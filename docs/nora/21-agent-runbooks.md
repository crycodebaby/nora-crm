# 21 – Agent Runbooks (conditional)

Stand: 2026-09-10 · Load-Klasse: **CONDITIONAL** — dieses Dokument wird **nie vollständig** als Standardkontext geladen.

Hier stehen die subsystem- und situationsabhängigen operativen Anweisungen für Änderungen an Nora: Testsequenzen, Verifikationsschritte, wiederkehrende Fallstricke. Sie standen früher als `Bei <X> zusätzlich:`-Blöcke in [`07`](07-agent-change-checklist.md) und wurden damit bei **jeder** Aufgabe mitgeladen, auch bei einer reinen Label-Änderung. [`07`](07-agent-change-checklist.md) behält nur das universelle Change Protocol; hier liegt alles Bedingte.

**Wie dieses Dokument benutzt wird:** Der Router [`README.md`](README.md) benennt für die jeweilige Aufgabe die zuständige Sektion. Es wird **genau diese Sektion** gelesen, nicht die Datei. Der Index unten ist der interne Einstieg, keine zweite Routingtabelle — Dokumentzuständigkeiten und Load-Klassen stehen ausschließlich im Router.

**Abgrenzung.** Dieses Dokument enthält **keine** durablen fachlichen oder datenbezogenen Invarianten — die stehen in [`01`](01-domain-model.md), [`03`](03-data-model-guardrails.md), [`22`](22-security-and-access.md) und den Subsystem-Contracts ([`10`](10-checklists-snippets-audit.md), [`11`](11-google-calendar-rbac.md), [`13`](13-crm-audit-retention.md), [`14`](14-google-calendar-readonly-implementation.md), [`18`](18-email-delivery-observability.md), [`19`](19-user-lifecycle-architecture.md)). Hier steht nur, **was beim Ändern zusätzlich zu tun und zu beweisen ist**.

**Ownership-Hinweis.** Sektion 4 hat seit CR2 einen Contract-Owner: [`22-security-and-access.md`](22-security-and-access.md). Die Sektionen **11–14** warten weiterhin auf einen (Operations/Errors/Notifications, PWA). Bis dieser existiert, tragen sie einige Contract-Sätze bewusst mit — jeweils als `Interim-Contract` markiert — statt sie in einen unpassenden bestehenden Owner zu schieben.

## Index (thematisch)

| Aufgabe | Sektion |
|---|---|
| Migration schreiben oder gegen Production anwenden | [1. Datenbank, Migrationen und Production-Ledger](#1-datenbank-migrationen-und-production-ledger) |
| Kunden-/Vorgangsnummern, Nummernlogik | [2. Nummern und Nummernlogik](#2-nummern-und-nummernlogik) |
| Checklisten, Textbausteine, Checklisten-Audit | [3. Checklisten, Textbausteine und Checklisten-Audit](#3-checklisten-textbausteine-und-checklisten-audit) |
| `SECURITY DEFINER`, `security_invoker`, Grants, RLS, neue Tabelle/View/Function in `public` | [4. Security und Zugriff](#4-security-und-zugriff) |
| RBAC-/RLS-Änderung lokal verifizieren | [5. Kanonische lokale SQL-Testsequenz](#5-kanonische-lokale-sql-testsequenz) |
| `sales`, `users` Edge Function, Auth, Rolle, Zugang, Anmeldeadresse, Offboarding, Kontolöschung | [6. Mitarbeiter-Lifecycle W1–W6-B](#6-mitarbeiter-lifecycle-w1w6-b) |
| CRM-Audit-Verlauf, `audit_events` | [7. CRM-Audit-Verlauf](#7-crm-audit-verlauf) |
| Google Kalender, Kalender-RBAC, OAuth | [8. Google Kalender](#8-google-kalender) |
| Rollenabhängige Oberfläche, Zugriffsschutz in der UI, Dialoge, Fehlergrenzen | [9. Rollenbewusste UX und Zugriffsschutz](#9-rollenbewusste-ux-und-zugriffsschutz) |
| Demo-Modus, Rollensimulation | [10. Demo-Modus und Rollensimulation](#10-demo-modus-und-rollensimulation) |
| Operation-IDs, OperationManager, Operations-Katalog | [11. Operationen: Correlation, Manager, Katalog](#11-operationen-correlation-manager-katalog) |
| Neuer Business-Fehlercode, `operation_errors`, Error Observatory | [12. Fehler: Contract und Observatory](#12-fehler-contract-und-observatory) |
| Notification-Karte, Toasts, Feedback-Schicht, Overlays | [13. Notifications und Feedback](#13-notifications-und-feedback) |
| Service Worker, Update-Hinweis, Live-Smoke nach Deployment | [14. PWA und Update-Verhalten](#14-pwa-und-update-verhalten) |
| Kunden-/Kontaktanlage, `customer_kind`, Hauptansprechpartner | [15. Kunden, Kontakte und Hauptansprechpartner](#15-kunden-kontakte-und-hauptansprechpartner) |

---

## 1. Datenbank, Migrationen und Production-Ledger

**Wann:** jede Migration, jeder Schreibzugriff auf eine echte Production-Datenbank (Supabase MCP). Durable Migrations- und Datenregeln: [`03`](03-data-model-guardrails.md) §4 (Migrationsinvarianten). Universelle Release-Reihenfolge und Freigaberegeln: [`07`](07-agent-change-checklist.md).

- [ ] **Ledger-Drift ist der Normalfall, nicht die Ausnahme.** Sofort nach dem Apply `list_migrations` prüfen: das Zeitstempel-Präfix muss exakt dem lokalen Dateinamen entsprechen — `apply_migration` trägt regelmäßig den **Anwendungszeitstempel** statt des Dateiname-Zeitstempels ein (bei jedem Production-Apply seit 2026-08-25 aufgetreten, zuletzt W1–W5; Evidenz im Archiv `releases/`). Der Release gilt erst als abgeschlossen, wenn der Ledger 1:1 zum Repository passt.
- [ ] **Korrektur nur nach Halt und expliziter PO-Freigabe.** Vor der Korrektur read-only verifizieren, dass die betroffene Zeile eindeutig zur gerade angewendeten Migration gehört (Name **und** Inhalt/`statements`-Spalte). Dann transaktional **exakt eine Zeile** korrigieren, danach erneut read-only bestätigen: `list_migrations` deckt sich wieder 1:1 mit dem Repo, keine andere Zeile verändert.
- [ ] `npx supabase db reset --local` nach jeder neuen Migration — die Migration muss reproduzierbar durchlaufen.
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

## 5. Kanonische lokale SQL-Testsequenz

**Wann:** jede RBAC-/RLS-/`SECURITY DEFINER`-Änderung und jede Lifecycle-Welle. Läuft ausschließlich lokal nach `npx supabase db reset --local`; die Übernahme in CI ist ein offener Punkt ([`17`](17-known-issues-and-planned-waves.md) Abschnitt B, Eintrag W9).

Reihenfolge:

`production_check` → `first_admin_parallel` → `setup` → `matrix` → `final_hardening` → `checklists_audit` → `crm_audit` → `google_calendar` → `teardown` → `production_check`

- [ ] **Keine Testrolle** nach `db reset` ohne Setup (`rbac_rls_production_check.sql`)
- [ ] `rbac_rls_verification.sql` gehört wie `rbac_rls_production_check.sql` auf die **leere** Datenbank (vor `setup` oder nach `teardown`): ihre erste Assertion lautet „`nora_rls_test` must not exist after production migrations only". Nach `setup` schlägt sie fehl — das ist Reihenfolge, kein Regressionsbefund
- [ ] `public_privilege_hardening_verification.sql` an beliebiger Stelle nach einem `db reset` — self-contained, rollt zurück, hinterlässt keine Testrolle
- [ ] die Lifecycle-Suiten W1 → W6-B laufen **je zweimal** (leere DB **und** mit Fixtures) in der Reihenfolge aus Sektion 6
- [ ] Bekannter Windows-Tooling-Bug in `rbac_rls_first_admin_parallel_runner.ps1` (die Vorbedingungs-Regex parst die mehrzeilige `psql`-Ausgabe falsch — kein SQL-/Produktfehler) samt Workaround: [`17`](17-known-issues-and-planned-waves.md) Abschnitt B, Eintrag W9. Der Workaround bildet die im Skript enthaltene SQL manuell nach (zwei parallele `docker exec … psql`-Sessions gegen `auth.users`, danach die Verifikation „exakt 1 Admin + 1 Viewer", dann Cleanup) — das Skript **nicht** nebenbei patchen

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

**Wann:** Änderungen an Operation-IDs, am `OperationManager`, am Operations-Katalog oder an der Korrelation zwischen Client und `audit_events`. Entscheidungen: [`06`](06-decision-log.md) Einträge Operation Correlation / Operation Manager. Persistenz-Invarianten: [`03`](03-data-model-guardrails.md) §5; Trust-Boundary („Operation IDs korrelieren, sie autorisieren nicht"): [`22`](22-security-and-access.md) Abschnitt 5.

> **Interim-Contract** (Sektion 11–14 haben noch keinen Contract-Owner — siehe Kopf dieses Dokuments):
>
> - **Falle 35 — gespeicherte Disposition ist kein Live-Status.** Die drei idempotenten RPCs schreiben `_meta.disposition = "executed"` beim Erstschreiben **unveränderlich** in `nora_private.idempotency_records`; dieser Wert bleibt für immer `"executed"`, auch nach beliebig vielen Replays. Die **externe** Disposition wird bei **jedem** Request serverseitig frisch berechnet (`v_replay || jsonb_build_object('_meta', …'replayed')` — jsonb `||` gewinnt rechts) und nie aus der gespeicherten Zeile übernommen. Eine Admin-Ansicht oder ein Reporting darf `result._meta.disposition` **nicht** als „letzte bekannte Disposition" ausgeben. Empirisch verifiziert: die direkte Abfrage zeigt `"executed"`, während der gleichzeitige Replay-Response korrekt `"replayed"` liefert. Die Tabelle ist ohnehin nur über `idempotency_check`/`idempotency_persist` erreichbar, nicht direkt per PostgREST.
> - **Falle 38 — eine vorgegebene `operationId` ist nicht die vergebene.** `createOperationContext()` normalisiert: ungültige Werte werden **verworfen und durch eine frisch geminte ersetzt**, gültige werden lowercased. Wer eine ID vorab anmeldet und dann auf `manager.getOperation(id)` wartet, wartet bei einer ungültigen oder uppercase-UUID auf eine ID, die es nie geben wird — der wartende Zustand löst sich nie auf. Vorgegebene IDs müssen garantiert gültig und lowercase sein (wie `createOperationId()` sie liefert), oder die anmeldende Schicht bindet sich an die **tatsächlich vergebene** Kontext-ID.

- [ ] `nora_private.current_operation_id()` bleibt INVOKER; liefert nur UUID oder NULL; kein Auth-/RLS-Effekt
- [ ] **Ownership:** der Einstieg mintet die ID einmal; der Transport reicht sie nur weiter und überschreibt gültige IDs nie
- [ ] `audit_events.request_id` wird über den zentralen Writer befüllt; keine zweite Spalte
- [ ] Partial Index `audit_events_request_id_idx` (nicht unique)
- [ ] Manager: `pending` → `success|error`; Exceptions nicht schlucken; ohne React voll funktionsfähig (Singleton); der `OperationProvider` erzeugt keine zweite konkurrierende Instanz
- [ ] Katalog typisiert; keine Fake-Systemschritte in Messages; `deal.assign` bleibt Katalogeintrag und wird nicht als zweite Mutation erzwungen
- [ ] in-memory only (kein DB/localStorage/Realtime); Retention: `success` kurz, `error` länger, `pending` nie auto-drop
- [ ] `runtimeErrorId` nur session-ephemer und ≠ `persistentErrorId` / `publicErrorRef`
- [ ] `useSyncExternalStore` für Listen
- [ ] ein altes Frontend ohne Header bleibt kompatibel (`request_id` NULL)
- [ ] `supabase/tests/operation_correlation_verification.sql` lokal nach `db reset`; HTTP-Probe `node scripts/verify-operation-header.mjs` nur gegen lokal (mit **und** ohne Header)
- [ ] Unit-Tests Manager A–M + Snapshot/Timer/Singleton + Correlation-Regression

## 12. Fehler: Contract und Observatory

**Wann:** neuer Business-Fehlercode, Änderungen an `normalizeCrmError`, an `operation_errors` oder am Error Observatory. Der **durable Fehlervertrag** (machine-code-first, `error.message`/`error.details` sind nie Business-Codes, Regex nur als Legacy-Fallback) steht in [`03`](03-data-model-guardrails.md) §6; hier steht der **Ablauf** und die Verifikation.

**Neuen Business-Fehlercode einführen — genau dieser Ablauf, nicht „neues Regex-Pattern ergänzen":**

1. [ ] Kanonischen `NoraErrorCode` in `domain/noraErrorCodes.ts` definieren (`NORA_ERROR_CODES` / `NORA_ERROR_DEFINITIONS`)
2. [ ] Serverseitig an der RAISE-Stelle `USING DETAIL = 'NORA_<CODE>'` setzen (SQL-Migration **additiv**, `supabase/schemas/02_functions.sql` synchron nachziehen)
3. [ ] Presentation-Mapping (`messageKey`) in `NORA_ERROR_DEFINITIONS` ergänzen
4. [ ] FakeRest über `throwNoraError()` denselben Code werfen lassen, soweit FakeRest den Command-Pfad überhaupt modelliert — sonst als Debt dokumentieren, **nicht** Scope aufblasen
5. [ ] Die menschliche `MESSAGE` bleibt frei umformulierbar/diagnostisch — nie als Business-Identität verwenden
6. [ ] Bestehende Regex-Pfade **nicht** entfernen (Legacy-Compatibility für nicht migrierte Aufrufer) — nur der Weg für *neue* Fälle ist dieser

- [ ] `supabase/tests/error_contract_verification.sql` (oder eine Erweiterung) nach `db reset --local` grün
- [ ] **Human Message Independence** nachgewiesen, wenn zwei Origins denselben Code liefern: Test mit unterschiedlichem MESSAGE-Text und gleichem DETAIL
- [ ] `npx vitest run` zusätzlich zu `typecheck`/`build`
- [ ] `operation_errors` bleibt additiv und getrennt von `audit_events`; kein Client-INSERT — nur `record_operation_error` / `report_operation_error`
- [ ] Actor ausschließlich `safe_auth_uid()`; die `operation_id` ist **nie** ein Auth-Merkmal
- [ ] `public_ref` serverseitig UNIQUE (`NORA-E…`); Dedupe per `operation_id`, neue Attempts bleiben unterscheidbar
- [ ] `technical_context` nach Allowlist — keine Request-Bodies, Secrets oder personenbezogenen Daten
- [ ] soft resource refs (kein FK auf Business-Tabellen)
- [ ] RLS: kein freier Browse; Admin `SELECT`; Report nur für den eigenen Actor
- [ ] Fehler werden best-effort in **eigener Transaktion** aufgezeichnet; ein Observatory-Ausfall ersetzt niemals die Business-Exception
- [ ] `supabase/tests/error_observatory_verification.sql` nach `db reset`; Unit-Tests A–H + Kontakttermin-Regression

## 13. Notifications und Feedback

**Wann:** Änderungen an der Notification-Karte, an Toasts, an der Feedback-Schicht eines Flows oder an Overlays/Portalen. Präsentations-Contract: [`02`](02-design-system.md).

> **Interim-Contract — Falle 37: die Presentation erfindet keinen Core-Lifecycle.** Der technische `OperationStatus` bleibt `pending` | `success` | `error`. Ein Presentation-Lifecycle **darf** zusätzliche Werte kennen (`partial` = Core committed, optionaler Folgeschritt nicht), diese entstehen aber ausschließlich durch **Reduktion mehrerer `OperationRecord`s in der Presentation** und werden **nie** in den Core zurückgeschrieben. Ein lange laufendes `pending` wird von der Presentation niemals zu `error`/`timeout` umgedeutet — der fehlende Timeout-Lifecycle ist ein bekannter Core-Follow-up ([`17`](17-known-issues-and-planned-waves.md) D.1) und darf nicht durch eine Anzeige-Heuristik kaschiert werden. Zulässig ist höchstens ein zusätzlicher Hinweis „dauert länger als erwartet" bei unverändertem Lifecycle und Tone.

- [ ] **Ein Flow gehört genau einer Feedback-Schicht.** Wird ein Flow auf die Notification-Karte migriert, werden seine `notify()`-Aufrufe für dieselbe fachliche Aussage im selben Schritt entfernt — nie Karte *und* Toast nebeneinander
- [ ] sonner bleibt für alle nicht migrierten Flows montiert; keine globale Toast-Bereinigung nebenbei
- [ ] ein Operation-Slot wird nur registriert, wenn die Operation auch wirklich startet (kein Phantom-Slot → sonst hängt die Karte für immer auf `pending`)
- [ ] Fehler **vor** dem Start einer Operation werden nicht in einen synthetischen `OperationRecord` verwandelt — Feldfehler bleiben inline, alles andere meldet der Aufrufer selbst (`QuickCaptureUnnotifiedError`-Muster)
- [ ] `application/commands/*` importiert weiterhin nichts aus `notifications/` (kein Display Context, kein i18n-Key, kein Tone)
- [ ] kein zweiter `OperationManager`: der `NotificationProvider` liegt unterhalb des `OperationProvider`
- [ ] neue sichtbare Texte kommen aus `crm.notifications.*` in **allen** registrierten Katalogen (Deutsch primär, Englisch gepflegt, französische Struktur nicht still brechen)
- [ ] **Overlay-/Portal-/`z-index`-Verhalten wird in der echten gestylten App abgenommen, nicht nur im Test.** Im Browser-Test-Bundle sind Tailwind-Utilities nicht kompiliert — Aussagen über Geometrie, Sichtbarkeit und Klickbarkeit, die an `@apply`-Klassen hängen (`fixed`, `pointer-events-none`, Abstände), sind dort **nicht** bewiesen und können sogar aus dem falschen Grund grün sein. Belastbar sind im Test nur reine CSS-Deklarationen (`z-index`, `pointer-events` aus eigenen Regeln)
- [ ] bei kritischen Overlay-Änderungen **echter Hit-Test** (`document.elementFromPoint()` o. ä.) auf jedes betroffene Control der darunterliegenden Oberfläche — „sieht richtig aus" ist kein Nachweis
- [ ] **Große, sich verändernde Flächen bekommen keine Live-Rolle.** `role="status"`/`role="alert"` bringen `aria-atomic="true"` mit: jede Mutation im Teilbaum wird als komplette Wiederholung vorgelesen. Sichtbare Präsentation und Screenreader-Ansage trennen (Muster: `NoraNotificationAnnouncer` in 7B, `UpdateAnnouncer` in der PWA-Schicht) — eine kurze Ansage pro Zustandswechsel, Identität über einen React-Key, kein Whitespace-Trick
- [ ] `npx vitest run` zusätzlich zu `typecheck`/`build`

## 14. PWA und Update-Verhalten

**Wann:** Änderungen an Service Worker, Precache oder Update-Hinweis — und bei **jedem** Live-Smoke nach einem Deployment. Durable Regeln: [`06`](06-decision-log.md) Eintrag PWA-Update-Lifecycle; Präsentation: [`02`](02-design-system.md) Abschnitt Anwendungs-Systemereignisse; Ursache und Reproduktion: [`17`](17-known-issues-and-planned-waves.md) Abschnitt E.

- [ ] **Live-Smoke direkt nach einem Deployment: ein Reload genügt nicht mehr.** Nora ist eine PWA (`vite-plugin-pwa`, `generateSW`) und läuft seit PWA-1B mit `registerType: "prompt"`: ein neuer Service Worker bleibt **WAITING**, bis der Benutzer aktualisiert. Ein bereits installierter Browser zeigt deshalb auch nach beliebig vielen Reloads weiter den **Vorgänger-Build** — das ist gewollt (der Precache des laufenden Builds bleibt intakt), macht aber jeden naiven Smoke-Test wertlos. Um den neuen Build wirklich zu prüfen, eines von beidem: den Update-Hinweis „Jetzt aktualisieren" auslösen, **oder** in einem frischen Profil bzw. nach `unregister()` des Service Workers testen. Verlässlicher Nachweis, dass wirklich der neue Build läuft: die Asset-Hashes aus dem live ausgelieferten `index.html` gegen das DOM prüfen bzw. auf einen release-spezifischen Marker im Bundle testen (bestätigt beim Phase-7B-Release 2026-08-30)
- [ ] **PWA-Lifecycle nicht als Business-Operation modellieren.** Ein Update bekommt keine `operationId`, keinen Idempotency-Key, keinen Eintrag im OperationManager und keinen erfundenen `pending/success/error`-Verlauf im Notification-Store. UI konsumiert ausschließlich `usePwaUpdate()` und fasst `navigator.serviceWorker`/Workbox nie direkt an
- [ ] **Eine ausgelöste Anfrage ist kein Erfolgssignal.** Wenn ein Zustand „hat geklappt" behaupten soll, muss dahinter ein reales Ereignis der Plattform stehen — nicht das Resolven eines Promise aus einer Fremdbibliothek. Vor dem Bauen den **ausgelieferten** Code der Bibliothek lesen (`node_modules/<paket>/dist/…`), nicht die README. Konkreter Fall: `updateServiceWorker()` aus `vite-plugin-pwa` resolved immer und sagt nichts über die Worker-Übernahme; das belastbare Signal ist `controllerchange`. Wer auf ein Ausbleiben reagieren will, braucht einen **Watchdog mit gemessener Frist** — und die Frist beginnt beim Auslösen, nicht am Anfang einer vorgelagerten Inszenierung

## 15. Kunden, Kontakte und Hauptansprechpartner

**Wann:** Änderungen an Kunden-/Kontaktanlage, an `customer_kind`, an `is_primary` oder den zugehörigen RPCs. **Die fachlichen und datenbezogenen Invarianten stehen in [`01`](01-domain-model.md) und [`03`](03-data-model-guardrails.md) (§1 Kern-Entitätsinvarianten, §3 Transaktionen/Sperren/Concurrency)** und werden hier nicht wiederholt — hier stehen nur die zusätzlichen operativen Schritte.

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
