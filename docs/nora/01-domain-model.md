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
- Kein Herstellerstatus am Vorgang (Status „Wartet auf Hersteller“ ist ein Vorgangsstatus, kein Hersteller-Feld)
- Kein separates Nachfassdatum — **`expected_closing_date`** wird fachlich als „Nächstes Nachfassdatum“ genutzt
- **`sales_id`** am Vorgang = fachlich „Zuständig“ (Benutzer aus `sales`)
- Aufgaben hängen an **`contact_id`**, nicht direkt an `deal_id` — Aufgaben zum Vorgang laufen über die verknüpften Ansprechpartner

## Nachfassen (Welle 5)

| Fachlich | Technisch | Hinweis |
|---|---|---|
| Nächstes Nachfassdatum | `deals.expected_closing_date` | Überfällig/heute in Kanban, Detail und Dashboard sichtbar |
| Zuständig | `deals.sales_id` | Formular + Detailansicht; Default beim Anlegen = aktueller Benutzer |
| Vorgangsstatus | `deals.stage` | inkl. „Nachfassen“, „Wartet auf Hersteller“ |
| Aufgabe zum Vorgang | `tasks.contact_id` | über Ansprechpartner des Vorgangs |

## Entscheidungsregel

Ein neues DB-Feld darf erst eingeführt werden, wenn es nicht sauber über bestehende Felder oder Konfiguration abbildbar ist und ein konkreter Vorgang den Bedarf belegt.

## Fensterauftrag vs. allgemeiner Vorgang (Welle 7a)

Der Chef-Prozess für Fenstertausch/Fensterauftrag ist ein **Spezialworkflow**, nicht das Standardschema für alle Vorgänge.

| Fachlich | Technisch (v0.3) | Später |
|---|---|---|
| Fensterauftrag | `deals.category = fensterservice` | `workflow_type = window_order` |
| Allgemeiner Vorgang | andere `dealCategories` | `workflow_type = general` |

- **Hauptstatus** für Kanban: schlanke Pipeline (7–8 Meilensteine) — siehe `09-window-order-workflow.md`
- **Qualitätskontrollen** (Auftragsbestätigung, Vorkasse, Produktionsfreigabe): **Checkliste**, keine Kanban-Spalten
- **Hersteller** generisch modellieren — nicht an einen Lieferanten-Namen koppeln

Vollständige Spezifikation: `docs/nora/09-window-order-workflow.md`
