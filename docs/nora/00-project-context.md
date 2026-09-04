# 00 – Projektkontext Nora CRM

Status: CURRENT · Zweck: ONBOARDING / PRODUKT-NORDSTERN · Zuletzt geprüft: 2026-09-04

## Was ist Nora?

Nora ist die interne Kunden- und Vorgangsverwaltung der Ergart Gruppe. Sie unterstützt das Büro bei Kunden, Ansprechpartnern, Vorgängen, Aufgaben, Notizen und der Nachvollziehbarkeit von Änderungen.

Nora ist ein **Produktivsystem mit echten Geschäftsdaten** (`nora.ergart.de`). Sie ist kein generisches Sales-CRM, kein ERP, kein Rechnungsprogramm und kein Field-Service-System mit Monteurplanung.

## Welches Geschäft unterstützt Nora?

Ergart arbeitet regional in Nordrhein-Westfalen im Fenster- und Hausmeisterservice (Fenstertausch, Reparatur, Wartung, Objektbetreuung, Immobilienservice). Ein typischer Ablauf: Anfrage per Telefon oder E-Mail → Kunde und Ansprechpartner finden oder anlegen → Vorgang mit Status, Dienstleistung und Nachfassdatum führen → Aufgaben und Notizen → Angebot, Herstellerbestellung, Montage → Abschluss.

Die Vorgangsstatus (z. B. „Aufmaß geplant", „Wartet auf Hersteller", „Angebot gesendet", „Rückmeldung ausstehend") beschreiben diesen Arbeitsstand, keine Sales-Pipeline.

## Wer nutzt Nora?

Produktsicht (Nutzergruppen):

| Nutzergruppe | Typische Arbeit |
|---|---|
| Büro / Sachbearbeitung | Anfragen erfassen, Kunden und Vorgänge pflegen, nachfassen, Aufgaben führen |
| Operative Verantwortliche (Chef, Meister) | Überblick, Freigaben, Statusentscheidungen, Herstellerbestellungen |
| Administration | Benutzer, Rollen, Konfiguration, Integrationen |

Die meisten Nutzer sind keine technischen Anwender. Sie arbeiten am Desktop und am iPad, oft während eines Telefonats.

Technische Autorisierungsrollen (in `sales.role`, nicht dasselbe wie die Nutzergruppen oben): `viewer` (nur lesen) · `office` (operativ schreiben, nicht löschen, keine Verwaltung) · `admin` (alles). Details: `11-google-calendar-rbac.md` Abschnitt C, Guardrails in `03`.

## Kernobjekte und Begriffe

Interne Namen stammen aus Atomic CRM und bleiben stabil. Sichtbar ist Nora vollständig deutsch.

| Technisch | Sichtbar in Nora | Bedeutung |
|---|---|---|
| `companies` | Kunden (Kundenakte) | Firma, Hausverwaltung, Gewerbe oder Privatperson (`customer_kind`) |
| `contacts` | Kontakte / Ansprechpartner | natürliche Person, meist einem Kunden zugeordnet; max. ein Hauptansprechpartner pro Kunde |
| `deals` | Vorgänge | Anfrage, Angebot, Auftrag, Nachfassung — der operative Geschäftsfall |
| `tasks` | Aufgaben | Rückruf, Besichtigung, Aufmaß, Nachfassen; mit Kunden- und/oder Kontaktbezug |
| `contact_notes` / `deal_notes` | Notizen | Freitext zur Person oder zum Vorgang |
| `tags` | Markierungen | fachliche Kennzeichnung |
| `sales` | Mitarbeiter / Benutzer | Nora-Benutzer mit Rolle; „Zuständig" an Vorgängen |
| `audit_events` | Änderungsverlauf / Änderungshistorie | append-only Protokoll fachlicher Änderungen |
| `stage` | Vorgangsstatus | Arbeitsstand, keine Sales-Stage |
| `expected_closing_date` | Nächster Kontakttermin / Nachfassdatum | kein Kalendertermin |
| `amount` | Geschätzter Auftragswert | Euro, `0` = noch nicht kalkuliert |
| `sector` | Kundentyp | Hausverwaltung, Gewerbe, Privatkunde, … |
| `customer_number` / `case_number` | Kundennummer `KD-000001` / Vorgangsnummer `VG-2026-000001` | serverseitig vergeben, unveränderlich |

Weitere Produktbegriffe: **Schnellerfassung** (Quick Capture: Kunde → Ansprechpartner → Vorgang in einem Dialog), **Hotboard** (operative Startübersicht), **Arbeitsboard** (Lesekurzansicht im Hotboard), **Vorgangsübersicht** (Kanban unter `/vorgaenge`).

Vollständiges Domänenmodell: `01-domain-model.md`. Begriffsregeln für die Oberfläche (kein „Deal", „Pipeline", „Opportunity"): `02-design-system.md`.

## Produktziele

1. Tägliche Büroarbeit beschleunigen — eine Anfrage in unter zwei Minuten erfassen, ohne Doppeleingaben.
2. Zusammenhänge zwischen Kunde, Ansprechpartner und Vorgang jederzeit verständlich machen.
3. Relevante Informationen schnell wiederfinden (Kunden-/Vorgangsnummer, globale Suche, Hotboard).
4. Änderungen sicher und nachvollziehbar machen (Rollen, Audit, atomare Schreibpfade).
5. Geringe kognitive Last und hohe Lesbarkeit auf Desktop und iPad.
6. Ohne externe KI vollständig nutzbar bleiben.
7. Künftige Schnittstellen (Automatisierung, API, eventuell KI-Clients) sollen auf stabile Nora-Anwendungsoperationen aufsetzen können, nicht auf Rohdaten. Das ist eine Richtung, kein Versprechen (`15-architecture.md`).

## Nicht-Ziele

Nora soll nicht werden:

- ein generisches Sales-Dashboard oder eine Pipeline-Verkaufssteuerung
- ein System, in dem Fachlogik in UI-Komponenten dupliziert wird
- eine Datenbank, die externen Clients direkt (SQL/PostgREST-Tabellen) freigegeben wird
- ein ERP, Rechnungs- oder Angebotsmodul, GoBD-Archiv, Hersteller-/Lieferantenmodul
- ein Field-Service-System mit Monteur- und Terminplanung (Termine bleiben im Google Kalender)
- eine Microservice-, CQRS- oder Event-Bus-Architektur ohne konkreten Bedarf
- eine KI-abhängige Anwendung

## UX-Richtung

Nora soll sich wie ein professionelles Arbeitsinstrument anfühlen: schnell, ruhig, lesbar, verständlich, klare Hierarchie, kurze Wege, hochwertig ohne Dekoration. Hell- und Dunkelmodus, Reduced Motion und Touch-Ziele ab 44 px sind Pflicht.

Der verbindliche Design-Vertrag steht in `02-design-system.md`. Ein größeres „Premium-UI/Motion"-Redesign wird erkundet, ist aber **nicht** implementiert; nichts davon darf als vorhanden beschrieben werden.

## Herkunft: Atomic CRM

Nora ist aus Atomic CRM (marmelab) hervorgegangen. Konsequenzen heute:

- Interne Resource-, Tabellen- und Legacy-Routennamen bleiben englisch; sichtbare Texte und URLs sind deutsch (`04`).
- Geerbte Dateien und Werkzeuge (`README.md`, `doc/`, `CONTRIBUTING.md`, Upstream-Skills, MCP-Edge-Function) sind kein Nora-Produktverhalten. Nora-Dokumentation und Decision Log haben Vorrang.
- Einige Kompatibilitätspfade existieren bewusst weiter (englische Redirects, Legacy-Spalten, alte Status-IDs im Mapping).

## Grundsatz

Nora löst nicht jedes Problem sofort. Zuerst wird geprüft, wie weit Konfiguration und UI reichen. Datenmodell-Erweiterungen erfolgen erst, wenn ein echter fachlicher Bedarf durch reale Vorgänge belegt ist und eine Entscheidung im `06-decision-log.md` steht.
