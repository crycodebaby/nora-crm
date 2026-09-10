# 22 – Security und Access (global)

Stand: 2026-09-10 · Status: **CURRENT** · Load-Klasse: **CONDITIONAL CURRENT CONTRACT**

Dies ist der **globale Security- und Access-Contract** von Nora: Authentifizierung vs. Autorisierung, Rollen und Capabilities, Trust Boundaries, Datenbank-Enforcement (RLS, Grants, Default-Privilegien, `SECURITY DEFINER`), Session- und Executor-Integrität.

Hier steht, **was wahr sein muss**. Wie eine Änderung durchzuführen und zu beweisen ist, steht in [`21`](21-agent-runbooks.md) Sektion 4 (Security und Zugriff) und Sektion 5 (kanonische SQL-Testsequenz). Dieses Dokument führt bewusst **keine** Routingtabelle — der einzige kanonische Router ist [`README.md`](README.md).

Vor CR2 lagen diese Regeln verstreut in [`03`](03-data-model-guardrails.md), [`11`](11-google-calendar-rbac.md) Abschnitte C/D und [`21`](21-agent-runbooks.md) Sektion 4. Wer allgemeine RBAC-/RLS-/Grants-/Trust-Boundary-Fragen hat, liest ab jetzt **nur dieses Dokument**.

---

## 1. Scope und Ownership-Abgrenzung

| Dokument | Zuständig für |
|---|---|
| **`22` (dieses)** | globale Security-/Access-**Invarianten**: Enforcement-Prinzip, Rollen, Trust Boundaries, RLS-/Grant-/`SECURITY DEFINER`-Regeln, Session-/Executor-Integrität |
| [`19`](19-user-lifecycle-architecture.md) | Mitarbeiter-/User-**Lifecycle-Prozesse**: Einladung, Rollenwechsel, Anmeldeadresse, Offboarding, Hard Delete, Zugangszustände |
| [`11`](11-google-calendar-rbac.md) | **Google-Calendar-spezifischer** Security-Kontext: Kalender-Permissions, OAuth, Secrets, Kalender-Tabellen und deren Access-Ausprägung |
| [`13`](13-crm-audit-retention.md) | Audit-**Ereignisse**, Actor-Snapshot, Sichtbarkeit, Retention |
| [`21`](21-agent-runbooks.md) | **operative** Change-/Verification-Schritte (Sektion 4 · 5 · 6) |
| [`17`](17-known-issues-and-planned-waves.md) Abschnitt A | genuin **offene** Security-Risiken und akzeptierte Einschränkungen |
| [`06`](06-decision-log.md) | **Begründungen** und durable Entscheidungen |
| [`03`](03-data-model-guardrails.md) | Daten-/Persistenzinvarianten — **nicht** Security |

Nora ist **Single-Tenant und einladungsbasiert**; öffentliche Selbstregistrierung ist in Production deaktiviert (`disable_signup: true`). Es gibt keine Mandantentrennung und keine Row-Ownership-Isolation zwischen Mitarbeitern: alle aktiven Mitarbeiter sehen dieselben CRM-Daten, differenziert nur nach Rolle. Wer das ändern will, trifft eine neue Architekturentscheidung — er leitet sie nicht aus einer bestehenden Policy ab.

---

## 2. Security Enforcement Principle

> **Für Datenzugriff und Persistenzautorisierung ist die Datenbank die letzte Enforcement Boundary. UI und Client sind niemals Autorität; Edge Functions ergänzen serverseitige Authorization und privilegierte Orchestrierung.**

Daraus folgt verbindlich:

- **UI-/Client-Guards spiegeln Berechtigungen, sie ersetzen sie nie.** `canAccess.ts`, `NoraAccessGuard`, `NoraReadOnlyBanner` sind Bedienkomfort und Fehlervermeidung — kein Schutz. Eine Regel, die nur in der UI existiert, existiert sicherheitstechnisch nicht.
- **RLS, Grants, DB-Functions und DB-Invarianten sind maßgeblich für Datenzugriff.** Wer eine Zugriffsregel einführt, führt sie in der Datenbank ein.
- **Edge Functions dürfen zusätzliche serverseitige Authorization, Actor-Verifikation und privilegierte Orchestrierung leisten** (Mehrsystem-Abläufe über GoTrue + Datenbank) — eine **zusätzliche** Boundary, nie ein Ersatz für DB-Enforcement.
- **Authentication ist nicht Sache der Datenbank.** Identität, Passwörter, Tokens, Bann und Session-Ausgabe liegen bei GoTrue/Supabase Auth. Die Datenbank autorisiert; sie authentifiziert nicht. Die Vermischung dieser Ebenen ist der häufigste Denkfehler — deshalb Abschnitt 3.

---

## 3. Authentication vs. Authorization

| Ebene | Wer | Beantwortet | Fehlerbild bei Verwechslung |
|---|---|---|---|
| **Identity / Authentication** | GoTrue, `auth.users` | „Wer ist das?" | Auth-Zustand als Berechtigung lesen |
| **Session Integrity** | `auth.sessions` + `nora_private.jwt_session_is_live()` | „Lebt diese Sitzung noch, und gehört sie diesem Benutzer?" | gültiges JWT als ausreichend behandeln |
| **Authorization (DB)** | RLS, Grants, `nora_private.*`-Helper | „Darf dieser Aufrufer diese Zeile/Operation?" | Policy ohne Objektprivileg (tot) oder Privileg ohne Policy (Angriffsfläche) |
| **Authorization (Edge)** | `users` Edge Function, `service_role`-Executoren | „Ist der handelnde Administrator verifiziert und darf er diese Lifecycle-Aktion?" | Body-Feld als Actor vertrauen |
| **UI Behavior** | `canAccess.ts` und Guards | „Was zeige ich an?" | UI-Guard als Enforcement zählen |

**Identität, Zugang und Rolle sind drei orthogonale Fakten** — `auth.users.email` (Identität), `sales.disabled` + Auth-Bann (Zugang), `sales.role` (Rolle). Kein Pfad bewegt zwei davon in einem Schreibvorgang implizit: eine E-Mail-Änderung aktiviert nie und deaktiviert nie, eine Rollenänderung ruft Auth nicht auf. Zugang wird immer auf beiden Seiten bewegt und verifiziert. `last_sign_in_at` ist kein Zustandssignal und nie ein Autorisierungsmerkmal. Prozesse: [`19`](19-user-lifecycle-architecture.md) §3.

---

## 4. Rollen und Capabilities

### 4.1 Die eine Rollenquelle

**`sales.role` ∈ `admin` | `office` | `viewer`** ist die einzige führende Rollenquelle. `public.sales` (bigint PK, 1:1 zu `auth.users` über `sales.user_id`) ist die einzige Benutzertabelle.

| Quelle | Status |
|---|---|
| `sales.role` | ✅ **einzige führende Quelle** |
| `sales.administrator` | ⚠️ Legacy-/Kompatibilitätsspiegel (`administrator = (role = 'admin')`); nie führend, Entfernung ist eine eigene Entscheidung |
| JWT `app_metadata.role` | optionaler Spiegel, nie führend; heute nicht als Autorisierungsquelle genutzt |
| `canAccess.ts` | UI-Guard, spiegelt die DB — kein eigenes Rechtemodell |

**Keine zweite Rollenquelle.** Keine `profiles`-, `crm_users`-, `user_roles`- oder `role_permissions`-Tabelle, keine parallele Benutzerverwaltung, keine rein JWT-getragene Rolle ohne DB-Rückfall. Wer eine vierte Rolle oder eine feinere Capability braucht, erweitert `sales.role` bzw. die Berechtigungsmatrix — er legt keine zweite Dimension an. *(Falle 25)*

### 4.2 Rollen

| Rolle | Zielnutzer | Kurzbeschreibung |
|---|---|---|
| `admin` | Chef / IT | Vollzugriff, Rollen und Zugänge verwalten, Konfiguration, globales Audit |
| `office` | Büro / Sekretariat | operativer CRM-Alltag: anlegen, bearbeiten, Checklisten laufen lassen, Audit in der Akte |
| `viewer` | schreibgeschützt | nur lesen; kein Audit-Zugriff |

Neue Nutzer erhalten Least Privilege: `viewer`. `office` wird nur explizit vergeben. Der erste Sign-up erhält `admin` (`handle_new_user` unter `pg_advisory_xact_lock(89142421, 1)` — exakt ein Admin unter Parallelität).

### 4.3 Globale Berechtigungsmatrix

Legende: ✅ erlaubt · 🔶 eingeschränkt · ❌ verboten · ⚙️ nur Admin · 🔧 System/Edge Function

| Aktion | admin | office | viewer |
|---|:---:|:---:|:---:|
| Kunden · Kontakte · Vorgänge · Aufgaben **lesen** | ✅ | ✅ | ✅ |
| Kunden · Kontakte · Vorgänge · Aufgaben **anlegen, bearbeiten, archivieren** | ✅ | ✅ | ❌ |
| Kunden · Kontakte · Vorgänge · Aufgaben **physisch löschen** | ✅ | 🔶 | ❌ |
| Checklisten und Textbausteine lesen | ✅ | ✅ | ✅ |
| Checkliste starten, Punkte haken, Textbaustein anlegen | ✅ | ✅ | ❌ |
| Textbaustein deaktivieren | ✅ | 🔶 | ❌ |
| Checklisten-**Vorlagen** bearbeiten | ⚙️ | ❌ | ❌ |
| **Audit** global lesen (`/audit`, `get_global_audit_events`) | ✅ | ❌ | ❌ |
| **Audit** in der Akte lesen (`get_entity_audit_events`) | ✅ | ✅ | ❌ |
| Audit schreiben · ändern · löschen | 🔧 | 🔧 | 🔧 |
| **Nutzer** einladen, Rolle ändern, deaktivieren, offboarden, Konto löschen | ⚙️ | ❌ | ❌ |
| App-**Konfiguration** | ⚙️ | ❌ | ❌ |
| **Kalender** (lesen, verknüpfen, Nora-Termine bearbeiten, OAuth) | → [`11`](11-google-calendar-rbac.md) | | |

**🔶 Eingeschränkt** (bewusst offen, Tendenz dokumentiert): `office` löscht Kunden/Vorgänge nicht physisch, sondern archiviert; `office` deaktiviert nur eigene Textbausteine. Diese Einschränkungen sind heute **nicht** durchgängig in RLS abgebildet — die Kern-CRM-Policies gewähren `authenticated` mit Schreibrolle vollen CRUD. Wer sie durchsetzen will, schreibt Policies und ergänzt die Matrix; er behauptet nicht, sie seien bereits erzwungen.

Kalenderspezifische Zeilen bleiben in [`11`](11-google-calendar-rbac.md) — die dortige Ausprägung ist eine **Verfeinerung** dieser Matrix, nie ein Widerspruch. Bei Abweichung gewinnt dieses Dokument.

### 4.4 Capability-Rollen

Capability-Rollen sind schmale, `NOLOGIN`/`NOBYPASSRLS`-Datenbankrollen, die genau ein privilegiertes Recht besitzen und Owner genau der Functions sind, die es brauchen. Sie ersetzen jedes GUC-Token-Modell.

| Rolle | Recht / Zweck |
|---|---|
| `nora_role_manager` | Owner von `nora_private.apply_sales_role_change` — Privileg-`UPDATE` auf `sales.role`/`disabled` |
| `nora_identity_manager` | Spalten-Grant `sales.email`; Owner von `nora_private.guard_auth_email_change` |
| `nora_audit_writer` | schmaler Audit-Schreibpfad |
| `nora_calendar_writer` · `nora_calendar_linker` | Kalender-Schreib-/Verknüpfungspfade ([`11`](11-google-calendar-rbac.md)) |

Regeln:

- **Keine Mitgliedschaft für `authenticated` oder `anon`** in einer Capability-Rolle.
- **Capability-Rollen sind nie Ziel eines Sicherheits-`revoke`.** Ein `revoke` richtet sich immer **namentlich** an `anon, authenticated, service_role`. Eine Sicherheitsbereinigung darf keine Fähigkeit stillschweigend abschalten; positive Assertions sind so wichtig wie negative.
- **Testrolle `nora_rls_test`** existiert nur lokal via `rbac_rls_setup.sql` — **nie** in einer Produktionsmigration. Kein festes Testpasswort in Git.

---

## 5. Trust Boundaries

| Grenze | Vertrauensstatus |
|---|---|
| **UI / Client** | **keine** Security Boundary. Spiegelt Rechte, erzwingt nichts. |
| **Edge Function** | **zusätzliche** serverseitige Boundary: verifiziert den Actor aus dem Caller-JWT, orchestriert privilegierte Mehrsystem-Abläufe. Ersetzt DB-Enforcement nicht. |
| **Datenbank** | **letzte** Enforcement Boundary für Datenzugriff und Persistenzautorisierung. |

Verbindlich:

- **`service_role` nie im Browser, nie in einer `VITE_*`-Variable, nie in Frontend-Code, `localStorage` oder React-State.** `service_role` umgeht RLS vollständig.
- **Body-Felder sind keine Identität.** `actor_user_id`, `user_id` und Ähnliches im Request werden ignoriert; der Actor ist die verifizierte JWT-User-ID. Ein gefälschter Actor kann Rechte nur verengen, nie erweitern.
- **Operation IDs sind Korrelation, keine Autorisierung.** `operation_id` (Header `x-nora-operation-id`, `nora_private.current_operation_id()`, `audit_events.request_id`) ist ausschließlich Nachvollziehbarkeit — nie ein Auth-Merkmal, nie ein Fähigkeitsnachweis. `nora_private.current_operation_id()` bleibt `SECURITY INVOKER` und hat keinen Auth-/RLS-Effekt.
- **Demo/FakeRest darf Production Security nicht schwächen.** FakeRest kennt die Datenbank-Guards nicht und hat **keine** Autorisierung auf Datenebene ([`17`](17-known-issues-and-planned-waves.md) D.3). Production-Code wird nie für Demo-Parität aufgeweicht; ein Demo-Pfad, der eine Operation „kann", ist kein Beleg dafür, dass Production sie erlaubt. Umgekehrt darf ein fehlender Demo-Pfad (z. B. kein Löschpfad, `deletion.supported = false`) nicht als Production-Lücke gelesen werden.
- **Secrets** (OAuth-/Refresh-Tokens, Client Secrets) gehören ausschließlich in Edge Function Secrets / Vault / `nora_private`-Secret-Tabellen mit `service_role`-Grant und RLS deny-all — nie in CRM-Tabellen, nie in `audit_events` (`old_data`/`new_data`/`metadata`), nie ins Frontend. Ausprägung für Google: [`11`](11-google-calendar-rbac.md) Abschnitt F. *(Falle 26)* Audit-Metadaten und `technical_context` folgen einer Allowlist — keine Request-Bodies, Tokens, Session-IDs oder Provider-Antworten.

---

## 6. Database Enforcement

### 6.1 PostgREST Exposure und interne Helper

- `supabase/config.toml` exponiert **nur** `public`. **`nora_private` ist nicht in den PostgREST-Schemas** und wird nicht hinzugefügt — dort liegen alle internen Helper. Was in `public` liegt, ist potenziell über die Data API erreichbar; ein Objekt dort zu platzieren ist eine Sicherheitsentscheidung, keine Stilfrage.
- `nora_private.safe_auth_uid()` ist der einzige JWT-`sub`-Leser: `auth.uid()` **wirft** bei malformed `sub`. Alle RLS-Helper nutzen den safe reader.
- Eine Function mit Rückgabetyp `trigger`/`event_trigger` wird von PostgREST nicht als RPC exponiert und kann nicht direkt aufgerufen werden (Engine-Restriktion, unabhängig von EXECUTE-Grants).

### 6.2 RLS und Grants gehören zusammen

- **`authenticated` erhält genau die Operationen, die seine RLS-Policies ausdrücken.** Eine Policy ohne passendes Objektprivileg ist tot; ein Objektprivileg ohne Policy ist unerreichbar und damit nur Angriffsfläche. Wer eine neue Policy anlegt, prüft **beides zusammen**.
- **`revoke all` vor jedem `grant`, ausnahmslos** — auch für Views. Additive Grants lassen geerbte Rechte stehen; genau so entstand der `audit_events`-`TRUNCATE`-Befund (Wave 0).
- **`TRUNCATE` ist die gefährlichste Zeile im ACL:** sie umgeht RLS vollständig **und** feuert keine Row-Trigger — Audit, `prevent_*`-Guards und Policies sind gleichzeitig wirkungslos. `TRUNCATE`, `REFERENCES`, `TRIGGER`, `MAINTAIN` gehören **keiner** API-Rolle.
- **`anon` hat genau ein Recht:** `SELECT` auf `public.init_state` (Vor-Login-Prüfung in `authProvider.getIsInitialized()`) — kein Tabellen-GRANT auf CRM-Tabellen, nichts auf den anderen Views.
- **`service_role` hält nirgends in `public` `DELETE`** (auf `public.sales` hält es **keine** Rolle). Wer einen solchen Pfad **braucht**, begründet ihn und ergänzt Zielmatrix *und* Verifikationssuite — er fügt nicht still ein `grant` hinzu. **`public.audit_events` ist auch im ACL append-only:** `service_role` hat `SELECT`/`INSERT`, sonst nichts.
- **Keine client-facing Rolle hält `CREATE ON SCHEMA public`** — Voraussetzung dafür, dass `SECURITY DEFINER` mit `search_path = public` unkritisch bleibt (Abschnitt 7). Braucht eine Migration `CREATE` für ein `alter function … owner to <capability>`, wird es **innerhalb** dieser Migration gewährt und vor deren Ende wieder entzogen.
- **Kein `MAINTAIN` im DDL** (erst ab PG17; lokal PG15, Production PG17): `revoke all` deckt beide ab, nur Assertions verzweigen über `current_setting('server_version_num')`. `has_table_privilege(…, 'MAINTAIN')` wirft auf PG15.
- **Privilegienaussagen werden gegen die Datenbank geprüft** (`has_table_privilege`, `has_function_privilege`, `pg_class.relacl`, `pg_proc.proacl`, `pg_default_acl`) — **niemals** gegen `supabase/schemas/06_grants.sql`. Diese Datei wird von keinem `db reset` ausgeführt (`config.toml` konfiguriert kein `[db.migrations] schema_paths`); sie ist ein lesbares Abbild des beabsichtigten Endzustands und **keine Privilegienwahrheit**. Autoritativ sind `supabase/migrations/` und die laufende Datenbank. Ihr eigener Dateikopf sagt das ebenfalls — wer einen Widerspruch findet, behandelt ihn als Befund.

### 6.3 Neue Objekte in `public` — Objekttypen sauber unterscheiden

Dies ist die **wichtigste und am häufigsten falsch verallgemeinerte** Regel dieses Dokuments. Tabellen und Functions haben in PostgreSQL **entgegengesetzte** Default-Semantik. Es gibt keine gemeinsame Formulierung wie „neue `public`-Objekte starten bei null Rechten" — die wäre für Functions **falsch und gefährlich**.

| Objekttyp | Default für ein neu erzeugtes Objekt in `public` | Konsequenz |
|---|---|---|
| **Tabelle / View** | **kein** API-Rollen-Recht. Die Default-Tabellen-Privilegien von `public` (Grantor `postgres`) vergeben seit Security Hardening Wave 1 (`PRODUCTION VERIFIED` 2026-09-07) an `anon`/`authenticated`/`service_role` **nichts** mehr. | Ohne expliziten `GRANT` ist das Objekt über PostgREST **unerreichbar**. Jeder Laufzeitzugriff ist ein bewusster `GRANT` in einer Migration. |
| **Sequenz** | **kein** API-Rollen-Recht. | Unkritisch: Noras `id`-Spalten sind durchgängig `generated by default as identity`, und ein Identity-`INSERT` braucht **kein** Sequenzrecht (verifiziert). |
| **Function** | **`owner + PUBLIC EXECUTE`** — PostgreSQLs eingebauter Default. Die neue Function kommt mit `proacl = NULL` heraus; `anon`, `authenticated` und `service_role` können sie **sofort ausführen**. | **Jede sensible Function braucht ihr eigenes explizites `revoke`.** Das ist Pflicht, nicht Redundanz. |

**Warum das schema-scoped Default-Privileg das nicht löst:** das `alter default privileges … in schema public revoke execute on functions from …` aus Migration `20260907120000` stellt den eingebauten `PUBLIC`-Default **nicht** ab — die gespeicherte Zeile wird mit ihm verschmolzen, und die neue Function kommt weiterhin mit `proacl = NULL` heraus. Nur eine **creator-scoped globale** Zeile **ohne** `in schema` würde ihn entfernen; sie ist bewusst nicht gesetzt ([`17`](17-known-issues-and-planned-waves.md) A.8).

Verbindliche Handlungsregeln:

- **Neue Tabelle/View in `public`:** Zielmatrix in `06_grants.sql` **und** Assertion in `supabase/tests/public_privilege_hardening_verification.sql` ergänzen — sonst ist das Objekt unerreichbar oder still zu weit offen.
- **Neue sensible Function:** eigenes `revoke all on function … from public, anon, authenticated` (bei RPCs zusätzlich `service_role`, wenn kein belegter Backend-Aufrufer existiert), danach genau ein gezielter Grant.
- **Neue public RPC:** `revoke all … from public, anon, authenticated, service_role` + einziger Grant an `authenticated`; `service_role` nur mit belegtem, deployten Aufrufer.
- **Eine neue Function nie aus der Tabellenregel heraus als „automatisch rechtelos" annehmen.** Wer das tut, veröffentlicht eine sensible Function an `anon`.
- **Nicht abgedeckt:** `pg_default_acl` für Creator `supabase_admin` in `public` sagt den API-Rollen weiterhin `arwdDxtm` zu; `postgres` ist kein Mitglied und kann das nicht ändern. Die Zeile ist **ruhend, nicht harmlos** — sie greift nur für Objekte, die `supabase_admin` in `public` anlegt. Die Vorbedingung „**alle** `public`-Relationen gehören `postgres`" ist deshalb eine **Sicherheitsannahme, kein Formalismus**: wer sie verletzt sieht, behandelt das als Sicherheitsvorfall, nicht als Aufräumarbeit ([`17`](17-known-issues-and-planned-waves.md) A.9). Ebenfalls nicht abgedeckt: Schema `storage` und der öffentliche Attachment-Bucket.

### 6.4 Privilegierte Read-Views

`public.init_state` und `public.sales_directory` sind **verifizierte, bewusste Ausnahmen** mit geprüfter minimaler Datenprojektion ([`06`](06-decision-log.md) „Intentional privileged read views"). Für sie gilt zusätzlich: jede Änderung an Projektion, Grants, zugrunde liegender RLS oder `security_invoker` erfordert eine **neue** Security-Bewertung — die alte Einstufung wird nie wiederverwendet.

Datenexposition der `sales`-Sicht: `sales_directory` und `sales_identities` zeigen allen aktiven Rollen nur Name und Avatar (Identities zusätzlich `disabled`); `public.sales` mit dem vollständigen Profil inklusive `role`/`email`/`disabled` liest ein Admin für alle Zeilen, jeder andere nur die eigene. Welche View wofür zuständig ist (aktive Zuweisung vs. historische Identität): [`19`](19-user-lifecycle-architecture.md) §7–§8.

Beide Views sind `security_invoker = false` über genau eine Tabelle und damit auto-updatable — deshalb explizit **`SELECT`-only** (`revoke all` + `grant select`), unabhängig von Default-Privilegien, und ohne Identity-/Security-Metadaten. Teamlisten nutzen `sales_directory`, nicht `sales`. Direkte Data-API-Updates auf `role`, `disabled`, `administrator`, `user_id`, `email` sind per Trigger blockiert (`prevent_sales_privilege_escalation`).

---

## 7. `SECURITY DEFINER` — Views und Functions

### 7.1 Falle 34: Advisor-Finding blind umsetzen

Falsch:

```text
Supabase Security Advisor meldet ERROR "Security Definer View" →
sofort security_invoker = true setzen, weil der Advisor es als Fehler markiert.
```

Richtig:

```text
Vor jeder Änderung an einer SECURITY DEFINER-View/-Function oder ihrem
security_invoker prüfen: konkrete Datenprojektion, Grants (anon/authenticated/
service_role), zugrunde liegende RLS, Ownership, tatsächlicher Execution Path,
tatsächliche Consumer, serverseitige Auth-Checks, funktionale Abhängigkeiten.
```

> **Ein Advisor-Finding ist ein Signal, kein Beweis — weder für einen Exploit noch für Harmlosigkeit.** Beide Richtungen müssen belegt werden.

Jede `SECURITY DEFINER`-View ist per Default ein ERROR-Lint; das allein sagt nichts. Umgekehrt ist ein fehlendes Finding kein Freibrief.

**`security_invoker` nicht reflexhaft setzen.** Ein Umschalten ändert, mit wessen Rechten die zugrunde liegenden Tabellen gelesen werden, und kann eine funktionierende, bewusst privilegierte Projektion stillschweigend brechen oder aufweiten.

**Trigger-/Event-Trigger-False-Positive:** eine Function mit Rückgabetyp `trigger` oder `event_trigger` kann **nicht** direkt aufgerufen werden — ein Advisor-Warning dazu ist strukturell ein Falsch-Positiv, kein Nachweis für Exposure. Ein Warning zu einer Function mit „echtem" Rückgabetyp (`jsonb`, `uuid`, `void`, …) muss dagegen **immer einzeln** geprüft werden: Grants, serverseitige Auth-Checks, `search_path`.

**`search_path`-Risiko:** ein gesetzter `search_path = public` (statt `''`) bei `SECURITY DEFINER` ist auf Production **nur deshalb** unkritisch, weil keine client-facing Rolle (`anon`/`authenticated`/`PUBLIC`) `CREATE` auf `public` besitzt (Abschnitt 6.2). Diese Grant-Voraussetzung ist vor **jeder** neuen `SECURITY DEFINER`-Function mit nicht-leerem `search_path` erneut zu prüfen — nicht pauschal von der aktuellen Bewertung ausgehen, falls sich Schema-Grants ändern.

### 7.2 Vertrag für eine neue `SECURITY DEFINER`-Function

- `search_path = ''`, vollständig schemaqualifiziert (Vorzugsvariante — macht das Risiko aus 7.1 gegenstandslos);
- Owner `postgres`, außer die Function braucht ein Capability-Privileg (dann Owner = Capability-Rolle);
- serverseitige Auth-Prüfung im Function-Körper (`nora_private.safe_auth_uid()` + `can_write()`/`is_admin()`/`has_role()`), nicht nur ein Grant;
- eigenes `revoke all … from public, anon, authenticated` (plus `service_role`, wenn kein Aufrufer belegt ist), dann genau ein gezielter Grant;
- schmale, allowlist-basierte Signatur — keine generische Zeilenmutation, keine Gott-Function.

Der operative Prüf- und Verifikationsablauf steht in [`21`](21-agent-runbooks.md) Sektion 4 und 5.

---

## 8. Session- und Executor-Integrität

### 8.1 Session-Binding als Trust Boundary

Ein JWT bleibt bis `exp` kryptografisch gültig. PostgREST prüft **nie**, ob die im Token genannte Sitzung noch existiert, und GoTrue bietet **keinen** Admin-Logout. Nora bindet die Autorisierung deshalb an die Sitzung.

> **Sicherheitsinvariante:** ein gültiges JWT genügt nicht. Ein Browser-Request, der eine Sitzung nennt, ist nur autorisiert, wenn Nora beweisen kann, dass **genau diese lebende Sitzung genau diesem authentifizierten Benutzer gehört**.

Vertrag (`nora_private.jwt_session_is_live()`):

| Claim-Zustand | Ergebnis |
|---|---|
| `session_id` vorhanden (UUID-String) | live **nur** wenn `auth.sessions.id = session_id` **und** `auth.sessions.user_id = JWT-sub`; kein `sub`, keine Zeile, fremder Besitzer oder **jeder** Fehler beim Nachschlagen → **verweigert** |
| `session_id` malformed (kein UUID-String: JSON `null`, Zahl, Boolean, Objekt, Array; Claims kein JSON-Objekt) | **verweigert** |
| `session_id` fehlt, aber PostgREST hat ein JWT übergeben (`request.jwt.claims` gesetzt) | **verweigert** — ein transportiertes Benutzer-JWT ohne Sitzung ist nie ein echtes GoTrue-Token |
| kein JWT übergeben (SQL-Fixtures mit Legacy-GUCs, `psql`, Trigger-Kontexte) | Kompatibilitätspfad — über die API unerreichbar |

- **Fail-closed:** kann `postgres` `auth.sessions` nicht lesen, antwortet der Helfer `WARNING` „session binding DENIED" und **verweigert**. Kein Fail-open-Fallback.
- Die Bindung sitzt in `nora_private.is_active_user()` und `current_role()` — und damit in `has_role`, `is_admin`, `can_write`, allen darauf gebauten Policies, beiden Identitäts-Views und allen RPCs. **Wer die RLS-Helfer anfasst, erhält die Bindung**; neue Helfer, die „aktiver Benutzer" beantworten, binden ebenfalls. Die **Claim-Klassifikation lebt an genau einer Stelle** (`nora_private.jwt_session_claim()`) — keine zweite Parser-Stelle, keine Session-Checks in einzelnen Policies; der Kompatibilitätspfad wird **nicht verbreitert**.
- `service_role` ist unbetroffen (RLS-Bypass; Executoren prüfen `safe_auth_role()` und konsultieren die Sitzung nie); Capability-Rollen haben rollennamenbasierte Policies ohne Session-Bezug. `nora_private.session_binding_health()` (nur `postgres`, keine Sitzungsdaten) ist der eine Gesundheitsprimitive — **kein** Browser-RPC.

**Migrations-Hard-Gate (verbindlich):** jede Migration, die `jwt_session_is_live()` oder `auth.sessions` berührt, prüft **vorab** `has_table_privilege('postgres', 'auth.sessions', 'SELECT')` **und** eine echte Lookup-Probe und **bricht im Fehlerfall ab** (Vorbild `20260906210000_nora_lifecycle_session_authorization.sql`). Eine Migration, die die Bindung ohne diese Vorbedingung installiert, sperrt alle Mitarbeiter aus. SQL-Fixtures, die `request.jwt.claims` setzen, brauchen eine echte `auth.sessions`-Zeile des Users (Suite-Konvention: Fixture-Sitzungs-ID = User-ID). Der konkrete Testvorgang: [`21`](21-agent-runbooks.md) Sektion 5 und 6.

Betriebsvoraussetzung und Restrisiko: [`17`](17-known-issues-and-planned-waves.md) A.2 und A.3.

### 8.2 Executor-Integrität

> **Ein privilegierter Fakt erhält genau einen kontrollierten Schreibpfad.**

- **Genau ein normaler privilegierter Pfad je Aktion.** Kein PostgREST-RPC für Browser-Rollen, kein Direkt-`UPDATE`, kein zweites Subsystem, kein GUC-/`postgres`-Bypass, kein Bypass-RPC „für Notfälle". Ein Executor ist eine `SECURITY DEFINER`-RPC, die **nur `service_role`** ausführen kann, und der **Actor ist serverseitig verifiziert** (existierender aktiver Administrator) — nie aus dem Request-Body übernommen.
- **Selbstschutz auf beiden Ebenen** (Edge *und* Datenbank): eigene Rolle, eigener Zugang, eigene Anmeldeadresse, eigenes Offboarding sind über diese Pfade nicht änderbar. Ein zweiter Administrator handelt.
- **Letzter aktiver Administrator ist eine Datenbank-Invariante**, nicht eine UI-Prüfung: `guard_last_active_admin_trigger` lässt nie null Zeilen mit `role = 'admin' AND disabled = false` zurück (`NORA_LAST_ACTIVE_ADMIN_REQUIRED`, Advisory-Lock, auf **jedem** Schreibpfad). Der Auth-Bann ist bewusst nicht Teil der Definition (Fremdsystem-Zustand ist in einer Transaktion nicht verlässlich lesbar).
- **Ticket oder Verweigerung.** Wo ein Fremdsystem (GoTrue) der eigentliche Treiber ist, autorisiert Nora vorab ein kurzlebiges Ticket und ein DB-Guard erzwingt es innerhalb der Fremdtransaktion — nie „Nora zuerst, Auth später" (Teilzustand). Ein Guard wird nie deaktiviert.
- **Ein Ticket bindet Identität, nicht nur eine Nummer:** Auth-UUID + Entity + Snapshot werden beim Ausführen erneut verglichen, damit eine Autorisierung für Identität A nie Identität B treffen kann — auch nicht bei wiederverwendeter `sales.id` ([`17`](17-known-issues-and-planned-waves.md) A.7).
- **Sitzungen werden in der Datenbank beendet** (`nora_private.revoke_auth_sessions`, nur postgres-intern, nur aus einem Executor) — nie aus einer Edge Function, nie über einen Browser-Pfad.
- **Edge Authorization ersetzt DB Enforcement nicht.** Scheitert ein Fremdsystemschritt (z. B. der Auth-Bann), ist der Zugang trotzdem aus, weil RLS und Session-Revokation greifen; gemeldet wird ein unvollständiger Sync — **nie grün ohne serverseitige Verifikation**. Ein aufgelöstes Promise eines Fremdsystems ist kein Erfolgssignal.

Die konkreten Kommandos, Zustände und Lifecycle-Abläufe stehen in [`19`](19-user-lifecycle-architecture.md) §6 und §11; die Audit-Seite in [`13`](13-crm-audit-retention.md).

---

## 9. Offene Security-Risiken

Dieses Dokument beschreibt den **beabsichtigten aktuellen Contract**. Genuin offene Punkte, akzeptierte Einschränkungen und ihre Bewertung stehen ausschließlich in [`17`](17-known-issues-and-planned-waves.md) Abschnitt A — sie werden hier nicht dupliziert und nicht stillschweigend als gelöst dargestellt.

Der Supabase Security Advisor ist vollständig bewertet (Snapshot 2026-08-28, `ASSESSED/KEEP` bzw. `RESOLVED`). **Jede neue Migration, Function oder Grant-Änderung braucht eine eigene Bewertung** — die alte wird nie fortgeschrieben.
