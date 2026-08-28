# 16 – Aktueller Zustand (Einstiegspunkt für neue Agenten)

Stand: 2026-08-26 (nach Self Contact Wave, Unified Tasks Wave, Live-UX-Fixes-Wave, Customer & Contact Workflow Wave + Foundation Performance/Index-Härtung, PR #1).

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

**Bekannte, noch offene Security-/Ops-Themen** (aus früherer Analyse vor dieser Session, hier nicht neu verifiziert — vor Umsetzung gegen aktuellen Code prüfen):
- Offene Selbstregistrierung (Status unklar, `handle_new_user`/`init_state`-Logik prüfen)
- Attachment-Bucket-Konfiguration
- Nicht deployte Edge Functions
- Rollen-Cache-Verhalten im Frontend
- Audit-Retention/Löschstrategie (`13-crm-audit-retention.md` beschreibt das Modell, keine automatische Löschung ist Stand v0.3l)

Diese Punkte waren zu Beginn der Customer & Contact Workflow Wave als "bekannt, nicht Kern des Auftrags" benannt und wurden in dieser Session nicht untersucht.

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

Verifiziert am 2026-08-28 in dieser Session (kontrollierter Production Release, read-only Nachverifikation gegen `nora-crm-prod` und das echte Vercel-Projekt):

- **Datenbank** (`nora-crm-prod`, Supabase-Projekt `kixxroxtfzbcbzctohex`): Migrationshistorie deckt sich vollständig mit `supabase/migrations/` bis einschließlich `20260826120000_self_contact_and_quick_capture_case.sql`. Enthält damit die Customer & Contact Workflow Wave, die Unified Tasks Wave, die Self Contact Wave und den Final-RC-Domain-Fix (Individual Name Invariant am CREATE-Pfad) vollständig — Spalten, Constraints, Trigger, RPCs, Views, Grants read-only nachverifiziert.
- **Frontend** (Vercel-Projekt `nora-crm`, Domain `nora.ergart.de`): Deployment `dpl_5UL3NL8J2bTwGCAJrobUNZRQ99NB`, Commit `0c93912137d610f570b5c5fd449573d25160fe86`, Status READY, Target production. Enthält alle oben genannten Waves inkl. des Final-RC-Hardening-Commits.
- **Produktionsdaten sind real**, nicht synthetisch: zum Prüfzeitpunkt 14 Kunden (davon 0 `individual`), 15 Kontakte, 4 Nutzer. Die Aussage „Nora ist noch kein Produktivsystem mit echten Kundendaten" (`00-project-context.md`, historisches Nicht-Ziel für v0.1) **stimmt nicht mehr** — als historische Zieldefinition markiert, siehe dort.
- Git: `origin/main` bei Commit `0c93912137d610f570b5c5fd449573d25160fe86`.
- **Live-Smoke-Test** (frische Session gegen `nora.ergart.de`, echte eingeloggte Sitzung): Hotboard/Kunden/Kontakte/Vorgänge laden fehlerfrei, Kunden-Show-Tab-Routing bleibt stabil (`#/kunden/:id/show/contacts`, `.../history`), Quick Capture öffnet und bietet den vorhandenen Hauptansprechpartner eines bestehenden Kunden korrekt an, Self-Contact-UI (Button „Kundenakte für diese Person anlegen") rendert fehlerfrei, „Firma"/„Privatperson"-Kundenart-Auswahl korrekt, keine rohen i18n-Keys oder DB-Fehlermeldungen sichtbar. Keine Testdaten in Production angelegt.
- **Bekannter, bereits behobener Migration-Bookkeeping-Drift:** `apply_migration` trug die Self-Contact-Migration zunächst mit dem Anwendungszeitstempel (`20260828013725`) statt dem Dateiname-Zeitstempel (`20260826120000`) ein — derselbe Drift-Typ wie bei der Customer & Contact Workflow Migration am 2026-08-25. Per transaktionalem `UPDATE` auf den korrekten Zeitstempel korrigiert und read-only nachverifiziert (genau eine Zeile geändert, keine andere Migration betroffen). **Dauerhafte Regel:** nach jedem `apply_migration` gegen `nora-crm-prod` `list_migrations` gegen das lokale Zeitstempel-Präfix prüfen, bevor der Release als abgeschlossen gilt.

Diese Fakten wurden per read-only MCP-Abfragen gegen die echte Produktionsdatenbank und das echte Vercel-Projekt sowie per Live-Browser-Smoke-Test verifiziert, nicht angenommen.

## 6a. Security Advisor Status

Die zwei vorbestehenden Supabase Security Advisor ERROR-level Findings (`SECURITY DEFINER`-Views):

- `public.init_state`
- `public.sales_directory`

wurden am 2026-08-28 in einer dedizierten, read-only Assessment-Session gegen den tatsächlichen Production-Katalog (`nora-crm-prod`) untersucht.

Ergebnis: **beide `ASSESSED / LOW / KEEP`, kein aktueller Production Security Blocker.** Die Advisor-ERROR-Klassifikation bezieht sich auf den Mechanismus (`security_invoker = false`/`off`), nicht auf einen nachgewiesenen Exploit — beide Views sind bewusste, eng begrenzte Ausnahmen mit minimaler, geprüfter Datenprojektion. Vollständige Begründung: `17-known-issues-and-planned-waves.md` „Security Advisor Findings — assessed 2026-08-28"; Architekturentscheidung: `06-decision-log.md` „2026-08-28 – Intentional privileged read views (`init_state` / `sales_directory`)".

**Vollständig abgearbeitet (Folge-Session, 2026-08-28 – Residual Security Advisor Closure):** die restlichen Advisor-Hinweise sind jetzt bewertet — `number_counters` (RLS-ohne-Policy) `INFORMATIONAL/KEEP` (deny-by-grants, kein anon/authenticated-Zugriff), die 17 ausführbaren `SECURITY DEFINER`-Trigger-/Event-Trigger-Functions `INFORMATIONAL/KEEP` (Rückgabetyp `trigger`/`event_trigger` — Postgres verbietet Direktaufruf, Advisor-Falsch-Positiv-Klasse), die aufrufbaren `authenticated`-only Business-RPCs `KEEP` (serverseitige Role-/Ownership-Checks verifiziert, kein anon-Zugriff, kein Authorization-Bug), Search-Path-Schutz `NO SEARCH PATH SECURITY BLOCKER` (kein `CREATE` auf `public` für client-facing Rollen, alle Functions schema-qualifiziert), und `auth_leaked_password_protection` **`RESOLVED — ENABLED`** (Production, 2026-08-28, per Dashboard-Toggle, danach per Advisor-Re-Check verifiziert). Details: `17-known-issues-and-planned-waves.md` „Residual Security Advisor Follow-ups — assessed 2026-08-28", `06-decision-log.md` „2026-08-28 – Residual Security Advisor Closure". Der zum Stand 2026-08-28 bekannte Supabase Security Advisor Backlog (dieser Snapshot) ist damit vollständig bewertet — Ziel ist nachgewiesene Sicherheit, nicht „0 Findings" (die verbleibenden INFO/ERROR-Einträge sind bewusst akzeptierte Architektur). Das schließt **keine** künftig neu auftretenden Advisor-Findings aus (neue Migration, neue Function, geänderte Grants, neue Advisor-Lint-Kategorie) — ein neuer Fund erfordert immer eine eigene Bewertung, unabhängig vom hier dokumentierten Abschluss.

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
5. Idempotency für retry-fähige/externe Write Commands (`CreateQuickCaptureCase`, `CreateCustomerFromContact`) — bewusst offen gelassen, additives `idempotencyKey`-Feld später möglich ohne Breaking Change.
6. Stabilerer, maschinenlesbarer Error Contract ohne Text-/Regex-Abhängigkeit (aktuell mappt `normalizeCrmError` auf Basis von Nachrichtenmustern — funktioniert, aber fragil bei künftigen Wortlaut-Änderungen).
7. `deals.contact_ids bigint[]` als Vorgang-Domain-Debt (keine FK-Integrität pro Element, keine Rollen/Zeitdimension) — siehe Decision Log.
8. Zukünftige Application Queries / Read Models (noch nicht implementiert, nur als Richtung dokumentiert).
9. ~~Separate Prüfung der beiden bestehenden, vorbestehenden Security-Advisor-Findings (`init_state`/`sales_directory`, `SECURITY DEFINER`-Views)~~ — **erledigt am 2026-08-28**, siehe Abschnitt 6a. Ergebnis: `ASSESSED / LOW / KEEP`, kein Blocker. Weitere INFO/WARN-Advisor-Hinweise bleiben unbewertet (separate Follow-up-Welle, siehe `17-known-issues-and-planned-waves.md`).

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
