# 21 – Agent Runbooks (conditional)

Stand: 2026-09-29 · Load-Klasse: **CONDITIONAL** — dieses Dokument wird **nie vollständig** als Standardkontext geladen.

Hier stehen die subsystem- und situationsabhängigen operativen Anweisungen für Änderungen an Nora: Testsequenzen, Verifikationsschritte, wiederkehrende Fallstricke. Sie standen früher als `Bei <X> zusätzlich:`-Blöcke in [`07`](07-agent-change-checklist.md) und wurden damit bei **jeder** Aufgabe mitgeladen, auch bei einer reinen Label-Änderung. [`07`](07-agent-change-checklist.md) behält nur das universelle Change Protocol; hier liegt alles Bedingte.

**Wie dieses Dokument benutzt wird:** Der Router [`README.md`](README.md) benennt für die jeweilige Aufgabe die zuständige Sektion. Es wird **genau diese Sektion** gelesen, nicht die Datei. Der Index unten ist der interne Einstieg, keine zweite Routingtabelle — Dokumentzuständigkeiten und Load-Klassen stehen ausschließlich im Router.

**Abgrenzung.** Dieses Dokument enthält **keine** durablen fachlichen oder datenbezogenen Invarianten — die stehen in [`01`](01-domain-model.md), [`03`](03-data-model-guardrails.md), [`22`](22-security-and-access.md) und den Subsystem-Contracts ([`10`](10-checklists-snippets-audit.md), [`11`](11-google-calendar-rbac.md), [`13`](13-crm-audit-retention.md), [`14`](14-google-calendar-readonly-implementation.md), [`18`](18-email-delivery-observability.md), [`19`](19-user-lifecycle-architecture.md), [`23`](23-operations-errors-feedback.md), [`24`](24-pwa-and-update-lifecycle.md)). Hier steht nur, **was beim Ändern zusätzlich zu tun und zu beweisen ist**.

**Ownership-Hinweis.** Sektion 4 hat seit CR2 einen Contract-Owner: [`22-security-and-access.md`](22-security-and-access.md). Die Sektionen **11–13** haben seit CR3 einen: [`23-operations-errors-feedback.md`](23-operations-errors-feedback.md) (Operationen, Fehler, Feedback). Sektion **14** hat seit CR5 einen: [`24-pwa-and-update-lifecycle.md`](24-pwa-and-update-lifecycle.md) (PWA und Update-Lifecycle). Alle drei enthalten deshalb **keine** Contract-Sätze mehr, sondern nur noch die operative Verifikation. Es gibt in diesem Dokument keinen `Interim-Contract` mehr: **`21` = wie man etwas sicher ändert und verifiziert** — ohne Ausnahme.

## Index (thematisch)

| Aufgabe | Sektion |
|---|---|
| Migration schreiben oder gegen Production anwenden | [1. Datenbank, Migrationen und Production-Ledger](#1-datenbank-migrationen-und-production-ledger) |
| Kunden-/Vorgangsnummern, Nummernlogik | [2. Nummern und Nummernlogik](#2-nummern-und-nummernlogik) |
| Checklisten, Textbausteine, Checklisten-Audit | [3. Checklisten, Textbausteine und Checklisten-Audit](#3-checklisten-textbausteine-und-checklisten-audit) |
| `SECURITY DEFINER`, `security_invoker`, Grants, RLS, neue Tabelle/View/Function in `public`, Storage-Policies, Bucket `attachments`, Tabelle `public.attachments`, die Löschintent-Warteschlange, der Anhang-Liveness-Resolver, die Serialisierung je Objektschlüssel und die Projektion der Notiz-Anhänge | [4. Security und Zugriff](#4-security-und-zugriff) |
| RBAC-/RLS-Änderung lokal verifizieren; Work-Read-Model- und Zwei-Sessions-Suiten | [5. Kanonische lokale SQL-Testsequenz](#5-kanonische-lokale-sql-testsequenz) |
| `sales`, `users` Edge Function, Auth, Rolle, Zugang, Anmeldeadresse, Offboarding, Kontolöschung | [6. Mitarbeiter-Lifecycle W1–W6-B](#6-mitarbeiter-lifecycle-w1w6-b) |
| CRM-Audit-Verlauf, `audit_events` | [7. CRM-Audit-Verlauf](#7-crm-audit-verlauf) |
| Google Kalender, Kalender-RBAC, OAuth | [8. Google Kalender](#8-google-kalender) |
| Rollenabhängige Oberfläche, Zugriffsschutz in der UI, Dialoge, Fehlergrenzen | [9. Rollenbewusste UX und Zugriffsschutz](#9-rollenbewusste-ux-und-zugriffsschutz) |
| Demo-Modus, Rollensimulation | [10. Demo-Modus und Rollensimulation](#10-demo-modus-und-rollensimulation) |
| Operation-IDs, OperationManager, Operations-Katalog, Idempotency/Replay | [11. Operationen: Correlation, Manager, Katalog](#11-operationen-correlation-manager-katalog) |
| Neuer Business-Fehlercode, `operation_errors`, Error Observatory | [12. Fehler: Contract und Observatory](#12-fehler-contract-und-observatory) |
| Notification-Karte, Toasts, Feedback-Schicht, Overlays | [13. Notifications und Feedback](#13-notifications-und-feedback) |
| Service Worker, Update-Hinweis, Live-Smoke nach Deployment | [14. PWA und Update-Verhalten](#14-pwa-und-update-verhalten) |
| Kunden-/Kontaktanlage, `customer_kind`, Hauptansprechpartner, Kunde eines Vorgangs (`deals.company_id`) | [15. Kunden, Kontakte und Hauptansprechpartner](#15-kunden-kontakte-und-hauptansprechpartner) |
| E2E-Tests (Playwright), Fixtures, Test-Reset, CI-Job `e2e-test` | [16. E2E-Testinfrastruktur und Isolation](#16-e2e-testinfrastruktur-und-isolation) |
| W8-E Release: Branding-Umzug, Runtime, Client-Konvergenz, Umstellung des Buckets `attachments` auf privat, Rollback | [17. W8-E Release: privater Anhang-Bucket](#17-w8-e-release-privater-anhang-bucket-stage-a--b--c-rollback) |

---

## 1. Datenbank, Migrationen und Production-Ledger

**Wann:** jede Migration, jeder Schreibzugriff auf eine echte Production-Datenbank (Supabase MCP). Durable Migrations- und Datenregeln: [`03`](03-data-model-guardrails.md) §4 (Migrationsinvarianten). Universelle Release-Reihenfolge und Freigaberegeln: [`07`](07-agent-change-checklist.md).

- [ ] **Ledger-Drift ist der Normalfall, nicht die Ausnahme.** Sofort nach dem Apply `list_migrations` prüfen: das Zeitstempel-Präfix muss exakt dem lokalen Dateinamen entsprechen — `apply_migration` trägt regelmäßig den **Anwendungszeitstempel** statt des Dateiname-Zeitstempels ein (bei jedem `apply_migration`-Production-Apply seit 2026-08-25 aufgetreten, zuletzt W8-C S1, S2A1, S2A2.1, S2A2.2, S3A und S3B; der CLI-Weg `db push` trug bei W8-B den Dateinamen-Zeitstempel korrekt ein; Evidenz im Archiv `releases/`). Der Release gilt erst als abgeschlossen, wenn der Ledger 1:1 zum Repository passt.
- [ ] **Korrektur nur nach Halt und expliziter PO-Freigabe.** Vor der Korrektur read-only verifizieren, dass die betroffene Zeile eindeutig zur gerade angewendeten Migration gehört (Name **und** Inhalt/`statements`-Spalte). Dann transaktional und fail-closed **exakt eine Zeile** korrigieren — der Schritt bricht ab, wenn Zeilenzahl, Abwesenheit der Zielversion, Eindeutigkeit des Namens oder der Inhalts-Fingerprint der Zeile nicht stimmen —, danach erneut read-only bestätigen: `list_migrations` deckt sich wieder 1:1 mit dem Repo, keine andere Zeile verändert.
- [ ] **In einem frischen Klon oder Worktree zuerst `npm run signing-keys:ensure`.** `supabase/signing_keys.json` ist absichtlich nicht versioniert und wird pro Maschine erzeugt; ohne diesen Schritt scheitert **jedes** Supabase-CLI-Kommando, bevor die eigentliche Aufgabe beginnt — der Fehlschlag sieht dann wie ein Migrations- oder Verbindungsproblem aus und ist keines. **Den generierten Schlüssel nie committen** (offener Ergonomiepunkt: [`17`](17-known-issues-and-planned-waves.md) I.10).
- [ ] `npx supabase db reset --local` nach jeder neuen Migration — die Migration muss reproduzierbar durchlaufen.
- [ ] **Der Production-Runner muss beim ersten Fehler abbrechen.** Ein `psql -f …` **ohne** `-v ON_ERROR_STOP=1` ist **kein** zulässiges Production-Migrationsverfahren: eine Migration mit fail-closed Vorbedingungsblock läuft sonst trotz abgewiesener Vorbedingung weiter und hinterlässt einen Teilzustand. Kanonisch ist der Supabase-CLI-Weg (`db push`) oder `apply_migration`; ein Ad-hoc-`psql` nur mit `ON_ERROR_STOP`.
- [ ] **Ledger-Korrektur ist kein Routineschritt.** Sie ist die dokumentierte Abhilfe für eine festgestellte Drift (oben), nicht ein fester Bestandteil eines Deployments. Der W8-B-Apply über die CLI trug den Dateinamen-Zeitstempel korrekt ein und brauchte **keine** Korrektur — erst prüfen, dann nur bei echter Drift und mit PO-Freigabe eingreifen.
- [ ] Schema-Dateien (`supabase/schemas/01_tables` … `06_grants`) mit der Migration synchron halten. `06_grants.sql` wird von keinem `db reset` ausgeführt und ist **nie** die Quelle für eine Privilegienaussage (siehe Sektion 4).

## 2. Nummern und Nummernlogik

**Wann:** Änderungen an `customer_number` / `case_number` oder ihren Generatoren. Spezifikation: [`08`](08-numbering-and-global-search.md).

- [ ] `npx supabase db reset --local` (Migration reproduzierbar?)
- [ ] NULL-/Duplikat-/Format-Check für `customer_number` / `case_number`
- [ ] Immutability lokal getestet (`UPDATE` muss fehlschlagen)
- [ ] INSERT mit Fake-Nummer erzeugt **keine** Client-Nummer (Hardening)
- [ ] `next_*` nicht per RPC für `anon`/`authenticated` ausführbar
- [ ] keine zweite Nummernlogik in Demo, CSV oder UI-Formularen

## 3. Checklisten, Textbausteine und Checklisten-Audit

**Wann:** Änderungen an Checklistenvorlagen, Runs, Textbausteinen oder deren Audit-Pfad. Contract: [`10`](10-checklists-snippets-audit.md).

- [ ] [`10`](10-checklists-snippets-audit.md) gelesen
- [ ] kein JSONB-only als Haupt-Checklistenmodell
- [ ] `label_snapshot` an `checklist_run_items` vorhanden
- [ ] `audit_events` append-only (kein UPDATE/DELETE für App-Rollen)
- [ ] `service_area_code` nicht mit `company_id` verwechselt
- [ ] Vorlagen/Snippets: `is_active = false` statt DELETE
- [ ] keine Audit-Daten in Notizen/Freitext
- [ ] FKs für deal, company, contact, checklist_run konsistent
- [ ] `npx supabase db reset --local` nach Migration
- [ ] `supabase/tests/checklists_audit_verification.sql` ausführen (Docker: `supabase_db_atomic-crm-demo`)
- [ ] Checklisten-Start über RPC `start_checklist_run_from_template` — keine manuellen Run-Item-Inserts vom Client

## 4. Security und Zugriff

**Wann:** Änderungen an `SECURITY DEFINER`-Functions/Views, `security_invoker`, Grants oder RLS; jede neue Tabelle, View oder Function in `public`.

> **Contract: [`22-security-and-access.md`](22-security-and-access.md) — Pflichtlektüre vor der Änderung.** Dort steht, *was wahr sein muss* (Enforcement-Prinzip, Rollen, Trust Boundaries, Grants/RLS, Tabellen- vs. Function-Defaults, `SECURITY DEFINER`, Session-Binding). Hier steht nur, *was zu tun und zu beweisen ist*. Die Regeln werden nicht wiederholt; ein Widerspruch zwischen beiden ist ein Befund.

- [ ] Zugriffsmatrix geprüft: `anon`, `authenticated viewer`, `authenticated office`, `authenticated admin`, `service_role` (nur soweit relevant)
- [ ] Grants immer als `revoke all` → gezielter `grant`; Privilegienaussagen gegen die **Datenbank** prüfen (`has_table_privilege`, `has_function_privilege`, `pg_class.relacl`, `pg_proc.proacl`, `pg_default_acl`) — **nie** gegen `06_grants.sql`
- [ ] **Objekttyp bestimmen, bevor über Rechte geurteilt wird:** neue Tabelle/View → startet ohne API-Rollen-Recht, braucht explizite Grants; neue **Function** → startet mit `PUBLIC EXECUTE`, braucht ein explizites `revoke`. Die Tabellenregel nie auf Functions übertragen ([`22`](22-security-and-access.md) Abschnitt 6.3)
- [ ] **Advisor-Finding einzeln bewerten, in beide Richtungen** — kein Beweis für einen Exploit, kein Beweis für Harmlosigkeit; `security_invoker` nie reflexhaft setzen; `trigger`/`event_trigger`-Rückgabetyp ist ein struktureller Falsch-Positiv ([`22`](22-security-and-access.md) Abschnitt 7.1)
- [ ] Bei `init_state`/`sales_directory`: die bestehende Bewertung ([`06`](06-decision-log.md) „Intentional privileged read views"; Einzelbewertungen im Archiv `releases/2026-08.md`) gilt nur für die dort geprüfte Projektion und deren Grants — bei Änderung **neu bewerten**, nie die alte Einstufung übernehmen
- [ ] **Security Hardening Wave 1** (`PRODUCTION VERIFIED` 2026-09-07 — der Vertrag ist live, nicht mehr Vorschlag): `supabase/tests/public_privilege_hardening_verification.sql` ausführen. Sie prüft Default-Privilegien, die exakte Zielmatrix aller `public`-Objekte, `anon`-Reichweite, Capability-Rollen (inkl. Spalten-Grant `sales.email`), Schema-`CREATE`, die Future-Object-Regression und die tatsächlichen `TRUNCATE`/`DELETE`-Verweigerungen; sie rollt sich selbst zurück und ist an jeder Stelle nach einem `db reset` lauffähig
- [ ] **Neue Tabelle/View in `public`?** Zielmatrix in `06_grants.sql` **und** Assertion in der Wave-1-Suite ergänzen, sonst ist das Objekt über PostgREST unerreichbar (oder still zu weit offen)
- [ ] **Neue sensible Function / neue public RPC?** Eigenes `revoke all on function … from public, anon, authenticated` (bei RPCs zusätzlich `service_role`, sofern kein belegter, deployter Aufrufer existiert) und danach genau ein gezielter Grant — geprüft mit `has_function_privilege`, nicht angenommen
- [ ] **Nie `MAINTAIN` im DDL**; nur Assertions über `current_setting('server_version_num')` verzweigen
- [ ] **Kein neues `DELETE`-Grant für `service_role` in `public`** ohne belegten, deployten Aufrufer; `revoke` immer namentlich an `anon, authenticated, service_role` (Capability-Rollen nie als `revoke`-Ziel)
- [ ] **`CREATE ON SCHEMA public`** bleibt bei keiner Rolle stehen — bei Bedarf in derselben Migration gewähren und vor deren Ende entziehen
- [ ] `nora_private` nicht in `config.toml` schemas; `nora_role_manager` NOLOGIN — keine Mitgliedschaft für `authenticated`
- [ ] keine GUC-Namen `nora.allow_sales_privilege_change` / `nora.privilege_rpc_token` im Code
- [ ] Testmatrix als `postgres` mit `SET LOCAL ROLE nora_rls_test` — **kein** festes Testpasswort in Git
- [ ] **Grant-Matrix aktualisiert:** Zielmatrix in `06_grants.sql`, positive **und** negative Assertions in der Wave-1-Suite, Berechtigungsmatrix in [`22`](22-security-and-access.md) Abschnitt 4.3 — eine Rechteänderung ohne Assertion ist nicht bewiesen
- [ ] `canAccess.ts` an die Rollenmatrix in [`22`](22-security-and-access.md) angeglichen; Teamlisten über `sales_directory`
- [ ] **Storage / Bucket `attachments` berührt?** Contract [`22`](22-security-and-access.md) Abschnitt 6.5 lesen, dann beide W8-B-Suiten ausführen: `supabase/tests/attachment_storage_hardening_verification.sql` (Policies, Bucket-Grenzen, Abwesenheit des Löschpfads; self-contained, rollt zurück) und `supabase/tests/attachment_storage_policy_verification.mjs` (echte Storage-API-Aufrufe je Rolle und Zugangszustand). Die SQL-Suite allein beweist **nicht**, wie `storage-api` antwortet
- [ ] **Tabelle `public.attachments` berührt?** Contract [`22`](22-security-and-access.md) Abschnitt 6.6 lesen, dann `supabase/tests/attachment_foundation_verification.sql` ausführen (Tabellenform, Ownership-XOR, `storage_key`-Unique, FK-`CASCADE`, RLS-Policies, Privilegienmatrix je Rolle; self-contained, rollt zurück). Sie ist von den beiden W8-B-Storage-Suiten **unabhängig**: die eine prüft Metadaten in `public`, die anderen den Bucket — eine grüne Suite beweist die andere Fläche nicht
- [ ] **Löschintent-Warteschlange oder Capture-Trigger berührt?** Contract [`22`](22-security-and-access.md) Abschnitt 6.7 lesen, dann `supabase/tests/attachment_deletion_capture_verification.sql` ausführen (Warteschlangenform und Constraints, partieller Unique-Index über die aktiven Zustände, Trigger auf `public.attachments` über alle sechs Löschpfade inkl. `CASCADE`, Fail-closed-Verhalten, `nora_private`-Abschottung und Privilegienmatrix je Rolle; self-contained, rollt zurück). Sie ersetzt die S1-Suite **nicht** — die eine prüft die Metadatenzeile, die andere die Erfassung ihres Verschwindens
- [ ] **`public.attachments` wird seit W8-C S3B ausschließlich von der Datenbank geschrieben** — als Projektion der Notiz-Anhang-Arrays ([`22`](22-security-and-access.md) Abschnitt 6.11). Wer Anhänge ändert, ändert das Notiz-Array; **nie** einen zweiten Schreiber (Dual-Write, RPC, Import, `service_role`) daneben bauen und den entzogenen direkten `INSERT`/`DELETE`-Grant für `authenticated` **nicht** „wiederherstellen". Seit W8-C S5 **liest** die Anwendung die Tabelle — ausschließlich als **Vertrauensquelle** des Anhang-Lese-Gates ([`22`](22-security-and-access.md) Abschnitt 6.12), nie als Anhang-Nutzlast: **nie** behaupten, Nora zeige Anhänge *aus* der Tabelle (angezeigt wird das verifizierte Legacy-Array), **nie** `src`, Reihenfolge oder `rawFile` aus den Zeilen rekonstruieren, **nie** aus einer fehlenden Zeile auf „kein Anhang" schließen (das ergibt `drift`, nicht „leer"), die Zeilenzahl nie als Invariante prüfen (S4 hat eine Momentaufnahme hergestellt, kein Constraint), und ein Zeilen-`DELETE`/`CASCADE` **nie** als „die Datei wird gelöscht" beschreiben
- [ ] **Notiz-Lesepfad, Read-Model-Zustände oder die Anhang-Darstellung berührt** (W8-C S5)? Contract [`22`](22-security-and-access.md) Abschnitt 6.12 und [`03`](03-data-model-guardrails.md) §1.8 lesen. Regeln, die nicht verhandelbar sind: **`[]` (verifiziert leer) nie mit `null` (nicht verbürgt) zusammenfallen lassen**; ein nicht angereicherter Lesevorgang ergibt `unverified`, **nie** `ok`; eine neue `getMany`/`getManyReference`-Nutzung wird **nicht** zur Anzeigefläche für Anhänge, ohne die relationale Evidenz bewusst herzustellen; der verifizierte Renderer bekommt **nur** verifizierte Arrays, Wiederherstellungsdaten bleiben schreibgeschützt (keine Bildvorschau, kein Eingabefeld, keine Schreibquelle) — **Anzeigen ist keine Verifikation**; der Schreibwächter greift **vor** dem Storage-Upload, damit ein abgewiesener Schreibvorgang kein Objekt zurücklässt; Read-Model-Metadaten werden vor jedem Schreibvorgang entfernt und **nie** persistiert. Ein FakeRest-`ok` ist eine Setzung, kein geprüfter Zustand ([`05`](05-demo-data-guidelines.md)) — **nie** als Paritätsbeweis für Production werten. Die heutige Bild-/Link-Darstellung ist **nicht** der abgenommene Viewer und darf umgebaut werden, solange dieselbe Trennung aus verifizierten und Wiederherstellungsdaten konsumiert wird
- [ ] **Liveness-Resolver, seine Helfer oder die Referenzflächen berührt?** Contract [`22`](22-security-and-access.md) Abschnitt 6.8 lesen, dann `supabase/tests/attachment_liveness_resolver_verification.sql` ausführen (Funktionsform und Security-Settings, API-Grenze je Rolle, URL- und Dateiwert-Klassifikation, jede registrierte Fläche gegen echte Zeilen, `live` dominiert `unknown`, Fehler werden nie zum Urteil, RLS-Drift wirft, Katalog-Vollständigkeitswächter, `skipped_live`-Vokabular; self-contained, rollt zurück). Sie braucht das **saubere Referenzuniversum** eines frischen `npx supabase db reset --local` und bricht sonst laut ab. Sie ersetzt die S1- und S2A1-Suiten **nicht**
- [ ] **Neue Spalte, die einen Objektschlüssel oder eine Storage-URL tragen kann?** Im Resolver per Migration registrieren **oder** im Vollständigkeitswächter der Suite ausdrücklich als ausgeschlossen klassifizieren — eine nicht registrierte Referenzfläche ist für den Resolver unsichtbar, ihre Schlüssel erschienen als `dead` ([`03`](03-data-model-guardrails.md) §1.8). Ein neuer Storage-Origin (z. B. eine eigene Domain) wird ebenfalls nur per Migration in die Origin-Allowlist aufgenommen; bis dahin sind seine Verweise `unknown`
- [ ] **Production-Apply einer Resolver-Migration: semantische Vorbedingungen vorher prüfen, `unknown` nie als Erfolg werten.** Vor dem Apply read-only prüfen, dass der `configuration`-Rest (ohne die beiden Branding-Schlüssel) den Stolperdraht **nicht** auslöst — sonst ergäbe jeder Schlüssel `unknown`. Nach dem Apply muss ein synthetischer, garantiert unreferenzierter Schlüssel `dead` liefern und bekannte Referenzen (Notiz, Logo, URL-only-Branding) `live`; ein `unknown` an dieser Stelle heißt **STOP und untersuchen**, nicht „grün, weil nicht `live`". Smoke-Schlüssel und echte Objektschlüssel/URLs gehören in die Release-Session, nie in durable Dokumentation
- [ ] **Ausführungsvertrag der Warteschlange berührt** (claim/inspect/fail, Lease-Konstanten, Recovery-Index)? Contract [`22`](22-security-and-access.md) Abschnitt 6.9 lesen. Dann `supabase/tests/attachment_deletion_queue_execution_verification.sql` ausführen. Die Suite prüft die Form und Security-Settings der sechs Functions, die API-Grenze je Rolle, die Konstanten, Claim, Stale-Recovery, Lease-Verlust, ABA und Fail, die Abbildung `live`/`unknown`/`dead` sowie dass kein Pfad `done` schreibt; sie ist self-contained und rollt zurück. **Zusätzlich** läuft die echte Mehrsitzungs-Matrix `supabase/tests/attachment_deletion_queue_concurrency_runner.ps1` — nur lokal, nie gegen Production. Die SQL-Suite beweist keine echte Nebenläufigkeit: ein fehlendes `SKIP LOCKED` in Auswahl oder Recovery zeigt nur die Matrix. Beide ersetzen die S1-, S2A1- und S2A2.1-Suiten **nicht**
- [ ] **Schlüsselsperre, Referenz-Zulassung, `storage_key`-Unveränderlichkeit oder die Sperr-Reihenfolge in Erfassung/Inspektion berührt** (W8-C S3A)? Contract [`22`](22-security-and-access.md) Abschnitt 6.10 und [`03`](03-data-model-guardrails.md) §3.3 lesen. Dann `supabase/tests/attachment_reference_serialization_verification.sql` ausführen: Form und ACL der Functions, exakte Sperre und ihre Transaktionsbindung, `READ COMMITTED`-Verweigerung unter `REPEATABLE READ`/`SERIALIZABLE`, Zulassungsmatrix je Warteschlangenzustand, Unveränderlichkeit, `SELECT`-only-Zugriff, Cascades; self-contained, rollt zurück. **Zusätzlich** die echte Mehrsitzungs-Matrix `supabase/tests/attachment_reference_serialization_concurrency_runner.ps1` — nur lokal, nie gegen Production. Nur sie beweist die Rennen (LOW-1, Re-Referenzierung, Zulassung gegen ein nicht committetes `DELETE`). Beide ersetzen die S1-, S2A1-, S2A2.1- und S2A2.2-Suiten **nicht**; wer S3A anfasst, führt diese mit aus, weil S3A Trigger-Inventar, Grant-Matrix und Inspektion verändert
- [ ] **Projektion der Notiz-Anhänge, Grammatik v1 oder die Trigger auf `contact_notes`/`deal_notes` berührt** (W8-C S3B)? Contract [`22`](22-security-and-access.md) Abschnitt 6.11 und [`03`](03-data-model-guardrails.md) §1.8/§3.3 lesen. Dann `supabase/tests/attachment_note_projection_verification.sql` ausführen: Form und ACL der drei Functions, genau vier `AFTER`-Zeilentrigger ohne `DELETE`-Projektion, Grammatik v1 auf beiden Notiztabellen, Delta-Matrix (`ADD`/`KEEP`/`REMOVE`, Umsortieren, Metadatenänderung, Duplikate), Null-Arbeit bei reiner Textänderung, Zulassung über Notiz-Schreibvorgänge samt Atomarität, Cascades, First-Touch der Bestandsnotizen, RBAC, RLS-Drift, `READ COMMITTED`; self-contained, rollt zurück. **Zusätzlich** die echte Mehrsitzungs-Matrix `supabase/tests/attachment_note_projection_concurrency_runner.ps1` — nur lokal, nie gegen Production; nur sie beweist den frischen Blick auf die Zeilen nach dem Warten auf die Notizzeile und die deadlockfreie Einfügereihenfolge. Wer S3B anfasst, führt die S1- bis S3A-Suiten mit aus. **Wer die Grammatik verschärft, zählt vorher read-only, welche Bestandselemente sie nicht mehr erfüllten** — sonst ließe sich eine bereits gespeicherte Notiz mit einem solchen Element anhangseitig nicht mehr ändern, solange es im Array bleibt (S3B selbst hat vor dem Anlegen der Trigger einen fail-closed Bestandszensus erzwungen)
- [ ] **Neuer direkter Aufrufer des Abgleich-Kerns?** `nora_private.reconcile_note_attachments(...)` wiederverwenden — **kein** zweiter Abgleich-Algorithmus, keine zweite Grammatik. Vor dem Aufruf die Notizzeile sperren (`FOR UPDATE`): der Kern setzt voraus, dass der Aufrufer sie hält. Die Schlüsselsperre nie selbst nehmen, Lock-Reihenfolge aus [`03`](03-data-model-guardrails.md) §3.3 einhalten, unter `READ COMMITTED` laufen, in kleinen Transaktionen statt einer großen. **Vorlage ist der ausgelieferte S4-Backfill** unter `supabase/maintenance/attachment_backfill/` — eine Notiz je Aufruf, Sperre vor dem Lesen des Arrays, Neuklassifikation unter der Sperre, fail-closed bei allem außer „leer" und „exakt"
- [ ] **Operator-Werkzeug unter `supabase/maintenance/` berührt oder ergänzt?** Das Verzeichnis ist **nicht** `supabase/tests/`: die Dateien laufen gegen **echte** Daten und committen. Die Regeln stehen in `supabase/maintenance/README.md` — eine schreibende Datei sagt das im Namen, in der ersten Zeile und im Kopf; eine lesende Datei muss jederzeit Production-sicher sein; „read-only" wird nie unqualifiziert behauptet (*keine durable Mutation* ≠ *strikt SQL-read-only*); pure SQL ohne psql-Meta-Kommandos, damit derselbe Text über MCP `execute_sql` und `psql` läuft; keine hartcodierten Production-Bezeichner. Ein mutierender Lauf gibt sein Ergebnis **in derselben Invocation** zurück — ein Operator darf nie aus einer späteren Abfrage rekonstruieren müssen, was passiert ist
- [ ] **Einen Bestandsbackfill in Production ausführen?** Reihenfolge: kanonischer Konsistenzprüfer **und** Preflight als **eine** Payload in **derselben** Sitzung (der Prüfer legt einen `pg_temp`-Helfer an, der mit der Sitzung stirbt — getrennt gesendet schlägt der Preflight fail-closed fehl), dann der Runner **einmal pro Notiz**, dann der Prüfer erneut. Das Ergebnis einer Invocation ist die **Zeile, die sie zurückgibt** — nie ein `NOTICE`, nie eine Nachfrage. Bei jedem SQL-Fehler **STOP**: die bereits committeten Notizen bleiben stehen, werden nie manuell zurückgerollt, und ein späterer autorisierter Lauf setzt nach einem **frischen** Preflight fort. Vor der ersten Mutation Release-Identität und Ledger read-only bestätigen
- [ ] **Resolver-, Ausführungs-, S3A- und S3B-Suite laufen außerhalb des Fensters `setup` → `teardown` aus Sektion 5** (davor oder danach), auf dem sauberen Referenzuniversum eines frischen `npx supabase db reset --local`. `setup` gewährt der Testrolle `EXECUTE` auf die `nora_private`-Functions, und die Owner-only-ACL-Assertion dieser Suiten meldet das zu Recht. Ein Fehlschlag innerhalb dieses Fensters ist Reihenfolge, kein Regressionsbefund
- [ ] **Production-Apply einer Migration, die die S3A-Schlüsselsperre oder die S3B-Projektion nutzt oder ändert: `READ COMMITTED` vorher read-only prüfen.** Datenbank-/Sitzungsdefault `default_transaction_isolation = read committed` und **keine** abweichende Isolations-Einstellung auf Datenbank- oder Rollenebene für `postgres`, `authenticator`, `authenticated`, `service_role`. Eine Abweichung heißt **STOP**: sie ließe jeden Anhang-Schreibvorgang fail-closed scheitern. Diese Einstellungen nie ändern, ohne 22 §6.10 neu zu bewerten
- [ ] **Neuer Aufrufer von Claim und Inspektion (S2B-Worker)?** `attachment_deletion_claim_next()` und `attachment_deletion_inspect()` **nie in derselben Transaktion** aufrufen — gegen eine gleichzeitige Erfassung endet das in `40P01` ([`22`](22-security-and-access.md) Abschnitt 6.10, [`17`](17-known-issues-and-planned-waves.md) H.1). Eine andere Reihenfolge nur mit eigenem Entwurf und eigener Mehrsitzungs-Matrix
- [ ] **Die Warteschlange hat seit S2A1 einen Erzeuger und seit S2A2.2 einen datenbankinternen Ausführungsvertrag, aber keinen Konsumenten; Resolver und Ausführungs-Functions haben keinen produktiven Aufrufer.** Ein Eintrag ist ein Lösch**vorhaben**, ein `dead` eine Momentbeobachtung — beides keine Erlaubnis. **Nie** einen Worker, eine API- oder `service_role`-Ausführungsgrenze, einen Ack-/`done`-Pfad oder einen Storage-`DELETE` ergänzen, solange die S2B-Gates offen sind — Seiteneffekt-Vertrag, getrennte Transaktionen für Claim und Inspektion, quellenübergreifende Schlüssel. S3A hat LOW-1 und das Re-Referenzierungs-Rennen nur für zeilenbasierte `public.attachments`-Verweise geschlossen; seit S3B entstehen echte Vorhaben, und seit S4 sind auch die Bestandsnotizen projiziert — ein veraltetes Formular kann trotzdem ein Vorhaben für einen noch gewollten Anhang erzeugen (S2B-Gate), und ein Objekt, das seine letzte Referenz im Fenster S3B → S4 verloren hätte, trüge in diesem Fall kein erfasstes Löschvorhaben (beobachtet wurde ein solcher Fall nicht, [`17`](17-known-issues-and-planned-waves.md) H.1). Sonst löscht Nora Dateien, die wieder referenziert wurden, oder verliert Vorhaben ([`17`](17-known-issues-and-planned-waves.md) H.1). Ein `service_role`-Recht entsteht nur zusammen mit einem deployten Aufrufer ([`22`](22-security-and-access.md) Abschnitt 6.3). `skipped_live` nicht als „gelöscht" oder „dauerhaft sicher" lesen, `dead` nie speichern oder als „löschbereit" ausdrücken. In Capture-Funktion, Resolver und Ausführungs-Functions kommt **nie** ein HTTP-, `pg_net`-, Storage- oder Edge-Aufruf; ein `exception when others`, das Fehler in `unknown` oder `dead` verwandelt, ist ein Defekt
- [ ] **Policies auf `storage.objects` nie „aufräumen".** Permissive Policies werden ODER-verknüpft: eine zusätzliche permissive Policy öffnet den Bucket, eine fremde zu löschen kann eine andere Fläche stilllegen. Unbekannte Policies führen zum Abbruch der Migration und zu einer PO-Entscheidung, nicht zu einem `drop policy`
- [ ] **Nicht behaupten, der Bucket sei privat.** Solange `storage.buckets.public = true` ist, liefert `storage-api` jeden bekannten Objektschlüssel ohne Anmeldung aus — unabhängig von jeder RLS-Policy ([`17`](17-known-issues-and-planned-waves.md) H.1)
- [ ] **Bucket-Sichtbarkeit von `attachments` ändern (W8-E Stage C) oder zurückdrehen?** Nie ad hoc, nie per Migration und **nie per SQL auf „privat"** (umgeht den CDN-Purge der Storage-API) — ausschließlich nach Sektion 17, mit `supabase/maintenance/attachment_privacy/10_set_attachments_privacy.mjs`
- [ ] **W8-E-Zugriffsschicht, Branding-Bucket oder die Werkzeuge unter `supabase/maintenance/attachment_privacy/` berührt?** Contract [`22`](22-security-and-access.md) Abschnitt 6.14 lesen. Dann `npm run test:unit:functions` (enthält `attachment_privacy/lib/privacy_control.test.ts`: Stage-C-Verfahren, Kompensation, Wächter gegen einen SQL-Flip und gegen Runbook-Rückfälle), die App-Tests der Zugriffsschicht und der Sitzungsgrenzen, und lokal auf einem frischen `db reset` **nach** den Attachment-SQL-Suiten `supabase/tests/attachment_privacy_verification.mjs` sowie `attachment_storage_policy_verification.mjs` in beiden Stufen (`NORA_ATTACHMENTS_EXPECTED_PUBLIC`). Der Privacy-Verifier läuft gegen einen eigenen Stack: `NORA_DB_CONTAINER` auf dessen Datenbank-Container setzen und aus dessen Projektverzeichnis starten

## 5. Kanonische lokale SQL-Testsequenz

**Wann:** jede RBAC-/RLS-/`SECURITY DEFINER`-Änderung und jede Lifecycle-Welle. Läuft ausschließlich lokal nach `npx supabase db reset --local`; die Übernahme in CI ist ein offener Punkt ([`17`](17-known-issues-and-planned-waves.md) Abschnitt B, Eintrag W9).

Reihenfolge:

`production_check` → `first_admin_parallel` → `setup` → `matrix` → `final_hardening` → `checklists_audit` → `crm_audit` → `google_calendar` → `teardown` → `production_check`

- [ ] **Keine Testrolle** nach `db reset` ohne Setup (`rbac_rls_production_check.sql`)
- [ ] `rbac_rls_verification.sql` gehört wie `rbac_rls_production_check.sql` auf die **leere** Datenbank (vor `setup` oder nach `teardown`): ihre erste Assertion lautet „`nora_rls_test` must not exist after production migrations only". Nach `setup` schlägt sie fehl — das ist Reihenfolge, kein Regressionsbefund
- [ ] `public_privilege_hardening_verification.sql` an beliebiger Stelle nach einem `db reset` — self-contained, rollt zurück, hinterlässt keine Testrolle
- [ ] die Lifecycle-Suiten W1 → W6-B laufen **je zweimal** (leere DB **und** mit Fixtures) in der Reihenfolge aus Sektion 6
- [ ] **Die W-A-Zwei-Sessions-Suite `supabase/tests/work_read_model_session_verification.mjs` läuft nur auf einem frisch zurückgesetzten Wegwerf-Stack — und danach wird erneut zurückgesetzt.** Sie legt echte lokale Auth-Benutzer, `sales`-Zeilen und GoTrue-Sitzungen an, um Kriterium 4 des Work Contracts ([`25`](25-universal-work-model.md) Abschnitt 22) in seiner strengen Lesart zu erfüllen (zwei getrennt authentifizierte Sessions, nicht zwei GUC-Werte). **Diese Identitäten lassen sich nach W6-B nicht mehr normal löschen** — der Guard, der ein unkontrolliertes `DELETE` auf `sales`/`auth.users` verweigert, gilt auch lokal und auch für Testfixturen ([`17`](17-known-issues-and-planned-waves.md) I.6). Verbindlich:
  1. vorher `npx supabase db reset --local`,
  2. Suite laufen lassen,
  3. **danach erneut `npx supabase db reset --local`** — **bevor** eine identitäts- oder lifecycle-sensible Suite läuft (Lifecycle W1–W6-B aus Sektion 6, `rbac_rls_production_check.sql`, `rbac_rls_verification.sql`, `first_admin_parallel`).

  Wer Schritt 3 auslässt, sieht in der nächsten Suite Fremdzeilen und liest Reihenfolge als Regressionsbefund. **Die Suite ist local-only** — sie verweigert jede Nicht-`localhost`-URL und wird nie gegen Production gerichtet; ein Production-Risiko entsteht durch sie nicht.
- [ ] **Work-Read-Model-Änderung (`public.get_work_items`, `nora_private.current_sales_id`)?** Zusätzlich zur Contract-Suite `supabase/tests/work_read_model_verification.sql` gilt der Security-Contract [`22`](22-security-and-access.md) Abschnitt 6.13: `SECURITY INVOKER` für die öffentliche Query (die RLS-Grenze **nicht** durch einen eigenen Autorisierungs-Body ersetzen), `SECURITY DEFINER` nur für den schmalen Actor-Resolver, `EXECUTE` ausschließlich für `authenticated`. Ein Actor-Parameter, ein Lesen von `nora.audit_actor_user_id` oder eine leere Ergebnismenge statt `42501` bei nicht auflösbarem Actor sind Defekte, keine Varianten
- [ ] Bekannter Windows-Tooling-Bug in `rbac_rls_first_admin_parallel_runner.ps1` (die Vorbedingungs-Regex parst die mehrzeilige `psql`-Ausgabe falsch — kein SQL-/Produktfehler) samt Workaround: [`17`](17-known-issues-and-planned-waves.md) Abschnitt B, Eintrag W9. Der Workaround bildet die im Skript enthaltene SQL manuell nach (zwei parallele `docker exec … psql`-Sessions gegen `auth.users`, danach die Verifikation „exakt 1 Admin + 1 Viewer", dann Cleanup) — das Skript **nicht** nebenbei patchen. Achtung: das `DELETE`-Cleanup des Skripts auf `sales`/`auth.users` ist seit W6-B verweigert ([`17`](17-known-issues-and-planned-waves.md) I.6) — Fixtures im Workaround per Rollback entfernen

## 6. Mitarbeiter-Lifecycle W1–W6-B

**Wann:** jede Änderung an `sales`, der `users` Edge Function, Auth, Rollen, Zugang, Anmeldeadresse, Offboarding, Kontolöschung oder Session-Bindung. Architektur-Contract: [`19`](19-user-lifecycle-architecture.md) — **Pflichtlektüre**; dieses Runbook ist nur die operative Ergänzung.

### Testsequenz

Jede Suite direkt nach der vorigen, **je zweimal** (leere DB und mit Fixtures); alle rollen sich selbst zurück:

| Welle | Suite | Zusätzlich |
|---|---|---|
| W1 | `supabase/tests/lifecycle_single_executor_verification.sql` | nach `production_check` (leer) **und** nach `safe_auth_role_verification` (Fixtures) |
| W2 | `supabase/tests/lifecycle_reference_integrity_verification.sql` | — |
| W3 | `supabase/tests/lifecycle_audit_actor_verification.sql` | danach `nora.audit_actor_user_id` / `nora.operation_id` leer |
| W4 | `supabase/tests/lifecycle_email_change_verification.sql` | danach zusätzlich `nora_private.sales_email_change_tickets` leer |
| W5 | `supabase/tests/lifecycle_offboarding_verification.sql` | parkt vorhandene Admins nur innerhalb des Rollbacks; danach zusätzlich `request.jwt.claim.session_id` leer |
| W6-A | `supabase/tests/lifecycle_session_authorization_verification.sql` | restauriert den Helfer-Owner; danach `select nora_private.session_binding_health()` → `healthy = true`, `mode = fail_closed`; `request.jwt.claims` / `request.jwt.claim.session_id` leer |
| W6-B | `supabase/tests/lifecycle_account_deletion_verification.sql` | danach `nora.account_deletion_ticket` / `nora_private.sales_account_deletion_tickets` leer; vor einem Release zusätzlich der reale GoTrue-HTTP-Beweis (Fälle A–D, Archiv W6-B) |

**SQL-Suiten räumen `sales`-Fixtures nur per Rollback auf, nie per `DELETE`** — der Guard verweigert es.

### Schreibpfade

- [ ] **Kein** neuer Schreibpfad für `sales.role` / `sales.disabled` außerhalb `users` Edge Function → `set_sales_access_by_executor`; die Legacy-RPC `set_sales_role_by_admin` ist seit W2 gelöscht und wird **nicht** wieder angelegt
- [ ] jede Änderung an `disabled` bewegt auch den Auth-Bann (Executor), nie nur eine Seite; kein grüner Erfolg ohne verifiziertes `accessConsistency = consistent`
- [ ] **W4 Anmeldeadresse:** `sales.email` und `auth.users.email` **nie** direkt schreiben (kein UPDATE, kein Sync in `handle_update_user`, kein Auth-Admin-`email` außerhalb `users/emailChange.ts`); der einzige Pfad ist `change_email` → `prepare_sales_email_change` → Auth Admin API → `guard_auth_email_change`. Kein PATCH-Feld `email` wieder einführen (`email_change_requires_command`). Neue Identitätsfelder bekommen einen eigenen Capability-Owner, keinen `postgres`-/GUC-Bypass
- [ ] **W5 Offboarding:** Zugang beenden **nur** über `action: offboard` → `public.offboard_employee_by_executor` (Datenbank: `disabled` + Sitzungen + Audit in einer Transaktion → Auth-Bann → Verifikation). Nie `auth.sessions`/`auth.refresh_tokens` aus einer Edge Function oder per RPC für Browser-Rollen löschen; `nora_private.revoke_auth_sessions` bleibt postgres-intern. `user.offboarded` nur bei echter Änderung (`disposition executed`), Replay schreibt nichts
- [ ] **W6-B Hard Delete:** kein zweiter Löschpfad für `sales`/`auth.users` (kein RPC, kein Edge-`DELETE`, kein Dashboard-Workaround); Löschung nur `action: delete_account` → `prepare_employee_account_deletion` → GoTrue Admin Hard Delete → `guard_auth_user_delete`. `guard_sales_delete`/`guard_auth_user_delete` nie deaktivieren. Die Löschprüfung zählt **all-time**

### Referenzen, Zuweisung, Read-Models

- [ ] **W2 Referenzen:** jede neue Spalte, die auf `sales.id` zeigt, bekommt einen `NO ACTION`-FK (nie `CASCADE`, nie `SET NULL`) und wird in der W2-Suite (Abschnitt 1 Zählung, Abschnitt 5 Blockade) ergänzt; kein `DELETE`-Grant und keine DELETE-Policy auf `sales` für Browser-Rollen; kein Trigger/RPC, der `sales`-Zeilen für normale Clients löschbar macht
- [ ] **W2 Zuweisung:** jede neue Spalte mit **aktueller Zuständigkeit** (nicht Urheberschaft) bekommt zusätzlich `guard_active_assignment_trigger` (`before insert or update of <spalte>`); Picker über `SalesAssignmentInput`, nie ein roher `ReferenceInput` auf `sales_directory`; der Fehler ist `NORA_EMPLOYEE_NOT_ASSIGNABLE`, FakeRest wirft ihn über `guardAssignmentOnCreate/Update`
- [ ] **W2 Read-Models:** Namen bestehender Datensätze (Notiz, Vorgang, Aufgabe, Aktivität, Export) über `sales_identities` (`useGetSalesName`, `SALES_IDENTITIES_RESOURCE`); Auswahl für Neues über `sales_directory` (`SALES_DIRECTORY_REFERENCE_PROPS`); deaktivierte Mitarbeiter nie zu „Unbekannt"/„Ehemalig" umlabeln, solange die Zeile existiert
- [ ] **W2 Views:** `sales_directory` und `sales_identities` bleiben `SELECT`-only (`revoke all` + `grant select`) — sie sind auto-updatable mit Owner `postgres`; jede Projektions-/Grant-Änderung braucht eine neue Security-Bewertung (Sektion 4)
- [ ] **W2 FakeRest:** `sales_directory`/`sales_identities` nur über den Store pflegen (`baseDataProvider.create/update/delete`), nie durch Mutation von `db.*` (wirkungslos)
- [ ] **W5 Preview:** neue Tabellen mit aktueller Zuständigkeit (`sales_id` + Zuweisungs-Guard) in `public.get_employee_dependency_preview` als eigener Zähler ergänzen; Urheberschaft (Notizen) bleibt getrennt und blockiert nie — in der **W6-B-Löschprüfung** blockiert dagegen beides (all-time). Neue Mitarbeiter-Referenzen (Zuständigkeit **oder** Urheberschaft) zusätzlich als Blocker in `nora_private.employee_deletion_preview` ergänzen und in der W6-B-Suite beweisen

### Audit, Session, Fehlercodes

- [ ] **W3 Audit-Actor:** Audit erst nach Provider-/DB-Erfolg schreiben; ein Audit-Fehler wird `audit_write_failed` und meldet **nie** grün; Operation-ID weiterreichen (`users/audit.ts`); Beweis in der W3-Suite und `users/audit.test.ts`. Ereignistyp-Allowlist, Actor-Herkunft und Ziel: [`13`](13-crm-audit-retention.md); Executor-Vertrag: [`22`](22-security-and-access.md) Abschnitt 8.2
- [ ] **W4 Links:** wer die Anmeldeadresse bewegt, muss die `auth.one_time_tokens` des Users löschen (der Guard tut es) — nie `auth.users.confirmation_token`/`recovery_token` rotieren (wirkungslos, `NULL sent_at` lässt GoTrue mit 500 panicken)
- [ ] **W4 Eindeutigkeit:** Adressen vor jedem Provider-Aufruf mit `lower(btrim())` normalisieren; `uq__sales__email` bleibt; Duplikate gegen `sales` **und** `auth.users` prüfen; GoTrue `23505` als `email_already_in_use` mappen
- [ ] **W4 Operationstypen:** neue Katalogtypen, die in `operation_errors` landen sollen, klein schreiben (`^[a-z][a-z0-9_.]*$`), sonst schweigt `record_operation_error`
- [ ] **W5/W6-A Session-Bindung:** `nora_private.is_active_user()` und `current_role()` enthalten `jwt_session_is_live()` — bei jeder Änderung der RLS-Helfer erhalten; neue Helfer, die „aktiver Benutzer" beantworten, ebenfalls binden; Claim-Klassifikation nur in `jwt_session_claim()`, keine Session-Checks in einzelnen Policies. Fixtures mit reinen Legacy-GUCs (`request.jwt.claim.sub`/`role`) laufen im Kompatibilitätspfad „kein JWT übergeben"; Fixtures, die `request.jwt.claims` (JSON) setzen, legen eine echte `auth.sessions`-Zeile an und geben deren `id` als `session_id` mit (Konvention: Sitzungs-ID = User-ID). Jede Migration, die `auth.sessions` oder die Session-Helfer berührt, prüft vorher `has_table_privilege('postgres', 'auth.sessions', 'SELECT')` **und** eine Lookup-Probe (W6-A-Gate)

### Oberfläche

- [ ] **W5:** Offboarding ist eine eigene Aktion mit Bestätigung und Preview, nie ein Nebeneffekt von „Speichern"; offene Zuweisungen sind Hinweis + Links, nie Vorbedingung; kein technisches Vokabular (JWT, Token, Sitzung, GoTrue)
- [ ] **W6-B:** Löschen ist ein eigener destruktiver Abschnitt am Ende der Mitarbeiterakte (nie neben Passwort/E-Mail/Rolle/Zugang), nur für deaktivierte, vom Server als löschbar erklärte Konten; Name im Dialogtitel, getippter Name, Admin-Ziel-Checkbox; Erfolg erst nach Server-Verifikation; Wortlaut „Konto und Anmeldeidentität werden endgültig gelöscht", nie „alle personenbezogenen Daten"; `user.account_deleted`-Metadaten ohne Adresse und Name; Demo ohne Löschpfad

## 7. CRM-Audit-Verlauf

**Wann:** Änderungen am Audit-Verlauf, an `audit_events` oder deren Oberfläche. Contract: [`13`](13-crm-audit-retention.md).

- [ ] [`13`](13-crm-audit-retention.md) gelesen
- [ ] `npx supabase db reset --local` nach Audit-Migration
- [ ] `supabase/tests/crm_audit_verification.sql` ausführen (Docker: `supabase_db_atomic-crm-demo`)
- [ ] `supabase/tests/rbac_rls_matrix.sql` — Audit-Zeilen: Admin global ✅, Office nur RPC ✅, Viewer ❌
- [ ] `supabase/tests/checklists_audit_verification.sql` — Checklisten-Audit unverändert, keine Doppel-Events
- [ ] kein Client-INSERT auf `audit_events`; Schreibweg nur Trigger + `nora_audit_writer`
- [ ] Office: kein direktes `SELECT` auf `audit_events`; nur `get_entity_audit_events`
- [ ] Viewer: `EntityAuditHistory` ausgeblendet (`CanAccess audit_events show`)
- [ ] UI: keine rohen JSON-Dumps; `deal.stage_changed` und `deal.status_changed` gleiches Label
- [ ] `auditUx.test.ts` grün
- [ ] `npm run dev:demo` — Rollenmatrix manuell: Admin `/audit` + Akte; Office nur Akte; Viewer weder noch
- [ ] Demo-Seed: synthetische Events mit `source = demo`, fiktive Personen

## 8. Google Kalender

**Wann:** Änderungen an der Kalenderintegration, am zugehörigen Rollenmodell oder an den `calendar-*` Edge Functions. Architektur/Spezifikation: [`11`](11-google-calendar-rbac.md); Implementierung: [`14`](14-google-calendar-readonly-implementation.md). **Die drei `calendar-*` Edge Functions sind nicht deployt** — Deployment-Stand im Kopf beider Dokumente.

- [ ] [`11`](11-google-calendar-rbac.md) bzw. [`14`](14-google-calendar-readonly-implementation.md) gelesen
- [ ] keine parallele Benutzerverwaltung — Rolle an `sales`, nicht in einer neuen User-Tabelle
- [ ] kein zweites Terminsystem (`appointments`) — nur `google_calendar_events` als Cache
- [ ] Google Kalender = System of Record für Termine; Nora nur Cache + Verknüpfung
- [ ] keine private iCal-Adresse; keine Tokens in Frontend, Audit oder Data-API-Tabellen
- [ ] Kalender-ID nicht in UI-Komponenten hardcoden
- [ ] `origin = google` vs. `origin = nora` bei Schreiboperationen beachten
- [ ] OAuth-Scopes minimal: read-only zuerst, write als eigene Welle
- [ ] bestehende Google-Labels/Farben/Freigaben nicht über Nora ändern
- [ ] Audit-Events für Kalender über die bestehenden `audit_events` — keine neue Audit-Tabelle
- [ ] keine `GOOGLE_*` Secrets in `VITE_*`; Edge Functions nur serverseitig; OAuth-Stubs geben 501/503 ohne Credentials — **kein** Fake-Erfolg
- [ ] Demo: Hinweis „Google Kalender im Demomodus nicht verbunden" — kein Fake-OAuth
- [ ] `supabase/tests/google_calendar_verification.sql` im Testfluss (nach `crm_audit`, vor `teardown`)

## 9. Rollenbewusste UX und Zugriffsschutz

**Wann:** Änderungen an rollenabhängiger Oberfläche, an Schreib-/Löschaktionen, Dialogen, Lade- und Fehlerzuständen. Aktueller Design-Stand: [`02`](02-design-system.md); Rollenmatrix: [`22`](22-security-and-access.md) Abschnitt 4.3. Abnahmevorlage (historisches Protokoll v0.3k.2): [`12`](12-role-ux-acceptance.md).

- [ ] Schreib-/Lösch-Buttons über `NoraAccessActions` oder `CanAccess` — nicht erst der RLS-Fehler
- [ ] `NoraReadOnlyBanner` für Viewer; keine Create-Aktion in Leerzuständen
- [ ] Office: Archivieren sichtbar, Delete ausgeblendet
- [ ] `normalizeCrmError` / `withCrmErrorHandler` — keine PostgREST-Rohtexte in Notifications
- [ ] `NoraAccessGuard` auf allen direkt erreichbaren Edit-/Create-Routen
- [ ] Dirty-Dialog: X/Escape + blockiertes Outside-Close; Quick-Capture-Draft bleibt bei Abbrechen
- [ ] `NoraShowBoundary` / `NoraListBoundary` / GlobalSearch-Fehler mit Retry
- [ ] Import nur Admin
- [ ] `noraRbacUx.test.ts` und `noraV03k1Ux.test.ts` grün
- [ ] manuelle Demo-Abnahme admin / office / viewer (Hotboard, Kanban, Show, Mobile)

## 10. Demo-Modus und Rollensimulation

**Wann:** Änderungen an Demo-Daten, Demo-Session oder Rollensimulation. Contract: [`05`](05-demo-data-guidelines.md) · [`04`](04-routing-i18n.md) Abschnitt Demo-Rollensimulation; kanonische technische Referenz: [`12`](12-role-ux-acceptance.md) Abschnitt „Technische Referenz".

- [ ] `demoSession.ts` ist die einzige Demo-Session-Quelle — kein `setItem(DEFAULT_USER)` beim Import
- [ ] `DemoRoleSwitcher` nur bei `VITE_IS_DEMO=true`; er aktualisiert Profilmenü **und** Berechtigungen nach dem Wechsel
- [ ] `demoRoleSimulation.test.ts` grün
- [ ] [`12`](12-role-ux-acceptance.md) gepflegt, wenn sich die Rollensimulation ändert
- [ ] **Supabase- und FakeRest-Pfad haben dieselbe Semantik.** Keine Demo-Sonderlogik. Wo beide Provider denselben Execute-Wrapper benutzen, ist die Parität strukturell; wo ein Provider `manager.execute` selbst inlined, muss sie explizit nachgezogen und getestet werden

## 11. Operationen: Correlation, Manager, Katalog

**Wann:** Änderungen an Operation-IDs, am `OperationManager`, am Operations-Katalog, an der Idempotency-/Replay-Semantik oder an der Korrelation zwischen Client und `audit_events`.

**Contract (was wahr sein muss):** [`23`](23-operations-errors-feedback.md) §1 (Lifecycle), §2 (Correlation und Identifier, Falle 38), §3 (Idempotency/Retry/Replay, Ausführungsdisposition, Falle 35 Ausführungshälfte) · [`03`](03-data-model-guardrails.md) §5 (Persistenz-Boundary, Falle 35 Persistenzhälfte) · [`13`](13-crm-audit-retention.md) (`audit_events.request_id`) · [`22`](22-security-and-access.md) Abschnitt 5 (Operation IDs korrelieren, sie autorisieren nicht). Begründungen: [`06`](06-decision-log.md) Einträge Operation Correlation / Operation Manager / Idempotency / Operation Status v1. **Hier steht nur die Verifikation.**

- [ ] `nora_private.current_operation_id()` bleibt INVOKER; liefert nur UUID oder NULL; kein Auth-/RLS-Effekt
- [ ] `audit_events.request_id` wird über den zentralen Writer befüllt; keine zweite Spalte
- [ ] Partial Index `audit_events_request_id_idx` (nicht unique)
- [ ] Manager-Tests: `pending` → `success|error`, Exceptions werden weitergereicht und nicht geschluckt, ohne React lauffähig
- [ ] **Singleton-Test:** der `OperationProvider` erzeugt keine zweite konkurrierende Manager-Instanz
- [ ] in-memory only (kein DB/localStorage/Realtime); Regression: ein `pending`-Record wird von der Kapazitätslogik **nicht** evakuiert
- [ ] `useSyncExternalStore` für Listen
- [ ] **Kompatibilitätsprobe:** ein altes Frontend ohne Header bleibt lauffähig (`request_id` NULL)
- [ ] **Falle-38-Regression:** eine ungültige oder uppercase-`operationId` wird verworfen bzw. lowercased — eine Schicht, die eine ID vorab anmeldet, prüft die **tatsächlich vergebene** Kontext-ID
- [ ] `supabase/tests/operation_correlation_verification.sql` lokal nach `db reset`
- [ ] `supabase/tests/operation_status_disposition_verification.sql` lokal nach `db reset` — **suite-gedeckt** sind `executed` in der Erstschreib-Antwort und `replayed` in der Replay-Antwort. **Nicht** suite-gedeckt ist, dass die **gespeicherte** Zeile dabei `executed` bleibt: die Suite liest `nora_private.idempotency_records` nicht. Diese Persistenzhälfte von Falle 35 gehört [`03`](03-data-model-guardrails.md) §5 — wer die Dispositionslogik ändert, weist sie mit einer **direkten Persistenz-Assertion** auf die gespeicherte Zeile nach
- [ ] HTTP-Probe `node scripts/verify-operation-header.mjs` nur gegen lokal, mit **und** ohne Header
- [ ] Unit-Tests Manager A–M + Snapshot/Timer/Singleton + Correlation-Regression

## 12. Fehler: Contract und Observatory

**Wann:** neuer Business-Fehlercode, Änderungen an `normalizeCrmError`, an `operation_errors` oder am Error Observatory.

**Contract (was wahr sein muss):** [`03`](03-data-model-guardrails.md) §6 (universeller DB-/Business-Fehlervertrag: machine-code-first, `error.message`/`error.details` sind nie Business-Codes) · [`23`](23-operations-errors-feedback.md) §4 (eingefrorener `CrmErrorKind`, Observatory-Invarianten, Grenze zu Audit). **Hier steht nur der Ablauf und die Verifikation.**

**Neuen Business-Fehlercode einführen — genau dieser Ablauf, nicht „neues Regex-Pattern ergänzen":**

1. [ ] Kanonischen `NoraErrorCode` in `domain/noraErrorCodes.ts` definieren (`NORA_ERROR_CODES` / `NORA_ERROR_DEFINITIONS`)
2. [ ] Serverseitig an der RAISE-Stelle `USING DETAIL = 'NORA_<CODE>'` setzen (SQL-Migration **additiv**, `supabase/schemas/02_functions.sql` synchron nachziehen)
3. [ ] Presentation-Mapping (`messageKey`) in `NORA_ERROR_DEFINITIONS` ergänzen
4. [ ] FakeRest über `throwNoraError()` denselben Code werfen lassen, soweit FakeRest den Command-Pfad überhaupt modelliert — sonst als Debt dokumentieren, **nicht** Scope aufblasen
5. [ ] Die menschliche `MESSAGE` bleibt frei umformulierbar/diagnostisch — nie als Business-Identität verwenden
6. [ ] Bestehende Regex-Pfade **nicht** entfernen (Legacy-Compatibility für nicht migrierte Aufrufer) — nur der Weg für *neue* Fälle ist dieser

- [ ] `supabase/tests/error_contract_verification.sql` (oder eine Erweiterung) nach `db reset --local` grün — innerhalb der RBAC-Kette aus Sektion 5; auf der frischen Datenbank allein scheitert sie an einer vorbestehenden Reihenfolge-Abhängigkeit ([`17`](17-known-issues-and-planned-waves.md) I.7), das ist kein Befund der eigenen Änderung
- [ ] **Human Message Independence** nachgewiesen, wenn zwei Origins denselben Code liefern: Test mit unterschiedlichem MESSAGE-Text und gleichem DETAIL
- [ ] `npx vitest run` zusätzlich zu `typecheck`/`build`

**Observatory-Änderung zusätzlich:**

- [ ] `supabase/tests/error_observatory_verification.sql` nach `db reset` grün — die Suite ist der Nachweis für die Observatory-Invarianten aus [`23`](23-operations-errors-feedback.md) §4.4 (Trennung von `audit_events`, kein direkter Tabellen-`INSERT`, serverseitiger Actor, UNIQUE `public_ref` und Dedupe per `operation_id`, `technical_context`-Allowlist, soft resource refs); eine neue Spalte oder ein neuer Schreibpfad ergänzt die Suite
- [ ] **Access-Regel bewiesen, nicht behauptet** (Contract: [`22`](22-security-and-access.md) Abschnitt 4.3): dieselbe Suite assertiert, dass ein Nicht-Admin **null** `operation_errors`-Zeilen sieht, ein Admin die Diagnosezeilen liest und ein Report auf eine Zeile mit fremdem Actor mit `42501` scheitert — wer Policy, Grant oder eine der beiden RPCs anfasst, hält alle drei Assertions grün
- [ ] **Best-Effort-Regression:** ein erzwungener Recorder-Fehlschlag lässt die fachliche Exception unverändert durch und rollt die Business-Transaktion nicht zurück
- [ ] Unit-Tests A–H + Kontakttermin-Regression

## 13. Notifications und Feedback

**Wann:** Änderungen an der Notification-Karte, an Toasts, an der Feedback-Schicht eines Flows oder an Overlays/Portalen.

**Contract (was wahr sein muss):** [`23`](23-operations-errors-feedback.md) §5 (Bedeutung: Intent ≠ Operation, Presentation-Lifecycle und Falle 37, Feedback-Policies, Retry-Fähigkeit vs. Retry-Mechanismus) · [`02`](02-design-system.md) (Darstellung: Layer, Position, Geometrie, Timing, Motion, Overlay, Accessibility). **Hier steht nur die Verifikation.**

- [ ] **Migrationsschritt vollständig:** wird ein Flow auf die Notification-Karte migriert, sind seine `notify()`-Aufrufe für dieselbe fachliche Aussage im selben Schritt entfernt — im Diff nachweisen, dass nicht Karte *und* Toast nebeneinander stehen bleiben; sonner bleibt für die nicht migrierten Flows montiert (keine globale Toast-Bereinigung nebenbei)
- [ ] **Kein Phantom-Slot — Regression:** ein Slot wird nur registriert, wenn die Operation wirklich startet, und ein Abbruch vor dem Start hinterlässt keine dauerhaft auf `pending` stehende Karte (`QuickCaptureUnnotifiedError`-Muster)
- [ ] **Import-Guard:** `application/commands/*` importiert weiterhin nichts aus `notifications/` (kein Display Context, kein i18n-Key, kein Tone)
- [ ] kein zweiter `OperationManager`: der `NotificationProvider` liegt unterhalb des `OperationProvider`
- [ ] neue sichtbare Texte kommen aus `crm.notifications.*` in **allen** registrierten Katalogen (Deutsch primär, Englisch gepflegt, französische Struktur nicht still brechen)
- [ ] **Overlay-/Portal-/`z-index`-Verhalten wird in der echten gestylten App abgenommen, nicht nur im Test.** Im Browser-Test-Bundle sind Tailwind-Utilities nicht kompiliert — Aussagen über Geometrie, Sichtbarkeit und Klickbarkeit, die an `@apply`-Klassen hängen (`fixed`, `pointer-events-none`, Abstände), sind dort **nicht** bewiesen und können sogar aus dem falschen Grund grün sein. Belastbar sind im Test nur reine CSS-Deklarationen (`z-index`, `pointer-events` aus eigenen Regeln)
- [ ] bei kritischen Overlay-Änderungen **echter Hit-Test** (`document.elementFromPoint()` o. ä.) auf jedes betroffene Control der darunterliegenden Oberfläche — „sieht richtig aus" ist kein Nachweis
- [ ] **Große, sich verändernde Flächen bekommen keine Live-Rolle.** `role="status"`/`role="alert"` bringen `aria-atomic="true"` mit: jede Mutation im Teilbaum wird als komplette Wiederholung vorgelesen. Sichtbare Präsentation und Screenreader-Ansage trennen (Muster: `NoraNotificationAnnouncer` in 7B, `UpdateAnnouncer` in der PWA-Schicht) — eine kurze Ansage pro Zustandswechsel, Identität über einen React-Key, kein Whitespace-Trick
- [ ] `npx vitest run` zusätzlich zu `typecheck`/`build`

## 14. PWA und Update-Verhalten

**Wann:** Änderungen an Service Worker, Precache oder Update-Hinweis — und bei **jedem** Live-Smoke nach einem Deployment. Der technische PWA-/Update-Contract steht in [`24`](24-pwa-and-update-lifecycle.md) (sektionsweise laden) und wird hier **nicht** wiederholt; Präsentation: [`02`](02-design-system.md) Abschnitt Anwendungs-Systemereignisse; offene Punkte: [`17`](17-known-issues-and-planned-waves.md) Abschnitt E. Hier steht nur, **wie verifiziert wird**.

- [ ] **Ein Reload ist kein belastbarer Live-Smoke.** Welcher Build nach einem Reload sichtbar ist, hängt am Controller-Zustand des Dokuments — bei einem bereits kontrollierten Client im Prompt-Modus garantiert ein Reload allein **nicht**, dass der neue Build läuft (technische Regel: [`24`](24-pwa-and-update-lifecycle.md) §2). Belastbar ist eines von beidem: den Update-Hinweis „Jetzt aktualisieren" auslösen, **oder** in einem frischen Profil bzw. nach `unregister()` des Service Workers testen
- [ ] **Nachweis, dass wirklich der neue Build läuft:** die Asset-Hashes aus dem live ausgelieferten `index.html` gegen das DOM prüfen bzw. auf einen release-spezifischen Marker im Bundle testen
- [ ] **Build-/Release-Identität für Nora: die im ausgelieferten Build eingebettete Commit-SHA.** Sie ist der konkrete Identitätsnachweis dafür, welcher Release tatsächlich live ist — nicht die zuletzt gepushte SHA auf `main`, nicht ein Deployment-Status und nicht die Erwartung aus der Dokumentation. Asset-Hashes des live ausgelieferten `index.html` gegen das DOM und andere Marker helfen **ergänzend** beim Nachweis, dass der neue Build wirklich geladen wurde, ersetzen diese Nora-Identität aber nicht. Der aktuell laufende Release steht in [`16`](16-current-state.md) Abschnitt „Was ist live?"
- [ ] **Vor dem Bauen den ausgelieferten Code der Fremdbibliothek lesen** (`node_modules/<paket>/dist/…`), nicht die README. Was eine Bibliothek dokumentiert und was ihr ausgelieferter Client tut, fällt in dieser Schicht regelmäßig auseinander — dasselbe gilt für effektive Plugin-Defaults ([`24`](24-pwa-and-update-lifecycle.md) §5): nach einem Plugin-Upgrade neu nachlesen, nicht annehmen
- [ ] **E2E beweist hier nichts:** E2E-Builds laufen ohne Service Worker. Ein grüner E2E-Lauf ist kein PWA-Nachweis
- [ ] **Die sechs sichtbaren Zustände lokal herstellen** über das Dev-Werkzeug `pwa/devUpdateTrigger.ts` (nur Dev-Server) — Bedienung und Zustandsmatrix: [`02`](02-design-system.md)

**Im RC3-Release am 2026-09-28 live bestätigt** (Beleg für die erste Regel oben, keine neue Regel): der alte Service Worker lieferte nach dem Deployment zunächst weiter die zwischengespeicherten Vorgänger-Assets, der neue Worker ging in `waiting`, Nora zeigte den Update-Hinweis, und erst die Benutzeraktion **„Jetzt aktualisieren"** aktivierte die neue Fassung — danach entsprachen DOM und Assets dem aktuellen Production-Deployment. **Ein normaler Reload allein ist damit erneut als unzureichender Rollout-Nachweis belegt.** Wer einen Release als „live" meldet, nachdem er nur neu geladen hat, hat den Rollout nicht nachgewiesen.

## 15. Kunden, Kontakte und Hauptansprechpartner

**Wann:** Änderungen an Kunden-/Kontaktanlage, an `customer_kind`, an `is_primary`, an `deals.company_id` oder den zugehörigen RPCs. **Die fachlichen und datenbezogenen Invarianten stehen in [`01`](01-domain-model.md) und [`03`](03-data-model-guardrails.md) (§1 Kern-Entitätsinvarianten, §3 Transaktionen/Sperren/Concurrency)** und werden hier nicht wiederholt — hier stehen nur die zusätzlichen operativen Schritte.

### Customer & Contact Workflow

- [ ] `companies.customer_kind` treibt den Formularmodus — keine Business-Felder (Branche/Größe/Umsatz/Steuernummer) für `individual`
- [ ] Kunde-plus-Ansprechpartner-Anlage nur über RPC `create_customer_with_contact` — kein sequentielles Client-Create in `/kunden/create`
- [ ] `links_jsonb` ist die UI-Quelle; `linkedin_url`/`website`/`context_links`/`phone_number` bleiben deprecated, **nicht gelöscht**
- [ ] `companies_summary` / `contacts_summary` enthalten die neuen Spalten — sonst sieht der Supabase-Modus sie nicht, obwohl die Basistabelle sie hat
- [ ] FakeRest-Demo nutzt den lifecycle-gewrappten `dataProvider`, nicht `baseDataProvider`, in `createCustomerWithContact`/`setPrimaryContact` (sonst fehlen `first_seen`/`customer_number`/`nb_contacts`-Defaults)
- [ ] `supabase/tests/customer_contact_workflow_verification.sql` nach `db reset --local`
- [ ] Kunden- und Privatpersonen-Anlage manuell im Browser geprüft (`npm run dev:demo`)

### Hauptansprechpartner (Atomic Contact Primary Intent)

- [ ] eine neue Formularvariante nutzt `ContactPrimaryContactField` + `attachContactSaveIntent` (Transform) — keine eigene „finde den Halter"-Regel
- [ ] `supabase/tests/contact_primary_intent_verification.sql` nach `db reset` (leere DB **und** mit Fixtures; rollt sich selbst zurück) — enthält Privilegienmatrix, Incident-Regression, Update-Matrix A–I, Idempotenz, Audit, Failure-Injection
- [ ] vor einem Release **alle drei** Real-Session-Matrizen lokal ausführen (nie gegen Production; sie hinterlassen zwei Fixture-`sales`-Zeilen): `supabase/tests/contact_primary_intent_concurrency_runner.ps1` (neu gegen neu, A–F) **und** `supabase/tests/contact_primary_cross_command_runner.ps1` (neu gegen bestehende Befehle, X-A..X-G inkl. gegenläufigem Kundenwechsel) **und** `supabase/tests/contact_primary_trigger_race_runner.ps1` (neu gegen **rohe** Kontakt-Namensschreibung, T-A..T-F — der Pfad von „Kontakte zusammenführen"). Die beiden 2026-09-08-Reviews zeigten: eine Matrix, die nur neu gegen neu rennt, übersieht den ersten Deadlock; eine, die nur Befehle gegeneinander rennt, den zweiten
- [ ] die Runner nehmen `-Container`: die entscheidenden Concurrency-Läufe zusätzlich gegen einen lokalen **PostgreSQL 17.6**-Stack (Production-Version) zertifizieren, nicht nur gegen den PG15-Entwicklungsstack
- [ ] Concurrency-Assertions prüfen **Ergebnisklassen und Invarianten**, nie einen bestimmten Rennsieger und nie eine Wanduhr-Dauer; wo eine spätere Stufe denselben Kunden legitim verändert, wird gegen einen Schnappschuss direkt nach der Stufe geprüft, nicht gegen den Endzustand

### Vorgang ↔ Kunde (`deals.company_id`)

- [ ] bei jeder Änderung an `deals.company_id`, am Vorgang-Kunde-Fremdschlüssel oder an einem Schreibpfad, der den Kunden eines Vorgangs setzt (inkl. Schnellerfassung): `supabase/tests/deal_company_required_verification.sql` nach `db reset` (self-contained, rollt zurück; leere DB oder mit Fixtures) — Invariante: [`03`](03-data-model-guardrails.md) §1.7

## 16. E2E-Testinfrastruktur und Isolation

**Wann:** Änderungen an `e2e/` (Specs, `fixtures.ts`, `helpers/e2eState.ts`), am CI-Job `e2e-test` oder bei E2E-Flakes. Regel mit Begründung: [`06`](06-decision-log.md) „2026-09-14 – E2E-Testisolation"; offene Punkte: [`17`](17-known-issues-and-planned-waves.md) Abschnitt I (I.5, I.6). Hier steht nur, **wie** man daran sicher arbeitet.

### Umgebung und Identität

- [ ] E2E läuft gegen einen **lokalen, disposable** Supabase-Stack (lokal und im GitHub-Runner) — kein persistentes Remote-„E2E-Projekt" voraussetzen, nie gegen Production
- [ ] **genau ein** kanonischer E2E-Admin (`admin@nora-e2e.local`, Worker-Fixture `e2eAdmin`): angelegt nur auf einem leeren Stack (Rolle über den First-Admin-Trigger), sonst aus dem DB-Zustand wiedererkannt — ein Worker-Neustart, Retry oder zweiter Lauf auf demselben Stack muss ihn ohne Neuanlage finden
- [ ] Specs legen **keine** eigenen Mitarbeiter an; sie nutzen `e2eAdmin`

### Reset

- [ ] Geschäftsdaten werden vor jedem Test über die **authentifizierte Session des kanonischen Admins** (Admin-RLS) gelöscht, nicht per `service_role` — `service_role` dient nur zum Anlegen von Testdaten und für lesende Prüfungen
- [ ] aktueller Reset-Scope (`BUSINESS_TABLES`, FK-sichere Reihenfolge): `tasks`, `contact_notes`, `deal_notes`, `deals`, `contacts`, `companies`, `tags`
- [ ] **nicht** gelöscht werden: `sales`, `auth.users`, `audit_events`, `configuration` (nur als kanonische Zeile `id = 1`, `config = {}` geprüft), Seed-/Lookup-Daten (z. B. `favicons_excluded_domains`), technischer Lifecycle-Zustand

### Fail-closed

- [ ] jedes Supabase-`{ error }` wird ausgewertet — ein ignoriertes `{ error }` war die Ursache der CI-Baseline vor E2E-B1
- [ ] nach dem Reset Postconditions prüfen (Tabellen leer, `configuration` kanonisch, Identität unverändert); keine automatische Reparatur
- [ ] ein unerwarteter zweiter Mitarbeiter oder Auth-Benutzer ist **kein** Cleanup-Problem, sondern ein Verstoß gegen den Test-State-Vertrag — Ursache im Test suchen, nicht im Reset wegräumen

### Erweiterungsregel

- [ ] erzeugt ein neuer Test einen **neuen Geschäftsdatentyp**, braucht er einen **zweiten Mitarbeiter**, erzeugt er **Selbstkontakte** oder **Checklisten-/Lifecycle-Zustand**, wird die Isolationsstrategie bewusst geprüft und erweitert (z. B. `BUSINESS_TABLES` samt Postcondition) — kein generisches „delete everything"
- [ ] wer einen zweiten Mitarbeiter braucht, modelliert ihn ausdrücklich und W6-B-konform; das Identitäts-Gate lehnt zusätzliche Zeilen heute ab

### Verifikation und Flakes

- [ ] bei Änderungen an Fixtures oder Isolation: gezielte Tests, CI-äquivalente Full Suite **und** ein zweiter Lauf auf demselben Stack (beweist Wiedererkennung statt Neuanlage)
- [ ] Flake-Fixes über **semantische Readiness-Signale** (Ziel-Oberfläche sichtbar), nicht über Sleeps, höhere Retries oder `.first()` zum Kaschieren. Die Kontaktlisten-Readiness in `menu.goToContacts` hängt heute an `.nora-list-row`; ein neuer E2E mit Kontaktfiltern braucht dafür einen expliziten semantischen Hook

### Fehlersignaturen

- [ ] `First E2E auth user was not bootstrapped as an active admin`, `email_exists` / „already been registered" oder ein `E2E_IDENTITY_*`-Code deuten bei dieser Architektur zuerst auf einen Bruch der Identitäts-Isolation (übrig gebliebener oder zusätzlicher Benutzer), **nicht** automatisch auf einen defekten First-Admin-Trigger — ein weiterer Benutzer auf einem nicht leeren Stack wird korrekt `viewer`

## 17. W8-E Release: privater Anhang-Bucket (Stage A → B → C, Rollback)

**Wann:** der Production-Release von W8-E und jeder Rollback danach. **Status: in Production ausgeführt am 2026-10-07 (Stage A → B → B.5 → C, ohne Rollback; Ausführungsstand am Ende dieser Sektion).** Das Verfahren bleibt das gültige für jede Wiederholung und für den Rollback. Wer diese Sektion liest, hat damit **keine** Freigabe: jede Production-Mutation unten braucht die ausdrückliche Freigabe des Product Owners **für genau diesen Schritt** ([`07`](07-agent-change-checklist.md) „Production-Sicherheit"). Warum die Reihenfolge so ist und was W8-E garantiert: Contract [`22`](22-security-and-access.md) Abschnitt 6.14 — hier steht nur, **was in welcher Reihenfolge zu tun und zu beweisen ist**. Offener Stand: [`17`](17-known-issues-and-planned-waves.md) H.1.

**Die eine Regel, aus der alles folgt:** `altes Runtime + privater Bucket` ist **nicht unterstützt** — das alte Frontend erreicht Anhänge über öffentliche Objekt-URLs, jede Anhangsdarstellung wäre kaputt. Daraus ergeben sich zwei Reihenfolgen, die **nie** umgekehrt werden:

| Richtung | Reihenfolge |
|---|---|
| Vorwärts | Stage A (Branding) → Stage B (W8-E-Runtime, Bucket noch öffentlich) → **B.5 Client-Konvergenz** → Stage C (Bucket privat, **über die Storage-API**) |
| Rollback nach C | **zuerst** Bucket wieder öffentlich (mit hartem Nachweis) → **erst dann** Runtime zurück |

Unterstützte Zustände: **A** altes Runtime + altes Branding + öffentlich · **B** altes Runtime + umgezogenes Branding + öffentlich · **C** W8-E-Runtime + umgezogenes Branding + öffentlich · **D** W8-E-Runtime + umgezogenes Branding + privat. Rollback: **D → öffentlich (= C) → altes Runtime (= B)**. Die umgezogenen Branding-Objekte bleiben dabei, wo sie sind.

**Werkzeuge** (alle im Repository, keine anderen verwenden):

| Schritt | Werkzeug | Schreibt? |
|---|---|---|
| Branding-Bucket | Migration `supabase/migrations/20260928120000_nora_branding_bucket.sql` | ja (Schema) |
| Branding-Umzug | `supabase/maintenance/branding_migration/relocate_branding_objects.mjs` | nur mit `--apply` |
| Gate vor Stage C | `supabase/maintenance/attachment_privacy/00_preflight.sql` | **nein** — eine einzige `select`-Anweisung |
| **Stage C — die einzige Umstellung** | `node supabase/maintenance/attachment_privacy/10_set_attachments_privacy.mjs private …` | ja — **über die Storage-API** (`PUT /storage/v1/bucket/attachments`), nur mit `--apply` |
| Nachprüfung nach Stage C | `supabase/maintenance/attachment_privacy/30_verify_attachments_private.sql` | **nein** — eine einzige `select`-Anweisung |
| Rollback (kanonisch) | `node …/10_set_attachments_privacy.mjs public …` | ja — über die Storage-API, nur mit `--apply` |
| Rollback-Fallback | `supabase/maintenance/attachment_privacy/20_set_attachments_public.sql` | ja (eine Zeile `storage.buckets`) — **nur**, wenn die Storage-API nicht verfügbar ist oder das Werkzeug `EMERGENCY` meldet |
| anonyme Probe | `node …/10_set_attachments_privacy.mjs probe --url=<URL>` | nein — ein anonymer `GET`, ohne jeden Schlüssel |

**Warum Stage C nicht mehr SQL ist (Alpha Storage 3C F-2).** Production läuft im Plan **Pro** — damit ist Supabase **Smart CDN** aktiv; öffentlich ausgelieferte Objekte werden am Edge gecacht, und `Cache-Control` steuert nur den Browser. `storage-api` purgt den CDN-Cache eines Buckets genau dann, wenn **sie selbst** ihn von öffentlich auf privat umstellt (`updateBucket`: `public: false` bei vorher `true`, upstream supabase/storage PR #1273). Ein direktes `update storage.buckets set public = false` erreicht diesen Code nie — ein vorher öffentlich abgerufenes Objekt bliebe anonym vom Edge abrufbar. Drei weitere Fakten, lokal gegen `storage-api` v1.77.0 mit einem Purge-Endpunkt-Stub nachgewiesen: der Purge läuft **asynchron** als Job; ein **fehlgeschlagener** Purge wird nur serverseitig protokolliert, die API antwortet trotzdem `Successfully updated`; und `public: false` auf einem **bereits** privaten Bucket purgt **nie**. Deshalb ist der **anonyme Abruf der exakten, vorher abgerufenen URL** nach der Umstellung der einzige Nachweis der Invalidierung — und er belegt den Edge-Standort, den der Client des Operators erreicht, nicht jeden weltweit. Eine sofortige globale Invalidierung wird nicht behauptet.

**Was als CDN-Nachweis zählt — und was nicht (Alpha Storage 3D LOW-1).** Der CDN-Nachweis an der exakten URL ist **nur** dann erbracht, wenn der **letzte** Abruf mit **HTTP 400 oder HTTP 404** antwortet — der Ablehnung eines anonymen Lesezugriffs durch Storage (Production antwortet mit HTTP 400). **Jedes andere Ergebnis ist kein Nachweis:**

| Antwort der exakten URL | Bedeutung | Werkzeug |
|---|---|---|
| HTTP 400 oder 404 | Storage verweigert — die URL liefert das Objekt nicht mehr | `PRIVATE / VERIFIED`, Exit 0 |
| HTTP 2xx | **noch erreichbar** — eine gecachte öffentliche Kopie | weiter abfragen; nach dem Fenster `CDN PROOF PENDING`, Exit 4 |
| Transportfehler, Timeout, DNS-/Netzfehler, keine Antwort, HTTP 3xx, 401, 403, 408, 409, 425, 429, 5xx, jede andere Antwort | **nicht aussagekräftig** — belegt nur, dass **dieser** Abruf gescheitert ist | weiter abfragen; nach dem Fenster `CDN PROOF PENDING`, Exit 4 |

Ein Netzfehler, eine `503` oder eine `429` ist **nie** ein Beleg für Privatheit — weder im Werkzeug noch bei einer Folgeprobe von Hand. Die Menge `{400, 404}` wird ohne unabhängigen Nachweis einer weiteren Ablehnungsform nicht erweitert. Das Werkzeug schreibt je Versuch `status` und `proof` (`accessible` / `denied` / `inconclusive`) in `NORA_W8E_RESULT`; `probe` gibt dieselbe Einordnung als `classification` aus.

**Ergebnis-Vokabular des Werkzeugs** (letzte Zeile jeder Ausführung: `NORA_W8E_RESULT {"outcome": …}` — sie gehört ins Release-Protokoll):

| Ausgabe `RESULT:` | Exit | Zustand | Nächster Schritt |
|---|---|---|---|
| `DRY-RUN / NO MUTATION` | 0 | unverändert | mit `--apply` wiederholen |
| `STOP / NO MUTATION` | 1 | **nachweislich unverändert** | STOP, Grund steht darüber; nicht umgehen |
| `PRIVATE / VERIFIED` | 0 | privat, Kontrollen unverändert, exakte URL antwortet zuletzt mit HTTP 400 oder 404 | weiter mit „Nach Stage C" |
| `PRIVATE / VERIFIED — CDN PROOF PENDING` | 4 | privat, verifiziert — die exakte URL liefert nach dem Fenster **noch** Bytes (2xx) **oder** ihre letzte Antwort war nicht aussagekräftig (Transportfehler, 3xx, 429, 5xx, …) | **nicht** kompensieren, **nicht** zurückrollen; „CDN-Wiederherstellung" unten |
| `PUBLIC / COMPENSATED` | 2 | wieder öffentlich mit Originalkontrollen, verifiziert (= Zustand C) | STOP, Ursache (steht darüber) untersuchen; Runtime **nicht** zurückrollen |
| `EMERGENCY / STATE REQUIRES MANUAL RECOVERY` | 3 | **nicht verifiziert** | Release-Notfall: Runtime **nicht** zurückrollen; `20_set_attachments_public.sql`, danach `probe`; PO sofort einbinden |
| `PUBLIC / VERIFIED` | 0 | (Rollback) öffentlich, Kontrollen unverändert, Probe-URL liefert Bytes | Runtime darf zurück |
| `PUBLIC / VERIFIED — PUBLIC READ PENDING` | 4 | (Rollback) öffentlich, Probe-URL liefert **noch** keine Bytes | Runtime **noch nicht** zurückrollen; `probe` wiederholen |
| `STOP / STILL PRIVATE` | 1 | (Rollback) weiterhin privat | Runtime **nicht** zurückrollen; erneut versuchen oder Fallback `20_…` |

**SQL-Runner für `00`, `30` und den Fallback `20`:** die **ganze Datei unverändert als ein** Supabase-MCP-`execute_sql`-Aufruf, der Supabase-Dashboard-SQL-Editor, oder `psql -v ON_ERROR_STOP=1 -f <datei>`. `00` und `30` sind je **eine** `select`-Anweisung ohne Transaktionssteuerung: in **jedem** dieser Runner ist die **letzte sichtbare Zeile** das Urteil `99 | == VERDICT == | GO` bzw. `VERIFIED` — oder `STOP` mit den durchgefallenen Gates (Alpha Storage 3C F-6). Keine Urteilszeile oder ein Fehler heißt **STOP**. **Nie** `psql` ohne `ON_ERROR_STOP` für `20`: es läuft nach einem Fehler weiter und endet mit Exit-Code 0.

### Werkzeuge und Zugänge

- [ ] **Zielprojekt:** `nora-crm-prod` (Ref: [`16`](16-current-state.md)); per `list_projects` nach Name **und** Ref bestätigt und gegen `VITE_SUPABASE_URL` der Production-Umgebung in Vercel abgeglichen. `--target` des Werkzeugs ist der Host `<ref>.supabase.co` — eine getippte Bestätigung, dass die Shell dorthin zeigt, wo der Operator es glaubt
- [ ] **Read-only-SQL gegen Production:** Supabase MCP `execute_sql` oder der Dashboard-SQL-Editor mit der **ganzen** Datei; ersatzweise `psql` mit der Verbindungszeichenfolge aus Dashboard → *Connect*. Ein Agent, dessen Werkzeug Production-Lesezugriffe verweigert, umgeht das nicht — der PO führt die Datei aus und gibt die Urteilszeile ins Protokoll
- [ ] **Migration anwenden (Stage A):** aus einem Checkout **genau** des zu releasenden Commits: `npm run signing-keys:ensure`, `npx supabase link --project-ref <ref>` (fragt das Datenbankpasswort — nur der PO), `npx supabase db push --dry-run` (muss **genau** `20260928120000_nora_branding_bucket.sql` nennen), dann `npx supabase db push`; danach `list_migrations` nach Sektion 1
- [ ] **Privilegierter Storage-Admin-Schlüssel (nur Stage C / Rollback):** Dashboard → *Project Settings* → *API Keys* → **Secret key** (bevorzugt einen eigens für den Release angelegten, der danach widerrufen wird) oder der Legacy-`service_role`-Schlüssel. Er lebt **nur** in der Shell des Operators für die Dauer des Befehls (`$env:NORA_STORAGE_ADMIN_KEY = …` bzw. `export NORA_STORAGE_ADMIN_KEY=…`, danach `Remove-Item Env:NORA_STORAGE_ADMIN_KEY` bzw. `unset`). **Nie** in eine Datei, **nie** in `.env*`, **nie** in eine Vite-Variable, **nie** in einen Chat oder an einen Agenten. Das Werkzeug verweigert einen Publishable-/`anon`-Schlüssel und einen Schlüssel, der zugleich in einer `VITE_*`-Variable steht, und druckt ihn nie
- [ ] **Laufende Runtime-SHA bestimmen:** in der live ausgelieferten App (frisches Profil oder nach „Jetzt aktualisieren", Sektion 14) in der DevTools-Konsole: `const src = [...document.querySelectorAll('script[type="module"][src]')].map((s) => s.src).find((u) => u.includes('/assets/index-')); (await (await fetch(src)).text()).includes('<40-stellige SHA>')` — `true` ist der Nachweis; `performance.getEntriesByType('resource')` zeigt ergänzend, dass genau dieser Chunk geladen wurde. Die eingebettete SHA ist die `VERCEL_GIT_COMMIT_SHA` des Builds, also die **Merge-SHA** auf `main`, **nicht** die PR-Head-SHA
- [ ] **Draft → Ready → Merge:** `gh pr ready 5` (CI läuft nur auf nicht-Draft-PRs), exakter Head-CI-Lauf mit **allen sieben** Jobs grün auf Job-Ebene, dann `gh pr merge 5 --merge --match-head-commit <zertifizierte Head-SHA>` — Merge-Commit, kein Squash, kein Rebase
- [ ] **Runtime zurückrollen:** Vercel *Instant Rollback* auf das in Phase 0 festgehaltene Deployment (Dashboard → *Deployments*, oder `vercel rollback <deployment-url>`, Status mit `vercel rollback status`). Laut Alpha Storage 3C ordnet Vercel danach neue Production-Deployments nicht automatisch zu, bis der Rollback aufgehoben bzw. ein Deployment promotet ist — vor dem nächsten Release im Dashboard prüfen (hier nicht selbst verifiziert)

### Phase 0 — Release-Identität (read-only)

Fehlschlag in Phase 0 → **STOP, keine Mutation**, Bericht an den PO.

- [ ] `main`-SHA, PR-Head-SHA und Merge-Methode festgehalten (Merge-Commit, kein Squash, kein Rebase — der zertifizierte Baum muss erhalten bleiben)
- [ ] **exakter Head-CI-Lauf** mit allen sieben Jobs grün (ESLint, Prettier, Typecheck, Test, Build, `e2e-test`, Secret scan) — ein Draft-Lauf mit übersprungenen Jobs zählt nicht
- [ ] erwartete Migration: genau **eine** neue, `20260928120000_nora_branding_bucket`; `git diff main...<head> -- supabase/migrations` zeigt nichts anderes
- [ ] **Supabase-Plan und CDN:** Plan der Organisation (`get_organization`); bei Pro oder höher ist Smart CDN aktiv — dann ist der CDN-Nachweis in Stage C **Pflicht**, nicht Kür
- [ ] **Production-Ausgangszustand read-only** festgehalten: Ledger-Head und -Anzahl; `storage.buckets` **vollständig** (`id`, `public`, `file_size_limit`, `allowed_mime_types`, `type`; erwartet `attachments` = `true`, 50 MiB, neun MIME-Typen; `branding` fehlt); Objektanzahl je Bucket; die **vollständigen** Definitionen auf `storage.objects` aus `pg_policies` (`policyname`, `permissive`, `roles`, `cmd`, `qual`, `with_check` — vor Stage A **genau** `attachments_select_active_user` und `attachments_insert_writer` in der W8-B-Form); Policies auf `storage.buckets` (erwartet: **keine**); `relrowsecurity` für `storage.objects` (erwartet `true`); Anzahl der Branding-Verweise in den `attachments`-Bucket (`configuration.lightModeLogo`/`darkModeLogo`, `companies.logo`; erwartet 4); Anhang-Repräsentation (Elemente mit `path`, aber **ohne** `src`: erwartet 0)
- [ ] **Runner-Verhalten festgehalten:** `00_preflight.sql` einmal im tatsächlich benutzten Runner ausführen; es muss mit der Urteilszeile enden (vor Stage A: `STOP`, weil `branding` fehlt — das ist erwartet)
- [ ] **Rollback-Ziel festgehalten:** die aktuelle Production-Deployment-ID und die darin eingebettete Commit-SHA. Dieses Deployment wird bis zum Abschluss von W8-E **nicht** gelöscht
- [ ] eine unerwartete Abweichung heißt **STOP** und Bericht, kein Weiterarbeiten

### Stage A — Branding-Bucket und Umzug (auf altem Runtime unterstützt)

- [ ] Migration anwenden (siehe „Werkzeuge und Zugänge"). Danach read-only: `branding` existiert und ist `public = true`, `branding_select_active_user` und `branding_insert_writer` existieren, `attachments` ist **unverändert** `public = true`, keine weitere Policy
- [ ] Umzug **zuerst trocken**: `node supabase/maintenance/branding_migration/relocate_branding_objects.mjs` mit `SUPABASE_URL`, `SUPABASE_ANON_KEY` (Publishable Key), `NORA_ADMIN_EMAIL`, `NORA_ADMIN_PASSWORD` eines **aktiven** Nora-Admins. Das Werkzeug meldet sich als dieser Admin an und schreibt nur über die normale RLS — **kein** `service_role`. Production-Zugangsdaten gibt nur der PO ein; ein Agent tippt sie nie
- [ ] **Tatsächliche Ausgabe** (lokal aufgezeichnet): Kopfzeilen `[w8e] note attachments known to be OFF LIMITS: <n>` und `[w8e] mode: DRY RUN (no writes) · attachments -> branding`; je Kandidat eine Zeile mit dem Ergebnis in **Großbuchstaben**, z. B. `WOULD-RELOCATE     config-logo configuration#1.lightModeLogo :: <schlüssel> -> <schlüssel>  (<n> bytes, image/png)`; danach `[w8e] summary` mit den Zählern in **Kleinbuchstaben** (`would-relocate     <n>`) und `[w8e] DRY RUN — nothing was written. Re-run with --apply.`
- [ ] Trockenlauf prüfen: **kein** `REFUSED` (= der Schlüssel ist ein Notiz-Anhang), **kein** `FAILED`; `WOULD-RELOCATE` = Anzahl der Branding-Verweise aus Phase 0; `SKIPPED` nur mit dokumentiertem Grund (leeres oder gebündeltes Konfigurations-Logo, `not a file value`, `external or unrecognised logo value`). **Der Trockenlauf prüft weder MIME-Typ noch Größe:** jede `(<n> bytes, <typ>)`-Angabe gegen die `branding`-Grenzen halten (PNG/JPEG/WebP/GIF, ≤ 5 MiB) — sonst scheitert erst `--apply`. `OFF LIMITS` gegen die read-only gezählte Zeilenzahl von `public.attachments` halten (bei ≥ 1000 das Werkzeug **nicht** verwenden, [`17`](17-known-issues-and-planned-waves.md) H.1)
- [ ] dann `--apply`: Kopfzeile `mode: APPLY (writes)`, Exit 0, jede Kandidatenzeile `RELOCATED` oder `ALREADY-RELOCATED` (Summe = Phase-0-Anzahl), kein `FAILED`/`REFUSED`. Das Werkzeug aktualisiert einen Verweis erst, **nachdem** die Kopie anonym gelesen und byte-identisch ist; ein erneuter Lauf nach Abbruch ist die vorgesehene Wiederaufnahme und meldet `ALREADY-RELOCATED`
- [ ] Verweise verifizieren: `00_preflight.sql` — Gates 3 (`branding` öffentlich), 4 (`branding`-Kontrollen), 7 (Branding-Policy-**Definitionen**) und 10 (kein Branding-Verweis mehr in `attachments`) = `PASS`, Gate 1 (`attachments` noch öffentlich) = `PASS`
- [ ] **Branding anonym (F-1):** für **jede** umgezogene Branding-URL (aus `configuration` und `companies.logo`, read-only gelesen) `node supabase/maintenance/attachment_privacy/10_set_attachments_privacy.mjs probe --url=<Branding-URL>` — erwartet `"status":200`, `"bytes"` > 0, `content-type` ein Bildtyp; ohne Sitzung, ohne Schlüssel
- [ ] **Branding in der angemeldeten Produktfläche (F-1):** als Admin `#/settings` öffnen — die Logo-Vorschauen (hell/dunkel) laden, und ihr Bild-`src` beginnt mit `https://<ref>.supabase.co/storage/v1/object/public/branding/`; in der Kundenliste erscheinen die umgezogenen Kundenlogos. **Die Login-Seite beweist hier nichts:** sie zeigt ausschließlich gebündelte Logos
- [ ] **Keine** Quellobjekte gelöscht — das Aufräumen bleibt S2B
- [ ] **Fehlschlag in Stage A → STOP.** Bereits kopierte Objekte im Bucket `branding` und bereits umgestellte Verweise dürfen bleiben: ein Verweis wird erst nach dem byte-identischen anonymen Lesebeweis umgestellt, und eine öffentliche Branding-URL funktioniert auch im alten Runtime (Zustand B). Wiederaufnahme = erneuter Lauf; **nichts** löschen. **Abbruch des ganzen Releases nach Stage A:** die Migration steht dann im Production-Ledger, aber nicht auf `main` — ein späteres `db push` von `main` wird abgewiesen. Auflösung nur per PO-Entscheidung: die Migration auf `main` landen (Merge) oder `supabase migration repair` mit ausdrücklicher Freigabe

### Stage B — W8-E-Runtime deployen, Bucket noch öffentlich

- [ ] PR mergen (siehe „Werkzeuge und Zugänge"); das Production-Deployment läuft über die Git-Integration
- [ ] **Build-Identität:** die im ausgelieferten Entry-Chunk eingebettete SHA ist die Merge-SHA (Verfahren oben — kein Reload als Nachweis, frisches Profil oder Update-Hinweis)
- [ ] `attachments` ist **weiterhin** `public = true` (read-only prüfen) — in Stage B wird **keine** Sichtbarkeit geändert
- [ ] PO-Smoke im angemeldeten Zustand (der Agent gibt keine Zugangsdaten ein): bestehender Notiz-Anhang (Bild und Dokument) wird angezeigt bzw. öffnet sich; im Netzwerk-Tab laufen die Zugriffe über `/storage/v1/object/sign/attachments/…`, nicht über `/object/public/attachments/…`
- [ ] PO-Smoke: neue Notiz mit neuem Anhang anlegen, danach dieselbe Notiz bearbeiten (Anhang bleibt sichtbar, speichern funktioniert). Danach read-only: das neue Element trägt `path` = Schlüssel **und** `src` = **kanonische öffentliche URL genau dieses Schlüssels** — ohne `?`, ohne Token, keine `/object/sign/`-URL
- [ ] Kundenlogo-Upload landet im Bucket `branding` (sein Bild-`src` enthält `/object/public/branding/`)
- [ ] **Fehlschlag in Stage B** (Smoke rot, falsche Build-SHA) → Stage C ist **verboten**. Solange `attachments` öffentlich ist, sind W8-E- und altes Runtime beide unterstützt (Zustände C und B): das Runtime darf ohne Bucket-Schritt auf das Phase-0-Deployment zurück; dann Ursache klären

### Stage B.5 — Client-Konvergenz (menschliches Gate, Pflicht vor Stage C)

**Nora hat heute keinen flottenweiten Nachweis, welches Runtime in welchem Browser läuft.** Nora ist eine PWA im Prompt-Modus ([`24`](24-pwa-and-update-lifecycle.md) §2): ein offener Tab bleibt auf dem alten Build, bis der Update-Hinweis bestätigt oder alle Nora-Fenster geschlossen wurden. Ein solcher Tab wäre nach Stage C genau der nicht unterstützte Zustand. Diese Stufe ist deshalb eine **ausdrückliche, protokollierte Operator-Vorbedingung — keine automatische Garantie**, und wird nie als solche beschrieben.

**Wann der Update-Hinweis überhaupt erscheint.** Er ist nur in der **angemeldeten** Oberfläche montiert — ein abgemeldetes Gerät zeigt ihn nie. Ein geöffneter Tab sucht per Intervall (60 min, frühestens alle 30 min) und beim Zurückkehren auf den Tab nach einem neuen Worker ([`24`](24-pwa-and-update-lifecycle.md) Parameter); das erste Öffnen nach dem Deployment kann noch den **alten** Build aus dem alten Service Worker laden. „Später" verschiebt den Hinweis um 2 h, und ein offener Dialog verdeckt ihn.

**Stage C ist verboten, bis der Operator die Konvergenz für die Clients bestätigt hat, die er kontrolliert:**

- [ ] das Production-Deployment entspricht nachweislich der W8-E-Merge-SHA (Stage B); **zwischen Stage B und Stage C wird nichts auf `main` gepusht** — jede weitere SHA, auch reine Dokumentation, erzeugt einen neuen Build und einen erneuten Update-Hinweis bei allen Geräten
- [ ] Liste der Arbeitsplätze und Geräte, auf denen Nora genutzt wird (Büro-PCs, Tablets, Handys, installierte PWA), liegt vor; auf **jedem**: **angemeldet** den Hinweis **„Neue Nora-Version verfügbar" → „Jetzt aktualisieren"** abschließen, **oder** alle Nora-Tabs und -Fenster schließen, Nora neu öffnen, anmelden, einige Minuten warten, Nora vollständig schließen und erneut öffnen — danach erscheint **kein** Update-Hinweis mehr
- [ ] auf mindestens einem Arbeitsplatz die eingebettete SHA im laufenden Build geprüft (die Merge-SHA, 40 Zeichen, Verfahren oben)
- [ ] ein **frischer** Browserkontext (neues Profil): anmelden und einen **bestehenden** Anhang öffnen
- [ ] die Mitarbeitenden sind informiert, dass zum Umstellungszeitpunkt keine alten Tabs absichtlich offen bleiben; Stage C möglichst außerhalb der Arbeitszeit
- [ ] ergänzend, **kein Beweis**: neue Zeilen in `public.operation_errors` seit dem Deployment mit einer `frontend_version` ungleich der Merge-SHA zeigen noch aktive alte Clients an; ihr Fehlen beweist nichts
- [ ] Bestätigung mit Uhrzeit, Geräteliste und Merge-SHA im Release-Protokoll; dazu die **ausdrückliche PO-Annahme** des Restrisikos, dass ein nicht erfasstes Gerät nach Stage C keine Anhänge zeigt, bis es aktualisiert ist
- [ ] **Fehlschlag in B.5** (ein Gerät konvergiert nicht) → **kein** Stage C. Warten und B.5 wiederholen, oder Stage B zurückrollen (Runtime zurück; der Bucket ist noch öffentlich)

### Stage C — Preflight, dann Umstellung über die Storage-API

- [ ] `00_preflight.sql` **unmittelbar davor** (read-only). Letzte Zeile `99 | == VERDICT == | GO`. Die Gates prüfen: `attachments` noch öffentlich und mit W8-B-Kontrollen; `branding` öffentlich und mit W8-E-Kontrollen; RLS auf `storage.objects` aktiv; die vier bekannten Policies in ihrer **kanonischen Definition** (Rollen, Befehl, permissiv, `USING`/`WITH CHECK` in PostgreSQLs normalisierter Form — ein gleichnamiger, aber erweiterter Policy-Stand ist `FAIL`); **keine** fremde Policy auf `storage.objects`; **keine** Policy auf `storage.buckets`; kein Branding-Verweis mehr in `attachments`. `STOP` → **keine Mutation**; eine fremde oder abweichende Policy wird **nicht** gelöscht oder „repariert", um weiterzukommen, sondern führt zu einer PO-Entscheidung (Sektion 4) mit den Optionen: Policy als bekannt aufnehmen (eigener Review), sie per Migration entfernen (eigener Review), oder Stage C verschieben. `GO` bestätigt **nicht** Stage B/B.5 — das tut der Operator
- [ ] **Probe-Objekt wählen:** ein bestehender, **nicht sensibler** Notiz-Anhang (z. B. ein vom PO dafür bestimmtes Test-Bild), und davon die **exakte** heutige öffentliche URL `https://<ref>.supabase.co/storage/v1/object/public/attachments/<schlüssel>` — so, wie das alte Runtime sie abruft: ohne Query-String, ohne Fragment. Sie gehört ins Release-Protokoll, nie in durable Dokumentation
- [ ] **Trockenlauf:** `node supabase/maintenance/attachment_privacy/10_set_attachments_privacy.mjs private --target=<ref>.supabase.co --probe-url=<exakte URL>` mit `SUPABASE_URL`, `SUPABASE_ANON_KEY` (Publishable Key) und `NORA_STORAGE_ADMIN_KEY` (siehe „Werkzeuge und Zugänge"). Erwartet `RESULT: DRY-RUN / NO MUTATION`. Das Werkzeug liest beide Buckets, prüft read-only, dass kein Branding-Verweis mehr in `attachments` zeigt, prüft anonym mit dem Publishable Key, dass `LIST` nichts liefert und Signieren verweigert wird (Positivkontrolle: das Probe-Objekt existiert), und ruft die exakte URL zweimal anonym ab (`prime #1`/`prime #2`: HTTP 200, Bytes, SHA-256, Cache-Header). Die Zeile `CDN cache header observed (cf-cache-status: …)` bzw. `NOT observed` ins Protokoll — auf Pro wird `observed` erwartet; `NOT observed` gegen Production heißt STOP und klären, bevor weitergemacht wird
- [ ] **Umstellung:** derselbe Befehl mit `--apply`. Erwartet: `API answer: {"message":"Successfully updated"}`, dann `/object/authenticated with the publishable key: HTTP 4xx` und `/object/<bucket>/<key> without credentials: HTTP 4xx`, dann der CDN-Nachweis auf der **exakten** URL (je Versuch ein frischer Prozess, Standardfenster 300 s, alle 10 s), bis sie mit HTTP 400 oder 404 antwortet, und `RESULT: PRIVATE / VERIFIED` mit Exit 0. Im Protokoll hat der letzte Eintrag von `attempts` in `NORA_W8E_RESULT` `status` 400 oder 404 und `proof` `denied` — sonst ist der Nachweis **nicht** erbracht, gleich was darüber steht. Die letzte Zeile `NORA_W8E_RESULT {…}` vollständig ins Protokoll (sie enthält Vorher-Zustand, Probe-Versuche mit `cf-cache-status`/`cf-ray` und den Nachweisumfang)
- [ ] **jedes andere Ergebnis** nach der Tabelle „Ergebnis-Vokabular" oben behandeln — insbesondere **niemals** `PRIVATE / VERIFIED — CDN PROOF PENDING` mit einem Rollback beantworten und **niemals** nach `EMERGENCY` das Runtime zurückrollen
- [ ] **Fehlschlag vor der API-Mutation** (Preflight `STOP`, Werkzeug `STOP / NO MUTATION`) → STOP, nichts geändert. **Fehlschlag nach der API-Mutation** → das Werkzeug kompensiert selbst (`PUBLIC / COMPENSATED`) oder meldet `EMERGENCY`; es gibt keinen dritten, mehrdeutigen Zustand
- [ ] **CDN-Wiederherstellung** (nur `CDN PROOF PENDING` oder ein Bucket, der **ohne** dieses Werkzeug privat wurde — das Werkzeug verweigert dann mit `"attachments" is already PRIVATE …`): `probe --url=<exakte URL>` nach 15–30 min wiederholen, möglichst zusätzlich von einem anderen Netz. Abgeschlossen ist die Wiederherstellung **nur** mit `"status":400` oder `"status":404` (`"classification":"denied"`); ein Transportfehler, 3xx, 429, 5xx oder jede andere Antwort ist nicht aussagekräftig — später erneut abfragen, **nie** als privat werten. Liefert sie weiter Bytes (2xx), entscheidet der PO: (a) den Purge durch einen kontrollierten Zyklus `public --apply` → `private --apply` mit diesem Werkzeug erneut auslösen (öffnet den Bucket für diese Sekunden wieder), (b) den Supabase-Support um einen Bucket-Purge bitten, oder (c) das Restrisiko für genau die gecachten Objekte ausdrücklich annehmen. **Nie** den Bucket „einfach so" als erledigt werten

### Nach Stage C — Verifikation

- [ ] `30_verify_attachments_private.sql` (read-only): letzte Zeile `99 | == VERDICT == | VERIFIED` — `attachments` privat, alle übrigen Gates wie im Preflight unverändert `PASS` (Kontrollen, Policy-Definitionen, RLS, keine Bucket-Policy, kein Branding-Verweis)
- [ ] **Anonym (bereits vom Werkzeug belegt, Zeilen ins Protokoll):** die exakte vorher abgerufene URL antwortet mit HTTP 400 oder 404 (`proof` `denied`); anonymes `LIST` liefert nichts; anonymes Signieren scheitert; `/object/authenticated/…` mit dem Publishable Key und `/object/attachments/<schlüssel>` ohne Schlüssel liefern 4xx. **Zusätzlich** 15–30 min später `probe --url=<exakte URL>` erneut: weiterhin HTTP 400 oder 404. „Kein HTTP 200" genügt **nicht** — ein Netzfehler, 3xx, 429 oder 5xx ist nicht aussagekräftig und wird wiederholt, bis 400/404 kommt; kommt 2xx, gilt „CDN-Wiederherstellung"
- [ ] **Aktive Rollen** (PO-Smoke je verfügbarer Rolle `viewer`, `office`, `admin`): Notiz-Anhänge (Bild, Dokument) werden über eine signierte URL angezeigt bzw. geöffnet; Notiz anzeigen, bearbeiten und speichern funktioniert; ein neuer Anhang lässt sich hochladen (nur `office`/`admin`)
- [ ] **Repräsentationen:** eine in Stage B gespeicherte Notiz (`path` + kanonisches `src`) und — falls vorhanden — ein Element nur mit `path` werden angezeigt und lassen sich bearbeiten
- [ ] **deaktivierter Mitarbeiter kann keine neue Fähigkeit erzeugen:** mit einem deaktivierten Testkonto (falls vorhanden) scheitert das Signieren. Gibt es keins, wird das nicht simuliert, sondern belegt über Gate 6 von `30_…` (die Definition von `attachments_select_active_user` verlangt `nora_private.is_active_user()`) plus den lokalen Verifier-Nachweis — und im Protokoll genau so benannt
- [ ] **Branding (F-1):** jede umgezogene Branding-URL per `probe` anonym → HTTP 200 mit denselben Bytes (SHA-256) wie in Stage A; als Admin `#/settings` → die Logo-Vorschauen laden aus `/storage/v1/object/public/branding/`
- [ ] read-only: Notiz-JSON und `public.attachments` unverändert gegenüber dem Stand direkt vor Stage C (Anzahl Elemente, Anzahl Zeilen) — Stage C schreibt nur die Bucket-Zeile
- [ ] **Fehlschlag nach Stage C — Entscheidung, nicht Gefühl:**

| Beobachtung | Entscheidung |
|---|---|
| aktive Mitarbeitende können Anhänge nicht öffnen (Signieren scheitert), trotz aktueller Runtime | **Rollback** (unten) |
| ein nicht erfasstes Gerät mit altem Runtime zeigt keine Anhänge | **kein** Rollback — Gerät aktualisieren (B.5-Restrisiko) |
| die exakte URL liefert weiter Bytes | **kein** Rollback (öffentlich wäre schlimmer) — CDN-Wiederherstellung |
| die exakte URL antwortet nicht aussagekräftig (Netzfehler, 3xx, 429, 5xx, …) | **kein** Rollback, **nicht** als privat werten — Probe später wiederholen (CDN-Wiederherstellung) |
| `30_…` sagt `STOP` bei Gate 6–9 (Policy/RLS) | STOP, PO; Rollback nur, wenn aktive Mitarbeitende betroffen sind |
| Branding lädt nicht | **kein** Anhang-Rollback — `branding` ist vom Flip unabhängig; untersuchen |
| alles andere Unerwartete | STOP und PO, nichts „reparieren" |

### Rollback nach Stage C

- [ ] **Zuerst** `node supabase/maintenance/attachment_privacy/10_set_attachments_privacy.mjs public --target=<ref>.supabase.co --probe-url=<exakte URL> --apply`. **Erfolg ist ausschließlich** `RESULT: PUBLIC / VERIFIED` mit Exit 0: der Bucket ist öffentlich, seine Kontrollen sind unverändert, **und** die Probe-URL liefert anonym wieder Bytes. `PUBLIC READ PENDING` (etwa eine noch gecachte Fehlerantwort) oder `STOP / STILL PRIVATE` heißt: das Runtime **noch nicht** zurückrollen
- [ ] **Fallback**, nur wenn die Storage-API nicht erreichbar ist oder das Werkzeug `EMERGENCY` gemeldet hat: `20_set_attachments_public.sql` als **eine** Invocation. Sie prüft ihr Ergebnis selbst (`NORA_W8E_ATTACHMENTS_BUCKET_MISSING`, `NORA_W8E_ATTACHMENTS_STILL_PRIVATE`), erzwingt `set constraints all immediate` und meldet Erfolg nur als Zeile `attachments | t | PUBLIC — …`. **Diese Zeile ist notwendig, aber nicht hinreichend:** danach muss `probe --url=<exakte URL>` HTTP 200 liefern — erst das ist das Gate für den Runtime-Rollback. Für diese Richtung ist SQL zulässig, weil öffentlich machen keine gecachten privaten Inhalte hinterlässt; die API purgt in dieser Richtung ebenfalls nicht
- [ ] **erst dann** das Runtime auf das in Phase 0 festgehaltene Deployment zurücksetzen (Instant Rollback) und dessen eingebettete SHA prüfen
- [ ] N-1-Repräsentation: im alten Runtime eine Notiz mit einem **unter W8-E hochgeladenen** Anhang öffnen (Bild erscheint, Dokument öffnet sich) und speichern — das alte Runtime liest das persistierte `src`
- [ ] Branding **nicht** zurückbewegen — der umgezogene Zustand ist auch für das alte Runtime unterstützt (Zustand B)
- [ ] ein W8-E-Tab, der nach dem Runtime-Rollback noch offen ist, ist unkritisch: W8-E-Runtime + öffentlicher Bucket ist Zustand C

### Nach dem Release — Dokumentationsabschluss

- [ ] [`16`](16-current-state.md) (was ist live), [`17`](17-known-issues-and-planned-waves.md) H.1 (Status, Restpunkte), [`06`](06-decision-log.md) (Status der W8-E-Einträge), [`20`](20-product-changelog.md) (benutzerspürbar: Anhänge nur noch angemeldet) und die Release-Evidenz in `releases/2026-09.md` (SHAs, Ledger, `NORA_W8E_RESULT`-Zeilen, Probe-Ergebnisse — Objektschlüssel und URLs nur dort, nie in durable Dokumenten)

### Ausführungsstand (Release 2026-10-07)

Nur Evidenz der **einen** Ausführung — das Verfahren oben bleibt davon getrennt und allgemein. Vollständige Zahlen und Probe-Ergebnisse: Archiv `releases/2026-10.md`.

| Punkt | Ergebnis |
|---|---|
| Merge-Commit (Stage B) | `b282eccfe659b1e6ff29162667feb81fd140cda8` (PR #5, Merge-Commit); vorheriger `main` `ab1b292c2ed302add979f1c6530b5c04a1b00861` |
| Zertifizierter RC / Tree | `783735c37d6e79c762aa223cc649acab7f144f0f` / `593bb005e8da6e602098eaea4a9e22de39ed9042` |
| Stage A | Migration `20260928120000` angewendet (Ledger 72); 4 Branding-Objekte umgezogen, 1 externes Logo übersprungen, 0 failed, 0 refused; Wiederholung idempotent — `W8-E STAGE A COMPLETE` |
| Stage B | Production lieferte den Merge-Build aus; `attachments` blieb öffentlich; vier Smokes bestanden — `W8-E STAGE B COMPLETE` |
| Stage B.5 | 2 reale Geräte verifiziert; weitere Geräte nicht einzeln verifiziert; Restrisiko vom Product Owner angenommen — **nicht** „alle Geräte konvergiert" (`B.5 CLOSED WITH PO-ACCEPTED RESIDUAL RISK`, [`06`](06-decision-log.md) „2026-10-07 – W8-E Release") |
| Stage-C-Preflight | 10/10 `PASS`, `GO` |
| Stage C | über das Storage-API-Werkzeug, nicht per SQL; `RESULT: PRIVATE / VERIFIED`; Dateigrößenlimit und MIME-Typen unverändert; Operator-Schlüssel nur in der lokalen Shell, danach entfernt |
| Sofortbeweis | `/object/authenticated/…` 400; `/object/<bucket>/…` anonym 400; exakte vorab gewärmte URL: 200/`HIT` → nach ≈ 11 s 400/`BYPASS`, Klassifikation `denied` |
| Verzögerter Nachweis | ≈ 17 min nach der Umstellung: alle drei Routen wieder 400 / `denied` — CDN-Nachweis geschlossen |
| Postflight | `30_verify_attachments_private.sql` 10/10, `VERIFIED` |
| Production-Smoke (PO) | Bild- und Dokument-Anhang öffnen sich über signierte URLs; Branding und Einstellungen rendern |
| Rollback | **nicht ausgeführt, nicht erforderlich** |
| Ergebnis | `W8-E STAGE C COMPLETE / PRIVATE VERIFIED` → `W8-E STORAGE RELEASE COMPLETE` |

Beobachtungen für künftige Ausführungen: neue Anhang-Objektschlüssel sind UUIDs; Stage A kopiert und stellt Verweise um, es löscht nichts — die Quellobjekte bleiben als S2B-Aufräumrest in `attachments` ([`17`](17-known-issues-and-planned-waves.md) H.1). Der Dokumentationsabschluss dieser Sektion („Nach dem Release") ist für diese Ausführung erledigt.

**Lokal geprüft, nicht in Production:** `supabase/maintenance/attachment_privacy/lib/privacy_control.test.ts` (läuft in CI) treibt das Stage-C-Verfahren mit Fakes durch jede Kompensationsgrenze und hält Repository und diese Sektion gegen die 3C-Befunde fest. `supabase/tests/attachment_privacy_verification.mjs` führt dasselbe Werkzeug und die SQL-Dateien gegen einen echten lokalen Stack aus — inklusive der Weigerung bei fremder oder gleichnamig erweiterter Policy, abgeschalteter RLS, einer Policy auf `storage.buckets`, erzwungener API-Fehler, Kompensation, `EMERGENCY`, der SQL-Fallback-Matrix in vier Runner-Formen und einer aufgeschobenen Constraint-Rücknahme. Er mutiert den **lokalen** Bucket und stellt Bucket, Kontrollen, Policies und RLS am Ende — auch nach einem Fehlschlag — wieder her; er verlangt zu Beginn einen Preflight `GO`. Vorher die Attachment-SQL-Suiten aus Sektion 4 laufen lassen: der Verifier schreibt eine echte Notiz, und `attachment_foundation_verification.sql` erwartet eine leere `public.attachments`. **Einen CDN gibt es lokal nicht:** lokal belegt ist der Kontrollpfad (die API-Umstellung löst genau einen Bucket-Purge aus, SQL keinen), nicht die Invalidierung am Edge.
