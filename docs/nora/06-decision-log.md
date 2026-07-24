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

## 2026-06-28 – v0.3e: Schnellerfassung / Eingangszentrale

### Kontext

Chefs sollen Anfragen aus Telefon, WhatsApp, E-Mail und Google-Notizen schnell als Kunde/Ansprechpartner/Vorgang erfassen — ohne externe Integrationen in dieser Welle.

### Entscheidung

- **3-Schritt-Dialog** `QuickCaptureDialog` mit Einstieg in Header, Hotboard und Mobile-Plus-Menü
- **Suche zuerst** via `performGlobalSearch`; Dubletten-Warnung heuristisch
- **Quelle** in `deals.description` (`Quelle: …`) — kein DB-Feld `source_channel` (später)
- **Speichern** sequentiell: Kunde → Kontakt → Vorgang → optional Aufgabe; Redirect zum Vorgang
- **Demo/FakeRest** über Standard-CRUD — keine Einschränkung
- **Nicht:** Google/Gmail/WhatsApp-API, Migration, atomare RPC

### Verifikation

- `quickCaptureUtils.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

### Später empfohlen

- DB-Feld `deals.source_channel` oder `inquiry_sources`
- Atomare RPC `create_inquiry_from_quick_capture` für Transaktionssicherheit
- Stärkere Dublettenprüfung (Fuzzy-Match, Adresse)

## 2026-06-28 – v0.3f: Intelligente Dubletten-Vorschläge

### Kontext

Die Schnellerfassung (v0.3e) zeigte nur eine generische Amber-Warnung. Chefs brauchen konkrete Kandidaten mit Begründung, um Dubletten aus Telefon/WhatsApp/E-Mail zu vermeiden.

### Entscheidung

- **Vorschlagsfeld** statt reiner Warnung — Titel „Du meinst vielleicht diesen Kunden“
- **Deterministisches Scoring** in `duplicateCandidateUtils.ts` — keine KI, kein Auto-Merge
- **Kriterien:** Kundennummer, Telefon, E-Mail (stark); ähnlicher Name (mittel); Name + Stadt/PLZ (stärker)
- **Effiziente Suche:** Debounce 400 ms, Cache, stale-Request-Ignore, max. 5 Kandidaten; `performGlobalSearch` wiederverwendet
- **Verhalten:** „Diesen Kunden verwenden“ → Schritt Ansprechpartner; „Trotzdem neuen Kunden anlegen“ → bewusstes Neuanlegen, Vorschläge ausblenden
- **Lexware-Vorbereitung:** `DuplicateSearchInput` + `rankDuplicateCandidates` für späteren CSV-Import wiederverwendbar
- **Nicht:** Migration, neue Tabellen, Auto-Merge, Lexware-Import in dieser Welle

### Verifikation

- `duplicateCandidateUtils.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3f: Realistische Demo- und UX-Testdaten

### Kontext

Die bisherigen FakeRest-Daten (Saarland, 8 Kunden) reichten nicht für realistische UI-Tests von Hotboard, Schnellerfassung, globaler Suche, Kanban und Dubletten-Vorschlägen.

### Entscheidung

- **Region** Düsseldorf / Neuss / Umgebung — vollständig fiktiv (`@nora-demo.local`, `+49 211/2131 000 …`)
- **Quelle der Wahrheit:** `noraDuesseldorfSeedData.ts` → `noraDemoSeed.ts` (FakeRest)
- **Umfang:** 25 Kunden, 30 Kontakte, 20 Vorgänge, 20 Aufgaben, 10+ Notizen
- **UI-Testfälle:** Mehrfach-Kontakte, Kunde ohne Kontakt, Kontakt ohne E-Mail, Vorgang ohne Wert, überfälliges Nachfassen, Dubletten-Paare (Becker/Schneider)
- **Checklisten-Runs:** nicht in FakeRest — `dev:demo` deaktiviert Checklisten-UI; Vorlage `FENS_PRODUCTION_RELEASE` bleibt in Supabase-Migration für `make start`
- **Nicht:** Production-DB, Migrationen, neue Fachlogik, dist-Dateien

### Verifikation

- `noraDemoSeed.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅

## 2026-07-14 – UX-Polish: Kontakte-Suche und globale Suche

### Kontext

Auf `/kontakte` erschien neben der globalen Navigationssuche eine zweite allgemeine Suchleiste. In Chrome trat beim Tippen in der globalen Suche teils ein Wallet-/Kundenkarten-Popup auf.

### Entscheidung

- **Kontakte-Liste:** `SearchInput` in `ContactListFilter` entfernt — spezifische Filter (Zuletzt gesehen, Status, Markierungen, Aufgaben, Betreuer) bleiben
- **Globale Suche:** Suchfeld technisch als Suche markiert (`type="search"`, `autoComplete="off"`, `spellCheck={false}`, IDs `nora-global-search` / `nora-global-search-mobile`)
- **ResponsiveFilters:** `searchInput` optional — Mobile zeigt nur Filter-Sheet wenn keine Listen-Suche
- **Nicht:** Suchlogik, Navigation, Migrationen

### Verifikation

- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3g: Schnellerfassung UX-Überarbeitung

### Kontext

Der lineare 3-Schritt-Wizard blockierte während Telefonaten. Doppelte Kundenvorschläge (Suchliste + Dubletten-Box) verwirrten. Entwürfe gingen beim Schließen verloren.

### Entscheidung

- **Frei anklickbare Tabs** — Kunde / Ansprechpartner / Vorgang jederzeit wechselbar; Validierung nur beim Speichern
- **Lokaler Entwurf** — `localStorage` Key `nora-quick-capture-draft`; wiederherstellen beim Öffnen; löschen nach Speichern oder „Entwurf verwerfen“
- **Ein Bereich „Mögliche Kunden“** — `PossibleCustomersPanel` + `mergeCustomerSearchResults` (keine doppelte Anzeige)
- **Layout** — breiterer Dialog, 2-Spalten Desktop, `BusinessNumber` als Badge
- **Performance** — nur `useDuplicateCandidateSearch` (400 ms Debounce, Cache, stale-guard)
- **Nicht:** Migration, serverseitige Entwürfe, Auto-Merge, Lexware

### Verifikation

- `quickCaptureDraft.test.ts`, `mergeCustomerSearchResults.test.ts`, `quickCaptureValidation.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3h: Kundenliste und Vorgänge-Kanban responsiver

### Kontext

Auf `/kunden` duplizierte eine Listen-Suche die globale Nora-Suche. Das Kanban war durch `max-w-screen-xl` und `max-w-[20rem]` auf Spalten eng begrenzt. „Nachfassen“ war für Nutzer nicht intuitiv.

### Entscheidung

- **Keine Listen-Suche auf `/kunden`** — nur kundenspezifische Filter (Kundentyp, Betreuer) via `ResponsiveFilters`
- **Kanban volle Breite** — `Layout` ohne `max-w-screen-xl` auf `/vorgaenge`; Grid-Spalten `minmax(280px, 320px)`
- **Scrollleiste** — `.nora-kanban-scroll` mit gestalteter horizontaler Scrollbar
- **Kartenhierarchie** — VG-Badge, Titel, Kunde, Kategorie/Wert, Kontakt-Badge
- **Terminologie** — sichtbare Texte „Kontakttermin“ / „Rückmeldung ausstehend“; IDs `nachfassen`, `expected_closing_date` unverändert
- **Nicht:** Migration, Status-IDs, globale Suchlogik, DnD-Bibliothek

### Verifikation

- `dealKanbanView.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3i: Kanban und Vorgangsakte barrierearm

### Kontext

v0.3h lieferte volle Kanban-Breite, aber Spaltenköpfe überlappten Karten, VG-Nummern waren zu klein, Dringlichkeit wirkte wie Fließtext, Scrollbars zu dünn, Vorgangsdetail unstrukturiert, englische Datumsformate sichtbar.

### Entscheidung

- **Spaltenkopf getrennt** — eigene Header-Box, Anzahl, Gap vor Karten; kein sticky Overlap
- **BusinessNumber** — zentrale Badge-Komponente mit Größen `sm`/`md`/`lg` und KD/VG-Akzent
- **NoraUrgencyBadge** — heute/überfällig/zukünftig mit Icon + Text + Warnbox im Detail
- **Scrollbars** — Kanban 16 px horizontal, Detail 14 px vertikal (`.nora-detail-scroll`)
- **Mausrad horizontal** — `useHorizontalWheelScroll` nur im Kanban-Container
- **DealShow** — breiter Dialog, `NoraSectionCard`-Abschnitte, sticky Kopf mit VG-Nummer
- **de-DE Datumsformat** — `noraDateTime.ts`, keine `Jul 14, 2026` mehr
- **Nicht:** Migration, Status-IDs, DnD-Bibliothek

### Verifikation

- `noraDateTime.test.ts`, `horizontalWheelScroll.test.ts`, `NoraUrgencyBadge.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – Demo-Auftragswerte korrigiert

### Kontext

Die Düsseldorf-Demo enthielt sechsstellige Einzelbeträge (bis 320.000 €), was Kanban-Spaltensummen, Dashboard und Geschäftswahrnehmung verfälschte.

### Entscheidung

- **Alle 20 Vorgänge** in `noraDuesseldorfSeedData.ts` auf fachlich plausible Euro-Werte angepasst (Gesamt ca. 57.000 €)
- **Fensterservice** max. 20.000 €; **Hausmeisterservice** max. 6.000 €
- **`amount = 0`** bleibt für „wartet auf Hersteller“ / noch nicht kalkuliert
- **JSON-Dokumentation** (`nora_demo_seed_duesseldorf_neuss.json`) synchronisiert
- **Tests** in `noraDemoSeed.test.ts` für Betragsgrenzen und Pipeline-Summe
- **Nicht:** echte Preise, Migration, Produktionsdaten

### Verifikation

- `noraDemoSeed.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅

## 2026-07-14 – v0.4a: Google-Kalender-Architektur und Nora-Rollenmodell spezifiziert

### Kontext

Nach Hotboard, Checklisten und Schnellerfassung soll Nora Termine aus dem bestehenden Google-Geschäftskalender lesen und mit CRM-Daten verknüpfen — ohne parallele Benutzerverwaltung oder zweites Terminsystem. Die Sekretärin (`office`) braucht klare Rechte; Google bleibt führend für Terminzeit und -existenz.

### Entscheidung

- **Spezifikation** in `11-google-calendar-rbac.md`
- **System of Record Termine:** Google Kalender (Zeit, Titel, Ort, Wiederholung, Existenz)
- **Nora speichert:** Cache (`google_calendar_events`), CRM-Verknüpfung, Audit — **kein** `appointments`-Hauptmodell
- **Ein Geschäftskalender:** `google_calendar_connections.calendar_id` — keine iCal-URL, kein Embed
- **Termin-Eigentum:** `origin = google` (zunächst read-only) \| `origin = nora` (später bearbeitbar)
- **Rollen:** `admin`, `office`, `viewer` an **`sales.role`** — keine zweite Benutzertabelle
- **RBAC-Empfehlung:** Rolle in DB (`sales.role`) + `current_nora_role()` für RLS; optional JWT-Spiegel später
- **Secrets:** Client Secret und Refresh Token nur in Edge Function Secrets/Vault — nie Frontend/Audit
- **OAuth:** zuerst `calendar.events.owned.readonly`; Write-Scope eigene Welle (v0.4e)
- **Sync:** manuell → periodisch → syncToken → Webhook (stufenweise v0.4c–g)
- **Audit:** bestehende `audit_events` mit `calendar.*`-Event-Typen
- **Nicht in v0.4a:** Migration, Edge Functions, OAuth, UI

### Begründung

Das bestehende Modell (`auth.users` ↔ `sales` 1:1, `administrator boolean`) reicht als Fundament — eine `sales.role`-Spalte vermeidet parallele Identitäten. Google als Termin-System of Record verhindert Drift zwischen Nora und Kalender. Minimale Scopes und Token-Trennung reduzieren Angriffsfläche.

### Nächste Welle

**v0.4b** — RBAC-Migration (`sales.role`, RLS, `canAccess`, Edge Function `users`)

## 2026-07-14 – v0.4b: RBAC- und RLS-Härtung

### Kontext

v0.4a spezifizierte `admin` / `office` / `viewer` an `sales.role`. v0.4b setzt das technisch um: Least-Privilege-Backfill, gehärtete Rollenfunktionen, tiered RLS, Systemfeld-Schutz und UI-Spiegel in `canAccess` — ohne Google-API, OAuth oder Kalendertabellen.

### Entscheidung

- **Kanonische Benutzertabelle:** `sales` bleibt CRM-Identität (`auth.users` 1:1)
- **Spalte:** `sales.role text not null` mit CHECK (`admin`, `office`, `viewer`)
- **Backfill (Least Privilege):** `administrator = true` → `admin`; alle anderen → `viewer`; `office` nur explizit per Admin
- **Spiegel:** `administrator = (role = 'admin')` per Trigger — widersprüchliche Zustände unmöglich
- **Rollenänderung:** nur `set_sales_role_by_admin()` (Admin-JWT oder `service_role`); direkte Updates an `role`/`disabled`/`administrator` blockiert
- **Funktionen:** `nora_auth_uid()`, `nora_is_active_user()`, `current_nora_role()`, `has_nora_role()`, `nora_can_write()`, `is_admin()` — SECURITY DEFINER, festes `search_path`, EXECUTE nur `authenticated`/`service_role`, kein `anon`
- **RLS-Matrix:** viewer SELECT; office SELECT/INSERT/UPDATE (kein DELETE); admin inkl. DELETE und Konfiguration/Vorlagen
- **`audit_events`:** SELECT nur admin/office; kein Client-INSERT/UPDATE/DELETE (RLS + append-only Trigger)
- **`disabled`:** kein Zugriff in Rollenfunktionen, RLS und Auth-Provider
- **Frontend:** `canAccess.ts`, `resolveNoraRole`, `SalesInputs` mit Rollen-Select, Edge Function `users` nutzt RPC
- **Tests:** `rbac_rls_verification.sql` + `rbac_rls_matrix.sql` (Rolle `nora_rls_test`, NOBYPASSRLS)

### Rollback / Kompatibilität

| Schritt | Aktion |
|---------|--------|
| **Rollback RLS** | Policies aus Migration rückgängig; vorherige Policies aus `20241104153231_sales_policies.sql` u. a. wiederherstellen |
| **Rollback Rolle** | `DROP COLUMN sales.role` erst nach Entfernen aller Policy-/Funktions-Referenzen |
| **`administrator`** | Bleibt lesbar als Deprecated-Spiegel; UI/Edge migrieren auf `role` vor Entfernung (Ziel v0.5) |
| **Backfill rückgängig** | Nicht automatisch — vor Rollback Snapshot der `sales`-Tabelle; `office`-Zuweisungen manuell dokumentieren |
| **Neue Nutzer** | `handle_new_user`: erster Nutzer `admin`, weitere `viewer` |

### Verifikation

- `npx supabase db reset --local` ✅
- `rbac_rls_setup` / `rbac_rls_matrix` ✅
- `checklists_audit_verification.sql` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3j: Hotboard-Arbeitsboard (Fokusboard)

### Kontext

Das Hotboard listete Vorgänge bereits nach Dringlichkeit und Status, aber ohne kompakten Spaltenüberblick wie im Kanban. Nutzer brauchen einen lesenden Schnellzugriff auf die wichtigsten offenen Vorgänge — ohne das volle Kanban zu duplizieren oder Status per Drag-and-drop zu ändern.

### Entscheidung

- **Arbeitsboard** im Hotboard: max. 2 Spalten (`neue-anfrage`, `nachfassen`), max. 5 Karten je Spalte
- **Sortierung** über bestehende `hotboardUtils` / `getFollowUpStatus` — keine zweite Statuslogik
- **Lesend:** Klick öffnet Vorgangsakte; Drag-and-drop bleibt auf `/vorgaenge`
- **Komponenten:** `HotboardFocusBoard`, `HotboardFocusColumn`, `HotboardFocusCard`
- **Keine** Migration, keine Status-ID-Änderung, keine neue DnD-Bibliothek

### Verifikation

- `hotboardFocusUtils.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅

## 2026-07-14 – v0.4b.1: RBAC-Migrations- und Function-Hardening

### Kontext

v0.4b lieferte die Rollenmatrix, aber enthielt eine Test-LOGIN-Rolle in der Produktionsmigration und exponierte interne Helper in `public`. v0.4b.1 bereitet den Production-Push vor — ohne Änderung der fachlichen Matrix.

### Entscheidung

- **Testrolle** aus `20260714120000` entfernt; lokales Setup/Teardown in `supabase/tests/rbac_rls_setup.sql` / `rbac_rls_teardown.sql` (NOLOGIN, kein Passwort in Git)
- **Schema `nora_private`:** interne Helper (`safe_auth_uid`, `is_active_user`, `current_role`, `has_role`, `can_write`, `is_admin`) — nicht in Data-API-Schemas
- **`public.nora_auth_uid` entfernt** — `auth.uid()` in öffentlichen RPCs; `nora_private.safe_auth_uid()` intern (malformed sub → NULL, kein Cast-Exception)
- **`search_path = ''`** auf allen SECURITY DEFINER-Funktionen; vollständig schemaqualifiziert
- **GUC-Härtung:** `nora.privilege_rpc_token` + `nora.allow_sales_privilege_change` nur in `set_sales_role_by_admin`; Reset nach Erfolg/Fehler
- **Grants:** `anon` REVOKE auf allen v0.4b-geschützten Tabellen; `authenticated` minimal (z. B. `sales`: SELECT+UPDATE)
- **Migration:** `20260714140000_nora_rbac_hardening.sql`
- **Keine** UI-, OAuth-, Kalender- oder Matrix-Änderung

### SECURITY DEFINER-Inventar (v0.4b.1)

| Funktion | Schema | PostgREST | Warum SECURITY DEFINER |
|----------|--------|-----------|------------------------|
| `safe_auth_uid` | nora_private | nein | JWT-sub lesen ohne Cast-Exception |
| `is_active_user` | nora_private | nein | RLS: sales-Lookup trotz Tabellen-RLS |
| `current_role` | nora_private | nein | RLS: Rolle aus sales |
| `has_role` | nora_private | nein | RLS: Rollenmatrix |
| `can_write` | nora_private | nein | RLS: office/admin |
| `is_admin` | nora_private | nein | RLS: admin-Checks |
| `set_sales_role_by_admin` | public | ja | Edge Function Rollen-RPC |
| `start_checklist_run_from_template` | public | ja | Checklisten-Start |
| `handle_new_user` | public | nein | Auth-Trigger: sales anlegen |

### Verifikation

- `npx supabase db reset --local` ✅
- `rbac_rls_production_check.sql` (ohne Testrolle) ✅
- `rbac_rls_setup` → `rbac_rls_matrix` → `rbac_rls_teardown` → production_check ✅
- `checklists_audit_verification.sql` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.4b.2: RBAC-Abschluss (Capability, Parallel-Admin, sales_directory)

### Kontext

v0.4b.1 nutzte GUC-Token für Privilegienänderungen — client-setzbare Textwerte sind keine saubere Capability-Grenze. Zusätzlich: Race beim ersten Admin, unnötige `sales`-Vollexposition für Teamlisten.

### Entscheidung

- **GUC-Modell entfernt** (`nora.allow_sales_privilege_change`, `nora.privilege_rpc_token`)
- **Rolle `nora_role_manager`:** NOLOGIN, NOBYPASSRLS, kein Mitglied für `authenticated`/`anon`/`service_role`
- **`nora_private.apply_sales_role_change`:** Owner `nora_role_manager`; EXECUTE nur `postgres`
- **`set_sales_role_by_admin`:** JWT-Check (`nora_private.is_admin()` / `service_role`), delegiert an apply-Funktion
- **Trigger `prevent_sales_privilege_escalation`:** erlaubt Privileg-UPDATE nur wenn `current_user = nora_role_manager`
- **Erster Admin:** `nora_private.resolve_first_signup_role()` mit `pg_advisory_xact_lock(89142421, 1)`
- **View `public.sales_directory`:** `id`, `first_name`, `last_name`, `avatar`; RLS nur aktive Nutzer; `security_invoker = false` + View-RLS
- **`public.sales` SELECT:** eigene Zeile oder Admin — nicht mehr alle Zeilen für office/viewer
- **Frontend:** Betreuer-Selects / `useGetSalesName` → `sales_directory`; Admin-Verwaltung bleibt auf `sales` + Edge Function
- **Migration:** `20260714150000_nora_rbac_final_hardening.sql` — keine Rückänderung an Remote-Migrationen
- **Keine** Matrix-Änderung (admin/office/viewer), kein Google/Kalender

### Verifikation

- `npx supabase db reset --local`
- `rbac_rls_production_check` → `first_admin_parallel` → `setup` → `matrix` → `final_hardening` → `checklists_audit` → `teardown` → production_check
- `rbac_rls_first_admin_parallel_runner.ps1` (zwei Sessions)
- `npm run typecheck` / `npm run build` / `npm run dev:demo`

## 2026-07-14 – Demo-Seed: `amountCents` → `amountEur`

### Kontext

Nach der Auftragswert-Korrektur war klar: `amountCents` speicherte Euro und wurde 1:1 auf `deals.amount` gemappt. Der Name birgt Faktor-100-Fehler-Risiko.

### Entscheidung

- **Umbenennung** in `DealSeed`: `amountCents` → `amountEur`
- **Mapping** in `noraDemoSeed.ts`: `amount: seed.amountEur` (keine Umrechnung)
- **Kategorieverteilung** dokumentiert: 13 Fensterservice, 4 Hausmeisterdienst, 2 Reparatur, 1 Wartung (20 gesamt)
- **Gesamtsumme** unverändert: 60.020 €
- **Nicht:** `deals.amount` in DB/Supabase, Migrationen

### Verifikation

- Keine verbleibende `amountCents`-Verwendung im Projekt ✅
- `noraDemoSeed.test.ts` (Mapping, Kategorien, Summe) ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3k: Rollenbewusste UX, Ladezustände und Fehlertoleranz

### Kontext

RBAC/RLS (v0.4b.x) war backend-seitig umgesetzt, die UI zeigte aber weiterhin Schreib- und Löschaktionen für alle Rollen. Lade-, Leer- und Fehlerzustände waren uneinheitlich.

### Entscheidung

- **UI spiegelt `canAccess.ts`**, ersetzt aber **niemals** RLS (DB bleibt autoritativ).
- **Viewer:** Lesemodus-Banner im Layout; keine Create/Edit/Delete; Edit-Routen leiten auf Show um.
- **Office:** Schreiben und Archivieren; kein physisches Löschen; keine Benutzer-/Konfigurationsverwaltung.
- **Admin:** unveränderte Verwaltungsaktionen.
- **Zentrale Fehlernormalisierung** (`normalizeCrmError`, `withCrmErrorHandler`) für PostgREST/Netzwerk — keine technischen DB-Texte in der UI.
- **Einheitliche Zustände:** `NoraPageLoading`, `NoraEmptyState`, `NoraQueryError` (Retry nur manuell).
- **Dirty-Form-Schutz:** `NoraCancelButton` in `FormToolbar`.
- **Demo-Rollentest:** drei feste FakeRest-Benutzer + `DemoRoleSwitcher` nur bei `VITE_IS_DEMO=true`.
- **Keine** Migration, **keine** RLS-Änderung, **keine** neuen Rollen.

### Verifikation

- `noraRbacUx.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅
- Manuelle Rollenprüfung admin/office/viewer im Demo noch ausstehend.

## 2026-07-14 – v0.3k.1: Rollen-UX-Abnahme und Dialog-Polish

### Kontext

v0.3k lieferte die Grundinfrastruktur; Edit-Guards, Dirty-Dialoge, Fehler-Retry und manuelle Demo-Abnahme waren noch unvollständig.

### Entscheidung

- **EditGuards vervollständigt** auf Company/Contact/Deal/Task Edit, Create, SalesEdit (admin-only), Settings, Import.
- **Dirty-Schutz:** `NoraDialogContent`, `useNoraDirtyDialog`, erweiterte Dialog/Sheet-Primitives — X/Escape bestätigen bei Dirty; Außenklick blockiert.
- **Quick Capture:** Abbrechen/X/Escape persistiert Draft (`persistDraft`); nur „Entwurf verwerfen“ löscht.
- **Fokus:** `useDialogFocusReturn` für Dialoge (DealShow, QuickCapture, NoraDialogContent).
- **Fehler-Retry:** GlobalSearch, SalesList, Company/Contact/Deal Show (`NoraShowBoundary`), Checklisten-Ladevorgang.
- **Import (bestehend, dokumentiert):**
  - Importiert per JSON-Stream: `sales`, `companies`, `contacts`, `notes`, `tasks`.
  - **Nicht reversibel** — kein Rollback; Fehlerbericht-Download bei Teilausfällen.
  - **Kein** Preview/Mapping/Dubletten-Assistent — daher **nur Admin** (`configuration` edit) bis sicherer Import-Assistent existiert.
- **Keine** Migration, RLS, Google/OAuth, neue Rollenmatrix.

### Verifikation

- `noraV03k1Ux.test.ts` + `noraRbacUx.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅
- Manuelle Browser-Matrix: mit `DemoRoleSwitcher` / separaten Logins empfohlen (siehe Ergebnisbericht).

## 2026-07-14 – v0.3k.2: Demo-Rollensimulation und abschließende Rollen-UX-Abnahme

### Kontext

`DemoRoleSwitcher` wechselte die Rolle visuell, aber `authProvider.ts` setzte bei jedem Modul-Import `DEFAULT_USER` (Anna Admin) in `localStorage` und überschrieb damit den Rollenwechsel nach Reload. Zusätzlich konkurrierten React-Query-Persist-Cache und `logout→login`-Race mit der aktiven Identität.

### Entscheidung

- **Kanonische Demo-Quelle:** `providers/fakerest/demoSession.ts`
  - Speicher: `localStorage["user"]` (`NORA_DEMO_USER_STORAGE_KEY`)
  - Statische Demo-Benutzer (`DEMO_SALES_BY_ROLE`) — keine async-Race beim Wechsel
  - `authProvider.getIdentity` / `canAccess` / `checkAuth` lesen ausschließlich daraus
  - **Kein** Überschreiben bei Modul-Import; `ensureDemoSession()` nur wenn leer
- **Rollenwechsel:** `useSwitchDemoRole` + `finalizeDemoSessionSwitch` — setzt Session, leert `REACT_QUERY_OFFLINE_CACHE`, `queryClient.clear()`, kontrollierter `location.assign`
- **Demo-Login:** `LoginPage` nutzt `useFinalizeDemoLogin` — gleiche Cache-Invalidierung wie Role-Switcher (verhindert Identity-Desync bei Login ohne vorheriges Logout)
- **Post-Switch-Navigation:** `resolveDemoPostSwitchUrl` für `/settings`, `/import`, `/sales`, Viewer-Edit-URLs
- **Hinweis im UI:** „Demo-Rolle – simuliert nur die Oberfläche“
- **Direkte Logins** (`admin@` / `office@` / `viewer@nora.demo`) bleiben Referenz für Abnahme
- **Keine** Production-Auth-Änderung, **keine** RLS-Umgehung

### Verifikation

- `demoRoleSimulation.test.ts` ✅
- `docs/nora/12-role-ux-acceptance.md` (Abnahmeprotokoll)
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅

## 2026-07-15 – v0.3l: Vollständiger CRM-Audit-Verlauf

### Kontext

Checklisten-Audit (`audit_events`, v0.3d2) deckte nur Checklisten, Snippets und `deal.stage_changed` ab. Office hatte globales SELECT auf `audit_events`. Vorgänge, Kunden, Aufgaben und Notizen brauchten serverseitige Trigger und kontextbezogene UI.

### Entscheidung

- **Eine Tabelle:** `audit_events` erweitert um Actor-Snapshots, `source`, `retention_class`, `task_id`, `note_id`
- **Schreib-Capability:** `nora_audit_writer` (NOLOGIN, INSERT-only) via `nora_private.write_audit_event`
- **Trigger** für companies, contacts, deals (ersetzt stage-only), tasks, contact_notes, deal_notes, sales (role/disabled)
- **Kompakte Änderungen** in `metadata.changes`; Notizen ohne Volltext
- **Lesen:** Admin global (`/audit` + `get_global_audit_events`); Office nur `get_entity_audit_events`; Viewer kein Zugriff
- **RLS:** direktes SELECT nur admin (Office-Policy entfernt)
- **Demo:** synthetische Events mit `source=demo`
- Spezifikation: `docs/nora/13-crm-audit-retention.md`

### Verifikation

- Migration `20260715120000_nora_crm_audit.sql`
- `crm_audit_verification.sql`, aktualisierte `rbac_rls_matrix.sql`
- `auditUx.test.ts` ✅
- `npm run typecheck` / `npm run build`

## 2026-07-15 – v0.3l.1: CRM-Audit-Abschluss (Schema-Sync, Tests, Abnahme)

### Kontext

v0.3l lieferte Migration, Trigger, RPCs und UI-Grundgerüst. v0.3l.1 schließt Schema-Synchronisation, SQL-Verifikation, Frontend-Formatierung und die Rollen-Matrix für den produktionsnahen Demo-Betrieb ab.

### Entscheidung

- **Schema-Sync:** Migrations- und Schema-Dateien (`01_tables`, `04_triggers`, `05_policies`) konsistent mit v0.3l-Audit-Erweiterung
- **Kanonischer Status-Event:** neue Trigger schreiben `deal.status_changed`; Legacy `deal.stage_changed` (v0.3d2) bleibt lesbar — UI mappt beide auf „Vorgangsstatus geändert“
- **Checklisten-Audit unverändert:** keine doppelten Events; CRM-Trigger ergänzen, ersetzen Checklisten-Trigger nicht
- **Tests:** `crm_audit_verification.sql` neu; `rbac_rls_matrix.sql` und `checklists_audit_verification.sql` angepasst; `auditUx.test.ts` für Formatter/Legacy-Label
- **Zurückgestellt:** Befüllung `event_hash`, `request_id`; externer WORM-Export; automatischer Purge
- **Immutability-Grenze:** append-only für App-Rollen — kein Anspruch auf Superuser-/Offline-Schutz ohne externen Export
- **Manuelle Abnahme:** Demo-Rollenmatrix admin (global + Akte), office (nur Akte), viewer (kein Audit)

### Verifikation

- `npx supabase db reset --local` ✅
- `crm_audit_verification.sql` + `rbac_rls_matrix.sql` + `checklists_audit_verification.sql` ✅
- `auditUx.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅
- Manuelle Rollenprüfung in Demo empfohlen (siehe `07-agent-change-checklist.md`, v0.3l-Abschnitt)

## 2026-07-16 – v0.4c.1: Google-Kalender Read-only Grundlage

### Kontext

Spezifikation in `11-google-calendar-rbac.md`. Ziel: technische Grundlage für read-only Google-Kalender-Integration ohne OAuth-Produktivbetrieb.

### Entscheidung

- **System of Record:** Google Kalender; Nora = Cache (`google_calendar_events`) + CRM-Verknüpfung + Audit
- **Singleton:** max. eine `connected`-Verbindung (Partial Unique Index + Trigger)
- **Allowlist:** `configuration.config.google_calendar.allowed_calendar_ids` + Edge-Env `GOOGLE_CALENDAR_ALLOWED_ID`
- **Keine Tokens** in `connections`, `events`, `audit_events`; vorbereitete Ablage `nora_private.google_calendar_oauth_secrets`
- **Capability `nora_calendar_writer`:** kontrollierte Cache-Schreibzugriffe (Edge/Sync)
- **Link/Unlink-RPCs:** admin/office; GUC `nora.calendar_link_update` für kontrollierte FK-Updates ohne Google-Mutation
- **Edge Functions:** Struktur + CSRF-State; Token-Austausch/Sync bewusst **501/503** bis v0.4c.2
- **Demo:** Hinweis ohne Fake-OAuth
- **Audit:** `calendar.event_linked` / `calendar.event_unlinked`; `retention_class = integration`

### Verifikation

- Migration `20260716120000_google_calendar_readonly.sql` ✅
- `google_calendar_verification.sql` + bestehende RBAC/Audit/Checklisten-Tests ✅
- `config.test.ts` (Allowlist/Env) ✅
- `npm run typecheck` / `npm run build` ✅
- **Kein** OAuth-E2E mit echtem Testkalender in dieser Welle

## 2026-07-16 – v0.4c.2: Google OAuth, Token-Verschlüsselung, manueller Sync

### Entscheidung

- **GUC entfernt:** `nora.calendar_link_update` → Capability `nora_calendar_linker` + SECURITY DEFINER intern
- **OAuth:** openid, email, `calendar.events.owned.readonly`, `calendar.calendarlist.readonly` (nur CalendarList.get für Allowlist)
- **PKCE S256** + State-Hash, TTL 10 min, atomarer Consume
- **Token:** AES-GCM-256, Nonce pro Eintrag, Key Version; RPCs `store_/load_google_calendar_refresh_token`
- **Allowlist:** `GOOGLE_CALENDAR_ALLOWED_ID` bindend; DB-Config wird bei Connect synchronisiert, kann Edge nicht überschreiben
- **Sync:** Admin-only, 30/365 Tage, singleEvents, showDeleted, etag-basiertes Update, Audit-Summen
- **Datenminimierung:** description bevorzugt leer, max 500, kein HTML
- **Admin-UI:** `/google-kalender`
- **E2E:** dokumentiert, nicht automatisiert — Erfolg erst nach manuellem Testkalender-Lauf

### Verifikation

- Migration `20260717120000_google_calendar_oauth_sync.sql` ✅
- SQL- + Function-Tests ✅
- `npm run typecheck` / `npm run build` ✅
- **OAuth-E2E ausstehend** (Betreiber + isolierter Testkalender)

## 2026-07-17 – v0.4c.2c: Release-Gates und Deployment-Bereinigung

### Kontext

Der bisherige GitHub-Workflow `deploy.yml` stammte aus dem Atomic-CRM-Setup. Er
veröffentlichte Dokumentation, Demo und Supabase-Frontend über GitHub Pages und
konnte bei einem Push auf `main` zusätzlich Remote-Migrationen und Edge
Functions ausrollen. Nora nutzt für das Frontend die Vercel-Git-Integration;
die alten Ziel-Repositories und zugehörigen Secrets sind nicht Teil des
freigegebenen Nora-Produktionsablaufs.

### Entscheidung

- Der Legacy-Workflow `.github/workflows/deploy.yml` wird vollständig entfernt.
- Es wird kein Ersatz-Workflow für automatische Supabase-Migrationen, Edge
  Functions oder GitHub Pages angelegt.
- Vercel-Deployment und ein späterer Supabase-Production-Bootstrap bleiben
  getrennte, ausdrücklich freizugebende Betriebsaufgaben.
- ESLint und Prettier laufen als direkte, getrennte Jobs über die kanonischen
  npm-Skripte. Die von `wearerequired/lint-action` erzeugten widersprüchlichen
  Wrapper- und Child-Checks entfallen.
- Fehlgeschlagene E2E-Läufe laden Playwright-Kontext, Traces und HTML-Bericht
  als kurzlebiges GitHub-Artefakt hoch.

### Begründung

Damit lösen normale Nora-Codeänderungen keine unbekannten GitHub-Pages- oder
Supabase-Remote-Deployments mehr aus. Direkte npm-Skripte machen lokale und
GitHub-Prüfungen identisch und verhindern, dass ein erfolgreicher Wrapper-Job
gleichzeitig fehlgeschlagene ESLint-/Prettier-Child-Checks erzeugt.

## 2026-07-17 – v0.4c.2c: E2E-Bootstrap und Profilzugriff

### Kontext

Der E2E-Reset löschte den kanonischen `configuration`-Singleton. Gleichzeitig
wertete `nora_private.safe_auth_uid()` nur das Legacy-GUC
`request.jwt.claim.sub` aus, während aktuelle PostgREST-Anfragen den Betreff im
JSON-GUC `request.jwt.claims` bereitstellen. Dadurch verwarf die bestehende
Active-User-Prüfung selbst korrekt angelegte Auth-Benutzer.

### Entscheidung

- `configuration.id = 1` mit `config = {}` bleibt ein notwendiger
  Systemdatensatz und wird nach jedem E2E-Reset kanonisch wiederhergestellt und
  verifiziert.
- Der Auth-Provider liest das eigene vollständige Profil weiterhin aus
  `public.sales`. `sales_directory` bleibt das reduzierte Verzeichnis für
  Team-Auswahlen und enthält bewusst weder `user_id` noch Rollen- oder
  Aktivierungsdaten.
- `safe_auth_uid()` unterstützt das Legacy-GUC und das aktuelle
  `request.jwt.claims`-JSON. Ungültige oder fehlende Werte ergeben weiterhin
  `NULL`.
- Die Policy-Matrix bleibt unverändert: aktive Benutzer sehen in `sales` nur
  die eigene Zeile; Administratoren sehen alle Zeilen; anonyme und deaktivierte
  Benutzer sehen keine. Es wird keine Test-Policy und kein allgemeines
  `SELECT`-Recht ergänzt.
- Ein E2E-Preflight prüft Auth-Benutzer, Service-Role-Bootstrap, normale
  Passwort-Session und den authentifizierten Self-Select vor dem Browserlauf.
  Diagnosen nennen Schritt und Ressource, redigieren aber Schlüssel,
  Passwörter, JWTs und Authorization-Werte.

## 2026-07-17 – v0.4c.2c: E2E-Auth-Assertions und First-Run-Dashboard

### Kontext

Nach erfolgreichem Login rendert Nora ohne Kontakte den Onboarding-Stepper
(`DashboardStepper` Schritt 1), nicht das Hotboard. Der Login-Helper prüfte
fälschlich Hotboard und ließ First-Run- sowie Bulk-Tag-Tests scheitern.

### Entscheidung

- `loginAsAdmin` bestätigt nur Auth und die authentifizierte App-Shell
  (`data-testid="authenticated-app-shell"`), nicht Dashboard-Inhalte.
- First-Run und Hotboard sind getrennte E2E-Specs.
- Atomic-CRM-Telemetrie ist für Nora dauerhaft deaktiviert
  (`<CRM disableTelemetry />`).
- Der E2E-Build deaktiviert den PWA-Service-Worker; Produktion bleibt
  unverändert.

## 2026-07-24 – Identity-Cache nach Profilnamensänderung

### Kontext

Nach erfolgreichem Speichern von Vor-/Nachname in `public.sales` zeigte das
Benutzermenü weiterhin „Pending Pending“, weil `getIdentity()` den Local-
Storage-Cache `RaStore.auth.current_sale` bevorzugte und `refetchIdentity()`
diesen nicht invalidierte.

### Entscheidung

- Cache-API im Auth-Provider: `clearCurrentSaleCache`, `setCurrentSaleCache`,
  `syncCurrentSaleCacheIfSelf`.
- Nach Namens-/Avatar-/Rollenänderungen am eigenen Profil: zuerst Cache aus
  DB-Rückgabe setzen, danach `refetchIdentity()`.
- Kein Löschen von Session-Tokens oder anderen RaStore-Keys.
- Admin-Edits fremder Benutzer aktualisieren den Identity-Cache nicht.

## 2026-07-23 – Mitarbeiterzugang: öffentliches Redesign und Einladung

### Kontext

Die öffentliche Fläche zeigte Nora als Produktmarke und bot eine öffentliche
Registrierung. Favicon-/Manifest-Einträge waren inkonsistent und teilweise
ungültig.

### Entscheidung

- Öffentliche Fläche: Ergart + „Mitarbeiterzugang“ + dezentes Smairys;
  Nora-Branding erst nach Anmeldung.
- Keine öffentliche Registrierung; `/sign-up` ist Einladungs-Hinweisseite;
  `dataProvider.signUp` wirft im Supabase-Modus.
- Kanonisches Favicon-/Manifest-Paket unter `public/` + `site.webmanifest`
  (`background_color`/`theme_color` `#2c2c2c`). VitePWA setzt `manifest: false`.
- Modi: Anmelden, Einladung aktivieren, Passwort vergessen.
- Onboarding nach Einladungslink: Passwort → Profil (Name) → Abschluss;
  keine Rollenwahl durch den Benutzer.
- HashRouter-Konflikt: Auth-Tokens weiter über `auth-callback.html`.
- Admin-Einladung: Edge Function `users` nutzt `inviteUserByEmail` +
  `set_sales_role_by_admin` + Audit `user.invited`. Redirect über `SITE_URL`
  bzw. Fallback `https://nora.ergart.de/auth-callback.html`.
- Kein Service-Role im Frontend/Vercel/`VITE_*`. Remote-Deploy und
  Production-Migration nicht Teil dieses Commits.

## 2026-07-23 – Profil-Update: Pending-Default und Rollen-Seiteneffekt

### Kontext

Neue Benutzer ohne Metadaten erscheinen als „Pending Pending“. Das Speichern
des eigenen Namens im Profil schlug fehl bzw. riskierte eine unbeabsichtigte
Rollenzurücksetzung auf `viewer`.

### Entscheidung

- „Pending“ ist nur ein Bootstrap-Platzhalter (`handle_new_user` / Spalten-Default),
  wenn bei der Einladung keine Namen mitgegeben wurden.
- Profil-Namensänderungen speichern über Auth-Metadaten + RLS-Update auf
  `sales` (ohne Edge-Privilege-Pfad).
- Edge Function `users` PATCH: Rolle/Disabled nur bei expliziter Angabe ändern;
  Namen immer auf `sales` setzen. Remote-Deploy der Function separat nötig.

## 2026-07-23 – DB-Lint: Funktionsvolatilität und ungenutzte Variablen

### Kontext

`supabase db lint` meldete 74 Warnungen ohne Fehler. Betroffen waren
überdeklarierte Volatilitätsklassen und ungenutzte Locals.

### Entscheidung

- `nora_private.audit_*_changes`: IMMUTABLE → STABLE. Die Diff-Logik liest
  keine Tabellen und ist semantisch deterministisch, aber plpgsql_check
  stuft die plpgsql-Zuweisungen über Composite-Felder als STABLE ein.
  Keine Funktionsindizes, Policies oder Planner-Pfade hängen an IMMUTABLE.
- `public.get_audit_storage_stats`: STABLE → VOLATILE wegen
  `pg_relation_size` / `pg_indexes_size`. Admin-RPC, selten aufgerufen.
- `get_avatar_for_email` / `get_domain_favicon`: ungenutzte Variablen
  entfernt; Verhalten unverändert.
- Additive Migration nur; keine Remote-/Production-Migration in diesem
  Schritt. Audit-Ausgabeform bleibt identisch.
