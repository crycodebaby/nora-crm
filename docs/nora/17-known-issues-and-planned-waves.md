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

**Status: RESOLVED / VERIFIED (2026-08-25, Unified Tasks Wave) — lokal implementiert, noch nicht auf Production**

**Problem war** (Live-Beispiel 2026-08-25): Kunde „Traum und Horror UG" hat Ansprechpartner „Freddie Krüger". Aufgaben zu Freddie erschienen auf der Kontaktakte, aber es gab keine entsprechende kundenbezogene Aufgabenliste auf der Kundenakte — `tasks` hing ausschließlich an `contact_id` (siehe `03-data-model-guardrails.md`, Falle 7 — dort ebenfalls aktualisiert).

**Umgesetzt:** `tasks.company_id` (nullable, historisch stabiler Kundenkontext, serverseitig via Trigger `nora_private.enforce_task_company_context()` abgeleitet/validiert), `tasks.contact_id` jetzt ebenfalls nullable, CHECK-Constraint für „mindestens eines von beiden". „Aufgaben"-Tab auf `/kunden/:id/show`. Vollständige Entscheidung inkl. historischer Semantik: Decision Log „2026-08-25 – Unified Tasks Wave". Migration lokal gegen echtes Postgres verifiziert (`supabase/tests/task_customer_context_verification.sql`), Browser-Szenarien live durchgespielt — siehe dort für Details. **Noch nicht auf `nora-crm-prod` migriert/deployed.**

---

### 5. Schnellerfassung auf atomare Customer/Contact-Operation umstellen

**Status: PLANNED FOLLOW-UP**

Die Schnellerfassung (`Kunde → Ansprechpartner → Vorgang`, `QuickCaptureDialog.tsx` / `submitQuickCapture.ts`) verwendet weiterhin **sequentielle** `dataProvider.create`-Aufrufe (Stand v0.3e), nicht die neue RPC `create_customer_with_contact`. Bei einem Fehler zwischen Kunden- und Kontakt-Anlage kann derselbe Teilzustand entstehen, den `/kunden/create` durch die neue atomare Operation seit der Customer & Contact Workflow Wave nicht mehr hat.

`/kunden/create` verwendet bereits die neue Architektur vollständig; die Schnellerfassung noch nicht. Diese Umstellung war ausdrücklich **nicht Teil** der Customer & Contact Workflow Wave (siehe Decision Log).

---

### 6. Legacy-Spalten-Cleanup

**Status: PLANNED FOLLOW-UP, kein Zeitdruck**

`companies.linkedin_url`, `companies.website`, `companies.context_links`, `companies.phone_number`, `contacts.linkedin_url` sind seit der Customer & Contact Workflow Wave UI-seitig nur noch Lese-Fallback (Bestandsdaten per Migration in `links_jsonb`/`email_jsonb`/`phone_jsonb` kopiert). Entfernen erst nach ausreichender Übergangszeit und Bestätigung, dass keine externen Integrationen (CSV-Import, alte API-Clients) mehr auf die alten Spalten schreiben.

---

## Bekannte, nicht in dieser Wave untersuchte Themen

Aus einer früheren Analyse vor der Customer & Contact Workflow Wave als „bekannt, nicht Kern des Auftrags" benannt, hier zur Vollständigkeit aufgeführt — **nicht in dieser Session verifiziert oder detailliert**, vor Bearbeitung gegen aktuellen Code/Produktion neu prüfen:

- Offene Selbstregistrierung
- Attachment-Bucket-Konfiguration
- Nicht deployte Edge Functions
- Rollen-Cache-Verhalten
- Audit-Retention-/Löschstrategie

Diese Liste ist bewusst knapp gehalten, da keine Detailanalyse aus dieser Session vorliegt, die über die Kategorienamen hinausgeht.
