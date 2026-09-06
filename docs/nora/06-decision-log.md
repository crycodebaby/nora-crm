# 06 – Decision Log Nora CRM

Dieses Dokument hält **durable Entscheidungen** fest: Architektur- und Produktregeln, die ein künftiger Agent kennen muss, um keine falsche Entscheidung zu treffen — jeweils mit Datum, Kontext, Entscheidung und Begründung, bewusst knapp.

**Was hier nicht mehr steht:** RC-SHAs, Migrations-Hashes, Testzahlen, Ledger-Korrekturen, Vercel-Deployments, Live-Smokes, Release-Reihenfolgen, Zwischenfälle. Diese Release-Evidenz liegt **unverändert im Originalwortlaut** im Release-Archiv (`releases/2026-06.md` … `releases/2026-09.md`, Index in `releases/README.md`). Jeder Eintrag unten verlinkt seinen Archiv-Originaleintrag („Archiv"). Die Dokumentationsarchitektur-Härtung vom 2026-09-06 hat diese Trennung eingeführt; der vorherige Stand dieser Datei ist über Git (`96fb1082`) und das Archiv vollständig rekonstruierbar.

Aktueller Zustand: `16-current-state.md`. Lifecycle-Architektur: `19-user-lifecycle-architecture.md`. Offene Punkte: `17-known-issues-and-planned-waves.md`.

**Neue Entscheidungen:** Datum, Kontext, Entscheidung, Begründung — hier knapp; Release-Evidenz in `releases/<jahr-monat>.md`; Eintrag in der Index-Tabelle unten ergänzen.

## Index (thematisch, neueste zuerst)

| Bereich | Entscheidung |
|---|---|
| Mitarbeiter-Lifecycle | [W6-A Session-Autorisierung fail-closed](#2026-09-06--user-lifecycle-w6-a-session-autorisierung-fail-closed-und-owner-gebunden) · [W5 Offboarding & Sitzungen](#2026-09-06--user-lifecycle-w5-kontrolliertes-offboarding-session-revokation-abhängigkeits-preview) · [W4 Anmeldeadresse](#2026-09-06--user-lifecycle-w4-kontrollierte-änderung-der-anmeldeadresse-login-identität) · [W3 Audit-Actor](#2026-09-05--user-lifecycle-w3-der-echte-administrator-steht-im-audit-der-mitarbeiter-hat-eine-stabile-audit-identität) · [W2 Referenzintegrität](#2026-09-05--user-lifecycle-w2-referenzintegrität-und-historische-identität) · [W1 Executor](#2026-09-05--user-lifecycle-w1-ein-privilegierter-executor-selbst-letzter-admin-schutz-zugangskonsistenz) · [V1B Präsentation](#2026-09-04--employee-onboarding--access-v1b-präsentation-über-dem-eingefrorenen-v1a-contract) · [V1A Zugangsstatus](#2026-09-04--employee-onboarding--access-v1a-zugangsstatus-wird-abgeleitet-nicht-gespeichert) · [Mitarbeiterzugang einladungsbasiert](#2026-07-23--mitarbeiterzugang-öffentliches-redesign-und-einladung) |
| E-Mail-Zustellung | [V1C-B Zustellstatus-UI](#2026-09-04--employee-access-v1c-b-zustellstatus-wird-gezeigt-die-mailart-nicht) · [V1C-A Best-Effort-Korrelation](#2026-09-04--employee-access-v1c-a-zustellbeobachtung-ist-best-effort-korrelation-kein-öffnungs-tracking) |
| Security / Privilegien | [Wave 0 TRUNCATE](#2026-09-04--security-hardening-wave-0-truncate-auf-audit_events-entzogen) · [Residual Advisor Closure](#2026-08-28--residual-security-advisor-closure) · [Privilegierte Read-Views](#2026-08-28--intentional-privileged-read-views-init_state--sales_directory) · [RBAC-Abschluss v0.4b.2](#2026-07-14--v04b2-rbac-abschluss-capability-parallel-admin-sales_directory) · [RBAC-Hardening v0.4b.1](#2026-07-14--v04b1-rbac-migrations--und-function-hardening) · [RBAC/RLS v0.4b](#2026-07-14--v04b-rbac--und-rls-härtung) · [Rollenbewusste UX v0.3k](#2026-07-14--v03k-rollenbewusste-ux-ladezustände-und-fehlertoleranz) |
| PWA | [Update-Lifecycle 1B–V2 (konsolidiert)](#2026-08-30--2026-09-01--pwa-update-lifecycle-wartender-worker-browser-fakten-systemereignis) |
| Kunden / Kontakte / Vorgänge | [Customer Create Speed & Clarity](#2026-09-01--customer-create-speed--clarity-land-ausgeblendet-bundesland-nrw-weitere-angaben-eingeklappt) · [Kanban Navigation Rail](#2026-08-30--vorgänge-kanban-navigation-rail) · [Kontakterstellung UI-Polish](#2026-08-28--kontakterstellung-ui-polish) · [Pre-Production Hardening](#2026-08-27--pre-production-hardening-patch) · [Self Contact Wave](#2026-08-26--self-contact-wave) · [Unified Tasks Wave](#2026-08-25--unified-tasks-wave) · [Customer & Contact Workflow Wave](#2026-08-25--customer--contact-workflow-wave) |
| Operationen / Fehler / Feedback | [Notification Presentation Contract 7A/7B](#2026-08-29--notification-presentation-contract-v1-phase-7a) · [Operation Status Contract v1](#2026-08-29--operation-status-contract-wave-v1-createquickcapturecase-slice) · [Idempotency Wave](#2026-08-29--idempotency-wave) · [Error Contract Wave](#2026-08-28--error-contract-wave) · [Error Observatory (FW3)](#2026-08-10--foundation-wave-3-error-observatory-core) · [Operation Manager (FW2)](#2026-08-10--foundation-wave-2-operation-manager--catalog) · [Operation Correlation (FW1)](#2026-08-10--foundation-wave-1-operation-correlation) · [Portal-Form-Owner (Gates 2/2b)](#2026-08-10--stabilization-gates-22b-form-owner-im-radix-portal) |
| Performance / Build | [Kernindizes und Bundle-Budget](#2026-08-15--kernindizes-und-bundle-budget) · [Migrationsregel: View-Spalten ans Ende](#2026-08-25--erste-lokale-postgres-verifikation-der-customer--contact-workflow-migration) · [Release-Gates ohne Remote-Deploy aus CI](#2026-07-17--v04c2c-release-gates-und-deployment-bereinigung) |
| Audit / Historie | [CRM-Audit v0.3l](#2026-07-15--v03l-vollständiger-crm-audit-verlauf) · [Checklisten/Audit-Datenmodell 7b](#2026-06-28--welle-7b-checklisten--textbaustein--und-audit-datenmodell-spezifiziert) |
| Google Kalender | [OAuth & Sync v0.4c.2](#2026-07-16--v04c2-google-oauth-token-verschlüsselung-manueller-sync) · [Read-only-Grundlage v0.4c.1](#2026-07-16--v04c1-google-kalender-read-only-grundlage) · [Architektur & Rollenmodell v0.4a](#2026-07-14--v04a-google-kalender-architektur-und-nora-rollenmodell-spezifiziert) |
| Fachliches Fundament | [Schnellerfassung UX v0.3g](#2026-07-14--v03g-schnellerfassung-ux-überarbeitung) · [Dubletten v0.3f](#2026-06-28--v03f-intelligente-dubletten-vorschläge) · [Schnellerfassung v0.3e](#2026-06-28--v03e-schnellerfassung--eingangszentrale) · [Hotboard v0.3b](#2026-06-28--v03b-hotboard--operative-startübersicht) · [Globale Suche 6d](#2026-06-28--welle-6d-globale-suche-im-header) · [Fensterauftrag 7a](#2026-06-28--welle-7a-fensterauftrag-prozess-spezifiziert) · [Nummern 6c](#2026-06-28--welle-6c-kundennummern-und-vorgangsnummern-implementiert) · [Nachfassen 5](#2026-06-28--welle-5-vorgangsworkflow-ohne-db-änderung) · [Typografie 4](#2026-06-28--welle-4-typografie-und-comfortable-density) · [Basisentscheidungen 2026-06-28](#2026-06-28--basisentscheidungen-atomic-crm-resource-namen-vorgänge-brandfarbe-eur-demo-daten) |

Nur im Archiv (reine Release-Historie, keine eigene durable Regel): siehe Tabelle „Nur archivierte Einträge" am Ende.

---

## 2026-09-06 – User Lifecycle W6-A: Session-Autorisierung fail-closed und Owner-gebunden

**Status:** `PRODUCTION VERIFIED` (2026-09-06; Laufzeit-SHA `401bb08b`, Migration `20260906210000_nora_lifecycle_session_authorization` live, nur Datenbank, keine sichtbare Änderung). Aktuelle Architektur: `19-user-lifecycle-architecture.md` §11. Release-Evidenz: `releases/2026-09.md` ([Nachtrag Release W6-A](releases/2026-09.md#2026-09-06--user-lifecycle-w6-a-session-autorisierung-fail-closed-und-owner-gebunden)).

**Kontext.** W5 band die Autorisierung an eine lebende Sitzung, ließ aber drei Schwächen bewusst offen. Alle drei wurden vor der Änderung lokal reproduziert (GoTrue 2.196, PostgREST 16, echte Sitzungen): ein JWT mit der lebenden Sitzung eines **anderen** Benutzers bestand die Existenzprüfung; ein malformed `session_id`-Claim (ungültiger String, JSON `null`, Zahl, Array) fiel auf den No-Claim-Pfad und wurde erlaubt; ohne Leserecht auf `auth.sessions` antwortete der Helfer mit `WARNING` „live".

**Entscheidungen.**

1. **Drei-Zustands-Vertrag statt „NULL = kein Claim".** `jwt_session_claim()` liefert `absent` \| `present` \| `malformed` plus „JWT übergeben". `present` autorisiert nur bei `auth.sessions.id = session_id` **und** `auth.sessions.user_id = sub`; `malformed` verweigert; jeder Lookup-Fehler verweigert (`WARNING` „session binding DENIED").
2. **Der Kompatibilitätspfad wird so eng wie praktikabel.** Ein von PostgREST übergebenes JWT (`request.jwt.claims` gesetzt) ohne `session_id` wird verweigert: PostgREST ≥ 9 setzt nur diese eine GUC (lokal v16.1, Production 14.5), jedes GoTrue-Benutzertoken trägt `session_id`, Token ohne `sub` (anon/service_role) erreichten die Daten ohnehin nie. Nur ohne jedes übergebene JWT (Legacy-Fixture-GUCs, `psql`, Trigger-Kontexte) bleibt das Vor-W5-Verhalten — über die API unerreichbar. Keine neue Auth-Schicht, keine Session-Checks in einzelnen Policies.
3. **Fail-closed braucht ein Gate, keinen Monitor.** Die Migration verweigert die Installation, wenn `postgres` `auth.sessions` nicht lesen kann (Privileg **und** Lookup-Probe), und testet den Vertrag vor dem Commit selbst. `nora_private.session_binding_health()` ist ein postgres-interner Gesundheitsprimitive ohne Sitzungsdaten für Suites, Runbook und Störungsdiagnose — **kein** Admin-Browser-RPC (ein Admin könnte ihn bei gebrochener Bindung nicht mehr autorisieren) und keine Edge-Änderung.
4. **JSON `null` ist malformed, nicht absent.** GoTrue emittiert nie `null`; ein vorhandener, unbrauchbarer Claim wird nicht stillschweigend als Abwesenheit gewertet.
5. **Fixtures modellieren echte Sitzungen.** Suites, die den API-Pfad (`request.jwt.claims`) spielen, legen eine `auth.sessions`-Zeile an (Konvention: Sitzungs-ID = User-ID); Suites mit reinen Legacy-GUCs bleiben als dokumentierter „kein JWT übergeben"-Kontext unverändert.
6. **Kein Hard Delete in dieser Welle** (W6-B getrennt: irreversible Funktion und CRM-weite Autorisierungsänderung teilen sich keine Migration).

**Begründung.** Die Sicherheitsinvariante „eine Sitzung autorisiert nur ihren Besitzer" ist nur mit Owner-Vergleich und Fail-closed vollständig; die Kosten sind ein Spaltenvergleich im bestehenden PK-Lookup. Der breite No-Claim-Pfad war eine Kompatibilitätsvermutung, keine Notwendigkeit — nach dem Beweis, dass echte Tokens immer `session_id` tragen, ist sein Erhalt für transportierte JWTs reines Restrisiko.

## 2026-09-06 – User Lifecycle W5: kontrolliertes Offboarding, Session-Revokation, Abhängigkeits-Preview

**Status:** `PRODUCTION VERIFIED` (2026-09-06). Archiv: `releases/2026-09.md` ([Original](releases/2026-09.md#2026-09-06--user-lifecycle-w5-kontrolliertes-offboarding-session-revokation-abhängigkeits-preview)). Aktuelle Architektur: `19-user-lifecycle-architecture.md` §11–§14.

**Kontext.** Deaktivieren (W1) beendete keine Sitzungen: GoTrue hat keinen Admin-Logout, PostgREST prüft nie, ob die im JWT genannte Sitzung existiert — ein vor dem Deaktivieren ausgestelltes Token bekam mit der Reaktivierung für seine Restlaufzeit wieder Datenzugriff (lokal bewiesen).

**Entscheidungen.**

1. **Offboarding ist eine eigene Geschäftsoperation, kein PATCH.** „Zugang beenden" = kein operativer Zugang mehr; Person, Historie, Referenzen bleiben; nichts wird gemailt. Ein Serverpfad: `users` Edge → `offboard_employee_by_executor` → W1-Capability + Sitzungslöschung + Audit in **einer** Transaktion → Bann → Verifikation. Kein paralleles Subsystem.
2. **Offene Zuständigkeiten blockieren nie.** Sie werden gezählt (Kunden, Kontakte, offene Vorgänge, offene Aufgaben; Notizen getrennt als Urheberschaft) und als dauerhafter Block „Offene Zuständigkeiten" in jedem Zugangszustand gezeigt — auch bei null. Keine Massen-Umverteilung.
3. **Sitzungen sind Teil der Autorisierung.** Die RLS-Helfer (`is_active_user`, `current_role`) verlangen, dass die im JWT genannte Sitzung in `auth.sessions` existiert; Tokens ohne Claim und `service_role` unverändert. Fail-open nur bei fehlendem Leserecht (dokumentierte, nicht angreiferseitig erreichbare Einschränkung) — **in W6-A geschlossen** (siehe Eintrag oben).
4. **Idempotenz über `disposition`, nicht über Zustandsfelder.** `executed` schreibt genau ein `user.offboarded`; `replayed` ändert und schreibt nichts. Kein `offboarded_at`, kein fünfter Zugangsstatus.
5. **Reaktivierung bleibt W1**; alte Sitzungen kommen nicht zurück, neue Anmeldung nötig. Kein `p_reason` (Freitext im Audit wäre Retentions-relevant).

**Begründung.** Ein Bann stoppt neue Token, nicht laufende; nur die Datenbank kann ein unverfallenes JWT wirksam entwerten. Offboarding als eigene Aktion mit Preview verhindert, dass Zuständigkeiten stillschweigend verwaisen oder ein Zugang aus „Rücksicht" aktiv bleibt.

## 2026-09-06 – User Lifecycle W4: kontrollierte Änderung der Anmeldeadresse (Login-Identität)

**Status:** `PRODUCTION VERIFIED` (2026-09-06). Archiv: [Original](releases/2026-09.md#2026-09-06--user-lifecycle-w4-kontrollierte-änderung-der-anmeldeadresse-login-identität). Architektur: `19-user-lifecycle-architecture.md` §9.

**Kontext.** Eine Auth-E-Mail-Änderung scheiterte am Privileg-Trigger (`sales.email is immutable`) — fail closed, aber kein unterstützter Weg. Zusätzlich (GoTrue-Fakt, bewiesen): ein an die alte Adresse gesendeter Einladungs-/Passwort-Link blieb nach A→B gültig und aktivierte das Konto unter B.

**Entscheidungen.**

1. **`auth.users.email` ist die Auth-Identität; `sales.email` ist ihr Spiegel mit genau einem Schreiber** (`guard_auth_email_change`, Capability-Owner `nora_identity_manager`, darf nur `email`). `handle_update_user` schreibt keine E-Mail mehr.
2. **Ticket + Guard statt verteilter Transaktion.** `prepare_sales_email_change` prüft alles vorab und legt ein kurzlebiges Ticket an; GoTrues eigenes `UPDATE auth.users` wird ohne Ticket verweigert — auch mit Service-Key, Selbstbedienung oder Dashboard. Mit Ticket: `sales.email`, Löschung aller `auth.one_time_tokens`, Audit in derselben Transaktion.
3. **Zugang und Identität sind orthogonal.** Eine E-Mail-Änderung aktiviert/deaktiviert nie; Eingeladene bekommen eine neue Einladung, Deaktivierte nichts.
4. **Normalisierung ist Provider-Contract** (`lower(btrim())`, citext, `uq__sales__email`, Eindeutigkeit gegen `sales` und `auth.users`).
5. **Selbständerung blockiert** (Lockout-Schutz); **kein generischer PATCH für die E-Mail** (`email_change_requires_command`); Erfolg nur nach Verifikation; Retry = typisiertes No-op.

**Begründung.** Zwei Speicher für eine Identität dürfen nie auseinanderlaufen; das geht nur, wenn der Provider-Write selbst durch Noras Guard läuft. Alte Links müssen mit der Adresse sterben, sonst aktiviert der falsche Empfänger das Konto.

## 2026-09-05 – User Lifecycle W3: der echte Administrator steht im Audit, der Mitarbeiter hat eine stabile Audit-Identität

**Status:** `PRODUCTION VERIFIED` (2026-09-06). Archiv: [Original](releases/2026-09.md#2026-09-05--user-lifecycle-w3-der-echte-administrator-steht-im-audit-der-mitarbeiter-hat-eine-stabile-audit-identität). Architektur: `19-user-lifecycle-architecture.md` §10, `13-crm-audit-retention.md`.

**Kontext.** Alle Lifecycle-Audit-Zeilen trugen Actor `System` (die Edge Function spricht als `service_role` ohne `sub`), und die Edge-eigenen Ereignisse hatten zufällige `entity_id`s.

**Entscheidungen.**

1. **Actor ≠ Ziel ≠ Operation** sind drei getrennte Fakten: `actor_*` (wer), `entity_id = nora_entity_uuid('sales', id)` (welcher Mitarbeiter, stabil), `request_id` (welche Ausführung, Operation-ID).
2. **Actor-Bridge statt neuem Audit-System.** Unter `service_role` löst `resolve_audit_actor()` den vom Executor transaktionslokal verankerten, verifizierten Admin aus `public.sales` auf; verankern darf nur der privilegierte Executor (`pin_audit_context`). Eine verankerte Nicht-Existenz bricht hart ab — nie stille Degradierung zu „System", nie eine behauptete Person.
3. **Ein schmaler Writer** (`record_employee_admin_event`, Ereignistyp-Allowlist, Metadaten aus der DB) statt generischer Schreibfähigkeit; nie `insert_audit_event` + `crypto.randomUUID()`.
4. **`System` bleibt gültig** für echte Automation (unverankerte `service_role`-Writes).
5. **Historie bleibt unverändert** (append-only, kein Backfill) — alte Zeilen sind wahre Aufzeichnungen der alten Implementierung.
6. **Audit-Fehler nach Provider-Erfolg → `audit_write_failed`, nie grün.** Kein Audit ohne Änderung, keine Änderung ohne Audit.

## 2026-09-05 – User Lifecycle W2: Referenzintegrität und historische Identität

**Status:** `PRODUCTION VERIFIED` (2026-09-05). Archiv: [Original](releases/2026-09.md#2026-09-05--user-lifecycle-w2-referenzintegrität-und-historische-identität). Architektur: `19-user-lifecycle-architecture.md` §7–§8, `03-data-model-guardrails.md` Falle 39.

**Kontext.** `contact_notes.sales_id` war `ON DELETE CASCADE` (Mitarbeiter löschen = Notizen still löschen), `tasks.sales_id` hatte keinen FK, und der einzige Namens-Lookup filterte deaktivierte Mitarbeiter weg (leere Namen, Export-Crash).

**Entscheidungen.**

1. **Produktregel:** ein echter Mitarbeiter mit Geschäftshistorie wird **offboarded, nicht hart gelöscht**. Hard Delete ist nur für Fake-/Versehens-/Testkonten ohne Referenzen (späterer Executor).
2. **INAKTIV / ARCHIVIERT ist nicht NICHT-EXISTENT** (Nora-Domänenregel, in W2 für Mitarbeiter umgesetzt, perspektivisch für Kunden/Kontakte/Vorgänge; kein generisches Archiv-Framework).
3. **Alle Referenzen auf `sales.id` sind `NO ACTION`-FKs** — nie `CASCADE`, nie `SET NULL`. Die Datenbank blockiert das Löschen referenzierter Identitäten auf jedem Pfad; Browser-Rollen können nie löschen.
4. **Zwei Read-Models:** `sales_directory` (aktiv, Zuweisung) und `sales_identities` (alle, historische Namen). Deaktivierte behalten ihren echten Namen; kein „Unbekannt"/„Ehemalig".
5. **Aktive Zuweisung ist autoritativ** (Hardening): Trigger auf `companies`/`contacts`/`deals`/`tasks` verweigert Neuzuweisung an Deaktivierte (`NORA_EMPLOYEE_NOT_ASSIGNABLE`); Notiztabellen (Urheberschaft) bewusst nicht.
6. Legacy-RPC `set_sales_role_by_admin` gelöscht (kein Aufrufer).

**Begründung.** Geschäftsdaten müssen den Mitarbeiter-Lebenszyklus überleben; Urheberschaft und Zuständigkeit sind Geschäftsgeschichte. Ein Snapshot nur zur Rechtfertigung von `SET NULL` wäre Doppelhaltung.

## 2026-09-05 – User Lifecycle W1: ein privilegierter Executor, Selbst-/Letzter-Admin-Schutz, Zugangskonsistenz

**Status:** `PRODUCTION VERIFIED` (2026-09-05). Archiv: [Original](releases/2026-09.md#2026-09-05--user-lifecycle-w1-ein-privilegierter-executor-selbst-letzter-admin-schutz-zugangskonsistenz). Architektur: `19-user-lifecycle-architecture.md` §5–§6.

**Kontext.** Es gab zwei Wege, `sales.role`/`sales.disabled` zu ändern (Edge Function und eine für `authenticated` ausführbare RPC); ein Admin konnte sich selbst deaktivieren, null aktive Admins waren möglich, und Production hatte genau eine Zugangs-Drift (deaktiviert ohne Bann).

**Entscheidungen.**

1. **Genau ein normaler privilegierter Pfad:** Admin-UI → `users` Edge → `set_sales_access_by_executor` (nur `service_role`) → Capability-Funktion. Browser können die RPC nicht ausführen.
2. **Verifizierter Actor-Kontext statt geratener Identität:** die Edge Function verifiziert das JWT und übergibt nur die User-ID; der Executor akzeptiert nur einen existierenden aktiven Admin — der Parameter kann Rechte nur verengen.
3. **Selbstschutz serverseitig, zweifach** (Edge und Datenbank); Re-Sync unveränderter Werte bleibt erlaubt.
4. **Letzter aktiver Administrator ist eine Datenbank-Invariante** (Trigger, Advisory-Lock, jeder Schreibpfad). Genau ein Admin genügt. Der Auth-Bann ist nicht Teil der Definition (Fremdsystem-Zustand).
5. **Zugangskonsistenz als eigener Fakt** (`accessConsistency`), kein fünfter Zustand; eine Reparatur „Zugangsstatus synchronisieren".
6. **Reihenfolge:** Datenbank → Auth-Bann → beide Fakten erneut lesen; Teilausfall meldet `employee_access_sync_incomplete`, nie grün; Retry konvergiert. Bewusst keine verteilte Transaktion.

## 2026-09-04 – Security Hardening Wave 0: TRUNCATE auf `audit_events` entzogen

**Status:** `PRODUCTION VERIFIED` (2026-09-04). Archiv: [Original](releases/2026-09.md#2026-09-04--security-hardening-wave-0-truncate-auf-audit_events-entzogen).

**Kontext.** `authenticated` besaß `TRUNCATE` (plus `REFERENCES`/`TRIGGER`/`MAINTAIN`) auf `audit_events` — geerbt aus den Default-Privilegien des Schemas `public`, weil Migrationen nur additiv `grant select` schrieben. `TRUNCATE` umgeht RLS und feuert keine Row-Trigger; die gesamte Historie war mit einer Anweisung löschbar.

**Entscheidungen.**

1. `authenticated` auf `audit_events` = **genau `SELECT`** (`revoke all` → `grant select`, `revoke all from public/anon`).
2. **Guardrail: immer `revoke all` vor `grant`** — ein additives `grant` lässt geerbte Rechte stehen.
3. **Guardrail: ein lokaler `db reset` reproduziert Production nicht** (lokal `grant all` in den Default-Privilegien, live `Dxtm`) — Privilegienaussagen gegen Production prüfen; Migrationen müssen in beiden Umgebungen denselben Endzustand erzwingen.
4. `service_role` behält `TRUNCATE` (bewusst akzeptiertes Restrisiko; Retention-Pfade); die schemaweiten Default-Privilegien bleiben ein eigener Folgebefund (`17-known-issues-and-planned-waves.md`).

## 2026-09-04 – Employee Access V1C-B: Zustellstatus wird gezeigt, die Mailart nicht

**Status:** `PRODUCTION VERIFIED` (2026-09-04). Archiv: [Original](releases/2026-09.md#2026-09-04--employee-access-v1c-b-zustellstatus-wird-gezeigt-die-mailart-nicht). Technischer Vertrag: `18-email-delivery-observability.md`.

**Entscheidungen.** Die Mailart wird **nie gerendert** (Best-Effort-Korrelation trägt keine Aussage über *einen* Sendeversuch); Zustellstatus ist dem Zugangszustand **untergeordnet** (eine gedämpfte Zeile, keine Status-Pille, kein Dashboard); **ohne Historie erscheint nichts** (auch bei Ladefehler oder fehlender Berechtigung); kein geratener Betreff-Matcher (stattdessen ein inhaltsfreies `subject_present`-Diagnosebit); Zeiten in `Europe/Berlin`. Deterministische Sendekorrelation, Brevo-API-Versand, Öffnungs-/Klick-Tracking und feinere `undeliverable`-Unterscheidung sind geparkt.

## 2026-09-04 – Employee Access V1C-A: Zustellbeobachtung ist Best-Effort-Korrelation, kein Öffnungs-Tracking

**Status:** `PRODUCTION VERIFIED` (2026-09-04). Archiv: [Original](releases/2026-09.md#2026-09-04--employee-access-v1c-a-zustellbeobachtung-ist-best-effort-korrelation-kein-öffnungs-tracking). Vertrag: `18-email-delivery-observability.md`.

**Entscheidungen.**

1. Absender `Nora <zugang@nora.ergart.de>` über Brevo als Supabase-Auth-SMTP; **kein eigenes Auth-Mailsystem**.
2. **Korrelation ist `BEST_EFFORT` und steht in den Daten** (Zuordnung über die Empfängeradresse; GoTrue erlaubt keinen Nora-Korrelationswert). Deterministisch nur über den Send Email Hook — eigene Architekturentscheidung, nicht getroffen.
3. **Kein Öffnungs-/Klick-Tracking** (Endpunkt verwirft, CHECK verhindert) — Betriebsbeobachtung, keine Mitarbeiterüberwachung.
4. **Providerneutraler Vertrag** (`EMAIL_ACCEPTED` … `EMAIL_SPAM_REPORTED` → `accepted/delayed/delivered/undeliverable/spam_reported`); Produktwahrheit „angefordert ≠ angenommen ≠ zugestellt"; Reihenfolge nach Provider-Zeitstempel, Duplikate per `dedupe_key`.
5. Webhook-Auth über dedizierten Bearer-Token (nie den Brevo-API-Key); `email_delivery_events` append-only, Admin-Leserecht, weiche `employee_sale_id` + Adress-Snapshot, kein Inhalt/Betreff/Token.
6. **Audit-Grenze:** Transportereignisse landen nie in `audit_events`.
7. Nachtrag Review: Brevo nutzt zwei Vokabulare (Abo-Enum camelCase vs. Nutzlast snake_case) — beide akzeptieren, unbekannte Werte diagnostisch loggen, nie raten; `provider_reason` begrenzt speichern.

## 2026-09-04 – Employee Onboarding & Access V1B: Präsentation über dem eingefrorenen V1A-Contract

**Status:** `PRODUCTION VERIFIED`, PO UX accepted (2026-09-04). Archiv: [Original](releases/2026-09.md#2026-09-04--employee-onboarding--access-v1b-präsentation-über-dem-eingefrorenen-v1a-contract). Gestaltung: `02-design-system.md` „Mitarbeiter-Onboarding & Zugang".

**Entscheidungen.** Präsentation berührt keine Semantik (Zustandsmaschine, Auth, Routen, Edge unverändert; Erfolgs-Mark nur im Reducer-Zustand `complete`); drei menschliche Schritte (Zugang → Passwort → Profil, Abschluss ist Erfolgszustand); Begrüßung nur aus der Session, nie aus URL-Parametern; Profilschritt sagt „Passwort gespeichert", kein Weg zurück vor das Passwort; Einmalcode nur für die Einladung; Fehler inline, nie als Toast; Admin-Status als Pill, ein Schreibpfad; Demo-Simulation bleibt im Code (nur `VITE_IS_DEMO`, nicht im Production-Bundle).

## 2026-09-04 – Employee Onboarding & Access V1A: Zugangsstatus wird abgeleitet, nicht gespeichert

**Status:** `PRODUCTION VERIFIED` (2026-09-04). Archiv: [Original](releases/2026-09.md#2026-09-04--employee-onboarding--access-v1a-zugangsstatus-wird-abgeleitet-nicht-gespeichert). Architektur: `19-user-lifecycle-architecture.md` §4.

**Entscheidungen.**

1. **Kein redundantes Statusfeld** — der Zugangsstatus wird aus Supabase Auth und `sales.disabled` abgeleitet; keine Migration.
2. **Vier Zustände** `invited | active | disabled | unknown`; `unknown` bietet keine Aktion (eine Einladung würde eine zweite Identität erzeugen).
3. **`last_sign_in_at` ist kein Zustandssignal**; nur die E-Mail-Bestätigung trennt „Link benutzt" von „nicht benutzt".
4. **Zwei getrennte Admin-Aktionen** („Einladung erneut senden" nur für `invited`, „Passwort einrichten lassen" nur für `active`); der Admin sieht nie Token oder Passwort.
5. **GoTrue-Semantik explizit behandelt:** `email_exists` ist Beweis eines veralteten abgeleiteten Zustands (`action_not_applicable`), nie ein zweiter Datensatz.
6. **`/auth-callback` gehört react-admin** — Nora besitzt `/zugang-einrichten` für Einladung und Recovery.
7. **WELCOME behauptet nichts, COMPLETE ist bewiesen** (Zustandsmaschine mit vier Vorbedingungen; Deaktivierte landen in `blocked`); Begrüßungsdaten nur aus der authentifizierten Identität; `sales.disabled` und Auth-Bann werden immer gemeinsam gesetzt; kein Einmalcode-Versprechen in der Passwort-Mail.
8. Nachtrag: die öffentliche Selbstregistrierung war in Production aktiv (Bestandsproblem) und wurde vom Product Owner deaktiviert (`disable_signup: true`, nachgewiesen) — Nora ist einladungsbasiert.

## 2026-09-01 – Customer Create Speed & Clarity: Land ausgeblendet, Bundesland NRW, „Weitere Angaben" eingeklappt

**Status:** released (2026-09-01, auf `main`, live). Archiv: [Original](releases/2026-09.md#2026-09-01--customer-create-speed--clarity-land-ausgeblendet-bundesland-nrw-weitere-angaben-eingeklappt).

**Entscheidungen.** „Land" ist auf `/kunden/create` kein sichtbares Feld; der Mapper setzt den kanonischen Bestandswert `"Deutschland"` (kein neuer Wert, keine DB-Änderung). „Bundesland" startet mit `"NRW"`, frei überschreibbar. Create/Edit explizit über `CompanyInputs variant="create" | "default"` getrennt — Edit zeigt Land weiterhin und überschreibt nie gespeicherte Werte. Progressive Disclosure („Weitere Angaben") nur im Create-Flow; Adresse in deutscher Lesereihenfolge. **Begründung:** der Standardfall (deutscher Kunde in NRW) braucht null Zusatzeingaben; der Default liegt im Application-Layer, damit die Persistenz ihren Vertrag behält.

## 2026-08-30 … 2026-09-01 – PWA-Update-Lifecycle: wartender Worker, Browser-Fakten, Systemereignis

Konsolidierte durable Entscheidung aus den Wellen PWA-1B, 1C, 1C.1, 1C.2, 1C.2-Closure, 1C.3, Update State Contract V2, Visual Polish 2 und Completion Acknowledgement. **Status:** alle released und live (Kanban-Release `fe962c58` für 1B–1C.3, Fast-Forward bis `672ebc76` für V2/Polish 2/Completion, 2026-09-01). Archiv-Originale: [PWA-1B](releases/2026-08.md#2026-08-30--pwa-update-wartender-worker-statt-automatischer-übernahme-pwa-1b) · [PWA-1C](releases/2026-08.md#2026-08-30--update-experience-als-anwendungs-systemereignis-pwa-1c) · [PWA-1C.1](releases/2026-08.md#2026-08-30--premium-update-experience-und-8-sekunden-choreografie-pwa-1c1) · [PWA-1C.2](releases/2026-08.md#2026-08-30--aktivierungsanfrage-ist-kein-erfolgssignal-watchdog-statt-promise-pwa-1c2) · [PWA-1C.2 Closure](releases/2026-08.md#2026-08-30--ein-retry-muss-etwas-senden-der-beendete-aktivierungsversuch-pwa-1c2-closure) · [PWA-1C.3](releases/2026-08.md#2026-08-30--eine-bestätigte-übernahme-ist-endgültig-activated-ist-monoton-pwa-1c3) · [State Contract V2](releases/2026-09.md#2026-09-01--pwa-update-state-contract-v2-browser-fakten-statt-entdeckungssignal) · [Visual Polish 2](releases/2026-09.md#2026-09-01--pwa-visual-polish-2-ring-statt-spektakel-kein-reload-angebot-bei-wartendem-worker) · [Completion Acknowledgement](releases/2026-09.md#2026-09-01--pwa-completion-acknowledgement-aktualisierung-abgeschlossen-nach-dem-reload-genau-einmal). Gestaltung: `02-design-system.md`; Ursachenprotokoll: `17-known-issues-and-planned-waves.md` „PWA-Update-Verhalten".

**Kontext.** `registerType: "autoUpdate"` erzeugte einen inkonsistenten Zwischenzustand (neuer Worker übernimmt, räumt den alten Precache, die Seite läuft auf altem JavaScript → Lazy-Chunk-404). Später zeigte Production einen falschen Recovery-Zustand, obwohl die neue Version längst lief.

**Durable Regeln.**

1. **Der neue Service Worker bleibt WAITING, bis der Benutzer bewusst aktualisiert** (`registerType: "prompt"`, `virtual:pwa-register` explizit in `main.tsx`, Lifecycle in `pwaUpdateStore`). **Kein `clients.claim()`.** „Später" verwirft nichts (2 Stunden, erneut beim App-Start); kein `localStorage`.
2. **Ein PWA-Update ist ein Anwendungs-Systemereignis, keine Business-Operation:** kein `operationId`, kein Idempotency-Key, kein Operation Manager, kein Notification-Store; eigener Layer, nicht-modal, bei offenem Dialog/Sheet nicht sichtbar.
3. **Eine ausgelöste Anfrage ist kein Erfolgssignal.** `updateServiceWorker()` resolved immer; das einzige belastbare Signal ist `controllerchange`. `applying` (angefordert) ≠ `activated` (vollzogen); `activated` ist innerhalb einer Dokument-Lebensdauer **monoton**; ein Watchdog (5 s, gemessen) ab `applyUpdate()` — nie ab einer vorgelagerten Inszenierung.
4. **Der Browser ist die Wahrheit; `onNeedRefresh` ist nur ein Entdeckungssignal.** Der Store liest `controller`/`waiting`/`installing`/`active` an jedem Entscheidungspunkt; expliziter Zustand `reloadRequired` (Invariante `activated ∨ (entdeckt ∧ ¬waiting ∧ ¬installing ∧ (¬controlled ∨ active ≠ controller))`); `applyUpdate()` sendet SKIP_WAITING nur mit wartendem Worker; ein Timeout allein ist nie `failed`.
5. **Nora besitzt den Reload** (1,5 s nach der Übernahme, falls der Client nicht selbst neu lädt) und **behauptet nie einen Fehler ohne Beweis** (Copy ohne Fehlerbehauptung; kein Reload-Angebot bei weiterhin wartendem Worker — nur „Weiterarbeiten").
6. **Die Choreografie ist Präsentation** (lokaler State, nicht im Store) und **täuscht keinen Fortschritt vor** (der Worker ist bereits installiert; nichts ist messbar).
7. **Erfolg wird nach dem Reload bestätigt, nicht davor** (`sessionStorage`-Bit, genau einmal, nie bei `failed`/`slow`/„Später"/F5).
8. A11y: große, sich verändernde Flächen bekommen keine Live-Rolle; ein `sr-only`-Announcer mit einer Ansage pro Zustandswechsel; Fokus-Besitz wird laufend geführt.

**Begründung.** Solange der alte Worker aktiv bleibt, bleibt sein Precache konsistent — der ursprüngliche Fehler kann strukturell nicht mehr auftreten. Ein Reload darf nie ungefragt in ein Formular fallen (es gibt keinen zentralen „Reload ist jetzt sicher"-Mechanismus, bewusst nicht gebaut). Und eine Oberfläche sagt nur, was sie belegen kann — dieselbe Regel wie im Error Contract und in der Notification Presentation.

**Offen (Product):** Choreografie-Dauer bei Reduced Motion; Kontrast/Touch-Höhe der projektweiten Primäraktion; globaler Nora-Loader (eigene Welle).

## 2026-08-30 – Vorgänge-Kanban Navigation Rail

**Status:** `PRODUCTION VERIFIED` (2026-09-01). Archiv: [Original](releases/2026-08.md#2026-08-30--vorgänge-kanban-navigation-rail).

**Entscheidungen.** Eine native Wahrheit — alle Wege (Trackpad, Wheel, Touch, Board-Pan, Pfeile, Tastatur, Track-Klick, Thumb-Drag) ändern nur dasselbe `scrollLeft`. Proportionaler Viewport-Thumb mit 44-px-Minimum, Marker aus realen Spaltenmitten, integrierte Pfeile, Rail bottom-sticky innerhalb der Arbeitsfläche, Browser-Scrollbar visuell ausgeblendet (native Scrollfläche bleibt), Mouse-Pan nur auf freier Fläche (Karten-DnD getrennt), **native Gesten bleiben führend** (kein Wheel-Listener am Kanban), kein Scroll-Snap. Lehre aus dem Release: die vollständige Liste gelöschter Zeilen gegen die Release-Basis lesen — ein Keyword-Scan reicht nicht (eine `focus-visible`-Regel war im Integrations-RC verloren gegangen).

## 2026-08-29 – Notification Presentation Contract v1 (Phase 7A)

**Status:** Phase 7B `PRODUCTION VERIFIED` (2026-08-30); nur Quick Capture migriert, weitere Intents Phase 7C. Archiv: [Original inkl. Nachträge 7B.3/7B.4/7B.4b/7B.4c/Release](releases/2026-08.md#2026-08-29--notification-presentation-contract-v1-phase-7a). Guardrails: `03-data-model-guardrails.md` Fallen 37/38; Checkliste `07-agent-change-checklist.md`.

**Entscheidungen.**

1. **Composite: eine sichtbare Karte pro Benutzer-Intent** (Quick Capture = zwei Operationen, eine Karte; Core success + Task failure = Presentation-`partial`/`warning`). **Kein neuer Core-Lifecycle-Status.**
2. **Presentation-Registrierung gehört nicht in Application Commands**; Commands nehmen nur neutrale Execution-Metadata (`operationId`s) entgegen und importieren nichts aus `notifications/`. `operationId` ≠ `idempotencyKey`.
3. **Ein lange laufendes Core-`pending` wird nie zu `error` umgedeutet.** `lifecycle`/`tone` sind eine Discriminated Union ohne widersprüchliche Kombinationen.
4. **Bedienbarkeit vor Kompaktheit:** Close ≥ 44 px, Fehlerdetails werden nicht weggeclampt; `replayed` rendert wie `executed`; `initiator` Pflicht mit Default `human`.
5. **IT-Eskalation und Retry sind Contract-Fähigkeiten, kein UI** (kein Button ohne Adressat; Retry braucht Command-Policy und kompatiblen Idempotency-Scope).
6. **Layer-Endstand (7B.4c):** Statusmeldungen liegen auf beiden Breakpoints **über** der Dialogschicht (`z-60`), modal-aware Position über Radix' `data-state="open"`, nur die neueste Karte bei offenem Dialog, Kartenkörper **click-through** — eine Statusmeldung muss lesbar bleiben **und** darf nie die Aktion blockieren, über die sie berichtet. Ein Flow gehört genau einer Feedback-Schicht; sonner bleibt für nicht migrierte Flows.
7. **Fehler vor Operation-Start** werden nie zu einem synthetischen `OperationRecord` (Audit/Observatory würden verfälscht); kein Phantom-Task-Slot.

## 2026-08-29 – Operation Status Contract Wave (v1, CreateQuickCaptureCase Slice)

**Status:** `PRODUCTION VERIFIED` (2026-08-29). Archiv: [Original inkl. Phasen 6C/6D.1/6E](releases/2026-08.md#2026-08-29--operation-status-contract-wave-v1-createquickcapturecase-slice). Guardrail: `03-data-model-guardrails.md` Falle 35.

**Entscheidungen.** Lifecycle bleibt `pending | success | error` (keine Werte ohne reale Semantik). `execution?: "executed" | "replayed"` ist ein Zusatzfeld an `success`, `undefined` ohne `idempotencyKey`. RPC-Transport: additives `_meta.disposition` im JSONB-Result der drei idempotenten RPCs (`CREATE OR REPLACE` auf unveränderten Signaturen), nur mit Key gesetzt; `_meta` ist reine Transportmetadata, nie Business-Feld, nie im Fingerprint; der in `idempotency_records` gespeicherte Wert bleibt für immer `executed`, die Replay-Antwort berechnet `replayed` frisch. `OperationRecord` bekommt `errorCode` (aus `normalizeCrmError().code`) und minimale `result`-Referenzen (IDs, nie Domainobjekte). Manager-API additiv über `reportOutcome`; FakeRest-Parität. Offen: pendente Operationen ohne TTL (LOW).

## 2026-08-29 – Idempotency Wave

**Status:** `PRODUCTION VERIFIED` (2026-08-28). Archiv: [Original inkl. Hardening und Release](releases/2026-08.md#2026-08-29--idempotency-wave).

**Entscheidungen.** `nora_private.idempotency_records` (unique `(command, idempotency_key, actor_id)`), nur über `idempotency_check`/`idempotency_persist` erreichbar; Atomizität über `pg_advisory_xact_lock` + Unique-Backstop. Transport als expliziter RPC-Parameter `p_idempotency_key`, **nie** über den Korrelations-Header (`operation_id` ≠ `idempotency_key`). Gleicher Key + gleicher Fingerprint → Replay; anderer Fingerprint → `NORA_IDEMPOTENCY_CONFLICT`. **Signatur-Gate:** ein zusätzlicher Parameter per `CREATE OR REPLACE` erzeugt eine Überladung (PostgREST `PGRST203`) — deshalb `DROP FUNCTION` + `CREATE`. Quick-Capture-Task hat eigenen Scope und eigene Transaktion (Best-Effort-Semantik bleibt); **committed scope = eingefroren, uncommitted scope = frei retriable**. Key-Ownership: Quick Capture mintet pro frischem Formularzustand und persistiert im Draft. **Precondition für `idempotency_persist`:** Lock zuerst, dann Write, dann Persist, alles in einer Transaktion. Kein Redis/Worker/Queue/Outbox.

## 2026-08-28 – Kontakterstellung UI-Polish

**Status:** deployed (2026-08-28; förmliche Rollen-UX-Abnahme nicht durchlaufen). Archiv: [Original](releases/2026-08.md#2026-08-28--kontakterstellung-ui-polish).

**Entscheidungen.** Nur die Kontakterstellung (`ContactInputs variant="create"`) bekommt die Komposition Person / Kundenbezug / Kontaktmöglichkeiten / eingeklappte Weitere Angaben (Validierungsfehler öffnen den Bereich); mobile first mit fester Primäraktion, zweispaltig erst ab `xl`; Kundenwahl mobil als Bottom Sheet mit räumlich getrennter Neuanlage; Brandfarbe nur für Primäraktion/Fokus/Akzente; iPad-Kopfzeile verdichtet. Keine Persistenz-/Routing-Änderung.

## 2026-08-28 – Error Contract Wave

**Status:** `PRODUCTION VERIFIED` (2026-08-28). Archiv: [Original](releases/2026-08.md#2026-08-28--error-contract-wave). Guardrail: `03-data-model-guardrails.md` Falle 33; Checkliste `07-agent-change-checklist.md`.

**Entscheidungen.** `MESSAGE` = Mensch/Diagnose, `ERRCODE` = PostgreSQL-Semantik, `DETAIL` = stabiler `NoraErrorCode` (PostgREST transportiert beides unverändert — bewiesen). Zentrale Definition `domain/noraErrorCodes.ts`; `extractNoraErrorCode()` akzeptiert nur kanonische Werte (kein `startsWith("NORA_")`); `normalizeCrmError()` ist **machine-code-first**, Regex nur Legacy-Fallback. `CrmErrorKind` friert ein (Transport-/Infrastrukturfehler); neue Business-Fehler gehen `NoraErrorCode → messageKey` direkt. FakeRest wirft denselben Code über `throwNoraError()`, soweit es den Pfad modelliert (keine Datenebene-Autorisierung in FakeRest — dokumentierter Debt). TOCTOU auf `uq_companies_self_contact_individual` wird in `create_customer_with_contact_core` gezielt übersetzt.

## 2026-08-28 – Residual Security Advisor Closure

**Status:** abgeschlossen für den Snapshot 2026-08-28. Archiv: [Original](releases/2026-08.md#2026-08-28--residual-security-advisor-closure). Details: `17-known-issues-and-planned-waves.md` „Residual Security Advisor Follow-ups".

**Entscheidungen / Guardrails.** Ziel ist nachgewiesene Sicherheit, nicht „0 Findings". `number_counters` (RLS ohne Policy) = deny-by-grants, KEEP. Functions mit Rückgabetyp `trigger`/`event_trigger` sind nicht direkt aufrufbar — Advisor-Falsch-Positiv-Klasse. `authenticated`-only Business-RPCs prüfen serverseitig Rolle/Ownership, KEEP. `search_path = public` bei `SECURITY DEFINER` ist nur unkritisch, weil keine client-facing Rolle `CREATE` auf `public` hat — **Voraussetzung bei jeder neuen Function erneut prüfen**. `auth_leaked_password_protection` aktiviert. Jede neue Migration/Function/Grant-Änderung braucht eine eigene Bewertung; die alte Einstufung wird nie wiederverwendet.

## 2026-08-28 – Intentional privileged read views (`init_state` / `sales_directory`)

**Status:** `ASSESSED — LOW — KEEP`. Archiv: [Original](releases/2026-08.md#2026-08-28--intentional-privileged-read-views-init_state--sales_directory). Guardrail: `03-data-model-guardrails.md` Falle 34.

**Entscheidung.** Beide Views bleiben `security_invoker = false`: `init_state` liefert `anon` nur ein 0/1-Bootstrap-Signal (die echte Grenze ist `resolve_first_signup_role()`), `sales_directory` ein minimales Teamverzeichnis (`id`, Name, Avatar) für alle aktiven Rollen. `security_invoker = true` würde beide Use-Cases nachweislich regressieren. **`sales_directory` wird ohne neue Entscheidung nie um `role`, `email`, `user_id`, `administrator` oder andere Identity-/Security-Metadaten erweitert**; Änderungen an Projektion, Grants, `sales`-RLS oder `is_active_user()` erfordern eine neue Bewertung. (Seit W2 sind beide Identity-Views zusätzlich explizit `SELECT`-only.)

## 2026-08-27 – Pre-Production Hardening Patch

**Status:** `PRODUCTION VERIFIED` (2026-08-28, zusammen mit der Self Contact Wave). Archiv: [Original inkl. Final-RC-Nachträge und Release](releases/2026-08.md#2026-08-27--pre-production-hardening-patch). Guardrails: `03-data-model-guardrails.md` Fallen 31/32/33.

**Durable Regeln.** Numerische Entity-/Identity-IDs nie per Truthiness prüfen (`identity.id = 0` existiert im Demo) — `== null`. Die Effective-Contact-Regel hat drei Implementierungen (SQL, TS, FakeRest), die über eine gemeinsam benannte Szenario-Matrix (Domain Contract Testing) synchron gehalten werden. Die Individual-Name-Invariante gilt am CREATE-Pfad **und** beim Rename: `companies.name` einer Privatkundenakte wird serverseitig aus dem Kontakt abgeleitet, ein leerer Name lehnt den ganzen Aufruf ab (kein Platzhalter). `error.message` ist nie ein i18n-Key.

## 2026-08-26 – Self Contact Wave

**Status:** `PRODUCTION VERIFIED` (2026-08-28). Archiv: [Original inkl. Alternativen](releases/2026-08.md#2026-08-26--self-contact-wave). Modell: `01-domain-model.md`; Fallen 28–31 in `03-data-model-guardrails.md`.

**Entscheidungen.**

1. **`companies.self_contact_id`** — gerichteter FK company→contact, **entkoppelt von `contacts.company_id`**: „diese Person repräsentiert diese Kundenakte". Kein Flag auf `contacts` (hätte die Arbeitgeberbeziehung überschrieben). Partial Unique nur für `customer_kind='individual'` (eine Person hat höchstens eine Privatkundenakte, darf aber mehrere Firmen repräsentieren).
2. **`contacts` bleibt kanonische Quelle für Personendaten**; `companies.name` bei Privatpersonen serverseitig synchron (kontrollierte Denormalisierung), Invariante `individual ⇒ self_contact_id` als deferred Constraint-Trigger, Delete-Guard für den repräsentierenden Kontakt einer Privatakte, `merge_contacts` repointet.
3. **Effective Contact Context — genau eine Regel** (`is_effective_contact_of_company` / `resolveCustomerContacts`): `contact.company_id = company.id` ODER `company.self_contact_id = contact.id`. Rollen `selfContact` / `explicitPrimaryContact` (nur bei passendem `company_id`) / `preferredContact` getrennt.
4. **Ein gemeinsamer RPC-Core** (`create_customer_with_contact_core`) für Kundenanlage und Quick Capture; `create_quick_capture_case` erlaubt genau einen Kundenpfad (neu oder bestehend), verweigert stilles Umhängen, referenziert bestehende Kontakte nur (kein Primary-Eingriff); Kunde+Kontakt+Vorgang atomar, Aufgabe bleibt Best-Effort.
5. **Application-/Domain-Layering additiv** (`domain/`, `application/commands/`), kein Event Bus, kein CQRS, kein Intent-Layer.
6. Quick Capture Schritt 2 als expliziter Tri-State; Draft pro Benutzer mit Schema-Version/Staleness, alter globaler Key wird entfernt, nie migriert; „Firma" statt „Unternehmen / Selbstständig".

## 2026-08-25 – Unified Tasks Wave

**Status:** `PRODUCTION VERIFIED` (2026-08-28). Archiv: [Original](releases/2026-08.md#2026-08-25--unified-tasks-wave). Guardrail: `03-data-model-guardrails.md` Falle 7/7a.

**Entscheidungen.** `tasks.company_id` (nullable) neben nullable `tasks.contact_id`, CHECK „mindestens eines"; **kein `deal_id`**, keine `task_links`-Architektur. **Historische Semantik:** `company_id` ist der Kundenkontext zum Zeitpunkt der Erstellung bzw. letzten bewussten Kontextänderung und wird **nie automatisch nachgeführt** (Nora will nachvollziehbare Historie). Durchsetzung per BEFORE-Trigger (nur bei gesetztem/geändertem Kontext). `tasks.contact_id` FK `ON DELETE SET NULL` mit vorgelagertem Trigger, der reine Kontakt-Aufgaben löscht; `merge_contacts` überspringt die Validierung (Identitätskonsolidierung). Audit liest den Kontext aus der Aufgabe, nicht live vom Kontakt.

## 2026-08-25 – Customer & Contact Workflow Wave

**Status:** `PRODUCTION VERIFIED` (2026-08-25). Archiv: [Original](releases/2026-08.md#2026-08-25--customer--contact-workflow-wave), [lokale Verifikation](releases/2026-08.md#2026-08-25--erste-lokale-postgres-verifikation-der-customer--contact-workflow-migration), [Production-Apply](releases/2026-08.md#2026-08-25--customer--contact-workflow-migration-auf-produktion-angewendet). Modell: `01-domain-model.md`.

**Entscheidungen.** `companies.customer_kind` (`business` | `individual`) treibt den Formularmodus; ersetzt **nicht** `sector`. `contacts.is_primary`, max. 1 pro Kunde per Partial Unique Index, Wechsel nur über RPC `set_primary_contact`. Generisches Link-Modell `links_jsonb` (Legacy-Spalten bleiben deprecated, Bestandsdaten kopiert). `companies.email_jsonb`/`phone_jsonb` analog zu Kontakten. Atomare Anlage über RPC `create_customer_with_contact` (kein Frontend-Copy/Paste). **Verworfen:** generisches `party/person/organization`-Modell (unverhältnismäßig), Selbstständige als dritte Kundenart (verhalten sich wie Firmen), `companies.primary_contact_id` (FK-Zyklus).

## 2026-08-25 – Erste lokale Postgres-Verifikation der Customer & Contact Workflow Migration

Archiv: [Original](releases/2026-08.md#2026-08-25--erste-lokale-postgres-verifikation-der-customer--contact-workflow-migration).

**Durable Regel.** Beim Erweitern einer View (`companies_summary`, `contacts_summary`, …) neue Spalten **immer ans Ende** der `select`-Liste anhängen — `create or replace view` interpretiert eine verschobene Spaltenposition als Umbenennung und scheitert (`42P16`).

## 2026-08-15 – Kernindizes und Bundle-Budget

**Status:** live (PR #1). Archiv: [Original](releases/2026-08.md#2026-08-15--kernindizes-und-bundle-budget).

**Entscheidungen.** Fehlende FK-/Hot-Path-Indizes auf den geerbten Kerntabellen additiv per `create index if not exists` (partielle/zusammengesetzte Indizes, z. B. `deals (stage, "index") where archived_at is null`); **kein `CONCURRENTLY`** (CLI-Transaktion) — ab ~100.000 Zeilen eigene nicht-transaktionale Migration; Indizes auch in `supabase/schemas/01_tables.sql`. **`sourcemap: false`** (keine Produktions-Sourcemaps ohne private Übertragung). **`manualChunks` in Funktionsform** (Objektform bricht bei fehlender Abhängigkeit). **Bundle-Budget als CI-Gate** am Build-Job; `visualizer({ open })` nur ohne `CI`. Code-Splitting per `React.lazy` bewusst zurückgestellt, bis Pfadkonstanten aus `Header.tsx` gelöst sind. Jede Referenz auf `sales.id` braucht einen führenden Index (Lehre aus den zwei übersehenen Notiz-FKs).

## 2026-08-10 – Foundation Wave 3: Error Observatory Core

Archiv: [Original](releases/2026-08.md#2026-08-10--foundation-wave-3-error-observatory-core).

**Entscheidungen.** Tabelle `public.operation_errors`, getrennt von `audit_events` — **Audit = erfolgreiche Änderungen, Observatory = fehlgeschlagene fachliche Operationen** (Compliance- und Diagnose-Daten nicht vermischen). Soft-Referenzen (kein FK auf Business-Tabellen), `operation_id` NOT NULL + UNIQUE, Actor nur aus `safe_auth_uid()`, serverseitige `public_ref` (`NORA-E…`), keine Client-INSERTs (nur `record_operation_error`/`report_operation_error`), `technical_context`-Allowlist, Report nur eigener Actor. Der Observatory-Ausfall ersetzt und blockiert nie den Business-Fehler (best-effort, non-blocking).

## 2026-08-10 – Foundation Wave 2: Operation Manager + Catalog

Archiv: [Original](releases/2026-08.md#2026-08-10--foundation-wave-2-operation-manager--catalog).

**Entscheidungen.** Typisierter Operation Catalog; In-Memory-Manager `execute(definition, input, handler)` mit `pending → success|error`, Exceptions weitergereicht, voll funktionsfähig ohne React (Prozess-Singleton, der Provider erzeugt keine zweite Instanz). Der Manager ist Eigentümer der Operation-ID am Einstieg; Transport reicht nur weiter. `deal.assign` ist nur Katalog, keine zweite Mutation. Retention success 8 s / error 60 s / pending nie auto-drop. Keine DB-Tabelle, kein Feedback-UI.

## 2026-08-10 – Foundation Wave 1: Operation Correlation

Archiv: [Original](releases/2026-08.md#2026-08-10--foundation-wave-1-operation-correlation).

**Entscheidungen.** `operation_id` = clientseitige UUID, einmal am fachlichen Einstieg gemintet, Transport-Header `x-nora-operation-id` (gültige IDs werden nie still ersetzt; ungültige soft neu gemintet). PostgreSQL liest sie über `nora_private.current_operation_id()` (INVOKER, nur GUC/Header, nie Abbruch) in `audit_events.request_id` — **die bestehende Spalte, keine zweite**. **Keine Auth-/RLS-Nutzung der `operation_id`** — sie ist ausschließlich Korrelation. Rückwärtskompatibel (kein Header → `NULL`).

## 2026-08-10 – Stabilization Gates 2/2b: Form-Owner im Radix-Portal

Archiv: [Gate 2](releases/2026-08.md#2026-08-10--stabilization-gate-2-dealedit-portal-form-owner), [Gate 2b](releases/2026-08.md#2026-08-10--stabilization-gate-2b-taskedit-portal-form-owner), [Gate 1](releases/2026-08.md#2026-08-10--stabilization-gate-1-deal-surface-recovery).

**Durable Regel.** Ein `Form` muss physisch **innerhalb** des Radix `DialogPortal`/`DialogContent` gerendert werden — sonst hat der sichtbare `SaveButton type="submit"` `button.form === null` und speichert nicht (Production-Ursache bei `DealEdit`/`TaskEdit`). Modal-Edits speichern `mutationMode="pessimistic"`; Dirty-Close über `FormDirtyBridge`; `DialogTitle`/`DialogDescription` (sr-only) sind Pflicht. Create-Routen dürfen nie als Record-ID an `EditBase`/`ShowBase` gehen; interne Navigation nur über `noraCreatePath()` (siehe `04-routing-i18n.md`).

## 2026-07-23 – Mitarbeiterzugang: öffentliches Redesign und Einladung

Archiv: [Original](releases/2026-07.md#2026-07-23--mitarbeiterzugang-öffentliches-redesign-und-einladung), [Profil-Update](releases/2026-07.md#2026-07-23--profil-update-pending-default-und-rollen-seiteneffekt), [Rollen-RPC Claims](releases/2026-07.md#2026-07-24--rollen-rpc-service_role-claims-erkennung), [Identity-Cache](releases/2026-07.md#2026-07-24--identity-cache-nach-profilnamensänderung).

**Entscheidungen.** Nora ist **einladungsbasiert**: keine öffentliche Registrierung (`/sign-up` ist nur Hinweisseite, `dataProvider.signUp` wirft im Supabase-Modus); öffentliche Fläche zeigt Ergart + „Mitarbeiterzugang", Nora-Branding erst nach Anmeldung. Onboarding nach Einladung: Passwort → Profil → Abschluss, keine Rollenwahl durch den Benutzer. Admin-Einladung über die `users` Edge Function. **Kein Service-Role-Schlüssel im Frontend/Vercel/`VITE_*`.** „Pending" ist nur Bootstrap-Platzhalter; PATCH ändert Rolle/Deaktiviert nur bei expliziter Angabe. Rollen-/Claims-Erkennung liest `request.jwt.claims` (JSON) und das Legacy-GUC.

## 2026-07-17 – v0.4c.2c: Release-Gates und Deployment-Bereinigung

Archiv: [Original](releases/2026-07.md#2026-07-17--v04c2c-release-gates-und-deployment-bereinigung), [E2E-Bootstrap](releases/2026-07.md#2026-07-17--v04c2c-e2e-bootstrap-und-profilzugriff), [E2E-Auth](releases/2026-07.md#2026-07-17--v04c2c-e2e-auth-assertions-und-first-run-dashboard).

**Entscheidungen.** Der Atomic-CRM-Workflow `deploy.yml` (GitHub Pages, automatische Remote-Migrationen und Edge-Deploys) ist entfernt — **kein automatischer Supabase-Remote-Deploy aus CI**; Vercel-Frontend-Deploy und Supabase-Production-Schritte sind getrennte, ausdrücklich freizugebende Betriebsaufgaben. ESLint/Prettier als direkte npm-Skript-Jobs. `configuration.id = 1` ist ein notwendiger Systemdatensatz; `safe_auth_uid()` liest Legacy-GUC und `request.jwt.claims`; Policy-Matrix unverändert (kein Test-SELECT-Recht). Atomic-CRM-Telemetrie dauerhaft aus; E2E-Build ohne Service Worker.

## 2026-07-16 – v0.4c.2: Google OAuth, Token-Verschlüsselung, manueller Sync

Archiv: [Original](releases/2026-07.md#2026-07-16--v04c2-google-oauth-token-verschlüsselung-manueller-sync).

**Entscheidungen.** Kein GUC-Bypass für FK-Updates → Capability `nora_calendar_linker`. OAuth-Scopes minimal (`calendar.events.owned.readonly`, `calendarlist.readonly`), PKCE S256 + State-Hash mit TTL, atomarer Consume. Refresh-Token AES-GCM-256 mit Nonce und Key-Version in `nora_private`. Allowlist `GOOGLE_CALENDAR_ALLOWED_ID` ist bindend (DB-Config kann Edge nicht überschreiben). Sync admin-only, etag-basiert, Datenminimierung (Beschreibung bevorzugt leer, max. 500, kein HTML).

## 2026-07-16 – v0.4c.1: Google-Kalender Read-only Grundlage

Archiv: [Original](releases/2026-07.md#2026-07-16--v04c1-google-kalender-read-only-grundlage). Implementierung: `14-google-calendar-readonly-implementation.md`.

**Entscheidungen.** Google Kalender ist System of Record; Nora = Cache (`google_calendar_events`) + CRM-Verknüpfung + Audit. Singleton-Verbindung (max. eine `connected`), Allowlist, **keine Tokens** in Data-API-Tabellen oder Audit, Capability `nora_calendar_writer`, Link/Unlink-RPCs für admin/office, Edge-Stubs antworten 501/503 statt Fake-Erfolg, Demo ohne Fake-OAuth, Audit `calendar.event_linked/unlinked` (`retention_class = integration`).

## 2026-07-15 – v0.3l: Vollständiger CRM-Audit-Verlauf

Archiv: [Original](releases/2026-07.md#2026-07-15--v03l-vollständiger-crm-audit-verlauf), [Abschluss v0.3l.1](releases/2026-07.md#2026-07-15--v03l1-crm-audit-abschluss-schema-sync-tests-abnahme). Modell: `13-crm-audit-retention.md`.

**Entscheidungen.** **Eine** Audit-Tabelle (`audit_events`) für Checklisten und CRM-Kernänderungen, erweitert um Actor-Snapshots, `source`, `retention_class`, `task_id`, `note_id`. Schreib-Capability `nora_audit_writer` (NOLOGIN, INSERT-only) über `nora_private.write_audit_event`; Trigger auf companies, contacts, deals, tasks, Notizen, sales. Kompakte `metadata.changes`, Notizen ohne Volltext. Lesen: Admin global (`/audit`), Office nur kontextbezogen per RPC, Viewer nichts; direktes SELECT nur Admin. Kanonisches Ereignis `deal.status_changed` (Legacy `deal.stage_changed` bleibt lesbar). Immutability-Grenze: append-only für App-Rollen, kein Superuser-/WORM-Schutz; `event_hash`, WORM-Export, Purge zurückgestellt.

## 2026-07-14 – v0.3k: Rollenbewusste UX, Ladezustände und Fehlertoleranz

Archiv: [Original](releases/2026-07.md#2026-07-14--v03k-rollenbewusste-ux-ladezustände-und-fehlertoleranz), [v0.3k.1](releases/2026-07.md#2026-07-14--v03k1-rollen-ux-abnahme-und-dialog-polish), [v0.3k.2](releases/2026-07.md#2026-07-14--v03k2-demo-rollensimulation-und-abschließende-rollen-ux-abnahme). Abnahme: `12-role-ux-acceptance.md`.

**Entscheidungen.** **Die UI spiegelt `canAccess.ts`, ersetzt aber niemals RLS** — die Datenbank bleibt autoritativ. Viewer: Lesemodus-Banner, keine Create/Edit/Delete, Edit-Routen leiten auf Show. Office: schreiben und archivieren, kein physisches Löschen, keine Benutzer-/Konfigurationsverwaltung. Zentrale Fehlernormalisierung (`normalizeCrmError`), einheitliche Lade-/Leer-/Fehlerzustände, Dirty-Form-Schutz. Import ist nicht reversibel und ohne Assistent → nur Admin. Demo-Session hat genau eine Quelle (`demoSession.ts`); Rollenwechsel invalidiert Caches.

## 2026-07-14 – v0.4b.2: RBAC-Abschluss (Capability, Parallel-Admin, sales_directory)

Archiv: [Original](releases/2026-07.md#2026-07-14--v04b2-rbac-abschluss-capability-parallel-admin-sales_directory).

**Entscheidungen.** Kein GUC-Token-Modell für Privilegienänderungen (client-setzbare Textwerte sind keine Capability-Grenze) → Rolle `nora_role_manager` (NOLOGIN, NOBYPASSRLS) als alleiniger Owner von `apply_sales_role_change`; Trigger `prevent_sales_privilege_escalation` erlaubt Privileg-UPDATEs nur als `nora_role_manager`. Erster Admin über `resolve_first_signup_role()` mit Advisory-Lock (exakt ein Admin unter Parallelität). View `sales_directory` (id, Name, Avatar) für Teamlisten; `public.sales` SELECT nur eigene Zeile oder Admin.

## 2026-07-14 – v0.4b.1: RBAC-Migrations- und Function-Hardening

Archiv: [Original](releases/2026-07.md#2026-07-14--v04b1-rbac-migrations--und-function-hardening).

**Entscheidungen.** Interne Helper (`safe_auth_uid`, `is_active_user`, `current_role`, `has_role`, `can_write`, `is_admin`) leben in Schema `nora_private` — nicht in Data-API-Schemas; `search_path = ''` auf allen `SECURITY DEFINER`-Functions, vollständig schemaqualifiziert; keine Testrolle in Produktionsmigrationen (nur lokales Setup/Teardown); `anon` ohne Grants auf geschützte Tabellen, `authenticated` minimal.

## 2026-07-14 – v0.4b: RBAC- und RLS-Härtung

Archiv: [Original](releases/2026-07.md#2026-07-14--v04b-rbac--und-rls-härtung). Rollenmatrix: `11-google-calendar-rbac.md` Abschnitt C.

**Entscheidungen.** `sales` bleibt die kanonische Benutzertabelle (1:1 zu `auth.users`); `sales.role text not null` mit CHECK (`admin`, `office`, `viewer`); Backfill nach Least Privilege (`administrator = true` → `admin`, sonst `viewer`, `office` nur explizit); `administrator = (role = 'admin')` per Trigger gespiegelt. RLS-Matrix: viewer SELECT; office SELECT/INSERT/UPDATE ohne DELETE; admin inkl. DELETE und Konfiguration. `disabled` blockiert in Rollenfunktionen, RLS und Auth-Provider. Erster Nutzer `admin`, weitere `viewer`.

## 2026-07-14 – v0.4a: Google-Kalender-Architektur und Nora-Rollenmodell spezifiziert

Archiv: [Original](releases/2026-07.md#2026-07-14--v04a-google-kalender-architektur-und-nora-rollenmodell-spezifiziert). Spezifikation: `11-google-calendar-rbac.md`.

**Entscheidungen.** **Google Kalender ist System of Record für Termine** (Zeit, Titel, Ort, Wiederholung, Existenz); Nora speichert Cache, CRM-Verknüpfung, Audit — **kein `appointments`-Hauptmodell**, ein Geschäftskalender per `calendar_id`, keine iCal-URL, kein Embed. Termin-Eigentum `origin = google | nora`. **Rollen `admin`/`office`/`viewer` an `sales.role` — keine zweite Benutzertabelle.** Secrets nur in Edge-Secrets/Vault, nie Frontend/Audit. OAuth read-only zuerst; Sync stufenweise; Kalender-Audit über `audit_events`.

## 2026-07-14 – v0.3g: Schnellerfassung UX-Überarbeitung

Archiv: [Original](releases/2026-07.md#2026-07-14--v03g-schnellerfassung-ux-überarbeitung); Folgewellen [v0.3h](releases/2026-07.md#2026-07-14--v03h-kundenliste-und-vorgänge-kanban-responsiver), [v0.3i](releases/2026-07.md#2026-07-14--v03i-kanban-und-vorgangsakte-barrierearm), [v0.3j](releases/2026-07.md#2026-07-14--v03j-hotboard-arbeitsboard-fokusboard).

**Entscheidungen.** Frei wechselbare Tabs (Validierung nur beim Speichern), lokaler Entwurf im Browser (kein serverseitiger Draft), ein Bereich „Mögliche Kunden" (keine doppelte Vorschlagsanzeige), Suche nur über `useDuplicateCandidateSearch`. Sichtbare Terminologie „Rückmeldung ausstehend"/„Nächster Kontakttermin" bei unveränderten technischen IDs; Datumsformat `de-DE` über `noraDateTime.ts`; keine Listen-Suche neben der globalen Suche.

## 2026-06-28 – v0.3f: Intelligente Dubletten-Vorschläge

Archiv: [Original](releases/2026-06.md#2026-06-28--v03f-intelligente-dubletten-vorschläge).

**Entscheidungen.** Deterministisches Scoring (Kundennummer, Telefon, E-Mail stark; Name mittel; Name + Ort stärker) — **keine KI, kein Auto-Merge**; Vorschläge sind informativ, der Nutzer entscheidet. Effiziente Suche (Debounce, Cache, Stale-Guard, max. 5), Wiederverwendung von `performGlobalSearch`; Logik für einen späteren CSV-/Lexware-Import wiederverwendbar.

## 2026-06-28 – v0.3e: Schnellerfassung / Eingangszentrale

Archiv: [Original](releases/2026-06.md#2026-06-28--v03e-schnellerfassung--eingangszentrale).

**Entscheidungen.** Ein Dialog für Anfragen aus Telefon/WhatsApp/E-Mail — ohne externe APIs; Suche zuerst; Quelle vorerst in `deals.description` (`Quelle: …`), kein `source_channel`-Feld; Nummern serverseitig. (Die ursprünglich sequentiellen Creates sind seit der Self Contact Wave durch eine atomare RPC ersetzt.)

## 2026-06-28 – v0.3b: Hotboard / operative Startübersicht

Archiv: [Original](releases/2026-06.md#2026-06-28--v03b-hotboard--operative-startübersicht), [v0.3c Fenster-Kanban-Filter](releases/2026-06.md#2026-06-28--v03c-fenster-kanban-filter), [v0.3d5 Produktionsfreigaben](releases/2026-06.md#2026-06-28--v03d5-hotboard-produktionsfreigaben-offen).

**Entscheidungen.** Das Hotboard ist eine **Team-Ansicht** offener Vorgänge (kein `sales_id`-Filter) aus vorhandenen Feldern; archivierte Vorgänge ausgeschlossen; **kein Terminmodell** — „Heutige Termine" erst mit Google Kalender, `expected_closing_date` wird nicht als Termin missbraucht. Fensterservice-Kanban als clientseitiger Kategorie-Filter mit bevorzugten Spalten, keine neuen Status-IDs.

## 2026-06-28 – Welle 6d: Globale Suche im Header

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-6d-globale-suche-im-header), [Spezifikation 6b](releases/2026-06.md#2026-06-28--welle-6b-kundennummern-vorgangsnummern-globale-suche-spezifikation). Details: `08-numbering-and-global-search.md`.

**Entscheidungen.** Frontend-orchestriert über den DataProvider (`getList`/`q`, `@eq` für exakte Nummern) — **keine Postgres-RPC, keine neue DB-Struktur**; exakte `KD-*`/`VG-YYYY-*` navigieren direkt; gruppierte Treffer; einfache Telefon-Normalisierung.

## 2026-06-28 – Welle 7a: Fensterauftrag-Prozess spezifiziert

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-7a-fensterauftrag-prozess-spezifiziert). Spezifikation: `09-window-order-workflow.md`.

**Entscheidungen.** Der Fensterauftrag ist ein **Spezialworkflow**, nicht das Standardschema (`deals.category = fensterservice`); schlanke Hauptstatus als Kanban-Meilensteine, Kontrollpunkte (S4a/S4b/S4c/S5) als **Checkliste, nicht als Spalten**; **Hersteller generisch** (kein Lieferantenname im Modell); E-Mails Vorlagen → manuell → Automation; Kundenstatus-Link eigenes späteres Modul; Google Drive/Keep/Tasks sind nicht Nora-Kern.

## 2026-06-28 – Welle 7b: Checklisten-, Textbaustein- und Audit-Datenmodell spezifiziert

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-7b-checklisten--textbaustein--und-audit-datenmodell-spezifiziert), [v0.3d2 Migration](releases/2026-06.md#2026-06-28--v03d2-datenbankmigration-checklisten-textbausteine-audit), [v0.3d3 Run-Start](releases/2026-06.md#2026-06-28--v03d3-checklisten-run-start-absichern), [v0.3d4 UI](releases/2026-06.md#2026-06-28--v03d4-checklisten-ui-im-vorgangsdetail). Spezifikation: `10-checklists-snippets-audit.md`.

**Entscheidungen.** Relationales Hauptmodell (`checklist_templates/_template_items/_runs/_run_items`, `saved_text_snippets`, `audit_events`) — **JSONB-only am Vorgang abgelehnt**; Servicebereiche `FENS`/`HAUS`/`IMMO` über `service_area_code`, nicht `company_id`; `label_snapshot` Pflicht an Run-Items; Audit append-only (CRM-Nachvollziehbarkeit, kein GoBD-Ersatz); Vorlagen deaktivieren statt löschen; Run-Start nur über die atomare, idempotente RPC `start_checklist_run_from_template` (Advisory-Lock), nie Client-Kopien.

## 2026-06-28 – Welle 6c: Kundennummern und Vorgangsnummern implementiert

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-6c-kundennummern-und-vorgangsnummern-implementiert), [6c-QA](releases/2026-06.md#2026-06-28--welle-6c-qa-datenbank-audit-nummern), [6c-Hardening](releases/2026-06.md#2026-06-28--welle-6c-hardening-nummern-api-absichern). Details: `08-numbering-and-global-search.md`; Fallen 8–13 in `03-data-model-guardrails.md`.

**Entscheidungen.** `KD-000001` (global monoton) und `VG-YYYY-000001` (pro Jahr) aus der Tabelle `number_counters` (race-sicher, nicht pro-Jahr-Sequenzen); Vergabe **ausschließlich serverseitig** per BEFORE-INSERT-Trigger (`SECURITY DEFINER`, Client-Werte werden überschrieben, nicht mit Fehler quittiert), Immutability per UPDATE-Trigger, `next_*`/`format_*` für `anon`/`authenticated` nicht ausführbar; UI nur read-only; FakeRest über `misc/numbering.ts`.

## 2026-06-28 – Welle 5: Vorgangsworkflow ohne DB-Änderung

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-5-vorgangsworkflow-ohne-db-änderung).

**Entscheidungen.** `expected_closing_date` = „Nächstes Nachfassdatum" (heute „Nächster Kontakttermin"), `sales_id` = „Zuständig", `stage` = Vorgangsstatus (inkl. Nachfassen, Wartet auf Hersteller); keine Migration — fachliche Lücken (dediziertes Nachfassdatum, `deal_id` an Aufgaben, Herstellerfeld) bleiben dokumentierte Kandidaten.

## 2026-06-28 – Welle 4: Typografie und comfortable density

Archiv: [Original](releases/2026-06.md#2026-06-28--welle-4-typografie-und-comfortable-density). Gestaltung: `02-design-system.md`.

**Entscheidungen.** Gebündeltes `Inter Variable` (keine CDN-Fonts), zentrale Tokens/Utility-Klassen in `src/index.css`, „comfortable density" mit 44-px-Touch-Zielen, ruhige Listenhierarchie statt bunter Flächen — ohne DataProvider, DB oder Resource-Namen anzufassen.

## 2026-06-28 – Basisentscheidungen: Atomic CRM, Resource-Namen, Vorgänge, Brandfarbe, EUR, Demo-Daten

Archiv: [Atomic CRM als Basis](releases/2026-06.md#2026-06-28--atomic-crm-als-basis-für-nora-crm), [Resource-Namen](releases/2026-06.md#2026-06-28--interne-resource-namen-bleiben-stabil), [Vorgänge](releases/2026-06.md#2026-06-28--deals-werden-sichtbar-zu-vorgängen), [Brandfarbe](releases/2026-06.md#2026-06-28--nora-brandfarbe), [EUR/de-DE](releases/2026-06.md#2026-06-28--eur-und-de-de), [Demo-Daten](releases/2026-06.md#2026-06-28--demo-daten-sind-synthetisch), [Startseite 6a](releases/2026-06.md#2026-06-28--welle-6a-öffentliche-startseite), [Auth-Navigation](releases/2026-06.md#2026-06-28--welle-6a-polish-auth-navigation), [Kanban-Polish](releases/2026-06.md#2026-06-28--vorgänge-kanban-aufräumen-kanban-polish).

**Entscheidungen.** Atomic CRM ist die Basis (React/TypeScript, Supabase-kompatibel, ohne eigenen VPS). **Interne Resource-Namen bleiben englisch** (`contacts`, `companies`, `deals`, `tasks`, `tags`) — eine harte Umbenennung würde DataProvider, Tabellen, Relations, Tests und gespeicherte Daten brechen; sichtbar und in URLs ist Nora deutsch. **„Deal" heißt sichtbar „Vorgang"** (Anfrage, Angebot, Nachfassung, Auftrag, Abschluss). Brandfarbe `#ff3b1f`. **EUR mit `de-DE`**, keine Dollar-Anzeige. **Demo-Daten sind synthetisch** (realistisch, aber keine echten personenbezogenen Daten). Öffentliche Startseite mit zwei Aktionen, `/login` als eigene Route; leere Kanban-Spalten standardmäßig ausgeblendet (Toggle in `localStorage`).

---

## Nur archivierte Einträge (reine Release-Historie)

Diese Originaleinträge enthalten keine eigene durable Regel über das oben Festgehaltene hinaus und liegen ausschließlich im Archiv:

| Eintrag | Archiv |
|---|---|
| 2026-08-25 – Repo/Produktions-Drift bei `nora_core_indexes` unabhängig bestätigt | [2026-08](releases/2026-08.md#2026-08-25--repoproduktions-drift-bei-nora_core_indexes-unabhängig-bestätigt) |
| 2026-08-25 – Customer & Contact Workflow Migration auf Produktion angewendet | [2026-08](releases/2026-08.md#2026-08-25--customer--contact-workflow-migration-auf-produktion-angewendet) |
| 2026-08-10 – Stabilization Gate 1: Deal Surface Recovery | [2026-08](releases/2026-08.md#2026-08-10--stabilization-gate-1-deal-surface-recovery) |
| 2026-07-24 – Rollen-RPC: service_role Claims-Erkennung · Identity-Cache nach Profilnamensänderung | [2026-07](releases/2026-07.md#2026-07-24--rollen-rpc-service_role-claims-erkennung) |
| 2026-07-23 – Profil-Update · DB-Lint: Funktionsvolatilität | [2026-07](releases/2026-07.md#2026-07-23--db-lint-funktionsvolatilität-und-ungenutzte-variablen) |
| 2026-07-17 – v0.4c.2c: E2E-Bootstrap · E2E-Auth-Assertions | [2026-07](releases/2026-07.md#2026-07-17--v04c2c-e2e-bootstrap-und-profilzugriff) |
| 2026-07-15 – v0.3l.1: CRM-Audit-Abschluss | [2026-07](releases/2026-07.md#2026-07-15--v03l1-crm-audit-abschluss-schema-sync-tests-abnahme) |
| 2026-07-14 – v0.3f Demo-Daten · UX-Polish Suche · v0.3h · v0.3i · Demo-Auftragswerte · v0.3j · `amountCents` → `amountEur` · v0.3k.1 · v0.3k.2 | [2026-07](releases/2026-07.md) |
| 2026-06-28 – Welle 6a · 6a-Polish · Kanban-Polish · 6b · 6c-QA · 6c-Hardening · v0.3c · v0.3d2 · v0.3d3 · v0.3d4 · v0.3d5 | [2026-06](releases/2026-06.md) |
