# 17 – Bekannte offene Punkte und geplante Waves

Übersicht: `16-current-state.md`. Dieses Dokument enthält die Details zu offenen Bugs, Live-Feedback und geplanten Domain-Waves. Bitte Status-Tags nicht ohne erneute Code-/Live-Prüfung ändern.

Status-Legende: `OPEN` (bestätigt, nicht behoben) · `NEEDS RE-VERIFICATION` (gemeldet, im aktuellen Code nicht reproduzierbar) · `BUG, Ursache vermutet` · `RESOLVED / VERIFIED` (behoben, mit Test und Live-Prüfung abgesichert) · `VERIFIED NOT REPRODUCIBLE / ALREADY RESOLVED` (Meldung im aktuellen Code/Live nicht reproduzierbar, keine Änderung nötig) · `PLANNED DOMAIN WAVE` · `PLANNED FOLLOW-UP`.

---

## UX-/Domain-Probleme

### 1. Kunden-Autocomplete: „neuen Kunden anlegen" nicht eindeutig als Aktion erkennbar

**Status: RESOLVED / VERIFIED (2026-08-25)**

Betroffen war: `/kontakte/create`, Kunden-Autocomplete-Feld (`AutocompleteCompanyInput.tsx`), über die gemeinsame Basiskomponente `src/components/admin/autocomplete-input.tsx`.

**Ursache:** Die Create-Option wurde im selben `CommandGroup` wie die normalen Sucheergebnisse gerendert, mit demselben (nur leeren) Check-Icon-Platzhalter — visuell nicht von echten Treffern unterscheidbar.

**Fix:**

- `autocomplete-input.tsx`: Die Create-Option wird jetzt in einer eigenen `CommandGroup`, getrennt durch `CommandSeparator`, mit einem `Plus`-Icon statt des (leeren) Such-Checks gerendert. Betrifft generisch jede Autocomplete-Instanz mit `create`/`onCreate` (aktuell nur die Kunden-Suche), keine neue Parallelkomponente.
- Message-Kataloge (`germanCrmMessages.ts`, `englishCrmMessages.ts`, `frenchCrmMessages.ts`): `resources.companies.autocomplete.create_item` zeigt jetzt den Suchtext in einer eindeutigen Aktionsformulierung, z. B. Deutsch: „Neuen Kunden „%{item}" anlegen".
- Tastaturbedienung/Accessibility unverändert (cmdk behandelt mehrere `CommandGroup`s weiterhin als eine durchlaufende Liste; `role="option"` bleibt erhalten).

**Verifiziert:**

- Neuer Test `src/components/atomic-crm/companies/AutocompleteCompanyInput.test.tsx` (2 Tests: Create-Option sichtbar mit erwartetem Label; Auswahl der Create-Option legt den Kunden tatsächlich an und setzt `company_id`).
- Live im Browser auf `/#/kontakte/create`: Eingabe „Traum und Horror UG" zeigt unten in der Liste, abgesetzt durch Trennlinie: „+ Neuen Kunden „Traum und Horror UG" anlegen".

---

### 2. LinkedIn-Feld auf `/kontakte/create`

**Status: VERIFIED NOT REPRODUCIBLE / ALREADY RESOLVED (2026-08-25)**

Live-Feedback 2026-08-25: Trotz des neuen generischen Links-Modells sei auf `/kontakte/create` weiterhin ein sichtbares Feld „LinkedIn-Adresse" vorhanden.

**Code-Prüfung (2026-08-25, nach dem Feedback):** `ContactInputs.tsx` — die einzige Formularkomponente, die von `ContactCreate.tsx`, `ContactCreateSheet.tsx` und `ContactEditSheet.tsx` verwendet wird — enthält **kein** `TextInput source="linkedin_url"` mehr, nur noch `ArrayInput source="links_jsonb"`. Verbleibende `linkedin_url`-Referenzen im Code sind ausschließlich:

- `CompanyAside.tsx`, `ContactPersonalInfo.tsx` — Lese-Fallback für Altdatensätze, deren Migrations-Backfill aus irgendeinem Grund leer blieb, kein Eingabefeld
- `useContactImport.tsx` — CSV-Spaltenname beim Import, kein UI-Formularfeld
- Message-Kataloge — verwaiste `linkedin_url`-Labels für die deprecated DB-Spalte, nicht zwingend im UI gerendert

**Live-Verifikation (2026-08-25, `npm run dev:demo`, `/#/kontakte/create`):** Seite enthält an keiner Stelle den Text „LinkedIn" (per Skript geprüft). Feld war zu diesem Zeitpunkt bereits nicht mehr vorhanden — vermutlich alter Deploy-Stand oder Browser-/Service-Worker-Cache beim ursprünglichen Melder. **Keine Code-Änderung vorgenommen.**

---

### 3. Kunden-Show: Tabs „Änderungsverlauf"/„Kontakte" springen zurück

**Status: RESOLVED / VERIFIED (2026-08-25)**

Live beobachtet 2026-08-25 auf `nora.ergart.de/#/kunden/27/show`: Klick auf Tab „Kontakte" oder „Änderungsverlauf" navigiert kurz, zeigt aber weiterhin den Inhalt des Tabs „Aktivität"; der aktive Tab-Zustand kehrt sichtbar dorthin zurück.

**Root Cause (verifiziert, nicht mehr nur vermutet):** `CompanyShow` wird über `useNoraResourceAliasRoutes` (`routing/NoraResourceAliasRoutes.tsx`) ausschließlich unter der deutschen Alias-Route `kunden/*` → `:id/show/*` gemountet. Dieselbe Routenliste registriert daneben `companies/*` → `<LegacyPathRedirect from="companies">`, das jede `/companies/...`-URL sofort per `<Navigate replace>` auf `/kunden/...` zurückschreibt.

`CompanyShowContent` (`CompanyShow.tsx`) navigierte bei Tab-Wechsel jedoch explizit auf den **englischen, internen** Pfad (`navigate(`/companies/${id}/show/${value}`)`) und ermittelte den aktiven Tab über `useMatch("/companies/:id/show/:tab")`. Der `LegacyPathRedirect`, der für exakt dieselbe Zielroute registriert ist, schrieb die URL sofort auf `/kunden/...` zurück — danach matchte `useMatch("/companies/...")` nicht mehr, `currentTab` fiel auf `"activity"` zurück, obwohl die URL korrekt den Ziel-Tab enthielt. Der Effekt war nur bei Nicht-Standard-Tabs sichtbar, weil der Default-Tab ohnehin `"activity"` ist.

**Fix (`CompanyShow.tsx`):** Navigation und Tab-Erkennung verwenden jetzt ausschließlich den kanonischen deutschen Pfad — `useMatch("/kunden/:id/show/:tab")` und `navigate()` über `noraCreatePath({ resource: "companies", type: "show", id })`. Der `LegacyPathRedirect`-Mechanismus wird für diese interne Navigation nicht mehr durchlaufen; kein Redirect-Suppression-Hack, kein Timing/Delay.

**Weitere Show-Komponenten geprüft:** `ContactShow.tsx` hat keinen `useMatch`-basierten Tab-Mechanismus (kein Bug). `DealShow.tsx` ist dialogbasiert ohne URL-Tab-Routing (kein Bug). Kein weiterer Fix nötig.

**Verifiziert:**

- Neuer Regressionstest `src/components/atomic-crm/companies/CompanyShow.test.tsx` (2 Tests: Kontakte-Tab und Änderungsverlauf-Tab bleiben nach Klick aktiv, geprüft gegen den echten React-Router-Baum via `StoryWrapper`). Test schlägt nachweislich fehl gegen den alten Code (verifiziert per `git stash`) und ist grün gegen den Fix.
- Live im Browser (`npm run dev:demo`, `/#/kunden/1/show`, Kunde „Familie Krüger"): Klick auf „1 Kontakt" → URL wird stabil `#/kunden/1/show/contacts`, Tab bleibt aktiv, kein Rücksprung. Klick auf „Änderungsverlauf" → `#/kunden/1/show/history`, ebenfalls stabil.

---

## Geplante Domain-Waves

### 4. Aufgabenmodell vereinheitlichen (Kunde + Ansprechpartner)

**Status: RESOLVED / VERIFIED (2026-08-25, Unified Tasks Wave) — PRODUCTION VERIFIED seit 2026-08-28**

**Problem war** (Live-Beispiel 2026-08-25): Kunde „Traum und Horror UG" hat Ansprechpartner „Freddie Krüger". Aufgaben zu Freddie erschienen auf der Kontaktakte, aber es gab keine entsprechende kundenbezogene Aufgabenliste auf der Kundenakte — `tasks` hing ausschließlich an `contact_id` (siehe `03-data-model-guardrails.md`, Falle 7 — dort ebenfalls aktualisiert).

**Umgesetzt:** `tasks.company_id` (nullable, historisch stabiler Kundenkontext, serverseitig via Trigger `nora_private.enforce_task_company_context()` abgeleitet/validiert), `tasks.contact_id` jetzt ebenfalls nullable, CHECK-Constraint für „mindestens eines von beiden". „Aufgaben"-Tab auf `/kunden/:id/show`. Vollständige Entscheidung inkl. historischer Semantik: Decision Log „2026-08-25 – Unified Tasks Wave". Migration lokal gegen echtes Postgres verifiziert (`supabase/tests/task_customer_context_verification.sql`), Browser-Szenarien live durchgespielt — siehe dort für Details. Seit dem kontrollierten Release am 2026-08-28 auf `nora-crm-prod` angewendet und read-only nachverifiziert (siehe `16-current-state.md` Abschnitt 6).

---

### 5. Schnellerfassung auf atomare Customer/Contact-Operation umstellen

**Status: RESOLVED / VERIFIED (2026-08-26, Self Contact Wave) — PRODUCTION VERIFIED seit 2026-08-28**

Die Schnellerfassung (`QuickCaptureDialog.tsx`) ruft jetzt den Application Command `createQuickCaptureCase` (`application/commands/createQuickCaptureCase.ts`) auf, der Kunde+Kontakt+Vorgang über die neue RPC `create_quick_capture_case` in einer Transaktion schreibt — kein Teilzustand mehr zwischen diesen dreien. `submitQuickCapture.ts` wurde entfernt. Aufgabe bleibt bewusst ein separater Best-Effort-Schritt danach (bestehende `taskFailed`-Notice-Semantik unverändert). Vollständige Entscheidung: Decision Log „2026-08-26 – Self Contact Wave".

---

### 6. Privatperson/Firma-Unterscheidung in Quick Capture

**Status: PLANNED FOLLOW-UP**

Die Schnellerfassung erzeugt Kunden weiterhin ohne `customer_kind`-Auswahl (Datenbank-Default `business`). Eine „Diese Person ist selbst Ansprechpartner"-Option analog zu `/kunden/create` bzw. dem neuen Kontakt→Kundenakte-Flow ist für Quick Capture **nicht** umgesetzt — bewusst nicht Teil der Self Contact Wave (siehe Decision Log). Bei Bedarf als eigene Folge-Welle zu spezifizieren.

---

### 7. Customer-Archive-/Soft-Delete-Lifecycle

**Status: PLANNED FOLLOW-UP, kein Zeitdruck**

Langfristige Zielrichtung: normales „Kunde löschen" durch einen fachlichen Lifecycle (`ArchiveCustomer`/`RestoreCustomer`, unveränderliche Kundennummer, historische Referenzintegrität) ersetzen. In der Self Contact Wave wurde dafür **nur** die notwendige Self-Contact-Delete-Invariante abgesichert (Löschen des repräsentierenden Kontakts einer Privatkundenakte ist blockiert) — kein vollständiger Archive-Lifecycle gebaut, bewusst außerhalb des Scopes.

---

### 8. Legacy-Spalten-Cleanup

**Status: PLANNED FOLLOW-UP, kein Zeitdruck**

`companies.linkedin_url`, `companies.website`, `companies.context_links`, `companies.phone_number`, `contacts.linkedin_url` sind seit der Customer & Contact Workflow Wave UI-seitig nur noch Lese-Fallback (Bestandsdaten per Migration in `links_jsonb`/`email_jsonb`/`phone_jsonb` kopiert). Entfernen erst nach ausreichender Übergangszeit und Bestätigung, dass keine externen Integrationen (CSV-Import, alte API-Clients) mehr auf die alten Spalten schreiben.

---

### 9a. Error Contract Wave — PRODUCTION VERIFIED

**Status: RESOLVED / VERIFIED (2026-08-28) — PRODUCTION VERIFIED seit 2026-08-28**

Maschinenlesbarer Nora Error Code (`DETAIL = NORA_<CODE>`) für fünf real nachgewiesene Business-Fälle: `NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT`, `NORA_INDIVIDUAL_NAME_REQUIRED`, `NORA_SELF_CONTACT_DELETE_BLOCKED`, `NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS`, `NORA_PERMISSION_DENIED`. Behebt die zuvor dokumentierte Individual-Name-Invariant-Erkennungslücke (fiel bisher auf `unknown`/`crm.errors.load_failed`). Additive Migration `20260828140000_error_contract_wave.sql`, `normalizeCrmError()` ist jetzt machine-code-first mit Legacy-Regex-Fallback. Vollständige Herleitung: Decision Log „2026-08-28 – Error Contract Wave".

**Bewusst nicht in dieser Welle behoben, dokumentierter Follow-up:** FakeRest hat weiterhin keine `can_write()`-Entsprechung — Autorisierung wird im Demo-Modus ausschließlich UI-seitig (`canAccess`) durchgesetzt, nie auf Datenebene. `NORA_PERMISSION_DENIED` ist dadurch in FakeRest strukturell nicht end-to-end testbar (nur gegen echtes Supabase). Eine vollständige FakeRest-Autorisierungs-Parität wäre eine eigene, größere Welle (kleines RBAC-Modell im Demo-Provider) — bewusst nicht in dieser Welle aufgebaut, um den Scope klein zu halten.

**Kontrollierter Production Release (2026-08-28):** Migration `20260828140000_error_contract_wave.sql` (SHA-256 `969768dac028914dd0f4fda3b9953927e5b5104d2cb6231f31387c2f12d30bfa`) gegen `nora-crm-prod` angewendet, Migration-Bookkeeping-Drift (dritte Wiederholung desselben Musters — Anwendungszeitstempel statt Repo-Zeitstempel) erkannt und korrigiert, alle sechs betroffenen Functions read-only vollständig verifiziert (Signatur, Security-Mode, `search_path`, Grants, alle fünf Codes). Commit `dbc41a742f82bdbb0fe734df7d0be33db6a5e35e` nach `origin/main` gepusht, Vercel-Production-Deployment (`dpl_92Y6n2e16R8ZfT1DcUXLrw98Cynh`) verifiziert (READY, korrekter Commit, Alias `nora.ergart.de`). Live-Smoke-Test erfolgreich (Hotboard/Kunden/Kontakte/Vorgänge, Tab-Routing — keine Fehler, keine Testdaten angelegt). Details: Decision Log „2026-08-28 – Error Contract Wave" Nachtrag „Kontrollierter Production Release — PRODUCTION VERIFIED".

---

### 9. Pre-Production Hardening Patch — vollständig nachgeprüft und auf Production released

**Status: PRODUCTION VERIFIED — 2026-08-28**

Die Pre-Production-Hardening-Session (siehe Decision Log) hat verifizierte Bugs behoben (FakeRest-Effective-Contact-Parität, Falsy-ID-Audit, Error Contract für Quick Capture, Individual Name Invariant). Docker wurde in derselben Session gestartet und die volle kanonische RBAC-Testreihenfolge (`07-agent-change-checklist.md`) gegen einen frischen `npx supabase db reset --local` durchlaufen — **alle Tests grün**, inkl. der neuen Domain-Contract-Matrix (Abschnitt 7) und des Individual-Name-Invariant-Negativtests (Abschnitt 4c-ii) in `customer_contact_workflow_verification.sql`, sowie eines neuen empirischen Atomic-Rollback-Tests (Abschnitt 6f). Concurrency wurde bewertet (kein neuer Doppel-Datensatz-Bug; ein bekannter/dokumentierter Idempotency-Gap bleibt bewusst offen für eine spätere Welle).

Eine anschließende Final-Release-Candidate-Verification fand und behob drei weitere Punkte vor dem Release: einen hardcodierten englischen Navigationspfad in `CompanyShow.tsx`, eine Lücke in `normalizeCrmError`s Fehlermuster (FakeRests deutscher Text für die effective-contact-context-Ablehnung wurde nicht erkannt), und — der wichtigste fachliche Fund — die Individual Name Invariant war am CREATE-Pfad von `create_customer_with_contact_core` gar nicht durchgesetzt (nur beim späteren Rename), sodass eine Privatkundenakte mit einem namenlosen Self Contact und einem davon unabhängigen `companies.name` entstehen konnte. Alle drei behoben, mit Regressionstests abgesichert (Decision Log „2026-08-27 – Pre-Production Hardening Patch", Nachtrag „Individual Name Invariant am CREATE-Pfad geschlossen").

**Production-Data-Preflight (read-only, mehrfach wiederholt, zuletzt unmittelbar vor und nach dem Release am 2026-08-28):** 14 Kunden, 0 `individual` → kein Self-Contact-Backfill-Kollisionsrisiko; keine Dubletten/verwaisten FKs/CHECK-Verletzungen gefunden; 2 vorbestehende (nicht durch diesen Patch verursachte) Security-Advisor-Findings zu `SECURITY DEFINER`-Views notiert, unverändert, nicht behoben (außerhalb des Scopes). **Keine Migration-Blocker.**

**Kontrollierter Production Release (2026-08-28):** Migration `20260826120000_self_contact_and_quick_capture_case.sql` (SHA-256 `b747b94d6132b37f41ed82367bcd898db52b07e85dbf2f14c83e8fcdd285c2e7`) gegen `nora-crm-prod` angewendet, Migration-Bookkeeping-Drift (Anwendungszeitstempel statt Repo-Zeitstempel — derselbe Drift-Typ wie am 2026-08-25) erkannt und korrigiert, Schema/Funktionen/Trigger/Grants/View read-only vollständig verifiziert. Commit `0c93912137d610f570b5c5fd449573d25160fe86` nach `origin/main` gepusht, Vercel-Production-Deployment (`dpl_5UL3NL8J2bTwGCAJrobUNZRQ99NB`) verifiziert (READY, korrekter Commit). Live-Smoke-Test gegen `nora.ergart.de` in echter Session erfolgreich (Hotboard/Kunden/Kontakte/Vorgänge, Tab-Routing, Quick Capture, Self-Contact-UI, Firma/Privatperson-Labels — keine Fehler, keine Testdaten angelegt). Details: Decision Log „2026-08-27 – Pre-Production Hardening Patch" und Session-Verlauf.

Release vollständig abgeschlossen — keine offenen Nachprüfungspunkte mehr aus dieser Wave.

## Security Advisor Findings — assessed 2026-08-28

Beide vorbestehenden Supabase Security Advisor ERROR-level Findings (`SECURITY DEFINER`-Views) wurden in einer dedizierten, read-only Session gegen den tatsächlichen `nora-crm-prod`-Katalog (nicht nur den Repo-Stand) untersucht — Definition, Owner, `security_invoker`, Dependency-Baum, Grants (inkl. `anon`/`authenticated`/`service_role`), zugrunde liegende RLS, tatsächliche Consumer und reale Zugriffsszenarien (anon, viewer, office, admin, manipulierter Client). Beide bereits vor der Customer & Contact Workflow Wave vorhanden.

**Wichtig für zukünftige Agenten:** Die Advisor-ERROR-Klassifikation bezieht sich ausschließlich auf den Mechanismus (`SECURITY DEFINER`/`security_invoker=false`), nicht auf einen nachgewiesenen Exploit. Der Advisor ist ein automatisiertes Signal, keine abschließende Risikobewertung — die tatsächliche Einstufung erfolgt anhand von Definition, Grants, RLS, Consumer und exponiertem Datenumfang.

### `public.init_state`

**Status: `ASSESSED — LOW — KEEP`**

- **Zweck:** Pre-Auth-Bootstrap-Check (`getIsInitialized()` in `authProvider.ts`), ob Nora bereits initialisiert wurde — steuert, ob die öffentliche Sign-up-Seite den Erstregistrierungs-Modus anbietet.
- **Security-Semantik:** `security_invoker = off`, Owner `postgres` — bewusster Owner-Privilege-Zugriff auf `public.sales`, weil `anon` unter der normalen `sales`-RLS-Policy (`"Sales select own or admin"`, nur `authenticated` + eigene Zeile/Admin) diesen Bootstrap-Zustand sonst nicht feststellen könnte.
- **Exponierter Datenumfang:** ausschließlich `is_initialized` — faktisch 0/1 (`count(...) from (select ... limit 1) sub`).
- **Nicht exponiert:** keine Mitarbeiteridentität, Rollen, E-Mails, IDs oder sonstige `sales`-Spalten.
- **Wichtige Sicherheitsgrenze:** Die tatsächliche Erstbenutzer-/Admin-Rollenvergabe wird **unabhängig von dieser View** serverseitig und atomar durch `nora_private.resolve_first_signup_role()` (`pg_advisory_xact_lock` + frischer `count(*)`) im `handle_new_user()`-Trigger geprüft — nicht via PostgREST erreichbar. Selbst ein falscher `init_state`-Wert kann keine zusätzliche Admin-Vergabe auslösen.
- **Bewertung:** kein aktueller Privilege-Escalation-Pfad, kein Production-Blocker.
- **Optionales Defense-in-Depth (nicht dringend, kein Security-Fix):** Die View trägt zusätzlich zu `SELECT` auch `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/`REFERENCES`/`TRIGGER`-Grants für `anon`/`authenticated` (`grant all on table public.init_state ...` in `06_grants.sql`) — heute wirkungslos, da die View nicht automatisch updatebar ist (Subquery mit `LIMIT`) und keine `INSTEAD OF`-Trigger existieren. Könnte in einer künftigen, separaten kleinen Migration auf `grant select` reduziert werden.

### `public.sales_directory`

**Status: `ASSESSED — LOW — KEEP`**

- **Zweck:** internes Team-/Assignee-Verzeichnis für Zuständigkeits-Picker (z. B. „Zuständig" an Vorgängen), nutzbar von allen aktiven Rollen inkl. `viewer`/`office`, die laut Rollenmatrix (`11-google-calendar-rbac.md` C.3) Teamlisten lesen dürfen, aber laut `sales`-RLS nur die eigene Zeile sehen.
- **Security-Semantik:** `security_invoker = false`, Owner `postgres` — bewusste, enge Privilegienerweiterung über die strengere `sales`-RLS hinaus.
- **Exponierte Spalten:** `id`, `first_name`, `last_name`, `avatar` — für alle nicht-`disabled` Sales-Zeilen.
- **Nicht exponiert (per View-Kommentar dokumentiert):** `role`, `email`, `user_id`, `administrator`, `disabled`.
- **Zugriff:** kein Tabellen-Grant für `anon` (`revoke all ... from anon`); `SELECT` nur für `authenticated`/`service_role`. Zusätzlich WHERE-Klausel `nora_private.is_active_user()` — SECURITY DEFINER, aber invoker-relativ (liest `auth.uid()` des tatsächlichen Aufrufers, nicht des View-Owners) — EXECUTE ebenfalls nicht an `anon` vergeben.
- **Bewertung:** keine nachgewiesene unautorisierte Datenexposition. Manipulierter authentifizierter Client (jede Rolle) erhält exakt dieselben 4 Spalten wie über die UI — keine Rollen-/Auth-Metadaten erreichbar.
- **Ausdrücklich festgehalten:** `security_invoker = true` ist **nicht** als pauschaler Fix vorgesehen — ein Wechsel würde nicht-Admin-Rollen (`office`/`viewer`) auf die eigene `sales`-Zeile beschränken und damit den dokumentierten Team-Picker funktional brechen (verifiziert gegen die aktuelle `"Sales select own or admin"`-Policy).

### Guardrail für zukünftige Änderungen

Die LOW/KEEP-Bewertung gilt **nur** für die aktuell geprüfte Definition, Projektion und Grants (Stand 2026-08-28, gegen `nora-crm-prod` verifiziert). Eine erneute Security-Bewertung ist zwingend erforderlich, wenn geändert werden:

- die projizierten Spalten einer der beiden Views
- die View-Grants (`anon`/`authenticated`/`service_role`)
- die zugrunde liegende `sales`-RLS
- `nora_private.is_active_user()`
- der Bootstrap-/Sign-up-Auth-Flow
- `nora_private.resolve_first_signup_role()`
- die `security_invoker`-Semantik einer der beiden Views

Für `sales_directory` ausdrücklich: **keine** Erweiterung um `role`, `email`, `user_id`, `administrator` oder sonstige Identity-/Security-Metadaten ohne neue, explizite Security-Entscheidung (Decision Log).

Vollständige technische Herleitung (Dependency-Baum, Grant-Tabellen, Rollen-Szenarien): Session-Assessment 2026-08-28, zusammengefasst in `06-decision-log.md` „2026-08-28 – Intentional privileged read views".

## Residual Security Advisor Follow-ups — assessed 2026-08-28

Die zuvor als `UNASSESSED` geführten Findings wurden in einer Folge-Session (2026-08-28, „Residual Security Advisor Closure", siehe `06-decision-log.md`) read-only gegen `nora-crm-prod` bewertet:

### `public.number_counters`

**Status: `ASSESSED — INFORMATIONAL — KEEP`**

RLS aktiviert, keine Policy — aber kein Tabellen-Grant für `anon`/`authenticated` (auch `service_role` hat nur `REFERENCES`/`TRIGGER`/`TRUNCATE`, kein SELECT/DML). Deny-by-grants unabhängig von RLS. Einzige Consumer: `assign_customer_number()`/`assign_case_number()` (`SECURITY DEFINER`, Owner `postgres`, ausschließlich als BEFORE-INSERT-Trigger auf `companies`/`deals`). Deliberate deny-all-Architektur.

### Ausführbare `SECURITY DEFINER`-Trigger-/Event-Trigger-Functions

**Status: `ASSESSED — INFORMATIONAL — KEEP`**

17 Functions (alle `audit_*`, `handle_new_user`, `handle_update_user`, `assign_case_number`, `assign_customer_number`, `cleanup_note_attachments`, `enforce_google_calendar_connection_rules`, `handle_contact_note_created_or_updated`, `rls_auto_enable`) haben Rückgabetyp `trigger` bzw. `event_trigger` — Postgres verbietet den direkten Aufruf unabhängig von Grants/Rolle, PostgREST exponiert sie nicht als RPC-Endpunkte. Advisor-Falsch-Positiv-Klasse (Lint berücksichtigt keinen Rückgabetyp), kein Exploit.

### Aufrufbare `authenticated`-only `SECURITY DEFINER`-Business-RPCs

**Status: `ASSESSED — KEEP`**

`create_customer_with_contact`, `create_quick_capture_case`, `set_primary_contact`, `set_sales_role_by_admin`, `start_checklist_run_from_template`, `link_google_calendar_event`, `unlink_google_calendar_event`, `get_audit_storage_stats`, `get_entity_audit_events`, `get_global_audit_events`, `record_operation_error`, `report_operation_error`. Keine für `anon` ausführbar; jede prüft serverseitig `can_write()`/`has_role([...])`/`is_admin()`/Actor-Ownership. Kein Authorization-Bug gefunden.

### Search-Path-Schutz (`SECURITY DEFINER` mit `search_path=public`)

**Status: `NO SEARCH PATH SECURITY BLOCKER`**

`CREATE` auf `public`/`pg_catalog`/`nora_private` ist auf Production für keine client-facing Rolle vergeben. Alle `SECURITY DEFINER`-Functions haben explizites `proconfig` (`search_path=''` oder `search_path=public`, eine mit `search_path=pg_catalog`); die neun `search_path=public`-Functions referenzieren intern ausschließlich schema-qualifizierte Objekte, keine Dynamic SQL.

### `auth_leaked_password_protection`

**Status: `RESOLVED — ENABLED` (2026-08-28, Production)**

Über Supabase Dashboard (Authentication → Sign In/Providers → Email → „Prevent use of leaked passwords") aktiviert; kein Management-API-/SQL-Zugriff auf Auth-Config vorhanden, daher gezielte Browser-Interaktion mit Nutzerbestätigung vor dem Speichern. Ausschließlich dieser eine Toggle geändert, alle übrigen Felder im Panel unverändert (per Re-Open verifiziert). `get_advisors` danach erneut abgerufen: WARN verschwunden, alle anderen Findings unverändert.

Vollständige Herleitung: `06-decision-log.md` „2026-08-28 – Residual Security Advisor Closure".

## Operation Manager — pendente Operationen ohne eigenen TTL

**Status: `ASSESSED — LOW — PLANNED FOLLOW-UP`**

`operationManager.ts::enforceCapacity()` eviktiert bei Kapazitätsüberschreitung ausschließlich nicht-pendente (`success`/`error`) Records — pendente Operationen werden nie automatisch entfernt und haben keinen eigenen TTL-/Timeout-Lifecycle. Vorbestehend seit Foundation Wave 2 (Operation Manager Grundgerüst), **nicht** durch die Operation Status Contract Wave v1 (2026-08-29) eingeführt oder verändert. Bewusst kein Fix in dieser oder der Operation Status Contract Wave — kein neuer Lifecycle-Status (z. B. `timed_out`/`cancelled`) ohne reale Semantik/Bedarf eingeführt (siehe `03-data-model-guardrails.md` Grundregel 5). Bei künftigem Bedarf (z. B. hängende Handler, die nie resolven/rejecten) eigene, spätere Welle mit explizitem Timeout-Mechanismus statt stillschweigender Kapazitätslogik.

Bestätigt read-only in der Phase-6D.1-Closure-Verifikation (2026-08-29) — kein neuer RC-Blocker, siehe `06-decision-log.md` Nachtrag „Phase 6D.1".

## Notification-UI — Stand nach Phase 7B.4

Phase 7B.4 (2026-08-29) hat die Notification-Schicht erstmals produktiv montiert, aber bewusst nur für **einen** Flow.

**Abgeschlossen (lokal verifiziert, nicht Production-verifiziert):**

- Quick Capture zeigt genau eine Karte pro Benutzer-Intent (Core + optionale Aufgabe), inkl. pending / success / partial / error.
- `NotificationProvider` unterhalb von `OperationProvider`, `NoraNotificationOutlet` in Desktop- und Mobile-Layout.
- Die vier Quick-Capture-`notify()`-Toasts sind entfernt; sonner bleibt für alle übrigen Flows aktiv.

**Offen, geplant für 7C (nicht Teil von 7B.4):**

- Weitere Intents: `deal.update`, `customer.createWithContact`, `contact.convertToCustomer` — jeweils Policy-Eintrag plus Controller am passenden Aufrufer.
- Isolierter Task-Retry (Core bereits committed, Aufgabe unter eigenem Idempotency-Scope wiederholen). Braucht eine eigene Entscheidung — Retry ist nie allein aus `errorCode` ableitbar.
- Migration der `OPERATION_CATALOG`-Literale, die `DealEdit.tsx` heute als Pseudo-i18n-Key benutzt.

**Offen, 7C Hardening (LOW, aus dem Final Adversarial Review 2026-08-30):**

- **Vorgegebene `operationId` ohne Rückkopplung an die tatsächlich vergebene ID.** `createOperationContext()` verwirft eine ungültige ID und lowercased eine gültige. Der Store meldet den Intent aber unter der *gewünschten* ID an — bei einer ungültigen oder uppercase-UUID wartet die Karte damit auf eine Operation, die es nie geben wird, und bleibt für immer `pending`. **Im ausgelieferten Code nicht erreichbar**, weil `useNotifiedQuickCapture` ausschließlich `createOperationId()` benutzt (immer gültig, immer lowercase). Relevant, sobald ein 7C-Aufrufer IDs aus einer anderen Quelle durchreicht. Kandidat: Registrierung an die Kontext-ID binden oder ungültige Vorgaben hart ablehnen. Siehe `03-data-model-guardrails.md`, Falle 38.
- **`announced`-Set im `NoraNotificationAnnouncer` ist unbegrenzt.** Es merkt sich jede `(notificationId, lifecycle)`-Kombination für die Lebensdauer der Session, um Doppelansagen zu verhindern. Pro Benutzeraktion sind das wenige Einträge, es gibt keinen realen Druck — nur anfassen, falls die Notification-Schicht auf viele Flows ausgeweitet wird.

**Offen, 7C UX-Polish (LOW, aus der 7B.4a–7B.4c-Abnahme):**

- **Langer Vorgangstitel verdrängt den Kundennamen.** Die Kontextzeile ist auf zwei Zeilen begrenzt (vertragskonform); bei einem sehr langen Titel wird dafür der Kundenname abgeschnitten („… für Immobilienverwaltung…“). Gerade der Kunde unterscheidet aber zwei ähnliche Karten. Kandidat: Kunde gegenüber dem Titel priorisieren, wenn beide nicht passen. Kein Release-Blocker.
- **Hover-Pause bei offenem Dialog.** Bewusster Preis der Click-through-Garantie (7B.4c): solange ein Dialog offen ist, pausiert Hover die Auto-Ausblendung nicht. Nur relevant für Success/Partial, die ohnehin von selbst gehen; Fehler bleiben stehen. Nur anfassen, falls es sich real störend zeigt.
- **Ein Schritt-Tab kann bei offenem Quick-Capture-Dialog visuell überlagert werden** (Desktop, schmale Viewports). Funktional folgenlos — die Karte ist click-through, und „Zurück“/„Weiter“ decken dieselbe Navigation ab.

Erledigt und damit geschlossen: die Desktop-Überlappung des Dialog-Footers und die auf Mobile hinter dem Dialog wartende Karte — beide durch das modal-aware Placement in 7B.4c behoben (gemessen: kein Dialog-Control mehr blockiert; im Final Review bei 1212 px unabhängig bestätigt, 0 von 14 Controls blockiert).

**Beobachtet, bewusst NICHT als Follow-up geöffnet:**

- **`drawer-content` (vaul) ist von der modal-aware Regel nicht erfasst** — nur `dialog-content` und `sheet-content` sind es. Aktuell existiert kein Nora-Flow, in dem eine Statusmeldung mit einem Drawer kollidiert (Drawer wird nur in `admin/breadcrumb.tsx` benutzt, ohne Aktionsleiste). Erst relevant, wenn ein Drawer eigene Primäraktionen bekommt.
- **Nicht Phase-7B-verursacht** und daher hier nur benannt, nicht als Notification-Schuld geführt: eine Prettier-Formatdrift in `providers/fakerest/dataProvider.ts` (besteht schon vor 7B), die Radix-Warnung `Missing Description or aria-describedby for DialogContent`, die `react-refresh`-ESLint-Warnung bei Provider-Dateien (gleiches Muster wie `OperationProvider`), sowie ein einmalig im Demo-Modus beobachtetes Redirect-Race nach Quick Capture (FakeRest liefert die frisch erzeugte Deal-ID noch nicht lesbar zurück → Legacy-sonner „Der Eintrag existiert nicht"). Letzteres betrifft den unveränderten Redirect-Pfad, nicht die Notification-Schicht.

**Offen, Phase 8 oder später:**

- Sichtbare IT-Eskalation (`canEscalateToIT` / `publicErrorRef` existieren im Contract, werden nicht gerendert — es fehlt der auswertende Incident-Workflow, nicht die Technik).
- Persistente Notification-History, Notification-Sidebar, Browser-Push.
- Ablösung von sonner. Bis dahin existieren bewusst zwei Feedback-Schichten nebeneinander; jeder Flow gehört genau einer davon.

**Bekannte, akzeptierte Eigenschaften:**

- Eine `pending`-Karte lässt sich schließen. Das blendet nur aus und bricht die Operation nicht ab (die Operation hat weiterhin keinen eigenen Timeout-Lifecycle, siehe Abschnitt „Operation Manager — pendente Operationen ohne eigenen TTL“).
- `retentionSoftCap` ist kein hartes Limit: gleichzeitig laufende Intents können ihn überschreiten, weil `pending` nie verdrängt wird. Hart begrenzt ist nur die Anzahl gleichzeitig sichtbarer Karten.

## Bekannte, nicht in dieser Wave untersuchte Themen

Aus einer früheren Analyse vor der Customer & Contact Workflow Wave als „bekannt, nicht Kern des Auftrags" benannt, hier zur Vollständigkeit aufgeführt — **nicht in dieser Session verifiziert oder detailliert**, vor Bearbeitung gegen aktuellen Code/Produktion neu prüfen:

- Offene Selbstregistrierung
- Attachment-Bucket-Konfiguration
- Nicht deployte Edge Functions
- Rollen-Cache-Verhalten
- Audit-Retention-/Löschstrategie

Diese Liste ist bewusst knapp gehalten, da keine Detailanalyse aus dieser Session vorliegt, die über die Kategorienamen hinausgeht.
