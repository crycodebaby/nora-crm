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

### 3a. Kundenanlage — Findings aus der Customer Create Speed & Clarity Wave (2026-09-01)

**Umgesetzt (RC, siehe Decision Log „2026-09-01 – Customer Create Speed & Clarity"):** Land auf `/kunden/create` ausgeblendet und als `"Deutschland"` gesetzt, Bundesland-Default `"NRW"`, „Weitere Angaben" eingeklappt, PLZ | Ort in einer Zeile. Folgende Punkte wurden dabei beobachtet, aber bewusst **nicht** in dieser Wave behoben:

1. **Produktions-Datenhygiene `companies.country` (LOW, Daten, kein Code):** Bestand enthält `"Deutschland "` (4×, Leerzeichen am Ende), `"DE"` (1×) neben `"Deutschland"` (1×) und `NULL` (10×). Neue Kunden erhalten ab jetzt konsistent `"Deutschland"`; ein einmaliges, vom Product Owner freigegebenes Read-Then-Update der 5 abweichenden Bestandswerte wäre sinnvoll (kein Migration-Bedarf, kein Constraint-Wunsch — Freitext bleibt Freitext).
2. **Demo-Seed `state_abbr = "NW"` vs. Produktion/PO `"NRW"` (LOW, Demo-Daten):** `noraDemoSeed.ts` nutzt das ISO-3166-2-Kürzel „NW", alle gepflegten Produktionswerte und der neue Default sagen „NRW". Für Demo-Konsistenz auf „NRW" angleichen (nur Demo-Daten, `05-demo-data-guidelines.md`).
3. **Ansprechpartner-Unterabschnitt auf `/kunden/create` (MEDIUM, UX, Contact-Wave):** Bei „Neuer Ansprechpartner" trägt die E-Mail-Liste das Label „Persönliche Angaben" (`resources.contacts.field_categories.personal_info`), Telefon- und Link-Listen sind gar nicht beschriftet — drei unbeschriftete ⊕-Buttons untereinander. Gehört in eine Contact-Wave (`CustomerContactCaptureInputs.tsx`), analog zu den beschreibenden Add-Buttons der Kontakterstellung („Weitere Telefonnummer hinzufügen").
4. **Privatperson: Namensfelder stehen ganz unten (MEDIUM, UX):** Für `customer_kind = individual` ist Vor-/Nachname das wichtigste Feld (Kundenname wird daraus abgeleitet), steht aber unter Kontakt/Adresse. Ein Slot in `CompanyInputs` (Person direkt unter der Kundenart) wäre der saubere Fix — strukturelle Änderung, daher hier nur empfohlen.
5. **Leerer rechter Rand auf `/kunden/create` (LOW, Layout):** `lg:mr-72` reserviert Platz für ein Aside, das es im Create-Flow nicht gibt. Beim Entfernen würde das Formular sehr breit; besser eine bewusste `max-w`-Entscheidung im Rahmen einer Formular-Breiten-Regel im Design System.
6. **E-Mail/Telefon erfordern erst einen ⊕-Klick (LOW, UX, geteiltes Muster):** Auf Create startet jede Liste leer; ein vorbelegter leerer Eintrag (wie in `ContactEdit`) spart einen Klick, betrifft aber das geteilte `ArrayInput`-Muster von Kunden und Kontakten — nicht isoliert für Kunden ändern.

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

Phase 7B.4 (2026-08-29) hat die Notification-Schicht erstmals produktiv montiert, aber bewusst nur für **einen** Flow. Seit dem kontrollierten Release am 2026-08-30 (Commit `9db08c4b`, Vercel READY, `nora.ergart.de`) ist dieser Stand **PRODUCTION VERIFIED** — siehe Decision Log, Nachtrag „Kontrollierter Production Release — PHASE 7B PRODUCTION VERIFIED". Der Release enthielt keine Migration und keine Änderung unter `supabase/`.

**Abgeschlossen (PRODUCTION VERIFIED seit 2026-08-30):**

- Quick Capture zeigt genau eine Karte pro Benutzer-Intent (Core + optionale Aufgabe), inkl. pending / success / partial / error.
- `NotificationProvider` unterhalb von `OperationProvider`, `NoraNotificationOutlet` in Desktop- und Mobile-Layout.
- Die vier Quick-Capture-`notify()`-Toasts sind entfernt; sonner bleibt für alle übrigen Flows aktiv — live bestätigt, sonner ist weiterhin im Production-Bundle enthalten.

**Noch nicht live nachgewiesen (kein Defekt, offener Nachweis):**

- Der echte Live-**Write**-Smoke (Schnellerfassung in Production absenden) wurde nicht durchgeführt, weil es keinen freigegebenen Production-Testdatensatz gibt und dafür echte Geschäftsdaten hätten entstehen müssen. Gedeckt durch Browser-Integrationstests und die lokale UX-Abnahme; die Live-Bestätigung ergibt sich aus der nächsten regulären Nutzeraktion.
- Der PWA-Service-Worker liefert unmittelbar nach jedem Deployment beim ersten Aufruf noch die Assets des Vorgänger-Builds aus und aktualisiert sich erst beim Reload. **Nicht 7B-verursacht**, bestehendes `vite-plugin-pwa`-Verhalten — hier nur festgehalten, damit ein künftiger Release-Smoke nicht versehentlich den alten Build prüft. Ursache seit 2026-08-30 nachgewiesen, siehe „PWA-Update-Verhalten nach Deployment" weiter unten.

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

## PWA-Update-Verhalten nach Deployment — Ursache bewiesen (PWA-1A, 2026-08-30)

**Severity:** MEDIUM (operativ/UX, kein Daten- oder Sicherheitsrisiko; im Deployment-Fenster mit sichtbarem Fehlerpotenzial — siehe Benutzerwirkung)
**Status:** **URSACHE GESCHLOSSEN durch PWA-1B (2026-08-30, lokal implementiert und verifiziert — noch kein Production-Release).** Der Abschnitt bleibt als Ursachen- und Reproduktionsprotokoll stehen. Was sich geändert hat, steht am Ende unter „Behebung (PWA-1B)".

**Symptom:** Nach einem Vercel-Deployment rendert der erste Aufruf noch den Vorgänger-Build. Prüft man die Asset-URLs dieses Aufrufs gegen den Server, liefern sie 404. Ein Reload heilt den Zustand.

**Ursache (nachgewiesen, nicht geraten):** `vite.config.ts` nutzt `VitePWA({ registerType: "autoUpdate" })` ohne `injectRegister`-Angabe. Das hat zwei Konsequenzen, die zusammen das Verhalten erzeugen:

1. Der Plugin erzwingt für diese Kombination `workbox.skipWaiting = true` und `workbox.clientsClaim = true` (`node_modules/vite-plugin-pwa/dist/index.js`, Auflösung von `injectRegister: "auto"`). Der generierte `dist/sw.js` enthält entsprechend `self.skipWaiting()`, `clientsClaim()`, `cleanupOutdatedCaches()` und `NavigationRoute(createHandlerBoundToURL("index.html"))`.
2. Weil **keine** Datei unter `src/` `virtual:pwa-register` importiert, injiziert der Plugin nur das schlanke `dist/registerSW.js`: `navigator.serviceWorker.register('./sw.js', { scope: './' })` — ohne Reload-Logik. Der Reload nach einem Update steckt ausschließlich im virtuellen Client-Modul (`dist/client/build/register.js`: im `autoUpdate`-Zweig `wb.addEventListener("activated", … window.location.reload())`), das Nora nicht lädt.

Das „auto" in `autoUpdate` bezieht sich also nur auf die **Aktivierung des Workers**, nicht auf die **Aktualisierung der laufenden Seite**. Zusätzlich beantwortet die `NavigationRoute` jede Navigation aus dem Precache — der Browser sieht das neue `index.html` erst, nachdem der neue Worker aktiv ist.

**Reproduziert (lokal, zwei aufeinanderfolgende Builds auf demselben Origin, `http://localhost:4177`):**

| Schritt | Beobachtung |
|---|---|
| Build A installiert | SW aktiv, 38 Precache-Einträge, `index-CSEIzXGx.js` |
| Build B „deployed" (Server serviert nur noch B) | alte Asset-URLs liefern am Server 404 |
| Aufruf #1 danach | rendert **Build A** (`index-CSEIzXGx.js`) — Symptom reproduziert |
| Aufruf #2 (Reload) | rendert Build B, Precache enthält A nicht mehr |
| Offener Tab + `registration.update()` | neuer Worker geht ohne `waiting` direkt auf `activated`, ein `controllerchange`, **kein** Reload — die Seite läuft weiter auf A |
| Alte Chunk-URL aus der laufenden A-Seite | `fetch` = 200 (nur wegen HTTP-Cache), mit `cache: "reload"` = **404** |

**Gegen Production nachgemessen (2026-08-30, read-only, `nora.ergart.de`):**

- Der live ausgelieferte `/sw.js` hat exakt dieselbe Struktur wie der lokale Build: `skipWaiting()`, `clientsClaim()`, `cleanupOutdatedCaches()`, `NavigationRoute` auf `index.html`, 38 Precache-Einträge, darunter der gehashte Lazy-Chunk `assets/DealList-CUiVL1zD.js`. Das lokale Reproduktionsmodell entspricht damit dem echten Production-Worker.
- Eine Asset-URL, die nicht zum aktuellen Deployment gehört, liefert einen **harten 404** (`x-vercel-error: NOT_FOUND`), **kein** SPA-Fallback.
- **Wichtig — Annahme widerlegt:** Vercel liefert `/assets/*` hier **nicht** `immutable`, sondern `cache-control: public, max-age=0, must-revalidate` (gemessen an `assets/inter-greek-wght-normal-CkhJZR-_.woff2`). Es gibt keine `vercel.json`, und die automatische Immutable-Regel greift nur bei Framework-erkannten Build-Outputs, nicht bei einem reinen Vite-`dist`. **Der HTTP-Cache ist in Production also kein Schutzschild** — jede Asset-Anfrage revalidiert gegen den Origin und bekommt nach einem Deploy 404.

**Benutzerwirkung:** Zwei Effekte, unterschiedlich schwer.

1. **Sicher und bei jedem Release (gesichert):** der erste Aufruf nach einem Deployment zeigt den Vorgänger-Build. Mitarbeiter arbeiten ohne jedes Signal eine Session lang auf dem alten Stand weiter; ein Release-Smoke misst ohne Reload den falschen Build. Kein Absturz, kein Datenverlust.
2. **Realer Fehlerfall im Deployment-Fenster:** der einzige dynamisch nachgeladene Chunk ist `DealList` (`src/components/atomic-crm/deals/index.ts`, `React.lazy`). Läuft eine Seite noch auf Build A, ist Worker B bereits aktiv (Precache-Eintrag von A nachweislich entfernt) und öffnet der Nutzer *in dieser Sitzung erstmals* die Vorgangsliste, geht die Chunk-Anfrage ins Netz und läuft in einen 404 → `React.lazy` schlägt fehl, die Vorgangsliste rendert nicht. Weil Production **nicht** `immutable` ausliefert, fängt der HTTP-Cache das anders als im lokalen Versuch **nicht** verlässlich ab. Heilt durch Reload, ist aber ein sichtbarer Defekt und keine reine Messartefakt-Frage.

Der Fehlerfall wurde in dieser Session **nicht** live in Production ausgelöst (das hätte ein zusätzliches Production-Deployment erfordert). Nachgewiesen sind alle vier Einzelbedingungen: Precache-Eviction (lokal reproduziert), fehlender Reload (lokal reproduziert), harter 404 auf nicht mehr existente Asset-URLs (Production gemessen), fehlender `immutable`-Schutz (Production gemessen).

**Nicht die Ursache** (geprüft und ausgeschlossen): fehlendes `cleanupOutdatedCaches` (ist aktiv), `base: "./"`/Scope (HashRouter, Dokument-URL immer Root), Phase 7B.

### Behebung (PWA-1B, 2026-08-30) — lokal verifiziert, noch nicht deployed

`registerType: "prompt"` + explizit geladenes `virtual:pwa-register`. Der neue Worker bleibt WAITING, bis der Benutzer aktualisiert; der Precache des laufenden Builds bleibt damit vollständig. Details und Begründung: `06-decision-log.md`, „2026-08-30 – PWA-Update: wartender Worker statt automatischer Übernahme (PWA-1B)".

**Am generierten Build bewiesen:** `dist/sw.js` enthält jetzt `self.addEventListener("message", … "SKIP_WAITING" … self.skipWaiting())` statt eines top-level `self.skipWaiting()`; `clientsClaim()` ist verschwunden; `registerSW.js` wird nicht mehr injiziert.

**Am Zwei-Build-Test bewiesen** (Build A installiert → Build B deployed, alte Chunk-URL am Server 404):

| Beobachtung | vorher (`autoUpdate`) | nachher (`prompt`) |
|---|---|---|
| Neuer Worker | sofort `activated` | **`waiting`/`installed`** |
| Laufende Seite | wird stillschweigend übernommen | bleibt unangetastet auf Build A |
| Precache | A wird beim Aktivieren geräumt (38 Einträge, nur B) | **A und B koexistieren (42 Einträge)** |
| `DealList`-Chunk A, HTTP-Cache umgangen | 404 | **200 aus dem Precache** |
| Dynamischer Import von Chunk A | schlägt fehl | **erfolgreich** |
| Nach „Jetzt aktualisieren" | — | Worker B aktiv, Reload, Build B, Precache wieder 38 Einträge, A sauber entfernt |

**Verbleibendes Risiko:** aktualisiert ein Benutzer in einem Tab, laden alle anderen offenen Nora-Tabs ebenfalls neu (gemessen). Sie landen sauber auf dem neuen Build — der ursprüngliche Fehler wird also nicht auf den zweiten Tab verschoben —, aber ungespeicherte Eingaben in einem zweiten Tab gehen verloren. Bewusst offen für PWA-1C.

### PWA-1C — Update-Experience (2026-08-30): `LOCAL VERIFIED` (UX-Abnahme inzwischen erteilt, siehe Nachtrag PWA-1C.2)

Der Platzhalter aus PWA-1B ist durch ein **Anwendungs-Systemereignis** ersetzt: eigener Layer `z-70`, prominentes nicht-modales Panel (`pwa/NoraUpdateEvent.tsx`), eigenes organisches Update-Motiv (`pwa/NoraUpdateOrb.tsx`, reines CSS), und **bei offenem Dialog/Sheet gar nicht sichtbar**. „Später" verschiebt um 2 Stunden. Die Lifecycle-Logik wurde nicht angefasst — nur die Wiederanzeige-Konstante. Details: `02-design-system.md` („Anwendungs-Systemereignisse / Update-Experience") und `06-decision-log.md` („2026-08-30 – Update-Experience als Anwendungs-Systemereignis (PWA-1C)").

**In der gestylten App nachgemessen:** Layer `z-index: 70`; Panel `top: 5rem` (Desktop) räumt den 46 px hohen Header inkl. globaler Suche und „Schnellerfassung" frei — **kein persistentes Bedienelement wird verdeckt** (bei `top: 1.5rem` waren es zwei); alle 84 Hit-Test-Punkte im Panel erreichen das Panel; bei offener Schnellerfassung `display: none`, Fläche 0, nicht fokussierbar, danach wieder sichtbar; Kontrast hell 4,74–19,8 / dunkel 6,94–17,2; Touch-Ziele 44 px (Desktop) bzw. 47 px (Mobile); Mobile 500×615 ohne Overflow und frei von der `MobileNavigation`.

**Zwei echte Befunde, die erst der Lauf in der echten App zeigte** — beide behoben: das Panel verdeckte in der ersten Fassung Header-Controls, und das Update-Motiv zerfiel bei `prefers-reduced-motion: reduce` zu Rechtecken, weil seine Rundung nur aus Keyframes kam.

**Offen und bewusst nicht entschieden:** die Designqualität selbst. Automatische Tests belegen Zustände, Semantik, Accessibility-Verdrahtung und Aktionen; „fühlt sich hochwertig an" kann nur der Product Owner abnehmen. Ebenfalls offen: das Mehr-Tab-Verhalten aus PWA-1B (andere Tabs laden beim Aktualisieren ebenfalls neu) — bewusst ohne Nutzer-Copy und ohne Cross-Tab-Architektur belassen.

**Kein Production-Release.** Nächste Schritte: Product-Owner-UX-Abnahme → Final Review → RC Freeze → kontrollierter Production Release.

### Nachtrag PWA-1C.1 (2026-08-30): visuelle Ablehnung und Neufassung

Die visuelle Fassung aus PWA-1C wurde vom Product Owner **nicht abgenommen** (generisch, zu sehr nach Standard-UI). PWA-1C.1 ist die daraus folgende reine Art-Direction-/Motion-Welle: Orb-zentrierte Komposition, mehrschichtiger Orb, Warnsymbol des Product Owners, 8-Sekunden-Choreografie, Recovery-Zustand. Kein Eingriff in Service-Worker-Lifecycle, Store, Build-Konfiguration oder Datenbank. Details: `06-decision-log.md`, „2026-08-30 – Premium Update Experience und 8-Sekunden-Choreografie (PWA-1C.1)".

**Diese visuelle Fassung ist inzwischen vom Product Owner abgenommen.** Orb, Aura, Warnsymbol, Panelkomposition, Timeline und Art Direction gelten damit als fixiert und wurden in PWA-1C.2 nicht mehr angefasst.

**Vier echte Befunde, die erst die Messung in der gestylten App zeigte** — alle behoben:

1. Der Orb las sich als **Zielscheibe**: drei konzentrische Kreise durch Zweistopp-Verläufe mit linearem Abfall, einen konturierten zentrierten Kern und eine flach gefüllte Innenform.
2. Bei **150 % Browser-Zoom** (960×600 CSS-Pixel) lief die Komposition 50 px unter den Fensterrand — „Jetzt aktualisieren" war unerreichbar. Behoben über höhenbasierte Regeln; Browser-Zoom verkleinert den Viewport in beiden Achsen, und Höhe ist die Achse, die diese Komposition verbraucht.
3. `overflow: hidden auto` machte die **Aura zu scrollbarer Fläche**: dauerhafte Scrollleiste am Panel, 17 px Inhaltsbreite verloren, Komposition aus der Mitte gezogen.
4. Der **Titeltext wechselte beim Klick** statt in der unsichtbaren Phase — ein harter Sprung, der die gesamte Auflösung-per-Unschärfe wirkungslos machte.

**Offene Product-Frage:** Dauer der Choreografie bei `prefers-reduced-motion: reduce`. Empfehlung: von 8 s auf ~2,5 s kürzen und direkt in die ruhige Szene springen. Bewusst nicht eigenmächtig umgesetzt. PWA-1C.2 hat daran nichts geändert.

### Nachtrag PWA-1C.2 (2026-08-30): abgelehnter RC und Recovery-Contract-Korrektur

Der **Final Adversarial Review** des ersten PWA-RC (`0329c0aedb7b250436ab43b651a9577ced10b0af`) hat den Kandidaten mit `PWA UPDATE RC REJECTED — FIX REQUIRED` abgelehnt: 0 BLOCKER, 0 HIGH, **1 MEDIUM**, mehrere LOW. Unabhängig bestätigt hat derselbe Review u. a. den Zwei-Build-Lifecycle (Worker B WAITING, A bleibt Controller, A-Lazy-Chunk 200 aus dem Precache während der Server 404 liefert, genau ein Reload, alter Cache danach aufgeräumt), den generierten `sw.js` (kein `skipWaiting()`, kein `clientsClaim()`), die vollständige Abwesenheit des Dev-Harness im Production-Build und die Choreografie-Grenze (`applyUpdate()` erst nach acht Sekunden, genau einmal).

**Der MEDIUM.** Der Recovery-Zustand hing am Promise von `updateServiceWorker()`. Der ausgelieferte Client von `vite-plugin-pwa` 1.2.0 lehnt dieses Promise praktisch nie ab — es wartet nur auf die Registrierung (die alle Fehler abfängt) und feuert dann ein `postMessage` ohne `await`. Damit war der `catch`-Zweig toter Code, der Recovery-Zustand in Production unerreichbar, und der reale Fehlerfall — Anfrage gesendet, `controllerchange` kommt nie — hätte Nora **dauerhaft** auf „Nora wird aktualisiert" stehen lassen, ohne Aktion und ohne Timeout. Die Doku behauptete an zwei Stellen ausdrücklich das Gegenteil.

**Zweiter Befund, erst bei der Reparatur gemessen.** Nach `SKIP_WAITING` feuert `controllerchange` genau einmal und der neue Worker übernimmt — die Seite lädt aber **nicht** neu. Der Client von `vite-plugin-pwa` lädt nur bei Funden, die Workbox als „intern" führt; Noras eigene Prüfung (stündlich bzw. bei Tab-Rückkehr, also lange nach dem Seitenaufbau) zählt nicht dazu. Am unveränderten RC-Code identisch gemessen. Ohne Gegenmaßnahme hätte der Watchdog das Problem sogar verdeckt, weil die Übernahme ja stattgefunden hat. Nora lädt deshalb 1,5 s nach der Übernahme selbst neu.

**Behoben in PWA-1C.2** (lokal implementiert und verifiziert, kein Production-Release): `activated` aus `controllerchange` als einziges Erfolgssignal, 5-Sekunden-Watchdog ab `applyUpdate()` (empirisch begründet: gemessene Übernahme 2–3 ms normal, max. 34 ms bei 20× CPU-Drosselung), Copy ohne Fehlerbehauptung, Recovery-Aktion nach echtem Worker-Zustand, verspätete Übernahme nimmt Recovery zurück. Details: `06-decision-log.md`, „2026-08-30 – Aktivierungsanfrage ist kein Erfolgssignal: Watchdog statt Promise (PWA-1C.2)".

**Ebenfalls geschlossen** (LOW aus demselben Review): Fokus fiel nach der Primäraktion auf `<body>`; `role="status"` auf der sich mehrfach umbauenden Fläche hätte Screenreader-Wiederholungsansagen erzeugt; `src/index.css` bestand Prettier nicht; das SVG-Design-Asset hatte gemischte Zeilenenden; der Kommentar „byteweise identisch" war zu stark; der Verweis auf „Falle 37" in `pwaUpdateStore.ts` passte nicht.

**Offen geblieben und bewusst nicht in dieser Welle gelöst:** der Kontrast der Primäraktion (siehe nächster Abschnitt) und die Reduced-Motion-Dauer.

### PWA Update State Contract V2 (2026-09-01): Recovery-Bug behoben — `LOCAL VERIFIED / RC`

**Befund (Read-only-Diagnose, Zwei-Build-Repro in Chromium, TYPE D).** Der Product Owner sah in Production den Recovery-Zustand mit „Nora neu laden", obwohl kein Fehler vorlag. Ursache: `onNeedRefresh` aus `vite-plugin-pwa` (Prompt-Modus) feuert für externe Funde bereits beim `installed`, und Nora behandelte den Callback als „ein Worker wartet". In einem **unkontrollierten Dokument** (kein `controller` — Erstbesuch, Hard Reload, gelöschte Site-Daten; ohne `clients.claim()` bleibt es das bis zur nächsten Navigation) aktiviert sich der Worker 2 ms später selbst, SKIP_WAITING geht ins Leere und `controllerchange` erreicht das Dokument nie → nach 13 s Recovery B. Zweiter Befund (MEDIUM): hatte ein anderer Tab aktiviert, zeigte die Fläche weiter „verfügbar" und spielte beim Klick acht Sekunden ohne Wirkung ab. Der 5-s-Watchdog selbst war **nicht** zu aggressiv (Übernahme im kontrollierten Tab: 14 ms).

**Behoben:** Browser-Fakten als Wahrheit (`syncFacts()` an allen Entscheidungspunkten, ereignisbasiert über `statechange`/`updatefound`/`controllerchange`/`visibilitychange`), expliziter Zustand `reloadRequired`, `applyUpdate()` sendet nur mit wartendem Worker, Watchdog liest Fakten statt Fehler zu setzen (`slow` mit genau einem stillen zweiten Versuch), `failed` nur bei abgelehnter Anfrage, Presentation Contract V2 mit ruhiger Copy und ohne Warnoptik. Kein `clients.claim()`, kein Cross-Tab-Messaging, keine Dependency-Änderung, der production-bewiesene Happy Path (waiting → 8 s → ein SKIP_WAITING → ein controllerchange → ein Reload) ist unverändert. Details: `16-current-state.md` 6b, `02-design-system.md` (Presentation Contract V2), Decision Log „2026-09-01 – PWA Update State Contract V2".

**Doku-Korrektur:** Die Aussage aus PWA-1C.2, der Client lade nach der Übernahme nie selbst neu, gilt nur für unkontrollierte Dokumente. Im kontrollierten Tab meldet Workbox `controlling.isUpdate = true` und `register.js` lädt synchron neu (gemessen); Noras 1,5-s-Reload ist das Sicherheitsnetz für alle anderen Fälle — es entsteht kein Doppel-Reload.

**Offen / bewusst nicht in dieser Welle:** Reduced-Motion-Dauer der Choreografie; Kontrast/Touch-Höhe der Primäraktion (unten); der globale Loader (nächster Abschnitt). Production-Verifikation steht aus.

**Unabhängiger finaler technischer Review (2026-09-01):** `TECHNICALLY APPROVED — FREEZE STATE CONTRACT`, 0 BLOCKER / 0 HIGH / 0 MEDIUM. Verbleibend und bewusst offen gelassen: LOW-1 Assessment `nothing` (Worker verschwindet ohne Aktivierung/Ersatz — Choreografie ohne Exit; theoretisch), LOW-2 Nutzen des stillen zweiten SKIP_WAITING nur im Ersetzt-Fall, NOTE `vite-plugin-pwa` lädt kontrollierte Nicht-Klick-Tabs nach Fremdaktivierung sofort neu (Plugin, pre-existing), NOTE ein per Navigations-Update-Check < 60 s nach Registrierung gefundener Worker löst im unkontrollierten Dokument kein `onNeedRefresh` aus (Plugin). Der State Contract wird dafür nicht wieder geöffnet.

### PWA Visual Polish 2 (2026-09-01): Präsentation — `RC VERIFIED — READY FOR PRODUCT OWNER ACCEPTANCE`

Reine Präsentationswelle auf `polish/nora-pwa-update-visual-v2` (Store/Registrierung/Hooks/SW-Erzeugung byteweise unverändert). **UX-1 aus dem Final Review behoben:** in „Gleich bereit" kein „Nora neu laden" und kein „Falls es nicht weitergeht …" mehr — der Zwei-Build-Beweis hatte gezeigt, dass ein Reload bei weiterhin wartendem Worker denselben Build lädt und das Panel sofort wieder auf „verfügbar" stellt; stattdessen nach der zweiten Frist ein leises „Weiterarbeiten" über den bestehenden Verschiebe-Pfad. **NOTE-2 behoben:** die in V2 verlorenen Abschnitte von `02-design-system.md` (Reduced Motion, Accessibility, Kontrast, Mobile, Tokens, Texte, lokal ansehen) sind aktualisiert wiederhergestellt. Sichtbare Änderung: 30-rem-Fläche, flaches Material, Orb 7 rem mit Orbital-Ring (Bogen / langsamer Bogen / geschlossener Ring / gedämpfter Orb), eine Nebenzeile, eine Primäraktion, mobil gestapelt. Details: `02-design-system.md` „Visual Polish 2" und Decision Log „2026-09-01 – PWA Visual Polish 2".

**Offen:** Product-Owner-Sichtabnahme; danach Production-Release (kein Deployment aus dieser Welle). Weiterhin offen: Kontrast der Primäraktion (unten), Reduced-Motion-Dauer, globaler Loader. Dev-Harness-Eigenheit, kein Produktfehler: nach einem simulierten `failed` bleibt `failed` im Store bis zum Reload gesetzt (eingefrorene Store-Semantik) — ein erneutes „Update anzeigen" zeigt deshalb wieder den Fehlerzustand; für weitere Zustände „Neu laden" drücken.

### PWA Completion Acknowledgement (2026-09-01): „Aktualisierung abgeschlossen" — `RC — LOCAL VERIFIED`

Kleine Presentation-Welle auf `feat/nora-pwa-update-success-ack` (Basis `0e505456`). Die frisch geladene Version bestätigt nach einem erfolgreichen Update genau einmal „Aktualisierung abgeschlossen / Nora ist bereit." (grün, ohne Aktion, Auto-Dismiss 6 s). Transport per `sessionStorage`-Bit (`pwa/pwaUpdateCompletion.ts`), geschrieben nur bei `controllerchange` im Store und bei Noras eigenem Reload; nie bei `failed`, `slow`, „Später" oder F5. State Contract V2 unverändert bis auf eine Nebenwirkungszeile im Store. Details: `02-design-system.md` „Abschlussbestätigung", Decision Log „2026-09-01 – PWA Completion Acknowledgement".

**Offen:** Product-Owner-Sichtabnahme (Screenshots hell/dunkel/Reduced Motion liegen vor); Release zusammen mit Visual Polish 2. **Bekannter, akzeptierter Randfall:** ein Tab, der die Übernahme nur mitbekommt (externes Update, anderer Tab hat ausgelöst) und vom Client nicht neu geladen wird, zeigt „Neue Version bereit"; lädt der Benutzer dort später von Hand neu, erscheint die Bestätigung — zutreffend, weil dieser Reload das Update in diesem Tab vollendet. **Nicht abgedeckt durch automatische Tests:** der echte `window.location.reload()`-Pfad (im Browser-Testrunner nicht ersetzbar) — im Dev-Server über „Abschluss anzeigen" und den echten Weg „Jetzt aktualisieren → Übernahme simulieren → Auto-Reload" nachgestellt. Dev-Harness-Hinweis: „Abschluss anzeigen" lädt sofort neu; ein zweites „Neu laden" danach zeigt nichts mehr (Beweis für „kein Success bei gewöhnlichem Reload").

## Nora Loading Motion System (geplante Welle, noch nicht begonnen)

Aus der PWA-Diagnose 2026-09-01: Nora hat **zwei identische Spinner-Komponenten** (`src/components/ui/spinner.tsx`, `src/components/admin/spinner.tsx` — beide lucide `Loader2` + `animate-spin text-primary`), `admin/loading.tsx` darauf aufbauend, rund 13 direkte `animate-spin`-Vorkommen und ~45 `Loader2`/`Spinner`-Referenzen in ~25 Dateien (Quick Capture, Kontakt→Kunde, Import, Audit, Kalender-Admin, Notification-Card, sonner-Loading-Icon, Mobile-Dashboard), dazu `ui/skeleton.tsx`, `ui/progress.tsx` und den eigenständigen PWA-Orb. Der Product Owner wünscht einen hochwertigeren, ruhigeren Nora-Ladekreis. **Bewusst nicht in der PWA-V2-Welle umgesetzt** — die PWA-Fläche hat nur ihre eigene ruhige Wartebewegung (langsamer atmende Punkte) bekommen. Empfehlung für die eigene Welle: einen zentralen Nora Motion Primitive einführen, die beiden Spinner-Komponenten darauf umstellen (deckt den Großteil ab), dann die Inline-`animate-spin`-Stellen nachziehen; Reduced Motion, Hell/Dunkel und 44-px-Touchziele mit abnehmen.

## Kontrast der Nora-Primäraktion unterschreitet AA (LOW, projektweit, 2026-08-30)

**Befund.** `.nora-primary-action` trägt Weiß auf `--nora-brand` (`#ff3b1f`). Canvas-aufgelöst gemessen: **3,56:1** — unter den 4,5:1, die WCAG 1.4.3 für normalen Text verlangt (14 px bei Schriftschnitt 600 zählt nicht als „large text"). Der Wert ist in Hell und Dunkel identisch, weil die Markenfarbe in beiden Modi dieselbe ist.

**Nicht von der PWA-Welle verursacht.** Dieselben 3,56 wurden am bestehenden Header-Button „Neue Anfrage erfassen" nachgemessen. Betroffen ist jede Primäraktion in Nora.

**Warum in PWA-1C.2 nicht lokal korrigiert.** Technisch ginge es (rund 15 % Schwarz in den Markenton mischen ergibt 4,76 — gerechnet, nicht gemessen). Das hätte aber genau einen Knopf anders eingefärbt als jede andere Primäraktion in Nora, direkt neben dem markenroten Orb, an einer vom Product Owner abgenommenen Komposition — und das eigentliche, globale Problem trotzdem nicht gelöst.

**Empfohlener Fix (eigene kleine Welle, zusammen mit dem 44-px-Punkt unten).** Markenton für Flächen mit weißem Text einmal projektweit auf ≥ 4,5 absenken oder eine eigene `--nora-brand-on-white`-Variante einführen, dann alle Primäraktionen nachmessen. Product-Owner-Entscheidung, weil es die Markenfarbe berührt.

## `nora-primary-action` unterschreitet das 44-px-Touch-Minimum (LOW, projektweit, 2026-08-30)

**Befund.** `.nora-primary-action` in `src/index.css` nutzt `@apply min-h-10 …`. Tailwind v4 verschiebt **jede** Regel, die `@apply` verwendet, in die `utilities`-Layer, wo sie nach `.min-h-*` einsortiert wird und diese gewinnt. Ergebnis: die Klasse nagelt jede Primäraktion auf 40 px fest und überschreibt dabei

- eine `min-h-11`/`min-h-12`-Utility-Klasse am selben Element **und**
- jede Regel in der `components`-Layer (Layer-Reihenfolge schlägt Spezifität)

Damit unterschreitet die Nora-Primäraktion Noras eigenes Touch-Minimum von 44 px (`--nora-touch-min`). Gemessen im Systemereignis: Primärbutton 164×**40**, Ghost-Button daneben 144×**44**.

**Betroffen sind vermutlich weitere Stellen.** Mehrere bestehende Aufrufe kombinieren `nora-primary-action` mit einer `min-h-*`-Klasse in der Annahme, dass diese greift — z. B. `ContactCreateSheet.tsx` (`min-h-12`) und `DealProductionChecklistSection.tsx` (`nora-touch-target`, das ebenfalls `@apply` nutzt). Ob sie tatsächlich zu klein rendern, ist **nicht** nachgemessen worden; die Mechanik legt es nahe.

**Aktueller Stand.** In PWA-1C.1 nur lokal gelöst, über eine bewusst ungelayerte, eng auf `.nora-system-event-action` gescopte Regel — die einzige ungelayerte Regel in `index.css`. Die geteilte Klasse wurde **nicht** angefasst, weil sie zu anderen Wellen gehört und eine Änderung dort jede Primäraktion in Nora betrifft.

**Empfohlener Fix (eigene kleine Welle).** `min-h-10` aus `.nora-primary-action` entfernen und die Höhe dort über `--nora-touch-min` setzen, dann alle Aufrufstellen einmal nachmessen. Vorher prüfen, ob irgendwo bewusst ein 40-px-Button gewollt ist.

## Bekannte, nicht in dieser Wave untersuchte Themen

Aus einer früheren Analyse vor der Customer & Contact Workflow Wave als „bekannt, nicht Kern des Auftrags" benannt, hier zur Vollständigkeit aufgeführt — **nicht in dieser Session verifiziert oder detailliert**, vor Bearbeitung gegen aktuellen Code/Produktion neu prüfen:

- Offene Selbstregistrierung
- Attachment-Bucket-Konfiguration
- Nicht deployte Edge Functions
- Rollen-Cache-Verhalten
- Audit-Retention-/Löschstrategie

Diese Liste ist bewusst knapp gehalten, da keine Detailanalyse aus dieser Session vorliegt, die über die Kategorienamen hinausgeht.
