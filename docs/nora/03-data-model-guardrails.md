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

## Datenmodell-Erweiterungen – Kandidaten

Nur bei belegtem Bedarf:

| Feld / Tabelle | Zweck |
|---|---|
| `customer_type` | dedizierter Kundentyp statt `sector` |
| `priority` | Dringlichkeit am Vorgang |
| `service_type` | Dienstleistung am Vorgang |
| `objects` / `sites` | Baustelle / Objekt |
| `measurements` | Aufmaßdaten |
| `manufacturer_status` | Wartet auf Hersteller, Lieferant, Ersatzteil |
| `source_channel` | Google Ads, Website, Telefon, WhatsApp, Empfehlung |
| `files` / `photos` | Fotos, PDF, Angebot, Aufmaß |

## Migrationsregel

Vor einer Migration dokumentieren:

- Warum ist das Feld nötig?
- Welche bestehenden Workflows belegen den Bedarf?
- Welche alten Daten müssen migriert werden?
- Welche UI-Stellen müssen angepasst werden?
- Gibt es eine rückwärtskompatible Lösung?
