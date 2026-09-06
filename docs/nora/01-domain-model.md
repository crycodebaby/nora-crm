# 01 – Fachliches Domänenmodell

Stand: 2026-09-06. Dieses Dokument beschreibt das **aktuelle** Fach-/Domänenmodell kompakt; Begründungen stehen in `06-decision-log.md`, Fallen in `03-data-model-guardrails.md`, der Mitarbeiter-Lifecycle im Detail in `19-user-lifecycle-architecture.md`.

## Zentrale fachliche Unterscheidung

Kunde ≠ Kontakt ≠ Vorgang ≠ Aufgabe.

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
| Notiz | `contact_notes` / `deal_notes` | Kontakt- oder Vorgangsnotiz; Autor über `sales_id` |
| Markierung | `tags` | fachliche Kennzeichnung |
| Kundentyp | `companies.sector` | vorläufig fachlich umgenutzt (lose Klassifikation); die binäre Kundenart ist `companies.customer_kind` |
| Mitarbeiter | `sales` (1:1 `auth.users`) | Rolle, Zugang, Anmeldeadresse — siehe „Rollenmodell" unten |

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
- Aufgaben hängen **nicht** direkt an `deal_id` — Aufgaben zum Vorgang laufen weiterhin über die verknüpften Ansprechpartner (`deal.contact_ids`)
- Seit der Unified Tasks Wave (2026-08-25): `tasks` hat sowohl `contact_id` als auch `company_id` (beide nullable, mindestens eines gesetzt). `company_id` ist der **historisch stabile** Kundenkontext einer Aufgabe — wird bei Erstellung/Kontextänderung serverseitig aus `contact_id` abgeleitet, aber **nie** automatisch nachgeführt, wenn der Kontakt später den Kunden wechselt. Details: Decision Log „2026-08-25 – Unified Tasks Wave", `03-data-model-guardrails.md` Falle 7a.

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

**Mitarbeiter-Lebenszyklus (Employee Access V1A–V1C, User Lifecycle W1–W5; Stand 2026-09-06).** Vollständige Architektur: `19-user-lifecycle-architecture.md`.

| Fachlich | Technisch | Hinweis |
|---|---|---|
| Zugangsstatus | abgeleitet aus Supabase Auth + `sales.disabled`: `invited` / `active` / `disabled` / `unknown` | nie gespeichert; `unknown` bietet keine Aktion |
| Mitarbeiter einladen, Einladung erneut senden, Passwort einrichten lassen | `users` Edge Function → GoTrue + Executor | Nora ist einladungsbasiert; keine öffentliche Registrierung |
| Zugang deaktivieren / reaktivieren / Rolle ändern | `users` Edge Function → `set_sales_access_by_executor` | einziger Schreibpfad; Selbstschutz, mindestens ein aktiver Admin, Auth-Bann wird mitgeführt und verifiziert |
| Anmeldeadresse ändern | Aktion „E-Mail-Adresse ändern" → `prepare_sales_email_change` → GoTrue → Guard auf `auth.users` | `auth.users.email` ist Master, `sales.email` Spiegel; alte Links werden ungültig; Selbständerung blockiert |
| Zugang beenden (Offboarding) | Aktion „Zugang beenden" → `offboard_employee_by_executor` | Deaktivieren + alle Sitzungen beenden + `user.offboarded` in einer Transaktion; nichts wird gemailt; Reaktivierung erfordert neue Anmeldung |
| Offene Zuständigkeiten | `get_employee_dependency_preview` → Block „Offene Zuständigkeiten" in der Mitarbeiterakte | Kunden, Kontakte, offene Vorgänge, offene Aufgaben — blockieren nie, werden gezählt und verlinkt; Notizen sind Urheberschaft, keine offene Arbeit |
| „Wem darf ich neue Arbeit zuweisen?" | `sales_directory` (nur aktive) + Trigger `guard_active_assignment` | Picker `SalesAssignmentInput`; Neuzuweisung an Deaktivierte wird serverseitig abgelehnt |
| „Wer war zuständig / wer hat das geschrieben?" | `sales_identities` (alle, inkl. `disabled`) | Namen auf bestehenden Notizen, Vorgängen, Akten, im Aktivitätslog und Export |
| Wer hat das entschieden? | `audit_events` `user.*` mit echtem Admin-Actor, stabiler Mitarbeiter-Entity, Operation-ID | `13-crm-audit-retention.md` |
| Mitarbeiter löschen | kein unterstützter Pfad; nur unreferenzierte Zeilen wären für einen künftigen kontrollierten Executor (W6) löschbar | sechs `NO ACTION`-FKs blockieren jede referenzierte Identität; Browser-Rollen nie |

Ein echter Mitarbeiter mit Geschäftshistorie wird **offboarded, nicht gelöscht**. Domänenregel: **INAKTIV / ARCHIVIERT ist nicht NICHT-EXISTENT** — deaktivierte Mitarbeiter behalten ihren echten Namen auf allem Bestehenden und verschwinden nur aus Auswahllisten für Neues. Identität (Anmeldeadresse), Zugang (aktiv/deaktiviert) und Rolle sind drei getrennte Fakten. Der Datenzugriff eines Mitarbeiters ist an eine lebende Auth-Sitzung gebunden.

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

## Kunden-/Ansprechpartner-Erfassung (Customer & Contact Workflow Wave, 2026-08-25)

| Fachlich | Technisch | Hinweis |
|---|---|---|
| Kundenart | `companies.customer_kind` (`business`\|`individual`) | Treibt Formularmodus in `/kunden/create` und `/kunden/:id/edit` |
| Hauptansprechpartner | `contacts.is_primary` | Max. 1 pro `company_id` (Partial Unique Index); Wechsel über RPC `set_primary_contact` |
| Links (Website/LinkedIn/…) | `companies.links_jsonb` / `contacts.links_jsonb` | Ersetzt LinkedIn-only-Validierung; `linkedin_url`/`website`/`context_links` bleiben deprecated Legacy-Spalten |
| Firmen-E-Mail/-Telefon | `companies.email_jsonb` / `companies.phone_jsonb` | Gleiche Struktur wie bei `contacts`; `phone_number` bleibt deprecated |
| Atomare Kundenanlage | RPC `create_customer_with_contact` | Kunde + optional neuer/bestehender Hauptansprechpartner in einer Transaktion |

Vollständige Entscheidung: `06-decision-log.md` (2026-08-25).

## Self Contact / Effective Contact Context (Self Contact Wave, 2026-08-26)

| Fachlich | Technisch | Hinweis |
|---|---|---|
| „Diese Person repräsentiert diese Kundenakte" | `companies.self_contact_id` | Gerichteter FK company→contact, **entkoppelt** von `contacts.company_id` — eine Person kann Ansprechpartner einer Firma bleiben und gleichzeitig `self_contact_id` einer anderen (eigenen) Kundenakte sein |
| Eindeutigkeit | Partial Unique Index nur für `customer_kind='individual'` | Eine Person hat höchstens eine Privatkundenakte, darf aber `self_contact_id` mehrerer Firmen-Kundenakten sein |
| „Gehört dieser Kontakt zu dieser Kundenakte?" | `nora_private.is_effective_contact_of_company()` (SQL) / `domain/customerContactContext.ts` (TS) | Einzige Regel: `contact.company_id = company.id` ODER `company.self_contact_id = contact.id`. Genutzt von Task-Kontextvalidierung, Quick-Capture-Validierung, CompanyShow |
| Rollen (bewusst getrennt) | `selfContact` / `explicitPrimaryContact` / `preferredContact` | `is_primary` eines Kontakts mit abweichendem `company_id` ist für die jeweilige Kundenakte fachlich bedeutungslos — kein „Primary hier" |
| Privatperson-Namensquelle | `contacts` kanonisch, `companies.name` serverseitig synchronisiert | `nora_private.sync_individual_company_name()`; Edit-Formular zeigt `companies.name` bei individual+self_contact_id read-only |
| Kontakt → Kundenakte | Application Command `createCustomerFromContact` | Wiederverwendet vorhandene Personendaten, verändert `contacts.company_id`/`is_primary` nie |
| Schnellerfassung atomar | Application Command `createQuickCaptureCase` → RPC `create_quick_capture_case` | Kunde+Kontakt+Vorgang eine Transaktion; Aufgabe bleibt separater Best-Effort-Schritt |

Vollständige Entscheidung inkl. Alternativen: `06-decision-log.md` „2026-08-26 – Self Contact Wave".

## Erweiterungen geplant (Welle 7b)

| Fachlich | Technisch (Ziel) | Status |
|---|---|---|
| Modulare Checkliste | `checklist_templates`, `checklist_runs`, `checklist_run_items` | spezifiziert |
| Textbausteine (Plus/Minus) | `saved_text_snippets` | spezifiziert |
| Audit / Nachvollziehbarkeit | `audit_events` (append-only) | ✅ v0.3l (CRM + Checklisten) |
| Servicebereich | `service_area_code` (`FENS`, `HAUS`, `IMMO`) | spezifiziert |
| Produktionsfreigabe Fenster | Vorlage `FENS_PRODUCTION_RELEASE` | Seed in Migration v0.3d2 ✅ |
