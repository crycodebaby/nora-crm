# 16 – Aktueller Zustand (Einstiegspunkt für neue Agenten)

Stand: 2026-09-06 · letzter Laufzeit-Release: User Lifecycle W6-A `PRODUCTION VERIFIED` (Laufzeit-SHA `401bb08b`, nur Datenbank — Production-Ledger-Kopf `20260906210000`; Frontend und Edge Functions unverändert seit W5 `3baf5b02`). Der Repository-/Dokumentationskopf ist der jeweils aktuelle `main` (`git log`); er liegt durch reine Docs-Commits **vor** dem Laufzeit-Release — die beiden SHAs sind bewusst zwei verschiedene Fakten.

Dieses Dokument ist der **Navigations-Einstieg** und eine **kompakte Momentaufnahme** dessen, was heute live ist. Es verlinkt, statt zu duplizieren. Es enthält bewusst **keine** Release-Evidenz (RC-SHAs, Testzahlen, Live-Beweise) — die liegt im Release-Archiv (`releases/`).

## 0. Welches Dokument ist wofür zuständig?

| Dokument | Zuständigkeit | Was hinein gehört |
|---|---|---|
| `01-domain-model.md` | **aktuelles Fach-/Domänenmodell** | Begriffe, Entitäten, fachliche Regeln, Rollen — kompakt, mit Links |
| `03-data-model-guardrails.md` | **durable Invarianten / technische Guardrails** | Fallen, Regeln, Grants-/RLS-Guardrails; keine Release-Evidenz |
| `06-decision-log.md` | **durable Entscheidungen mit Begründung** | knapp; Release-Details nur als Link ins Archiv |
| `16-current-state.md` (dieses) | **aktuelle Momentaufnahme / Navigation** | was ist live, welche Versionen, wohin lesen |
| `17-known-issues-and-planned-waves.md` | **nur genuin offene Punkte** | Bugs, Restrisiken, geplante Wellen; erledigte Punkte wandern ins Archiv |
| `19-user-lifecycle-architecture.md` | **aktuelle Architektur des Mitarbeiter-Lifecycle-Subsystems** | Zustände, Executoren, Audit-Modell, Session-Bindung, Roadmap |
| `20-product-changelog.md` | **Produkt-Changelog** (für PO/Büro/IT, kein Git-Log) | was sich für Benutzer geändert hat |
| `releases/*.md` | **historische Release-Evidenz** | RC-SHAs, Migrationen, Ledger, Edge-Versionen, Testzahlen, Live-Beweise, Zwischenfälle, Originalwortlaut alter Decision-Log-Einträge |
| `07-agent-change-checklist.md` | Prüfliste vor/während/nach Änderungen inkl. **Dokumentations-Abschlusscheck** | — |
| übrige `0x`/`1x`-Dokumente | Spezifikationen einzelner Bereiche (Design, Routing, Demo, Nummern, Fenster, Checklisten, Kalender, Rollen-UX, Audit, E-Mail-Zustellung) | — |

Ein neuer Agent liest zuerst dieses Dokument, dann die für sein Thema zuständigen Dokumente (Tabelle in Abschnitt 6). Das Archiv liest er nur, wenn er einen früheren Release rekonstruieren muss.

## 1. Was ist Nora?

Nora CRM ist eine angepasste Kunden- und Vorgangsverwaltung für einen deutschen Hausmeister- und Fensterservice-Betrieb (Ergart Gruppe) auf Basis von Atomic CRM. Details: `00-project-context.md`. Nora läuft **produktiv** unter `nora.ergart.de` mit echten Kundendaten (seit 2026-08-25).

## 2. Kernressourcen

| Sichtbar | Technisch | Kurzbeschreibung |
|---|---|---|
| Kunde | `companies` | Firma (`customer_kind = business`) oder Privatperson (`individual`); `self_contact_id` = repräsentierende Person, unabhängig von deren `contacts.company_id` |
| Ansprechpartner | `contacts` | natürliche Person, optional `company_id`; max. 1 `is_primary` pro Kunde |
| Vorgang | `deals` | Anfrage/Angebot/Auftrag; `case_number`, `stage`, `expected_closing_date` („Nächster Kontakttermin"), `sales_id` („Zuständig") |
| Aufgabe | `tasks` | `contact_id` und `company_id` beide nullable, mindestens eines gesetzt; `company_id` = **historisch stabiler** Kundenkontext |
| Notiz | `contact_notes` / `deal_notes` | Urheberschaft über `sales_id` |
| Markierung | `tags` | |
| Mitarbeiter | `sales` (1:1 `auth.users`) | `role` ∈ admin/office/viewer, `disabled`, `email` (Spiegel der Login-Identität) |

Domänenmodell: `01-domain-model.md`. Fallen: `03-data-model-guardrails.md`.

## 3. Wie funktioniert Security (Kurzfassung)?

- Rollen `admin` / `office` / `viewer` an `sales.role`; Matrix in `11-google-calendar-rbac.md` Abschnitt C; UI spiegelt sie (`canAccess.ts`), die Datenbank bleibt autoritativ.
- RLS auf allen Kern-Tabellen; `SECURITY DEFINER`-RPCs prüfen Rolle/Ownership selbst; interne Helper in `nora_private`.
- **Datenzugriff ist an eine lebende Auth-Sitzung gebunden** (W5): ein JWT, dessen Sitzung fehlt, bekommt keine Daten. **W6-A** (`PRODUCTION VERIFIED` 2026-09-06): die genannte Sitzung muss dem JWT-`sub` gehören; malformed oder fehlender Claim eines übergebenen JWT → verweigert; nicht prüfbare Sitzung → verweigert (fail-closed) — `19-user-lifecycle-architecture.md` §11.
- Mitarbeiter-Lifecycle (Einladung, Rolle, Deaktivieren, Anmeldeadresse, Offboarding) läuft ausschließlich über die `users` Edge Function und `service_role`-only Executoren mit verifiziertem Actor — `19-user-lifecycle-architecture.md`.
- `operation_id` (Header `x-nora-operation-id`) ist **ausschließlich Korrelation**, nie Auth.
- Audit: `audit_events`, append-only, Trigger + schmale Writer; Actor/Ziel/Operation sind drei Fakten — `13-crm-audit-retention.md`. Error Observatory: `operation_errors`, getrennt vom Audit.
- Öffentliche Selbstregistrierung ist in Production **deaktiviert** (`disable_signup: true`, nachgewiesen 2026-09-04); Nora ist einladungsbasiert.
- Supabase Security Advisor: Snapshot 2026-08-28 vollständig bewertet (`ASSESSED/KEEP` bzw. `RESOLVED`); jede neue Migration/Function/Grant-Änderung braucht eine eigene Bewertung. Guardrails: `03-data-model-guardrails.md` Falle 34; Bewertungen: `06-decision-log.md` 2026-08-28 und Archiv `releases/2026-08.md`.
- Bekannte Restrisiken: `17-known-issues-and-planned-waves.md` (Default-Privilegien, JOSE-Wortlaut, Leserecht von `postgres` auf `auth.sessions` als Betriebsvoraussetzung, …).

## 4. Was ist live? (Momentaufnahme 2026-09-06)

| Komponente | Stand | Nachweis |
|---|---|---|
| Repository-/Dokumentationskopf | aktueller `main` — bei Bedarf aus Git auflösen, hier bewusst nicht festgeschrieben (Docs-Commits verschieben ihn, ohne die Laufzeit zu ändern) | `git log` |
| Letzter Laufzeit-Release | User Lifecycle W5 `3baf5b0210975f65142fb7b7747a23312cc8d3d0` (2026-09-06) | Archiv `releases/2026-09.md` |
| Frontend | Vercel-Projekt `nora-crm`, Domain `nora.ergart.de`, automatisches Production-Deployment pro Push auf `main` | Release-Archiv `releases/2026-09.md` |
| Datenbank | `nora-crm-prod` (`kixxroxtfzbcbzctohex`), Postgres 17.6; Migrations-Ledger **54 Einträge, Kopf `20260906180000_nora_lifecycle_offboarding`**, deckungsgleich mit `supabase/migrations/` (54 Dateien) | `list_migrations` read-only 2026-09-06 |
| Edge Function `users` | **Version 8** (`verify_jwt = false`, verifiziert JWTs selbst) | `list_edge_functions` read-only 2026-09-06 |
| Edge Function `brevo-email-events` | **Version 2** (`verify_jwt = false`, Bearer-Token) | dito |
| Weitere Edge Functions im Repo (`calendar-*`, `merge_contacts`, `delete_note_attachments`, `update_password`, `postmark`, `mcp`) | **nicht** in Production deployt (nur `users` und `brevo-email-events` sind live) | dito |
| Produktionsdaten | real (5 Mitarbeiter, davon ein deaktiviertes Testkonto `sales.id = 4`; Geschäftsdaten wachsen durch Nutzung) | Archiv W5 |

Release-Regel (schemaabhängige Wellen): RC einfrieren → Production-Migration → DB-Verifikation → Edge-Deploy → Push → Live-Smoke; Details in `07-agent-change-checklist.md`. **Nach einem Deployment holt ein Reload allein den neuen Build nicht** (PWA im Prompt-Modus) — siehe Abschnitt 5 und Checkliste.

## 5. Abgeschlossene Wellen (Überblick)

Alle folgenden Wellen sind auf `main` und live; Status wie zuletzt dokumentiert. Details und Evidenz: Archiv-Monat in Klammern; Entscheidungen: `06-decision-log.md`.

| Bereich | Welle | Status | Archiv |
|---|---|---|---|
| Fundament | Atomic-CRM-Basis, deutsches Branding, Welle 4–7b (Typografie, Nachfassen, Startseite, Nummern, Suche, Hotboard, Fenster-Kanban, Checklisten, Schnellerfassung, Dubletten) | live | `2026-06` |
| UX / Rollen | v0.3f–v0.3k.2 (Demo-Daten, Schnellerfassung-UX, Kanban/Akte, rollenbewusste UX, Demo-Rollensimulation) | live | `2026-07` |
| Security | v0.4a/b/b.1/b.2 (RBAC/RLS, `nora_private`, Capability-Rolle, `sales_directory`) | live | `2026-07` |
| Audit | v0.3l/v0.3l.1 CRM-Audit | live | `2026-07` |
| Kalender | v0.4c.1/c.2/c.2c Google-Kalender read-only, OAuth, Sync, Release-Gates | live (OAuth-E2E mit echtem Testkalender nie automatisiert) | `2026-07` |
| Zugang | Mitarbeiterzugang-Redesign, Einladung (2026-07-23) | live | `2026-07` |
| Foundation | FW1 Operation Correlation, FW2 Operation Manager, FW3 Error Observatory, Stabilization Gates 1/2/2b, Kernindizes + Bundle-Budget | live | `2026-08` |
| Kunden/Kontakte | Customer & Contact Workflow, Unified Tasks, Self Contact, Pre-Production Hardening | `PRODUCTION VERIFIED` (2026-08-25/28) | `2026-08` |
| Fehler/Operationen | Error Contract, Idempotency, Operation Status v1 | `PRODUCTION VERIFIED` (2026-08-28/29) | `2026-08` |
| Feedback | Notification 7A/7B (nur Quick Capture migriert) | `PRODUCTION VERIFIED` (2026-08-30) | `2026-08` |
| Kontakte | Kontakterstellung UI-Polish | deployed (Rollen-UX-Abnahme nicht förmlich durchlaufen) | `2026-08` |
| Vorgänge | Kanban Navigation Rail | `PRODUCTION VERIFIED` (2026-09-01) | `2026-08` |
| PWA | PWA-1B–1C.3 (mit Kanban-Release), Update State Contract V2, Visual Polish 2, Completion Acknowledgement | released 2026-09-01 (`672ebc76`); Live-Browser-Verifikation des V2-Happy-Path nicht protokolliert | `2026-08`, `2026-09` |
| Kunden | Customer Create Speed & Clarity | released 2026-09-01 (`d41338ed`) | `2026-09` |
| Zugang | Employee Onboarding & Access V1A, V1B | `PRODUCTION VERIFIED`, V1B PO UX accepted (2026-09-04) | `2026-09` |
| E-Mail | V1C-A Zustellbeobachtung, V1C-B Zustellstatus-UI | `PRODUCTION VERIFIED` (2026-09-04) | `2026-09` |
| Security | Security Hardening Wave 0 (`audit_events` TRUNCATE) | `PRODUCTION VERIFIED` (2026-09-04) | `2026-09` |
| Lifecycle | User Lifecycle W1, W2, W3, W4, W5 | `PRODUCTION VERIFIED` (2026-09-05/06) | `2026-09` |
| Lifecycle | User Lifecycle W6-A (Session-Autorisierung fail-closed/Owner-gebunden) | `PRODUCTION VERIFIED` (2026-09-06; nur Datenbank, Migration `20260906210000`, keine sichtbare Änderung) | `2026-09` |

**Was heute gilt (Kurzfassungen der Subsysteme):**

- **Kunden/Kontakte:** `customer_kind`, Hauptansprechpartner, `links_jsonb`/`email_jsonb`/`phone_jsonb`, atomare Anlage-RPCs, `self_contact_id`, Effective Contact Context, Quick Capture atomar mit Idempotency — `01-domain-model.md`.
- **Aufgaben:** `tasks.company_id` historisch stabil, Aufgaben-Tab auf der Kundenakte (Desktop) — `01-domain-model.md`, Fallen 7/7a.
- **Fehler/Operationen:** `NoraErrorCode` über `DETAIL`, Operation Manager mit `execution`/`errorCode`/`result`, Idempotency-Records — `06-decision-log.md` 2026-08-28/29, `domain/noraErrorCodes.ts`, `operations/*`.
- **Feedback:** eine Statuskarte pro Intent, über Dialogen, click-through; nur Quick Capture migriert, sonner für alle anderen Flows — `notifications/*`, `02-design-system.md`.
- **PWA:** Prompt-Modus (wartender Worker), Browser-Fakten als Wahrheit, Zustände `available · applying · slow · reloadRequired · failed`, Bestätigung nach dem Reload — `06-decision-log.md` „PWA-Update-Lifecycle", `02-design-system.md`, `pwa/*`.
- **Mitarbeiter-Lifecycle:** abgeleiteter Zugangsstatus, ein Executor je Aktion, historische Identität, Audit-Actor, kontrollierte E-Mail-Änderung, Offboarding mit Session-Revokation und Preview — `19-user-lifecycle-architecture.md`.
- **E-Mail-Zustellung:** Brevo-Webhook, Best-Effort-Korrelation, Zustellzeile im Panel, kein Tracking — `18-email-delivery-observability.md`.

## 6. Welche Dokumente muss ich für welches Thema lesen?

| Thema | Dokument |
|---|---|
| Projektziel, Nicht-Ziele | `00-project-context.md` |
| Domänenmodell, Kundenart, Hauptansprechpartner, Self Contact, Aufgaben-Kontext, Rollen | `01-domain-model.md` (+ Fallen in `03-…`, Begründung in `06-…`) |
| Design/UI-Regeln, Systemereignisse, Onboarding-Gestaltung | `02-design-system.md` |
| Datenmodell-Fallen, RBAC-/RLS-Guardrails, Lifecycle-Invarianten | `03-data-model-guardrails.md` |
| Routing, i18n, deutsche URLs, bekanntes Fehlermuster englische Ur-Code-Pfade | `04-routing-i18n.md` |
| Demo-Daten (FakeRest) | `05-demo-data-guidelines.md` |
| Durable Entscheidungen inkl. Begründung (thematischer Index am Anfang) | `06-decision-log.md` |
| Checkliste vor/während/nach Änderungen, Release-Regeln, Dokumentations-Abschluss | `07-agent-change-checklist.md` |
| Nummernvergabe, globale Suche | `08-numbering-and-global-search.md` |
| Fensterauftrag-Workflow | `09-window-order-workflow.md` |
| Checklisten/Textbausteine/Audit-Datenmodell | `10-checklists-snippets-audit.md` |
| Google Kalender, Rollenmodell (RBAC-Matrix) | `11-google-calendar-rbac.md`, `14-google-calendar-readonly-implementation.md` |
| Rollen-UX-Abnahme | `12-role-ux-acceptance.md` |
| Audit-Ereignisse, Actor-Modell, Retention | `13-crm-audit-retention.md` |
| Offene Bugs, Restrisiken, geplante Wellen | `17-known-issues-and-planned-waves.md` |
| E-Mail-Zustellbeobachtung (Brevo, Vertrag, Operator-Konfiguration) | `18-email-delivery-observability.md` |
| **Mitarbeiter-/Benutzer-Lifecycle (Zustände, Executoren, Audit, Session-Bindung, Offboarding, Roadmap W1–W10)** | `19-user-lifecycle-architecture.md` |
| Produkt-Changelog, `/changelog`-Vertrag | `20-product-changelog.md` |
| Historische Release-Evidenz, alte Decision-Log-Originale | `releases/README.md` → `releases/2026-06.md` … `releases/2026-09.md` |
| Error Contract | `06-decision-log.md` „Error Contract Wave" + `domain/noraErrorCodes.ts` + `07-…` |
| Operation Status / Notification Contract | `06-decision-log.md` 2026-08-29 + `operations/*`, `notifications/*` |
| Mitarbeiter-Onboarding (Einladung → Passwort → Profil) | `19-…` §4, `02-design-system.md` „Mitarbeiter-Onboarding & Zugang", `login/employeeOnboardingFlow.ts` |

Hinweis: die Nummer `15` ist nicht vergeben (keine `15-*.md` in der Git-Historie) — keine bewusste Reservierung.

## 7. Truth Hierarchy

Bei Widersprüchen zwischen Chatwissen, Dokumentation und Code gilt (siehe auch `07-agent-change-checklist.md`):

1. aktueller Code
2. aktuelle Migrationen / DB-Zustand
3. verifizierter Production-Zustand
4. Git-Historie
5. Dokumentation
6. Chatwissen aus vorherigen Sitzungen

Dokumentation wird nach bestem Wissen aktuell gehalten, ist aber niemals autoritativer als der tatsächliche Code- oder DB-Zustand. Innerhalb der Dokumentation gilt: **aktuelle Wahrheit** steht in `16`/`01`/`03`/`19`, **durable Entscheidungen** in `06`, **historische Fakten** im Archiv `releases/` — ein historischer Eintrag beschreibt den Wissensstand seines Datums, nicht den heutigen Zustand.
