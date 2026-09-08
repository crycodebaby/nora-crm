# 17 – Bekannte offene Punkte und geplante Waves

Stand: 2026-09-07. Übersicht: `16-current-state.md`. Dieses Dokument enthält **nur genuin offene Punkte**: bestätigte Bugs, Restrisiken, geparkte Entscheidungen und geplante Wellen. Erledigte Punkte werden nicht gelöscht, sondern mit ihrem Originalwortlaut ins Release-Archiv verschoben (`releases/2026-08.md` und `releases/2026-09.md`, jeweils Anhang „aus `17-known-issues-…` verschoben"). Bitte Status-Tags nicht ohne erneute Code-/Live-Prüfung ändern.

Status-Legende: `OPEN` (bestätigt, nicht behoben) · `NEEDS RE-VERIFICATION` (gemeldet, im aktuellen Code nicht reproduzierbar) · `PARKED` (bewusst nicht entschieden) · `PLANNED DOMAIN WAVE` · `PLANNED FOLLOW-UP` · `ACCEPTED LIMITATION` (dokumentiert, bewusst nicht behoben).

---

## A. Sicherheit und Privilegien

### A.8 Neue Functions in `public` sind per PostgreSQL-Default für `PUBLIC` ausführbar

**Status: `ACCEPTED LIMITATION`** (unabhängig verifiziert 2026-09-07; korrigiert eine frühere Einschätzung, die Function-Defaults als „sicher" eingestuft hatte).

Eine neu erzeugte Function in `public` erhält `proacl = NULL`, also PostgreSQLs eingebauten Default `owner + PUBLIC EXECUTE` — `anon`, `authenticated` und `service_role` können sie damit sofort ausführen. Das ist **nicht** der `pg_default_acl`-Tabellendefekt, den Security Hardening Wave 1 behoben hat (früher A.1, seit dem Production-Apply 2026-09-07 aufgelöst und im Originalwortlaut im Archiv `releases/2026-09.md`): es tritt genauso in einem frisch angelegten, unkonfigurierten Schema auf.

**Korrektur 2026-09-07 (unabhängige Zertifizierung).** Eine frühere Fassung dieses Eintrags behauptete, der `PUBLIC`-EXECUTE-Default sei über `ALTER DEFAULT PRIVILEGES` überhaupt nicht abstellbar. Das ist **falsch**. Richtig ist die Unterscheidung nach Geltungsbereich:

- **Schema-scoped** (`alter default privileges for role postgres in schema public revoke execute on functions from …`) entfernt den eingebauten `PUBLIC`-Default **nicht** — auch dann nicht, wenn zusätzlich `from public` widerrufen wird: die gespeicherte Zeile wird mit dem eingebauten Default verschmolzen, und die neue Function kommt weiterhin mit `proacl = NULL` heraus (`anon`/`authenticated`/`service_role` = `true`). Genau diese Variante steht in Migration `20260907120000`; sie ist für die effektive Erreichbarkeit also wirkungslos.
- **Creator-scoped global** (`alter default privileges for role postgres revoke execute on functions from public;` — **ohne** `in schema`) entfernt ihn dagegen: die neue Function erhält `proacl = {postgres=X/postgres}`, `anon`/`authenticated`/`service_role` = `false` (lokal auf PG15 verifiziert 2026-09-07).

**Security Hardening Wave 1 ändert den globalen Function-Default nicht** und löst Function-EXECUTE-Defaults ausdrücklich nicht. Der Befund ist unverändert gegenüber dem Stand vor der Welle: Production trägt dieselbe schema-scoped Zeile `{postgres=X/postgres}` und keine globale Zeile, verhält sich also identisch.

Wirksame Gegenmaßnahme ist deshalb weiterhin **pro Function**: jede sensible Function trägt ihr eigenes `revoke all on function … from public, anon, authenticated`, so wie es die Migrationen und `06_grants.sql` durchgängig tun. Die Regressionssuite prüft genau das (Abschnitt 6c: kein Browser-Rolle-`EXECUTE` auf Executoren und privilegierte Writer) und protokolliert das Default-Verhalten als NOTICE, statt es zu behaupten. Sequenzen sind davon **nicht** betroffen: ein neues Identity-Sequence-Objekt vergibt an keine API-Rolle etwas (verifiziert), und Identity-Spalten brauchen ohnehin kein Sequenzrecht.

Eigene Folgewelle wäre nötig, falls „neue Function ist standardmäßig unerreichbar" durchgesetzt werden soll. Der naheliegende Weg ist die **creator-scoped globale** Default-Privilegien-Zeile (siehe Korrektur oben); zu bewerten wären dabei: sie gilt für **alle** Schemata, in denen `postgres` Objekte anlegt (nicht nur `public`), sie wirkt nur auf **künftige** Functions und rüstet bestehende nicht nach, und ihre Wechselwirkung mit von der Plattform angelegten Functions ist zu prüfen. Alternativen bleiben ein Event-Trigger oder eine verbindliche Migrationskonvention. Unabhängig davon gilt weiterhin: jede sensible Function bekommt ihr eigenes explizites `revoke`.

### A.9 `pg_default_acl` für Creator `supabase_admin` in `public` bleibt für Nora unerreichbar

**Status: `ACCEPTED LIMITATION`** (read-only bestätigt 2026-09-07, vor und nach dem Wave-1-Apply unverändert).

Neben der von Security Hardening Wave 1 bereinigten Zeile für Creator `postgres` existiert in `pg_default_acl` eine zweite Zeile für Creator `supabase_admin` in Schema `public`, die `anon`, `authenticated` und `service_role` weiterhin `arwdDxtm` zusagt. `postgres` ist **kein** Mitglied von `supabase_admin` (`pg_has_role` = false) und kann sie nicht ändern; sie gehört der Plattform.

**Ruhend, nicht harmlos:** die Zeile greift nur für Objekte, die `supabase_admin` in `public` anlegt. Alle 27 Relationen in `public` gehören `postgres` (die Wave-1-Migration prüft das als harte Vorbedingung und bricht sonst ab), deshalb ist heute keine Tabelle davon betroffen. Legte die Plattform künftig eine Tabelle in `public` an, erbte diese die vollen API-Rollen-Rechte — ohne dass eine Nora-Migration das verhindern könnte.

**Konsequenz für Agenten:** die Vorbedingung „alle `public`-Relationen gehören `postgres`" ist eine Sicherheitsannahme, kein Formalismus. Wer sie bei einem Befund verletzt sieht, behandelt das als Sicherheitsvorfall und nicht als Aufräumarbeit.

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

**Status: `OPEN (LOW)`** (V1C-A.6) — eine handgesetzte Id wäre möglich; praktisch zeigt eine weiche `employee_sale_id` in `email_delivery_events` nie auf einen anderen Mitarbeiter (Sequenz nur vorwärts, kein Codepfad setzt Ids), `recipient_email_snapshot` ist die Gegenprobe. `GENERATED ALWAYS` wäre eine eigene Entscheidung an einer bestehenden Tabelle. W6-B (live) hängt die Löschautorisierung deshalb nie nur an die Nummer (Ticket bindet Auth-UUID + Entity + Identitäts-Snapshot; Suite beweist die Wiederverwendungs-Abwehr).

## B. Mitarbeiter-Lifecycle (offen nach W1–W6-A)

Aktuelle Architektur: `19-user-lifecycle-architecture.md` (Roadmap in §17, Einschränkungen in §16).

- **W6-B Kontrollierter Hard Delete** („Benutzerkonto endgültig löschen") — `PRODUCTION VERIFIED` (2026-09-07). Migration `20260906230000_nora_lifecycle_account_deletion` live (Ledger beim W6-B-Release 56; aktueller Stand siehe `16-current-state.md`), `users`-Edge **v9**, Frontend-Abschnitt live; Vertrag in `19-user-lifecycle-architecture.md` §15, Runbook im Archiv. Beim Release erledigt: Production-Apply, Edge-Deploy, Push und der destruktive Live-Smoke nach expliziter PO-Freigabe am benannten Ziel (Kandidat `sales 4`: eingeladen/nie aktiviert, deaktiviert, gebannt, 0 Geschäftsreferenzen, 0 Actor-Audit, 24 Ziel-Audit-Zeilen, 0 Zustellzeilen — read-only am 2026-09-06 erneut bestätigt). Bewusst nicht Teil von W6-B: Orphan-Cleanup einer Auth-Identität ohne `sales`-Zeile (wird verweigert, Runbook-Fall), Retention/Anonymisierung, `GENERATED ALWAYS` (A.7).
- **W6-B Betriebsfolge (live seit 2026-09-07):** Auth-Benutzer mit Nora-`sales`-Zeile lassen sich im Supabase-Dashboard nicht mehr löschen (Guard, gewollt — gleiche Haltung wie W4); direkte `DELETE FROM sales` per SQL sind für alle Rollen verweigert. Test-Fixtures werden per Rollback entfernt. `ACCEPTED LIMITATION`.
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

### G.3 Dashboard sendet eine fehlerhafte Kontakt-Id-Abfrage (`contacts?id=in.(1,1,,29,)`)

**Status: `OPEN`** (beobachtet 2026-09-07 während der Untersuchung des Hauptansprechpartner-Zwischenfalls; bewusst **nicht** Teil der Atomic-Contact-Primary-Intent-RC). Die Startseite fragt Kontakte mit einer `id=in.(…)`-Liste ab, die Duplikate und leere Elemente enthält (`1,1,,29,`). PostgREST verweigert die leere Elemente; die Ursache liegt in der Zusammensetzung der Kontakt-Id-Liste im Dashboard, nicht im Kontakt-Speicherpfad. Eigene, kleine Korrektur mit Regressionstest — vorher nicht im Kontakt-Kontext „mitfixen".

### G.4 Atomic Contact Primary Intent — offen nach dem Release (2026-09-08)

**Status: die Welle selbst ist `PRODUCTION VERIFIED`** (2026-09-08, Migration `20260908120000`, Ledger 58, PO-Live-Smoke akzeptiert — `06-decision-log.md` „2026-09-08 – Atomic Contact Primary Intent", Evidenz `releases/2026-09.md`). Hier stehen nur die **bewusst offen gebliebenen** Restpunkte. Restpunkte: `contacts.import` (CSV) und die Notiz-/Aufgaben-Pfade schreiben Kontakte weiterhin roh und additiv (`is_primary` nie `true`) — beabsichtigt, kein Risiko für den Index, aber ohne Operation-Korrelation. Die Markierungen-RC (`74a67659`, älterer `main`) berührt `noraErrorCodes`, `normalizeCrmError` und die Kataloge und muss auf **diesen** Stand portiert werden (rein textuelle Konflikte erwartet). `set_primary_contact` hat weiterhin kein UI und behält seinen `service_role`-Grant aus 2026-08-25.

Nach den beiden Blocker-Fixes (RC `0fb3d6ba`, zwei unabhängige Reviews 2026-09-08) zusätzlich bewusst **offen und ausserhalb dieser Welle**:

- **Selbstkontakt eines Privatkunden ist weiterhin auf einen anderen Kunden verschiebbar** (INFO, vorbestehend, nicht durch diese Welle entstanden): `public.update_contact` mit `company_id`-Patch erlaubt es, den in `companies.self_contact_id` referenzierten Kontakt einer Privatkundenakte wegzubewegen. Der Lock-Fix ändert daran nichts (bewusst geprüft: Abschnitt 9 der Suite bleibt grün). Eigene, kleine Welle mit einem Guard — nicht im Kontakt-Speicherpfad „mitfixen".
- **`set_primary_contact` behält seinen `service_role`-Grant** aus 2026-08-25, obwohl kein deployter Backend-Pfad ihn nutzt. Die Review nannte das als Aufräumpunkt; er war nicht der gemeldete Defekt und wurde im Blocker-Fix bewusst nicht angefasst (eigene Grant-Welle, zusammen mit A.8).
- **Rohe Kontakt-Namensschreibungen bleiben rohe Pfade.** „Kontakte zusammenführen" (`dataProvider.mergeContacts`) und der CSV-Import schreiben `contacts.first_name`/`last_name` weiterhin ohne Absicht und ohne Operation-Korrelation. Das ist beabsichtigt (sie verschieben die Rolle nicht) und seit dem Advisory-Mutex auch deadlockfrei — aber sie erscheinen nicht im Operationsprotokoll. Wenn Merge je eine eigene Operation bekommen soll, ist das eine eigene kleine Welle, kein Locking-Thema.
- **`nora_private.sync_individual_company_name` bleibt ein synchroner Trigger.** Er wurde bewusst nicht entfernt, deferred oder umgebaut: die Privatkunden-Namenssynchronisation ist eine durable Invariante. Jeder künftige Trigger, der `contacts` → `companies` (oder umgekehrt) schreibt, ist per Konstruktion kontaktzeilen-zuerst und muss in der T-Matrix mitgerannt werden (`07-agent-change-checklist.md`).
- **Der bestehende Kern kann bei einem konkurrierenden Kontaktumzug `40001` („contact moved concurrently; retry") werfen** — dieselbe beschränkte Schleife wie `public.update_contact`, drei Versuche. Erreichbar nur über `create_customer_with_contact` mit `p_existing_contact_id`, wenn derselbe Kontakt gleichzeitig anderswo verschoben wird; in 120 Cross-Command-Rennen nie beobachtet. Falls dieser Fall je im Feld auftritt, gehört er in den Fehlerkontrakt (`NORA_*`-DETAIL), nicht in einen stillen Retry.

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

- **Schema `storage` / Attachment-Bucket** — `OPEN`, **ausdrücklich nicht** Teil von Security Hardening Wave 1. Öffentlicher Bucket laut Lifecycle-Reconnaissance 2026-09-04; zusätzlich read-only bestätigt (2026-09-07): `pg_default_acl` für Creator `postgres` in Schema `storage` vergibt `arwdDxtm` an `anon`, `authenticated` und `service_role` — dieselbe Form wie der in `public` behobene Tabellendefekt (früher A.1, Archiv `releases/2026-09.md`), aber mit anderem Owner, anderer Plattformmechanik und anderem Rollback-Pfad (`storage.objects`/`storage.buckets` gehören `supabase_storage_admin`). Braucht eine eigene Security-/Produktwelle mit eigener Abnahme; Wave 1 hat `storage` **nicht** angefasst und behauptet keine Härtung dort.
- **`mcp` Edge Function** — `PARKED`, nicht deployt. Sie kann eine direkte PostgreSQL-Verbindung aufbauen und `set role authenticated` setzen. Wave 1 reduziert den Schaden eines solchen Kanals (`authenticated` hat kein `TRUNCATE`/`DELETE` mehr, wo es nichts zu suchen hat), ersetzt aber keine eigene Bewertung dieser Funktion vor einem etwaigen Deploy.
- Rollen-Cache-Verhalten im Frontend
- Audit-Retention-/Löschstrategie (`13-crm-audit-retention.md` beschreibt das Modell; kein automatischer Purge)
- `supabase/config.toml` enthält lokal weiterhin `enable_signup = true` (steuert Produktion nicht; dort ist die Selbstregistrierung seit 2026-09-04 deaktiviert) — in einer kleinen Welle nachziehen.
