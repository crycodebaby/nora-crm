# 16 – Aktueller Zustand (Einstiegspunkt für neue Agenten)

Stand: 2026-09-06 (User Lifecycle W5 PRODUCTION VERIFIED — `main` = 3baf5b02, Migration 20260906180000 live, users Edge v8; W4 PRODUCTION VERIFIED; davor 2026-08-29 nach Security Advisor Baseline Closure + Error Contract Wave Production Release + Idempotency Wave Production Release + Operation Status Contract v1 Production Release).

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
- **Offene Selbstregistrierung — Status GEKLÄRT und AKTIV (2026-09-04): `disable_signup: false` in `nora-crm-prod` read-only nachgewiesen. Jede beliebige E-Mail-Adresse kann sich selbst registrieren und erhält über `handle_new_user` automatisch eine `sales`-Zeile mit Leserechten auf alle Kunden-/Kontakt-/Vorgangsdaten. Bestandsproblem, nicht durch eine Welle verursacht, aber release-blockierend — Details, Nachweiskette und Behebungsanleitung in `17-known-issues-and-planned-waves.md`.**
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

20. **Vorgänge-Kanban Navigation Rail** (2026-08-30): Die erste Pfeil-/Scrollbar-Präsentation wurde vom Product Owner visuell verworfen; ihr früherer `UX ACCEPTED`-Status gilt nicht mehr. Der lokale Nachfolger behandelt das Kanban als horizontale Arbeitsfläche: bottom-sticky integriertes Rail als einzige sichtbare horizontale Steuerung, proportionaler und direkt ziehbarer Viewport-Thumb mit 44-px-Touch-Minimum, echte Spaltenmarker, Track-Klick auf reale Position, integrierte 44-px-Pfeile, korrekte Scrollbar-ARIA-Semantik und schwächere Edge-Fades. Die Browser-Scrollbar ist visuell ausgeblendet; native Trackpad-/Touch-/Wheel-Fähigkeit und Momentum bleiben erhalten. Alle Wege schreiben ausschließlich dasselbe `scrollLeft`; Karten-DnD und freier Board-Pan bleiben getrennt. Reine Frontend-/UX-Wave, keine Migration und keine Domain-/Persistenzänderung. **`KANBAN NAVIGATION RAIL PRODUCTION VERIFIED`** (2026-09-01): Product Owner UX-Abnahme erteilt; kontrollierter Release als Fast-Forward `90f3dfc4..fe962c58` (kein Force, kein Squash, kein Merge-Commit), Vercel Production `dpl_A9GhyFNPvUPfuprbtrERDPgHBvwU` READY auf exakt diesem SHA, Alias `nora.ergart.de`. **Bewusst keine DB-Wave:** der Diff gegen die Production-Basis `90f3dfc4` beruehrt keine Datei unter `supabase/` und kein `*.sql` — keine Migration, keine RPC-/RLS-/Audit-Aenderung. Live nicht-schreibend nachgemessen (Dark und Light, 1151 px und 916 px effektive Breite): bei nur drei belegten Statusspalten liegt kein Overflow vor und das Rail blendet sich korrekt aus (`data-visible="false"`, beide Pfeile disabled); mit „Alle Status anzeigen“ (12 Spalten, `scrollWidth` 4060) erscheint es, Pfeil = exakt eine Spalte (340 px = 320 + 20 Gap) mit Klammerung an beiden Enden, `End`/`Home` auf `scrollWidth - clientWidth` bzw. 0 ohne Seitenscroll, Track-Klick zentriert auf 1 px genau, Thumb-Drag proportional und punktgenau mit sauberem `data-dragging`-Reset, Edge-Fades richtungsabhaengig, Rail sticky und durch die Arbeitsflaeche begrenzt (`padding-bottom: 76px`, Karten frei), 44-px-Touchziele, `overflow-x: auto` bei ausgeblendeter Browserleiste, kein horizontaler Seiten-Overflow, Konsole ohne Meldungen. Karten-DnD blieb intakt (RFD-Kontext live, Pointer-Down auf einer Karte startet keinen Board-Pan) — ein echter Karten-Drop wurde in Production **nicht** ausgefuehrt, weil er eine Statusaenderung an einem realen Vorgang geschrieben haette; dieser Pfad bleibt durch die Suite und die lokale Abnahme gedeckt. Unterhalb des MobileLayout-Breakpoints (gemessen 749 px) rendert das Kanban wie bisher nicht — unveraendertes Bestandsverhalten, nicht Teil dieser Welle. Decision Log „2026-08-30 – Vorgänge-Kanban Navigation Rail".

21. **Employee Onboarding & Access V1A** (2026-09-04): technisches Fundament für
Mitarbeiterzugänge — **kein** Design-/Motion-Wave. Der produktseitige
Zugangsstatus wird aus Supabase Auth + `sales.disabled` **abgeleitet**
(`invited` / `active` / `disabled` / `unknown`), **keine Migration, keine neue
Statusspalte**. Neuer admin-only Serverpfad an der bestehenden `users` Edge
Function: `GET /users[?sales_id=]` liefert ausschließlich
`employeeId/email/accessState/disabled/invitedAt/activatedAt` (keine Tokens,
keine Provider-Metadaten); `POST` mit `action: "resend_invitation" |
"request_password_setup"` sind die zwei zustandsabhängigen Admin-Aktionen, jede
serverseitig gegen denselben Zustand geprüft und auditiert
(`user.invitation_resent`, `user.password_setup_requested`). Client:
`application/commands/employeeAccess.ts` als benannte Anwendungsoperationen,
`sales/employeeAccessContract.ts` als Vokabular-Spiegel,
`sales/EmployeeAccessPanel.tsx` + Statusspalte in `SalesList`.
**Behobener Bestandsdefekt:** `public/auth-callback.html` leitete auf
`#/auth-callback` weiter — eine von react-admin für `handleCallback` reservierte
Route, die Nora nicht implementiert; Einladungs- **und** Passwort-Link endeten
auf „Something went wrong". Neue Nora-eigene Route `/zugang-einrichten` führt
beide Wege auf dieselbe Passwortvergabe. Onboarding ist jetzt eine reine
Zustandsmaschine (`login/employeeOnboardingFlow.ts`): `welcome` behauptet
nie, das Passwort sei gesetzt; `complete` ist nur nach echtem Passwort-Erfolg,
gültiger `sales`-Zuordnung und nicht deaktiviertem Zugang erreichbar. Lokale
Invite-/Recovery-E-Mail-Templates auf deutsche Nora-Terminologie umgestellt
(„Einladung zu Nora", „Nora-Zugang einrichten", „Einmalcode") inkl. Korrektur
des fehlerhaften `{{ .ConfirmationURL }}/auth-callback.html`-Links.
**Status: `V1A DEPLOYED — HUMAN E2E PENDING` (2026-09-04).** Oeffentliche
Selbstregistrierung wurde vom Product Owner in `nora-crm-prod` deaktiviert und
unabhaengig nachgewiesen: `/auth/v1/settings` meldet `disable_signup: true`,
`POST /auth/v1/signup` antwortet `422 signup_disabled`. Login-Pfad und Recovery
bestehender Benutzer weiterhin funktionsfaehig (`invalid_credentials` statt
Blockade; `recovery_sent_at` real gesetzt); der Admin-Invite-Endpunkt ist
bearer-gated (`401 no_authorization`) und von der Signup-Einstellung nicht
betroffen. `users` Edge Function als **Version 3** deployt und live verifiziert
(CORS meldet jetzt `GET, POST, PATCH, DELETE`; ungueltiges JWT ergibt auf
GET/POST/PATCH weiterhin 401). **Noch offen:** kontrollierter manueller
End-to-End-Test durch den Product Owner mit einem eigenen Test-Postfach.
**Erst danach `PRODUCTION VERIFIED`.** Verifikation lokal: `typecheck`,
`build`, App-Suite (92 Dateien, 815 Tests, 1 übersprungen) und Function-Suite
(11 Dateien, 163 Tests) grün, ESLint 0 Fehler. **Nicht verifiziert:** echter
E-Mail-Versand, echte GoTrue-Antworten und Live-Verhalten gegen
`nora-crm-prod` — die `users` Edge Function ist zudem nicht automatisch
deployt. Siehe Decision Log „2026-09-04 – Employee Onboarding & Access V1A".

22. **Employee Onboarding & Access V1B** (2026-09-04): Präsentations-Welle
über dem eingefrorenen V1A-Contract — Zustandsmaschine, Auth, Routen und
Edge Function unverändert. Neue Login-Primitive (`OnboardingProgress`,
`PasswordFieldWithVisibility`, `ConsentCheckbox`, `OnboardingSuccessMark`,
`AccessStepFold`, `WaitingDots`, `onboardingSteps.ts`, `accessMotion.ts`),
`EmployeeAccessShell` mit `--nora-access-*`-Tokens und 26-rem-Karte,
`set-password-page.tsx` als Schrittfolge „Hallo {Vorname}" → Passwort →
Profil (Variante B) → zentrierter Abschluss mit gezeichnetem grünen Haken;
Ungültig/Gesperrt neutral. Admin: `EmployeeAccessStatus`-Pill in `SalesList`
(neue Spalte „Rolle", alte Badges entfernt) und im `EmployeeAccessPanel`
(Datumszeile, zustandsabhängige Aktionen, Verweis auf das eine Schreibfeld).
Copy: Admin-Anlage „Mitarbeiter einladen". Demo-Modus simuliert das
Onboarding-Backend (nur `VITE_IS_DEMO=true`, nicht im Production-Bundle).
**Status: `PO UX ACCEPTED — READY FOR RELEASE`** (2026-09-04) — Branch
`feat/nora-employee-onboarding-access-v1b`, nicht auf `main`, nicht deployt.
Verifikation und Messwerte: Decision Log „2026-09-04 – Employee Onboarding &
Access V1B"; Gestaltungsregeln: `02-design-system.md` „Mitarbeiter-Onboarding
& Zugang (Welle V1B)".
23. **Employee Access V1C-A – E-Mail-Zustellbeobachtung** (2026-09-04):
Backend-/Infrastruktur-Fundament, damit Nora über eine Zugangs-E-Mail mehr weiß
als „Sendevorgang angenommen". Neue Edge Function `brevo-email-events`
(Bearer-Token-Authentifizierung über `BREVO_WEBHOOK_TOKEN`, konstantzeitiger
Vergleich, `verify_jwt = false`), providerneutraler Ereignisvertrag
(`EMAIL_ACCEPTED` … `EMAIL_SPAM_REPORTED`), append-only Tabelle
`public.email_delivery_events` mit Admin-Leserecht, Ingest-RPC
`public.ingest_email_delivery_event()` und Lesemodell
`public.employee_email_delivery_status()` für V1C-B. **Kein Öffnungs- und
Klick-Tracking** — Tracking-Ereignisse werden verworfen und sind per CHECK
ausgeschlossen. **Korrelation ist `BEST_EFFORT`** (Zuordnung über die
Empfängeradresse; Supabase Auth versendet über SMTP und erlaubt keinen
Nora-eigenen Korrelationswert in der Nachricht) — „zugestellt" beweist weder
Lesen noch abgeschlossenes Onboarding. Migration
`20260904120000_nora_email_delivery_observability.sql` ist additiv und in
Production angewendet (genau ein Eintrag, Version auf den Dateinamen-Zeitstempel
korrigiert). **Status: `V1C-A PRODUCTION VERIFIED` (2026-09-04)** — Release-SHA
`8e80c44b`, Edge Function `brevo-email-events` Version 1 (`verify_jwt = false`),
Brevo-Outgoing-Webhook aktiv, echter E2E mit einer realen Zugangs-E-Mail
bestätigt: `request` → `EMAIL_ACCEPTED` und `delivered` → `EMAIL_DELIVERED`,
beide `best_effort` und korrekt auf `sales.id = 1` aufgelöst, Lesemodell liefert
`outcome = delivered`. Kein Öffnungs-/Klick-Datensatz. Wiederholtes Ingest
derselben Ereignisidentität legt keine zweite Zeile an. **Offener Befund:**
`mail_kind` blieb `unknown`, weil der Betreff der Brevo-Nutzlast nicht auf die
konfigurierten Needles passte — die Zustellwahrheit ist davon unberührt, aber
die Ursache ist auf zwei Möglichkeiten eingegrenzt (Betreff-Drift im Dashboard
vs. fehlendes `subject`-Feld in der Brevo-Nutzlast) und wird beim nächsten echten
Versand durch ein inhaltsfreies `subject_present`-Log entschieden (siehe
`17-known-issues-and-planned-waves.md`, V1C-A.7). Verifiziert: `typecheck`,
`build`, ESLint sowie die Function-Suite (13 Dateien, 251 Tests) grün — darunter
repräsentative Brevo-Nutzlasten mit den echten `snake_case`-Ereigniswerten
(`soft_bounce`, `hard_bounce`, `invalid_email`), die sich von den camelCase-
Namen des Webhook-Abos unterscheiden. **Nicht
verifiziert:** die Migration wurde gegen **keine** Postgres-Instanz ausgeführt
(kein Docker in der Session, siehe `17-known-issues-and-planned-waves.md`), und
der Produktions-SMTP-Transport konnte nur indirekt beurteilt werden — beides ist
mit dem Production-Release und dem realen E2E nachgeholt. Nicht belegbar blieb
allein die 200-Antwort des Webhooks im Edge-Log (Log-Stream für dieses Fenster
unvollständig, auch der auslösende `POST /users` fehlt); die Zeilen selbst sind
der Beweis, weil nur `service_role` einfügen darf. Details:
`18-email-delivery-observability.md`, Decision Log „2026-09-04 – Employee Access
V1C-A".

24. **Employee Access V1C-B – Zustellstatus-UI** (2026-09-04): das
`EmployeeAccessPanel` zeigt unter den Zugangsfakten eine untergeordnete Zeile
„Letzte E-Mail-Zustellung" — „Zugestellt am 04.09.2026 um 17:09",
„E-Mail versendet", „Zustellung verzögert", „E-Mail konnte nicht zugestellt
werden" (+ „E-Mail-Adresse prüfen") oder „Als Spam markiert – Zustellung
eingeschränkt". **Ohne Historie erscheint der Block gar nicht.** Gelesen wird
ausschließlich über die Admin-only-RPC
`public.employee_email_delivery_status()`, nie direkt über
`email_delivery_events`; ein Lesefehler zeigt nichts an statt einer Fehlermeldung,
weil Zustellstatus Sekundärinformation ist. Der Zugangszustand bleibt die
primäre Information. **Die Mailart wird bewusst nie gerendert** — die Korrelation
ist Best-Effort, „diese Einladung wurde zugestellt" wäre eine Aussage, die die
Daten nicht tragen. Kein „geöffnet"/„gelesen"/„geklickt". Zeitstempel fest in
`Europe/Berlin`. **Status: `V1C-B RC` (2026-09-04)** — nicht deployt, wartet auf
Product-Owner-Review. Verifiziert: `typecheck`, `build`, ESLint (0 Fehler),
Prettier für die geänderten Dateien, App-Suite (98 Dateien, 886 Tests) und
Function-Suite (13 Dateien, 259 Tests) grün. Details:
`18-email-delivery-observability.md` Abschnitt 6a/6b.

25. **User Lifecycle W1 – ein privilegierter Executor** (2026-09-05): jede
Änderung an `sales.role` / `sales.disabled` (Rolle, Deaktivieren,
Reaktivieren, Einladung als deaktiviert) läuft ausschließlich über
`Admin-UI → users Edge Function → public.set_sales_access_by_executor
(service_role, verifizierter Actor) → nora_private.apply_sales_role_change`.
Die Legacy-RPC `set_sales_role_by_admin` ist für `authenticated`/`anon` nicht
mehr ausführbar (nur noch service_role; in W2 entfernt, siehe Punkt 26).
Serverseitig neu: Selbstschutz (ein Admin kann sich nicht selbst deaktivieren
oder demotieren, `403 self_access_change_forbidden`), Datenbank-Invariante
„mindestens ein aktiver Administrator" (`guard_last_active_admin_trigger`,
`NORA_LAST_ACTIVE_ADMIN_REQUIRED`), Bann-Synchronisation in **jedem** Zweig mit
Verifikation beider Fakten (`employee_access_sync_incomplete` statt falschem
Erfolg), Konsistenzfakt `accessConsistency` + `noraDisabled` in `GET /users`
und eine Reparatur „Zugangsstatus synchronisieren" im `EmployeeAccessPanel`.
Migration `20260904220000_nora_lifecycle_single_executor.sql`, neue SQL-Suite
`lifecycle_single_executor_verification.sql`, `users/lifecycle.ts` (+17 Tests).
**Status: `PRODUCTION VERIFIED` (2026-09-05).** Migration in `nora-crm-prod`
angewendet (Ledger nach PO-freigegebener Einzeilen-Korrektur unter
`20260904220000`), `users` Edge Function v5, `main = a58650a0`
(Fast-Forward), Vercel READY auf exakt diesem SHA, Live-Smoke der
Benutzerverwaltung grün. Der eine inkonsistente Datensatz wurde über
„Zugangsstatus synchronisieren" repariert (Bann gesetzt, kein doppeltes
Audit-Ereignis, `accessConsistency = consistent`). Details: Decision Log
„2026-09-05 – User Lifecycle W1", Nachtrag Release; offene Punkte in
`17-known-issues-and-planned-waves.md`.

26. **User Lifecycle W2 – Referenzintegrität und historische Identität**
(2026-09-05): Geschäftsdaten überleben den Mitarbeiter-Lebenszyklus.
`contact_notes.sales_id` von `ON DELETE CASCADE` auf `NO ACTION`,
`tasks.sales_id` bekommt einen Foreign Key (`NO ACTION`, nullable bleibt),
Browser-Rollen verlieren `DELETE` auf `sales`, beide Identity-Views sind
`SELECT`-only. Lösch-Modell: referenzierter Mitarbeiter → DELETE auf jedem
Pfad verweigert (sechs FK-Barrieren); unreferenzierter Mitarbeiter → nur für
`postgres`/`service_role` löschbar (Pfad des künftigen kontrollierten
Hard-Delete-Executors, nicht gebaut). Zwei Read-Models: `sales_directory`
(aktiv, Zuweisungs-Picker) und neu `sales_identities` (alle Zeilen inkl.
`disabled`, historische Namen in Notizen/Akten/Aktivitätslog/Export);
deaktivierte Mitarbeiter behalten ihren echten Namen auf alten Datensätzen.
Legacy-RPC `set_sales_role_by_admin` entfernt (kein Aufrufer mehr; `users`
Edge Function v5 nutzt den Executor). Nebenfix: FakeRest pflegt die
Projektionen jetzt über den Store (vorher wirkungslose Array-Mutation).
**Hardening (gleicher RC):** aktive Zuweisung ist autoritativ — Trigger
`guard_active_assignment_trigger` auf `companies`/`contacts`/`deals`/`tasks`
verweigert `INSERT`/`UPDATE OF sales_id` auf einen deaktivierten Mitarbeiter
(`NORA_EMPLOYEE_NOT_ASSIGNABLE`, neuer `NoraErrorCode`), unverwandte Updates
und Wegwechseln bleiben erlaubt, Notiztabellen (Urheberschaft) sind bewusst
nicht betroffen; `SalesAssignmentInput` zeigt einen deaktivierten Zuständigen
im Bearbeiten-Formular sichtbar, aber nicht wählbar.
Migrationen `20260905120000_nora_lifecycle_reference_integrity.sql` und
`20260905150000_nora_lifecycle_active_assignment.sql`, neue SQL-Suite
`lifecycle_reference_integrity_verification.sql` (11 Abschnitte).
**Status: `PRODUCTION VERIFIED`** (2026-09-05: beide Migrationen live auf
`nora-crm-prod`, `main = f12c908e`, Vercel READY auf diesem SHA, Alias
`nora.ergart.de`, Live-Smoke durch den Product Owner ohne Regression; siehe
Decision Log „2026-09-05 – User Lifecycle W2", Nachtrag Release).
Details: Decision Log „2026-09-05 – User Lifecycle W2".

27. **User Lifecycle W3 – Audit-Actor und stabile Mitarbeiter-Historie**
(2026-09-05): Jede menschlich ausgelöste Lifecycle-Aktion nennt im Audit den
echten Administrator (`actor_id`, `actor_sales_id`, Name, Rolle) und denselben
stabilen Ziel-Mitarbeiter (`entity_id = nora_entity_uuid('sales', id)`) —
vorher „System" mit `NULL`-Actor für alle 12 Production-Zeilen, und die drei
Edge-Ereignisse mit zufälliger Entity. Mechanik: `resolve_audit_actor()`
löst unter `service_role` den vom Executor transaktionslokal verankerten,
verifizierten Actor aus `public.sales` auf (unverankert bleibt `System`);
`set_sales_access_by_executor` bekommt `p_operation_id` (alte Signatur
gelöscht, Edge v5 kompatibel); neue `service_role`-only RPC
`record_employee_admin_event` für `user.invited` /
`user.invitation_resent` / `user.password_setup_requested` (Ereignistyp,
Actor, Ziel, Metadaten-Schlüssel validiert, Snapshots und Entity aus der DB).
`users` Edge Function: Modul `audit.ts`, eine Operation-ID pro Request
(Header oder geprägt) als `request_id` aller Audit-Zeilen des Requests,
`audit_write_failed` statt grünem Ergebnis ohne Audit. Historie unverändert.
Migration `20260905180000_nora_lifecycle_audit_actor.sql`, neue SQL-Suite
`lifecycle_audit_actor_verification.sql` (8 Abschnitte), echter HTTP-Lauf
(24 Beweise). **Status: `PRODUCTION VERIFIED`** (2026-09-06): Migration
einmal auf `nora-crm-prod` angewendet (Ledger-Drift mit PO-Vorabfreigabe auf
`20260905180000` korrigiert, Ledger 52 = Repo), `users` Edge **v6** byteexakt
aus dem RC, `main = 929948da` (manueller PO-Push nach Klassifizierer-Halt),
Live-Beweis mit dem deaktivierten Testkonto `sales.id = 4`: vier neue
`user.role_changed`-Zeilen mit Actor = Product Owner (`actor_id`,
`actor_sales_id = 1`, Name, Rolle `admin`), einer stabilen `entity_id`
(`nora_entity_uuid('sales', 4)`) und vier verschiedenen `request_id`s;
Endzustand `office`/deaktiviert; die 12 alten `System`-Zeilen unverändert
(Digest identisch). Details: Decision Log „2026-09-05 – User Lifecycle W3",
Nachtrag Release.

28. **User Lifecycle W4 – kontrollierte Änderung der Anmeldeadresse**
(2026-09-06): Die Login-E-Mail eines Mitarbeiters lässt sich jetzt ändern —
administratorgesteuert, ohne dass Auth-Identität und `sales.email`
auseinanderlaufen, ohne Änderung des Zugangsstatus, und ohne dass alte
Einladungs-/Passwort-Links weiterleben. Vorher scheiterte jede Auth-E-Mail-
Änderung an `prevent_sales_privilege_escalation` (`500 internal_error`);
GoTrue hätte außerdem den alten Einladungslink nach A→B weiterhin akzeptiert
(lokal bewiesen). Mechanik: `Admin-UI („E-Mail-Adresse ändern") → users Edge
(action change_email) → public.prepare_sales_email_change (service_role,
verifizierter Actor, alle Guards, Ticket) → GoTrue Admin API → BEFORE-UPDATE-
Guard auf auth.users` — der Guard schreibt `sales.email` (Capability-Owner
`nora_identity_manager`), löscht die `auth.one_time_tokens` des Users,
konsumiert das Ticket und schreibt `user.email_changed` (Actor = Admin,
stabile Entity, Request-ID) **in GoTrues Transaktion**; ohne Ticket wird jede
Auth-E-Mail-Änderung verweigert. Danach verifiziert die Edge Function beide
Speicher und den Zugangsstatus; eingeladene Mitarbeiter erhalten eine neue
Einladung an die neue Adresse, deaktivierte bleiben deaktiviert/gebannt und
erhalten nichts. Normalisierung `lower(btrim())`, Unique-Index
`uq__sales__email` (citext), Eindeutigkeit gegen `sales` und `auth.users`.
Selbständerung blockiert; PATCH mit `email` wird als Ganzes abgewiesen
(`email_change_requires_command`); `GET /users` liefert `identityConsistency`.
Migration `20260906120000_nora_lifecycle_email_change.sql`, neue SQL-Suite
`lifecycle_email_change_verification.sql` (11 Abschnitte), `users/emailChange.ts`
(+26 Tests), `sales/ChangeEmployeeEmailDialog.tsx`, Operation-Katalog
`employee.change_login_email`. **Status: `PRODUCTION VERIFIED` (2026-09-06)**
— Migration `20260906120000` live (Ledger korrigiert), `users` Edge v7, RC
`693a84c9` + Hotfix `64ac11c1` (No-op-„Speichern" im Bearbeiten-Formular,
Test-Typisierung) auf `origin/main`, Vercel auf `nora.ergart.de`; Live-Beweis
des Product Owners am deaktivierten Testkonto `sales.id = 4`: fünf
`user.email_changed`-Zeilen mit echtem Admin-Actor, stabiler Entity-ID und
eigener Request-ID, `disabled`/Bann unverändert, alte Einladungs-Tokens
gelöscht, keine Mail, Adresse am Ende wiederhergestellt — Decision Log
„2026-09-06 – User Lifecycle W4", Nachtrag Release. Offene Punkte:
`17-known-issues-and-planned-waves.md` Abschnitt „User Lifecycle W4".

29. **User Lifecycle W5 – kontrolliertes Offboarding, Session-Revokation,
Abhängigkeits-Preview** (2026-09-06): Neue Geschäftsoperation **„Zugang
beenden"** — der Nora-Zugang eines Mitarbeiters endet sofort, Person,
Historie und alle Referenzen bleiben, nichts wird gemailt, offene
Zuweisungen blockieren nie und werden als Zähler gezeigt. Mechanik:
`Admin-UI → users Edge (action offboard) → public.offboard_employee_by_executor
(service_role, verifizierter Actor) → in einer Transaktion: sales.disabled
über die W1-Capability (Letzter-Admin-Trigger, user.disabled), alle
auth.sessions/auth.refresh_tokens des Mitarbeiters gelöscht, Preview,
user.offboarded (echter Admin, stabile Entity, request_id) → Auth-Bann →
Verifikation`. `disposition executed|replayed`: ein Retry ändert nichts und
schreibt nichts. **Session-Bindung der RLS:** bewiesen, dass PostgREST die
Existenz der Sitzung nie prüft und ein altes unverfallenes Token nach einer
Reaktivierung wieder Daten sah; `nora_private.is_active_user()` und
`current_role()` verlangen jetzt, dass die im JWT genannte Sitzung in
`auth.sessions` existiert (Tokens ohne Claim unverändert; Fail-open mit
WARNING nur bei fehlendem Leserecht). Reaktivierung (W1) unverändert, alte
Sitzungen kommen nicht zurück, neue Anmeldung erforderlich. Preview
`public.get_employee_dependency_preview` (Kunden, Kontakte, offene Vorgänge,
offene Aufgaben; Notizen getrennt) in `GET /users?sales_id=` und in der
Antwort. UI: `OffboardEmployeeDialog`, dauerhafter Block „Offene
Zuständigkeiten" in der Mitarbeiterakte (`EmployeeDependencySummary`, vor/
während/nach dem Offboarding, auch bei null) mit gefilterten Listen-Links,
Katalog `employee.offboard`. Migration
`20260906180000_nora_lifecycle_offboarding.sql`, neue SQL-Suite
`lifecycle_offboarding_verification.sql` (12 Abschnitte),
`users/offboarding.ts` (+15 Tests). **Status: `PRODUCTION VERIFIED`
(2026-09-06)** — RC `3baf5b02` unabhängig zertifiziert (Gate PASS), `main` =
`3baf5b02`, Migration live (Ledger-Kopf `20260906180000`), `users` Edge v8
byteidentisch, Vercel READY, Live-Beweis am Testkonto `sales.id = 4`
(Endzustand deaktiviert/gebannt, eigener `user.offboarded`); kanonische
SQL-Sequenz 28/28, Function-Suite 17/343, App-Suite 108/955, echter
GoTrue-Beweis 63/63. Fail-open der Session-Bindung bei fehlendem Leserecht
ist eine dokumentierte, nicht angreiferseitig erreichbare Einschränkung
(W6-Empfehlung: fail-closed). Details und Zwischenfall des Live-Beweises:
Decision Log „2026-09-06 – User Lifecycle W5", Nachtrag Release. W6 (Hard
Delete) nicht begonnen.

## 5. Customer & Contact Workflow Wave — was ist tatsächlich implementiert

Vollständige Entscheidung: Decision Log "2026-08-25 – Customer & Contact Workflow Wave".

- `companies.customer_kind` (`business`/`individual`) steuert den Formularmodus in `CompanyInputs` (geteilt zwischen `/kunden/create` und `/kunden/:id/edit`).
- `contacts.is_primary` — max. 1 Hauptansprechpartner pro Kunde, durchgesetzt per Partial Unique Index `uq_contacts_one_primary_per_company`. Wechsel nur über RPC `set_primary_contact`.
- Atomare Anlage über RPC `create_customer_with_contact(p_company jsonb, p_contact jsonb, p_existing_contact_id bigint)` — SECURITY DEFINER, `can_write()`-gated, ein Transaktionskörper für Kunde + optional neuer/bestehender Ansprechpartner.
- `/kunden/create` (`CustomerCreateForm.tsx`) ist die Referenzimplementierung: eigener `onSubmit` statt `CreateBase`, ruft `dataProvider.createCustomerWithContact(...)`. Ansprechpartner-Modi: kein / neu / Unternehmer ist selbst Ansprechpartner (inkl. „Angaben übernehmen") / bestehenden zuordnen. Bei Privatperson entfällt der Modus-Wähler, Kundenname wird aus Vor-/Nachname abgeleitet.
- **Regionale Create-Defaults (Customer Create Speed & Clarity, 2026-09-01, RC):** `/kunden/create` zeigt kein „Land"-Feld; `buildCustomerCreatePayload` setzt `country = "Deutschland"` (kanonischer Bestandswert, `customerCreateDefaults.ts`). „Bundesland" startet mit `"NRW"`, frei überschreibbar. Links/Größe/Umsatz/Steuernummer liegen eingeklappt unter „Weitere Angaben"; Adresse in der Reihenfolge Straße → PLZ | Ort → Bundesland. `CompanyInputs variant="create"` — der Edit-Flow (`variant="default"`) bleibt strukturell unverändert, zeigt Land weiterhin und überschreibt nie gespeicherte Werte. Decision Log „2026-09-01 – Customer Create Speed & Clarity".
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

**Nachtrag 2026-09-04 (Security Hardening Wave 0 — `audit_events` TRUNCATE): `PRODUCTION VERIFIED`.** Unabhängig vom Advisor-Backlog wurde ein Privilegienbefund geschlossen: `authenticated` besaß auf `public.audit_events` das Recht `TRUNCATE` (sowie `REFERENCES`/`TRIGGER`/`MAINTAIN`). `TRUNCATE` umgeht Row Level Security **und** feuert keine Row-Trigger — weder die Admin-only-Lesepolicy noch die Append-only-Trigger `prevent_audit_events_update`/`_delete` konnten das abwehren; die gesamte Audit-Historie war mit einer Anweisung löschbar, während einzelne Zeilen korrekt geschützt waren. Ursache waren die Default-Privilegien des Schemas `public` in Kombination mit rein additiven `grant select`-Migrationen ohne vorheriges `revoke all`. Migration `20260904174013_nora_audit_events_truncate_hardening` normalisiert `authenticated` auf **genau `SELECT`**; live gegen `nora-crm-prod` verifiziert (TRUNCATE/UPDATE/DELETE/INSERT als `authenticated` real abgewiesen, Admin-Lesepfad und `nora_private.write_audit_event()` funktionsfähig, 276 Audit-Zeilen unberührt, alle Proben in zurückgerollten Transaktionen — keine künstliche Audit-Historie erzeugt). Details: `06-decision-log.md` „2026-09-04 – Security Hardening Wave 0".

**Zwei Guardrails aus dieser Welle, die für jede künftige Grant-Änderung gelten:**

- **Immer `revoke all` vor `grant`.** Ein additives `grant select` lässt die von den Default-Privilegien geerbten Rechte (`TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN`) stehen — genau so entstand dieser Befund. `operation_errors` und `email_delivery_events` waren nie betroffen, weil deren Migrationen erst revoken.
- **Ein lokaler `db reset` reproduziert Production nicht.** Die Default-Privilegien in `public` sind live enger (`Dxtm`) als im Repo deklariert (`grant all`); lokal erhält `authenticated` auf neuen Tabellen daher **mehr** Rechte als live. Privilegienaussagen müssen gegen Production geprüft werden, nicht nur lokal. Offener Folgebefund (`configuration`, `google_calendar_connections`, `google_calendar_events` sowie die Repo-/Production-Drift der Default-Privilegien): `17-known-issues-and-planned-waves.md` „Default-Privilegien im Schema `public` vergeben TRUNCATE an API-Rollen".

## 6b. PWA-Status (Stand 2026-09-01, nach PWA-1B/1C und Update State Contract V2)

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
- **Recovery-Zustand**, falls die Übernahme ausbleibt (Semantik seit PWA-1C.2 korrigiert, siehe unten).
- Neue `--nora-system-*`-Tokens für Surface, Hairline, Schatten, Aura und Warnfarben (hell/dunkel getrennt).

Details: `02-design-system.md`, Abschnitt „Anwendungs-Systemereignisse / Update-Experience"; Begründung: `06-decision-log.md`, „2026-08-30 – Premium Update Experience und 8-Sekunden-Choreografie (PWA-1C.1)".

**Seit PWA-1C.2 (lokal implementiert und verifiziert, noch kein Production-Release):** technische Korrektur aus dem Final Review des ersten RC. Der Recovery-Pfad hing am Promise von `updateServiceWorker()` — der ausgelieferte `vite-plugin-pwa`-Client lehnt das aber praktisch nie ab, wodurch Recovery in Production unerreichbar war und der reale Fall „Anfrage raus, Übernahme kommt nie" Nora dauerhaft auf „wird aktualisiert" stehen gelassen hätte. Neu:

- `pwaUpdateStore` trennt `applying` (**angefordert**) von `activated` (**vollzogen**, aus `controllerchange`). Nirgendwo gilt noch „Promise resolved = aktiviert".
- **Watchdog von 5 s ab `applyUpdate()`** (die acht Sekunden zählen nicht mit), Wert empirisch begründet: gemessene Übernahme 2–3 ms normal, max. 34 ms bei 20× CPU-Drosselung.
- **Nora besitzt den Reload.** Zweiter Befund aus der Reparatur: nach `SKIP_WAITING` übernimmt der neue Worker zwar (`controllerchange` feuert genau einmal, alter Precache wird aufgeräumt), aber der Client von `vite-plugin-pwa` lädt die Seite **nicht** neu — er tut das nur bei „internen" Funden, und Noras stündliche bzw. tabbasierte Prüfung zählt für Workbox nicht dazu. Am Code vor der Korrektur identisch gemessen. Nora lädt deshalb 1,5 s nach der Übernahme selbst neu, falls die Seite dann noch steht.
- Recovery-Copy ohne Fehlerbehauptung: „Aktualisierung dauert länger als erwartet". Aktion nach echtem Worker-Zustand: „Erneut versuchen" bzw. „Nora neu laden". Kein „Später" — SKIP_WAITING ist gesendet, ein Zurück wäre nicht zusicherbar.
- A11y: sichtbare Fläche `role="group"` **ohne** Live-Semantik plus eigener `sr-only`-Announcer (genau eine Ansage pro Zustandswechsel); Fokus fällt nach der Primäraktion nicht mehr auf `<body>`.

Begründung: `06-decision-log.md`, „2026-08-30 – Aktivierungsanfrage ist kein Erfolgssignal: Watchdog statt Promise (PWA-1C.2)".

**Nachtrag PWA-1C.2 (Closure, lokal implementiert und verifiziert, noch kein Production-Release):** der Delta Final Review des Fix-RC `6718d772` hat zwei eingeführte Defekte belegt und den RC abgelehnt. Beide sind geschlossen:

- **BLOCKER — „Erneut versuchen" war wirkungslos.** `applyUpdate()` sperrt auf `applying`, und `applying` fiel auf dem Watchdog-Pfad nie wieder auf `false`. Der Retry spielte acht Sekunden Choreografie ab und schickte **kein** zweites SKIP_WAITING. Neu: `endStalledActivation()` beendet beim Ablauf des Watchdogs genau den einen steckengebliebenen Versuch — kein `reset()`, `needRefresh`, Registration, wartender Worker, Listener und Callbacks bleiben unangetastet. Nur wenn wirklich noch ein Worker wartet; sonst bleibt es beim Reload-Ausweg. Doppelklickschutz während eines laufenden Versuchs unverändert.
- **MEDIUM — Fokusdiebstahl 13 Sekunden nach dem Klick.** Der Fokus-Besitz wird jetzt laufend geführt statt einmal beim Klick gemessen (siehe `02-design-system.md`, „Fokus").
- **LOW — Testlücke.** Der Test, dessen Titel eine vollständige neue Sequenz behauptete, prüfte sie nicht; die Fakes lieferten `registration === undefined`, wodurch Recovery-Variante A in der gesamten Suite unerreichbar war. Fakes und DEV-Harness haben jetzt eine realistische Registration mit umschaltbarem `waiting`.

**Nachtrag PWA-1C.3 (lokal implementiert und verifiziert, noch kein Production-Release):** der Last Delta Review des Closure-RC `2861a602` hat einen MEDIUM belegt und den RC abgelehnt. Geschlossen:

- **MEDIUM — bestätigte Übernahme wurde vom Retry-Commit verworfen.** `applyUpdate()` setzte `activated = false`; traf die Übernahme während einer laufenden Retry-Choreografie ein, löschte deren Commit sie wieder, schickte ein zweites SKIP_WAITING ins Leere und ließ Nora in ein falsches Recovery laufen — der Nora-eigene Reload feuerte nie. Neu: `activated` ist innerhalb einer Dokument-Lebensdauer **monoton**, und `applyUpdate()` ist bei bestätigter Übernahme ein No-op. Gemessen: `activated` bleibt `true`, Anfragen bleiben bei 1, genau ein Reload.
- **LOW — Testtreue.** Der Test für genau diesen Fall arbeitete mit einem `vi.fn()`-No-op und einem harness-lokalen `activated` und sprang mit einem `advance()` über Commit und Watchdog; er konnte den Konflikt nicht sehen. Ersetzt durch getrennte Schritte, gezählte `applyUpdate`-Aufrufe und einen Regressionstest gegen den echten Store.

Begründung: `06-decision-log.md`, „2026-08-30 – Eine bestätigte Übernahme ist endgültig: `activated` ist monoton (PWA-1C.3)".

**Status PWA-1C.1/1C.2/1C.3: `LOCAL VERIFIED + PRODUCT OWNER UX ACCEPTED — DREI RCs ABGELEHNT, RACE-FIX LOKAL VERIFIZIERT, NEUER RC OFFEN — NICHT PRODUCTION VERIFIED`.**

- **UX abgenommen:** die visuelle Fassung aus PWA-1C.1 ist vom Product Owner akzeptiert. Orb, Aura, Warnsymbol, Panelkomposition, Timeline und Art Direction wurden in PWA-1C.2 **nicht** angefasst.
- **Erster RC `0329c0ae` abgelehnt** (Final Adversarial Review, 2026-08-30): 0 BLOCKER, 0 HIGH, 1 MEDIUM (Recovery-Contract), mehrere LOW. Der Review hat u. a. den Zwei-Build-Lifecycle, den generierten `sw.js`, die Dev-Harness-Freiheit des Production-Builds und die Choreografie-Grenze unabhängig bestätigt.
- **Dritter RC `2861a602` abgelehnt** (Last Delta Review, 2026-08-30): 1 MEDIUM (bestätigte Übernahme vom Retry-Commit verworfen), 1 LOW (Testtreue), NOTES. Der Review hat den echten Retry (Anfragen 1 → 2), den wiederholten Retry, den Doppelklick-Guard, den Fokus-Besitz, das Listener-Cleanup, den Worker-verschwindet-Race, die Production-Freiheit des DEV-Harness und den Retry gegen den echten Service Worker unabhängig bestätigt.
- **Zweiter RC `6718d772` abgelehnt** (Delta Final Review, 2026-08-30): 1 BLOCKER (wirkungsloses „Erneut versuchen"), 1 MEDIUM (Fokusdiebstahl), 1 LOW (Testlücke). Der Review hat den Watchdog, das `activated`-Signal (gegen echtes `sw.js`: `controllerchange` genau einmal, 5 ms) und die Notwendigkeit des Nora-eigenen Reloads unabhängig bestätigt. Die visuelle Regressionsabnahme desselben RC war zuvor angenommen worden; Variante A war dort nicht reproduzierbar — genau dort saß der BLOCKER.
- **In der gestylten App nachgemessen** (Stand PWA-1C.1): Viewport-Matrix 1024/1180/1280/1440/1920 plus die Zoom-Äquivalente 1152 (125 %) und 960 (150 %) und Mobile 390/430/500, jeweils hell und dunkel — alle passen in den Viewport, kein horizontaler Overflow, Orb-Abweichung von der Panelmitte 0,0 px; Touch-Ziele 44 px Desktop / 46,8 px Mobile; Reduced Motion in echtem Chromium; Dialog-Deferral gegen einen echten Radix-Dialog (0 von 10 Dialog-Controls blockiert); die vollständige Achtsekundensequenz als Bildfolge und Messreihe.
- **Kontrast:** alle Texte in der Panelfläche ≥ 4,5, alle Grafiken ≥ 3,0 in beiden Modi — **mit einer Ausnahme:** die Primäraktion liegt bei 3,56 (Weiß auf `--nora-brand`). Das ist die projektweite `.nora-primary-action` (identisch am bestehenden Header-Button gemessen), bewusst nicht lokal umgefärbt. Siehe `02-design-system.md` und `17-known-issues-and-planned-waves.md`.
- **Kein Production-Deployment.**

**Offene Product-Frage aus dieser Welle:** ob die Achtsekundendauer bei `prefers-reduced-motion: reduce` gekürzt werden soll (Empfehlung: ja, auf ~2,5 s). Bewusst nicht eigenmächtig umgesetzt — siehe Decision Log. PWA-1C.2 hat daran nichts geändert.

**PWA Update State Contract V2 (2026-09-01) — `PWA UPDATE STATE CONTRACT V2 — LOCAL VERIFIED / RC`, nicht Production Verified.** Anlass: die PWA-Wellen 1B–1C.3 sind mit dem Kanban-Release `fe962c58` auf nora.ergart.de gegangen (Happy Path live bestätigt, siehe Decision Log), und der Product Owner sah dort trotzdem den Recovery-Zustand „Aktualisierung dauert länger als erwartet … Sie können weiterarbeiten" mit „Nora neu laden". Eine Read-only-Diagnose (Zwei-Build-Repro in Chromium, TYPE D) hat die Ursache belegt: **`onNeedRefresh` ist nur ein Entdeckungssignal, kein wartender Worker.** In einem **unkontrollierten Dokument** (`navigator.serviceWorker.controller === null`: Erstbesuch, Hard Reload, gelöschte Site-Daten — ohne `clients.claim()` bleibt es das den ganzen Tag) aktiviert sich der neu gefundene Worker 2 ms nach `installed` selbst, `registration.waiting` wird null, SKIP_WAITING geht ins Leere, `controllerchange` kommt nie — und Nora deutete das nach 13 s als Fehlschlag, obwohl die neue Version längst aktiv war. Behoben, ohne `clients.claim()` und ohne Änderung des production-bewiesenen Happy Path:

- **Browser-Fakten sind die Wahrheit.** `pwaUpdateStore.syncFacts()` liest Controller, `registration.waiting/installing/active` an jedem Entscheidungspunkt (Registrierung, `onNeedRefresh`, vor `applyUpdate()`, `controllerchange`, Watchdog, Tab-Rückkehr) und hängt sich an `statechange`/`updatefound` — kein Polling.
- **Neuer Zustand `reloadRequired`** (Invariante: `activated ∨ (entdeckt ∧ ¬waiting ∧ ¬installing ∧ (¬controlled ∨ active ≠ controller))` — bewusst nicht `waiting === null` allein). `applyUpdate()` sendet nur noch mit wartendem Worker und antwortet sonst `reloadRequired`/`activated`/`noop`; `failed` gilt nur bei positivem Beweis (abgelehnte Anfrage).
- **Watchdog (5 s, unverändert) ist kein Fehlerkriterium**: er liest die Fakten und teilt in `slow` (Worker wartet → genau ein stiller zweiter Versuch, nach der zweiten Frist Reload-Angebot), `reloadRequired` (Nora lädt nach dem Commit selbst neu) oder `failed`. Der Sammelzustand „Recovery" existiert nicht mehr.
- **Multi-Tab:** Aktivierung aus einem anderen Tab (oder stiller Faktenwechsel) korrigiert die Fläche auf „Neue Version bereit"; ein Klick startet keine acht Sekunden Schein-Choreografie mehr.
- **Presentation Contract V2** (`available · applying · slow · reloadRequired · failed`, siehe `02-design-system.md`): Warnsymbol, Warnbox, `--nora-system-warning*` und der erklärende Absatz sind entfernt; Copy „Neue Nora-Version verfügbar" / „Nora wird aktualisiert" / „Gleich bereit …" / „Neue Version bereit" / „Aktualisierung gerade nicht möglich", eine Speicherzeile, eine Primäraktion. `NoraSafetyMark.tsx` gelöscht. DEV-Harness hat den Schalter „Dokument kontrolliert".
- **Tests:** Store, Hook und Komponente gegen den echten Store mit Browser-Fakten-Attrappen (Controller, Worker als `EventTarget`s); Matrix aus der Diagnose (unkontrolliert, Klick vor dem Übergang, fremde Aktivierung, Übernahme kurz vor/nach der Frist, echter Fehler, StrictMode, Timer-Cleanup).
- **Nicht Teil dieser Welle:** der globale Nora-Loader (siehe `17-known-issues-and-planned-waves.md`, „Nora Loading Motion System"), die Reduced-Motion-Dauer, der Kontrast der Primäraktion.

**Unabhängiger finaler technischer Review (2026-09-01):** `PWA UPDATE STATE CONTRACT V2 TECHNICALLY APPROVED — FREEZE STATE CONTRACT` (0 BLOCKER / 0 HIGH / 0 MEDIUM; Zwei-Build-Flows kontrolliert, unkontrolliert, Fremdaktivierung und „Worker wartet weiter" im Browser bestätigt). Der State Contract ist damit eingefroren.

**PWA Visual Polish 2 (2026-09-01) — `PWA VISUAL POLISH 2 RC VERIFIED — READY FOR PRODUCT OWNER ACCEPTANCE`, reine Präsentationswelle auf `polish/nora-pwa-update-visual-v2`.** Store, Registrierung, Hooks und Service-Worker-Erzeugung byteweise unverändert. Sichtbar: 30-rem-Fläche mit flachem Material, kleinerer Orb mit dünnem Orbital-Ring als PWA-lokaler Lade-Bewegung (Bogen beim Aktualisieren, langsamer Bogen bei „Gleich bereit", geschlossener Ring bei „Neue Version bereit", gedämpfter Orb im Fehlerfall), eine Nebenzeile, eine Primäraktion. **UX-1 behoben:** „Gleich bereit" bietet keinen Reload und keinen Reparaturtipp mehr — nach der zweiten Frist nur ein leises „Weiterarbeiten" (derselbe Verschiebe-Pfad wie „Später"). Copy: `reload_hint` „Offene Eingaben vor dem Neuladen kurz speichern." Die in V2 verlorenen Doku-Abschnitte in `02-design-system.md` sind wiederhergestellt. Nächster Schritt: Product-Owner-Sichtabnahme (Screenshot-Satz hell/dunkel/800 px/Reduced Motion liegt vor), danach Production-Release.

**PWA Completion Acknowledgement (2026-09-01) — `PWA COMPLETION ACKNOWLEDGEMENT RC — LOCAL VERIFIED`, kleine UX-/Presentation-Welle auf `feat/nora-pwa-update-success-ack` (Basis `0e505456`).** Nach einem erfolgreichen Update bestätigt die **frisch geladene** Version genau einmal „Aktualisierung abgeschlossen / Nora ist bereit." — grün (Orb, Ring, Haken, Titel über `--nora-success`-Tokens), ohne Aktion, Auto-Dismiss nach 6 s, Reduced Motion sauber. Transport über den Reload: ein `sessionStorage`-Bit (`pwa/pwaUpdateCompletion.ts`), geschrieben nur bei `controllerchange` im Store (synchron, vor dem Workbox-Reload) und bei Noras eigenem Reload (Fallback nach Commit, „Nora neu laden"); nie bei `failed`/`slow`/„Später"/F5. State Contract V2 unverändert (eine Nebenwirkungszeile im Store, `useUpdateChoreography.ts` byteweise gleich). Details: `02-design-system.md` „Abschlussbestätigung", Decision Log „2026-09-01 – PWA Completion Acknowledgement". Nicht gepusht, nicht deployed; Product-Owner-Sichtabnahme offen.

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
11. User-Lifecycle-Folgewellen: ~~W3 Audit-Actor~~ (PRODUCTION VERIFIED 2026-09-06, siehe Abschnitt 4 Punkt 27), ~~W4 E-Mail-Änderung~~ (PRODUCTION VERIFIED 2026-09-06, siehe Abschnitt 4 Punkt 28), ~~W5 Session-Revokation / Offboarding / Abhängigkeits-Preview~~ (PRODUCTION VERIFIED 2026-09-06, siehe Abschnitt 4 Punkt 29), W6 Hard-Delete-Executor (die Datenbankbarriere aus W2 steht; die Preview zählt jetzt die sechs Referenzen), W9 SQL-Suiten in CI.

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
| **Mitarbeiter-Onboarding & Zugang (Einladung → Passwort → Profil → Abschluss, Admin-Zugangsstatus)** | `02-design-system.md` „Mitarbeiter-Onboarding & Zugang (Welle V1B)" (Gestaltung) + `06-decision-log.md` „2026-09-04 – Employee Onboarding & Access V1A" (Contract) und „… V1B" (Präsentation) + `login/employeeOnboardingFlow.ts` (Zustandsmaschine) |
| **Mitarbeiter-Lebenszyklus (Executor, Selbst-/Letzter-Admin-Schutz, Referenzintegrität, `sales_directory` vs. `sales_identities`, Lösch-Modell, Archivierungsprinzip)** | `06-decision-log.md` „User Lifecycle W1" + „User Lifecycle W2" (Begründung) + `03-data-model-guardrails.md` „Mitarbeiter-Referenzintegrität" / Falle 39 + `07-agent-change-checklist.md` W1/W2-Bullets |
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
