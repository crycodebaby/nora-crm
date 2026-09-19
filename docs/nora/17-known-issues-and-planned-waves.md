# 17 – Bekannte offene Punkte und geplante Waves

Stand: 2026-09-19. Übersicht: `16-current-state.md`. Dieses Dokument enthält **nur genuin offene Punkte**: bestätigte Bugs, Restrisiken, geparkte Entscheidungen und geplante Wellen. Erledigte Punkte werden nicht gelöscht, sondern mit ihrem Originalwortlaut ins Release-Archiv verschoben (`releases/2026-08.md` und `releases/2026-09.md`, jeweils Anhang „aus `17-known-issues-…` verschoben"). Bitte Status-Tags nicht ohne erneute Code-/Live-Prüfung ändern.

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

### A.10 `anon` besitzt in Production `EXECUTE` auf vier nicht-Trigger-Functions in `public`

**Status: `OPEN (LOW)`** (read-only verifiziert 2026-09-10; keine Fixwelle beauftragt. Nachtrag 2026-09-16: der fünfte Treffer `public.get_note_attachments_function_url` **existiert nicht mehr** — W8-B hat die Function mit dem Anhang-Löschpfad entfernt, H.1. Die Bewertung der verbliebenen vier ist unverändert.)

Konkrete Ausprägung von A.8: `anon` hält in Production `EXECUTE` auf `public.get_avatar_for_email`, `public.get_domain_favicon`, `public.merge_contacts` und `public.nora_entity_uuid` — alle vier mit „echtem" Rückgabetyp und damit als PostgREST-RPC erreichbar. Die Ursache ist nicht für alle dieselbe: bei `get_avatar_for_email`, `get_domain_favicon` und `merge_contacts` trägt der eingebaute `PUBLIC`-EXECUTE-Default (A.8) allein — es sind Functions ohne eigenes `revoke` und ohne expliziten Grant. `nora_entity_uuid` trägt **zusätzlich einen expliziten, bislang nicht widerrufenen Grant an `anon`** (`grant all on function public.nora_entity_uuid(text, bigint) to anon` in `20260628150000_checklists_snippets_audit.sql`). Wer diese Fundstelle bereinigt, darf sie deshalb nicht als reines Default-Problem behandeln — vgl. `20260628140000_numbering_api_hardening.sql`, das genau solche Grants für die Nummern-Functions wieder entzogen hat. Weitere acht Treffer liegen in `nora_private` und sind über die Data API nicht erreichbar (Schema nicht in `config.toml` exponiert).

**Bewertung:** kein bekannter Datenabfluss. Alle vier sind `SECURITY INVOKER` und laufen damit mit den Rechten von `anon` — und `anon` hält in `public` genau ein Tabellenrecht (`SELECT` auf `init_state`, read-only gegenverifiziert 2026-09-10). `merge_contacts` und `nora_entity_uuid` scheitern deshalb an Tabellen-ACL bzw. RLS; die beiden `get_*`-Functions sind reine String-/URL-Helfer ohne Tabellenzugriff. Der Befund ist eine **Defense-in-Depth-Lücke**, kein Exploit — und nach dem Prinzip aus [`22`](22-security-and-access.md) Abschnitt 7.1 auch kein Nachweis für Harmlosigkeit auf Dauer: ein künftiges Tabellenrecht für `anon` oder ein Umbau einer dieser Functions auf `SECURITY DEFINER` würde sie sofort scharf machen.

**Abhilfe** (eigene Welle, nicht beauftragt): je Function ein `revoke all on function … from public, anon, authenticated` — dieselbe Maßnahme, die A.8 als dauerhaft wirksame Gegenmaßnahme benennt — plus Assertion in `public_privilege_hardening_verification.sql`.

### A.11 Deklaratives Schema enthält mehrere Security-Kernhelfer nicht

**Status: `OPEN (LOW)`** (verifiziert am Repository-Stand 2026-09-10).

`supabase/schemas/*.sql` ist ein lesbares Abbild des beabsichtigten Endzustands und wird von keinem `db reset` ausgeführt; autoritativ sind `supabase/migrations/` und die Datenbank ([`22`](22-security-and-access.md) Abschnitt 6.2). Das Abbild ist aber unvollständig: `nora_private.jwt_session_claim`, `nora_private.jwt_session_is_live`, `nora_private.session_binding_health`, `nora_private.guard_sales_delete` und die Definition von `nora_private.is_active_user` fehlen in `02_functions.sql` (die letzte wird in `03_views.sql`/`05_policies.sql` nur *benutzt*). Damit fehlt genau der Session-Autorisierungskern (W6-A) und der `sales`-DELETE-Guard (W6-B) in der reviewbaren Übersicht.

**Konsequenz für Agenten:** Wer den Security-Kern verstehen oder ändern will, liest die Migrationen (`20260906210000_nora_lifecycle_session_authorization.sql`, `20260906230000_nora_lifecycle_account_deletion.sql`) oder die Datenbank — **nicht** das deklarative Schema, und schließt aus dessen Schweigen nichts. **Abhilfe** (eigene Welle, nicht beauftragt): die fehlenden Definitionen nachtragen, so wie `07-agent-change-checklist.md` es für Migrationen ohnehin verlangt.

### A.12 Browserseitige React-Query-Persistenz von Geschäftsdaten auf der MobileAdmin-Oberfläche

**Status: `OPEN (MEDIUM)`** (read-only am Repository-Stand 2026-09-11 verifiziert; keine Bewertung abgeschlossen, keine Fixwelle beauftragt).

Die MobileAdmin-Oberfläche hängt ihren React-Query-Cache über `PersistQueryClientProvider` und `createAsyncStoragePersister({ storage: localStorage })` an den Browserspeicher (`src/components/atomic-crm/root/CRM.tsx`); `gcTime` steht auf rund 24 Stunden. Damit liegen Geschäftsdaten persistent im lokalen Browserprofil vor, nicht nur im Arbeitsspeicher der Sitzung.

Ein Logout-Clear für diesen Cache ist im realen Supabase-Pfad **nicht** nachgewiesen: die einzige gefundene Räumung des Persist-Keys steht im Demo-Pfad (`src/components/atomic-crm/providers/fakerest/demoSession.ts`) und belegt nichts über Production.

**Offen zu bewerten** (bewusst nicht vorweggenommen): ob und in welchem Umfang das eine Security-/Privacy-Frage ist, ob beim Logout geräumt werden muss und welche Persistenzdauer gewollt ist. Dieser Eintrag stellt **keinen** Datenschutzverstoß fest, spezifiziert keine Laufzeitlösung und beauftragt keine Welle.

**Abgrenzung.** Dies ist **nicht** der Service-Worker-Cache: der cacht keine Geschäftsdaten ([`24`](24-pwa-and-update-lifecycle.md) §5). Die technische Negativgrenze „Service Worker cacht keine Geschäftsdaten ≠ Nora speichert keine Geschäftsdaten im Browser" steht in [`24`](24-pwa-and-update-lifecycle.md) §6; `24` ist **nicht** Owner dieses Punktes. Security-Contract: [`22`](22-security-and-access.md).

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
- **W9 SQL-Verifikationssuiten in CI** — `PLANNED FOLLOW-UP`. Die kanonische Sequenz (`21-agent-runbooks.md` Sektion 5) läuft weiterhin nur lokal; `rbac_rls_first_admin_parallel_runner.ps1` hat einen bekannten Windows-Regex-Bug (Vorbedingung „sales must be empty" wird falsch geparst) — Workaround: die enthaltene SQL manuell mit zwei parallelen `psql`-Sessions nachbilden, das Skript nicht nebenbei patchen.
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

- **V1C-A.7 `mail_kind` bleibt im echten Betrieb `unknown`** — `OPEN`, Ursache eingegrenzt (A: Betreff-Drift im Dashboard, B: kein `subject` in der Brevo-Nutzlast). Die deployte Edge Function protokolliert bei `unknown` ein inhaltsfreies `subject_present`-Bit, eingeführt mit dem V1C-B-Deploy vom 2026-09-04 (in der Release-Historie als v2 geführt; dasselbe Artefakt meldet die Plattform heute als v3, siehe `16-current-state.md`); es wurde **noch nie ausgelöst**, weil seit diesem Deploy keine Nora-E-Mail versendet wurde. Entscheidbar beim nächsten kontrollierten Versand (ausgehende Aktion, braucht Freigabe). Blockiert nichts — die UI rendert die Mailart nicht.
- **V1C-A.8 Edge-Log-Stream für erfolgreiche Webhook-Aufrufe unvollständig** — `OPEN` (Beobachtbarkeitslücke, kein Funktionsfehler). Zustellprobleme über `email_delivery_events` und die Brevo-Webhook-Historie untersuchen, nicht über `function_edge_logs`.
- **V1C-A.4 / V1C-B.1 Deterministische Sendekorrelation** (Supabase Send Email Hook + Brevo-API-Versand mit eigener Korrelations-ID) — `PARKED`; ersetzt den Auth-Mailversand, eigene Architekturentscheidung. Erst danach dürfte eine UI „**diese** Einladung wurde zugestellt" sagen.
- **V1C-B.2 Feinere Unterscheidung innerhalb `undeliverable`** (Hard Bounce / Blocked / Invalid) — `PARKED`; nächster Admin-Schritt ist in allen Fällen derselbe.
- **V1C-A.5 Privilegierte Purge für Test-/Fake-Benutzer** in `email_delivery_events` — im W6-B-RC als **schmale Purge innerhalb der Kontolöschung** umgesetzt (nur `employee_sale_id = sale` **und** Adresse aus der Identitätshistorie; Fremdadressen bleiben und werden gezählt). Allgemeine Aufbewahrungsfristen bleiben nicht entschieden (`PARKED`).
- **Weitere Edge Functions im Repo sind nicht deployt** (`calendar-*`, `merge_contacts`, `update_password`, `postmark`, `mcp`) — Kontext, kein Bug; nur `users` (v10) und `brevo-email-events` (v3) sind live (read-only verifiziert 2026-09-18). Edge Functions werden nie von Vercel ausgeliefert. `delete_note_attachments` steht hier nicht mehr: die Function war nie deployt und ist mit W8-B aus dem Repository entfernt (H.1).

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

### D.5 `operation_errors` — Retention, Datenschutz und Wachstum undefiniert

**Status: `OPEN`** (festgestellt CR3, 2026-09-10) — `public.operation_errors` besitzt **keine** definierte Retention-, Purge- oder Datenschutz-Policy: die Tabelle wächst unbegrenzt, aufgelöste Zeilen (`resolved_at`) werden nicht abgeräumt, und es gibt keine Frist analog zu den `retention_class`-Klassen des Audits ([`13`](13-crm-audit-retention.md)). Die `technical_context`-Allowlist begrenzt zwar den Inhalt, ersetzt aber keine Aufbewahrungsentscheidung. Contract-Ist-Zustand: [`23`](23-operations-errors-feedback.md) §4.5. CR3 hat das bewusst **nicht** entschieden — eine Frist wäre eine eigene Entscheidung mit Migration und gehört in eine eigene Welle.

### D.6 Observatory-Aufzeichnung deckt die camelCase-Operationstypen nicht ab

Siehe Abschnitt **A.6** — der Operationstyp-Check von `record_operation_error` weist die bestehenden Katalogtypen (`quickCapture.createCase`, `customer.createWithContact`, …) ab; technische Fehlschläge dieser Operationen landen nie in `operation_errors`. Das ist die Operations-/Feedback-seitige Folge eines Sicherheits-/Privilegien-Findings und wird hier nur referenziert, nicht dupliziert. Contract-Ist-Zustand: [`23`](23-operations-errors-feedback.md) §4.5.

## E. PWA und Motion

Der technische PWA-/Update-Contract (Lifecycle, Precache, Offline, Installability, Multi-Tab) steht seit CR5 in [`24-pwa-and-update-lifecycle.md`](24-pwa-and-update-lifecycle.md); hier stehen **nur genuin offene** Punkte.

- **Reduced-Motion-Dauer der Update-Choreografie** — `PARKED` (Product-Frage): bei `prefers-reduced-motion: reduce` steht die Bewegung, die Dauer bleibt 8 s. Empfehlung: ~2,5 s und direkt in die ruhige Szene.
- **Nora Loading Motion System** — `PLANNED DOMAIN WAVE`, nicht begonnen. Zwei identische Spinner-Komponenten (`ui/spinner.tsx`, `admin/spinner.tsx`), ~13 direkte `animate-spin`-Vorkommen, ~45 `Loader2`/`Spinner`-Referenzen in ~25 Dateien, dazu Skeleton/Progress und der PWA-Orb. Empfehlung: zentraler Motion Primitive, beide Spinner darauf umstellen, Inline-Stellen nachziehen; Reduced Motion, Hell/Dunkel, 44-px-Touchziele mit abnehmen.
- **Live-Browser-Verifikation des PWA-V2-Happy-Path** (alter Tab → „Neue Nora-Version verfügbar" → „Jetzt aktualisieren" → Bestätigung genau einmal → zweites F5 ohne Bestätigung) — `NEEDS RE-VERIFICATION`: beim Release `672ebc76` (2026-09-01) nur per Bundle-Copy-Guard geprüft; der 1B–1C.3-Happy-Path war beim Kanban-Release live bestätigt.
- **Installability ist kein abgenommenes Produktziel** — `PARKED` (Product-Frage): Nora besitzt Manifest- und Standalone-Grundlagen, aber keinen abgenommenen Installability-Product-Contract und keine eigene Install-UI (kein `beforeinstallprompt`-Handler). Ob Installability ein bewusstes Produktziel werden soll — und damit verifiziert und gepflegt werden muss — ist offen. Aktueller Ist-Stand: [`24`](24-pwa-and-update-lifecycle.md) §7.

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

### G.4 Atomic Contact Primary Intent — offen nach dem Release (2026-09-08)

**Status: die Welle selbst ist `PRODUCTION VERIFIED`** (2026-09-08, Migration `20260908120000`, Ledger 58, PO-Live-Smoke akzeptiert — `06-decision-log.md` „2026-09-08 – Atomic Contact Primary Intent", Evidenz `releases/2026-09.md`). Hier stehen nur die **bewusst offen gebliebenen** Restpunkte. Restpunkte: `contacts.import` (CSV) und die Notiz-/Aufgaben-Pfade schreiben Kontakte weiterhin roh und additiv (`is_primary` nie `true`) — beabsichtigt, kein Risiko für den Index, aber ohne Operation-Korrelation. Die Markierungen-RC (`74a67659`, älterer `main`) berührt `noraErrorCodes`, `normalizeCrmError` und die Kataloge und muss auf **diesen** Stand portiert werden (rein textuelle Konflikte erwartet). `set_primary_contact` hat weiterhin kein UI und behält seinen `service_role`-Grant aus 2026-08-25.

Nach den beiden Blocker-Fixes (RC `0fb3d6ba`, zwei unabhängige Reviews 2026-09-08) zusätzlich bewusst **offen und ausserhalb dieser Welle**:

- **Selbstkontakt eines Privatkunden ist weiterhin auf einen anderen Kunden verschiebbar** (INFO, vorbestehend, nicht durch diese Welle entstanden): `public.update_contact` mit `company_id`-Patch erlaubt es, den in `companies.self_contact_id` referenzierten Kontakt einer Privatkundenakte wegzubewegen. Der Lock-Fix ändert daran nichts (bewusst geprüft: Abschnitt 9 der Suite bleibt grün). Eigene, kleine Welle mit einem Guard — nicht im Kontakt-Speicherpfad „mitfixen".
- **`set_primary_contact` behält seinen `service_role`-Grant** aus 2026-08-25, obwohl kein deployter Backend-Pfad ihn nutzt. Die Review nannte das als Aufräumpunkt; er war nicht der gemeldete Defekt und wurde im Blocker-Fix bewusst nicht angefasst (eigene Grant-Welle, zusammen mit A.8).
- **Rohe Kontakt-Namensschreibungen bleiben rohe Pfade.** „Kontakte zusammenführen" (`dataProvider.mergeContacts`) und der CSV-Import schreiben `contacts.first_name`/`last_name` weiterhin ohne Absicht und ohne Operation-Korrelation. Das ist beabsichtigt (sie verschieben die Rolle nicht) und seit dem Advisory-Mutex auch deadlockfrei — aber sie erscheinen nicht im Operationsprotokoll. Wenn Merge je eine eigene Operation bekommen soll, ist das eine eigene kleine Welle, kein Locking-Thema.
- **`nora_private.sync_individual_company_name` bleibt ein synchroner Trigger.** Er wurde bewusst nicht entfernt, deferred oder umgebaut: die Privatkunden-Namenssynchronisation ist eine durable Invariante. Jeder künftige Trigger, der `contacts` → `companies` (oder umgekehrt) schreibt, ist per Konstruktion kontaktzeilen-zuerst und muss in der T-Matrix mitgerannt werden (`21-agent-runbooks.md` Sektion 15).
- **Der bestehende Kern kann bei einem konkurrierenden Kontaktumzug `40001` („contact moved concurrently; retry") werfen** — dieselbe beschränkte Schleife wie `public.update_contact`, drei Versuche. Erreichbar nur über `create_customer_with_contact` mit `p_existing_contact_id`, wenn derselbe Kontakt gleichzeitig anderswo verschoben wird; in 120 Cross-Command-Rennen nie beobachtet. Falls dieser Fall je im Feld auftritt, gehört er in den Fehlerkontrakt (`NORA_*`-DETAIL), nicht in einen stillen Retry.

### G.2 Geplante Domain-Waves

- **Privatperson/Firma-Unterscheidung in Quick Capture** — `PLANNED FOLLOW-UP`: die Schnellerfassung erzeugt Kunden ohne `customer_kind`-Auswahl (Default `business`); die „Diese Person ist selbst Ansprechpartner"-Option fehlt dort bewusst (Self Contact Wave).
- **Customer-Archive-/Soft-Delete-Lifecycle** (`ArchiveCustomer`/`RestoreCustomer`) — `PLANNED FOLLOW-UP`, kein Zeitdruck. Domänenregel steht (INAKTIV ≠ NICHT-EXISTENT, W2); bisher nur die Self-Contact-Delete-Invariante abgesichert; kein generisches Archiv-Framework.
- **Business Data Lifecycle (allgemeines Archiv / Wiederherstellen / Endgültig löschen)** — `PARKED` (PO-Entscheidung 2026-09-13). Ein allgemeines Archiv-/Restore-/Purge-Modell für Geschäftsdaten ist derzeit **keine** freigegebene Arbeit; eine `/archiv`-Fläche ist nicht geplant. Das bestehende Löschverhalten für Administratoren bleibt vorerst akzeptiert. Eine spätere Richtung „Geschäftsdatensätze werden fortgeschrieben und in Zustände überführt statt gelöscht" kann neu bewertet werden. Der schmalere Punkt „Customer-Archive-/Soft-Delete-Lifecycle" oben wird dadurch nicht zu einer allgemeinen Archivwelle erweitert; eigenständige technische Findings (z. B. `storage`, H) bleiben bei ihrem Owner.
- **Legacy-Spalten-Cleanup** (`companies.linkedin_url`, `website`, `context_links`, `phone_number`, `contacts.linkedin_url`) — `PLANNED FOLLOW-UP`, kein Zeitdruck; erst nach Übergangszeit und Bestätigung, dass keine Integration (CSV-Import, alte Clients) mehr schreibt.
- **Mobile „Aufgaben"-Bereich auf der Kundenakte** — der Tab existiert nur im Desktop-`CompanyShow`; `CompanyShowContentMobile` hat keine Tab-Struktur. `PLANNED FOLLOW-UP`.
- **`deals.contact_ids bigint[]`** als Vorgang-Domain-Debt (keine FK-Integrität pro Element, keine Rollen-/Zeitdimension) — `PLANNED DOMAIN WAVE`, nicht designt.
- **Kontakterstellung UI-Polish**: förmliche Rollen-UX-Abnahme nach `12-role-ux-acceptance.md` nie durchlaufen (technisch deployed). `NEEDS RE-VERIFICATION`.
- **Application Queries / Read Models** für künftige KI-/Automatisierungs-Konsumenten (Falle 36) — Richtung dokumentiert, nichts implementiert.
- **Mobile-Ladezustand der Startseite live nachprüfen** — `PLANNED FOLLOW-UP` aus dem W7-R1A-Release (2026-09-08): der Ein-Sekunden-Vorlauf ist im ausgelieferten Build konstruktiv entfernt und durch Tests abgedeckt, eine Sichtprüfung auf einem echten mobilen Viewport steht aber aus (die Release-Session erreichte den ≤ 767-px-Breakpoint nicht).

### G.5 Mobile Vorgang-Routing — offen nach W7-M1 (2026-09-13)

W7-M1 (mobile Vorgang-Detailroute) ist `PRODUCTION VERIFIED` und hier **nicht** offen — Contract [`04`](04-routing-i18n.md), Entscheidung [`06`](06-decision-log.md) „2026-09-13 – Mobile Vorgang-Details: nur die Show-Fläche", Evidenz `releases/2026-09.md`. Die folgenden Punkte wurden dabei festgestellt und bewusst **nicht** in W7-M1 gezogen; sie öffnen W7-M1 nicht wieder.

- **Unbekannte Pfade enden projektweit in einer leeren Fläche** — `PLANNED FOLLOW-UP` (kleine Routing-Härtung). Nora nutzt weiterhin den ra-core-Standard-Catch-All; nicht registrierte oder ungültige Pfade (auf Mobile z. B. `/vorgaenge` als Liste) zeigen weder Fehler noch Ausweg. Nicht Vorgang-spezifisch.
- **Aktivitätsverlauf unterdrückt mobil Vorgang-Links und nutzt einen Legacy-Pfad** — `OPEN (LOW)`. `activity/ActivityLogDealCreated.tsx` und `ActivityLogDealNoteCreated.tsx` rendern mobil (`isMobile`) Vorgänge noch aus der Zeit ohne mobile Vorgang-Route ohne Link; zusätzlich sind `/deals/${…}/show` hartcodiert statt über `noraRoutes.ts` (Regel in [`04`](04-routing-i18n.md)). Funktioniert über den Legacy-Redirect, verschenkt aber die inzwischen vorhandene mobile Detailseite.
- **Fehlerzustand der mobilen Vorgang-Detailseite ohne Kopfzeile** — `OPEN (LOW, UX)`, live beobachtet 2026-09-13. Bei einem nicht existierenden Vorgang zeigt Nora den generischen Ladefehler mit „Erneut versuchen"; die untere Navigation bleibt als Ausweg, der übliche Kopf „Vorgang" mit Zurück-Schaltfläche fehlt aber.
- **Dedizierte mobile Vorgangsliste/Kanban sowie mobile Resource-Anlege-/Bearbeiten-Flächen für Vorgänge** — `PARKED` (Produktfrage). W7-M1 führte nur die mobile Show-Fläche ein; mobil sind für Vorgänge keine Listen-, Create- oder Edit-Routen registriert. Die Schnellerfassung bleibt als separater Anlageworkflow bestehen und legt auch mobil Vorgänge an. Eigene Produktentscheidung, falls gewünscht.

### G.6 Vorgang ↔ Kunde — offen nach W7-R1B (2026-09-13)

W7-R1B (`deals.company_id NOT NULL`) ist `PRODUCTION VERIFIED` und hier **nicht** offen — Invariante [`03`](03-data-model-guardrails.md) §1.7, Entscheidung [`06`](06-decision-log.md) „2026-09-13 – W7-R1B", Evidenz `releases/2026-09.md`.

- **FakeRest `updateMany("deals", …)` umgeht die Kunden-Paritätsprüfung** — `OPEN (LOW)`. Der FakeRest-Guard für `company_id` hängt an `beforeCreate`/`beforeUpdate`; `updateMany` läuft nicht durch `beforeUpdate`, ein `updateMany("deals", { data: { company_id: null } })` würde in der Demo also nicht abgewiesen. Heute schreibt kein Aufrufer `company_id` über diesen Pfad (der einzige gefundene `updateMany`-Aufrufer für Vorgänge ändert `sales_id`). Supabase/Production ist nicht betroffen — dort erzwingt `NOT NULL` die Regel. Beheben, sobald ein Pfad zur Sammel-Umhängung von Kunden entsteht, oder in einer kleinen Paritätsbereinigung.

## H. Anhänge, Storage und weitere bekannte Themen

H.1 und H.2 sind verifiziert und datiert. H.3 sammelt die Punkte aus einer frühen Analyse, die seither **nicht** in einer Session verifiziert oder detailliert wurden.

### H.1 Anhänge / Storage — offen nach W8-B, W8-C S1, S2A1, S2A2.1, S2A2.2, S3A und S3B (2026-09-19)

W8-B (Attachment Security Hardening) ist `PRODUCTION VERIFIED` und hier **nicht** offen — aktueller Contract [`22`](22-security-and-access.md) Abschnitt 6.5, Ist-Zustand [`16`](16-current-state.md) Abschnitt „Anhänge / Storage", Entscheidung [`06`](06-decision-log.md) „2026-09-15 – W8-B", Evidenz `releases/2026-09.md`. Was W8-B geschlossen hat (breite `authenticated`-Rechte auf `SELECT`/`INSERT`/`DELETE`, Storage-Zugriff deaktivierter Mitarbeiter mit gültigem JWT, fehlende Typ-/Größengrenzen, der unsichere `service_role`-Löschpfad) steht im Originalwortlaut im Archiv.

Ebenfalls **nicht** offen ist **W8-C S1** (Attachment Schema Foundation, `PRODUCTION VERIFIED` 2026-09-17): die Metadatentabelle `public.attachments` existiert in Production — additiv ausgeliefert, seit S3B die datenbankeigene Projektionsfläche der Notiz-Anhänge (unten); die Anwendung liest und schreibt sie weiterhin nicht. Contract [`22`](22-security-and-access.md) Abschnitt 6.6, Entscheidung [`06`](06-decision-log.md) „2026-09-16 – W8-C S1", Evidenz `releases/2026-09.md`.

Ebenfalls **nicht** offen ist **W8-C S2A1** (Attachment Deletion Capture, `PRODUCTION VERIFIED` 2026-09-17): das Löschen einer Zeile in `public.attachments` schreibt seitdem ein Lösch**vorhaben** in die private Warteschlange `nora_private.attachment_storage_deletion_queue` — fail-closed, ohne Konsumenten, ohne jeden Storage- oder Netzwerkaufruf; seit S3B entstehen dort tatsächlich Vorhaben, sobald ein projizierter Anhang entfällt. Contract [`22`](22-security-and-access.md) Abschnitt 6.7, Entscheidung [`06`](06-decision-log.md) „2026-09-17 – W8-C S2A1", Evidenz `releases/2026-09.md`. **Erfassung ist keine Löschung** — die physische Bereinigung bleibt unten offen.

Ebenfalls **nicht** offen ist **W8-C S2A2.1** (Attachment Liveness Resolver, `PRODUCTION VERIFIED` 2026-09-18): der zentrale, read-only Resolver `nora_private.attachment_storage_key_liveness(text)` beobachtet `live` / `dead` / `unknown` über die registrierten Referenzflächen (inkl. Legacy-JSON-Arrays und URL-only-Branding), und die Warteschlange kennt den terminalen Zustand `skipped_live` als Vokabular. Contract [`22`](22-security-and-access.md) Abschnitt 6.8, Entscheidung [`06`](06-decision-log.md) „2026-09-18 – W8-C S2A2.1", Evidenz `releases/2026-09.md`. **Beobachtung ist keine Erlaubnis** — ein `dead` autorisiert keine Löschung.

Ebenfalls **nicht** offen ist **W8-C S2A2.2** (Attachment Deletion Queue Execution, `PRODUCTION VERIFIED` 2026-09-18, Ledger 64/64 deckungsgleich): der datenbankinterne Ausführungsvertrag der Warteschlange. Er umfasst Claim unter einer exklusiven, serverseitig erzeugten Lease, Stale-Recovery, begrenzte Versuche mit Backoff sowie lease-geschütztes Inspect und Fail (`live` → `skipped_live`, `unknown` fail-closed, `dead` ohne Schreibvorgang). Die Functions sind nur für `postgres` ausführbar; es gibt keinen Worker, kein API-/`service_role`-Recht und keinen Pfad zu `done`. Contract [`22`](22-security-and-access.md) Abschnitt 6.9, Entscheidung [`06`](06-decision-log.md) „2026-09-18 – W8-C S2A2.2", Evidenz `releases/2026-09.md`. **Ein Ausführungsvertrag ist kein Ausführender** — gelöscht wird weiterhin nichts.

Ebenfalls **nicht** offen ist **W8-C S3A** (Attachment Reference Serialization, `PRODUCTION VERIFIED` 2026-09-19, Ledger 65/65 deckungsgleich): Referenz-Zulassung, Erfassung und Inspektion koordinieren sich je `storage_key` über eine transaktionsgebundene Advisory-Sperre; eine neue `public.attachments`-Zeile für einen Schlüssel mit aktivem Vorhaben oder `done` wird abgewiesen; `storage_key` ist unveränderlich; `authenticated` hält auf `public.attachments` nur noch `SELECT`. Das schließt LOW-1 und das Re-Referenzierungs-Rennen für zeilenbasierte `public.attachments`-Verweise (Originalwortlaut beider Punkte im Archiv). Contract [`22`](22-security-and-access.md) Abschnitt 6.10, Entscheidung [`06`](06-decision-log.md) „2026-09-19 – W8-C S3A", Evidenz `releases/2026-09.md`. **Mechanismus, nicht Schreiber** — S3A selbst schreibt keine Zeile und löscht nichts.

Ebenfalls **nicht** offen ist **W8-C S3B** (Note Attachment Projection, `CLOSED / PRODUCTION VERIFIED / LEDGER REPO-ALIGNED` 2026-09-19, Ledger 66/66 deckungsgleich): Datenbank-Trigger projizieren das Anhang-Array einer Notiz bei `INSERT` und bei jeder Array-Änderung in `public.attachments` — in derselben Transaktion, als minimale Differenz gegen die tatsächlichen Zeilen, unter einer zentralen Grammatik (v1), ohne Dual-Write und ohne direkte Schreibrechte irgendeiner API-Rolle. Die beiden über Notiz-Schreibvorgänge erreichbaren Fehlercodes sind auf die Oberfläche abgebildet. Contract [`22`](22-security-and-access.md) Abschnitt 6.11, Invarianten [`03`](03-data-model-guardrails.md) §1.8, Entscheidung [`06`](06-decision-log.md) „2026-09-19 – W8-C S3B", Evidenz `releases/2026-09.md`. **Projektion ist kein Backfill** — Bestandsnotizen sind nicht zurückprojiziert, und gelöscht wird weiterhin nichts. Offen bleiben:

- **Der Bucket `attachments` ist weiterhin öffentlich (`public = true`)** — `OPEN`, bewusst getragen. Wer einen Objektschlüssel kennt, lädt die Datei ohne Anmeldung herunter; das gilt auch für Bestandsobjekte und für ausgeschiedene Mitarbeiter, die einen Schlüssel besitzen. W8-B hat die Storage-**API**-Autorisierung gehärtet, nicht die Vertraulichkeit vorhandener Objekt-URLs. Die Umstellung auf einen privaten Bucket (samt signierten URLs, Migration der Bestandsschlüssel und Logo-Sonderfall) ist eine **eigene Welle (W8-E)**, nicht designt.
- **Verwaiste Storage-Objekte** — `ACCEPTED LIMITATION`, unverändert nach S1, S2A1, S2A2.1, S2A2.2, S3A und S3B. Es gibt weiterhin **keinen** physischen Löschpfad: das Löschen einer Notiz entfernt die Datei nicht, und das gilt ausdrücklich auch für die FK-`CASCADE`s auf `public.attachments` — sie löschen die **Metadatenzeile**, nicht das Objekt im Bucket. S2A1 hält das Vorhaben fest, S2A2.1 beobachtet, S2A2.2 verwaltet Aufträge, S3A serialisiert, S3B projiziert — keiner löscht. Unverändert gilt auch: ein Upload landet **vor** dem Datenbank-Schreibvorgang im Bucket; scheitert der Schreibvorgang danach, bleibt das Objekt verwaist. Weder S3A noch S3B lösen das (`DEFERRED`); seit S3B kann auch eine abgewiesene Projektion einen solchen Schreibvorgang scheitern lassen. Der Liveness-Zensus vom 2026-09-18 zählt 43 Objekte, davon **8 aktuell unreferenzierte Verwaisungskandidaten** (`dead`); sie sind **nicht** bereinigt, **nicht** als entbehrlich bestätigt, und es gibt keine Fähigkeit, sie zu entfernen. Der alte Trigger-/`pg_net`-/Edge-Pfad wird nicht reaktiviert.
- **Der Löschpfad ist in Schnitte zerlegt — sie werden nicht zusammengezogen.** Reihenfolge und Zustand:
  - **S2A1 Erfassung** — `CLOSED / PRODUCTION VERIFIED` (2026-09-17), siehe oben.
  - **S2A2.1 Liveness-Vertrag** — `CLOSED / PRODUCTION VERIFIED` (2026-09-18), siehe oben. Nur die zentrale read-only Beobachtung plus das Vokabular `skipped_live`.
  - **S2A2.2 Ausführungsvertrag der Warteschlange** — `CLOSED / PRODUCTION VERIFIED` (2026-09-18), siehe oben. Claim, Lease, Stale-Recovery, Attempt-Budget, Backoff, lease-geschütztes Inspect/Fail — nur in der Datenbank und nur für `postgres`. **Bewusst ohne `service_role`-Ausführungsgrenze:** es gibt keinen deployten Aufrufer, und ohne einen solchen bekommt `service_role` kein Recht ([`22`](22-security-and-access.md) Abschnitt 6.3). Das ist eine Sicherheitsgrenze, kein offener Rest von S2A2.2. S2A2.2 löscht kein Storage-Objekt und schreibt nie `done`.
  - **S3A Serialisierung je Objektschlüssel + Referenz-Zulassung** — `CLOSED / PRODUCTION VERIFIED` (2026-09-19), siehe oben. Der früher als ein Schnitt „S3" geplante Schreibvertrag wurde in S3A (Mechanismus) und S3B (Projektion) geteilt.
  - **S3B Projektion Notiz-JSON → `public.attachments`** — `CLOSED / PRODUCTION VERIFIED / LEDGER REPO-ALIGNED` (2026-09-19), siehe oben.
  - **S4 Backfill der Bestandsanhänge + globale Konsistenzprüfung** — `OPEN / NEXT`, nicht begonnen. Zweck, genau: die von S3B **unberührten** Bestandsnotizen projizieren und danach prüfen, dass Notiz-JSON und `public.attachments` global übereinstimmen. S4 ruft dafür den vorhandenen Kern `nora_private.reconcile_note_attachments(...)` unter einer Sperre der Notizzeile auf und führt **keinen** zweiten Abgleich-Algorithmus und keine zweite Grammatik ein ([`22`](22-security-and-access.md) Abschnitt 6.11). Bis S4 gilt keine globale Parität (Fenster unten).
  - **S5 Umschalten der Leseseite** — `FUTURE`, nicht begonnen, **blockiert bis S4 `PRODUCTION VERIFIED`**: vorher wäre eine Leseseite auf `public.attachments` für unberührte Bestandsnotizen leer.
  - **S6 Abschaltung des Legacy-JSON-Schreibpfads** — `FUTURE`, nicht begonnen.
  - **S2B physischer Löschworker (Storage-`DELETE`)** — `GATED / FUTURE`. Physische Storage-Löschung ist **nicht** aktiv. S2B bringt den echten Worker und erst mit ihm eine eng geschnittene `service_role`-Ausführungsgrenze, einen Pfad zu `done` sowie den Vertrag für externe Seiteneffekte. Gates (alle unten): Seiteneffekt-Abgrenzung, getrennte Transaktionen für Claim und Inspektion, veraltetes Formular (Lost Update), `done`-Index, quellenübergreifende Schlüssel. Die bloße Existenz der Warteschlange, ihres Ausführungsvertrags, der S3A-Serialisierung oder erster echter Vorhaben seit S3B ist **kein** Grund, einen Worker scharf zu schalten.
- **Fenster S3B → S4: unberührte Bestandsnotizen sind unprojiziert** — `OPEN`, befristet bis S4, bewusst getragen. Eine Bestandsnotiz wird erst beim ersten Anhang-ändernden Schreibvorgang projiziert, dann aber vollständig (First-Touch); eine reine Textänderung projiziert nichts. Das ist **kein** abgeschlossener Backfill. Bekannte Lücke: wird ein Anhang aus einer Bestandsnotiz entfernt, **bevor** diese je projiziert wurde, existiert keine Zeile, die gelöscht würde — es entsteht kein Löschvorhaben für diese historische Referenz. Das ist keine Verschlechterung gegenüber dem Stand vor S3B (dort entstand nie ein Vorhaben), aber ein Grund, warum S4 direkt folgt. Folge höchstens ein weiteres verwaistes Objekt, nie eine falsche Löschung.
- **S2B-Designgate: veraltetes Formular überschreibt eine neuere Anhangliste** — `OPEN`, **S2B-Gate**, in der unabhängigen Review von S3B festgehalten. Notiz-Schreibvorgänge haben keine optimistische Nebenläufigkeitskontrolle; der Lost Update selbst ist vorbestehend. Neu seit S3B: die Projektion bildet den Überschreibvorgang getreu ab und erfasst für die verdrängten Anhänge ein Löschvorhaben. Solange nichts physisch löscht, ist das rückholbar. Bevor S2B einen Storage-`DELETE` aktiviert, muss dieses Szenario bewusst gelöst oder mit einem sicheren Entwurf getragen werden. Nicht entworfen; **nicht** Teil von S4.
- **Re-Referenzierungs-Rennen und LOW-1 (verlorenes Löschvorhaben)** — für zeilenbasierte `public.attachments`-Verweise **durch S3A geschlossen** (Originalwortlaut beider Punkte: `releases/2026-09.md`, Eintrag W8-C S3A). Geschlossen ist damit ausschließlich, was an der Schlüsselsperre teilnimmt. Ein Warteschlangeneintrag bleibt ein Vorhaben und ein `dead` eine Momentbeobachtung — beides nie Erlaubnis ([`22`](22-security-and-access.md) Abschnitte 6.7, 6.8, 6.10).
- **Quellenübergreifend geteilte Schlüssel** — `OPEN (LOW)`, **Carry-forward S2B/S4**. Verweise außerhalb von `public.attachments` nehmen die Schlüsselsperre nicht: Kundenlogos, Branding, Avatare sowie das JSON nie projizierter Bestandsnotizen (bis S4). Anhang-ändernde Notiz-Schreibvorgänge nehmen seit S3B über die Projektion teil. Im normalen Betrieb entstehen dort frische UUID-Schlüssel; ein Schlüssel, der zugleich in `public.attachments` und in einer anderen Quelle steht, entsteht nur durch gezielt gebaute Schreibvorgänge. Vor physischer Löschung muss S2B bzw. der Backfill (S4) diesen Fall abdecken oder ausschließen.
- **S2B-Designgate: `claim_next()` und `inspect()` nie in derselben Transaktion** — `OPEN`, **S2B-Gate**, in der unabhängigen Review von S3A lokal reproduziert. Wer beides in **einer** Transaktion aufruft, hält die Warteschlangenzeile vor der Schlüsselsperre und kehrt damit die S3A-Lock-Reihenfolge um. Eine gleichzeitige Erfassung desselben Schlüssels hält die Schlüsselsperre und wartet auf die Transaktion des Claims — PostgreSQL bricht mit Deadlock `40P01` ab. Heute ruft niemand so auf; es geht kein Vorhaben verloren, und die S3A-Invarianten gelten. Ein künftiger Worker führt Claim und Inspektion deshalb in getrennten Transaktionen aus — oder S2B entwirft die Lock-Reihenfolge bewusst neu und beweist sie nebenläufig ([`22`](22-security-and-access.md) Abschnitt 6.10, [`03`](03-data-model-guardrails.md) §3.3).
- **`done`-Suche der Referenz-Zulassung ohne Index** — `OPEN (LOW)`, **S2B-Carry-forward**. Die Zulassung sucht `done`-Zeilen ohne eigenen Index; heute gibt es keine einzige `done`-Zeile, weil nichts `done` schreibt. Ein Index wird bewertet, sobald S2B tatsächlich `done` schreibt.
- **Externe Seiteneffekte sind durch die Lease nicht abgegrenzt** — `OPEN`, **S2B-Gate**, kein S2A2.2-Defekt und durch S3A **nicht** gelöst. Die Lease aus S2A2.2 und die Schlüsselsperre aus S3A sichern nur **Datenbank**-Vorgänge ab; die Sperre lebt nur so lange wie eine Transaktion. Sie beweisen nicht, dass ein bereits gestarteter künftiger Storage-Aufruf endet, wenn die Lease in der Datenbank abläuft. Ein Nachfolger kann den Auftrag dann erneut beanspruchen, während der alte Aufruf noch wirkt. Physische Löschung braucht deshalb zusätzlich einen eigenen Sicherheitsvertrag für externe Seiteneffekte (S2B), bevor ein Worker scharf geschaltet wird. Der Vertrag ist nicht entworfen.
- **Das Attachment-Modell ist eine Fähigkeit auf Persistenzebene, noch keine Fläche** — `PLANNED DOMAIN WAVE` (W8-C S4 ff.), S1, S2A1, S2A2.1, S2A2.2, S3A und S3B erledigt. Vorhanden: die Entität `public.attachments` mit Attachment-Id, Ownership auf Datensatzebene (Notiz-XOR) und provider-neutraler `storage_key`-Identität, für API-Rollen schreibgeschützt, durch Zulassung und Unveränderlichkeit abgesichert und seit S3B von der Datenbank aus den Notiz-Arrays projiziert. **Noch nicht vorhanden und nicht begonnen:** Backfill der Bestandsanhänge samt globaler Konsistenzprüfung (S4), Umschalten der Leseseite (S5), Abschaltung des Legacy-Schreibpfads (S6), physische Storage-Bereinigung (S2B), ein Nora-eigener Anhang-Viewer, KI-/Inhaltsmetadaten, atomare Notiz-RPC sowie eine Audit-Spur für das Hinzufügen oder Entfernen eines Anhangs. Bis dahin bleiben die JSON-Arrays am Notizdatensatz Schreib- und Lesepfad der Anwendung und Provider-URLs (`src`) im JSON persistiert; `path` ist seit S3B kein loses Legacy-Feld mehr, sondern die geprüfte Identität des Anhangs.
- **E2E-Stack: Storage-Origin nicht in der Anhang-URL-Allowlist** — `OPEN (LOW)`, Carry-forward aus S3B; **Production ist nicht betroffen**. Der lokale E2E-Supabase-Stack läuft auf `http://127.0.0.1:54341`; die Allowlist kennt das Production-Projekt und den lokalen Entwicklungs-Stack (`:54321`). Ein Notiz-Anhang mit `src` würde dort von der Grammatik abgewiesen. Heute nutzt kein E2E-Szenario Anhänge. Abhilfe erst mit dem ersten solchen Szenario — die Allowlist wird nur per Migration erweitert ([`22`](22-security-and-access.md) Abschnitt 6.8).
- **Demo/FakeRest bildet die Projektion nicht nach** — `INFO / DEBT`. FakeRest kennt weder `public.attachments` noch Grammatik oder Zulassung; Demo-Anhänge tragen keinen `path`. Das ist nach [`05`](05-demo-data-guidelines.md) und [`03`](03-data-model-guardrails.md) §5 zulässig (Parität, kein Ersatz) und kein Beleg für eine Production-Lücke. Relevant wird es spätestens mit der Leseseite (S5).
- **Ein Bucket für zwei Zwecke** — `OPEN (LOW)`: Notiz-Anhänge und Kunden-/Branding-Logos teilen sich `attachments` und damit Policies, MIME-Allowlist und Öffentlichkeit. Eine Trennung wäre Teil von W8-E.
- **Die neun erlaubten MIME-Typen sind eine Baseline, kein Endstand** — `OPEN (LOW)`. Nicht erlaubt und bisher nicht entschieden: HEIC/HEIF (iPhone-Fotos), Legacy-Office (`.doc`/`.xls`), PPTX, Archive, E-Mail-Dateien, Video sowie die Windows-Eigenheit, `.csv` als `application/vnd.ms-excel` zu melden. Das sind **keine** W8-B-Defekte, sondern Produktentscheidungen für den Fall, dass ein solcher Bedarf auftritt.
- **Der Bucket prüft den deklarierten MIME-Typ, nicht den Inhalt** — `ACCEPTED LIMITATION`. Keine Magic-Byte-, Inhalts- oder Virenprüfung. Eine falsch deklarierte Datei wird angenommen.
- **Vor W8-B ausgestellte signierte Upload-Token** bleiben bis zu ihrem Ablauf gültig — theoretischer Restpfad, kein beobachteter Fall.
- **`crypto.randomUUID()` braucht einen sicheren Kontext** — in Production (HTTPS) gegeben; ein Aufruf über unverschlüsseltes HTTP hätte keinen Schlüsselgenerator. Kontext, kein Bug.
- **Nicht deklarierte Anhänge im Postmark-Pfad** — `OPEN (LOW)`, unverändert: eine vom Bucket abgewiesene Datei kann die Verarbeitung der gesamten eingehenden Mail scheitern lassen. Die `postmark` Edge Function ist **nicht deployt**; der Punkt wird bei einem etwaigen Deploy scharf.

### H.2 Default-Privilegien des Schemas `storage`

`OPEN`, **ausdrücklich nicht** Teil von Security Hardening Wave 1 und **nicht** von W8-B. Read-only bestätigt (2026-09-07): `pg_default_acl` für Creator `postgres` in Schema `storage` vergibt `arwdDxtm` an `anon`, `authenticated` und `service_role` — dieselbe Form wie der in `public` behobene Tabellendefekt (früher A.1, Archiv `releases/2026-09.md`), aber mit anderem Owner, anderer Plattformmechanik und anderem Rollback-Pfad (`storage.objects`/`storage.buckets` gehören `supabase_storage_admin`). Braucht eine eigene Security-Welle mit eigener Abnahme; weder Wave 1 noch W8-B haben die Default-Privilegien des Schemas angefasst oder eine Härtung dort behauptet. W8-B hat ausschließlich Policies auf `storage.objects` und die Bucket-Zeile geändert ([`22`](22-security-and-access.md) Abschnitt 6.5).

### H.3 Bekannte, nicht erneut verifizierte Themen

Aus einer frühen Analyse benannt und seither **nicht** in einer Session verifiziert oder detailliert — insbesondere **nicht** in der W8-B-Closure. Diese Punkte gehören **nicht** zu H.2 und tragen keine Datierung; vor Bearbeitung gegen aktuellen Code/Produktion prüfen.

- **`mcp` Edge Function** — `PARKED`, nicht deployt. Sie kann eine direkte PostgreSQL-Verbindung aufbauen und `set role authenticated` setzen. Wave 1 reduziert den Schaden eines solchen Kanals (`authenticated` hat kein `TRUNCATE`/`DELETE` mehr, wo es nichts zu suchen hat), ersetzt aber keine eigene Bewertung dieser Funktion vor einem etwaigen Deploy.
- Rollen-Cache-Verhalten im Frontend
- Audit-Retention-/Löschstrategie (`13-crm-audit-retention.md` beschreibt das Modell; kein automatischer Purge)
- `supabase/config.toml` enthält lokal weiterhin `enable_signup = true` (steuert Produktion nicht; dort ist die Selbstregistrierung seit 2026-09-04 deaktiviert) — in einer kleinen Welle nachziehen.

## I. Build, Bundle und CI

Das **Build-/Bundle-Gate ist seit H2 (`PRODUCTION VERIFIED` 2026-09-10) grün** — Entry 1009 kB gegen das
unveränderte Budget von 1050 kB, Gesamt 2392 kB gegen 2600 kB. **H1 und H2 sind abgeschlossen** — Evidenz:
`releases/2026-09.md` „Entry-Chunk-Budget H2" und „Visualizer Production Exclusion H1"; der frühere Punkt I.1
(Entry-Chunk über Budget) ist aufgelöst und liegt im Originalwortlaut im Archiv (`releases/2026-09.md`, Anhang
zum H2-Eintrag).

Der frühere Punkt **I.2 (E2E-Bootstrap schlägt fehl) ist `RESOLVED`** durch E2E-B1 (Test-Infrastruktur-Commit
`7384431d`, GitHub Actions „Check" Run #104 mit allen sechs Jobs grün). Ursache und Evidenz:
`releases/2026-09.md` „E2E-Testisolation E2E-B1" (dort auch der I.2-Originalwortlaut); Regel: `06` „2026-09-14 –
E2E-Testisolation"; Runbook: [`21`](21-agent-runbooks.md) Sektion 16. Die folgenden Punkte sind davon unabhängig.

### I.3 `vite.demo.config.ts` aktiviert den Visualizer weiterhin unabhängig

**Status: `PLANNED FOLLOW-UP` (LOW)**, kein Zeitdruck. Nach H1 läuft der Bundle-Visualizer in `vite.config.ts`
nur noch bei `ANALYZE=true`; `vite.demo.config.ts` bindet ihn weiterhin unbedingt ein. Das betrifft **keinen**
Production-PWA-Precache und **keinen** Production-Build (`npm run build` nutzt `vite.config.ts`; die
Demo-Konfiguration enthält kein `VitePWA`) — es ist eine reine Konsistenzbereinigung und **kein** Grund, H1
wieder zu öffnen.

### I.4 Budget-Hinweis verweist auf `dist/stats.html`

**Status: `PLANNED FOLLOW-UP` (LOW)**. `scripts/check-bundle-budget.mjs` nennt im Hinweistext bei Budget-
Überschreitung `dist/stats.html`. Nach H1 entsteht diese Datei lokal nur noch bei `ANALYZE=true`; in CI bleibt
der Hinweis korrekt, weil der Build-Step die Variable setzt. H2 hat den Text bewusst **nicht** angefasst (der
Slice berührte nur eine Importzeile); der kleine Textnachzug bleibt offen.

### I.5 E2E-Code ist vom App-Typecheck nicht vollständig abgedeckt (F-2)

**Status: `OPEN (LOW)`**, festgestellt in E2E-B1 (2026-09-14); kein Release-Blocker. `npm run typecheck` deckt
`e2e/` nicht vollständig ab — Typfehler in Fixtures und Specs fallen dort nicht zwingend auf. **Abhilfe** (eigener
kleiner Slice, nicht beauftragt): dedizierter E2E-Typecheck oder saubere tsconfig-/Script-Lösung.

### I.6 Legacy-Runner `rbac_rls_first_admin_parallel_runner.ps1` löscht `sales`/`auth.users` direkt (F-3)

**Status: `OPEN (LOW)`**, festgestellt in E2E-B1 (2026-09-14). Das Cleanup am Ende des Skripts
(`delete from public.sales …` / `delete from auth.users …`) widerspricht dem W6-B-Vertrag (direkte `sales`-DELETEs
sind für alle Rollen verweigert, [`19`](19-user-lifecycle-architecture.md) §15). Die E2E-Isolation nutzt den Runner
**nicht**. Bekannter zweiter Mangel desselben Skripts (Windows-Regex): Abschnitt B, Eintrag W9. **Abhilfe** (eigener
Slice, nicht beauftragt): Cleanup auf Rollback bzw. W6-B-konformen Pfad umstellen, zusammen mit W9 bewerten.

### I.7 `error_contract_verification.sql` hängt auf frischer Datenbank von der Suite-Reihenfolge ab

**Status: `OPEN (LOW)` — vorbestehende Test-Harness-Schuld**, festgestellt in der unabhängigen Review von W8-C S3B
(2026-09-19); **kein** S3B-Befund und kein Production-Thema. Auf einer frischen Datenbank (nur Migrationen) scheitert
die Suite am Letzter-Admin-Schutz aus User Lifecycle W1; innerhalb der RBAC-Kette aus
[`21`](21-agent-runbooks.md) Sektion 5 läuft sie grün. Per A/B-Lauf belegt: dasselbe Verhalten **mit und ohne** die
S3B-Migration; die Suite referenziert weder Notizen noch Anhänge. **Abhilfe** (eigener kleiner Hygiene-Slice, nicht
beauftragt): die Suite self-contained machen oder ihre Position in der Kette dokumentieren, zusammen mit W9 bewerten.
