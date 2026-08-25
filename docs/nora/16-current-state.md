# 16 – Aktueller Zustand (Einstiegspunkt für neue Agenten)

Stand: 2026-08-25 (nach Customer & Contact Workflow Wave + Foundation Performance/Index-Härtung, PR #1).

Dieses Dokument ist eine **schnelle Orientierung**, kein Ersatz für die referenzierten Dokumente. Es verlinkt, statt Inhalte zu duplizieren.

## 1. Was ist Nora?

Nora CRM ist eine angepasste Kunden- und Vorgangsverwaltung für einen deutschen Hausmeister- und Fensterservice-Betrieb (Ergart Gruppe), auf Basis von Atomic CRM. Details: `00-project-context.md`.

## 2. Kernressourcen

| Sichtbar | Technisch | Kurzbeschreibung |
|---|---|---|
| Kunde | `companies` | Unternehmen/Selbstständig (`customer_kind = business`) oder Privatperson (`customer_kind = individual`) |
| Ansprechpartner | `contacts` | natürliche Person, optional `company_id`; max. 1 `is_primary = true` pro Kunde |
| Vorgang | `deals` | Anfrage/Auftrag/Angebot |
| Aufgabe | `tasks` | aktuell an `contact_id` gebunden, **kein** Kundenkontext (siehe Abschnitt 7) |
| Notiz | `contact_notes` / `deal_notes` | |
| Markierung | `tags` | |

Vollständiges Domänenmodell: `01-domain-model.md`. Datenmodell-Fallen: `03-data-model-guardrails.md`.

## 3. Wie funktioniert Security?

- Rollenmodell `admin` / `office` / `viewer` an `sales.role` — siehe `11-google-calendar-rbac.md` Abschnitt C, `12-role-ux-acceptance.md`.
- RLS auf allen Kern-Tabellen; SECURITY-DEFINER-RPCs prüfen `nora_private.can_write()` / `nora_private.safe_auth_uid()` selbst (nicht nur RLS).
- `operation_id` (Header `x-nora-operation-id`) ist **ausschließlich Korrelation**, nie Auth.
- Audit: `audit_events`, append-only, automatisch über INSERT/UPDATE-Trigger auf Kern-Tabellen — siehe `13-crm-audit-retention.md`.
- Error Observatory: `operation_errors`, getrennt von Audit (fehlgeschlagene vs. erfolgreiche Operationen) — Decision Log 2026-08-10.

**Bekannte, noch offene Security-/Ops-Themen** (aus früherer Analyse vor dieser Session, hier nicht neu verifiziert — vor Umsetzung gegen aktuellen Code prüfen):
- Offene Selbstregistrierung (Status unklar, `handle_new_user`/`init_state`-Logik prüfen)
- Attachment-Bucket-Konfiguration
- Nicht deployte Edge Functions
- Rollen-Cache-Verhalten im Frontend
- Audit-Retention/Löschstrategie (`13-crm-audit-retention.md` beschreibt das Modell, keine automatische Löschung ist Stand v0.3l)

Diese Punkte waren zu Beginn der Customer & Contact Workflow Wave als "bekannt, nicht Kern des Auftrags" benannt und wurden in dieser Session nicht untersucht.

## 4. Welche großen Waves sind abgeschlossen?

Chronologisch, Details im Decision Log (`06-decision-log.md`):

1. Atomic-CRM-Basis, deutsches Branding/Locale (Welle 1–4)
2. Nachfassen ohne Migration (Welle 5), Startseite/Auth-Nav (Welle 6a)
3. Kunden-/Vorgangsnummern (`customer_number`/`case_number`, Welle 6c/6c-Hardening)
4. Globale Suche (Welle 6d), Hotboard (v0.3b), Fenster-Kanban-Filter (v0.3c)
5. Checklisten/Textbausteine/Audit-Datenmodell (v0.3d2–v0.3d6)
6. Schnellerfassung + Dubletten-Vorschläge (v0.3e–v0.3g) — **sequentielle Creates, nicht die neue atomare RPC** (siehe Abschnitt 6)
7. RBAC/RLS-Härtung (v0.4b), Google-Kalender read-only (v0.4c.1)
8. CRM-Audit (v0.3l), rollenbewusste UX (v0.3k, v0.3k.1, v0.3k.2)
9. Foundation Wave 1–3: Operation Correlation, Operation Manager + Catalog, Error Observatory Core
10. Foundation Performance/Index-Härtung (PR #1, 2026-08-15/16): fehlende FK-/Hot-Path-Indizes auf `deals`/`tasks`/`contacts`/`companies`/`contact_notes`/`deal_notes`, Vite Code-Splitting + Bundle-Budget-CI-Gate — siehe Decision Log "2026-08-15 – Kernindizes und Bundle-Budget"
11. **Customer & Contact Workflow Wave** (2026-08-25) — siehe Abschnitt 5

## 5. Customer & Contact Workflow Wave — was ist tatsächlich implementiert

Vollständige Entscheidung: Decision Log "2026-08-25 – Customer & Contact Workflow Wave".

- `companies.customer_kind` (`business`/`individual`) steuert den Formularmodus in `CompanyInputs` (geteilt zwischen `/kunden/create` und `/kunden/:id/edit`).
- `contacts.is_primary` — max. 1 Hauptansprechpartner pro Kunde, durchgesetzt per Partial Unique Index `uq_contacts_one_primary_per_company`. Wechsel nur über RPC `set_primary_contact`.
- Atomare Anlage über RPC `create_customer_with_contact(p_company jsonb, p_contact jsonb, p_existing_contact_id bigint)` — SECURITY DEFINER, `can_write()`-gated, ein Transaktionskörper für Kunde + optional neuer/bestehender Ansprechpartner.
- `/kunden/create` (`CustomerCreateForm.tsx`) ist die Referenzimplementierung: eigener `onSubmit` statt `CreateBase`, ruft `dataProvider.createCustomerWithContact(...)`. Ansprechpartner-Modi: kein / neu / Unternehmer ist selbst Ansprechpartner (inkl. „Angaben übernehmen") / bestehenden zuordnen. Bei Privatperson entfällt der Modus-Wähler, Kundenname wird aus Vor-/Nachname abgeleitet.
- Links generalisiert: `companies.links_jsonb` / `contacts.links_jsonb` (`{url, type, label?}`, Typen: website/linkedin/instagram/facebook/google/portal/other) ersetzen die LinkedIn-only-Validierung. **`ContactInputs.tsx` rendert kein `linkedin_url`-Feld mehr** — nur noch `links_jsonb`.
- `companies.email_jsonb` / `companies.phone_jsonb` neu, analog zu `contacts`.
- Legacy-Spalten (`linkedin_url`, `website`, `phone_number`, `context_links`) bleiben in der DB bestehen (Bestandsdaten per Migration in die neuen `*_jsonb`-Felder kopiert), werden aber vom UI nicht mehr beschrieben — nur noch als Fallback-Anzeige gelesen (`CompanyAside.tsx`, `ContactPersonalInfo.tsx`) für Datensätze, bei denen die Kopie aus irgendeinem Grund leer geblieben ist.
- Operation Catalog erweitert um `customer.createWithContact` / `contact.setPrimary` (Operation Manager + Error Observatory, analog `deal.update`).
- Neuer SQL-Verifikationstest: `supabase/tests/customer_contact_workflow_verification.sql`.

**Nicht Teil dieser Wave:** Schnellerfassung nutzt weiterhin sequentielle Creates (siehe Abschnitt 6).

## 6. Was ist aktuell live?

Verifiziert am 2026-08-25 in dieser Session (read-only Prüfung gegen `nora-crm-prod`, Vercel-Deployment-Status):

- **Datenbank** (`nora-crm-prod`, Supabase-Projekt `kixxroxtfzbcbzctohex`): Migrationshistorie deckt sich mit `supabase/migrations/` bis einschließlich `20260825120612_nora_migration_bookkeeping_cleanup.sql`. Enthält die Customer & Contact Workflow Wave vollständig (Spalten, Constraint, Unique-Index, RPCs, Views).
- **Frontend** (Vercel-Projekt `nora-crm`, Domain `nora.ergart.de`): Deployment `dpl_hJp4Bn4tuSaDP4nLGevLd5hNT6No`, Commit `e3f18f7f`, Status READY, Target production.
- **Produktionsdaten sind real**, nicht synthetisch: zum Prüfzeitpunkt 14 Kunden, 16 Kontakte, 6 Vorgänge, 3 Nutzer. Die Aussage „Nora ist noch kein Produktivsystem mit echten Kundendaten" (`00-project-context.md`, historisches Nicht-Ziel für v0.1) **stimmt nicht mehr** — als historische Zieldefinition markiert, siehe dort.
- Git: `origin/main` bei Commit `e3f18f7f` (Repo `crycodebaby/nora-crm`).

Diese Fakten wurden per read-only MCP-Abfragen gegen die echte Produktionsdatenbank und das echte Vercel-Projekt verifiziert, nicht angenommen.

## 7. Welche offenen Bugs/UX-Probleme existieren?

Details, Status und vermutete Ursachen: `17-known-issues-and-planned-waves.md`. Kurzfassung:

1. **Kunden-Autocomplete „neuen Kunden anlegen"-UX** (`/kontakte/create`) — Aktionstext nicht eindeutig als Aktion erkennbar. Bestätigt im Code (`create_label` in den Message-Katalogen). **OPEN.**
2. **LinkedIn-Feld auf `/kontakte/create`** — als Live-Feedback gemeldet; aktueller Code (`ContactInputs.tsx`) rendert kein `linkedin_url`-Feld mehr, nur `links_jsonb`. **Nicht im aktuellen Code reproduzierbar** — vermutlich veralteter Stand vor Deploy oder Browser-Cache beim Melder. Vor erneuter Untersuchung live neu prüfen.
3. **Kunden-Show Tab-/Routing-Bug** (`/#/kunden/:id/show`, Tabs „Änderungsverlauf"/„Kontakte") — beim Klick kurze Navigation, danach Rücksprung zu „Aktivität". Selbst live beobachtet (2026-08-25, `/kunden/27/show`). Wahrscheinliche Ursache identifiziert, aber nicht gefixt: `CompanyShowContent` navigiert per `useMatch("/companies/:id/show/:tab")`-Pattern (technischer, englischer Pfad) via `navigate(`/companies/${id}/show/${tab}`)`; die sichtbare/aliasierte deutsche Route ist aber `/kunden/...` (`routing/noraRoutes.ts`, `translateLegacyPathname`). Vermutung: Nach der Navigation greift der Legacy-Redirect und schreibt die URL auf `/kunden/...` um, wodurch `useMatch` (das nur auf `/companies/...` passt) nicht mehr matcht und `currentTab` auf `"activity"` zurückfällt. **BUG, Ursache nicht verifiziert/gefixt.**

## 8. Welche nächsten Domain-Waves sind geplant?

1. **Aufgabenmodell vereinheitlichen** (`PLANNED DOMAIN WAVE`, noch nicht designed) — `tasks.contact_id` ist die einzige Bindung; eine Aufgabe mit sowohl Kunden- als auch Ansprechpartner-Kontext erscheint aktuell nicht auf der Kundenakte. Ziel: eine Aufgabe existiert genau einmal, sichtbar in Kunden- **und** Kontaktakte, ohne Duplizierung. Keine Schemaentscheidung bisher getroffen — siehe `17-known-issues-and-planned-waves.md`.
2. **Schnellerfassung auf `create_customer_with_contact` umstellen** — aktuell sequentielle Client-Creates (Teilzustand-Risiko wie vor dieser Wave bei `/kunden/create`).
3. Legacy-Spalten-Cleanup (`linkedin_url`, `website`, `context_links`, `companies.phone_number`) nach ausreichender Übergangszeit.

## 9. Welche Dokumente muss ich für welches Thema lesen?

| Thema | Dokument |
|---|---|
| Projektziel, Nicht-Ziele | `00-project-context.md` |
| Domänenmodell, Kundenart, Hauptansprechpartner | `01-domain-model.md` |
| Design/UI-Regeln | `02-design-system.md` |
| Datenmodell-Fallen, Guardrails | `03-data-model-guardrails.md` |
| Routing, i18n, deutsche URLs | `04-routing-i18n.md` |
| Demo-Daten (FakeRest) | `05-demo-data-guidelines.md` |
| **Alle fachlichen/architektonischen Entscheidungen inkl. Begründung** | `06-decision-log.md` |
| Checkliste vor/während/nach Code-Änderungen | `07-agent-change-checklist.md` |
| Nummernvergabe, globale Suche | `08-numbering-and-global-search.md` |
| Fensterauftrag-Workflow | `09-window-order-workflow.md` |
| Checklisten/Textbausteine/Audit-Datenmodell | `10-checklists-snippets-audit.md` |
| Google Kalender, Rollenmodell (RBAC) | `11-google-calendar-rbac.md` |
| Rollen-UX-Abnahme | `12-role-ux-acceptance.md` |
| CRM-Audit-Retention | `13-crm-audit-retention.md` |
| Google-Kalender-Implementierung (read-only) | `14-google-calendar-readonly-implementation.md` |
| **Dieser Überblick** | `16-current-state.md` |
| **Offene Bugs, geplante Waves im Detail** | `17-known-issues-and-planned-waves.md` |

## 10. Truth Hierarchy

Bei Widersprüchen zwischen Chatwissen, Dokumentation und Code gilt (siehe auch `07-agent-change-checklist.md`):

1. aktueller Code
2. aktuelle Migrationen / DB-Zustand
3. verifizierter Production-Zustand
4. Git-Historie
5. Dokumentation
6. Chatwissen aus vorherigen Sitzungen

Dokumentation wird nach bestem Wissen aktuell gehalten, ist aber niemals autoritativer als der tatsächliche Code- oder DB-Zustand.
