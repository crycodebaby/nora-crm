# 17 – Bekannte offene Punkte und geplante Waves

Übersicht: `16-current-state.md`. Dieses Dokument enthält die Details zu offenen Bugs, Live-Feedback und geplanten Domain-Waves. Bitte Status-Tags nicht ohne erneute Code-/Live-Prüfung ändern.

Status-Legende: `OPEN` (bestätigt, nicht behoben) · `NEEDS RE-VERIFICATION` (gemeldet, im aktuellen Code nicht reproduzierbar) · `BUG, Ursache vermutet` · `PLANNED DOMAIN WAVE` · `PLANNED FOLLOW-UP`.

---

## UX-/Domain-Probleme

### 1. Kunden-Autocomplete: „neuen Kunden anlegen" nicht eindeutig als Aktion erkennbar

**Status: OPEN**

Betroffen: `/kontakte/create`, Kunden-Autocomplete-Feld (`AutocompleteCompanyInput.tsx`).

Aktueller Text (`resources.companies.autocomplete.create_label`, alle drei Message-Kataloge):

> „Tippen Sie, um einen neuen Kunden anzulegen"

Live-Feedback 2026-08-25: Der Hinweistext ist nicht eindeutig genug von normalen Sucheergebnissen abgesetzt und wird als Aktion leicht übersehen.

**Gewünschte UX:**

- deutlich als Aktion erkennbar
- visuell vom Sucheergebnis getrennt
- Plus-Symbol o. ä.
- Formulierung z. B.: „Neuen Kunden „<Suchtext>" anlegen"

**Nicht umgesetzt in dieser Session** — reine Copy-/Layout-Änderung an `AutocompleteCompanyInput.tsx` und den drei Message-Katalogen, kein Datenmodellbezug.

---

### 2. LinkedIn-Feld auf `/kontakte/create`

**Status: NEEDS RE-VERIFICATION** (im aktuellen Code nicht reproduzierbar)

Live-Feedback 2026-08-25: Trotz des neuen generischen Links-Modells sei auf `/kontakte/create` weiterhin ein sichtbares Feld „LinkedIn-Adresse" vorhanden.

**Code-Prüfung (2026-08-25, nach dem Feedback):** `ContactInputs.tsx` — die einzige Formularkomponente, die von `ContactCreate.tsx`, `ContactCreateSheet.tsx` und `ContactEditSheet.tsx` verwendet wird — enthält **kein** `TextInput source="linkedin_url"` mehr, nur noch `ArrayInput source="links_jsonb"`. Verbleibende `linkedin_url`-Referenzen im Code sind ausschließlich:

- `CompanyAside.tsx`, `ContactPersonalInfo.tsx` — Lese-Fallback für Altdatensätze, deren Migrations-Backfill aus irgendeinem Grund leer blieb, kein Eingabefeld
- `useContactImport.tsx` — CSV-Spaltenname beim Import, kein UI-Formularfeld
- Message-Kataloge — verwaiste `linkedin_url`-Labels für die deprecated DB-Spalte, nicht zwingend im UI gerendert

**Nächster Schritt:** Vor jeder Code-Änderung live auf `nora.ergart.de/#/kontakte/create` neu prüfen (ggf. Deploy-Timing oder Browser-Cache zum Meldezeitpunkt). Falls das Feld dort tatsächlich noch erscheint, widerspricht das dem hier dokumentierten Codestand — dann hat Code-Wahrheit Vorrang vor dieser Notiz, und die Ursache muss neu untersucht werden (z. B. alter Service-Worker/PWA-Cache beim Melder).

---

### 3. Kunden-Show: Tabs „Änderungsverlauf"/„Kontakte" springen zurück

**Status: BUG, Ursache vermutet, nicht gefixt**

Live beobachtet 2026-08-25 auf `nora.ergart.de/#/kunden/27/show` (Browser-Test in dieser Session): Klick auf Tab „Kontakte" oder „Änderungsverlauf" navigiert kurz, zeigt aber weiterhin den Inhalt des Tabs „Aktivität"; der aktive Tab-Zustand kehrt sichtbar dorthin zurück.

**Vermutete Ursache** (Code-Analyse, nicht verifiziert durch Fix/Test):

`CompanyShowContent` (`CompanyShow.tsx`) ermittelt den aktiven Tab über:

```ts
const tabMatch = useMatch("/companies/:id/show/:tab");
const currentTab = tabMatch?.params?.tab || "activity";
```

und navigiert bei Tab-Wechsel explizit auf den **englischen, internen** Pfad:

```ts
navigate(`/companies/${record?.id}/show/${value}`);
```

Die sichtbare/aliasierte Route ist aber deutsch (`/kunden/...`, siehe `routing/noraRoutes.ts`, `NORA_RESOURCE_PATHS`, `translateLegacyPathname`). Hypothese: Nach der Navigation zu `/companies/...` greift der Legacy-Redirect-Mechanismus und schreibt die URL auf `/kunden/...` um. `useMatch("/companies/:id/show/:tab")` matcht danach nicht mehr (falsches Pattern), `currentTab` fällt auf `"activity"` zurück, obwohl die URL korrekt den Ziel-Tab enthält.

**Mögliche Fixrichtungen** (nicht bewertet/entschieden):

- `useMatch` zusätzlich (oder stattdessen) gegen das deutsche Pfadmuster `/kunden/:id/show/:tab` prüfen
- `navigate()` direkt auf den deutschen Pfad statt den englischen ausführen lassen
- Redirect-Mechanismus so anpassen, dass er den Tab-Teil des Pfads erhält, statt nur `id`/`show` zu behandeln

**Nicht in dieser Session untersucht:** ob derselbe Mechanismus auch `ContactShow`/`DealShow`-Tabs betrifft (falls diese ein ähnliches `useMatch`-Pattern verwenden).

---

## Geplante Domain-Waves

### 4. Aufgabenmodell vereinheitlichen (Kunde + Ansprechpartner)

**Status: PLANNED DOMAIN WAVE — noch nicht designed, keine Schemaentscheidung getroffen**

**Problem** (Live-Beispiel 2026-08-25): Kunde „Traum und Horror UG" hat Ansprechpartner „Freddie Krüger". Aufgaben zu Freddie erscheinen auf der Kontaktakte, aber es gibt keine entsprechende kundenbezogene Aufgabenliste auf der Kundenakte — obwohl `deals.company_id` existiert, hängen `tasks` ausschließlich an `contact_id` (siehe `03-data-model-guardrails.md`, Falle 7).

**Fachliches Zielbild:**

- Eine Aufgabe soll **genau einmal** existieren, z. B. „Freddie wegen Angebot zurückrufen" mit Kontext Kunde (Traum und Horror UG) **und** Ansprechpartner (Freddie Krüger) — sichtbar in beiden Akten, ein Erledigt-Status überall.
- Eine Aufgabe soll auch **nur** im Kundenkontext existieren können (z. B. „Rechnung prüfen"), ohne konkreten Ansprechpartner.
- Keine duplizierten Aufgaben-Datensätze für denselben Sachverhalt.

**Mögliche technische Richtung** (nicht beschlossen): Erweiterung von `tasks` um einen optionalen Kundenkontext (z. B. `company_id`), sodass eine Aufgabe wahlweise `contact_id`, `company_id` oder beides trägt. Erfordert Analyse: Auswirkung auf `TasksListByDueDate`, Hotboard „Offene Aufgaben", RLS, bestehende Task-Erstellungspfade (`TaskCreateSheet`, Kontaktdetail).

**Nicht entscheiden, solange nicht analysiert und freigegeben** — dies ist eine Notiz für die nächste Design-Runde, keine Migrationsvorgabe.

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
