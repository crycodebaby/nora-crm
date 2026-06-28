# 05 – Demo-Daten-Guidelines

## Zweck der Demo-Daten

Demo-Daten sollen fachliche Nutzbarkeit prüfen, nicht nur Tabellen füllen.

Sie müssen realistisch genug sein, damit UI-, Workflow- und Datenmodellprobleme sichtbar werden.

## Datenschutz

Demo-Daten sind synthetisch. Keine echten personenbezogenen Daten verwenden.

Empfohlen:

- fiktive Namen
- fiktive Firmen
- Demo-E-Mail-Domains wie `nora-demo.local`
- Telefonnummern mit klaren Demo-Mustern
- plausible, aber nicht zu echte Kundengeschichten

## Regionale Ausrichtung

Für Demo-Daten können Regionen genutzt werden:

- Saarland, wenn Ergart-spezifisch
- Düsseldorf, Neuss und Umgebung für neutralere Testdaten

## Mindestabdeckung Demo

Eine gute Demo enthält:

- Privatkunde
- Hausverwaltung
- Gewerbekunde
- Bestandskunde
- Neukunde
- Lieferant / Hersteller
- abgeschlossener Vorgang
- abgelehnter Vorgang
- Vorgang wartet auf Hersteller
- Vorgang mit Nachfassung
- Vorgang mit Besichtigung/Aufmaß

## Testvorgänge

Vorgänge sollen konkrete Arbeit beschreiben:

- Fenstergriff Wohnzimmer defekt
- Haustür Mehrfamilienhaus schließt nicht richtig
- Aufmaß für neues Fensterelement
- Fensterbeschläge Gewerbeobjekt warten
- Hausmeisterdienst Objektübergabe
- Angebot Fensterbeschläge nachfassen

## Aufgaben

Aufgaben sollen handlungsorientiert sein:

- Rückruf
- Besichtigung
- Aufmaß
- Herstelleranfrage
- Angebot erstellen
- Angebot nachfassen
- Termin vereinbaren
- Dokumentation

## Import-Hinweis

Für Kontakte kann ein CSV im Atomic-/Nora-Exportformat verwendet werden.

Für relationale Demo-Daten ist JSON besser, weil Kunden, Kontakte, Vorgänge und Aufgaben zusammenhängen.
