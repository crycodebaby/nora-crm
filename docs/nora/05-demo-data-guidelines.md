# 05 – Demo-Daten-Guidelines

## Zweck der Demo-Daten

Demo-Daten sollen fachliche Nutzbarkeit prüfen, nicht nur Tabellen füllen.

Sie müssen realistisch genug sein, damit UI-, Workflow- und Datenmodellprobleme sichtbar werden.

## Datenschutz

Demo-Daten sind synthetisch. Keine echten personenbezogenen Daten verwenden.

Empfohlen:

- fiktive Namen
- fiktive Firmen
- Demo-E-Mail-Domains wie `nora-demo.local` oder `*-demo.local`
- Telefonnummern mit klaren Demo-Mustern (`+49 211 000 …`)
- plausible, aber nicht zu echte Kundengeschichten

## Regionale Ausrichtung (Welle v0.3f Demo-Daten)

**FakeRest-Quelle:** `src/components/atomic-crm/providers/fakerest/dataGenerator/noraDuesseldorfSeedData.ts`

Region Düsseldorf / Neuss / Umgebung:

- Düsseldorf, Neuss, Meerbusch, Kaarst, Ratingen, Erkrath, Dormagen

Referenz-JSON (Dokumentation/Import): `demo-data/nora_demo_seed_duesseldorf_neuss.json`

## Datenumfang (FakeRest / `npm run dev:demo`)

| Entität | Anzahl |
|---------|--------|
| Kunden (`companies`) | 25 |
| Ansprechpartner (`contacts`) | 30 |
| Vorgänge (`deals`) | 20 |
| Aufgaben (`tasks`) | 20 |
| Kontakt-Notizen | 10 |
| Vorgangs-Notizen | 6 |

Nummern werden beim Seed vergeben: `KD-000001`, `VG-2026-000001` (über `assignCustomerNumbers` / `assignCaseNumbers`).

## Mindestabdeckung Demo

Eine gute Demo enthält:

- Privatkunde, Hausverwaltung, Gewerbekunde, Bestandskunde, Neukunde, Lieferant/Hersteller, Sonstiges
- abgeschlossener / abgelehnter Vorgang
- Vorgang wartet auf Hersteller
- Vorgang mit überfälligem Nachfassdatum (Hotboard)
- Vorgang ohne Auftragswert (`amount: 0`)
- Kunde mit mehreren Ansprechpartnern (z. B. Rheinbogen)
- Kunde ohne Ansprechpartner (z. B. WEG Königsallee 12)
- Ansprechpartner ohne E-Mail, nur Telefon (z. B. Hausmeister Hansen)
- ähnliche Kundennamen / gleiche E-Mail für Dubletten-Tests (Becker, Schneider)
- Fensterservice- und Hausmeisterdienst-Vorgänge

## Hotboard-Abdeckung

Die Demo-Vorgänge füllen bewusst:

- **Heute nachfassen / überfällig** — `expected_closing_date` heute oder in der Vergangenheit
- **Neue Anfragen** — `stage: neue-anfrage`
- **Wartet auf Hersteller** — `stage: wartet-auf-hersteller`
- **Angebote nachfassen** — `angebot-gesendet` / `nachfassen`
- **Offene Aufgaben** — überfällige und heutige Tasks

**Produktionsfreigaben** (`FENS_PRODUCTION_RELEASE`): nur im lokalen Supabase-Modus (`make start`), nicht in `dev:demo` — Checklisten-UI ist dort bewusst deaktiviert.

## Testvorgänge

Vorgänge sollen konkrete Arbeit beschreiben:

- Fenstergriff Wohnzimmer defekt
- Haustür Mehrfamilienhaus schließt nicht richtig
- Balkontür schließt nicht richtig
- Aufmaß für Fenstertausch
- Kellerfenster undicht
- Treppenhausbeleuchtung prüfen (Hausmeister, ohne Checkliste)
- Wohnungsübergabe vorbereiten
- Angebot für neue Haustür
- Montage terminieren

## Aufgaben

Aufgaben sollen handlungsorientiert sein:

- Rückruf, Besichtigung, Aufmaß, Herstelleranfrage
- Angebot erstellen / nachfassen
- Termin vereinbaren, Dokumentation

## Globale Suche testen

Demo-Daten enthalten durchsuchbare:

- KD-Nummern (`KD-000001` …)
- VG-Nummern (`VG-2026-000001` …)
- Kundennamen (z. B. „Rheinbogen“, „Becker“, „Schneider“)
- Telefonnummern (`+49 211 000 41 02`, `+49 2131 000 88 01`)
- E-Mails (`sabine.becker@nora-demo.local` — Dubletten-Test)

## Auftragswerte (Demo)

Auftragswerte in der Düsseldorf-/Neuss-Demo müssen dem **realistischen Geschäftsvolumen** eines lokalen Fenster- und Hausmeisterservice passen.

| Regel | Wert |
|-------|------|
| Fensterservice max. | 20.000 € pro Vorgang |
| Hausmeisterservice max. | 6.000 € (größerer Objektauftrag) |
| Gesamt-Pipeline (20 Vorgänge) | ca. 60.000–120.000 € |
| `amount = 0` | „Noch nicht kalkuliert“ — nicht automatisch kostenlos |
| Sechsstellige Einzelaufträge | **Nicht zulässig** in diesem Demo-Datensatz |

Beträge dienen **UX-, Kanban- und Dashboard-Tests**, nicht als Preis- oder Angebotsvorgabe.

**Quelle:** `amountEur` in `noraDuesseldorfSeedData.ts` — Werte in **Euro**, 1:1-Mapping auf `deals.amount` in FakeRest.

### Kategorieverteilung (20 Vorgänge)

| Kategorie | Anzahl |
|-----------|--------|
| `fensterservice` | 13 |
| `hausmeisterdienst` | 4 |
| `reparatur` | 2 |
| `wartung` | 1 |

Gesamtsumme der Demo-Pipeline: **60.020 €** (Stand Seed-Korrektur).

## Import-Hinweis

Für Kontakte kann ein CSV im Atomic-/Nora-Exportformat verwendet werden (`demo-data/nora_contacts_import_duesseldorf_neuss.csv`).

Für relationale Demo-Daten ist die TypeScript-Seed-Datei die Quelle der Wahrheit; JSON dient als lesbare Dokumentation.
