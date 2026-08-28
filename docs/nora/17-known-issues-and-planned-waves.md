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

### 9. Pre-Production Hardening Patch — vollständig nachgeprüft und auf Production released

**Status: PRODUCTION VERIFIED — 2026-08-28**

Die Pre-Production-Hardening-Session (siehe Decision Log) hat verifizierte Bugs behoben (FakeRest-Effective-Contact-Parität, Falsy-ID-Audit, Error Contract für Quick Capture, Individual Name Invariant). Docker wurde in derselben Session gestartet und die volle kanonische RBAC-Testreihenfolge (`07-agent-change-checklist.md`) gegen einen frischen `npx supabase db reset --local` durchlaufen — **alle Tests grün**, inkl. der neuen Domain-Contract-Matrix (Abschnitt 7) und des Individual-Name-Invariant-Negativtests (Abschnitt 4c-ii) in `customer_contact_workflow_verification.sql`, sowie eines neuen empirischen Atomic-Rollback-Tests (Abschnitt 6f). Concurrency wurde bewertet (kein neuer Doppel-Datensatz-Bug; ein bekannter/dokumentierter Idempotency-Gap bleibt bewusst offen für eine spätere Welle).

Eine anschließende Final-Release-Candidate-Verification fand und behob drei weitere Punkte vor dem Release: einen hardcodierten englischen Navigationspfad in `CompanyShow.tsx`, eine Lücke in `normalizeCrmError`s Fehlermuster (FakeRests deutscher Text für die effective-contact-context-Ablehnung wurde nicht erkannt), und — der wichtigste fachliche Fund — die Individual Name Invariant war am CREATE-Pfad von `create_customer_with_contact_core` gar nicht durchgesetzt (nur beim späteren Rename), sodass eine Privatkundenakte mit einem namenlosen Self Contact und einem davon unabhängigen `companies.name` entstehen konnte. Alle drei behoben, mit Regressionstests abgesichert (Decision Log „2026-08-27 – Pre-Production Hardening Patch", Nachtrag „Individual Name Invariant am CREATE-Pfad geschlossen").

**Production-Data-Preflight (read-only, mehrfach wiederholt, zuletzt unmittelbar vor und nach dem Release am 2026-08-28):** 14 Kunden, 0 `individual` → kein Self-Contact-Backfill-Kollisionsrisiko; keine Dubletten/verwaisten FKs/CHECK-Verletzungen gefunden; 2 vorbestehende (nicht durch diesen Patch verursachte) Security-Advisor-Findings zu `SECURITY DEFINER`-Views notiert, unverändert, nicht behoben (außerhalb des Scopes). **Keine Migration-Blocker.**

**Kontrollierter Production Release (2026-08-28):** Migration `20260826120000_self_contact_and_quick_capture_case.sql` (SHA-256 `b747b94d6132b37f41ed82367bcd898db52b07e85dbf2f14c83e8fcdd285c2e7`) gegen `nora-crm-prod` angewendet, Migration-Bookkeeping-Drift (Anwendungszeitstempel statt Repo-Zeitstempel — derselbe Drift-Typ wie am 2026-08-25) erkannt und korrigiert, Schema/Funktionen/Trigger/Grants/View read-only vollständig verifiziert. Commit `0c93912137d610f570b5c5fd449573d25160fe86` nach `origin/main` gepusht, Vercel-Production-Deployment (`dpl_5UL3NL8J2bTwGCAJrobUNZRQ99NB`) verifiziert (READY, korrekter Commit). Live-Smoke-Test gegen `nora.ergart.de` in echter Session erfolgreich (Hotboard/Kunden/Kontakte/Vorgänge, Tab-Routing, Quick Capture, Self-Contact-UI, Firma/Privatperson-Labels — keine Fehler, keine Testdaten angelegt). Details: Decision Log „2026-08-27 – Pre-Production Hardening Patch" und Session-Verlauf.

Release vollständig abgeschlossen — keine offenen Nachprüfungspunkte mehr aus dieser Wave.

## Security Follow-ups (bewusst offen, nicht durch Self Contact Wave verursacht)

- `public.init_state` — View mit `SECURITY DEFINER` (Security-Advisor-Finding, ERROR-Level)
- `public.sales_directory` — View mit `SECURITY DEFINER` (Security-Advisor-Finding, ERROR-Level)

Beide bereits vor der Customer & Contact Workflow Wave vorhanden, in jedem Production-Preflight seither read-only bestätigt als unverändert (zuletzt 2026-08-28, siehe Punkt 9 oben und Decision Log). Bewusst nicht in dieser oder einer der vorherigen Waves behoben — separate Prüfung/Entscheidung nötig, ob `SECURITY DEFINER` hier fachlich erforderlich ist oder auf `SECURITY INVOKER` umgestellt werden kann.

## Bekannte, nicht in dieser Wave untersuchte Themen

Aus einer früheren Analyse vor der Customer & Contact Workflow Wave als „bekannt, nicht Kern des Auftrags" benannt, hier zur Vollständigkeit aufgeführt — **nicht in dieser Session verifiziert oder detailliert**, vor Bearbeitung gegen aktuellen Code/Produktion neu prüfen:

- Offene Selbstregistrierung
- Attachment-Bucket-Konfiguration
- Nicht deployte Edge Functions
- Rollen-Cache-Verhalten
- Audit-Retention-/Löschstrategie

Diese Liste ist bewusst knapp gehalten, da keine Detailanalyse aus dieser Session vorliegt, die über die Kategorienamen hinausgeht.
