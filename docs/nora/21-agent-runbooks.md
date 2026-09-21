# 21 – Agent Runbooks (conditional)

Stand: 2026-09-21 · Load-Klasse: **CONDITIONAL** — dieses Dokument wird **nie vollständig** als Standardkontext geladen.

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
| RBAC-/RLS-Änderung lokal verifizieren | [5. Kanonische lokale SQL-Testsequenz](#5-kanonische-lokale-sql-testsequenz) |
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

---

## 1. Datenbank, Migrationen und Production-Ledger

**Wann:** jede Migration, jeder Schreibzugriff auf eine echte Production-Datenbank (Supabase MCP). Durable Migrations- und Datenregeln: [`03`](03-data-model-guardrails.md) §4 (Migrationsinvarianten). Universelle Release-Reihenfolge und Freigaberegeln: [`07`](07-agent-change-checklist.md).

- [ ] **Ledger-Drift ist der Normalfall, nicht die Ausnahme.** Sofort nach dem Apply `list_migrations` prüfen: das Zeitstempel-Präfix muss exakt dem lokalen Dateinamen entsprechen — `apply_migration` trägt regelmäßig den **Anwendungszeitstempel** statt des Dateiname-Zeitstempels ein (bei jedem `apply_migration`-Production-Apply seit 2026-08-25 aufgetreten, zuletzt W8-C S1, S2A1, S2A2.1, S2A2.2, S3A und S3B; der CLI-Weg `db push` trug bei W8-B den Dateinamen-Zeitstempel korrekt ein; Evidenz im Archiv `releases/`). Der Release gilt erst als abgeschlossen, wenn der Ledger 1:1 zum Repository passt.
- [ ] **Korrektur nur nach Halt und expliziter PO-Freigabe.** Vor der Korrektur read-only verifizieren, dass die betroffene Zeile eindeutig zur gerade angewendeten Migration gehört (Name **und** Inhalt/`statements`-Spalte). Dann transaktional und fail-closed **exakt eine Zeile** korrigieren — der Schritt bricht ab, wenn Zeilenzahl, Abwesenheit der Zielversion, Eindeutigkeit des Namens oder der Inhalts-Fingerprint der Zeile nicht stimmen —, danach erneut read-only bestätigen: `list_migrations` deckt sich wieder 1:1 mit dem Repo, keine andere Zeile verändert.
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

## 5. Kanonische lokale SQL-Testsequenz

**Wann:** jede RBAC-/RLS-/`SECURITY DEFINER`-Änderung und jede Lifecycle-Welle. Läuft ausschließlich lokal nach `npx supabase db reset --local`; die Übernahme in CI ist ein offener Punkt ([`17`](17-known-issues-and-planned-waves.md) Abschnitt B, Eintrag W9).

Reihenfolge:

`production_check` → `first_admin_parallel` → `setup` → `matrix` → `final_hardening` → `checklists_audit` → `crm_audit` → `google_calendar` → `teardown` → `production_check`

- [ ] **Keine Testrolle** nach `db reset` ohne Setup (`rbac_rls_production_check.sql`)
- [ ] `rbac_rls_verification.sql` gehört wie `rbac_rls_production_check.sql` auf die **leere** Datenbank (vor `setup` oder nach `teardown`): ihre erste Assertion lautet „`nora_rls_test` must not exist after production migrations only". Nach `setup` schlägt sie fehl — das ist Reihenfolge, kein Regressionsbefund
- [ ] `public_privilege_hardening_verification.sql` an beliebiger Stelle nach einem `db reset` — self-contained, rollt zurück, hinterlässt keine Testrolle
- [ ] die Lifecycle-Suiten W1 → W6-B laufen **je zweimal** (leere DB **und** mit Fixtures) in der Reihenfolge aus Sektion 6
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
