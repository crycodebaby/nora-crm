# 10 – Checklisten, Textbausteine und Audit (Datenmodell-Spezifikation)

**Welle 7b** — Spezifikation  
**Welle v0.3d2** — Datenbankmigration umgesetzt  
**Welle v0.3d3** — RPC `start_checklist_run_from_template` umgesetzt  
**Welle v0.3d4** — Checklisten-UI im Vorgangsdetail umgesetzt  
**Welle v0.3d5** — Hotboard-Kachel „Produktionsfreigaben offen“ umgesetzt  
**Status:** Tabellen, RLS, Audit, Run-Start, Vorgangs-UI und **Hotboard-Kachel** implementiert

Dieses Dokument definiert das fachliche und technische Fundament für modulare Checklisten, wiederverwendbare Textbausteine und zentrale Audit-Logs. Es ergänzt `01-domain-model.md`, `03-data-model-guardrails.md`, `09-window-order-workflow.md` und den Decision Log.

**Zielgruppe:** spätere Implementierungs-Agenten — damit keine zufälligen JSONB-Felder, doppelten Tabellen oder unvollständigen Audit-Strukturen entstehen.

---

## Implementierungsstand (v0.3d5)

| Element | Status |
|---------|--------|
| Komponente | `HotboardOpenProductionReleases` in `Hotboard.tsx` |
| Utils/Tests | `productionReleaseHotboardUtils.ts`, `.test.ts` |
| DB | keine Migration — liest `checklist_*` + `deals` + `companies` |
| Demo | Bereich ausgeblendet (`VITE_IS_DEMO`) |

### Filterlogik

| Kriterium | Regel |
|-----------|--------|
| Vorlage | `FENS_PRODUCTION_RELEASE` (`checklist_templates.code`) |
| Run | `status = 'open'` |
| Sichtbar | mind. 1 offener **Pflichtpunkt** → Priorität `required_missing` |
| Optional | nur optionale Punkte offen → `optional_only`, nach hinten sortiert |
| Ausgeschlossen | `completed`/`cancelled`, archivierte Vorgänge, alle Punkte erledigt |

### Sortierung (max. 5)

1. `required_missing` vor `optional_only`
2. ältestes `checklist_runs.started_at` zuerst (längste Wartezeit auf Freigabe)
3. Tie-Break: `deals.expected_closing_date` aufsteigend

**Begründung:** `started_at` misst direkt, wie lange die Produktionsfreigabe offen ist; Nachfassdatum nur als Sekundärsignal.

### Navigation

Klick → `noraCreatePath({ resource: 'deals', type: 'show', id })` → `/vorgaenge/:id/show`

### Bewusst nicht

- Keine Rollenlogik, kein Auto-Statuswechsel, keine E-Mail, keine Hotboard-Automation

---

## Implementierungsstand (v0.3d4)

| Element | Status |
|---------|--------|
| UI-Komponente | `DealProductionChecklistSection` in `DealShow` |
| Utils/Tests | `checklistUtils.ts`, `checklistUtils.test.ts` |
| DataProvider | `startChecklistRunFromTemplate` (Supabase RPC) |
| Demo | Abschnitt sichtbar, deaktiviert mit Hinweis (`VITE_IS_DEMO`) |
| Snippet-Plus/Minus | ❌ Folge-Welle |
| Rollenlogik / Statuswechsel | ❌ bewusst nicht |

### UI-Platzierung

- **Datei:** `src/components/atomic-crm/deals/DealShow.tsx` — zwischen Aufgaben und Notizen
- **Sichtbarkeit:** `category = fensterservice` **oder** bestehende `checklist_runs` für den Vorgang
- **Titel:** „Produktionsfreigabe Fenster“ (`resources.deals.checklist.title`)

### Ablauf

1. **Start:** Button ruft `dataProvider.startChecklistRunFromTemplate` → Supabase-RPC `start_checklist_run_from_template` — **keine** manuellen INSERTs in `checklist_runs` / `checklist_run_items`
2. **Laden:** `useGetList('checklist_runs', { deal_id })` + `useGetList('checklist_run_items', { checklist_run_id })`, sortiert nach `sort_index`
3. **Abhaken:** `useUpdate('checklist_run_items')` mit `is_checked`, `checked_at`, `checked_by` (aus `useGetIdentity`)
4. **Notiz:** optionales Textfeld per „Notiz“-Button; Speichern via `update` auf `note`
5. **Audit:** DB-Trigger `audit_checklist_run_item_changes` — kein Client-Schreiben auf `audit_events`
6. **Fortschritt:** „X von Y erledigt“; Hinweis „Pflichtpunkte erledigt“ wenn alle `is_required` erfüllt — **kein** automatischer Vorgangsstatus

### FakeRest / Demo

- `import.meta.env.VITE_IS_DEMO === "true"` → Abschnitt mit `resources.deals.checklist.demo_disabled`, kein RPC-Aufruf
- FakeRest `startChecklistRunFromTemplate` wirft `CHECKLISTS_NOT_AVAILABLE_IN_DEMO` (Fallback, falls UI-Guard umgangen wird)
- Vollständige Demo-Semantik (In-Memory-RPC) optional in Folge-Welle

### Grenzen v0.3d4

- Nur Vorlage `FENS_PRODUCTION_RELEASE`
- Keine Textbaustein-Plus/Minus-UI
- Keine Hotboard-Kachel (v0.3d5)
- Kein automatisches Setzen von `wartet-auf-hersteller` o. ä.

---

## Implementierungsstand (v0.3d3)

| Element | Status |
|---------|--------|
| Migration Tabellen | `20260628150000_checklists_snippets_audit.sql` |
| Migration Run-Start | `20260628160000_start_checklist_run_from_template.sql` |
| RPC | `start_checklist_run_from_template(p_template_code, p_deal_id, p_contact_id?)` → `uuid` |
| TypeScript | `START_CHECKLIST_RUN_FROM_TEMPLATE_RPC`, `StartChecklistRunFromTemplateArgs` |
| SQL-Verifikation | `supabase/tests/checklists_audit_verification.sql` (d2 + d3) |
| UI | ❌ v0.3d4 |

### RPC `start_checklist_run_from_template`

```sql
start_checklist_run_from_template(
  p_template_code text,
  p_deal_id bigint,
  p_contact_id bigint default null
) returns uuid
```

**Verhalten:**

- Nur `authenticated` (nicht `anon`); prüft `auth.uid()`
- Lädt aktive Vorlage per `code`, Vorgang per `p_deal_id`
- Übernimmt `company_id` vom Vorgang, `service_area_code` von der Vorlage
- **Idempotent:** existiert offener Run (`status = 'open'`) für `deal_id + template_id` → gleiche `id` zurück, keine neuen Items, kein Audit
- Sonst: INSERT Run + COPY aller aktiven Template-Items mit `label_snapshot`, `is_required`, `sort_index`
- **Audit:** ein `checklist.run_started` via bestehender INSERT-Trigger auf `checklist_runs` (nicht doppelt manuell)
- **Race:** `pg_advisory_xact_lock` + `unique_violation`-Fallback auf partial unique index

**Fehler:** Vorlage fehlt/inaktiv, Vorgang fehlt, keine aktiven Items, Kontakt fehlt/nicht verknüpft, nicht authentifiziert.

**Frontend-Aufruf (v0.3d4):**

```typescript
const { data: runId } = await supabase.rpc(START_CHECKLIST_RUN_FROM_TEMPLATE_RPC, {
  p_template_code: FENS_PRODUCTION_RELEASE_TEMPLATE_CODE,
  p_deal_id: dealId,
  p_contact_id: contactId ?? null,
});
```

### FakeRest / Demo

- **v0.3d4 Checklisten-UI** benötigt **Supabase** (RPC) oder minimale FakeRest-Erweiterung
- Empfehlung Demo: `supabase.rpc` spiegeln in `dataProvider` mit gleicher Idempotenz-Logik in Memory — **nicht** in v0.3d3 umgesetzt
- `npm run dev:demo` zeigt Checklisten-UI erst nach FakeRest-Stub

### Freigabe v0.3d4 UI

**Ja** — Run-Start ist serverseitig atomar und getestet; UI muss nur RPC aufrufen und Run-Items anzeigen/aktualisieren.

---

## Implementierungsstand (v0.3d2, historisch)

| Element | Status |
|---------|--------|
| Migration | `20260628150000_checklists_snippets_audit.sql` |
| Schema-Quellen | `supabase/schemas/01_tables.sql`, `02_functions.sql`, `04_triggers.sql`, `05_policies.sql`, `06_grants.sql` |
| TypeScript | `src/components/atomic-crm/types/checklists.ts` |
| SQL-Verifikation | `supabase/tests/checklists_audit_verification.sql` |
| Seed | `FENS_PRODUCTION_RELEASE` + 9 Items (8 required, Vorkasse optional) |
| UI | ❌ v0.3d4 |
| Hotboard-Kachel | ❌ v0.3d5 |

### Abweichungen / Anpassungen an Nora-Basis

| Spez-Feld | Implementierung | Grund |
|-----------|-----------------|-------|
| `deal_id uuid` | `bigint` FK → `deals.id` | Bestehende Nora-PKs sind `bigint` |
| `company_id uuid` | `bigint` FK → `companies.id` | wie oben |
| `contact_id uuid` | `bigint` FK → `contacts.id` | wie oben |
| `checklist_runs.status` default `open` | `open` \| `completed` \| `cancelled` | Spez-Anpassung (nicht `draft`/`in_progress`) |
| `entity_id` für Deals | `nora_entity_uuid('deal', id)` | Deterministisches UUID v5 für `bigint`-PKs |

### Audit-Minimum (v0.3d2)

| Event | Auslöser |
|-------|----------|
| `deal.stage_changed` | `deals.stage` UPDATE |
| `checklist.run_started` | `checklist_runs` INSERT |
| `checklist.run_completed` / `cancelled` / `run_status_changed` | Status-UPDATE |
| `checklist.item_checked` / `unchecked` | `is_checked` UPDATE |
| `checklist.item_note_changed` | `note` UPDATE |
| `snippet.created` / `snippet.deactivated` | Snippet INSERT / `is_active` → false |

### Bekannte Grenzen (v0.3d2)

- Vorlagen/Template-Items: **nur Admins** (`is_admin()`) dürfen INSERT/UPDATE — normale Nutzer lesen und führen Runs aus
- Keine DELETE-Policies auf Vorlagen, Runs, Snippets — Deaktivierung über `is_active`
- `insert_audit_event` nicht für Client-RPC freigegeben — nur Trigger/SECURITY DEFINER
- `actor_id` kann NULL sein, wenn Trigger ohne Auth-Kontext laufen (z. B. service_role)
- ~~Kein automatisches Anlegen von Run-Items beim Run-Start~~ — **behoben in v0.3d3** via `start_checklist_run_from_template`
- Rollenmodell für „Produktion freigegeben“ noch nicht feingranular

### Freigabe v0.3d4 UI

**Ja** — Datenmodell, Constraints, RLS, Audit-Fundament und Seed-Vorlage sind lokal verifiziert (`db reset` + SQL-Test). UI kann Runs/Items über PostgREST anlegen.

---

## 1. Ziel und Scope

### 1.1 Warum Nora modulare Checklisten braucht

Nora führt Vorgänge über Wochen und Monate — besonders im **Fensterservice** mit Aufmaß, Herstellerbestellung, Produktionsfreigabe und Montage. Der Chef-Prozess (siehe `09-window-order-workflow.md`) definiert **Qualitätskontrollen** (S4a/S4b/S4c), die bewusst **keine Kanban-Spalten** sind.

Checklisten müssen:

- **wiederverwendbar** sein (Vorlage pro Servicebereich, versionierbar)
- **am Vorgang ausführbar** sein (konkreter Lauf mit Snapshots)
- **verantwortlich nachvollziehbar** sein (wer hat wann was bestätigt)
- **historisch korrekt** bleiben (auch wenn Vorlagen später geändert werden)

### 1.2 Servicebereiche FENS / HAUS / IMMO

| Code | Fachlich | Beispiel-Checklisten |
|------|----------|----------------------|
| `FENS` | Fensterservice | Produktionsfreigabe, Aufmaß-Qualität |
| `HAUS` | Hausmeisterservice | Übergabeprotokoll, Objektbegehung |
| `IMMO` | Immobilienservice / Immobilienverwaltung | Verwaltungsübergabe, Mängelliste |

Ein gemeinsames Datenmodell verhindert, dass jeder Bereich eigene Sonderlösungen bekommt.

### 1.3 Warum nicht Notizen oder PDF

| Ansatz | Problem |
|--------|---------|
| **Notiz** | Kein strukturierter Pflicht-/Optional-Status, keine Vorlagen, schlechte Auswertung, Audit unsauber |
| **PDF** | Export ja — aber nicht führend; keine Live-Freigabe, keine Hotboard-Kachel, keine RLS |
| **Tags** | Keine Reihenfolge, kein Haken-Status, keine Verantwortlichkeit |
| **JSONB-only am Vorgang** | Keine Wiederverwendung, schwaches Audit, schwer querybar — siehe Abschnitt 3 |

**Regel:** Checklisten sind **strukturierte CRM-Daten** mit eigenen Tabellen — Notizen und Anhänge ergänzen, ersetzen nicht.

### 1.4 Warum Audit-Logs über Jahre

Ein Hausmeister- und Fensterbetrieb braucht bei Reklamationen, Gewährleistung und Personalwechsel Antworten auf:

- Wer hat die Produktion freigegeben?
- Wann wurde der Vorgangsstatus geändert?
- Was stand auf der Checkliste zum Zeitpunkt X?

**Audit** (`audit_events`) ist **append-only** und dient der **CRM-Nachvollziehbarkeit** — nicht GoBD-Archiv, nicht MailStore, nicht Buchhaltungsjournal. Es ergänzt die fachliche Historie über UUID-verknüpfte Ereignisse.

### 1.5 Scope dieser Welle

| In Scope | Außerhalb Scope |
|----------|-----------------|
| Tabellen- und Feld-Spezifikation | Migration, RLS-Implementierung |
| Servicebereich-Codes | Google Kalender, Maps, E-Mail |
| Audit-Event-Katalog (Beispiele) | UI, Sidebar, Hotboard-Kachel |
| Textbausteine (Plus/Minus-Konzept) | Kundenportal / Tracking-Link |
| Migrationsphasen v0.3d* | Physisches Löschen historischer Daten |

---

## 2. Servicebereiche

### 2.1 Codes

| `service_area_code` | Bedeutung | Typische `deals.category` (heute) |
|---------------------|-----------|-----------------------------------|
| `FENS` | Fensterservice | `fensterservice` |
| `HAUS` | Hausmeisterservice | `hausmeisterdienst` |
| `IMMO` | Immobilienservice / Immobilienverwaltung | *(noch kein eigener category-Wert — später)* |

### 2.2 Abgrenzung `company_id`

| Feld | Bedeutung | Darf **nicht** sein |
|------|-----------|---------------------|
| `company_id` | Kunde / Firma / Haushalt / Verwaltung | Servicebereich |
| `service_area_code` | Fachlicher Geschäftszweig (FENS/HAUS/IMMO) | Kundenreferenz |

**Guardrail:** `company_id` bleibt der Kunde. Servicebereiche werden über **`service_area_code`** abgebildet — auf Vorlagen, Checklisten-Läufen, Textbausteinen und (später optional) am Vorgang.

### 2.3 Mapping `deals.category` → `service_area_code` (Übergang)

Bis ein explizites Feld `deals.service_area_code` existiert, gilt beim Anlegen von Checklisten-Läufen:

```text
fensterservice     → FENS
hausmeisterdienst  → HAUS
(reparatur/wartung/sonstiges → NULL oder manuell HAUS/FENS je Kontext)
```

Später kann `deals.service_area_code` eingeführt werden — **ohne** `company_id` zu ersetzen.

---

## 3. Datenmodell-Entscheidung

### 3.1 Vergleich

| Option | Beschreibung | Bewertung |
|--------|--------------|-----------|
| **A) JSONB an `deals`** | z. B. `production_checklist jsonb` | ❌ Abgelehnt als Hauptmodell |
| **B) Relationale Tabellen** | Vorlagen, Läufe, Punkte, Snippets, Audit | ✅ **Empfohlen** |
| **C) Hybrid** | Relational + JSONB-Snapshots | ✅ Ergänzend, nicht führend |

### 3.2 Empfehlung: relational als Hauptmodell

**Primär:** Option B — eigene Tabellen (Abschnitt 4).

**JSONB nur ergänzend für:**

- `audit_events.old_data` / `new_data` / `metadata` — Event-Payload
- optional `checklist_runs.metadata` — Export-Kontext, keine führenden Punkte
- **nicht** als Ersatz für `checklist_run_items`

### 3.3 Begründung gegen JSONB-only

| Kriterium | JSONB-only | Relational |
|-----------|------------|------------|
| Auditfähigkeit | schwer querybar, keine FK | `audit_events` + FK auf Runs/Items |
| Wiederverwendbarkeit | Kopieren pro Vorgang | `checklist_templates` |
| Verknüpfbarkeit | nur `deal_id` | Deal, Kunde, Kontakt, Run, Item |
| RLS | ein Blob pro Vorgang | feingranular pro Tabelle |
| Datenchaos | Ad-hoc-Keys pro Entwickler | Schema + Constraints |
| Langzeit-Nachvollziehbarkeit | Vorlagenänderung überschreibt Semantik | `label_snapshot` pro Punkt |
| Hotboard / Auswertung | SQL/Views umständlich | `checklist_runs.status`, offene Pflichtpunkte |

---

## 4. Vorgeschlagene Tabellen

Alle Tabellen in Schema `public`, Primärschlüssel `uuid`, Zeitstempel `timestamptz`, FKs mit `ON DELETE RESTRICT` (kein Kaskaden-Löschen historischer Daten).

### 4.1 `checklist_templates`

**Zweck:** Wiederverwendbare Checklisten-Vorlagen.

| Spalte | Typ | Pflicht | Hinweis |
|--------|-----|---------|---------|
| `id` | `uuid` | ✅ | PK, `gen_random_uuid()` |
| `code` | `text` | ✅ | **unique**, stabil z. B. `FENS_PRODUCTION_RELEASE` |
| `name` | `text` | ✅ | sichtbar, z. B. „Produktionsfreigabe Fenster“ |
| `service_area_code` | `text` | ✅ | `FENS` \| `HAUS` \| `IMMO`, CHECK-Constraint |
| `description` | `text` | | fachliche Erklärung |
| `is_active` | `boolean` | ✅ | default `true`; Deaktivierung statt DELETE |
| `version` | `integer` | ✅ | default `1`; erhöhen bei inhaltlicher Vorlagenänderung |
| `created_by` | `uuid` | ✅ | FK → `auth.users` / `sales.user_id` |
| `created_at` | `timestamptz` | ✅ | |
| `updated_at` | `timestamptz` | ✅ | |

**Regeln:**

- Vorlagen **deaktivieren** (`is_active = false`), nicht physisch löschen.
- Neue Version: entweder `version++` am gleichen `code` oder neuer `code` — Entscheidung offen (Abschnitt 11).

### 4.2 `checklist_template_items`

**Zweck:** Standardpunkte einer Vorlage.

| Spalte | Typ | Pflicht | Hinweis |
|--------|-----|---------|---------|
| `id` | `uuid` | ✅ | PK |
| `template_id` | `uuid` | ✅ | FK → `checklist_templates.id` |
| `label` | `text` | ✅ | sichtbarer Punkt |
| `description` | `text` | | Hilfetext |
| `is_required` | `boolean` | ✅ | default `true` |
| `sort_index` | `integer` | ✅ | Reihenfolge |
| `is_active` | `boolean` | ✅ | default `true`; Punkt deaktivieren statt löschen |
| `created_at` | `timestamptz` | ✅ | |
| `updated_at` | `timestamptz` | ✅ | |

**Regeln:**

- Punkte **deaktivieren**, nicht löschen — alte Läufe referenzieren `template_item_id` optional.
- Sortierung über `sort_index`, nicht über Array-Reihenfolge in JSONB.

### 4.3 `checklist_runs`

**Zweck:** Konkret ausgeführte Checkliste an einem Vorgang/Kundenkontext.

| Spalte | Typ | Pflicht | Hinweis |
|--------|-----|---------|---------|
| `id` | `uuid` | ✅ | PK |
| `template_id` | `uuid` | ✅ | FK → `checklist_templates.id` |
| `deal_id` | `uuid` | ✅ | FK → `deals.id` |
| `company_id` | `uuid` | ✅ | FK → `companies.id` — denormalisiert für Abfragen/Audit |
| `contact_id` | `uuid` | | FK → `contacts.id`, nullable |
| `service_area_code` | `text` | ✅ | Snapshot zum Startzeitpunkt |
| `status` | `text` | ✅ | z. B. `draft` \| `in_progress` \| `completed` \| `cancelled` |
| `started_by` | `uuid` | ✅ | FK Benutzer |
| `completed_by` | `uuid` | | nullable |
| `started_at` | `timestamptz` | ✅ | |
| `completed_at` | `timestamptz` | | nullable |
| `created_at` | `timestamptz` | ✅ | |
| `updated_at` | `timestamptz` | ✅ | |

**Regeln:**

- Ein Vorgang kann **mehrere Läufe** haben (z. B. neue Freigabe nach Änderung) — Historie über Runs, nicht Überschreiben.
- `company_id` muss mit `deals.company_id` konsistent sein (Trigger oder App-Check).
- Fenster-Produktionsfreigabe: Template `FENS_PRODUCTION_RELEASE` bei `deals.stage >= angenommen` (fachlich, UI später).

### 4.4 `checklist_run_items`

**Zweck:** Konkrete abgehakte Punkte eines Laufs.

| Spalte | Typ | Pflicht | Hinweis |
|--------|-----|---------|---------|
| `id` | `uuid` | ✅ | PK |
| `checklist_run_id` | `uuid` | ✅ | FK → `checklist_runs.id` |
| `template_item_id` | `uuid` | | FK → `checklist_template_items.id`, nullable wenn Vorlagenpunkt später deaktiviert |
| `label_snapshot` | `text` | ✅ | **Pflicht** — historischer Text zum Zeitpunkt des Laufstarts |
| `is_required` | `boolean` | ✅ | Snapshot |
| `is_checked` | `boolean` | ✅ | default `false` |
| `checked_by` | `uuid` | | nullable |
| `checked_at` | `timestamptz` | | nullable |
| `note` | `text` | | optional, Kurzkommentar am Punkt |
| `sort_index` | `integer` | ✅ | |
| `created_at` | `timestamptz` | ✅ | |
| `updated_at` | `timestamptz` | ✅ | |

**Regeln:**

- Beim **Start** eines Laufs: Items aus aktiven Template-Items kopieren → `label_snapshot`, `is_required`, `sort_index`.
- Änderungen an der Vorlage **ändern nicht** abgeschlossene Läufe.
- Jeder Haken/Entfernen erzeugt `audit_events` (Abschnitt 5).

### 4.5 `saved_text_snippets`

**Zweck:** Wiederverwendbare Textbausteine für Plus/Minus-UI (Checklistenpunkt-Notiz, Aufgabentext, Notiz, Mängeltext).

| Spalte | Typ | Pflicht | Hinweis |
|--------|-----|---------|---------|
| `id` | `uuid` | ✅ | PK |
| `service_area_code` | `text` | ✅ | `FENS` \| `HAUS` \| `IMMO` |
| `kind` | `text` | ✅ | siehe unten |
| `text` | `text` | ✅ | Bausteintext |
| `shortcut` | `text` | | optional, z. B. Kurzcode |
| `is_active` | `boolean` | ✅ | default `true` |
| `created_by` | `uuid` | ✅ | |
| `created_at` | `timestamptz` | ✅ | |
| `updated_at` | `timestamptz` | ✅ | |
| `usage_count` | `integer` | ✅ | default `0`; bei Verwendung inkrementieren |

**`kind`-Werte:**

| `kind` | Verwendung |
|--------|------------|
| `checklist_item` | Notiz/Hinweis an Checklistenpunkt |
| `task_text` | Aufgabenbeschreibung |
| `note_text` | Vorgangs-/Kontaktnotiz |
| `issue_text` | Mängel-/Problemformulierung |

**Regeln:**

- **Plus** (UI später): neuen Baustein anlegen → INSERT.
- **Minus** (UI später): `is_active = false`, kein DELETE.
- Snippets sind **kein** Ersatz für Audit oder Checklistenstruktur.

### 4.6 ER-Übersicht

```text
checklist_templates 1──* checklist_template_items
checklist_templates 1──* checklist_runs
checklist_runs      1──* checklist_run_items
deals               1──* checklist_runs
companies           1──* checklist_runs
contacts            0──1 checklist_runs (optional)

saved_text_snippets (standalone, nach service_area_code + kind)

audit_events → optional FK-Kontext: company, contact, deal, checklist_run, checklist_run_item
```

---

## 5. Audit-Modell

### 5.1 Tabelle `audit_events`

| Spalte | Typ | Pflicht | Hinweis |
|--------|-----|---------|---------|
| `id` | `uuid` | ✅ | PK |
| `actor_id` | `uuid` | ✅ | wer hat die Aktion ausgelöst |
| `event_type` | `text` | ✅ | maschinenlesbar, stabil |
| `entity_type` | `text` | ✅ | z. B. `deal`, `checklist_run`, `checklist_run_item` |
| `entity_id` | `uuid` | ✅ | PK der betroffenen Entität |
| `company_id` | `uuid` | | nullable, Kontext |
| `contact_id` | `uuid` | | nullable |
| `deal_id` | `uuid` | | nullable |
| `checklist_run_id` | `uuid` | | nullable |
| `checklist_run_item_id` | `uuid` | | nullable |
| `old_data` | `jsonb` | | nullable, vorheriger Zustand (diff-fähig) |
| `new_data` | `jsonb` | | nullable, neuer Zustand |
| `metadata` | `jsonb` | | nullable, z. B. UI-Quelle, Client-Hint |
| `created_at` | `timestamptz` | ✅ | **nur Insert**, kein `updated_at` |

### 5.2 Regeln

| Regel | Umsetzung (später) |
|-------|---------------------|
| **Append-only** | Kein UPDATE/DELETE für `authenticated` auf `audit_events` |
| **Client schreibt nicht beliebig** | INSERT nur via Trigger, SECURITY DEFINER-Funktion oder Edge Function |
| **Fachlich lesbar** | `event_type` + `old_data`/`new_data` mit stabilen Keys; UI mappt auf deutsche Labels |
| **Kein GoBD-/MailStore-Ersatz** | Audit = CRM-Nachvollziehbarkeit; Buchhaltung/Rechnungsarchiv separat |
| **Kein Audit in Freitext** | Notizen duplizieren keine Audit-IDs oder JSON-Dumps |

### 5.3 Beispiel-Events

| `event_type` | Auslöser |
|--------------|----------|
| `deal.created` | Vorgang angelegt |
| `deal.stage_changed` | `deals.stage` geändert |
| `deal.updated` | andere Vorgangsfelder |
| `company.updated` | Kunde geändert |
| `contact.updated` | Ansprechpartner geändert |
| `checklist.run_started` | `checklist_runs` INSERT, status → `in_progress` |
| `checklist.item_checked` | `is_checked` true |
| `checklist.item_unchecked` | `is_checked` false |
| `checklist.run_completed` | alle Pflichtpunkte erfüllt, status → `completed` |
| `checklist.run_cancelled` | Lauf abgebrochen |
| `snippet.created` | Textbaustein angelegt |
| `snippet.deactivated` | `is_active` → false |
| `checklist.template_deactivated` | Vorlage deaktiviert (später, Admin) |

**Pflicht-Minimum v0.3d (Vorschlag):** Checklisten-Events + `deal.stage_changed` — Rest schrittweise.

---

## 6. Eindeutigkeit und Verknüpfung

### 6.1 Identifikatoren

| Art | Technisch | Sichtbar für Menschen |
|-----|-----------|------------------------|
| Primärschlüssel | `uuid` | nein (intern) |
| Kunde | `companies.id` | `customer_number` (`KD-*`) |
| Vorgang | `deals.id` | `case_number` (`VG-YYYY-*`) |
| Checklisten-Lauf | `checklist_runs.id` | optional später eigene Nummer — offen |
| Audit-Ereignis | `audit_events.id` | nein |

### 6.2 Verknüpfungsregeln

- Checklisten und Audit **immer über UUID-FKs** — nicht über Businessnummern allein.
- **Keine** Checklisten-ID als Text in Notizen speichern.
- **Keine** Audit-Informationen in `deals.description`, Notizen oder Tags.
- Foreign Keys erzwingen Integrität; denormalisierte Felder (`company_id` am Run) dienen Abfragen, nicht der alleinigen Wahrheit.

### 6.3 Businessnummern unverändert

`KD-*` und `VG-*` bleiben unveränderlich und getrennt von Checklisten — siehe `08-numbering-and-global-search.md`.

---

## 7. RLS und Berechtigungen

### 7.1 Grundsätze (Zielbild)

| Aktion | Wer |
|--------|-----|
| Checkliste **ausführen** (Punkte haken) | normale CRM-Nutzer (`authenticated`) |
| Checklisten-**Vorlage** bearbeiten/deaktivieren | eingeschränkt (Admin/Meister — offen) |
| Textbaustein **anlegen** (Plus) | normale Nutzer im eigenen Servicebereich |
| Textbaustein **deaktivieren** (Minus) | Owner oder Admin |
| **Audit lesen** | alle Nutzer im Mandant (oder rollenabhängig später) |
| **Audit schreiben/löschen** | System/Trigger only |

### 7.2 Technische Leitplanken

- `audit_events`: **kein** UPDATE/DELETE für App-Rollen.
- Vorlagen und Snippets: **`is_active = false`** statt DELETE.
- Historische `checklist_run_items`: nicht löschen wenn Run `completed`.
- Produktionsfreigabe (S4b): später nur bestimmte Rollen dürfen finalen Summenpunkt setzen — über RLS oder App-Logik auf spezifischem `template_item` (offen).

### 7.3 RLS-Muster (Vorschlag)

- Gleiche Mandanten-Sicht wie bestehende Tabellen (`companies`, `deals`) — Nora ist aktuell Single-Tenant pro Instanz; RLS analog zu `deals` (alle `authenticated` lesen/schreiben wo erlaubt).
- `checklist_templates`: SELECT für alle; INSERT/UPDATE nur Admin-Rolle (später).

---

## 8. UI-Konzept (ohne Implementierung)

### 8.1 Ort

- **Vorgangsdetail** (`DealShow`): Abschnitt „Checkliste“ / „Produktionsfreigabe“ bei passendem Servicebereich und Status.
- Keine Sidebar-Änderung in dieser Welle.
- Keine neue Navigationsebene.

### 8.2 Darstellung

| Element | Richtlinie |
|---------|------------|
| Layout | eckige Boxen, klare Hierarchie (Nora-Designsystem) |
| Vorgangsnummer | klein, sekundär unter Titel (`BusinessNumber`) |
| Punkte | touchfreundlich (`nora-touch-target`), Checkbox + Label |
| Pflichtpunkte | visuell markiert |
| Fortschritt | z. B. „7/9 Pflichtpunkte“ |
| Textbausteine | Dropdown/Schnellauswahl; **Plus** speichert neuen Baustein; **Minus** deaktiviert |

### 8.3 Fenster-Produktionsfreigabe (Referenz)

Entspricht `09-window-order-workflow.md` Abschnitt 4.3 — als Template `FENS_PRODUCTION_RELEASE` mit 9 Punkten (Vorkasse optional).

### 8.4 Hotboard (später v0.3d5)

Kachel „Produktionsfreigaben offen“: Vorgänge `FENS`, Status `angenommen` oder `wartet-auf-hersteller`, Run unvollständig oder nicht gestartet.

---

## 9. Anti-Overengineering- und Anti-Duplizierungsregeln

| ❌ Nicht | ✅ Stattdessen |
|----------|----------------|
| JSONB-only-Checkliste am Vorgang | relationale `checklist_*` Tabellen |
| Checkliste als Notiz | `checklist_runs` + `checklist_run_items` |
| Checklistenpunkte als Tags | strukturierte Items mit `is_checked` |
| getrennte Audit-Tabellen pro Bereich | eine `audit_events` |
| Höning-spezifische Felder | generischer Hersteller / Notiz |
| `company_id` als Servicebereich | `service_area_code` |
| physisches Löschen von Vorlagenpunkten | `is_active = false` |
| UI Plus/Minus ohne DB | `saved_text_snippets` zuerst |
| Audit in Freitext | `audit_events` |
| Zweites Statussystem in JSONB | `deals.stage` + Checkliste getrennt |
| Checklisten-ID in Notizen | UUID-FK nur in strukturierten Tabellen |

---

## 10. Migrationsphasen

| Phase | Inhalt | Abhängigkeiten |
|-------|--------|----------------|
| **v0.3d1** | Spezifikation (dieses Dokument) | 7a, 7b ✅ |
| **v0.3d2** | DB-Migration: Tabellen Abschnitt 4 + `audit_events` | v0.3d1 |
| **v0.3d3** | RPC `start_checklist_run_from_template`, Idempotenz, Item-Copy | ✅ `20260628160000` |
| **v0.3d4** | UI Checkliste im Vorgangsdetail | ✅ |
| **v0.3d5** | Hotboard-Kachel „Produktionsfreigaben offen“ | ✅ |
| **v0.3d6** | Audit-Ansicht in Kunden-/Vorgangsdetail (lesend) | v0.3d3 |
| **v0.3e** | UI-Komponenten / Designsystem (ChecklistCard, SnippetPicker) | v0.3d4 |
| **v0.3f** | Linke Sidebar (Navigation) | eigenes Konzept, nicht hier |

**Hinweis:** Terminmodell (`appointments`), Google Maps/Kalender und E-Mail bleiben in `09-window-order-workflow.md` Phasen v0.3e–v0.4+ — nicht mit v0.3d vermischen.

---

## 11. Offene Entscheidungen

| # | Frage | Tendenz / Anmerkung |
|---|-------|---------------------|
| 1 | Welche Rollen dürfen Vorlagen bearbeiten? | Admin + Meister; Sachbearbeitung nur ausführen |
| 2 | Wer darf Produktion freigeben (S4b)? | Meister/Chef auf letztem Pflichtpunkt |
| 3 | Müssen einzelne Punkte User + Datum speichern? | **Ja** — `checked_by`, `checked_at` pro Item |
| 4 | Vorkasse bei Fensterservice Pflicht? | **Nein** — Punkt 8 optional (`is_required` pro Template konfigurierbar) |
| 5 | Textbausteine global oder pro Servicebereich? | **Pro `service_area_code`**; globale Snippets nur wenn explizit `IMMO`+`FENS` Duplikat gewünscht |
| 6 | Sichtbare Checklisten-Nummer? | v0.3d: UUID intern reicht; Businessnummer `CL-*` nur bei Bedarf |
| 7 | Pflicht-Audit-Events für v0.3d? | Checkliste + `deal.stage_changed` minimum |
| 8 | `deals.service_area_code` einführen? | optional; Mapping von `category` reicht zunächst |
| 9 | Mehrere aktive Runs pro Vorgang/Template? | max. 1 `in_progress` pro Template+Deal empfohlen |
| 10 | Versionierung Vorlagen | `version` integer + neuer Run referenziert `template_id` zum Startzeitpunkt |

---

## 12. Bezug zu Fensterauftrag (09)

Die 9 Punkte aus `09-window-order-workflow.md` Abschnitt 4.3 werden als **erste Seed-Vorlage** `FENS_PRODUCTION_RELEASE` modelliert — nicht als Kanban-Status.

| Chef-Punkt | Template-Item (Vorschlag) | `is_required` |
|------------|---------------------------|---------------|
| Maße geprüft | `measures_verified` | true |
| Anschlagrichtung geprüft | `opening_direction_verified` | true |
| Farbe innen/außen | `color_verified` | true |
| Glasart | `glass_verified` | true |
| Zusatzoptionen | `options_verified` | true |
| Lieferadresse | `delivery_address_verified` | true |
| Rechnungsbetrag | `invoice_amount_verified` | true |
| Vorkasse bezahlt | `prepayment_received` | **false** (vertraglich) |
| Produktion freigegeben | `production_released` | true (Gate) |

S4a/S4b/S4c bleiben **Checklistenpunkte**, keine `deals.stage`-Werte.

---

## 13. Referenzen

| Dokument | Inhalt |
|----------|--------|
| `01-domain-model.md` | Domänenbegriffe, Servicebereiche |
| `03-data-model-guardrails.md` | Fallen, Kandidaten-Tabelle aktualisiert |
| `06-decision-log.md` | Entscheidung Welle 7b |
| `07-agent-change-checklist.md` | Checklisten bei DB-Änderungen |
| `08-numbering-and-global-search.md` | KD/VG-Nummern |
| `09-window-order-workflow.md` | Fensterprozess, UI-Zielorte |
