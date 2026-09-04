# 07 – Agent Change Checklist

Status: CURRENT · Zweck: AUSFÜHRUNGS- UND RELEASE-SICHERHEIT · Zuletzt geprüft: 2026-09-04

Aufbau: **KRITISCH** gilt für jede Änderung. **WICHTIG** gilt, sobald der genannte Bereich berührt wird. **REFERENZ** sind Testrezepte je Subsystem. Rechtemodell und Datenfallen stehen in `03`, Architektur in `15`.

## Release-Status-Glossar

Genau diese Begriffe, keine Synonyme. Ein Agent darf höchstens `DEPLOYED` bzw. `PRODUCTION VERIFIED` feststellen; `PO UX ACCEPTED` erklärt nur der Product Owner.

| Status | Bedeutung |
|---|---|
| `LOCAL VERIFIED` | Alle Gates (Lint, Prettier, Typecheck, Vitest, Build, bei DB-Änderung `db reset` + SQL-Tests) sind lokal grün; bei UI zusätzlich im gestylten Browser geprüft. Nichts gepusht |
| `RC VERIFIED` | Ein eingefrorener Release Candidate (Commit-SHA, bei Migration zusätzlich SHA-256 der Migrationsdatei) hat einen unabhängigen Review ohne offene BLOCKER/HIGH bestanden |
| `DEPLOYED` | Der Commit ist auf `origin/main`, das Vercel-Production-Deployment ist READY auf exakt diesem SHA, bei DB-Änderung ist die Migration in `nora-crm-prod` angewendet und das Bookkeeping stimmt |
| `PRODUCTION VERIFIED` | `DEPLOYED` plus nicht-schreibender Live-Nachweis gegen `nora.ergart.de` mit dem **neuen** Build (PWA-Regel unten), plus read-only DB-Nachverifikation, wenn die Welle Schema, RPCs oder Grants berührt hat |
| `RELEASE COMPLETE` | `PRODUCTION VERIFIED` und Abschnitt 1 in `16` sowie der Status in `06`/`17` sind nachgezogen |
| `PO UX ACCEPTED` | Orthogonal: sichtbare Abnahme durch den Product Owner. Technische Nachweise ersetzen sie nie |

Veraltete Schreibweisen (`LOCAL RC APPROVED`, `READY FOR PRODUCT OWNER REVIEW`, `TECHNICALLY APPROVED — FREEZE`, `PHASE … COMPLETE`, `PRODUCTION BASELINE`) in älteren Decision-Log-Einträgen sind historisch und werden nicht neu verwendet.

## KRITISCH — bei jeder Änderung

Vorher:

- [ ] `AGENTS.md`, `00`, `16` gelesen; aufgabenspezifische Dokumente nach `AGENTS.md` Abschnitt D
- [ ] Ziel und Scope klar; unabhängige Themen nicht vermischt
- [ ] geprüft: nur UI/Label? Konfiguration? Demo-Daten? Supabase-Tabellen/Migration? `localStorage`? Entsteht doppelte Datenhaltung?
- [ ] keine Migration ohne belegten Bedarf und Decision-Log-Eintrag; keine Resource-Namen umbenannt; kein `dist/` bearbeitet
- [ ] Arbeit in isoliertem Worktree/Branch; dirty `main`, Stashes und `.cursor/mcp.json` unangetastet

Während:

- [ ] sichtbare Texte deutsch, keine Denglisch-Begriffe; neue Keys in DE und EN gepflegt, FR-Struktur mitgeführt (`04`)
- [ ] Nora-Brandfarbe und Tokens zentral genutzt (`02`)
- [ ] keine zweite Implementierung einer bestehenden Regel (Effective Contact, Nummern, Audit, Feedback-Schicht)

Nachher:

- [ ] `npm run lint`, `npm run prettier`, `npm run typecheck`, `npx vitest run`, `npm run build`, `node ./scripts/check-bundle-budget.mjs`
- [ ] bei UI: `npm run dev:demo`, betroffene Seiten in Hell/Dunkel, 125 %/150 % Zoom, Mobile
- [ ] bei DB: `npx supabase db reset --local` + betroffene `supabase/tests/*.sql` (Reihenfolge unter REFERENZ)
- [ ] Decision Log ergänzt, falls fachliche/architektonische Entscheidung (Titel auch im Index von `06`)
- [ ] `16` Abschnitt 1 nur nach einem Release aktualisiert; Statuswörter nur laut Glossar
- [ ] Commit-Nachricht klar; kein Push ohne PO-Freigabe

Wenn ein Fehler entsteht: Ursache dokumentieren, kleine nachvollziehbare Korrektur, keine hektische Komplettumschreibung, keine unnötige Migration oder Löschung von Bestandsdaten.

## WICHTIG — Production-Datenbank und Release

Bei jedem `apply_migration` oder SQL-Write gegen `nora-crm-prod` (Supabase MCP):

- [ ] Ausdrückliche PO-Freigabe in dieser Session
- [ ] Zielprojekt vor **jedem** Write per `list_projects` gegen Name **und** Ref (`kixxroxtfzbcbzctohex`) bestätigt
- [ ] Sofort nach dem Apply `list_migrations` prüfen: Zeitstempel-Präfix muss exakt dem lokalen Dateinamen entsprechen. `apply_migration` hat wiederholt den Anwendungszeitstempel eingetragen
- [ ] Bei Drift: read-only verifizieren, dass die Zeile eindeutig zur gerade angewendeten Migration gehört (Name + `statements`), dann transaktional genau eine Zeile korrigieren, danach erneut read-only bestätigen (1:1 mit dem Repo, keine andere Zeile verändert)
- [ ] Reihenfolge bei schemaabhängigen Wellen: RC einfrieren (Commit-SHA + Migration-SHA-256 aus dem Git-Blob, nicht aus dem CRLF-Arbeitsbaum) → Production-DB-Migration → DB-Verifikation → Git Push → automatisches Vercel-Deployment → Live-Smoke. **Nie** Push zuerst
- [ ] Business-Zählstände vor/nach Apply unverändert; keine Testdaten in Produktion

Live-Smoke nach einem Deployment:

- [ ] **Ein Reload genügt nicht.** Nora läuft mit `registerType: "prompt"`; ein neuer Service Worker bleibt WAITING, ein installierter Browser zeigt nach beliebig vielen Reloads den Vorgänger-Build. Entweder „Jetzt aktualisieren" auslösen oder in frischem Profil bzw. nach `unregister()` testen. Nachweis des neuen Builds: Asset-Hashes aus dem live ausgelieferten `index.html` gegen das DOM prüfen oder ein release-spezifisches Merkmal im Bundle
- [ ] Nur nicht-schreibende Prüfung (Hotboard, Listen, Akten, Dialoge öffnen/schließen). Kein Schreib-Smoke ohne freigegebenen Testpfad

## WICHTIG — SECURITY DEFINER, RLS, Grants

- [ ] Zugriffsmatrix geprüft: `anon`, `authenticated viewer`, `authenticated office`, `authenticated admin`, `service_role`
- [ ] UI nie als Security Boundary; Prüfung gegen Grants/RLS/Function-Body
- [ ] `search_path = ''` oder vollständig schema-qualifiziert; bei nicht-leerem `search_path` vorher prüfen, dass keine client-facing Rolle `CREATE` auf `public` hat
- [ ] `nora_private` bleibt außerhalb der PostgREST-Schemas (`config.toml`); `nora_role_manager`, `nora_audit_writer`, `nora_calendar_linker` NOLOGIN, keine Mitgliedschaft für `authenticated`
- [ ] `init_state` / `sales_directory`: Bewertung in `17` gilt nur für die dort geprüfte Projektion und Grants — bei Änderung neu bewerten
- [ ] Teamlisten nutzen `sales_directory`, nicht `sales`; keine GUC-Token-Modelle (`nora.allow_sales_privilege_change`, `nora.privilege_rpc_token`, `nora.calendar_link_update`) wieder einführen
- [ ] `canAccess.ts` spiegelt die Matrix; DB bleibt autoritativ
- [ ] Kein Remote-Migration-Apply, kein Function-Deploy ohne Freigabe

## WICHTIG — Error Contract

- [ ] Neuer Business-Fehler bekommt einen `NoraErrorCode` in `domain/noraErrorCodes.ts` **und** serverseitig `USING DETAIL = 'NORA_<CODE>'` — nie nur ein Regex-Pattern
- [ ] `normalizeCrmError()` bleibt machine-code-first; kein `startsWith("NORA_")`-Raten; kein neuer generischer `CrmErrorKind`
- [ ] FakeRest wirft denselben Code über `throwNoraError()`, sofern der Pfad dort modelliert ist — sonst als Debt in `17`
- [ ] Migration additiv; `supabase/schemas/02_functions.sql` synchron; `supabase/tests/error_contract_verification.sql` grün
- [ ] Human Message Independence: zwei Origins, gleicher `DETAIL`, unterschiedliche `MESSAGE`

## WICHTIG — Operationen, Idempotency, Notifications

- [ ] Operation-ID: Einstieg mintet einmal; Transport überschreibt gültige IDs nicht; `operation_id` nie Auth, nie Geschäftslogik
- [ ] `operation_id ≠ idempotency_key`; Idempotency nur über RPC-Parameter, Lock zuerst → Write → Persist in derselben Transaktion
- [ ] `OperationStatus` bleibt `pending | success | error`; Presentation erfindet keinen Lifecycle (`03` Falle 37)
- [ ] Ein Flow gehört genau einer Feedback-Schicht: Karte **oder** sonner, nie beide; sonner bleibt für nicht migrierte Flows
- [ ] Operation-Slot nur registrieren, wenn die Operation wirklich startet; Fehler vor dem Start nicht in synthetische Records verwandeln (`QuickCaptureUnnotifiedError`-Muster)
- [ ] `application/commands/*` importiert nichts aus `notifications/`; `NotificationProvider` liegt unter `OperationProvider`, kein zweiter Manager
- [ ] Supabase- und FakeRest-Pfad gleiche Semantik; Texte aus `crm.notifications.*` in allen Katalogen
- [ ] Overlay-/`z-index`-Verhalten im gestylten Browser abnehmen, nicht nur im Test; bei kritischen Overlays echter Hit-Test (`document.elementFromPoint()`) auf jedes betroffene Control

## WICHTIG — PWA

- [ ] PWA-Lifecycle ist keine Business-Operation: keine `operationId`, kein Idempotency-Key, kein Eintrag im Operation-/Notification-Store. UI konsumiert nur `usePwaUpdate()`
- [ ] Eine ausgelöste Anfrage ist kein Erfolgssignal; belastbar ist `controllerchange`. Ausgelieferten Bibliothekscode (`node_modules/<paket>/dist/…`) lesen, nicht die README. Fristen beginnen beim Auslösen, nicht bei einer vorgelagerten Inszenierung
- [ ] Große, sich verändernde Flächen bekommen keine Live-Rolle; Ansage getrennt über einen `sr-only`-Announcer (eine Ansage pro Zustandswechsel, Identität per React-Key)
- [ ] `registerType: "prompt"` und der intakte Precache des laufenden Builds sind Produktionsvoraussetzung (kein `clients.claim()`); Vercel liefert `/assets/*` nicht `immutable`

## WICHTIG — Routing, i18n, Views

- [ ] Interne Navigation, `useMatch` und Redirect-Ziele über `noraCreatePath()`; englische Pfade nur als Legacy-Eingang; `LegacyPathRedirect` nicht entfernen
- [ ] Neue View-Spalten in `companies_summary` / `contacts_summary` **ans Ende** anhängen (`create or replace view` erlaubt kein Einfügen)
- [ ] Französischer Katalog: neue Keys mitführen, nie teilweise entfernen (`04`)

## REFERENZ — Testreihenfolgen und Subsystem-Rezepte

Kanonische SQL-Testsequenz nach `npx supabase db reset --local` (Docker-Container `supabase_db_atomic-crm-demo`):

```
rbac_rls_production_check → rbac_rls_first_admin_parallel → rbac_rls_setup → rbac_rls_matrix
→ rbac_rls_final_hardening → checklists_audit_verification → crm_audit_verification
→ google_calendar_verification → (wellenspezifische *_verification.sql)
→ rbac_rls_teardown → rbac_rls_production_check
```

- Matrix läuft als `postgres` mit `SET LOCAL ROLE nora_rls_test`; die Testrolle existiert nur über `rbac_rls_setup.sql`, nie in Migrationen, kein Passwort in Git
- Windows: `rbac_rls_first_admin_parallel_runner.ps1` scheitert an einer Vorbedingungs-Regex trotz `count=0`. Workaround: die enthaltene SQL (zwei parallele `docker exec … psql`-Sessions gegen `auth.users`, danach „exakt 1 admin + 1 viewer", Cleanup) manuell nachbilden; das Skript nicht nebenbei patchen

Nummern (`customer_number` / `case_number`):

- [ ] NULL/Duplikat/Format-Check; `UPDATE` muss mit „is immutable" fehlschlagen; `INSERT` mit Fake-Nummer wird überschrieben; `next_*`/`format_*` nicht für `anon`/`authenticated` ausführbar; keine zweite Nummernlogik in Demo/CSV/UI (`08`)

Checklisten / Audit (`10`, `13`):

- [ ] relationale Tabellen, kein JSONB-only; `label_snapshot` an Run-Items; Vorlagen/Snippets `is_active = false` statt DELETE; `service_area_code` ≠ `company_id`
- [ ] Run-Start nur über `start_checklist_run_from_template`; Demo-Hinweis bei `VITE_IS_DEMO`
- [ ] `audit_events` append-only: kein Client-INSERT, Schreibweg nur Trigger + `nora_audit_writer`; Office nur `get_entity_audit_events`, Viewer nichts; neue Trigger schreiben `deal.status_changed` (Legacy `deal.stage_changed` bleibt lesbar); UI ohne rohe JSON-Dumps
- [ ] Tests: `checklists_audit_verification.sql`, `crm_audit_verification.sql`, `rbac_rls_matrix.sql`, `auditUx.test.ts`

Google Kalender (`11`, `14`):

- [ ] Keine parallele Benutzertabelle; kein zweites Terminsystem (`appointments`); Google = System of Record, Nora = Cache + Verknüpfung
- [ ] Keine iCal-Adresse; keine Tokens in Frontend, Audit oder Data-API-Tabellen; keine `GOOGLE_*`-Secrets in `VITE_*`; Kalender-ID nicht in Komponenten
- [ ] `origin = google` read-only; Scopes minimal; `service_role` nie im Browser; Google-Labels/Freigaben nicht über Nora ändern
- [ ] Edge Functions ohne Credentials liefern 501/503, kein Fake-Erfolg; Demo zeigt Hinweis ohne OAuth; Schema-Dateien `01_tables` … `06_grants` mit Migration synchron
- [ ] `google_calendar_verification.sql` in der Sequenz nach `crm_audit`

Rollenbewusste UX (`02`, `12`):

- [ ] Schreib-/Löschaktionen über `NoraAccessActions` / `CanAccess`; `NoraReadOnlyBanner` für Viewer; Office: Archivieren sichtbar, Delete ausgeblendet; `NoraAccessGuard` auf Edit-/Create-Routen; Import nur Admin
- [ ] Dirty-Dialoge: X/Escape bestätigen, Außenklick blockiert; Quick-Capture-Draft bleibt bei Abbrechen; `DemoRoleSwitcher` nur bei `VITE_IS_DEMO=true`; `demoSession.ts` einzige Demo-Session-Quelle
- [ ] Tests: `noraRbacUx.test.ts`, `noraV03k1Ux.test.ts`, `demoRoleSimulation.test.ts`

Operation Correlation / Manager / Error Observatory (`15`):

- [ ] `nora_private.current_operation_id()` INVOKER, nur UUID oder NULL; `audit_events.request_id` über den zentralen Writer, partial Index nicht unique; altes Frontend ohne Header bleibt kompatibel
- [ ] Manager ohne React funktionsfähig (Singleton), `OperationProvider` erzeugt keine zweite Instanz; in-memory only; Retention success kurz, error länger, pending nie auto-drop
- [ ] `operation_errors` additiv, getrennt von `audit_events`; Writes nur über `record_operation_error` / `report_operation_error`; Actor nur `safe_auth_uid()`; `public_ref` serverseitig UNIQUE (`NORA-E…`); `technical_context` Allowlist ohne Bodies/Secrets/PII; Soft-Refs ohne FK auf Business-Tabellen
- [ ] Tests: `operation_correlation_verification.sql`, `error_observatory_verification.sql`, `operation_status_disposition_verification.sql`; HTTP-Diagnose `node scripts/verify-operation-header.mjs` nur lokal

Customer & Contact Workflow (`01`, `03`):

- [ ] `customer_kind` treibt den Formularmodus; keine Business-Felder für `individual`; `contacts.is_primary` max. 1 pro `company_id` (Partial Unique Index ist Autorität)
- [ ] Kunde+Ansprechpartner nur über `create_customer_with_contact`, Wechsel nur über `set_primary_contact`; `links_jsonb` statt LinkedIn-Sonderfall; Legacy-Spalten bleiben
- [ ] FakeRest nutzt den lifecycle-gewrappten `dataProvider`, nicht `baseDataProvider`, für `createCustomerWithContact` / `setPrimaryContact`
- [ ] Tests: `customer_contact_workflow_verification.sql`, `task_customer_context_verification.sql`
