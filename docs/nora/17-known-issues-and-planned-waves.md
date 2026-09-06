# 17 – Bekannte offene Punkte und geplante Waves

Stand: 2026-09-06. Übersicht: `16-current-state.md`. Dieses Dokument enthält **nur genuin offene Punkte**: bestätigte Bugs, Restrisiken, geparkte Entscheidungen und geplante Wellen. Erledigte Punkte werden nicht gelöscht, sondern mit ihrem Originalwortlaut ins Release-Archiv verschoben (`releases/2026-08.md` und `releases/2026-09.md`, jeweils Anhang „aus `17-known-issues-…` verschoben"). Bitte Status-Tags nicht ohne erneute Code-/Live-Prüfung ändern.

Status-Legende: `OPEN` (bestätigt, nicht behoben) · `NEEDS RE-VERIFICATION` (gemeldet, im aktuellen Code nicht reproduzierbar) · `PARKED` (bewusst nicht entschieden) · `PLANNED DOMAIN WAVE` · `PLANNED FOLLOW-UP` · `ACCEPTED LIMITATION` (dokumentiert, bewusst nicht behoben).

---

## A. Sicherheit und Privilegien

### A.1 Default-Privilegien im Schema `public` vergeben TRUNCATE an API-Rollen

**Status: `OPEN / PLANNED FOLLOW-UP`** (festgestellt 2026-09-04, gegen `nora-crm-prod` verifiziert; Folgebefund aus Security Hardening Wave 0)

Die Default-Tabellen-Privilegien von `public` (Grantor `postgres`) vergeben an `anon`, `authenticated` und `service_role` bei jedem `CREATE TABLE` automatisch `Dxtm` (`TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN`) — noch vor jedem expliziten Grant. Eine Migration, die nur additiv `grant select` schreibt, lässt dieses Erbe stehen; so entstand der `audit_events`-Befund. `TRUNCATE` umgeht RLS vollständig und feuert keine Row-Trigger.

Stand in Production nach Wave 0:

| Klassifikation | Tabellen |
|---|---|
| sauber | `audit_events` (Wave 0), `email_delivery_events`, `number_counters`, `operation_errors` |
| **read-only für `authenticated`, aber truncatable** — gleiche Form wie der `audit_events`-Bug | `configuration`, `google_calendar_connections`, `google_calendar_events` |
| truncatable, besitzt aber ohnehin `DELETE` (RLS-Bypass bleibt relevant) | `checklist_*`, `companies`, `contact_notes`, `contacts`, `deal_notes`, `deals`, `favicons_excluded_domains`, `sales`, `saved_text_snippets`, `tags`, `tasks` |

Zusätzliche Repo-/Production-Drift: `supabase/schemas/06_grants.sql` deklariert `alter default privileges … grant all on tables` (lokal `arwdDxtm`), Production vergibt nur `Dxtm`; die Verengung ist in keiner Repo-Migration enthalten. **Ein lokaler `db reset` reproduziert Production nicht** — lokal erhält `authenticated` auf neuen Tabellen mehr Rechte als live.

Vorschlag für eine eigene Welle: (1) `configuration`, `google_calendar_connections`, `google_calendar_events` auf `revoke all` → gezielter `grant` bringen; (2) entscheiden, ob die Default-Privilegien dauerhaft korrigiert und im Repo festgeschrieben werden; (3) entscheiden, ob `service_role` `TRUNCATE` auf `audit_events` behält; (4) `public.init_state` mitnehmen (trägt wirkungslose DML-Grants für `anon`/`authenticated`). Ablauf wie Wave 0: lokaler Replay, Verhaltensnachweis pro Rolle, Production-Apply, Live-Verifikation.

### A.2 Fail-closed Session-Bindung: Leserecht von `postgres` auf `auth.sessions` ist Betriebsvoraussetzung

**Status: `ACCEPTED LIMITATION`** (W6-A, `PRODUCTION VERIFIED` 2026-09-06). Seit W6-A verweigert `nora_private.jwt_session_is_live()` jede nicht prüfbare Sitzung (`WARNING` „session binding DENIED"). Verliert `postgres` das Leserecht auf `auth.sessions`, sehen deshalb **alle** Mitarbeiter sofort keine Daten. Kein Angriffspfad; in Production ist das Recht vorhanden (direkt **und** über `pg_read_all_data`). Diagnose: Log-Suchbegriff „session binding DENIED" und `select nora_private.session_binding_health()` (nur `postgres`); Abhilfe: Leserecht wiederherstellen, keine Nora-Codeänderung. Der frühere Fail-open-Punkt (W5) ist aufgelöst und im Originalwortlaut im Archiv (`releases/2026-09.md`, Anhang).

### A.3 Restlaufzeit eines alten JWT nur durch RLS gedeckt

**Status: `ACCEPTED LIMITATION`** — ein JWT bleibt bis `exp` kryptografisch gültig; PostgREST akzeptiert es, die Datenbank verweigert (deaktiviert und/oder Sitzung gelöscht). Autorisierungs-, keine Authentifizierungsentwertung. Kein Pfad in Nora liefert einem solchen Token Daten.

### A.4 `public.insert_audit_event` bleibt für `service_role` ausführbar

**Status: `PLANNED FOLLOW-UP`** — Aufrufer sind die Google-Kalender-Edge-Functions (Actor `System`). Vorbestehende generische Schreibfähigkeit; die `users`-Function nutzt sie seit W3 nicht mehr. Kandidat: schmale Writer je Function.

### A.5 401-Antworten der Edge Functions tragen JOSE-Wortlaut

**Status: `OPEN (LOW)`** — `_shared/authentication.ts` gibt den Fehlertext der JOSE-Bibliothek zurück (z. B. „JWSInvalid: …"). Keine Daten, aber technisches Vokabular. Auf neutralen Text reduzieren.

### A.6 `record_operation_error` weist die bestehenden camelCase-Operationstypen ab

**Status: `OPEN`, vorbestehend (bemerkt in W4)** — `public.record_operation_error` akzeptiert nur `^[a-z][a-z0-9_.]*$`; die Katalogtypen `quickCapture.createCase`, `customer.createWithContact`, … werden seit jeher mit `invalid operation_type` abgewiesen — technische Fehlschläge dieser Operationen landen nie in `operation_errors` (der Recorder ist best-effort und schweigt). W4/W5 nutzen deshalb `employee.change_login_email` / `employee.offboard`. Eigene Folgewelle: Katalog oder Check-Constraint anpassen, Suite ergänzen.

### A.7 `public.sales.id` ist `GENERATED BY DEFAULT`

**Status: `OPEN (LOW)`** (V1C-A.6) — eine handgesetzte Id wäre möglich; praktisch zeigt eine weiche `employee_sale_id` in `email_delivery_events` nie auf einen anderen Mitarbeiter (Sequenz nur vorwärts, kein Codepfad setzt Ids), `recipient_email_snapshot` ist die Gegenprobe. `GENERATED ALWAYS` wäre eine eigene Entscheidung an einer bestehenden Tabelle. W6-B (RC) hängt die Löschautorisierung deshalb nie nur an die Nummer (Ticket bindet Auth-UUID + Entity + Identitäts-Snapshot; Suite beweist die Wiederverwendungs-Abwehr).

## B. Mitarbeiter-Lifecycle (offen nach W1–W6-A)

Aktuelle Architektur: `19-user-lifecycle-architecture.md` (Roadmap in §17, Einschränkungen in §16).

- **W6-B Kontrollierter Hard Delete** („Benutzerkonto endgültig löschen") — `RC VERIFIED — NOT RELEASED` (2026-09-07). Migration `20260906230000_nora_lifecycle_account_deletion`, `users`-Edge-Änderung (neue Version erst mit Deploy), Frontend-Abschnitt; Vertrag in `19-user-lifecycle-architecture.md` §15, Runbook im Archiv. Offen bis zum Release: Production-Apply, Edge-Deploy, Push, **explizite PO-Freigabe** für den destruktiven Live-Smoke am benannten Ziel (Kandidat `sales 4`: eingeladen/nie aktiviert, deaktiviert, gebannt, 0 Geschäftsreferenzen, 0 Actor-Audit, 24 Ziel-Audit-Zeilen, 0 Zustellzeilen — read-only am 2026-09-06 erneut bestätigt). Bewusst nicht Teil von W6-B: Orphan-Cleanup einer Auth-Identität ohne `sales`-Zeile (wird verweigert, Runbook-Fall), Retention/Anonymisierung, `GENERATED ALWAYS` (A.7).
- **W6-B Betriebsfolge (ab Release):** Auth-Benutzer mit Nora-`sales`-Zeile lassen sich im Supabase-Dashboard nicht mehr löschen (Guard, gewollt — gleiche Haltung wie W4); direkte `DELETE FROM sales` per SQL sind für alle Rollen verweigert. Test-Fixtures werden per Rollback entfernt. `ACCEPTED LIMITATION`.
- **W9 SQL-Verifikationssuiten in CI** — `PLANNED FOLLOW-UP`. Die kanonische Sequenz (`07-agent-change-checklist.md`) läuft weiterhin nur lokal; `rbac_rls_first_admin_parallel_runner.ps1` hat einen bekannten Windows-Regex-Bug (Vorbedingung „sales must be empty" wird falsch geparst) — Workaround: die enthaltene SQL manuell mit zwei parallelen `psql`-Sessions nachbilden, das Skript nicht nebenbei patchen.
- **Dialog „Zugang beenden" nennt das Ziel nur über Anmeldeadresse und Status** — `OPEN (UX)`. Im Live-Beweis 2026-09-06 traf der Product Owner damit einen echten Administrator statt des Testkontos (sofort reaktiviert; Sitzungen blieben gelöscht → Neuanmeldung). Kein Codefehler. Härtung: Name im Dialogkopf, zusätzliche Bestätigung bei Admin-Zielen.
- **Rollenwechsel wird in der Benutzer-UI nicht als eigener sichtbarer Vorgang bestätigt** — `OPEN (LOW, UX)`; im W3-Live-Beweis entstanden vier Rollenwechsel, wo zwei beabsichtigt waren.
- **`invalid_payload` → Rollen-Fehlertext** in `SalesEdit` (nur noch bei echten ungültigen Payloads erreichbar) — `OPEN (LOW, UX)`.
- **GoTrue verbirgt die Guard-Verweigerung** (`500 unexpected_failure` statt `NORA_EMAIL_CHANGE_NOT_AUTHORIZED`); der Fall wird als `email_change_provider_failed` gemeldet, nichts verändert — nur Diagnose, keine Korrektheit betroffen. `ACCEPTED LIMITATION`.
- **Selbständerung der Anmeldeadresse blockiert** (Lockout-Schutz) — ein einzelner Administrator braucht einen zweiten oder die technische Betreuung; eine bestätigungsbasierte Selbständerung wäre eine spätere Welle. `PARKED`.
- **Selbstbedienungs-Änderung über GoTrue (`PUT /auth/v1/user`)** scheitert an der Datenbank (`500` beim Bestätigen) — gewollt, aber nicht benutzerfreundlich formuliert; es gab nie eine Nora-Oberfläche dafür. `ACCEPTED LIMITATION`.
- **E-Mail-Drift wird nur erkannt, nicht repariert** (`identityConsistency = inconsistent`, keine Aktion im Panel; kein Runbook, da kein Production-Fall). `ACCEPTED LIMITATION`.
- **Neue Einladung nach E-Mail-Änderung ist nicht atomar** (`email_change_invitation_failed`, `emailChanged: true`; Administrator nutzt „Einladung erneut senden"). `ACCEPTED LIMITATION`.
- **Bann-Ausfall nach erfolgreichem DB-Schritt** beim Offboarding meldet `employee_access_sync_incomplete` (`offboarded: true`); Konvergenz über Retry oder „Zugangsstatus synchronisieren", keine Automatik. `ACCEPTED LIMITATION`.
- **Kein „Sitzungen beenden" für bereits Deaktivierte in der Oberfläche** (der Executor deckt den Fall; die Session-Bindung entwertet Restsitzungen ohnehin). `ACCEPTED LIMITATION`.
- **Aufgaben-Follow-up nur als Zähler** (keine Desktop-Aufgabenliste mit Route); Umverteilung bleibt normales Bearbeiten. `ACCEPTED LIMITATION`.
- **`x-nora-operation-id` aus dem Browser** erreicht die `users`-Function nur für W4/W5-Aktionen (Operation Manager); PATCH/Invite werden serverseitig geprägt — additive Verbesserung. `PLANNED FOLLOW-UP`.
- **Retention/Anonymisierung personenbezogener Audit-Metadaten** (`invitee_email`, `employee_email`, `changes.email`) — `PARKED`, siehe `13-crm-audit-retention.md`.
- **`user.invited` ist nicht in derselben Transaktion wie die Rolle** (GoTrue + Executor + Record-RPC; bei Audit-Fehler `audit_write_failed`, Retry meldet `already_exists`) — bewusst kein verteiltes Commit. `ACCEPTED LIMITATION`.
- **Deaktivierter Admin, Rollenwechsel** (LOW-W3-UX-Frage) — `OPEN (LOW)`.
- **FakeRest kennt die Datenbank-Guards nicht** (Demo hat keine Autorisierung auf Datenebene) — dokumentierte Demo-Lücke, `ACCEPTED LIMITATION`; eine vollständige FakeRest-Autorisierungsparität wäre eine eigene Welle.
- **Produktionsstand nach W5** (Kontext, kein Bug): 3 `user.offboarded`-Zeilen (1× `sales 2` Zwischenfall, 2× Testkonto `sales 4`); Testkonto-Anmeldeadresse ist eine unechte Adresse außerhalb der Firmendomain; `sales 2` aktiv, ohne Sitzungen bis zur nächsten Anmeldung.

## C. E-Mail-Zustellbeobachtung (V1C)

Vertrag: `18-email-delivery-observability.md`.

- **V1C-A.7 `mail_kind` bleibt im echten Betrieb `unknown`** — `OPEN`, Ursache eingegrenzt (A: Betreff-Drift im Dashboard, B: kein `subject` in der Brevo-Nutzlast). Die Edge Function (v2) protokolliert bei `unknown` ein inhaltsfreies `subject_present`-Bit; es wurde **noch nie ausgelöst**, weil seit dem v2-Deploy keine Nora-E-Mail versendet wurde. Entscheidbar beim nächsten kontrollierten Versand (ausgehende Aktion, braucht Freigabe). Blockiert nichts — die UI rendert die Mailart nicht.
- **V1C-A.8 Edge-Log-Stream für erfolgreiche Webhook-Aufrufe unvollständig** — `OPEN` (Beobachtbarkeitslücke, kein Funktionsfehler). Zustellprobleme über `email_delivery_events` und die Brevo-Webhook-Historie untersuchen, nicht über `function_edge_logs`.
- **V1C-A.4 / V1C-B.1 Deterministische Sendekorrelation** (Supabase Send Email Hook + Brevo-API-Versand mit eigener Korrelations-ID) — `PARKED`; ersetzt den Auth-Mailversand, eigene Architekturentscheidung. Erst danach dürfte eine UI „**diese** Einladung wurde zugestellt" sagen.
- **V1C-B.2 Feinere Unterscheidung innerhalb `undeliverable`** (Hard Bounce / Blocked / Invalid) — `PARKED`; nächster Admin-Schritt ist in allen Fällen derselbe.
- **V1C-A.5 Privilegierte Purge für Test-/Fake-Benutzer** in `email_delivery_events` — im W6-B-RC als **schmale Purge innerhalb der Kontolöschung** umgesetzt (nur `employee_sale_id = sale` **und** Adresse aus der Identitätshistorie; Fremdadressen bleiben und werden gezählt). Allgemeine Aufbewahrungsfristen bleiben nicht entschieden (`PARKED`).
- **Weitere Edge Functions im Repo sind nicht deployt** (`calendar-*`, `merge_contacts`, `delete_note_attachments`, `update_password`, `postmark`, `mcp`) — Kontext, kein Bug; nur `users` (v8) und `brevo-email-events` (v2) sind live. Edge Functions werden nie von Vercel ausgeliefert.

## D. Operationen, Fehler, Feedback

### D.1 Operation Manager — pendente Operationen ohne eigenen TTL

**Status: `ASSESSED — LOW — PLANNED FOLLOW-UP`** — `enforceCapacity()` eviktiert nur nicht-pendente Records; pendente haben keinen Timeout-Lifecycle. Vorbestehend seit Foundation Wave 2; bewusst kein neuer Lifecycle-Status ohne reale Semantik (Falle 37). Bei Bedarf eigene Welle mit explizitem Timeout-Mechanismus. Folge: eine `pending`-Karte lässt sich schließen (blendet nur aus), `retentionSoftCap` ist kein hartes Limit.

### D.2 Notification-UI — offen nach Phase 7B (geplant für 7C)

- Weitere Intents: `deal.update`, `customer.createWithContact`, `contact.convertToCustomer` — je Policy-Eintrag + Controller.
- Isolierter Task-Retry (Core committed, Aufgabe unter eigenem Idempotency-Scope wiederholen) — braucht eigene Entscheidung; Retry ist nie allein aus `errorCode` ableitbar.
- Migration der `OPERATION_CATALOG`-Literale, die `DealEdit.tsx` als Pseudo-i18n-Key nutzt.
- Hardening (LOW): eine vorgegebene `operationId` wird registriert, ohne die tatsächlich vergebene zu prüfen (Falle 38; im ausgelieferten Code nicht erreichbar); `announced`-Set im Announcer ist unbegrenzt.
- UX-Polish (LOW): langer Vorgangstitel verdrängt den Kundennamen in der Kontextzeile; Hover-Pause wirkt bei offenem Dialog nicht (bewusster Preis des Click-through); ein Schritt-Tab kann bei offenem Quick-Capture-Dialog überlagert werden (funktional folgenlos).
- Bewusst nicht als Follow-up geöffnet: `drawer-content` (vaul) ist von der modal-aware Regel nicht erfasst (kein Flow betroffen); Prettier-Drift in `providers/fakerest/dataProvider.ts`; Radix-Warnung `Missing Description`; `react-refresh`-ESLint-Warnung bei Provider-Dateien; ein einmaliges Redirect-Race im Demo-Modus nach Quick Capture.
- Phase 8 oder später: sichtbare IT-Eskalation (`canEscalateToIT`/`publicErrorRef` existieren im Contract, es fehlt der Incident-Workflow), persistente Notification-History, Browser-Push, Ablösung von sonner (bis dahin zwei Feedback-Schichten, jeder Flow gehört genau einer).
- Kein Live-**Write**-Smoke der Schnellerfassung in Production (kein freigegebener Testdatensatz) — gedeckt durch Browser-Integrationstests und lokale Abnahme; kein Blocker.

### D.3 FakeRest ohne Datenebene-Autorisierung

`NORA_PERMISSION_DENIED` ist in FakeRest strukturell nicht end-to-end testbar (nur `canAccess` in der UI). `PLANNED FOLLOW-UP`, eigene größere Welle.

### D.4 Legacy-Regex in `normalizeCrmError`

Bleibt als Fallback bestehen, bis nachgewiesen ist, dass alle relevanten Production-Aufrufer `DETAIL` liefern. `PLANNED FOLLOW-UP`.

## E. PWA und Motion

- **Reduced-Motion-Dauer der Update-Choreografie** — `PARKED` (Product-Frage): bei `prefers-reduced-motion: reduce` steht die Bewegung, die Dauer bleibt 8 s. Empfehlung: ~2,5 s und direkt in die ruhige Szene.
- **Nora Loading Motion System** — `PLANNED DOMAIN WAVE`, nicht begonnen. Zwei identische Spinner-Komponenten (`ui/spinner.tsx`, `admin/spinner.tsx`), ~13 direkte `animate-spin`-Vorkommen, ~45 `Loader2`/`Spinner`-Referenzen in ~25 Dateien, dazu Skeleton/Progress und der PWA-Orb. Empfehlung: zentraler Motion Primitive, beide Spinner darauf umstellen, Inline-Stellen nachziehen; Reduced Motion, Hell/Dunkel, 44-px-Touchziele mit abnehmen.
- **Live-Browser-Verifikation des PWA-V2-Happy-Path** (alter Tab → „Neue Nora-Version verfügbar" → „Jetzt aktualisieren" → Bestätigung genau einmal → zweites F5 ohne Bestätigung) — `NEEDS RE-VERIFICATION`: beim Release `672ebc76` (2026-09-01) nur per Bundle-Copy-Guard geprüft; der 1B–1C.3-Happy-Path war beim Kanban-Release live bestätigt.
- Bekannte Plugin-Eigenheiten (LOW, `vite-plugin-pwa`, bewusst offen gelassen): Assessment `nothing` (Worker verschwindet ohne Ersatz — Choreografie ohne Exit, theoretisch); kontrollierte Nicht-Klick-Tabs laden nach Fremdaktivierung sofort neu; ein < 60 s nach Registrierung gefundener Worker löst im unkontrollierten Dokument kein `onNeedRefresh` aus. Der State Contract wird dafür nicht wieder geöffnet.
- **Multi-Tab:** aktualisiert ein Benutzer in einem Tab, laden alle anderen Nora-Tabs ebenfalls neu — ungespeicherte Eingaben dort gehen verloren. Bewusst ohne Cross-Tab-Architektur. `ACCEPTED LIMITATION`.
- **Nach jedem Deployment liefert der Service Worker beim ersten Aufruf noch den Vorgänger-Build** — gewollt (Prompt-Modus); Release-Smokes müssen „Jetzt aktualisieren" auslösen oder in frischem Profil testen (`07-agent-change-checklist.md`).

## F. Design-System (projektweit)

- **Kontrast der Nora-Primäraktion unterschreitet AA** — `OPEN (LOW, projektweit)`: `.nora-primary-action` Weiß auf `--nora-brand` (`#ff3b1f`) misst 3,56:1 (< 4,5:1), in Hell und Dunkel identisch. Empfehlung: Markenton für weiße Textflächen projektweit absenken oder `--nora-brand-on-white` einführen, dann alle Primäraktionen nachmessen. PO-Entscheidung (Markenfarbe).
- **`.nora-primary-action` unterschreitet das 44-px-Touch-Minimum** — `OPEN (LOW, projektweit)`: `@apply min-h-10` landet in Tailwinds `utilities`-Layer und schlägt `min-h-11`/`min-h-12` am selben Element sowie jede `components`-Regel (40 px gemessen). Vermutlich weitere Stellen betroffen (`ContactCreateSheet.tsx`, `DealProductionChecklistSection.tsx`), nicht nachgemessen. Nur im Systemereignis über eine ungelayerte Regel gelöst. Empfehlung: `min-h-10` entfernen, Höhe über `--nora-touch-min`, Aufrufstellen nachmessen.
- **Dark-Mode der öffentlichen Zugangs-Shell** — Tokens vorbereitet (`--nora-access-*`), kein `.dark`-Block. `PLANNED FOLLOW-UP`.
- **Echter Screenreader-Lauf und echte Reduced-Motion-Browsereinstellung** für Onboarding (V1B) und PWA-Fläche — nur per injizierter Stylesheet-Regel bzw. Code-Review gedeckt. `NEEDS RE-VERIFICATION`.
- **Pflicht-Stern an Labels** auf der Mitarbeiterfläche ist react-admin-Standard — Folgeentscheidung, falls unerwünscht (projektweit). `PARKED`.

## G. Kunden, Kontakte, Vorgänge, Aufgaben

### G.1 Kundenanlage — Findings aus Customer Create Speed & Clarity (2026-09-01)

Beobachtet, bewusst nicht in dieser Wave behoben:

1. **Produktions-Datenhygiene `companies.country`** (LOW, Daten): Bestand enthält `"Deutschland "` (mit Leerzeichen), `"DE"`, `"Deutschland"` und `NULL`; neue Kunden erhalten konsistent `"Deutschland"`. Ein einmaliges, vom Product Owner freigegebenes Read-Then-Update der abweichenden Bestandswerte wäre sinnvoll — kein Constraint, Freitext bleibt Freitext.
2. **Demo-Seed `state_abbr = "NW"` vs. Produktion/PO `"NRW"`** (LOW, Demo): für Demo-Konsistenz auf „NRW" angleichen (`05-demo-data-guidelines.md`).
3. **Ansprechpartner-Unterabschnitt auf `/kunden/create`** (MEDIUM, UX): E-Mail-Liste trägt das Label „Persönliche Angaben", Telefon-/Link-Listen sind unbeschriftet (drei ⊕-Buttons). Gehört in eine Contact-Wave (`CustomerContactCaptureInputs.tsx`).
4. **Privatperson: Namensfelder stehen ganz unten** (MEDIUM, UX): Vor-/Nachname ist bei `individual` das wichtigste Feld — Slot direkt unter der Kundenart wäre der saubere Fix (strukturell).
5. **Leerer rechter Rand auf `/kunden/create`** (LOW, Layout): `lg:mr-72` reserviert Platz für ein nicht vorhandenes Aside; bewusste `max-w`-Regel im Design System nötig.
6. **E-Mail/Telefon erfordern erst einen ⊕-Klick** (LOW, UX, geteiltes `ArrayInput`-Muster von Kunden und Kontakten) — nicht isoliert ändern.

### G.2 Geplante Domain-Waves

- **Privatperson/Firma-Unterscheidung in Quick Capture** — `PLANNED FOLLOW-UP`: die Schnellerfassung erzeugt Kunden ohne `customer_kind`-Auswahl (Default `business`); die „Diese Person ist selbst Ansprechpartner"-Option fehlt dort bewusst (Self Contact Wave).
- **Customer-Archive-/Soft-Delete-Lifecycle** (`ArchiveCustomer`/`RestoreCustomer`) — `PLANNED FOLLOW-UP`, kein Zeitdruck. Domänenregel steht (INAKTIV ≠ NICHT-EXISTENT, W2); bisher nur die Self-Contact-Delete-Invariante abgesichert; kein generisches Archiv-Framework.
- **Legacy-Spalten-Cleanup** (`companies.linkedin_url`, `website`, `context_links`, `phone_number`, `contacts.linkedin_url`) — `PLANNED FOLLOW-UP`, kein Zeitdruck; erst nach Übergangszeit und Bestätigung, dass keine Integration (CSV-Import, alte Clients) mehr schreibt.
- **Mobile „Aufgaben"-Bereich auf der Kundenakte** — der Tab existiert nur im Desktop-`CompanyShow`; `CompanyShowContentMobile` hat keine Tab-Struktur. `PLANNED FOLLOW-UP`.
- **`deals.contact_ids bigint[]`** als Vorgang-Domain-Debt (keine FK-Integrität pro Element, keine Rollen-/Zeitdimension) — `PLANNED DOMAIN WAVE`, nicht designt.
- **Kontakterstellung UI-Polish**: förmliche Rollen-UX-Abnahme nach `12-role-ux-acceptance.md` nie durchlaufen (technisch deployed). `NEEDS RE-VERIFICATION`.
- **Application Queries / Read Models** für künftige KI-/Automatisierungs-Konsumenten (Falle 36) — Richtung dokumentiert, nichts implementiert.

## H. Bekannte, nicht untersuchte Themen

Aus einer frühen Analyse benannt, seither **nicht** in einer Session verifiziert oder detailliert — vor Bearbeitung gegen aktuellen Code/Produktion prüfen:

- Attachment-Bucket-Konfiguration (öffentlicher Bucket laut Lifecycle-Reconnaissance 2026-09-04; keine Härtung entschieden)
- Rollen-Cache-Verhalten im Frontend
- Audit-Retention-/Löschstrategie (`13-crm-audit-retention.md` beschreibt das Modell; kein automatischer Purge)
- `supabase/config.toml` enthält lokal weiterhin `enable_signup = true` (steuert Produktion nicht; dort ist die Selbstregistrierung seit 2026-09-04 deaktiviert) — in einer kleinen Welle nachziehen.
