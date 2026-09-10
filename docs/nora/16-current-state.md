# 16 – Aktueller Zustand (Einstiegspunkt für neue Agenten)

Stand: 2026-09-10 · letzter Laufzeit-Release: Entry-Chunk-Budget H2 `PRODUCTION VERIFIED` (Laufzeit-RC **und** Release-Kopf `5cae655f` — **frontend-only Performance-Korrektur**, keine Migration, kein Edge-Deploy, **keine sichtbare Funktionsänderung**: eine Importzeile in `ContactListContent.tsx`, dadurch Entry-Chunk 1092 → 1009 kB und das Bundle-Budget-Gate wieder grün). Letzter Release mit sichtbarer Funktionalität: Startseite-Zuverlässigkeit W7-R1A `PRODUCTION VERIFIED` (Laufzeit-RC **und** Release-Kopf `8fcb603d` — **frontend-only**, keine Migration, kein Edge-Deploy). Die Startseite fragt Ansprechpartner und Kunden nur noch mit gültigen, eindeutigen Ids ab und zeigt beim Laden keine leere Fläche mehr. Letzter **Datenbank**-Release: Atomic Contact Primary Intent `PRODUCTION VERIFIED` (Laufzeit-RC `0fb3d6ba`, Release-Kopf `5d526231` — Production-Ledger-Kopf `20260908120000`; Datenbank + Frontend, kein Edge-Deploy). Kontakt-Speichern und „Hauptansprechpartner" sind seitdem **eine** Transaktion. Der Repository-/Dokumentationskopf ist der jeweils aktuelle `main` (`git log`); er liegt durch reine Docs-Commits **vor** dem Laufzeit-Release — die beiden SHAs sind bewusst zwei verschiedene Fakten.

Dieses Dokument ist die **kompakte Momentaufnahme** dessen, was heute live ist. Es verlinkt, statt zu duplizieren. Welches Dokument wofür zuständig ist und wann es geladen wird, steht ausschließlich im Router [`README.md`](README.md). Abschnitt 4 nennt die SHAs und Versionen, die zur Identifikation des laufenden Stands nötig sind; die vollständige Release-Evidenz (Migrations-Hashes, Testzahlen, Live-Beweise, Zwischenfälle) liegt im Archiv (`releases/`).

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
- **Privilegien in `public` sind explizit, nicht geerbt** (Security Hardening Wave 1, `PRODUCTION VERIFIED` 2026-09-07): von `postgres` neu erzeugte Tabellen in `public` erben **keine** API-Rollen-Rechte mehr; `anon`/`authenticated`/`service_role` halten auf keiner der geprüften `public`-Relationen `TRUNCATE`, `REFERENCES`, `TRIGGER` oder `MAINTAIN`; Laufzeitrechte entstehen ausschließlich aus explizitem `GRANT` plus RLS. `service_role` hat nirgends in `public` `DELETE`; `anon` hat genau `SELECT` auf `init_state`. Vertrag: `03-data-model-guardrails.md`.
- Öffentliche Selbstregistrierung ist in Production **deaktiviert** (`disable_signup: true`, nachgewiesen 2026-09-04); Nora ist einladungsbasiert.
- Supabase Security Advisor: Snapshot 2026-08-28 vollständig bewertet (`ASSESSED/KEEP` bzw. `RESOLVED`); jede neue Migration/Function/Grant-Änderung braucht eine eigene Bewertung. Guardrails: `03-data-model-guardrails.md` Falle 34; Bewertungen: `06-decision-log.md` 2026-08-28 und Archiv `releases/2026-08.md`.
- Bekannte Restrisiken: `17-known-issues-and-planned-waves.md` (PostgreSQLs eingebauter `PUBLIC`-EXECUTE-Default für **neue Functions** — von Wave 1 ausdrücklich **nicht** gelöst; Schema `storage` und öffentlicher Attachment-Bucket; die für `postgres` unerreichbare `supabase_admin`-Default-ACL in `public`; JOSE-Wortlaut; Leserecht von `postgres` auf `auth.sessions` als Betriebsvoraussetzung, …).

## 4. Was ist live? (Momentaufnahme 2026-09-10)

| Komponente | Stand | Nachweis |
|---|---|---|
| Repository-/Dokumentationskopf | aktueller `main` — bei Bedarf aus Git auflösen, hier bewusst nicht festgeschrieben (Docs-Commits verschieben ihn, ohne die Laufzeit zu ändern) | `git log` |
| Letzter Laufzeit-Release (Frontend) | Entry-Chunk-Budget H2, Laufzeit-RC **und** Release-Kopf `5cae655fdc4accda3c2613b316293b896b466ca4` (2026-09-10; **frontend-only Performance-Korrektur** — keine Migration, kein Edge-Deploy, keine Production-DB-Änderung, keine sichtbare Funktionsänderung). Live-Beweis: ausgeliefertes Bundle trägt die eingebettete SHA `5cae655f…`; H1-Vertrag unverändert (`/stats.html` 404, 37 Precache-Einträge) | Archiv `releases/2026-09.md` (Entry-Chunk-Budget H2) |
| Vorheriger Laufzeit-Release (Frontend) | Visualizer Production Exclusion H1, Laufzeit-RC **und** Release-Kopf `c50e779fff645c1c5bf33a962c92b6c0b48e12d6` (2026-09-09; frontend-only Build-Hygiene, keine sichtbare Funktionsänderung) | Archiv `releases/2026-09.md` (Visualizer Production Exclusion H1) |
| Letzter Laufzeit-Release mit **sichtbarer** Funktionalität | Startseite-Zuverlässigkeit W7-R1A, Laufzeit-RC **und** Release-Kopf `8fcb603dac7db3599695c031a7fc3ef702892fa3` (2026-09-08; **frontend-only** — keine Migration, kein Edge-Deploy, keine Production-DB-Änderung) | Archiv `releases/2026-09.md` (Startseite-Zuverlässigkeit W7-R1A) |
| Letzter Datenbank-Release | Atomic Contact Primary Intent, Laufzeit-RC `0fb3d6ba6a52613e366c780586c4988d264c61eb`, Release-Kopf `5d526231b21848a2720629a12bd55ac902e6cb43` (2026-09-08; Datenbank + Frontend — Migration `20260908120000_nora_atomic_contact_primary_intent`, kein Edge-Deploy) | Archiv `releases/2026-09.md` (Nachtrag Release Atomic Contact Primary Intent) |
| Vorheriger Datenbank-Release | Security Hardening Wave 1, Laufzeit-RC `8f812f3bfb6b398382ea448859050a6c3f03d85d`, Release-Paket `59c7dcf3032de1fd1c05b4a6d4da9718a0c22194` (2026-09-07; **nur Datenbank**, keine sichtbare Änderung) | Archiv `releases/2026-09.md` (Eintrag Security Hardening Wave 1) |
| Frontend | Vercel-Projekt `nora-crm`, Domain `nora.ergart.de`, automatisches Production-Deployment pro Push auf `main`; ausgeliefert ist der H2-Build `5cae655f` (Production READY, Alias `nora.ergart.de`; Identitätsnachweis ist die im Bundle eingebettete Commit-SHA). Fachlich unverändert der Stand Startseite-Zuverlässigkeit W7-R1A — weder H1 noch H2 ändern eine sichtbare Funktion | Release-Archiv `releases/2026-09.md` |
| Datenbank | `nora-crm-prod` (`kixxroxtfzbcbzctohex`), Postgres 17.6; Migrations-Ledger **58 Einträge, Kopf `20260908120000_nora_atomic_contact_primary_intent`**, deckungsgleich mit `supabase/migrations/` (58 Dateien) | `list_migrations` read-only 2026-09-08 |
| Edge Function `users` | **Version 9** (`verify_jwt = false`, verifiziert JWTs selbst; Stand W6-B) | `list_edge_functions` read-only 2026-09-07 |
| Edge Function `brevo-email-events` | **Version 2** (`verify_jwt = false`, Bearer-Token) | dito |
| Weitere Edge Functions im Repo (`calendar-*`, `merge_contacts`, `delete_note_attachments`, `update_password`, `postmark`, `mcp`) | **nicht** in Production deployt (nur `users` und `brevo-email-events` sind live) | dito |
| Build / CI | **Build-/Bundle-Gate GREEN**: Entry 1009 kB / Budget 1050, Gesamt 2392 kB / Budget 2600 (Budgets seit 2026-08-15 unverändert). **Gesamt-CI weiterhin RED** — ausschließlich wegen der bekannten E2E-Bootstrap-Baseline `17-known-issues-and-planned-waves.md` I.2 | GitHub-Run `34425680399` auf `5cae655f`; Archiv `releases/2026-09.md` (Entry-Chunk-Budget H2) |
| Produktionsdaten | real (**4 Mitarbeiter**, davon 2 aktive Administratoren; das deaktivierte Testkonto `sales.id = 4` wurde am 2026-09-07 im W6-B-Live-Beweis endgültig gelöscht. Geschäftsdaten wachsen durch Nutzung und blieben unberührt) | Archiv W6-B |

Release-Regel (schemaabhängige Wellen): RC einfrieren → Production-Migration → DB-Verifikation → Edge-Deploy → Push → Live-Smoke; Details in `07-agent-change-checklist.md`. **Nach einem Deployment holt ein Reload allein den neuen Build nicht** (PWA im Prompt-Modus) — siehe Abschnitt 5 und Checkliste.

## 5. Abgeschlossene Wellen (Überblick)

Alle folgenden Wellen sind auf `main` — **die Spalte `Status` gilt pro Zeile und ist nicht pauschal „live"**: Repository-Stand, DB-Deployment, Edge-Deployment und produktive Nutzbarkeit sind vier verschiedene Fakten (Kalender ist der Fall, in dem sie auseinanderfallen). Status wie zuletzt dokumentiert. Details und Evidenz: Archiv-Monat in Klammern; Entscheidungen: `06-decision-log.md`.

| Bereich | Welle | Status | Archiv |
|---|---|---|---|
| Fundament | Atomic-CRM-Basis, deutsches Branding, Welle 4–7b (Typografie, Nachfassen, Startseite, Nummern, Suche, Hotboard, Fenster-Kanban, Checklisten, Schnellerfassung, Dubletten) | live | `2026-06` |
| UX / Rollen | v0.3f–v0.3k.2 (Demo-Daten, Schnellerfassung-UX, Kanban/Akte, rollenbewusste UX, Demo-Rollensimulation) | live | `2026-07` |
| Security | v0.4a/b/b.1/b.2 (RBAC/RLS, `nora_private`, Capability-Rolle, `sales_directory`) | live | `2026-07` |
| Audit | v0.3l/v0.3l.1 CRM-Audit | live | `2026-07` |
| Kalender | v0.4c.1/c.2/c.2c Google-Kalender read-only, OAuth, Sync, Release-Gates | **nicht produktiv nutzbar** — Code vollständig auf `main`; **Datenbankgrundlage deployed** (Migrationen `20260716120000`, `20260717120000` im Ledger; `google_calendar_connections` und `google_calendar_events` existieren, beide **0 Zeilen**); **die drei `calendar-*` Edge Functions sind nicht deployt** (read-only verifiziert 2026-09-10), damit gibt es keinen Verbinde- und keinen Sync-Pfad. Die Route `/google-kalender` existiert und rendert die vollständige Adminfläche — sie zeigt „keine Verbindung"/„keine Termine" und ihre beiden Aktionen laufen ins Leere; **eine vorhandene Route ist kein Beweis einer nutzbaren Integration**. Details: `14-…` und `11-…`, jeweils Kasten im Kopf | `2026-07` |
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
| Security | Security Hardening Wave 1 (Default-Privilegien `public` + explizite Zielmatrix) | **`PRODUCTION VERIFIED`** (2026-09-07; nur Datenbank, Migration `20260907120000`, keine sichtbare Änderung) | `2026-09` |
| Lifecycle | User Lifecycle W1, W2, W3, W4, W5 | `PRODUCTION VERIFIED` (2026-09-05/06) | `2026-09` |
| Lifecycle | User Lifecycle W6-A (Session-Autorisierung fail-closed/Owner-gebunden) | `PRODUCTION VERIFIED` (2026-09-06; nur Datenbank, Migration `20260906210000`, keine sichtbare Änderung) | `2026-09` |
| Lifecycle | User Lifecycle W6-B (kontrollierter Hard Delete „Benutzerkonto endgültig löschen") | **`PRODUCTION VERIFIED`** (2026-09-07; Migration `20260906230000`, `users`-Edge v9, Frontend; Live-Beweis am Testkonto `sales.id = 4`) | `2026-09` |
| Kunden/Kontakte | Atomic Contact Primary Intent (Kontakt-Speichern + „Hauptansprechpartner" als eine Transaktion) | **`PRODUCTION VERIFIED`** (2026-09-08; Migration `20260908120000`, Frontend, kein Edge-Deploy; PO-Live-Smoke am Testkunden `companies.id = 20`) | `2026-09` |
| Startseite | Startseite-Zuverlässigkeit W7-R1A (gültige Kontakt-/Kunden-Ids, kein leerer Ladezustand) | **`PRODUCTION VERIFIED`** (2026-09-08; frontend-only, keine Migration, kein Edge-Deploy; Live-Beweis `contacts?id=in.(1,29)` statt `contacts?id=in.(1,1,,29,)`). **Wave 7 ist damit nicht abgeschlossen** — W7-R1B (`Deal.company_id` Contract-Parity) steht aus | `2026-09` |
| Build / PWA-Hygiene | Visualizer Production Exclusion H1 (Bundle-Visualizer nur noch bei `ANALYZE=true`) | **`PRODUCTION VERIFIED`** (2026-09-09; frontend-only Build-Hygiene, keine Migration, kein Edge-Deploy, keine sichtbare Funktionsänderung; `/stats.html` 404, Precache 38 → 37) | `2026-09` |
| Build / Bundle | Entry-Chunk-Budget H2 (Lodash-Root-Import in `ContactListContent.tsx` durch Per-Methode-Imports ersetzt) | **`PRODUCTION VERIFIED`** (2026-09-10; frontend-only, keine Migration, kein Edge-Deploy, keine sichtbare Funktionsänderung; Entry 1092 → 1009 kB, Gesamt 2475 → 2392 kB, Budgets unverändert). Das Build-/Bundle-Gate ist damit wieder grün; **der Gesamt-CI bleibt rot** wegen der E2E-Bootstrap-Baseline (`17-known-issues-and-planned-waves.md` I.2) | `2026-09` |

**Was heute gilt (Kurzfassungen der Subsysteme):**

- **Kunden/Kontakte:** `customer_kind`, Hauptansprechpartner, `links_jsonb`/`email_jsonb`/`phone_jsonb`, atomare Anlage-RPCs, `self_contact_id`, Effective Contact Context, Quick Capture atomar mit Idempotency — `01-domain-model.md`. **„Hauptansprechpartner" ist eine Geschäftstransition, kein Spaltenschreibvorgang** (`PRODUCTION VERIFIED` 2026-09-08): `public.create_contact` / `public.update_contact` führen Kontaktschreibung und Rollenwechsel in **einer** Transaktion aus, serialisiert je Kunde über einen Advisory-Lock; das Formular schreibt `is_primary` nie mehr roh — `06-decision-log.md` „2026-09-08 – Atomic Contact Primary Intent", `03-data-model-guardrails.md` Falle 40.
- **Startseite:** Ansprechpartner- und Kunden-Ids werden aus Aufgaben bzw. Vorgängen über `resolveHotboardContactIds` / `resolveHotboardCompanyIds` abgeleitet — leere Ids raus, Duplikate raus, Reihenfolge des ersten Vorkommens bleibt (`tasks.contact_id` und `deals.company_id` sind nullable). Während des Ladens rendert die Startseite ein Skeleton statt einer leeren Fläche. Diese Resolver sind presentation-lokale Read-Normalisierung, **noch keine** Application-Query-Schicht — `dashboard/hotboardUtils.ts`, Evidenz `releases/2026-09.md`.
- **Aufgaben:** `tasks.company_id` historisch stabil, Aufgaben-Tab auf der Kundenakte (Desktop) — `01-domain-model.md`, Fallen 7/7a.
- **Fehler/Operationen:** `NoraErrorCode` über `DETAIL`, Operation Manager mit `execution`/`errorCode`/`result`, Idempotency-Records — `06-decision-log.md` 2026-08-28/29, `domain/noraErrorCodes.ts`, `operations/*`.
- **Feedback:** eine Statuskarte pro Intent, über Dialogen, click-through; nur Quick Capture migriert, sonner für alle anderen Flows — `notifications/*`, `02-design-system.md`.
- **PWA:** Prompt-Modus (wartender Worker), Browser-Fakten als Wahrheit, Zustände `available · applying · slow · reloadRequired · failed`, Bestätigung nach dem Reload — `06-decision-log.md` „PWA-Update-Lifecycle", `02-design-system.md`, `pwa/*`. **Der Precache trägt keine Diagnoseartefakte** (H1, `PRODUCTION VERIFIED` 2026-09-09): die Workbox-Glob `**/*.html` nimmt alles mit, was in `dist/` liegt — der Bundle-Visualizer schreibt `dist/stats.html` deshalb nur noch bei `ANALYZE=true` (`06-decision-log.md` „2026-09-09 – Visualizer Production Exclusion").
- **Mitarbeiter-Lifecycle:** abgeleiteter Zugangsstatus, ein Executor je Aktion, historische Identität, Audit-Actor, kontrollierte E-Mail-Änderung, Offboarding mit Session-Revokation und Preview — `19-user-lifecycle-architecture.md`. Kontrollierter Hard Delete (W6-B) ist live: der **einzige** unterstützte Löschpfad für Mitarbeiterkonten, nur für Konten ohne Geschäfts- und Urheberschaftshistorie; Konten mit Historie werden offboarded, nie gelöscht. Kontolöschung ist **keine** DSGVO-Löschung — das Audit bleibt.
- **E-Mail-Zustellung:** Brevo-Webhook, Best-Effort-Korrelation, Zustellzeile im Panel, kein Tracking — `18-email-delivery-observability.md`.

## 6. Welche Dokumente muss ich für welches Thema lesen?

Das entscheidet der Router: [`README.md`](README.md), Tabelle `Architekturbereiche`. Sie nennt pro Bereich den aktuellen Contract, den benannten `06`-Eintrag für die Begründung und die `17`-Sektion für die offenen Punkte. Dieses Dokument führt bewusst keine zweite Routingtabelle.

## 7. Truth Hierarchy

Bei Widersprüchen zwischen Chatwissen, Dokumentation, Repository und Production gilt:

1. **verifizierter tatsächlicher Production-Zustand** — wenn er materiell vom Repository-Sollzustand abweicht
2. **aktueller Code und aktuelle Migrationen im Repository**
3. Git-Historie
4. aktuelle Architektur-/Contract-Dokumente (`16`, `01`, `03`, `13`, `18`, `19`, … — Zuordnung im Router)
5. durable Entscheidungen mit Begründung (`06`)
6. historische Release-Evidenz (`releases/`)
7. Chatwissen aus vorherigen Sitzungen

**Repository-Code ist dadurch nicht zweitrangig — er antwortet auf eine andere Frage.** Das Repository ist autoritativ dafür, was der **nächste Release** enthält; der verifizierte Production-Zustand ist autoritativ dafür, was **heute läuft**. Beide Fakten fallen regelmäßig auseinander: der Repository-/Dokumentationskopf wandert mit jedem Docs-Commit, ohne die Laufzeit zu verändern (Abschnitt 4). Erst wenn eine Aussage über den **heutigen Live-Zustand** getroffen wird und beide materiell widersprechen, gewinnt Production — und dann ist die Abweichung selbst ein Befund, der dokumentiert und nicht stillschweigend übernommen wird.

Dokumentation ist niemals autoritativer als Code, Migrationen oder verifizierter Production-Zustand. Innerhalb der Dokumentation gilt: **aktuelle Wahrheit** steht in `16`/`01`/`03`/`19` und den Subsystem-Contracts, **durable Entscheidungen** in `06`, **historische Fakten** im Archiv `releases/` — ein historischer Eintrag beschreibt den Wissensstand seines Datums, nicht den heutigen Zustand.
