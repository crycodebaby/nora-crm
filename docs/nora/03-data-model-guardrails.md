# 03 – Datenmodell-Guardrails

## Oberstes Ziel

Doppelte Datenhaltung und rekursive Modellfehler vermeiden.

## Grundregeln

1. Eine Information hat genau einen fachlich führenden Ort.
2. UI-Labels dürfen geändert werden, technische IDs nur mit Begründung.
3. Datenbankänderungen erfordern explizite Entscheidung.
4. Demo-Daten dürfen echte Architekturprobleme nicht verstecken.
5. Kein neues Feld, nur weil ein Formular leer wirkt.
6. Keine Resource-Namen blind umbenennen.

## Häufige Fallen

### Falle 1: Kunde und Ansprechpartner vermischen

Falsch:

```text
Firma als Kontakt speichern und zusätzlich als Kunde speichern.
```

Richtig:

```text
Kunde = Unternehmen / Haushalt / Verwaltung
Kontakt = Person beim Kunden
```

### Falle 2: Baustellenadresse doppelt pflegen

Später muss entschieden werden, ob Baustellenadressen eigene Objekte werden.

Bis dahin nicht willkürlich Adressen in mehrere Textfelder kopieren.

### Falle 3: Kundentyp in Tags, Sector und Notes gleichzeitig

Aktuell wird `sector` als Kundentyp verwendet. Nicht zusätzlich denselben Kundentyp als Tag speichern, außer es ist bewusst als Markierung gedacht.

### Falle 4: Vorgangsstatus und Aufgabenstatus vermischen

Vorgangsstatus beschreibt den Stand des Vorgangs.

Aufgabenstatus beschreibt, ob eine konkrete Aufgabe erledigt ist.

### Falle 5: Hersteller als Kunde missbrauchen

Lieferanten/Hersteller können in v0.1 als Kunden-/Firmen-Datensatz erscheinen, aber ein echtes Herstellerfeld am Vorgang existiert noch nicht. Nicht so tun, als sei das vollständig gelöst.

### Falle 6: Nachfassdatum doppelt pflegen

Aktuell ist **`expected_closing_date`** der führende Ort für „Nächstes Nachfassdatum“. Kein zusätzliches Nachfassfeld in Notizen oder Aufgaben als Ersatz einführen, solange kein DB-Feld beschlossen ist.

### Falle 7: Aufgaben direkt am Vorgang ohne Ansprechpartner

`tasks` haben **`contact_id`**, nicht `deal_id`. Aufgaben aus der Vorgangsansicht müssen über verknüpfte Ansprechpartner laufen — nicht so tun, als gäbe es eine direkte Vorgangs-Aufgaben-Relation in der DB.

### Falle 8: Kundennummer als Tag oder in Notizen

Falsch:

```text
Tag „KD-000042“ am Kontakt, weil die Kundennummer sonst nirgends steht.
```

Richtig:

```text
Führendes Feld companies.customer_number — einmalig, unique, unveränderlich.
```

### Falle 9: Vorgangsnummer im Titel oder in Freitextnotizen

Falsch:

```text
deals.name = „VG-2026-000015 Fenstergriff defekt“
```

Richtig:

```text
deals.case_number = VG-2026-000015
deals.name = Fenstergriff defekt
```

### Falle 10: Telefonnummer als Ersatz für KD/VG-Nummern

Telefonnummern können mehrfach vorkommen, sich ändern oder unvollständig sein. Sie eignen sich für Suche, aber **nicht** als Primärreferenz in Telefonannahme oder Angebotsbezug.

### Falle 11: Nummern nachträglich ändern oder im Frontend vergeben

Nummern werden serverseitig vergeben und dürfen nach Vergabe nicht geändert werden. Kein Eingabefeld im Formular, keine Client-Generierung bei `create`.

### Falle 12: Parallele Nummernsysteme (CSV, Demo, DB)

Nicht gleichzeitig Nummern in CSV-Spalten, Demo-JSON-Kommentaren und Datenbankfeldern pflegen. **`customer_number`** und **`case_number`** sind die einzige führende Quelle — siehe `08-numbering-and-global-search.md`.

### Falle 13: API-Umgehung der Nummernvergabe

**Behoben (6c-Hardening):** `assign_*`-Trigger vergeben immer serverseitig; `next_*`/`format_*` sind für `anon`/`authenticated` nicht per RPC ausführbar. Nora-UI sendet keine Nummern; FakeRest nutzt `misc/numbering.ts` nur im Demo-Modus.

## Datenmodell-Erweiterungen – Kandidaten

Nur bei belegtem Bedarf:

| Feld / Tabelle | Zweck |
|---|---|
| `companies.customer_number` | feste Kundennummer (`KD-000001`), unique, unveränderlich — **implementiert** (Welle 6c) |
| `deals.case_number` | feste Vorgangsnummer (`VG-2026-000001`), unique, unveränderlich — **implementiert** (Welle 6c) |
| `follow_up_date` | dediziertes Nachfassdatum, falls `expected_closing_date` wieder Abschlussdatum werden soll |
| `deal_id` an `tasks` | direkte Aufgaben am Vorgang ohne Umweg über Kontakt |
| `priority` | Dringlichkeit am Vorgang |
| `service_type` | Dienstleistung am Vorgang |
| `objects` / `sites` | Baustelle / Objekt |
| `measurements` | Aufmaßdaten |
| `manufacturer_status` | Wartet auf Hersteller, Lieferant, Ersatzteil |
| `source_channel` | Google Ads, Website, Telefon, WhatsApp, Empfehlung |
| `files` / `photos` | Fotos, PDF, Angebot, Aufmaß |
| `appointments` | Termine Aufmaß/Montage mit `deal_id`, Start/Ende |
| `manufacturer_id` / `manufacturer_name` | Herstellerbezug am Vorgang (generisch, nicht Höning-spezifisch) |
| `service_area_code` | `FENS` / `HAUS` / `IMMO` — Geschäftszweig, **nicht** Kunde — siehe `10-checklists-snippets-audit.md` |
| `checklist_templates` / `checklist_runs` / `checklist_run_items` | modulare Checklisten — **relational, nicht JSONB-only** — **implementiert** (v0.3d2) |
| `saved_text_snippets` | wiederverwendbare Textbausteine — **implementiert** (v0.3d2) |
| `audit_events` | zentrale append-only Audit-Log-Tabelle — **implementiert** (v0.3d2) |
| `workflow_type` | `general` vs. `window_order` — falls `category` nicht reicht |

**Veraltet / ersetzt durch 10:**

| Kandidat | Status |
|---|---|
| `production_checklist` (jsonb) | ❌ nicht als Hauptmodell — relationale Tabellen stattdessen |

### Falle 18: JSONB-only-Checkliste am Vorgang

Falsch:

```text
deals.production_checklist jsonb als einzige Quelle für Produktionsfreigabe
```

Richtig:

```text
checklist_templates + checklist_runs + checklist_run_items mit label_snapshot
```

Siehe `10-checklists-snippets-audit.md`.

### Falle 19: Servicebereich über company_id

Falsch:

```text
company_id oder sector als Ersatz für FENS/HAUS/IMMO
```

Richtig:

```text
service_area_code auf Vorlage, Lauf und Snippet — company_id bleibt Kunde
```

### Falle 20: Audit in Notizen oder Freitext

Falsch:

```text
„Produktion freigegeben von Max am 12.03.“ nur als Notiz
```

Richtig:

```text
checklist_run_items.checked_by + checked_at + audit_events
```

### Falle 21: Checklisten-ID in Notizen

Falsch:

```text
Notiz: „Checkliste abc-123-def erledigt“
```

Richtig:

```text
FK checklist_run_id in strukturierten Tabellen; Notiz optional als Kommentar am Punkt
```

## Checklisten- und Audit-Guardrails (Welle 7b)

Details in `10-checklists-snippets-audit.md`:

- relationale Tabellen als Hauptmodell — kein JSONB-only
- Vorlagenpunkte deaktivieren, nicht löschen
- Audit append-only — Client darf Events nicht ändern/löschen
- keine getrennten Audit-Tabellen pro Bereich
- Textbausteine persistent vor Plus/Minus-UI

## Fensterauftrag-Guardrails (Welle 7a)

Ergänzung zu den Fallen oben — Details in `09-window-order-workflow.md`:

### Falle 14: Chef-Unterstatus als Kanban-Spalten

Falsch:

```text
S4a, S4b, S4c, S5 jeweils eigene Pipeline-Spalte
```

Richtig:

```text
Hauptstatus „Wartet auf Hersteller“ + Checkliste am Vorgang
```

### Falle 15: Höning im Datenmodell verdrahten

Falsch:

```text
stage = hoehning-bestellt
```

Richtig:

```text
stage = wartet-auf-hersteller
Notiz oder manufacturer_name = „Höning“ (oder Lieferant-Datensatz)
```

### Falle 16: Kunden-Tracking-Link ohne Trennung

Falsch:

```text
Öffentliche URL zeigt interne Notizen, Einkaufspreise, Checklistenkommentare
```

Richtig:

```text
Eigenes Portal-Modul mit Token, vereinfachten Kundenstufen, DSGVO-Löschung
```

### Falle 17: Google als Prozesskern

Falsch:

```text
Zapier/Make verbindet Drive, Keep und Gmail als Workflow-Engine
```

Richtig:

```text
Nora = System of Record; Google Maps/Kalender optional als Layer (später)
```

## Migrationsregel

Vor einer Migration dokumentieren:

- Warum ist das Feld nötig?
- Welche bestehenden Workflows belegen den Bedarf?
- Welche alten Daten müssen migriert werden?
- Welche UI-Stellen müssen angepasst werden?
- Gibt es eine rückwärtskompatible Lösung?
