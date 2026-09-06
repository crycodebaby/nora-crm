# 07 – Agent Change Checklist

Vor jeder Änderung:

- [ ] `AGENTS.md` gelesen
- [ ] relevante `docs/nora/*.md` gelesen
- [ ] Ziel der Änderung verstanden
- [ ] geprüft, ob UI, Konfiguration, Demo-Daten oder Datenmodell betroffen sind
- [ ] keine unnötige DB-/Migration-Änderung geplant
- [ ] keine Resource-Namen blind umbenannt
- [ ] keine `dist/`-Dateien direkt bearbeitet

Während der Änderung:

- [ ] sichtbare Texte in Deutsch gepflegt
- [ ] keine Denglisch-Begriffe eingeführt
- [ ] Nora-Brandfarbe zentral/konsequent genutzt
- [ ] alte Atomic-Werte nicht unnötig gebrochen
- [ ] Datenmodell-Doppelungen vermieden

Nach der Änderung:

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] bei Demo-Daten: `npm run dev:demo`
- [ ] manuelle Prüfung relevanter Seiten
- [ ] bei Kanban/Detail: Zoom 125 %/150 %, Hell/Dunkel, Maus + Trackpad
- [ ] Dokumentations-Abschlusscheck durchlaufen (Abschnitt „Dokumentations-Abschluss" unten)
- [ ] Commit-Nachricht klar formuliert

## Dokumentations-Abschluss (nach jeder bedeutsamen Änderung)

Nicht jedes Dokument muss bei jeder Änderung angefasst werden — **nur die zuständigen**. Nach einer bedeutsamen Änderung fragen: *Hat diese Änderung Folgendes berührt?*

| Frage | Zuständiges Dokument | Was dorthin gehört |
|---|---|---|
| das Fach-/Domänenmodell (neue Entität, Begriff, Regel, Rolle)? | `01-domain-model.md` | kompakte aktuelle Beschreibung, Link auf Details |
| eine durable Invariante oder Guardrail (Falle, Grant-/RLS-Regel, Migrationsregel)? | `03-data-model-guardrails.md` | die Regel selbst, ohne Release-Evidenz |
| eine durable fachliche/architektonische Entscheidung? | `06-decision-log.md` | Datum, Kontext, Entscheidung, Begründung — knapp; Eintrag in der Index-Tabelle; Link ins Archiv |
| ein dediziertes Architektur-/Spezifikationsdokument (z. B. `19-user-lifecycle-architecture.md`, `18-…`, `13-…`, `11-…`, `02-…`)? | das jeweilige Dokument | aktueller Zustand des Subsystems |
| den aktuellen Live-Zustand (Versionen, Ledger-Kopf, Edge-Versionen, abgeschlossene Wellen, Navigation)? | `16-current-state.md` | Momentaufnahme + Themen-Tabelle (sonst findet die nächste Session das Thema nicht) |
| offene Punkte (neuer Bug, Restrisiko, geplante Welle — oder ein erledigter)? | `17-known-issues-and-planned-waves.md` | nur genuin Offenes; Erledigtes ins Archiv verschieben, nicht löschen |
| die Release-Historie (RC-SHA, Migration, Ledger, Edge-Deploy, Live-Beweis, Zwischenfall)? | `releases/<jahr-monat>.md` | Chronik-Zeile + Abschnitt mit Evidenz |
| etwas, das Benutzer merken? | `20-product-changelog.md` | Datum, Titel, „Was ändert sich für Sie", optional technischer Hinweis |

Zusätzlich: interne Links prüfen, wenn Überschriften verschoben oder umbenannt wurden; überholte Zwischenstände als überholt markieren statt löschen; `AGENTS.md` nur ändern, wenn sich der Pflicht-Leseeinstieg ändert.

Bei jedem `apply_migration` gegen eine echte Production-Datenbank (Supabase MCP) zusätzlich:

- [ ] Zielprojekt vor JEDEM Write per `list_projects` gegen Name UND Ref bestätigt (nicht nur einmal zu Sessionbeginn)
- [ ] Sofort nach dem Apply `list_migrations` prüfen: Zeitstempel-Präfix muss exakt dem lokalen Dateinamen entsprechen — `apply_migration` trägt regelmäßig den Anwendungszeitstempel ein (bei jedem Production-Apply seit 2026-08-25 aufgetreten, zuletzt W1–W5; Evidenz im Archiv `releases/`); Korrektur nur nach Halt und expliziter PO-Freigabe als transaktionale Einzeilen-Änderung
- [ ] Bei Drift: vor der Korrektur read-only verifizieren, dass die betroffene Zeile eindeutig zur gerade angewendeten Migration gehört (Name + Inhalt/`statements`-Spalte), dann transaktional exakt eine Zeile korrigieren, danach erneut read-only bestätigen (`list_migrations` deckt sich wieder 1:1 mit dem Repo, keine andere Zeile verändert)
- [ ] Release-Reihenfolge bei schemaabhängigen Waves mit automatischem Vercel-Deploy: RC einfrieren (Commit-SHA + Migration-SHA-256) → Production-DB-Migration → DB-Verifikation → ggf. Edge-Function-Deploy aus byteexakten RC-Blobs (Edge Functions werden **nicht** von Vercel deployt) → Git Push → automatisches Vercel-Deployment → Live-Smoke — **nicht** Push zuerst
- [ ] `npm run typecheck` gehört ausdrücklich zu den RC-Gates und ist nicht durch `npm run build` abgedeckt (Root-`tsconfig` schließt Tests aus)

Bei Nummern-/DB-Änderungen zusätzlich:

- [ ] `npx supabase db reset --local` (Migration reproduzierbar?)
- [ ] NULL/Duplikat/Format-Check für `customer_number` / `case_number`
- [ ] Immutability lokal getestet (`UPDATE` muss fehlschlagen)
- [ ] INSERT mit Fake-Nummer erzeugt **keine** Client-Nummer (Hardening)
- [ ] `next_*` nicht per RPC für `anon`/`authenticated` ausführbar
- [ ] Keine zweite Nummernlogik in Demo/CSV/UI-Formularen

Bei Checklisten-/Audit-Migration (ab v0.3d2) zusätzlich:

- [ ] `docs/nora/10-checklists-snippets-audit.md` gelesen
- [ ] Kein JSONB-only als Haupt-Checklistenmodell
- [ ] `label_snapshot` an `checklist_run_items` vorhanden
- [ ] `audit_events` append-only (kein UPDATE/DELETE für App-Rollen)
- [ ] `service_area_code` nicht mit `company_id` verwechselt
- [ ] Vorlagen/Snippets: `is_active = false` statt DELETE
- [ ] Keine Audit-Daten in Notizen/Freitext
- [ ] FKs für deal, company, contact, checklist_run konsistent
- [ ] `npx supabase db reset --local` nach Migration
- [ ] `supabase/tests/checklists_audit_verification.sql` ausführen (Docker: `supabase_db_atomic-crm-demo`)
- [ ] Checklisten-Start über RPC `start_checklist_run_from_template` — keine manuellen Run-Item-Inserts vom Client
- [ ] v0.3d4: `DealProductionChecklistSection` in `DealShow` — Demo-Hinweis bei `VITE_IS_DEMO`

Bei Änderungen an `SECURITY DEFINER`-Functions/Views, `security_invoker`, Grants oder RLS zusätzlich:

- [ ] Zugriffsmatrix geprüft: `anon`, `authenticated viewer`, `authenticated office`, `authenticated admin`, `service_role` (nur soweit relevant)
- [ ] UI niemals als Security Boundary behandelt — Prüfung erfolgt gegen Grants/RLS/Function-Body, nicht gegen sichtbare UI-Zustände
- [ ] Bei `init_state`/`sales_directory`: bestehende Bewertung (`06-decision-log.md` „Intentional privileged read views"; Einzelbewertungen im Archiv `releases/2026-08.md`) gilt nur für die dort geprüfte Projektion/Grants — bei Änderung neu bewerten, nicht die alte Einstufung übernehmen
- [ ] Grants immer als `revoke all` → gezielter `grant`; Privilegienaussagen gegen Production prüfen (lokaler `db reset` ist großzügiger) — siehe `03-data-model-guardrails.md` Migrationsregel

Bei RBAC-/Kalender-Änderungen (ab v0.4a) zusätzlich:

- [ ] `docs/nora/11-google-calendar-rbac.md` gelesen
- [ ] Keine parallele Benutzerverwaltung — Rolle an `sales`, nicht neue User-Tabelle
- [ ] Kein zweites Terminsystem (`appointments`) — nur `google_calendar_events` als Cache
- [ ] Google Kalender = System of Record für Termine; Nora nur Cache + Verknüpfung
- [ ] Keine private iCal-Adresse; keine Tokens in Frontend, Audit oder Data-API-Tabellen
- [ ] Kalender-ID nicht in UI-Komponenten hardcoden
- [ ] `origin = google` vs. `origin = nora` bei Schreiboperationen beachten
- [ ] OAuth-Scopes minimal: read-only zuerst, write als eigene Welle
- [ ] `service_role` niemals im Browser
- [ ] Bestehende Google-Labels/Farben/Freigaben nicht über Nora ändern
- [ ] Audit-Events für Kalender über bestehende `audit_events` — keine neue Audit-Tabelle

Bei RBAC-/RLS-Härtung (v0.4b / v0.4b.1 / v0.4b.2) zusätzlich:

- [ ] Migrationen `20260714120000` + `20260714140000` + `20260714150000` angewendet
- [ ] **Keine Testrolle** nach `db reset` ohne Setup (`rbac_rls_production_check.sql`)
- [ ] Lokaler Testfluss: `production_check` → `first_admin_parallel` → `setup` → `matrix` → `final_hardening` → `checklists_audit` → `crm_audit` → `google_calendar` → `teardown` → `production_check`
- [ ] **User Lifecycle W1:** `supabase/tests/lifecycle_single_executor_verification.sql` zusätzlich nach `production_check` (leere DB) **und** nach `safe_auth_role_verification` (mit Fixtures) ausführen — sie rollt sich selbst zurück
- [ ] **Kein** neuer Schreibpfad für `sales.role` / `sales.disabled` außerhalb `users` Edge Function → `set_sales_access_by_executor`; die Legacy-RPC `set_sales_role_by_admin` ist seit W2 gelöscht und wird **nicht** wieder angelegt
- [ ] Jede Änderung an `disabled` bewegt auch den Auth-Bann (Executor), nie nur eine Seite; kein grüner Erfolg ohne verifiziertes `accessConsistency = consistent`
- [ ] **User Lifecycle W2:** `supabase/tests/lifecycle_reference_integrity_verification.sql` direkt nach der W1-Suite ausführen (leere DB **und** mit Fixtures; rollt sich selbst zurück)
- [ ] **W2 Referenzen:** jede neue Spalte, die auf `sales.id` zeigt, bekommt einen `NO ACTION`-FK (nie `CASCADE`, nie `SET NULL`) und wird in der W2-Suite (Abschnitt 1 Zählung, Abschnitt 5 Blockade) ergänzt; kein `DELETE`-Grant oder DELETE-Policy auf `sales` für Browser-Rollen; kein Trigger/RPC, der `sales`-Zeilen für normale Clients löschbar macht
- [ ] **W2 Zuweisung:** jede neue Spalte mit **aktueller Zuständigkeit** (nicht Urheberschaft) bekommt zusätzlich `guard_active_assignment_trigger` (`before insert or update of <spalte>`); Picker über `SalesAssignmentInput`, nie ein roher `ReferenceInput` auf `sales_directory`; der Fehler ist `NORA_EMPLOYEE_NOT_ASSIGNABLE`, FakeRest wirft ihn über `guardAssignmentOnCreate/Update`
- [ ] **W2 Read-Models:** Namen bestehender Datensätze (Notiz, Vorgang, Aufgabe, Aktivität, Export) über `sales_identities` (`useGetSalesName`, `SALES_IDENTITIES_RESOURCE`); Auswahl für Neues über `sales_directory` (`SALES_DIRECTORY_REFERENCE_PROPS`); deaktivierte Mitarbeiter nie zu „Unbekannt"/„Ehemalig" umlabeln, solange die Zeile existiert
- [ ] **User Lifecycle W3:** `supabase/tests/lifecycle_audit_actor_verification.sql` direkt nach der W2-Suite ausführen (leere DB **und** mit Fixtures; rollt sich selbst zurück); nach dem Lauf müssen `nora.audit_actor_user_id` / `nora.operation_id` leer sein
- [ ] **W3 Audit-Actor:** neue `user.*`-Ereignisse aus einer Edge Function **nie** über `insert_audit_event` + `crypto.randomUUID()`; Ereignistyp in `public.record_employee_admin_event` (Allowlist) ergänzen, Actor = verifizierte JWT-User-ID (nie aus dem Body), Ziel = `sales.id`, Operation-ID weiterreichen (`users/audit.ts`); Audit erst nach Provider-/DB-Erfolg, Audit-Fehler → `audit_write_failed`, nie grün; Beweis in der W3-Suite und `users/audit.test.ts`
- [ ] **User Lifecycle W4:** `supabase/tests/lifecycle_email_change_verification.sql` direkt nach der W3-Suite ausführen (leere DB **und** mit Fixtures; rollt sich selbst zurück); danach müssen `nora.audit_actor_user_id` / `nora.operation_id` leer und `nora_private.sales_email_change_tickets` leer sein
- [ ] **W4 Anmeldeadresse:** `sales.email` und `auth.users.email` **nie** direkt schreiben (kein UPDATE, kein Sync in `handle_update_user`, kein Auth-Admin-`email` außerhalb `users/emailChange.ts`); der einzige Pfad ist `change_email` → `prepare_sales_email_change` → Auth Admin API → `guard_auth_email_change`. Kein PATCH-Feld `email` wieder einführen (`email_change_requires_command`). Neue Identitätsfelder bekommen einen eigenen Capability-Owner, keinen `postgres`-/GUC-Bypass
- [ ] **W4 Links:** wer die Anmeldeadresse bewegt, muss die `auth.one_time_tokens` des Users löschen (der Guard tut es) — nie `auth.users.confirmation_token`/`recovery_token` rotieren (wirkungslos, `NULL sent_at` lässt GoTrue mit 500 panicken)
- [ ] **W4 Eindeutigkeit:** Adressen vor jedem Provider-Aufruf mit `lower(btrim())` normalisieren; `uq__sales__email` bleibt; Duplikate gegen `sales` **und** `auth.users` prüfen; GoTrue `23505` als `email_already_in_use` mappen
- [ ] **W4 Operationstypen:** neue Katalogtypen, die in `operation_errors` landen sollen, klein schreiben (`^[a-z][a-z0-9_.]*$`), sonst schweigt `record_operation_error`
- [ ] **User Lifecycle W5:** `supabase/tests/lifecycle_offboarding_verification.sql` direkt nach der W4-Suite ausführen (leere DB **und** mit Fixtures; rollt sich selbst zurück, parkt vorhandene Admins nur innerhalb des Rollbacks); danach müssen `nora.audit_actor_user_id` / `nora.operation_id` / `request.jwt.claim.session_id` leer sein
- [ ] **W5 Offboarding:** Zugang beenden **nur** über `action: offboard` → `public.offboard_employee_by_executor` (Datenbank: `disabled` + Sitzungen + Audit in einer Transaktion → Auth-Bann → Verifikation). Nie `auth.sessions`/`auth.refresh_tokens` aus einer Edge Function oder per RPC für Browser-Rollen löschen; `nora_private.revoke_auth_sessions` bleibt postgres-intern. `user.offboarded` nur bei echter Änderung (`disposition executed`), Replay schreibt nichts
- [ ] **W5 Session-Bindung:** `nora_private.is_active_user()` und `current_role()` enthalten `jwt_session_is_live()` — bei jeder Änderung der RLS-Helfer erhalten; neue Helfer, die „aktiver Benutzer" beantworten, ebenfalls binden. Test-Fixtures setzen nur `request.jwt.claim.sub` (kein `session_id`) und bleiben dadurch unverändert gültig; wer eine Sitzung simulieren will, setzt `request.jwt.claim.session_id` auf eine echte `auth.sessions.id`. Jede Migration, die `auth.sessions` berührt, prüft vorher `has_table_privilege('postgres', 'auth.sessions', 'SELECT')` im Preflight
- [ ] **W5 Preview:** neue Tabellen mit aktueller Zuständigkeit (`sales_id` + Zuweisungs-Guard) in `public.get_employee_dependency_preview` als eigener Zähler ergänzen; Urheberschaft (Notizen) bleibt getrennt und blockiert nie
- [ ] **W5 Oberfläche:** Offboarding ist eine eigene Aktion mit Bestätigung und Preview, nie ein Nebeneffekt von „Speichern"; offene Zuweisungen sind Hinweis + Links, nie Vorbedingung; kein technisches Vokabular (JWT, Token, Sitzung, GoTrue)
- [ ] **W2 Views:** `sales_directory` und `sales_identities` bleiben `SELECT`-only (`revoke all` + `grant select`) — sie sind auto-updatable mit Owner `postgres`; jede Projektions-/Grant-Änderung braucht eine neue Security-Bewertung
- [ ] **W2 FakeRest:** `sales_directory`/`sales_identities` nur über den Store pflegen (`baseDataProvider.create/update/delete`), nie durch Mutation von `db.*` (wirkungslos)
- [ ] Bekannter Windows-Tooling-Bug (bestätigt in zwei unabhängigen Sessions, 2026-08-29 Phase 6C und 6D.1): `rbac_rls_first_admin_parallel_runner.ps1` wirft `Write-Error "sales must be empty..."` trotz `count=0`, weil die Vorbedingungs-Regex die mehrzeilige `psql`-Spaltenausgabe falsch parst — kein SQL-/Produktfehler. Workaround: die im Skript enthaltene SQL (zwei parallele `docker exec ... psql`-Sessions gegen `auth.users`, danach Verifikation „exakt 1 admin + 1 viewer", Cleanup) manuell/per eigenem `Start-Job`-Aufruf ohne die Vorbedingungsprüfung nachbilden — nicht das `.ps1` patchen, ohne dass es explizit als eigene, bewusste Änderung entschieden wird.
- [ ] Matrix als `postgres` mit `SET LOCAL ROLE nora_rls_test` — **kein** festes Testpasswort in Git
- [ ] `nora_private` nicht in `config.toml` schemas
- [ ] `nora_role_manager` NOLOGIN — kein Mitgliedschaft für `authenticated`
- [ ] Teamlisten nutzen `sales_directory`, nicht `sales` (außer Admin-Verwaltung / eigenes Profil)
- [ ] Keine GUC-Namen `nora.allow_sales_privilege_change` / `nora.privilege_rpc_token` im Code
- [ ] `supabase/tests/checklists_audit_verification.sql`
- [ ] `canAccess.ts` spiegelt Rollenmatrix; DB bleibt autoritativ

Bei Google-Kalender-Grundlage (v0.4c.1) zusätzlich:

- [ ] `docs/nora/14-google-calendar-readonly-implementation.md` gelesen
- [ ] Migration `20260716120000_google_calendar_readonly.sql` angewendet
- [ ] `supabase/tests/google_calendar_verification.sql` im Testfluss (nach `crm_audit`, vor `teardown`)
- [ ] Keine `GOOGLE_*` Secrets in `VITE_*`
- [ ] Edge Functions nur serverseitig; OAuth-Stubs geben 501/503 ohne Credentials — **kein** Fake-Erfolg
- [ ] Demo: Hinweis „Google Kalender im Demomodus nicht verbunden“ — kein Fake-OAuth
- [ ] Schema-Dateien (`01_tables` … `06_grants`) mit Migration synchron halten

Bei rollenbewusster UX (v0.3k) zusätzlich:

- [ ] Schreib-/Lösch-Buttons über `NoraAccessActions` oder `CanAccess` — nicht nur RLS-Fehler
- [ ] `NoraReadOnlyBanner` für Viewer; keine Create-Aktion in Leerzuständen
- [ ] Office: Archivieren sichtbar, Delete ausgeblendet
- [ ] `normalizeCrmError` / `withCrmErrorHandler` — keine PostgREST-Rohtexte in Notifications
- [ ] `DemoRoleSwitcher` nur bei `VITE_IS_DEMO=true`
- [ ] `noraRbacUx.test.ts` grün

Bei v0.3k.1 (Dialog-Polish) zusätzlich:

- [ ] `NoraAccessGuard` auf allen direkt erreichbaren Edit-/Create-Routen
- [ ] Dirty-Dialog: X/Escape + blockiertes Outside-Close; Quick-Capture-Draft bleibt bei Abbrechen
- [ ] `NoraShowBoundary` / `NoraListBoundary` / GlobalSearch-Fehler mit Retry
- [ ] Import nur Admin; Import-Fähigkeiten in Decision-Log dokumentiert
- [ ] `noraV03k1Ux.test.ts` grün
- [ ] Manuelle Demo-Abnahme admin / office / viewer (Hotboard, Kanban, Show, Mobile)

Bei v0.3k.2 (Demo-Rollensimulation) zusätzlich:

- [ ] `demoSession.ts` ist einzige Demo-Session-Quelle — kein `setItem(DEFAULT_USER)` beim Import
- [ ] `DemoRoleSwitcher` aktualisiert Profilmenü und Berechtigungen nach Wechsel
- [ ] `demoRoleSimulation.test.ts` grün
- [ ] `docs/nora/12-role-ux-acceptance.md` gepflegt

Bei CRM-Audit (v0.3l / v0.3l.1) zusätzlich:

- [ ] `docs/nora/13-crm-audit-retention.md` gelesen
- [ ] `npx supabase db reset --local` nach Audit-Migration
- [ ] `supabase/tests/crm_audit_verification.sql` ausführen (Docker: `supabase_db_atomic-crm-demo`)
- [ ] `supabase/tests/rbac_rls_matrix.sql` — Audit-Zeilen: Admin global ✅, Office nur RPC ✅, Viewer ❌
- [ ] `supabase/tests/checklists_audit_verification.sql` — Checklisten-Audit unverändert, keine Doppel-Events
- [ ] Kein Client-INSERT auf `audit_events`; Schreibweg nur Trigger + `nora_audit_writer`
- [ ] Office: kein direktes `SELECT` auf `audit_events`; nur `get_entity_audit_events`
- [ ] Viewer: `EntityAuditHistory` ausgeblendet (`CanAccess audit_events show`)
- [ ] UI: keine rohen JSON-Dumps; `deal.stage_changed` und `deal.status_changed` gleiches Label
- [ ] `auditUx.test.ts` grün
- [ ] `npm run typecheck` / `npm run build`
- [ ] `npm run dev:demo` — Rollenmatrix manuell: Admin `/audit` + Akte; Office nur Akte; Viewer weder noch
- [ ] Demo-Seed: synthetische Events mit `source = demo`, fiktive Personen

Bei Operation Correlation (Foundation Wave 1) zusätzlich:

- [ ] `nora_private.current_operation_id()` — INVOKER; nur UUID oder NULL; kein Auth/RLS-Effekt
- [ ] Ownership: Einstieg mintet einmal; Transport überschreibt gültige IDs nicht
- [ ] `audit_events.request_id` über zentralen Writer befüllt; keine zweite Spalte
- [ ] Partial Index `audit_events_request_id_idx` (nicht unique)
- [ ] Vertikaler Slice: `deals` update sendet `x-nora-operation-id`
- [ ] `supabase/tests/operation_correlation_verification.sql` lokal nach `db reset`
- [ ] HTTP: `node scripts/verify-operation-header.mjs` nur gegen lokal (mit + ohne Header)
- [ ] Kein Remote-Migration-Apply / kein Function-Deploy ohne Freigabe
- [ ] Altes Frontend ohne Header bleibt kompatibel (`request_id` NULL)

Bei Operation Manager + Catalog (Foundation Wave 2) zusätzlich:

- [ ] Catalog typisiert; keine Fake-Systemschritte in Messages
- [ ] Manager: pending → success|error; Exceptions nicht schlucken
- [ ] Manager ohne React voll funktionsfähig (Singleton)
- [ ] OperationProvider erzeugt keine zweite konkurrierende Instanz
- [ ] Operation-ID Ownership: Manager Einstieg; Transport nur weiterreichen
- [ ] In-memory only (kein DB/localStorage/Realtime)
- [ ] `runtimeErrorId` nur session-ephemer (kein Server-Lookup bis Observatory)
- [ ] `deal.update` Slice über Manager + Wave-1-Header
- [ ] `deal.assign` nur Catalog, nicht als zweite Mutation erzwingen
- [ ] `OperationProvider` in CRM; `useSyncExternalStore` für Listen
- [ ] Retention: success kurz, error länger, pending nie auto-drop
- [ ] Unit-Tests Manager A–M + Snapshot/Timer/Singleton + Wave-1 Regression
- [ ] Keine Feedback-UI / kein Error Observatory in dieser Wave

Bei Error Observatory Core (Foundation Wave 3) zusätzlich:

- [ ] `operation_errors` additiv; getrennt von `audit_events`
- [ ] Keine Client-INSERT; nur `record_operation_error` / `report_operation_error`
- [ ] Actor ausschließlich `safe_auth_uid()` — `operation_id` nie Auth
- [ ] `public_ref` serverseitig UNIQUE (`NORA-E…`)
- [ ] `technical_context` Allowlist; keine Bodies/Secrets/PII
- [ ] Soft resource refs (kein FK auf Business-Tabellen)
- [ ] Dedupe per `operation_id`; neue Attempts unterscheidbar
- [ ] RLS: kein freier Browse; Admin SELECT; Report nur eigener Actor
- [ ] `deal.update` Fehler → best-effort Record in eigener Transaktion
- [ ] Observatory-Ausfall ersetzt Business-Exception nicht
- [ ] `runtimeErrorId` ≠ `persistentErrorId` / `publicErrorRef`
- [ ] `supabase/tests/error_observatory_verification.sql` nach `db reset`
- [ ] Unit-Tests A–H + Kontakttermin-Regression
- [ ] Keine Feedback-UI / keine Outbox / kein Remote-Apply ohne Freigabe

Bei Customer & Contact Workflow Wave (2026-08-25) zusätzlich:

- [ ] `companies.customer_kind` treibt Formularmodus — keine Business-Felder (Branche/Größe/Umsatz/Steuernummer) für `individual`
- [ ] `contacts.is_primary` — max. 1 pro `company_id` (Partial Unique Index bleibt Autorität, nicht nur UI)
- [ ] Kunde+Ansprechpartner-Anlage nur über RPC `create_customer_with_contact` — kein sequentielles Client-Create in `/kunden/create`
- [ ] Hauptansprechpartner-Wechsel nur über RPC `set_primary_contact`
- [ ] `links_jsonb` ersetzt LinkedIn-only-Validierung als UI-Quelle; `linkedin_url`/`website`/`context_links`/`phone_number` bleiben deprecated, nicht gelöscht
- [ ] `companies_summary` / `contacts_summary` Views enthalten die neuen Spalten (sonst sieht Supabase-Mode sie nicht, obwohl die Basistabelle sie hat)
- [ ] FakeRest-Demo nutzt den lifecycle-gewrappten `dataProvider`, nicht `baseDataProvider`, in `createCustomerWithContact`/`setPrimaryContact` (sonst fehlen `first_seen`/`customer_number`/`nb_contacts`-Defaults)
- [ ] `npx supabase db reset --local` nach Migration (nicht in diesem Sandbox-Environment ausführbar — siehe Abschlussbericht)
- [ ] `npm run typecheck` / `npm run build` / `npm run dev:demo` — Kunden-/Privatperson-Anlage manuell im Browser geprüft

Bei Error-Contract-Änderungen (ab Error Contract Wave, 2026-08-28) zusätzlich:

- [ ] Neuer Business-Fehler bekommt einen `NoraErrorCode` in `domain/noraErrorCodes.ts` UND serverseitig `USING DETAIL = 'NORA_<CODE>'` — nicht nur ein neues Regex-Pattern
- [ ] `normalizeCrmError()` bleibt machine-code-first: erkannter Code aus `.details`/explizitem `.code` vor der Regex-Kette
- [ ] Kein `startsWith("NORA_")`-Raten — nur kanonisch gelistete Codes werden akzeptiert
- [ ] Kein neuer generischer `CrmErrorKind`-Business-Zwischenwert (`domain_rejection` o. ä.) — neue Codes gehen direkt auf `messageKey`
- [ ] FakeRest wirft denselben Code über `throwNoraError()` (`.details`), sofern FakeRest den Command-Pfad überhaupt modelliert — sonst als Debt dokumentieren, nicht Scope aufblasen
- [ ] Migration additiv, neue Datei mit neuem Zeitstempel — bereits angewendete Migrationen nie editieren
- [ ] `supabase/schemas/02_functions.sql` synchron nachgezogen
- [ ] `supabase/tests/error_contract_verification.sql` (oder Erweiterung) nach `db reset --local` grün
- [ ] Human Message Independence nachgewiesen, wenn zwei Origins denselben Code liefern (Test mit unterschiedlichem MESSAGE-Text, gleichem DETAIL)
- [ ] `npm run typecheck` / `npm run build` / `npx vitest run`

Bei Notification-/Feedback-Änderungen (ab Phase 7B.4, 2026-08-29) zusätzlich:

- [ ] **Ein Flow gehört genau einer Feedback-Schicht.** Wird ein Flow auf die Notification-Karte migriert, werden seine `notify()`-Aufrufe für dieselbe fachliche Aussage im selben Schritt entfernt — nie Karte *und* Toast nebeneinander
- [ ] sonner bleibt für alle nicht migrierten Flows montiert; keine globale Toast-Bereinigung nebenbei
- [ ] Ein Operation-Slot wird nur registriert, wenn die Operation auch wirklich startet (kein Phantom-Slot → sonst hängt die Karte für immer auf `pending`)
- [ ] Fehler **vor** dem Start einer Operation werden nicht in einen synthetischen `OperationRecord` verwandelt — Feldfehler bleiben inline, alles andere meldet der Aufrufer selbst (`QuickCaptureUnnotifiedError`-Muster)
- [ ] `application/commands/*` importiert weiterhin nichts aus `notifications/` (kein Display Context, kein i18n-Key, kein Tone)
- [ ] Kein zweiter `OperationManager`: der `NotificationProvider` liegt unterhalb des `OperationProvider`
- [ ] Neue sichtbare Texte kommen aus `crm.notifications.*` in **allen** registrierten Katalogen (Deutsch primär, Englisch gepflegt, französische Struktur nicht still brechen)
- [ ] **Supabase- und FakeRest-Pfad haben dieselbe Semantik.** Keine Demo-Sonderlogik. Wo beide Provider denselben Execute-Wrapper benutzen, ist die Parität strukturell; wo ein Provider `manager.execute` selbst inlined, muss sie explizit nachgezogen und getestet werden
- [ ] **Overlay-/Portal-/`z-index`-Verhalten wird in der echten gestylten App abgenommen, nicht nur im Test.** Im Browser-Test-Bundle sind Tailwind-Utilities nicht kompiliert — Aussagen über Geometrie, Sichtbarkeit und Klickbarkeit, die an `@apply`-Klassen hängen (`fixed`, `pointer-events-none`, Abstände), sind dort **nicht** bewiesen und können sogar aus dem falschen Grund grün sein. Belastbar sind im Test nur reine CSS-Deklarationen (`z-index`, `pointer-events` aus eigenen Regeln)
- [ ] Bei kritischen Overlay-Änderungen **echter Hit-Test** (`document.elementFromPoint()` o. ä.) auf jedes betroffene Control der darunterliegenden Oberfläche — „sieht richtig aus" ist kein Nachweis
- [ ] Nach einer finalen UX-Entscheidung werden Design-System-, Decision-Log- und Current-State-Doku **im selben Zug** nachgezogen; überholte Zwischenstände werden als überholt markiert statt gelöscht
- [ ] `npm run typecheck` / `npm run build` / `npx vitest run`
- [ ] **Live-Smoke direkt nach einem Deployment: ein Reload genügt nicht mehr.** Nora ist eine PWA (`vite-plugin-pwa`, `generateSW`) und läuft seit PWA-1B mit `registerType: "prompt"`: ein neuer Service Worker bleibt **WAITING**, bis der Benutzer aktualisiert. Ein bereits installierter Browser zeigt deshalb auch nach beliebig vielen Reloads weiter den **Vorgänger-Build** — das ist gewollt (der Precache des laufenden Builds bleibt intakt), macht aber jeden naiven Smoke-Test wertlos. Um den neuen Build wirklich zu prüfen, eines von beidem: den Update-Hinweis „Jetzt aktualisieren“ auslösen, **oder** in einem frischen Profil bzw. nach `unregister()` des Service Workers testen. Ursache und Reproduktion: siehe `docs/nora/17-known-issues-and-planned-waves.md`, Abschnitt „PWA-Update-Verhalten nach Deployment“. Verlässlicher Nachweis, dass wirklich der neue Build läuft: die Asset-Hashes aus dem live ausgelieferten `index.html` gegen das DOM prüfen bzw. auf einen release-spezifischen Marker im Bundle testen (bestätigt beim Phase-7B-Release 2026-08-30)
- [ ] **PWA-Lifecycle nicht als Business-Operation modellieren.** Ein Update bekommt keine `operationId`, keinen Idempotency-Key, keinen Eintrag im OperationManager und keinen erfundenen `pending/success/error`-Verlauf im Notification-Store. UI konsumiert ausschließlich `usePwaUpdate()` und fasst `navigator.serviceWorker`/Workbox nie direkt an
- [ ] **Eine ausgelöste Anfrage ist kein Erfolgssignal.** Wenn ein Zustand „hat geklappt" behaupten soll, muss dahinter ein reales Ereignis der Plattform stehen — nicht das Resolven eines Promise aus einer Fremdbibliothek. Vor dem Bauen den **ausgelieferten** Code der Bibliothek lesen (`node_modules/<paket>/dist/…`), nicht die README. Konkreter Fall: `updateServiceWorker()` aus `vite-plugin-pwa` resolved immer und sagt nichts über die Worker-Übernahme; das belastbare Signal ist `controllerchange`. Wer auf ein Ausbleiben reagieren will, braucht einen **Watchdog mit gemessener Frist** — und die Frist beginnt beim Auslösen, nicht am Anfang einer vorgelagerten Inszenierung
- [ ] **Große, sich verändernde Flächen bekommen keine Live-Rolle.** `role="status"`/`role="alert"` bringen `aria-atomic="true"` mit: jede Mutation im Teilbaum wird als komplette Wiederholung vorgelesen. Sichtbare Präsentation und Screenreader-Ansage trennen (Muster: `NoraNotificationAnnouncer` in 7B, `UpdateAnnouncer` in der PWA-Schicht) — eine kurze Ansage pro Zustandswechsel, Identität über einen React-Key, kein Whitespace-Trick

Wenn ein Fehler entsteht:

1. Ursache dokumentieren.
2. Keine hektische Komplettumschreibung.
3. Kleine, nachvollziehbare Korrektur.
4. Bestehende Daten nicht unnötig migrieren oder löschen.
