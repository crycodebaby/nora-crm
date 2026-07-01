# 08 – Kundennummern, Vorgangsnummern und globale Suche

**Welle 6b** — Spezifikation  
**Welle 6c** — Implementierung (Nummern + UI-Anzeige; globale Suche folgt in v0.2e)

Dieses Dokument spezifiziert feste Kunden- und Vorgangsnummern sowie eine spätere globale Suche für Nora CRM.

## Implementierungsstatus (Welle 6c)

| Bereich | Status |
|---|---|
| DB-Felder `customer_number`, `case_number` | ✅ Migration `20260628130000_customer_and_case_numbers.sql` |
| Serverseitige Generierung | ✅ `number_counters` + Funktionen + Trigger |
| Backfill Altbestand | ✅ in derselben Migration (`created_at`, `id`) |
| `NOT NULL` + `UNIQUE` | ✅ |
| Immutability | ✅ `prevent_*_number_change` Trigger |
| TypeScript-Typen | ✅ `types.ts` |
| Listen-Suche (`q`) | ✅ `customer_number`, `case_number` in `applyFullTextSearch` |
| UI-Anzeige | ✅ Karten, Detail, Formular (read-only) |
| FakeRest / Demo | ✅ `misc/numbering.ts`, `noraDemoSeed`, `beforeCreate` |
| Globale Suche im Header | ✅ Welle 6d / v0.3a |
| API-Hardening (RPC + Client-Insert) | ✅ Migration `20260628140000_numbering_api_hardening.sql` |

### Gewählte Generierungsstrategie

**`number_counters`-Tabelle** statt pro-Jahr-Postgres-Sequenzen:

| Aspekt | Entscheidung | Begründung |
|---|---|---|
| Kundennummer | `counter_key = 'customer'`, `year = 0` | Global monoton, kein Jahres-Reset |
| Vorgangsnummer | `counter_key = 'deal_case'`, `year = YYYY` | Pro Kalenderjahr ab `000001` |
| Atomarität | `INSERT … ON CONFLICT DO UPDATE` | Race-condition-sicher ohne dynamische Sequenz-Namen |
| Zugriff | `SECURITY DEFINER` auf `next_*` | `number_counters` für API-Rollen gesperrt (`REVOKE`) |

Alternative pro-Jahr-Sequenzen (`case_number_seq_2026`, …) wurden verworfen: unbegrenzt viele Sequenz-Objekte, schwerer in Migrationen/Backfill nachzuhalten.

### Migration

Datei: `supabase/migrations/20260628130000_customer_and_case_numbers.sql`

Enthält: Spalten, `number_counters`, Format-/Next-Funktionen, Assign-/Prevent-Trigger, Backfill, `NOT NULL`, Unique Constraints, `companies_summary`-Erweiterung (Spalte `customer_number` **am Ende** der View — Postgres erlaubt kein Einfügen in bestehende Spaltenreihenfolge).

### UI-Anzeigestellen

| Stelle | Feld |
|---|---|
| `CompanyCard` | `customer_number` unter Kundenname |
| `CompanyShow` (Desktop/Mobile) | Kopfbereich |
| `CompanyAside` / `AdditionalInfo` | Zusatzinfos |
| `CompanyInputs` (Edit) | read-only, nicht editierbar |
| `DealCard` (Kanban) | `case_number` oben auf Karte |
| `DealShow` | über Vorgangstitel |
| `DealEdit` / `DealInputs` (Edit) | read-only |

Komponente: `misc/BusinessNumber.tsx` (dezente Mono-Darstellung).

### Backfill-Status

- **Erledigt** in Migration für alle bestehenden `companies` und `deals` ohne Nummer.
- Reihenfolge: `ORDER BY created_at ASC, id ASC`.
- Vorgänge: laufende Nummer **pro Jahr** aus `created_at`.
- Zählerstände danach aus Max-Werten der vergebenen Nummern gesetzt.
- Bestehende Nummern werden nicht überschrieben (nur `WHERE … IS NULL`).

### Bekannte Risiken

- **View-Spaltenreihenfolge:** Neue Felder in Views nur anhängen, nicht einfügen.
- **Jahreswechsel:** Neues Jahr startet Vorgangs-Zähler bei `000001`; Kundennummer läuft global weiter.
- **CSV-Import:** Noch ohne `customer_number` — v0.2f.
- **Supabase Linter RLS auf `number_counters`:** Linter meldet fehlendes RLS; faktisch durch `REVOKE` auf Tabelle abgesichert.

## Welle 6c-Hardening — Nummern-API (2026-06-28)

### Ziel

Nummern **ausschließlich** serverseitig durch `BEFORE INSERT`-Trigger vergeben. Clients dürfen weder Nummern mitsenden noch Zähler per RPC verbrauchen.

### Migration

`supabase/migrations/20260628140000_numbering_api_hardening.sql`

### Änderungen

| Bereich | Vorher (6c) | Nachher (Hardening) |
|---|---|---|
| `assign_customer_number` | Nur bei `NULL` | **Immer** `next_customer_number()`; Client-Wert wird überschrieben |
| `assign_case_number` | Nur bei `NULL` | **Immer** `next_case_number(created_at)` |
| `assign_*` Privileg | `SECURITY INVOKER` | **`SECURITY DEFINER`** + `search_path = public` |
| `next_*` / `format_*` RPC | `GRANT` für `anon`/`authenticated` | **`REVOKE`** von `public`/`anon`/`authenticated`; nur `service_role` |

### Insert-Verhalten (Soll)

| Aktion | Ergebnis |
|---|---|
| `INSERT company` ohne Nummer | `KD-00000n` (DB) |
| `INSERT company` mit `KD-888888` | **Überschrieben** mit nächster echter Nummer |
| `INSERT deal` ohne Nummer | `VG-YYYY-00000n` (DB) |
| `INSERT deal` mit Fake-`case_number` | **Überschrieben** mit nächster echter Nummer |
| `UPDATE` Nummer | weiterhin **blockiert** (`prevent_*`) |

### Nicht per RPC nutzbar (Client-Rollen)

- `next_customer_number()`
- `next_case_number(timestamptz)`
- `format_customer_number(bigint)`
- `format_case_number(integer, bigint)`

Trigger-Funktionen `assign_*` / `prevent_*` bleiben für Insert/Update-Pipeline zuständig; Rückgabetyp `trigger` wird von PostgREST nicht als RPC exponiert.

### Freigabe globale Suche

**Welle 6d freigegeben** — Hardening schließt die offenen QA-Befunde (RPC-Verbrauch, Client-Fake-Nummern).

### Verifikation (2026-06-28, `npx supabase db reset --local`)

| Test | Ergebnis |
|---|---|
| Migration `20260628140000` nach Reset | ✅ angewendet |
| `has_function_privilege('authenticated', next_customer_number)` | ✅ `false` |
| `has_function_privilege('anon', next_case_number)` | ✅ `false` |
| `SET ROLE authenticated` + `next_customer_number()` | ✅ `permission denied for function` |
| `INSERT` mit `KD-888888` | ✅ gespeichert als `KD-000002` (überschrieben) |
| `INSERT` mit `VG-2099-000099` | ✅ gespeichert als `VG-2026-000001` (überschrieben) |
| `UPDATE customer_number` / `case_number` | ✅ `is immutable` |
| NULL / Duplikate | ✅ 0 |

## Welle 6c-QA — Datenbank-Audit (2026-06-28)

### Durchgeführte Prüfungen

| Prüfung | Ergebnis |
|---|---|
| `npx supabase db reset --local` | ✅ Alle Migrationen inkl. `20260628130000` reproduzierbar |
| `npm run typecheck` / `npm run build` | ✅ nach Reset |
| Spalten `customer_number`, `case_number` | ✅ `text`, `NOT NULL` |
| Unique Constraints | ✅ `companies_customer_number_key`, `deals_case_number_key` |
| Tabelle `number_counters` | ✅ vorhanden |
| Funktionen (8 Stück) | ✅ alle vorhanden; `next_*` mit `SECURITY DEFINER` + `search_path = public` |
| Trigger (4 Stück) | ✅ `assign_*` + `prevent_*` auf `companies` / `deals` |
| NULL / Duplikate / Format | ✅ 0 Verstöße (auf QA-Testdaten + leerer Seed-DB) |
| Auto-Vergabe bei Insert | ✅ `KD-000001`, `KD-000002`; `VG-2026-000001` |
| Immutability | ✅ `UPDATE` → Exception `customer_number is immutable` / `case_number is immutable` |
| `companies_summary.customer_number` | ✅ Spalte vorhanden (letzte Spalte der View) |

### Bestätigte DB-Objekte

**Tabelle:** `public.number_counters` (`counter_key`, `year`, `last_value`, PK)

**Spalten:** `companies.customer_number`, `deals.case_number`

**Funktionen:** `format_customer_number`, `format_case_number`, `next_customer_number`, `next_case_number`, `assign_customer_number`, `assign_case_number`, `prevent_customer_number_change`, `prevent_case_number_change`

**Trigger:** `assign_customer_number_trigger`, `prevent_customer_number_change_trigger`, `assign_case_number_trigger`, `prevent_case_number_change_trigger`

### Security / RLS (Audit-Ergebnis)

| Thema | Befund | Bewertung |
|---|---|---|
| `number_counters` Table Grants | `anon` / `authenticated`: **kein** SELECT/INSERT (`has_table_privilege` = false) | ✅ Client kann Tabelle nicht direkt lesen/schreiben |
| Supabase Linter „RLS disabled“ | `number_counters` hat **kein** RLS aktiviert | ⚠️ Linter-Warnung; faktisch durch `REVOKE` abgesichert |
| `next_customer_number()` / `next_case_number()` | Per `GRANT` für `anon`/`authenticated` **aufrufbar** (PostgREST-RPC) | ⚠️ → **behoben in 6c-Hardening** (`REVOKE EXECUTE`) |
| Client setzt Nummer bei Insert | Wenn `customer_number`/`case_number` ≠ NULL mitgesendet wird, **kein** Override durch Trigger | ⚠️ → **behoben in 6c-Hardening** (`assign_*` überschreibt immer) |
| `SECURITY DEFINER` + `search_path` | `next_*` setzen `search_path = public` | ✅ bewusst und korrekt |

**Empfehlung:** ~~Hardening-Welle~~ **umgesetzt** in `20260628140000_numbering_api_hardening.sql`. Optional später: `ENABLE ROW LEVEL SECURITY` auf `number_counters` (Defense in Depth).

### Anti-Duplizierung (Code-Audit)

| Prüfpunkt | Ergebnis |
|---|---|
| Nummern als Tags | ✅ nicht gefunden |
| `case_number` in `deals.name` / Notizen | ✅ Demo-Seeds ohne VG-Präfix im Titel |
| Zweite Nummernlogik | ✅ nur `misc/numbering.ts` + DB-Funktionen (gleiches Format) |
| FakeRest vs. DB | ✅ gleiche Formate `KD-######` / `VG-YYYY-######` |
| UI editierbar | ✅ kein `TextInput` für Nummernfelder; nur `BusinessNumber` read-only |

### Freigabe nächste Welle

**Globale Suche (Welle 6d / v0.2e): freigegeben** — Nummernfelder sind in DB und Listen-`q`-Suche vorhanden; QA blockiert nicht.

Parallel empfohlen (nicht blockierend): ~~API-Hardening für Insert/RPC wie oben~~ **erledigt (6c-Hardening)**.

---

## A. Fachliches Ziel

Nora braucht feste, eindeutige Nummern für den operativen Alltag:

| Anwendungsfall | Warum eine Nummer nötig ist |
|---|---|
| **Telefonannahme** | Anrufer nennt „KD-000042“ — sofortiger Sprung zur Kundenakte ohne Namensverwechslung |
| **E-Mail-Rückfragen** | Betreff oder Signatur mit `VG-2026-000015` — eindeutiger Bezug zum Vorgang |
| **Angebot-/Vorgangsbezug** | Angebot, Rechnung und Nachfassung referenzieren dieselbe Vorgangsnummer |
| **Schnelle Suche** | Eingabe in Sekunden statt Durchsuchen von Namenslisten |
| **Eindeutige Zuordnung** | Mehrere „Müller“ oder mehrere Fenster-Vorgänge beim selben Kunden bleiben unterscheidbar |
| **Verwechslungen vermeiden** | Interne `id` (z. B. `7`) ist für Nutzer nicht merkbar und nicht kommunikationsfähig |

**Grundsatz:** Kundennummer und Vorgangsnummer sind **fachliche Primärschlüssel für Menschen** — ergänzend zur technischen `id`, nicht als Ersatz.

---

## B. Nummernformate

### Empfohlene Formate

| Typ | Format | Beispiel |
|---|---|---|
| **Kundennummer** | `KD-` + 6-stellig, nullgefüllt | `KD-000001` |
| **Vorgangsnummer** | `VG-` + Jahr + `-` + 6-stellig, nullgefüllt | `VG-2026-000001` |

### Begründungen

**Kundennummer ohne Jahresanteil**

- Ein Kunde ist ein **dauerhaftes** Geschäftsobjekt; die Nummer soll über Jahre stabil bleiben.
- Jahreswechsel darf keine neue Kundenidentität suggerieren.
- Einfacher zu merken und telefonisch zu diktieren (`KD` + sechs Ziffern).
- Kein jährlicher Reset nötig — Sequenz läuft monoton weiter.

**Vorgangsnummer mit Jahresanteil**

- Vorgänge sind **zeitgebundene** Ereignisse (Anfrage, Auftrag, Ticket).
- Das Jahr hilft bei Archivierung, Jahresauswertung und mündlicher Kommunikation („Vorgang 2026 …“).
- Parallele Nummernkreise pro Jahr sind möglich (offene Entscheidung, siehe Abschnitt I).
- Format bleibt auch mit Jahresanteil telefonisch gut nutzbar: Buchstabierhilfe `VG`, dann Jahr, dann laufende Nummer.

**Telefonische Nutzbarkeit**

- Präfixe `KD` / `VG` sind kurz und unterscheidbar.
- Bindestriche als Sprechpausen: „KD minus null null null null null eins“.
- Keine Sonderzeichen außer Bindestrich; nur Großbuchstaben im Präfix.
- Feste Länge der Ziffernblock(s) vermeidet Verwechslung mit Telefonnummern.

**Unveränderlichkeit nach Vergabe**

- Nummern werden in Telefonaten, E-Mails, Angeboten und ggf. externen Systemen zitiert.
- Nachträgliche Änderung bricht Referenzen und Vertrauen.
- Korrekturen erfolgen über neue Datensätze oder dokumentierte Sonderfälle (Admin), nicht im regulären UI.

---

## C. Empfohlene Datenfelder (noch nicht implementieren)

### `companies.customer_number`

| Eigenschaft | Wert |
|---|---|
| Spaltenname | `customer_number` |
| Typ | `text` (nicht `integer` — Präfix und führende Nullen bleiben erhalten) |
| Constraint | `UNIQUE`, nach Backfill `NOT NULL` |
| Vergabe | Serverseitig bei `INSERT`, nie vom Client vorgegeben |
| Änderung | Nach Vergabe **unveränderlich** (DB-Trigger + keine UI-Felder) |
| Index | Unique Index für exakte Suche und Kollisionsprüfung |

### `deals.case_number`

| Eigenschaft | Wert |
|---|---|
| Spaltenname | `case_number` |
| Typ | `text` |
| Constraint | `UNIQUE`, nach Backfill `NOT NULL` |
| Vergabe | Serverseitig bei `INSERT` |
| Änderung | Nach Vergabe **unveränderlich** |
| Index | Unique Index |

### Views anpassen (später)

- `companies_summary`: `customer_number` aufnehmen (Listen, globale Suche).
- Kein separates View für Deals nötig, sofern `deals` direkt genutzt wird; ggf. Kanban-Queries erweitern.

### TypeScript (später)

- `Company.customer_number: string`
- `Deal.case_number: string`

### Optionale Felder (spätere Wellen, nicht Teil von 6b)

| Feld | Tabelle | Zweck |
|---|---|---|
| `source_channel` | `deals` oder `companies` | Herkunft: Telefon, Website, Empfehlung |
| `created_from` | `deals` | z. B. `manual`, `email`, `import` |
| `external_reference` | `deals` | Fremdsystem-ID (ERP, Ticketing) |

Diese Felder **ersetzen nicht** `case_number` / `customer_number`.

---

## D. Nummerngenerierung

### Warum nicht nur im Frontend?

| Risiko bei Client-Generierung | Auswirkung |
|---|---|
| Race Conditions | Zwei Nutzer legen gleichzeitig an → gleiche Nummer |
| Offline / Demo-Drift | FakeRest und Produktion divergieren |
| Manipulation | API-Client kann beliebige Nummern senden |
| Kein Single Source of Truth | CSV, Notizen und DB widersprechen sich |

**Regel:** Nummern werden **ausschließlich serverseitig** vergeben (Postgres-Funktion + Trigger oder RPC, der nur intern aufgerufen wird).

### Empfohlene Postgres-Strategie

```
┌─────────────────────────────────────────────────────────┐
│  INSERT companies / deals                               │
│       ↓                                                 │
│  BEFORE INSERT TRIGGER                                  │
│       ↓                                                 │
│  assign_customer_number() / assign_case_number()        │
│       ↓                                                 │
│  nextval(sequence) oder Jahr-Tabelle mit FOR UPDATE     │
│       ↓                                                 │
│  Formatierung KD-000042 / VG-2026-000015                │
│       ↓                                                 │
│  UNIQUE constraint fängt Restkollisionen ab              │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  UPDATE companies / deals                               │
│       ↓                                                 │
│  BEFORE UPDATE TRIGGER                                  │
│       ↓                                                 │
│  IF OLD.customer_number IS DISTINCT FROM NEW... → RAISE │
└─────────────────────────────────────────────────────────┘
```

**Komponenten:**

1. **Sequenzen**
   - `customer_number_seq` — global, monoton.
   - `case_number_seq` — entweder global mit Jahr aus `created_at` im Format **oder** pro Kalenderjahr eine Zeile/Sequenz (siehe offene Entscheidung).

2. **Funktionen** (`02_functions.sql`-Format)
   - `format_customer_number(bigint) → text`
   - `format_case_number(year int, seq bigint) → text`
   - `next_customer_number() → text` — `SELECT nextval(...)` + Format.
   - `next_case_number(p_created_at timestamptz) → text` — Jahr aus Zeitstempel.

3. **Trigger**
   - `BEFORE INSERT`: `assign_*` setzt **immer** die nächste DB-Nummer (Client-Werte werden überschrieben; seit 6c-Hardening).
   - `BEFORE UPDATE`: Änderung an Nummernfeldern verbieten (`RAISE EXCEPTION`).

4. **RLS / API**
   - PostgREST-Clients dürfen Nummernfelder bei `INSERT`/`UPDATE` nicht setzen (Trigger ignoriert Client-Werte oder Policy blockiert Spalte).
   - Optional: Spalten aus `authenticated`-Update-Rechten ausnehmen.

5. **Kollisionsfreiheit**
   - `nextval` ist in Postgres atomar.
   - Zusätzlich `UNIQUE` auf der Textspalte.
   - Bei seltenem Retry: Insert schlägt fehl → Transaktion wiederholen (nur serverseitig relevant).

### FakeRest / Demo

- **`beforeCreate`-Lifecycle** im FakeRest-`dataProvider` spiegelt dieselbe Logik wie die DB-Funktion (gemeinsame Hilfsfunktion in `src/.../numbering.ts` empfohlen).
- **`noraDemoSeed.ts`**: feste, dokumentierte Demo-Nummern vergeben (z. B. `KD-000001` … `KD-000005`), konsistent mit Sequenz-Start nach Seed-Reset.
- Kein zweites Nummernsystem in JSON/CSV — Demo-Nummern leben in `customer_number` / `case_number`.

---

## E. Backfill / Migration bestehender Daten

### Phasenmodell

| Phase | Zustand |
|---|---|
| 1 | Spalten `nullable`, Unique Index auf nicht-NULL-Werte (`UNIQUE` partial index) |
| 2 | Backfill-Skript (Migration oder einmalige SQL) |
| 3 | Sequenzen auf `MAX(numerischer_teil) + 1` setzen |
| 4 | `NOT NULL` Constraint aktivieren |
| 5 | Trigger für Neu-Anlage und Immutability |

### Backfill-Regeln

**Kunden (`companies`)**

- Alle Zeilen mit `customer_number IS NULL`.
- Sortierung: `ORDER BY created_at ASC, id ASC` (stabile Reihenfolge).
- Vergabe: `KD-000001`, `KD-000002`, … ohne Lücken in der Backfill-Reihenfolge.
- Bestehende `id` **nicht** ändern.
- Keine Duplikate: vor Vergabe prüfen, ob Unique verletzt würde.

**Vorgänge (`deals`)**

- Alle Zeilen mit `case_number IS NULL`.
- Sortierung: `ORDER BY created_at ASC, id ASC`.
- Jahr für Format aus `created_at` (nicht Migrationsdatum).
- Beispiel: Vorgang von 2024 → `VG-2024-000001` (laufende Nummer **pro Jahr** oder global — siehe Entscheidung I).

**Demo-/Alt-Daten**

- FakeRest-Daten beim nächsten Seed mit Nummern erzeugen.
- Produktions- und Demo-Nummernkreise können getrennt bleiben (verschiedene Supabase-Projekte); innerhalb eines Projekts ein Kreis.

**Rollback-Sicherheit**

- Backfill in Transaktion.
- Vor `NOT NULL`: Stichprobe und Zähler `COUNT(*) WHERE customer_number IS NULL` = 0.

---

## F. Globale Suche

### Implementierungsstatus (Welle 6d / v0.3a)

| Aspekt | Umsetzung |
|---|---|
| UI | `GlobalSearch.tsx` — Desktop inline im `Header`, Mobile Such-Icon in `MobileNavigation` (Overlay) |
| Logik | `misc/globalSearch.ts` + `dataProvider.globalSearch()` |
| DB | **Keine** neue Migration — bestehende `q`-/`@or`-Suche und `@eq` auf Nummernfelder |
| Direktnavigation | `KD-*` / `VG-YYYY-*` → exakter `@eq`-Treffer → `/kunden/:id/show` bzw. `/vorgaenge/:id/show` |
| Gruppierung | Max. 5 Treffer je Kunden / Ansprechpartner / Vorgänge |
| Debounce | 300 ms |
| Mindestlänge | 2 Zeichen (außer KD-/VG-Muster) |
| Telefon | Leerzeichen, Bindestriche, Klammern entfernt — **keine** +49/0-Umstellung (später) |
| Auth | Nur eingeloggt (`requireAuth`); nicht auf öffentlicher Landingpage |

### Platzierung

- Suchfeld im **Header** (`Header.tsx` / `MobileHeader.tsx`) — zentral, immer erreichbar.
- Platzhalter z. B. „Kundennummer, Vorgang, Name, Telefon …“
- Tastaturkürzel optional später (z. B. `/` oder `Strg+K`).

### Suchziele

| Eingabe / Treffertyp | Quellen | Priorität |
|---|---|---|
| Exakte Kundennummer (`KD-000042`) | `companies.customer_number` | Höchste → Direktnavigation |
| Exakte Vorgangsnummer (`VG-2026-000015`) | `deals.case_number` | Höchste → Direktnavigation |
| Firmen-/Kundenname | `companies.name` | Trefferliste |
| Ansprechpartnername | `contacts.first_name`, `last_name` | Trefferliste |
| Telefon | `companies.phone_number`, `contacts.phone_jsonb` | Trefferliste |
| E-Mail | `contacts.email_jsonb` | Trefferliste |
| Adresse | `companies.address`, `zipcode`, `city` | Trefferliste |
| Vorgangstitel | `deals.name` | Trefferliste |

### Verhalten

```
Nutzer tippt Suchbegriff
        │
        ├─ Exakt KD-* (Regex) ──► 0 Treffer → Hinweis
        │                         1 Treffer → /kunden/:id/show
        │                         >1 (unwahrscheinlich) → Liste
        │
        ├─ Exakt VG-YYYY-* ──► analog → /vorgaenge/:id/show
        │
        └─ Sonst ──► parallele Suche über Ressourcen
                      │
                      ├─ Treffer gruppiert:
                      │     Kunden (companies)
                      │     Ansprechpartner (contacts)
                      │     Vorgänge (deals)
                      │
                      └─ Klick → deutsche Show-Route
```

### Technische Umsetzung (Empfehlung für v0.2e)

**Option A – Frontend-orchestriert (schneller, mehr HTTP)**

- Custom DataProvider-Methode `globalSearch(query)`.
- Drei `getList`-Aufrufe mit erweitertem `q` / exakten Filtern.
- Nummernfelder in `applyFullTextSearch`-Spaltenlisten aufnehmen.
- Exakte Nummer: zusätzlich `customer_number@eq` / `case_number@eq`.

**Option B – Postgres-RPC (skalierbarer, eine Roundtrip)**

- View oder Funktion `search_crm(p_query text)` mit `UNION ALL` und Ranking.
- Exakte Nummernmatches zuerst.
- Frontend ruft RPC über custom DataProvider auf.

**Empfehlung:** Für Nora-v0.2 zunächst **Option A** (weniger Backend-Risiko); bei Performance-Problemen **Option B**.

### Routing (deutsch)

| Resource | Listen | Detail |
|---|---|---|
| Kunden | `/kunden` | `/kunden/:id/show` |
| Kontakte | `/kontakte` | `/kontakte/:id/show` |
| Vorgänge | `/vorgaenge` | `/vorgaenge/:id/show` |

Navigation ausschließlich über `noraCreatePath({ resource, type: 'show', id })`.

### Telefonnummern

- Optional Normalisierung (Leerzeichen, `+49`/`0`) — **offene Entscheidung** (Abschnitt I).
- Bis zur Entscheidung: Suche zusätzlich auf normalisierte Variante (Ziffernfolge) vorbereiten, aber Nummernfelder nicht durch Telefonsuche ersetzen.

---

## G. UI-Auswirkungen (spätere Wellen)

| Stelle | Kundennummer | Vorgangsnummer |
|---|---|---|
| Kundenliste | Spalte oder Subtitle unter Name | — |
| Kundenakte (Show) | Kopfbereich, neben Name | — |
| Vorgangsliste / Kanban-Karte | Referenz auf Kunde optional | Prominent auf Karte |
| Vorgangsdetail | Verknüpfter Kunde mit KD-Nummer | Kopfbereich |
| Suchergebnisse | Badge/Subtitle | Badge/Subtitle |
| E-Mail-/Telefonnotizen | Automatisch nicht editierbar; Copy-Button optional | In Vorlagen referenzierbar |

**Formulare:** Keine Eingabefelder für Nummern — nur Anzeige nach Anlage.

**i18n:** Labels „Kundennummer“, „Vorgangsnummer“ (oder „Ticket-ID“) in `germanCrmMessages.ts`.

---

## H. Anti-Duplizierungsregeln

Diese Regeln ergänzen `03-data-model-guardrails.md` (Falle 8 ff.).

1. **Kundennummer nicht als Tag** — Tags sind Markierungen, keine Identifikatoren.
2. **Vorgangsnummer nicht in Titel oder Notiz** — `deals.name` und Notizen beschreiben den Inhalt; die Nummer lebt in `case_number`.
3. **Telefonnummer ≠ Ersatz für KD/VG** — Telefonsuche ist Ergänzung, nicht Primärschlüssel (Nummern können mehrfach vorkommen, Nummern nicht).
4. **Nummern nie nachträglich ändern** — weder UI noch Import noch Admin-Routine ohne dokumentierten Ausnahmeprozess.
5. **Kein paralleles Nummernsystem** — nicht in CSV, Demo-JSON, Tags und DB getrennt pflegen.
6. **`customer_number` und `case_number` sind führend** — in Kommunikation, Suche und Integration immer diese Felder referenzieren.
7. **Technische `id` nicht in der UI als „Nummer“ zeigen** — vermeidet Verwechslung mit KD/VG.

---

## I. Offene Entscheidungen (Projektinhaber)

| # | Frage | Optionen | Empfehlung (vorläufig) |
|---|---|---|---|
| 1 | UI-Label Vorgang | „Vorgangsnummer“ vs. „Ticket-ID“ | **Vorgangsnummer** (konsistent mit Domänensprache) |
| 2 | Kunden-Präfix | `KD` vs. `K` | **`KD`** (eindeutiger, weniger Verwechslung mit „Kunde“ mündlich) |
| 3 | Vorgangsnummer jährlicher Reset | Pro Jahr ab `000001` vs. durchlaufende Sequenz mit Jahressegment nur informativ | **Pro Jahr reset** — passt zu `VG-2026-…`-Format |
| 4 | Globale Suche vs. Migration | Suche erst nach Nummern in DB vs. parallel | **Erst Nummern (v0.2b–d), dann Suche (v0.2e)** |
| 5 | Telefon-Normalisierung | Strikt normalisieren vs. Rohtext-`ilike` | **Normalisierung** für DE-Nummern (`+49`, führende 0, Leerzeichen) |

---

## J. Umsetzungsempfehlung in Phasen

| Phase | Inhalt | Abhängigkeiten |
|---|---|---|
| **v0.2a** | Spezifikation + Dokumentation | ✅ Welle 6b |
| **v0.2b–c** | DB, Generierung, Backfill | ✅ Welle 6c |
| **v0.2d** | Anzeige in Listen/Details | ✅ Welle 6c |
| **v0.2e** | Globale Suche im Header | ✅ Welle 6d |
| **v0.2f** | CSV-/Import-Regeln | offen |

---

## Referenzen im Code (Ist)

- Schema: `supabase/schemas/01_tables.sql`, `03_views.sql`
- Suche: `src/components/atomic-crm/providers/supabase/dataProvider.ts` (`applyFullTextSearch`)
- Header: `src/components/atomic-crm/layout/Header.tsx`
- Routen: `src/components/atomic-crm/routing/noraRoutes.ts`
- Demo: `src/components/atomic-crm/providers/fakerest/dataGenerator/noraDemoSeed.ts`
- Typen: `src/components/atomic-crm/types.ts`
