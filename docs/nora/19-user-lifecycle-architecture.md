# 19 – User-Lifecycle-Architektur (Mitarbeiterzugang)

Stand: 2026-09-06 — aktueller Zustand nach User Lifecycle **W1–W5** (alle `PRODUCTION VERIFIED`).

Dieses Dokument ist die **aktuelle Quelle der Wahrheit** für den Mitarbeiter-/Benutzer-Lebenszyklus in Nora. Es beschreibt, wie das Subsystem heute funktioniert. Historische Release-Evidenz (RC-SHAs, Migrationshashes, Testzahlen, Live-Beweise, Zwischenfälle) steht im Release-Archiv (`releases/2026-09.md`), die knappen Entscheidungen mit Begründung in `06-decision-log.md`.

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

Ereignisvokabular `user.*` (live): `user.role_changed`, `user.disabled`, `user.enabled` (Trigger `audit_sales_privilege_change`), `user.invited`, `user.invitation_resent`, `user.password_setup_requested` (Edge → `public.record_employee_admin_event`, Allowlist, Metadaten aus der DB), `user.email_changed` (W4-Guard, in GoTrues Transaktion), `user.offboarded` (W5-Executor, nur bei `executed`). `retention_class = user_management`, `source = user`.

Regeln: kein Audit ohne Änderung, keine Änderung ohne Audit (Trigger/Executor in derselben Transaktion); Audit nach einem Provider-Erfolg (Einladung, Passwort-Link) erst nach dessen Annahme, Audit-Fehler → `audit_write_failed`, nie grün; nie Token, JWTs, Sitzungs-IDs oder Provider-Antworten in `metadata`; alte Zeilen (vor W3 `System`) bleiben unverändert (append-only, kein Backfill). Details zur Tabelle: `13-crm-audit-retention.md`.

## 11. Session-gebundene RLS-Autorisierung (W5)

Ein JWT bleibt bis `exp` kryptografisch gültig; PostgREST prüft nie, ob die im Token genannte Sitzung noch existiert, und GoTrue bietet keinen Admin-Logout. Nora bindet deshalb die Autorisierung an die Sitzung:

- `nora_private.jwt_session_is_live()` liest den `session_id`-Claim (`safe_auth_session_id()`) und verlangt eine Zeile in `auth.sessions`.
- `nora_private.is_active_user()` und `nora_private.current_role()` — und damit `has_role`, `is_admin`, `can_write` und alle Policies — tragen diese Bindung.
- Bewusst eng: ein JWT **ohne** `session_id`-Claim (Test-Fixtures, Nicht-GoTrue-Kontexte) verhält sich wie vorher; `service_role` ist unbetroffen. Ein Browser kann den Claim aus einem signierten Token nicht entfernen.
- Effekt: eine widerrufene Sitzung ist sofort tot — auch nach Reaktivierung, auch bei unverfallenem Token. Reaktivierung erfordert eine neue Anmeldung.
- Kosten: ein PK-Lookup pro Policy-Auswertung.
- **Fail-open (bekannte Einschränkung):** ist `auth.sessions` für `postgres` nicht lesbar, antwortet der Helper mit `WARNING` „live" (Vor-W5-Verhalten). Siehe Abschnitt 16.

Wer die RLS-Helfer ändert, erhält die Bindung; neue Helfer, die „aktiver Benutzer" beantworten, binden ebenfalls.

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

## 15. Hard-Delete-Grenze

Heute gibt es **keinen** unterstützten Löschpfad für Mitarbeiter:

- Browser-Rollen haben weder `DELETE`-Privileg noch DELETE-Policy auf `sales`.
- Ein referenzierter Mitarbeiter ist durch die sechs `NO ACTION`-FKs auf jedem Pfad unlöschbar (`23503`) — auch für `postgres`/`service_role`.
- Ein unreferenzierter Mitarbeiter ist technisch nur für `postgres`/`service_role` löschbar. Das ist der Pfad eines **künftigen kontrollierten Hard-Delete-Executors** (W6, nicht gebaut) für Fake-, Versehens- und nie genutzte Testkonten: Preview = alle sechs Zähler 0, Snapshots in `audit_events`/`email_delivery_events` bleiben, Auth-Identität separat (`sales.user_id → auth.users` ist `NO ACTION`), Test-Datenpurge nie über `CASCADE`. Eine privilegierte Purge für `email_delivery_events` eines Testbenutzers ist ebenfalls nur vorbereitet, nicht gebaut.
- **Produktregel:** ein echter Mitarbeiter mit Geschäftshistorie wird **offboarded, nicht gelöscht**.

## 16. Bekannte Sicherheitseinschränkungen (aktuell)

| Einschränkung | Bewertung | Vorgemerkt |
|---|---|---|
| Session-Bindung ist **fail-open**, wenn `postgres` `auth.sessions` nicht lesen kann (WARNING, Vor-W5-Verhalten) | von keinem Aufrufer auslösbar; in Production ist das Privileg vorhanden (direkt **und** über `pg_read_all_data`); Restrisiko = eigenes unverfallenes Token eines gerade reaktivierten Mitarbeiters (≤ 3600 s) | W6: fail-closed + Privileg-Monitor |
| Helfer prüft nur die **Existenz** der Sitzung (kein `user_id = sub`-Abgleich); malformed `session_id`-Claim fällt auf den No-Claim-Pfad | über signierte GoTrue-Tokens nicht erreichbar | W6: Owner-Abgleich, malformed → deny |
| Restlaufzeit eines alten JWT ist nur durch die RLS gedeckt, nicht durch GoTrue-Entwertung | Autorisierungs-, keine Authentifizierungsentwertung; kein Pfad liefert Daten | akzeptiert, dokumentiert |
| `public.insert_audit_event` bleibt für `service_role` ausführbar (Kalender-Functions, Actor `System`) | vorbestehend; `users`-Function nutzt sie nicht mehr | spätere Härtung (schmale Writer je Function) |
| Default-Privilegien in `public` vergeben `TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN` an API-Rollen; lokaler `db reset` ist großzügiger als Production | `audit_events` geschlossen (Wave 0); Folgetabellen offen | eigene Grant-Welle (`17-known-issues-and-planned-waves.md`) |
| 401-Antworten der Edge Functions tragen JOSE-Wortlaut | keine Daten, technisches Vokabular | Follow-up |
| Dialog „Zugang beenden" nennt das Ziel nur über Anmeldeadresse und Status (Live-Zwischenfall 2026-09-06: echter Admin statt Testkonto getroffen, sofort reaktiviert) | kein Codefehler | UX-Härtung: Name im Dialogkopf, Extra-Bestätigung bei Admin-Zielen |
| FakeRest kennt die Datenbank-Guards nicht (Demo hat keine Autorisierung auf Datenebene) | dokumentierte Demo-Lücke | — |
| `invitee_email`/`employee_email`/`changes.email` im Audit sind personenbezogen | keine Retention-/Anonymisierungsregel entschieden | `13-crm-audit-retention.md` offene Entscheidung |

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
| **W6** | Kontrollierter Hard-Delete-Executor für unreferenzierte Test-/Fake-Konten; Empfehlung: Session-Bindung fail-closed + Privileg-Monitor, Owner-Abgleich im Helfer | **geplant / nicht begonnen** — Umfang TBD |
| **W7** | — | **geplant / TBD** (nicht entschieden) |
| **W8** | — | **geplant / TBD** (nicht entschieden) |
| **W9** | SQL-Verifikationssuiten (kanonische Sequenz) in CI | **geplant / nicht begonnen** |
| **W10** | — | **geplant / TBD** (nicht entschieden) |

Kandidaten ohne Wellen-Zuordnung (nicht entschieden): Default-Privilegien-Bereinigung, Dialog-Härtung „Zugang beenden", JOSE-Wortlaut, `record_operation_error`-camelCase-Nebenbefund, Retention/Anonymisierung personenbezogener Audit-Metadaten, deterministische Sendekorrelation (Send Email Hook), Purge von `email_delivery_events` für Testkonten, bestätigungsbasierte Selbständerung der Anmeldeadresse, sichtbare Bestätigung eines Rollenwechsels in der UI. Zukünftige Implementierungsdetails werden hier **nicht** vorweggenommen.

## 18. Agenten-Guardrails

- Kein neuer Schreibpfad für `sales.role`, `sales.disabled`, `sales.email` oder `auth.sessions` außerhalb der Executoren in Abschnitt 6. Keine RPC für Browser-Rollen, kein GUC-/`postgres`-Bypass, keine zweite Lifecycle-Maschine.
- Jede Änderung an `disabled` bewegt auch den Auth-Bann und wird verifiziert; kein grüner Erfolg ohne `accessConsistency = consistent`.
- Neue `user.*`-Ereignisse: Allowlist in `record_employee_admin_event` (oder DB-Executor mit `pin_audit_context`), Actor = verifizierte JWT-User-ID, Ziel = `sales.id`, Operation-ID weiterreichen — nie `insert_audit_event` + `crypto.randomUUID()`.
- Jede neue Referenz auf `sales.id`: `NO ACTION`-FK, W2-Suite ergänzen; jede Spalte mit aktueller Zuständigkeit: zusätzlich `guard_active_assignment_trigger` und Preview-Zähler; Picker über `SalesAssignmentInput`.
- Namen bestehender Datensätze über `sales_identities`, Auswahl für Neues über `sales_directory`; beide Views bleiben `SELECT`-only und ohne Identity-/Security-Metadaten.
- RLS-Helfer, die „aktiver Benutzer" beantworten, tragen `jwt_session_is_live()`. Test-Fixtures setzen nur `request.jwt.claim.sub`; eine Sitzung simuliert man mit `request.jwt.claim.session_id` auf eine echte `auth.sessions.id`. Migrationen, die `auth.sessions` berühren, prüfen vorher `has_table_privilege('postgres', 'auth.sessions', 'SELECT')`.
- Keine Testdaten, Fixtures oder Beweise an echten Mitarbeitern in Production; Live-Beweise nur am freigegebenen Testkonto.
- Kanonische SQL-Sequenz nach `db reset` (W1 → W2 → W3 → W4 → W5 je zweimal, leer und mit Fixtures) — siehe `07-agent-change-checklist.md`.
- Bei Änderungen an diesem Subsystem: dieses Dokument, `01-domain-model.md` (Kurzfassung), `03-data-model-guardrails.md` (Invarianten), `06-decision-log.md` (durable Entscheidung) und `16-current-state.md` nachziehen; Release-Evidenz ins Archiv (`releases/`).
