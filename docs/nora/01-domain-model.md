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
- **Qualitätskontrollen** (Auftragsbestätigung, Vorkasse, Produktionsfreigabe): **Checkliste**, keine Kanban-Spalten — Datenmodell: `10-checklists-snippets-audit.md`
- **Servicebereiche** `FENS` / `HAUS` / `IMMO` über `service_area_code` — **nicht** über `company_id`
- **Hersteller** generisch modellieren — nicht an einen Lieferanten-Namen koppeln

Vollständige Spezifikationen:

- Fensterprozess: `docs/nora/09-window-order-workflow.md`
- Checklisten, Textbausteine, Audit: `docs/nora/10-checklists-snippets-audit.md`

## Schnellerfassung (Welle v0.3e)

Operativer Einstieg für neue Anfragen (Telefon, WhatsApp, E-Mail, Google Notizen/Kalender — **manuell**, ohne API):

```text
Suche Kunde → Ansprechpartner → Vorgang (+ optional Aufgabe)
```

- Erzeugt `companies` / `contacts` / `deals` / optional `tasks`
- Quelle vorerst in `deals.description` (`Quelle: …`)
- Nummern (`customer_number`, `case_number`) serverseitig wie bisher

## Google Kalender (Welle v0.4a)

Google Kalender bleibt das **einzige führende Terminsystem** für Zeit, Titel, Ort, Wiederholung und Existenz von Terminen.

| Fachlich | Technisch (Ziel) | Status |
|---|---|---|
| Geschäftskalender (ein Kalender) | `google_calendar_connections.calendar_id` | v0.4c.1 implementiert |
| Gespiegelte Termine | `google_calendar_events` (Cache + CRM-Verknüpfung) | v0.4c.1 implementiert |
| Termin-Herkunft | `origin` = `google` \| `nora` | v0.4c.1 (nur Import `google`) |
| CRM-Verknüpfung | `company_id`, `contact_id`, `deal_id` (bigint FKs) | v0.4c.1 RPC link/unlink |
| Hotboard „Heutige Termine“ | liest `google_calendar_events` | v0.4d geplant |
| Nora-Termin anlegen | Google API write scope, Extended Properties | v0.4e geplant |

**Nicht:** paralleles `appointments`-Modell, private iCal-Adresse, zweites Terminsystem in Nora.

Vollständige Spezifikation: `docs/nora/11-google-calendar-rbac.md`

## Rollenmodell (Welle v0.4a)

| Rolle | Zielnutzer | Kurz |
|---|---|---|
| `admin` | Chef / IT | Vollzugriff, Kalender verbinden, Rollen verwalten |
| `office` | Sekretärin / Büro | Operativer CRM-Alltag, Termine lesen/erstellen |
| `viewer` | schreibgeschützt | Nur Lesen |

Technisch an **`sales.role`** (nicht separate Benutzertabelle). `sales.administrator` ist nur Kompatibilitätsspiegel (`role = admin` ↔ `true`). Teamlisten nutzen **`sales_directory`** (v0.4b.2).

## Änderungshistorie / Audit (Welle v0.3l)

| Fachlich | Technisch | Hinweis |
|---|---|---|
| Änderungshistorie | `audit_events` | append-only, eine zentrale Tabelle |
| Akten-Historie | `EntityAuditHistory` + RPC `get_entity_audit_events` | in Kunden-, Kontakt- und Vorgangsakte |
| Globaler Verlauf | Route `/audit` + RPC `get_global_audit_events` | nur Admin |
| Auslöser | DB-Trigger → `nora_private.write_audit_event` | kein Client-INSERT |

**Zweck:** betriebliche Nachvollziehbarkeit — wer hat wann welche CRM-Daten geändert? **Nicht** Mitarbeiter-Leistungsüberwachung, nicht GoBD-Archiv, nicht Klick-Tracking.

**Sichtbarkeit nach Rolle:**

| Rolle | Global (`/audit`) | Kontext (Akte) |
|---|---|---|
| `admin` | ✅ | ✅ |
| `office` | ❌ | ✅ (RPC) |
| `viewer` | ❌ | ❌ |

Checklisten-Ereignisse (`checklist.*`) und CRM-Kernänderungen (Kunde, Kontakt, Vorgang, Aufgabe, Notiz, Benutzerrecht) nutzen dieselbe Tabelle — siehe `13-crm-audit-retention.md`.

## Erweiterungen geplant (Welle 7b)

| Fachlich | Technisch (Ziel) | Status |
|---|---|---|
| Modulare Checkliste | `checklist_templates`, `checklist_runs`, `checklist_run_items` | spezifiziert |
| Textbausteine (Plus/Minus) | `saved_text_snippets` | spezifiziert |
| Audit / Nachvollziehbarkeit | `audit_events` (append-only) | ✅ v0.3l (CRM + Checklisten) |
| Servicebereich | `service_area_code` (`FENS`, `HAUS`, `IMMO`) | spezifiziert |
| Produktionsfreigabe Fenster | Vorlage `FENS_PRODUCTION_RELEASE` | Seed in Migration v0.3d2 ✅ |
