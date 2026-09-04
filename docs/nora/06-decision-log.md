# 06 – Decision Log Nora CRM

Dieses Dokument hält relevante Entscheidungen fest. Neue Entscheidungen müssen mit Datum, Kontext, Entscheidung und Begründung ergänzt werden.

## Index (chronologisch neueste zuerst)

Diese Datei ist inzwischen sehr groß. Nicht komplett lesen, wenn nur eine bestimmte Entscheidung relevant ist — gezielt per Anker springen oder im Editor nach dem Titeltext suchen (Anker sind Best-Effort-Slugs; falls ein Link im jeweiligen Viewer nicht funktioniert, stattdessen nach dem Titeltext suchen).

| Entscheidung | Anker |
|---|---|
| 2026-09-04 – Employee Onboarding & Access V1A: Zugangsstatus wird abgeleitet, nicht gespeichert | [Springen](#2026-09-04--employee-onboarding--access-v1a-zugangsstatus-wird-abgeleitet-nicht-gespeichert) |
| 2026-09-01 – Customer Create Speed & Clarity: Land ausgeblendet, Bundesland NRW, „Weitere Angaben" eingeklappt | [Springen](#2026-09-01--customer-create-speed--clarity-land-ausgeblendet-bundesland-nrw-weitere-angaben-eingeklappt) |
| 2026-09-01 – PWA Completion Acknowledgement: „Aktualisierung abgeschlossen" nach dem Reload, genau einmal | [Springen](#2026-09-01--pwa-completion-acknowledgement-aktualisierung-abgeschlossen-nach-dem-reload-genau-einmal) |
| 2026-09-01 – PWA Visual Polish 2: Ring statt Spektakel, kein Reload-Angebot bei wartendem Worker | [Springen](#2026-09-01--pwa-visual-polish-2-ring-statt-spektakel-kein-reload-angebot-bei-wartendem-worker) |
| 2026-09-01 – PWA Update State Contract V2: Browser-Fakten statt Entdeckungssignal | [Springen](#2026-09-01--pwa-update-state-contract-v2-browser-fakten-statt-entdeckungssignal) |
| 2026-08-30 – Eine bestätigte Übernahme ist endgültig: `activated` ist monoton (PWA-1C.3) | [Springen](#2026-08-30--eine-bestätigte-übernahme-ist-endgültig-activated-ist-monoton-pwa-1c3) |
| 2026-08-30 – Ein Retry muss etwas senden: der beendete Aktivierungsversuch (PWA-1C.2 Closure) | [Springen](#2026-08-30--ein-retry-muss-etwas-senden-der-beendete-aktivierungsversuch-pwa-1c2-closure) |
| 2026-08-30 – Aktivierungsanfrage ist kein Erfolgssignal: Watchdog statt Promise (PWA-1C.2) | [Springen](#2026-08-30--aktivierungsanfrage-ist-kein-erfolgssignal-watchdog-statt-promise-pwa-1c2) |
| 2026-08-30 – Premium Update Experience und 8-Sekunden-Choreografie (PWA-1C.1) | [Springen](#2026-08-30--premium-update-experience-und-8-sekunden-choreografie-pwa-1c1) |
| 2026-08-30 – Update-Experience als Anwendungs-Systemereignis (PWA-1C) | [Springen](#2026-08-30--update-experience-als-anwendungs-systemereignis-pwa-1c) |
| 2026-08-30 – PWA-Update: wartender Worker statt automatischer Übernahme (PWA-1B) | [Springen](#2026-08-30--pwa-update-wartender-worker-statt-automatischer-übernahme-pwa-1b) |
| 2026-08-30 – Vorgänge-Kanban Navigation Rail | [Springen](#2026-08-30-vorgänge-kanban-navigation-rail) |
| 2026-08-29 – Notification Presentation Contract v1 (Phase 7A) | [Springen](#2026-08-29-notification-presentation-contract-v1-phase-7a) |
| 2026-08-29 – Operation Status Contract Wave (v1, CreateQuickCaptureCase Slice) | [Springen](#2026-08-29-operation-status-contract-wave-v1-createquickcapturecase-slice) |
| 2026-08-29 – Idempotency Wave | [Springen](#2026-08-29-idempotency-wave) |
| 2026-08-28 – Kontakterstellung UI-Polish | [Springen](#2026-08-28-kontakterstellung-ui-polish) |
| 2026-08-28 – Error Contract Wave | [Springen](#2026-08-28-error-contract-wave) |
| 2026-08-28 – Residual Security Advisor Closure | [Springen](#2026-08-28-residual-security-advisor-closure) |
| 2026-08-28 – Intentional privileged read views (`init_state` / `sales_directory`) | [Springen](#2026-08-28-intentional-privileged-read-views-init_state--sales_directory) |
| 2026-08-27 – Pre-Production Hardening Patch | [Springen](#2026-08-27-pre-production-hardening-patch) |
| 2026-08-26 – Self Contact Wave | [Springen](#2026-08-26-self-contact-wave) |
| 2026-08-25 – Unified Tasks Wave | [Springen](#2026-08-25-unified-tasks-wave) |
| 2026-08-25 – Repo/Produktions-Drift bei `nora_core_indexes` unabhängig bestätigt | [Springen](#2026-08-25-repoproduktions-drift-bei-nora_core_indexes-unabhängig-bestätigt) |
| 2026-08-25 – Customer & Contact Workflow Wave | [Springen](#2026-08-25-customer-contact-workflow-wave) |
| 2026-08-25 – Erste lokale Postgres-Verifikation der Customer & Contact Workflow Migration | [Springen](#2026-08-25-erste-lokale-postgres-verifikation-der-customer-contact-workflow-migration) |
| 2026-08-25 – Customer & Contact Workflow Migration auf Produktion angewendet | [Springen](#2026-08-25-customer-contact-workflow-migration-auf-produktion-angewendet) |
| 2026-08-10 – Foundation Wave 3: Error Observatory Core | [Springen](#2026-08-10-foundation-wave-3-error-observatory-core) |
| 2026-08-10 – Stabilization Gate 2b: TaskEdit Portal Form Owner | [Springen](#2026-08-10-stabilization-gate-2b-taskedit-portal-form-owner) |
| 2026-08-10 – Stabilization Gate 2: DealEdit Portal Form Owner | [Springen](#2026-08-10-stabilization-gate-2-dealedit-portal-form-owner) |
| 2026-08-10 – Foundation Wave 2: Operation Manager + Catalog | [Springen](#2026-08-10-foundation-wave-2-operation-manager-catalog) |
| 2026-08-10 – Stabilization Gate 1: Deal Surface Recovery | [Springen](#2026-08-10-stabilization-gate-1-deal-surface-recovery) |
| 2026-06-28 – Atomic CRM als Basis für Nora CRM | [Springen](#2026-06-28-atomic-crm-als-basis-für-nora-crm) |
| 2026-06-28 – Interne Resource-Namen bleiben stabil | [Springen](#2026-06-28-interne-resource-namen-bleiben-stabil) |
| 2026-06-28 – Deals werden sichtbar zu Vorgängen | [Springen](#2026-06-28-deals-werden-sichtbar-zu-vorgängen) |
| 2026-06-28 – Nora-Brandfarbe | [Springen](#2026-06-28-nora-brandfarbe) |
| 2026-06-28 – EUR und de-DE | [Springen](#2026-06-28-eur-und-de-de) |
| 2026-06-28 – Demo-Daten sind synthetisch | [Springen](#2026-06-28-demo-daten-sind-synthetisch) |
| 2026-06-28 – Welle 4: Typografie und comfortable density | [Springen](#2026-06-28-welle-4-typografie-und-comfortable-density) |
| 2026-06-28 – Welle 5: Vorgangsworkflow ohne DB-Änderung | [Springen](#2026-06-28-welle-5-vorgangsworkflow-ohne-db-änderung) |
| 2026-06-28 – Welle 6a: Öffentliche Startseite | [Springen](#2026-06-28-welle-6a-öffentliche-startseite) |
| 2026-06-28 – Welle 6a-Polish: Auth-Navigation | [Springen](#2026-06-28-welle-6a-polish-auth-navigation) |
| 2026-06-28 – Vorgänge-Kanban aufräumen (Kanban-Polish) | [Springen](#2026-06-28-vorgänge-kanban-aufräumen-kanban-polish) |
| 2026-06-28 – Welle 6b: Kundennummern, Vorgangsnummern, globale Suche (Spezifikation) | [Springen](#2026-06-28-welle-6b-kundennummern-vorgangsnummern-globale-suche-spezifikation) |
| 2026-06-28 – Welle 6c: Kundennummern und Vorgangsnummern implementiert | [Springen](#2026-06-28-welle-6c-kundennummern-und-vorgangsnummern-implementiert) |
| 2026-06-28 – Welle 6c-QA: Datenbank-Audit Nummern | [Springen](#2026-06-28-welle-6c-qa-datenbank-audit-nummern) |
| 2026-06-28 – Welle 6c-Hardening: Nummern-API absichern | [Springen](#2026-06-28-welle-6c-hardening-nummern-api-absichern) |
| 2026-06-28 – Welle 7a: Fensterauftrag-Prozess spezifiziert | [Springen](#2026-06-28-welle-7a-fensterauftrag-prozess-spezifiziert) |
| 2026-06-28 – Welle 6d: Globale Suche im Header | [Springen](#2026-06-28-welle-6d-globale-suche-im-header) |
| 2026-06-28 – v0.3b: Hotboard / operative Startübersicht | [Springen](#2026-06-28-v03b-hotboard-operative-startübersicht) |
| 2026-06-28 – v0.3c: Fenster-Kanban-Filter | [Springen](#2026-06-28-v03c-fenster-kanban-filter) |
| 2026-06-28 – Welle 7b: Checklisten-, Textbaustein- und Audit-Datenmodell spezifiziert | [Springen](#2026-06-28-welle-7b-checklisten--textbaustein--und-audit-datenmodell-spezifiziert) |
| 2026-06-28 – v0.3d2: Datenbankmigration Checklisten, Textbausteine, Audit | [Springen](#2026-06-28-v03d2-datenbankmigration-checklisten-textbausteine-audit) |
| 2026-06-28 – v0.3d3: Checklisten-Run-Start absichern | [Springen](#2026-06-28-v03d3-checklisten-run-start-absichern) |
| 2026-06-28 – v0.3d4: Checklisten-UI im Vorgangsdetail | [Springen](#2026-06-28-v03d4-checklisten-ui-im-vorgangsdetail) |
| 2026-06-28 – v0.3d5: Hotboard „Produktionsfreigaben offen“ | [Springen](#2026-06-28-v03d5-hotboard-produktionsfreigaben-offen) |
| 2026-06-28 – v0.3e: Schnellerfassung / Eingangszentrale | [Springen](#2026-06-28-v03e-schnellerfassung-eingangszentrale) |
| 2026-06-28 – v0.3f: Intelligente Dubletten-Vorschläge | [Springen](#2026-06-28-v03f-intelligente-dubletten-vorschläge) |
| 2026-07-14 – v0.3f: Realistische Demo- und UX-Testdaten | [Springen](#2026-07-14-v03f-realistische-demo--und-ux-testdaten) |
| 2026-07-14 – UX-Polish: Kontakte-Suche und globale Suche | [Springen](#2026-07-14-ux-polish-kontakte-suche-und-globale-suche) |
| 2026-07-14 – v0.3g: Schnellerfassung UX-Überarbeitung | [Springen](#2026-07-14-v03g-schnellerfassung-ux-überarbeitung) |
| 2026-07-14 – v0.3h: Kundenliste und Vorgänge-Kanban responsiver | [Springen](#2026-07-14-v03h-kundenliste-und-vorgänge-kanban-responsiver) |
| 2026-07-14 – v0.3i: Kanban und Vorgangsakte barrierearm | [Springen](#2026-07-14-v03i-kanban-und-vorgangsakte-barrierearm) |
| 2026-07-14 – Demo-Auftragswerte korrigiert | [Springen](#2026-07-14-demo-auftragswerte-korrigiert) |
| 2026-07-14 – v0.4a: Google-Kalender-Architektur und Nora-Rollenmodell spezifiziert | [Springen](#2026-07-14-v04a-google-kalender-architektur-und-nora-rollenmodell-spezifiziert) |
| 2026-07-14 – v0.4b: RBAC- und RLS-Härtung | [Springen](#2026-07-14-v04b-rbac--und-rls-härtung) |
| 2026-07-14 – v0.3j: Hotboard-Arbeitsboard (Fokusboard) | [Springen](#2026-07-14-v03j-hotboard-arbeitsboard-fokusboard) |
| 2026-07-14 – v0.4b.1: RBAC-Migrations- und Function-Hardening | [Springen](#2026-07-14-v04b1-rbac-migrations--und-function-hardening) |
| 2026-07-14 – v0.4b.2: RBAC-Abschluss (Capability, Parallel-Admin, sales_directory) | [Springen](#2026-07-14-v04b2-rbac-abschluss-capability-parallel-admin-sales_directory) |
| 2026-07-14 – Demo-Seed: `amountCents` → `amountEur` | [Springen](#2026-07-14-demo-seed-amountcents-amounteur) |
| 2026-07-14 – v0.3k: Rollenbewusste UX, Ladezustände und Fehlertoleranz | [Springen](#2026-07-14-v03k-rollenbewusste-ux-ladezustände-und-fehlertoleranz) |
| 2026-07-14 – v0.3k.1: Rollen-UX-Abnahme und Dialog-Polish | [Springen](#2026-07-14-v03k1-rollen-ux-abnahme-und-dialog-polish) |
| 2026-07-14 – v0.3k.2: Demo-Rollensimulation und abschließende Rollen-UX-Abnahme | [Springen](#2026-07-14-v03k2-demo-rollensimulation-und-abschließende-rollen-ux-abnahme) |
| 2026-07-15 – v0.3l: Vollständiger CRM-Audit-Verlauf | [Springen](#2026-07-15-v03l-vollständiger-crm-audit-verlauf) |
| 2026-07-15 – v0.3l.1: CRM-Audit-Abschluss (Schema-Sync, Tests, Abnahme) | [Springen](#2026-07-15-v03l1-crm-audit-abschluss-schema-sync-tests-abnahme) |
| 2026-07-16 – v0.4c.1: Google-Kalender Read-only Grundlage | [Springen](#2026-07-16-v04c1-google-kalender-read-only-grundlage) |
| 2026-07-16 – v0.4c.2: Google OAuth, Token-Verschlüsselung, manueller Sync | [Springen](#2026-07-16-v04c2-google-oauth-token-verschlüsselung-manueller-sync) |
| 2026-07-17 – v0.4c.2c: Release-Gates und Deployment-Bereinigung | [Springen](#2026-07-17-v04c2c-release-gates-und-deployment-bereinigung) |
| 2026-07-17 – v0.4c.2c: E2E-Bootstrap und Profilzugriff | [Springen](#2026-07-17-v04c2c-e2e-bootstrap-und-profilzugriff) |
| 2026-07-17 – v0.4c.2c: E2E-Auth-Assertions und First-Run-Dashboard | [Springen](#2026-07-17-v04c2c-e2e-auth-assertions-und-first-run-dashboard) |
| 2026-07-24 – Rollen-RPC: service_role Claims-Erkennung | [Springen](#2026-07-24-rollen-rpc-service_role-claims-erkennung) |
| 2026-07-24 – Identity-Cache nach Profilnamensänderung | [Springen](#2026-07-24-identity-cache-nach-profilnamensänderung) |
| 2026-07-23 – Mitarbeiterzugang: öffentliches Redesign und Einladung | [Springen](#2026-07-23-mitarbeiterzugang-öffentliches-redesign-und-einladung) |
| 2026-07-23 – Profil-Update: Pending-Default und Rollen-Seiteneffekt | [Springen](#2026-07-23-profil-update-pending-default-und-rollen-seiteneffekt) |
| 2026-07-23 – DB-Lint: Funktionsvolatilität und ungenutzte Variablen | [Springen](#2026-07-23-db-lint-funktionsvolatilität-und-ungenutzte-variablen) |
| 2026-08-10 – Foundation Wave 1: Operation Correlation | [Springen](#2026-08-10-foundation-wave-1-operation-correlation) |
| 2026-08-15 – Kernindizes und Bundle-Budget | [Springen](#2026-08-15-kernindizes-und-bundle-budget) |

---

## 2026-09-04 – Employee Onboarding & Access V1A: Zugangsstatus wird abgeleitet, nicht gespeichert

**Kontext.** Nora ist einladungsbasiert. Administratoren konnten bisher weder
sehen, ob eine eingeladene Person ihren Zugang tatsächlich eingerichtet hat,
noch gezielt die passende Zugangs-E-Mail auslösen. Der Browser darf `auth.users`
nicht sehen, und `public.sales` kennt nur `disabled`.

**Entscheidung 1 — kein redundantes Statusfeld.** Der produktseitige Zustand des
Nora-Zugangs wird **abgeleitet**, nicht gespeichert. Autoritative Quellen sind
ausschließlich Supabase Auth (`email_confirmed_at`/`confirmed_at`,
`banned_until`, `invited_at`) und `public.sales.disabled`. Es gibt **keine**
Migration und **keine** neue Statusspalte — das wäre genau die doppelte
Datenhaltung, die `03-data-model-guardrails.md` verbietet.

**Entscheidung 2 — vier Zustände, nicht drei.** Produktvokabular:

| Zustand | Technische Wahrheit | Erlaubte Admin-Aktion |
|---|---|---|
| `invited` („Einladung gesendet") | Auth-Identität existiert, E-Mail **nicht** bestätigt | „Einladung erneut senden", deaktivieren |
| `active` („Zugang aktiv") | E-Mail bestätigt, nicht deaktiviert | „Passwort einrichten lassen", deaktivieren |
| `disabled` („Zugang deaktiviert") | `sales.disabled` **oder** aktiver Auth-Bann | aktivieren |
| `unknown` („Zugang unklar") | `sales`-Zeile ohne auflösbare Auth-Identität | **keine** |

`unknown` ist bewusst ergänzt und begründet: eine solche Zeile ist nicht
deaktiviert (niemand hat sie deaktiviert) und darf **nicht** als `invited`
behandelt werden, weil eine erneute Einladung dann eine *zweite* Auth-Identität
für dieselbe Person erzeugen würde. `unknown` bietet deshalb keine Aktion an.

**Entscheidung 3 — `last_sign_in_at` ist kein Zustandssignal.** Wer seinen
Zugang eingerichtet, sich aber nie angemeldet hat, ist `active`. Wessen Session
abgelaufen ist, ist nicht wieder `invited`. Bestätigung der E-Mail-Adresse ist
die einzige Tatsache, die „hat den Einladungslink benutzt" von „hat ihn nicht
benutzt" trennt. `last_sign_in_at` ist deshalb nicht einmal Teil des gelesenen
Faktenausschnitts.

**Entscheidung 4 — zwei getrennte Admin-Aktionen statt einer.** Für eine
**aktive** Person ist „Einladung erneut senden" fachlich falsch — sie braucht
keine Erst-Einladung. Sie erhält „Passwort einrichten lassen". Technisch ist das
der Supabase-Recovery-Mechanismus; das bleibt ein internes Implementierungsdetail
und heißt im Administrationsablauf **nicht** „Passwort vergessen". Der
Administrator erzeugt kein Passwort, sieht keinen Token und erfährt das Passwort
der Person nicht.

**Entscheidung 5 — GoTrue-Semantik explizit behandelt, nicht geraten.** Eine
erneute Einladung an eine existierende, **unbestätigte** Auth-Identität sendet
die Einladung erneut auf demselben Benutzer. `email_exists` liefert GoTrue nur
für eine bereits **bestätigte** Identität. Genau so ist der Server-Handler
gebaut: `email_exists` wird nicht als Fehler behandelt, sondern als Beweis, dass
der abgeleitete Zustand veraltet war — die Antwort ist `action_not_applicable`
mit `accessState: "active"`. Es wird kein zweiter `sales`-Datensatz und keine
zweite Auth-Identität erzeugt.

**Entscheidung 6 — `/auth-callback` gehört react-admin, nicht Nora.**
`public/auth-callback.html` leitete die Supabase-Tokens bisher auf
`#/auth-callback` weiter. Diese Route ist von react-admin für
`authProvider.handleCallback` reserviert, das Nora nicht implementiert — beide
E-Mail-Wege (Einladung **und** Passwort-Link) endeten dadurch auf „Something
went wrong". Nora besitzt jetzt die eigene Route `/zugang-einrichten`, die
Einladungs- und Recovery-Weg auf dieselbe Passwortvergabe zusammenführt.

**Entscheidung 7 — WELCOME behauptet nichts, COMPLETE ist bewiesen.** Der
Onboarding-Ablauf ist eine reine Zustandsmaschine
(`login/employeeOnboardingFlow.ts`): `checking → welcome → password → profile →
complete`, mit den Nebenzuständen `invalid` und `blocked`. `welcome` behauptet
ausdrücklich **nicht**, dass ein Passwort gesetzt ist. `complete` ist nur
erreichbar, wenn alle vier Bedingungen aus `SUCCESS_PRECONDITIONS` gelten:
authentifizierte Session, erfolgreiche Passwortänderung, gültige
`sales`-Zuordnung, Zugang nicht deaktiviert. Eine deaktivierte Person landet aus
jedem Schritt in `blocked` und erreicht `complete` nie. Animation darf diese
Übergänge nicht auslösen.

**Entscheidung 8 — Begrüßungsdaten nur aus authentifizierter Identität.**
„Hallo Viktoriia" und die Anmeldeadresse stammen aus `user.user_metadata` bzw.
`user.email` der echten Session. URL-Query-Parameter werden nie als Identität
vertraut.

**Nicht Teil dieser Welle (bewusst):** endgültiges Hard Delete von Benutzern und
Änderung der Login-E-Mail einer aktivierten Person — beides gehört zu
`NORA USER LIFECYCLE ADMIN V1`. Ebenso kein Premium-Visual (V1B).

**Nachtrag 2026-09-04 (unabhängige Produktionsprüfung):** die offene Frage zur
Selbstregistrierung ist beantwortet — `nora-crm-prod` meldet
`disable_signup: false`, öffentliche Selbstregistrierung ist also **aktiv** und
führt über `handle_new_user` zu einer `sales`-Zeile mit Lesezugriff auf alle
Kunden-, Kontakt- und Vorgangsdaten. Das ist ein Bestandsproblem, kein
V1A-Fehler, blockiert aber das V1A-Release, weil V1A Einladungsexklusivität
zusichert. Vollständige Nachweiskette und Behebungsanleitung:
`17-known-issues-and-planned-waves.md`. `supabase/config.toml` bleibt bewusst
unverändert (lokale Konfiguration, steuert Produktion nicht).

Die Prüfung hat den Zustandskontrakt zugleich gegen echte Produktionsdaten
bestätigt: alle fünf `sales`-Zeilen werden truthful abgeleitet, insbesondere die
deaktivierte Zeile mit `sales.disabled = true` bei gleichzeitig
`banned_until = null` — sie wird korrekt als `disabled` gemeldet und bekommt
keine Einladung angeboten. Genau dafür verodert der Kontrakt beide Fakten.

## 2026-09-01 – Customer Create Speed & Clarity: Land ausgeblendet, Bundesland NRW, „Weitere Angaben" eingeklappt

### Kontext

Ergart arbeitet praktisch ausschließlich regional in Deutschland, vor allem in Nordrhein-Westfalen. Auf `/kunden/create` musste das Büro trotzdem bei jedem neuen Kunden „Land" und „Bundesland" von Hand eintippen; daneben standen Sales-CRM-Residuen (Größe, Umsatz) gleichwertig neben den täglich benötigten Feldern. Product-Owner-Auftrag: Kundenanlage schneller und klarer machen — ohne Datenmodell-/Backend-Änderung.

**Ist-Analyse vor der Umsetzung (read-only, `nora-crm-prod` + Code):**

- `companies.country` ist nullable Freitext, kein Default, kein ISO-Code; die RPC `create_customer_with_contact_core` schreibt `nullif(p_company->>'country', '')`. Produktionsbestand: 10× `NULL`, 4× `"Deutschland "` (mit Leerzeichen am Ende), 1× `"Deutschland"`, 1× `"DE"`. Demo-Seed (`noraDemoSeed.ts`): `"Deutschland"`. **Kanonischer Wert ist damit `"Deutschland"`** — kein neuer Wert erfunden.
- `companies.state_abbr` ist nullable Freitext. Produktionsbestand: 9× `NULL`, 7× `"NRW"` — die PO-Vorgabe „NRW" deckt sich mit allen gepflegten Bestandswerten. (Demo-Seed verwendet `"NW"`, siehe Findings in `17-…`.)
- Es gab bereits Form-`defaultValues` in `CustomerCreateForm.tsx` (`sales_id`, `customer_kind`, Ansprechpartner-Modus, Anrede) — der sauberste Ort für den Bundesland-Default. Der Country-Default gehört in den reinen, unit-getesteten Mapper `buildCustomerCreatePayload.ts`, weil das Feld im Formular nicht mehr existiert.

### Entscheidung

1. **Land ist auf „Kunde anlegen" kein sichtbares Feld mehr.** `buildCustomerCreatePayload` setzt `country` auf `DEFAULT_CUSTOMER_COUNTRY = "Deutschland"` (neues Modul `customerCreateDefaults.ts`), sofern nicht explizit ein anderer, nicht-leerer Wert mitkommt; Leerzeichen-Varianten werden als „nicht gesetzt" behandelt. Keine DB-Spalte, kein Domain-Feld, keine Bestandsdaten verändert.
2. **Bundesland startet mit `"NRW"`** (`DEFAULT_CUSTOMER_STATE_ABBR`) über die Form-`defaultValues` — sofort sichtbar, frei überschreibbar, kein Select, keine Bundesländer-Domainlogik.
3. **Create/Edit-Trennung explizit statt implizit:** `CompanyInputs` bekommt `variant="create" | "default"`. `CustomerCreateForm` übergibt `create`; `CompanyEdit` bleibt bei `default`. Im Edit bleibt „Land" sichtbar/editierbar, der gespeicherte Bundesland-Wert wird nie überschrieben, Kontext-Felder bleiben inline.
4. **Progressive Disclosure nur im Create-Flow:** Links, Größe, Umsatz und Steuernummer liegen in einem standardmäßig eingeklappten Bereich „Weitere Angaben" (bestehende `Accordion`-Primitive, dasselbe Muster wie die Kontakterstellung vom 2026-08-28, inkl. automatischem Öffnen bei Validierungsfehler nach Submit). Kundentyp bleibt sichtbar (Nora-fachlich: Privatkunde/Hausverwaltung/Gewerbekunde …). Kein neues Formular-Framework, keine neue Komponentenarchitektur.
5. **Adresse in deutscher Lesereihenfolge:** Straße → PLZ + Ort (eine Zeile) → Bundesland. Gilt für Create und Edit gleichermaßen (ein Address-Block, eine Wahrheit).
6. Neue sichtbare Texte (`resources.companies.create_form.additional`, `additional_help`) in Deutsch, Englisch, Französisch.

### Begründung

Weniger kognitive Last, nicht weniger Daten: Der Standardfall (deutscher Kunde in NRW) erfordert null zusätzliche Eingaben, Ausnahmen bleiben mit einem Tastendruck möglich. Der Country-Default liegt im Application-Layer, damit die Persistenz weiterhin exakt den bisherigen Vertrag (`nullif`, Freitext) erhält und die Regel ohne Formular unit-testbar ist. Die `variant`-Prop macht den Unterschied Create/Edit im Code lesbar statt ihn an `useRecordContext() == null` zu hängen.

### Vor/Nach (Desktop 1440 px, Light)

- **Vorher:** Adresse-Block mit fünf untereinanderstehenden Feldern (Adresse, Ort, Postleitzahl, Bundesland, Land), alle leer; linke Spalte Kontakt (E-Mail, Telefon, Links) + Kontext (Kundentyp, Größe, Umsatz, Steuernummer) inline. Dokumenthöhe 1 552 px.
- **Nachher:** Adresse (Adresse; PLZ | Ort; Bundesland = „NRW"), kein Land; linke Spalte Kontakt (E-Mail, Telefon) + Kontext (Kundentyp) + eingeklappt „Weitere Angaben — Selten benötigt — kann auch später ergänzt werden." Dokumenthöhe 1 402 px. Privatperson: Kontext entfällt, „Weitere Angaben" enthält nur Links.

### Verifikation

- `npm ci`, `npm run typecheck`, `npm run build`: grün.
- Fokussierte Tests: `buildCustomerCreatePayload.test.ts` (12), `CompanyCreate.test.tsx` (8), neu `CompanyEdit.test.tsx` (2) — grün. Abgedeckt: kein Land-Feld; kanonischer Deutschland-Wert im RPC-Payload (mit/ohne Ansprechpartner, Privatperson); NRW-Default; NRW überschreibbar; Edit übernimmt Bestandswerte („Niedersachsen", leer) und zeigt Land; Disclosure eingeklappt/aufklappbar; bestehende Pflichtfeld-Validierung des neuen Ansprechpartners.
- Full Vitest: 88 Dateien, 764 Tests grün, 1 skipped (vorbestehend). ESLint/Prettier auf allen geänderten Dateien grün, `git diff --check` sauber.
- Browser (`npm run dev:demo`): Desktop 1440 px und 784 px, Hell und Dunkel — Land weg, Bundesland „NRW" sichtbar, PLZ/Ort-Zeile sauber, kein horizontaler Overflow, Buttons erreichbar. End-to-End im Demo-Provider: Kunde ohne Ansprechpartner angelegt → Kundenakte zeigt „Neuss / NRW / Deutschland". Edit eines Demo-Kunden zeigt weiterhin „Land = Deutschland", Bundesland unverändert „NW".

### Nicht Teil dieser Änderung

PWA, Kanban, Supabase-Schema/SQL/RLS, Notifications, Operation Status, globales Design System, Loader, Contact-Create-Redesign, Routing, Dependencies. Ansprechpartner-Logik (kein/neu/selbst/bestehend) fachlich unverändert — nur geprüft, dass Defaults und Layout sie nicht berühren. Bewusst **nicht** umgesetzt (nur empfohlen, siehe `17-…`): Ansprechpartner-Unterabschnitt mit irreführendem Label „Persönliche Angaben" und unbeschrifteten ⊕-Buttons; Privatperson-Namensfelder ganz unten statt oben; Datenhygiene der Produktions-`country`-Werte.

**Status:** CUSTOMER CREATE SPEED & CLARITY RC VERIFIED — READY FOR PRODUCT OWNER REVIEW. Kein main-Push, kein Deployment.

---

## 2026-09-01 – PWA Completion Acknowledgement: „Aktualisierung abgeschlossen" nach dem Reload, genau einmal

### Kontext

Der Update-Experience fehlte der positive Abschluss: Nach „Jetzt aktualisieren" lief die Choreografie, Nora lud neu — und die neue Version begann wortlos. Der Product Owner wollte einen klaren, freundlichen Success-Moment, **nicht vor dem Reload behauptet, sondern nach dem erfolgreichen Reload der neuen Version bestätigt** („Completion Acknowledgement"). Randbedingungen: State Contract V2 bleibt eingefroren, keine neue Lifecycle-Infrastruktur, keine Vermischung mit Operation-Notifications, kein Success bei gewöhnlichem Reload, keinem nach `failed`, keine Doppelanzeige.

### Entscheidung

- **Ein Bit im `sessionStorage`** (`nora.pwa.updateCompleted`, Modul `pwa/pwaUpdateCompletion.ts`) trägt den Erfolg über den Reload. Tab-gebunden: überlebt genau den Reload, läuft nie in andere Tabs, stirbt mit dem Tab. Gleiche Wahl wie `chunk-reload` in `src/main.tsx`. Kein `localStorage`, kein Query-Parameter, kein Cross-Tab-Messaging, kein neuer Store-Zustand.
- **Geschrieben nur an Wahrheitspunkten:** (1) `controllerchange` im Store — der einzige belastbare Übernahmebeweis; synchron im Listener, der vor dem Workbox-Listener registriert ist, also *bevor* der Client aus `virtual:pwa-register` im kontrollierten Tab neu lädt. (2) Noras eigener Reload (`reloadPage` in `NoraUpdateEvent.tsx`): der Fallback nach dem Commit und der Klick auf „Nora neu laden" im Zustand `reloadRequired`, den die Browser-Fakten belegt haben. Nie bei `failed`, `slow`, „Später", F5.
- **Genau einmal:** beim ersten Mount von `NoraUpdateEvent` gelesen, sofort aus dem Speicher gelöscht, im Modulspeicher gemerkt (StrictMode-Doppelaufruf, Layout-Wechsel, Remount nach Login antworten gleich); nach Anzeige quittiert. Ein zweiter Reload findet nichts.
- **Präsentation:** dieselbe Fläche, derselbe Orb, `data-presentation="completed"` — der Orb wird über die Tokens grün (`--nora-success`), geschlossener Ring, ein dünner Haken, der sich nach dem Ring einzeichnet, Titel in Success-Grün. Titel „Aktualisierung abgeschlossen", Zeile „Nora ist bereit." (en „Update complete / Nora is ready.", fr „Mise à jour terminée / Nora est prête."). Keine Aktion, keine Punkte, kein Fokusdiebstahl; Announcer sagt einen Satz. Auto-Dismiss nach 6 s (`COMPLETION_DISMISS_MS`), 420 ms Ausblenden; Escape bei Fokus im Panel blendet früher aus. Reduced Motion: Haken steht fertig, kein Ausblende-Weg.
- **Vorrang des Stores:** meldet der Store direkt nach dem Reload etwas (weiteres Update), tritt die Bestätigung ohne Ausblenden zurück und kommt nicht wieder.
- **Store-Eingriff minimal:** `pwaUpdateStore.ts` erhält genau eine Nebenwirkung (`markUpdateCompleted()` in `handleControllerChange`); Snapshot, Zustände, Invarianten und `useUpdateChoreography.ts` sind unverändert.
- **Dev-Harness:** neuer Knopf „Abschluss anzeigen" (setzt nur das Bit und lädt neu); der echte Weg „Jetzt aktualisieren → 8 s → Übernahme simulieren → 1,5 s Reload" führt ohne Sonderpfad zur Bestätigung. Weiterhin ausschließlich per `import.meta.env.DEV`.
- **Bewusst nicht:** Versionsvergleich als zweite Wahrheit (die Browser-Fakten sind die Wahrheit, ein Build-Env-Abgleich brächte eine zweite Quelle mit Ausfallmöglichkeit), TTL auf dem Bit, Anzeige vor dem Reload, Anzeige über den Notification-/Operation-Store.

### Begründung

Ein Erfolg, der vor dem Reload behauptet wird, ist eine Vermutung; einer, der in der neu geladenen Version steht, ist ein Fakt — genau das, was der State Contract V2 überall sonst verlangt. Der `sessionStorage` ist die kleinste Stelle, die genau eine Dokument-Lebensdauer überbrückt. Und Grün am selben Orb, der eben noch rot lief, sagt „fertig" ohne ein einziges neues Element außer dem Haken.

**Randfall, bewusst akzeptiert:** trifft die Übernahme in einem Tab ein, der weder selbst aktualisiert hat noch vom Client neu geladen wird (externes Update, anderer Tab hat ausgelöst), steht dort „Neue Version bereit"; verschiebt der Benutzer und lädt später von Hand neu, erscheint die Bestätigung — zutreffend, denn *dieser* Reload vollendet das Update in diesem Tab.

**Status:** `PWA COMPLETION ACKNOWLEDGEMENT RC — LOCAL VERIFIED`. Lokaler RC auf `feat/nora-pwa-update-success-ack` (Basis `0e505456`, Visual Polish 2); nicht gepusht, nicht deployed, keine Product-Owner-Abnahme.

---

## 2026-09-01 – PWA Visual Polish 2: Ring statt Spektakel, kein Reload-Angebot bei wartendem Worker

### Kontext

Der State Contract V2 (`3a092771`) hat den unabhängigen finalen technischen Review bestanden (`PWA UPDATE STATE CONTRACT V2 TECHNICALLY APPROVED — FREEZE STATE CONTRACT`, 0 BLOCKER / 0 HIGH / 0 MEDIUM) und ist damit eingefroren. Zwei Punkte blieben offen: **UX-1** — im Zustand „Gleich bereit" bot die Fläche nach der zweiten Frist „Nora neu laden" plus den Hinweis „Falls es nicht weitergeht, hilft ein kurzes Neuladen." an, obwohl der Zwei-Build-Beweis (Build W mit stummem SKIP_WAITING-Handler) zeigte, dass ein Reload bei weiterhin wartendem Worker denselben Build unter demselben Controller lädt und den Benutzer sofort wieder zu „Neue Nora-Version verfügbar" bringt; und die Produktrückmeldung, dass das Panel trotz V2 optisch noch wie die Vorversion wirkt. Zusätzlich hatte der Review festgestellt (NOTE-2), dass `02-design-system.md` in V2 die Abschnitte Accessibility, Kontrast, Mobile, Tokens, Texte und „lokal ansehen" verloren hatte.

### Entscheidung

- **Reine Präsentationswelle.** `pwaUpdateStore.ts`, `pwaRegistration.ts`, `usePwaUpdate.ts`, `useUpdateChoreography.ts`, `vite.config.ts` (Service-Worker-Erzeugung) sind byteweise unverändert; Watchdog, Retry, `reloadRequired`-Invariante, SKIP_WAITING-Vertrag und die Achtsekunden-Timeline bleiben, wie sie sind.
- **UX-1 behoben:** in `slow`/verlängertem Warten gibt es weder Reload-Knopf noch Reparaturtipp. Nach der zweiten Frist erscheint ein leises „Weiterarbeiten", das denselben sicheren Verschiebe-Pfad nimmt wie „Später" (Choreografie `reset()` + `dismissForNow()`): nichts wird gesendet, der wartende Worker bleibt erhalten, eine spätere Übernahme hebt die Verschiebung auf. Keine neue Zustandslogik. Der Reload-CTA existiert nur noch in `reloadRequired`.
- **Der Orb trägt den Zustand.** Neue PWA-lokale Lade-Bewegung: ein dünner, maskierter Conic-Gradient-Bogen auf zwei gegenläufigen Ebenen (Perioden 1 : 1,618; 2,8 s beim Aktualisieren, 5,6 s bei „Gleich bereit"), geschlossener Ruhering bei „Neue Version bereit", gedämpfter entsättigter Orb im Fehlerfall. Kein rotierender Ladekreis, keine Abhängigkeit, nur `transform`/`opacity`. Reduced Motion ersetzt den Bogen durch den Ruhering. Noras globale Loader bleiben unangetastet (eigene Welle).
- **Komposition:** 30 rem statt 34, flaches Material, Radius 2 rem, Orb 7 rem (Update-Szene 1,16 statt 1,32), Titel 1,375 rem, eine Nebenzeile, eine Aktionsreihe mit einer Primäraktion (markengetönter Schatten) und einer leisen Textaktion. Mobil gestapelt, Primär oben.
- **Copy:** `reload_hint` „Offene Eingaben vor dem Neuladen kurz speichern."; `slow_prolonged_hint` entfernt; `slow_action` „Weiterarbeiten" (en „Keep working", fr „Continuer"). Strukturelle Parität de/en/fr.
- **Docs-Integrität:** die in V2 verlorenen Abschnitte von `02-design-system.md` sind in aktualisierter Form wiederhergestellt (ohne Warnsymbol/Recovery), zusätzlich dokumentiert die Welle Ring, Tokens und Zustandsbilder additiv.
- **Bewusst nicht in dieser Welle:** die technischen LOWs des Reviews (Assessment `nothing`, Nutzen des stillen zweiten SKIP_WAITING), die Plugin-Notes (sofortiger Reload eines Nicht-Klick-Tabs durch `vite-plugin-pwa`), der projektweite Primäraktions-Kontrast (3,56) und der globale Loader.

### Begründung

Ein technisch korrekter Zustand, der eine wirkungslose Handlung anbietet, ist für die Mitarbeiter eine Falle: sie laden neu, sehen wieder „verfügbar", laden wieder — und lernen, dass Nora „nicht will". Der einzige ehrliche Ausweg bei einem Worker, der wirklich noch wartet, ist, in Ruhe weiterzuarbeiten. Visuell braucht die Fläche keinen größeren Orb und keine zweite Zeile, um ernst genommen zu werden — sie braucht einen Zustand, den man auf einen Blick liest. Ein Bogen, der läuft; ein Ring, der geschlossen ist; ein Orb, der still wird. Das ist die ganze Sprache.

**Status:** `PWA VISUAL POLISH 2 RC VERIFIED — READY FOR PRODUCT OWNER ACCEPTANCE`. Lokaler RC auf `polish/nora-pwa-update-visual-v2`; nicht gepusht, nicht deployed, keine Product-Owner-Abnahme.

---

## 2026-09-01 – PWA Update State Contract V2: Browser-Fakten statt Entdeckungssignal

### Kontext

Die PWA-Wellen 1B–1C.3 sind mit dem Kanban-Release `fe962c58` live gegangen; der Happy Path (kontrollierter Tab, Worker WAITING, ein SKIP_WAITING, ein `controllerchange` 8 011 ms nach dem Klick, ein Reload) ist dort bestätigt. Trotzdem sah der Product Owner in Production den Recovery-Zustand „Aktualisierung dauert länger als erwartet — Nora konnte die neue Version noch nicht vollständig übernehmen. Sie können weiterarbeiten." mit der Aktion „Nora neu laden" — für Mitarbeiter ein Fehler, obwohl keiner vorlag.

Eine Read-only-Diagnose (Zwei-Build-Repro mit echtem generiertem `sw.js`, Chromium; zehn Vitest-Szenarien gegen die echte Komponente) hat die Kombination als Recovery-Variante B identifiziert (`registration.waiting === null` beim Watchdog) und reproduziert:

1. Seit PWA-1B ruft der Worker kein `clients.claim()` mehr. Ein Dokument ohne Controller (Erstbesuch, Hard Reload Ctrl+Shift+R, gelöschte Site-Daten, Inkognito) bleibt in der hash-gerouteten SPA mit Passwort-Login **den ganzen Arbeitstag** unkontrolliert.
2. `register.js` (vite-plugin-pwa 1.2.0, Prompt-Modus) ruft `onNeedRefresh` für **externe** Funde — bei Noras stündlicher Prüfung immer — bereits beim `installed`-Ereignis, 200 ms bevor workbox-window über `waiting` entscheidet.
3. Benutzt kein Client die Registrierung, aktiviert der Browser den Worker sofort (gemessen: 2 ms nach `installed`). `waiting` wird null, `messageSkipWaiting()` sendet nichts, `controllerchange` erreicht ein unkontrolliertes Dokument per Spezifikation nie. Nora deutete das nach 13 s als „nicht übernommen".

Zweiter Befund (MEDIUM): hatte ein anderer Tab aktiviert (`activated = true`), blieb die Fläche auf „verfügbar" und ein Klick spielte acht Sekunden Choreografie ohne Wirkung ab. Der Watchdog selbst (5 s) war nicht zu aggressiv: Übernahme im kontrollierten Tab 14 ms nach dem Commit. Klassifikation TYPE D: technische Lücke im Client-Vertrag plus Präsentation.

### Entscheidung

- **Der Browser ist die Wahrheit; `onNeedRefresh` ist ein Entdeckungssignal.** `pwaUpdateStore.syncFacts()` liest `navigator.serviceWorker.controller`, `registration.waiting/installing/active` an jedem Entscheidungspunkt: Registrierung, `onNeedRefresh`, unmittelbar vor `applyUpdate()`, `controllerchange`, Watchdog, Rückkehr auf den Tab. Ereignisbasiert über `statechange` des beobachteten Workers und `updatefound` — kein Polling, kein BroadcastChannel, kein Cross-Tab-Protokoll.
- **Expliziter Zustand `reloadRequired`** mit dokumentierter Invariante: `activated ∨ (entdeckt ∧ ¬waiting ∧ ¬installing ∧ (¬controlled ∨ active ≠ controller))`. Bewusst **nicht** `waiting === null` allein — ohne entdecktes Update sagt ein fehlender wartender Worker nichts, und während `installing` ersetzt gerade ein neuerer Worker den entdeckten.
- **`applyUpdate()` liest vorher die Fakten** und sendet SKIP_WAITING nur, wenn ein Worker wartet; sonst antwortet es `activated`, `reloadRequired` oder `noop`. `activated` bleibt monoton (PWA-1C.3). Kein zweites SKIP_WAITING nach Erfolg.
- **Der Watchdog (5 s, unverändert) ist kein Fehlerkriterium.** Beim Ablauf ordnet `assessActivation()` ein: `activated` → Reload-Pfad; Worker wartet → `slow` mit genau **einem** stillen zweiten Versuch pro Lauf, nach einer zweiten Frist Reload-Angebot ohne weiteren Automatismus; Reload-Befund → `reloadRequired` (nach einem Commit lädt Nora nach 1,5 s selbst); abgelehnte Anfrage → `failed`. Ein Timeout allein ist nie `failed`.
- **Kein `clients.claim()`.** Das würde den PWA-1A-Chunk-Fehler zurückbringen. Ein unkontrolliertes Dokument braucht nur einen Reload — genau das sagt die Fläche jetzt.
- **Presentation Contract V2:** `available · applying · slow · reloadRequired · failed`; ein Titel, höchstens eine ruhige Zeile, eine Primäraktion; kein Warnsymbol, keine Warnbox, kein Orange; nie „Sie können weiterarbeiten" neben einem Reload-Knopf. Zeigen die Fakten beim Klick bereits `reloadRequired`, startet keine Choreografie. Der production-bewiesene Happy Path bleibt unverändert (8-Sekunden-Choreografie, ein SKIP_WAITING, ein Reload).

### Begründung

Ein Zustand, der einen Fehlschlag behauptet, während die neue Version läuft, kostet Vertrauen — und die einzige richtige Handlung („Nora neu laden") stand neben einem Text, der sie überflüssig erscheinen ließ. Die Reparatur braucht keine neue Architektur: die Fakten, die fehlten, liegen bereits im Browser; Nora musste sie nur lesen, statt einem Callback eine Semantik zu unterstellen, die er nie hatte. Der 5-Sekunden-Wert bleibt, weil er gemessen richtig ist; falsch war die Schlussfolgerung, nicht die Frist.

**Doku-Korrektur zu PWA-1C.2:** Der Client von `vite-plugin-pwa` lädt im kontrollierten Tab sehr wohl selbst neu (`controlling.isUpdate = true`, gemessen); nur ein unkontrolliertes Dokument bleibt stehen. Noras 1,5-s-Reload ist damit Sicherheitsnetz, nicht Regelweg — es entsteht kein Doppel-Reload.

**Status:** `PWA UPDATE STATE CONTRACT V2 — LOCAL VERIFIED / RC`. Nicht Production Verified; kein Deployment. Der globale Nora-Loader ist eine eigene spätere Welle („Nora Loading Motion System", `17-known-issues-and-planned-waves.md`).

---

## 2026-08-30 – Eine bestätigte Übernahme ist endgültig: `activated` ist monoton (PWA-1C.3)

### Kontext

Der unabhängige Last Delta Review des Closure-RC (`2861a602`) hat den Kandidaten abgelehnt: 1 MEDIUM. Der Retry aus dem Eintrag darunter sendet nachweislich wieder — aber er konnte eine bereits bestätigte Übernahme wieder wegwerfen.

### Problem

`applyUpdate()` setzte als erste Amtshandlung `activated = false`, mit der Begründung, ein früheres `controllerchange` dürfe den Erfolg *dieses* Versuchs nicht vorwegnehmen.

Die Begründung verwechselte zwei Dinge. `applying` beschreibt einen **Versuch** und darf enden. `activated` beschreibt das **Dokument**: es hat eine echte Worker-Übernahme beobachtet. Diese Beobachtung wird durch einen neuen Versuch nicht falsch.

Gemessen am abgelehnten RC: trifft die Übernahme während einer laufenden Retry-Choreografie ein (vor deren Commit), dann steht `activated` korrekt auf `true` — und der Commit acht Sekunden später löscht sie wieder, schickt ein zweites SKIP_WAITING an einen Worker, der längst übernommen hat, und lässt Nora anschließend in den Watchdog und damit in einen falschen Recovery-Zustand laufen. Der Nora-eigene Reload feuerte nie, obwohl das Update erfolgreich war.

### Entscheidung

**`activated` ist innerhalb einer Dokument-Lebensdauer monoton.** Einmal `true`, bleibt es `true` — kein Retry, kein Commit, kein Watchdog, kein Präsentationszustand nimmt es zurück. Der Reload beendet das Dokument ohnehin und erzeugt einen frischen Store; `reset()` ist die Testentsprechung dazu und bleibt die einzige Stelle, die zurücksetzen darf.

**`applyUpdate()` ist ein No-op bei bestätigter Übernahme.** Der Guard prüft jetzt auch `activated`: es gibt dann nichts mehr anzufordern. Die Choreografie läuft normal bis zu ihrem Commit; `commitRequested && activated` greift, und der bestehende Nora-eigene Reload-Pfad schließt den Vorgang ab. Genau ein Reload, keine zweite Anfrage, kein falsches Recovery.

Die drei anderen Guard-Bedingungen bleiben unverändert: Doppelklick und Mehrfachanfragen während eines laufenden Versuchs sind weiterhin gesperrt.

### Was das zusätzlich verbessert

Der Fall, für den das alte `activated = false` ursprünglich geschrieben war — ein anderer Tab aktiviert den Worker, bevor der Benutzer hier entscheidet —, wird dadurch nicht schlechter, sondern besser. Vorher: Klick → acht Sekunden Choreografie → Anfrage ins Leere → fünf Sekunden Watchdog → Recovery → der Benutzer muss „Nora neu laden" klicken. Jetzt: Klick → Choreografie → Commit ohne Anfrage → Reload. Gemessen: 0 Aktivierungsanfragen, genau ein Reload, keine Sackgasse.

### Bewusst nicht geändert

Die Choreografie (`useUpdateChoreography.ts`) bleibt unangetastet: sie commitet weiterhin unbedingt und trifft keine Entscheidung über Worker-Zustände. Die Unterscheidung gehört in den Store, der die technische Wahrheit hält.

---

## 2026-08-30 – Ein Retry muss etwas senden: der beendete Aktivierungsversuch (PWA-1C.2 Closure)

### Kontext

Der Delta Final Review des Fix-RC (`6718d772`) hat den Kandidaten abgelehnt: 1 BLOCKER, 1 MEDIUM, 1 LOW. Der Watchdog aus dem Eintrag darunter war korrekt — der Ausweg aus dem Zustand, den er erzeugt, war es nicht.

### Problem

`applyUpdate()` sperrt bewusst auf `applying` (Doppelklick, Mehrfachanfragen, StrictMode). Auf dem Watchdog-Pfad fiel `applying` aber nie wieder auf `false`: das Promise von `updateServiceWorker()` lehnt in Production praktisch nie ab, und `reset()` wird dort nie aufgerufen. „Erneut versuchen" lief damit in genau diesen Guard — acht Sekunden Choreografie, danach **keine** Anfrage, nach fünf Sekunden wieder Recovery. Eine Endlosschleife ohne technische Wirkung, und ausgerechnet in dem Zweig, den der reale Fehlerfall zeigt: wenn die Übernahme ausbleibt, wartet der Worker per Definition noch, also greift `hasWaitingWorker()` und Nora bietet den wirkungslosen Knopf an.

Dieselbe Fehlerklasse, die den ersten RC gekippt hat: die Oberfläche behauptet etwas, das die technische Schicht nicht einlöst.

Aufgefallen ist es niemandem, weil beide Fakes — Test und DEV-Werkzeug — `registration === undefined` durchreichten. Variante A war dadurch weder testbar noch am Bildschirm herstellbar; ein Test trug sogar den Titel „startet mit ‚Erneut versuchen' eine vollständige neue Sequenz" und prüfte etwas anderes.

### Entscheidung

**Ein eng geschnittener Übergang statt eines Resets.** `endStalledActivation()` beendet beim Ablauf des Watchdogs genau den einen steckengebliebenen Versuch und meldet zurück, ob ein zweiter überhaupt etwas bewirken kann. `needRefresh`, Registration, wartender Worker, Listener und Update-Callbacks bleiben unangetastet — ein Retry darf keinen technischen Zustand verlieren. `reset()` bleibt, was es war: Test- und Lifecycle-Hygiene, nie ein Retry-Mechanismus.

**Zwei Fälle, bewusst nicht vermischt.** Wartet noch ein Worker, endet der Versuch, `applying` fällt kontrolliert auf `false`, und die Aktion ist „Erneut versuchen". Wartet keiner mehr, wäre ein zweites SKIP_WAITING nachweislich wirkungslos — dann bleibt der Versuch stehen und die Aktion ist „Nora neu laden". Ist die Übernahme doch noch eingetreten, gibt es nichts zu wiederholen: `activated` gewinnt, und der Recovery-Zustand verschwindet von selbst.

**Idempotent, weil StrictMode Effekte doppelt aufruft.** Der Rückgabewert hängt am Weltzustand, nicht daran, ob der Aufruf etwas verändert hat. Sonst kippte die Aktion beim zweiten Effektlauf still auf „Nora neu laden", obwohl ein Worker wartet.

**Die Wahrheit wird beim Klick noch einmal gelesen.** Zwischen Watchdog und Klick können Sekunden liegen. Ist der wartende Worker inzwischen weg, lädt Nora, statt eine Anfrage ins Leere zu schicken.

**Kein Versuchslimit.** Die Grenze ist der wartende Worker, nicht ein Zähler. Solange wirklich einer da ist, bleibt der Ausweg offen.

**Der Doppelklickschutz bleibt.** Während eines laufenden Versuchs wird weiterhin genau eine Anfrage gesendet — der Guard wurde nicht entfernt, sondern der Zustand davor korrekt zurückgeführt.

### Fokus-Besitz statt Momentaufnahme

Das MEDIUM: der Besitz wurde einmal beim Klick gemessen und nie wieder geprüft. Wer danach in ein Kundenfeld klickte, bekam den Fokus dreizehn Sekunden später herausgerissen, sobald der Watchdog zuschlug. Jetzt führt ein `focusin`-Beobachter den Besitz mit, solange das Ereignis montiert ist. Der Rückfall auf `<body>` beim Wegfalten der Aktionen zählt ausdrücklich nicht als Aufgabe — er ist keine Entscheidung des Benutzers, und genau deshalb reicht eine `contains(document.activeElement)`-Prüfung im Moment des Verschiebens nicht. Kein globaler FocusManager, Listener nur zur Laufzeit des Ereignisses.

### Nachweis

Die Beobachtungsgröße ist die Zahl der gesendeten Aktivierungsanfragen, nicht die Animation. Nach dem Retry steigt sie von 1 auf 2 — in der Testsuite (`applyCalls`) wie in der echten App (Statuszeile „Anfragen" des DEV-Werkzeugs).

Gegen das echte generierte `sw.js` gemessen: ein Worker, der die erste SKIP_WAITING-Anfrage nicht beantwortet hat, übernimmt bei der zweiten (`controllerchange`, 61 ms). Der zweite Versuch ist also nicht nur gesendet, sondern auch wirksam.

### Bewusst nicht geändert

`data-state` trägt im Recovery-Zustand weiterhin `"available"`. In Fall A stimmt das jetzt mit dem Store überein (`applying` ist beendet); in Fall B bleibt der Widerspruch bestehen. Konsistenz erforderte, das Attribut an den Store zu koppeln — ein State-Refactor ohne Konsumenten. Bleibt als NOTE.

---

## 2026-08-30 – Aktivierungsanfrage ist kein Erfolgssignal: Watchdog statt Promise (PWA-1C.2)

### Kontext

Der unabhängige Final Review des ersten PWA-RC (`0329c0ae`) hat den Kandidaten abgelehnt. Keine BLOCKER, keine HIGH — aber ein MEDIUM, und zwar an der Stelle, an der die Welle sich am sichersten fühlte: der Recovery-Zustand.

### Der Befund

`pwaUpdateStore.applyUpdate()` setzte `applying` synchron auf `true` und nahm es nur in einem Fall zurück: wenn das Promise von `updateServiceWorker()` ablehnt. Daraus leitete die Präsentation nach 1,5 s Schonfrist den Recovery-Zustand ab. Die Begründung im Code war intern schlüssig — und trotzdem falsch, weil sie eine Annahme über eine fremde Bibliothek enthielt, die niemand nachgelesen hatte.

Der ausgelieferte Production-Client von `vite-plugin-pwa` 1.2.0 (`dist/client/build/register.js`) ist:

```js
const updateServiceWorker = async (_reloadPage = true) => {
  await registerPromise;            // register() fängt jeden Fehler ab, wirft nie
  if (!auto) sendSkipWaitingMessage?.();   // void postMessage, kein await
};
```

und `Workbox.messageSkipWaiting()` verwirft das Promise von `messageSW()` und tut ohne wartenden Worker **gar nichts**. Das Promise lehnt also praktisch nie ab. Folge:

- Der `catch`-Zweig im Store war toter Code.
- Der Recovery-Zustand war auf dem Production-Pfad **unerreichbar** — erreichbar nur über den Fake des Dev-Werkzeugs und den Fake im Test.
- Der Fall, den Production wirklich erzeugen kann — Anfrage raus, `controllerchange` kommt nie — hätte Nora **dauerhaft** auf „Nora wird aktualisiert" stehen lassen, ohne Aktion und ohne Timeout.

Die Dokumentation behauptete an zwei Stellen ausdrücklich das Gegenteil („bleibt **nicht** ewig auf ‚wird aktualisiert' stehen", „Bleibt die Aktivierung aus, zeigt Nora nach 1,5 s …").

### Entscheidung

**Zwei getrennte Wahrheiten im Store.** `applying` heißt „Aktivierung wurde angefordert". Neu daneben `activated` — „der Browser hat die Übernahme vollzogen", gespeist aus `controllerchange` auf `navigator.serviceWorker`. Das ist das einzige belastbare Erfolgssignal; derselbe Listener, an dem auch der Client von `virtual:pwa-register` seinen Reload aufhängt. Nirgendwo im Code gilt fortan „Promise resolved = aktiviert".

**Watchdog statt Promise-Semantik.** Die Frist läuft ab `applyUpdate()` — die acht Sekunden Choreografie zählen ausdrücklich nicht mit. Trifft `controllerchange` ein, wird der Timer abgeräumt; bleibt er aus, erscheint Recovery. Trifft die Übernahme verspätet doch ein, verschwindet Recovery wieder: die Oberfläche behauptet nie etwas, das gerade nicht mehr stimmt, und ein zweites `applyUpdate()` findet dabei nicht statt.

**Fünf Sekunden, gemessen statt geschätzt.** Gegen das echte generierte `sw.js` in Chromium 148, `postMessage(SKIP_WAITING)` → `controllerchange`: ohne Drosselung 2–3 ms (n=6), bei 4× CPU-Drosselung 2–34 ms (n=5), bei 20× CPU-Drosselung 9–26 ms (n=4). Schlechtester beobachteter Wert 34 ms. Fünf Sekunden sind rund das 150-Fache und decken zusätzlich die Zeitgeber-Drosselung eines Hintergrund-Tabs ab. Ein falsch-positiver Recovery-Zustand ist damit praktisch ausgeschlossen, ohne nach den ohnehin vergangenen acht Sekunden noch minutenlang zu warten.

**Zweiter Befund während der Reparatur: der Reload gehört Nora.** Beim Messen des Watchdogs im Zwei-Build-Harness zeigte sich, dass nach `SKIP_WAITING` zwar `controllerchange` genau einmal feuert, der neue Worker übernimmt und der alte Precache aufgeräumt wird — die Seite aber **nicht** neu lädt. Ursache: der Client aus `virtual:pwa-register` hängt seinen Reload an das `controlling`-Ereignis, aber nur wenn es `isUpdate` trägt; Workbox lässt das weg, sobald es den Fund als extern einstuft (u. a. bei mehr als einer Minute Abstand zur Registrierung — bei Noras stündlicher bzw. tabbasierter Prüfung der Normalfall). Identisch am Code vor dieser Korrektur gemessen: kein Regressionseffekt, sondern ein Zustand, den niemand geprüft hatte.

Ohne Gegenmaßnahme hätte der Fix das Problem sogar verschoben statt gelöst: der Watchdog greift ja gerade nicht mehr, weil die Übernahme stattgefunden hat — die Szene wäre trotzdem stehen geblieben. Deshalb: **„übernommen" ist nicht „fertig"**. Trifft `controllerchange` ein und lebt die Seite 1,5 s später noch, lädt Nora selbst neu. Lädt der Client doch selbst (synchron im `controlling`-Handler), kommt der Timer nie zum Zug — kein doppelter Reload. Der Reload ist als Parameter in die Choreografie hineingereicht, weil `window.location.reload` in einem echten Browser nicht ersetzbar ist und der Fall sonst untestbar wäre.

**Copy ohne Fehlerbehauptung.** „Aktualisierung dauert länger als erwartet" statt „konnte nicht gestartet werden". Belegt ist das Ausbleiben, nicht das Scheitern. Ein Zustandsbericht darf nicht mehr behaupten, als er weiß — dieselbe Regel wie im Error Contract und in der Notification Presentation.

**Aktion nach echtem Worker-Zustand.** Wartet noch ein Worker, ist „Erneut versuchen" sinnvoll; ist keiner mehr da, liefe ein zweiter Versuch nachweislich ins Leere und „Nora neu laden" ist die ehrlichere Aktion. Entschieden wird beim Eintritt in den Zustand über `registration.waiting`, nicht geraten.

**Kein „Später" in Recovery — und das ist kein Versehen.** Der Review hat zu Recht bemängelt, dass der Recovery-Zustand keinen Ausweg hatte. Der naheliegende Ausweg wäre falsch: SKIP_WAITING ist gesendet, den Worker verlässlich wieder auf WAITING zu setzen ist keine Fähigkeit, die Nora hat. Ein „Später" wäre hier eine Lüge über den eigenen Zustand. Der Ausweg ist stattdessen die Aktion selbst, und sie bekommt beim Eintritt in den Zustand den Fokus.

### Was bewusst NICHT geändert wurde

Orb, Aura, Warnsymbol, Panelkomposition, Timeline, die acht Sekunden im normalen Motion-Modus, Hell/Dunkel-Art-Direction, die Service-Worker-Strategie (`registerType: "prompt"`), das Deferral-Verhalten von „Später" im Verfügbar-Zustand. Der Product Owner hat die visuelle Fassung abgenommen; diese Welle ist eine technische Korrektur, keine zweite Designrunde.

Ebenfalls nicht geändert: die Reduced-Motion-Dauer (weiterhin offene Product-Frage) und die globale `.nora-primary-action`-Farbe (Kontrast 3,56, projektweit — siehe `02-design-system.md` und `17-known-issues-and-planned-waves.md`).

### Begleitende Accessibility-Korrekturen

- **Live-Region getrennt.** Das Panel trug `role="status"` und damit `aria-atomic="true"`; jede Mutation im Teilbaum hätte die komplette Fläche erneut vorlesen lassen — während der Sequenz mehrfach. Die Fläche ist jetzt `role="group"` ohne Live-Semantik, daneben steht ein winziger `sr-only`-Announcer mit genau einer Ansage pro Zustandswechsel. Konzeptionell wie 7B, aber ohne dessen Store.
- **Fokus nach der Primäraktion.** Die Aktionszeile faltet sich weg; ohne Zutun fiel der Fokus auf `<body>`. Er wandert jetzt auf die Fläche selbst und im Recovery-Zustand auf deren Aktion — aber nur, wenn er beim Auslösen ohnehin schon im Panel lag, damit daraus kein Fokusdiebstahl werden kann. *(Überholt: diese einmalige Messung war selbst ein Fokusdiebstahl, wenn der Benutzer danach weiterarbeitete — siehe „Ein Retry muss etwas senden", Abschnitt „Fokus-Besitz statt Momentaufnahme".)*

### Verifikation

Neuer Regressionstest für genau den Fall, der vorher ungetestet war: Anfrage gesendet, Promise resolved, kein `controllerchange` → nach der Frist Recovery. Dazu: rechtzeitige Übernahme → kein Recovery; verspätete Übernahme → Recovery wird zurückgenommen, kein zweiter Apply; abgelehnte Anfrage → ebenfalls Recovery; Fokusverlauf; Announcer-Sequenz. Der Store-Test deckt `activated`, das Ignorieren eines `controllerchange` vor `applyUpdate()`, `hasWaitingWorker()` und den Listener-Abbau ab.

Das Dev-Werkzeug simuliert die Übernahme über ein echtes `controllerchange` auf `navigator.serviceWorker` — dieselbe Schnittstelle wie in Production, ohne dafür Production-Logik aufzuweichen.

---

## 2026-08-30 – Premium Update Experience und 8-Sekunden-Choreografie (PWA-1C.1)

### Kontext

PWA-1C war **funktional** abgenommen: Lifecycle, Layer, Dialog-Deferral, Accessibility und Reduced Motion waren geprüft. Die **visuelle** Fassung wurde vom Product Owner abgelehnt — als generisch, zu sehr nach KI-generierter Standard-UI, nicht eigenständig genug für ein besonderes Nora-Systemereignis. Diese Welle ist deshalb ausschließlich Art Direction, Motion Design und Präsentation: kein Eingriff in `vite.config.ts`, den Service-Worker-Lifecycle, `pwaRegistration`, den Operation-/Notification-Store oder die Datenbank.

### Warum der erste Entwurf verworfen wurde

Die konkrete Ursache war nicht Dekoration, sondern **Komposition**. Der Entwurf war eine 30-rem-Zeile: kleines Motiv links, Text rechts, zwei Buttons darunter, `rounded-xl + border + shadow`. Das ist die Standardanatomie jeder Framework-Karte. Sie war korrekt und austauschbar — man hätte sie in jeder beliebigen SaaS-Anwendung wiedererkannt. Ein Systemereignis, das sich vom normalen Statusfeedback unterscheiden soll, kann nicht dieselbe Grundform benutzen wie das Statusfeedback.

Konkrete Befunde aus der Nacharbeit, jeweils in der gestylten App gemessen:

- Der 3,25-rem-Orb war zu klein, um Mittelpunkt zu sein — er las sich als Icon neben Text.
- Zwei synchron gegenläufig rotierende Schichten lesen sich als *animiertes Icon*, nicht als Organismus. Synchronität ist das Problem, nicht die Geschwindigkeit.
- Der Glow saß wenige Pixel um die Form; er war Kontur, nicht Aura.
- 1,25 rem Padding und 30 rem Breite gaben der Komposition keinen Raum, in dem sie hätte wirken können.

### Entscheidung

**Orb-zentrierte Premium-Komposition.** Eine zentrierte Spalte mit dem Orb als exaktem visuellen Mittelpunkt (Orb → Titel → Text → Sicherheitshinweis → Aktionen), 34 rem breit, 2,5 rem Padding, 8,5-rem-Orb. Dieselbe gestalterische DNA auf allen Breakpoints; Mobile ist komprimiert, nicht proportional verkleinert. Vollständige Gestaltungsdokumentation: `02-design-system.md`, Abschnitt „Anwendungs-Systemereignisse / Update-Experience".

**Warum zentrierte Spalte statt Zeile:** eine Zeile hat kein Zentrum — sie hat einen Anfang und ein Ende und liest sich immer als Listeneintrag. Nur eine zentrierte Achse macht ein Element zum Mittelpunkt eines Ereignisses. Das ist die eine Strukturentscheidung, aus der alles Weitere folgt.

**Warum nicht breiter als 34 rem:** die Zeilenlänge des Sicherheitshinweises liegt damit bei rund 65 Zeichen. Mehr Breite hätte die Komposition „großzügiger" gemacht und die Lesbarkeit verschlechtert — das ist kein guter Tausch. „Mehr Raum" wurde stattdessen über Padding (verdoppelt) und Orb-Größe (mehr als verdoppelt) eingelöst.

**Desynchronisation statt mehr Bewegung.** Der Orb hat sieben Ebenen mit Perioden von 9,5 s bis 89 s, von denen keine ein Vielfaches einer anderen ist. Tiefe entsteht dadurch, dass die Ebenen nie wieder zusammenlaufen — nicht dadurch, dass sich mehr oder schneller bewegt. Der Kern fährt bewusst keine Kreisbahn und ist in **keinem** Keyframe zentriert.

**Das Warnsymbol des Product Owners ist verbindlich.** Die Geometrie wurde unverändert übernommen (Original als Design-Asset unter `docs/nora/assets/pwa-update-warning-source.svg` erhalten); entfernt wurde nur Export-Ballast (`fill="#000000"` am Root, Adobe-Entities/Metadata, feste Pixelgröße, leere `<g>`-Hüllen). `viewBox` und alle `d`-Strings sind unverändert. Nicht durch ein Lucide-Icon ersetzt, nicht nachgezeichnet, nicht gerastert.

**Achtsekundenchoreografie als Präsentation, mit lokalem State.** Vier Phasen (`settling` / `converging` / `sustaining` / `committing`), danach genau ein `applyUpdate()`. Der Zustand lebt in `useUpdateChoreography.ts`, **nicht** im `pwaUpdateStore`.

### Warum die acht Sekunden bewusst keinen Fortschritt vortäuschen

Der wartende Service Worker ist zum Zeitpunkt des Klicks **bereits vollständig installiert**. Es gibt technisch nichts zu laden, nichts zu messen und nichts, dessen Fortschritt man anzeigen könnte. Eine Prozentanzeige, eine Fortschrittsleiste oder ein „Installation abgeschlossen" wären damit erfundene Werte — eine Behauptung der Oberfläche über einen Zustand, den sie nicht kennt.

Das ist für Nora kein Stilfrage, sondern dieselbe Regel, die überall sonst gilt (Error Contract, Operation Status, Notification Presentation): die Oberfläche sagt nur, was sie belegen kann. Ein Systemereignis, das über die Anwendung selbst berichtet, wäre der schlechteste Ort, um damit anzufangen. Die Sequenz zeigt deshalb ausschließlich, **dass** etwas vorbereitet wird — getragen von drei ruhigen Punkten, nicht von Zahlen.

Warum es dann überhaupt acht Sekunden gibt: ein sofortiger Reload nach dem Klick fühlt sich an wie ein Absturz. Der Übergang von einer Version zur nächsten ist der eine Moment, in dem eine Arbeitsanwendung zeigen kann, dass sie gepflegt wird. Das ist der einzige Zweck — und deshalb wird er auch so benannt.

### Warum der Choreografie-State nicht in den Store gehört

`pwaUpdateStore` bildet den echten Service-Worker-Lifecycle ab: `idle` / `updateAvailable` / `applying`. Diese drei Zustände sind technische Wahrheit — sie beschreiben, was der Browser tut. Ein vierter Zustand `choreography` daneben wäre eine Präsentationsentscheidung, die als Worker-Zustand auftritt; jeder spätere Leser des Stores müsste dann unterscheiden, welche Zustände real sind und welche erfunden. Der Store bleibt deshalb unverändert bis auf **nichts** — diese Welle fasst ihn nicht an.

Absicherung gegen ein doppeltes `applyUpdate()` auf drei Ebenen: Wiedereintrittssperre in `start()`, Verschwinden der Aktionen aus dem Tab-Index, und ein Lauf-Token am Commit selbst (das auch React StrictMode trägt, weil Refs den doppelten Effekt-Mount derselben Fiber überleben). Unmount während der Sequenz räumt alle Timer ab; der wartende Worker bleibt unangetastet.

### Recovery statt Endlosszene

Bleibt die Aktivierung aus, zeigt Nora nach 1,5 s Schonfrist einen ruhigen Zustand mit „Erneut versuchen". Das ist zulässig, weil der Contract es belastbar liefert: `applyUpdate()` setzt `applying` synchron auf `true` und lässt es dort — es gibt genau zwei Wege zurück (sofortige Ablehnung durch den Store, oder abgelehnte Aktivierung mit `catch`), und beide sind echte Fehlschläge. Ein falsch-positiver Recovery-Zustand ist damit ausgeschlossen. „Erneut versuchen" startet eine vollständige neue Sequenz — bewusst kein zweiter, abgekürzter Pfad, der eigene Zustände und eigene Fehlerfälle mitbrächte.

### Offene Product-Frage: Reduced Motion und die acht Sekunden

Bei `prefers-reduced-motion: reduce` steht die Bewegung still, die **Dauer** bleibt aber bei acht Sekunden. Das ist bewusst nicht eigenmächtig geändert worden.

Argument dafür, sie zu kürzen: ohne Morphing, Wachsen und Aura-Ausbreitung trägt die Zeit weniger — es bleiben ein statischer Orb, ein Titel und drei sanft pulsierende Punkte. Acht Sekunden Warten auf ein Ereignis, dessen Inszenierung man abbestellt hat, könnte als Zumutung statt als Sorgfalt ankommen.

Argument dagegen: Reduced Motion ist eine Aussage über Bewegung, nicht über Zeit. Ein anderer Ablauf für diese Nutzergruppe ist eine Produktentscheidung mit eigener Begründungslast, und die Punkte zeigen weiterhin, dass etwas läuft.

**Empfehlung an den Product Owner:** die Dauer bei Reduced Motion auf etwa 2,5 s zu kürzen und direkt in die ruhige Szene zu springen. Nicht umgesetzt — das ist seine Entscheidung, nicht die des Entwicklers.

### Nebenbefund (nicht in dieser Welle behoben)

`.nora-primary-action` nutzt `@apply`, und Tailwind v4 verschiebt jede Regel, die das tut, in die `utilities`-Layer. Ihr `min-h-10` nagelt jede Primäraktion auf 40 px fest und **überschreibt** sowohl eine `min-h-11`-Klasse am selben Element als auch jede Regel in der `components`-Layer (Layer-Reihenfolge schlägt Spezifität). Damit unterschreitet sie Noras eigenes 44-px-Touch-Minimum. Im Systemereignis über eine bewusst ungelayerte, eng gescopte Regel gelöst; die geteilte Klasse wurde **nicht** angefasst, weil sie zu anderen Wellen gehört. Es ist wahrscheinlich, dass weitere Nora-Primäraktionen davon betroffen sind — eigene Prüfung wert, siehe `17-known-issues-and-planned-waves.md`.

### Bekannter Rest

Designqualität ist kein automatisch prüfbares Kriterium. Tests decken Zustände, Timing, Semantik und Accessibility-Verdrahtung ab und behaupten ausdrücklich **nicht**, dass das Ergebnis hochwertig aussieht. Geometrie, Kontrast (Canvas-aufgelöste sRGB-Werte), Touch-Ziele, Viewport-Matrix, Reduced Motion, Dialog-Deferral und die vollständige Bildfolge der Achtsekundensequenz wurden in der gestylten App gemessen. Ob es sich **hochwertig anfühlt**, entscheidet der Product Owner — Status daher `LOCAL VERIFIED — AWAITING PRODUCT OWNER UX ACCEPTANCE`.

---

## 2026-08-30 – Update-Experience als Anwendungs-Systemereignis (PWA-1C)

### Kontext

PWA-1B lieferte den Lifecycle (wartender Worker, benutzergesteuerte Aktivierung) plus einen bewusst ungestalteten Platzhalter-Hinweis. Offen war, wie das Ereignis im Produkt auftreten soll: sichtbar genug, dass ein Mitarbeiter es bemerkt, ohne ihn zu drängen oder mitten in einer Eingabe zu unterbrechen.

### Entscheidung

Ein PWA-Update ist ein **Anwendungs-Systemereignis** — eine eigene Kategorie neben den Statusmeldungen aus Phase 7B, mit eigenem Layer (`z-70`), eigener Position und eigenem visuellen Motiv, aber geteilten Design-Primitiven. Semantisch bleibt es getrennt: kein `operationId`, kein Idempotency-Key, kein OperationManager, kein Notification-Store.

Konkret:

- **Prominentes, nicht-modales Panel** (Variante B), oben zentriert (Desktop) bzw. oben über die volle Breite (Mobile) — gegenläufig zu den Statusmeldungen unten, damit sich beide Schichten nie stapeln.
- **Bei offenem Dialog/Sheet wird nichts angezeigt.** Gesteuert über dieselbe `body:has(…[data-state="open"])`-Regel wie 7B.
- **Eigenes Update-Motiv** statt Spinner: ruhige organische CSS-Form.
- **„Später" von 60 auf 120 Minuten.** Kleine, explizite Änderung am PWA-Store.
- Copy ohne technische Begriffe, Sicherheitshinweis auf neutraler statt Danger-Fläche.

### Begründung

**Warum nicht modal (Variante A):** ein echtes Modal blockiert die Arbeit, obwohl das Ereignis ausdrücklich aufschiebbar ist — „prominent" und „dauerhaft blockierend" sind nicht dasselbe. Zusätzlich hätte ein zweiter modaler Layer über einem offenen Radix-Dialog Fokus-Kapselung, `aria-hidden` und Escape-Semantik gefährdet — genau die Klasse von Problemen, die 7B.4b/c teuer gelernt hat.

**Warum bei offenem Dialog gar nicht anzeigen:** mitten in Schnellerfassung oder Vorgangsakte ist der schlechteste denkbare Moment, zu einem Reload einzuladen — es ist der Zustand, in dem ungespeicherte Eingaben real existieren. Verschieben statt verdrängen ist die respektvollere und zugleich technisch einfachere Lösung: sie löst die Layer-Kollision vollständig, ohne eine zweite Zustandsmaschine. Der wartende Worker geht dabei nicht verloren.

**Warum 120 statt 60 Minuten:** das Panel ist seit PWA-1C ein prominentes Systemereignis, kein kleiner Toast. Bei 60 Minuten erschiene es an einem Arbeitstag bis zu achtmal — bei dieser Größe wäre das Drängeln. 120 Minuten ergeben drei bis vier Gelegenheiten pro Tag; zusammen mit „erscheint beim nächsten App-Start ohnehin wieder" verschwindet das Update nicht praktisch für immer. Deterministische Einzelregel, bewusst keine Eskalationsstufen und bewusst kein „nie wieder".

**Warum kein Multi-Tab-Hinweis:** dass beim Aktualisieren auch andere Nora-Tabs neu laden, ist ein technischer Randfall. Er gehört in die Engineering-Doku (PWA-1B), nicht in die Oberfläche — eine Warnung darüber würde ein seltenes Detail zu einem Produktthema aufblasen.

### Bekannter Rest

Designqualität ist kein automatisch prüfbares Kriterium. Tests decken Zustände, Semantik, Accessibility-Verdrahtung und Aktionen ab; Geometrie, Layer, Kontrast und Motiv wurden in der gestylten App nachgemessen. Ob es sich **hochwertig anfühlt**, entscheidet der Product Owner — Status daher `LOCAL VERIFIED — AWAITING PRODUCT OWNER UX ACCEPTANCE`.

---

## 2026-08-30 – PWA-Update: wartender Worker statt automatischer Übernahme (PWA-1B)

### Kontext

PWA-1A hat nachgewiesen (Reproduktion in zwei aufeinanderfolgenden Builds plus Messungen gegen Production), dass `registerType: "autoUpdate"` in Nora einen inkonsistenten Zwischenzustand erzeugt: der Plugin erzwingt für diese Kombination `skipWaiting` + `clientsClaim`, der neue Worker aktiviert sich sofort, übernimmt offene Tabs und räumt beim Aktivieren den Precache des alten Builds weg — während die Seite weiter altes JavaScript ausführt. Ein danach erst angeforderter Lazy Chunk des alten Builds (in Nora: `DealList`) existiert dann weder im Cache noch auf dem Server. Ein Reload nach dem Update kam nie, weil Nora das Client-Modul `virtual:pwa-register` gar nicht lud; das „auto" in `autoUpdate` betrifft nur die Worker-Aktivierung, nicht die laufende Seite.

### Entscheidung

**Der neue Service Worker bleibt WAITING, bis der Benutzer bewusst aktualisiert.**

- `vite.config.ts`: `registerType: "prompt"` statt `"autoUpdate"`.
- Nora lädt `virtual:pwa-register` explizit (`pwaRegistration.ts`) und besitzt damit das Update-Ereignis selbst.
- Registriert wird beim App-Start in `src/main.tsx`, **nicht** in einer Komponente: Nora rendert seine Layouts erst nach dem Login, eine Registrierung im Komponentenbaum würde die Login-Seite und abgemeldete Nutzer auslassen.
- Der Lifecycle liegt in `pwaUpdateStore.ts` (framework- und UI-frei, prozessweit ein Store), die Präsentationsschnittstelle in `usePwaUpdate()`: `{ state, updateAvailable, applying, applyUpdate, dismissForNow }`.
- „Später" verwirft nichts: der Worker bleibt WAITING, der Hinweis erscheint nach einer Stunde bzw. beim nächsten App-Start erneut. Bewusst kein LocalStorage — die Registration ist die technische Wahrheit.

### Begründung

Solange der alte Worker aktiv bleibt, bleibt auch sein Precache vollständig. Die laufende Version ist damit in sich konsistent, und der ursprüngliche Fehler kann strukturell nicht mehr auftreten — nicht nur „seltener". Gleichzeitig darf ein Reload nicht ungefragt mitten in einem Formular passieren: Nora hat Dirty Forms, Dialoge und laufende Operationen, und es existiert **kein** zentraler, zuverlässiger Mechanismus, der „ein Reload ist jetzt sicher" beantworten könnte (geprüft: `isDirty` liegt nur lokal pro Formular in react-hook-form, `beforeunload` nur im undoable-Pfad der react-admin-Notification). Deshalb wurde bewusst **keine** neue globale Safe-State-Infrastruktur gebaut; die Reload-Entscheidung gehört dem Benutzer.

### Abgrenzung

- Ein PWA-Update ist **keine** Business-Operation: kein `operationId`, kein Idempotency-Key, kein Eintrag im OperationManager, keine Wiederverwendung des Notification-Stores aus Phase 7B. Technische Wahrheit bleibt technisch (siehe `03-data-model-guardrails.md`, Falle 37).
- PWA-1B liefert bewusst nur einen minimalen, erreichbaren Auslöser. Ohne ihn würde `prompt` bedeuten, dass niemand je aktualisiert. Die eigentliche Update-UX ist PWA-1C.

### Bekannter Rest

Aktualisiert ein Benutzer in einem Tab, laden **alle** anderen offenen Nora-Tabs ebenfalls neu (gemessen). Das ist Verhalten des `virtual:pwa-register`-Clients: jeder Tab, der das Update-Signal bekommen hat, lauscht auf `controlling` und lädt neu. Es verschiebt das ursprüngliche Problem nicht — die anderen Tabs landen sauber auf dem neuen Build, nicht in einem halb-alten Zustand — aber ein zweiter Tab mit ungespeicherter Eingabe verliert sie. Bewusst nicht mit einer eigenen Cross-Tab-Architektur behandelt; Entscheidung liegt bei PWA-1C.

---

## 2026-08-30 – Vorgänge-Kanban Navigation Rail

### Kontext

Die reale Demo-Ansicht unter `/vorgaenge` hat 12 sichtbare Statusspalten und ist bei 1280 px rund 4.060 px breit. Die erste lokale Horizontalnavigations-Wave war funktional, wurde visuell aber ausdrücklich nicht akzeptiert: Edge-Fades, zwei Pfeiltasten in der Toolbar und eine behauptete kontrastreichere Browser-Scrollbar wirkten wie ergänzte Overflow-Hilfen, nicht wie ein bewusst gestaltetes Arbeitswerkzeug.

Die Browser-Messung erklärte insbesondere den Scrollbar-Widerspruch: Die Regeln griffen auf dem richtigen `.nora-kanban-scroll`-Element (Chromium meldete 16 px Höhe und die Nora-Farben), dessen physisches Ende lag bei 1280×720 jedoch bei `y=841` und damit 121 px unter dem sichtbaren Viewport. Die Leiste war technisch gestylt, im eigentlichen Arbeitsschritt aber nicht sichtbar. Das frühere Verdict `LOCAL VERIFIED + UX ACCEPTED` war daher falsch und ist widerrufen.

### Entscheidung

- **Eine native Wahrheit:** Alle Wege — Trackpad, horizontales Wheel/Shift+Wheel, Touch, Board-Pan, Pfeile, Tastatur, Track-Klick und Thumb-Drag — verändern ausschließlich dasselbe native `scrollLeft`. Es gibt keine zweite künstliche Position.
- **Proportionaler Viewport-Thumb:** Die Thumb-Breite folgt `clientWidth / scrollWidth`, mit einem 44-px-Mindestgriff auf schmalen Touch-Geräten; die Position folgt über den verbleibenden Track-Weg weiterhin exakt `scrollLeft / (scrollWidth - clientWidth)`. Scroll, Resize und Inhaltsmutation werden per `requestAnimationFrame`, `ResizeObserver` und `MutationObserver` synchronisiert. Die Marker entstehen aus den realen Spaltenmitten.
- **Direkter Drag:** Pointer-Delta wird über den verfügbaren Thumb-Weg proportional in nativen Scrollweg übersetzt. Während des Ziehens gibt es bewusst kein Smooth-Scrolling. Pointer Capture und zusätzliche Window-Fallbacks räumen Up, Cancel, Lost Capture, Mouse-Up außerhalb, Fensterverlust und Unmount auf.
- **Track-Entscheidung A:** Ein Klick auf freie Track-Fläche zentriert den Viewport ungefähr an der real angeklickten Position. Bei einer 12-spaltigen Übersicht entspricht das dem räumlichen Modell des Rails besser als wiederholtes seitenweises Klicken. Die programmatische Bewegung ist smooth, außer bei Reduced Motion.
- **Integrierte Pfeile:** Links/Rechts sind Bestandteile derselben Rail-Oberfläche, haben 44×44 px Hit Targets, klare `aria-label`s und scrollen ungefähr eine Spalte. Die frühere Platzierung in der Toolbar entfällt.
- **Sticky innerhalb der Arbeitsfläche:** Das Rail liegt als bottom-sticky Element am unteren sichtbaren Rand. Es bleibt bei langen Spalten erreichbar, wird am Ende durch den Kanban-Container begrenzt und erhält ausreichend unteren Innenraum, damit Karten nicht dauerhaft verdeckt werden.
- **Eine sichtbare Steuerung:** Der natürliche Anschnitt der nächsten Spalte und schmale Edge-Fades ergänzen das Rail. Die native Browser-Scrollbar wird visuell ausgeblendet, weil sie direkt hinter dem Rail als konkurrierende zweite Steuerung gelesen wurde; native Scrollfläche, Touch-Momentum, Trackpad und `scrollLeft` bleiben erhalten.
- **Accessibility und Touch:** Der Thumb verwendet die korrekte horizontale `scrollbar`-Semantik mit `aria-controls`, `aria-valuemin`, `aria-valuemax` und `aria-valuenow`. Track, Thumb und Pfeile bieten mindestens 44 px Höhe; der Thumb wird auch bei sehr breitem Board nicht schmaler als 44 px. Direkter Touch-Drag nutzt Pointer Capture. Pfeile, Page Up/Down und Home/End sind per Tastatur verfügbar; Fokus wird am Rail sichtbar statt als dominanter Rahmen um das ganze Board.
- **Mouse-Pan nur auf freier Fläche:** `grab`/`grabbing` startet ausschließlich mit der linken Maustaste auf markierten freien Board-Flächen. Karten (`data-rfd-draggable-id`), Spaltenköpfe und interaktive Elemente sind harte Ausschlüsse. Pointer Capture wird bei Up, Cancel, Lost Capture und Unmount bereinigt.
- **Native Gesten bleiben führend:** Kein Wheel-Listener mehr am Vorgangs-Kanban. Vertikales Mausrad scrollt die Seite; horizontales Trackpad, diagonale Gesten, Touch-Momentum und Shift+Wheel bleiben Browser-/Plattformverhalten. Der bestehende Wheel-Helper bleibt unverändert für das kleine Hotboard-Fokusboard.
- **Kein Scroll-Snap:** Freie Navigation bleibt erhalten.
- **Scope:** reine Frontend-/UX-Änderung; keine Domain-, Routing-, Backend-, Datenbank-, RLS-, DnD-Library- oder Persistenzänderung. Kein Production-Deployment in dieser Wave.

### Begründung

Das Rail macht Größe, Ausschnitt und Position der horizontalen Arbeitsfläche gleichzeitig sichtbar. Es bleibt in Reichweite, ohne die Kanban-Kartenlogik zu übernehmen. Der natürliche Content Peek, schwache Edge-Fades und die reale Spaltensegmentierung bilden mehrere ruhige Signale statt eines dominanten Pfeils. Native Wheel-/Trackpad-Semantik reduziert weiterhin Überraschungen, während Board-Pan und Rail-Drag klar voneinander und von Karten-DnD getrennt sind.

### Verifikation

- Automatisiert: reale Rail-/Thumb-Geometrie inklusive 44-px-Minimum, proportionaler Maus- und Touch-Drag, ausgeblendete Browser-Scrollbar bei weiter nativer Scrollfläche, Track-Ziel, Start/Mitte/Ende, Pfeile, Keyboard, Resize, Inhaltsmutation, Reduced Motion, Pointer-Cleanup und DnD-/Pan-Isolation.
- Gestylter Localhost: technische und visuelle Prüfung von Anfang/Mitte/Ende, sticky Containergrenze, Pfeil, Track-Klick und direktem Thumb-Drag. Weitere dokumentierte Breiten-/Zoom-/Theme-Matrix gehört zur Session-Abnahme.
- Status: **LOCAL VERIFIED — AWAITING PRODUCT OWNER UX ACCEPTANCE**. Kein Production-Deployment; automatisierte Tests oder Agenten-Screenshots setzen den Status niemals auf `UX ACCEPTED`.

### Nachtrag: Kontrollierter Production Release (2026-09-01) — `PRODUCTION VERIFIED`

Ein unabhaengiges Release-Gate auf dem RC `0b021df9` hat einen BLOCKER gefunden, der nicht zur Kanban-Wave gehoerte: die `index.css` des RC stammte aus einem Arbeitsbaum-Snapshot auf Stand `0329c0ae` und hatte dadurch die erst danach ergaenzte Regel `.nora-system-event:focus-visible` aus `origin/main@90f3dfc4` verloren — ein WCAG-2.4.7-Regress an der PWA-Update-Flaeche, die `NoraUpdateEvent` programmatisch fokussiert. Geschlossen in `fe962c58` durch byte-gleiche Wiederherstellung genau dieses Blocks; im finalen Diff gegen die Basis erscheint die Regel deshalb gar nicht mehr als Aenderung. **Lehre fuer kuenftige Integrationen:** ein Keyword-Scan nach PWA-Begriffen reicht nicht — die vollstaendige Liste der geloeschten Zeilen gegen die Release-Basis muss gelesen werden.

Release: Fast-Forward `90f3dfc4..fe962c58`, kein Force, kein Squash, kein Merge-Commit. Vercel Production `dpl_A9GhyFNPvUPfuprbtrERDPgHBvwU` READY auf exakt diesem SHA, Alias `nora.ergart.de`. Keine Migration, keine DB-Aenderung.

**PWA-Update-Lifecycle erstmals gegen einen echten Folge-Build live verifiziert.** Ein vor dem Release geoeffneter Tab auf Build `90f3dfc4` (Bundle `index-DBLLfd-K.js`) blieb nach dem Deployment stabil; die Pruefung ergab `registration.waiting = true` bei **null** `controllerchange` — also kein Auto-Takeover vor der Benutzeraktion. Nach „Jetzt aktualisieren" fiel `controllerchange` **genau einmal**, gemessene **8.011 ms** nach dem Klick (die dokumentierte Achtsekunden-Choreografie), danach genau ein Reload auf das neue Bundle `index-BFqB6c-q.js`. Kein Recovery-Zustand im Happy Path, kein wartender Worker mehr, keine Chunk-404, kein `vite:preloadError`, Konsole ohne Meldungen. Damit ist der in PWA-1C.2/1C.3 beschriebene Contract erstmals an einem realen Production-Buildwechsel bestaetigt.

Offen und ausdruecklich **nicht** Teil dieser Welle: das Product-Owner-Feedback zur Update-Experience (kuerzere Copy, ruhigere Bildsprache statt der orangen Warnoptik, freundlicherer Warte-/Recovery-Zustand, neue Nora-Ladeanimation). Das ist eine eigene spaetere PWA-UX-Polish-Welle und war nie eine Bedingung fuer diesen Release.

---

## 2026-08-29 – Notification Presentation Contract v1 (Phase 7A)

### Kontext

Nach `OPERATION STATUS V1 PRODUCTION VERIFIED` (Phase 6E) existiert die technische Operationswahrheit (`pending|success|error`, `execution`, `errorCode`, `result`), aber keine menschliche Rückmeldung darüber. Eine reine Assessment-Session (Phase 7A, kein Code) hat die reale Feedback-Lage kartiert: einzige Feedback-Schicht ist ra-core `useNotify` → sonner (`admin/notification.tsx`, `position="bottom-center"`, in `Layout.tsx`/`MobileLayout.tsx` montiert), verteilt auf 34 Dateien; `useOperations()`/`useOperation()` sind vorhanden, aber von **keiner** Komponente konsumiert; `OperationRecord` trägt keinen fachlichen Anzeigekontext und keine Herkunft; `index.css` hat kein Success-/Warning-Token, keine Motion-Token und keinen `prefers-reduced-motion`-Guard. Drei Punkte waren Produktentscheidungen und wurden vom Auftraggeber entschieden.

### Entscheidung — Produkt

- **Composite: eine user-visible Notification pro Benutzer-Intent.** Quick Capture erzeugt technisch zwei Operationen (`quickCapture.createCase` + `quickCapture.createTask`, je eigene `operationId`, je eigener `manager.execute`-Eintrag in beiden Providern) — sichtbar wird daraus **eine** Karte. Core success + Task failure ist ein **Presentation**-`partial` mit Tone `warning` innerhalb derselben Karte. **Kein neuer Core-Lifecycle-Status.** `OperationStatus` bleibt `pending | success | error`; `taskFailed` bleibt Feld des Application-Command-Outputs.
- **IT-Eskalation bleibt Contract-Fähigkeit, kein UI.** `canEscalateToIT` / `publicErrorRef` gehören zum Contract, werden in 7B aber **nicht gerendert**. Sichtbare Eskalation erst mit belastbarem IT-Incident-Workflow. Befund: die Serverseite existiert bereits (`report_operation_error`, `operation_errors.public_ref` = `NORA-E…`, `reported_by_user_at`) — es fehlt die auswertende Stelle, nicht die Technik. Ein Button ohne Adressat ist ein Versprechen ohne Deckung.
- **Retry in 7B deaktiviert (`{ kind: "none" }`).** Kein halb funktionierender Retry. Der isolierte Task-Retry (Core bereits committed, nur Task-Schritt unter eigenem Idempotency-Scope `quick_capture_case.task` wiederholen) ist frühestens 7C und wird dort separat entschieden. Retry ist nie aus `errorCode` allein ableitbar — er braucht Command-Policy **und** kompatiblen Idempotency-Scope.

### Entscheidung — Architektur-Guardrails (verbindlich ab 7B)

- **Presentation-Registrierung gehört nicht in Application Commands.** Der Delivery-/UI-/Notification-Controller registriert den Intent und reicht die benötigten **Execution**-Metadaten (vorab gemintete `operationId`s) an den Command weiter. Application Commands (`application/commands/*`) bleiben presentation-unabhängig — kein Import aus `notifications/`, kein Display Context, keine i18n-Keys, keine Tone-Entscheidung.
- **Ein lange laufendes Core-`pending` wird von der Presentation niemals zu `error` umgedeutet.** Zulässig ist später höchstens ein zusätzlicher Hinweis „dauert länger als erwartet" — Lifecycle und Tone bleiben `pending`. Der fehlende Timeout-Lifecycle im Core (bekannter Follow-up, `17-known-issues-and-planned-waves.md`) wird nicht durch eine Presentation-Heuristik kaschiert.
- **`NotificationLifecycle` und `tone` dürfen keine widersprüchlichen Kombinationen erlauben.** Der Record ist eine Discriminated Union über `lifecycle`; `tone` wird daraus abgeleitet (`pending→pending`, `success→success`, `partial→warning`, `error→error`) und ist kein frei setzbares Feld.
- **Bedienbarkeit vor Kompaktheit.** Close-Touch-Target mindestens 44×44 px (`--nora-touch-min`). Handlungsrelevante Fehlerdetails werden **nicht** weggeclampt — die Kontextzeile darf auf 2 Zeilen begrenzt werden, die Fehler-/Warnungs-Detailzeile nicht.

### Weitere Contract-Festlegungen (aus dem Assessment übernommen)

- `notificationId` ≠ `operationId`; ein Record hält `operationIds[]` + `primaryOperationId`.
- Display Context (`customerName`/`contactName`/`dealTitle`/`taskTitle`) kommt beim Start der Aktion mit — nie aus UI-Strings geraten, nie per Extra-Query nachgeladen, nie in `operation_errors.technical_context`.
- `execution: "replayed"` rendert **identisch** zu `"executed"` — kein eigener Hinweis.
- Fehlertexte kommen aus `NORA_ERROR_DEFINITIONS[code].messageKey` (bestehende `crm.errors.*`); einziger neuer Fehlertext ist der Fallback `crm.notifications.errors.generic`. Kein neuer Error Contract, kein sichtbarer `NORA_*`-Code.
- `initiator` ist Pflichtfeld mit Default `{ kind: "human" }` und wird bei `human` nicht gerendert. Ein fehlender Wert darf nie als „nicht-menschlich" interpretiert werden. Keine AI-Funktion in Phase 7.
- Neuer i18n-Namespace `crm.notifications.*` in allen drei Katalogen. Die Literal-Strings in `OPERATION_CATALOG` werden **nicht** Textquelle (`DealEdit.tsx` nutzt sie heute als Pseudo-i18n-Key — wird in 7C mitmigriert).
- Beim Settle friert der Notification-Store die Anzeigedaten ein: `OPERATION_RETENTION` entfernt Records nach 8 s (success) / 60 s (error), eine persistente Fehlerkarte überlebt ihren `OperationRecord`.
- Nicht in der Policy gelistete `CatalogOperationType`s sind still.

### Nicht eingeführt (bewusst)

Produktive Notification-UI, neue DB-Tabellen, Migration, Incident Inbox, Mail-/Ticketsystem, AI-Agent, LLM-generierte Texte, Event Bus, Worker, Queue, persistente Notification-History, Browser-Push, vollständige Retry Engine, Änderung am Operation Status Contract oder an `normalizeCrmError`/`noraErrorCodes`, Ausbau von sonner.

### Verifikation

Phase 7A war eine reine Assessment-Session ohne Code-Änderung; dieser Eintrag hält die getroffenen Entscheidungen fest. Die Umsetzung erfolgt in Phase 7B (Contract + Store + Karte + Quick-Capture-Slice + Toast-Migration der vier `QuickCaptureDialog`-`notify()`-Aufrufe) mit eigener Verifikation.

### Nachtrag (Phase 7B.3, 2026-08-29): Operation-ID-Propagation

Die in den Guardrails geforderte Trennung ist jetzt technisch möglich, ohne dass ein Application Command die Presentation kennt:

- **Ein Aufrufer darf eine `operationId` vorgeben.** `createOperationContext()` respektierte gültige IDs schon seit Foundation Wave 1 (Ownership-Regel); neu ist, dass der Quick-Capture-Pfad sie durchreicht: `CreateQuickCaptureCase{,Task}Params.operationId` → `manager.execute(catalog, { operationId }, …)` → `x-nora-operation-id`. Ohne Vorgabe wird weiterhin automatisch gemintet — unverändertes Verhalten für alle bestehenden Aufrufer.
- **Application Commands nehmen ausschließlich neutrale Execution-Metadata entgegen.** `createQuickCaptureCase` kennt `operationIds?: { caseOperationId?, taskOperationId? }` und sonst nichts aus der Presentation-Welt (kein `notificationId`, kein Display Context, kein `messageKey`, kein Tone). `application/commands/*` importiert nichts aus `notifications/`.
- **`operationId` ≠ `idempotencyKey`.** Ersteres identifiziert einen technischen Versuch, Letzteres den fachlichen Intent über Retries hinweg. Ein Retry bekommt eine neue `operationId` und behält den Key.
- FakeRest besitzt dieselbe Semantik wie Supabase (Pflichtparität); keine Demo-Sonderlogik.

### Nachtrag (Phase 7B.4, 2026-08-29): erster produktiver Vertical Slice — Quick Capture

Die Notification-Schicht ist erstmals real montiert. Umfang bewusst genau ein Flow.

- **Notification Controller.** `notifications/useNotifiedQuickCapture.ts` (Hook + testbare reine Form `submitNotifiedQuickCapture`) sitzt zwischen `QuickCaptureDialog` und `application/commands/createQuickCaptureCase`. Er mintet die `operationId`s, registriert **einen** Intent und reicht die IDs als neutrale Execution-Metadata weiter — mehr nicht. Kein eigener Lifecycle, kein Timer, keine Fehlerinterpretation, kein DB-Read, kein freier Text: Zustand kommt ausschließlich aus `quickCaptureCaseResolver` über den Store.
- **Kein Phantom-Task-Slot.** Ein `taskOperationId` wird nur gemintet und registriert, wenn der Command den Task-Schritt tatsächlich ausführt (`taskType` gesetzt). Sonst wartet die Karte auf eine Operation, die nie startet.
- **Provider-Hierarchie.** `CRM → OperationProvider → NotificationProvider → Admin`. Der Store konsumiert denselben `OperationManager` (kein zweiter Manager) und lebt oberhalb von Layout und Dialog — das ist die Bedingung dafür, dass die Karte „Submit → Dialog schließt → Redirect zur Vorgangsakte" überlebt (P37, real getestet). Der Store wird in `NoraNotificationOutlet` in `Layout.tsx` und `MobileLayout.tsx` gerendert.
- **Toast-Migration.** Die vier Quick-Capture-`notify()`-Pfade (Success, Partial, Business-/Command-Fehler, Unknown) sind entfernt. sonner bleibt für alle anderen Flows montiert und unverändert. `useNotify` wird im Quick-Capture-Pfad nur noch für **eine** Kategorie benutzt: einen Fehler, der eintritt, **bevor** eine technische Operation gestartet ist.
- **Fehler vor Operation-Start (Kategorie C).** Neu: `QuickCaptureUnnotifiedError`. Wenn der Submit fehlschlägt, ohne dass `manager.getOperation(caseOperationId)` existiert, verwirft der Controller die Karte und meldet das dem Aufrufer, der den Fehler dann selbst anzeigt. Bewusst **kein** synthetischer `OperationRecord` — eine erfundene Operation ohne serverseitiges Gegenstück würde Audit und Error Observatory verfälschen. Der Auth-Precondition-Guard des Dialogs (`not_authenticated`) läuft über genau diesen Pfad. Feld-/Formularvalidierung bleibt unverändert inline.
- **Keine Karte über offenem Dialog (Befund, keine neue Entscheidung).** ⚠️ **Überholt durch Phase 7B.4c — beschreibt den Stand vom 2026-08-29, nicht den heutigen Code.** Damalige Annahme: die 7B.2-Z-Layer-Regel (Region `z-index: 40`, Radix-Overlay `z-50`) liefere Variante B ohne Zusatzlogik — während der Dialog offen ist, liege eine Karte hinter dem Overlay und werde sichtbar, sobald der Submit den Dialog verlässt. Die UX-Abnahme hat das widerlegt (siehe 7B.4b/7B.4c): der Quick-Capture-Flow endet *immer* mit einem offenen Dialog, die Karte war damit im Hauptpfad praktisch nie lesbar.
- **Close bleibt Presentation-only.** Der Store löscht nur den Karteneintrag; Operation, Audit und Error Observatory bleiben unberührt. Auch eine `pending`-Karte lässt sich schließen — das cancelt nichts, es blendet nur aus. Keine Retry-/IT-Buttons (unverändert 7C bzw. Phase 8).
- **Replay unsichtbar.** `execution: "replayed"` erzeugt eine gewöhnliche Success-Karte; die Disposition bleibt intern am `OperationRecord`.

Nicht geändert: Idempotency-Semantik, Operation Status Contract, RBAC/RLS, Migrationen, RPCs, Audit-/Observatory-Schema, `x-nora-operation-id`-Plumbing aus 7B.3, französischer Legacy-Katalog.

### Nachtrag (Phase 7B.4b, 2026-08-29): Layer-Regel korrigiert — Statusmeldungen über Dialogen

> ⚠️ **Zwischenstand, teilweise überholt durch Phase 7B.4c.** Die hier getroffene Grundentscheidung — Statusmeldungen liegen **über** der Dialogschicht — gilt weiterhin. Die unten beschriebene **Mobile-Ausnahme (`z-index: 40`)** gilt **nicht mehr**: seit 7B.4c teilen beide Breakpoints denselben Layer `z-60`. Für den heutigen Code ist ausschließlich der Abschnitt 7B.4c maßgeblich.

Die in Phase 7A getroffene und in 7B.2 umgesetzte Regel lautete: *„Notification unter Navigation und unter Dialog-Overlays; eine Karte verdeckt niemals einen offenen Dialog“* (`z-index: 40`). Diese Regel war als Zurückhaltung gedacht und ist bewusst so entschieden worden — die reale UX-Abnahme (Phase 7B.4a) hat sie widerlegt.

**Befund.** Quick Capture endet **immer** mit einem offenen Dialog: bei Erfolg leitet der Flow in die Vorgangsakte, die auf dem Desktop selbst ein Modal ist; bei einem Core-Fehler bleibt der Schnellerfassungs-Dialog absichtlich offen. Gemessen bei 1440×900: das Vorgangsmodal (x162–1262, `z-50`) verdeckte **242 von 380 px (64 %)** der Erfolgskarte inklusive Icon und Titel, der Rest lag unter dem 50-%-Schwarz-Overlay. Die eine Karte, die der Benutzer lesen soll, war im Hauptpfad praktisch nie vollständig lesbar.

**Neue Entscheidung.** Statusmeldungen liegen **über** normalen Nora-Dialogen und Modal-Overlays. Begründung: Eine Statusmeldung berichtet über die *eigene* Aktion des Benutzers; sie muss unabhängig davon lesbar bleiben, welche Oberfläche gerade offen ist. Nora-Layer-Reihenfolge:

`Basisinhalt < Navigation/Popover < Dialog-Overlay + Dialog (z-50) < Statusmeldungen (z-60)`

`60` ist die kleinste saubere Stufe oberhalb der Dialogschicht — kein pauschales `999999`, damit ein später bewusst eingeführter Critical-/System-Layer noch darüber liegen kann.

**Ausnahme Mobile — aus der Abnahme heraus entstanden.** Der erste Wurf hob den Layer global auf 60. Auf Mobile war das messbar schlechter: bei 500×715 verdeckten zwei Karten **36 % des Dialogs**, und „Abbrechen“, „Zurück“ sowie „Speichern und Vorgang öffnen“ trafen im Hit-Test die Karte statt den Dialog — der Benutzer konnte die Aktion, über die die Karte berichtete, nicht mehr abschließen. Als Zwischenlösung behielt `.nora-notification-region-mobile` deshalb `z-index: 40`. Der daraus abgeleitete Leitsatz gilt unverändert weiter: **eine Statusmeldung darf niemals die Aktion blockieren, über die sie berichtet.**

⚠️ **Die Mobile-Ausnahme selbst ist überholt (7B.4c).** Sie kaufte Bedienbarkeit mit Unsichtbarkeit — auf dem Telefon lag die Fehlerkarte damit wieder hinter dem Dialog. Die Ursache war nie der Layer, sondern die *Position*. Seit 7B.4c gilt auf beiden Breakpoints `z-60`; die Kollision löst modal-aware Placement plus Click-through.

**Unverändert.** Reine Stacking-Änderung: keine Store-, Lifecycle-, Timing-, Retention-, Resolver- oder Correlation-Änderung. Die Region bleibt nicht-modal (`pointer-events: none`, nur die Karte `auto`), ohne Focus-Trap, ohne Autofocus, ohne Escape-Handler; der `NoraNotificationAnnouncer` bleibt alleiniger Besitzer der Screenreader-Ansagen.

**Bekannte Restfolge (Desktop) — ⚠️ inzwischen behoben durch 7B.4c, nicht mehr offen.** Damals galt: unterhalb von ca. 1700 px Viewport-Breite überlappte die Karte die rechte Hälfte des Dialog-Footers; gemessen bei 1424 px verdeckte die Fehlerkarte 119 von 244 px des Buttons „Speichern und Vorgang öffnen“. Genau diese Überlappung war der Auslöser für das modal-aware Placement; sie existiert seitdem nicht mehr und ist **kein** offener 7C-Punkt.

### Nachtrag (Phase 7B.4c, 2026-08-30): modal-aware Placement — Endstand

Die Layer-Frage brauchte drei Anläufe. Der Verlauf gehört zur Entscheidung dazu:

1. **7A/7B.2 — unter dem Dialog (`z-40`).** Zurückhaltend gedacht. Ergebnis: die Karte war im realen Quick-Capture-Flow zu 64 % vom Vorgangsmodal verdeckt, also praktisch nicht lesbar.
2. **7B.4b — global über dem Dialog (`z-60`), weiterhin unten rechts.** Löste die Lesbarkeit auf dem Desktop, erzeugte aber auf Mobile einen Blocker: die Karte verdeckte 36 % des Dialogs und fing die Klicks auf „Abbrechen“, „Zurück“ und „Speichern und Vorgang öffnen“ ab. Als Zwischenlösung blieb Mobile auf `z-40` — damit war die Fehlerkarte auf dem Telefon wieder unsichtbar. Beide Zustände waren jeweils nur eine Hälfte der Anforderung.
3. **7B.4c — modal-aware Placement.** Die eigentliche Ursache war nie der Layer, sondern die **Position**: unten verankert kollidiert die Karte zwangsläufig mit dem Dialog-Footer, weil dort die Primäraktionen liegen.

**Endgültige Regel.** Beide Anforderungen gelten gleichzeitig: eine Statusmeldung muss lesbar bleiben, egal welche Oberfläche offen ist, **und** darf niemals die Aktion blockieren, über die sie berichtet. Umgesetzt in vier Teilen:

- **Ein Layer für beide Breakpoints:** `Basisinhalt < Navigation/Popover < Dialog (z-50) < Statusmeldungen (z-60)`. Die Mobile-Ausnahme aus 7B.4b entfällt.
- **Modal-aware Position** über Radix' eigenes `data-state="open"` (`body:has([data-slot="dialog-content"][data-state="open"])`, analog für `sheet-content`) — keine zweite Modal-State-Maschine, kein neuer globaler Zustand. Desktop: oben zentriert. Mobile: unterhalb des Dialog-Kopfblocks (Token `--nora-notification-modal-top-mobile`, hergeleitet aus gemessener Dialoggeometrie).
- **Nur die neueste Karte, solange ein Dialog offen ist.** Zwei Fehler hintereinander sind erreichbar (Fehler blenden sich nie aus) und der wachsende Stapel verdeckte Schritt-Tabs *und* das Titel-Feld. Reine Darstellungsgrenze, der Store bleibt unberührt.
- **Click-through als harte Garantie:** bei offenem Dialog ist der Kartenkörper `pointer-events: none`, nur das Schließen-Ziel `auto`. Damit kann eine Karte unabhängig von jeder Dialoggeometrie keinen Klick abfangen — die Position ist nur noch eine visuelle Optimierung, kein Funktionsrisiko.

**Bewusster Preis.** Hover-Pause der Auto-Ausblendung wirkt bei offenem Dialog nicht. Das ist die richtige Seite des Tauschs: dort arbeitet der Benutzer im Dialog, und eine Statusmeldung darf einen Klick auf die Aktion nie gewinnen. Außerhalb von Dialogen bleibt alles wie zuvor.

**Verifikation (gestylte App, echtes Hit-Testing).** Desktop 1424 px und 1884 px sowie 150 % Zoom, Mobile 500×715, jeweils Pending / Success über Vorgangsmodal / Error bei offenem Dialog / Partial: **0 von 11 (Mobile) bzw. 0 von 11 (Desktop) Dialog-Controls blockiert**, Karten-Close 47×47 px und bedienbar, MobileNavigation frei, kein sonner-Toast daneben.

**Unabhängig bestätigt im Final Adversarial Review (2026-08-30, RC `d21c3de7`).** Zweite, getrennte Messung im gestylten App bei 1212 px Viewport — schmaler als beide oben geprüften Desktop-Breiten und damit der härtere Fall — mit einer Pending-Karte über dem offenen Quick-Capture-Dialog: **0 von 14 Dialog-Controls blockiert, 0 unerreichbar** (`document.elementFromPoint()` auf den Mittelpunkt jedes Controls), Kartenkörper `pointer-events: none`, Karten-Close 44×44 px und trotz Radix' `pointer-events: none` auf `<body>` erreichbar. Ebenfalls widerlegt wurde die Vermutung, Radix' modaler Dialog könne die Region per `aria-hidden` vor assistiver Technik verbergen: `#root` bleibt exponiert.

**Unverändert.** Kein Store-, Lifecycle-, Timing-, Retention-, Resolver-, Correlation- oder Error-Mapping-Eingriff; Announcer und Live-Region-Architektur unangetastet.

### Nachtrag (2026-08-30): Kontrollierter Production Release — PHASE 7B PRODUCTION VERIFIED

Keine neue Architekturentscheidung — nur die Dokumentation des durchgeführten Releases.

**Release Candidate.** `9db08c4b35991b4f0d08a898d11a23a1fcba65bc` (Dokumentations-/Kommentar-Hygiene auf dem Feature-Commit `d21c3de7`). Der Hygiene-Commit wurde vor dem Release erneut gegen `d21c3de7` geprüft: er ändert ausschließlich Markdown sowie zwei Kommentarblöcke in `NoraNotificationCenter.tsx`/`.test.tsx` — keine einzige ausführbare Zeile, also nachweislich keine Verhaltensänderung.

**Scope-Freeze gegen die Production-Basis `f46ce06a`.** Der Diff berührt keine Datei unter `supabase/` und keine `*.sql`-Datei. Damit: **keine Migration angewandt**, keine RLS-, RPC-Signatur-, `SECURITY DEFINER`-, Audit- oder Error-Observatory-Schemaänderung. Die bekannte `supabase_migrations`-Bookkeeping-Thematik war für diesen Release folglich gegenstandslos; es wurde bewusst **keine** Production-DB-Aktion durchgeführt. Phase 7B ist ein reiner Frontend-/Presentation-Release mit neutraler `operationId`-Propagation.

**Pre-Push-Gates (alle grün).** `npm run typecheck`, `npm run build`, vollständige Vitest-Suite (80 Dateien, 644 bestanden, 1 übersprungen — exakt der erwartete Stand), ESLint auf den geänderten Dateien (0 Fehler; die eine `react-refresh/only-export-components`-Warnung in `NotificationProvider.tsx` ist eine DX-Warnung ohne Production-Wirkung), `git diff --check` sauber. Hygiene-Scan über den RC: kein `__uxFail`, kein `debugger`, kein `console.log` in den Notification-/Quick-Capture-/Layout-/Root-Pfaden, keine Testinstrumentierung im Production Path, `.cursor/mcp.json` blieb unversioniert und wurde nicht gepusht.

**Push.** Fast-Forward `f46ce06a..9db08c4b` auf `origin/main`, kein Force Push, kein Fremdcommit dazwischen.

**Deployment.** Vercel-Projekt `nora-crm`, Deployment `dpl_B6T7F6Ugmuaq1hbtCpburrfmMr6F`, Target production, Status **READY**, Commit exakt `9db08c4b…`, Domain `nora.ergart.de`.

**Live-Smoke (nicht-schreibend).** Hotboard, Kunden, Kontakte, Vorgänge und die Vorgangsakte-Detailansicht laden mit echten Produktionsdaten; keine weiße Seite, keine Console-Fehler, keine unbehandelten Promise-Rejections. Das ausgelieferte Bundle enthält den 7B-Code nachweislich (`nora-notification-*`-Klassen, `nora-notification-region`/`-card`-Test-IDs, `quickCapture.createCase`). Der Notification-Contract wurde live nachgemessen: Region montiert mit `role="region"` / `aria-label="Statusmeldungen"` / `aria-live="off"` (Live-Semantik korrekt beim Announcer), `z-index: 60`, `pointer-events: none`; **beide** dokumentierten Placement-Zustände real bestätigt — ohne Dialog unten rechts (24 px), bei offener Vorgangsakte per modal-aware Placement im Kopfbereich (`top: 23 px`). Mobile (622 px effektive Breite): Variante `nora-notification-region-mobile` aktiv, MobileNavigation vorhanden, Schnellerfassung über den FAB erreichbar, kein Layout-Crash, kein horizontaler Overflow. sonner ist im Production-Bundle weiterhin enthalten — es gab **keine** globale sonner-Ablösung.

**Bewusst nicht durchgeführt.** Ein echter Live-**Write**-Smoke (Schnellerfassung absenden) fand nicht statt: auf Production existiert kein freigegebener Testdatensatz-Pfad, und ein erzwungener Smoke hätte echte Geschäftsdaten erzeugt. Der Schreibpfad ist durch die Browser-Integrationstests (echter `QuickCaptureDialog`) und die lokale UX-Abnahme gedeckt; die endgültige Live-Bestätigung erfolgt bei der nächsten regulären Nutzeraktion. Ebenso wurde bewusst **keine** Production-Fehlerinstrumentierung vorgenommen — Error/Partial sind lokal vollständig geprüft.

**NOTE, nicht 7B-verursacht.** Unmittelbar nach dem Deployment lieferte der PWA-Service-Worker beim ersten Aufruf noch die Assets des Vorgänger-Builds aus (deren URLs inzwischen 404 sind); nach einem Reload aktualisierte sich der Worker selbst. Das ist bestehendes `vite-plugin-pwa`-Verhalten bei jedem Deployment und kein Notification-Defekt. Wer direkt nach einem Release smoke-testet, muss einmal neu laden, sonst prüft er den alten Build.

**Ergebnis.** Keine BLOCKER, keine HIGH, keine MEDIUM. **PHASE 7B PRODUCTION VERIFIED.** Quick Capture ist und bleibt der einzige migrierte Intent; `deal.update`, `customer.createWithContact` und `contact.convertToCustomer` bleiben Phase 7C.

## 2026-08-29 – Operation Status Contract Wave (v1, CreateQuickCaptureCase Slice)

### Kontext

Zwei vorherige Assessment-Sessions (kein Code) hatten den bestehenden Operation Manager (Foundation Wave 2), das Error Contract (`NoraErrorCode`) und die Idempotency Wave kartiert und einen konkreten, aus dem Code abgeleiteten Contract-Vorschlag gemacht. Kernbefund: der Application Layer konnte bislang nicht unterscheiden, ob ein erfolgreicher idempotenter RPC-Call einen neuen Write durchgeführt oder ein bestehendes Ergebnis replayed hat — `idempotency_check`/`idempotency_persist` gaben identische JSON-Formen zurück. Zwei Entscheidungen waren offen: das RPC-Metadatenformat für `executed`/`replayed` und die Korrektur der Fehlerquelle am Operation Record (`kind` vs. `code`). Diese Session trifft beide Entscheidungen und implementiert Contract v1 am ersten Vertical Slice.

### Entscheidung

- **Lifecycle bleibt `pending | success | error`** — keine neuen Werte (`partial`, `queued`, `retrying`, `cancelled`, `paused`, `timed_out`) ohne reale Nora-Semantik.
- **`execution?: "executed" | "replayed"`** ist kein Lifecycle-Status, sondern ein optionales Zusatzfeld an einem `success`-Record. Fehlt (undefined), wenn kein `idempotencyKey` übergeben wurde — nie „executed" für einen ungeschützten Legacy-Call annehmen.
- **RPC-Metadatenformat:** additives `_meta.disposition` im bestehenden JSONB-Result der drei idempotenten RPCs (`create_customer_with_contact`, `create_quick_capture_case`, `create_quick_capture_task`), additive Migration `20260829150000_operation_status_disposition.sql` — reine `CREATE OR REPLACE FUNCTION`-Body-Änderung auf den bestehenden Signaturen (kein `DROP`/Overload-Risiko wie bei der Idempotency Wave, da kein neuer Parameter). `_meta` wird nur gesetzt, wenn `p_idempotency_key` nicht `null` ist — ein Legacy-Call ohne Key erhält exakt das alte, unveränderte Result-JSON (kein `_meta`-Key überhaupt). Bei Replay überschreibt `v_replay || jsonb_build_object('_meta', ...)` den in `idempotency_records.result` gespeicherten `_meta`-Wert (der beim Erst-Write `"executed"` war) auf `"replayed"` — jsonb `||` überschreibt Top-Level-Keys der rechten Seite.
- **`_meta` ist reine Transportmetadata**, nie Business-Feld, nie Bestandteil des in `idempotency_records` persistierten fachlichen Contracts über die Fingerprint-Berechnung hinaus (Fingerprint wird weiterhin ausschließlich aus den fachlichen `p_*`-Parametern gebildet, unverändert).
- **Fehler-Contract-Korrektur:** `OperationRecord` bekommt ein neues Feld `errorCode?: NoraErrorCode | "unknown"`, gespeist aus `normalizeCrmError().code` (statt weiterhin nur `.kind`, das laut `normalizeCrmError.ts` selbst als „vestigial once `code` is present" markiert ist). Das bestehende `safeErrorCode` (`.kind`) bleibt unverändert als Legacy-/Rückwärtskompatibilitätsfeld bestehen — keine stille Umdefinition, keine neue Fehlerklassifikation.
- **Result-Referenzen:** neues `OperationResultReference`-Feld (`result?: Record<string, string|number|null>`) am `OperationRecord`, ausschließlich die vom RPC zurückgegebenen IDs (`companyId`/`contactId`/`dealId`/`taskId`), nie vollständige Domainobjekte.
- **Manager-API-Erweiterung, kein neuer Manager:** `OperationHandler`-Signatur bekommt einen `ExecutionOperationContext` (Context + optionales `reportOutcome({execution?, result?})`) statt des bisherigen reinen `OperationContext`. Rückwärtskompatibel — ein Handler, der `reportOutcome` nie aufruft, verhält sich exakt wie vorher (execution/result bleiben `undefined`). Nur die drei betroffenen `execute*.ts`-Wrapper (`executeCreateQuickCaptureCase`, `executeCreateQuickCaptureTask`, `executeCreateCustomerFromContact`) rufen `reportOutcome` tatsächlich auf; `executeCreateCustomerWithContact` (schickt nie einen `idempotencyKey`) bleibt unverändert.
- **FakeRest-Parität hergestellt:** `runWithFakeRestIdempotency` in `providers/fakerest/dataProvider.ts` gibt jetzt `{result, disposition}` zurück (disposition `undefined` ohne Key, `"executed"` bei Erstschreiben, `"replayed"` bei Replay) — die drei betroffenen FakeRest-Handler (die den Operation Manager direkt aufrufen, nicht über `execute*.ts`) rufen `context.reportOutcome(...)` entsprechend auf. Die an den Aufrufer zurückgegebene Business-Form bleibt unverändert (kein `_meta`-Leak), verifiziert per Test.
- **Quick Capture Partial Success bleibt wie zuvor modelliert:** kein neuer `partial`-Lifecycle-Status. Core (`quickCapture.createCase`) und Task (`quickCapture.createTask`) bleiben zwei unabhängige Operation-Manager-Einträge; `taskFailed` bleibt ein Feld des Application-Command-Outputs (`createQuickCaptureCase.ts`), keine Parent/Child-Verknüpfung auf Manager-Ebene in dieser Wave.
- **Audit-Kompatibilität geprüft, keine Änderung nötig:** `nora_private.current_operation_id()` liest den Korrelations-Header unabhängig vom RPC-Rückgabewert; die `_meta`-Erweiterung berührt weder die `INSERT`-Statements auf `companies`/`contacts`/`deals`/`tasks` noch `insert_audit_event`/`request_id`. Keine Audit-Änderung vorgenommen.

### Erster Vertical Slice

`CreateQuickCaptureCase` (inkl. des separaten Task-Schritts) und, da dieselben drei bereits idempotenten RPCs betroffen sind, `CreateCustomerFromContact` gleich mit — beide nutzen denselben additiven `_meta`-Mechanismus ohne Mehraufwand.

### Verifikation

- `npm run typecheck`, `npm run build`: grün.
- `npx vitest run`: 75 Testdateien / 538 Tests grün (1 vorbestehender Skip, unverändert), inkl. neuer `operations/operationStatusContract.test.ts` (11 Tests: executed/replayed/undefined-Disposition, präziser `errorCode`, Retry-Attempt-Isolation, Core-success+Task-error-Trennung, Result-Referenz-Minimalität) und Erweiterung von `fakeRestIdempotencyParity.test.ts` (2 neue Tests: FakeRest-Disposition-Parität, kein `_meta`-Leak in die Business-Antwort).
- **Nicht verifiziert in dieser Session (Phase 6B):** kein lokaler Supabase/Docker-Stack verfügbar (Sandbox-Limitierung, wie bereits bei der Customer & Contact Workflow Wave dokumentiert) — `npx supabase db reset --local`, die neue SQL-Suite `supabase/tests/operation_status_disposition_verification.sql` (geschrieben, ungetestet) und ein authentifizierter End-to-End-PostgREST-Roundtrip stehen noch aus. Migration wurde sorgfältig als reine `CREATE OR REPLACE`-Body-Änderung auf unveränderten Signaturen konstruiert (kein Overload-Risiko wie bei der Idempotency Wave), aber das ist Code-Review, kein DB-Beweis. **Diese Lücke ist seit Phase 6C (Nachtrag unten) geschlossen.**

### Nicht eingeführt (bewusst)

Notification-/Status-UI, Incident-Inbox, Retry-Button, persistente Operation-History-Tabelle, Parent/Child-Operation-Tree, Event Bus, Queue, Worker, Outbox, Audit-Redesign, neue Lifecycle-Werte ohne reale Semantik.

### Bekannte Folgepunkte

- Notification-/Status-UI bleibt eigene, spätere Welle — Contract v1 ist UI-neutral gehalten (keine Farben/Texte im Contract).
- `executeCreateCustomerWithContact.ts` (`/kunden/create`) sendet weiterhin keinen `idempotencyKey` — bewusste, unveränderte Legacy-Semantik dieses Pfads (kein Contract-Bug, kein Scope dieser Wave), kein `_meta` für diesen Aufrufer möglich, bis er selbst auf Idempotency umgestellt wird (separater, späterer Ausbau).

### Nachtrag (2026-08-29, Phase 6C): Vollständige lokale DB-/PostgREST-Verifikation — LOCAL RC / REVIEW READY

Docker war in dieser Folge-Session erreichbar. Vollständig durchgeführt, alles gegen einen frischen `npx supabase db reset --local` (46 Migrationen, `20260829150000` korrekt eingetragen, keine Bookkeeping-Drift — `db reset` schreibt Dateiname-Zeitstempel direkt, kein `apply_migration`-Risiko):

- **Signatur-/Overload-Check:** alle drei RPCs existieren nach dem Reset exakt einmal mit der erwarteten Argumentliste (`pg_proc`-Abfrage) — kein Overload durch die reine `CREATE OR REPLACE`-Body-Änderung.
- **Neue SQL-Suite `operation_status_disposition_verification.sql`:** lief grün gegen echtes lokales Postgres (`ALL CHECKS PASSED`) — Legacy ohne `_meta`, frischer Write → `executed`, Replay → `replayed` mit identischen IDs und ohne zweite Zeile, Konflikt → `NORA_IDEMPOTENCY_CONFLICT`, Task-Scope unabhängig disposition-fähig.
- **Kritischer empirischer Beweis (der explizit befürchtete Fehlerfall):** direkt gegen `nora_private.idempotency_records` geprüft — die gespeicherte Zeile bleibt für immer `"executed"` (Schreibzeitpunkt eingefroren); jede Replay-Antwort auf der Leitung berichtet unabhängig davon korrekt `"replayed"` (jsonb `||`-Override greift wie vorgesehen). Kein Leck des eingefrorenen `"executed"`-Werts in eine Replay-Antwort.
- **Authentifizierter End-to-End-HTTP-Beweis** (echter `authenticated`-User-JWT via GoTrue-Password-Grant, kein `service_role`): über `curl` gegen die lokale PostgREST-Instanz — Legacy-Call (kein `_meta`), frischer Call (`_meta.disposition=executed`), Replay (`_meta.disposition=replayed`, identische `company_id`/`deal_id`), Konflikt (HTTP 409, `code=23505`, `details=NORA_IDEMPOTENCY_CONFLICT`, keine zusätzliche Zeile). Zusätzlich über den echten `@supabase/supabase-js`-Client (dieselbe Bibliothek wie die App) reproduziert — `error.details === "NORA_IDEMPOTENCY_CONFLICT"` exakt wie `extractNoraErrorCode()` es erwartet.
- **Quick Capture Partial Success, real:** Core-Schreibvorgang erfolgreich (`executed`), Task-Versuch mit absichtlich ungültigem Payload (`p_company_id`/`p_contact_id` beide `null`) schlägt real fehl (HTTP 400, `22023`) und hinterlässt **keinen** committeten Idempotency-Record; ein korrigierter Retry mit demselben Key gelingt danach frisch (`executed`, kein Konflikt) — bestätigt die bereits aus der Idempotency Wave dokumentierte „uncommitted scope = frei wiederholbar"-Regel bleibt durch diese Wave intakt.
- **Audit-Kompatibilität, real bewiesen (nicht nur gelesen):** `audit_events` zeigt für den Core-Write genau ein `company.created`/`deal.created` mit korrektem `actor_id`; der anschließende Replay über denselben Key erzeugt **keine** zusätzlichen Audit-Zeilen (0 neue Events). `request_id`-Korrelation mit einem explizit gesendeten `x-nora-operation-id`-Header bestätigt (`audit_events.request_id` = gesendete UUID) — unverändert durch diese Wave.
- **Error Observatory:** `errorObservatory.ts` und die zugehörigen SQL-Functions (`record_operation_error`, `operation_errors`) sind laut Diff unverändert; kein gesonderter Test nötig über die bestehende, weiterhin grüne Suite hinaus.
- **Vollständige kanonische RBAC/RLS-Testsequenz** (`07-agent-change-checklist.md`, Pflicht bei `SECURITY DEFINER`-Änderungen — alle drei betroffenen RPCs sind `SECURITY DEFINER`): `production_check` → `first_admin_parallel` (der PowerShell-Runner hatte einen vorbestehenden, von dieser Wave unabhängigen Regex-Parsing-Bug bei der Sales-Leerprüfung unter Windows — echte Parallelität stattdessen über zwei parallele `docker exec psql`-Hintergrundprozesse in Bash nachgebildet, Ergebnis exakt 1 Admin + 1 Viewer) → `setup` → `matrix` → `final_hardening` → `checklists_audit` → `crm_audit` → `google_calendar` → `operation_status_disposition_verification` (neu) → `teardown` → `production_check`. Alle Schritte grün. Zusätzlich `customer_contact_workflow_verification.sql`, `task_customer_context_verification.sql`, `error_contract_verification.sql` erneut grün (unverändertes Verhalten bestehender Business-Regeln bestätigt).
- **Backward Compatibility:** alle Konsumenten der drei RPC-Result-Shapes durchsucht (`ContactToCustomerDialog.tsx`, `QuickCaptureDialog.tsx`, `CustomerCreateForm.tsx`, beide Application Commands) — keiner liest `_meta` oder verlässt sich auf das exakte JSON-Objekt jenseits der dokumentierten Felder; `executeCreateCustomerWithContact.ts` bleibt unverändert (sendet nie einen Key, erhält nie `_meta`).
- **Vollständige Regression danach:** `npm run typecheck`, `npx vitest run` (75 Dateien/539 Tests grün, 1 unveränderter Skip — ein neuer Invarianten-Test ergänzt, siehe unten), `npm run build` — alle grün.
- **Neuer Regressionstest:** `reportOutcome()` gefolgt von einem dennoch geworfenen Fehler erzeugt nachweislich **keinen** widersprüchlichen Record (kein `execution`/`result` auf einem `error`-Status) — der bestehende Code verhindert das bereits strukturell (der Error-Pfad baut den finalen Record aus dem ursprünglichen `pending`-Snapshot, nie aus dem im Handler mutierten `outcomeMeta`); keine Codeänderung nötig, nur ein Test ergänzt, der das absichert.
- **Migration/Schema-Parität:** `20260829150000_operation_status_disposition.sql` und die entsprechenden Abschnitte in `supabase/schemas/02_functions.sql` sind Zeile für Zeile identisch in der disposition-relevanten Logik; keine Signatur-, Security-Mode- oder Grant-Änderung.
- **Kanonischer Migration-Hash:** SHA-256 `ec4eb5b1bb774d452a82b83d82c89deb9a43ceb74baa6899ad06f3ea94e10f5d` (git-Blob-Inhalt nach `git add`, LF-normalisiert — nicht der ggf. CRLF-transformierte Working-Tree-Bytehash).

**Ergebnis: LOCAL RC / REVIEW READY.** Kein Production-Write, keine Production-Migration, kein Push in dieser Session. Nicht gleichzusetzen mit „PRODUCTION VERIFIED" — dieser Status erfordert einen eigenen, späteren, kontrollierten Production-Release-Prozess (RC einfrieren → Production-DB-Migration → DB-Verifikation → Git Push → Deployment → Live-Smoke, wie bei den vorherigen Waves).

### Nachtrag (2026-08-29, Phase 6D.1): Finale RC-Closure-Verifikation auf dem echten Arbeitsbaum — LOCAL RC APPROVED — NOT YET PRODUCTION VERIFIED

Unabhängig von der zuvor in einem separaten (inzwischen verworfenen) Worktree durchgeführten adversariellen Review dieses RC (Verdikt: "RC APPROVED — READY FOR PRODUCTION RELEASE", keine BLOCKER/HIGH/MEDIUM-Findings) wurde in dieser Session eine schmale Closure-Verifikation direkt auf dem echten Arbeitsbaum (`main`, `HEAD=80b1ec4b`) wiederholt:

- **RC-Identität erneut bestätigt:** `HEAD=80b1ec4b`, Baseline `b433b8f5` als Ancestor erreichbar, `git status` sauber bis auf das vorbestehende untracked `.cursor/mcp.json`. Kanonischer Git-Blob-SHA-256 der Migration `20260829150000_operation_status_disposition.sql` erneut über `git cat-file -p <blob> | sha256sum` berechnet (nicht der Working-Tree-/CRLF-Hash) — Ergebnis identisch: `ec4eb5b1bb774d452a82b83d82c89deb9a43ceb74baa6899ad06f3ea94e10f5d`. Vorherige Production-Migration `20260829120000_nora_idempotency_core.sql` laut `git diff b433b8f5 HEAD` unverändert.
- **Workspace-Hygiene-Fund (kein RC-Defekt):** Ein registrierter, aber inhaltlich leerer Git-Worktree unter `.claude/worktrees/agent-aad8805aae5cf8f8f` (derselbe Commit, detached HEAD, keine eigenen Änderungen) war von der zuvor erwähnten, "verworfenen" Review-Session auf der Platte stehen geblieben und `git worktree prune`-fähig, aber noch nicht entfernt. Er wurde in dieser Session sauber entfernt (`git worktree remove` scheiterte unter Windows an einer zu langen Pfadlänge in `node_modules`; per `robocopy /MIR` gegen ein leeres Zielverzeichnis geleert, dann `git worktree prune`). Vor der Bereinigung verfälschte dieser Duplikat-Baum `npx vitest run` (34 zusätzliche, doppelte Testdateien liefen mit, u. a. mit einem echten Browser-`process`-Fehler in einem Deno-Edge-Function-Test) — reines Tooling-/Scan-Artefakt, kein Produktcode-Fehler. Nach Bereinigung: `git status` identisch zum Ausgangszustand (nur `.cursor/mcp.json` untracked).
- **Manager-Publikations-Contract gegen Code+Tests re-verifiziert (nur gelesen, keine Änderung):** `operationManager.ts` baut den Error-Record strukturell aus dem `pending`-Snapshot vor jedem `reportOutcome()`-Aufruf (nicht aus dem im Handler mutierten `outcomeMeta`) — ein Error-Record kann `execution`/`result` bau-bedingt nie tragen. Abgedeckt durch `operationStatusContract.test.ts`: Test „2" (executed+result), „3"/„create_customer_with_contact…" (replayed+result), Invarianten-Test „reportOutcome() followed by a thrown error never produces a contradictory record" (Zeile ~306–330, explizit: `op.execution`/`op.result` bleiben `undefined` auf einem Error-Record trotz vorherigem `reportOutcome({execution:"executed", …})`). Cleanup/Retention (`operationManager.test.ts`, Describe-Block „Timer / cleanup") löscht abgelaufene Records ausschließlich (`operations.delete`), mutiert nie deren `status` — strukturell kann Cleanup keinen bereits finalisierten Record „umlebendig" machen. Kein Test-Gap gefunden, keine neuen Tests nötig.
- **Exakte kanonische RBAC/RLS-Sequenz erneut wörtlich ausgeführt** (nicht nur funktional äquivalent) nach frischem `npx supabase db reset --local`: `production_check` → `first_admin_parallel` → `setup` → `matrix` → `final_hardening` → `checklists_audit` → `crm_audit` → `google_calendar` → `teardown` → `production_check`, alle mit Exit 0 / `OK`-Result. `first_admin_parallel`: derselbe vorbestehende, Windows-spezifische Regex-Parsing-Bug in `rbac_rls_first_admin_parallel_runner.ps1` (Zeile 13/15 — die Vorbedingungsprüfung „sales muss leer sein" parst die mehrzeilige `psql`-Spaltenausgabe fehlerhaft und wirft `Write-Error`, obwohl `count=0`), bestätigt als reines Tooling-Problem des `.ps1`-Wrappers, nicht der zugrunde liegenden SQL-Logik oder des RC — der exakte SQL-Inhalt des Skripts (zwei echte parallele `docker exec psql`-Sessions gegen `auth.users`, anschließende Verifikation „exakt 1 admin + 1 viewer", Cleanup) wurde manuell nachgebildet und lief grün, ohne Produktcode zu ändern. Zusätzlich `operation_status_disposition_verification.sql` erneut grün (`ALL CHECKS PASSED`).
- **Pending-Capacity/TTL:** read-only bestätigt — `operationManager.ts::enforceCapacity()` eviktiert ausschließlich nicht-pendente Records; pendente Operationen haben weiterhin keinen eigenen TTL/Timeout-Lifecycle. Vorbestehend aus Foundation Wave 2, **nicht** durch diese Wave eingeführt. Klassifikation: **LOW / PLANNED FOLLOW-UP** (siehe `17-known-issues-and-planned-waves.md`), kein RC-Blocker.
- **Audit-/`operation_id`-Korrelation, Namensklärung bestätigt:** `audit_events.request_id` wird ausschließlich über `nora_private.current_operation_id()` befüllt, die den Request-Header `x-nora-operation-id` liest (`NORA_OPERATION_ID_HEADER` in `operationContext.ts`) — die Spalte heißt historisch `request_id`, repräsentiert aber die technische `operation_id`-Korrelation aus der Operation-Correlation-Wave (2026-08-10), keine zweite, unabhängige Identität. Additiv, Correlation-Fehler → `NULL`, bestehendes Verhalten unverändert.
- **Idempotency-`_meta`-Guardrail, Dokumentationslage geprüft:** bereits oben in diesem Eintrag (Nachtrag Phase 6C) korrekt beschrieben (`jsonb ||`-Override-Mechanik) und zusätzlich jetzt in `03-data-model-guardrails.md` als eigene Falle für künftige Agenten ergänzt (siehe dort) — kein Codewechsel, nur Querverweis/Auffindbarkeit verbessert.
- **Vollständige Regression auf dem echten Baum (nach Worktree-Cleanup, vor dieser Dokumentationsänderung):** `npm run typecheck` grün, `npx vitest run` → 75 Testdateien / 539 Tests grün, 1 vorbestehender unveränderter Skip (identisch zum in Phase 6C dokumentierten Stand), `npm run build` grün, `git diff --check` sauber. Keine Produktcode-Änderung in dieser Session — nur Dokumentation und Workspace-Hygiene (Worktree-Entfernung, kein Git-Tracked-Inhalt betroffen).

**Ergebnis: `LOCAL RC APPROVED — NOT YET PRODUCTION VERIFIED`.** Kein Production-Write, keine Production-Migration, kein Push in dieser Session. Der kontrollierte Production-Release-Prozess (RC einfrieren → Production-DB-Migration → DB-Verifikation → Git Push → Deployment → Live-Smoke) steht weiterhin aus.

### Nachtrag (2026-08-29, Phase 6E): Kontrollierter Production Release — OPERATION STATUS V1 PRODUCTION VERIFIED — PHASE 6 COMPLETE

Der zuvor freigegebene RC (`HEAD=80b1ec4b`, Closure-Commit `8a09725c`) wurde in einer eigenen Release-Session kontrolliert nach Production ausgeführt (DB-first, wie bei Error Contract Wave und Idempotency Wave):

- **Git-Preflight:** `origin/main` lag exakt auf der erwarteten Baseline `b433b8f5`; Commit-Kette `b433b8f5 → 80b1ec4b → 8a09725c` bestätigt, `80b1ec4b` enthält ausschließlich den RC (Code+Tests+Migration+Docs), `8a09725c` ausschließlich den Docs-Closure-Schritt, kein `.cursor/mcp.json` in beiden Commits, vorherige Production-Migration `20260829120000_nora_idempotency_core.sql` unverändert.
- **Migration-Identität:** kanonischer Git-Blob-SHA-256 erneut aus `80b1ec4b` berechnet — identisch zu allen vorherigen Bestätigungen: `ec4eb5b1bb774d452a82b83d82c89deb9a43ceb74baa6899ad06f3ea94e10f5d`.
- **Production-Target vorab bestätigt:** `nora-crm-prod` (`kixxroxtfzbcbzctohex`), 45 Migrationen, letzte `20260829120000/nora_idempotency_core`, neue Migration noch nicht vorhanden. Pre-Apply Business-Baseline: companies=16, contacts=17, deals=8, tasks=9.
- **Migration angewendet** gegen `nora-crm-prod` — Erfolg.
- **Bookkeeping-Drift (viertes Mal, wie erwartet):** `apply_migration` trug den Apply-Zeitstempel `20260829140725` statt des Datei-Zeitstempels `20260829150000` ein. Nach expliziter Nutzerfreigabe transaktional korrigiert (`UPDATE supabase_migrations.schema_migrations SET version = '20260829150000' WHERE version = '20260829140725'`, kein erneutes Apply). Danach verifiziert: Zielversion exakt einmal vorhanden, falsche Version verschwunden, weiterhin 46 Migrationen gesamt.
- **DB-Contract-Verifikation (read-only):** alle drei RPCs (`create_customer_with_contact`, `create_quick_capture_case`, `create_quick_capture_task`) je genau einmal vorhanden, erwartete Signaturen, keine Overloads, `SECURITY DEFINER`/`search_path=""` unverändert, Grants (`authenticated`/`postgres`/`service_role` EXECUTE) unverändert, Function Bodies enthalten den Disposition-Contract (`'executed'`/`'replayed'`).
- **Data Integrity:** Business-Counts nach Apply identisch zu vorher (16/17/8/9) — keine Release-Testdaten, keine unerwartete Mutation.
- **Git Push:** normaler Fast-Forward `origin/main` `b433b8f5..8a09725c`, kein neuer Produktcode-Commit, kein Force-Push. Remote verifiziert: `origin/main == 8a09725c`, `80b1ec4b` als Ancestor bestätigt, `.cursor/mcp.json` weiterhin ausschließlich lokal.
- **Vercel Deployment:** Production-Deployment `dpl_Cxzp4hVhn69stKHjuf332qegUqox`, Status READY, exakter Commit-SHA `8a09725c916bc0643b9963503daf3248e12c254d`, Domain `nora.ergart.de` im Projekt gelistet.
- **Live-Smoke (nicht-destruktiv):** Hotboard, Kunden-Liste, Kontakte-Liste, Vorgänge-Kanban, Schnellerfassung-Dialog (ohne Speichern geschlossen), Kontakt-Detail mit Kunden-Kontext — alles fehlerfrei geladen, keine rohen `NORA_*`-Codes, keine rohen i18n-Keys, keine Console-Regression (einzige Konsolen-Meldung: vorbestehende Radix-Dialog-A11y-Warnung, kein Runtime-Fehler, keine Regression durch diese Migration).
- **Post-Deploy DB-Re-Verifikation:** 46/46 Migrationen, Zielversion weiterhin exakt einmal vorhanden, Business-Counts weiterhin unverändert.

**Ergebnis: `OPERATION STATUS V1 PRODUCTION VERIFIED — PHASE 6 COMPLETE`.** Phase-7-Notification-/Status-UI, die diesen Contract konsumiert, existiert weiterhin nicht — eigene, spätere Welle. Offener Follow-up unverändert: dauerhaft hängende `pending`-Operationen besitzen keinen eigenen Timeout-Lifecycle (LOW, PLANNED, siehe `17-known-issues-and-planned-waves.md`).

---

## 2026-08-29 – Idempotency Wave

### Kontext

Zwei vorherige Assessment-Sessions (kein Code) hatten den bestehenden Write-Pfad von `CreateQuickCaptureCase`/`CreateCustomerFromContact` kartiert und den dokumentierten Rest-Gap aus der Self Contact Wave (`06-decision-log.md` Zeile ~226, `16-current-state.md` Punkt 5) bestätigt: kein serverseitiger Schutz gegen Doppelclick/Retry, Duplikate bei Netzwerk-Timeout möglich. Diese Session implementiert die additive, kleinstmögliche Idempotency-Lösung.

### Entscheidung

- Neue Tabelle `nora_private.idempotency_records` (`command`, `idempotency_key`, `actor_id`, `request_fingerprint`, `result`), unique auf `(command, idempotency_key, actor_id)`. Kein direkter Client-Zugriff — nur über zwei neue private Helper (`nora_private.idempotency_check`/`idempotency_persist`), analog zum bestehenden `create_customer_with_contact_core`-Muster.
- Atomizität: `pg_advisory_xact_lock(hashtext('nora_idempotency'), hashtext(command || ':' || key))` + Unique-Index-Backstop mit `unique_violation`-Fallback — dasselbe bewährte Muster wie `start_checklist_run_from_template` (v0.3d3). Empirisch mit zwei echten parallelen Postgres-Sessions gegen denselben Key bewiesen: genau eine committete Mutation.
- Transport: expliziter RPC-Parameter `p_idempotency_key uuid default null`, kein Header (bewusst getrennt von `x-nora-operation-id`, das reine technische Korrelation bleibt und nie Geschäftslogik steuert). `operation_id != idempotency_key` bleibt in beide Richtungen unabhängig.
- **Signatur-Gate empirisch verifiziert**: `CREATE OR REPLACE FUNCTION` mit einem zusätzlichen Parameter ersetzt die Funktion NICHT — Postgres legt eine zweite, überladene Funktion an. Gegen die lokale Supabase/PostgREST-Instanz reproduziert: ein alter 5-Parameter-Aufruf brach danach mit `PGRST203` ("Could not choose the best candidate function"). Migration verwendet deshalb `DROP FUNCTION` + `CREATE FUNCTION` für beide bestehenden RPCs — empirisch bestätigt: alter und neuer Aufruf-Shape lösen danach exakt eine Funktion auf, keine Overloads.
- Request-Fingerprint: `md5(jsonb_build_object(...)::text)` über die fachlich relevanten Parameter (kein `pgcrypto` nötig, `md5` ist Postgres-Core). Gleicher Key + gleicher Fingerprint → Replay des gespeicherten `result`; gleicher Key + anderer Fingerprint → neuer Code `NORA_IDEMPOTENCY_CONFLICT`.
- **Quick-Capture-Task-Grenze**: Core (Company+Contact+Deal, `create_quick_capture_case`) bleibt eine Transaktion. Task bekommt eine eigene, neue RPC `public.create_quick_capture_task` mit eigener Transaktion und eigenem Idempotency-Scope (`quick_capture_case.task`) unter demselben client-seitigen `idempotency_key` wie der Core-Scope (`quick_capture_case.core`) — bewusst NICHT in eine gemeinsame Transaktion gezogen, damit die bestehende Best-Effort-Semantik (Core kann erfolgreich sein, auch wenn Task fehlschlägt) strukturell erhalten bleibt. Ein technisch fehlgeschlagener Task-Versuch hinterlässt keinen Record (Transaktion rollt komplett zurück) und bleibt frei retriable — kein `task_attempted`-Flag nötig, nur ein committeter Record zählt als „erledigt".
- Key Ownership/Lifecycle: Quick Capture mintet den Key einmal pro frischem Formular-Zustand und persistiert ihn im bestehenden Draft (`quickCaptureDraft.ts`, Schema-Version 2→3) — ein Reload/Resume verwendet denselben Key. Bei `taskFailed:true` wird der Draft (und damit der Key) bewusst NICHT gelöscht, nur bei vollständigem Erfolg oder explizitem Verwerfen. `ContactToCustomerDialog` hat keinen persistierten Draft — der Key lebt nur für die Dialog-Session (kleinere, aber bewusste Garantie als bei Quick Capture).
- Ein `NORA_IDEMPOTENCY_CONFLICT` im Task-Scope wird in `createQuickCaptureCase.ts` explizit NICHT in `taskFailed:true` verschluckt (das würde einen missbrauchten Retry mit geändertem Task-Payload verstecken), sondern als harter `QuickCaptureSubmitError` propagiert.

### Empirische Verifikation (lokal, Docker/Supabase, keine Produktionsänderung)

- Vollständiger `npx supabase db reset --local` inkl. neuer Migration `20260829120000_nora_idempotency_core.sql` — sauber.
- SQL-Regressionssuite (alle `supabase/tests/*_verification.sql`, inkl. `rbac_rls_matrix.sql`/`rbac_rls_verification.sql` in korrekter Reihenfolge und `google_calendar_verification.sql`) grün.
- Manuelle Szenario-Matrix gegen echtes lokales Postgres: First-Call, Replay (gleiche IDs, keine neuen Zeilen), Conflict bei geändertem Payload, RBAC unverändert (`viewer` weiterhin abgelehnt, VOR jeder Idempotency-Prüfung), Backward-Compat ohne Key, Task-Replay, Task-Conflict, fehlgeschlagener Task-Versuch blockiert Retry nicht, **zwei echte parallele Postgres-Sessions mit gleichem Key → genau eine Mutation** (Core und Task separat bewiesen).
- Vitest (513→518 Tests inkl. neuer `fakeRestIdempotencyParity.test.ts`), `npm run typecheck`, `npm run build` — alle grün.

### Nicht eingeführt (bewusst)

Redis, Worker, Queue, Outbox, Event Bus, generisches Command-Framework, `idempotency_key`-Spalte direkt auf `tasks` (würde Infrastruktur-Semantik in eine Domain-Tabelle leaken), Retention/Cleanup-Infrastruktur (Volumen aktuell gering, `operation_errors` hat dasselbe Muster ohne Cleanup).

### Hardening nach unabhängigem Review (2026-08-29)

Ein unabhängiger Adversarial Review (separate Session, kein Code aus der Implementierungs-Session übernommen) fand keinen Duplicate-Write-Pfad, keine Datenkorruption und kein Authorization-Leak, aber drei zu klärende Punkte. Alle drei sind jetzt bewusst entschieden:

- **`CreateCustomerFromContact` / `customerKind=individual` — Lost-Response-Replay**: Der Client-Precheck (`findExistingPrivateCustomerRecord`) lief bisher immer vor dem RPC-Call und hätte einen Lost-Response-Retry (Versuch 1 committet serverseitig, Response geht verloren, Versuch 2 mit demselben `idempotencyKey`) fälschlich in `ExistingPrivateCustomerRecordError` umgeleitet, statt den idempotenten RPC-Replay-Pfad zu erreichen. **Entscheidung**: der Precheck läuft jetzt nur noch, wenn **kein** `idempotencyKey` übergeben wird (Legacy-Aufrufer ohne Idempotency-Schutz). Mit gesetztem Key geht der Aufruf direkt zum RPC — die DB ist für Replay UND für den Fremd-Intent-Fall (`uq_companies_self_contact_individual`-Backstop → `NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS` → bestehender Catch-Block re-resolved und wirft dieselbe `ExistingPrivateCustomerRecordError`) bereits vollständig autoritativ, keine zusätzliche Client-Logik nötig. Gleicher Key + geänderter Payload läuft stattdessen in `NORA_IDEMPOTENCY_CONFLICT` (RPC-Fingerprint-Mismatch), nicht in `ExistingPrivateCustomerRecordError`.
- **Quick Capture Task — No-Task → Task unter gleichem Root-Key (Semantic B, jetzt verbindlich)**: Task ist ein eigenständiger, optionaler Sub-Intent mit eigenem Idempotency-Scope (`quick_capture_case.task`), nicht Teil des eingefrorenen Core-Intents. Wenn unter einem Root-`idempotency_key` bisher **kein** Task erfolgreich committet wurde (unabhängig davon, ob überhaupt einer angefordert wurde oder ob ein Versuch technisch fehlschlug), darf unter demselben Key **erstmals oder erneut korrigiert** ein Task übermittelt werden — das ist kein Conflict. Erst ein bereits **erfolgreich committeter** Task-Record friert den Task-Scope ein: derselbe Payload → Replay, ein anderer Payload → `NORA_IDEMPOTENCY_CONFLICT`. Kurz: committed scope = eingefroren, uncommitted scope = frei retriable/korrigierbar/entfernbar. Diese Regel war im Code bereits so implementiert; sie war nur nicht explizit hier festgehalten.
- **`idempotency_persist` — Preconditions statt Refactor**: Der `unique_violation`-Fallback in `idempotency_persist` rollt nur seinen eigenen INSERT zurück, nicht vorherige Business-Writes derselben Transaktion. Sicher ist das nur, weil alle drei Call-Sites (`create_customer_with_contact`, `create_quick_capture_case`, `create_quick_capture_task`) ausnahmslos zuerst `idempotency_check` (inkl. Advisory-Lock-Erwerb) aufrufen und danach in **derselben** Transaktion Business-Write → `idempotency_persist` ausführen. Das ist jetzt explizit in den Funktions-Kommentaren beider Helper festgehalten (siehe Migration). Kein generisches Idempotency-Framework, keine neue Architektur — nur die Precondition sichtbar gemacht. Jede künftige Wiederverwendung von `idempotency_persist` MUSS dieses Muster (Lock zuerst, dann Write, dann Persist, alles in einer TX) einhalten.
- **Authentifizierter End-to-End-HTTP-Beweis — GESCHLOSSEN (Nachtrag 2026-08-28, Independent Re-Review)**: Gegen einen frischen `npx supabase db reset --local` wurde ein echter `authenticated`-User-JWT via GoTrue-Password-Grant erzeugt (Test-User `e2e-office@nora.test`, `auth.users`-Insert + `handle_new_user`-Trigger, kein `service_role`-Token) und damit alle drei betroffenen RPCs direkt über die lokale PostgREST-Instanz (`http://127.0.0.1:54321/rest/v1/rpc/...`) angesprochen: (1) `create_customer_with_contact` Legacy-Call ohne `p_idempotency_key` → Erfolg (HTTP 200, `company_id=1`); (2) neuer idempotenter Call mit Key → Erfolg (HTTP 200, `company_id=2`); (3) Replay (gleicher Key, gleicher Payload) → identisches Ergebnis (`company_id=2`), Company-Count unverändert bei 2; (4) Conflict (gleicher Key, geänderter Payload) → HTTP 409, `code=23505`, `details=NORA_IDEMPOTENCY_CONFLICT`, kein zusätzlicher Datensatz. `create_quick_capture_case` und `create_quick_capture_task` unter derselben JWT ebenfalls verifiziert (Erstcall + Replay unter gemeinsamem Root-Key, jeweils identisches Ergebnis, keine Dublette: 1 Deal, 1 Task). Damit ist der reine HTTP-Layer-Beweis mit echter `authenticated`-Rolle für alle drei RPCs erbracht — kein Rest-Gap mehr vor Production. Ausschließlich gegen lokale Supabase-Instanz durchgeführt, keine Production-Änderung.

### Nachtrag (2026-08-28): Kontrollierter Production Release — PRODUCTION VERIFIED

Nach dem lokal implementierten, unabhängig reviewten und gehärteten RC (Commit `1748053496f64dc5479bdbbe03d9f11e76f33173`, Hardening-Commit nach unabhängigem Adversarial Review — siehe oben) wurde die Idempotency Wave in einem RC-eingefrorenen, DB-first Prozess auf Production angewendet. Der Code-Commit war zu diesem Zeitpunkt bereits auf `origin/main` (aus einer vorherigen Session gemerged/gepusht) — nur der DB-Migrationsschritt stand noch aus.

- **Pre-Write-Verifikation:** Migration-Identität gegen den kanonischen Git-Blob-Inhalt in Commit `1748053` bestätigt (SHA-256 `a8f416c70b2abef4bb7598ec2cc769d524a44a2ccb845b6f690897b17d133fc1`), nicht gegen den Working-Tree-Bytehash (Windows/CRLF-Risiko). Production-Migrationshistorie vor Apply gelesen: 44 Migrationen, zuletzt `20260828140000_error_contract_wave`, `nora_idempotency_core` noch nicht vorhanden — deckungsgleich mit Repo-Erwartung.
- **DB-Migration:** `20260829120000_nora_idempotency_core.sql` gegen `nora-crm-prod` (`kixxroxtfzbcbzctohex`) via `apply_migration` angewendet. Additiv, keine bestehende Migration verändert.
- **Erneuter Migration-Bookkeeping-Drift, korrigiert (vierte Wiederholung desselben Musters):** `apply_migration` trug die Migration mit dem Anwendungszeitstempel (`20260828202455`) statt dem Dateiname-Zeitstempel (`20260829120000`) ein. Vor der Korrektur read-only verifiziert: `20260828202455`/`nora_idempotency_core` existierte genau einmal, 45 Zeilen insgesamt. Per transaktionalem `UPDATE supabase_migrations.schema_migrations SET version = '20260829120000' WHERE version = '20260828202455' AND name = 'nora_idempotency_core'` korrigiert (genau eine Zeile), anschließend read-only bestätigt: `20260829120000`/`nora_idempotency_core` existiert genau einmal. Dieser Drift ist jetzt viermal aufgetreten (2026-08-25, 2026-08-28 Self Contact Wave, 2026-08-28 Error Contract Wave, 2026-08-29 Idempotency Wave) — die Regel in `07-agent-change-checklist.md` bleibt bestehen.
- **DB-Verifikation (read-only):** `nora_private.idempotency_records` — erwartete Spalten, Unique-Index auf `(command, idempotency_key, actor_id)`, keine direkten Grants für `anon`/`authenticated` (nur `postgres`-Owner). Drei betroffene RPCs (`public.create_customer_with_contact` 6 Argumente, `public.create_quick_capture_case` 8 Argumente, `public.create_quick_capture_task` 7 Argumente, neu) — je genau eine Function pro Name, kein unerwarteter Overload, alle `SECURITY DEFINER`, `search_path=''`, `EXECUTE` nur für `authenticated`/`service_role`/`postgres` (kein `anon`).
- **Data Integrity:** Kern-Counts vor/nach Apply unverändert (16 Kunden, 17 Kontakte, 8 Vorgänge, 9 Aufgaben — Migration ist reines DDL, keine DML). `idempotency_records` nach Apply leer (0 Zeilen) — keine Release-Testdaten.
- **Git Push:** entfällt — Commit `1748053` war bereits vor dieser Session auf `origin/main` (`git log origin/main` bestätigt dies; `origin/main` lag zum Zeitpunkt dieser Session bereits 3 Commits weiter, aus einer separaten, unrelated UI/UX-Wave, unangetastet gelassen).
- **Vercel-Deployment:** kein neues Deployment durch diese Session ausgelöst (kein neuer Push). Production-Frontend lief bereits auf einem Commit, der die Idempotency-Client-Logik enthält.
- **Live-Smoke-Test** (frische Session gegen `nora.ergart.de`, reale eingeloggte Sitzung): keine Runtime-/Console-Fehler; Hotboard/Kunden (16)/Kontakte/Vorgänge (8) laden korrekt mit realen Produktionsdaten; Schnellerfassung öffnet normal (Kunde-Tab); keine rohen `NORA_*`-Codes oder i18n-Keys sichtbar. Keine Production-Testdaten angelegt, Dialog ohne Speichern geschlossen.
- **Post-Deploy-DB-Verifikation:** Migration-History (45/45, `20260829120000` korrekt benannt) und Datenzustand erneut read-only bestätigt — unverändert zum Stand direkt nach der Migration.

**Ergebnis: PRODUCTION VERIFIED.** Kein DB-Rollback nötig. Der zuvor offene authentifizierte End-to-End-HTTP-Beweis (echter `authenticated`-User-JWT statt `service_role`/Katalog-Ebene) wurde in einem separaten, gezielten Independent Re-Review nachträglich lokal erbracht (siehe Nachtrag „Authentifizierter End-to-End-HTTP-Beweis — GESCHLOSSEN" oben) — kein offener Rest-Gap mehr.

## 2026-08-28 – Kontakterstellung UI-Polish

### Kontext

Die Kontakterstellung war funktional, aber ohne klare visuelle Hierarchie: Pflichtangaben, Kundenbezug, Kontaktwege und selten benötigte Zusatzangaben wirkten gleich wichtig. Auf Mobilgeräten blieb die Kunden-Autocomplete-Auswahl ein kleines Popover; die Aktion zum direkten Anlegen eines Kunden stand zusammen mit normalen Suchtreffern und war dadurch schwerer erlernbar. Die bestehende iPad-Kopfzeile erzeugte bei 834 px außerdem horizontalen Überlauf.

### Entscheidung

- Nur die **Kontakterstellung** erhält die neue Komposition (`ContactInputs variant="create"`). Bestehende Kontakt-Edit-/Show-Flows behalten ihre bisherige Struktur und Semantik.
- Vier wiedererkennbare Bereiche: „Person“, „Kundenbezug“, „Kontaktmöglichkeiten“ und die standardmäßig eingeklappten „Weiteren Angaben“. Validierungsfehler in einem Zusatzfeld öffnen den Bereich automatisch.
- Mobile first: einspaltige Karten, mindestens 44 px große Touch-Ziele und eine feste Primäraktion „Kontakt anlegen“. Erst ab `xl` wird das Formular zweispaltig; iPad bleibt bewusst einspaltig.
- Die Nora-Brandfarbe (`--nora-brand`) bleibt der primären Aktion, Fokus-/Auswahlzuständen und kleinen Abschnittsakzenten vorbehalten. Sämtliche Flächen verwenden bestehende Theme-Tokens und funktionieren in Hell- und Dunkelmodus.
- Die Kundenwahl verwendet mobil ein großes Bottom Sheet mit eigener Suchfläche und einer räumlich getrennten Aktion „Neuen Kunden … anlegen“. Die existierende unmittelbare Create-/Select-Semantik bleibt unverändert. Zusätzlich filtert die UI die bereits geladenen Treffer unmittelbar nach Name und Kundennummer; die serverseitige `q`-Suche bleibt für weitere Datensätze bestehen.
- Für iPad-Breiten wird nur die bestehende Desktop-Kopfzeile verdichtet: globale Suche und Demo-Rollenwahl erscheinen ab `xl`, Schnellerfassung bleibt darunter als Symbol verfügbar. Keine Routen-, Berechtigungs- oder Datenmodelländerung.
- Neue sichtbare Texte liegen vollständig in Deutsch, Englisch und Französisch vor.

### Verifikation

- ESLint auf allen geänderten TSX-Dateien: grün.
- `npm run typecheck`: grün.
- 8 fokussierte Browser-Komponententests: grün (Struktur, Datenbereinigung, Kunden-Neuanlage, mobile Suchfläche und Filterung).
- `npm run build`: grün; nur die bereits bekannten Chunk-/Browserslist-Warnungen.
- Frischer Demo-Browserlauf: 1440 px Desktop, 834 px iPad und 390 px Mobil ohne horizontalen Überlauf; Hell-/Dunkelmodus, feste CTA, eingeklappte Zusatzangaben und mobile Kunden-Neuanlage visuell geprüft; keine Console- oder Vite-Overlay-Fehler.

### Nicht Teil dieser Änderung

Keine Supabase-Migration, kein neues Persistenzmodell, keine Änderung an `contacts.company_id`, `companies.self_contact_id`, `is_primary`, RBAC/RLS, Merge/vCard/Kundenakte-Aktionen oder bestehenden Routen.

**Nachtrag (2026-08-28): DEPLOYED, finale UX-Abnahme noch offen.** Die zugehörigen Commits sind auf `origin/main` gemerged und über das automatische Vercel-Production-Deployment live auf `nora.ergart.de` (per Live-Check bestätigt: `/#/kontakte/create` zeigt die neue Sektionsstruktur „Person"/„Kundenbezug"/„Kontaktmöglichkeiten"/„Weitere Angaben" mit fester Primäraktion). Damit technisch produktiv, aber **kein** förmliches Rollen-UX-Abnahmeprotokoll (`12-role-ux-acceptance.md`) für diese Welle durchlaufen — nicht mit „PRODUCTION VERIFIED" gleichzusetzen, bis diese Abnahme nachgeholt ist.

---

## 2026-08-28 – Error Contract Wave

### Kontext

Vorherige, separate Assessment-Session hatte den bestehenden Fehlerfluss kartiert: `normalizeCrmError` klassifizierte Business-Fehler ausschließlich per Regex auf `error.message` — Herkunft, Wave 1A dieser Serie. Bestätigte Lücke: die Individual Name Invariant (leerer Vor-/Nachname bei Privatkundenakte) hatte kein passendes Muster und fiel auf `unknown`/`crm.errors.load_failed`. Diese Session (Wave 1B) implementiert den ersten produktionsreifen, rückwärtskompatiblen Contract.

Empirisch bewiesen (lokaler echter Postgres → PostgREST-Roundtrip, danach erneut über die realen migrierten RPCs bestätigt): PostgREST liefert bei `RAISE EXCEPTION ... USING ERRCODE = 'x', DETAIL = 'y'` das SQLSTATE unverändert in `PostgrestError.code` und `DETAIL` unverändert in `.details` — kein Text-Parsing nötig, um einen stabilen Code zu transportieren.

### Entscheidung

- **Contract:** `MESSAGE` = Mensch/Diagnose, frei umformulierbar. `ERRCODE` = PostgreSQL-Semantik, keine Nora-Business-Identität. `DETAIL` = stabiler `NoraErrorCode`, nie aus `MESSAGE` abgeleitet.
- **Zentrale Definition:** `src/components/atomic-crm/domain/noraErrorCodes.ts` — framework-frei, `NORA_ERROR_CODES`/`NoraErrorCode`/`NoraErrorCategory`/`NORA_ERROR_DEFINITIONS` (code → category + messageKey), `extractNoraErrorCode()` (akzeptiert ausschließlich kanonische Werte, kein `startsWith("NORA_")`), `throwNoraError()` für FakeRest (wirft `Error` mit `.details = code`, spiegelt die PostgrestError-Form).
- **Fünf erste Codes**, ausschließlich für bereits real nachgewiesene Fälle: `NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT`, `NORA_INDIVIDUAL_NAME_REQUIRED`, `NORA_SELF_CONTACT_DELETE_BLOCKED`, `NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS`, `NORA_PERMISSION_DENIED`. Bewusst **nicht** `NORA_INSUFFICIENT_PRIVILEGE` — der Code beschreibt Noras Application-Semantik, nicht PostgreSQLs `42501 insufficient_privilege`.
- **`normalizeCrmError` ist machine-code-first:** erkannter `NoraErrorCode` aus `.details`/explizitem `.code` ist immer autoritativ vor der bestehenden Regex-Kette. Unbekannte `.details`-Werte werden nie akzeptiert. `NormalizedCrmError` bekommt ein neues optionales Feld `code?: NoraErrorCode` — `technicalMessage`/`status` bleiben unverändert Dev-only/Observatory, nie Teil des stabilen Contracts.
- **`CrmErrorKind` (10 Werte, nicht 11) friert ein:** bleibt für Transport-/Infrastrukturfehler (network/service/auth/notfound/aborted/unknown) dauerhaft bestehen. Die zwei bestehenden Business-Werte (`contact_not_in_customer_context`, `self_contact_delete_blocked`) sind reine Rückwärtskompatibilität für noch nicht migrierte Aufrufer — **kein** neuer generischer `domain_rejection`-Zwischenwert. Neue Business-Errors gehen `NoraErrorCode → messageKey` direkt, ohne `CrmErrorKind`-Umweg.
- **Server-seitig additiv:** neue Migration `20260828140000_error_contract_wave.sql` (SHA-256 `969768dac028914dd0f4fda3b9953927e5b5104d2cb6231f31387c2f12d30bfa`) — `20260826120000_self_contact_and_quick_capture_case.sql` bleibt unverändert. `CREATE OR REPLACE FUNCTION` auf bestehenden Signaturen für `nora_private.create_customer_with_contact_core`, `nora_private.enforce_task_company_context`, `nora_private.sync_individual_company_name`, `nora_private.guard_self_contact_delete`, `public.create_customer_with_contact`, `public.create_quick_capture_case`. `supabase/schemas/02_functions.sql` synchron nachgezogen.
- **Human Message Independence bewiesen:** `enforce_task_company_context()` (23514, englischer Text) und `create_quick_capture_case()` (42501, anderer englischer Text) liefern beide `DETAIL=NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT` — per SQL-Test (`supabase/tests/error_contract_verification.sql`) gegen echtes lokales Postgres bewiesen, nicht nur behauptet.
- **Private Customer TOCTOU:** `create_customer_with_contact_core` fängt `unique_violation` in einem benannten Block (`<<main>> ... exception when unique_violation then get stacked diagnostics ... constraint_name ...`) und übersetzt ausschließlich `uq_companies_self_contact_individual` zu `NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS` — jede andere Unique-Violation wird unverändert weitergereicht (`raise;`). Client-seitig fängt `createCustomerFromContact.ts` diesen Code ab und löst denselben `ExistingPrivateCustomerRecordError` aus wie der normale Pre-Check (`findExistingPrivateCustomerRecord`) — kein separater Race-UI-Pfad.
- **FakeRest-Parität:** `throwNoraError()` für alle fünf Szenarien, soweit FakeRest den jeweiligen Command-Pfad überhaupt modelliert. Neu implementiert (existierten vorher gar nicht in FakeRest): Individual Name Invariant (CREATE- und Rename-Pfad) und Self Contact Delete Guard und Private-Customer-Uniqueness-Backstop in `createCustomerWithContactCore`/`markCompanySelfContact` sowie neue `beforeUpdate`/`beforeDelete`-Hooks auf `contacts`. **Bewusst nicht angefasst:** FakeRest hat weiterhin keine `can_write()`-Entsprechung — Autorisierung wird in FakeRest nur UI-seitig (`canAccess`) durchgesetzt, nicht auf Datenebene. `NORA_PERMISSION_DENIED` ist daher über FakeRest nicht end-to-end testbar; dokumentiert als bestehender, nicht in dieser Welle behobener Debt (separat von der bereits bekannten Security-Advisor-Bewertung).
- **Error Observatory korrigiert, Scope klein gehalten:** `errorObservatory.ts::extractSqlstate()` liest die SQLSTATE jetzt primär aus `PostgrestError.code` (empirisch bewiesen, dass das dort unverändert ankommt) statt sie aus `details`/`hint`-Text zu raten; PGRST-Codes werden weiterhin korrekt als eigene Familie behandelt (`postgrest_code`, nicht `sqlstate`). Kein Observatory-Redesign.
- **Legacy-Regex bleibt** als Fallback für nicht migrierte Aufrufer und für Rückwärtskompatibilität — inkl. eines neuen, bewusst als Legacy-only markierten Musters für `uq_companies_self_contact_individual` im Nachrichtentext, das ausschließlich greift, wenn keine `DETAIL` vorhanden ist.

### Tests

Lokal `npx supabase db reset --local`, danach `supabase/tests/customer_contact_workflow_verification.sql`, `supabase/tests/task_customer_context_verification.sql` (beide weiterhin grün — Migration ist additiv, keine Verhaltensänderung an bestehenden Prüfungen) und neu `supabase/tests/error_contract_verification.sql` (alle fünf Codes, Human Message Independence, TOCTOU-Race, Fremd-Unique-Violation bleibt unübersetzt, Permission Denied für office/admin/viewer). TypeScript: `normalizeCrmError.test.ts` (neu), `errorContractParity.test.ts` (neu, FakeRest), `createCustomerFromContact.test.ts` (neu, TOCTOU), Erweiterungen an `createQuickCaptureCase.test.ts` und `errorObservatory.test.ts`. `npx vitest run`: 71 Testdateien/513 Tests grün. `npm run typecheck` und `npm run build` grün.

### Begründung

Kleinstmögliche Änderung, die die tatsächlich nachgewiesene Fragilität behebt (Text-Regex als einzige Erkennung, eine dokumentierte Erkennungslücke), ohne neues Error-Framework, ohne Idempotency/Notification/Observatory-Redesign — diese bleiben bewusst außerhalb des Scopes für spätere Wellen.

### Bekannte Folgepunkte

- Legacy-Regex-Pfade erst entfernen, wenn nachgewiesen ist, dass alle relevanten Production-Aufrufer `DETAIL` liefern.
- FakeRest-Authorization-Parity (`can_write()`-Äquivalent) bleibt offener, separat zu spezifizierender Debt-Punkt.
- Idempotency für `CreateQuickCaptureCase`/`CreateCustomerFromContact` bleibt eigene, spätere Welle (unverändert aus Self Contact Wave).
- Das geplante Nora Status-/Notification-System ist ein späterer Consumer von `NoraErrorCode`/`operation_id` — nicht Teil dieser Welle.

### Nachtrag (2026-08-28): Kontrollierter Production Release — PRODUCTION VERIFIED

Nach dem lokal implementierten und verifizierten RC (Commit `dbc41a742f82bdbb0fe734df7d0be33db6a5e35e`, davor unabhängig reviewed, nach einem Review-Fund minimal korrigiert — Schema-Datei-Drift bei `set_primary_contact`, siehe Commit `dbc41a74` selbst — und erneut unabhängig reviewed) wurde die Error Contract Wave in einem RC-eingefrorenen, mehrphasigen Prozess auf Production angewendet:

- **DB-Migration:** `20260828140000_error_contract_wave.sql` (SHA-256 `969768dac028914dd0f4fda3b9953927e5b5104d2cb6231f31387c2f12d30bfa`) gegen `nora-crm-prod` (`kixxroxtfzbcbzctohex`) via `apply_migration` angewendet. Additiv, `20260826120000_self_contact_and_quick_capture_case.sql` unverändert.
- **Erneuter Migration-Bookkeeping-Drift, korrigiert (dritte Wiederholung desselben Musters):** `apply_migration` trug die Migration mit dem Anwendungszeitstempel (`20260828131523`) statt dem Dateiname-Zeitstempel (`20260828140000`) ein. Vor der Korrektur read-only verifiziert: `20260828131523`/`error_contract_wave` existierte genau einmal, `20260828140000` existierte noch nicht, 44 Zeilen insgesamt (deckungsgleich mit den 44 lokalen Repo-Migrationsdateien). Per transaktionalem `UPDATE supabase_migrations.schema_migrations SET version = '20260828140000' WHERE version = '20260828131523' AND name = 'error_contract_wave'` korrigiert (genau eine Zeile), anschließend read-only bestätigt: `20260828140000`/`error_contract_wave` existiert genau einmal, `20260828131523` nicht mehr, weiterhin 44 Zeilen, Migrationshistorie 1:1 deckungsgleich mit dem Repo. Dieser Drift ist jetzt dreimal aufgetreten (2026-08-25, 2026-08-28 Self Contact Wave, 2026-08-28 Error Contract Wave) — die Regel in `07-agent-change-checklist.md` bleibt bestehen.
- **DB-Verifikation (read-only):** alle sechs betroffenen Functions (`nora_private.create_customer_with_contact_core`, `nora_private.enforce_task_company_context`, `nora_private.sync_individual_company_name`, `nora_private.guard_self_contact_delete`, `public.create_customer_with_contact`, `public.create_quick_capture_case`) — korrekte Signatur, korrekter Security-Mode (`create_customer_with_contact_core`/`enforce_task_company_context` INVOKER, die übrigen vier `SECURITY DEFINER`), `search_path=''`, kein unerwarteter Overload (je genau 1), Grants nur `authenticated`/`postgres`/`service_role` (kein `anon`). Alle fünf `NoraErrorCode`s exakt an der dokumentierten Stelle im Function-Body gefunden (`NORA_CONTACT_NOT_IN_CUSTOMER_CONTEXT`, `NORA_INDIVIDUAL_NAME_REQUIRED`, `NORA_SELF_CONTACT_DELETE_BLOCKED`, `NORA_PRIVATE_CUSTOMER_ALREADY_EXISTS`, `NORA_PERMISSION_DENIED`). `public.set_primary_contact` bestätigt weiterhin **kein** Producer von `NORA_PERMISSION_DENIED` (Schema-Datei-Drift-Fix aus Commit `dbc41a74` spiegelt sich korrekt in Production). `uq_companies_self_contact_individual` (Partial Unique Index) weiterhin vorhanden. Datenzustand nach Migration identisch zu vor der Migration (16 Kunden, 17 Kontakte, 7 Vorgänge, 10 Aufgaben, 4 Sales — Migration ist reines DDL, keine DML).
- **Git Push:** `dbc41a742f82bdbb0fe734df7d0be33db6a5e35e` nach `origin/main` gepusht (vom Nutzer selbst ausgeführt, da der Push aus der Agent-Session per lokaler Tool-Policy blockiert war). Remote-SHA verifiziert identisch zu HEAD.
- **Vercel-Deployment:** `dpl_92Y6n2e16R8ZfT1DcUXLrw98Cynh`, Target production, Status READY, Commit exakt `dbc41a742f82bdbb0fe734df7d0be33db6a5e35e`, Alias `nora.ergart.de` bestätigt (`aliasError: null`).
- **Live-Smoke-Test** (frische Session gegen `nora.ergart.de`, reale eingeloggte Sitzung): keine Runtime-/Console-Fehler; Hotboard/Kundenliste/Kontakte/Vorgänge laden korrekt mit realen Produktionsdaten; Kunden-Show-Tab-Routing erneut geprüft (Aktivität/Änderungsverlauf) und stabil, keine Rücksprünge; keine rohen `NORA_*`-Codes oder i18n-Keys sichtbar. Keine Production-Testdaten angelegt.
- **Post-Deploy-DB-Verifikation:** Migration-History (44/44, `20260828140000` korrekt) und Datenzustand erneut read-only bestätigt — unverändert zum Stand direkt nach der Migration.

**Ergebnis: PRODUCTION VERIFIED.** Kein DB-Rollback, kein Frontend-Rollback nötig.

---

## 2026-08-28 – Residual Security Advisor Closure

### Kontext

Nachfolge-Session zu „Intentional privileged read views" (siehe unten). Diese Session hat den restlichen Supabase Security Advisor Backlog bewertet, der zuvor als `UNASSESSED` geführt wurde (`number_counters` RLS-ohne-Policy, ausführbare `SECURITY DEFINER`-Functions/RPCs, `auth_leaked_password_protection`), und zusätzlich einen offenen Nachweis zum Search-Path-Schutz von `SECURITY DEFINER`-Functions mit nicht-leerem `search_path` erbracht. Vollständig read-only bis auf einen einzigen, gezielten Auth-Konfigurations-Toggle.

### Entscheidung / Befunde

- **`public.number_counters` (RLS enabled, no policy):** `ASSESSED — INFORMATIONAL — KEEP`. Kein Tabellen-Grant für `anon`/`authenticated` (auch `service_role` hat kein SELECT/DML, nur `REFERENCES`/`TRIGGER`/`TRUNCATE`), also deny-by-grants unabhängig von RLS. Einzige Consumer sind `assign_customer_number()`/`assign_case_number()` — `SECURITY DEFINER`, Owner `postgres`, ausschließlich als BEFORE-INSERT-Trigger auf `companies`/`deals` verwendet. Deliberate deny-all-Architektur, keine Lücke.
- **Ausführbare `SECURITY DEFINER`-Trigger-/Event-Trigger-Functions (`anon_security_definer_function_executable` / `authenticated_security_definer_function_executable` für 17 Functions, u. a. alle `audit_*`, `handle_new_user`, `handle_update_user`, `assign_case_number`, `assign_customer_number`, `cleanup_note_attachments`, `enforce_google_calendar_connection_rules`, `handle_contact_note_created_or_updated`, `rls_auto_enable`):** `ASSESSED — INFORMATIONAL — KEEP`. Alle haben Rückgabetyp `trigger` bzw. (`rls_auto_enable`) `event_trigger` — Postgres verbietet den direkten Aufruf solcher Functions unabhängig von Grants/Rolle ("trigger functions can only be called as triggers"); PostgREST exponiert sie ohnehin nicht als aufrufbare `/rest/v1/rpc/...`-Endpunkte. Der Advisor kann den Rückgabetyp bei dieser Lint-Kategorie nicht berücksichtigen und markiert den (wirkungslosen) PUBLIC-Default-EXECUTE-Grant fälschlich als Exposure. Advisor-Falsch-Positiv-Klasse, kein Exploit.
- **Aufrufbare `authenticated`-only `SECURITY DEFINER`-Business-RPCs** (`create_customer_with_contact`, `create_quick_capture_case`, `set_primary_contact`, `set_sales_role_by_admin`, `start_checklist_run_from_template`, `link_google_calendar_event`, `unlink_google_calendar_event`, `get_audit_storage_stats`, `get_entity_audit_events`, `get_global_audit_events`, `record_operation_error`, `report_operation_error`): `ASSESSED — KEEP`. Keine ist für `anon` ausführbar; jede prüft serverseitig `can_write()`, `has_role([...])`, `is_admin()` oder Actor-Ownership (nie nur RLS, nie Client-/UI-Vertrauen). Kein Authorization-Bug gefunden.
- **Search-Path-Schutz von `SECURITY DEFINER`-Functions:** `NO SEARCH PATH SECURITY BLOCKER`. `CREATE` auf Schema `public` (und `pg_catalog`, `nora_private`) ist auf Production für keine der Rollen `PUBLIC`, `anon`, `authenticated`, `service_role` vergeben — nur `pg_database_owner`/`supabase_admin`/`postgres` besitzen es. Damit kann kein untrusted Client Objekte anlegen, die einen `search_path` shadowen könnten. Zusätzlich: jede `SECURITY DEFINER`-Function in der Datenbank hat ein explizites `proconfig` (`search_path=''` bei der Mehrheit, `search_path=public` bei 9 Functions — `assign_case_number`, `assign_customer_number`, `audit_checklist_run_changes`, `audit_checklist_run_item_changes`, `audit_deal_stage_change`, `audit_saved_text_snippet_changes`, `next_case_number`, `next_customer_number`, `get_user_id_by_email` —, `search_path=pg_catalog` bei `rls_auto_enable`); keine Function verlässt sich auf den Such-Pfad des Aufrufers. Die neun `search_path=public`-Functions referenzieren intern ausschließlich schema-qualifizierte Objekte (`public.number_counters`, `public.insert_audit_event`, `auth.users`, …), keine Dynamic SQL — auch bei hypothetisch offenerem `public`-Schema wären sie robust.
- **`auth_leaked_password_protection`:** `RESOLVED — ENABLED` (2026-08-28, Production). Vorheriger Zustand: deaktiviert (Advisor WARN). Über das Supabase Dashboard (Authentication → Sign In/Providers → Email-Provider-Panel → „Prevent use of leaked passwords") aktiviert — kein Management-API-/SQL-Zugriff auf Auth-Config vorhanden, daher gezielte Browser-Interaktion mit expliziter Nutzerbestätigung vor dem Speichern. Ausschließlich dieser eine Toggle geändert; alle übrigen Felder im selben Panel (Secure password change, Require current password when updating, Minimum password length = 6, Password requirements, Email OTP expiration/length) unverändert gelassen und per Re-Open des Panels nach dem Speichern verifiziert. Anschließend `get_advisors` erneut read-only abgerufen: `auth_leaked_password_protection`-WARN ist aus dem aktuellen Snapshot verschwunden, alle anderen Findings (`number_counters` INFO, zwei `security_definer_view` ERRORs) unverändert vorhanden.

### Begründung

Ziel des Supabase Security Advisors ist nachgewiesene Sicherheit, nicht „0 Findings". Die verbleibenden INFO-/WARN-Signale (`number_counters`, die 17 Trigger-/Event-Trigger-Functions) sind nach Prüfung von Definition, Grants, RLS, Consumer und realem Angriffspfad bewusst akzeptierte Architektur bzw. Advisor-Mechanik-Artefakte — kein Fix nötig oder sinnvoll. Der einzige Punkt mit echtem, kostengünstigem Sicherheitsgewinn ohne Nora-spezifische Abhängigkeit war `auth_leaked_password_protection`, daher isoliert aktiviert.

Diese Bewertung deckt den zum 2026-08-28 abgerufenen Advisor-Snapshot vollständig ab, ist aber keine Zusicherung für alle Zukunft: jede künftige Migration, neue Function/RPC, Grant-Änderung oder neue Advisor-Lint-Kategorie kann neue Findings erzeugen, die eigenständig zu bewerten sind — unabhängig vom hier dokumentierten Abschluss.

### Guardrail

Diese Bewertung gilt nur für den zum Zeitpunkt geprüften Production-Privilege-Stand. Bei künftigen Änderungen an Schema-Grants (`CREATE` auf `public`/`pg_catalog`/`nora_private`), an einer der 9 `search_path=public`-Functions (neue unqualifizierte Referenzen, Dynamic SQL) oder an einer der `authenticated`-only Business-RPCs (neue Parameter, geänderte Rollen-/Ownership-Prüfung) ist eine erneute Security-Bewertung erforderlich — nicht die alte Einstufung wiederverwenden. Kein pauschaler Rückschluss „SECURITY DEFINER + search_path gesetzt = sicher" ohne erneute Prüfung von Schema-Privilegien und interner Qualifizierung.

Vollständige technische Herleitung: Session-Assessment 2026-08-28 (Nachfolge-Session zu „Intentional privileged read views"), zusammengefasst in `17-known-issues-and-planned-waves.md`.

---

## 2026-08-28 – Intentional privileged read views (`init_state` / `sales_directory`)

### Kontext

Zwei vorbestehende Supabase Security Advisor ERROR-level Findings (`SECURITY DEFINER`-Views: `public.init_state`, `public.sales_directory`) waren seit vor der Customer & Contact Workflow Wave bekannt, aber nie im Detail bewertet — nur in jedem Production-Preflight read-only als „unverändert" bestätigt. Diese Session führte ein dediziertes, ausschließlich read-only Assessment gegen den tatsächlichen `nora-crm-prod`-Katalog durch (Definition, Owner, `security_invoker`, Dependency-Baum, Grants für `anon`/`authenticated`/`service_role`, zugrunde liegende `sales`-RLS, reale Consumer, Zugriffsszenarien je Rolle inkl. manipuliertem Client).

### Entscheidung

`public.init_state` und `public.sales_directory` bleiben bewusst mit `security_invoker = off` bzw. `false` bestehen. Keine Code-, Migrations- oder Grant-Änderung in dieser Session.

### Begründung

Beide Views überschreiten eine strengere Base-Table-RLS auf `public.sales` gezielt für einen engen, fachlich notwendigen Read-Use-Case:

- **`init_state`:** anonymer Bootstrap-Status-Check (Sign-up-UI-Gating) mit minimalem, nicht-personenbezogenem 0/1-Signal (`is_initialized`). `anon` hat unter der `sales`-RLS-Policy „Sales select own or admin" sonst keine Möglichkeit, diesen Zustand vor dem Login festzustellen. Die tatsächliche Sicherheitsgrenze für „nur ein Erst-Admin" liegt nicht in dieser View, sondern unabhängig davon in `nora_private.resolve_first_signup_role()` (Advisory-Lock + frischer Count, nicht via PostgREST erreichbar).
- **`sales_directory`:** internes Teamverzeichnis (`id`, `first_name`, `last_name`, `avatar` — explizit ohne `role`/`email`/`user_id`/`administrator`/`disabled`) für Zuständigkeits-Picker, nutzbar von allen aktiven Rollen. Die `sales`-RLS beschränkt reguläre Reads auf die eigene Zeile (oder Admin) — ohne die Owner-Privilegien der View könnten `office`/`viewer` keine Kollegen für Zuständigkeits-Auswahl sehen, was der dokumentierten Rollenmatrix (`11-google-calendar-rbac.md` C.3: „Kalender/Teamlisten lesen: alle Rollen") widerspricht.

Ein pauschaler Wechsel auf `security_invoker = true` wurde für beide Views geprüft und würde den jeweiligen Use-Case nachweislich regressieren (`init_state`: `anon` sähe immer `is_initialized = 0`; `sales_directory`: `office`/`viewer` sähen nur die eigene Zeile).

Security assessment: **LOW / KEEP** für beide Findings — **kein aktueller Production Security Blocker**. Der Supabase Advisor markiert hier den Mechanismus (jede `SECURITY DEFINER`-View ist per Default ein ERROR-Lint), nicht einen nachgewiesenen Exploit; die tatsächliche Risikobewertung erfolgt anhand der konkreten Datenprojektion, Grants, RLS, Consumer und Zugriffsszenarien — nicht anhand des Advisor-Labels allein.

### Guardrail

Diese Entscheidung gilt nur für die aktuell geprüfte Projektion, Grants und Abhängigkeiten beider Views (Stand 2026-08-28). Änderungen an den projizierten Spalten, den View-Grants, der zugrunde liegenden `sales`-RLS, `nora_private.is_active_user()`, dem Bootstrap-/Sign-up-Flow, `resolve_first_signup_role()` oder der `security_invoker`-Semantik erfordern eine neue Security-Bewertung. `sales_directory` darf ohne neue Entscheidung nicht um `role`, `email`, `user_id`, `administrator` oder sonstige Identity-/Security-Metadaten erweitert werden.

**Optional, nicht dringend:** `init_state` trägt heute wirkungslose zusätzliche DML-Grants (`INSERT`/`UPDATE`/`DELETE`/…) für `anon`/`authenticated` neben `SELECT` (nicht updatebare View, keine `INSTEAD OF`-Trigger) — könnte in einer künftigen kleinen, separat reviewten Migration auf `grant select` reduziert werden. Das ist Grant-Hygiene/Defense-in-Depth, kein Security-Fix.

Vollständige Details je Finding (Datenklassifikation, Grant-Tabellen, Rollen-Zugriffsszenarien): `17-known-issues-and-planned-waves.md` „Security Advisor Findings — assessed 2026-08-28". Weitere vom Advisor gemeldete INFO-/WARN-Hinweise (`number_counters` RLS-ohne-Policy, mehrere ausführbare `SECURITY DEFINER`-RPCs, `auth_leaked_password_protection`) wurden in dieser Session **nicht bewertet** — siehe „Remaining Security Advisor Follow-ups" im selben Dokument. Der Supabase Security Advisor ist damit **nicht** vollständig abgearbeitet.

---

## 2026-08-27 – Pre-Production Hardening Patch

### Kontext

Die Self Contact Wave (2026-08-26, siehe unten) war implementiert, aber noch nicht gepusht/deployed. Ein unabhängiger Hardening-Review vor dem Push fand konkrete, verifizierbare Bugs und Architekturschwächen. Diese Session hat die verifizierten Punkte behoben und mit Tests abgesichert — kein neues Feature, keine neue Architektur.

### Entscheidung / Befunde

- **Verifizierter FakeRest/SQL-Parität-Bug (behoben):** `providers/fakerest/internal/taskContextCheck.ts::isEffectiveContactOfCompany()` prüfte bislang **nur** `company.self_contact_id === contactId` und fragte den Kontakt selbst nie ab — ein regulärer Kontakt derselben Firma (`contact.company_id = company.id`, kein Self Contact) wurde in FakeRest fälschlich als „nicht effektiv zugehörig" abgelehnt, obwohl SQL (`nora_private.is_effective_contact_of_company`) und TS-Domain (`domain/customerContactContext.ts`) korrekt beide Bedingungen prüften. Fix: FakeRest fragt jetzt zusätzlich `contacts.company_id` ab und prüft beide Bedingungen (ODER-Verknüpfung), identisch zur SQL-Autorität.
- **Domain Contract Testing eingeführt:** neue gemeinsam benannte Szenario-Matrix `domain/effectiveContactContext.contractCases.ts` (`regular_contact` / `self_contact` / `foreign_contact` / `foreign_primary_contact` / `regular_and_self` / `missing_contact` / `missing_company`), verwendet von `customerContactContext.test.ts` (TS) und dem neuen `taskContextCheck.test.ts` (FakeRest); identisch benannte Fälle in `supabase/tests/customer_contact_workflow_verification.sql` Abschnitt 7 (SQL, nicht in dieser Session gegen echtes Postgres ausgeführt — siehe „Nicht verifiziert" unten). Ziel: eine erneute Divergenz fällt künftig im Test auf, nicht erst im Browser.
- **Falsy-ID-Audit (numerische IDs per Truthiness geprüft, `identity.id = 0` als „keine Identity" fehlinterpretiert):** repository-weiter Grep-Audit nach `!identity?.id`, `!companyId`, `!winnerId`, `!record.*_id` u. ä. Muster. Neue Guardrail-Regel: Falle 32 in `03-data-model-guardrails.md`. Behobene Fundstellen (BUG, `identity.id`/andere numerische IDs können `0` sein — Default-Demo-Admin hat `identity.id = 0`, siehe `demoSession.ts`):
  - `QuickCaptureDialog.tsx` — 4× `!identity?.id` (Draft-Persistenz/-Restore/-Autosave/-Submit) + Save-Button `disabled`, außerdem `!!companyId`/`!!selfContactId` in `enabled`-Flags
  - `ContactMergeButton.tsx` — `!winnerId`/`!!winnerId` (3 Stellen inkl. einer JSX-Bedingung, die bei `winnerId=0` sichtbar „0" gerendert hätte statt nichts)
  - `CompanyAside.tsx` — `!record.sales_id` (Sichtbarkeit des „Weitere Infos"-Bereichs)
  - `CompanyInputs.tsx` / `CompanyShow.tsx` (`SelfContactCard`) — `!!record.self_contact_id`
  - `NoteCreateSheet.tsx` / `TaskCreateSheet.tsx` — `!referenceRecordId`
  - `AddTask.tsx` — `!resolvedContactId`
  Alle auf `== null`/`!= null` (nullish) umgestellt. Regressionstests: `quickCaptureDraft.test.ts` (`userId = 0`), `customerContactContext.test.ts` (`contact.id = 0` / `self_contact_id = 0`). **Nicht mit eigenen Component-Tests abgedeckt** (Zeit-/Scope-Abwägung, da die Fixes strukturell identisch zum bereits getesteten Muster sind): `ContactMergeButton`, `AddTask`, `NoteCreateSheet`, `TaskCreateSheet` — kein bestehendes Test-File für diese Komponenten vorgefunden, kein neues für jede einzelne ID=0-Randstelle angelegt.
- **Error Contract geschlossen (Quick Capture):** `application/commands/createQuickCaptureCase.ts` reichte bei einem RPC-Fehlschlag den rohen `error.message` unverändert als `QuickCaptureSubmitError`-Code durch; `QuickCaptureDialog.tsx` baute daraus direkt einen i18n-Key (`crm.quick_capture.errors.${error.message}`) — freier DB-Text hätte nie eine Übersetzung getroffen. Fix: `misc/normalizeCrmError.ts` um zwei neue `CrmErrorKind`s erweitert (`contact_not_in_customer_context`, `self_contact_delete_blocked`) mit Pattern-Matching auf die bekannten Self-Contact-Wave-Exception-Texte; `createQuickCaptureCase.ts` normalisiert jetzt vor dem Werfen und reicht nur noch einen von zwei stabilen Codes durch (`contact_not_in_customer_context` | `case_create_failed`). Keine zweite Error-Infrastruktur — bestehende `normalizeCrmError`/`CrmErrorKind`-Maschinerie wiederverwendet und erweitert, exakt wie in `CustomerCreateForm.tsx` bereits genutzt. Neue i18n-Keys in allen drei Katalogen (DE/EN/FR).
- **Individual Name Invariant (verifiziert erreichbar, behoben):** `ContactInputs.tsx` validiert `first_name`/`last_name` nur mit `required()` (react-admin), das Whitespace-only-Werte (`" "`) nicht ablehnt. `nora_private.sync_individual_company_name()` trimmt vor dem Schreiben — ein Kontakt-Edit mit `first_name=" "`/`last_name=" "` auf dem repräsentierenden Kontakt einer Privatkundenakte hätte `companies.name = ''` erzeugt (NOT NULL, aber kein Non-Empty-Check). Fix: Trigger berechnet den Namen vorab und lehnt mit `RAISE EXCEPTION` ab, wenn er für eine `individual`-Kundenakte leer würde — kein Platzhalter wie „Unbekannt". Geändert in der noch ungepushten Migration `20260826120000_self_contact_and_quick_capture_case.sql` selbst (nicht als Folge-Migration, da die Self Contact Wave insgesamt noch nicht deployed ist) und gespiegelt in `supabase/schemas/02_functions.sql`. Test ergänzt in `customer_contact_workflow_verification.sql` (Abschnitt 4c-ii) — **nicht in dieser Session gegen echtes Postgres ausgeführt**, siehe unten.

### Nachtrag (2026-08-27, selbe Session): Docker gestartet, versäumte Nachprüfung nachgeholt

Docker Desktop wurde lokal gestartet und die volle kanonische RBAC-Testreihenfolge aus `07-agent-change-checklist.md` gegen einen frischen `npx supabase db reset --local` durchlaufen: `rbac_rls_production_check` → `rbac_rls_first_admin_parallel` → `rbac_rls_setup` → `rbac_rls_matrix` → `rbac_rls_final_hardening` → `checklists_audit_verification` → `crm_audit_verification` → `customer_contact_workflow_verification` (inkl. neuer Domain-Contract-Matrix Abschnitt 7 und Individual-Name-Invariant-Negativtest Abschnitt 4c-ii) → `task_customer_context_verification` → `rbac_rls_teardown` → `rbac_rls_production_check` — **alle grün**, reproduzierbar über zwei komplette Durchläufe.

- **Atomarer Rollback empirisch bewiesen:** neuer Testabschnitt 6f in `customer_contact_workflow_verification.sql` — gültige Firma+Kontakt kombiniert mit absichtlich leerem Vorgangsnamen (`p_deal.name = ''`); `create_quick_capture_case` schlägt fehl (`'deal name required'`), und es bleibt nachweislich **kein** halbfertiger Kunde/Kontakt/Vorgang zurück (Company-/Contact-/Deal-Zeilenzahl vor/nach identisch, kein Datensatz mit dem Test-Firmennamen). Zusätzlich einmal interaktiv gegen die Datenbank vorab geprobt, bevor der Test persistiert wurde.
- **Authorization Boundary bestätigt:** `rbac_rls_matrix` deckt die anon/viewer/office/admin-Matrix für die bestehenden RLS-Policies/RPCs ab (unverändert, aber jetzt in dieser Session tatsächlich ausgeführt statt nur angenommen); `customer_contact_workflow_verification.sql` bestätigt zusätzlich gezielt, dass `viewer` von `create_quick_capture_case` selbst (nicht nur RLS) abgelehnt wird.
- **Concurrency-Bewertung (nur bewertet, keine neue Infrastruktur gebaut, wie beauftragt):**
  - Zwei nahezu gleichzeitige `CreateQuickCaptureCase`-Aufrufe mit `p_company` (neue Firma, gleicher Name): kein Unique-Constraint auf `companies.name` → beide erzeugen je eine Firma. Vorbestehendes, bekanntes Verhalten (Dubletten nur heuristisch, siehe `03-data-model-guardrails.md` „Schnellerfassung"), durch diesen Patch nicht verschlechtert.
  - Zwei nahezu gleichzeitige Anlagen einer **individuellen** Kundenakte für denselben `self_contact_id` (z. B. Doppelklick auf „Kundenakte anlegen"): durch `uq_companies_self_contact_individual` (Partial Unique Index) geschützt — der zweite Request bekommt einen `unique_violation`, seine gesamte Transaktion (inkl. der neu eingefügten Company-Zeile) wird atomar zurückgerollt. Keine doppelte Privatkundenakte möglich. Der abgelehnte Request zeigt aktuell nur die generische `crm.errors.load_failed`-Fallback-Meldung (kein dediziertes Mapping in `normalizeCrmError` für diese konkrete Unique-Violation) — akzeptabel für ein seltenes Race-Fenster (der übliche sequentielle Fall ist bereits durch `findExistingPrivateCustomerRecord()`-Vorabprüfung in `createCustomerFromContact.ts` mit klarer UI abgefangen), aber als kleine Verbesserungsmöglichkeit notiert, nicht in dieser Session umgesetzt.
  - `p_existing_company_id` + `p_existing_contact_id` (bestehender Kunde + bestehender Kontakt): ein doppelter Request (zwei Tabs/Geräte, oder ein sehr schneller Doppelklick, der die bestehende `isPending`-Sperre des Save-Buttons umgeht) erzeugt zwei separate Vorgänge — kein Idempotency-Key vorhanden. Das ist der bewusst unadressierte, dokumentierte Rest-Gap aus der ursprünglichen Self-Contact-Wave-Entscheidung: `CreateQuickCaptureCaseInput`/`CreateCustomerFromContactInput` sind einfache, additive Objektstrukturen — ein späteres optionales `idempotencyKey`-Feld ist ohne Breaking Change möglich, wurde aber (wie beauftragt) nicht implementiert.
  - In keinem der drei Fälle entsteht ein **halbfertiger** Datensatz — jede RPC ist ein einzelner Funktionskörper (eine Transaktion); Races beeinflussen nur, *wie viele* vollständige Objekte entstehen, nie einen unvollständigen Zustand.
- **Production-Data-Preflight — nachgeholt, nachdem die Supabase-MCP-Verbindung in derselben Session auf `nora-crm-prod` umgestellt wurde** (Projekt-Ref `kixxroxtfzbcbzctohex`, verifiziert per `list_projects` vor jeder Abfrage). Read-only, aggregiert, keine personenbezogenen Daten:
  - Migrationshistorie deckungsgleich mit `supabase/migrations/` bis einschließlich `20260825190000_unified_tasks_wave` — Self Contact Wave (`20260826120000_…`) **noch nicht angewendet**, keine Drift.
  - 14 Kunden, **0 `individual`**, 14 `business` → **kein Self-Contact-Backfill-Kollisionsrisiko**: es gibt keine Privatkundenakten, für die `self_contact_id` nachträglich bestimmt werden müsste; die neue Spalte/der deferred Constraint-Trigger haben beim Apply nichts zu tun.
  - 15 Kontakte (7 ohne `company_id`, unauffällig), 8 Hauptansprechpartner, **0 Kunden mit mehr als einem Hauptansprechpartner** (Partial-Unique-Index-Invariante hält in Produktion).
  - 7 Vorgänge, 8 Aufgaben, **0 Aufgaben, die den „company_id oder contact_id"-CHECK verletzen würden**.
  - **0 doppelte** `customer_number`/`case_number`, 0 Kunden ohne Nummer, **0 verwaiste FKs** (contacts→companies, tasks→contacts, tasks→companies).
  - Security-/Performance-Advisors geprüft: 2 vorbestehende ERROR-Findings (`init_state`/`sales_directory`-Views mit `SECURITY DEFINER`) — **nicht durch diesen Patch verursacht**, außerhalb des Scopes dieser Session, nicht behoben. Übrige Findings INFO/WARN, Routine (ungenutzte Indizes, RLS-Init-Plan-Hinweise), nichts Blockierendes.
  - **Ergebnis: keine Migration-Blocker.**

### Verifiziert

- `npm run typecheck`, `npm run build` — grün.
- Vollständige Vitest-Suite: 68 Test-Dateien / 487 Tests grün, 1 vorbestehend übersprungen (unverändert ggü. vorherigem Stand plus die neuen Tests aus diesem Patch).
- Neue/erweiterte Tests: `domain/customerContactContext.test.ts` (Contract-Matrix + `id=0`-Regression), `providers/fakerest/internal/taskContextCheck.test.ts` (neu, Contract-Matrix), `quickCaptureDraft.test.ts` (`userId=0`-Regression), `application/commands/createQuickCaptureCase.test.ts` (neu, Error-Contract), `misc/noraRbacUx.test.ts` (drei neue `normalizeCrmError`-Fälle).
- `npx supabase db reset --local` zweimal vollständig durchlaufen (inkl. Migration `20260826120000_self_contact_and_quick_capture_case.sql` mit dem neuen Individual-Name-Invariant-Guard); volle kanonische RBAC-Testreihenfolge + `customer_contact_workflow_verification.sql` (inkl. neuer Domain-Contract-Matrix und Atomic-Rollback-Test) + `task_customer_context_verification.sql` — alle grün, reproduzierbar.
- Production-Data-Preflight (read-only) gegen `nora-crm-prod` durchgeführt, siehe oben — keine Migration-Blocker gefunden.
- Kein Push, kein Production-Deploy, keine Production-Migration in dieser Session (wie beauftragt) — Preflight war ausschließlich lesend (`execute_sql` mit `select`, `list_migrations`, `get_advisors`).

### Nachtrag (2026-08-28, Final Release Candidate Verification): Individual Name Invariant am CREATE-Pfad geschlossen

**Verifizierter, behobener Bug:** `nora_private.create_customer_with_contact_core()` erzwang die Individual-Name-Invariante bislang nur beim späteren Rename (`sync_individual_company_name()`-Guard aus dem Haupteintrag oben). Am CREATE-Pfad selbst prüfte nichts, ob der self-contact-werdende Kontakt tatsächlich einen Namen hat, und `companies.name` wurde nie aus dem Kontakt abgeleitet — ein client-seitig gelieferter `p_company.name` (z. B. „Batman") blieb unabhängig vom tatsächlichen Kontaktnamen stehen, sogar bei `customer_kind='individual'`. Live reproduziert: ein neuer Self Contact mit leerem/Whitespace-only Namen erzeugte eine Privatkundenakte mit einem vom Kontakt komplett unabhängigen Namen.

**Fix (in `create_customer_with_contact_core`, alle drei Self-Contact-Zuweisungspfade — `p_self_contact_id`, `p_existing_contact_id`, neuer `p_contact` — sowie sowohl neue als auch bestehende Kundenakte):** sobald diese Funktion `self_contact_id` für eine `individual`-Kundenakte setzt, wird `companies.name` serverseitig aus `contacts.first_name`/`last_name` (getrimmt) abgeleitet und überschreibt einen abweichenden `p_company.name`; hat der repräsentierende Kontakt nach Trim weder Vor- noch Nachnamen, schlägt der gesamte Aufruf fehl (kein halbfertiger Datensatz, ein Funktionskörper = eine Transaktion). Für `customer_kind='business'` bleibt der Firmenname vollständig unabhängig vom Self Contact — die Ableitung greift ausschließlich bei `individual`. Geändert in derselben Migration (`20260826120000_self_contact_and_quick_capture_case.sql`, damals noch ungepusht) und `supabase/schemas/02_functions.sql` — beide zusammen mit dem restlichen Fix vor dem Production Release eingebracht, siehe Release-Nachtrag unten.

**Neue SQL-Tests** (`customer_contact_workflow_verification.sql`, Abschnitt 4c-iv): individuell + neuer Kontakt mit leerem/Whitespace-Namen → Ablehnung, vollständiger Rollback; individuell + bestehender Kontakt ohne sinnvollen Namen → Ablehnung; individuell + Kontakt „Existierender Kontaktname" + abweichendes `p_company.name="Batman"` → Ergebnis ist kanonisch „Existierender Kontaktname"; individuell + normal benannter neuer Kontakt → Erfolg mit korrekt abgeleitetem Namen; business + Self Contact über denselben Core (`p_mark_self`) → Firmenname bleibt unabhängig. Alle grün gegen `npx supabase db reset --local`, volle kanonische Testreihenfolge erneut vollständig durchlaufen.

### Nachtrag (2026-08-28): Kontrollierter Production Release — PRODUCTION VERIFIED

Nach Abschluss der Final Release Candidate Verification (Commit `0c93912137d610f570b5c5fd449573d25160fe86`) wurde die Self-Contact-/Quick-Capture-Wave inkl. Final-RC-Hardening in einem mehrphasigen, RC-eingefrorenen Prozess auf Production angewendet:

- **DB-Migration:** `20260826120000_self_contact_and_quick_capture_case.sql` (SHA-256 `b747b94d6132b37f41ed82367bcd898db52b07e85dbf2f14c83e8fcdd285c2e7`) gegen `nora-crm-prod` (`kixxroxtfzbcbzctohex`) via `apply_migration` angewendet.
- **Erneuter Migration-Bookkeeping-Drift, korrigiert:** `apply_migration` trug die Migration wieder mit dem Anwendungszeitstempel (`20260828013725`) statt dem Dateiname-Zeitstempel (`20260826120000`) ein — derselbe Drift-Typ wie am 2026-08-25 bei der Customer & Contact Workflow Migration (siehe dortiger Eintrag). Vor der Korrektur read-only verifiziert: `20260828013725` existierte genau einmal mit korrektem Namen und inhaltlich verifizierten Statements (enthielt `self_contact_id`, `create_quick_capture_case`, `uq_companies_self_contact_individual`), `20260826120000` existierte noch nicht. Per transaktionalem `UPDATE supabase_migrations.schema_migrations SET version = '20260826120000' WHERE version = '20260828013725'` korrigiert (genau eine Zeile), anschließend read-only bestätigt: `20260826120000` existiert genau einmal, `20260828013725` nicht mehr, Migrationshistorie 1:1 deckungsgleich mit den 42 lokalen Repo-Migrationsdateien, keine andere Migration verändert. **Dauerhafte Regel (siehe auch `07-agent-change-checklist.md`):** nach jedem `apply_migration` gegen `nora-crm-prod` sofort `list_migrations` gegen das lokale Dateiname-Zeitstempel-Präfix prüfen, bevor der Release als abgeschlossen gilt — dieser Drift ist jetzt zweimal aufgetreten.
- **DB-Verifikation (read-only):** `companies.self_contact_id` (FK, Partial Unique Index, deferred Constraint-Trigger), alle drei neuen/geänderten Trigger, `is_effective_contact_of_company`/`create_customer_with_contact_core`/`create_customer_with_contact`/`create_quick_capture_case`/`merge_contacts` (korrekte Signaturen, kein altes Overload), Grants (`anon` weiterhin ausgeschlossen, `authenticated`/`service_role` korrekt), `companies_summary` (neue Spalte korrekt ans Ende angehängt) — alle bestätigt. Datenzustand unverändert (14 Kunden, 15 Kontakte, 0 `individual`, 0 leere Namen), keine Testdaten angelegt. Security Advisor: weiterhin exakt die 2 vorbestehenden `SECURITY DEFINER`-View-Findings (`init_state`, `sales_directory`), keine neuen/anderen Findings, ein zusätzlicher (erwarteter) WARN für die neue `create_quick_capture_case`-RPC im selben Muster wie alle bestehenden Write-RPCs.
- **Git Push:** `0c93912137d610f570b5c5fd449573d25160fe86` nach `origin/main` gepusht (vom Nutzer selbst ausgeführt, da der Push aus der Agent-Session per lokaler Tool-Policy blockiert war). Remote-SHA verifiziert identisch zu HEAD.
- **Vercel-Deployment:** `dpl_5UL3NL8J2bTwGCAJrobUNZRQ99NB`, Target production, Status READY, Commit exakt `0c93912137d610f570b5c5fd449573d25160fe86`, Alias `nora.ergart.de` bestätigt.
- **Live-Smoke-Test** (frische Session gegen `nora.ergart.de`, reale eingeloggte Sitzung): keine Runtime-/Console-Fehler; Hotboard/Kundenliste/Kundenakte/Kontakte laden korrekt mit realen Produktionsdaten; Kunden-Show-Tab-Routing bleibt stabil unter `#/kunden/:id/show/contacts` und `.../history` (Regressionstest für den ursprünglichen Tab-Bounce-Bug bestätigt weiterhin grün in Produktion); Quick Capture öffnet, bietet den vorhandenen Hauptansprechpartner eines bestehenden Kunden korrekt an (Effective-Contact-Context-Auflösung gegen echtes Supabase-Backend bestätigt); „Kundenakte für diese Person anlegen"-Button (Self-Contact-Feature) rendert fehlerfrei auf der Kontakt-Edit-Seite; Kundenart-Auswahl zeigt „Firma"/„Privatperson", keine „Unternehmen / Selbstständig"-Reste; keine rohen i18n-Keys oder DB-Fehlermeldungen sichtbar. Keine Production-Testdaten angelegt; ein unbeabsichtigt in `localStorage` des echten Nutzers abgelegter Quick-Capture-Draft (Ergebnis der Lese-Exploration) wurde bereinigt.
- **Post-Deploy-DB-Smoke:** Migration-History, RPC-Erreichbarkeit, `companies_summary`, Datenzustand und Security Advisor erneut read-only bestätigt — unverändert zum Stand direkt nach der Migration.

**Ergebnis: PRODUCTION VERIFIED.** Kein DB-Rollback, kein Frontend-Rollback nötig.

## 2026-08-26 – Self Contact Wave

### Kontext

Drei zusammenhängende Lücken: (1) kein Weg, aus einem bestehenden Kontakt eine Kundenakte zu erzeugen, ohne Personendaten erneut einzutippen; (2) `contacts.is_primary` drückt nur „Hauptansprechpartner" aus, kein Konzept für „diese Person ist selbst der Kunde" — konkretes Beispiel: Freddie Krüger bleibt Ansprechpartner von „Traum und Horror UG" und wird gleichzeitig selbst Kunde (eigene Kundenakte); (3) Schnellerfassung erzeugte Kunde/Kontakt/Vorgang über sequentielle Client-Creates (Teilzustandsrisiko), Schritt 2 „Ansprechpartner" war UX-seitig unklar (Checkbox suggerierte keine Entitätserstellung), und der lokale Draft war nicht pro Benutzer gescoped. Zusätzlich: doppelte „Position"-Anzeige auf `/kontakte/create`, UI-Text „Unternehmen / Selbstständig" sollte zu „Firma" werden.

### Entscheidung

**Datenmodell — `companies.self_contact_id`:** neue Spalte, gerichteter FK company→contact, **entkoppelt von `contacts.company_id`**. Kein Flag auf `contacts` (das hätte entweder die bestehende Arbeitgeberbeziehung überschrieben oder eine Umhäng-Semantik erzwungen). `self_contact_id` drückt aus: „diese natürliche Person repräsentiert diese Kundenakte" — bei `customer_kind='individual'` die Privatkundin/der Privatkunde selbst, bei `customer_kind='business'` die Person hinter der Firma (CRM-Zuordnung, **keine** rechtlich geprüfte Eigentümeraussage). Partial Unique Index **nur** für `customer_kind='individual'` (`uq_companies_self_contact_individual`) — eine Person hat höchstens eine Privatkundenakte, darf aber `self_contact_id` mehrerer Firmen-Kundenakten sein (z. B. mehrere Selbstständigkeiten).

**Individual-Namenssynchronisation:** `contacts` bleibt die kanonische Quelle für Personendaten. Trigger `nora_private.sync_individual_company_name()` hält `companies.name` bei `customer_kind='individual'` serverseitig synchron zum `self_contact_id`-Kontakt (kontrollierte Denormalisierung, keine zweite unabhängige Wahrheit — vgl. Falle 28 in `03-data-model-guardrails.md`). `CompanyInputs.tsx` zeigt `companies.name` im Edit-Modus für Individual+self_contact_id daher read-only mit Link zum Kontakt-Edit.

**Individual-Invariante (transaktionsfinal erzwungen):** `customer_kind='individual' ⇒ self_contact_id IS NOT NULL` wird über eine `DEFERRABLE INITIALLY DEFERRED` Constraint-Trigger (`check_individual_company_has_self_contact_trigger`) am COMMIT geprüft — nicht bei jedem einzelnen INSERT/UPDATE innerhalb der RPC-Transaktion, da der Core-Helper Company zuerst anlegt und `self_contact_id` erst danach setzt. Der Trigger **re-queried die aktuelle Zeile** statt den erfassten NEW-Werten zu vertrauen (bekannte Postgres-Falle bei deferred Triggers: NEW/OLD sind zum Zeitpunkt des ursprünglichen Statements eingefroren, nicht zum Zeitpunkt der verzögerten Prüfung). Fires nur bei `INSERT` sowie `UPDATE OF customer_kind, self_contact_id` — nicht bei jedem Feld-Update, damit ein (aktuell theoretischer) Altbestand ohne auflösbaren Kontakt nicht rückwirkend für unrelated Edits blockiert wird. **Bekannte Restlücke:** ein hypothetischer direkter `UPDATE companies` außerhalb der RPCs, der `customer_kind` auf `individual` setzt, ohne `self_contact_id` zu setzen, würde erst am Transaktionsende abgelehnt — für alle App-Schreibpfade (RPCs) ausreichend, aber kein Ersatz für eine allgemeine Datenintegritätsgarantie gegen jeden denkbaren SQL-Zugriff.

**Self-Contact-Delete-Guard:** Löschen eines Kontakts, der `self_contact_id` einer **individuellen** Kundenakte ist, wird per Trigger blockiert (`guard_self_contact_delete_trigger`) — sonst würde der Namens-Sync-Anker verwaisen. Für `customer_kind='business'` bleibt die bestehende `ON DELETE SET NULL`-FK-Aktion ausreichend (Firmenname ist unabhängig).

**merge_contacts:** repointed `companies.self_contact_id` vom Loser- auf den Winner-Kontakt, bevor der Loser gelöscht wird (Schritt 1b, analog zur bestehenden Task-Reassignment-Logik) — sonst hätte ein Contact-Merge denselben Namens-Sync-Anker verwaist bzw. wäre am neuen Delete-Guard gescheitert.

**Effective Contact Context — eine zentrale Regel:** `nora_private.is_effective_contact_of_company(contact_id, company_id)` (SQL, `nora_private`) und `domain/customerContactContext.ts::resolveCustomerContacts()` (TS, framework-frei) sind die **einzigen** Stellen, die „gehört dieser Kontakt zu dieser Kundenakte" beantworten: `contact.company_id = company.id` ODER `company.self_contact_id = contact.id`. Genutzt von `enforce_task_company_context()` (Unified Tasks Wave erweitert um den Self-Contact-Fall), `create_quick_capture_case()` (Validierung gegen stilles Umhängen), CompanyShow-Kontakte-Tab, Aufgaben-Kontaktauswahl und Quick-Capture-Schritt-2 — keine parallele Ad-hoc-Implementierung pro Screen. Drei Rollen bleiben bewusst getrennt: `selfContact` (unabhängig von `company_id`), `explicitPrimaryContact` (nur gültig, wenn `is_primary=true` UND `company_id` tatsächlich passt — ein `is_primary`-Flag bei abweichendem `company_id` ist für diese Kundenakte bedeutungslos), `preferredContact` (explicitPrimaryContact, sonst selfContact).

**`companies_summary.nb_contacts`:** erweitert um `+1`, wenn `self_contact_id` gesetzt und dessen `company_id` nicht bereits dieser Kundenakte entspricht (kein Doppelzählen) — hält die Zahl konsistent mit dem, was der Kontakte-Tab tatsächlich anzeigt (inkl. `SelfContactCard`-Fallback in `CompanyShow.tsx`, wenn der Self Contact nicht Teil der `company_id`-gefilterten Liste ist).

**RPC-Refaktor — gemeinsamer Core, keine Duplikation:** `nora_private.create_customer_with_contact_core(p_company, p_existing_company_id, p_contact, p_existing_contact_id, p_self_contact_id, p_mark_self, p_contact_is_primary)` ist die einzige Implementierung der Kunde+Kontakt-Erzeugungslogik, genutzt von sowohl `public.create_customer_with_contact` (erweitert um `p_self_contact_id`/`p_mark_self`, PostgREST-rückwärtskompatibel — alte 3-Positionsargument-Aufrufer laufen unverändert dank Defaults auf den neuen Parametern; alte 3-Arg-Funktionssignatur explizit `drop function` statt als Overload stehen gelassen, um PostgREST-Mehrdeutigkeit zu vermeiden) als auch der neuen `public.create_quick_capture_case`. **Gefundener und behobener Korrektheitsfehler während der Umsetzung:** der ursprüngliche Entwurf hätte bei einem neuen Kontakt (`p_contact`) für eine bereits bestehende Kundenakte hart `is_primary=true` gesetzt — das verletzt `uq_contacts_one_primary_per_company`, sobald diese Kundenakte schon einen anderen Hauptansprechpartner hat (genau der Quick-Capture-Fall „zweiter Kontakt für bestehenden Kunden"). Fix: `p_contact_is_primary` (Default `true`, passend zum bisherigen Verhalten bei brandneuen Firmen ohne bestehende Kontakte) steuert das explizit; bei `true` wird ein bestehender Primary zuerst demotet.

**`create_quick_capture_case` — zwei Kundenpfade, kein Duplicate-Company-Risiko:** genau einer von `p_company` (neu) / `p_existing_company_id` (bestehend, kein Insert) ist erlaubt. Bei bestehendem Kunde **und** bestehendem Kontakt wird serverseitig `is_effective_contact_of_company()` geprüft — nicht erfüllt → Ablehnung, niemals stilles Umhängen. Ist die Kombination bereits effektiv, wird der Kontakt nur **referenziert** (kein `contacts`-UPDATE, kein `is_primary`-Eingriff) — die `p_existing_contact_id`-Semantik von `create_customer_with_contact` („reassign + force primary", korrekt für CustomerCreateForms „bestehenden Kontakt zuordnen" bei einer neuen Firma) passt hier nicht, da das Auswählen eines vorhandenen Kontakts einer bereits etablierten Kundenakte niemand befördern/degradieren soll. Aufgabe bleibt bewusst außerhalb der Transaktion (separater Best-Effort-Schritt, bestehende `taskFailed`-Notice-Semantik unverändert) — Kunde+Kontakt+Vorgang sind die eine atomare Einheit, deren Teil-Fehlschlag laut Auftrag zu vermeiden war.

**Application-/Domain-Layering (additiv, keine Big-Bang-Architektur):** `domain/customerContactContext.ts` (framework-frei) und `application/commands/{createCustomerFromContact,createQuickCaptureCase}.ts` sind die ersten Nora-Application-Command-Vertical-Slices. UI-Komponenten (`ContactToCustomerDialog.tsx`, `QuickCaptureDialog.tsx`) rufen ausschließlich diese Commands auf, keine direkte RPC-/dataProvider-Orchestrierung mehr. `operations/` (Operation Manager, Catalog, `x-nora-operation-id`) bleibt unverändert die bestehende Execution-/Korrelations-Infrastruktur-Grenze — **nicht** als bereits vollständige Hexagonal-Port-Schicht misszuverstehen. Kein Event Bus, kein CQRS-Framework, keine Idempotency-Infrastruktur, kein Intent-/MCP-Layer — diese Wave liefert nur die zwei konkret gebrauchten Commands.

**Quick Capture Schritt 2 (UX):** Checkbox „Neuen Ansprechpartner erfassen" ersetzt durch einen expliziten Tri-State (`existing` / `new` / `none`, `QuickCaptureContactMode`) mit vier klaren Optionen (Hauptansprechpartner verwenden — vorausgewählt hervorgehoben über `resolveCustomerContacts`, anderen vorhandenen wählen, neuen anlegen, ohne fortfahren). Eine verbleibende Checkbox bedeutet nur noch „Als Hauptansprechpartner festlegen" (mit Hilfetext) für den Fall eines neuen Kontakts. `customer_kind`/Self-Unterscheidung wird in Quick Capture **nicht** eingeführt (nicht beauftragt, Quick Capture kennt weiterhin nur einen Firmenmodus) — als offene Folgearbeit dokumentiert.

**Draft-Härtung:** Storage-Key jetzt pro Benutzer (`nora-quick-capture-draft:{identity.id}`), Schema-Version + `updatedAt` mit 7-Tage-Staleness-Schwelle (inkompatible/veraltete Drafts werden wie „kein Draft" behandelt statt einen Laufzeitfehler zu riskieren oder überraschend alte Daten wiederherzustellen), zusätzlich zum bestehenden Save-on-Close ein debounced Autosave (~500 ms) sowie ein synchroner Flush bei `pagehide`/`visibilitychange`. Der alte globale Key (`nora-quick-capture-draft`, ohne Benutzer-Scope) wird beim ersten Laden entfernt — **niemals** einem Benutzer zugeordnet oder migriert, da die historische Eigentümerschaft auf einem geteilten Rechner/Profil nicht bestimmbar ist.

**Position-Fix (`ContactInputs.tsx`):** Root Cause war eine Sektionsüberschrift, deren Text zufällig mit dem Auto-Label des einzigen enthaltenen Felds (`title`) übereinstimmte (beides „Position" im Deutschen). Fix entfernt die **Überschrift**, nicht das Feld-Label — das Feld behält seinen echten Accessible Name aus Accessibility-Gründen.

**„Firma" statt „Unternehmen / Selbstständig":** reiner UI-Text (`customerKind.ts`, `germanCrmMessages.ts`), interner Wert `customer_kind='business'` unverändert.

### Begründung

Ein Kunde-Datensatz und die Person, die ihn repräsentiert, sind zwei unterschiedliche Konzepte, die bisher nur über `contacts.company_id` (Arbeitgeber-Beziehung) und `is_primary` (Hauptansprechpartner-Rolle) ausgedrückt werden konnten — beide reichen nicht für „diese Person ist selbst der Kunde", ohne dabei zwangsläufig entweder eine bestehende Arbeitgeberbeziehung zu überschreiben oder dieselbe Person doppelt anzulegen. Eine gerichtete, von `contacts.company_id` entkoppelte Spalte auf `companies` löst das additiv, ohne die bestehende `party/person/organization`-Ablehnung (Customer & Contact Workflow Wave) zu revidieren. Eine zentrale serverseitige Regel (`is_effective_contact_of_company`) statt mehrfacher Ad-hoc-Prüfungen verhindert, dass Task-Validierung und Quick-Capture-Validierung divergieren.

### Alternativen / verworfene Ansätze

- **Flag auf `contacts` (`is_customer_self`) statt `companies.self_contact_id`:** verworfen. Hätte entweder `contacts.company_id` umhängen müssen (zerstört die bestehende Arbeitgeberbeziehung) oder wäre bedeutungslos gewesen, solange der Kontakt nicht auch `company_id` auf dieselbe Kundenakte gesetzt hätte.
- **Globales `UNIQUE(companies.self_contact_id)`:** verworfen — hätte verhindert, dass dieselbe Person `self_contact_id` mehrerer Firmen-Kundenakten ist (z. B. mehrere Selbstständigkeiten). Partial Unique nur für `customer_kind='individual'`.
- **`p_existing_contact_id`-Semantik („reassign + force primary") auch für Quick Capture bei bestehendem Kunde+Kontakt:** verworfen zugunsten eines reinen Referenz-Pfads (`v_reference_contact_id`) — Auswählen eines vorhandenen Kontakts einer etablierten Kundenakte darf die Hauptansprechpartner-Zuordnung nicht implizit verändern.
- **Sofortige (nicht deferred) CHECK-Constraint für die Individual-Invariante:** verworfen — hätte den bestehenden RPC-Ablauf (Company zuerst, `self_contact_id` erst danach) blockiert.

### Verifiziert

- `supabase/tests/customer_contact_workflow_verification.sql`: Freddie-Szenario (self_contact_id ändert `contacts.company_id`/`is_primary` nicht), Partial-Unique nur individual (Cross-Business-self_contact_id erlaubt, zweite Privatakte abgelehnt), Individual-Namens-Sync, Self-Contact-Delete-Guard (individual blockiert, business `SET NULL`), `merge_contacts`-Self-Contact-Repointing, `create_quick_capture_case` (neuer Kunde, bestehender Kunde ohne Duplicate-Insert, bestehender Kunde ohne Kontakt, Fremd-Kontakt-Ablehnung, Primary-Konflikt-Regression bei zweitem Kontakt für bestehenden Kunden mit/ohne `p_contact_is_primary`), PostgREST-Rückwärtskompatibilität (alter 3-Positionsargument-Aufruf), viewer-Ablehnung — grün gegen `npx supabase db reset --local`.
- `supabase/tests/task_customer_context_verification.sql`: Self-Contact als gültiger Task-Kundenkontext (Aufgabe für Freddie im Kontext seiner eigenen Privatkundenakte), unrelated-Firma weiterhin abgelehnt, historische Task-Semantik unverändert — grün.
- `supabase/tests/crm_audit_verification.sql`: unverändert grün (Audit-Erweiterung um `self_contact_id`-Tracking bricht bestehende Audit-Erwartungen nicht).
- Vollständige Vitest-Suite (66 Dateien / 465 Tests, 1 vorbestehend übersprungen), `npm run typecheck`, `npm run build` — grün. Neue Tests: `domain/customerContactContext.test.ts` (Freddie-Szenario, Primary/Preferred-Trennung), `CompanyShow.test.tsx` (Self-Contact-Card bei abweichendem `company_id`), `ContactCreate.test.tsx` (Position-Regression inkl. a11y-Label), `quickCaptureDraft.test.ts` (Scoping, Schema-Version, Staleness, Legacy-Key-Purge), `quickCaptureValidation.test.ts` (expliziter Kontakt-Entscheid).
- Live-Browser-Verifikation (`npm run dev:demo`): „Firma"-Label auf `/kunden/create` bestätigt; „Position" auf `/kontakte/create` erscheint nachweislich nur einmal; Kontakt→Kundenakte-Dialog (Privatperson und Firma) legt erfolgreich eine Kundenakte an, ohne `contacts.company_id`/`is_primary` des bestehenden Kontakts zu verändern; während der Live-Verifikation wurde der `p_contact_is_primary`-Fehler sowie ein fehlendes `sales_id` auf neu erzeugten Kundenakten entdeckt und behoben (siehe oben). **Nicht abschließend live verifiziert:** die `SelfContactCard`-Anzeige im Kontakte-Tab zeigte in der manuellen FakeRest-Demo-Session ein nicht reproduzierbares Rendering-Verhalten (vermutlich Session-/HMR-Zustand nach vielen aufeinanderfolgenden Hot-Reloads) — die isolierte Komponenten-Testumgebung (`CompanyShow.test.tsx`) bestätigt jedoch deterministisch korrektes Verhalten für exakt dasselbe Szenario. Empfehlung: bei nächster Gelegenheit einmal in einer frischen Browser-Session (kein Dev-Server-HMR-Verlauf) gegenzuprüfen.

## 2026-08-25 – Unified Tasks Wave

### Kontext

Aufgaben (`tasks`) hingen bisher ausschließlich an `contact_id` (`NOT NULL`). Dadurch gab es keine kundenbezogene Aufgabenübersicht auf der Kundenakte, und eine reine Kundenaufgabe ohne Ansprechpartner (z. B. „Rechnung prüfen") war nicht abbildbar. Details der Analyse: `17-known-issues-and-planned-waves.md` (vorherige Fassung, jetzt umgesetzt).

### Entscheidung

- **Zieldatenmodell:** `tasks.company_id` (nullable) zusätzlich zu weiterhin vorhandenem, jetzt nullable `tasks.contact_id`. CHECK-Constraint `tasks_company_or_contact_check`: mindestens eines von beiden muss gesetzt sein. Variante A aus der vorherigen Analyse — keine parallele `task_links`-Architektur.
- **Historische Semantik (zentrale Produktentscheidung):** `tasks.company_id` ist der Kundenkontext einer Aufgabe **zum Zeitpunkt ihrer Erstellung bzw. letzten bewussten Kontextänderung** und wird **nicht automatisch nachgeführt**, wenn der verknüpfte Kontakt später einem anderen Kunden zugeordnet wird. Begründung: Nora legt Wert auf nachvollziehbare Kundenhistorie — der Kontext einer Aufgabe soll dokumentieren, für welchen Kunden und mit welchem damaligen Ansprechpartner sie entstanden ist, auch wenn sich die heutige Zuordnung geändert hat. Kein Trigger/Cascade-Update synchronisiert `tasks.company_id` bei einem späteren `contacts.company_id`-Wechsel.
- **Serverseitige Durchsetzung:** BEFORE-INSERT-OR-UPDATE-Trigger `nora_private.enforce_task_company_context()` auf `tasks` — ein Trigger statt einer neuen RPC, weil Task-Create/-Update bereits über normale `dataProvider.create`/`update`-Pfade läuft (kein bestehendes Task-RPC-Muster wie bei `create_customer_with_contact`). Der Trigger greift nur, wenn `contact_id`/`company_id` tatsächlich gesetzt oder geändert werden — nie bei einem reinen Feld-Update (Text/Fälligkeit/Erledigt/Zuständigkeit). Bei gesetztem `contact_id` wird `company_id` serverseitig aus `contacts.company_id` abgeleitet (falls nicht angegeben) oder validiert (Client darf keine inkonsistente Kombination erzeugen).
- **Delete-Semantik:** `tasks.contact_id` FK von `ON DELETE CASCADE` auf `ON DELETE SET NULL` geändert — eine Aufgabe mit Kundenkontext darf einen gelöschten Kontakt überleben. Ein neuer `BEFORE DELETE`-Trigger auf `contacts` (`nora_private.delete_contact_only_tasks()`) löscht vorab genau die Aufgaben, die sonst nach dem `SET NULL` gegen den CHECK-Constraint verstoßen würden (reine Kontakt-Aufgaben ohne Kundenkontext) — bewahrt das bisherige Cascade-Verhalten für diesen Fall. `tasks.company_id` FK bleibt `ON DELETE CASCADE` (konsistent mit `contacts`/`deals`).
- **`merge_contacts`:** Die Massenumhängung von Aufgaben beim Contact-Merge (`UPDATE tasks SET contact_id = winner_id ...`) ist Identitätskonsolidierung, kein bewusster Kontextwechsel durch eine Mitarbeiterin — sie überspringt die Kontext-Validierung explizit über die Session-Variable `nora.skip_task_context_check` (Muster analog zu `nora.operation_id`). FakeRest bildet dasselbe über ein Modul-Flag (`taskContextCheck.ts`) nach.
- **Audit:** `audit_task_changes` erfasst jetzt auch `company_id`-Änderungen; `audit_task_row` liest den Kundenkontext direkt aus `tasks.company_id` statt ihn live über `contacts.company_id` zu joinen (spiegelt die historische Aufgabe, nicht die heutige Kontakt-Zuordnung).
- **UI:** Neuer Tab „Aufgaben" auf `/kunden/:id/show` (Desktop), zeigt alle Aufgaben mit `company_id = aktueller Kunde` unabhängig vom Kontakt. „+ Aufgabe" auf der Kundenakte schlägt den Hauptansprechpartner vor (entfernbar, änderbar, nur Kontakte dieses Kunden). Wenn der historische `task.company_id` vom heutigen `contact.company_id` abweicht, zeigt `Task.tsx` eine dezente Zusatzinfo („– heute bei %{company}" / „– heute ohne Kunden") statt eines Fehlers.

### Verifiziert

- `supabase/tests/task_customer_context_verification.sql`: Schema, Backfill, alle Kombinationen (Kunde+Kontakt / nur Kunde / nur Kontakt / weder noch / falsche Kombination), historische Semantik über Contact-Wechsel, Contact-/Company-Delete-Semantik, `merge_contacts`, Rollen (viewer/office/admin) — grün gegen `npx supabase db reset --local`.
- Vollständige Vitest-Suite (Unit + FakeRest + Browser/Component) grün; `npm run typecheck`/`npm run build` grün.
- Live-Browser-Verifikation gegen echtes lokales Postgres (Szenarien 1–4 aus dem Auftrag): Kunde+Hauptansprechpartner-Aufgabe erscheint auf beiden Akten und ist dort synchron erledigt; reine Kundenaufgabe ohne künstlichen Kontakt; Aufgabe für unzugeordneten Kontakt; historische Stabilität nach Kontaktwechsel inkl. sichtbarer „heute bei anderem Kunden"-Notiz und weiterhin funktionierendem Erledigt-Toggle.

## 2026-08-25 – Repo/Produktions-Drift bei `nora_core_indexes` unabhängig bestätigt

### Kontext

Beim lokalen Testen der Customer & Contact Workflow Wave (`npx supabase db reset --local` gegen ein frisch verfügbares Docker) wurde read-only gegen `nora-crm-prod` festgestellt, dass Migration `20260815120000_nora_core_indexes` dort bereits angewendet ist, aber zu diesem Zeitpunkt lokal weder als Migrationsdatei noch im `main`-Branch vorlag. Aus den tatsächlichen Index-Definitionen auf Prod wurde eine Rekonstruktion vorbereitet.

### Auflösung

Beim anschließenden `git push` stellte sich heraus, dass die Migration bereits **korrekt und vollständiger** über PR #1 (`chore/foundation-performance-hardening`, Commit `774a6c46`) in `main` gelandet war — siehe „2026-08-15 – Kernindizes und Bundle-Budget" unten. Die eigene Rekonstruktion wurde beim Rebase verworfen, die autoritative Version aus PR #1 übernommen; doppelte Index-Deklarationen in `supabase/schemas/01_tables.sql` (durch den vorübergehenden Parallelstand entstanden) wurden bereinigt.

### Begründung

Zwei unabhängige Diagnosen desselben Drifts bestätigen den Befund, aber nur eine Version darf ins Repo — Duplikate in der deklarativen Schema-Datei hätten `create index` ohne `if not exists` zum Scheitern gebracht.

## 2026-08-25 – Customer & Contact Workflow Wave

### Kontext

Kunden- und Ansprechpartner-Erfassung war uneinheitlich: `/kunden/create` nutzte
reines `CreateBase` (kein atomarer Kunde+Ansprechpartner-Write), es gab kein
Konzept für Hauptansprechpartner, keine Unterscheidung Unternehmen/Selbstständig
vs. Privatperson, `companies` hatte nur ein einzelnes `phone_number`-Feld und
keine E-Mail, und die LinkedIn-Validierung akzeptierte ausschließlich
`linkedin.com`-URLs.

### Entscheidung

- **Kundenart:** neue Spalte `companies.customer_kind` (`business` | `individual`,
  CHECK-Constraint). Treibt Formularmodus in `CompanyInputs`
  (`/kunden/create` und `/kunden/:id/edit` teilen sich diese Komponente).
  Ersetzt **nicht** `sector` — `sector` bleibt die lose Kundentyp-Klassifikation
  (Hausverwaltung, Gewerbe, …), `customer_kind` ist die grundlegende binäre
  Unterscheidung, die die UI-Verzweigung treibt (Falle 3 aus `03-data-model-guardrails.md`
  bleibt beachtet: keine Doppelklassifikation über Tags).
- **Hauptansprechpartner:** neue Spalte `contacts.is_primary boolean`. Max. 1 pro
  `company_id` über Partial Unique Index `uq_contacts_one_primary_per_company`
  (DB-Ebene, nicht nur UI). Atomarer Wechsel über RPC `set_primary_contact`
  (unsetzt alten, setzt neuen in einer Transaktion).
- **Links generalisiert:** neue Spalten `companies.links_jsonb` /
  `contacts.links_jsonb` (`{url, type, label?}`, `type` ∈ website/linkedin/
  instagram/facebook/google/portal/other). Ersetzt die LinkedIn-only-Validierung
  (`isLinkedInUrl.ts`, entfernt) als UI-Quelle. **Bestandsdaten nicht verloren:**
  `linkedin_url` (companies + contacts), `companies.website`,
  `companies.context_links` werden per Migration in `links_jsonb` kopiert; die
  alten Spalten bleiben als deprecated Legacy-Felder in der DB bestehen
  (Cleanup-Kandidat für eine spätere Welle, siehe Abschnitt „Offene Punkte" im
  Abschlussbericht).
- **Firmen-Kontaktmethoden:** neue Spalten `companies.email_jsonb` /
  `companies.phone_jsonb` — gleiche Struktur wie `contacts.email_jsonb` /
  `contacts.phone_jsonb` (Typen erweitert um `Mobile`/`Central`/`Direct`,
  vorhandene `Work`/`Home`/`Other`-Werte bleiben gültig). `companies.phone_number`
  bleibt als deprecated Spiegel bestehen, wird per Migration in `phone_jsonb`
  (Typ „Central") kopiert.
- **Atomare Operation statt Frontend-Copy/Paste:** neue RPC
  `create_customer_with_contact(p_company jsonb, p_contact jsonb, p_existing_contact_id bigint)`
  — SECURITY DEFINER, `can_write()`-gated, ein DB-Write für Kunde + optional
  neuer/bestehender Ansprechpartner (als Hauptansprechpartner markiert). Kein
  Teilzustand bei Fehler (ein Postgres-Funktionskörper = eine Transaktion).
  `customer_number`/`case_number` bleiben serverseitig vergeben (bestehende
  Trigger, unverändert). Audit läuft automatisch über die bestehenden
  `audit_company_row`/`audit_contact_row`-INSERT-Trigger — keine manuellen
  Audit-Writes in der RPC nötig.
- **Referenzimplementierung `/kunden/create`:** `CustomerCreateForm.tsx` ersetzt
  `CreateBase` durch `Form` mit eigenem `onSubmit`, der
  `dataProvider.createCustomerWithContact(...)` aufruft (Operation Manager +
  Error Observatory über `customer.createWithContact` im Operation Catalog,
  analog `deal.update`). Ansprechpartner-Erfassung über vier Modi: kein / neu /
  Unternehmer ist selbst Ansprechpartner (mit „Angaben übernehmen"-Button,
  kopiert Firmen-Kontaktdaten in die Ansprechpartner-Felder) / bestehenden
  zuordnen. Bei Privatperson entfällt der Modus-Wähler: `CompanyInputs` blendet
  das Pflichtfeld „Kundenname" im Create-Modus aus (`buildCustomerCreatePayload`
  leitet den Namen aus Vor-/Nachname ab), Edit-Modus zeigt es weiterhin
  (dort ist `companies.name` die einzige Quelle, keine virtuellen
  Vor-/Nachname-Felder).
- **`/kunden/:id/edit` und `/kontakte/*` teilen dieselben Bausteine:**
  `CompanyInputs` (Create + Edit), `misc/linksModel.ts` (Link-Typen, generische
  URL-Validierung, Cleanup), `misc/contactMethodTypes.ts` (E-Mail-/Telefon-Typen,
  von Companies und Contacts genutzt) — keine dreifache Implementierung.
- **Operation Catalog erweitert** um `customer.createWithContact` und
  `contact.setPrimary` (analog bestehender `deal.update`-Vertical-Slice);
  RPC-Aufrufe tragen `x-nora-operation-id` über `.setHeader()` (Supabase-Client),
  FakeRest-Demo-Implementierung nutzt denselben Operation Manager ohne
  RPC-Header-Mechanik.
- **Schnellerfassung (Quick Capture) unverändert in dieser Welle** — bleibt bei
  sequentiellen Creates (v0.3e-Stand); Umstellung auf dieselbe RPC ist als
  Folge-Welle dokumentiert (siehe Abschlussbericht, „Offene Punkte").

### Begründung

Ein Kunde ist entweder ein Unternehmen/Selbstständiger oder eine Privatperson —
diese Unterscheidung bestimmt, welche Felder eine Büromitarbeiterin sieht und ob
Personendaten einmal oder zweimal erfasst werden müssen. Ein DB-Constraint für
„max. 1 Hauptansprechpartner" verhindert inkonsistente Zustände unabhängig vom
Frontend. Eine RPC statt mehrerer Client-Creates verhindert die aus der
Schnellerfassung bekannte Teilzustand-Falle (Kunde angelegt, Kontakt-Erstellung
schlägt fehl). Das generische Link-Modell vermeidet eine LinkedIn-Sonderrolle,
ohne Bestandsdaten zu verlieren.

### Alternativen / verworfene Ansätze

- **Neumodellierung als `party`/`person`/`organization`** (generisches CRM-Partei-Modell,
  bei dem Kunde und Ansprechpartner dieselbe zugrunde liegende Entität wären):
  verworfen. `companies` und `contacts` bleiben getrennte Tabellen. Ein
  großer Umbau hätte DataProvider, RLS, Audit-Trigger, Nummernvergabe,
  Checklisten-FKs und sämtliche bestehende UI gleichzeitig angefasst — außer
  Verhältnis zum tatsächlichen fachlichen Bedarf (einmalige Personendaten-
  Erfassung), der sich additiv über `customer_kind` + eine Anlage-RPC lösen
  ließ. Entspricht der bestehenden Leitlinie „keine Resource-Namen blind
  umbenennen" (`03-data-model-guardrails.md`).
- **Selbstständige als eigene dritte `customer_kind`-Ausprägung** (statt
  `business`): verworfen. Fachlich verhalten sich Selbstständige wie
  Unternehmen (eigene Kundenakte, eigene Geschäftskontaktdaten, optional
  eigene Person als Ansprechpartner) — eine dritte Ausprägung hätte in JEDEM
  UI-Verzweigungspunkt (`CompanyInputs`, `CustomerContactCaptureInputs`,
  `buildCustomerCreatePayload`) dieselbe Business-Logik wie `business` noch
  einmal abgebildet, ohne fachlichen Mehrwert. Der „Unternehmer ist selbst
  Ansprechpartner"-Modus mit „Angaben übernehmen" deckt den Anwendungsfall
  innerhalb von `business` ab.
- **Hauptansprechpartner als Flag direkt am Kunden** (`companies.primary_contact_id`
  statt `contacts.is_primary`): verworfen zugunsten des Felds auf `contacts`.
  Ein FK von `companies` auf `contacts` hätte einen zirkulären FK-Zyklus mit
  `contacts.company_id` erzeugt und wäre beim Löschen/Entkoppeln eines
  Kontakts fehleranfälliger als ein Flag mit Partial Unique Index.

### Folgearbeiten (nicht Teil dieser Wave)

Siehe `17-known-issues-and-planned-waves.md`: Schnellerfassung auf
`create_customer_with_contact` umstellen, Legacy-Spalten-Cleanup nach
Übergangszeit, Aufgabenmodell-Vereinheitlichung (separate, noch nicht
designte Domain-Wave — kein Zusammenhang mit dieser Entscheidung, aber
gleicher Live-Test-Zyklus deckte den Bedarf auf).

## 2026-08-25 – Erste lokale Postgres-Verifikation der Customer & Contact Workflow Migration

### Kontext

Die Customer & Contact Workflow Wave wurde zunächst ohne lokal verfügbares
Docker entwickelt (Migration nur gelesen, nicht ausgeführt). Nach
Docker-Verfügbarkeit wurde `npx supabase db reset --local` erstmals gegen
echtes Postgres ausgeführt.

### Befund und Fix

`20260825120000_customer_contact_workflow.sql` schlug beim ersten Reset fehl:

```
ERROR: cannot change name of view column "email_fts" to "links_jsonb" (SQLSTATE 42P16)
```

**Ursache:** `create or replace view` erlaubt ausschließlich das Anhängen
neuer Spalten **ans Ende** der `select`-Liste — nicht das Einfügen an
beliebiger Position. Die neuen Spalten `links_jsonb`/`is_primary` für
`contacts_summary` waren vor den berechneten Spalten `email_fts`/`phone_fts`
eingefügt, wodurch Postgres deren Position verschob und dies als
Spaltenumbenennung interpretierte.

**Fix:** Neue View-Spalten strikt ans Ende der `select`-Liste verschoben
(in Migration und `supabase/schemas/03_views.sql`). Nach dem Fix lief
`db reset --local` fehlerfrei durch.

**Regel für künftige Änderungen:** Beim Erweitern von `companies_summary`
oder `contacts_summary` (oder jeder anderen View) neue Spalten **immer**
ans Ende der `select`-Liste anhängen, nie dazwischen einfügen — sonst
schlägt `create or replace view` mit genau diesem Fehler fehl.

### Verifikation

Nach dem Fix: kompletter `db reset --local` erfolgreich; neuer
SQL-Verifikationstest `supabase/tests/customer_contact_workflow_verification.sql`
ergänzt und grün (Schema-Form, RPC-Grants `anon` ausgeschlossen, Unternehmen +
neuer/bestehender Kontakt, Privatperson, Hauptansprechpartner-Wechsel,
DB-seitige Ablehnung eines zweiten Hauptansprechpartners, ungültiger
`customer_kind`, `viewer`-Rolle von der RPC selbst abgelehnt). `npm run
typecheck`, `npx vitest run` (434 Tests) und `npm run build` liefen
zusätzlich erfolgreich.

## 2026-08-25 – Customer & Contact Workflow Migration auf Produktion angewendet

### Kontext

Nach Abschluss der Customer & Contact Workflow Wave (siehe oben) und nach
Verfügbarkeit von Docker wurde die Migration erstmals lokal gegen echtes
Postgres verifiziert (siehe Eintrag unten) und anschließend — auf
ausdrückliche Anweisung — gegen die Produktionsdatenbank angewendet.

### Ablauf und Verifikation (read-only Prüfung gegen `nora-crm-prod`,
Supabase-Projekt `kixxroxtfzbcbzctohex`)

- `git push` löste einen Merge-Konflikt mit `origin/main` aus: PR #1
  (`chore/foundation-performance-hardening`, Commit `774a6c46`) hatte
  zwischenzeitlich dieselbe fehlende `nora_core_indexes`-Migration bereits
  korrekt committed (siehe Eintrag „Repo/Produktions-Drift … unabhängig
  bestätigt" oben). Per Rebase aufgelöst, autoritative Version übernommen.
- `20260825120000_customer_contact_workflow.sql` per Supabase-MCP
  `apply_migration` gegen `nora-crm-prod` angewendet.
- **Migration-Bookkeeping-Drift beim Apply erkannt und korrigiert:** Die
  MCP-Aktion trug die Migration zunächst mit dem Anwendungszeitstempel
  (`20260825120416`) statt dem Dateiname-Zeitstempel (`20260825120000`) in
  `supabase_migrations.schema_migrations` ein — hätte exakt dieselbe
  Drift-Falle wie `nora_core_indexes` reproduziert. Per `UPDATE` auf den
  korrekten Zeitstempel korrigiert; diese Korrektur selbst erzeugte einen
  weiteren Bookkeeping-Eintrag (`20260825120612`), dafür wurde eine leere
  Migrationsdatei `20260825120612_nora_migration_bookkeeping_cleanup.sql`
  im Repo nachgezogen, damit lokale und Produktions-Historie wieder
  deckungsgleich sind.
- Nach Abschluss read-only verifiziert: Migrationshistorie auf Prod
  identisch zu `supabase/migrations/`; `companies.customer_kind` /
  `links_jsonb` / `email_jsonb` / `phone_jsonb`, `contacts.is_primary` /
  `links_jsonb`, RPCs `create_customer_with_contact` / `set_primary_contact`
  vorhanden.
- Frontend: Vercel-Projekt `nora-crm` (Domain `nora.ergart.de`) deployte
  automatisch nach `git push`; Deployment `dpl_hJp4Bn4tuSaDP4nLGevLd5hNT6No`,
  Commit `e3f18f7f`, Status READY, Target production — verifiziert per
  Vercel-MCP.
- Produktionsdaten sind zum Prüfzeitpunkt real (14 Kunden, 16 Kontakte, 6
  Vorgänge, 3 Nutzer) — keine Testdaten wurden auf Prod angelegt; die
  verhaltensbasierte RPC-Verifikation mit Fake-Nutzern lief ausschließlich
  lokal gegen das Docker-Postgres.

### Begründung

Explizite Nutzeranweisung nach vorheriger Risikobewertung (Datenmenge,
Bestandsdatenkompatibilität, RLS-/RPC-Voraussetzungen bereits vorhanden).
Read-only-Verifikation vor und nach jedem Schritt verhindert, dass ein
stiller Fehlschlag unbemerkt bleibt.

## 2026-08-10 – Foundation Wave 3: Error Observatory Core

### Kontext

Wave 2 liefert `runtimeErrorId` nur session-ephemer. Nora braucht dauerhafte,
sichere technische Fehlerbeobachtung getrennt vom Business-Audit.
Stabilization Gate 2/2b (DealEdit/TaskEdit Portal Form Owner) lag dazwischen
und bleibt unverändert.

### Entscheidung

- Neue Tabelle `public.operation_errors` (nicht `audit_events`).
- Soft-Referenzen (`resource_id` text, keine FK auf deals/companies) —
  Fehler überlebt Archiv/Löschung.
- `operation_id uuid NOT NULL` + UNIQUE: jeder persistierte Fehler korreliert
  zu genau einem Manager-`execute()`-Versuch. Keine nullable „generic JS“-Pfade
  in dieser Welle.
- `actor_user_id uuid NOT NULL` ausschließlich aus `safe_auth_uid()`;
  unauthentifiziert → Exception, keine anonymen Rows.
- `public_ref` serverseitig: `NORA-E` + 8 Crockford-Zeichen, UNIQUE, Retry bei
  Kollision (kein Overwrite).
- Keine Client-INSERTs; Writes nur via `record_operation_error` /
  `report_operation_error` (SECURITY DEFINER, `search_path=''`).
  EXECUTE: `REVOKE` von PUBLIC/anon, `GRANT` nur authenticated (+ service_role).
- `technical_context` Allowlist (Keys + Values): `http_status`, `postgrest_code`,
  `sqlstate`, `edge_function`.
- `report_operation_error`: nur eigener Actor; idempotent; bei beiden
  Identifiern müssen sie dieselbe Row treffen (kein loses OR).
- Vertikaler Slice: `deal.update` Fehler → Manager error sofort → best-effort
  Record **non-blocking** → `persistentErrorId` / `publicErrorRef` nach Enrichment.
  Observatory-Ausfall ersetzt niemals den Business-Fehler und blockiert ihn nicht.
- Frontend-Version: `VITE_NORA_FRONTEND_VERSION` aus Vercel/Git SHA.
- Keine Feedback-UI, keine Outbox, keine Auto-Retention-Löschung.

### Begründung

Audit = erfolgreiche Änderungen; Observatory = fehlgeschlagene fachliche
Operationen. Trennung verhindert Vermischung von Compliance- und Diagnose-Daten.

## 2026-08-10 – Stabilization Gate 2b: TaskEdit Portal Form Owner

### Kontext

Gleicher Form-Ownership-Bug wie Gate 2 in `TaskEdit`: Form außerhalb des
Radix-Portals → `button.form === null` → Speichern ohne Update.

### Entscheidung

- Dieselbe Struktur wie Gate 2 / `DealCreate`: `DialogPortal` →
  `DialogContent` → `<form>` → Inputs + `SaveButton`.
- `FormDirtyBridge` + sr-only `DialogDescription`.
- `mutationMode="pessimistic"` (wie `DealEdit`): Dialog schließt nach Erfolg;
  Undoable würde `dataProvider.update` verzögern und den Failure-Pfad im
  Dialog unbrauchbar machen. Notify ohne `undoable` für Update-Success.
- Keine CRM-weite Refaktorierung; Wave-1/2-Infrastruktur unverändert; kein DB-Change.
- Tests: struktureller BEFORE/AFTER-Beweis (`button.form === null` vs. owner);
  Integration klickt sichtbares „Speichern“ (Success + Failure).

### Begründung

Portal-Form-Owner wiederherstellen; pessimistisch speichern für Modal-Edit
konsistent zu Gate 2.

## 2026-08-10 – Stabilization Gate 2: DealEdit Portal Form Owner

### Kontext

Produktion: Speichern im Vorgang-Bearbeiten-Dialog reagierte nicht (kein Update,
kein Console-Error), obwohl das Formular dirty wurde und der
Verwerfen-Dialog erschien. Wave 3 Error Observatory wurde dafür geparkt
(`wip-wave3-error-observatory-before-stabilization-gate2`).

### Entscheidung

- **Produktionsursache (nachgewiesen):** `<Form className="contents">`
  **außerhalb** des Radix `DialogPortal` → sichtbarer
  `SaveButton type="submit"` mit `button.form === null` → kein natives Submit;
  RHF-Context blieb über den Portal-Baum trotzdem aktiv (`isDirty` true).
- Fix **A**: `Form` physisch **innerhalb** von `NoraDialogContent` /
  `DialogContent` rendern (wie bereits bei `DealCreate`). Dirty-Close über
  `FormDirtyBridge` + `NoraDialogContent isDirty`.
- Accessibility: `DialogTitle` / `DialogDescription` (sr-only) ergänzt.
- Integrationstest klickt echtes „Speichern“ und prüft `button.form` +
  `dataProvider.update`.
- Andere Flächen: `TaskEdit` gleiches Anti-Pattern (Follow-up Gate 2b);
  Sheets nutzen bereits `SaveButton type="button"`.
- Delete bleibt Hard-Delete (`NoraDeleteButton` → `DeleteButton`); Archive
  Center später.

### Hinweis Test-Harness (nicht Produktion)

Ein zwischenzeitlich beobachtetes „Form-ready Race“ (Speichern vor voll
geladenem EditBase/References → RHF-Validierungstoast im Browser-Test) betraf
**ausschließlich** das Vitest-Harness Timing. Es war **nicht** die
Produktionsursache; Produktion war `button.form === null` durch
Portal/Form-DOM-Trennung.

### Begründung

Native Form-Semantik im Portal wiederherstellen ist robuster als Button-Typ-
Workarounds und entspricht dem bereits korrekten Create-Dialog.

## 2026-08-10 – Foundation Wave 2: Operation Manager + Catalog

### Kontext

Wave 1 korreliert `operation_id` bis `audit_events.request_id`. Nora braucht
zusätzlich einen zentralen Laufzeit-Manager für fachliche Operationen
(pending/success/error), ohne Feedback-UI und ohne Persistenz.

### Entscheidung

- **Operation Catalog** (typed): zunächst `deal.update`, `deal.assign`,
  `customer.update`, `contact.update` mit DE-Messages.
- **Operation Manager** (in-memory): `execute(definition, input, handler)` —
  mint/reuse `operationId`, pending → success|error, Exceptions weiterreichen.
  Voll funktionsfähig **ohne** React/`OperationProvider` (process singleton).
  Provider bindet denselben Singleton — erzeugt keine zweite Instanz.
- React: `OperationProvider` + `useOperationManager` / `useOperations`
  (`useSyncExternalStore`, stabile Snapshot-Referenz).
- Vertikaler Slice: `dataProvider.update("deals")` → Manager → Wave-1-Header.
  Vorhandene Meta-Header → kein verschachtelter Manager-Aufruf.
- **deal.assign**: nur Catalog; Form-Save mit `sales_id` bleibt ein `deal.update`
  (keine künstliche zweite Mutation).
- Fehlerbezug: `runtimeErrorId` (ephemer, session-only) — **nicht** serverseitig
  gespeichert bis Error Observatory.
- Retention: success 8s, error 60s, pending nie auto-drop, max 50.
- Keine DB-Tabelle, kein Feedback-UI, kein Error Observatory.

### Begründung

Manager ist Eigentümer der Operation-ID am Einstieg; Transport bleibt Wave 1.
Feedback/Observatory können später auf denselben In-Memory-State aufsetzen.

## 2026-08-10 – Stabilization Gate 1: Deal Surface Recovery

### Kontext

Nach Wave-1-Production-Migration zeigten Vorgangsflächen unabhängige Frontend-Fehler
(`sales_directory` 400, `deals?id=eq.create`, RelativeTimeFormat RangeError, schwaches
Deal-Save-Feedback). Operation Correlation blieb unberührt.

### Entscheidung

- `formatNoraRelativeDay` defensiv (Fallback `—`); Archive-Grupierung mit ISO-Tageskey.
- `sales_directory`-Filter `disabled@neq` entfernt (View filtert bereits `disabled=false`).
- Create-Route darf nie als Deal-ID an `EditBase`/`ShowBase` gehen (`isNoraRecordId` /
  `matchNoraEditPath`).
- `DateInput` sync über `YYYY-MM-DD`-Regex; `DealEdit` restored `notify` nach Success.
- Keine DB-Migration.

### Begründung

Root Causes waren Frontend/Application-Bugs, keine Schema-Lücken.

## 2026-06-28 – Atomic CRM als Basis für Nora CRM

### Kontext

Es wurde ein CRM benötigt, das mit Vercel/Supabase-naher Architektur kompatibel ist und ohne eigenen VPS betrieben werden kann.

### Entscheidung

Atomic CRM wird als Basis verwendet und zu Nora CRM angepasst.

### Begründung

Atomic CRM liefert bereits:

- React-/TypeScript-Frontend
- Supabase-kompatible Architektur
- Kontakte, Kunden, Vorgänge, Aufgaben
- Demo-/FakeRest-Modus
- gute Erweiterbarkeit

## 2026-06-28 – Interne Resource-Namen bleiben stabil

### Kontext

Sichtbar soll die App deutsch sein. Intern verwendet Atomic CRM Resource-Namen wie `contacts`, `companies`, `deals`.

### Entscheidung

Interne Resource-Namen bleiben vorerst englisch. Sichtbar und in URLs wird Nora deutsch.

### Begründung

Eine harte Umbenennung könnte DataProvider, Supabase-Tabellen, Relations, Tests, Activity-Logs und gespeicherte Daten brechen.

## 2026-06-28 – Deals werden sichtbar zu Vorgängen

### Kontext

„Deal“ ist für einen Hausmeister-/Fensterservice-Betrieb fachlich unpassend.

### Entscheidung

Sichtbarer Begriff: Vorgang.

### Begründung

Ein Vorgang kann Anfrage, Angebot, Nachfassung, Auftrag oder Abschluss sein und passt besser zum operativen Handwerksalltag.

## 2026-06-28 – Nora-Brandfarbe

### Entscheidung

Primäre Akzentfarbe: `#ff3b1f`.

### Begründung

Kräftiges Rot-Orange schafft Wiedererkennbarkeit und hebt primäre Aktionen hervor.

## 2026-06-28 – EUR und de-DE

### Entscheidung

Währungsformatierung in Nora ist EUR mit Locale `de-DE`.

### Begründung

Nora ist für deutsche Betriebe konzipiert. Dollar-Anzeigen sind fachlich falsch und wirken wie Demo-/US-Altlasten.

## 2026-06-28 – Demo-Daten sind synthetisch

### Entscheidung

Demo-Daten dürfen realistisch wirken, aber keine echten personenbezogenen Daten enthalten.

### Begründung

Datenschutz, sichere Weitergabe im Repo und risikofreier Testbetrieb.

## 2026-06-28 – Welle 4: Typografie und comfortable density

### Kontext

Nach Branding, deutscher Lokalisierung und Demo-Daten soll Nora CRM auf Desktop und iPad lesbarer und ruhiger wirken — ohne großes Redesign und ohne Backend-Änderungen.

### Entscheidung

- **Schrift:** Bundled `Inter Variable` (`@fontsource-variable/inter`) mit System-Fallback; keine CDN-Font-Requests
- **Steuerung:** Zentrale CSS-Tokens und Utility-Klassen in `src/index.css` (`.nora-page`, `.nora-list-row`, `.nora-form-section`, etc.)
- **Density:** „Comfortable density“ — mehr Zeilenhöhe und Touch-Ziele (min. 44 px), aber keine überdimensionierte UI
- **Formulare:** Breiteres `SimpleForm` (`max-w-xl`), Sektionen über `.nora-form-section`
- **Listen:** Klare Hierarchie via `.nora-list-title` / `.nora-muted`, dezente Trennlinien statt bunter Flächen

### Begründung

Zentrale Tokens sind wartbarer als verstreute Tailwind-Einzelklassen. Inter ist bereits im Projekt und eignet sich für interne Business-Tools. Größere Touch-Ziele und Line-Heights verbessern iPad-Bedienung und Lesbarkeit längerer Notizen — ohne DataProvider, DB oder Resource-Namen anzufassen.

## 2026-06-28 – Welle 5: Vorgangsworkflow ohne DB-Änderung

### Kontext

Nora soll typische Fensterservice-Vorgänge von Anfrage bis Nachfassen durchspielbar machen — mit vorhandenen Atomic-Feldern.

### Entscheidung

- **`expected_closing_date`** = sichtbar „Nächstes Nachfassdatum“ (Überfällig/heute markiert)
- **`sales_id`** = sichtbar „Zuständig“ im Formular und in der Detailansicht
- **`stage`** = Vorgangsstatus (u. a. Nachfassen, Wartet auf Hersteller)
- **Aufgaben** weiter über `tasks.contact_id`; Schnellaktionen in der Vorgangsdetailansicht für verknüpfte Ansprechpartner
- **Dashboard** zeigt „Heute nachfassen“ und „Wartet auf Hersteller“ aus vorhandenen Vorgangsdaten (ersetzt durch **Hotboard v0.3b** — siehe unten)

### Begründung

Keine Migration nötig; fachliche Lücken (dediziertes Nachfassdatum, `deal_id` an Aufgaben, Hersteller-Feld) bleiben dokumentiert für spätere DB-Erweiterungen.

## 2026-06-28 – Welle 6a: Öffentliche Startseite

### Kontext

Nicht eingeloggte Nutzer landeten direkt auf Login oder Sign-up-Redirect — kein ruhiger Einstieg mit Firmen- und Produktmarke.

### Entscheidung

- **`StartPage`** zeigt **`NoraLandingPage`** (minimalistisch, zwei Aktionen)
- **`/login`** als dedizierte Route für die bestehende `LoginPage`
- **`/sign-up`** unverändert für Registrierung / Erstbenutzer
- **Branding:** Betreiber „Ergart Gruppe“ oben links (blauer Rahmen + Logo aus `public/logos`); Nora-Monogramm zentral als Produktmarke
- **Auth-Logik** unverändert; nur Routing und UI-Einstieg

### Begründung

Klare Trennung zwischen öffentlichem Einstieg und Anmeldung, ohne Supabase oder DataProvider anzufassen. Symbiose Firma + Software ohne Marketing-Website.

## 2026-06-28 – Welle 6a-Polish: Auth-Navigation

### Kontext

Login und Sign-up hatten keine konsistenten Querverweise: Login verlinkte oben fälschlich auf `/login` statt `/`; Sign-up bot weder Einloggen noch Zurück zur Startseite.

### Entscheidung

- **`AuthPageNav`** — gemeinsame sekundäre Navigation (Outline/Ghost, touchfreundlich)
- **Login:** oben Ghost „Zur Startseite“ → `/`; unter Formular „Noch kein Konto?“ + „Registrieren“ → `/sign-up`
- **Sign-up:** „Schon ein Konto?“ + „Einloggen“ → `/login`; Ghost „Zur Startseite“ → `/`
- **i18n:** `crm.auth.nav.*` in DE/EN/FR
- **Keine** Änderung an Auth-Provider, Supabase oder DB

### Begründung

Nach `db reset` fehlen lokale Nutzer — klare Wege zu Sign-up und Startseite reduzieren Verwirrung ohne Fachlogik anzufassen.

## 2026-06-28 – Vorgänge-Kanban aufräumen (Kanban-Polish)

### Kontext

Die Vorgangsübersicht zeigte alle 12 konfigurierten Status-Spalten inklusive leerer Spalten mit `0,00 €` — bei wenigen Vorgängen wirkte das überladen.

### Entscheidung

- **Leere Spalten** standardmäßig ausblenden (`getVisibleDealStages` in `stages.ts`)
- **Toggle** „Alle Status anzeigen“ / „Leere Status ausblenden“ mit Persistenz in `localStorage` (`nora-deals-show-all-stages`)
- **Spaltensummen** nur bei Summe > 0, Label „Auftragswert: …“
- **Drag-and-drop** nur zwischen sichtbaren Spalten; für Ziele in ausgeblendeten Spalten Toggle nutzen
- **Statuswechsel** in Detail/Edit unverändert (volle Phasenliste)
- Keine DB-, Migrations- oder Nummernlogik-Änderung

### Begründung

Ruhigere Standardansicht für den Alltag; volle Pipeline bei Bedarf einblendbar ohne Konfiguration in den Einstellungen zu ändern.

## 2026-06-28 – Welle 6b: Kundennummern, Vorgangsnummern, globale Suche (Spezifikation)

### Kontext

Für Telefonannahme, E-Mail-Rückfragen und schnelle Zuordnung braucht Nora eindeutige, feste Nummern. Bisher existieren weder `customer_number` noch `case_number` in DB, Typen oder Demo-Daten; Suche ist nur pro Liste (`q`-Filter), keine globale Suche im Header.

### Entscheidung

- **Kundennummer:** Format `KD-000001` (ohne Jahresanteil), Feld `companies.customer_number`
- **Vorgangsnummer:** Format `VG-2026-000001` (mit Jahresanteil), Feld `deals.case_number`
- **Vergabe:** serverseitig (Postgres-Sequenz + Funktion + Trigger), nicht im Frontend
- **Immutability:** nach Vergabe nicht änderbar (DB-Trigger)
- **Globale Suche:** später im Header; exakte KD/VG → Direktnavigation zu `/kunden/:id/show` bzw. `/vorgaenge/:id/show`
- **Welle 6b:** nur Dokumentation in `08-numbering-and-global-search.md` — **keine** Migration, kein DataProvider, keine UI

### Begründung

Feste Nummern sind kommunikationsfähige Primärschlüssel für Menschen. Serverseitige Generierung verhindert Duplikate bei parallelen Anlagen. Getrennte Spezifikation vor Implementierung hält DB-Backfill und UI-Wellen kontrollierbar.

### Offene Punkte (Projektinhaber)

- UI-Label „Vorgangsnummer“ vs. „Ticket-ID“
- Präfix `KD` vs. `K`
- Jährlicher Reset der Vorgangs-Sequenz ja/nein
- Reihenfolge: globale Suche erst nach Nummern-Migration (empfohlen)
- Telefonnummern-Normalisierung in der Suche

## 2026-06-28 – Welle 6c: Kundennummern und Vorgangsnummern implementiert

### Kontext

Welle 6b spezifizierte feste KD-/VG-Nummern. Für Telefon- und E-Mail-Alltag müssen Nummern automatisch, eindeutig und unveränderlich vergeben werden.

### Entscheidung

- **Migration** `20260628130000_customer_and_case_numbers.sql` mit Backfill in einer Transaktion
- **Zähler:** Tabelle `number_counters` (nicht pro-Jahr-Sequenzen) — wartbar, race-condition-sicher via `ON CONFLICT DO UPDATE`
- **Kundennummer:** `next_customer_number()` → `KD-000001` (global monoton)
- **Vorgangsnummer:** `next_case_number(created_at)` → `VG-YYYY-000001` (pro Jahr)
- **Trigger:** `assign_*` bei Insert (wenn NULL), `prevent_*` bei Update (Immutability)
- **UI:** read-only Anzeige in Karten/Details/Edit; keine Formularfelder
- **FakeRest:** gemeinsame Logik in `misc/numbering.ts`
- **Globale Suche:** bewusst **nicht** in dieser Welle (v0.2e)

### Begründung

Serverseitige Vergabe verhindert Duplikate und Client-Manipulation. `number_counters` skaliert besser als dynamische Jahres-Sequenzen. Backfill in derselben Migration hält lokale und Remote-Deploys konsistent.

### Offene Punkte

- Globale Suche (v0.2e)
- CSV-Import/Export mit Nummernspalten (v0.2f)

## 2026-06-28 – Welle 6c-QA: Datenbank-Audit Nummern

### Kontext

Nach Implementierung von `customer_number` / `case_number` soll die Migration reproduzierbar sein und Nummern eindeutig, vollständig und unveränderlich wirken.

### Entscheidung

- **`npx supabase db reset --local`:** erfolgreich — Migration `20260628130000` reproduzierbar
- **Schema, Trigger, Constraints:** bestätigt per SQL-Introspection
- **Immutability:** bestätigt (lokaler UPDATE-Test schlägt fehl)
- **Security:** `number_counters` für `anon`/`authenticated` nicht direkt lesbar; Linter meldet fehlendes RLS (durch REVOKE abgefedert)
- **Risiko dokumentiert:** direkte RPC-Aufrufe `next_*` und Client-gesetzte Nummern bei Insert — kein Schema-Fix in QA-Welle
- **Globale Suche:** **freigegeben** als nächste Welle (6d / v0.2e)

### Begründung

QA blockiert die globale Suche nicht. API-Hardening ist empfohlen, aber kein Showstopper für UI-Suche, da die Nora-App Nummern nicht clientseitig setzt.

## 2026-06-28 – Welle 6c-Hardening: Nummern-API absichern

### Kontext

6c-QA fand zwei Lücken: RPC-Aufruf von `next_*` ohne Insert; Client konnte Fake-Nummern bei Insert mitsenden.

### Entscheidung

- Migration `20260628140000_numbering_api_hardening.sql`
- `assign_customer_number` / `assign_case_number`: **immer** DB-Nummer (`SECURITY DEFINER`)
- `REVOKE EXECUTE` auf `next_*` und `format_*` für `public`/`anon`/`authenticated`
- `GRANT EXECUTE` nur `service_role` für interne Funktionen
- UPDATE-Immutability unverändert (`prevent_*`)
- **Globale Suche (6d): freigegeben**

### Begründung

Single Source of Truth für Nummern liegt ausschließlich in der DB. Client-Werte werden robust überschrieben statt Fehler zu werfen — Imports/API-Clients können keine reservierten Nummern setzen.

### Verifikation

`npx supabase db reset --local` (2026-06-28): RPC für `authenticated`/`anon` blockiert; Fake-Nummern bei Insert überschrieben; UPDATE-Immutability bestätigt.

## 2026-06-28 – Welle 7a: Fensterauftrag-Prozess spezifiziert

### Kontext

Chef-Rohkonzept mit 11+ Phasen (Aufmaß bis Montage abgeschlossen), internen Kontrollpunkten, Kunden-E-Mails und Tracking-Link soll Nora-konform bewertet werden — ohne sofortige Implementierung.

### Entscheidung

- **Spezifikation** in `09-window-order-workflow.md`
- **Fensterauftrag** ≠ alle Vorgänge — Zuordnung über `deals.category = fensterservice` (später optional `workflow_type`)
- **Schlanke Hauptstatus** (7–8 Kanban-Meilensteine) aus bestehenden `dealStages`-IDs
- **S4a / S4b / S4c / S5** als **Checkliste**, nicht als Kanban-Spalten
- **Hersteller generisch** — Höning nicht im Modell verdrahten
- **E-Mails:** Vorlagen → manuell → Automation (keine Vollautomatik jetzt)
- **Kundenstatus-Link:** eigenes späteres Modul (v0.5), nicht jetzt
- **Google Maps/Kalender:** sinnvoll später; **Drive/Keep/Tasks** nicht Nora-Kern
- **Nächste Implementierung:** v0.3a Globale Suche, dann v0.3b Hotboard + v0.3c Fenster-Kanban

### Begründung

Der Chef-Prozess liefert wertvolle operative Logik für einen Kerngeschäftszweig, würde als 1:1-Kanban aber Nora überladen. Trennung Hauptstatus/Checkliste hält das Board ruhig (konsistent mit Kanban-Polish) und bereitet digitale Qualitätssicherung vor, ohne vorzeitige DB-Migrationen.

## 2026-06-28 – Welle 6d: Globale Suche im Header

### Kontext

KD-/VG-Nummern sind implementiert und gehärtet. Büro und Telefonannahme brauchen zentrale Schnellsuche ohne Listenwechsel.

### Entscheidung

- **`GlobalSearch`** im Desktop-Header und als Mobile-Overlay (`MobileNavigation`)
- **`performGlobalSearch`** nutzt bestehende `getList`/`q`-Suche und `@eq` für exakte Nummern
- **Keine** neue DB-Struktur, **keine** Migration
- Direktnavigation bei exaktem `KD-*` / `VG-YYYY-*`
- Gruppierte Trefferliste (max. 5 pro Ressource)
- Telefon: einfache Normalisierung (Leerzeichen, `-`, `()`); +49/0 später
- Vorgangs-Listen-`q` um Feld `stage` ergänzt (global + Listen-Suche)

### Begründung

Option A aus Spezifikation — Frontend-orchestriert über DataProvider, ohne Postgres-RPC. Nutzt vorhandene RLS und Lifecycle-`q`-Suche; FakeRest-kompatibel über natives `q`-Filtering.

## 2026-06-28 – v0.3b: Hotboard / operative Startübersicht

### Kontext

Nach Login soll das Büro sofort sehen, was heute wichtig ist — ohne neue DB-Struktur, ohne Google Kalender, ohne Fensterauftrag-Checkliste.

### Entscheidung

- **`Hotboard`** ersetzt `DealFollowUpPanel` und die prominente Dashboard-`TasksList`
- **Team-Ansicht** für Vorgänge (kein `sales_id`-Filter) — Büro sieht alle offenen Vorgänge
- **Fünf Bereiche**, je max. 5 Einträge, mit Empty-State „Keine Einträge“:
  - Heute nachfassen (`expected_closing_date` heute/überfällig, bestehende `dealUtils`)
  - Neue Anfragen (`stage = neue-anfrage`)
  - Wartet auf Hersteller (`stage = wartet-auf-hersteller`)
  - Angebote nachfassen (`angebot-gesendet`, `nachfassen`; Dedupe gegen Nachfass-Bereich)
  - Offene Aufgaben (eigene Tasks über `contact_id` → Ansprechpartner-Link)
- **Archivierte Vorgänge** ausgeschlossen (`archived_at@is: null`)
- **Navigation:** `noraCreatePath` → `/vorgaenge/:id/show`, `/kontakte/:id/show`
- **Filterlogik** in `hotboardUtils.ts` (unit-getestet)
- **Nicht gebaut:** Heutige Termine, Montage/Aufmaß heute — kein Terminmodell; Hinweis in UI und Docs
- **Google Kalender** bewusst später (echte Start/Ende-Termine, nicht `expected_closing_date` missbrauchen)

### Begründung

Nutzt ausschließlich vorhandene Felder und DataProvider-Abfragen. Hotboard oben, Statistik (`DealsChart`) und Aktivität darunter — ruhiges Nora-Layout für Desktop und Tablet.

## 2026-06-28 – v0.3c: Fenster-Kanban-Filter

### Kontext

Fensteraufträge sollen gezielt im Kanban betrachtet werden können, ohne die allgemeine Vorgangsübersicht zu dominieren. Prozess ist in `09-window-order-workflow.md` spezifiziert; S4a/S4b/S4c bleiben Checklistenpunkte.

### Entscheidung

- **Ansichtsauswahl** in `DealKanbanToolbar`: Alle Vorgänge · Fensterservice · Hausmeisterservice
- **Client-seitiger Filter** auf `deals.category` — keine DB-Migration, ergänzt (ersetzt nicht) den bestehenden Listenfilter
- **Fensterservice-Kanban:** 8 bevorzugte Status-Spalten (`FENSTERSERVICE_KANBAN_STAGE_IDS`); Vorgänge in anderen Status erscheinen als Zusatzspalte wenn belegt
- **Hausmeisterservice:** alle 12 Status, nur Kategorie gefiltert
- **localStorage** für gewählte Ansicht (`nora-deals-kanban-view`)
- **Keine neuen Status-IDs**, keine S4-Spalten, keine Produktionscheckliste

### Begründung

Schlanke Fenster-Pipeline ohne Datenmodelländerung. Bestehende Logik „leere Spalten ausblenden“ / „Alle Status anzeigen“ bleibt erhalten und kombinierbar.

## 2026-06-28 – Welle 7b: Checklisten-, Textbaustein- und Audit-Datenmodell spezifiziert

### Kontext

Nach Hotboard und Fenster-Kanban-Filter soll das nächste fachliche Fundament gelegt werden: modulare Checklisten (FENS/HAUS/IMMO), Textbausteine und zentrale Audit-Logs — ohne voreilige Migration.

### Entscheidung

- **Spezifikation** in `10-checklists-snippets-audit.md`
- **Hauptmodell relational:** `checklist_templates`, `checklist_template_items`, `checklist_runs`, `checklist_run_items`, `saved_text_snippets`, `audit_events`
- **JSONB-only am Vorgang abgelehnt** als führende Checklistenquelle
- **Hybrid:** JSONB nur in `audit_events` (old/new/metadata) und optional Run-Metadaten
- **Servicebereiche:** `FENS`, `HAUS`, `IMMO` über `service_area_code` — **nicht** `company_id`
- **`label_snapshot` Pflicht** an Run-Items für historische Korrektheit
- **Audit append-only** — CRM-Nachvollziehbarkeit, kein GoBD-Ersatz
- **S4a/S4b/S4c** bleiben Checklistenpunkte in Vorlage `FENS_PRODUCTION_RELEASE`
- **Nächste Implementierung:** v0.3d2 Migration, dann RLS/UI

### Begründung

Relationale Struktur ermöglicht Wiederverwendung, RLS, Hotboard-Auswertung und jahrelange Nachvollziehbarkeit. Verhindert parallele JSONB-Experimente und Audit-Dumps in Notizen.

## 2026-06-28 – v0.3d2: Datenbankmigration Checklisten, Textbausteine, Audit

### Kontext

Spezifikation aus Welle 7b (`10-checklists-snippets-audit.md`) soll persistent werden — ohne UI.

### Entscheidung

- **Migration** `20260628150000_checklists_snippets_audit.sql`
- **6 Tabellen:** `checklist_templates`, `checklist_template_items`, `checklist_runs`, `checklist_run_items`, `saved_text_snippets`, `audit_events`
- **FKs** an bestehende `bigint`-PKs (`deals`, `companies`, `contacts`); Checklisten-PKs `uuid`
- **Constraints:** `service_area_code` ∈ FENS/HAUS/IMMO; Run-Status `open`/`completed`/`cancelled`; Snippet-`kind`; `usage_count >= 0`; partial unique index max. 1 offener Run pro `deal_id + template_id`
- **Audit:** `insert_audit_event` SECURITY DEFINER; Trigger auf Deals/Runs/Items/Snippets; `prevent_audit_mutation` auf UPDATE/DELETE
- **RLS:** Templates Admin-write; Runs/Items/Snippets authenticated CRUD ohne DELETE; Audit SELECT-only
- **Seed:** `FENS_PRODUCTION_RELEASE` mit 9 Punkten (Vorkasse optional)
- **TypeScript:** `types/checklists.ts`
- **Keine UI** in dieser Welle

### Verifikation

- `npx supabase db reset --local` ✅
- `supabase/tests/checklists_audit_verification.sql` ✅
- `npm run typecheck` / `npm run build` ✅

### Nächste Welle

**v0.3d4** — UI im Vorgangsdetail (freigegeben).

## 2026-06-28 – v0.3d3: Checklisten-Run-Start absichern

### Kontext

v0.3d2 legte Tabellen an, kopierte Run-Items aber nicht automatisch — UI-Risiko für inkonsistente Zustände.

### Entscheidung

- **RPC** `start_checklist_run_from_template(text, bigint, bigint)` — SECURITY DEFINER, nur `authenticated`
- Atomar: Run + alle aktiven Template-Items mit `label_snapshot`
- **Idempotent** bei offenem Run; advisory lock + unique_violation-Fallback
- **Audit** weiterhin nur via INSERT-Trigger (kein doppeltes Event bei Idempotenz)
- TypeScript-Konstanten für v0.3d4 UI
- SQL-Tests in `checklists_audit_verification.sql`

### Verifikation

- `npx supabase db reset --local` ✅
- SQL-Verifikation inkl. RPC-Tests ✅
- `npm run typecheck` / `npm run build` ✅

### Nächste Welle

**v0.3d5** — Hotboard-Kachel „Produktionsfreigaben offen“.

## 2026-06-28 – v0.3d4: Checklisten-UI im Vorgangsdetail

### Kontext

v0.3d3 lieferte atomaren Run-Start per RPC; Nutzer brauchen digitale Produktionsfreigabe im Fenstervorgang.

### Entscheidung

- **UI** `DealProductionChecklistSection` in `DealShow` — nur Fensterservice oder bestehende Runs
- **Start** ausschließlich via `dataProvider.startChecklistRunFromTemplate` (RPC) — keine Client-Kopie von Template-Items
- **Updates** auf `checklist_run_items` per Standard-DataProvider; Audit via DB-Trigger
- **Demo** (`VITE_IS_DEMO`): Abschnitt mit deaktiviertem Hinweis, kein RPC
- **Nicht** in dieser Welle: Snippet-Plus/Minus, Rollenlogik, automatischer Statuswechsel, Hotboard-Kachel

### Verifikation

- `npm run typecheck` / `npm run build` ✅
- Unit-Tests `checklistUtils.test.ts` ✅
- Keine DB-Migration in v0.3d4

### Nächste Welle

**v0.3d6** — Audit-Ansicht in Kunden-/Vorgangsdetail (lesend).

## 2026-06-28 – v0.3d5: Hotboard „Produktionsfreigaben offen“

### Kontext

Büro/Leitung braucht operative Sicht auf Fenster-Vorgänge mit offener Produktionscheckliste vor Herstellerfreigabe.

### Entscheidung

- **Kachel** `HotboardOpenProductionReleases` im bestehenden Hotboard-Grid
- **Daten:** `checklist_templates` + `checklist_runs` + `checklist_run_items` + `deals` + `companies` — keine neue DB-Struktur
- **Filter:** `FENS_PRODUCTION_RELEASE`, Run `open`, fehlende Pflichtpunkte (optional-only nach hinten)
- **Sortierung:** ältestes `started_at` zuerst (Tie-Break: `expected_closing_date`)
- **Demo:** Bereich ausgeblendet
- **Nicht:** Rollenlogik, Auto-Status, E-Mail, Migration

### Verifikation

- `productionReleaseHotboardUtils.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

### Nächste Welle

**v0.3d6** — Audit-Ansicht lesend im Kunden-/Vorgangsdetail.

## 2026-06-28 – v0.3e: Schnellerfassung / Eingangszentrale

### Kontext

Chefs sollen Anfragen aus Telefon, WhatsApp, E-Mail und Google-Notizen schnell als Kunde/Ansprechpartner/Vorgang erfassen — ohne externe Integrationen in dieser Welle.

### Entscheidung

- **3-Schritt-Dialog** `QuickCaptureDialog` mit Einstieg in Header, Hotboard und Mobile-Plus-Menü
- **Suche zuerst** via `performGlobalSearch`; Dubletten-Warnung heuristisch
- **Quelle** in `deals.description` (`Quelle: …`) — kein DB-Feld `source_channel` (später)
- **Speichern** sequentiell: Kunde → Kontakt → Vorgang → optional Aufgabe; Redirect zum Vorgang
- **Demo/FakeRest** über Standard-CRUD — keine Einschränkung
- **Nicht:** Google/Gmail/WhatsApp-API, Migration, atomare RPC

### Verifikation

- `quickCaptureUtils.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

### Später empfohlen

- DB-Feld `deals.source_channel` oder `inquiry_sources`
- Atomare RPC `create_inquiry_from_quick_capture` für Transaktionssicherheit
- Stärkere Dublettenprüfung (Fuzzy-Match, Adresse)

## 2026-06-28 – v0.3f: Intelligente Dubletten-Vorschläge

### Kontext

Die Schnellerfassung (v0.3e) zeigte nur eine generische Amber-Warnung. Chefs brauchen konkrete Kandidaten mit Begründung, um Dubletten aus Telefon/WhatsApp/E-Mail zu vermeiden.

### Entscheidung

- **Vorschlagsfeld** statt reiner Warnung — Titel „Du meinst vielleicht diesen Kunden“
- **Deterministisches Scoring** in `duplicateCandidateUtils.ts` — keine KI, kein Auto-Merge
- **Kriterien:** Kundennummer, Telefon, E-Mail (stark); ähnlicher Name (mittel); Name + Stadt/PLZ (stärker)
- **Effiziente Suche:** Debounce 400 ms, Cache, stale-Request-Ignore, max. 5 Kandidaten; `performGlobalSearch` wiederverwendet
- **Verhalten:** „Diesen Kunden verwenden“ → Schritt Ansprechpartner; „Trotzdem neuen Kunden anlegen“ → bewusstes Neuanlegen, Vorschläge ausblenden
- **Lexware-Vorbereitung:** `DuplicateSearchInput` + `rankDuplicateCandidates` für späteren CSV-Import wiederverwendbar
- **Nicht:** Migration, neue Tabellen, Auto-Merge, Lexware-Import in dieser Welle

### Verifikation

- `duplicateCandidateUtils.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3f: Realistische Demo- und UX-Testdaten

### Kontext

Die bisherigen FakeRest-Daten (Saarland, 8 Kunden) reichten nicht für realistische UI-Tests von Hotboard, Schnellerfassung, globaler Suche, Kanban und Dubletten-Vorschlägen.

### Entscheidung

- **Region** Düsseldorf / Neuss / Umgebung — vollständig fiktiv (`@nora-demo.local`, `+49 211/2131 000 …`)
- **Quelle der Wahrheit:** `noraDuesseldorfSeedData.ts` → `noraDemoSeed.ts` (FakeRest)
- **Umfang:** 25 Kunden, 30 Kontakte, 20 Vorgänge, 20 Aufgaben, 10+ Notizen
- **UI-Testfälle:** Mehrfach-Kontakte, Kunde ohne Kontakt, Kontakt ohne E-Mail, Vorgang ohne Wert, überfälliges Nachfassen, Dubletten-Paare (Becker/Schneider)
- **Checklisten-Runs:** nicht in FakeRest — `dev:demo` deaktiviert Checklisten-UI; Vorlage `FENS_PRODUCTION_RELEASE` bleibt in Supabase-Migration für `make start`
- **Nicht:** Production-DB, Migrationen, neue Fachlogik, dist-Dateien

### Verifikation

- `noraDemoSeed.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅

## 2026-07-14 – UX-Polish: Kontakte-Suche und globale Suche

### Kontext

Auf `/kontakte` erschien neben der globalen Navigationssuche eine zweite allgemeine Suchleiste. In Chrome trat beim Tippen in der globalen Suche teils ein Wallet-/Kundenkarten-Popup auf.

### Entscheidung

- **Kontakte-Liste:** `SearchInput` in `ContactListFilter` entfernt — spezifische Filter (Zuletzt gesehen, Status, Markierungen, Aufgaben, Betreuer) bleiben
- **Globale Suche:** Suchfeld technisch als Suche markiert (`type="search"`, `autoComplete="off"`, `spellCheck={false}`, IDs `nora-global-search` / `nora-global-search-mobile`)
- **ResponsiveFilters:** `searchInput` optional — Mobile zeigt nur Filter-Sheet wenn keine Listen-Suche
- **Nicht:** Suchlogik, Navigation, Migrationen

### Verifikation

- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3g: Schnellerfassung UX-Überarbeitung

### Kontext

Der lineare 3-Schritt-Wizard blockierte während Telefonaten. Doppelte Kundenvorschläge (Suchliste + Dubletten-Box) verwirrten. Entwürfe gingen beim Schließen verloren.

### Entscheidung

- **Frei anklickbare Tabs** — Kunde / Ansprechpartner / Vorgang jederzeit wechselbar; Validierung nur beim Speichern
- **Lokaler Entwurf** — `localStorage` Key `nora-quick-capture-draft`; wiederherstellen beim Öffnen; löschen nach Speichern oder „Entwurf verwerfen“
- **Ein Bereich „Mögliche Kunden“** — `PossibleCustomersPanel` + `mergeCustomerSearchResults` (keine doppelte Anzeige)
- **Layout** — breiterer Dialog, 2-Spalten Desktop, `BusinessNumber` als Badge
- **Performance** — nur `useDuplicateCandidateSearch` (400 ms Debounce, Cache, stale-guard)
- **Nicht:** Migration, serverseitige Entwürfe, Auto-Merge, Lexware

### Verifikation

- `quickCaptureDraft.test.ts`, `mergeCustomerSearchResults.test.ts`, `quickCaptureValidation.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3h: Kundenliste und Vorgänge-Kanban responsiver

### Kontext

Auf `/kunden` duplizierte eine Listen-Suche die globale Nora-Suche. Das Kanban war durch `max-w-screen-xl` und `max-w-[20rem]` auf Spalten eng begrenzt. „Nachfassen“ war für Nutzer nicht intuitiv.

### Entscheidung

- **Keine Listen-Suche auf `/kunden`** — nur kundenspezifische Filter (Kundentyp, Betreuer) via `ResponsiveFilters`
- **Kanban volle Breite** — `Layout` ohne `max-w-screen-xl` auf `/vorgaenge`; Grid-Spalten `minmax(280px, 320px)`
- **Scrollleiste** — `.nora-kanban-scroll` mit gestalteter horizontaler Scrollbar
- **Kartenhierarchie** — VG-Badge, Titel, Kunde, Kategorie/Wert, Kontakt-Badge
- **Terminologie** — sichtbare Texte „Kontakttermin“ / „Rückmeldung ausstehend“; IDs `nachfassen`, `expected_closing_date` unverändert
- **Nicht:** Migration, Status-IDs, globale Suchlogik, DnD-Bibliothek

### Verifikation

- `dealKanbanView.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3i: Kanban und Vorgangsakte barrierearm

### Kontext

v0.3h lieferte volle Kanban-Breite, aber Spaltenköpfe überlappten Karten, VG-Nummern waren zu klein, Dringlichkeit wirkte wie Fließtext, Scrollbars zu dünn, Vorgangsdetail unstrukturiert, englische Datumsformate sichtbar.

### Entscheidung

- **Spaltenkopf getrennt** — eigene Header-Box, Anzahl, Gap vor Karten; kein sticky Overlap
- **BusinessNumber** — zentrale Badge-Komponente mit Größen `sm`/`md`/`lg` und KD/VG-Akzent
- **NoraUrgencyBadge** — heute/überfällig/zukünftig mit Icon + Text + Warnbox im Detail
- **Scrollbars** — Kanban 16 px horizontal, Detail 14 px vertikal (`.nora-detail-scroll`)
- **Mausrad horizontal** — `useHorizontalWheelScroll` nur im Kanban-Container
- **DealShow** — breiter Dialog, `NoraSectionCard`-Abschnitte, sticky Kopf mit VG-Nummer
- **de-DE Datumsformat** — `noraDateTime.ts`, keine `Jul 14, 2026` mehr
- **Nicht:** Migration, Status-IDs, DnD-Bibliothek

### Verifikation

- `noraDateTime.test.ts`, `horizontalWheelScroll.test.ts`, `NoraUrgencyBadge.test.ts` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – Demo-Auftragswerte korrigiert

### Kontext

Die Düsseldorf-Demo enthielt sechsstellige Einzelbeträge (bis 320.000 €), was Kanban-Spaltensummen, Dashboard und Geschäftswahrnehmung verfälschte.

### Entscheidung

- **Alle 20 Vorgänge** in `noraDuesseldorfSeedData.ts` auf fachlich plausible Euro-Werte angepasst (Gesamt ca. 57.000 €)
- **Fensterservice** max. 20.000 €; **Hausmeisterservice** max. 6.000 €
- **`amount = 0`** bleibt für „wartet auf Hersteller“ / noch nicht kalkuliert
- **JSON-Dokumentation** (`nora_demo_seed_duesseldorf_neuss.json`) synchronisiert
- **Tests** in `noraDemoSeed.test.ts` für Betragsgrenzen und Pipeline-Summe
- **Nicht:** echte Preise, Migration, Produktionsdaten

### Verifikation

- `noraDemoSeed.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅

## 2026-07-14 – v0.4a: Google-Kalender-Architektur und Nora-Rollenmodell spezifiziert

### Kontext

Nach Hotboard, Checklisten und Schnellerfassung soll Nora Termine aus dem bestehenden Google-Geschäftskalender lesen und mit CRM-Daten verknüpfen — ohne parallele Benutzerverwaltung oder zweites Terminsystem. Die Sekretärin (`office`) braucht klare Rechte; Google bleibt führend für Terminzeit und -existenz.

### Entscheidung

- **Spezifikation** in `11-google-calendar-rbac.md`
- **System of Record Termine:** Google Kalender (Zeit, Titel, Ort, Wiederholung, Existenz)
- **Nora speichert:** Cache (`google_calendar_events`), CRM-Verknüpfung, Audit — **kein** `appointments`-Hauptmodell
- **Ein Geschäftskalender:** `google_calendar_connections.calendar_id` — keine iCal-URL, kein Embed
- **Termin-Eigentum:** `origin = google` (zunächst read-only) \| `origin = nora` (später bearbeitbar)
- **Rollen:** `admin`, `office`, `viewer` an **`sales.role`** — keine zweite Benutzertabelle
- **RBAC-Empfehlung:** Rolle in DB (`sales.role`) + `current_nora_role()` für RLS; optional JWT-Spiegel später
- **Secrets:** Client Secret und Refresh Token nur in Edge Function Secrets/Vault — nie Frontend/Audit
- **OAuth:** zuerst `calendar.events.owned.readonly`; Write-Scope eigene Welle (v0.4e)
- **Sync:** manuell → periodisch → syncToken → Webhook (stufenweise v0.4c–g)
- **Audit:** bestehende `audit_events` mit `calendar.*`-Event-Typen
- **Nicht in v0.4a:** Migration, Edge Functions, OAuth, UI

### Begründung

Das bestehende Modell (`auth.users` ↔ `sales` 1:1, `administrator boolean`) reicht als Fundament — eine `sales.role`-Spalte vermeidet parallele Identitäten. Google als Termin-System of Record verhindert Drift zwischen Nora und Kalender. Minimale Scopes und Token-Trennung reduzieren Angriffsfläche.

### Nächste Welle

**v0.4b** — RBAC-Migration (`sales.role`, RLS, `canAccess`, Edge Function `users`)

## 2026-07-14 – v0.4b: RBAC- und RLS-Härtung

### Kontext

v0.4a spezifizierte `admin` / `office` / `viewer` an `sales.role`. v0.4b setzt das technisch um: Least-Privilege-Backfill, gehärtete Rollenfunktionen, tiered RLS, Systemfeld-Schutz und UI-Spiegel in `canAccess` — ohne Google-API, OAuth oder Kalendertabellen.

### Entscheidung

- **Kanonische Benutzertabelle:** `sales` bleibt CRM-Identität (`auth.users` 1:1)
- **Spalte:** `sales.role text not null` mit CHECK (`admin`, `office`, `viewer`)
- **Backfill (Least Privilege):** `administrator = true` → `admin`; alle anderen → `viewer`; `office` nur explizit per Admin
- **Spiegel:** `administrator = (role = 'admin')` per Trigger — widersprüchliche Zustände unmöglich
- **Rollenänderung:** nur `set_sales_role_by_admin()` (Admin-JWT oder `service_role`); direkte Updates an `role`/`disabled`/`administrator` blockiert
- **Funktionen:** `nora_auth_uid()`, `nora_is_active_user()`, `current_nora_role()`, `has_nora_role()`, `nora_can_write()`, `is_admin()` — SECURITY DEFINER, festes `search_path`, EXECUTE nur `authenticated`/`service_role`, kein `anon`
- **RLS-Matrix:** viewer SELECT; office SELECT/INSERT/UPDATE (kein DELETE); admin inkl. DELETE und Konfiguration/Vorlagen
- **`audit_events`:** SELECT nur admin/office; kein Client-INSERT/UPDATE/DELETE (RLS + append-only Trigger)
- **`disabled`:** kein Zugriff in Rollenfunktionen, RLS und Auth-Provider
- **Frontend:** `canAccess.ts`, `resolveNoraRole`, `SalesInputs` mit Rollen-Select, Edge Function `users` nutzt RPC
- **Tests:** `rbac_rls_verification.sql` + `rbac_rls_matrix.sql` (Rolle `nora_rls_test`, NOBYPASSRLS)

### Rollback / Kompatibilität

| Schritt | Aktion |
|---------|--------|
| **Rollback RLS** | Policies aus Migration rückgängig; vorherige Policies aus `20241104153231_sales_policies.sql` u. a. wiederherstellen |
| **Rollback Rolle** | `DROP COLUMN sales.role` erst nach Entfernen aller Policy-/Funktions-Referenzen |
| **`administrator`** | Bleibt lesbar als Deprecated-Spiegel; UI/Edge migrieren auf `role` vor Entfernung (Ziel v0.5) |
| **Backfill rückgängig** | Nicht automatisch — vor Rollback Snapshot der `sales`-Tabelle; `office`-Zuweisungen manuell dokumentieren |
| **Neue Nutzer** | `handle_new_user`: erster Nutzer `admin`, weitere `viewer` |

### Verifikation

- `npx supabase db reset --local` ✅
- `rbac_rls_setup` / `rbac_rls_matrix` ✅
- `checklists_audit_verification.sql` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3j: Hotboard-Arbeitsboard (Fokusboard)

### Kontext

Das Hotboard listete Vorgänge bereits nach Dringlichkeit und Status, aber ohne kompakten Spaltenüberblick wie im Kanban. Nutzer brauchen einen lesenden Schnellzugriff auf die wichtigsten offenen Vorgänge — ohne das volle Kanban zu duplizieren oder Status per Drag-and-drop zu ändern.

### Entscheidung

- **Arbeitsboard** im Hotboard: max. 2 Spalten (`neue-anfrage`, `nachfassen`), max. 5 Karten je Spalte
- **Sortierung** über bestehende `hotboardUtils` / `getFollowUpStatus` — keine zweite Statuslogik
- **Lesend:** Klick öffnet Vorgangsakte; Drag-and-drop bleibt auf `/vorgaenge`
- **Komponenten:** `HotboardFocusBoard`, `HotboardFocusColumn`, `HotboardFocusCard`
- **Keine** Migration, keine Status-ID-Änderung, keine neue DnD-Bibliothek

### Verifikation

- `hotboardFocusUtils.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅

## 2026-07-14 – v0.4b.1: RBAC-Migrations- und Function-Hardening

### Kontext

v0.4b lieferte die Rollenmatrix, aber enthielt eine Test-LOGIN-Rolle in der Produktionsmigration und exponierte interne Helper in `public`. v0.4b.1 bereitet den Production-Push vor — ohne Änderung der fachlichen Matrix.

### Entscheidung

- **Testrolle** aus `20260714120000` entfernt; lokales Setup/Teardown in `supabase/tests/rbac_rls_setup.sql` / `rbac_rls_teardown.sql` (NOLOGIN, kein Passwort in Git)
- **Schema `nora_private`:** interne Helper (`safe_auth_uid`, `is_active_user`, `current_role`, `has_role`, `can_write`, `is_admin`) — nicht in Data-API-Schemas
- **`public.nora_auth_uid` entfernt** — `auth.uid()` in öffentlichen RPCs; `nora_private.safe_auth_uid()` intern (malformed sub → NULL, kein Cast-Exception)
- **`search_path = ''`** auf allen SECURITY DEFINER-Funktionen; vollständig schemaqualifiziert
- **GUC-Härtung:** `nora.privilege_rpc_token` + `nora.allow_sales_privilege_change` nur in `set_sales_role_by_admin`; Reset nach Erfolg/Fehler
- **Grants:** `anon` REVOKE auf allen v0.4b-geschützten Tabellen; `authenticated` minimal (z. B. `sales`: SELECT+UPDATE)
- **Migration:** `20260714140000_nora_rbac_hardening.sql`
- **Keine** UI-, OAuth-, Kalender- oder Matrix-Änderung

### SECURITY DEFINER-Inventar (v0.4b.1)

| Funktion | Schema | PostgREST | Warum SECURITY DEFINER |
|----------|--------|-----------|------------------------|
| `safe_auth_uid` | nora_private | nein | JWT-sub lesen ohne Cast-Exception |
| `is_active_user` | nora_private | nein | RLS: sales-Lookup trotz Tabellen-RLS |
| `current_role` | nora_private | nein | RLS: Rolle aus sales |
| `has_role` | nora_private | nein | RLS: Rollenmatrix |
| `can_write` | nora_private | nein | RLS: office/admin |
| `is_admin` | nora_private | nein | RLS: admin-Checks |
| `set_sales_role_by_admin` | public | ja | Edge Function Rollen-RPC |
| `start_checklist_run_from_template` | public | ja | Checklisten-Start |
| `handle_new_user` | public | nein | Auth-Trigger: sales anlegen |

### Verifikation

- `npx supabase db reset --local` ✅
- `rbac_rls_production_check.sql` (ohne Testrolle) ✅
- `rbac_rls_setup` → `rbac_rls_matrix` → `rbac_rls_teardown` → production_check ✅
- `checklists_audit_verification.sql` ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.4b.2: RBAC-Abschluss (Capability, Parallel-Admin, sales_directory)

### Kontext

v0.4b.1 nutzte GUC-Token für Privilegienänderungen — client-setzbare Textwerte sind keine saubere Capability-Grenze. Zusätzlich: Race beim ersten Admin, unnötige `sales`-Vollexposition für Teamlisten.

### Entscheidung

- **GUC-Modell entfernt** (`nora.allow_sales_privilege_change`, `nora.privilege_rpc_token`)
- **Rolle `nora_role_manager`:** NOLOGIN, NOBYPASSRLS, kein Mitglied für `authenticated`/`anon`/`service_role`
- **`nora_private.apply_sales_role_change`:** Owner `nora_role_manager`; EXECUTE nur `postgres`
- **`set_sales_role_by_admin`:** JWT-Check (`nora_private.is_admin()` / `service_role`), delegiert an apply-Funktion
- **Trigger `prevent_sales_privilege_escalation`:** erlaubt Privileg-UPDATE nur wenn `current_user = nora_role_manager`
- **Erster Admin:** `nora_private.resolve_first_signup_role()` mit `pg_advisory_xact_lock(89142421, 1)`
- **View `public.sales_directory`:** `id`, `first_name`, `last_name`, `avatar`; RLS nur aktive Nutzer; `security_invoker = false` + View-RLS
- **`public.sales` SELECT:** eigene Zeile oder Admin — nicht mehr alle Zeilen für office/viewer
- **Frontend:** Betreuer-Selects / `useGetSalesName` → `sales_directory`; Admin-Verwaltung bleibt auf `sales` + Edge Function
- **Migration:** `20260714150000_nora_rbac_final_hardening.sql` — keine Rückänderung an Remote-Migrationen
- **Keine** Matrix-Änderung (admin/office/viewer), kein Google/Kalender

### Verifikation

- `npx supabase db reset --local`
- `rbac_rls_production_check` → `first_admin_parallel` → `setup` → `matrix` → `final_hardening` → `checklists_audit` → `teardown` → production_check
- `rbac_rls_first_admin_parallel_runner.ps1` (zwei Sessions)
- `npm run typecheck` / `npm run build` / `npm run dev:demo`

## 2026-07-14 – Demo-Seed: `amountCents` → `amountEur`

### Kontext

Nach der Auftragswert-Korrektur war klar: `amountCents` speicherte Euro und wurde 1:1 auf `deals.amount` gemappt. Der Name birgt Faktor-100-Fehler-Risiko.

### Entscheidung

- **Umbenennung** in `DealSeed`: `amountCents` → `amountEur`
- **Mapping** in `noraDemoSeed.ts`: `amount: seed.amountEur` (keine Umrechnung)
- **Kategorieverteilung** dokumentiert: 13 Fensterservice, 4 Hausmeisterdienst, 2 Reparatur, 1 Wartung (20 gesamt)
- **Gesamtsumme** unverändert: 60.020 €
- **Nicht:** `deals.amount` in DB/Supabase, Migrationen

### Verifikation

- Keine verbleibende `amountCents`-Verwendung im Projekt ✅
- `noraDemoSeed.test.ts` (Mapping, Kategorien, Summe) ✅
- `npm run typecheck` / `npm run build` ✅

## 2026-07-14 – v0.3k: Rollenbewusste UX, Ladezustände und Fehlertoleranz

### Kontext

RBAC/RLS (v0.4b.x) war backend-seitig umgesetzt, die UI zeigte aber weiterhin Schreib- und Löschaktionen für alle Rollen. Lade-, Leer- und Fehlerzustände waren uneinheitlich.

### Entscheidung

- **UI spiegelt `canAccess.ts`**, ersetzt aber **niemals** RLS (DB bleibt autoritativ).
- **Viewer:** Lesemodus-Banner im Layout; keine Create/Edit/Delete; Edit-Routen leiten auf Show um.
- **Office:** Schreiben und Archivieren; kein physisches Löschen; keine Benutzer-/Konfigurationsverwaltung.
- **Admin:** unveränderte Verwaltungsaktionen.
- **Zentrale Fehlernormalisierung** (`normalizeCrmError`, `withCrmErrorHandler`) für PostgREST/Netzwerk — keine technischen DB-Texte in der UI.
- **Einheitliche Zustände:** `NoraPageLoading`, `NoraEmptyState`, `NoraQueryError` (Retry nur manuell).
- **Dirty-Form-Schutz:** `NoraCancelButton` in `FormToolbar`.
- **Demo-Rollentest:** drei feste FakeRest-Benutzer + `DemoRoleSwitcher` nur bei `VITE_IS_DEMO=true`.
- **Keine** Migration, **keine** RLS-Änderung, **keine** neuen Rollen.

### Verifikation

- `noraRbacUx.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅
- Manuelle Rollenprüfung admin/office/viewer im Demo noch ausstehend.

## 2026-07-14 – v0.3k.1: Rollen-UX-Abnahme und Dialog-Polish

### Kontext

v0.3k lieferte die Grundinfrastruktur; Edit-Guards, Dirty-Dialoge, Fehler-Retry und manuelle Demo-Abnahme waren noch unvollständig.

### Entscheidung

- **EditGuards vervollständigt** auf Company/Contact/Deal/Task Edit, Create, SalesEdit (admin-only), Settings, Import.
- **Dirty-Schutz:** `NoraDialogContent`, `useNoraDirtyDialog`, erweiterte Dialog/Sheet-Primitives — X/Escape bestätigen bei Dirty; Außenklick blockiert.
- **Quick Capture:** Abbrechen/X/Escape persistiert Draft (`persistDraft`); nur „Entwurf verwerfen“ löscht.
- **Fokus:** `useDialogFocusReturn` für Dialoge (DealShow, QuickCapture, NoraDialogContent).
- **Fehler-Retry:** GlobalSearch, SalesList, Company/Contact/Deal Show (`NoraShowBoundary`), Checklisten-Ladevorgang.
- **Import (bestehend, dokumentiert):**
  - Importiert per JSON-Stream: `sales`, `companies`, `contacts`, `notes`, `tasks`.
  - **Nicht reversibel** — kein Rollback; Fehlerbericht-Download bei Teilausfällen.
  - **Kein** Preview/Mapping/Dubletten-Assistent — daher **nur Admin** (`configuration` edit) bis sicherer Import-Assistent existiert.
- **Keine** Migration, RLS, Google/OAuth, neue Rollenmatrix.

### Verifikation

- `noraV03k1Ux.test.ts` + `noraRbacUx.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅
- Manuelle Browser-Matrix: mit `DemoRoleSwitcher` / separaten Logins empfohlen (siehe Ergebnisbericht).

## 2026-07-14 – v0.3k.2: Demo-Rollensimulation und abschließende Rollen-UX-Abnahme

### Kontext

`DemoRoleSwitcher` wechselte die Rolle visuell, aber `authProvider.ts` setzte bei jedem Modul-Import `DEFAULT_USER` (Anna Admin) in `localStorage` und überschrieb damit den Rollenwechsel nach Reload. Zusätzlich konkurrierten React-Query-Persist-Cache und `logout→login`-Race mit der aktiven Identität.

### Entscheidung

- **Kanonische Demo-Quelle:** `providers/fakerest/demoSession.ts`
  - Speicher: `localStorage["user"]` (`NORA_DEMO_USER_STORAGE_KEY`)
  - Statische Demo-Benutzer (`DEMO_SALES_BY_ROLE`) — keine async-Race beim Wechsel
  - `authProvider.getIdentity` / `canAccess` / `checkAuth` lesen ausschließlich daraus
  - **Kein** Überschreiben bei Modul-Import; `ensureDemoSession()` nur wenn leer
- **Rollenwechsel:** `useSwitchDemoRole` + `finalizeDemoSessionSwitch` — setzt Session, leert `REACT_QUERY_OFFLINE_CACHE`, `queryClient.clear()`, kontrollierter `location.assign`
- **Demo-Login:** `LoginPage` nutzt `useFinalizeDemoLogin` — gleiche Cache-Invalidierung wie Role-Switcher (verhindert Identity-Desync bei Login ohne vorheriges Logout)
- **Post-Switch-Navigation:** `resolveDemoPostSwitchUrl` für `/settings`, `/import`, `/sales`, Viewer-Edit-URLs
- **Hinweis im UI:** „Demo-Rolle – simuliert nur die Oberfläche“
- **Direkte Logins** (`admin@` / `office@` / `viewer@nora.demo`) bleiben Referenz für Abnahme
- **Keine** Production-Auth-Änderung, **keine** RLS-Umgehung

### Verifikation

- `demoRoleSimulation.test.ts` ✅
- `docs/nora/12-role-ux-acceptance.md` (Abnahmeprotokoll)
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅

## 2026-07-15 – v0.3l: Vollständiger CRM-Audit-Verlauf

### Kontext

Checklisten-Audit (`audit_events`, v0.3d2) deckte nur Checklisten, Snippets und `deal.stage_changed` ab. Office hatte globales SELECT auf `audit_events`. Vorgänge, Kunden, Aufgaben und Notizen brauchten serverseitige Trigger und kontextbezogene UI.

### Entscheidung

- **Eine Tabelle:** `audit_events` erweitert um Actor-Snapshots, `source`, `retention_class`, `task_id`, `note_id`
- **Schreib-Capability:** `nora_audit_writer` (NOLOGIN, INSERT-only) via `nora_private.write_audit_event`
- **Trigger** für companies, contacts, deals (ersetzt stage-only), tasks, contact_notes, deal_notes, sales (role/disabled)
- **Kompakte Änderungen** in `metadata.changes`; Notizen ohne Volltext
- **Lesen:** Admin global (`/audit` + `get_global_audit_events`); Office nur `get_entity_audit_events`; Viewer kein Zugriff
- **RLS:** direktes SELECT nur admin (Office-Policy entfernt)
- **Demo:** synthetische Events mit `source=demo`
- Spezifikation: `docs/nora/13-crm-audit-retention.md`

### Verifikation

- Migration `20260715120000_nora_crm_audit.sql`
- `crm_audit_verification.sql`, aktualisierte `rbac_rls_matrix.sql`
- `auditUx.test.ts` ✅
- `npm run typecheck` / `npm run build`

## 2026-07-15 – v0.3l.1: CRM-Audit-Abschluss (Schema-Sync, Tests, Abnahme)

### Kontext

v0.3l lieferte Migration, Trigger, RPCs und UI-Grundgerüst. v0.3l.1 schließt Schema-Synchronisation, SQL-Verifikation, Frontend-Formatierung und die Rollen-Matrix für den produktionsnahen Demo-Betrieb ab.

### Entscheidung

- **Schema-Sync:** Migrations- und Schema-Dateien (`01_tables`, `04_triggers`, `05_policies`) konsistent mit v0.3l-Audit-Erweiterung
- **Kanonischer Status-Event:** neue Trigger schreiben `deal.status_changed`; Legacy `deal.stage_changed` (v0.3d2) bleibt lesbar — UI mappt beide auf „Vorgangsstatus geändert“
- **Checklisten-Audit unverändert:** keine doppelten Events; CRM-Trigger ergänzen, ersetzen Checklisten-Trigger nicht
- **Tests:** `crm_audit_verification.sql` neu; `rbac_rls_matrix.sql` und `checklists_audit_verification.sql` angepasst; `auditUx.test.ts` für Formatter/Legacy-Label
- **Zurückgestellt:** Befüllung `event_hash`, `request_id`; externer WORM-Export; automatischer Purge
- **Immutability-Grenze:** append-only für App-Rollen — kein Anspruch auf Superuser-/Offline-Schutz ohne externen Export
- **Manuelle Abnahme:** Demo-Rollenmatrix admin (global + Akte), office (nur Akte), viewer (kein Audit)

### Verifikation

- `npx supabase db reset --local` ✅
- `crm_audit_verification.sql` + `rbac_rls_matrix.sql` + `checklists_audit_verification.sql` ✅
- `auditUx.test.ts` ✅
- `npm run typecheck` / `npm run build` / `npm run dev:demo` ✅
- Manuelle Rollenprüfung in Demo empfohlen (siehe `07-agent-change-checklist.md`, v0.3l-Abschnitt)

## 2026-07-16 – v0.4c.1: Google-Kalender Read-only Grundlage

### Kontext

Spezifikation in `11-google-calendar-rbac.md`. Ziel: technische Grundlage für read-only Google-Kalender-Integration ohne OAuth-Produktivbetrieb.

### Entscheidung

- **System of Record:** Google Kalender; Nora = Cache (`google_calendar_events`) + CRM-Verknüpfung + Audit
- **Singleton:** max. eine `connected`-Verbindung (Partial Unique Index + Trigger)
- **Allowlist:** `configuration.config.google_calendar.allowed_calendar_ids` + Edge-Env `GOOGLE_CALENDAR_ALLOWED_ID`
- **Keine Tokens** in `connections`, `events`, `audit_events`; vorbereitete Ablage `nora_private.google_calendar_oauth_secrets`
- **Capability `nora_calendar_writer`:** kontrollierte Cache-Schreibzugriffe (Edge/Sync)
- **Link/Unlink-RPCs:** admin/office; GUC `nora.calendar_link_update` für kontrollierte FK-Updates ohne Google-Mutation
- **Edge Functions:** Struktur + CSRF-State; Token-Austausch/Sync bewusst **501/503** bis v0.4c.2
- **Demo:** Hinweis ohne Fake-OAuth
- **Audit:** `calendar.event_linked` / `calendar.event_unlinked`; `retention_class = integration`

### Verifikation

- Migration `20260716120000_google_calendar_readonly.sql` ✅
- `google_calendar_verification.sql` + bestehende RBAC/Audit/Checklisten-Tests ✅
- `config.test.ts` (Allowlist/Env) ✅
- `npm run typecheck` / `npm run build` ✅
- **Kein** OAuth-E2E mit echtem Testkalender in dieser Welle

## 2026-07-16 – v0.4c.2: Google OAuth, Token-Verschlüsselung, manueller Sync

### Entscheidung

- **GUC entfernt:** `nora.calendar_link_update` → Capability `nora_calendar_linker` + SECURITY DEFINER intern
- **OAuth:** openid, email, `calendar.events.owned.readonly`, `calendar.calendarlist.readonly` (nur CalendarList.get für Allowlist)
- **PKCE S256** + State-Hash, TTL 10 min, atomarer Consume
- **Token:** AES-GCM-256, Nonce pro Eintrag, Key Version; RPCs `store_/load_google_calendar_refresh_token`
- **Allowlist:** `GOOGLE_CALENDAR_ALLOWED_ID` bindend; DB-Config wird bei Connect synchronisiert, kann Edge nicht überschreiben
- **Sync:** Admin-only, 30/365 Tage, singleEvents, showDeleted, etag-basiertes Update, Audit-Summen
- **Datenminimierung:** description bevorzugt leer, max 500, kein HTML
- **Admin-UI:** `/google-kalender`
- **E2E:** dokumentiert, nicht automatisiert — Erfolg erst nach manuellem Testkalender-Lauf

### Verifikation

- Migration `20260717120000_google_calendar_oauth_sync.sql` ✅
- SQL- + Function-Tests ✅
- `npm run typecheck` / `npm run build` ✅
- **OAuth-E2E ausstehend** (Betreiber + isolierter Testkalender)

## 2026-07-17 – v0.4c.2c: Release-Gates und Deployment-Bereinigung

### Kontext

Der bisherige GitHub-Workflow `deploy.yml` stammte aus dem Atomic-CRM-Setup. Er
veröffentlichte Dokumentation, Demo und Supabase-Frontend über GitHub Pages und
konnte bei einem Push auf `main` zusätzlich Remote-Migrationen und Edge
Functions ausrollen. Nora nutzt für das Frontend die Vercel-Git-Integration;
die alten Ziel-Repositories und zugehörigen Secrets sind nicht Teil des
freigegebenen Nora-Produktionsablaufs.

### Entscheidung

- Der Legacy-Workflow `.github/workflows/deploy.yml` wird vollständig entfernt.
- Es wird kein Ersatz-Workflow für automatische Supabase-Migrationen, Edge
  Functions oder GitHub Pages angelegt.
- Vercel-Deployment und ein späterer Supabase-Production-Bootstrap bleiben
  getrennte, ausdrücklich freizugebende Betriebsaufgaben.
- ESLint und Prettier laufen als direkte, getrennte Jobs über die kanonischen
  npm-Skripte. Die von `wearerequired/lint-action` erzeugten widersprüchlichen
  Wrapper- und Child-Checks entfallen.
- Fehlgeschlagene E2E-Läufe laden Playwright-Kontext, Traces und HTML-Bericht
  als kurzlebiges GitHub-Artefakt hoch.

### Begründung

Damit lösen normale Nora-Codeänderungen keine unbekannten GitHub-Pages- oder
Supabase-Remote-Deployments mehr aus. Direkte npm-Skripte machen lokale und
GitHub-Prüfungen identisch und verhindern, dass ein erfolgreicher Wrapper-Job
gleichzeitig fehlgeschlagene ESLint-/Prettier-Child-Checks erzeugt.

## 2026-07-17 – v0.4c.2c: E2E-Bootstrap und Profilzugriff

### Kontext

Der E2E-Reset löschte den kanonischen `configuration`-Singleton. Gleichzeitig
wertete `nora_private.safe_auth_uid()` nur das Legacy-GUC
`request.jwt.claim.sub` aus, während aktuelle PostgREST-Anfragen den Betreff im
JSON-GUC `request.jwt.claims` bereitstellen. Dadurch verwarf die bestehende
Active-User-Prüfung selbst korrekt angelegte Auth-Benutzer.

### Entscheidung

- `configuration.id = 1` mit `config = {}` bleibt ein notwendiger
  Systemdatensatz und wird nach jedem E2E-Reset kanonisch wiederhergestellt und
  verifiziert.
- Der Auth-Provider liest das eigene vollständige Profil weiterhin aus
  `public.sales`. `sales_directory` bleibt das reduzierte Verzeichnis für
  Team-Auswahlen und enthält bewusst weder `user_id` noch Rollen- oder
  Aktivierungsdaten.
- `safe_auth_uid()` unterstützt das Legacy-GUC und das aktuelle
  `request.jwt.claims`-JSON. Ungültige oder fehlende Werte ergeben weiterhin
  `NULL`.
- Die Policy-Matrix bleibt unverändert: aktive Benutzer sehen in `sales` nur
  die eigene Zeile; Administratoren sehen alle Zeilen; anonyme und deaktivierte
  Benutzer sehen keine. Es wird keine Test-Policy und kein allgemeines
  `SELECT`-Recht ergänzt.
- Ein E2E-Preflight prüft Auth-Benutzer, Service-Role-Bootstrap, normale
  Passwort-Session und den authentifizierten Self-Select vor dem Browserlauf.
  Diagnosen nennen Schritt und Ressource, redigieren aber Schlüssel,
  Passwörter, JWTs und Authorization-Werte.

## 2026-07-17 – v0.4c.2c: E2E-Auth-Assertions und First-Run-Dashboard

### Kontext

Nach erfolgreichem Login rendert Nora ohne Kontakte den Onboarding-Stepper
(`DashboardStepper` Schritt 1), nicht das Hotboard. Der Login-Helper prüfte
fälschlich Hotboard und ließ First-Run- sowie Bulk-Tag-Tests scheitern.

### Entscheidung

- `loginAsAdmin` bestätigt nur Auth und die authentifizierte App-Shell
  (`data-testid="authenticated-app-shell"`), nicht Dashboard-Inhalte.
- First-Run und Hotboard sind getrennte E2E-Specs.
- Atomic-CRM-Telemetrie ist für Nora dauerhaft deaktiviert
  (`<CRM disableTelemetry />`).
- Der E2E-Build deaktiviert den PWA-Service-Worker; Produktion bleibt
  unverändert.

## 2026-07-24 – Rollen-RPC: service_role Claims-Erkennung

### Kontext

Admin-Rollenwechsel (viewer → admin) schlug fehl mit SQLSTATE 42501
`forbidden` in `set_sales_role_by_admin`, obwohl die Edge Function den
Service-Role-Client nutzte. Auth-Admin-Updates liefen vorher noch mit 200.

### Root Cause

`set_sales_role_by_admin` prüfte nur `request.jwt.claim.role`. Aktuelle
PostgREST-/supabase-js-Aufrufe setzen die Rolle unter
`request.jwt.claims` (JSON). Die Legacy-GUC blieb leer → Fallback auf
`nora_private.is_admin()` ohne sales-Profil der Service-Role → forbidden.

Zusätzlich führte PATCH immer `updateUserById` aus, auch bei reiner
Rollenänderung (Teilaktualisierungsrisiko).

### Entscheidung

- Neue additive Migration: `nora_private.safe_auth_role()` + RPC-Umstellung.
- Edge Function: feldexplizite PATCH-Planung; role-only ohne Auth-Admin.
- HTTP 42501 → 403 `role_update_forbidden`.
- Frontend sendet nur geänderte Felder.
- Kein Remote-Apply / kein Function-Deploy in diesem Commit.

## 2026-07-24 – Identity-Cache nach Profilnamensänderung

### Kontext

Nach erfolgreichem Speichern von Vor-/Nachname in `public.sales` zeigte das
Benutzermenü weiterhin „Pending Pending“, weil `getIdentity()` den Local-
Storage-Cache `RaStore.auth.current_sale` bevorzugte und `refetchIdentity()`
diesen nicht invalidierte.

### Entscheidung

- Cache-API im Auth-Provider: `clearCurrentSaleCache`, `setCurrentSaleCache`,
  `syncCurrentSaleCacheIfSelf`.
- Nach Namens-/Avatar-/Rollenänderungen am eigenen Profil: zuerst Cache aus
  DB-Rückgabe setzen, danach `refetchIdentity()`.
- Kein Löschen von Session-Tokens oder anderen RaStore-Keys.
- Admin-Edits fremder Benutzer aktualisieren den Identity-Cache nicht.

## 2026-07-23 – Mitarbeiterzugang: öffentliches Redesign und Einladung

### Kontext

Die öffentliche Fläche zeigte Nora als Produktmarke und bot eine öffentliche
Registrierung. Favicon-/Manifest-Einträge waren inkonsistent und teilweise
ungültig.

### Entscheidung

- Öffentliche Fläche: Ergart + „Mitarbeiterzugang“ + dezentes Smairys;
  Nora-Branding erst nach Anmeldung.
- Keine öffentliche Registrierung; `/sign-up` ist Einladungs-Hinweisseite;
  `dataProvider.signUp` wirft im Supabase-Modus.
- Kanonisches Favicon-/Manifest-Paket unter `public/` + `site.webmanifest`
  (`background_color`/`theme_color` `#2c2c2c`). VitePWA setzt `manifest: false`.
- Modi: Anmelden, Einladung aktivieren, Passwort vergessen.
- Onboarding nach Einladungslink: Passwort → Profil (Name) → Abschluss;
  keine Rollenwahl durch den Benutzer.
- HashRouter-Konflikt: Auth-Tokens weiter über `auth-callback.html`.
- Admin-Einladung: Edge Function `users` nutzt `inviteUserByEmail` +
  `set_sales_role_by_admin` + Audit `user.invited`. Redirect über `SITE_URL`
  bzw. Fallback `https://nora.ergart.de/auth-callback.html`.
- Kein Service-Role im Frontend/Vercel/`VITE_*`. Remote-Deploy und
  Production-Migration nicht Teil dieses Commits.

## 2026-07-23 – Profil-Update: Pending-Default und Rollen-Seiteneffekt

### Kontext

Neue Benutzer ohne Metadaten erscheinen als „Pending Pending“. Das Speichern
des eigenen Namens im Profil schlug fehl bzw. riskierte eine unbeabsichtigte
Rollenzurücksetzung auf `viewer`.

### Entscheidung

- „Pending“ ist nur ein Bootstrap-Platzhalter (`handle_new_user` / Spalten-Default),
  wenn bei der Einladung keine Namen mitgegeben wurden.
- Profil-Namensänderungen speichern über Auth-Metadaten + RLS-Update auf
  `sales` (ohne Edge-Privilege-Pfad).
- Edge Function `users` PATCH: Rolle/Disabled nur bei expliziter Angabe ändern;
  Namen immer auf `sales` setzen. Remote-Deploy der Function separat nötig.

## 2026-07-23 – DB-Lint: Funktionsvolatilität und ungenutzte Variablen

### Kontext

`supabase db lint` meldete 74 Warnungen ohne Fehler. Betroffen waren
überdeklarierte Volatilitätsklassen und ungenutzte Locals.

### Entscheidung

- `nora_private.audit_*_changes`: IMMUTABLE → STABLE. Die Diff-Logik liest
  keine Tabellen und ist semantisch deterministisch, aber plpgsql_check
  stuft die plpgsql-Zuweisungen über Composite-Felder als STABLE ein.
  Keine Funktionsindizes, Policies oder Planner-Pfade hängen an IMMUTABLE.
- `public.get_audit_storage_stats`: STABLE → VOLATILE wegen
  `pg_relation_size` / `pg_indexes_size`. Admin-RPC, selten aufgerufen.
- `get_avatar_for_email` / `get_domain_favicon`: ungenutzte Variablen
  entfernt; Verhalten unverändert.
- Additive Migration nur; keine Remote-/Production-Migration in diesem
  Schritt. Audit-Ausgabeform bleibt identisch.

## 2026-08-10 – Foundation Wave 1: Operation Correlation

### Kontext

Nora braucht eine nachvollziehbare Korrelation fachlich relevanter Schreiboperationen
vom Frontend bis zum bestehenden `audit_events`-Verlauf — ohne Operations-Feedback-UI,
Error Observatory, Archive Center oder Outbox.

### Entscheidung

- **operation_id** = clientseitig `crypto.randomUUID()`; Kurzform `OP-XXXX-XXXX` nur Anzeige später.
- Ownership: ID einmal am fachlichen Einstieg minten; Transport-Helper nur weiterreichen.
  Bereits gültiger `x-nora-operation-id` wird nicht still gegen eine neue UUID getauscht.
  Ungültige ID → soft neu minten (kein Throw, kein Security-Merkmal).
- Transport-Header: `x-nora-operation-id`.
- PostgreSQL: `nora_private.current_operation_id()` (**INVOKER**, nur GUC-Lesen) liest zuerst
  `nora.operation_id` (GUC), sonst `request.headers` → `x-nora-operation-id`;
  ungültig/fehlend/kaputtes JSON → `NULL`, nie Abbruch.
- `write_audit_event`: Signatur unverändert; `request_id` additiv; Correlation-Fehler → `NULL`.
- Bestehende Spalte `audit_events.request_id` wird vom zentralen Writer befüllt — keine zweite Spalte.
- Partial Index `audit_events_request_id_idx` (nicht unique).
- Vertikaler Slice: `dataProvider.update("deals")` injiziert den Header (reused, wenn schon gesetzt).
- RPC/Edge: wiederverwendbare Helper vorbereitet; keine breite Function-Migration.
- Keine Auth-/RLS-Nutzung der operation_id.
- Migration rückwärtskompatibel: altes Frontend ohne Header → `request_id = NULL`.

### Verifikation

- SQL-Test `supabase/tests/operation_correlation_verification.sql` (inkl. Header-Clear nach GUC).
- HTTP-Diagnose: `scripts/verify-operation-header.mjs` (mit/ohne Header; production URL blockiert).
- Bestehendes Nora-Muster `request.headers` bereits in Attachment-Trigger genutzt.

### Nicht in dieser Welle

Operations Feedback, Error Observatory, Archive Center, Domain Events/Outbox,
Realtime-Aktionen anderer Nutzer, breite RPC/Edge-Umbauten.

### Migration

`20260810160000_nora_operation_correlation.sql` — lokal anwenden; **kein** Remote-Apply in diesem Commit.


## 2026-08-15 – Kernindizes und Bundle-Budget

### Kontext

Nora soll produktiv eingesetzt werden. Zwei Messbefunde standen dem entgegen:

**Index-Asymmetrie.** Die Nora-eigenen Tabellen sind sorgfältig indiziert
(`audit_events` 9 Indizes, `operation_errors` 5, `checklist_*` und
`google_calendar_*` je 3–4). Der von Atomic CRM geerbte Kern hatte dagegen
nur Primärschlüssel und zwei Fremdschlüsselindizes: `deals` und `contacts`
je `company_id`, `companies` und `tasks` gar nichts. Ungedeckt waren damit
genau die heißen Pfade — `deals.stage` (jeder Kanban-Aufbau und jeder Drop),
`deals.expected_closing_date` (Hotboard, Nachfassen), `tasks.due_date`
(`TasksListByDueDate` mit `perPage: 1000`) sowie `tasks.contact_id`: ein
Fremdschlüssel ohne Index, wodurch jedes Löschen eines Kontakts wegen
`on delete cascade` einen Seq-Scan über `tasks` auslöst.

**Kein Code-Splitting.** In `src/` existiert kein einziges `React.lazy`; alle
Seiten werden in `CRM.tsx` statisch importiert. Zusätzlich fehlten
Vendor-Chunks, wodurch jedes Deployment den gesamten Browser-Cache
invalidiert, auch bei einer einzigen geänderten Zeile Anwendungscode.

### Entscheidung

- **Kernindizes** additiv per Migration `20260815120000_nora_core_indexes.sql`.
  Ausschließlich `create index if not exists`, keine Tabellen-, Policy- oder
  Funktionsänderung. Wo die Abfrage es hergibt, partielle bzw.
  zusammengesetzte Indizes statt Einzelspalten — `deals (stage, "index")
  where archived_at is null` deckt Kanban-Filter und -Sortierung gemeinsam ab.
- **Kein `CONCURRENTLY`.** Die Supabase-CLI umschließt Migrationen mit einer
  Transaktion, in der `create index concurrently` nicht zulässig ist. Bei der
  aktuellen Datenmenge liegt die Sperrdauer im Millisekundenbereich. Ab etwa
  100.000 Zeilen je Tabelle wäre eine separate, nicht transaktionale
  Migration nötig.
- **`supabase/schemas/01_tables.sql` mitgeführt.** Die Indizes stehen
  zusätzlich in der deklarativen Schema-Datei, damit Migrationen und Schema
  nicht auseinanderlaufen.
- **`sourcemap: false`** statt `"hidden"`. `"hidden"` erzeugt weiterhin
  `.map`-Dateien im Deploy-Ordner und entfernt nur die
  `//# sourceMappingURL`-Referenz — die Dateien bleiben unter ihrem
  bekannten Pfad (`*.js.map`) abrufbar und schützen den Quelltext nicht
  zuverlässig. Solange Nora keine private Sourcemap-Übertragung an ein
  Error-Monitoring besitzt, dürfen Produktions-Sourcemaps gar nicht erzeugt
  werden. `false` unterdrückt die Erzeugung vollständig.
- **`manualChunks` in Funktionsform**, nicht als Objekt. Die Objektform
  bricht den Build, wenn eine gelistete Abhängigkeit nicht im Modulgraph
  liegt; die Funktionsform ignoriert sie. Gruppen: `react`, `admin`,
  `charts`, `markdown`, `transfer`, `dnd`.
- **Bundle-Budget als CI-Gate** (`scripts/check-bundle-budget.mjs`),
  angehängt an den bestehenden Build-Job statt als eigener Job — spart einen
  zweiten `npm ci` und Build. `dist/stats.html` wird als Artefakt gesichert.
- **`visualizer({ open })` korrigiert:** GitHub Actions setzt `CI=true`, nicht
  `NODE_ENV=CI`. Die alte Bedingung hätte im Headless-Runner einen Browser
  zu öffnen versucht.

### Bewusst nicht in dieser Welle

**Code-Splitting per `React.lazy`.** Bei der Vorbereitung zeigte sich, dass
`Header.tsx` die Seitenkomponenten `ImportPage`, `AuditPage`,
`GoogleCalendarAdminPage` und `ChangelogPage` statisch importiert, um an
deren statisches `.path` zu gelangen (ebenso `SettingsPageMobile.tsx` für
`ChangelogPage.path`). Ein `React.lazy` allein in `CRM.tsx` würde diese
Chunks über den Header wieder ins Hauptbundle ziehen — die Wirkung wäre
null.

Sauberer Weg: Pfadkonstanten in eigene Module ziehen (wie bei
`auditPagePath.ts` und `googleCalendarAdminPath.ts` bereits vorhanden),
`Page.path = KONSTANTE` zur Rückwärtskompatibilität beibehalten, `Header.tsx`
und `SettingsPageMobile.tsx` auf die Konstanten umstellen, erst dann in
`CRM.tsx` lazy laden. Betrifft acht Dateien und gehört in einen eigenen
Commit mit laufendem `typecheck`.

Ebenfalls nicht enthalten: Dashboard-Snapshot-RPC, `deal.reorder` als RPC,
Operations-Resolver, Request-Zähler, `operation_metrics`.

### Verifikation

- `supabase/tests/core_indexes_verification.sql` — prüft die Existenz aller
  16 Indizes und schlägt zusätzlich fehl, sobald ein Fremdschlüssel auf einer
  Kerntabelle wieder ohne führenden Index angelegt wird.
- `npm run typecheck` und `npm run build` — grün, lokal nachvollzogen
  (2026-08-15).
- `node ./scripts/check-bundle-budget.mjs` — kalibriert (2026-08-15) anhand
  eines echten Produktions-Builds: Entry-Chunk gemessen 955 kB → Budget 1050
  kB (~10 % Headroom), Gesamt gemessen 2321 kB → Budget 2600 kB (~12 %
  Headroom). Die zuvor geschätzten Werte (900 / 3500 kB) hätten den
  aktuellen Build am Entry-Budget scheitern lassen.

### Nachtrag Review — zwei übersehene Fremdschlüssel

Die erste Fassung der Migration deckte 14 Indizes ab und hätte die eigene
Verifikation nicht bestanden: `contact_notes.sales_id`
(`contactNotes_sales_id_fkey`, **ON UPDATE CASCADE ON DELETE CASCADE**) und
`deal_notes.sales_id` (`dealNotes_sales_id_fkey`) waren weiterhin ohne Index.
Das ist exakt die Falle, wegen der die Migration überhaupt geschrieben wurde —
nur an Benutzern statt an Kontakten: das Löschen eines `sales`-Datensatzes
hätte einen Seq-Scan über `contact_notes` ausgelöst. Beide Indizes ergänzt
(partiell `where sales_id is not null`, ausreichend für FK-Prüfungen, da dort
nie nach NULL gesucht wird).

Zusätzlich im Verifikationsskript: der Tabellenabgleich lief über
`conrelid::regclass::text`. Dessen Textform hängt vom `search_path` ab — ohne
`public` darin hätte die `IN`-Liste nie getroffen und der Test wäre
stillschweigend grün gewesen. Jetzt über `pg_class.relname` +
`relnamespace`.

### Migration

`20260815120000_nora_core_indexes.sql` — lokal anwenden; **kein** Remote-Apply
in diesem Commit.
