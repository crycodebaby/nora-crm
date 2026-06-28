# 01 – Fachliches Domänenmodell

## Zentrale fachliche Unterscheidung

Kunde ist nicht Vorgang.

Ein Kunde kann mehrere Ansprechpartner und mehrere Vorgänge haben.

Beispiel:

```text
Hausverwaltung Beispiel GmbH
  Ansprechpartner: Frau Keller
  Ansprechpartner: Herr Braun
  Vorgang: Haustür Mehrfamilienhaus schließt nicht richtig
  Vorgang: Fensterbeschläge im Treppenhaus prüfen
```

Später kann zusätzlich eine Objekt-/Baustellenebene nötig werden:

```text
Kunde
  Objekt / Baustelle
    Vorgang
      Aufgaben
      Notizen
      Dateien / Fotos
      Aufmaß
```

## Aktuelles Nora-v0.1-Modell

| Fachlich | Aktuell technisch | Bemerkung |
|---|---|---|
| Kunde | `companies` | B2C/B2B/Verwaltung/Gewerbe |
| Ansprechpartner | `contacts` | Person beim Kunden |
| Vorgang | `deals` | Anfrage, Auftrag, Angebot, Nachfassung |
| Aufgabe | `tasks` | Rückruf, Besichtigung, Angebot nachfassen |
| Notiz | `notes` | Kontakt- oder Vorgangsnotiz |
| Markierung | `tags` | fachliche Kennzeichnung |
| Kundentyp | `companies.sector` | vorläufig fachlich umgenutzt |

## Gewünschte Statuslogik für Vorgänge

Nora-Statuswerte:

- Neue Anfrage
- Kontaktiert
- Termin vereinbart
- Aufmaß geplant
- Aufmaß erledigt
- In Kalkulation
- Wartet auf Hersteller
- Angebot gesendet
- Nachfassen
- Angenommen
- Abgelehnt
- Abgeschlossen

Diese Werte beschreiben den Arbeitsstand und nicht klassische Sales-Stages.

## Aktuelle technische Einschränkungen

- Kein separates Feld `customer_type`
- Kein separates Feld `priority`
- Kein separates Objekt-/Baustellenmodell
- Kein Aufmaßmodell
- Kein Herstellerstatus am Vorgang
- Kein separates Nachfassdatum, sofern `expected_closing_date` dafür verwendet wird

## Entscheidungsregel

Ein neues DB-Feld darf erst eingeführt werden, wenn es nicht sauber über bestehende Felder oder Konfiguration abbildbar ist und ein konkreter Vorgang den Bedarf belegt.
