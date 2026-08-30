# 16 – Aktueller Zustand (Einstiegspunkt für neue Agenten)

Stand: 2026-08-29 (nach Security Advisor Baseline Closure + Error Contract Wave Production Release + Idempotency Wave Production Release + Operation Status Contract v1 Production Release).

Dieses Dokument ist eine **schnelle Orientierung**, kein Ersatz für die referenzierten Dokumente. Es verlinkt, statt Inhalte zu duplizieren.

## 1. Was ist Nora?

Nora CRM ist eine angepasste Kunden- und Vorgangsverwaltung für einen deutschen Hausmeister- und Fensterservice-Betrieb (Ergart Gruppe), auf Basis von Atomic CRM. Details: `00-project-context.md`.

## 2. Kernressourcen

| Sichtbar | Technisch | Kurzbeschreibung |
|---|---|---|
| Kunde | `companies` | Firma (`customer_kind = business`) oder Privatperson (`customer_kind = individual`); `self_contact_id` = repräsentierende Person, unabhängig von deren `contacts.company_id` (Self Contact Wave) |
| Ansprechpartner | `contacts` | natürliche Person, optional `company_id`; max. 1 `is_primary = true` pro Kunde |
| Vorgang | `deals` | Anfrage/Auftrag/Angebot |
| Aufgabe | `tasks` | `contact_id` und `company_id` beide nullable, mindestens eines gesetzt (CHECK). `company_id` ist der **historisch stabile** Kundenkontext — wird bei Erstellung/Kontextänderung serverseitig aus `contact_id` abgeleitet, aber nie automatisch nachgeführt, wenn der Kontakt später den Kunden wechselt (siehe Unified Tasks Wave, Decision Log) |
| Notiz | `contact_notes` / `deal_notes` | |
| Markierung | `tags` | |

Vollständiges Domänenmodell: `01-domain-model.md`. Datenmodell-Fallen: `03-data-model-guardrails.md`.

## 3. Wie funktioniert Security?

- Rollenmodell `admin` / `office` / `viewer` an `sales.role` — siehe `11-google-calendar-rbac.md` Abschnitt C, `12-role-ux-acceptance.md`.
- RLS auf allen Kern-Tabellen; SECURITY-DEFINER-RPCs prüfen `nora_private.can_write()` / `nora_private.safe_auth_uid()` selbst (nicht nur RLS).
- `operation_id` (Header `x-nora-operation-id`) ist **ausschließlich Korrelation**, nie Auth.
- Audit: `audit_events`, append-only, automatisch über INSERT/UPDATE-Trigger auf Kern-Tabellen — siehe `13-crm-audit-retention.md`.
- Error Observatory: `operation_errors`, getrennt von Audit (fehlgeschlagene vs. erfolgreiche Operationen) — Decision Log 2026-08-10.

**Supabase Security Advisor Baseline: abgeschlossen (Stand 2026-08-28).** Der zu diesem Zeitpunkt bekannte Advisor-Backlog ist vollständig bewertet — jedes Finding ist entweder `ASSESSED/KEEP` (bewusste, geprüfte Architektur) oder `RESOLVED` (behoben und per Advisor-Re-Check bestätigt). Kein Finding wurde ungeprüft als „ok" markiert. Details, Einzelbewertungen und die Guardrail für künftige Änderungen: Abschnitt 6a unten, `06-decision-log.md`, `17-known-issues-and-planned-waves.md`. **Diese Abgeschlossenheit gilt nur für den geprüften Snapshot** — jede neue Migration, Function/RPC, Grant-Änderung oder neue Advisor-Lint-Kategorie erfordert eine eigene, neue Bewertung.

**Separat davon — bekannte, noch offene Ops-/Betriebs-Themen** (aus einer früheren Analyse vor der Customer & Contact Workflow Wave, **nicht** Teil der Security-Advisor-Bewertung und weiterhin nicht in einer Session verifiziert — vor Umsetzung gegen aktuellen Code prüfen):
- Offene Selbstregistrierung (Status unklar, `handle_new_user`/`init_state`-Logik prüfen)
- Attachment-Bucket-Konfiguration
- Nicht deployte Edge Functions
- Rollen-Cache-Verhalten im Frontend
- Audit-Retention/Löschstrategie (`13-crm-audit-retention.md` beschreibt das Modell, keine automatische Löschung ist Stand v0.3l)

## 4. Welche großen Waves sind abgeschlossen?

Chronologisch, Details im Decision Log (`06-decision-log.md`):

1. Atomic-CRM-Basis, deutsches Branding/Locale (Welle 1–4)
2. Nachfassen ohne Migration (Welle 5), Startseite/Auth-Nav (Welle 6a)
3. Kunden-/Vorgangsnummern (`customer_number`/`case_number`, Welle 6c/6c-Hardening)
4. Globale Suche (Welle 6d), Hotboard (v0.3b), Fenster-Kanban-Filter (v0.3c)
5. Checklisten/Textbausteine/Audit-Datenmodell (v0.3d2–v0.3d6)
6. Schnellerfassung + Dubletten-Vorschläge (v0.3e–v0.3g) — **sequentielle Creates, nicht die neue atomare RPC** (siehe Abschnitt 6)
7. RBAC/RLS-Härtung (v0.4b), Google-Kalender read-only (v0.4c.1)
8. CRM-Audit (v0.3l), rollenbewusste UX (v0.3k, v0.3k.1, v0.3k.2)
9. Foundation Wave 1–3: Operation Correlation, Operation Manager + Catalog, Error Observatory Core
10. Foundation Performance/Index-Härtung (PR #1, 2026-08-15/16): fehlende FK-/Hot-Path-Indizes auf `deals`/`tasks`/`contacts`/`companies`/`contact_notes`/`deal_notes`, Vite Code-Splitting + Bundle-Budget-CI-Gate — siehe Decision Log "2026-08-15 – Kernindizes und Bundle-Budget"
11. **Customer & Contact Workflow Wave** (2026-08-25) — siehe Abschnitt 5
12. **Live-UX-Fixes-Wave** (2026-08-25): Kunden-Show Tab-Routing-Bug behoben, Kunden-Autocomplete-Create-UX verbessert — siehe Abschnitt 7
13. **Unified Tasks Wave** (2026-08-25): `tasks.company_id`, historisch stabiler Kundenkontext, „Aufgaben"-Tab auf der Kundenakte — siehe Abschnitt 5a und Decision Log "2026-08-25 – Unified Tasks Wave". **PRODUCTION VERIFIED** (2026-08-28, siehe Abschnitt 6).
14. **Self Contact Wave** (2026-08-26): `companies.self_contact_id` (Person repräsentiert eine Kundenakte unabhängig von `contacts.company_id`), Kontakt→Kundenakte-Workflow, atomarer Quick-Capture-Command, Quick-Capture-Schritt-2-UX, Draft-Härtung, „Firma"-Label, Position-Fix — siehe Abschnitt 5b und Decision Log "2026-08-26 – Self Contact Wave". **PRODUCTION VERIFIED** (2026-08-28, siehe Abschnitt 6).
15. **Pre-Production Hardening Patch + Final RC Hardening** (2026-08-27/28): unabhängiger Review der Self Contact Wave fand konkrete Bugs (FakeRest-Parität, Falsy-ID-Audit, Error Contract, hardcodierter Navigationspfad, Individual Name Invariant am CREATE-Pfad); alle behoben und mit Tests abgesichert (kein neues Feature) — siehe Decision Log "2026-08-27 – Pre-Production Hardening Patch". **PRODUCTION VERIFIED** (2026-08-28, kontrollierter Release inkl. Production-Migration, DB-Verifikation, Deployment und Live-Smoke-Test).
16. **Error Contract Wave** (2026-08-28): maschinenlesbarer Nora Error Code (`DETAIL = NORA_<CODE>`) ersetzt reine Nachrichtenerkennung für fünf Business-Fälle (Contact-not-in-Context, Individual-Name-Required, Self-Contact-Delete-Blocked, Private-Customer-Already-Exists, Permission-Denied); rückwärtskompatibel, additive Migration, FakeRest-Parität für die vier fachlichen Fälle — siehe Decision Log "2026-08-28 – Error Contract Wave". **PRODUCTION VERIFIED** (2026-08-28, kontrollierter Release inkl. Production-Migration, DB-Verifikation, Deployment und Live-Smoke-Test, siehe Decision Log Nachtrag "Kontrollierter Production Release — PRODUCTION VERIFIED" im selben Eintrag).
17. **Idempotency Wave** (2026-08-29): additiver Idempotency-Contract (`nora_private.idempotency_records`, `idempotency_check`/`idempotency_persist`) für `CreateCustomerFromContact`/`CreateQuickCaptureCase`, neue optionale `p_idempotency_key uuid`-Parameter (Default `null`, rückwärtskompatibel), neue RPC `public.create_quick_capture_task` mit eigenem Idempotency-Scope; `DETAIL = NORA_IDEMPOTENCY_CONFLICT` bei Key-Wiederverwendung mit geändertem Payload — siehe Decision Log "2026-08-29 – Idempotency Wave". Code (Commit `1748053`) bereits auf `origin/main`. **PRODUCTION VERIFIED** (2026-08-28, Migration `20260829120000_nora_idempotency_core.sql` gegen `nora-crm-prod` angewendet, Migration-Bookkeeping-Drift korrigiert, DB-Verifikation, Live-Smoke-Test — kein Git-Push mehr nötig, Code war bereits gemerged).
18. **Operation Status Contract Wave v1** (2026-08-29): additives `_meta.disposition` (`executed`/`replayed`) an den drei bereits idempotenten RPCs (Migration `20260829150000_operation_status_disposition.sql`, reine `CREATE OR REPLACE`-Body-Änderung, keine Signaturänderung), `OperationRecord` um `execution`/`errorCode`/`result` erweitert, FakeRest-Parität hergestellt — siehe Decision Log "2026-08-29 – Operation Status Contract Wave (v1, CreateQuickCaptureCase Slice)". **`LOCAL RC APPROVED — NOT YET PRODUCTION VERIFIED`** (Phase 6C, 2026-08-29; Closure-Verifikation Phase 6D.1, 2026-08-29): vollständig gegen frischen `npx supabase db reset --local` verifiziert — neue SQL-Suite grün, authentifizierter End-to-End-PostgREST-Beweis (echter `authenticated`-JWT) für Legacy/executed/replayed/Conflict, empirischer Beweis dass der gespeicherte `idempotency_records`-Wert für immer `"executed"` bleibt und niemals in eine Replay-Antwort leakt, vollständige kanonische RBAC/RLS-Testsequenz zweimal grün (Phase 6C und erneut Phase 6D.1 auf dem echten Arbeitsbaum, kanonischer Migration-Hash reproduziert), Audit-Kompatibilität real bewiesen (kein doppeltes Audit-Event bei Replay, `request_id`-Korrelation intakt — siehe Decision Log Phase 6D.1 zur Namensklärung `request_id` = `operation_id`-Korrelation). **`OPERATION STATUS V1 PRODUCTION VERIFIED — PHASE 6 COMPLETE`** (2026-08-29, Phase 6E): kontrollierter DB-first Production-Release durchgeführt — Migration `20260829150000_operation_status_disposition.sql` (kanonischer SHA-256 `ec4eb5b1bb774d452a82b83d82c89deb9a43ceb74baa6899ad06f3ea94e10f5d`) gegen `nora-crm-prod` angewendet, bekannter Bookkeeping-Drift (Apply-Zeitstempel `20260829140725` statt Datei-Zeitstempel) mit expliziter Freigabe transaktional korrigiert, alle drei RPCs read-only nachverifiziert (keine Overloads, `SECURITY DEFINER`/`search_path`/Grants unverändert, Disposition-Contract im Function Body vorhanden), Business-Daten vor/nach Apply unverändert, Git nach Production-DB-Grün gepusht (`main` = `8a09725c916bc0643b9963503daf3248e12c254d`), Vercel Production READY auf exaktem SHA, `nora.ergart.de` erreichbar, Live-Smoke (Hotboard, Kunden, Kontakte, Vorgänge, Schnellerfassung, Kontakt-Detail) ohne Regression. Phase-7-Notification-/Status-UI existiert weiterhin nicht — Contract ist nur maschinenlesbar über die RPC-Response. Offener Follow-up: dauerhaft hängende `pending`-Operations besitzen keinen eigenen Timeout-Lifecycle (LOW, PLANNED).
18. **Kontakterstellung UI-Polish** (2026-08-28): mobile-first Formularhierarchie („Person“, „Kundenbezug“, „Kontaktmöglichkeiten“, eingeklappte „Weitere Angaben“), feste Nora-Primäraktion, mobile Kundenwahl als Bottom Sheet mit getrennter Neuanlage sowie verdichtete iPad-Kopfzeile. Reine UI-/i18n-Änderung, keine Persistenz- oder Routingänderung. **DEPLOYED (Commits auf `origin/main`, live auf `nora.ergart.de` bestätigt), finale UX-Abnahme (`12-role-ux-acceptance.md`) noch offen — nicht PRODUCTION VERIFIED im Sinne eines abgeschlossenen Rollen-UX-Abnahmeprotokolls.** Siehe Decision Log „2026-08-28 – Kontakterstellung UI-Polish“, Nachtrag.
19. **Notification Vertical Slice (Phase 7B.1–7B.4)** (2026-08-29): Notification Presentation Contract als Code (`notifications/notificationModel|Policy|Timing|Messages|ErrorPresentation|Store`), Karte/Center/Announcer (7B.2), `operationId`-Propagation Command → Provider → OperationManager (7B.3) und erster produktiver Vertical Slice **Quick Capture** (7B.4): `NotificationProvider` unterhalb von `OperationProvider` in `CRM.tsx`, `NoraNotificationOutlet` in `Layout.tsx`/`MobileLayout.tsx`, `useNotifiedQuickCapture` als Controller, genau **eine** Karte pro Benutzer-Intent (Core + optionaler Task), die vier Quick-Capture-`notify()`-Toasts entfernt; sonner bleibt für alle übrigen Flows aktiv. **Quick Capture ist der einzige migrierte Flow** — die weiteren Intents (`deal.update`, `customer.createWithContact`, `contact.convertToCustomer`) sind bewusst Phase 7C. Keine DB-/RPC-/RLS-/Audit-Änderung, keine Migration. **`PRODUCTION VERIFIED`** (2026-08-30, Release-Commit `9db08c4b35991b4f0d08a898d11a23a1fcba65bc` — Details am Ende dieses Eintrags). Lokaler Verifikationsstand vor dem Release (2026-08-29): `npm run typecheck`, `npm run build` und die vollständige Vitest-Suite (80 Dateien, 644 Tests, 1 übersprungen) grün, inklusive Browser-Integrationstests, die den echten `QuickCaptureDialog` absenden und Karte, Toast-Freiheit sowie Dialog-Unmount- und Redirect-Überleben nachweisen. Siehe Decision Log „2026-08-29 – Notification Presentation Contract v1 (Phase 7A)“, Nachträge 7B.3/7B.4. **UX-Abnahme abgeschlossen (7B.4a–7B.4c, 2026-08-29/30):** die visuelle Abnahme fand einen Layering-Blocker (Karte lag unter Dialog-Overlays und war im realen Quick-Capture-Flow zu 64 % verdeckt). Endstand nach drei Anläufen: Statusmeldungen liegen auf **beiden** Breakpoints über der Dialogschicht (`z-60`), wechseln bei offenem Dialog per `data-state`-gesteuertem **modal-aware Placement** aus der Footer-Zone in den Kopf-/Inhaltsbereich, zeigen dabei nur die neueste Karte und sind click-through bis auf ihr Schließen-Ziel. Gemessen im gestylten App: **kein einziges Dialog-Control blockiert** (Desktop 1424/1884 px, 150 % Zoom, Mobile 500×715), MobileNavigation frei, keine zweite Feedback-Schicht. Reine Placement-/Layering-Nacharbeit, kein Store-/Lifecycle-Eingriff. **Quick-Capture-Notification-UX lokal vollständig akzeptiert — LOCAL VERIFIED + UX ACCEPTED (Stand vor dem Production Release).** **Final Adversarial Review abgeschlossen (2026-08-30)** auf RC `d21c3de7`: keine BLOCKER, keine HIGH, keine MEDIUM. Unabhängig nachgemessen wurden u. a. die Operation-ID-Korrelation, die Composite-Semantik und — im gestylten App bei 1212 px Viewport mit `elementFromPoint` — das Hit-Testing über offenem Dialog (0 von 14 Dialog-Controls blockiert, Karten-Close 44×44 px trotz Radix' `pointer-events: none` auf `<body>` erreichbar). Gefundene LOW-Punkte waren ausschließlich Doku-/Kommentar-Drift und sind in der nachfolgenden Hygiene-Welle bereinigt. Nicht selbst nachgemessen und daher weiterhin nur durch Suite und UX-Abnahme gedeckt: Mobile-Viewport-Geometrie, Zoomstufen, echter Screenreader. **Kontrollierter Production Release (2026-08-30) — `PHASE 7B PRODUCTION VERIFIED`:** Release-Commit `9db08c4b35991b4f0d08a898d11a23a1fcba65bc` (Fast-Forward `f46ce06a..9db08c4b`, kein Force Push). **Bewusst keine DB-Wave:** der Diff gegen die Production-Basis `f46ce06a` berührt keine einzige Datei unter `supabase/` und kein `*.sql` — es wurde keine Migration angewandt, keine RPC/RLS/SECURITY-DEFINER-/Audit-Änderung vorgenommen. Vor dem Push erneut grün: `typecheck`, `build`, vollständige Vitest-Suite (80 Dateien, 644 Tests, 1 übersprungen), ESLint auf den geänderten Dateien (0 Fehler, 1 bekannte `react-refresh`-DX-Warnung), `git diff --check`. Vercel Production Deployment `dpl_B6T7F6Ugmuaq1hbtCpburrfmMr6F` **READY** auf exakt diesem SHA, Domain `nora.ergart.de` erreichbar. Live verifiziert (Desktop 1784×815 bzw. 1296×592): Hotboard, Kunden, Kontakte, Vorgänge und die Vorgangsakte-Detailansicht rendern mit echten Daten, keine weiße Seite, keine JS-Fehler, keine unbehandelten Rejections. Das ausgelieferte Bundle enthält nachweislich den 7B-Code (`nora-notification-*`-CSS-Klassen, `nora-notification-region`/`-card`-Test-IDs, `quickCapture.createCase`). **Notification-Contract live nachgemessen (nicht-schreibend):** die Region ist montiert (`role="region"`, `aria-label="Statusmeldungen"`, `aria-live="off"` — Live-Semantik liegt korrekt beim Announcer), `z-index: 60`, `pointer-events: none`; ohne Dialog liegt sie unten rechts (24 px Abstand), bei offener Vorgangsakte wechselt sie per modal-aware Placement in den Kopfbereich (`top: 23 px`) — beide dokumentierten Zustände sind in Production real bestätigt. **Keine sonner-Ablösung:** sonner ist im Production-Bundle weiterhin enthalten, nur die vier Quick-Capture-Toasts sind ersetzt. Mobile (622 px effektive Breite): mobile Regionsvariante `nora-notification-region-mobile` aktiv, MobileNavigation vorhanden, Schnellerfassung über den FAB erreichbar, kein Layout-Crash, kein horizontaler Overflow. **Offen und bewusst nicht erzwungen:** ein echter Live-**Write**-Smoke (Schnellerfassung absenden) wurde NICHT durchgeführt, weil es auf Production keinen freigegebenen Testdatensatz-Pfad gibt und dafür echte Geschäftsdaten hätten erzeugt werden müssen; der Quick-Capture-Schreibpfad ist durch die Browser-Integrationstests und die lokale UX-Abnahme gedeckt, die endgültige Live-Bestätigung braucht eine reguläre Nutzeraktion. **NOTE (nicht 7B-verursacht):** unmittelbar nach dem Deployment lieferte der PWA-Service-Worker beim ersten Aufruf noch die Assets des Vorgänger-Builds (deren URLs inzwischen 404 sind); nach einem Reload aktualisierte sich der Worker selbst. Das ist bestehendes `vite-plugin-pwa`-Verhalten bei jedem Deployment, kein Notification-Defekt. **Verifikationsgrenze von Phase 7B (Stand 2026-08-30, abschließend):** Deployment- und Notification-Infrastruktur sind live verifiziert; ein künstlicher Production-Quick-Capture-**Write** wurde bewusst **nicht** erzeugt, weil dafür echte Geschäftsdaten hätten entstehen müssen. Der erste reguläre Production-Write bleibt damit *zusätzliche* Live-Evidence, ist aber **kein Implementierungsblocker** und **kein offener Punkt in 7B** — Phase 7B bleibt `PRODUCTION VERIFIED` und wird dafür nicht wieder geöffnet.


## 5. Customer & Contact Workflow Wave — was ist tatsächlich implementiert

Vollständige Entscheidung: Decision Log "2026-08-25 – Customer & Contact Workflow Wave".

- `companies.customer_kind` (`business`/`individual`) steuert den Formularmodus in `CompanyInputs` (geteilt zwischen `/kunden/create` und `/kunden/:id/edit`).
- `contacts.is_primary` — max. 1 Hauptansprechpartner pro Kunde, durchgesetzt per Partial Unique Index `uq_contacts_one_primary_per_company`. Wechsel nur über RPC `set_primary_contact`.
- Atomare Anlage über RPC `create_customer_with_contact(p_company jsonb, p_contact jsonb, p_existing_contact_id bigint)` — SECURITY DEFINER, `can_write()`-gated, ein Transaktionskörper für Kunde + optional neuer/bestehender Ansprechpartner.
- `/kunden/create` (`CustomerCreateForm.tsx`) ist die Referenzimplementierung: eigener `onSubmit` statt `CreateBase`, ruft `dataProvider.createCustomerWithContact(...)`. Ansprechpartner-Modi: kein / neu / Unternehmer ist selbst Ansprechpartner (inkl. „Angaben übernehmen") / bestehenden zuordnen. Bei Privatperson entfällt der Modus-Wähler, Kundenname wird aus Vor-/Nachname abgeleitet.
- Links generalisiert: `companies.links_jsonb` / `contacts.links_jsonb` (`{url, type, label?}`, Typen: website/linkedin/instagram/facebook/google/portal/other) ersetzen die LinkedIn-only-Validierung. **`ContactInputs.tsx` rendert kein `linkedin_url`-Feld mehr** — nur noch `links_jsonb`.
- `companies.email_jsonb` / `companies.phone_jsonb` neu, analog zu `contacts`.
- Legacy-Spalten (`linkedin_url`, `website`, `phone_number`, `context_links`) bleiben in der DB bestehen (Bestandsdaten per Migration in die neuen `*_jsonb`-Felder kopiert), werden aber vom UI nicht mehr beschrieben — nur noch als Fallback-Anzeige gelesen (`CompanyAside.tsx`, `ContactPersonalInfo.tsx`) für Datensätze, bei denen die Kopie aus irgendeinem Grund leer geblieben ist.
- Operation Catalog erweitert um `customer.createWithContact` / `contact.setPrimary` (Operation Manager + Error Observatory, analog `deal.update`).
- Neuer SQL-Verifikationstest: `supabase/tests/customer_contact_workflow_verification.sql`.

**Nicht Teil dieser Wave:** Schnellerfassung nutzt weiterhin sequentielle Creates (siehe Abschnitt 6).

## 5a. Unified Tasks Wave — was ist tatsächlich implementiert

Vollständige Entscheidung: Decision Log "2026-08-25 – Unified Tasks Wave".

- `tasks.company_id` (nullable) zusätzlich zu jetzt ebenfalls nullable `tasks.contact_id`. CHECK-Constraint `tasks_company_or_contact_check`: mindestens eines muss gesetzt sein.
- **Historisch stabiler Kundenkontext:** `company_id` wird beim Erstellen bzw. bei bewusster Kontextänderung serverseitig aus `contacts.company_id` abgeleitet/validiert (`nora_private.enforce_task_company_context()`, BEFORE-INSERT/UPDATE-Trigger auf `tasks`) — greift **nicht** bei reinen Feld-Updates (Text/Fälligkeit/Erledigt). Wechselt der Kontakt später den Kunden, bleibt `task.company_id` unverändert.
- **Delete-Semantik:** `tasks.contact_id`-FK jetzt `ON DELETE SET NULL` (war `CASCADE`); neuer Trigger `nora_private.delete_contact_only_tasks()` (BEFORE DELETE auf `contacts`) löscht vorab nur die Aufgaben, die sonst ohne Kundenkontext verwaist wären. `tasks.company_id`-FK bleibt `ON DELETE CASCADE`.
- `merge_contacts` überspringt die neue Kontext-Validierung bei der Massenumhängung von Aufgaben (Session-Flag `nora.skip_task_context_check`, FakeRest-Äquivalent in `taskContextCheck.ts`).
- Audit (`audit_task_changes`/`audit_task_row`) erfasst `company_id` und liest den Kontext direkt aus der Aufgabe, nicht mehr live über den Kontakt.
- UI: „Aufgaben"-Tab auf `/kunden/:id/show` (Desktop) über `CompanyTasksList.tsx`; „+ Aufgabe" auf der Kundenakte schlägt den Hauptansprechpartner vor (entfernbar, nur Kontakte dieses Kunden). `Task.tsx` zeigt eine dezente Notiz, wenn der historische Kundenkontext vom heutigen Kontakt-Kunden abweicht.
- Neuer SQL-Verifikationstest: `supabase/tests/task_customer_context_verification.sql`.

**Nicht Teil dieser Wave:** `deal_id` an `tasks` (bewusst ausgeschlossen); Company-seitige `nb_tasks`-Zählung/Badge auf dem Tab-Label (nur Kontakte/Vorgänge haben Zähler, Aufgaben-Tab ist ein einfaches Label).

## 5b. Self Contact Wave — was ist tatsächlich implementiert

Vollständige Entscheidung: Decision Log „2026-08-26 – Self Contact Wave".

- `companies.self_contact_id` (nullable FK auf `contacts`, entkoppelt von `contacts.company_id`) — drückt aus, welche natürliche Person eine Kundenakte repräsentiert, unabhängig davon, wo diese Person sonst als Ansprechpartner geführt wird (Freddie-Szenario: bleibt Ansprechpartner von Firma A, wird zusätzlich selbst Kunde). Partial Unique Index nur für `customer_kind='individual'`.
- `contacts` bleibt kanonische Quelle für Personendaten bei Privatkunden — `companies.name` wird bei `customer_kind='individual'` serverseitig synchron gehalten (`nora_private.sync_individual_company_name()`), im Edit-Formular read-only mit Link zum Kontakt.
- **Effective Contact Context** — eine zentrale Regel (`nora_private.is_effective_contact_of_company()` SQL, `domain/customerContactContext.ts` TS): ein Kontakt gehört zu einer Kundenakte, wenn `company_id` passt ODER er deren `self_contact_id` ist. Genutzt von Task-Kontextvalidierung, Quick-Capture-Validierung, CompanyShow-Kontakte-Tab.
- Neue Application Commands: `application/commands/createCustomerFromContact.ts` (Kontakt → Kundenakte, UI: `ContactToCustomerDialog.tsx`, Button in `ContactAside.tsx` bei Export/Merge) und `application/commands/createQuickCaptureCase.ts` (ersetzt `submitQuickCapture.ts` — Kunde+Kontakt+Vorgang atomar über neue RPC `create_quick_capture_case`, Aufgabe bleibt separater Best-Effort-Schritt).
- Neue RPC-Kern-Refaktorierung: `nora_private.create_customer_with_contact_core()` — gemeinsame Logik für `create_customer_with_contact` (erweitert, PostgREST-rückwärtskompatibel) und `create_quick_capture_case` (neu).
- Quick Capture Schritt 2 („Ansprechpartner"): expliziter Tri-State (bestehend/neu/kein Ansprechpartner) statt einer Checkbox, die implizit eine Entität erzeugte.
- Quick-Capture-Draft: pro Benutzer gescoped, Schema-Version + Staleness, Autosave + Lifecycle-Flush; alter globaler Key wird beim Upgrade entfernt (nie migriert).
- UI-Fixes: doppelte „Position"-Anzeige auf `/kontakte/create` behoben (Root Cause: Sektionsüberschrift duplizierte das Feld-Auto-Label), „Unternehmen / Selbstständig" → „Firma".

**Nicht Teil dieser Wave:** Privatperson/Firma-Unterscheidung in Quick Capture (kennt weiterhin nur einen Firmenmodus); Customer-Archive-/Soft-Delete-Lifecycle (nur die notwendige Self-Contact-Delete-Invariante wurde abgesichert).

## 6. Was ist aktuell live?

Verifiziert am 2026-08-28 (Error Contract Wave Release, read-only Nachverifikation gegen `nora-crm-prod` und das echte Vercel-Projekt):

- **Datenbank** (`nora-crm-prod`, Supabase-Projekt `kixxroxtfzbcbzctohex`): Migrationshistorie deckt sich vollständig mit `supabase/migrations/` bis einschließlich `20260828140000_error_contract_wave.sql` (44/44 Migrationen 1:1). Enthält damit zusätzlich zu den vorherigen Waves den maschinenlesbaren Error Contract (fünf `NORA_*`-Codes über `DETAIL`) — sechs betroffene Functions (Signatur, Security-Mode, `search_path`, Grants, Codes) read-only nachverifiziert.
- **Frontend** (Vercel-Projekt `nora-crm`, Domain `nora.ergart.de`): Deployment `dpl_92Y6n2e16R8ZfT1DcUXLrw98Cynh`, Commit `dbc41a742f82bdbb0fe734df7d0be33db6a5e35e`, Status READY, Target production. Enthält alle vorherigen Waves inkl. der Error Contract Wave.
- **Produktionsdaten sind real**, nicht synthetisch: zum Prüfzeitpunkt 16 Kunden (davon 0 `individual`), 17 Kontakte, 7 Vorgänge, 10 Aufgaben, 4 Nutzer. Wachstum gegenüber dem vorherigen Snapshot (14 Kunden, 15 Kontakte) ist normale Produktionsnutzung, nicht durch die Migration verursacht (rein additives DDL, keine DML).
- Git: `origin/main` bei Commit `dbc41a742f82bdbb0fe734df7d0be33db6a5e35e`.
- **Live-Smoke-Test** (frische Session gegen `nora.ergart.de`, echte eingeloggte Sitzung): Hotboard/Kunden/Kontakte/Vorgänge laden fehlerfrei, Kunden-Show-Tab-Routing bleibt stabil (`#/kunden/:id/show/history`, Aktivität/Änderungsverlauf-Wechsel ohne Rücksprung), keine rohen `NORA_*`-Codes oder i18n-Keys sichtbar, keine Console-/Runtime-Fehler. Keine Testdaten in Production angelegt.
- **Bekannter, bereits behobener Migration-Bookkeeping-Drift (dritte Wiederholung):** `apply_migration` trug die Error-Contract-Migration zunächst mit dem Anwendungszeitstempel (`20260828131523`) statt dem Dateiname-Zeitstempel (`20260828140000`) ein — derselbe Drift-Typ wie bei der Customer & Contact Workflow Migration (2026-08-25) und der Self Contact Migration (2026-08-28). Per transaktionalem `UPDATE` auf den korrekten Zeitstempel korrigiert und read-only nachverifiziert (genau eine Zeile geändert, keine andere Migration betroffen, 44 Zeilen vor und nach der Korrektur). **Dauerhafte Regel:** nach jedem `apply_migration` gegen `nora-crm-prod` `list_migrations` gegen das lokale Zeitstempel-Präfix prüfen, bevor der Release als abgeschlossen gilt.

Diese Fakten wurden per read-only MCP-Abfragen gegen die echte Produktionsdatenbank und das echte Vercel-Projekt sowie per Live-Browser-Smoke-Test verifiziert, nicht angenommen.

**Nachtrag 2026-08-30 (Phase 7B Notification Vertical Slice):** Frontend-Stand aktualisiert auf Deployment `dpl_B6T7F6Ugmuaq1hbtCpburrfmMr6F`, Commit `9db08c4b35991b4f0d08a898d11a23a1fcba65bc`, Status READY, Target production, Domain `nora.ergart.de`. `origin/main` steht ebenfalls auf diesem Commit. **Der Datenbankstand aus Abschnitt 6 bleibt unverändert gültig** — Phase 7B war ein reiner Frontend-/Presentation-Release ohne Migration und ohne jede Änderung an `supabase/`. Live-Smoke und die nicht-schreibende Verifikation des Notification-Contracts sind in Abschnitt 4 Punkt 19 dokumentiert. Es wurden keine Testdaten in Production angelegt.

## 6a. Security Advisor Status

Die zwei vorbestehenden Supabase Security Advisor ERROR-level Findings (`SECURITY DEFINER`-Views):

- `public.init_state`
- `public.sales_directory`

wurden am 2026-08-28 in einer dedizierten, read-only Assessment-Session gegen den tatsächlichen Production-Katalog (`nora-crm-prod`) untersucht.

Ergebnis: **beide `ASSESSED / LOW / KEEP`, kein aktueller Production Security Blocker.** Die Advisor-ERROR-Klassifikation bezieht sich auf den Mechanismus (`security_invoker = false`/`off`), nicht auf einen nachgewiesenen Exploit — beide Views sind bewusste, eng begrenzte Ausnahmen mit minimaler, geprüfter Datenprojektion. Vollständige Begründung: `17-known-issues-and-planned-waves.md` „Security Advisor Findings — assessed 2026-08-28"; Architekturentscheidung: `06-decision-log.md` „2026-08-28 – Intentional privileged read views (`init_state` / `sales_directory`)".

**Vollständig abgearbeitet (Folge-Session, 2026-08-28 – Residual Security Advisor Closure):** die restlichen Advisor-Hinweise sind jetzt bewertet — `number_counters` (RLS-ohne-Policy) `INFORMATIONAL/KEEP` (deny-by-grants, kein anon/authenticated-Zugriff), die 17 ausführbaren `SECURITY DEFINER`-Trigger-/Event-Trigger-Functions `INFORMATIONAL/KEEP` (Rückgabetyp `trigger`/`event_trigger` — Postgres verbietet Direktaufruf, Advisor-Falsch-Positiv-Klasse), die aufrufbaren `authenticated`-only Business-RPCs `KEEP` (serverseitige Role-/Ownership-Checks verifiziert, kein anon-Zugriff, kein Authorization-Bug), Search-Path-Schutz `NO SEARCH PATH SECURITY BLOCKER` (kein `CREATE` auf `public` für client-facing Rollen, alle Functions schema-qualifiziert), und `auth_leaked_password_protection` **`RESOLVED — ENABLED`** (Production, 2026-08-28, per Dashboard-Toggle, danach per Advisor-Re-Check verifiziert). Details: `17-known-issues-and-planned-waves.md` „Residual Security Advisor Follow-ups — assessed 2026-08-28", `06-decision-log.md` „2026-08-28 – Residual Security Advisor Closure". Der zum Stand 2026-08-28 bekannte Supabase Security Advisor Backlog (dieser Snapshot) ist damit vollständig bewertet — Ziel ist nachgewiesene Sicherheit, nicht „0 Findings" (die verbleibenden INFO/ERROR-Einträge sind bewusst akzeptierte Architektur). Das schließt **keine** künftig neu auftretenden Advisor-Findings aus (neue Migration, neue Function, geänderte Grants, neue Advisor-Lint-Kategorie) — ein neuer Fund erfordert immer eine eigene Bewertung, unabhängig vom hier dokumentierten Abschluss.

## 6b. PWA-Status (Stand 2026-08-30, nach PWA-1B/1C — lokal, **nicht** deployed)

Nora ist eine installierbare PWA. Der Service Worker wird von `vite-plugin-pwa` 1.2.0 im `generateSW`-Modus erzeugt (`vite.config.ts`).

**Seit PWA-1B (lokal implementiert und verifiziert, noch kein Production-Release):**

- `registerType: "prompt"` — ein neuer Worker installiert sich und bleibt **WAITING**, bis der Benutzer aktualisiert. Der generierte `dist/sw.js` enthält nachweislich **kein** top-level `skipWaiting()` und **kein** `clientsClaim()` mehr, sondern nur noch den `SKIP_WAITING`-Message-Handler. Der Precache des laufenden Builds bleibt dadurch vollständig erhalten.
- Nora lädt `virtual:pwa-register` explizit (`src/components/atomic-crm/pwa/pwaRegistration.ts`); das Plugin injiziert deshalb kein `registerSW.js` mehr.
- Registrierung beim App-Start in `src/main.tsx` (nicht im Komponentenbaum — die Layouts rendern erst nach dem Login).
- Lifecycle: `pwa/pwaUpdateStore.ts` (framework-/UI-frei, prozessweit ein Store, Zustände `idle` / `updateAvailable` / `applying`), Präsentationsschnittstelle `pwa/usePwaUpdate.ts`.
- Update-Erkennung: Browser-Standard plus `registration.update()` beim Zurückkehren auf den Tab und stündlich, gedrosselt auf höchstens alle 30 Minuten und nur online.
- **Wichtige Folge für Release-Smokes:** ein Reload holt den neuen Build jetzt **nicht** mehr — der wartende Worker wird erst durch „Jetzt aktualisieren" aktiv. Siehe `07-agent-change-checklist.md`.

**Seit PWA-1C (lokal implementiert und verifiziert, noch kein Production-Release):** das Update tritt als **Anwendungs-Systemereignis** auf — eigener Layer `z-70`, prominentes aber **nicht-modales** Panel (`pwa/NoraUpdateEvent.tsx`, Motiv `pwa/NoraUpdateOrb.tsx`), oben zentriert, und **bei offenem Dialog/Sheet gar nicht sichtbar** (dieselbe `body:has(…[data-state="open"])`-Regel wie 7B). „Später" verschiebt um 2 Stunden statt 1 — die einzige technische Änderung am Store. Texte in `crm.pwa.*` (de/en/fr).

**Seit PWA-1C.1 (lokal implementiert und verifiziert, noch kein Production-Release):** reine Art-Direction-/Motion-/Presentation-Welle. Der erste visuelle Entwurf wurde vom Product Owner als generisch verworfen; ersetzt wurde die **Komposition**, nicht die Dekoration. Neu:

- **Orb-zentrierte Komposition** (34 rem, 2,5 rem Padding, 8,5-rem-Orb, Orb exakt in der Mitte), mehrschichtiger Update-Orb mit desynchronisierten Perioden, weit auslaufende Aura.
- **Warnsymbol des Product Owners** (`pwa/NoraSafetyMark.tsx`) — Geometrie unverändert aus dem gelieferten SVG, Original als Design-Asset unter `docs/nora/assets/pwa-update-warning-source.svg`.
- **8-Sekunden-Update-Choreografie** (`pwa/useUpdateChoreography.ts`) mit vier Phasen, danach genau ein `applyUpdate()`. **Bewusst reine Präsentation** — keine Fortschrittsbehauptung, weil der wartende Worker zu diesem Zeitpunkt bereits installiert ist und es nichts zu messen gibt. Der Choreografie-State ist lokal zur Komponente; `pwaUpdateStore` bleibt **unverändert**.
- **Recovery-Zustand** mit „Erneut versuchen", falls die Aktivierung ausbleibt.
- Neue `--nora-system-*`-Tokens für Surface, Hairline, Schatten, Aura und Warnfarben (hell/dunkel getrennt).

Details: `02-design-system.md`, Abschnitt „Anwendungs-Systemereignisse / Update-Experience"; Begründung: `06-decision-log.md`, „2026-08-30 – Premium Update Experience und 8-Sekunden-Choreografie (PWA-1C.1)".

**Status PWA-1C.1: `LOCAL VERIFIED — AWAITING PRODUCT OWNER UX ACCEPTANCE`.** In der gestylten App nachgemessen: Viewport-Matrix 1024/1180/1280/1440/1920 plus die Zoom-Äquivalente 1152 (125 %) und 960 (150 %) und Mobile, jeweils hell und dunkel — alle passen in den Viewport, kein horizontaler Overflow, Orb-Abweichung von der Panelmitte 0,0 px; Kontrast Text ≥ 4,5 und Grafik ≥ 3,0 in beiden Modi; Touch-Ziele 44 px Desktop / 47 px Mobile; Reduced Motion in echtem Chromium mit gesetztem Flag; Dialog-Deferral gegen einen echten Radix-Dialog in der laufenden App; die vollständige Achtsekundensequenz als Bildfolge und Messreihe. Die Bewertung „fühlt sich hochwertig an" liegt beim Product Owner. **Kein Production-Deployment, kein Commit.**

**Offene Product-Frage aus dieser Welle:** ob die Achtsekundendauer bei `prefers-reduced-motion: reduce` gekürzt werden soll (Empfehlung: ja, auf ~2,5 s). Bewusst nicht eigenmächtig umgesetzt — siehe Decision Log.

**Weiterhin gültige Production-Eigenschaften (2026-08-30 read-only gemessen):** nicht mehr existente Asset-URLs liefern einen harten 404 (kein SPA-Fallback); `/assets/*` wird **nicht** `immutable` ausgeliefert, sondern `max-age=0, must-revalidate` (es gibt keine `vercel.json`) — der HTTP-Cache ist also kein Schutznetz. Genau deshalb muss der Precache des laufenden Builds intakt bleiben.

Ursache, Reproduktion und Risikobewertung: `17-known-issues-and-planned-waves.md`, Abschnitt „PWA-Update-Verhalten nach Deployment". Entscheidung: `06-decision-log.md`, „2026-08-30 – PWA-Update: wartender Worker statt automatischer Übernahme (PWA-1B)".

## 7. Welche offenen Bugs/UX-Probleme existieren?

Details, Status und Ursachen: `17-known-issues-and-planned-waves.md`. Kurzfassung (Stand 2026-08-25, Live-UX-Fixes-Wave):

1. **Kunden-Autocomplete „neuen Kunden anlegen"-UX** (`/kontakte/create`) — **RESOLVED / VERIFIED.** Create-Option ist jetzt visuell abgesetzt (eigene `CommandGroup`, `CommandSeparator`, Plus-Icon) und zeigt eindeutigen deutschen Aktionstext („Neuen Kunden „%{item}" anlegen"). Fix in `autocomplete-input.tsx` (generisch) + drei Message-Kataloge. Test + Live-Verifikation vorhanden.
2. **LinkedIn-Feld auf `/kontakte/create`** — **VERIFIED NOT REPRODUCIBLE / ALREADY RESOLVED.** `ContactInputs.tsx` rendert kein `linkedin_url`-Feld, nur `links_jsonb`; live auf `/#/kontakte/create` bestätigt kein „LinkedIn"-Text vorhanden. Keine Code-Änderung nötig.
3. **Kunden-Show Tab-/Routing-Bug** (`/#/kunden/:id/show`, Tabs „Änderungsverlauf"/„Kontakte") — **RESOLVED / VERIFIED.** Root Cause verifiziert: `CompanyShowContent` navigierte auf den englischen `/companies/...`-Pfad, den der `LegacyPathRedirect` (registriert für dieselbe deutsche `kunden/*`-Alias-Route) sofort auf `/kunden/...` zurückschrieb — `useMatch("/companies/...")` matchte danach nicht mehr. Fix: Navigation und `useMatch` verwenden jetzt durchgehend den kanonischen deutschen Pfad (`CompanyShow.tsx`). `ContactShow`/`DealShow` geprüft, nicht betroffen (kein `useMatch`-Tab-Mechanismus bzw. dialogbasiert). Regressionstest + Live-Verifikation vorhanden.

## 8. Welche nächsten Domain-Waves sind geplant?

Hinweis: Unified Tasks Wave und Self Contact Wave (inkl. Final RC Hardening) sind seit 2026-08-28 auf Production angewendet und PRODUCTION VERIFIED (siehe Abschnitt 6) — nicht mehr offen.

1. Legacy-Spalten-Cleanup (`linkedin_url`, `website`, `context_links`, `companies.phone_number`) nach ausreichender Übergangszeit.
2. Mobile „Aufgaben"-Bereich auf der Kundenakte (die Unified Tasks Wave hat den Tab nur für Desktop `CompanyShow` gebaut, mobile `CompanyShowContentMobile` hat aktuell keine Tab-Struktur).
3. Privatperson/Firma-Unterscheidung in Quick Capture (bewusst nicht Teil der Self Contact Wave, siehe Decision Log).
4. Customer-Archive-/Soft-Delete-Lifecycle (`ArchiveCustomer`/`RestoreCustomer`) als Ersatz für das normale Kunden-Löschen — separate, noch nicht designte Wave; aktuell nur die notwendige Self-Contact-Delete-Invariante abgesichert.
5. ~~Idempotency für retry-fähige/externe Write Commands (`CreateQuickCaptureCase`, `CreateCustomerFromContact`)~~ — **Idempotency Wave, PRODUCTION VERIFIED seit 2026-08-28**, siehe Abschnitt 4 Punkt 17 und Decision Log. Migration `20260829120000_nora_idempotency_core.sql`, `NORA_IDEMPOTENCY_CONFLICT`. Authentifizierter End-to-End-HTTP-Beweis (echter `authenticated`-User-JWT) inzwischen erbracht (Decision Log Nachtrag „Authentifizierter End-to-End-HTTP-Beweis — GESCHLOSSEN"). Notification-/Operation-Status-Contract bleibt nicht Teil dieser Welle.
6. ~~Stabilerer, maschinenlesbarer Error Contract ohne Text-/Regex-Abhängigkeit~~ — **Error Contract Wave, PRODUCTION VERIFIED seit 2026-08-28**, siehe Abschnitt 6 und Decision Log. Fünf Codes über `DETAIL`, machine-code-first `normalizeCrmError()`, Legacy-Regex bleibt Fallback. Weitere RPCs/Trigger können in Folgewellen migriert werden, sobald neue reale Fälle auftreten.
7. `deals.contact_ids bigint[]` als Vorgang-Domain-Debt (keine FK-Integrität pro Element, keine Rollen/Zeitdimension) — siehe Decision Log.
8. Zukünftige Application Queries / Read Models (noch nicht implementiert, nur als Richtung dokumentiert).
9. ~~Separate Prüfung der beiden bestehenden, vorbestehenden Security-Advisor-Findings (`init_state`/`sales_directory`, `SECURITY DEFINER`-Views)~~ — **erledigt am 2026-08-28**, siehe Abschnitt 6a. Ergebnis: `ASSESSED / LOW / KEEP`, kein Blocker. Weitere INFO/WARN-Advisor-Hinweise bleiben unbewertet (separate Follow-up-Welle, siehe `17-known-issues-and-planned-waves.md`).
10. ~~Operation Status Contract v1~~ — **PRODUCTION VERIFIED seit 2026-08-29** (Phase 6E), siehe Abschnitt 4 Punkt 18, Decision Log „Operation Status Contract Wave" inkl. Nachtrag Phase 6C, 6D.1 und 6E. Die Notification-/Status-UI, die diesen Contract konsumiert, ist inzwischen als Phase 7B umgesetzt — siehe Abschnitt 4 Punkt 19. Sie ist seit 2026-08-30 **PRODUCTION VERIFIED** (Release-Commit `9db08c4b`), deckt aber bislang **nur Quick Capture** ab; die weiteren Intents bleiben Phase 7C.

## 9. Welche Dokumente muss ich für welches Thema lesen?

| Thema | Dokument |
|---|---|
| Projektziel, Nicht-Ziele | `00-project-context.md` |
| Domänenmodell, Kundenart, Hauptansprechpartner | `01-domain-model.md` |
| **Aufgaben/Tasks, `tasks.company_id`, historischer Kundenkontext** | `01-domain-model.md` (Modell) + `03-data-model-guardrails.md` Falle 7/7a (Fallen) + `06-decision-log.md` „Unified Tasks Wave" (Begründung) |
| **Self Contact, Effective Contact Context, Kontakt→Kundenakte, Quick-Capture-Command/Draft** | `01-domain-model.md` (Modell) + `03-data-model-guardrails.md` (Fallen) + `06-decision-log.md` „Self Contact Wave" (Begründung, Alternativen) |
| Design/UI-Regeln | `02-design-system.md` |
| Datenmodell-Fallen, Guardrails | `03-data-model-guardrails.md` |
| Routing, i18n, deutsche URLs, **bekanntes Fehlermuster englische Ur-Code-Pfade** | `04-routing-i18n.md` |
| Demo-Daten (FakeRest) | `05-demo-data-guidelines.md` |
| **Alle fachlichen/architektonischen Entscheidungen inkl. Begründung** — Datei hat einen Index am Anfang, nicht komplett lesen, gezielt springen | `06-decision-log.md` |
| Checkliste vor/während/nach Code-Änderungen | `07-agent-change-checklist.md` |
| Nummernvergabe, globale Suche | `08-numbering-and-global-search.md` |
| Fensterauftrag-Workflow | `09-window-order-workflow.md` |
| Checklisten/Textbausteine/Audit-Datenmodell | `10-checklists-snippets-audit.md` |
| Google Kalender, Rollenmodell (RBAC) | `11-google-calendar-rbac.md` |
| **Security Advisor Findings (`init_state`/`sales_directory`, `SECURITY DEFINER`-Views), unbewertete Follow-ups** | `16-current-state.md` Abschnitt 6a (Kurzstatus) + `17-known-issues-and-planned-waves.md` „Security Advisor Findings — assessed 2026-08-28" (Details) + `06-decision-log.md` „2026-08-28 – Intentional privileged read views" (Begründung) |
| Rollen-UX-Abnahme | `12-role-ux-acceptance.md` |
| CRM-Audit-Retention | `13-crm-audit-retention.md` |
| Google-Kalender-Implementierung (read-only) | `14-google-calendar-readonly-implementation.md` |
| **Dieser Überblick** | `16-current-state.md` |
| **Offene Bugs, geplante Waves im Detail** | `17-known-issues-and-planned-waves.md` |
| **Error Contract (`NoraErrorCode`, `DETAIL`-Konvention, machine-code-first `normalizeCrmError`)** | `06-decision-log.md` „2026-08-28 – Error Contract Wave" + `domain/noraErrorCodes.ts` + `07-agent-change-checklist.md` |
| **Operation Status Contract (`execution`/`errorCode`/`result` am `OperationRecord`, `_meta.disposition`)** | `06-decision-log.md` „2026-08-29 – Operation Status Contract Wave (v1, CreateQuickCaptureCase Slice)" + `operations/operationModel.ts` + `operations/operationManager.ts` |
| **Notification Presentation Contract (Intent-Karte, Presentation-`partial`/`warning`, Display Context, Initiator, Retry-/Eskalations-Policy, Architektur-Guardrails)** — Contract Phase 7A; UI seit Phase 7B.4 real montiert, aber nur für Quick Capture | `06-decision-log.md` „2026-08-29 – Notification Presentation Contract v1 (Phase 7A)" inkl. Nachträge 7B.3/7B.4 + `notifications/*` |

Hinweis: Die Nummer `15` existiert nicht (keine `15-*.md` in der Git-Historie gefunden) — keine bewusste Reservierung, einfach eine Lücke. Bei der nächsten neuen Kern-Doku kann `15` vergeben werden, statt eine Lücke offenzulassen.

## 10. Truth Hierarchy

Bei Widersprüchen zwischen Chatwissen, Dokumentation und Code gilt (siehe auch `07-agent-change-checklist.md`):

1. aktueller Code
2. aktuelle Migrationen / DB-Zustand
3. verifizierter Production-Zustand
4. Git-Historie
5. Dokumentation
6. Chatwissen aus vorherigen Sitzungen

Dokumentation wird nach bestem Wissen aktuell gehalten, ist aber niemals autoritativer als der tatsächliche Code- oder DB-Zustand.
