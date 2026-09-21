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

## Notiz-Anhänge im Demo-Modus — die Paritätsgrenze (W8-C S5, 2026-09-21)

FakeRest spricht seit W8-C S5 denselben **Lesevertrag** für Notiz-Anhänge wie der Supabase-Provider, simuliert aber
**nicht** die Datenbankseite dahinter. Diese Grenze ist bewusst und muss bekannt sein, bevor jemand aus einem grünen
Demo-Lauf auf Production schließt:

- **FakeRest bildet `public.attachments` nicht nach.** Es gibt keine Metadatentabelle, keine Projektion, keine
  Anhang-Grammatik, keine Referenz-Zulassung und keine Löschintent-Warteschlange. Demo-Anhänge tragen keinen
  Objektschlüssel (`path`).
- **FakeRest führt keine relationale Paritätsprüfung durch.** Es gibt nichts, wogegen geprüft werden könnte.
- **Jede Demo-Notiz wird mit dem Lesezustand `ok` ausgeliefert** — damit die Demo-Oberfläche nicht dauerhaft
  degradiert wirkt. **Das ist eine Setzung, kein geprüfter Zustand:** Demo-Daten verbürgen sich selbst.
- **Eine Teilaktualisierung erfindet keine Anhänge.** Ein Schreibvorgang, der das Anhangfeld gar nicht mitschickt,
  bleibt eine Teilaktualisierung; er setzt es nicht auf „leer" und löscht damit keine Demo-Anhänge.
- **Die Read-Model-Metadaten sind kein Demo-Geschäftsdatum** und werden nicht in den Demo-Datenbestand geschrieben.
  Sie gehören zum Lesevertrag, nicht zum Datensatz.

**Was die Demo damit beweist und was nicht:** sie beweist **UI- und Anwendungsverträge** (dass die Oberfläche mit dem
Read Model korrekt umgeht), **nie relationale Production-Konsistenz**. Ein `ok` aus FakeRest ist kein Beleg dafür,
dass eine Notiz in Production verbürgt wäre. Vollständiger Contract: [`22`](22-security-and-access.md) Abschnitt 6.12;
Invarianten: [`03`](03-data-model-guardrails.md) §1.8; offene Demo-Schuld: [`17`](17-known-issues-and-planned-waves.md) H.1.

## Onboarding-Simulation im Demo-Modus (V1B, 2026-09-04)

`/set-password?access_token=demo&refresh_token=demo` durchläuft im Demo-Modus den kompletten Mitarbeiter-Onboarding-Ablauf ohne Backend (Persona „Otto Office", 0,7 s simulierte Latenz). Szenarien: `&demo=weak` (Passwort abgelehnt), `&demo=profile-error`, `&demo=blocked`, `&demo=unverified`; ohne Token der ungültige Link. Nur hinter `VITE_IS_DEMO=true`, nicht im Production-Bundle — Details in `02-design-system.md` („Demo-Simulation").
