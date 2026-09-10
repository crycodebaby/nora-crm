# 19 – User-Lifecycle-Architektur (Mitarbeiterzugang)

Stand: 2026-09-07 — aktueller Zustand nach User Lifecycle **W1–W6-B** (alle `PRODUCTION VERIFIED`); **W6-B (kontrollierter Hard Delete) ist seit 2026-09-07 live** — Abschnitt 15 beschreibt den in Production gültigen Vertrag. Abschnitt 11 beschreibt den in Production gültigen Session-Autorisierungsvertrag.

Dieses Dokument ist die **aktuelle Quelle der Wahrheit** für den Mitarbeiter-/Benutzer-Lebenszyklus in Nora. Es beschreibt, wie das Subsystem heute funktioniert. Historische Release-Evidenz (RC-SHAs, Migrationshashes, Testzahlen, Live-Beweise, Zwischenfälle) steht im Release-Archiv (`releases/2026-09.md`), die knappen Entscheidungen mit Begründung in `06-decision-log.md`.

**Ownership-Abgrenzung.** Dieses Dokument beschreibt die **Lifecycle-Prozesse**. Die globalen Security-Invarianten dahinter gehören `22`:

| Thema | Owner |
|---|---|
| Rollen-/Authorization-Contract (`sales.role`, Matrix, Capability-Rollen) | [`22`](22-security-and-access.md) Abschnitt 4 |
| Session-/Executor-Trust-Contract (Session-Binding, Actor-Verifikation, Migrations-Hard-Gate) | [`22`](22-security-and-access.md) Abschnitt 8 |
| RLS, Grants, `SECURITY DEFINER`, privilegierte Read-Views | [`22`](22-security-and-access.md) Abschnitte 6–7 |
| operative Verifikation | [`21`](21-agent-runbooks.md) Sektion 6 |
| offene Sicherheitsrisiken | [`17`](17-known-issues-and-planned-waves.md) Abschnitt A |

Bei Widersprüchen gilt die Truth Hierarchy aus `16-current-state.md`: Code und Migrationen vor Dokumentation.

---

## 1. Zweck

Nora ist **einladungsbasiert**. Ein Mitarbeiter bekommt seinen Zugang von einem Administrator, richtet ein Passwort ein, arbeitet mit einer Rolle, und verliert seinen Zugang wieder — ohne dass Geschäftsdaten, Historie oder Nachvollziehbarkeit darunter leiden. Das Lifecycle-Programm beantwortet:

- Wer ist diese Person (Identität)?
- Darf sie sich gerade anmelden und Daten sehen (Zugang)?
- Was darf sie tun (Rolle)?
- Wer hat das entschieden, wann, für wen (Audit)?
- Was passiert mit ihren Kunden, Vorgängen, Aufgaben und Notizen, wenn sie geht (Referenzintegrität)?

Nicht Zweck: Mitarbeiterüberwachung, HR-System, generisches Identity-Framework.

## 2. Terminologie

| Begriff (sichtbar) | Technisch | Bedeutung |
|---|---|---|
| Mitarbeiter / Benutzer | `public.sales` (1:1 zu `auth.users`) | die Person im Team |
| Anmeldeadresse | `auth.users.email` (Master), `sales.email` (Spiegel) | Login-Identität |
| Rolle | `sales.role` ∈ `admin` \| `office` \| `viewer` | Berechtigungsstufe; `sales.administrator` ist nur Kompatibilitätsspiegel |
| Zugang deaktiviert | `sales.disabled = true` **und** Auth-Bann (`banned_until`) | kein operativer Zugang |
| Zugang beenden (Offboarding) | Aktion `offboard` | Deaktivieren + Sitzungen beenden + Audit in einer Transaktion |
| Zugangsstatus | abgeleitet: `invited` \| `active` \| `disabled` \| `unknown` | nie gespeichert |
| Executor | `SECURITY DEFINER`-RPC, nur `service_role` | der einzige privilegierte Schreibpfad einer Lifecycle-Aktion |
| Actor | verifizierte Auth-User-ID des handelnden Administrators | wer eine Aktion ausgelöst hat |

## 3. Identität, Zugang, Rolle — drei getrennte Fakten

| Fakt | Führender Ort | Wer schreibt | Regel |
|---|---|---|---|
| **Identität** (Login-E-Mail) | `auth.users.email` | GoTrue — nur mit Nora-Ticket (W4) | `sales.email` ist Spiegel, genau ein Schreiber (`nora_private.guard_auth_email_change`) |
| **Zugang** (aktiv/deaktiviert) | `sales.disabled` + Auth-Bann | W1-Executor / W5-Offboarding | beide Seiten werden immer gemeinsam bewegt und verifiziert |
| **Rolle** | `sales.role` | W1-Executor über `nora_private.apply_sales_role_change` (Owner `nora_role_manager`) | kein Direkt-UPDATE (Trigger `prevent_sales_privilege_escalation`) |

Die drei Fakten sind **orthogonal**: eine E-Mail-Änderung aktiviert oder deaktiviert nie; eine Rollenänderung ruft Auth nicht auf; Deaktivieren ändert die Identität nicht.

## 4. Aktuelle Zugangszustände

Der produktseitige Zugangsstatus wird **abgeleitet, nicht gespeichert** (V1A). Quellen: Supabase Auth (`email_confirmed_at`/`confirmed_at`, `banned_until`, `invited_at`) und `sales.disabled`.

| Zustand | Wahrheit | Erlaubte Admin-Aktionen |
|---|---|---|
| `invited` („Einladung gesendet") | Auth-Identität existiert, E-Mail nicht bestätigt | Einladung erneut senden, E-Mail-Adresse ändern (neue Einladung), Zugang beenden, deaktivieren |
| `active` („Zugang aktiv") | E-Mail bestätigt, nicht deaktiviert | Passwort einrichten lassen, Rolle ändern, E-Mail-Adresse ändern, Zugang beenden, deaktivieren |
| `disabled` („Zugang deaktiviert") | `sales.disabled` **oder** aktiver Bann | aktivieren, E-Mail-Adresse ändern (keine Einladung) |
| `unknown` („Zugang unklar") | `sales`-Zeile ohne auflösbare Auth-Identität | **keine** (eine Einladung würde eine zweite Identität erzeugen) |

Zusätzliche Konsistenzfakten aus `GET /users`: `accessConsistency` (`consistent` \| `inconsistent` \| `unknown`, Nora-Wert vs. Auth-Bann) und `identityConsistency` (Auth-E-Mail vs. `sales.email`). Bei Inkonsistenz bietet das Panel „Zugangsstatus synchronisieren" (Zugang) bzw. **keine** Aktion (Identität — technische Betreuung). `last_sign_in_at` ist **kein** Zustandssignal.

## 5. Architekturfluss

```
Admin-UI (EmployeeAccessPanel, Dialoge, Bearbeiten-Formular)
   │  functions.invoke("users", …) mit x-nora-operation-id (Operation Manager)
   ▼
users Edge Function (verify_jwt = false; verifiziert das Caller-JWT selbst: JWKS + auth.getUser)
   │  spricht als service_role; übergibt NUR die verifizierte Actor-User-ID
   ▼
public.<executor>_by_executor (SECURITY DEFINER, Owner postgres, search_path '', EXECUTE nur service_role)
   │  prüft Actor (existierender aktiver Admin), Selbstschutz, Ziel; verankert Actor + Operation-ID (pin_audit_context)
   ▼
nora_private.* Capability-Funktionen (Owner nora_role_manager / nora_identity_manager)
   │  Trigger: guard_last_active_admin, prevent_sales_privilege_escalation, audit_sales_privilege_change
   ▼
PostgreSQL (public.sales, auth.sessions/refresh_tokens, audit_events)  ──►  danach: GoTrue Admin API (Bann / E-Mail / Einladung)  ──►  Verifikation beider Speicher
```

Die Datenbank kommt **immer zuerst**: eine abgelehnte Anfrage hat nichts berührt; ein Teilausfall im Auth-Schritt fällt in Richtung „Zugang verweigert", nie „Identität bleibt versehentlich aktiv". Ein grünes Ergebnis gibt es nur nach serverseitiger Verifikation.

Rein lesend: `GET /users[?sales_id=]` (admin-only) liefert `employeeId/email/accessState/disabled/invitedAt/activatedAt/accessConsistency/noraDisabled/identityConsistency` und — nur für den Einzelabruf — `dependencies`. Keine Tokens, keine rohen Auth-Felder.

## 6. Vertrauenswürdige Kommandos / Executoren

| Kommando (Edge) | Datenbank | Zweck | Welle |
|---|---|---|---|
| `PATCH /users {role?, disabled?}` | `public.set_sales_access_by_executor(actor, sale, role, disabled, operation_id)` | Rolle ändern, deaktivieren, reaktivieren, „Zugangsstatus synchronisieren" | W1 (+W3 Signatur) |
| `POST invite` (Einladung) | GoTrue `inviteUserByEmail` → Executor (Rolle, optional `disabled`) → `record_employee_admin_event('user.invited')` | Mitarbeiter einladen | V1A / W1 / W3 |
| `POST resend_invitation`, `POST request_password_setup` | GoTrue → `record_employee_admin_event(...)` | zustandsabhängige Zugangs-E-Mails | V1A / W3 |
| `POST change_email` | `public.prepare_sales_email_change(...)` → GoTrue Admin API → Trigger `guard_auth_email_change` (schreibt `sales.email`, löscht `auth.one_time_tokens`, Audit) | Anmeldeadresse ändern | W4 |
| `POST offboard` | `public.offboard_employee_by_executor(actor, sale, operation_id)` | Zugang beenden | W5 |
| `GET /users?sales_id=` | `public.get_employee_dependency_preview(sale)` | offene Zuständigkeiten zählen | W5 |
| `GET /users?sales_id=` | `public.get_employee_deletion_preview(sale)` | Löschprüfung: darf dieses Konto endgültig gelöscht werden? | W6-B |
| `POST delete_account` | `public.prepare_employee_account_deletion(actor, sale, confirmation, admin_confirmed, operation_id)` → GoTrue Admin **Hard Delete** → Trigger `guard_auth_user_delete` (löscht `public.sales`, Nora-Technikzustand, schreibt `user.account_deleted` in GoTrues Transaktion) → `get_employee_deletion_evidence` | Benutzerkonto endgültig löschen | W6-B |

Gemeinsame Regeln:

- **Genau ein normaler privilegierter Pfad je Aktion.** Kein PostgREST-RPC für Browser-Rollen (`42501`), kein Direkt-UPDATE, kein zweites Subsystem. Die frühere RPC `set_sales_role_by_admin` ist gelöscht (W2) und wird nicht wieder angelegt.
- **Body-Felder sind keine Identität.** `actor_user_id`, `user_id` u. ä. im Request werden ignoriert; der Actor ist die verifizierte JWT-User-ID. Ein gefälschter Actor kann Rechte nur verengen, nie erweitern (der Executor akzeptiert nur existierende aktive Admins).
- **Selbstschutz** (Edge **und** Datenbank): eigener Zugang, eigene Rolle, eigene Anmeldeadresse und eigenes Offboarding sind über diese Pfade nicht änderbar (`NORA_SELF_ACCESS_CHANGE_FORBIDDEN`, `NORA_SELF_EMAIL_CHANGE_FORBIDDEN`). Ein zweiter Administrator handelt.
- **Letzter aktiver Administrator** ist eine Datenbank-Invariante (`guard_last_active_admin_trigger`, `NORA_LAST_ACTIVE_ADMIN_REQUIRED`, Advisory-Lock, auf jedem Schreibpfad). Der Auth-Bann ist bewusst **nicht** Teil der Definition (Fremdsystem-Zustand ist in einer Transaktion nicht verlässlich lesbar).
- **Idempotenz statt Zustandsfelder:** Re-Sync ohne Änderung ist ein No-op ohne zweites Audit; Offboarding antwortet `disposition executed|replayed`.
- **Fehlercontract:** Datenbank `DETAIL = NORA_*`, Edge snake_case-Code + HTTP-Status, Oberfläche deutscher Nutzertext ohne technisches Vokabular. Die vollständigen Tabellen je Welle stehen im Archiv (`releases/2026-09.md`).

## 7. Historische Mitarbeiter-Identität

**INAKTIV / ARCHIVIERT ist nicht NICHT-EXISTENT.** Ein deaktivierter oder offboardeter Mitarbeiter bleibt Identitätsanker für alles Bestehende:

- Alte Notizen, Vorgänge, Aufgaben, Akten und der Aktivitätslog zeigen weiterhin den **echten Namen** (nie „Unbekannt", „Gelöscht", „Ehemalig", solange die Zeile existiert).
- Zwei Read-Models: `public.sales_directory` (nur aktive; „Wem darf ich Neues zuweisen?") und `public.sales_identities` (alle inkl. `disabled`; „Wer war zuständig / wer hat das geschrieben?"). Beide `SELECT`-only, Owner `postgres`, `security_invoker = false`, ohne `role`/`email`/`user_id`.
- Alle sechs Referenzen auf `sales.id` sind `NO ACTION`-Fremdschlüssel: `companies`, `contacts`, `deals`, `tasks` (Zuständigkeit) und `contact_notes`, `deal_notes` (Urheberschaft). Nie `CASCADE`, nie `SET NULL`.
- Snapshots ohne FK bleiben bewusst stehen: `audit_events.actor_sales_id` + Namens-Snapshot, `email_delivery_events.employee_sale_id` + Adress-Snapshot.

## 8. Zuweisungsberechtigung

Ein deaktivierter Mitarbeiter darf von bestehenden Datensätzen weiter referenziert, aber **nicht neu** als Zuständiger zugewiesen werden — unterhalb der UI, für jeden Schreiber:

- Trigger `guard_active_assignment_trigger` (`BEFORE INSERT OR UPDATE OF sales_id`) auf `companies`, `contacts`, `deals`, `tasks`; Fehler `NORA_EMPLOYEE_NOT_ASSIGNABLE` (`NoraErrorCode EMPLOYEE_NOT_ASSIGNABLE`). Unverwandte Updates und Wegwechseln bleiben erlaubt. **Nicht** auf Notiztabellen.
- UI: `SalesAssignmentInput` — Auswahl aus `sales_directory`; ein deaktivierter aktueller Zuständiger bleibt sichtbar, aber nicht wählbar. Nie ein roher `ReferenceInput` auf `sales_directory`.
- FakeRest wirft denselben Code (`guardAssignmentOnCreate/Update`).
- Bekannte Kante: `merge_contacts` kann eine Zusammenführung mit diesem Code ablehnen (Gewinner ohne, Verlierer mit deaktiviertem Zuständigen) — fachlich korrekt.

## 9. Login-E-Mail-Identitätscontract (W4)

- `auth.users.email` ist die Auth-Identität; `sales.email` ihr Spiegel mit genau einem Schreiber: `nora_private.guard_auth_email_change()` (`BEFORE UPDATE OF email ON auth.users`, Capability-Owner `nora_identity_manager`, darf nur `sales.email`). `handle_update_user` synchronisiert nur Namen.
- **Ticket oder Verweigerung:** `public.prepare_sales_email_change` (nur `service_role`) prüft alles vorab (Actor, Selbstschutz, Normalisierung, Format, Eindeutigkeit gegen `sales` **und** `auth.users`, Konsistenz, No-op) und legt ein Ticket mit zwei Minuten Laufzeit an (`nora_private.sales_email_change_tickets`). GoTrues `UPDATE auth.users` ohne passendes lebendes Ticket wird abgelehnt (`NORA_EMAIL_CHANGE_NOT_AUTHORIZED`) — auch mit Service-Key, auch per Selbstbedienung (`PUT /auth/v1/user`), auch aus dem Dashboard.
- Mit Ticket geschehen in **einer** Postgres-Transaktion: `sales.email`, Löschen aller `auth.one_time_tokens` des Users (alte Einladungs-/Passwort-Links sterben), Ticket-Konsum, `user.email_changed`.
- Normalisierung `lower(btrim(x))`, 1–255 Zeichen, genau ein `@`, Punkt in der Domain; `sales.email` ist `citext` mit `uq__sales__email`.
- Zustandsmatrix: aktiv → beide Speicher neu, bleibt aktiv; eingeladen → atomar umgezogen, danach neue Einladung an die neue Adresse; deaktiviert → umgezogen, bleibt deaktiviert/gebannt, keine Einladung; unklar/inkonsistent → verweigert, keine stille Reparatur.
- Ein PATCH-Body mit `email` wird als Ganzes abgewiesen (`email_change_requires_command`); das Bearbeiten-Formular zeigt die Anmeldeadresse read-only.
- Keine Session-Revokation bei E-Mail-Änderung (Passwort und Bann unverändert).

## 10. Audit-Modell: Actor / Ziel / Operation (W3)

Drei getrennte Fakten pro Zeile in `audit_events`:

| Fakt | Spalten | Herkunft |
|---|---|---|
| **Actor** (wer) | `actor_id`, `actor_sales_id`, `actor_name_snapshot`, `actor_role_snapshot` | Browser-Sitzung: JWT-`sub`. Privilegierter Pfad (`service_role`): der vom Executor transaktionslokal verankerte, verifizierte Admin (`nora_private.pin_audit_context` → GUC `nora.audit_actor_user_id`), aufgelöst aus `public.sales` durch `resolve_audit_actor()`. Unverankerte `service_role`-Writes bleiben `System` (echte Automation). |
| **Ziel** (welcher Mitarbeiter) | `entity_type = 'sales'`, `entity_id = nora_entity_uuid('sales', sales.id)` | stabil über alle `user.*`-Ereignisse desselben Mitarbeiters |
| **Operation** (welche Ausführung) | `request_id` | Operation-ID des Requests (`x-nora-operation-id` vom Browser, sonst von der Edge Function geprägt); alle Audit-Zeilen eines Requests teilen sie |

Ereignisvokabular `user.*` (live): `user.role_changed`, `user.disabled`, `user.enabled` (Trigger `audit_sales_privilege_change`), `user.invited`, `user.invitation_resent`, `user.password_setup_requested` (Edge → `public.record_employee_admin_event`, Allowlist, Metadaten aus der DB), `user.email_changed` (W4-Guard, in GoTrues Transaktion), `user.offboarded` (W5-Executor, nur bei `executed`), `user.account_deleted` (W6-B-Guard `guard_auth_user_delete`, in GoTrues DELETE-Transaktion). `retention_class = user_management`, `source = user`.

Regeln: kein Audit ohne Änderung, keine Änderung ohne Audit (Trigger/Executor in derselben Transaktion); Audit nach einem Provider-Erfolg (Einladung, Passwort-Link) erst nach dessen Annahme, Audit-Fehler → `audit_write_failed`, nie grün; nie Token, JWTs, Sitzungs-IDs oder Provider-Antworten in `metadata`; alte Zeilen (vor W3 `System`) bleiben unverändert (append-only, kein Backfill). Details zur Tabelle: `13-crm-audit-retention.md`.

## 11. Session-gebundene RLS-Autorisierung (W5, finalisiert in W6-A)

**Der globale Contract steht in [`22`](22-security-and-access.md) Abschnitt 8.1** — Claim-Klassifikation, Owner-Bindung (`auth.sessions.user_id = sub`), malformed/fehlender Claim → deny, fail-closed, Migrations-Hard-Gate, `session_binding_health()`. Er wird hier nicht wiederholt.

**Was das für den Lifecycle bedeutet:**

- Ein JWT bleibt bis `exp` kryptografisch gültig, und GoTrue bietet keinen Admin-Logout. Deshalb ist **Offboarding erst durch die Session-Revokation wirksam** (§13), nicht durch den Auth-Bann allein.
- Eine widerrufene Sitzung ist **sofort** tot — auch nach Reaktivierung, auch bei unverfallenem Token. **Reaktivierung erfordert deshalb eine neue Anmeldung** (§14).
- Blast Radius der Bindung: 57 von 74 Policies auf 20 Tabellen, 2 Views, 11 RPCs; die übrigen 17 Policies sind rollennamenbasiert (Capability-Rollen, Storage). `service_role` ist unbetroffen.
- Kosten: ein PK-Lookup mit Besitzer-Vergleich pro Policy-Auswertung.
- Bewiesen lokal gegen GoTrue 2.196 / PostgREST 16 (echte Anmeldungen, mit dem lokalen Schlüssel signierte Claim-Formen); Production läuft PostgREST 14.5 (setzt ebenfalls nur `request.jwt.claims`).

## 12. Abhängigkeits-Preview / „Offene Zuständigkeiten"

`public.get_employee_dependency_preview(sale)` (nur `service_role`) zählt — nur Zähler, keine Zeilen:

| Aktuelle Zuständigkeit (Umverteilungsarbeit) | Historische Urheberschaft (bleibt) |
|---|---|
| `companies`, `contacts`, `open_deals` (`archived_at is null`), `open_tasks` (`done_date is null`) | `contact_notes`, `deal_notes` |

Sichtbar in der Mitarbeiterakte als dauerhafter Block **„Offene Zuständigkeiten"** (`EmployeeDependencySummary`) — vor, während und nach dem Offboarding, in jedem Zugangszustand, auch bei null („Keine offenen Zuständigkeiten."). Nicht-null-Zähler verlinken auf die bestehenden Listen, gefiltert nach `sales_id` (Aufgaben nur als Zähler). Offene Zuständigkeiten **blockieren nie** — sie sind Hinweis und Follow-up, keine Vorbedingung. Kein Massen-Reassign, kein Automatismus.

Neue Tabellen mit aktueller Zuständigkeit (`sales_id` + Zuweisungs-Guard) werden als eigener Zähler ergänzt; Urheberschaft bleibt getrennt.

## 13. Offboarding („Zugang beenden", W5)

Eigene Geschäftsoperation, kein PATCH: *diese Person hat ab sofort keinen operativen Nora-Zugang mehr.* Person, Historie und alle Referenzen bleiben; nichts wird gemailt.

Ablauf (`public.offboard_employee_by_executor`, eine Postgres-Transaktion): Guards (Actor aktiver Admin, nicht selbst, Ziel existiert) → `sales.disabled := true` über die W1-Capability (Letzter-Admin-Trigger und `user.disabled` feuern dort) → `nora_private.revoke_auth_sessions` löscht alle `auth.sessions` + `auth.refresh_tokens` des Mitarbeiters → Preview → `user.offboarded` (Actor, stabile Entity, `request_id`, Metadaten: `access_already_disabled`, `sessions_revoked`, `dependencies`). Danach außerhalb: Auth-Bann (GoTrue) → Verifikation (`disabled` **und** Bann **und** `accessConsistency = consistent`).

- `executed`: Zugang war aktiv **oder** es gab lebende Sitzungen → genau eine `user.offboarded`-Zeile. `replayed`: bereits deaktiviert ohne Sitzungen → nichts geändert, nichts geschrieben, Bann erneut angewendet. Kein `already_offboarded`-Fehler, kein `offboarded_at`-Feld.
- Scheitert der Bann: Zugang ist bereits aus (RLS + Sitzungen); Antwort `500 employee_access_sync_incomplete` mit `offboarded: true` — nie grün; Konvergenz über Retry oder „Zugangsstatus synchronisieren".
- Oberfläche: Aktion „Zugang beenden" (aktiv und eingeladen; für Deaktivierte nicht angeboten — dort „Zugang aktivieren"), Dialog mit Anmeldeadresse, Status, Preview-Tabelle, Folgesatz, „Es wird keine E-Mail versendet.", Erfolgstext erst nach Verifikation. Kein technisches Vokabular (JWT, Token, Sitzung, GoTrue).
- Kein Grund-Feld (`p_reason`), kein Hard Delete, keine DSGVO-Löschung, keine automatische Umverteilung.

## 14. Reaktivierung

Unverändert W1: `PATCH {sales_id, disabled: false}` → Executor setzt `sales.disabled = false` (`user.enabled`) → Bann aufgehoben → Verifikation. Alte Sitzungen kommen **nicht** zurück (gelöscht), ein altes Token bleibt durch die Session-Bindung tot; eine frische Anmeldung erzeugt eine neue Sitzung. Nach einer Reaktivierung ist immer eine neue Anmeldung nötig — die Mitarbeiterakte weist darauf hin.

## 15. Kontrollierter Hard Delete („Benutzerkonto endgültig löschen", W6-B — `PRODUCTION VERIFIED`)

**Produktregel (unverändert):** ein echter Mitarbeiter mit Geschäfts- oder Urheberschaftshistorie wird **offboarded, nie gelöscht** (§13). Hard Delete ist eine **Ausnahmeoperation** für versehentlich angelegte, doppelte, Test- oder nie genutzte Identitäten. Er entfernt das Nora-Benutzerkonto (`public.sales`) und die Anmeldeidentität (`auth.users` mit GoTrues CASCADE-Kindern). Er ist **keine DSGVO-Löschung**: `audit_events` (Nora) und `auth.audit_log_entries` (GoTrue) bleiben; Retention/Anonymisierung ist eine geparkte Entscheidung (`13-crm-audit-retention.md`). Bevorzugte Nutzerformulierung: „Das Nora-Benutzerkonto und die Anmeldeidentität werden endgültig gelöscht." — nie „Alle personenbezogenen Daten werden vollständig gelöscht."

Seit dem W6-B-Release (2026-09-07) gilt in Production: der kontrollierte Pfad ist der **einzige** unterstützte Löschpfad. Browser-Rollen haben weiterhin kein `DELETE`-Privileg/keine Policy auf `sales`; referenzierte Mitarbeiter bleiben durch die sechs `NO ACTION`-FKs auf jedem Pfad unlöschbar; der früher für `postgres`/`service_role` offene direkte SQL-Pfad ist jetzt durch `guard_sales_delete` geschlossen.

Das vorbestehende `TRUNCATE`-Recht der API-Rollen aus den Default-Privilegien (Zeilentrigger greifen bei `TRUNCATE` nicht) war zum W6-B-Release noch offen und ist seitdem durch eine **eigenständige, spätere** Datenbank-Sicherheitswelle geschlossen: Security Hardening Wave 1 (`PRODUCTION VERIFIED` 2026-09-07, **nicht** Teil von W6-B) entzog den API-Rollen `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` in ganz `public` und `service_role` zusätzlich jedes direkte `DELETE`. Der W6-B-Löschpfad wurde danach erneut geprüft und ist unverändert funktionsfähig: `guard_auth_user_delete` und `guard_sales_delete` gehören weiterhin `postgres`, laufen weiterhin innerhalb der GoTrue-Transaktion und sind für `service_role` nicht ausführbar; die Ticket-RPCs bleiben `service_role`-ausführbar. Vertrag: `22-security-and-access.md` Abschnitt 6.

**Löschprüfung (`public.get_employee_deletion_preview`, nur `service_role`)** — getrennt von der W5-Preview („Was ist noch offen?"): sie fragt „Ist diese Identität je zu durablem Geschäfts-/Historienzustand geworden?" und liefert nur Zähler.

| Klasse | Referenzen | Wirkung |
|---|---|---|
| **Geschäftshistorie** (`NORA_EMPLOYEE_HAS_BUSINESS_HISTORY`) | alle sechs W2-Tabellen `companies`, `contacts`, `deals`, `tasks`, `contact_notes`, `deal_notes` — **all-time**: archivierte Vorgänge, erledigte Aufgaben und historische Notizen zählen | blockiert; die sechs `NO ACTION`-FKs bleiben die letzte Datenbankbarriere (nie `CASCADE`/`SET NULL`) |
| **Durable Provenienz** (`NORA_EMPLOYEE_HAS_DURABLE_PROVENANCE`) | `checklist_templates.created_by`, `saved_text_snippets.created_by`, `google_calendar_connections.connected_by`, `audit_events` mit dem Mitarbeiter als **Actor** (`actor_sales_id`/`actor_id`) | blockiert — wer in Nora gehandelt oder Inhalte erstellt hat, ist kein „nie genutztes" Konto |
| **Audit als Ziel** | `audit_events.entity_id = nora_entity_uuid('sales', id)` (Einladung, Deaktivierung, …) | blockiert **nie**, bleibt erhalten (jedes eingeladene Konto hat solche Zeilen) |
| **Zielzustand** | `sales.disabled = true` **und** Auth-Bann (`NORA_EMPLOYEE_STILL_ACTIVE` / `NORA_EMPLOYEE_ACCESS_INCONSISTENT`), Identität auflösbar und konsistent (`NORA_EMPLOYEE_AUTH_NOT_FOUND` / `NORA_EMPLOYEE_IDENTITY_INCONSISTENT`) | aktives Konto → zuerst „Zugang beenden"; kein Sonderpfad für eingeladene Konten |
| **Technischer Kontozustand** | `auth.sessions`/`refresh_tokens`/`identities`/`one_time_tokens`/MFA/OAuth (GoTrue-CASCADE; Sitzungen zusätzlich explizit gezählt und gelöscht), W4-E-Mail-Tickets, `email_delivery_events` mit `employee_sale_id = sale` **und** einer Adresse, die dieser Mitarbeiter je hatte (aktuell + `user.email_changed`-Historie) | wird mit dem Konto entfernt; Zustellzeilen mit fremder Adresse bleiben und werden gezählt |
| **Bewahrt** | `operation_errors`, `idempotency_records` (nur UUID-Technik), `google_oauth_states` (verfällt), Nora-Audit, GoTrue-Audit (`user_deleted` mit E-Mail in `traits`, von GoTrue geschrieben) | unverändert |

**Architektur (ein Commit oder gar nichts):** `users` Edge (`action: delete_account`, verifizierter Admin-Caller) → `prepare_employee_account_deletion` prüft Actor (aktiver Admin), Selbstschutz (`NORA_SELF_DELETE_FORBIDDEN`), die getippte Bestätigung gegen den **aktuellen** vollständigen Namen (`NORA_DELETE_CONFIRMATION_MISMATCH`; Normalisierung: trim + Whitespace-Kollaps, case-sensitiv), die Extra-Bestätigung für Admin-Ziele (`NORA_ADMIN_TARGET_CONFIRMATION_REQUIRED`) und die vollständige Löschprüfung, dann schreibt sie ein **Ticket mit zwei Minuten Laufzeit** (`nora_private.sales_account_deletion_tickets`: `sale_id` + Auth-`user_id` + `entity_id` + E-Mail-/Namens-/Rollen-Snapshot + verifizierter Actor + `operation_id` + Zähler-Snapshot; keine Secrets) → GoTrue Admin **Hard Delete** → `nora_private.guard_auth_user_delete` (`BEFORE DELETE ON auth.users`) läuft **in GoTrues Transaktion**: ohne lebendes passendes Ticket `NORA_ACCOUNT_DELETE_NOT_AUTHORIZED` (auch Dashboard/SQL/andere Admin-API-Aufrufer); mit Ticket: Snapshot-Abgleich, Actor erneut geprüft, Löschprüfung **erneut** ausgewertet (kein Vertrauen in die Preview), `pin_audit_context(actor, operation_id)` (der W3-Kontext der Prepare-Transaktion überlebt nicht — das Ticket trägt ihn), Sitzungen/Tickets/Zustellzeilen entfernt, `DELETE FROM public.sales` (die sechs FKs brechen bei jeder Referenz die **gesamte** GoTrue-Transaktion ab), `user.account_deleted` geschrieben, Ticket konsumiert → Postgres löscht `auth.users`, CASCADE → Commit → Edge verifiziert per `get_employee_deletion_evidence` (Sales-Zeile weg **und** Auth weg **und** committetes Ereignis) und antwortet `disposition executed`.

- `nora_private.guard_sales_delete` (`BEFORE DELETE ON public.sales`) verweigert jedes direkte `DELETE` (`psql`, Dashboard, Data API als `service_role`) mit `NORA_SALES_DELETE_NOT_AUTHORIZED`; erlaubt ist nur der Aufruf **innerhalb** der autorisierten Auth-Löschung (transaktionslokales GUC `nora.account_deletion_ticket` = lebendes Ticket für genau `sale_id` + `user_id` **und** `pg_trigger_depth() >= 2`). Kein generischer Bypass-RPC. `service_role` ist Orchestrierungsfähigkeit, keine Browser-Berechtigung. Test-Suiten, die bisher `sales`-Fixtures per `DELETE` aufräumten, verlassen sich seit W6-B auf den Rollback ihrer Transaktion.
- **Id-Wiederverwendung:** `sales.id` bleibt `GENERATED BY DEFAULT` (eigener offener Punkt); die Autorisierung hängt nie nur an der Nummer — Ticket und Guard vergleichen Auth-UUID, Entity und Identitäts-Snapshot.
- **Audit:** `user.account_deleted` = „das Nora-/Auth-Konto wurde über den kontrollierten W6-B-Pfad endgültig gelöscht" — nicht „alle Daten gelöscht". Actor = verankerter Admin, Ziel = stabile Entity, `request_id` = Operation-ID, Metadaten nur Ids und Zähler (`eligibility`, `sessions_removed`, `email_delivery_events_purged/retained`, `audit_events_as_target_retained`, `provider_audit_record`), **keine** Adresse, kein Name. Geschrieben in derselben Transaktion: kein Ereignis ohne Löschung, keine Löschung ohne Ereignis; ein Retry schreibt nie ein zweites.
- **Retry:** `sales` weg + committetes Ereignis → `already_deleted` (kein neuer Audit); `sales` weg ohne Ereignis → `not_found`; Provider-Fehler ohne Commit → Ticket storniert, `account_delete_provider_failed`, nichts verändert (GoTrue 2.196 verbirgt die Guard-Verweigerung hinter `500`); Provider-Fehler mit Commit (Antwort verloren) → Evidenz gewinnt, `executed`; `sales` da, Auth weg (nur außerhalb Noras möglich) → `identity_inconsistent`, keine stille Reparatur; GoTrue `404` nach committeter Löschung ist Evidenz, kein Fehler.
- **Oberfläche:** eigener destruktiver Abschnitt „Benutzerkonto endgültig löschen" am Ende der Mitarbeiterakte, visuell getrennt von Passwort/E-Mail/Rolle/Zugang; für aktive/eingeladene Konten nur der Hinweis „erst nach „Zugang beenden""; für deaktivierte Konten Löschprüfung mit allen sechs Zählern und Blockergrund („Dieser Mitarbeiter ist Teil der Geschäftshistorie und kann nicht endgültig gelöscht werden. Beenden Sie stattdessen den Nora-Zugang.") oder der destruktive Dialog: **Name im Titel**, Anmeldeadresse, Rolle, Zugangsstatus, Zähler, getippter vollständiger Name, bei Admin-Zielen zusätzliche Checkbox, Erfolg erst nach Server-Verifikation, danach Rückkehr zur Benutzerliste. Nur Administratoren sehen die Akte. Demo/FakeRest: `deletion.supported = false`, kein destruktives Element (kein vorgetäuschtes Sicherheitsmodell).
- **Fehlercontract:** Datenbank `DETAIL = NORA_*` (oben), Edge snake_case (`self_delete_forbidden`, `confirmation_mismatch`, `admin_target_confirmation_required`, `employee_still_active`, `business_history_exists`, `durable_provenance_exists`, `identity_inconsistent`, `account_delete_not_authorized`, `account_delete_provider_failed`, `account_delete_verification_failed`, `not_found`; Dispositionen `executed | already_deleted`), Oberfläche deutscher Nutzertext ohne technisches Vokabular.

## 16. Bekannte Sicherheitseinschränkungen

Die offenen und akzeptierten Sicherheitspunkte werden **nicht hier** geführt, sondern in [`17`](17-known-issues-and-planned-waves.md) Abschnitt A (Bewertung und Status) — insbesondere: fail-closed Session-Bindung als Betriebsvoraussetzung (A.2), Restlaufzeit eines alten JWT (A.3), `insert_audit_event` für `service_role` (A.4), JOSE-Wortlaut in 401-Antworten (A.5), `sales.id` ist `GENERATED BY DEFAULT` (A.7), fehlende Autorisierung auf Datenebene in FakeRest ([`17`](17-known-issues-and-planned-waves.md) D.3).

Genuin **lifecycle-eigene** offene Punkte:

| Einschränkung | Bewertung | Vorgemerkt |
|---|---|---|
| Dialog „Zugang beenden" nennt das Ziel nur über Anmeldeadresse und Status (Live-Zwischenfall 2026-09-06: echter Admin statt Testkonto getroffen, sofort reaktiviert) | kein Codefehler; der W6-B-Löschdialog setzt die Lehre bereits um (Name im Titel, Tippbestätigung, Admin-Checkbox) | UX-Härtung des W5-Dialogs bleibt eigener Punkt |
| `invitee_email` / `employee_email` / `changes.email` im Audit sind personenbezogen | keine Retention-/Anonymisierungsregel entschieden | [`13`](13-crm-audit-retention.md) offene Entscheidung |

## 17. Roadmap W1–W10

| Welle | Inhalt | Status |
|---|---|---|
| **V1A** | Zugangsstatus abgeleitet, `GET /users`, Einladung erneut senden / Passwort einrichten lassen, Route `/zugang-einrichten`, Onboarding-Zustandsmaschine | `PRODUCTION VERIFIED` (2026-09-04) |
| **V1B** | Präsentation des Onboardings und der Admin-Zugangsfakten | `PRODUCTION VERIFIED`, PO UX accepted (2026-09-04) |
| **V1C-A / V1C-B** | E-Mail-Zustellbeobachtung (Brevo-Webhook) und Zustellstatus-Zeile | `PRODUCTION VERIFIED` (2026-09-04) — `18-email-delivery-observability.md` |
| **Wave 0** | `TRUNCATE` auf `audit_events` für `authenticated` entzogen | `PRODUCTION VERIFIED` (2026-09-04) |
| **W1** | Ein privilegierter Executor, Selbst-/Letzter-Admin-Schutz, Zugangskonsistenz | `PRODUCTION VERIFIED` (2026-09-05) |
| **W2** | Referenzintegrität, historische Identität (`sales_identities`), aktive Zuweisung autoritativ, Legacy-RPC entfernt | `PRODUCTION VERIFIED` (2026-09-05) |
| **W3** | Audit-Actor-Korrektheit, stabile Ziel-Entity, `record_employee_admin_event`, Operation-Korrelation | `PRODUCTION VERIFIED` (2026-09-06) |
| **W4** | Kontrollierte Änderung der Anmeldeadresse (Ticket + Guard, `nora_identity_manager`) | `PRODUCTION VERIFIED` (2026-09-06) |
| **W5** | Offboarding, Session-Revokation, session-gebundene RLS, Abhängigkeits-Preview | `PRODUCTION VERIFIED` (2026-09-06) |
| **W6-A** | Session-Autorisierung finalisiert: fail-closed, Owner-Bindung (`sessions.user_id = sub`), malformed/fehlender Claim → deny, Migrations-Hard-Gate, `session_binding_health()` | `PRODUCTION VERIFIED` (2026-09-06) — Migration `20260906210000_nora_lifecycle_session_authorization`, nur Datenbank |
| **W6-B** | Kontrollierter Hard Delete „Benutzerkonto endgültig löschen": Löschprüfung (all-time Geschäftshistorie + Provenienz), Ticket, `auth.users`- und `sales`-DELETE-Guards, GoTrue-Admin-Hard-Delete als Treiber, `user.account_deleted`, schmale Purge `email_delivery_events`, destruktiver Dialog mit Name/Tippbestätigung/Admin-Checkbox | **`PRODUCTION VERIFIED`** (2026-09-07; Migration `20260906230000_nora_lifecycle_account_deletion`, `users`-Edge v9, Frontend; Live-Beweis am Testkonto `sales.id = 4`) — §15; Release-Evidenz im Archiv |
| **Wave 1** (keine Lifecycle-Welle) | Default-Privilegien des `public`-Schemas und explizite Zielmatrix: API-Rollen ohne `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN`, `service_role` ohne direktes `DELETE` in `public` | `PRODUCTION VERIFIED` (2026-09-07; Migration `20260907120000`, nur Datenbank) — eigenständige Sicherheitswelle **nach** W6-B, hier nur der Vollständigkeit halber; Vertrag in [`22`](22-security-and-access.md) Abschnitt 6 |
| **W7** | — | **geplant / TBD** (nicht entschieden) |
| **W8** | — | **geplant / TBD** (nicht entschieden) |
| **W9** | SQL-Verifikationssuiten (kanonische Sequenz) in CI | **geplant / nicht begonnen** |
| **W10** | — | **geplant / TBD** (nicht entschieden) |

Kandidaten ohne Wellen-Zuordnung (nicht entschieden): Dialog-Härtung „Zugang beenden", JOSE-Wortlaut, `record_operation_error`-camelCase-Nebenbefund, Retention/Anonymisierung personenbezogener Audit-Metadaten, deterministische Sendekorrelation (Send Email Hook), bestätigungsbasierte Selbständerung der Anmeldeadresse, sichtbare Bestätigung eines Rollenwechsels in der UI, Orphan-Cleanup einer Auth-Identität ohne `sales`-Zeile (W6-B verweigert bewusst). Zukünftige Implementierungsdetails werden hier **nicht** vorweggenommen.

## 18. Agenten-Guardrails

Diese Liste wiederholt **nicht** die Abschnitte 6–15; sie nennt nur, was beim Ändern zusätzlich zu beachten ist.

**Global (nicht hier entscheiden):** Rollen-/Authorization-Contract, Trust Boundaries, RLS/Grants/`SECURITY DEFINER`, Session-Binding und Executor-Integrität → [`22`](22-security-and-access.md). Operative Testsequenz und Verifikationsschritte → [`21`](21-agent-runbooks.md) Sektion 6.

**Lifecycle-spezifisch:**

- **Kein neuer Schreibpfad** für `sales.role`, `sales.disabled`, `sales.email` oder `auth.sessions` außerhalb der Executoren in Abschnitt 6. Keine RPC für Browser-Rollen, keine zweite Lifecycle-Maschine.
- Jede Änderung an `disabled` bewegt auch den Auth-Bann und wird verifiziert; **kein grüner Erfolg ohne `accessConsistency = consistent`**.
- Neue `user.*`-Ereignisse: Allowlist in `record_employee_admin_event` (oder DB-Executor mit `pin_audit_context`), Actor = verifizierte JWT-User-ID, Ziel = `sales.id`, Operation-ID weiterreichen — **nie** `insert_audit_event` + `crypto.randomUUID()`.
- Jede neue Referenz auf `sales.id`: `NO ACTION`-FK und W2-Suite ergänzen ([`03`](03-data-model-guardrails.md) §2.2). Jede Spalte mit **aktueller** Zuständigkeit zusätzlich `guard_active_assignment_trigger` und Preview-Zähler; Picker über `SalesAssignmentInput`.
- Namen bestehender Datensätze über `sales_identities`, Auswahl für Neues über `sales_directory`; beide Views bleiben `SELECT`-only und ohne Identity-/Security-Metadaten.
- **Hard Delete (W6-B):** kein zweiter Löschpfad für `sales` oder `auth.users` — weder RPC noch Edge-`DELETE` noch Dashboard. Die Löschprüfung zählt **all-time** (nie die W5-„offen"-Filter übernehmen); neue Tabellen mit Mitarbeiter-Urheberschaft/-Zuständigkeit werden in `nora_private.employee_deletion_preview` als Blocker ergänzt und in der W6-B-Suite bewiesen. Guards nie deaktivieren, Ticket nie länger als zwei Minuten, keine E-Mail/Namen in `user.account_deleted`-Metadaten, `sales.id` nie als alleinige Autorisierungsbasis.
- **Test-Fixtures und Session-Bindung:** wer nur die Legacy-GUCs `request.jwt.claim.sub`/`role` setzt, läuft im Kompatibilitätspfad; wer `request.jwt.claims` (der API-Pfad) setzt, **muss** eine echte `auth.sessions`-Zeile des Users anlegen und deren `id` als `session_id` mitgeben (Suite-Konvention: Fixture-Sitzungs-ID = User-ID).
- **Keine Testdaten, Fixtures oder Beweise an echten Mitarbeitern in Production**; Live-Beweise nur am freigegebenen Testkonto.
- Bei Änderungen an diesem Subsystem nachziehen: dieses Dokument, [`01`](01-domain-model.md) (Kurzfassung), [`03`](03-data-model-guardrails.md) (Dateninvarianten), [`22`](22-security-and-access.md) (nur wenn sich ein **globaler** Security-Contract ändert), [`06`](06-decision-log.md) (durable Entscheidung), [`16`](16-current-state.md); Release-Evidenz ins Archiv (`releases/`).
