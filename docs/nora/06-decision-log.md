# 06 – Decision Log Nora CRM

Dieses Dokument hält **durable Entscheidungen** fest: Architektur- und Produktregeln, die ein künftiger Agent kennen muss, um keine falsche Entscheidung zu treffen — jeweils mit Datum, Kontext, Entscheidung und Begründung, bewusst knapp.

**Was hier nicht mehr steht:** RC-SHAs, Migrations-Hashes, Testzahlen, Ledger-Korrekturen, Vercel-Deployments, Live-Smokes, Release-Reihenfolgen, Zwischenfälle. Diese Release-Evidenz liegt **unverändert im Originalwortlaut** im Release-Archiv (`releases/2026-06.md` … `releases/2026-09.md`, Index in `releases/README.md`). Jeder Eintrag unten verlinkt seinen Archiv-Originaleintrag („Archiv"). Die Dokumentationsarchitektur-Härtung vom 2026-09-06 hat diese Trennung eingeführt; der vorherige Stand dieser Datei ist über Git (`96fb1082`) und das Archiv vollständig rekonstruierbar.

Aktueller Zustand: `16-current-state.md`. Lifecycle-Architektur: `19-user-lifecycle-architecture.md`. Offene Punkte: `17-known-issues-and-planned-waves.md`.

**Neue Entscheidungen:** Datum, Kontext, Entscheidung, Begründung — hier knapp; Release-Evidenz in `releases/<jahr-monat>.md`; Eintrag in der Index-Tabelle unten ergänzen.

## Index (thematisch, neueste zuerst)

| Bereich | Entscheidung |
|---|---|
| Mitarbeiter-Lifecycle | [W6-B Kontrollierter Hard Delete](#2026-09-07--user-lifecycle-w6-b-kontrollierter-hard-delete-benutzerkonto-endgültig-löschen) · [W6-A Session-Autorisierung fail-closed](#2026-09-06--user-lifecycle-w6-a-session-autorisierung-fail-closed-und-owner-gebunden) · [W5 Offboarding & Sitzungen](#2026-09-06--user-lifecycle-w5-kontrolliertes-offboarding-session-revokation-abhängigkeits-preview) · [W4 Anmeldeadresse](#2026-09-06--user-lifecycle-w4-kontrollierte-änderung-der-anmeldeadresse-login-identität) · [W3 Audit-Actor](#2026-09-05--user-lifecycle-w3-der-echte-administrator-steht-im-audit-der-mitarbeiter-hat-eine-stabile-audit-identität) · [W2 Referenzintegrität](#2026-09-05--user-lifecycle-w2-referenzintegrität-und-historische-identität) · [W1 Executor](#2026-09-05--user-lifecycle-w1-ein-privilegierter-executor-selbst-letzter-admin-schutz-zugangskonsistenz) · [V1B Präsentation](#2026-09-04--employee-onboarding--access-v1b-präsentation-über-dem-eingefrorenen-v1a-contract) · [V1A Zugangsstatus](#2026-09-04--employee-onboarding--access-v1a-zugangsstatus-wird-abgeleitet-nicht-gespeichert) · [Mitarbeiterzugang einladungsbasiert](#2026-07-23--mitarbeiterzugang-öffentliches-redesign-und-einladung) |
| E-Mail-Zustellung | [V1C-B Zustellstatus-UI](#2026-09-04--employee-access-v1c-b-zustellstatus-wird-gezeigt-die-mailart-nicht) · [V1C-A Best-Effort-Korrelation](#2026-09-04--employee-access-v1c-a-zustellbeobachtung-ist-best-effort-korrelation-kein-öffnungs-tracking) |
| Security / Privilegien | [W8-C S4 Backfill der Bestandsanhänge](#2026-09-20--w8-c-s4-der-bestand-wird-nachprojiziert--eine-datenoperation-kein-neuer-vertrag) · [W8-C S3B Projektion der Notiz-Anhänge](#2026-09-19--w8-c-s3b-die-datenbank-projiziert-notiz-anhänge-selbst-als-minimale-differenz-gegen-die-tatsächlichen-zeilen) · [W8-C S3A Serialisierung je Objektschlüssel](#2026-09-19--w8-c-s3a-wer-eine-datei-referenziert-und-wer-über-ihre-löschung-entscheidet-wartet-auf-denselben-schlüssel) · [W8-C S2A2.2 Ausführungsvertrag der Warteschlange](#2026-09-18--w8-c-s2a22-die-warteschlange-bekommt-einen-ausführungsvertrag-aber-keinen-ausführenden) · [W8-C S2A2.1 Liveness-Resolver](#2026-09-18--w8-c-s2a21-ob-eine-datei-noch-gebraucht-wird-ist-eine-beobachtung-keine-erlaubnis) · [W8-C S2A1 Lösch-Erfassung](#2026-09-17--w8-c-s2a1-die-absicht-zu-löschen-wird-erfasst-bevor-irgendetwas-löschen-darf) · [W8-C S1 Attachment-Fundament](#2026-09-16--w8-c-s1-das-attachment-fundament-entsteht-als-leeres-schema-vor-jeder-anbindung) · [W8-B Attachment Hardening](#2026-09-15--w8-b-anhänge-werden-sofort-gehärtet-bevor-das-attachment-fundament-gebaut-wird) · [Global Security & Access Owner](#2026-09-10--global-security--access-erhält-einen-eigenen-current-contract) · [Wave 1 Default-Privilegien & Zielmatrix](#2026-09-07--security-hardening-wave-1-default-privilegien-des-public-schemas-und-explizite-zielmatrix) · [Wave 0 TRUNCATE](#2026-09-04--security-hardening-wave-0-truncate-auf-audit_events-entzogen) · [Residual Advisor Closure](#2026-08-28--residual-security-advisor-closure) · [Privilegierte Read-Views](#2026-08-28--intentional-privileged-read-views-init_state--sales_directory) · [RBAC-Abschluss v0.4b.2](#2026-07-14--v04b2-rbac-abschluss-capability-parallel-admin-sales_directory) · [RBAC-Hardening v0.4b.1](#2026-07-14--v04b1-rbac-migrations--und-function-hardening) · [RBAC/RLS v0.4b](#2026-07-14--v04b-rbac--und-rls-härtung) · [Rollenbewusste UX v0.3k](#2026-07-14--v03k-rollenbewusste-ux-ladezustände-und-fehlertoleranz) |
| PWA | [Contract Ownership (CR5)](#2026-09-11--pwa-contract-ownership-cr5-eigener-current-owner-für-service-worker-und-update-lifecycle) · [Update-Lifecycle 1B–V2 (konsolidiert)](#2026-08-30--2026-09-01--pwa-update-lifecycle-wartender-worker-browser-fakten-systemereignis) |
| Kunden / Kontakte / Vorgänge | [W7-R1B Jeder Vorgang gehört genau einem Kunden](#2026-09-13--w7-r1b-jeder-vorgang-gehört-genau-einem-kunden) · [Mobile Vorgang-Details: nur Show](#2026-09-13--mobile-vorgang-details-nur-die-show-fläche) · [Atomic Contact Primary Intent](#2026-09-08--atomic-contact-primary-intent-hauptansprechpartner-ist-eine-geschäftstransition-kein-spaltenschreibvorgang) · [Customer Create Speed & Clarity](#2026-09-01--customer-create-speed--clarity-land-ausgeblendet-bundesland-nrw-weitere-angaben-eingeklappt) · [Kanban Navigation Rail](#2026-08-30--vorgänge-kanban-navigation-rail) · [Kontakterstellung UI-Polish](#2026-08-28--kontakterstellung-ui-polish) · [Pre-Production Hardening](#2026-08-27--pre-production-hardening-patch) · [Self Contact Wave](#2026-08-26--self-contact-wave) · [Unified Tasks Wave](#2026-08-25--unified-tasks-wave) · [Customer & Contact Workflow Wave](#2026-08-25--customer--contact-workflow-wave) |
| Work / Arbeitskorb | [Universal Work Model v1](#2026-09-21--universal-work-model-v1-work-ist-ein-vertrag-über-bestehenden-trägern-kein-neues-datenmodell) |
| Operationen / Fehler / Feedback | [Notification Presentation Contract 7A/7B](#2026-08-29--notification-presentation-contract-v1-phase-7a) · [Operation Status Contract v1](#2026-08-29--operation-status-contract-wave-v1-createquickcapturecase-slice) · [Idempotency Wave](#2026-08-29--idempotency-wave) · [Error Contract Wave](#2026-08-28--error-contract-wave) · [Error Observatory (FW3)](#2026-08-10--foundation-wave-3-error-observatory-core) · [Operation Manager (FW2)](#2026-08-10--foundation-wave-2-operation-manager--catalog) · [Operation Correlation (FW1)](#2026-08-10--foundation-wave-1-operation-correlation) · [Portal-Form-Owner (Gates 2/2b)](#2026-08-10--stabilization-gates-22b-form-owner-im-radix-portal) |
| Performance / Build / Test | [E2E-Testisolation](#2026-09-14--e2e-testisolation-tests-respektieren-dieselben-security--und-lifecycle-grenzen-wie-die-anwendung) · [Visualizer Production Exclusion](#2026-09-09--visualizer-production-exclusion-diagnoseartefakte-gehören-nicht-in-den-production-build) · [Kernindizes und Bundle-Budget](#2026-08-15--kernindizes-und-bundle-budget) · [Migrationsregel: View-Spalten ans Ende](#2026-08-25--erste-lokale-postgres-verifikation-der-customer--contact-workflow-migration) · [Release-Gates ohne Remote-Deploy aus CI](#2026-07-17--v04c2c-release-gates-und-deployment-bereinigung) |
| Audit / Historie | [CRM-Audit v0.3l](#2026-07-15--v03l-vollständiger-crm-audit-verlauf) · [Checklisten/Audit-Datenmodell 7b](#2026-06-28--welle-7b-checklisten--textbaustein--und-audit-datenmodell-spezifiziert) |
| Google Kalender | [OAuth & Sync v0.4c.2](#2026-07-16--v04c2-google-oauth-token-verschlüsselung-manueller-sync) · [Read-only-Grundlage v0.4c.1](#2026-07-16--v04c1-google-kalender-read-only-grundlage) · [Architektur & Rollenmodell v0.4a](#2026-07-14--v04a-google-kalender-architektur-und-nora-rollenmodell-spezifiziert) |
| Fachliches Fundament | [Schnellerfassung UX v0.3g](#2026-07-14--v03g-schnellerfassung-ux-überarbeitung) · [Dubletten v0.3f](#2026-06-28--v03f-intelligente-dubletten-vorschläge) · [Schnellerfassung v0.3e](#2026-06-28--v03e-schnellerfassung--eingangszentrale) · [Hotboard v0.3b](#2026-06-28--v03b-hotboard--operative-startübersicht) · [Globale Suche 6d](#2026-06-28--welle-6d-globale-suche-im-header) · [Fensterauftrag 7a](#2026-06-28--welle-7a-fensterauftrag-prozess-spezifiziert) · [Nummern 6c](#2026-06-28--welle-6c-kundennummern-und-vorgangsnummern-implementiert) · [Nachfassen 5](#2026-06-28--welle-5-vorgangsworkflow-ohne-db-änderung) · [Typografie 4](#2026-06-28--welle-4-typografie-und-comfortable-density) · [Basisentscheidungen 2026-06-28](#2026-06-28--basisentscheidungen-atomic-crm-resource-namen-vorgänge-brandfarbe-eur-demo-daten) |

Nur im Archiv (reine Release-Historie, keine eigene durable Regel): siehe Tabelle „Nur archivierte Einträge" am Ende.

---

## 2026-09-21 – Universal Work Model v1: Work ist ein Vertrag über bestehenden Trägern, kein neues Datenmodell

**Status:** `FROZEN` — Domain Freeze 2026-09-21, unabhängiger Architecture Review mit **DOMAIN FREEZE PASS** und **W-A GO**. **Keine Migration, kein Code, keine Production-Änderung, keine Release-Evidenz** — diese Welle ist eine reine Domainentscheidung; die erste Umsetzungswelle **W-A** ist freigegeben, aber nicht begonnen. Contract: [`25`](25-universal-work-model.md) (vollständig; Decision Matrix dort Abschnitt 24, spätere Gates Abschnitt 23). Invarianten: [`03`](03-data-model-guardrails.md) §1.8, §2.2, §3.1, §5. Security: [`22`](22-security-and-access.md). Audit: [`13`](13-crm-audit-retention.md).

**Kontext.** Nora soll eine operative Arbeitsoberfläche bekommen, auf der ein Mitarbeiter sieht, was zu tun ist, wem es gehört und was fällig ist. Das Hotboard liefert das heute nicht: es liest Aufgaben über rohes CRUD, filtert „meine Aufgaben" clientseitig aus einem `localStorage`-Cache (mit stillem Fallback, der bei fehlender Identität **alle** Tasks als eigene zeigt) und rechnet Überfälligkeit in der Browser-Zeitzone. Vor jeder Implementierung war zu klären, was „Arbeit" in Nora überhaupt ist, welche Tabelle sie tragen darf und wer als Akteur gilt. Die naheliegende Antwort — eine Universal-Tabelle `work_items` mit `entity_type`/`entity_id` — wäre genau das polymorphe Modell, das Nora bei den Anhängen bereits wegen fehlender FK-Integrität abgelehnt hat.

**Entscheidungen.**

1. **Work ist ein Domain- und Application-Vertrag über bestehenden Trägern, keine Universal-Tabelle.** Keine `public.work_items`, kein polymorphes `entity_type`/`entity_id`. Begründung: kein Befund verlangt eine Universal-Entity, und die polymorphe Variante ist in Nora bereits präzedenzhaft abgelehnt ([`03`](03-data-model-guardrails.md) §1.8). Der **Arbeitskorb** ist Read Model und Oberfläche — nie eine eigene Wahrheit, nie eine eigene Persistenz.
2. **`public.tasks` ist der einzige Work Carrier in v1.** Ein Träger qualifiziert sich nur, wenn er Handlung, Halter, Fälligkeit und Abschluss **speichern** kann; „man könnte eine Spalte anlegen" zählt nicht. `tasks` ist der einzige Kandidat, der Halter **und** Fälligkeit mit echten Spalten trägt und dessen Halter dieselbe Identität führt wie der Rest der Domäne (`sales.id`).
3. **Checklisten sind kein Work Carrier.** `checklist_run_items` hat keine Halter- und keine Fälligkeitsspalte; `checklist_runs` führt `started_by`/`completed_by` als Provenienz (`uuid`, nicht `sales.id`) und ebenfalls keine Fälligkeit. Sie bleiben fachlicher Kontext und Fortschritt am Vorgang. Zusätzlich bestätigend: 24 pflichtige ungeprüfte Punkte gegenüber 11 offenen Aufgaben hätten am ersten Tag 69 % der Arbeitskorbzeilen gestellt. Der **Lauf** bleibt als künftiger Kandidat protokolliert (Gate G-6) — er ist auf der Lifecycle-Achse sogar stärker als `tasks`, ihm fehlen genau Halter und Fälligkeit.
4. **Carrier Capability und Row Validity sind zwei Ebenen und werden nie vermischt.** Dass ein Träger ein Feld tragen *kann*, sagt nichts darüber, ob eine *einzelne Zeile* ein gültiger Work-Gegenstand ist. Belegt: das Schema erzwingt die fachlichen Mindestbedingungen nicht (`text`, `type`, `due_date`, `sales_id` alle nullable), die Durchsetzung liegt im Formular — und ein zweiter ausgelieferter Schreibpfad (`useImportFromJson.ts`) umgeht es bereits. Der Contract führt deshalb `validity = valid | incomplete` mit `invalid_reason = missing_title` als geschlossenem Vokabular mit genau einem Wert. Eine unvollständige Zeile **verschwindet nicht still**, wird aber auch nicht als gültige Work-Zeile ausgegeben und **nie clientseitig repariert**.
5. **`due_at` ist nullable, und das ist ein gültiger Zustand.** Der Work-Abgrenzungstest fragt nach der **Ausdrucksfähigkeit** einer Fälligkeit, nicht nach ihrer Pflicht. Arbeit ohne Termin ist vollständige Arbeit.
6. **`due_precision` (`day | instant | unknown`) hat pro Wert eine definierte Wirkung.** Bei `day` und `unknown` gilt die Geschäftstagsregel; bei `instant` ist `overdue := due_at < now()`, sodass `due_today` und `overdue` gleichzeitig wahr sein können — `due_today` beschreibt den Kalendertag, `overdue` das Überschreiten der Frist. Begründung: ein Diskriminator ohne beobachtbare Wirkung ist ein Contract-Defekt. Alle Vergleiche laufen serverseitig in `Europe/Berlin`. **Jede Uhrzeit-Heuristik ist verboten** — insbesondere darf `00:00 UTC` (= 02:00 Berlin) nicht als Tagesabsicht gelesen werden, obwohl genau drei Bestandszeilen aus `create_quick_capture_task(p_due_date date)` so aussehen: das hieße Absicht erfinden, wo keine gespeichert ist. `public.tasks` kann die Absicht nicht halten, also liefert W-A für **jede** Zeile `unknown` — dieselbe Tri-State-Ehrlichkeit wie `liveness` und `mail_kind`.
7. **Lifecycle v1 hat genau zwei Zustände: `open` und `done`.** `deferred`/Wiedervorlage ist als Zielsemantik eingefroren — `actionable` wird abgeleitet (`open`, oder `deferred` mit erreichtem `reappear_at`), **kein Cron, kein Worker, kein Trigger** schreibt den Zustand zurück ([`03`](03-data-model-guardrails.md) §5 Falle 35). Die Persistenz dafür fehlt jedoch und kommt erst mit einer trägerspezifischen Migration (Gate G-1). **`cancel` ist nicht in v1**, und die Abbildung `cancel → done_date` ist **verboten**: der Audit-Trigger liest `done_date NULL → NOT NULL` zwingend als `task.completed`, und `audit_events` ist append-only — das erzeugte eine dauerhaft falsche, nie korrigierbare Geschäftshistorie. `cancelled` bleibt reserviertes Wort, ist aber nicht Teil des Target Lifecycle: der Bedarf ist unbelegt (`checklist_runs.status` bietet `'cancelled'` seit der Checklisten-Welle an und **kein** Lauf nutzt ihn).
8. **`deals.expected_closing_date` und Work Due sind zwei Begriffe und bleiben getrennt.** ECD ist bereits das „Nächste Nachfassdatum" des **Vorgangs**, Work Due die Fälligkeit einer **Handlung**. Keine Synchronisation, keine Ableitung, kein gegenseitiger Ersatz — die Anwendung von [`03`](03-data-model-guardrails.md) Falle 4 auf eine neue Fläche.
9. **Der Actor stammt ausschließlich aus der authentifizierten Session** — nie aus einer Client-`actor_id`, einem `localStorage`-Wert, einem Query-Parameter oder einem MCP-Argument. Der Begriff „akteursparametrisiert" ist ersatzlos entfernt, weil er die Lesart *Actor-als-Parameter* zuließ. Ein Mitarbeiter, nach dem gefiltert wird, ist **Query Subject** mit eigener Authorization, nicht die Security Identity — Präzedenz ist `get_global_audit_events`, das die Autorisierung aus der Session zieht und `p_actor_sales_id` als reinen Filter behandelt. Der Zwei-Akteure-Test verlangt entsprechend **zwei getrennt authentifizierte Sessions**, nicht eine Session mit zwei Werten. Der heutige Hotboard-Pfad ist ausdrücklich **kein** Präzedenzfall.
10. **`context.customer = null` ist ein legitimer Domainzustand, kein Fehler und keine Ladelücke** — und **es gibt keinen Vorgangskontext in v1.** `public.tasks` hat kein `deal_id`; er wäre nur per Heuristik herstellbar, und die Evidenz spricht dagegen (6 von 11 offenen Aufgaben haben keinen erreichbaren aktiven Vorgang, `deals.contact_ids` ist `bigint[]` ohne FK-Integrität je Element). **Lieber kein Feld als ein geratenes** — eine Vermutung wird nie als maschinenlesbare Wahrheit ausgegeben. Ein echter optionaler FK bleibt Gate G-2, das die Entscheidung „Unified Tasks Wave" ausdrücklich ablösen müsste.
11. **Kein `allowed_actions`, solange kein autoritativer Command existiert.** Ein Function-Census zeigt: der einzige Task-Application-Command ist `create_quick_capture_task`; Abschluss läuft über rohes CRUD. Eingefrorene Regel: **Nora bewirbt niemals eine ausführbare Action, für die kein autoritativer Application Command existiert.** W-A publiziert das Feld deshalb nicht — und auch keine `carrier_capabilities`-Ersatzabstraktion. Wenn es kommt (Gate G-4), ist es serverseitig abgeleitet, nie gespeichert, nie autoritativ; das Command prüft alles erneut.
12. **Der Arbeitskorb liefert standardmäßig `state = open` — und darin beide Validity-Zustände.** Der allgemeine Work Contract stellt weiterhin `open` **und** `done` dar; eingeschränkt wird nur die operative Default-Query. `done` ist ausschließlich über einen **expliziten** Scope anforderbar (Parametername bewusst offen, wie RPC-Name und Signatur). Der Ausschluss erfolgt **nur über `state`, nie über `validity`**: eine offene unvollständige Zeile erscheint im Korb mit `title = null`, `invalid_reason = missing_title` und `actionable = false`. **`actionable` ist ein Ausgabefeld und niemals der Default-Filter** — es bündelt `state` und `validity`, und als Filter eingesetzt entfernte es genau die offenen `incomplete`-Zeilen und bräche die Zusage aus Entscheidung 4. Korbzugehörigkeit und Handlungsfähigkeit sind zwei verschiedene Aussagen.
13. **Team v1 = alles, was der Actor gemäß Nora-Security sehen darf.** Das ist bereits der Ist-Zustand (`Tasks select active` → `is_active_user()`, kein Owner-Scoping); es gibt keine Servicebereichsspalte an `sales` und zwei konkurrierende Bereichsvokabulare (`deals.category` vs. `checklist_runs.service_area_code`). Holder ist Domain State und **heute keine Security Boundary** — sehr wohl aber fachliche Vorbedingung. Feineres Scoping und Holder-als-Authorization sind Gates (G-8, G-7). Ebenfalls eingefroren: **`set_sales_id_default()` wird nie global geändert**, um freie Arbeit zu ermöglichen — die Funktion hängt auch an `deals`, und eine Rumpfänderung veränderte still die Vorgangsanlage.
14. **W-A wird eine serverseitige PostgreSQL Application Query / RPC, und eine minimale DB-Migration dafür ist zulässig.** Die frühere Forderung „W-A ist migrationsfrei" **entfällt**: Nora ist ein statisches SPA ohne `api/` und ohne SSR, serverseitig existieren nur Postgres und die deployten Edge Functions — die Kombination aus *serverseitig* + *keine Client-Logik* + *keine Migration* war in dieser Runtime nicht realisierbar. An ihre Stelle tritt die schärfere Grenze: **W-A verändert keine Domain-Tabelle und keine Work-Persistenz.** Erlaubt ist nur, was den read-only Contract und seine Grants herstellt — dazu gehört ein heute fehlender Resolver `auth.uid() → sales.id`. **Keine Edge Function nur zur Vermeidung einer Migration**; der Ausführungsort ist der, an dem Noras bestehende serverseitige Read-Contracts liegen. `SECURITY INVOKER` vs. `SECURITY DEFINER` wird bewusst **nicht** hier entschieden, sondern im W-A-Security-Review.
15. **W-A ist freigegeben (`W-A GO`) und nicht begonnen.** Es ist ein Architecture-/Read-Model-Proof, kein Produkt-Feature: keine Writes, kein Claiming, kein Assignment, kein `deferred`, kein `cancel`, keine Checklisten, kein Vorgangskontext, kein `allowed_actions`, kein MCP, keine Hotboard-Änderung. Der Erfolg ist an 21 objektive PASS/FAIL-Kriterien gebunden; Bestandszahlen (11 offen, 4 erledigt, 15 gesamt) sind **Testanker, keine Contract-Bestandteile**. Dass `is_unassigned` und die unvollständige Zeile mangels Bestandsdaten nur über die Vertragsform belegbar sind, ist offen ausgewiesen, nicht kaschiert.

## 2026-09-20 – W8-C S4: Der Bestand wird nachprojiziert — eine Datenoperation, kein neuer Vertrag

**Status:** `PRODUCTION VERIFIED` (Commit `6dece31a6e92aaa459b4eef511325bf1136c9fc6`, **keine Migration**, Production-Verifikation 2026-09-20). Contract: [`22`](22-security-and-access.md) Abschnitt 6.11; Invarianten: [`03`](03-data-model-guardrails.md) §1.8, Lock-Reihenfolge §3.3. Ist-Zustand: [`16`](16-current-state.md) Abschnitt „Anhänge / Storage". Offene Folgeschnitte und Gates: [`17`](17-known-issues-and-planned-waves.md) H.1. Evidenz: `releases/2026-09.md`.

**Kontext.** S3B hatte den Mechanismus ausgeliefert, aber bewusst keine historische Zeile geschrieben: Bestandsnotizen blieben unprojiziert, bis jemand ihr Anhang-Array anfasste. Damit gab es keine globale Parität zwischen Notiz-JSON und `public.attachments` — und S5 (Leseseite) hätte für unberührte Bestandsnotizen leere Anhanglisten gezeigt.

**Entscheidungen.**

1. **Der Backfill ist Operator-Werkzeug, keine Migration.** Er liegt unter `supabase/maintenance/`, nicht in `supabase/migrations/`. Begründung: eine Migration beschreibt den **Schemastand** und läuft bei jedem `db reset` erneut; eine einmalige Massenänderung an echten Zeilen ist kein Schemastand. Eine Migration hätte außerdem lokal gegen leere Entwicklungsdaten „erfolgreich" gelaufen und damit nichts bewiesen. Der Ledger bleibt bei 66.
2. **`supabase/maintenance/` wird als eigene Kategorie eingeführt — Werkzeug, das gegen echte Daten läuft und committet.** Es ist ausdrücklich **nicht** `supabase/tests/`. Die Trennung ist eine Sicherheitsgrenze: eine Datei, die schreibt, sagt das im Namen, in der ersten Zeile und im Kopf; ein Test tut es nie. Dazu gehört die Regel, dass **„read-only" nie unqualifiziert** behauptet wird — *keine durable Mutation* ist die Eigenschaft, die Production-Sicherheit begründet, *strikt SQL-read-only* die engere Aussage; eine Datei, die einen `pg_temp`-Helfer anlegt, erfüllt die erste und nicht die zweite.
3. **Eine Notiz je Invocation, atomar, neu klassifiziert unter der Sperre.** Der Runner wählt seinen Kandidaten selbst, sperrt die Notizzeile `FOR UPDATE`, liest **erst danach** das Array und entscheidet unter der Sperre: leer → abgleichen, exakt → nichts tun, alles andere → `RAISE`. Begründung: die Korpus-Aussage des Preflights ist älter als die Transaktion; nur die Neuklassifikation unter der Sperre schützt die Notiz, die gerade angefasst wird. Ein Lauf über alle Notizen in einer Transaktion hätte zudem die Live-Nutzung blockiert.
4. **Kein zweiter Abgleich, keine zweite Grammatik.** Aufgerufen wird derselbe Kern `nora_private.reconcile_note_attachments(...)` wie bei der Projektion (S3B-Entscheidung 10). Zwei Abgleiche divergieren.
5. **Der Backfill fasst das Notiz-JSON nicht an.** Kein synthetisches `UPDATE`, um die Trigger auszulösen. Begründung: ein solches `UPDATE` hätte die Audit-Spur der Notiz beschmutzt und den Backfill von Benutzerarbeit ununterscheidbar gemacht. Er schreibt ausschließlich `INSERT`s in `public.attachments` — jede Invocation belegt das selbst über die Transaktions-Schreibzähler und scheitert, wenn sie etwas anderes geschrieben hat.
6. **Ein Fehler ist ein SQL-Fehler, niemals ein Ergebniswert.** Es gibt nur `BACKFILLED`, `SKIPPED_ALREADY_EXACT` und `NO_CANDIDATE`; kein Ausgang bedeutet „ist schiefgegangen". Begründung: ein Fehler-Ergebniswert wird in einer langen Schleife übersehen. Ein abgebrochener Lauf ist ein sicherer Ruhezustand — die bereits committeten Notizen sind einzeln atomar und idempotent, werden **nie** manuell zurückgerollt, und ein späterer Lauf setzt nach einem frischen Preflight fort.
7. **Der Preflight prüft die Form seiner eigenen Auskunft, bevor er sie liest.** Der Konsistenzprüfer liefert immer alle dreizehn Klassen; der Preflight erzwingt genau diese Form, weil jeder Ausfall des Prüfers wie „nichts ist auffällig" aussieht — eine leere, gekürzte oder umbenannte Klassenliste liest sich sonst als sauberer Korpus. Ein unvollständiger Zensus ist `55000`, nie `GO`.
8. **`GO` ist nicht `GREEN`.** Der Prüfer ist erst grün, wenn **alle** zwölf blockierenden Klassen 0 sind; der Preflight lässt genau eine davon zu — die noch offenen Kandidaten, denn das ist die Arbeit. Fehlende Storage-Objekte bleiben `INFO`: Referenzkonsistenz und physische Existenz sind getrennte Verträge.
9. **Grenze von S4.** Kein Schema, keine Rechte, keine Migration, keine Zeile in `src/**`, keine Leseseite (S5), kein Rückbau des Legacy-JSON (S6), kein Worker und keine physische Löschung (S2B), keine Warteschlangen- oder Storage-Berührung. **Die erreichte globale Parität ist eine verifizierte Momentaufnahme, kein Constraint** — kein Schemaelement erzwingt sie, und die Zeilenzahl der Tabelle bleibt kein Vertragsmerkmal.
10. **S5 ist damit an seiner Datenvoraussetzung nicht mehr blockiert — und nicht begonnen.** „Datentor offen" ist kein Freigabe-Signal: S5 braucht eigenen Entwurf, eigene Review und eigenen Release.

## 2026-09-19 – W8-C S3B: Die Datenbank projiziert Notiz-Anhänge selbst, als minimale Differenz gegen die tatsächlichen Zeilen

**Status:** `PRODUCTION VERIFIED` (Laufzeit `fd5f3ad7be92adccf44f09467e10455356301431`, Migration `20260919180000_nora_attachment_note_projection`, Production-Verifikation 2026-09-19). Contract: [`22`](22-security-and-access.md) Abschnitt 6.11 (Projektion, Grammatik v1) und 6.6 (Zugriff); Invarianten: [`03`](03-data-model-guardrails.md) §1.8, Lock-Reihenfolge §3.3. Ist-Zustand: [`16`](16-current-state.md) Abschnitt „Anhänge / Storage". Offene Folgeschnitte und Gates: [`17`](17-known-issues-and-planned-waves.md) H.1. Evidenz: `releases/2026-09.md`.

**Kontext.** Nach S3A war `public.attachments` abgesichert, aber leer: die Anwendung schreibt Anhänge als JSON-Array am Notizdatensatz, und nichts bildete sie relational ab. Offen war, **wer** die Tabelle schreibt, **wogegen** abgeglichen wird und was mit den Bestandsnotizen geschieht, deren JSON teils ältere Formen trägt.

**Entscheidungen.**

1. **Projektions-Owner sind Datenbank-Trigger, nicht ein Dual-Write der Anwendung.** `AFTER INSERT`/`UPDATE`-Zeilentrigger auf `contact_notes` und `deal_notes` gleichen die Zeilen der Notiz in derselben Transaktion ab; scheitert die Projektion, scheitert der Notiz-Schreibvorgang. Begründung: ein Dual-Write hat zwei Commits oder zwei Aufrufer, die auseinanderlaufen können, und jeder weitere Schreibpfad (Import, künftige RPC, `service_role`) müsste ihn nachbauen. Der Trigger sieht jeden Schreibpfad, und JSON und Zeilen committen nie in verschiedenen Zuständen.
2. **Kein Projektions-Trigger auf `DELETE`.** Das Löschen einer Notiz läuft über den bestehenden FK-`CASCADE` und damit durch die Erfassung aus S2A1/S3A. Ein zweiter Löschpfad hätte dieselbe Zeile zweimal behandelt.
3. **Abgleich als minimale Differenz — eine Korrektheitsregel.** `ADD = D − E` wird eingefügt, `REMOVE = E − D` gelöscht, `KEEP = D ∩ E` nicht angefasst. Ein „alles löschen, alles neu einfügen" erfasste für jeden behaltenen Schlüssel ein Löschvorhaben, und das Wiedereinfügen scheiterte in derselben Transaktion an der S3A-Zulassung. `ADD` läuft in deterministischer Schlüsselreihenfolge, damit gleichzeitige Mehrfach-Einfügungen auf dem Unique-Index in gleicher Reihenfolge warten statt zu verklemmen.
4. **`E` sind die tatsächlichen Zeilen, nie das alte JSON.** Abgeglichen wird gegen das, was der Notiz in `public.attachments` wirklich gehört. Begründung: das alte JSON sagt nichts darüber, was projiziert ist — bei einer Bestandsnotiz nichts. Aus `OLD` abzuleiten hätte Teilprojektionen erzeugt und unsaubere Altdaten zur Vorbedingung gemacht; so blockiert ein unsauberes altes Array ein gültiges neues nie.
5. **First-Touch gleicht die ganze Notiz ab; ein Backfill ist das nicht.** Aus Entscheidung 4 folgt: der erste Anhang-ändernde Schreibvorgang einer Bestandsnotiz projiziert ihren **gesamten** aktuellen Anhangstand, eine reine Textänderung nichts. Jede Notiz ist entweder unprojiziert oder exakt projiziert. S3B hat bewusst keine historische Zeile geschrieben: Auslieferung des Mechanismus und Massenänderung an Bestandsdaten bleiben getrennt rücknehmbar. Die akzeptierte Lücke — ein vor dem First-Touch entfernter Bestandsanhang erzeugt kein Löschvorhaben — ist keine Verschlechterung gegenüber vorher und ein Grund, warum S4 direkt folgt.
6. **Identität ist der `storage_key`; geänderte Metadaten werden abgewiesen, nicht aktualisiert.** Nicht `src`, Titel oder Position. Zeilen sind seit S1 unveränderlich; ein stilles `UPDATE` von Titel oder Typ hätte diese Regel gebrochen, ein stilles Ignorieren JSON und Zeile auseinanderlaufen lassen.
7. **Eine zentrale Grammatik (v1), und `path` ist Pflicht.** Eine Function entscheidet, was ein Nora-Anhangverweis ist; die `src`-Prüfung delegiert an den bestehenden URL-Helfer des Resolvers statt eine zweite URL-Logik einzuführen. Ein Element ohne `path` ist kein Nora-Anhang — der frühere Import-Fallback (fremde URL als Link speichern) entfällt, weil ein Verweis ohne Objektschlüssel weder projizierbar noch je bereinigbar ist. Ein doppelter Schlüssel in einer Notiz wird abgewiesen statt dedupliziert: jede Dedupe-Regel wäre eine stille Entscheidung über Nutzerdaten. Grundlage war ein read-only Production-Zensus vor dem Apply: alle Bestandselemente erfüllten die Grammatik.
8. **Keine direkte Schreibberechtigung auf `public.attachments`, für niemanden.** Die S3A-Matrix bleibt unverändert; die Projektion schreibt über einen `SECURITY DEFINER`-Dispatcher, der den Besitzer nur aus auslösender Tabelle und `NEW.id` ableitet. Validator und Kern sind `SECURITY INVOKER`; kein API-`EXECUTE`, auch nicht für `service_role`. S3B bringt keine Netzwerk-, Storage- oder Löschfähigkeit.
9. **Die Fehlercodes werden jetzt auf die Oberfläche abgebildet.** `NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION` und `NORA_ATTACHMENT_REFERENCE_INVALID` sind mit S3B erstmals über einen Notiz-Schreibvorgang erreichbar und stehen deshalb in `NORA_ERROR_CODES`. Rein interne Codes bleiben unregistriert.
10. **S4 verwendet denselben Abgleich-Kern.** `nora_private.reconcile_note_attachments(...)` ist so geschnitten, dass der Backfill ihn unter einer Sperre der Notizzeile aufruft. Ein zweiter Algorithmus oder eine zweite Grammatik für Bestandsdaten ist ausgeschlossen — zwei Abgleiche divergieren. S5 (Leseseite) bleibt blockiert, bis S4 `PRODUCTION VERIFIED` ist. *(Diese Bedingung ist seit dem 2026-09-20 erfüllt — Eintrag „2026-09-20 – W8-C S4" oben; S5 selbst ist unverändert nicht begonnen.)*
11. **Grenze von S3B und neues S2B-Gate.** Kein Backfill (S4), keine Leseseite (S5), kein Rückbau des Legacy-JSON (S6), kein Worker und keine physische Löschung (S2B), kein Viewer. Neu als S2B-Designgate getragen: Notiz-Schreibvorgänge haben keine optimistische Nebenläufigkeitskontrolle; ein veraltetes Formular kann eine neuere Anhangliste überschreiben, und S3B erfasst dafür getreu ein Löschvorhaben. Ohne physische Löschung ist das rückholbar, mit ihr nicht mehr — S2B löst das Szenario oder trägt es mit einem sicheren Entwurf ([`17`](17-known-issues-and-planned-waves.md) H.1).

## 2026-09-19 – W8-C S3A: Wer eine Datei referenziert und wer über ihre Löschung entscheidet, wartet auf denselben Schlüssel

**Status:** `PRODUCTION VERIFIED` (Schema-Commit `5350f21655ca8d3b83819958f87fe8229d7b736b`, Migration `20260919120000_nora_attachment_reference_serialization`, Production-Verifikation 2026-09-19). Contract: [`22`](22-security-and-access.md) Abschnitt 6.10 (Serialisierung, Zulassung) und 6.6 (Zugriff, Unveränderlichkeit); Lock-Reihenfolge: [`03`](03-data-model-guardrails.md) §3.3. Ist-Zustand: [`16`](16-current-state.md) Abschnitt „Anhänge / Storage". Offene Folgeschnitte und Gates: [`17`](17-known-issues-and-planned-waves.md) H.1. Evidenz: `releases/2026-09.md`.

**Kontext.** Nach S2A2.2 waren zwei Rennen offen: LOW-1 (ein Vorhaben geht zwischen unterdrückter Erfassung und `live`-Inspektion verloren → verwaistes Objekt) und das Re-Referenzierungs-Rennen (eine Inspektion liefert `dead`, während gleichzeitig eine neue Referenz committet → ein künftiger Worker löschte eine referenzierte Datei). Beide sind lokal mit echten Sitzungen reproduziert. Der als ein Schnitt geplante „S3" (Referenzschreibung samt Dual-Write) hätte Koordination und erste Zeilen gleichzeitig ausgeliefert.

**Entscheidungen.**

1. **S3 wird geteilt: erst der Mechanismus (S3A), dann die Projektion (S3B).** S3A liefert Sperre, Zulassung, Unveränderlichkeit und die Schreibgrenze — solange `public.attachments` und die Warteschlange leer sind. Begründung: ein Mechanismus ohne Zeilen ist folgenlos und vollständig nebenläufig beweisbar; eine Projektion ohne Mechanismus schaltete LOW-1 und das Rennen mit der ersten Zeile scharf.
2. **Ein Koordinationspunkt je Objektschlüssel: eine transaktionsgebundene Advisory-Sperre.** Zulassung, Erfassung und Inspektion nehmen `pg_advisory_xact_lock(hashtext('nora_attachment_storage_key'), hashtext(key))`, dieselbe Konvention wie `nora_primary_contact`. Die Warteschlangenzeile taugt nicht als Mutex: sie existiert nicht immer, und die unterdrückte Erfassung sperrt sie nicht. Die Sperre ist ein **Integritätsmechanismus**, keine Performance-Maßnahme. Die Lock-Reihenfolge Anhangzeile → Schlüsselsperre → Warteschlangenzeile ist durable ([`03`](03-data-model-guardrails.md) §3.3).
3. **`READ COMMITTED` gehört zum Vertrag, und eine andere Isolationsstufe scheitert laut.** Das Protokoll braucht nach dem Warten einen frischen Statement-Snapshot. Unter `REPEATABLE READ` / `SERIALIZABLE` sähe die Prüfung den konkurrierenden Commit nicht; still falsch zuzulassen wäre schlimmer als abzubrechen. Production läuft ohne abweichende Einstellung mit `READ COMMITTED`.
4. **Die Zulassung weist ab — sie zieht kein Vorhaben zurück.** Aktive Vorhaben (`pending`, `claimed`, `failed_retryable`) und `done` blockieren eine neue Referenz; `skipped_live` und `failed_terminal` blockieren nicht. Der Auftrag wird nie verändert, es entsteht kein neuer Zustand. Begründung: Zustandsübergänge der Warteschlange gehören ausschließlich dem Ausführungsvertrag ([`22`](22-security-and-access.md) Abschnitt 6.7), nicht einem Referenzschreiber; `done` heißt „Objekt bestätigt entfernt", eine neue Referenz darauf zeigte ins Leere.
5. **`storage_key` ist unveränderlich; Austausch ist Löschen plus Neuanlage.** Ein Umschreiben A → B verschöbe einen Verweis an Erfassung und Zulassung vorbei. Der Wächter gilt auch für Owner- und manuelle Pfade.
6. **`public.attachments` bekommt einen datenbankeigenen Schreiber statt eines direkten API-Pfads.** `authenticated` verliert `INSERT` und `DELETE`, die beiden Schreib-Policies entfallen, `SELECT` bleibt. Ein direktes `DELETE` erfasste ein Vorhaben für einen Schlüssel, der im Notiz-JSON noch lebt; ein direktes `INSERT` schüfe Verweise, die das JSON nicht kennt. Der vorgesehene Schreiber ist die S3B-Projektion. Damit ist **Entscheidung 7 des S1-Eintrags überholt**.
7. **Keine Oberflächenabbildung des neuen Fehlercodes in S3A.** Es gibt keinen Aufrufer, der Zeilen schreibt; die Abbildung von `NORA_ATTACHMENT_STORAGE_KEY_PENDING_DELETION` gehört zu dem Schnitt, der erstmals schreibt. *Nachtrag 2026-09-19:* S3B schreibt erstmals und hat die Abbildung geliefert (Eintrag „2026-09-19 – W8-C S3B", Entscheidung 9).
8. **`claim_next()` + `inspect()` in einer Transaktion ist ein S2B-Designgate, kein S3A-Fix.** In dieser Kombination hält der Aufrufer die Warteschlangenzeile vor der Schlüsselsperre; gegen eine gleichzeitige Erfassung endet das in `40P01`. Heute ruft niemand so auf, kein Vorhaben geht verloren, die Invarianten gelten. Ein Fix in S3A hätte den Worker aus S2B vorweg entworfen. Verbindlich: S2B trennt Claim und Inspektion in eigene Transaktionen oder entwirft und beweist eine neue Reihenfolge.
9. **Grenze von S3A.** Keine Projektion aus den Notiz-Arrays, keine Validierung der Legacy-Formen, kein Backfill, keine Umschaltung der Leseseite, kein Rückbau des Legacy-Schreibpfads (S3B–S6). Kein Worker, keine Storage- oder Netzwerkfähigkeit, kein Pfad zu `done`, kein neuer Zustand, kein `service_role`-Recht, keine Änderung an Claim, Fail, Konstanten oder Resolver. Geschlossen sind LOW-1 und das Re-Referenzierungs-Rennen **nur** für zeilenbasierte `public.attachments`-Verweise. Offen bleiben die Absicherung externer Seiteneffekte und quellenübergreifend geteilte Schlüssel ([`17`](17-known-issues-and-planned-waves.md) H.1).

## 2026-09-18 – W8-C S2A2.2: Die Warteschlange bekommt einen Ausführungsvertrag, aber keinen Ausführenden

**Status:** `PRODUCTION VERIFIED` (Schema-Commit `90d051f28db3e447f389deb79d12691b92813feb`, Migration `20260918180000_nora_attachment_deletion_queue_execution`, Production-Verifikation 2026-09-18). Contract: [`22`](22-security-and-access.md) Abschnitt 6.9 (Ausführungsvertrag) und 6.7 (Zustände). Ist-Zustand: [`16`](16-current-state.md) Abschnitt „Anhänge / Storage". Offene Folgeschnitte und Gates: [`17`](17-known-issues-and-planned-waves.md) H.1. Evidenz: `releases/2026-09.md`.

**Kontext.** Nach S2A1 (Erfassung) und S2A2.1 (Beobachtung) fehlte der Warteschlange die Semantik, wie ein Auftrag beansprucht, wiederholt oder beendet wird. `17` H.1 hatte dafür eine minimale `service_role`-Ausführungs-RPC prognostiziert. Es gibt aber keinen deployten Worker, der sie aufrufen würde.

**Entscheidungen.**

1. **Der Ausführungsvertrag entsteht in der Datenbank, vor jedem Ausführenden.** Claim, Stale-Recovery, Attempt-Budget, Backoff, lease-geschütztes Inspect und Fail sind sechs Functions in `nora_private`: `SECURITY INVOKER`, Owner `postgres`, ACL nur `postgres`. Sie sind ein Vertrag, kein Worker. Begründung: Lease-, Budget- und Mapping-Semantik lassen sich in der Datenbank vollständig und nebenläufig beweisen, bevor irgendetwas außerhalb von ihr handelt.
2. **Keine `service_role`-Ausführungsgrenze in S2A2.2 — sie wird bis S2B mit echtem Aufrufer zurückgestellt.** Nach [`22`](22-security-and-access.md) Abschnitt 6.3 bekommt `service_role` ein Recht nur mit belegtem, deployten Aufrufer. Eine RPC ohne Aufrufer wäre reine Angriffsfläche. Die Prognose in `17` H.1 und in Entscheidung 9 des S2A2.1-Eintrags ist damit **überholt**. Das Fehlen der RPC ist eine Sicherheitsgrenze, kein unerledigter Rest; die Grenze entsteht in S2B zusammen mit dem Worker als neue Trust Boundary.
3. **Die Lease ist ein serverseitig erzeugtes Token je Claim, keine Worker-Identität.** `claimed_by` wird dafür umgedeutet, ohne neue Spalte; die Migration verweigert das, solange beanspruchte Zeilen existieren. TTL 10 Minuten, Budget 5 Versuche, `attempt_count` steigt beim Claim, deterministischer Backoff 15/30/60/120/240 Minuten. Eine verlorene Lease ist ein Fehler (`NORA_ATTACHMENT_LEASE_LOST`), nie „der letzte Schreiber gewinnt". Begründung: ein frisches Token je Claim schließt ABA — ein veralteter Halter kann einen neu beanspruchten Auftrag nicht verändern. Zählen beim Claim sorgt dafür, dass auch ein Absturz nach dem Claim Budget verbraucht.
4. **Das Liveness-Urteil wird ohne neuen Zustand abgebildet.** `live` → `skipped_live` (Vorhaben zurückgezogen); `unknown` → fail-closed, Wiederholung bzw. `failed_terminal`; `dead` → **kein Schreibvorgang**, der Auftrag bleibt beansprucht. Es gibt keinen Zustand `deletion_ready`: ein gespeichertes `dead` wäre sofort veraltet und sähe wie eine Erlaubnis aus. Ein Resolverfehler bleibt ein Fehler und wird kein `unknown`.
5. **S2A2.2 schreibt nie `done`.** `done` bleibt reserviert für „Storage-Objekt bestätigt entfernt". Ohne physische Löschung gibt es nichts zu bestätigen — also kein Ack und keine Abschluss-Function. Den Pfad zu `done` bringt erst S2B.
6. **Die Datenbank-Lease grenzt nur Datenbank-Mutationen ab, keine externen Seiteneffekte.** Ein künftiger Storage-Aufruf, der bei Ablauf der Lease schon läuft, wird von ihr nicht gestoppt. Das ist kein Defekt von S2A2.2, sondern ein ausdrückliches Gate: physische Löschung braucht zusätzlich einen Seiteneffekt-Vertrag (S3/S2B).
7. **LOW-1 wird als S3/S2B-Gate getragen, nicht in S2A2.2 gelöst.** Ein Vorhaben kann zwischen unterdrückter Erfassung und einer `live`-Inspektion verloren gehen ([`17`](17-known-issues-and-planned-waves.md) H.1). Die Folge ist ausschließlich ein mögliches verwaistes Objekt, nie eine falsche Löschung. Die Lösung gehört in den Schreibvertrag der Referenzen (S3), der Erfassung und Referenzschreibung mit aktiven Vorhaben koordiniert. Die Reihenfolge S3 → S2B wird nicht zusammengezogen. *Nachtrag 2026-09-19:* S3A hat LOW-1 für zeilenbasierte `public.attachments`-Verweise geschlossen; die Seiteneffekt-Abgrenzung aus Entscheidung 6 bleibt ein S2B-Gate (Eintrag „2026-09-19 – W8-C S3A").

## 2026-09-18 – W8-C S2A2.1: Ob eine Datei noch gebraucht wird, ist eine Beobachtung, keine Erlaubnis

**Status:** `PRODUCTION VERIFIED` (Schema-Commit `64963155d25321dbf9b4799a87f7582e30c445fe`, Migration `20260918120000_nora_attachment_liveness_resolver`, Production-Verifikation 2026-09-18). Contract: [`22`](22-security-and-access.md) Abschnitt 6.8 (Resolver) und 6.7 (Vokabular `skipped_live`). Ist-Zustand: [`16`](16-current-state.md) Abschnitt „Anhänge / Storage". Offene Folgeschnitte: [`17`](17-known-issues-and-planned-waves.md) H.1. Evidenz: `releases/2026-09.md`.

**Kontext.** S2A1 hält fest, *dass* eine Datei gehen soll; offen blieb, wie ein späterer Konsument prüft, ob sie noch irgendwo gebraucht wird. Die lebende Referenzmenge ist größer als `public.attachments` — Legacy-JSON-Arrays, Kundenlogos, Avatare und Branding-Logos, die in Production **nur als URL ohne `path`** gespeichert sind. Der ursprünglich als ein Schnitt geplante S2A2 (Resolver **und** Claim-/Lease-/Ack-/Fail-Vertrag) wurde in S2A2.1 (Beobachtung) und S2A2.2 (Ausführung) geteilt.

**Entscheidungen.**

1. **Die Liveness-Frage bekommt genau einen zentralen Ort, vor jedem Konsumenten.** `nora_private.attachment_storage_key_liveness(text)` ist die einzige Stelle, die beantwortet, ob ein Objektschlüssel noch referenziert wird; ein künftiger Worker fragt sie, statt eigene Parser mitzubringen. Begründung: zwei Parser divergieren, und die gefährliche Richtung der Divergenz ist ein falsches `dead`.
2. **Tri-State statt Boolean, fail-closed.** `live` (eine registrierte Fläche beweist die Referenz), `dead` (alle Flächen erfolgreich ausgewertet, kein Beweis, keine Mehrdeutigkeit), `unknown` (kein Beweis, aber ein registrierter Wert, aus dem sich `dead` nicht sicher ableiten lässt). **`live` dominiert `unknown`.** Ein Boolean hätte Mehrdeutigkeit in `false` = „löschbar" gefaltet. Laufzeitfehler sind **kein** drittes Ergebnis: ohne `exception when others` bricht Schema-Drift den Aufrufer ab — ein Fehler ist kein Urteil.
3. **`dead` ist eine Beobachtung, keine Löscherlaubnis.** Das Ergebnis gilt für einen Statement-Snapshot. Der Konsument (S2A2.2) muss sich gegen gleichzeitige Re-Referenzierung serialisieren, und physische Löschung (S2B) bleibt blockiert, bis S3 die Referenzschreibung absichert — S2A2.1 löst das Re-Referenzierungs-Rennen **nicht**.
4. **Die Registry ist fest codiert.** Keine Registry-Tabelle und kein dynamisches SQL: eine konfigurierbare Liste wäre eine zweite Schreibfläche mit eigener Autorisierungsfrage, dynamisches SQL eine Injektionsfläche. Eine neue Referenzspalte wird per Migration registriert oder ausdrücklich ausgeschlossen; ein Katalog-Vollständigkeitswächter in der Verifikationssuite macht Vergessen sichtbar.
5. **URL-only-Branding nimmt voll teil; nur die kanonische Form auf bekanntem Origin beweist `live`.** Ohne die URL-Auswertung wären die beiden in Production nur als URL gespeicherten Branding-Logos `dead` gewesen. Die Origin-Allowlist ist exakt (Production-Projekt, lokaler Stack) und bewusst nicht spekulativ; derselbe Schlüssel auf fremdem Origin ist `unknown`, fehlgeformte `attachments`-artige Werte sind `unknown`, gewöhnliche fremde URLs sind keine Referenz. Der übrige `configuration`-Inhalt ist ein Stolperdraht: ein speicherartiger Wert an unregistrierter Stelle ergibt `unknown`, nie `live`.
6. **Audit-Historie hält keine Bytes am Leben.** `audit_events` ist Evidenz darüber, *was war*; würde sie Liveness begründen, bliebe jede je protokollierte Datei für immer liegen. Ausgeschlossen sind ebenso `idempotency_records`, `operation_errors`, Löschticket-Snapshots und `storage.objects` selbst. Audit-Daten werden dadurch weder gelöscht noch verändert.
7. **`SECURITY DEFINER` für Sichtbarkeit, `row_security = off` gegen stille Blindheit.** Der Resolver muss jede Zeile sehen, sonst meldet er ein falsches `dead`; `row_security = off` lässt künftige RLS-/Ownership-Drift mit `42501` scheitern, statt still weniger Zeilen zu liefern. Kein API-Rollen-`EXECUTE`, keine Auth-Prüfung im Körper, weil es keinen API-Aufrufer gibt; kein neues `service_role`-Recht, kein Netzwerk, kein Storage.
8. **`skipped_live` entsteht jetzt als Vokabular, solange die Warteschlange leer ist.** Terminal, nicht aktiv, nicht fällig: das Vorhaben wurde zurückgezogen, weil der Schlüssel zu diesem Zeitpunkt `live` beobachtet wurde — **nicht** gelöscht, nicht dauerhaft sicher, keine Erlaubnis. Der Zustand war beim S2A1-Vokabular nicht vorgesehen; die beiden `CHECK`-Constraints wurden unter demselben Namen ersetzt, als die Warteschlange 0 Zeilen hatte — der billigste Zeitpunkt für eine solche Änderung. S2A2.1 schreibt keine Zeile; erzeugen wird den Zustand erst ein Konsument.
9. **Grenze von S2A2.1.** Nicht enthalten und erst S2A2.2 ff.: Claim, Lease-Token, Lease-Recovery, Attempt-Behandlung, Ack, Fail, Retry/Backoff, `service_role`-Ausführungs-RPC, Worker, physische Storage-Löschung. Die Reihenfolge S2A2.2 → S3 → S2B wird nicht zusammengezogen. *Nachtrag 2026-09-18:* S2A2.2 hat den Ausführungsvertrag geliefert, bewusst **ohne** `service_role`-Ausführungs-RPC, die erst mit dem Worker in S2B kommt. Die Serialisierung gegen Re-Referenzierung aus Entscheidung 3 liegt bei S3, nicht bei S2A2.2 (Eintrag „2026-09-18 – W8-C S2A2.2", Entscheidungen 2 und 7).

## 2026-09-17 – W8-C S2A1: Die Absicht zu löschen wird erfasst, bevor irgendetwas löschen darf

**Status:** `PRODUCTION VERIFIED` (Schema-Commit `28bf7902e8bdf09f6b54370e3a27b1f406fb7b8f`, Migration `20260917120000_nora_attachment_deletion_capture`, Production-Verifikation 2026-09-17). Contract: [`22`](22-security-and-access.md) Abschnitt 6.7. Ist-Zustand: [`16`](16-current-state.md) Abschnitt „Anhänge / Storage". Offene Folgeschnitte: [`17`](17-known-issues-and-planned-waves.md) H.1. Evidenz: `releases/2026-09.md`.

**Kontext.** Seit W8-B gibt es keinen physischen Löschpfad; verwaiste Storage-Objekte sind eine bewusst getragene Einschränkung. S1 hat mit `public.attachments` die Zeile geschaffen, deren Verschwinden der natürliche Haken für eine spätere Bereinigung ist. Offen war, wo die Bereinigung ansetzt — und wann der Haken existieren muss.

**Entscheidungen.**

1. **Erfassen ist ein eigener Schnitt, vor jeder Ausführung und vor jedem Schreiben.** S2A1 legt ausschließlich die private Warteschlange `nora_private.attachment_storage_deletion_queue` und einen `AFTER DELETE FOR EACH ROW`-Trigger auf `public.attachments` an, der `OLD.storage_key` als `pending` erfasst. Kein Worker, keine Claim-/Ack-/Fail-RPC, kein Storage-Aufruf. Begründung: Die Erfassung muss **vor** der ersten Anhangzeile stehen, sonst gingen genau die Löschungen verloren, die während des Anbindungsschnitts passieren. Da `public.attachments` leer und unverdrahtet ist, ist der Mechanismus heute folgenlos — das ist der Preis der richtigen Reihenfolge, kein Defekt. *Nachtrag 2026-09-19:* seit S3B wird die Tabelle projiziert, die Erfassung ist damit wirksam (Eintrag „2026-09-19 – W8-C S3B").
2. **Ein Warteschlangeneintrag ist ein Vorhaben, keine Erlaubnis.** Wer später löscht, muss **unabhängig** beweisen, dass der Schlüssel nirgends mehr lebt; die lebende Referenzmenge ist größer als `public.attachments` (Legacy-JSON-Arrays, Kundenlogos, URL-abgeleitete Branding-Verweise). Diesen Resolver entwirft S2A2. Ohne diesen Satz wird aus einer Outbox stillschweigend ein Löschbefehl.
3. **Erfassung ist fail-closed, Unterdrückung nur beim exakt gemeinten Konflikt.** Ein doppeltes *aktives* Vorhaben zum selben Schlüssel ist ein No-op (partieller Unique-Index, **benanntes** Konfliktziel); jede andere Einfügefehlerlage rollt die Metadatenlöschung zurück. Ein bloßes `on conflict do nothing` wurde verworfen: es arbitriert über **jeden** Unique-Index, auch den Primärschlüssel, und hätte ein verlorenes Vorhaben stillschweigend verschluckt — das Objekt bliebe für immer liegen, ohne dass irgendwo steht, dass es gehen sollte. Ein `exception when others` ebenso verworfen: Schlucken ist der Defekt.
4. **Eindeutigkeit gilt nur für aktive Vorhaben, nicht dauerhaft.** Ein Schlüssel, dessen Auftrag abgeschlossen ist, darf später legitim erneut referenziert und erneut gelöscht werden; ein permanenter `UNIQUE(storage_key)` hätte dieses zweite, gültige Vorhaben verschluckt. Terminale Zeilen bleiben erhalten und werden nicht automatisch gelöscht — eine Warteschlange, die ihre eigene Evidenz entfernt, ist nicht prüfbar.
5. **Die Erfassung bleibt reine Datenbankarbeit.** Kein HTTP, kein `pg_net`, keine Edge Function, kein Storage-API-Aufruf im Triggerpfad — der ausdrückliche Gegenentwurf zur mit W8-B entfernten Kette (`service_role` löscht einen client-gelieferten Pfad). `SECURITY DEFINER` ist hier erforderlich, weil der löschende `authenticated`-Aufrufer auf der privaten Warteschlange nichts hält; `service_role` bekommt **kein** neues Recht.
6. **Das vollständige Zustandsvokabular entsteht sofort, die Semantik erst in S2A2.** `pending` · `claimed` · `failed_retryable` · `done` · `failed_terminal` stehen bereits in der `CHECK`-Bedingung, obwohl S2A1 nur `pending` erzeugt — damit S2A2 keine `ALTER`-Operation an einer lebenden Tabelle mit echten Aufträgen braucht. Umgekehrt wird **kein** Index für einen Konsumenten angelegt, den es nicht gibt (Lease-Recovery gehört zu S2A2). *Nachtrag 2026-09-18:* Das Vokabular war nicht vollständig — S2A2.1 hat den terminalen Zustand `skipped_live` ergänzt und dafür die `CHECK`-Constraints bei leerer Warteschlange ersetzt (Eintrag „2026-09-18 – W8-C S2A2.1", Entscheidung 8).
7. **Die Reihenfolge S2A1 → S2A2 → S3 → S2B wird nicht zusammengezogen.** Physische Storage-Löschung (S2B) bleibt blockiert, bis die Anhangverweise atomar geschrieben werden (S3); bis dahin kann ein Schlüssel zwischen Erfassung und Ausführung erneut referenziert werden. Die bloße Existenz der Warteschlange rechtfertigt **keinen** Worker.

## 2026-09-16 – W8-C S1: Das Attachment-Fundament entsteht als leeres Schema, vor jeder Anbindung

**Status:** `PRODUCTION VERIFIED` (Schema-Commit `3df2ced82a36ae7d8d05f3f3f87181109f3af4fc`, Migration `20260916120000_nora_attachment_foundation`, Production-Verifikation 2026-09-17). Contract: [`22`](22-security-and-access.md) Abschnitt 6.6. Ist-Zustand: [`16`](16-current-state.md) Abschnitt „Anhänge / Storage". Offene Folgeschnitte: [`17`](17-known-issues-and-planned-waves.md) H.1. Evidenz: `releases/2026-09.md`.

**Kontext.** Anhänge lagen ausschließlich als JSON-Array am Notizdatensatz (H.1): keine Identität, keine Ownership auf Datensatzebene, kein Ort, an dem ein Löschpfad überhaupt ansetzen könnte. W8-B hatte den unsicheren Löschpfad entfernt, ohne ihn zu ersetzen, und die Neuentwicklung ausdrücklich an W8-C verwiesen.

**Entscheidungen.**

1. **Schema zuerst, Anbindung später — und die beiden Schnitte werden nie vermischt.** S1 legt ausschließlich `public.attachments` an: additiv, **leer**, ohne eine einzige Zeile in `src/**`. Kein Dual-Write, keine Migration der Bestandsdaten, kein Umschalten der Leseseite. Begründung: ein Fundament, das gleichzeitig ausgeliefert und beschrieben wird, lässt sich nicht einzeln zurücknehmen; ein leeres additives Schema ist folgenlos, wenn der nächste Schnitt anders ausfällt. Die Legacy-JSON-Arrays bleiben bis auf Weiteres die **einzige** live genutzte Darstellung. *Nachtrag 2026-09-19:* die Anbindung kam als datenbankeigene Projektion, nicht als Dual-Write der Anwendung; die Anwendung liest und schreibt weiterhin nur das JSON (Eintrag „2026-09-19 – W8-C S3B").
2. **Ein Anhang gehört genau einer Notiz.** `contact_note_id` **XOR** `deal_note_id`, als `CHECK` erzwungen — nie beide, nie keiner. Eine polymorphe „owner_type/owner_id"-Spalte wurde verworfen: sie kauft Flexibilität, die niemand braucht, mit dem Verlust der Fremdschlüsselintegrität.
3. **`CASCADE` löscht Metadaten, niemals Dateien.** Die beiden FKs sind `ON DELETE CASCADE`, und S1 hat **keinen** physischen Löschpfad. Das ist bewusst die halbe Miete: die Zeilenlöschung ist der Haken, an dem S2 die physische Bereinigung aufhängt. Wer diesen Cascade als „die Datei wird gelöscht" beschreibt, dokumentiert eine Funktion, die es nicht gibt.
4. **`storage_key` ist Identität, nicht Adresse.** Die Spalte ist `NOT NULL` und `UNIQUE` und hält einen provider-neutralen Objektschlüssel — nie `src`, öffentliche oder signierte URL, Hostname, Bucket- oder Anbietername. Bewusst **ohne** Formatzwang: heutige Schlüssel sind flach, die Invariante ist Identität, nicht das heutige Layout (W8-E darf ein anderes wählen). Grundlage der `UNIQUE`-Zusage ist eine read-only Production-Bestandsaufnahme: 31 Bestandsanhänge, 31 auflösbar, 31 **verschiedene** Schlüssel, 0 Dubletten, 31/31 mit MIME-Typ — dieselbe Erhebung trägt `mime_type NOT NULL`.
5. **Die MIME-Allowlist bleibt Bucket-Policy und wird nicht als Entitätsinvariante dupliziert.** `mime_type` hält, was beim Upload **deklariert** wurde; geprüft wird nirgends der Inhalt. Die Grenze gehört an genau eine Stelle (W8-B, [`22`](22-security-and-access.md) 6.5) — zwei Orte für dieselbe Regel driften auseinander.
6. **Metadaten sind unveränderlich: kein `UPDATE`, weder Policy noch Privileg.** Ersetzen oder entfernen, nie mutieren — deshalb auch kein `updated_at`.
7. **`DELETE = can_write()` statt `is_admin()`.** Büro entfernt einen Anhangverweis heute bereits über das `UPDATE` des Notiz-Arrays; die Zeilenlöschung ist das modellierte Äquivalent derselben bestehenden Fähigkeit und damit **keine** Rechteausweitung. Die Notiz selbst zu löschen bleibt `is_admin()`. *Nachtrag 2026-09-19:* **überholt.** S3A hat `authenticated` den direkten `INSERT`- und `DELETE`-Pfad auf `public.attachments` entzogen; die Tabelle bekommt einen datenbankeigenen Schreiber (Eintrag „2026-09-19 – W8-C S3A", Entscheidung 6).
8. **Kein `uploaded_by`.** Eine Mitarbeiterreferenz würde Hard-Delete-Semantik, Lifecycle-Referenzintegrität und die Löschvorschau ausweiten, ohne dass ein Produktbedarf belegt ist. Zurückgestellt, additiv nachrüstbar — nicht verworfen.

## 2026-09-15 – W8-B: Anhänge werden sofort gehärtet, bevor das Attachment-Fundament gebaut wird

**Status:** `PRODUCTION VERIFIED` (Laufzeit `be77e7da53ce4eaaae1710bbcafbb8d99e5759b4`, Migration `20260915120000_nora_attachment_storage_hardening`, Production-Verifikation 2026-09-16). Contract: [`22`](22-security-and-access.md) Abschnitt 6.5. Ist-Zustand: [`16`](16-current-state.md) Abschnitt „Anhänge / Storage". Offene Punkte: [`17`](17-known-issues-and-planned-waves.md) H.1. Evidenz: `releases/2026-09.md` (Eintrag Attachment Security Hardening W8-B).

**Kontext.** Der gemeinsame Bucket `attachments` (Notiz-Anhänge, Kunden- und Branding-Logos) trug Policies, die nur `authenticated` verlangten: jeder angemeldete Benutzer — auch ein `viewer`, auch ein deaktivierter Mitarbeiter mit noch gültigem JWT — konnte auflisten, hochladen und löschen; Löschen und erneutes Hochladen unter demselben Schlüssel erlaubte das Austauschen von Inhalten. Es gab keine Typ- und keine Größengrenze. Zugleich existierte ein Löschpfad, der aus einem Trigger über `pg_net` eine **nicht deployte** Edge Function rufen sollte, die mit `service_role` client-kontrollierte Pfade entfernt: tot und im Fall eines Deploys gefährlich. Das eigentlich richtige Fundament (Attachment-Entität mit Id, Ownership und Löschwarteschlange) ist eine große eigene Welle.

**Entscheidungen.**

1. **Härten vor Umbauen.** W8-B nimmt den kleinsten durablen Schnitt, der die akuten Risiken schließt — enge Policies, Bucket-Grenzen, sichere Objektschlüssel —, und beginnt das Attachment-Fundament **nicht**.
2. **Storage trägt dieselbe Aktiv-/Rollenprüfung wie die CRM-Daten.** Lesen erfordert einen aktiven Benutzer, Hochladen eine aktive Schreibrolle; beide über dieselben `nora_private`-Helfer, damit die Session-Bindung (W6-A) automatisch mitgilt. Für `UPDATE` und `DELETE` gibt es **keine** Policy für normale Rollen.
3. **Der unsichere Löschpfad wird entfernt, nicht repariert.** Trigger, `cleanup_note_attachments()`, `get_note_attachments_function_url()` und die Edge-Function-Quelle verschwinden. Der Preis — verwaiste Storage-Objekte — wird **bewusst und befristet** in Kauf genommen, bis W8-C einen Löschpfad neu entwirft.
4. **Der Bucket bleibt in W8-B öffentlich.** Die Umstellung auf privaten Storage mit signierten URLs berührt Bestandsschlüssel, Logo-Anzeige und jeden Lesepfad; sie ist eine eigene Welle (W8-E) und wird nicht als Nebenwirkung einer Policy-Härtung mitgenommen.
5. **MIME-Baseline aus dem Produktionsbefund.** Erlaubt sind neun Typen (JPEG, PNG, WebP, GIF, PDF, DOCX, XLSX, TXT, CSV) mit 50 MiB je Datei. Grundlage war eine read-only Bestandsaufnahme: die vorhandenen Anhänge bestanden ausschließlich aus JPEG, PNG und PDF, keiner über 50 MiB. Die Liste ist eine **Baseline**, kein endgültiger Produktentscheid.

**Begründung.** Ein bekanntes, breit offenes Zugriffsrecht monatelang stehen zu lassen, weil die saubere Lösung groß ist, ist die teuerste Variante — die Härtung ist klein, rückbaubar und blockiert das Fundament nicht. Der tote Löschpfad wäre durch ein späteres Deploy ohne weiteres Zutun scharf geworden; ihn zu entfernen ist billiger und ehrlicher, als ihn halb zu reparieren. Die Verwaisungen sind sichtbar, benannt und kosten Speicherplatz — der frühere Pfad hätte im Fehlerfall fremde Objekte gelöscht. Die MIME-Liste aus dem echten Bestand abzuleiten verhindert sowohl eine Allowlist, die den Alltag blockiert, als auch eine, die ausführbare Formate zulässt. **Verworfen:** den Bucket in derselben Welle privat schalten (bricht jede bestehende Objekt-URL und die Logo-Anzeige), den Löschpfad „nur absichern" (die Grundkonstruktion — `service_role` löscht einen client-gelieferten Pfad — ist nicht absicherbar), und Inhalts-/Virenprüfung zu behaupten, die es nicht gibt.

## 2026-09-14 – E2E-Testisolation: Tests respektieren dieselben Security- und Lifecycle-Grenzen wie die Anwendung

**Status:** `CURRENT` (2026-09-14; Test-Infrastruktur-Commit `7384431d917eed79000d50437a53abd514bc27c5`, keine Laufzeit-, DB- oder Edge-Änderung). Runbook: [`21`](21-agent-runbooks.md) Sektion 16. Evidenz: `releases/2026-09.md` (Eintrag E2E-Testisolation E2E-B1).

**Kontext.** Der E2E-Reset setzte einen privilegierten Sonderpfad voraus: er löschte Geschäftsdaten, `sales` und Auth-Benutzer per `service_role` und ignorierte Supabase-Fehler. Seit W6-B (Mitarbeiter-/Auth-Löschung nur über den kontrollierten Pfad) und Security Hardening Wave 1 (kein Geschäfts-`DELETE` für `service_role`) schlug dieser Pfad still fehl — Gesamt-CI war rot.

**Entscheidung.**

1. Ein disposable E2E-Stack besitzt **genau einen kanonischen Administrator**. Er wird nur auf einem leeren Stack angelegt und danach aus dem DB-Zustand wiedererkannt; zwischen Tests wird er **nicht** gelöscht.
2. Zurückgesetzt werden **nur fachliche Testdaten**, über eine echte authentifizierte Admin-Session — es greifen die normalen RLS-Policies, W6-B-Guards werden nicht umgangen.
3. Unerwarteter Identitätszustand oder ein Cleanup-Fehler ist **fail-closed**: der Lauf bricht ab, nichts wird automatisch repariert, übernommen oder gelöscht.
4. **Keine** `service_role`-DELETE-Ausnahme und **keine** test-only DB-Hintertür.

**Begründung.** Test-Infrastruktur darf Security-Hardening nicht dadurch brechen, dass sie privilegierte Sonderpfade voraussetzt — sonst wird jede Härtung zum CI-Ausfall oder, schlimmer, zum Druck, die Härtung für Tests aufzuweichen. Tests, die dieselben Grenzen wie die Anwendung durchlaufen, beweisen zugleich, dass der normale Admin-Pfad funktioniert. **Verworfen:** Grants, Policies oder Guards für den Test-Reset lockern.

## 2026-09-13 – W7-R1B: Jeder Vorgang gehört genau einem Kunden

**Status:** `PRODUCTION VERIFIED` (2026-09-13; Laufzeit `fd635b08d57173d26a76c58c6029e2d95030a81f`, Migration `20260913120000_nora_deal_company_required`). Domänenregel: [`01`](01-domain-model.md); Daten-Invariante: [`03`](03-data-model-guardrails.md) §1.7. Release-Evidenz: `releases/2026-09.md` (Eintrag Deal-Kunde-Contract W7-R1B).

**Kontext.** Im Domain-Typ war `Deal.company_id` nicht-null, die aus Atomic CRM geerbte Datenbankspalte `deals.company_id` dagegen nullable. W7-R1A hatte nur die Startseiten-Lesepfade gegen leere Kunden-Ids abgesichert; der Widerspruch zwischen Domäne und Datenbank blieb offen.

**Entscheidung.** Jeder Vorgang gehört genau einem Kunden. Umgesetzt als **Domain nicht-null + Datenbank-Härtung**: `deals.company_id` wird `NOT NULL` (fail-closed ohne Backfill), FakeRest spiegelt die Regel in den normalen Anlage-/Änderungspfaden. Das Löschverhalten des Fremdschlüssels bleibt bewusst unverändert — es ist nicht Gegenstand dieser Entscheidung.

**Begründung.** Die normalen Anlage- und Bearbeitungspfade verlangen bereits einen Kunden; die Schnellerfassung bestimmt den Kunden serverseitig; kein bestehender Workflow braucht einen Vorgang ohne Kunden. Der Production-Bestand vor dem Apply enthielt keinen Vorgang mit `company_id IS NULL`, ein Backfill war nicht nötig. Diese Produktworkflows, der aktuelle Datenbestand und das etablierte Nora-Modell (Kunde ≠ Kontakt ≠ Vorgang) tragen den Pflicht-Kunden; der bestehende Fremdschlüssel ist dafür höchstens Umfeld-Evidenz, kein Beweis. **Verworfen:** den Domain-Typ nullable machen, nur weil die geerbte Upstream-Spalte nullable war — das hätte einen fachlich nicht gewollten Zustand legitimiert und jede Lesestelle mit Null-Behandlung belastet, statt die Datenbank an die tatsächliche Domäne anzugleichen.

## 2026-09-13 – Mobile Vorgang-Details: nur die Show-Fläche

**Status:** `PRODUCTION VERIFIED` (2026-09-13; Laufzeit `8aa62cc88c938a082fe0df99c84f96297c5ebbbc`, frontend-only). Routing-Contract: [`04`](04-routing-i18n.md) Abschnitt „Mobile / Desktop: getrennte Resource-Registrierung". Release-Evidenz: `releases/2026-09.md` (Eintrag Mobile Vorgang-Detailroute W7-M1).

**Kontext.** Die mobile Oberfläche registrierte für `deals` keine einzige Route — ein unveränderter Rest aus Atomic CRM. Gleichzeitig führten Nora-eigene mobile Einstiege (Startseite/Hotboard inkl. Produktionsfreigaben, globale Suche, Schnellerfassung, Deep Links) genau auf `/vorgaenge/:id/show` und endeten dort in einer leeren Fläche. Eine Nora-Entscheidung „Vorgänge werden mobil nicht geöffnet" gab es nie.

**Entscheidungen.**

1. **Einen Vorgang ansehen gehört mobil zum Nora-Kernworkflow.** Mobile registriert für `deals` eine eigene Show-Fläche mit dem fachlichen Kern des Vorgangs.
2. **Nur Show.** Eine dedizierte mobile Vorgangsliste/Kanban sowie dedizierte mobile Resource-Anlege-/Bearbeiten-Flächen (Create-/Edit-Routen für `deals`) werden bewusst **nicht** mit eingeführt; jede davon wäre eine eigene Produktentscheidung, die W7-M1 nicht trifft. Die bestehende Schnellerfassung ist davon unberührt: ein separater Anlageworkflow, über den auch mobil ein Vorgang angelegt und anschließend geöffnet wird. Folge: mobile Flächen bieten keine Links auf die Vorgangsliste an.
3. **Desktop bleibt unverändert** (Kanban, Vorgangs-Dialog). Keine allgemeine Mobile/Desktop-Parität.

**Begründung.** Nora selbst schickte mobile Nutzer bereits zu Vorgängen; der Ausschluss stammte aus dem Upstream-Zustand und war kein tragfähiger Produktvertrag. Der kleinste Schnitt, der diese Einstiege konsistent macht, ist die Show-Fläche — eine dedizierte mobile Liste oder Bearbeitungsfläche hätte eigene UX-Fragen, die nicht Teil der Korrektur sind. Verworfen: die mobilen Einstiege entfernen (nimmt Nutzern den Vorgang, den Nora ihnen gerade zeigt) und Desktop-Parität in einem Schritt.

## 2026-09-11 – PWA Contract Ownership (CR5): eigener Current Owner für Service Worker und Update-Lifecycle

**Status:** `CURRENT` (Dokumentationsentscheidung, 2026-09-11; keine Migration, kein Deploy, keine Laufzeitänderung). Contract: [`24-pwa-and-update-lifecycle.md`](24-pwa-and-update-lifecycle.md).

**Kontext.** Der technische PWA-/Update-Vertrag lag über fünf Orte verstreut: als „Durable Regeln 1–8" in diesem Rationale-Dokument, als ausdrücklich markierter `Interim-Contract` in [`21`](21-agent-runbooks.md) §14, als technische Nebensätze in der Präsentation ([`02`](02-design-system.md)), als akzeptierte Limitationen in der Open-State-Liste ([`17`](17-known-issues-and-planned-waves.md) E) — und im Rest nur im Code. Wer eine PWA-Frage hatte, musste vier Dokumente zusammensuchen und fand die Cache-, Offline- und Installability-Grenze nirgends.

**Entscheidungen.**

1. **PWA und Update-Lifecycle erhalten einen eigenen Current Contract** ([`24`](24-pwa-and-update-lifecycle.md), Load-Klasse **CONDITIONAL CURRENT CONTRACT**, sektionsweise §0–§9): Registrierungsgrenze, Lifecycle- und State-Contract, Erkennung und Prüfkadenz, Aktivierung/Reload/Abschluss, Precache-, Offline-, Installability-Grenze und Multi-Tab-Verhalten.
2. **`21` wird reines Runbook.** §14 trägt keine Contract-Sätze mehr, sondern nur noch Verifikation und Live-Smoke; der `Interim-Contract`-Vermerk im Kopf von `21` entfällt ersatzlos.
3. **`02` bleibt Presentation.** Die sichtbaren Zustände, Copy, Komposition, Motion und A11y bleiben dort; die technischen Bedingungen in der Zustandstabelle sind ausdrücklich **abgeleitet** und zeigen auf `24`.
4. **[`23`](23-operations-errors-feedback.md) scheidet als Owner bewusst aus.** Ein PWA-Update ist keine Business-Operation — kein `operationId`, kein Idempotency-Key, kein OperationManager. Es in den Operations-Contract zu ziehen hätte genau die Modellierung eingeführt, die dieser Lifecycle seit PWA-1C ablehnt.
5. **Build-/Release-Identität bleibt Verifikation.** Die im Build eingebettete Commit-SHA gehört zu „wie weise ich nach, was live ist" und bleibt deshalb in [`21`](21-agent-runbooks.md) §14 — sie ist keine PWA-Wahrheit.

**Begründung.** Ein Contract, der als Anhang eines Rationale-Dokuments und als Fußnote eines Runbooks lebt, wird bei Release-Arbeit gefunden und bei Architekturarbeit übersehen. Der Anlass war eine konkrete Folge davon: die Kurzregel „ein Reload holt den neuen Build nicht" war an vier Stellen als unbedingte Wahrheit notiert, obwohl sie nur für **kontrollierte** Clients gilt — ein Satz, der in einem Rationale-Dokument nie präzisiert wird, weil dort niemand nach dem technischen Vertrag sucht. Ein eigener conditional Owner macht die PWA-Wahrheit auffindbar, wenn sie gebraucht wird, und abwesend, wenn nicht.

## 2026-09-10 – Global Security & Access erhält einen eigenen Current Contract

**Status:** `CURRENT` (Dokumentationsentscheidung, 2026-09-10; keine Migration, kein Deploy, keine Laufzeitänderung). Contract: `22-security-and-access.md`.

**Kontext.** Die globale Security- und Access-Wahrheit lag verstreut: das Nora-weite Rollenmodell und die Berechtigungsmatrix in `11-google-calendar-rbac.md` Abschnitt C — einem Dokument über den Google-Kalender, dessen Edge-Seite nicht einmal deployt ist; die Grant-/RLS-/`SECURITY DEFINER`-Guardrails in `03-data-model-guardrails.md`, einem **ALWAYS** geladenen Datenmodell-Dokument; die operativen Prüfschritte in `21-agent-runbooks.md` Sektion 4, die selbst notierte, dass ihr Contract-Owner fehlt. Ein Agent mit einer allgemeinen RBAC-Frage musste drei Dokumente zusammensuchen und trug dabei bei **jeder** Aufgabe den vollen Security-Text im Always-Kontext mit.

**Entscheidungen.**

1. **Global Security & Access erhält einen eigenen Current Contract** (`22-security-and-access.md`, Load-Klasse **CONDITIONAL CURRENT CONTRACT**): Enforcement-Prinzip, Authentication vs. Authorization, Rollen und Capability-Rollen, globale Berechtigungsmatrix, Trust Boundaries, Database Enforcement, Session- und Executor-Integrität.
2. **Ownership-Grenze.** `03` bleibt Daten/Persistenz und **ALWAYS**; `19` bleibt Lifecycle-Prozesse; `11` behält nur den kalenderspezifischen Access-Kontext; `21` bleibt operative Verifikation; `16` behält nur einen kompakten Security-Kernel; `17` A bleibt der Ort für offene Risiken.
3. **Das verbindliche Enforcement-Prinzip lautet:** für Datenzugriff und Persistenzautorisierung ist die **Datenbank** die letzte Enforcement Boundary; UI und Client sind niemals Autorität; **Edge Functions ergänzen** serverseitige Authorization und privilegierte Orchestrierung. Authentication (GoTrue/Identity) wird ausdrücklich **nicht** als DB-Verantwortung beschrieben.
4. **Die Fallen-Nummern 1–40 bleiben dauerhaft stabil.** Eine Falle behält ihre ID auch nach einem Owner-Wechsel (Falle 25 und 34 sind jetzt in `22`); `03` führt einen kompakten **Fallen-Index** (Nummer → kanonischer Owner) als Resolver. Keine Renummerierung, keine Rückschreibung historischer Release-Dokumente.

**Begründung.** Security-Wahrheit, die als Nebenabschnitt eines Subsystemdokuments lebt, wird bei Subsystem-Arbeit gefunden und bei Security-Arbeit übersehen — und Security-Wahrheit im Always-Kontext verteuert jede Label-Änderung. Ein eigener conditional Contract macht sie **auffindbar, wenn sie gebraucht wird**, und **abwesend, wenn nicht**. Die stabilen Fallen-IDs sind der Preis dafür, dass fünfzehn Monate Release-Dokumentation nicht umgeschrieben werden müssen.

## 2026-09-09 – Visualizer Production Exclusion: Diagnoseartefakte gehören nicht in den Production-Build

**Status:** `PRODUCTION VERIFIED` (2026-09-09; Laufzeit-RC **und** Release-Kopf `c50e779fff645c1c5bf33a962c92b6c0b48e12d6`, Base `078a9483`; keine Migration, kein Edge-Deploy, keine sichtbare Funktionsänderung). Release-Evidenz: `releases/2026-09.md` (Eintrag Visualizer Production Exclusion H1).

**Kontext.** Der Bundle-Visualizer schrieb `dist/stats.html` bei **jedem** Build — `open: !process.env.CI` (Entscheidung 2026-08-15) steuert nur das Öffnen im Browser, nicht die Erzeugung der Datei. Die Workbox-Glob `**/*.html` nahm sie damit in den PWA-Precache auf: ein 2 MB großes Entwickler-Diagnoseartefakt wurde bei jedem Deploy an jeden Client übertragen (38 Einträge / 5.553.922 B, davon `stats.html` 36,4 %).

**Entscheidungen.**

1. **Der Precache ist kein Ablageort für Diagnoseartefakte.** Was in `dist/` liegt, wird ausgeliefert — die Workbox-Glob unterscheidet nicht zwischen Anwendungs- und Werkzeugausgabe. Ein Build-Werkzeug, das nach `dist/` schreibt, braucht deshalb einen expliziten Schalter, nicht nur eine Verhaltensoption.
2. **Der Visualizer ist opt-in über `ANALYZE=true`** — **strikt** verglichen, nicht generische Truthiness (`ANALYZE=1`/`false`/`TRUE` aktivieren ihn nicht). Ohne die Variable wird das Plugin gar nicht erst geladen. Damit ersetzt `ANALYZE` das `CI`-Kriterium der Entscheidung 2026-08-15 als Steuergröße; `open: !process.env.CI` bleibt innerhalb des aktivierten Plugins als Kopflos-Schutz bestehen.
3. **CI behält seine Diagnose unverändert**, aber schmal: `ANALYZE=true` steht am **Build-Step** in `.github/workflows/check.yml`, nicht job- oder workflow-weit. Bundle-Budget-Step und Artefakt-Upload finden `dist/stats.html` weiterhin vor.
4. **Kein Bundle-Budget-Tuning in einer Hygiene-Änderung.** H1 ändert keinen JS-Chunk und keine Budgetzahl; das bereits vorher rote Entry-Chunk-Budget (1092 kB > 1050 kB) bleibt eine eigene Welle (H2) — damals `17-known-issues-and-planned-waves.md` I.1. *Navigationsnachtrag 2026-09-10: H2 ist inzwischen aufgelöst (`PRODUCTION VERIFIED`); I.1 steht deshalb nicht mehr in den aktiven Known Issues, die Evidenz liegt im Archiv `releases/2026-09.md` („Entry-Chunk-Budget H2", Anhang mit dem I.1-Originalwortlaut).*

**Begründung.** Der Defekt war nicht der Visualizer, sondern die stillschweigende Annahme, ein Werkzeug schreibe nur dort, wo man es beobachtet. Ein expliziter, strikt geprüfter Schalter macht die Ausgabe zu einer angeforderten Handlung statt zu einem Nebeneffekt; die strikte Prüfung verhindert, dass eine beiläufig gesetzte Umgebungsvariable das Artefakt versehentlich zurück in den Production-Build holt. **Verworfen:** die Datei aus der Workbox-Glob ausschließen (behandelt das Symptom, `dist/` bliebe verschmutzt und die nächste Werkzeugausgabe fiele wieder durch) und generische Truthiness (macht `ANALYZE=false` zu einer Aktivierung).

## 2026-09-08 – Atomic Contact Primary Intent: Hauptansprechpartner ist eine Geschäftstransition, kein Spaltenschreibvorgang

**Status:** `PRODUCTION VERIFIED` (2026-09-08; Laufzeit-RC `0fb3d6ba6a52613e366c780586c4988d264c61eb`, Release-Kopf `5d526231b21848a2720629a12bd55ac902e6cb43`, Base `7d85acbd`; Migration `20260908120000_nora_atomic_contact_primary_intent`, LF SHA-256 `0354bdec34c527a598529ba4309247154d7ec6838722ac7953c7dc4d56af4f6f` — angewendet, Ledger **58** / Kopf `20260908120000`; PO-Live-Smoke akzeptiert). Zwei frühere RCs wurden von unabhängigen Reviews als **release-blockierend zurückgewiesen** und dürfen nicht releast werden: `cf48560b` (Hash `d3352113fd001d53…`, Cross-Command-Deadlock) und `b161a4f9` (Hash `edf8346fa947cb6c…`, Trigger-Deadlock). Beide Nachträge stehen am Ende dieses Eintrags. Release-Evidenz: `releases/2026-09.md` (Eintrag Atomic Contact Primary Intent). Modell: `01-domain-model.md`; Guardrail: `03-data-model-guardrails.md` §3 (Transaktionen, Sperren, Concurrency).

**Kontext.** Am 2026-09-07 legte der Product Owner in Production einen zweiten Ansprechpartner für den Kunden `companies.id = 20` an und markierte ihn als Hauptansprechpartner, obwohl `contacts.id = 29` diese Rolle bereits hielt. Das Kontaktformular schrieb `is_primary = true` als rohe Spalte; der Partial Unique Index `uq_contacts_one_primary_per_company` verweigerte korrekt (HTTP 409, SQLSTATE 23505); Nora zeigte dem Büro die generische Meldung „Die Daten konnten gerade nicht geladen werden." Die Datenbank-Invariante war richtig — es fehlte die **autoritative Transition** in der Anwendungsschicht. Die zwei Tage zuvor abgeschlossene Privilegien-Härtung war nachweislich nicht ursächlich.

**Entscheidungen.**

1. **Explizite Absicht statt Checkbox-Spalte.** Ein Kontakt-Speichern trägt einen `PrimaryContactIntent` (`keep` · `make_primary` mit *beobachtetem* aktuellen Hauptansprechpartner · `clear`), modelliert framework-frei in `domain/contactPrimaryIntent.ts`. `contacts.is_primary` wird von der Oberfläche nie mehr als rohe Spalte geschrieben; die RPCs lesen `is_primary` aus der Nutzlast ausdrücklich **nicht**.
2. **Ein atomarer Befehl, keine zwei Browser-Requests.** `public.create_contact` und `public.update_contact` schreiben Kontaktfelder, Kundenwechsel **und** die Hauptansprechpartner-Transition in einer Transaktion (Variante B, verbindlich). Der neue Kontakt wird in seinem **Endzustand** eingefügt (`contact.created` mit `is_primary = true`, davor genau ein `contact.updated` für den abgelösten Halter) — kein „created, dann updated". Verworfen: `insert` + zweiter `set_primary_contact`-Aufruf (Teilzustand bei Netzverlust), Validierung nur in JavaScript, Aufweichen des Index.
3. **Ein Transitionskern.** `nora_private.prepare_primary_contact_slot` ist die einzige Implementierung von „bisherigen Halter demotieren"; `create_contact`, `update_contact` **und** die bestehende `set_primary_contact` laufen darauf. Kein Gott-Funktions-Umbau: schmale, allowlist-basierte Signaturen, keine generische Zeilenmutation.
4. **Serialisierung über den Kunden, nicht über den Index — mit einem Advisory Lock, nicht mit der Kundenzeile.** Jede Transition nimmt über `nora_private.lock_customers_for_primary_transition` einen **transaktionsgebundenen Advisory Lock je Kunde** (Namespace `nora_primary_contact`, Nora-Bestandsmuster wie im Idempotenz-Kern), bei Kundenwechsel beide Kunden in aufsteigender Id-Reihenfolge — und zwar **bevor** irgendeine Kontakt- oder Kundenzeile gesperrt oder geschrieben wird. Der Unique Index bleibt letzte Verteidigung (Resttreffer → `NORA_PRIMARY_CONTACT_ALREADY_EXISTS`), ist aber nicht der normale Koordinationsmechanismus.

    Eine **Zeilensperre auf `public.companies` ist als Mutex ungeeignet** — das war der zweite Blocker (Nachtrag unten). Dieselbe Kundenzeile wird nämlich unvermeidbar auch *kontaktzeilen-zuerst* gesperrt: der Trigger `nora_private.sync_individual_company_name` schreibt `public.companies` aus einem laufenden `UPDATE public.contacts` heraus, und jeder Kontakt-`INSERT`/Kundenwechsel nimmt über den FK `KEY SHARE`. Diese Pfade lassen sich nicht umsortieren. „Kundenzeile zuerst überall" ist deshalb nicht bloß unvollständig umgesetzt, sondern **unerreichbar**.

    Die durable Regel lautet daher:

    > Jede Hauptansprechpartner-Transition nimmt die Advisory-Transitionssperren ihrer Kunden in aufsteigender Kunden-Id, **bevor** sie eine Kontakt- oder Kundenzeile sperrt oder schreibt; und jedes Warten auf eine **Kontaktzeile** liegt **vor** jedem Erwerb einer **Kundenzeilensperre**.

    Beide Eigenschaften gelten nachweislich für `create_contact`, `update_contact`, `set_primary_contact` und `create_customer_with_contact_core`. Damit kann keine kontaktzeilen-zuerst laufende Fremdtransaktion mehr einen Zyklus mit einer Transition bilden.
5. **Stale-UI-Schutz.** `make_primary` trägt die Id des Halters, den der Benutzer im Formular gesehen hat (`null` = „keinen"). Unter dem Kundenlock wird der tatsächliche Halter erneut gelesen; weicht er ab, wird die **gesamte** Operation zurückgerollt und `NORA_PRIMARY_CONTACT_CHANGED` geliefert („Der Hauptansprechpartner wurde inzwischen geändert. Bitte prüfen Sie die Auswahl erneut."). Ein neuerer Hauptansprechpartner wird nie still ersetzt. Ist das Ziel bereits Halter, ist `make_primary` ein No-op — dadurch ist ein wiederholtes Update natürlich idempotent.
6. **Zwei Fehlercodes, bewusst getrennt.** `NORA_PRIMARY_CONTACT_ALREADY_EXISTS` („Dieser Kunde hat bereits einen Hauptansprechpartner.") für den Legacy-Rohschreibpfad — in `normalizeCrmError` **eng** am Constraint-Namen verankert, kein breites `duplicate key`-Matching — und `NORA_PRIMARY_CONTACT_CHANGED` für den Stale-Fall. Kein Kontakt-Speicherfehler fällt mehr auf `load_failed`.
7. **Idempotenz mit vorhandenen Primitiven.** `create_contact` nutzt `idempotency_check`/`idempotency_persist` (Scope `contact.create`); der Schlüssel wird pro Formularsitzung gemintet (Idempotency-Wave-Vertrag: `operation_id` ≠ `idempotency_key`, kein zweiter Tisch). Der Fingerprint beschreibt die **Geschäftsanfrage**, nicht die rohe Client-JSON: er entsteht aus `nora_private.contact_create_fingerprint_payload` — genau der Allowlist schreibbarer Felder, die der Befehl verarbeitet (TypeScript-Spiegel `contactCreateFingerprintPayload`, damit FakeRest denselben Fingerprint bildet). Schlüssel, die der Befehl ohnehin ignoriert (View-Spalten wie `company_name`/`nb_notes`, UI-Hilfsfelder), können dadurch keinen `NORA_IDEMPOTENCY_CONFLICT` mehr auslösen; ein Unterschied in einem schreibbaren Feld dagegen sehr wohl. Volatile `first_seen`/`last_seen` bleiben bewusst ausgenommen, damit ein echter Retry als Replay erkannt wird. Updates brauchen keinen Schlüssel (siehe 5).
8. **Provider-Ebene als eine Eintrittsstelle.** Wie `deal.update` fangen Supabase- und FakeRest-Provider `create/update("contacts")` ab: trägt die Nutzlast eine Absicht (jedes Nora-Formular) oder einen `is_primary`-Wert (ältere Aufrufer), läuft **eine** `contact.create`/`contact.update`-Operation über den Operation Manager (eine UUID → `x-nora-operation-id` → `audit_events.request_id`). Partielle Updates ohne Bezug zum Hauptansprechpartner (Status, Markierungen, `last_seen`, Import) bleiben rohe, additive Schreibpfade — sie können den Index nicht verletzen.
9. **Sicherheitsvertrag der Härtungswelle eingehalten.** Beide neuen Functions: `SECURITY DEFINER`, Owner `postgres`, `search_path = ''`, `safe_auth_uid()` + `can_write()`, eigener `revoke all … from public, anon, authenticated, service_role`, einziger Grant an `authenticated`; `service_role` erhält **kein** EXECUTE (kein deployter Backend-Pfad). Tabellen-ACLs, `set_primary_contact`-Grants und Storage unverändert.
10. **Oberfläche.** Der aktuelle Halter steht direkt am Schalter („Aktuell: Freddie Krüger" · „Noch kein Hauptansprechpartner festgelegt." · „Diese Person ist aktuell Hauptansprechpartner."); ON zeigt die Konsequenz inline („… wird beim Speichern als Hauptansprechpartner abgelöst."), kein Modal, keine Warnbox. Ein Kundenwechsel im offenen Formular setzt den Schalter zurück und löst den Halter des **neuen** Kunden auf; die gesendete Erwartung gehört immer zum tatsächlich gespeicherten Kunden.

**Begründung.** Die Datenbank kann nur dann garantieren, dass ein Kunde nie zwei Hauptansprechpartner hat und dass der abgelöste Halter nur zusammen mit dem neuen committet, wenn beide Schreibvorgänge dieselbe Transaktion und denselben Lock teilen. Eine explizite Absicht mit beobachtetem Halter macht die Transition nachvollziehbar (Audit) und schützt vor stiller Überschreibung durch ein veraltetes Formular. Demo (FakeRest) implementiert denselben Vertrag, damit der Demo-Modus keinen Zustand annimmt, den Production ablehnt.

**Nachtrag 2026-09-08 (Blocker-Fix, RC `b161a4f9`).** Eine unabhängige Review des ersten RC `cf48560b` fand einen release-blockierenden **Cross-Command-Deadlock**. Die Dokumentation jenes RC behauptete, die Real-Session-Matrix A–F habe lokal „kein Deadlock" bewiesen; bewiesen war damit nur *neu gegen neu* — die neuen Befehle gegeneinander. Der Pfad, der tatsächlich brach, war *neu gegen bestehend*:

| Pfad | Sperrreihenfolge vor dem Fix |
|---|---|
| `nora_private.create_customer_with_contact_core` (Schnellerfassung, **bestehender** Kunde, `p_contact_is_primary = true`) | `UPDATE public.contacts` (Halter demotieren) → `INSERT public.contacts` ⇒ der FK nimmt `KEY SHARE` auf die Kundenzeile |
| `nora_private.prepare_primary_contact_slot` (alle neuen Befehle) | `SELECT … public.companies … FOR UPDATE` → `SELECT … public.contacts … FOR UPDATE` |

Kontaktzeile-zuerst gegen Kundenzeile-zuerst ist ein Zyklus. Gemessen auf `cf48560b`: **6 von 30** realen Schnellerfassung-gegen-`update_contact`-Rennen endeten mit `40P01`, zusätzlich **13 von 30** mit einem **rohen, unübersetzten `23505`** aus der Schnellerfassung, deren Demote+Insert überhaupt nicht gegen eine konkurrierende Beförderung serialisiert war. Die Invariante (höchstens ein Hauptansprechpartner je Kunde) hielt in allen Läufen — es war ein Verfügbarkeits- und Fehlerkontrakt-Defekt, kein Datenintegritätsdefekt. Deterministisch mit zwei echten Sitzungen reproduziert, auf PostgreSQL 15.8 **und** auf 17.6 (Production-Version).

**Entscheidung.** Die neuen Befehle behalten ihren Kundenlock; der **bestehende** Kern übernimmt dieselbe Disziplin über denselben Helfer `nora_private.lock_companies_for_primary_transition`: Kunde — und, bei einem hereinbewegten Kontakt, dessen aktueller Kunde — in aufsteigender Id-Reihenfolge sperren, **bevor** eine Kontaktzeile angefasst wird, mit derselben beschränkten Lese-/Sperr-/Nachlese-Schleife, die `public.update_contact` bereits benutzt. Verworfen: den Kundenlock aus den neuen Befehlen entfernen (macht die Transition wieder unserialisiert), Deadlock-Retry im Browser (versteckt die Ursache), Advisory Locks (Zeilenreihenfolge genügt). Fachlich ändert sich an der Schnellerfassung nichts — nur die Reihenfolge der Sperren. Nach dem Fix: **0 Deadlocks und 0 rohe `23505`** in 30 Rennen (15.8 und 17.6) sowie in je 60 Cross-Command-Rennen.

**Durable Regel (in dieser Form überholt — siehe den zweiten Nachtrag).** Ein Lock-Vertrag gilt nur, wenn *jeder* Pfad ihn einhält; neue Pfade werden in `supabase/tests/contact_primary_cross_command_runner.ps1` (Matrix X-A..X-G) gegen die bestehenden gerennt, nicht nur gegen ihresgleichen. Die damals formulierte Fassung „zuerst die Kundenzeile sperren" hat die nächste Review widerlegt: Trigger- und FK-Pfade sperren die Kundenzeile unvermeidbar kontaktzeilen-zuerst. Es gilt die Advisory-Regel aus Entscheidung 4.

**Nachtrag 2026-09-08 (zweiter Blocker-Fix, RC `0fb3d6ba`).** Die unabhängige Delta-Review des RC `b161a4f9` reproduzierte einen **zweiten** release-blockierenden Deadlock. Der erste Fix hatte *Funktionen* inventarisiert, aber keine *Trigger*.

`nora_private.sync_individual_company_name` ist ein `after update of first_name, last_name on public.contacts`-Trigger, der `update public.companies` ausführt. Er läuft **innerhalb** eines Kontakt-`UPDATE`, das die Kontaktzeile bereits hält — also kontaktzeilen-zuerst, konstruktionsbedingt und nicht umsortierbar. Gegen die kundenzeilen-zuerst arbeitenden Befehle ist das ein Zyklus:

```
A: update public.contacts set first_name = …   -- hält Kontakt S, Trigger will Kunde C
B: select public.companies … for update        -- hält C, will dann S
=> 40P01
```

Gemessen auf `b161a4f9`: **30 von 30** realen Rennen endeten im Deadlock — deutlich häufiger als der erste Blocker. Deterministisch mit zwei echten Sitzungen reproduziert, auf PostgreSQL 15.8 **und** 17.6. Die Invariante hielt durchgehend; es war erneut ein Verfügbarkeits- und Fehlerkontrakt-Defekt (40P01 ist kein Nora-Fehlercode und landet in der generischen Meldung, die diese Welle gerade beseitigen soll).

**Produktiv erreichbar** über eine reale Funktion: „Kontakte zusammenführen" (`ContactMergeButton` → `dataProvider.mergeContacts`) sendet ein rohes, absichtsloses `PATCH` auf `contacts` mit `first_name`/`last_name`, das der Provider bewusst **nicht** über `public.update_contact` leitet. Ist der Gewinnerkontakt der Selbstkontakt einer Privatkundenakte und ändert gleichzeitig jemand den Hauptansprechpartner desselben Kunden, deadlockt es.

**Entscheidung.** Nicht „noch einen Kundenlock ergänzen", sondern den Mutex wechseln: `nora_private.lock_companies_for_primary_transition` (Zeilensperre) wird durch `nora_private.lock_customers_for_primary_transition` (transaktionsgebundener Advisory Lock je Kunde) ersetzt und gelöscht. Alle Aufrufer bleiben unverändert. Verworfen: den Trigger abschalten oder deferren (die Privatkunden-Namenssynchronisation ist eine durable Invariante, kein Komfort), Deadlock-Retry oder 40P01-Übersetzung im Client (verdeckt die Ursache), `lock_timeout`/`SKIP LOCKED` (verändert die Geschäftssemantik).

**Beweis, beide PostgreSQL-Versionen.** HIGH #1 bleibt geschlossen (X-Matrix grün; der zurückgewiesene `cf48560b`-Kern lässt dieselbe Matrix weiterhin laut scheitern). HIGH #2 ist geschlossen (neue T-Matrix grün; der zurückgewiesene Zeilensperren-Mutex lässt sie mit 19–20 Deadlocks je 30 Rennen scheitern). Beide direkten Renn-Harnische: 30/30 sauber, vorher 6/30 bzw. 30/30 Deadlocks. Die Privatkunden-Namenssynchronisation ist unverändert erhalten und wird nach jedem Rennen geprüft.

**Nicht Teil dieser Entscheidung.** Die Markierungen-RC (separater Stand, integriert später auf diesen `main`), die fehlerhafte Dashboard-Abfrage `contacts?id=in.(1,1,,29,)` (`17-known-issues-and-planned-waves.md` G.3), Storage/Attachments, der globale `PUBLIC`-EXECUTE-Default für Functions (A.8), MCP, Google Kalender, Mitarbeiter-Lifecycle.

---

## 2026-09-07 – Security Hardening Wave 1: Default-Privilegien des `public`-Schemas und explizite Zielmatrix

**Status:** `PRODUCTION VERIFIED` (2026-09-07; Migration `20260907120000_nora_public_privilege_hardening` live, **DB-only** — kein Edge-Deploy, kein Frontend-Deploy). Guardrails: `22-security-and-access.md` Abschnitt 6 (Database Enforcement); Release-Evidenz und Runbook: `releases/2026-09.md` (Eintrag Security Hardening Wave 1).

**Durables Ergebnis.** Von `postgres` neu erzeugte Tabellen in `public` erben keine API-Rollen-Rechte mehr; die 27 bestehenden `public`-Relationen tragen eine explizite Zielmatrix; keine API-Rolle hält dort noch `TRUNCATE`, `REFERENCES`, `TRIGGER` oder `MAINTAIN`; `service_role` hat nirgends in `public` direktes `DELETE`; `nora_calendar_linker` hat kein dauerhaftes `CREATE ON SCHEMA public` mehr; alle Capability-Rollen samt Spalten-Grant `sales.email` sind unverändert erhalten. **Nicht** gelöst und ausdrücklich außerhalb dieser Entscheidung: der eingebaute `PUBLIC`-EXECUTE-Default für neue Functions und Schema `storage` (siehe unten sowie `17-known-issues-and-planned-waves.md` A.8/A.9).

**Kontext.** Wave 0 (2026-09-04) entzog `TRUNCATE` auf `audit_events` und benannte dabei die eigentliche Ursache, ohne sie zu beheben: die Default-Tabellen-Privilegien von `public` (Grantor `postgres`) geben jeder **neu erzeugten** Tabelle vor jedem expliziten `GRANT` Rechte an `anon`, `authenticated` und `service_role` — in Production `Dxtm` (`TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`), lokal auf PostgreSQL 15 sogar `arwdDxt`. Eine additiv geschriebene Migration (`grant select`) lässt dieses Erbe stehen.

Unabhängig nachgewiesen (2026-09-07): auf der Basis vor dieser Welle war `set role authenticated; truncate public.sales cascade;` lokal **erfolgreich** und kaskadierte in `companies`, `contact_notes`, `contacts`, `deal_notes`, `deals`, `tasks`, `checklist_runs`, `checklist_run_items` und `google_calendar_events` — RLS vollständig umgangen, keine Row-Trigger, keine Audit-Zeile —, während ein normales `delete from public.sales` verweigert wurde. In Production (read-only gemessen) hielt `authenticated` `TRUNCATE` auf **17** von 21 Basistabellen, `service_role` auf **20**, dazu alle drei Rollen auf vier Views; insgesamt 196 unerwünschte Privilegien-Treffer.

**Entscheidungen.**

1. **Sichere Defaults statt hoffnungsvoller Revokes.** `alter default privileges for role postgres in schema public revoke all on tables/sequences from anon, authenticated, service_role` (und `revoke execute on functions`). Eine neue Tabelle in `public` startet damit **ohne jedes** API-Rollen-Recht; Laufzeitzugriff entsteht nur noch durch einen bewussten `GRANT`. Verworfen: die Defaults großzügig lassen und darauf vertrauen, dass jede künftige Migration `revoke all` voranstellt — genau das ist historisch schiefgegangen.
2. **Explizite Zielmatrix statt gewachsener ACL.** `authenticated` erhält exakt die Operationen, die seine RLS-Policies ausdrücken (dadurch entfallen u. a. das unerreichbare `INSERT` auf `sales` und `DELETE` auf `checklist_*`/`saved_text_snippets`, für die es nie eine DELETE-Policy gab). `anon` behält nichts außer `SELECT` auf `init_state` (die Vor-Login-Prüfung `authProvider.getIsInitialized()`). Der aktuelle Production-ACL ist **nicht** automatisch der gewünschte ACL — er enthält den Defekt.
3. **`service_role` verliert `DELETE` überall, nicht nur auf `sales`.** Im gesamten `supabase/functions`-Baum (deployt **und** nicht deployt) existiert kein einziges `.delete()` gegen eine `public`-Tabelle; `merge_contacts` läuft über eine eigene `SUPABASE_DB_URL`-Verbindung, nicht über `service_role`; der einzige unterstützte Kontolöschpfad läuft seit W6-B als `postgres` in `nora_private.guard_auth_user_delete`, und `guard_sales_delete` verweigert ein direktes `service_role`-`DELETE` ohnehin. Die W2-Begründung „`service_role` behält `DELETE` für den künftigen Executor" ist damit überholt — der Executor existiert und ist nicht `service_role`. `audit_events` verliert zusätzlich `UPDATE` (append-only; `prevent_audit_events_update/_delete` verweigern es bereits). Nicht entzogen wurden `SELECT`/`INSERT`/`UPDATE` von `service_role` dort, wo eine Edge Function sie belegt — „`service_role` ist vertrauenswürdig" ist keine ausreichende Begründung, ein belegter Aufrufer schon.
4. **`nora_calendar_linker` verliert `CREATE ON SCHEMA public`.** Das Recht stammt aus `20260717120000` und war nur nötig, damit `alter function … owner to nora_calendar_linker` durchläuft (Postgres verlangt `CREATE` im Schema vom neuen Owner). Lokal bewiesen: nach dem Entzug bleiben Ownership und Ausführung der beiden `SECURITY DEFINER`-Link-Functions intakt, `create or replace` durch `postgres` funktioniert weiter, und die Rolle kann keine Objekte mehr in `public` anlegen. Die Google-Kalender-Grundlage (Rolle, Tabellen, RPCs) bleibt vollständig erhalten — sie ist nur nicht deployt, nicht abgeschafft. **Muster für später:** `CREATE` innerhalb der Migration gewähren, Ownership übertragen, vor Ende der Migration wieder entziehen — nie dauerhaft stehen lassen.
5. **Lokal und Production konvergieren.** Die Migration ist so geschrieben, dass sie beide Ausgangszustände auf dasselbe Ziel bringt (`revoke all` → gezielter `grant`), und benennt `MAINTAIN` nirgends im DDL — dadurch parst und läuft **eine** Datei auf PostgreSQL 15 (lokal) und 17 (Production). Nur die Assertions verzweigen über `server_version_num`. Ein lokaler `db reset` ist damit erstmals nicht mehr großzügiger als Production.
6. **`supabase/schemas/06_grants.sql` wird angeglichen, nicht aktiviert.** Die Datei wird von keinem `db reset` ausgeführt (`config.toml` konfiguriert kein `[db.migrations] schema_paths`), deklarierte aber `grant all on table … to anon` und die schädlichen Default-Privilegien. Sie wird auf die Zielmatrix gebracht und trägt jetzt im Kopf, dass **Migrationen autoritativ sind** und Privilegienfragen gegen die Datenbank zu prüfen sind. Verworfen: `schema_paths` aktivieren (eigene Build-System-Änderung) und die Datei löschen (die Repo-Konvention hält `01`–`06` bewusst synchron).

**Begründung.** Ein Privileg, das keine Laufzeit belegt, ist kein Sicherheitsnetz, sondern nur Angriffsfläche — und `TRUNCATE` ist der Fall, in dem RLS und Audit-Trigger gleichzeitig wirkungslos sind. Die Ursache an den Default-Privilegien zu beheben ist der einzige Weg, der auch für Tabellen gilt, die es noch nicht gibt; eine kanonische Regressionsprobe (`supabase/tests/public_privilege_hardening_verification.sql`) lässt einen Rückfall auffliegen, statt ihn erneut zufällig entdecken zu lassen.

**Nicht Teil dieser Welle.** Schema `storage` (anderer Owner, andere Plattformmechanik, eigener Rollback-Pfad), die nicht deployte `mcp` Edge Function, der öffentliche Attachment-Bucket, und die von PostgreSQL eingebaute `PUBLIC`-EXECUTE-Vorgabe für **neue Functions**. Zu Letzterer (korrigiert 2026-09-07 durch die unabhängige Zertifizierung): das schema-scoped `revoke execute on functions` dieser Migration entfernt den eingebauten `PUBLIC`-Default **nicht** — entfernbar wäre er nur über eine **creator-scoped globale** Default-Privilegien-Zeile ohne `in schema`, die diese Welle bewusst nicht setzt. Neue Functions bleiben daher `PUBLIC`-ausführbar; die wirksame Maßnahme ist unverändert der explizite `revoke` pro sensibler Function (`17-known-issues-and-planned-waves.md` A.8).

---

## 2026-09-07 – User Lifecycle W6-B: Kontrollierter Hard Delete („Benutzerkonto endgültig löschen")

**Status:** `PRODUCTION VERIFIED` (2026-09-07; Migration `20260906230000_nora_lifecycle_account_deletion` live, `users`-Edge v9, Frontend; Live-Beweis am Testkonto `sales.id = 4`, Release-Evidenz im Archiv `releases/2026-09.md`). Aktueller Vertrag: `19-user-lifecycle-architecture.md` §15; Guardrails: `22-security-and-access.md` Abschnitt 8.2 (Executor-Integrität) und `03-data-model-guardrails.md` §2.2 (Referenzintegrität); Release-Evidenz und Runbook: `releases/2026-09.md` (Eintrag W6-B).

**Kontext.** Seit W2 war ein unreferenzierter Mitarbeiter technisch nur für `postgres`/`service_role` per SQL löschbar; ein unterstützter Produktpfad fehlte, und ein versehentlich angelegtes oder Test-Konto (Production: `sales 4`, eingeladen, nie aktiviert, deaktiviert, gebannt, null Referenzen) konnte nicht entfernt werden. Gegen das reale GoTrue 2.196 wurde erneut bewiesen: der Admin-Hard-Delete läuft mit GoTrues Audit-Insert in **einer** Postgres-Transaktion; solange die `sales`-Zeile existiert, scheitert er am `NO ACTION`-FK (500, nichts verändert); ein `BEFORE DELETE`-Trigger auf `auth.users` läuft in dieser Transaktion, eine Exception rollt alles zurück, ein darin ausgeführtes `DELETE FROM public.sales` committet mit; die sechs W2-FKs brechen die gesamte GoTrue-Transaktion ab (Nora-Audit-Zeile und GoTrue-Audit-Zeile teilen dieselbe `xmin`).

**Entscheidungen.**

1. **Hard Delete ist Ausnahme, Offboarding bleibt der Normalweg.** Löschbar ist nur eine Identität, die **nie** durabler Geschäfts-/Historienzustand wurde: all-time null in allen sechs W2-Tabellen (archivierte Vorgänge, erledigte Aufgaben, historische Notizen zählen) **und** keine durable Provenienz (authored `checklist_templates`/`saved_text_snippets`, `google_calendar_connections.connected_by`, `audit_events` als **Actor**). Audit-Zeilen als **Ziel** blockieren nie. Eine eigene Löschprüfung (`get_employee_deletion_preview`) — die W5-Preview („offen") wird nicht überladen.
2. **Zielzustand ist der W5-Zustand.** `disabled` **und** gebannt, Identität konsistent, kein Selbst-Delete, Actor aktiver Admin. Ein aktives oder eingeladenes Konto geht zuerst durch „Zugang beenden"; kein Sonderpfad. Restsitzungen eines deaktivierten+gebannten Kontos sind durch W6-A/Bann bereits wertlos und werden in der Löschtransaktion mitgezählt und entfernt.
3. **Option C: Ticket + `auth.users`-Guard, GoTrue ist der Treiber.** Zwei-Minuten-Ticket (`sale_id` + Auth-UUID + Entity + Identitäts-Snapshot + Actor + Operation-ID), GoTrue Admin Hard Delete, `guard_auth_user_delete` validiert alles erneut und löscht `sales`, Technikzustand und schreibt `user.account_deleted` **in GoTrues Transaktion**. Verworfen: „`sales` zuerst, Auth später" (Teilzustand), FK schwächen, Auth-Interna per SQL löschen, Orphan-Sweeper.
4. **Kein zweiter Löschpfad.** `guard_sales_delete` verweigert jedes direkte `DELETE` (auch `service_role`, Dashboard, `psql`); erlaubt nur mit lebendem Ticket im transaktionslokalen GUC **und** `pg_trigger_depth() >= 2`. `guard_auth_user_delete` verweigert Auth-Löschungen ohne Ticket — eine Dashboard-Löschung kann Nora-Zustand nicht mehr verwaisen lassen. Bestehende SQL-Suiten räumen `sales`-Fixtures nur noch per Rollback auf.
5. **Id-Wiederverwendung ist eingeplant, nicht behoben.** `sales.id` bleibt `GENERATED BY DEFAULT` (eigener Punkt A.7); Autorisierung bindet Auth-UUID + Entity + Snapshot, nie nur die Nummer.
6. **Audit-Wahrheit und Minimal-PII.** `user.account_deleted` nur in derselben Transaktion; Metadaten nur Ids und Zähler — **keine** Adresse, kein Name (Retention-Entscheidung bleibt geparkt). Historische Audit-Zeilen, GoTrues `user_deleted`-Zeile, `operation_errors` und `idempotency_records` bleiben. Kontolöschung ≠ DSGVO-Löschung; Nutzertext: „Das Nora-Benutzerkonto und die Anmeldeidentität werden endgültig gelöscht." — nie „alle personenbezogenen Daten".
7. **Schmale Purge.** `email_delivery_events` nur bei `employee_sale_id = sale` **und** Adresse aus der Identitätshistorie des Mitarbeiters; Fremdadressen bleiben und werden gezählt; keine allgemeine Retention.
8. **Bestätigung in Tiefe.** Getippter vollständiger Name (trim + Whitespace-Kollaps, case-sensitiv), serverseitig gegen die **aktuelle** Identität geprüft; bei Admin-Zielen zusätzliche Checkbox (auch serverseitig verlangt). Der Dialog nennt Name, Anmeldeadresse, Rolle, Zugangsstatus und alle sechs Zähler — die Lehre aus dem W5-Zwischenfall; der W5-Dialog selbst bleibt ein eigener UX-Punkt.
9. **Retry nach Evidenz.** `already_deleted` nur bei fehlender `sales`-Zeile **plus** committetem Ereignis; fehlende Zeile ohne Ereignis ist `not_found`; GoTrue-Fehler ohne Commit storniert das Ticket (`account_delete_provider_failed`, GoTrue verbirgt die Guard-Verweigerung hinter 500); Commit trotz verlorener Antwort zählt als `executed`. Kein Duplikat-Audit.
10. **Demo hat keinen Löschpfad** (`deletion.supported = false`, kein destruktives Element): kein vorgetäuschtes Sicherheitsmodell, Production-Code nicht geschwächt.
11. **Production-Löschung nur mit expliziter PO-Freigabe** des benannten Ziels (Kandidat `sales 4`); in der RC-Phase wurde nichts gelöscht.

**Begründung.** Nur die Datenbank kann Nora- und Auth-Identität zusammen committen oder zusammen verwerfen; der GoTrue-Hard-Delete ist der einzige unterstützte Weg, Auth-Kinder korrekt zu entfernen, und sein Trigger-Kontext ist der einzige Ort, an dem das ohne Teilzustand geht. Die all-time-Regel und der Actor-Blocker machen die Produktregel „echte Mitarbeiter werden nie gelöscht" technisch, nicht nur organisatorisch. Die Guards schließen den seit W2 offenen SQL-Seam, damit „kein zweiter Löschpfad" eine Datenbankaussage ist.

## 2026-09-06 – User Lifecycle W6-A: Session-Autorisierung fail-closed und Owner-gebunden

**Status:** `PRODUCTION VERIFIED` (2026-09-06; Laufzeit-SHA `401bb08b`, Migration `20260906210000_nora_lifecycle_session_authorization` live, nur Datenbank, keine sichtbare Änderung). Aktuelle Architektur: `19-user-lifecycle-architecture.md` §11. Release-Evidenz: `releases/2026-09.md` ([Nachtrag Release W6-A](releases/2026-09.md#2026-09-06--user-lifecycle-w6-a-session-autorisierung-fail-closed-und-owner-gebunden)).

**Kontext.** W5 band die Autorisierung an eine lebende Sitzung, ließ aber drei Schwächen bewusst offen. Alle drei wurden vor der Änderung lokal reproduziert (GoTrue 2.196, PostgREST 16, echte Sitzungen): ein JWT mit der lebenden Sitzung eines **anderen** Benutzers bestand die Existenzprüfung; ein malformed `session_id`-Claim (ungültiger String, JSON `null`, Zahl, Array) fiel auf den No-Claim-Pfad und wurde erlaubt; ohne Leserecht auf `auth.sessions` antwortete der Helfer mit `WARNING` „live".

**Entscheidungen.**

1. **Drei-Zustands-Vertrag statt „NULL = kein Claim".** `jwt_session_claim()` liefert `absent` \| `present` \| `malformed` plus „JWT übergeben". `present` autorisiert nur bei `auth.sessions.id = session_id` **und** `auth.sessions.user_id = sub`; `malformed` verweigert; jeder Lookup-Fehler verweigert (`WARNING` „session binding DENIED").
2. **Der Kompatibilitätspfad wird so eng wie praktikabel.** Ein von PostgREST übergebenes JWT (`request.jwt.claims` gesetzt) ohne `session_id` wird verweigert: PostgREST ≥ 9 setzt nur diese eine GUC (lokal v16.1, Production 14.5), jedes GoTrue-Benutzertoken trägt `session_id`, Token ohne `sub` (anon/service_role) erreichten die Daten ohnehin nie. Nur ohne jedes übergebene JWT (Legacy-Fixture-GUCs, `psql`, Trigger-Kontexte) bleibt das Vor-W5-Verhalten — über die API unerreichbar. Keine neue Auth-Schicht, keine Session-Checks in einzelnen Policies.
3. **Fail-closed braucht ein Gate, keinen Monitor.** Die Migration verweigert die Installation, wenn `postgres` `auth.sessions` nicht lesen kann (Privileg **und** Lookup-Probe), und testet den Vertrag vor dem Commit selbst. `nora_private.session_binding_health()` ist ein postgres-interner Gesundheitsprimitive ohne Sitzungsdaten für Suites, Runbook und Störungsdiagnose — **kein** Admin-Browser-RPC (ein Admin könnte ihn bei gebrochener Bindung nicht mehr autorisieren) und keine Edge-Änderung.
4. **JSON `null` ist malformed, nicht absent.** GoTrue emittiert nie `null`; ein vorhandener, unbrauchbarer Claim wird nicht stillschweigend als Abwesenheit gewertet.
5. **Fixtures modellieren echte Sitzungen.** Suites, die den API-Pfad (`request.jwt.claims`) spielen, legen eine `auth.sessions`-Zeile an (Konvention: Sitzungs-ID = User-ID); Suites mit reinen Legacy-GUCs bleiben als dokumentierter „kein JWT übergeben"-Kontext unverändert.
6. **Kein Hard Delete in dieser Welle** (W6-B getrennt: irreversible Funktion und CRM-weite Autorisierungsänderung teilen sich keine Migration).

**Begründung.** Die Sicherheitsinvariante „eine Sitzung autorisiert nur ihren Besitzer" ist nur mit Owner-Vergleich und Fail-closed vollständig; die Kosten sind ein Spaltenvergleich im bestehenden PK-Lookup. Der breite No-Claim-Pfad war eine Kompatibilitätsvermutung, keine Notwendigkeit — nach dem Beweis, dass echte Tokens immer `session_id` tragen, ist sein Erhalt für transportierte JWTs reines Restrisiko.

## 2026-09-06 – User Lifecycle W5: kontrolliertes Offboarding, Session-Revokation, Abhängigkeits-Preview

**Status:** `PRODUCTION VERIFIED` (2026-09-06). Archiv: `releases/2026-09.md` ([Original](releases/2026-09.md#2026-09-06--user-lifecycle-w5-kontrolliertes-offboarding-session-revokation-abhängigkeits-preview)). Aktuelle Architektur: `19-user-lifecycle-architecture.md` §11–§14.

**Kontext.** Deaktivieren (W1) beendete keine Sitzungen: GoTrue hat keinen Admin-Logout, PostgREST prüft nie, ob die im JWT genannte Sitzung existiert — ein vor dem Deaktivieren ausgestelltes Token bekam mit der Reaktivierung für seine Restlaufzeit wieder Datenzugriff (lokal bewiesen).

**Entscheidungen.**

1. **Offboarding ist eine eigene Geschäftsoperation, kein PATCH.** „Zugang beenden" = kein operativer Zugang mehr; Person, Historie, Referenzen bleiben; nichts wird gemailt. Ein Serverpfad: `users` Edge → `offboard_employee_by_executor` → W1-Capability + Sitzungslöschung + Audit in **einer** Transaktion → Bann → Verifikation. Kein paralleles Subsystem.
2. **Offene Zuständigkeiten blockieren nie.** Sie werden gezählt (Kunden, Kontakte, offene Vorgänge, offene Aufgaben; Notizen getrennt als Urheberschaft) und als dauerhafter Block „Offene Zuständigkeiten" in jedem Zugangszustand gezeigt — auch bei null. Keine Massen-Umverteilung.
3. **Sitzungen sind Teil der Autorisierung.** Die RLS-Helfer (`is_active_user`, `current_role`) verlangen, dass die im JWT genannte Sitzung in `auth.sessions` existiert; Tokens ohne Claim und `service_role` unverändert. Fail-open nur bei fehlendem Leserecht (dokumentierte, nicht angreiferseitig erreichbare Einschränkung) — **in W6-A geschlossen** (siehe Eintrag oben).
4. **Idempotenz über `disposition`, nicht über Zustandsfelder.** `executed` schreibt genau ein `user.offboarded`; `replayed` ändert und schreibt nichts. Kein `offboarded_at`, kein fünfter Zugangsstatus.
5. **Reaktivierung bleibt W1**; alte Sitzungen kommen nicht zurück, neue Anmeldung nötig. Kein `p_reason` (Freitext im Audit wäre Retentions-relevant).

**Begründung.** Ein Bann stoppt neue Token, nicht laufende; nur die Datenbank kann ein unverfallenes JWT wirksam entwerten. Offboarding als eigene Aktion mit Preview verhindert, dass Zuständigkeiten stillschweigend verwaisen oder ein Zugang aus „Rücksicht" aktiv bleibt.

## 2026-09-06 – User Lifecycle W4: kontrollierte Änderung der Anmeldeadresse (Login-Identität)

**Status:** `PRODUCTION VERIFIED` (2026-09-06). Archiv: [Original](releases/2026-09.md#2026-09-06--user-lifecycle-w4-kontrollierte-änderung-der-anmeldeadresse-login-identität). Architektur: `19-user-lifecycle-architecture.md` §9.

**Kontext.** Eine Auth-E-Mail-Änderung scheiterte am Privileg-Trigger (`sales.email is immutable`) — fail closed, aber kein unterstützter Weg. Zusätzlich (GoTrue-Fakt, bewiesen): ein an die alte Adresse gesendeter Einladungs-/Passwort-Link blieb nach A→B gültig und aktivierte das Konto unter B.

**Entscheidungen.**

1. **`auth.users.email` ist die Auth-Identität; `sales.email` ist ihr Spiegel mit genau einem Schreiber** (`guard_auth_email_change`, Capability-Owner `nora_identity_manager`, darf nur `email`). `handle_update_user` schreibt keine E-Mail mehr.
2. **Ticket + Guard statt verteilter Transaktion.** `prepare_sales_email_change` prüft alles vorab und legt ein kurzlebiges Ticket an; GoTrues eigenes `UPDATE auth.users` wird ohne Ticket verweigert — auch mit Service-Key, Selbstbedienung oder Dashboard. Mit Ticket: `sales.email`, Löschung aller `auth.one_time_tokens`, Audit in derselben Transaktion.
3. **Zugang und Identität sind orthogonal.** Eine E-Mail-Änderung aktiviert/deaktiviert nie; Eingeladene bekommen eine neue Einladung, Deaktivierte nichts.
4. **Normalisierung ist Provider-Contract** (`lower(btrim())`, citext, `uq__sales__email`, Eindeutigkeit gegen `sales` und `auth.users`).
5. **Selbständerung blockiert** (Lockout-Schutz); **kein generischer PATCH für die E-Mail** (`email_change_requires_command`); Erfolg nur nach Verifikation; Retry = typisiertes No-op.

**Begründung.** Zwei Speicher für eine Identität dürfen nie auseinanderlaufen; das geht nur, wenn der Provider-Write selbst durch Noras Guard läuft. Alte Links müssen mit der Adresse sterben, sonst aktiviert der falsche Empfänger das Konto.

## 2026-09-05 – User Lifecycle W3: der echte Administrator steht im Audit, der Mitarbeiter hat eine stabile Audit-Identität

**Status:** `PRODUCTION VERIFIED` (2026-09-06). Archiv: [Original](releases/2026-09.md#2026-09-05--user-lifecycle-w3-der-echte-administrator-steht-im-audit-der-mitarbeiter-hat-eine-stabile-audit-identität). Architektur: `19-user-lifecycle-architecture.md` §10, `13-crm-audit-retention.md`.

**Kontext.** Alle Lifecycle-Audit-Zeilen trugen Actor `System` (die Edge Function spricht als `service_role` ohne `sub`), und die Edge-eigenen Ereignisse hatten zufällige `entity_id`s.

**Entscheidungen.**

1. **Actor ≠ Ziel ≠ Operation** sind drei getrennte Fakten: `actor_*` (wer), `entity_id = nora_entity_uuid('sales', id)` (welcher Mitarbeiter, stabil), `request_id` (welche Ausführung, Operation-ID).
2. **Actor-Bridge statt neuem Audit-System.** Unter `service_role` löst `resolve_audit_actor()` den vom Executor transaktionslokal verankerten, verifizierten Admin aus `public.sales` auf; verankern darf nur der privilegierte Executor (`pin_audit_context`). Eine verankerte Nicht-Existenz bricht hart ab — nie stille Degradierung zu „System", nie eine behauptete Person.
3. **Ein schmaler Writer** (`record_employee_admin_event`, Ereignistyp-Allowlist, Metadaten aus der DB) statt generischer Schreibfähigkeit; nie `insert_audit_event` + `crypto.randomUUID()`.
4. **`System` bleibt gültig** für echte Automation (unverankerte `service_role`-Writes).
5. **Historie bleibt unverändert** (append-only, kein Backfill) — alte Zeilen sind wahre Aufzeichnungen der alten Implementierung.
6. **Audit-Fehler nach Provider-Erfolg → `audit_write_failed`, nie grün.** Kein Audit ohne Änderung, keine Änderung ohne Audit.

## 2026-09-05 – User Lifecycle W2: Referenzintegrität und historische Identität

**Status:** `PRODUCTION VERIFIED` (2026-09-05). Archiv: [Original](releases/2026-09.md#2026-09-05--user-lifecycle-w2-referenzintegrität-und-historische-identität). Architektur: `19-user-lifecycle-architecture.md` §7–§8, `03-data-model-guardrails.md` §2.2.

**Kontext.** `contact_notes.sales_id` war `ON DELETE CASCADE` (Mitarbeiter löschen = Notizen still löschen), `tasks.sales_id` hatte keinen FK, und der einzige Namens-Lookup filterte deaktivierte Mitarbeiter weg (leere Namen, Export-Crash).

**Entscheidungen.**

1. **Produktregel:** ein echter Mitarbeiter mit Geschäftshistorie wird **offboarded, nicht hart gelöscht**. Hard Delete ist nur für Fake-/Versehens-/Testkonten ohne Referenzen (späterer Executor).
2. **INAKTIV / ARCHIVIERT ist nicht NICHT-EXISTENT** (Nora-Domänenregel, in W2 für Mitarbeiter umgesetzt, perspektivisch für Kunden/Kontakte/Vorgänge; kein generisches Archiv-Framework).
3. **Alle Referenzen auf `sales.id` sind `NO ACTION`-FKs** — nie `CASCADE`, nie `SET NULL`. Die Datenbank blockiert das Löschen referenzierter Identitäten auf jedem Pfad; Browser-Rollen können nie löschen.
4. **Zwei Read-Models:** `sales_directory` (aktiv, Zuweisung) und `sales_identities` (alle, historische Namen). Deaktivierte behalten ihren echten Namen; kein „Unbekannt"/„Ehemalig".
5. **Aktive Zuweisung ist autoritativ** (Hardening): Trigger auf `companies`/`contacts`/`deals`/`tasks` verweigert Neuzuweisung an Deaktivierte (`NORA_EMPLOYEE_NOT_ASSIGNABLE`); Notiztabellen (Urheberschaft) bewusst nicht.
6. Legacy-RPC `set_sales_role_by_admin` gelöscht (kein Aufrufer).

**Begründung.** Geschäftsdaten müssen den Mitarbeiter-Lebenszyklus überleben; Urheberschaft und Zuständigkeit sind Geschäftsgeschichte. Ein Snapshot nur zur Rechtfertigung von `SET NULL` wäre Doppelhaltung.

## 2026-09-05 – User Lifecycle W1: ein privilegierter Executor, Selbst-/Letzter-Admin-Schutz, Zugangskonsistenz

**Status:** `PRODUCTION VERIFIED` (2026-09-05). Archiv: [Original](releases/2026-09.md#2026-09-05--user-lifecycle-w1-ein-privilegierter-executor-selbst-letzter-admin-schutz-zugangskonsistenz). Architektur: `19-user-lifecycle-architecture.md` §5–§6.

**Kontext.** Es gab zwei Wege, `sales.role`/`sales.disabled` zu ändern (Edge Function und eine für `authenticated` ausführbare RPC); ein Admin konnte sich selbst deaktivieren, null aktive Admins waren möglich, und Production hatte genau eine Zugangs-Drift (deaktiviert ohne Bann).

**Entscheidungen.**

1. **Genau ein normaler privilegierter Pfad:** Admin-UI → `users` Edge → `set_sales_access_by_executor` (nur `service_role`) → Capability-Funktion. Browser können die RPC nicht ausführen.
2. **Verifizierter Actor-Kontext statt geratener Identität:** die Edge Function verifiziert das JWT und übergibt nur die User-ID; der Executor akzeptiert nur einen existierenden aktiven Admin — der Parameter kann Rechte nur verengen.
3. **Selbstschutz serverseitig, zweifach** (Edge und Datenbank); Re-Sync unveränderter Werte bleibt erlaubt.
4. **Letzter aktiver Administrator ist eine Datenbank-Invariante** (Trigger, Advisory-Lock, jeder Schreibpfad). Genau ein Admin genügt. Der Auth-Bann ist nicht Teil der Definition (Fremdsystem-Zustand).
5. **Zugangskonsistenz als eigener Fakt** (`accessConsistency`), kein fünfter Zustand; eine Reparatur „Zugangsstatus synchronisieren".
6. **Reihenfolge:** Datenbank → Auth-Bann → beide Fakten erneut lesen; Teilausfall meldet `employee_access_sync_incomplete`, nie grün; Retry konvergiert. Bewusst keine verteilte Transaktion.

## 2026-09-04 – Security Hardening Wave 0: TRUNCATE auf `audit_events` entzogen

**Status:** `PRODUCTION VERIFIED` (2026-09-04). Archiv: [Original](releases/2026-09.md#2026-09-04--security-hardening-wave-0-truncate-auf-audit_events-entzogen).

**Kontext.** `authenticated` besaß `TRUNCATE` (plus `REFERENCES`/`TRIGGER`/`MAINTAIN`) auf `audit_events` — geerbt aus den Default-Privilegien des Schemas `public`, weil Migrationen nur additiv `grant select` schrieben. `TRUNCATE` umgeht RLS und feuert keine Row-Trigger; die gesamte Historie war mit einer Anweisung löschbar.

**Entscheidungen.**

1. `authenticated` auf `audit_events` = **genau `SELECT`** (`revoke all` → `grant select`, `revoke all from public/anon`).
2. **Guardrail: immer `revoke all` vor `grant`** — ein additives `grant` lässt geerbte Rechte stehen.
3. **Guardrail: ein lokaler `db reset` reproduziert Production nicht** (lokal `grant all` in den Default-Privilegien, live `Dxtm`) — Privilegienaussagen gegen Production prüfen; Migrationen müssen in beiden Umgebungen denselben Endzustand erzwingen.
4. `service_role` behält `TRUNCATE` (bewusst akzeptiertes Restrisiko; Retention-Pfade); die schemaweiten Default-Privilegien bleiben ein eigener Folgebefund (`17-known-issues-and-planned-waves.md`).

> **Abgelöst am 2026-09-07 durch Security Hardening Wave 1.** Punkt 4 gilt nicht mehr: `service_role` hat auf `audit_events` weder `TRUNCATE` noch `UPDATE` noch `DELETE`, und der als Folgebefund vermerkte Default-Privilegien-Defekt ist behoben. Punkte 1–3 gelten unverändert weiter. Aktueller Vertrag: `22-security-and-access.md` Abschnitt 6 und `13-crm-audit-retention.md`.

## 2026-09-04 – Employee Access V1C-B: Zustellstatus wird gezeigt, die Mailart nicht

**Status:** `PRODUCTION VERIFIED` (2026-09-04). Archiv: [Original](releases/2026-09.md#2026-09-04--employee-access-v1c-b-zustellstatus-wird-gezeigt-die-mailart-nicht). Technischer Vertrag: `18-email-delivery-observability.md`.

**Entscheidungen.** Die Mailart wird **nie gerendert** (Best-Effort-Korrelation trägt keine Aussage über *einen* Sendeversuch); Zustellstatus ist dem Zugangszustand **untergeordnet** (eine gedämpfte Zeile, keine Status-Pille, kein Dashboard); **ohne Historie erscheint nichts** (auch bei Ladefehler oder fehlender Berechtigung); kein geratener Betreff-Matcher (stattdessen ein inhaltsfreies `subject_present`-Diagnosebit); Zeiten in `Europe/Berlin`. Deterministische Sendekorrelation, Brevo-API-Versand, Öffnungs-/Klick-Tracking und feinere `undeliverable`-Unterscheidung sind geparkt.

## 2026-09-04 – Employee Access V1C-A: Zustellbeobachtung ist Best-Effort-Korrelation, kein Öffnungs-Tracking

**Status:** `PRODUCTION VERIFIED` (2026-09-04). Archiv: [Original](releases/2026-09.md#2026-09-04--employee-access-v1c-a-zustellbeobachtung-ist-best-effort-korrelation-kein-öffnungs-tracking). Vertrag: `18-email-delivery-observability.md`.

**Entscheidungen.**

1. Absender `Nora <zugang@nora.ergart.de>` über Brevo als Supabase-Auth-SMTP; **kein eigenes Auth-Mailsystem**.
2. **Korrelation ist `BEST_EFFORT` und steht in den Daten** (Zuordnung über die Empfängeradresse; GoTrue erlaubt keinen Nora-Korrelationswert). Deterministisch nur über den Send Email Hook — eigene Architekturentscheidung, nicht getroffen.
3. **Kein Öffnungs-/Klick-Tracking** (Endpunkt verwirft, CHECK verhindert) — Betriebsbeobachtung, keine Mitarbeiterüberwachung.
4. **Providerneutraler Vertrag** (`EMAIL_ACCEPTED` … `EMAIL_SPAM_REPORTED` → `accepted/delayed/delivered/undeliverable/spam_reported`); Produktwahrheit „angefordert ≠ angenommen ≠ zugestellt"; Reihenfolge nach Provider-Zeitstempel, Duplikate per `dedupe_key`.
5. Webhook-Auth über dedizierten Bearer-Token (nie den Brevo-API-Key); `email_delivery_events` append-only, Admin-Leserecht, weiche `employee_sale_id` + Adress-Snapshot, kein Inhalt/Betreff/Token.
6. **Audit-Grenze:** Transportereignisse landen nie in `audit_events`.
7. Nachtrag Review: Brevo nutzt zwei Vokabulare (Abo-Enum camelCase vs. Nutzlast snake_case) — beide akzeptieren, unbekannte Werte diagnostisch loggen, nie raten; `provider_reason` begrenzt speichern.

## 2026-09-04 – Employee Onboarding & Access V1B: Präsentation über dem eingefrorenen V1A-Contract

**Status:** `PRODUCTION VERIFIED`, PO UX accepted (2026-09-04). Archiv: [Original](releases/2026-09.md#2026-09-04--employee-onboarding--access-v1b-präsentation-über-dem-eingefrorenen-v1a-contract). Gestaltung: `02-design-system.md` „Mitarbeiter-Onboarding & Zugang".

**Entscheidungen.** Präsentation berührt keine Semantik (Zustandsmaschine, Auth, Routen, Edge unverändert; Erfolgs-Mark nur im Reducer-Zustand `complete`); drei menschliche Schritte (Zugang → Passwort → Profil, Abschluss ist Erfolgszustand); Begrüßung nur aus der Session, nie aus URL-Parametern; Profilschritt sagt „Passwort gespeichert", kein Weg zurück vor das Passwort; Einmalcode nur für die Einladung; Fehler inline, nie als Toast; Admin-Status als Pill, ein Schreibpfad; Demo-Simulation bleibt im Code (nur `VITE_IS_DEMO`, nicht im Production-Bundle).

## 2026-09-04 – Employee Onboarding & Access V1A: Zugangsstatus wird abgeleitet, nicht gespeichert

**Status:** `PRODUCTION VERIFIED` (2026-09-04). Archiv: [Original](releases/2026-09.md#2026-09-04--employee-onboarding--access-v1a-zugangsstatus-wird-abgeleitet-nicht-gespeichert). Architektur: `19-user-lifecycle-architecture.md` §4.

**Entscheidungen.**

1. **Kein redundantes Statusfeld** — der Zugangsstatus wird aus Supabase Auth und `sales.disabled` abgeleitet; keine Migration.
2. **Vier Zustände** `invited | active | disabled | unknown`; `unknown` bietet keine Aktion (eine Einladung würde eine zweite Identität erzeugen).
3. **`last_sign_in_at` ist kein Zustandssignal**; nur die E-Mail-Bestätigung trennt „Link benutzt" von „nicht benutzt".
4. **Zwei getrennte Admin-Aktionen** („Einladung erneut senden" nur für `invited`, „Passwort einrichten lassen" nur für `active`); der Admin sieht nie Token oder Passwort.
5. **GoTrue-Semantik explizit behandelt:** `email_exists` ist Beweis eines veralteten abgeleiteten Zustands (`action_not_applicable`), nie ein zweiter Datensatz.
6. **`/auth-callback` gehört react-admin** — Nora besitzt `/zugang-einrichten` für Einladung und Recovery.
7. **WELCOME behauptet nichts, COMPLETE ist bewiesen** (Zustandsmaschine mit vier Vorbedingungen; Deaktivierte landen in `blocked`); Begrüßungsdaten nur aus der authentifizierten Identität; `sales.disabled` und Auth-Bann werden immer gemeinsam gesetzt; kein Einmalcode-Versprechen in der Passwort-Mail.
8. Nachtrag: die öffentliche Selbstregistrierung war in Production aktiv (Bestandsproblem) und wurde vom Product Owner deaktiviert (`disable_signup: true`, nachgewiesen) — Nora ist einladungsbasiert.

## 2026-09-01 – Customer Create Speed & Clarity: Land ausgeblendet, Bundesland NRW, „Weitere Angaben" eingeklappt

**Status:** released (2026-09-01, auf `main`, live). Archiv: [Original](releases/2026-09.md#2026-09-01--customer-create-speed--clarity-land-ausgeblendet-bundesland-nrw-weitere-angaben-eingeklappt).

**Entscheidungen.** „Land" ist auf `/kunden/create` kein sichtbares Feld; der Mapper setzt den kanonischen Bestandswert `"Deutschland"` (kein neuer Wert, keine DB-Änderung). „Bundesland" startet mit `"NRW"`, frei überschreibbar. Create/Edit explizit über `CompanyInputs variant="create" | "default"` getrennt — Edit zeigt Land weiterhin und überschreibt nie gespeicherte Werte. Progressive Disclosure („Weitere Angaben") nur im Create-Flow; Adresse in deutscher Lesereihenfolge. **Begründung:** der Standardfall (deutscher Kunde in NRW) braucht null Zusatzeingaben; der Default liegt im Application-Layer, damit die Persistenz ihren Vertrag behält.

## 2026-08-30 … 2026-09-01 – PWA-Update-Lifecycle: wartender Worker, Browser-Fakten, Systemereignis

Konsolidierte durable Entscheidung aus den Wellen PWA-1B, 1C, 1C.1, 1C.2, 1C.2-Closure, 1C.3, Update State Contract V2, Visual Polish 2 und Completion Acknowledgement. **Status:** alle released und live (Kanban-Release `fe962c58` für 1B–1C.3, Fast-Forward bis `672ebc76` für V2/Polish 2/Completion, 2026-09-01). Archiv-Originale: [PWA-1B](releases/2026-08.md#2026-08-30--pwa-update-wartender-worker-statt-automatischer-übernahme-pwa-1b) · [PWA-1C](releases/2026-08.md#2026-08-30--update-experience-als-anwendungs-systemereignis-pwa-1c) · [PWA-1C.1](releases/2026-08.md#2026-08-30--premium-update-experience-und-8-sekunden-choreografie-pwa-1c1) · [PWA-1C.2](releases/2026-08.md#2026-08-30--aktivierungsanfrage-ist-kein-erfolgssignal-watchdog-statt-promise-pwa-1c2) · [PWA-1C.2 Closure](releases/2026-08.md#2026-08-30--ein-retry-muss-etwas-senden-der-beendete-aktivierungsversuch-pwa-1c2-closure) · [PWA-1C.3](releases/2026-08.md#2026-08-30--eine-bestätigte-übernahme-ist-endgültig-activated-ist-monoton-pwa-1c3) · [State Contract V2](releases/2026-09.md#2026-09-01--pwa-update-state-contract-v2-browser-fakten-statt-entdeckungssignal) · [Visual Polish 2](releases/2026-09.md#2026-09-01--pwa-visual-polish-2-ring-statt-spektakel-kein-reload-angebot-bei-wartendem-worker) · [Completion Acknowledgement](releases/2026-09.md#2026-09-01--pwa-completion-acknowledgement-aktualisierung-abgeschlossen-nach-dem-reload-genau-einmal). Aktueller technischer Contract: [`24-pwa-and-update-lifecycle.md`](24-pwa-and-update-lifecycle.md). Gestaltung: [`02-design-system.md`](02-design-system.md). Ursachenprotokoll (historisch): [`releases/2026-08.md`](releases/2026-08.md#pwa-update-verhalten-nach-deployment--ursache-bewiesen-pwa-1a-2026-08-30).

**Kontext.** `registerType: "autoUpdate"` erzeugte einen inkonsistenten Zwischenzustand (neuer Worker übernimmt, räumt den alten Precache, die Seite läuft auf altem JavaScript → Lazy-Chunk-404). Später zeigte Production einen falschen Recovery-Zustand, obwohl die neue Version längst lief.

**Aktueller technischer Contract: [`24-pwa-and-update-lifecycle.md`](24-pwa-and-update-lifecycle.md).** Dort stehen seit CR5 die technischen Regeln dieses Lifecycles — wartender Worker, Browser-Fakten statt Entdeckungssignal, `applying` ≠ `activated`, `reloadRequired`, Watchdog, Reload-Ownership, Abschluss-Handoff, Precache- und Offline-Grenze. Dieses Dokument führt sie bewusst **nicht** als zweite Regelliste; hier steht nur das Warum.

**Begründung.**

- **Warum `autoUpdate` verworfen wurde:** `registerType: "autoUpdate"` erzwingt `skipWaiting` + `clientsClaim`. Der neue Worker übernimmt dann sofort offene Tabs und räumt den Precache des alten Builds weg, während die Seite noch altes JavaScript ausführt — ein danach angeforderter Lazy Chunk des alten Builds existiert weder im Cache noch auf dem Server (404). Solange der alte Worker aktiv bleibt, bleibt sein Precache konsistent; der ursprüngliche Fehler kann strukturell nicht mehr auftreten.
- **Warum ein Update nicht ungefragt in ein Formular fallen darf:** es gibt keinen zentralen „Reload ist jetzt sicher"-Mechanismus — bewusst nicht gebaut. Deshalb entscheidet der Benutzer, wann aktualisiert wird, und „Später" verwirft nichts.
- **Warum die Oberfläche nur belegbare Zustände zeigen darf:** eine ausgelöste Anfrage ist kein Erfolgssignal, und ein Timeout ist kein Fehlerbeweis. Eine Oberfläche sagt nur, was sie belegen kann — dieselbe Regel wie im Error Contract und in der Notification Presentation. Ein Update darf auch nicht wie eine Störung aussehen (Product-Owner-Entscheidung 2026-09-01: kein Orange, kein Warnsymbol).
- **Warum ein PWA-Update keine Business-Operation ist:** es entsteht nicht aus einer Benutzerabsicht am Fachmodell, hat kein fachliches Ergebnis und nichts, wofür Idempotenz oder Replay eine Bedeutung hätten. Es in den Operations-Contract ([`23`](23-operations-errors-feedback.md)) zu ziehen hätte einen erfundenen `pending/success/error`-Verlauf erzeugt.
- **Warum die Choreografie Präsentation bleibt:** der Worker ist beim Klick bereits installiert; es ist nichts messbar, was ein Fortschrittsbild ehrlich abbilden könnte. Eine Inszenierung, die Fortschritt vortäuscht, wäre eine Behauptung ohne Beleg.

**Offene Produkt- und Design-Punkte** zu dieser Fläche stehen — nicht hier dupliziert — in [`17-known-issues-and-planned-waves.md`](17-known-issues-and-planned-waves.md) Abschnitt E (PWA) und F (Design-System).

## 2026-08-30 – Vorgänge-Kanban Navigation Rail

**Status:** `PRODUCTION VERIFIED` (2026-09-01). Archiv: [Original](releases/2026-08.md#2026-08-30--vorgänge-kanban-navigation-rail).

**Entscheidungen.** Eine native Wahrheit — alle Wege (Trackpad, Wheel, Touch, Board-Pan, Pfeile, Tastatur, Track-Klick, Thumb-Drag) ändern nur dasselbe `scrollLeft`. Proportionaler Viewport-Thumb mit 44-px-Minimum, Marker aus realen Spaltenmitten, integrierte Pfeile, Rail bottom-sticky innerhalb der Arbeitsfläche, Browser-Scrollbar visuell ausgeblendet (native Scrollfläche bleibt), Mouse-Pan nur auf freier Fläche (Karten-DnD getrennt), **native Gesten bleiben führend** (kein Wheel-Listener am Kanban), kein Scroll-Snap. Lehre aus dem Release: die vollständige Liste gelöschter Zeilen gegen die Release-Basis lesen — ein Keyword-Scan reicht nicht (eine `focus-visible`-Regel war im Integrations-RC verloren gegangen).

## 2026-08-29 – Notification Presentation Contract v1 (Phase 7A)

**Status:** Phase 7B `PRODUCTION VERIFIED` (2026-08-30); nur Quick Capture migriert, weitere Intents Phase 7C. Archiv: [Original inkl. Nachträge 7B.3/7B.4/7B.4b/7B.4c/Release](releases/2026-08.md#2026-08-29--notification-presentation-contract-v1-phase-7a). Contract: `23-operations-errors-feedback.md` §5 (Falle 37) und §2 (Falle 38); operative Verifikation: `21-agent-runbooks.md` Sektion 13 bzw. 11.

**Entscheidungen.**

1. **Composite: eine sichtbare Karte pro Benutzer-Intent** (Quick Capture = zwei Operationen, eine Karte; Core success + Task failure = Presentation-`partial`/`warning`). **Kein neuer Core-Lifecycle-Status.**
2. **Presentation-Registrierung gehört nicht in Application Commands**; Commands nehmen nur neutrale Execution-Metadata (`operationId`s) entgegen und importieren nichts aus `notifications/`. `operationId` ≠ `idempotencyKey`.
3. **Ein lange laufendes Core-`pending` wird nie zu `error` umgedeutet.** `lifecycle`/`tone` sind eine Discriminated Union ohne widersprüchliche Kombinationen.
4. **Bedienbarkeit vor Kompaktheit:** Close ≥ 44 px, Fehlerdetails werden nicht weggeclampt; `replayed` rendert wie `executed`; `initiator` Pflicht mit Default `human`.
5. **IT-Eskalation und Retry sind Contract-Fähigkeiten, kein UI** (kein Button ohne Adressat; Retry braucht Command-Policy und kompatiblen Idempotency-Scope).
6. **Layer-Endstand (7B.4c):** Statusmeldungen liegen auf beiden Breakpoints **über** der Dialogschicht (`z-60`), modal-aware Position über Radix' `data-state="open"`, nur die neueste Karte bei offenem Dialog, Kartenkörper **click-through** — eine Statusmeldung muss lesbar bleiben **und** darf nie die Aktion blockieren, über die sie berichtet. Ein Flow gehört genau einer Feedback-Schicht; sonner bleibt für nicht migrierte Flows.
7. **Fehler vor Operation-Start** werden nie zu einem synthetischen `OperationRecord` (Audit/Observatory würden verfälscht); kein Phantom-Task-Slot.

## 2026-08-29 – Operation Status Contract Wave (v1, CreateQuickCaptureCase Slice)

**Status:** `PRODUCTION VERIFIED` (2026-08-29). Archiv: [Original inkl. Phasen 6C/6D.1/6E](releases/2026-08.md#2026-08-29--operation-status-contract-wave-v1-createquickcapturecase-slice). Contract: `23-operations-errors-feedback.md` §1 und §3 (Ausführungssemantik, Falle 35); Persistenz-Invariante: `03-data-model-guardrails.md` §5; operative Verifikation: `21-agent-runbooks.md` Sektion 11.

**Entscheidungen.** Lifecycle bleibt `pending | success | error` (keine Werte ohne reale Semantik). `execution?: "executed" | "replayed"` ist ein Zusatzfeld an `success`, `undefined` ohne `idempotencyKey`. RPC-Transport: additives `_meta.disposition` im JSONB-Result der drei idempotenten RPCs (`CREATE OR REPLACE` auf unveränderten Signaturen), nur mit Key gesetzt; `_meta` ist reine Transportmetadata, nie Business-Feld, nie im Fingerprint; der in `idempotency_records` gespeicherte Wert bleibt für immer `executed`, die Replay-Antwort berechnet `replayed` frisch. `OperationRecord` bekommt `errorCode` (aus `normalizeCrmError().code`) und minimale `result`-Referenzen (IDs, nie Domainobjekte). Manager-API additiv über `reportOutcome`; FakeRest-Parität. Offen: pendente Operationen ohne TTL (LOW).

## 2026-08-29 – Idempotency Wave

**Status:** `PRODUCTION VERIFIED` (2026-08-28). Archiv: [Original inkl. Hardening und Release](releases/2026-08.md#2026-08-29--idempotency-wave).

**Entscheidungen.** `nora_private.idempotency_records` (unique `(command, idempotency_key, actor_id)`), nur über `idempotency_check`/`idempotency_persist` erreichbar; Atomizität über `pg_advisory_xact_lock` + Unique-Backstop. Transport als expliziter RPC-Parameter `p_idempotency_key`, **nie** über den Korrelations-Header (`operation_id` ≠ `idempotency_key`). Gleicher Key + gleicher Fingerprint → Replay; anderer Fingerprint → `NORA_IDEMPOTENCY_CONFLICT`. **Signatur-Gate:** ein zusätzlicher Parameter per `CREATE OR REPLACE` erzeugt eine Überladung (PostgREST `PGRST203`) — deshalb `DROP FUNCTION` + `CREATE`. Quick-Capture-Task hat eigenen Scope und eigene Transaktion (Best-Effort-Semantik bleibt); **committed scope = eingefroren, uncommitted scope = frei retriable**. Key-Ownership: Quick Capture mintet pro frischem Formularzustand und persistiert im Draft. **Precondition für `idempotency_persist`:** Lock zuerst, dann Write, dann Persist, alles in einer Transaktion. Kein Redis/Worker/Queue/Outbox.

## 2026-08-28 – Kontakterstellung UI-Polish

**Status:** deployed (2026-08-28; förmliche Rollen-UX-Abnahme nicht durchlaufen). Archiv: [Original](releases/2026-08.md#2026-08-28--kontakterstellung-ui-polish).

**Entscheidungen.** Nur die Kontakterstellung (`ContactInputs variant="create"`) bekommt die Komposition Person / Kundenbezug / Kontaktmöglichkeiten / eingeklappte Weitere Angaben (Validierungsfehler öffnen den Bereich); mobile first mit fester Primäraktion, zweispaltig erst ab `xl`; Kundenwahl mobil als Bottom Sheet mit räumlich getrennter Neuanlage; Brandfarbe nur für Primäraktion/Fokus/Akzente; iPad-Kopfzeile verdichtet. Keine Persistenz-/Routing-Änderung.

## 2026-08-28 – Error Contract Wave

**Status:** `PRODUCTION VERIFIED` (2026-08-28). Archiv: [Original](releases/2026-08.md#2026-08-28--error-contract-wave). Guardrail: `03-data-model-guardrails.md` §6 (universeller DB-Fehlervertrag); eingefrorener `CrmErrorKind` und Observatory-Contract: `23-operations-errors-feedback.md` §4; Ablauf für einen neuen Code: `21-agent-runbooks.md` Sektion 12.

**Entscheidungen.** `MESSAGE` = Mensch/Diagnose, `ERRCODE` = PostgreSQL-Semantik, `DETAIL` = stabiler `NoraErrorCode` (PostgREST transportiert beides unverändert — bewiesen). Zentrale Definition `domain/noraErrorCodes.ts`; `extractNoraErrorCode()` akzeptiert nur kanonische Werte (kein `startsWith("NORA_")`); `normalizeCrmError()` ist **machine-code-first**, Regex nur Legacy-Fallback. `CrmErrorKind` friert ein (Transport-/Infrastrukturfehler); neue Business-Fehler gehen `NoraErrorCode → messageKey` direkt. FakeRest wirft denselben Code über `throwNoraError()`, soweit es den Pfad modelliert (keine Datenebene-Autorisierung in FakeRest — dokumentierter Debt). TOCTOU auf `uq_companies_self_contact_individual` wird in `create_customer_with_contact_core` gezielt übersetzt.

## 2026-08-28 – Residual Security Advisor Closure

**Status:** abgeschlossen für den Snapshot 2026-08-28. Archiv: [Original](releases/2026-08.md#2026-08-28--residual-security-advisor-closure). Details: `17-known-issues-and-planned-waves.md` „Residual Security Advisor Follow-ups".

**Entscheidungen / Guardrails.** Ziel ist nachgewiesene Sicherheit, nicht „0 Findings". `number_counters` (RLS ohne Policy) = deny-by-grants, KEEP. Functions mit Rückgabetyp `trigger`/`event_trigger` sind nicht direkt aufrufbar — Advisor-Falsch-Positiv-Klasse. `authenticated`-only Business-RPCs prüfen serverseitig Rolle/Ownership, KEEP. `search_path = public` bei `SECURITY DEFINER` ist nur unkritisch, weil keine client-facing Rolle `CREATE` auf `public` hat — **Voraussetzung bei jeder neuen Function erneut prüfen**. `auth_leaked_password_protection` aktiviert. Jede neue Migration/Function/Grant-Änderung braucht eine eigene Bewertung; die alte Einstufung wird nie wiederverwendet.

## 2026-08-28 – Intentional privileged read views (`init_state` / `sales_directory`)

**Status:** `ASSESSED — LOW — KEEP`. Archiv: [Original](releases/2026-08.md#2026-08-28--intentional-privileged-read-views-init_state--sales_directory). Guardrail: `22-security-and-access.md` Abschnitt 7.1 (Falle 34).

**Entscheidung.** Beide Views bleiben `security_invoker = false`: `init_state` liefert `anon` nur ein 0/1-Bootstrap-Signal (die echte Grenze ist `resolve_first_signup_role()`), `sales_directory` ein minimales Teamverzeichnis (`id`, Name, Avatar) für alle aktiven Rollen. `security_invoker = true` würde beide Use-Cases nachweislich regressieren. **`sales_directory` wird ohne neue Entscheidung nie um `role`, `email`, `user_id`, `administrator` oder andere Identity-/Security-Metadaten erweitert**; Änderungen an Projektion, Grants, `sales`-RLS oder `is_active_user()` erfordern eine neue Bewertung. (Seit W2 sind beide Identity-Views zusätzlich explizit `SELECT`-only.)

## 2026-08-27 – Pre-Production Hardening Patch

**Status:** `PRODUCTION VERIFIED` (2026-08-28, zusammen mit der Self Contact Wave). Archiv: [Original inkl. Final-RC-Nachträge und Release](releases/2026-08.md#2026-08-27--pre-production-hardening-patch). Guardrails: `03-data-model-guardrails.md` §1.6, §2.1 und §6.

**Durable Regeln.** Numerische Entity-/Identity-IDs nie per Truthiness prüfen (`identity.id = 0` existiert im Demo) — `== null`. Die Effective-Contact-Regel hat drei Implementierungen (SQL, TS, FakeRest), die über eine gemeinsam benannte Szenario-Matrix (Domain Contract Testing) synchron gehalten werden. Die Individual-Name-Invariante gilt am CREATE-Pfad **und** beim Rename: `companies.name` einer Privatkundenakte wird serverseitig aus dem Kontakt abgeleitet, ein leerer Name lehnt den ganzen Aufruf ab (kein Platzhalter). `error.message` ist nie ein i18n-Key.

## 2026-08-26 – Self Contact Wave

**Status:** `PRODUCTION VERIFIED` (2026-08-28). Archiv: [Original inkl. Alternativen](releases/2026-08.md#2026-08-26--self-contact-wave). Modell: `01-domain-model.md`; Invarianten (Fallen 28–31) in `03-data-model-guardrails.md` §1.

**Entscheidungen.**

1. **`companies.self_contact_id`** — gerichteter FK company→contact, **entkoppelt von `contacts.company_id`**: „diese Person repräsentiert diese Kundenakte". Kein Flag auf `contacts` (hätte die Arbeitgeberbeziehung überschrieben). Partial Unique nur für `customer_kind='individual'` (eine Person hat höchstens eine Privatkundenakte, darf aber mehrere Firmen repräsentieren).
2. **`contacts` bleibt kanonische Quelle für Personendaten**; `companies.name` bei Privatpersonen serverseitig synchron (kontrollierte Denormalisierung), Invariante `individual ⇒ self_contact_id` als deferred Constraint-Trigger, Delete-Guard für den repräsentierenden Kontakt einer Privatakte, `merge_contacts` repointet.
3. **Effective Contact Context — genau eine Regel** (`is_effective_contact_of_company` / `resolveCustomerContacts`): `contact.company_id = company.id` ODER `company.self_contact_id = contact.id`. Rollen `selfContact` / `explicitPrimaryContact` (nur bei passendem `company_id`) / `preferredContact` getrennt.
4. **Ein gemeinsamer RPC-Core** (`create_customer_with_contact_core`) für Kundenanlage und Quick Capture; `create_quick_capture_case` erlaubt genau einen Kundenpfad (neu oder bestehend), verweigert stilles Umhängen, referenziert bestehende Kontakte nur (kein Primary-Eingriff); Kunde+Kontakt+Vorgang atomar, Aufgabe bleibt Best-Effort.
5. **Application-/Domain-Layering additiv** (`domain/`, `application/commands/`), kein Event Bus, kein CQRS, kein Intent-Layer.
6. Quick Capture Schritt 2 als expliziter Tri-State; Draft pro Benutzer mit Schema-Version/Staleness, alter globaler Key wird entfernt, nie migriert; „Firma" statt „Unternehmen / Selbstständig".

## 2026-08-25 – Unified Tasks Wave

**Status:** `PRODUCTION VERIFIED` (2026-08-28). Archiv: [Original](releases/2026-08.md#2026-08-25--unified-tasks-wave). Guardrail: `03-data-model-guardrails.md` §1.3.

**Entscheidungen.** `tasks.company_id` (nullable) neben nullable `tasks.contact_id`, CHECK „mindestens eines"; **kein `deal_id`**, keine `task_links`-Architektur. **Historische Semantik:** `company_id` ist der Kundenkontext zum Zeitpunkt der Erstellung bzw. letzten bewussten Kontextänderung und wird **nie automatisch nachgeführt** (Nora will nachvollziehbare Historie). Durchsetzung per BEFORE-Trigger (nur bei gesetztem/geändertem Kontext). `tasks.contact_id` FK `ON DELETE SET NULL` mit vorgelagertem Trigger, der reine Kontakt-Aufgaben löscht; `merge_contacts` überspringt die Validierung (Identitätskonsolidierung). Audit liest den Kontext aus der Aufgabe, nicht live vom Kontakt.

## 2026-08-25 – Customer & Contact Workflow Wave

**Status:** `PRODUCTION VERIFIED` (2026-08-25). Archiv: [Original](releases/2026-08.md#2026-08-25--customer--contact-workflow-wave), [lokale Verifikation](releases/2026-08.md#2026-08-25--erste-lokale-postgres-verifikation-der-customer--contact-workflow-migration), [Production-Apply](releases/2026-08.md#2026-08-25--customer--contact-workflow-migration-auf-produktion-angewendet). Modell: `01-domain-model.md`.

**Entscheidungen.** `companies.customer_kind` (`business` | `individual`) treibt den Formularmodus; ersetzt **nicht** `sector`. `contacts.is_primary`, max. 1 pro Kunde per Partial Unique Index, Wechsel nur über RPC `set_primary_contact`. Generisches Link-Modell `links_jsonb` (Legacy-Spalten bleiben deprecated, Bestandsdaten kopiert). `companies.email_jsonb`/`phone_jsonb` analog zu Kontakten. Atomare Anlage über RPC `create_customer_with_contact` (kein Frontend-Copy/Paste). **Verworfen:** generisches `party/person/organization`-Modell (unverhältnismäßig), Selbstständige als dritte Kundenart (verhalten sich wie Firmen), `companies.primary_contact_id` (FK-Zyklus).

## 2026-08-25 – Erste lokale Postgres-Verifikation der Customer & Contact Workflow Migration

Archiv: [Original](releases/2026-08.md#2026-08-25--erste-lokale-postgres-verifikation-der-customer--contact-workflow-migration).

**Durable Regel.** Beim Erweitern einer View (`companies_summary`, `contacts_summary`, …) neue Spalten **immer ans Ende** der `select`-Liste anhängen — `create or replace view` interpretiert eine verschobene Spaltenposition als Umbenennung und scheitert (`42P16`).

## 2026-08-15 – Kernindizes und Bundle-Budget

**Status:** live (PR #1). Archiv: [Original](releases/2026-08.md#2026-08-15--kernindizes-und-bundle-budget).

**Entscheidungen.** Fehlende FK-/Hot-Path-Indizes auf den geerbten Kerntabellen additiv per `create index if not exists` (partielle/zusammengesetzte Indizes, z. B. `deals (stage, "index") where archived_at is null`); **kein `CONCURRENTLY`** (CLI-Transaktion) — ab ~100.000 Zeilen eigene nicht-transaktionale Migration; Indizes auch in `supabase/schemas/01_tables.sql`. **`sourcemap: false`** (keine Produktions-Sourcemaps ohne private Übertragung). **`manualChunks` in Funktionsform** (Objektform bricht bei fehlender Abhängigkeit). **Bundle-Budget als CI-Gate** am Build-Job; `visualizer({ open })` nur ohne `CI` — **überholt seit 2026-09-09**: der Visualizer läuft überhaupt nur noch bei `ANALYZE=true` (siehe „2026-09-09 – Visualizer Production Exclusion"); das Bundle-Budget als CI-Gate gilt unverändert. Code-Splitting per `React.lazy` bewusst zurückgestellt, bis Pfadkonstanten aus `Header.tsx` gelöst sind. Jede Referenz auf `sales.id` braucht einen führenden Index (Lehre aus den zwei übersehenen Notiz-FKs).

## 2026-08-10 – Foundation Wave 3: Error Observatory Core

Archiv: [Original](releases/2026-08.md#2026-08-10--foundation-wave-3-error-observatory-core).

**Entscheidungen.** Tabelle `public.operation_errors`, getrennt von `audit_events` — **Audit = erfolgreiche Änderungen, Observatory = fehlgeschlagene fachliche Operationen** (Compliance- und Diagnose-Daten nicht vermischen). Soft-Referenzen (kein FK auf Business-Tabellen), `operation_id` NOT NULL + UNIQUE, Actor nur aus `safe_auth_uid()`, serverseitige `public_ref` (`NORA-E…`), keine Client-INSERTs (nur `record_operation_error`/`report_operation_error`), `technical_context`-Allowlist, Report nur eigener Actor. Der Observatory-Ausfall ersetzt und blockiert nie den Business-Fehler (best-effort, non-blocking).

## 2026-08-10 – Foundation Wave 2: Operation Manager + Catalog

Archiv: [Original](releases/2026-08.md#2026-08-10--foundation-wave-2-operation-manager--catalog).

**Entscheidungen.** Typisierter Operation Catalog; In-Memory-Manager `execute(definition, input, handler)` mit `pending → success|error`, Exceptions weitergereicht, voll funktionsfähig ohne React (Prozess-Singleton, der Provider erzeugt keine zweite Instanz). Der Manager ist Eigentümer der Operation-ID am Einstieg; Transport reicht nur weiter. `deal.assign` ist nur Katalog, keine zweite Mutation. Retention success 8 s / error 60 s / pending nie auto-drop. Keine DB-Tabelle, kein Feedback-UI.

## 2026-08-10 – Foundation Wave 1: Operation Correlation

Archiv: [Original](releases/2026-08.md#2026-08-10--foundation-wave-1-operation-correlation).

**Entscheidungen.** `operation_id` = clientseitige UUID, einmal am fachlichen Einstieg gemintet, Transport-Header `x-nora-operation-id` (gültige IDs werden nie still ersetzt; ungültige soft neu gemintet). PostgreSQL liest sie über `nora_private.current_operation_id()` (INVOKER, nur GUC/Header, nie Abbruch) in `audit_events.request_id` — **die bestehende Spalte, keine zweite**. **Keine Auth-/RLS-Nutzung der `operation_id`** — sie ist ausschließlich Korrelation. Rückwärtskompatibel (kein Header → `NULL`).

## 2026-08-10 – Stabilization Gates 2/2b: Form-Owner im Radix-Portal

Archiv: [Gate 2](releases/2026-08.md#2026-08-10--stabilization-gate-2-dealedit-portal-form-owner), [Gate 2b](releases/2026-08.md#2026-08-10--stabilization-gate-2b-taskedit-portal-form-owner), [Gate 1](releases/2026-08.md#2026-08-10--stabilization-gate-1-deal-surface-recovery).

**Durable Regel.** Ein `Form` muss physisch **innerhalb** des Radix `DialogPortal`/`DialogContent` gerendert werden — sonst hat der sichtbare `SaveButton type="submit"` `button.form === null` und speichert nicht (Production-Ursache bei `DealEdit`/`TaskEdit`). Modal-Edits speichern `mutationMode="pessimistic"`; Dirty-Close über `FormDirtyBridge`; `DialogTitle`/`DialogDescription` (sr-only) sind Pflicht. Create-Routen dürfen nie als Record-ID an `EditBase`/`ShowBase` gehen; interne Navigation nur über `noraCreatePath()` (siehe `04-routing-i18n.md`).

## 2026-07-23 – Mitarbeiterzugang: öffentliches Redesign und Einladung

Archiv: [Original](releases/2026-07.md#2026-07-23--mitarbeiterzugang-öffentliches-redesign-und-einladung), [Profil-Update](releases/2026-07.md#2026-07-23--profil-update-pending-default-und-rollen-seiteneffekt), [Rollen-RPC Claims](releases/2026-07.md#2026-07-24--rollen-rpc-service_role-claims-erkennung), [Identity-Cache](releases/2026-07.md#2026-07-24--identity-cache-nach-profilnamensänderung).

**Entscheidungen.** Nora ist **einladungsbasiert**: keine öffentliche Registrierung (`/sign-up` ist nur Hinweisseite, `dataProvider.signUp` wirft im Supabase-Modus); öffentliche Fläche zeigt Ergart + „Mitarbeiterzugang", Nora-Branding erst nach Anmeldung. Onboarding nach Einladung: Passwort → Profil → Abschluss, keine Rollenwahl durch den Benutzer. Admin-Einladung über die `users` Edge Function. **Kein Service-Role-Schlüssel im Frontend/Vercel/`VITE_*`.** „Pending" ist nur Bootstrap-Platzhalter; PATCH ändert Rolle/Deaktiviert nur bei expliziter Angabe. Rollen-/Claims-Erkennung liest `request.jwt.claims` (JSON) und das Legacy-GUC.

## 2026-07-17 – v0.4c.2c: Release-Gates und Deployment-Bereinigung

Archiv: [Original](releases/2026-07.md#2026-07-17--v04c2c-release-gates-und-deployment-bereinigung), [E2E-Bootstrap](releases/2026-07.md#2026-07-17--v04c2c-e2e-bootstrap-und-profilzugriff), [E2E-Auth](releases/2026-07.md#2026-07-17--v04c2c-e2e-auth-assertions-und-first-run-dashboard).

**Entscheidungen.** Der Atomic-CRM-Workflow `deploy.yml` (GitHub Pages, automatische Remote-Migrationen und Edge-Deploys) ist entfernt — **kein automatischer Supabase-Remote-Deploy aus CI**; Vercel-Frontend-Deploy und Supabase-Production-Schritte sind getrennte, ausdrücklich freizugebende Betriebsaufgaben. ESLint/Prettier als direkte npm-Skript-Jobs. `configuration.id = 1` ist ein notwendiger Systemdatensatz; `safe_auth_uid()` liest Legacy-GUC und `request.jwt.claims`; Policy-Matrix unverändert (kein Test-SELECT-Recht). Atomic-CRM-Telemetrie dauerhaft aus; E2E-Build ohne Service Worker.

## 2026-07-16 – v0.4c.2: Google OAuth, Token-Verschlüsselung, manueller Sync

Archiv: [Original](releases/2026-07.md#2026-07-16--v04c2-google-oauth-token-verschlüsselung-manueller-sync).

**Entscheidungen.** Kein GUC-Bypass für FK-Updates → Capability `nora_calendar_linker`. OAuth-Scopes minimal (`calendar.events.owned.readonly`, `calendarlist.readonly`), PKCE S256 + State-Hash mit TTL, atomarer Consume. Refresh-Token AES-GCM-256 mit Nonce und Key-Version in `nora_private`. Allowlist `GOOGLE_CALENDAR_ALLOWED_ID` ist bindend (DB-Config kann Edge nicht überschreiben). Sync admin-only, etag-basiert, Datenminimierung (Beschreibung bevorzugt leer, max. 500, kein HTML).

## 2026-07-16 – v0.4c.1: Google-Kalender Read-only Grundlage

Archiv: [Original](releases/2026-07.md#2026-07-16--v04c1-google-kalender-read-only-grundlage). Implementierung: `14-google-calendar-readonly-implementation.md`.

**Entscheidungen.** Google Kalender ist System of Record; Nora = Cache (`google_calendar_events`) + CRM-Verknüpfung + Audit. Singleton-Verbindung (max. eine `connected`), Allowlist, **keine Tokens** in Data-API-Tabellen oder Audit, Capability `nora_calendar_writer`, Link/Unlink-RPCs für admin/office, Edge-Stubs antworten 501/503 statt Fake-Erfolg, Demo ohne Fake-OAuth, Audit `calendar.event_linked/unlinked` (`retention_class = integration`).

## 2026-07-15 – v0.3l: Vollständiger CRM-Audit-Verlauf

Archiv: [Original](releases/2026-07.md#2026-07-15--v03l-vollständiger-crm-audit-verlauf), [Abschluss v0.3l.1](releases/2026-07.md#2026-07-15--v03l1-crm-audit-abschluss-schema-sync-tests-abnahme). Modell: `13-crm-audit-retention.md`.

**Entscheidungen.** **Eine** Audit-Tabelle (`audit_events`) für Checklisten und CRM-Kernänderungen, erweitert um Actor-Snapshots, `source`, `retention_class`, `task_id`, `note_id`. Schreib-Capability `nora_audit_writer` (NOLOGIN, INSERT-only) über `nora_private.write_audit_event`; Trigger auf companies, contacts, deals, tasks, Notizen, sales. Kompakte `metadata.changes`, Notizen ohne Volltext. Lesen: Admin global (`/audit`), Office nur kontextbezogen per RPC, Viewer nichts; direktes SELECT nur Admin. Kanonisches Ereignis `deal.status_changed` (Legacy `deal.stage_changed` bleibt lesbar). Immutability-Grenze: append-only für App-Rollen, kein Superuser-/WORM-Schutz; `event_hash`, WORM-Export, Purge zurückgestellt.

## 2026-07-14 – v0.3k: Rollenbewusste UX, Ladezustände und Fehlertoleranz

Archiv: [Original](releases/2026-07.md#2026-07-14--v03k-rollenbewusste-ux-ladezustände-und-fehlertoleranz), [v0.3k.1](releases/2026-07.md#2026-07-14--v03k1-rollen-ux-abnahme-und-dialog-polish), [v0.3k.2](releases/2026-07.md#2026-07-14--v03k2-demo-rollensimulation-und-abschließende-rollen-ux-abnahme). Abnahme: `12-role-ux-acceptance.md`.

**Entscheidungen.** **Die UI spiegelt `canAccess.ts`, ersetzt aber niemals RLS** — die Datenbank bleibt autoritativ. Viewer: Lesemodus-Banner, keine Create/Edit/Delete, Edit-Routen leiten auf Show. Office: schreiben und archivieren, kein physisches Löschen, keine Benutzer-/Konfigurationsverwaltung. Zentrale Fehlernormalisierung (`normalizeCrmError`), einheitliche Lade-/Leer-/Fehlerzustände, Dirty-Form-Schutz. Import ist nicht reversibel und ohne Assistent → nur Admin. Demo-Session hat genau eine Quelle (`demoSession.ts`); Rollenwechsel invalidiert Caches.

## 2026-07-14 – v0.4b.2: RBAC-Abschluss (Capability, Parallel-Admin, sales_directory)

Archiv: [Original](releases/2026-07.md#2026-07-14--v04b2-rbac-abschluss-capability-parallel-admin-sales_directory).

**Entscheidungen.** Kein GUC-Token-Modell für Privilegienänderungen (client-setzbare Textwerte sind keine Capability-Grenze) → Rolle `nora_role_manager` (NOLOGIN, NOBYPASSRLS) als alleiniger Owner von `apply_sales_role_change`; Trigger `prevent_sales_privilege_escalation` erlaubt Privileg-UPDATEs nur als `nora_role_manager`. Erster Admin über `resolve_first_signup_role()` mit Advisory-Lock (exakt ein Admin unter Parallelität). View `sales_directory` (id, Name, Avatar) für Teamlisten; `public.sales` SELECT nur eigene Zeile oder Admin.

## 2026-07-14 – v0.4b.1: RBAC-Migrations- und Function-Hardening

Archiv: [Original](releases/2026-07.md#2026-07-14--v04b1-rbac-migrations--und-function-hardening).

**Entscheidungen.** Interne Helper (`safe_auth_uid`, `is_active_user`, `current_role`, `has_role`, `can_write`, `is_admin`) leben in Schema `nora_private` — nicht in Data-API-Schemas; `search_path = ''` auf allen `SECURITY DEFINER`-Functions, vollständig schemaqualifiziert; keine Testrolle in Produktionsmigrationen (nur lokales Setup/Teardown); `anon` ohne Grants auf geschützte Tabellen, `authenticated` minimal.

## 2026-07-14 – v0.4b: RBAC- und RLS-Härtung

Archiv: [Original](releases/2026-07.md#2026-07-14--v04b-rbac--und-rls-härtung). Rollenmatrix: `22-security-and-access.md` Abschnitt 4.3 (bis CR2 in `11` Abschnitt C).

**Entscheidungen.** `sales` bleibt die kanonische Benutzertabelle (1:1 zu `auth.users`); `sales.role text not null` mit CHECK (`admin`, `office`, `viewer`); Backfill nach Least Privilege (`administrator = true` → `admin`, sonst `viewer`, `office` nur explizit); `administrator = (role = 'admin')` per Trigger gespiegelt. RLS-Matrix: viewer SELECT; office SELECT/INSERT/UPDATE ohne DELETE; admin inkl. DELETE und Konfiguration. `disabled` blockiert in Rollenfunktionen, RLS und Auth-Provider. Erster Nutzer `admin`, weitere `viewer`.

## 2026-07-14 – v0.4a: Google-Kalender-Architektur und Nora-Rollenmodell spezifiziert

Archiv: [Original](releases/2026-07.md#2026-07-14--v04a-google-kalender-architektur-und-nora-rollenmodell-spezifiziert). Spezifikation: `11-google-calendar-rbac.md`.

**Entscheidungen.** **Google Kalender ist System of Record für Termine** (Zeit, Titel, Ort, Wiederholung, Existenz); Nora speichert Cache, CRM-Verknüpfung, Audit — **kein `appointments`-Hauptmodell**, ein Geschäftskalender per `calendar_id`, keine iCal-URL, kein Embed. Termin-Eigentum `origin = google | nora`. **Rollen `admin`/`office`/`viewer` an `sales.role` — keine zweite Benutzertabelle.** Secrets nur in Edge-Secrets/Vault, nie Frontend/Audit. OAuth read-only zuerst; Sync stufenweise; Kalender-Audit über `audit_events`.

## 2026-07-14 – v0.3g: Schnellerfassung UX-Überarbeitung

Archiv: [Original](releases/2026-07.md#2026-07-14--v03g-schnellerfassung-ux-überarbeitung); Folgewellen [v0.3h](releases/2026-07.md#2026-07-14--v03h-kundenliste-und-vorgänge-kanban-responsiver), [v0.3i](releases/2026-07.md#2026-07-14--v03i-kanban-und-vorgangsakte-barrierearm), [v0.3j](releases/2026-07.md#2026-07-14--v03j-hotboard-arbeitsboard-fokusboard).

**Entscheidungen.** Frei wechselbare Tabs (Validierung nur beim Speichern), lokaler Entwurf im Browser (kein serverseitiger Draft), ein Bereich „Mögliche Kunden" (keine doppelte Vorschlagsanzeige), Suche nur über `useDuplicateCandidateSearch`. Sichtbare Terminologie „Rückmeldung ausstehend"/„Nächster Kontakttermin" bei unveränderten technischen IDs; Datumsformat `de-DE` über `noraDateTime.ts`; keine Listen-Suche neben der globalen Suche.

## 2026-06-28 – v0.3f: Intelligente Dubletten-Vorschläge

Archiv: [Original](releases/2026-06.md#2026-06-28--v03f-intelligente-dubletten-vorschläge).

**Entscheidungen.** Deterministisches Scoring (Kundennummer, Telefon, E-Mail stark; Name mittel; Name + Ort stärker) — **keine KI, kein Auto-Merge**; Vorschläge sind informativ, der Nutzer entscheidet. Effiziente Suche (Debounce, Cache, Stale-Guard, max. 5), Wiederverwendung von `performGlobalSearch`; Logik für einen späteren CSV-/Lexware-Import wiederverwendbar.

## 2026-06-28 – v0.3e: Schnellerfassung / Eingangszentrale

Archiv: [Original](releases/2026-06.md#2026-06-28--v03e-schnellerfassung--eingangszentrale).

**Entscheidungen.** Ein Dialog für Anfragen aus Telefon/WhatsApp/E-Mail — ohne externe APIs; Suche zuerst; Quelle vorerst in `deals.description` (`Quelle: …`), kein `source_channel`-Feld; Nummern serverseitig. (Die ursprünglich sequentiellen Creates sind seit der Self Contact Wave durch eine atomare RPC ersetzt.)

## 2026-06-28 – v0.3b: Hotboard / operative Startübersicht

Archiv: [Original](releases/2026-06.md#2026-06-28--v03b-hotboard--operative-startübersicht), [v0.3c Fenster-Kanban-Filter](releases/2026-06.md#2026-06-28--v03c-fenster-kanban-filter), [v0.3d5 Produktionsfreigaben](releases/2026-06.md#2026-06-28--v03d5-hotboard-produktionsfreigaben-offen).

**Entscheidungen.** Das Hotboard ist eine **Team-Ansicht** offener Vorgänge (kein `sales_id`-Filter) aus vorhandenen Feldern; archivierte Vorgänge ausgeschlossen; **kein Terminmodell** — „Heutige Termine" erst mit Google Kalender, `expected_closing_date` wird nicht als Termin missbraucht. Fensterservice-Kanban als clientseitiger Kategorie-Filter mit bevorzugten Spalten, keine neuen Status-IDs.

## 2026-06-28 – Welle 6d: Globale Suche im Header

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-6d-globale-suche-im-header), [Spezifikation 6b](releases/2026-06.md#2026-06-28--welle-6b-kundennummern-vorgangsnummern-globale-suche-spezifikation). Details: `08-numbering-and-global-search.md`.

**Entscheidungen.** Frontend-orchestriert über den DataProvider (`getList`/`q`, `@eq` für exakte Nummern) — **keine Postgres-RPC, keine neue DB-Struktur**; exakte `KD-*`/`VG-YYYY-*` navigieren direkt; gruppierte Treffer; einfache Telefon-Normalisierung.

## 2026-06-28 – Welle 7a: Fensterauftrag-Prozess spezifiziert

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-7a-fensterauftrag-prozess-spezifiziert). Spezifikation: `09-window-order-workflow.md`.

**Entscheidungen.** Der Fensterauftrag ist ein **Spezialworkflow**, nicht das Standardschema (`deals.category = fensterservice`); schlanke Hauptstatus als Kanban-Meilensteine, Kontrollpunkte (S4a/S4b/S4c/S5) als **Checkliste, nicht als Spalten**; **Hersteller generisch** (kein Lieferantenname im Modell); E-Mails Vorlagen → manuell → Automation; Kundenstatus-Link eigenes späteres Modul; Google Drive/Keep/Tasks sind nicht Nora-Kern.

## 2026-06-28 – Welle 7b: Checklisten-, Textbaustein- und Audit-Datenmodell spezifiziert

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-7b-checklisten--textbaustein--und-audit-datenmodell-spezifiziert), [v0.3d2 Migration](releases/2026-06.md#2026-06-28--v03d2-datenbankmigration-checklisten-textbausteine-audit), [v0.3d3 Run-Start](releases/2026-06.md#2026-06-28--v03d3-checklisten-run-start-absichern), [v0.3d4 UI](releases/2026-06.md#2026-06-28--v03d4-checklisten-ui-im-vorgangsdetail). Spezifikation: `10-checklists-snippets-audit.md`.

**Entscheidungen.** Relationales Hauptmodell (`checklist_templates/_template_items/_runs/_run_items`, `saved_text_snippets`, `audit_events`) — **JSONB-only am Vorgang abgelehnt**; Servicebereiche `FENS`/`HAUS`/`IMMO` über `service_area_code`, nicht `company_id`; `label_snapshot` Pflicht an Run-Items; Audit append-only (CRM-Nachvollziehbarkeit, kein GoBD-Ersatz); Vorlagen deaktivieren statt löschen; Run-Start nur über die atomare, idempotente RPC `start_checklist_run_from_template` (Advisory-Lock), nie Client-Kopien.

## 2026-06-28 – Welle 6c: Kundennummern und Vorgangsnummern implementiert

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-6c-kundennummern-und-vorgangsnummern-implementiert), [6c-QA](releases/2026-06.md#2026-06-28--welle-6c-qa-datenbank-audit-nummern), [6c-Hardening](releases/2026-06.md#2026-06-28--welle-6c-hardening-nummern-api-absichern). Details: `08-numbering-and-global-search.md`; Fallen-Index 8–13 in `03-data-model-guardrails.md` §7.

**Entscheidungen.** `KD-000001` (global monoton) und `VG-YYYY-000001` (pro Jahr) aus der Tabelle `number_counters` (race-sicher, nicht pro-Jahr-Sequenzen); Vergabe **ausschließlich serverseitig** per BEFORE-INSERT-Trigger (`SECURITY DEFINER`, Client-Werte werden überschrieben, nicht mit Fehler quittiert), Immutability per UPDATE-Trigger, `next_*`/`format_*` für `anon`/`authenticated` nicht ausführbar; UI nur read-only; FakeRest über `misc/numbering.ts`.

## 2026-06-28 – Welle 5: Vorgangsworkflow ohne DB-Änderung

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-5-vorgangsworkflow-ohne-db-änderung).

**Entscheidungen.** `expected_closing_date` = „Nächstes Nachfassdatum" (heute „Nächster Kontakttermin"), `sales_id` = „Zuständig", `stage` = Vorgangsstatus (inkl. Nachfassen, Wartet auf Hersteller); keine Migration — fachliche Lücken (dediziertes Nachfassdatum, `deal_id` an Aufgaben, Herstellerfeld) bleiben dokumentierte Kandidaten.

## 2026-06-28 – Welle 4: Typografie und comfortable density

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-4-typografie-und-comfortable-density). Gestaltung: `02-design-system.md`.

**Entscheidungen.** Gebündeltes `Inter Variable` (keine CDN-Fonts), zentrale Tokens/Utility-Klassen in `src/index.css`, „comfortable density" mit 44-px-Touch-Zielen, ruhige Listenhierarchie statt bunter Flächen — ohne DataProvider, DB oder Resource-Namen anzufassen.

## 2026-06-28 – Basisentscheidungen: Atomic CRM, Resource-Namen, Vorgänge, Brandfarbe, EUR, Demo-Daten

Archiv: [Atomic CRM als Basis](releases/2026-06.md#2026-06-28--atomic-crm-als-basis-für-nora-crm), [Resource-Namen](releases/2026-06.md#2026-06-28--interne-resource-namen-bleiben-stabil), [Vorgänge](releases/2026-06.md#2026-06-28--deals-werden-sichtbar-zu-vorgängen), [Brandfarbe](releases/2026-06.md#2026-06-28--nora-brandfarbe), [EUR/de-DE](releases/2026-06.md#2026-06-28--eur-und-de-de), [Demo-Daten](releases/2026-06.md#2026-06-28--demo-daten-sind-synthetisch), [Startseite 6a](releases/2026-06.md#2026-06-28--welle-6a-öffentliche-startseite), [Auth-Navigation](releases/2026-06.md#2026-06-28--welle-6a-polish-auth-navigation), [Kanban-Polish](releases/2026-06.md#2026-06-28--vorgänge-kanban-aufräumen-kanban-polish).

**Entscheidungen.** Atomic CRM ist die Basis (React/TypeScript, Supabase-kompatibel, ohne eigenen VPS). **Interne Resource-Namen bleiben englisch** (`contacts`, `companies`, `deals`, `tasks`, `tags`) — eine harte Umbenennung würde DataProvider, Tabellen, Relations, Tests und gespeicherte Daten brechen; sichtbar und in URLs ist Nora deutsch. **„Deal" heißt sichtbar „Vorgang"** (Anfrage, Angebot, Nachfassung, Auftrag, Abschluss). Brandfarbe `#ff3b1f`. **EUR mit `de-DE`**, keine Dollar-Anzeige. **Demo-Daten sind synthetisch** (realistisch, aber keine echten personenbezogenen Daten). Öffentliche Startseite mit zwei Aktionen, `/login` als eigene Route; leere Kanban-Spalten standardmäßig ausgeblendet (Toggle in `localStorage`).

---

## Nur archivierte Einträge (reine Release-Historie)

Diese Originaleinträge enthalten keine eigene durable Regel über das oben Festgehaltene hinaus und liegen ausschließlich im Archiv:

| Eintrag | Archiv |
|---|---|
| 2026-08-25 – Repo/Produktions-Drift bei `nora_core_indexes` unabhängig bestätigt | [2026-08](releases/2026-08.md#2026-08-25--repoproduktions-drift-bei-nora_core_indexes-unabhängig-bestätigt) |
| 2026-08-25 – Customer & Contact Workflow Migration auf Produktion angewendet | [2026-08](releases/2026-08.md#2026-08-25--customer--contact-workflow-migration-auf-produktion-angewendet) |
| 2026-08-10 – Stabilization Gate 1: Deal Surface Recovery | [2026-08](releases/2026-08.md#2026-08-10--stabilization-gate-1-deal-surface-recovery) |
| 2026-07-24 – Rollen-RPC: service_role Claims-Erkennung · Identity-Cache nach Profilnamensänderung | [2026-07](releases/2026-07.md#2026-07-24--rollen-rpc-service_role-claims-erkennung) |
| 2026-07-23 – Profil-Update · DB-Lint: Funktionsvolatilität | [2026-07](releases/2026-07.md#2026-07-23--db-lint-funktionsvolatilität-und-ungenutzte-variablen) |
| 2026-07-17 – v0.4c.2c: E2E-Bootstrap · E2E-Auth-Assertions | [2026-07](releases/2026-07.md#2026-07-17--v04c2c-e2e-bootstrap-und-profilzugriff) |
| 2026-07-15 – v0.3l.1: CRM-Audit-Abschluss | [2026-07](releases/2026-07.md#2026-07-15--v03l1-crm-audit-abschluss-schema-sync-tests-abnahme) |
| 2026-07-14 – v0.3f Demo-Daten · UX-Polish Suche · v0.3h · v0.3i · Demo-Auftragswerte · v0.3j · `amountCents` → `amountEur` · v0.3k.1 · v0.3k.2 | [2026-07](releases/2026-07.md) |
| 2026-06-28 – Welle 6a · 6a-Polish · Kanban-Polish · 6b · 6c-QA · 6c-Hardening · v0.3c · v0.3d2 · v0.3d3 · v0.3d4 · v0.3d5 | [2026-06](releases/2026-06.md) |
