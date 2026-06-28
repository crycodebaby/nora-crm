# 00 – Projektkontext Nora CRM

## Ausgangslage

Nora CRM basiert auf Atomic CRM und wird für die Ergart-Gruppe beziehungsweise einen Hausmeister- und Fensterservice-Betrieb angepasst.

Bisher umgesetzt:

- Deutsche Oberfläche
- Nora-Branding
- Nora-Favicon und Manifest
- Deutsche URLs als Aliase: `/kontakte`, `/kunden`, `/vorgaenge`
- Interne Resource-Namen bleiben stabil: `contacts`, `companies`, `deals`
- Nora-Brandfarbe `#ff3b1f`
- Vorgänge statt Deals
- Euro-Formatierung statt Dollar
- Legacy-Mapping alter Atomic-Pipelinewerte
- Realistische Nora-Demo-Daten im FakeRest-Modus

## Ziel von Nora v0.1

Nora v0.1 soll ein vorführbarer und fachlich plausibler CRM-Prototyp sein, der realistische Kunden- und Vorgangsabläufe abbildet:

1. Kunde finden oder anlegen
2. Ansprechpartner erfassen
3. Vorgang anlegen
4. Status, Dienstleistung und Beschreibung pflegen
5. Nachfassdatum und Aufgaben nutzen
6. Vorgang später wiederfinden
7. Dashboard und Listen als Arbeitsübersicht verwenden

## Nicht-Ziel von v0.1

Nora v0.1 ist noch nicht:

- vollständiges ERP
- Rechnungsprogramm
- vollwertiges Angebotsmodul
- Field-Service-System mit Monteurplanung
- Hersteller-/Lieferantenmodul
- GoBD-Archiv
- Produktives System mit echten Kundendaten

## Wichtige fachliche Begriffe

| Technisch | Sichtbar Nora |
|---|---|
| contacts | Kontakte / Ansprechpartner |
| companies | Kunden |
| deals | Vorgänge |
| tasks | Aufgaben |
| tags | Markierungen |
| pipeline | Vorgangsübersicht |
| stage | Vorgangsstatus |
| expected closing date | Nächstes Nachfassdatum oder geplanter Abschluss |
| budget | Geschätzter Auftragswert |
| sector | aktuell als Kundentyp verwendet |

## Grundsatz

Nora soll nicht jedes Problem sofort lösen. Erst wird geprüft, wie weit Konfiguration und UI-Anpassungen reichen. Datenmodell-Erweiterungen erfolgen erst, wenn ein echter fachlicher Bedarf durch Testfälle sichtbar wird.
