# 06 – Decision Log Nora CRM

Dieses Dokument hält relevante Entscheidungen fest. Neue Entscheidungen müssen mit Datum, Kontext, Entscheidung und Begründung ergänzt werden.

## 2026-06-28 – Atomic CRM als Basis für Nora CRM

### Kontext

Es wurde ein CRM benötigt, das mit Vercel/Supabase-naher Architektur kompatibel ist und ohne eigenen VPS betrieben werden kann.

### Entscheidung

Atomic CRM wird als Basis verwendet und zu Nora CRM angepasst.

### Begründung

Atomic CRM liefert bereits:

- React-/TypeScript-Frontend
- Supabase-kompatible Architektur
- Kontakte, Kunden, Vorgänge, Aufgaben
- Demo-/FakeRest-Modus
- gute Erweiterbarkeit

## 2026-06-28 – Interne Resource-Namen bleiben stabil

### Kontext

Sichtbar soll die App deutsch sein. Intern verwendet Atomic CRM Resource-Namen wie `contacts`, `companies`, `deals`.

### Entscheidung

Interne Resource-Namen bleiben vorerst englisch. Sichtbar und in URLs wird Nora deutsch.

### Begründung

Eine harte Umbenennung könnte DataProvider, Supabase-Tabellen, Relations, Tests, Activity-Logs und gespeicherte Daten brechen.

## 2026-06-28 – Deals werden sichtbar zu Vorgängen

### Kontext

„Deal“ ist für einen Hausmeister-/Fensterservice-Betrieb fachlich unpassend.

### Entscheidung

Sichtbarer Begriff: Vorgang.

### Begründung

Ein Vorgang kann Anfrage, Angebot, Nachfassung, Auftrag oder Abschluss sein und passt besser zum operativen Handwerksalltag.

## 2026-06-28 – Nora-Brandfarbe

### Entscheidung

Primäre Akzentfarbe: `#ff3b1f`.

### Begründung

Kräftiges Rot-Orange schafft Wiedererkennbarkeit und hebt primäre Aktionen hervor.

## 2026-06-28 – EUR und de-DE

### Entscheidung

Währungsformatierung in Nora ist EUR mit Locale `de-DE`.

### Begründung

Nora ist für deutsche Betriebe konzipiert. Dollar-Anzeigen sind fachlich falsch und wirken wie Demo-/US-Altlasten.

## 2026-06-28 – Demo-Daten sind synthetisch

### Entscheidung

Demo-Daten dürfen realistisch wirken, aber keine echten personenbezogenen Daten enthalten.

### Begründung

Datenschutz, sichere Weitergabe im Repo und risikofreier Testbetrieb.

## 2026-06-28 – Welle 4: Typografie und comfortable density

### Kontext

Nach Branding, deutscher Lokalisierung und Demo-Daten soll Nora CRM auf Desktop und iPad lesbarer und ruhiger wirken — ohne großes Redesign und ohne Backend-Änderungen.

### Entscheidung

- **Schrift:** Bundled `Inter Variable` (`@fontsource-variable/inter`) mit System-Fallback; keine CDN-Font-Requests
- **Steuerung:** Zentrale CSS-Tokens und Utility-Klassen in `src/index.css` (`.nora-page`, `.nora-list-row`, `.nora-form-section`, etc.)
- **Density:** „Comfortable density“ — mehr Zeilenhöhe und Touch-Ziele (min. 44 px), aber keine überdimensionierte UI
- **Formulare:** Breiteres `SimpleForm` (`max-w-xl`), Sektionen über `.nora-form-section`
- **Listen:** Klare Hierarchie via `.nora-list-title` / `.nora-muted`, dezente Trennlinien statt bunter Flächen

### Begründung

Zentrale Tokens sind wartbarer als verstreute Tailwind-Einzelklassen. Inter ist bereits im Projekt und eignet sich für interne Business-Tools. Größere Touch-Ziele und Line-Heights verbessern iPad-Bedienung und Lesbarkeit längerer Notizen — ohne DataProvider, DB oder Resource-Namen anzufassen.

## 2026-06-28 – Welle 5: Vorgangsworkflow ohne DB-Änderung

### Kontext

Nora soll typische Fensterservice-Vorgänge von Anfrage bis Nachfassen durchspielbar machen — mit vorhandenen Atomic-Feldern.

### Entscheidung

- **`expected_closing_date`** = sichtbar „Nächstes Nachfassdatum“ (Überfällig/heute markiert)
- **`sales_id`** = sichtbar „Zuständig“ im Formular und in der Detailansicht
- **`stage`** = Vorgangsstatus (u. a. Nachfassen, Wartet auf Hersteller)
- **Aufgaben** weiter über `tasks.contact_id`; Schnellaktionen in der Vorgangsdetailansicht für verknüpfte Ansprechpartner
- **Dashboard** zeigt „Heute nachfassen“ und „Wartet auf Hersteller“ aus vorhandenen Vorgangsdaten (ersetzt durch **Hotboard v0.3b** — siehe unten)

### Begründung

Keine Migration nötig; fachliche Lücken (dediziertes Nachfassdatum, `deal_id` an Aufgaben, Hersteller-Feld) bleiben dokumentiert für spätere DB-Erweiterungen.

## 2026-06-28 – Welle 6a: Öffentliche Startseite

### Kontext

Nicht eingeloggte Nutzer landeten direkt auf Login oder Sign-up-Redirect — kein ruhiger Einstieg mit Firmen- und Produktmarke.

### Entscheidung

- **`StartPage`** zeigt **`NoraLandingPage`** (minimalistisch, zwei Aktionen)
- **`/login`** als dedizierte Route für die bestehende `LoginPage`
- **`/sign-up`** unverändert für Registrierung / Erstbenutzer
- **Branding:** Betreiber „Ergart Gruppe“ oben links (blauer Rahmen + Logo aus `public/logos`); Nora-Monogramm zentral als Produktmarke
- **Auth-Logik** unverändert; nur Routing und UI-Einstieg

### Begründung

Klare Trennung zwischen öffentlichem Einstieg und Anmeldung, ohne Supabase oder DataProvider anzufassen. Symbiose Firma + Software ohne Marketing-Website.

## 2026-06-28 – Welle 6a-Polish: Auth-Navigation

### Kontext

Login und Sign-up hatten keine konsistenten Querverweise: Login verlinkte oben fälschlich auf `/login` statt `/`; Sign-up bot weder Einloggen noch Zurück zur Startseite.

### Entscheidung

- **`AuthPageNav`** — gemeinsame sekundäre Navigation (Outline/Ghost, touchfreundlich)
- **Login:** oben Ghost „Zur Startseite“ → `/`; unter Formular „Noch kein Konto?“ + „Registrieren“ → `/sign-up`
- **Sign-up:** „Schon ein Konto?“ + „Einloggen“ → `/login`; Ghost „Zur Startseite“ → `/`
- **i18n:** `crm.auth.nav.*` in DE/EN/FR
- **Keine** Änderung an Auth-Provider, Supabase oder DB

### Begründung

Nach `db reset` fehlen lokale Nutzer — klare Wege zu Sign-up und Startseite reduzieren Verwirrung ohne Fachlogik anzufassen.

## 2026-06-28 – Vorgänge-Kanban aufräumen (Kanban-Polish)

### Kontext

Die Vorgangsübersicht zeigte alle 12 konfigurierten Status-Spalten inklusive leerer Spalten mit `0,00 €` — bei wenigen Vorgängen wirkte das überladen.

### Entscheidung

- **Leere Spalten** standardmäßig ausblenden (`getVisibleDealStages` in `stages.ts`)
- **Toggle** „Alle Status anzeigen“ / „Leere Status ausblenden“ mit Persistenz in `localStorage` (`nora-deals-show-all-stages`)
- **Spaltensummen** nur bei Summe > 0, Label „Auftragswert: …“
- **Drag-and-drop** nur zwischen sichtbaren Spalten; für Ziele in ausgeblendeten Spalten Toggle nutzen
- **Statuswechsel** in Detail/Edit unverändert (volle Phasenliste)
- Keine DB-, Migrations- oder Nummernlogik-Änderung

### Begründung

Ruhigere Standardansicht für den Alltag; volle Pipeline bei Bedarf einblendbar ohne Konfiguration in den Einstellungen zu ändern.

## 2026-06-28 – Welle 6b: Kundennummern, Vorgangsnummern, globale Suche (Spezifikation)

### Kontext

Für Telefonannahme, E-Mail-Rückfragen und schnelle Zuordnung braucht Nora eindeutige, feste Nummern. Bisher existieren weder `customer_number` noch `case_number` in DB, Typen oder Demo-Daten; Suche ist nur pro Liste (`q`-Filter), keine globale Suche im Header.

### Entscheidung

- **Kundennummer:** Format `KD-000001` (ohne Jahresanteil), Feld `companies.customer_number`
- **Vorgangsnummer:** Format `VG-2026-000001` (mit Jahresanteil), Feld `deals.case_number`
- **Vergabe:** serverseitig (Postgres-Sequenz + Funktion + Trigger), nicht im Frontend
- **Immutability:** nach Vergabe nicht änderbar (DB-Trigger)
- **Globale Suche:** später im Header; exakte KD/VG → Direktnavigation zu `/kunden/:id/show` bzw. `/vorgaenge/:id/show`
- **Welle 6b:** nur Dokumentation in `08-numbering-and-global-search.md` — **keine** Migration, kein DataProvider, keine UI

### Begründung

Feste Nummern sind kommunikationsfähige Primärschlüssel für Menschen. Serverseitige Generierung verhindert Duplikate bei parallelen Anlagen. Getrennte Spezifikation vor Implementierung hält DB-Backfill und UI-Wellen kontrollierbar.

### Offene Punkte (Projektinhaber)

- UI-Label „Vorgangsnummer“ vs. „Ticket-ID“
- Präfix `KD` vs. `K`
- Jährlicher Reset der Vorgangs-Sequenz ja/nein
- Reihenfolge: globale Suche erst nach Nummern-Migration (empfohlen)
- Telefonnummern-Normalisierung in der Suche

## 2026-06-28 – Welle 6c: Kundennummern und Vorgangsnummern implementiert

### Kontext

Welle 6b spezifizierte feste KD-/VG-Nummern. Für Telefon- und E-Mail-Alltag müssen Nummern automatisch, eindeutig und unveränderlich vergeben werden.

### Entscheidung

- **Migration** `20260628130000_customer_and_case_numbers.sql` mit Backfill in einer Transaktion
- **Zähler:** Tabelle `number_counters` (nicht pro-Jahr-Sequenzen) — wartbar, race-condition-sicher via `ON CONFLICT DO UPDATE`
- **Kundennummer:** `next_customer_number()` → `KD-000001` (global monoton)
- **Vorgangsnummer:** `next_case_number(created_at)` → `VG-YYYY-000001` (pro Jahr)
- **Trigger:** `assign_*` bei Insert (wenn NULL), `prevent_*` bei Update (Immutability)
- **UI:** read-only Anzeige in Karten/Details/Edit; keine Formularfelder
- **FakeRest:** gemeinsame Logik in `misc/numbering.ts`
- **Globale Suche:** bewusst **nicht** in dieser Welle (v0.2e)

### Begründung

Serverseitige Vergabe verhindert Duplikate und Client-Manipulation. `number_counters` skaliert besser als dynamische Jahres-Sequenzen. Backfill in derselben Migration hält lokale und Remote-Deploys konsistent.

### Offene Punkte

- Globale Suche (v0.2e)
- CSV-Import/Export mit Nummernspalten (v0.2f)

## 2026-06-28 – Welle 6c-QA: Datenbank-Audit Nummern

### Kontext

Nach Implementierung von `customer_number` / `case_number` soll die Migration reproduzierbar sein und Nummern eindeutig, vollständig und unveränderlich wirken.

### Entscheidung

- **`npx supabase db reset --local`:** erfolgreich — Migration `20260628130000` reproduzierbar
- **Schema, Trigger, Constraints:** bestätigt per SQL-Introspection
- **Immutability:** bestätigt (lokaler UPDATE-Test schlägt fehl)
- **Security:** `number_counters` für `anon`/`authenticated` nicht direkt lesbar; Linter meldet fehlendes RLS (durch REVOKE abgefedert)
- **Risiko dokumentiert:** direkte RPC-Aufrufe `next_*` und Client-gesetzte Nummern bei Insert — kein Schema-Fix in QA-Welle
- **Globale Suche:** **freigegeben** als nächste Welle (6d / v0.2e)

### Begründung

QA blockiert die globale Suche nicht. API-Hardening ist empfohlen, aber kein Showstopper für UI-Suche, da die Nora-App Nummern nicht clientseitig setzt.

## 2026-06-28 – Welle 6c-Hardening: Nummern-API absichern

### Kontext

6c-QA fand zwei Lücken: RPC-Aufruf von `next_*` ohne Insert; Client konnte Fake-Nummern bei Insert mitsenden.

### Entscheidung

- Migration `20260628140000_numbering_api_hardening.sql`
- `assign_customer_number` / `assign_case_number`: **immer** DB-Nummer (`SECURITY DEFINER`)
- `REVOKE EXECUTE` auf `next_*` und `format_*` für `public`/`anon`/`authenticated`
- `GRANT EXECUTE` nur `service_role` für interne Funktionen
- UPDATE-Immutability unverändert (`prevent_*`)
- **Globale Suche (6d): freigegeben**

### Begründung

Single Source of Truth für Nummern liegt ausschließlich in der DB. Client-Werte werden robust überschrieben statt Fehler zu werfen — Imports/API-Clients können keine reservierten Nummern setzen.

### Verifikation

`npx supabase db reset --local` (2026-06-28): RPC für `authenticated`/`anon` blockiert; Fake-Nummern bei Insert überschrieben; UPDATE-Immutability bestätigt.

## 2026-06-28 – Welle 7a: Fensterauftrag-Prozess spezifiziert

### Kontext

Chef-Rohkonzept mit 11+ Phasen (Aufmaß bis Montage abgeschlossen), internen Kontrollpunkten, Kunden-E-Mails und Tracking-Link soll Nora-konform bewertet werden — ohne sofortige Implementierung.

### Entscheidung

- **Spezifikation** in `09-window-order-workflow.md`
- **Fensterauftrag** ≠ alle Vorgänge — Zuordnung über `deals.category = fensterservice` (später optional `workflow_type`)
- **Schlanke Hauptstatus** (7–8 Kanban-Meilensteine) aus bestehenden `dealStages`-IDs
- **S4a / S4b / S4c / S5** als **Checkliste**, nicht als Kanban-Spalten
- **Hersteller generisch** — Höning nicht im Modell verdrahten
- **E-Mails:** Vorlagen → manuell → Automation (keine Vollautomatik jetzt)
- **Kundenstatus-Link:** eigenes späteres Modul (v0.5), nicht jetzt
- **Google Maps/Kalender:** sinnvoll später; **Drive/Keep/Tasks** nicht Nora-Kern
- **Nächste Implementierung:** v0.3a Globale Suche, dann v0.3b Hotboard + v0.3c Fenster-Kanban

### Begründung

Der Chef-Prozess liefert wertvolle operative Logik für einen Kerngeschäftszweig, würde als 1:1-Kanban aber Nora überladen. Trennung Hauptstatus/Checkliste hält das Board ruhig (konsistent mit Kanban-Polish) und bereitet digitale Qualitätssicherung vor, ohne vorzeitige DB-Migrationen.

## 2026-06-28 – Welle 6d: Globale Suche im Header

### Kontext

KD-/VG-Nummern sind implementiert und gehärtet. Büro und Telefonannahme brauchen zentrale Schnellsuche ohne Listenwechsel.

### Entscheidung

- **`GlobalSearch`** im Desktop-Header und als Mobile-Overlay (`MobileNavigation`)
- **`performGlobalSearch`** nutzt bestehende `getList`/`q`-Suche und `@eq` für exakte Nummern
- **Keine** neue DB-Struktur, **keine** Migration
- Direktnavigation bei exaktem `KD-*` / `VG-YYYY-*`
- Gruppierte Trefferliste (max. 5 pro Ressource)
- Telefon: einfache Normalisierung (Leerzeichen, `-`, `()`); +49/0 später
- Vorgangs-Listen-`q` um Feld `stage` ergänzt (global + Listen-Suche)

### Begründung

Option A aus Spezifikation — Frontend-orchestriert über DataProvider, ohne Postgres-RPC. Nutzt vorhandene RLS und Lifecycle-`q`-Suche; FakeRest-kompatibel über natives `q`-Filtering.

## 2026-06-28 – v0.3b: Hotboard / operative Startübersicht

### Kontext

Nach Login soll das Büro sofort sehen, was heute wichtig ist — ohne neue DB-Struktur, ohne Google Kalender, ohne Fensterauftrag-Checkliste.

### Entscheidung

- **`Hotboard`** ersetzt `DealFollowUpPanel` und die prominente Dashboard-`TasksList`
- **Team-Ansicht** für Vorgänge (kein `sales_id`-Filter) — Büro sieht alle offenen Vorgänge
- **Fünf Bereiche**, je max. 5 Einträge, mit Empty-State „Keine Einträge“:
  - Heute nachfassen (`expected_closing_date` heute/überfällig, bestehende `dealUtils`)
  - Neue Anfragen (`stage = neue-anfrage`)
  - Wartet auf Hersteller (`stage = wartet-auf-hersteller`)
  - Angebote nachfassen (`angebot-gesendet`, `nachfassen`; Dedupe gegen Nachfass-Bereich)
  - Offene Aufgaben (eigene Tasks über `contact_id` → Ansprechpartner-Link)
- **Archivierte Vorgänge** ausgeschlossen (`archived_at@is: null`)
- **Navigation:** `noraCreatePath` → `/vorgaenge/:id/show`, `/kontakte/:id/show`
- **Filterlogik** in `hotboardUtils.ts` (unit-getestet)
- **Nicht gebaut:** Heutige Termine, Montage/Aufmaß heute — kein Terminmodell; Hinweis in UI und Docs
- **Google Kalender** bewusst später (echte Start/Ende-Termine, nicht `expected_closing_date` missbrauchen)

### Begründung

Nutzt ausschließlich vorhandene Felder und DataProvider-Abfragen. Hotboard oben, Statistik (`DealsChart`) und Aktivität darunter — ruhiges Nora-Layout für Desktop und Tablet.

## 2026-06-28 – v0.3c: Fenster-Kanban-Filter

### Kontext

Fensteraufträge sollen gezielt im Kanban betrachtet werden können, ohne die allgemeine Vorgangsübersicht zu dominieren. Prozess ist in `09-window-order-workflow.md` spezifiziert; S4a/S4b/S4c bleiben Checklistenpunkte.

### Entscheidung

- **Ansichtsauswahl** in `DealKanbanToolbar`: Alle Vorgänge · Fensterservice · Hausmeisterservice
- **Client-seitiger Filter** auf `deals.category` — keine DB-Migration, ergänzt (ersetzt nicht) den bestehenden Listenfilter
- **Fensterservice-Kanban:** 8 bevorzugte Status-Spalten (`FENSTERSERVICE_KANBAN_STAGE_IDS`); Vorgänge in anderen Status erscheinen als Zusatzspalte wenn belegt
- **Hausmeisterservice:** alle 12 Status, nur Kategorie gefiltert
- **localStorage** für gewählte Ansicht (`nora-deals-kanban-view`)
- **Keine neuen Status-IDs**, keine S4-Spalten, keine Produktionscheckliste

### Begründung

Schlanke Fenster-Pipeline ohne Datenmodelländerung. Bestehende Logik „leere Spalten ausblenden“ / „Alle Status anzeigen“ bleibt erhalten und kombinierbar.

## 2026-06-28 – Welle 7b: Checklisten-, Textbaustein- und Audit-Datenmodell spezifiziert

### Kontext

Nach Hotboard und Fenster-Kanban-Filter soll das nächste fachliche Fundament gelegt werden: modulare Checklisten (FENS/HAUS/IMMO), Textbausteine und zentrale Audit-Logs — ohne voreilige Migration.

### Entscheidung

- **Spezifikation** in `10-checklists-snippets-audit.md`
- **Hauptmodell relational:** `checklist_templates`, `checklist_template_items`, `checklist_runs`, `checklist_run_items`, `saved_text_snippets`, `audit_events`
- **JSONB-only am Vorgang abgelehnt** als führende Checklistenquelle
- **Hybrid:** JSONB nur in `audit_events` (old/new/metadata) und optional Run-Metadaten
- **Servicebereiche:** `FENS`, `HAUS`, `IMMO` über `service_area_code` — **nicht** `company_id`
- **`label_snapshot` Pflicht** an Run-Items für historische Korrektheit
- **Audit append-only** — CRM-Nachvollziehbarkeit, kein GoBD-Ersatz
- **S4a/S4b/S4c** bleiben Checklistenpunkte in Vorlage `FENS_PRODUCTION_RELEASE`
- **Nächste Implementierung:** v0.3d2 Migration, dann RLS/UI

### Begründung

Relationale Struktur ermöglicht Wiederverwendung, RLS, Hotboard-Auswertung und jahrelange Nachvollziehbarkeit. Verhindert parallele JSONB-Experimente und Audit-Dumps in Notizen.

## 2026-06-28 – v0.3d2: Datenbankmigration Checklisten, Textbausteine, Audit

### Kontext

Spezifikation aus Welle 7b (`10-checklists-snippets-audit.md`) soll persistent werden — ohne UI.

### Entscheidung

- **Migration** `20260628150000_checklists_snippets_audit.sql`
- **6 Tabellen:** `checklist_templates`, `checklist_template_items`, `checklist_runs`, `checklist_run_items`, `saved_text_snippets`, `audit_events`
- **FKs** an bestehende `bigint`-PKs (`deals`, `companies`, `contacts`); Checklisten-PKs `uuid`
- **Constraints:** `service_area_code` ∈ FENS/HAUS/IMMO; Run-Status `open`/`completed`/`cancelled`; Snippet-`kind`; `usage_count >= 0`; partial unique index max. 1 offener Run pro `deal_id + template_id`
- **Audit:** `insert_audit_event` SECURITY DEFINER; Trigger auf Deals/Runs/Items/Snippets; `prevent_audit_mutation` auf UPDATE/DELETE
- **RLS:** Templates Admin-write; Runs/Items/Snippets authenticated CRUD ohne DELETE; Audit SELECT-only
- **Seed:** `FENS_PRODUCTION_RELEASE` mit 9 Punkten (Vorkasse optional)
- **TypeScript:** `types/checklists.ts`
- **Keine UI** in dieser Welle

### Verifikation

- `npx supabase db reset --local` ✅
- `supabase/tests/checklists_audit_verification.sql` ✅
- `npm run typecheck` / `npm run build` ✅

### Nächste Welle

**v0.3d4** — UI im Vorgangsdetail (freigegeben).

## 2026-06-28 – v0.3d3: Checklisten-Run-Start absichern

### Kontext

v0.3d2 legte Tabellen an, kopierte Run-Items aber nicht automatisch — UI-Risiko für inkonsistente Zustände.

### Entscheidung

- **RPC** `start_checklist_run_from_template(text, bigint, bigint)` — SECURITY DEFINER, nur `authenticated`
- Atomar: Run + alle aktiven Template-Items mit `label_snapshot`
- **Idempotent** bei offenem Run; advisory lock + unique_violation-Fallback
- **Audit** weiterhin nur via INSERT-Trigger (kein doppeltes Event bei Idempotenz)
- TypeScript-Konstanten für v0.3d4 UI
- SQL-Tests in `checklists_audit_verification.sql`

### Verifikation

- `npx supabase db reset --local` ✅
- SQL-Verifikation inkl. RPC-Tests ✅
- `npm run typecheck` / `npm run build` ✅

### Nächste Welle

**v0.3d5** — Hotboard-Kachel „Produktionsfreigaben offen“.

## 2026-06-28 – v0.3d4: Checklisten-UI im Vorgangsdetail

### Kontext

v0.3d3 lieferte atomaren Run-Start per RPC; Nutzer brauchen digitale Produktionsfreigabe im Fenstervorgang.

### Entscheidung

- **UI** `DealProductionChecklistSection` in `DealShow` — nur Fensterservice oder bestehende Runs
- **Start** ausschließlich via `dataProvider.startChecklistRunFromTemplate` (RPC) — keine Client-Kopie von Template-Items
- **Updates** auf `checklist_run_items` per Standard-DataProvider; Audit via DB-Trigger
- **Demo** (`VITE_IS_DEMO`): Abschnitt mit deaktiviertem Hinweis, kein RPC
- **Nicht** in dieser Welle: Snippet-Plus/Minus, Rollenlogik, automatischer Statuswechsel, Hotboard-Kachel

### Verifikation

- `npm run typecheck` / `npm run build` ✅
- Unit-Tests `checklistUtils.test.ts` ✅
- Keine DB-Migration in v0.3d4

### Nächste Welle

**v0.3d6** — Audit-Ansicht in Kunden-/Vorgangsdetail (lesend).

## 2026-06-28 – v0.3d5: Hotboard „Produktionsfreigaben offen“

### Kontext

Büro/Leitung braucht operative Sicht auf Fenster-Vorgänge mit offener Produktionscheckliste vor Herstellerfreigabe.

### Entscheidung

- **Kachel** `HotboardOpenProductionReleases` im bestehenden Hotboard-Grid
- **Daten:** `checklist_templates` + `checklist_runs` + `checklist_run_items` + `deals` + `companies` — keine neue DB-Struktur
- **Filter:** `FENS_PRODUCTION_RELEASE`, Run `open`, fehlende Pflichtpunkte (optional-only nach hinten)
- **Sortierung:** ältestes `started_at` zuerst (Tie-Break: `expected_closing_date`)
- **Demo:** Bereich ausgeblendet
- **Nicht:** Rollenlogik, Auto-Status, E-Mail, Migration

### Verifikation

- `productionReleaseHotboardUtils.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

### Nächste Welle

**v0.3d6** — Audit-Ansicht lesend im Kunden-/Vorgangsdetail.
