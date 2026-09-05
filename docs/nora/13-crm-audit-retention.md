# 13 – CRM-Audit-Verlauf und Aufbewahrung (v0.3l)

Stand: 2026-07-15 · **Abschluss v0.3l.1:** 2026-07-15

## Zweck

Der CRM-Audit-Verlauf in `audit_events` protokolliert **relevante geschäftliche Änderungen** an Kunden, Kontakten, Vorgängen, Aufgaben, Notizen und Benutzerrechten.

Er dient der **betrieblichen Nachvollziehbarkeit** im Team — nicht der Mitarbeiter-Leistungsüberwachung, nicht GoBD-Archiv, nicht MailStore.

## Was wird protokolliert

| Bereich | Beispiel-Aktionscodes |
|---|---|
| Kunden | `company.created`, `company.updated`, `company.deleted` |
| Kontakte | `contact.created`, `contact.updated`, `contact.deleted` |
| Vorgänge | `deal.created`, `deal.updated`, `deal.status_changed`, `deal.archived`, `deal.restored`, `deal.deleted` |
| Aufgaben | `task.created`, `task.updated`, `task.completed`, `task.reopened`, `task.deleted` |
| Kontaktnotizen | `contact_note.created`, `contact_note.updated`, `contact_note.deleted` |
| Vorgangsnotizen | `deal_note.created`, `deal_note.updated`, `deal_note.deleted` |
| Benutzer | `user.role_changed`, `user.disabled`, `user.enabled` (Trigger), `user.invited`, `user.invitation_resent`, `user.password_setup_requested` (`record_employee_admin_event`, W3) |
| Checklisten | bestehende `checklist.*`-Codes (unverändert) |
| Google Kalender (v0.4c.1+) | `calendar.event_linked`, `calendar.event_unlinked` (Sync/Connect ab v0.4c.2) |

## Was wird nicht protokolliert

- Jeder Seitenaufruf oder Klick
- Vollständige Notiztexte (nur `content_changed`, Länge, Vorschau ≤80 Zeichen, Hash)
- Passwörter, Tokens, OAuth-Daten, Service-Role-Schlüssel
- Unveränderte Felder bei UPDATE
- `customer_number` / `case_number` als „Änderung“ (nur Snapshot in Metadaten)

## Rollen und Sichtbarkeit

| Rolle | Globaler Verlauf (`/audit`) | Kontext-Historie (Akte) |
|---|---|---|
| **admin** | ✅ via `get_global_audit_events` + direktes SELECT | ✅ via `get_entity_audit_events` |
| **office** | ❌ | ✅ via `get_entity_audit_events` (RPC) |
| **viewer** | ❌ | ❌ |

Office hat **kein** globales `SELECT` auf `audit_events` — nur die kontrollierte RPC.

## Technisches Modell

### Speicher

- Eine Tabelle: `public.audit_events` (append-only)
- Keine zweite Audit-Tabelle
- FK-Kontext: `company_id`, `contact_id`, `deal_id`, `task_id`, `note_id` (nullable, `ON DELETE SET NULL`)

### Schreibweg

- **Nur** DB-Trigger → `nora_private.write_audit_event` (Owner: `nora_audit_writer`)
- Ausnahme seit User Lifecycle W3 (2026-09-05): die `service_role`-only RPC `public.record_employee_admin_event` schreibt genau drei Mitarbeiter-Ereignisse aus der `users` Edge Function (Ereignistyp, Actor, Ziel, Metadaten validiert; Entity und Snapshots aus der DB). `public.insert_audit_event` bleibt für die Kalender-Functions (Actor `System`).
- `nora_audit_writer`: NOLOGIN, INSERT-only auf `audit_events`
- Clients (`authenticated`) können **nicht** direkt INSERT/UPDATE/DELETE

### Actor-Snapshot

Bei jedem Ereignis serverseitig:

- `actor_id` (auth UUID)
- `actor_sales_id`
- `actor_name_snapshot`
- `actor_role_snapshot`

**Actor-Vertrauensgrenze (W3, 2026-09-05):** Browser-Sitzung → Actor aus dem JWT-`sub`. Privilegierter Server-Pfad (`users` Edge Function, `service_role`) → die Edge Function verifiziert das Caller-JWT und übergibt nur die User-ID; der Executor bzw. `record_employee_admin_event` prüft sie (existierender aktiver Admin) und verankert sie transaktionslokal (`nora.audit_actor_user_id`); `resolve_audit_actor()` löst Name/Rolle/`sales.id` selbst aus `public.sales` auf. Kein Aufrufer kann Snapshots liefern. Ein `service_role`-Write ohne Verankerung bleibt `System` (echte Automation). `entity_id` für Mitarbeiter ist immer `nora_entity_uuid('sales', sales.id)` — Actor (wer), Ziel (`entity_id`, welcher Mitarbeiter) und Operation (`request_id`, welche Ausführung) sind drei verschiedene Fakten. Zeilen vor W3 tragen `System`; sie bleiben unverändert.

### Änderungsformat (kompakt)

```json
{
  "changes": {
    "stage": { "old": "neue-anfrage", "new": "termin-vereinbart" }
  },
  "customer_number": "KD-000015",
  "case_number": "VG-2026-000020"
}
```

### Aufbewahrungsklassen (`retention_class`)

| Klasse | Verwendung |
|---|---|
| `crm_change` | Normale CRM-Feldänderungen |
| `security` | Löschungen |
| `user_management` | Rollen, Deaktivierung |
| `checklist` | Checklisten-Ereignisse |
| `integration` | Kalender-Integration (`calendar.*`, v0.4c.1+) |
| `system` | Migrationen, System |

**Keine harte Löschfrist in Trigger.** Endgültige Fristen werden in einer Datenschutz-/Aufbewahrungsrichtlinie vor Mitarbeiterbetrieb festgelegt.

**Kein automatischer Purge** in v0.3l.

## Append-only und Grenzen

- Trigger `prevent_audit_events_update/delete` blockieren Mutation
- RLS: kein INSERT/UPDATE/DELETE für `authenticated`
- Admin darf lesen, **nicht** ändern oder löschen

**Grenze:** Ein technischer Datenbankeigentümer (`postgres`) kann innerhalb derselben DB weiterhin eingreifen. Für starke Beweissicherung ist später **externer Export / WORM-Speicher** vorgesehen — nicht in v0.3l.

## Speicherstatistik

Admin-RPC `get_audit_storage_stats()`:

- Ereignisanzahl, ältestes/neuestes Ereignis
- Tabellen- und Indexgröße
- Ereignisse letzte 30 Tage
- Wachstumshinweis: `unauffaellig` | `wachstum_beobachten` | `archivierungsplanung_erforderlich`

Anzeige dezent auf der Admin-Audit-Seite.

## Demo-Modus

- Kleine synthetische Demo-Ereignisse (`source = demo`)
- Fiktive Personen, kein Production-Audit in Demo-Builds
- Admin: globale Seite; Office: Kontext; Viewer: nichts

## RPCs

| RPC | Rolle | Zweck |
|---|---|---|
| `get_entity_audit_events(type, id, limit, before)` | admin, office | Akten-Historie |
| `get_global_audit_events(...)` | admin | Globaler Verlauf |
| `get_audit_storage_stats()` | admin | Größenstatistik |

## Verifikation

```bash
npx supabase db reset --local
# Tests: rbac_rls_matrix, checklists_audit_verification, crm_audit_verification
npm run typecheck
npm run build
npm run dev:demo
```

## v0.3l.1 — Abschluss

Welle v0.3l.1 schließt CRM-Audit für den Mitarbeiterbetrieb ab:

| Bereich | Status |
|---|---|
| Schema-Sync | Migration `20260715120000_nora_crm_audit.sql` + Schema-Dateien konsistent |
| SQL-Tests | `crm_audit_verification.sql`, aktualisierte `rbac_rls_matrix.sql`, `checklists_audit_verification.sql` |
| Frontend | `EntityAuditHistory`, `AuditPage`, `auditFormatters`, i18n `crm.audit.*` |
| Unit-Tests | `auditUx.test.ts` |
| Manuelle Abnahme | Admin/Office/Viewer-Matrix in Demo empfohlen (`docs/nora/12-role-ux-acceptance.md` ergänzen) |

**Bewusst zurückgestellt (nicht Blocker für v0.3l.1):**

| Thema | Stand |
|---|---|
| `event_hash` | Spalte vorbereitet — **keine** Befüllung in Triggern |
| `request_id` | seit Operation Correlation Wave befüllt (Header/GUC); seit W3 auch für alle `user.*`-Ereignisse der `users` Edge Function (eine Operation-ID pro Request) |
| WORM-Export | Kein externer unveränderlicher Speicher — nur DB append-only |
| Purge / Archivierung | Keine automatische Löschfrist |

**Grenzen der Immutability:** Trigger + RLS verhindern Mutation durch App-Rollen. Ein DB-Superuser (`postgres`) oder direkter Tabellenzugriff außerhalb der App kann weiterhin eingreifen — für rechtssichere Beweisführung ist später **externer Export / WORM-Speicher** vorgesehen.

## Offene Entscheidungen

- Endgültige gesetzliche Aufbewahrungsfristen (Datenschutz/Compliance)
- Externer WORM-Export und Befüllung von `event_hash` / `request_id`
- `company.archived` / `contact.archived` (noch kein DB-Feld)
