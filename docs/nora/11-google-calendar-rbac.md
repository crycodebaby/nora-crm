# 11 – Google-Kalender-Architektur (Spezifikation)

**Welle v0.4a** — Spezifikation  
**Status:** Spezifikation. Datenbankseite implementiert und in Production angewendet; Edge-Functions-Seite **nicht deployt** (siehe Kasten unten und `14-google-calendar-readonly-implementation.md`)

> **Deployment-Stand in Production (read-only verifiziert 2026-09-10).** Die **Datenbankseite ist live**: die Migrationen `20260716120000_google_calendar_readonly` und `20260717120000_google_calendar_oauth_sync` stehen im Production-Ledger. Die **drei Edge Functions `calendar-connect-start`, `calendar-connect-callback` und `calendar-sync-manual` sind nicht deployt** — in Production laufen ausschließlich `users` und `brevo-email-events`. Die Google-Kalender-Integration ist damit **in Production nicht nutzbar**: Verbinden und Sync existieren als Code, Schema und Spezifikation, nicht als laufende Funktion. Alles Folgende beschreibt den **beabsichtigten Contract**, nicht einen aktiven Produktionszustand. Offene Punkte: `17-known-issues-and-planned-waves.md`.

> **Dieses Dokument ist nicht der globale Security-Owner.** Das Nora-weite Rollenmodell (`admin` · `office` · `viewer`), die globale Berechtigungsmatrix, RBAC-/RLS-Architektur, Grants und die allgemeinen `SECURITY DEFINER`-Prinzipien stehen seit CR2 in **[`22-security-and-access.md`](22-security-and-access.md)**. Hier bleibt ausschließlich der **kalenderspezifische** Security- und Access-Kontext. Bei Abweichung gewinnt `22`.

Dieses Dokument spezifiziert die Google-Kalender-Integration auf Basis des bestehenden Auth-/Benutzermodells. Es ergänzt `01-domain-model.md`, `03-data-model-guardrails.md`, `22-security-and-access.md`, `10-checklists-snippets-audit.md` und den Decision Log.

**Zielgruppe:** Implementierungs-Agenten — damit kein zweites Terminsystem und keine Token-Leaks entstehen.

---

## 0. Ausgangslage

**Benutzer-, Rollen- und RLS-Grundlage:** [`22-security-and-access.md`](22-security-and-access.md) — `public.sales` ist die einzige Benutzertabelle (1:1 zu `auth.users` über `sales.user_id`), `sales.role` die einzige führende Rollenquelle, die Datenbank die letzte Enforcement Boundary. Mitarbeiter-Lifecycle: [`19-user-lifecycle-architecture.md`](19-user-lifecycle-architecture.md). Die frühere v0.4a-Ist-Analyse dieses Abschnitts beschrieb den Stand vor der RBAC-Härtung; ihr Originalwortlaut liegt im Archiv (`releases/2026-07.md`).

**Für den Kalender relevant:** `companies.sales_id`, `contacts.sales_id`, `deals.sales_id`, `tasks.sales_id` werden per Trigger `set_sales_id_default()` gesetzt und sind **Attribution, kein Zugriffsschutz**. Checklisten und Audit nutzen `auth.uid()` (UUID) für `started_by`, `checked_by`, `actor_id` — nicht `sales.id`; geplante `calendar.*`-Ereignisse folgen dem Audit-Contract in [`13`](13-crm-audit-retention.md).

---

## A. System-of-Record-Regel

| Domäne | Führendes System | Nora speichert |
|--------|------------------|----------------|
| Terminzeit (Start/Ende) | **Google Kalender** | Cache (`starts_at`, `ends_at`) |
| Titel, Ort | **Google Kalender** | Cache |
| Wiederholung / Serie | **Google Kalender** | Cache (`recurrence_rule` / JSON-Spiegel) |
| Existenz des Termins | **Google Kalender** | `google_event_id` + Sync-Status |
| CRM-Verknüpfung | **Nora** | `company_id`, `contact_id`, `deal_id` |
| Herkunft / Eigentum | **Nora** | `origin` (`google` \| `nora`) |
| Audit | **Nora** | `audit_events` |

**Kein zweites eigenständiges Nora-Terminmodell.** Keine Tabelle `appointments` als führende Quelle. `google_calendar_events` ist **Cache + Verknüpfung**, nicht paralleler Kalender.

**Abgrenzung zu bestehenden Feldern:**

- `deals.expected_closing_date` = **Nachfassdatum**, kein Kalendertermin
- `deals.stage = termin-vereinbart` = Vorgangsstatus, kein Ersatz für Kalender-Sync
- Hotboard „Heutige Termine“ (v0.4d) liest aus `google_calendar_events`, nicht aus `expected_closing_date`

---

## B. Kalender-Sicherheitsregeln

| Regel | Umsetzung |
|-------|-----------|
| **Genau eine** konfigurierte Geschäfts-Kalender-ID | Feld `google_calendar_connections.calendar_id` — Singleton pro Nora-Instanz |
| Kalender-ID **nicht** in UI-Komponenten hart codieren | Nur Konfiguration / DB / Edge-Function-Secrets |
| **Keine** private iCal-Adresse | Weder technisch noch in Doku verwenden |
| **Keine** öffentliche Embed-Integration | Kein iframe/öffentlicher Google-Embed |
| **Keine** Änderung von Kalenderfreigaben über Nora | Sharing bleibt manuell in Google Admin |
| **Keine** Änderung bestehender Labels/Farben in Google | Nora liest/schreibt Event-Felder, nicht Kalender-Metadaten |
| Bestehende Google-Termine zunächst **read-only** in Nora | `origin = google` → kein PATCH/DELETE Richtung Google in v0.4c–d |
| Nora darf später nur **eindeutig Nora-eigene** Termine ändern/löschen | `origin = nora` + Extended Properties in Google |
| Testkalender separat angelegt | ID wird in v0.4c konfiguriert, nicht im Repo hardcodiert |

---

## C. Kalender-Zugriff je Rolle

Die globalen Rollen (`admin` · `office` · `viewer`), ihre Definition und die **globale Berechtigungsmatrix** stehen in [`22`](22-security-and-access.md) Abschnitt 4. Hier steht nur die **kalenderspezifische Ausprägung** — eine Verfeinerung dieser Matrix, nie ein Widerspruch.

Legende: ✅ erlaubt · ❌ verboten · ⚙️ nur Admin

| Kalender-Aktion | admin | office | viewer |
|---|:---:|:---:|:---:|
| Termine lesen | ✅ | ✅ | ✅ |
| Kalendertermin **erstellen** (Nora → Google) | ✅ | ✅ | ❌ |
| Termin mit Kunde/Vorgang **verknüpfen** | ✅ | ✅ | ❌ |
| **Nora-Termin** (`origin = nora`) bearbeiten / löschen | ✅ | ✅ | ❌ |
| **Google-Termin** (`origin = google`) bearbeiten | ❌\* | ❌\* | ❌ |
| **Kalenderverbindung** verwalten (OAuth) | ⚙️ | ❌ | ❌ |

\* Google-Termine sind in Nora für **alle** Rollen read-only. Eine spätere Bearbeitung fremder Google-Termine ist eine offene Entscheidung (Abschnitt L).

Geplante `calendar.*`-Audit-Ereignisse (Abschnitt J) nutzen dieselbe `audit_events`-Tabelle und dieselben Lese-Regeln wie der übrige Audit — Contract: [`13`](13-crm-audit-retention.md), Sichtbarkeit je Rolle: [`22`](22-security-and-access.md) Abschnitt 4.3.

---

## D. RBAC-Umsetzung

Vollständig in [`22`](22-security-and-access.md): Rollenquelle, Capability-Rollen, interne `nora_private`-Helper, `SECURITY DEFINER`-Vertrag, Grants und Default-Privilegien, Session-gebundene Autorisierung.

Der historische Optionsvergleich A–E (Rolle an `sales` · `user_roles`-Tabellen · JWT-Claims · DB-Abfrage · Hybrid) und die Empfehlung von v0.4b sind **kein aktueller Security-Contract**. Die durable Entscheidung und ihre Begründung stehen in [`06`](06-decision-log.md) („v0.4b – RBAC- und RLS-Härtung", „v0.4b.1", „v0.4b.2 – RBAC-Abschluss"); der Originalwortlaut liegt im Archiv (`releases/2026-07.md`).

**Für den Kalender gilt daraus:**

- Kalender-Schreibpfade laufen über die Capability-Rollen `nora_calendar_writer` / `nora_calendar_linker`, nicht über breite Grants.
- Kalender-Edge-Functions nutzen `service_role`; `public.insert_audit_event` bleibt für sie ausführbar (bekannter Punkt: [`17`](17-known-issues-and-planned-waves.md) A.4).
- Ein **Inventar** der `SECURITY DEFINER`-Functions wird nicht in diesem Dokument geführt: eine gepflegte Liste veraltet still. Der aktuelle Stand wird gegen die Datenbank ermittelt (`pg_proc.prosecdef`, `pg_proc.proacl`, `has_function_privilege`) — Vorgehen: [`21`](21-agent-runbooks.md) Sektion 4.

---

## E. Kalender-Datenmodell (Spezifikation)

Neue Tabellen dürfen **UUID** als PK nutzen. FKs zu `companies`, `contacts`, `deals` sind **`bigint`**.

### E.1 `google_calendar_connections`

**Zweck:** Singleton-Verbindungsstatus zum **einen** Geschäftskalender. Enthält **keine** Tokens.

| Spalte | Typ | Pflicht | Hinweis |
|--------|-----|---------|---------|
| `id` | `uuid` | ✅ | PK, `gen_random_uuid()` |
| `calendar_id` | `text` | ✅ | Google Calendar ID des Geschäftskalenders |
| `calendar_summary` | `text` | | Cache: Anzeigename aus Google (read-only Info) |
| `status` | `text` | ✅ | `disconnected` \| `connected` \| `error` \| `token_expired` |
| `scopes_granted` | `text[]` | ✅ | z. B. `{calendar.events.owned.readonly}` |
| `connected_by` | `uuid` | | FK → `auth.users` — wer OAuth abgeschlossen hat |
| `connected_at` | `timestamptz` | | |
| `disconnected_at` | `timestamptz` | | |
| `last_sync_at` | `timestamptz` | | |
| `last_sync_status` | `text` | | `success` \| `failed` \| `partial` |
| `last_sync_error` | `text` | | keine Tokens, nur Fehlermeldung |
| `sync_token` | `text` | | später für inkrementellen Sync (v0.4g) |
| `created_at` | `timestamptz` | ✅ | |
| `updated_at` | `timestamptz` | ✅ | |

**Constraints / Indexe:**

- Partial unique: **max. eine** Zeile mit `status = 'connected'` (oder strikt Singleton: nur 1 Zeile gesamt — Entscheidung L.8)
- Index auf `status`
- **Kein** Refresh Token in dieser Tabelle

**RLS (Ziel):**

| Operation | admin | office | viewer |
|-----------|-------|--------|--------|
| SELECT | ✅ | ✅ (read-only Metadaten) | ✅ (read-only) |
| INSERT/UPDATE/DELETE | ✅ | ❌ | ❌ |

**Löschverhalten:** `ON DELETE` — keine FK-Kinder; Disconnect setzt `status = 'disconnected'`, löscht Tokens in Secret-Ablage. Zeile historisch behalten oder soft-delete — Tendenz: **behalten** für Audit.

**Audit:** `calendar.connected`, `calendar.disconnected` (Abschnitt J).

### E.2 `google_calendar_events`

**Zweck:** Gespiegelte Google-Events + Nora-CRM-Verknüpfung.

| Spalte | Typ | Pflicht | Hinweis |
|--------|-----|---------|---------|
| `id` | `uuid` | ✅ | PK |
| `google_event_id` | `text` | ✅ | Google Event ID |
| `google_calendar_id` | `text` | ✅ | muss = `connections.calendar_id` |
| `origin` | `text` | ✅ | `google` \| `nora` — CHECK |
| `title` | `text` | | Cache |
| `location` | `text` | | Cache |
| `starts_at` | `timestamptz` | ✅ | Cache — Hotboard-Queries |
| `ends_at` | `timestamptz` | ✅ | Cache |
| `is_all_day` | `boolean` | ✅ | default `false` |
| `timezone` | `text` | | IANA, z. B. `Europe/Berlin` |
| `recurrence_rule` | `text` | | RRULE-Zusammenfassung oder NULL |
| `recurring_event_id` | `text` | | Master-Series-ID bei Instanzen |
| `status` | `text` | | `confirmed` \| `tentative` \| `cancelled` |
| `etag` | `text` | | Google ETag für Optimistic Concurrency (v0.4f) |
| `html_link` | `text` | | Link zur Google-UI — **nicht** iCal |
| `extended_properties_private` | `jsonb` | | Spiegel Nora-Metadaten aus Google Extended Properties |
| `company_id` | `bigint` | | FK → `companies.id` |
| `contact_id` | `bigint` | | FK → `contacts.id` |
| `deal_id` | `bigint` | | FK → `deals.id` |
| `linked_by` | `uuid` | | `auth.uid()` beim Verknüpfen |
| `linked_at` | `timestamptz` | | |
| `synced_at` | `timestamptz` | ✅ | letzter erfolgreicher Cache-Refresh |
| `created_at` | `timestamptz` | ✅ | |
| `updated_at` | `timestamptz` | ✅ | |

**Constraints / Indexe:**

- `UNIQUE (google_calendar_id, google_event_id)`
- Index `(starts_at)` — Hotboard „Heute“
- Index `(deal_id)` WHERE `deal_id IS NOT NULL`
- Index `(company_id)` WHERE `company_id IS NOT NULL`
- Index `(origin, starts_at)`
- Optional: Index auf `(recurring_event_id)` für Serien

**FK-Löschverhalten:**

- `company_id`, `contact_id`, `deal_id`: `ON DELETE SET NULL` — Event bleibt im Kalender-Cache, Verknüpfung fällt weg
- Kein `ON DELETE CASCADE` auf Google-Events

**RLS (Ziel):**

| Operation | admin | office | viewer |
|-----------|-------|--------|--------|
| SELECT | ✅ | ✅ | ✅ |
| UPDATE Verknüpfung (`company_id`/`contact_id`/`deal_id`) | ✅ | ✅ | ❌ |
| INSERT (Nora-Termin anlegen) | ✅ | ✅ | ❌ |
| UPDATE Cache-Felder (Titel, Zeit, …) | 🔧 | 🔧 | ❌ |
| DELETE Zeile | 🔧 | 🔧** | ❌ |

\*\* office darf nur `origin = nora` löschen (über RPC/Edge Function, nicht direktes DELETE aller Events)

**Sync-Schreiben:** Cache-Updates (`title`, `starts_at`, `etag`, …) ausschließlich durch **Edge Function / service_role** — nicht durch Browser-Client.

**Audit:** `calendar.event_linked`, `calendar.event_created`, `calendar.event_updated`, `calendar.event_deleted`, `calendar.sync_completed`, `calendar.sync_failed`.

### E.3 Veralteter Kandidat `appointments`

Die Guardrails-Liste enthielt `appointments` als Kandidaten — **verworfen** zugunsten von `google_calendar_events`. Kein paralleles Modell einführen.

---

## F. Secret-Modell

| Secret | Ablage | Zugriff |
|--------|--------|---------|
| Google **Client ID** | Edge Function Env (öffentlich im OAuth-Flow) | Edge Functions |
| Google **Client Secret** | **Nur** Supabase Edge Function Secrets | Edge Functions |
| **Refresh Token** | Verschlüsselte Secret-Ablage (Supabase Vault oder dedizierte Tabelle, nur `service_role`) | Edge Functions |
| **Access Token** | Kurzlebig im Function-Memory | nie persistieren |
| OAuth **State** / PKCE | Function-Memory oder kurzlebige DB-Zeile ohne Token | Edge Functions |

**Verboten:**

- Tokens im **Frontend** / `localStorage` / React-State persistieren
- Tokens in **`audit_events`** (`old_data`/`new_data`/`metadata`)
- Tokens in **`google_calendar_connections`** oder **`google_calendar_events`**
- **`service_role`** im Browser oder in `VITE_*` Env-Vars
- Private **iCal-URL** als Sync-Ersatz

**Empfohlene Secret-Tabelle (v0.4c, optional):**

`google_calendar_oauth_secrets` — nur `service_role` GRANT, RLS deny all, Spalte `refresh_token_encrypted` + `connection_id` FK. Alternativ: Supabase Vault Secret pro Instanz.

---

## G. OAuth-Phasen

| Phase | Scope | Welle |
|-------|-------|-------|
| Read-only | `https://www.googleapis.com/auth/calendar.events.owned.readonly` | v0.4c |
| Write (eigene Events) | `https://www.googleapis.com/auth/calendar.events.owned` | v0.4e–f |
| **Nicht** | Voller `calendar`-Scope | — |
| **Nicht** | `calendar.readonly` auf alle Kalender | — |

**Regeln:**

- Genau **ein** Test-/Geschäftskalender — ID in `google_calendar_connections.calendar_id`
- OAuth-Flow nur für **`admin`** (Kalenderverbindung verwalten)
- Scope-Erweiterung read → write ist **eigene Welle** (v0.4e) mit Re-Consent
- Kein Google Workspace Domain-Wide Delegation in v0.4 — nur OAuth des verbindenden Admin-Kontos

---

## H. Sync-Modell (stufenweise)

| Stufe | Welle | Beschreibung |
|-------|-------|--------------|
| 1 — Manueller read-only Sync | v0.4c | Admin/Function-Trigger „Jetzt synchronisieren“; `events.list` mit Zeitfenster |
| 2 — Periodischer Sync | v0.4d | Cron/scheduled Edge Function (z. B. alle 15 min); Fehler in `last_sync_error` |
| 3 — `syncToken` | v0.4g | Inkrementell; `google_calendar_connections.sync_token` |
| 4 — Google Push (Webhook) | v0.4g | `channels.watch` + Verification; Channel-Renewal |

**Sync-Verhalten:**

- Upsert in `google_calendar_events` per `(google_calendar_id, google_event_id)`
- Gelöschte Events in Google → `status = cancelled` oder Zeile entfernen (Entscheidung L.9)
- Nora-Verknüpfungen bei Re-Sync **erhalten** (nur Cache-Felder überschreiben)
- Kein Sync in v0.4a

---

## I. Termin-Eigentum

### I.1 `origin`-Werte

| `origin` | Bedeutung | Nora-Schreiben | Google-Schreiben |
|----------|-----------|----------------|------------------|
| `google` | In Google angelegt, von Nora gespiegelt | Nur Verknüpfung | read-only (v0.4c–d) |
| `nora` | Über Nora angelegt | Bearbeiten/Löschen (office/admin) | über API mit `calendar.events.owned` |

### I.2 Nora-Metadaten in Google

Nora-eigene Termine erhalten **versteckte Extended Properties** (private):

```json
{
  "nora_origin": "nora",
  "nora_event_id": "<uuid>",
  "nora_deal_id": "12345",
  "nora_company_id": "42"
}
```

**Erkennungsregel:** Beim Sync hat ein Event `origin = nora`, wenn `extendedProperties.private.nora_origin = nora` gesetzt ist — auch nach Export aus Nora.

### I.3 Bearbeitungsregeln

| Aktion | `origin = google` | `origin = nora` |
|--------|-------------------|-----------------|
| Lesen / Hotboard | ✅ alle Rollen | ✅ alle Rollen |
| CRM-Verknüpfung setzen | admin, office | admin, office |
| Titel/Zeit ändern | ❌ (v0.4a–f) | admin, office (v0.4f) |
| Löschen | ❌ | admin, office + **Bestätigungsdialog** |
| Google-Labels/Farben ändern | ❌ | ❌ |

### I.4 Konfliktschutz (v0.4f)

- `etag` bei jedem Sync speichern
- Update an Google mit `If-Match: etag`
- Bei 412 Precondition Failed → UI-Hinweis „Termin wurde extern geändert“ + Refresh

---

## J. Audit (`audit_events`)

Bestehende Tabelle — **keine neue Audit-Tabelle**. CRM-Audit (v0.3l) und Checklisten-Audit (v0.3d2) teilen sich dieselbe append-only-Tabelle; Kalender-Events folgen dem gleichen Muster.

### J.1 Neue `event_type`-Werte

| `event_type` | Auslöser | `entity_type` |
|--------------|----------|---------------|
| `calendar.connected` | OAuth erfolgreich, `connections.status = connected` | `google_calendar_connection` |
| `calendar.disconnected` | Admin trennt Verbindung | `google_calendar_connection` |
| `calendar.sync_completed` | Sync erfolgreich | `google_calendar_connection` |
| `calendar.sync_failed` | Sync-Fehler | `google_calendar_connection` |
| `calendar.event_linked` | CRM-FKs gesetzt/geändert | `google_calendar_event` |
| `calendar.event_created` | Nora legt Termin an | `google_calendar_event` |
| `calendar.event_updated` | Nora ändert Nora-Termin | `google_calendar_event` |
| `calendar.event_deleted` | Nora löscht Nora-Termin | `google_calendar_event` |

### J.2 Audit-Felder

| Feld | Verwendung |
|------|------------|
| `entity_id` | `nora_entity_uuid('google_calendar_event', id)` oder direkt UUID des Event-Datensatzes |
| `company_id`, `contact_id`, `deal_id` | Kontext aus Verknüpfung |
| `metadata` | `{ "google_event_id": "...", "origin": "nora" }` — **ohne Tokens** |
| `actor_id` | `auth.uid()` des auslösenden Nutzers |

Schreiben nur über **SECURITY DEFINER** / Trigger / Edge Function — analog bestehendem Checklisten-Audit.

---

## K. Phasenplan

| Phase | Inhalt | Abhängigkeiten |
|-------|--------|----------------|
| **v0.4a** | Spezifikation (dieses Dokument) | ✅ |
| **v0.4b** | RBAC-Migration: `sales.role`, RLS, `canAccess`, Edge Function `users` | v0.4a |
| **v0.4c** | Google OAuth read-only, manueller Sync, `google_calendar_*` Tabellen | v0.4b |
| **v0.4d** | Hotboard-Terminkarten, periodischer Sync | v0.4c |
| **v0.4e** | Nora-Termine erstellen (write scope) | v0.4c, Re-Consent |
| **v0.4f** | Nora-Termine ändern/löschen, ETag-Konflikte | v0.4e |
| **v0.4g** | `syncToken`, Google Push Webhooks | v0.4d |

**Bewusst nicht in v0.4a:** Migration, Edge Functions, OAuth, UI, Secrets.

---

## L. Offene Entscheidungen

Nur **kalenderspezifisch** Offenes. Die früheren Zeilen L.1–L.3 und L.10–L.12 betrafen das globale Rollenmodell (Benutzertabelle, erster Admin, `office`-Löschrecht, `viewer`-Audit, JWT-Claim, `sales.administrator`); sie sind entschieden und stehen in [`22`](22-security-and-access.md) Abschnitt 4 bzw. [`06`](06-decision-log.md). Die Nummern bleiben unverändert, damit alte Verweise auflösbar sind.

| # | Frage | Optionen | Tendenz v0.4a |
|---|-------|----------|---------------|
| L.4 | Darf `office` **bestehende Google-Termine** später bearbeiten? | Nie / nur Verknüpfung / mit Einschränkung | **Nur Verknüpfung**; Bearbeitung in Google direkt |
| L.5 | Kalender zusätzlich mit Sekretärin bei **Google** teilen? | Ja (empfohlen) / nur Nora | **Ja** — Google-Sharing unabhängig von Nora; Nora-OAuth bleibt Admin-Konto |
| L.6 | Welche **Eventtypen** in Nora anzeigen? | Alle / ohne transparente / ohne ganztägig | **Alle bestätigten** im Zeitfenster; `cancelled` ausblenden |
| L.7 | **Wiederkehrende Termine** darstellen? | Master only / expandierte Instanzen / beides | **Expandierte Instanzen** im Sync-Zeitfenster; `recurring_event_id` für Gruppierung |
| L.8 | `google_calendar_connections` Singleton | Strikt 1 Zeile vs. Historie mehrerer Zeilen | **Historie** mit max. 1× `status=connected` |
| L.9 | Gelöschte Google-Events | Zeile löschen vs. `status=cancelled` | **`cancelled` + aus Hotboard filtern** |
| L.13 | Demo/FakeRest Kalender | Stub vs. deaktiviert | **Deaktiviert** mit Hinweis (wie Checklisten in Demo) |
| L.14 | Hotboard-Zeitfenster | Heute / heute+morgen / 7 Tage | **Heute + morgen** (operativer Büro-Alltag) |

---

## M. Anti-Duplizierungsregeln

| ❌ Nicht | ✅ Stattdessen |
|----------|----------------|
| Zweites Terminsystem (`appointments`) | `google_calendar_events` als Cache |
| Private iCal-URL | Google Calendar API mit OAuth |
| Kalender-ID in React-Komponenten | `google_calendar_connections` / Konfiguration |
| Tokens in `audit_events` | Nur Event-Metadaten ohne Secrets |
| `expected_closing_date` als Terminersatz | Kalender-Cache für Hotboard |
| Google-Labels/Farben über Nora ändern | Unverändert in Google belassen |
| Alle Google-Termine editierbar | Nur `origin = nora` |

---

## N. Referenzen

| Dokument / Code | Inhalt |
|-----------------|--------|
| `01-domain-model.md` | Domänenbegriffe, geplante Kalender-Erweiterung |
| `22-security-and-access.md` | **globales** Rollenmodell, Berechtigungsmatrix, RBAC/RLS, Grants, `SECURITY DEFINER` |
| `03-data-model-guardrails.md` | Daten-/Persistenzinvarianten; Fallen-Index (Fallen 17, 22–24, 26, 27 → dieses Dokument) |
| `06-decision-log.md` | Entscheidung v0.4a |
| `21-agent-runbooks.md` Sektionen 4, 5, 8 | operative RBAC- und Kalender-Schritte |
| `10-checklists-snippets-audit.md` | Audit-Muster, `is_admin()` |
| `supabase/schemas/01_tables.sql` | `sales`, `audit_events` |
| `supabase/schemas/05_policies.sql` | Bestehende RLS |
| `src/.../canAccess.ts` | UI-Rollenmatrix (spiegelt RLS, ersetzt sie nicht) |
| `src/.../normalizeCrmError.ts` | Fehlerübersetzung für UI (v0.3k) |
| `src/.../NoraReadOnlyBanner.tsx` | Viewer-Lesemodus (kompakt ab v0.3k.1) |
| `src/.../NoraAccessGuard.tsx` | Edit-Route-Redirects (v0.3k.1) |
| `src/.../NoraDialogContent.tsx` | Dirty-Close für Modals (v0.3k.1) |
| `src/.../NoraShowBoundary.tsx` | Show-Lade-/Fehlerzustände (v0.3k.1) |
| `src/.../ImportPage.tsx` | JSON-Import — nur Admin bis Assistent (v0.3k.1) |
| `src/.../demoSession.ts` | Kanonische FakeRest-Demo-Session (v0.3k.2) |
| `src/.../DemoRoleSwitcher.tsx` | Demo-Rollentest (nur FakeRest) |
