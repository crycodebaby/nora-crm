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

**Historische Zieldefinition, seit 2026-08-25 überholt:** „Produktives System
mit echten Kundendaten" stand ursprünglich hier als Nicht-Ziel. Seit der
Customer & Contact Workflow Wave läuft Nora produktiv unter `nora.ergart.de`
gegen die Supabase-Produktionsdatenbank `nora-crm-prod` mit realen
Kundendaten (verifiziert 2026-08-25, siehe `06-decision-log.md` und
`16-current-state.md`). Die Zeile bleibt hier stehen, um die ursprüngliche
v0.1-Zielsetzung nachvollziehbar zu halten, ist aber **keine aktuelle
Aussage mehr**.

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
