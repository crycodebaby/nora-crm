# 27 – Work 3 – Lifecycle-Commands `work.complete` / `work.reopen` (Command-Contract)

Stand: 2026-10-14 · Status: **CONTRACT CANDIDATE — bereit für unabhängige Review** (noch nicht eingefroren) · Umsetzungsstand: **nicht implementiert** — keine Migration, kein RPC, kein Code · Load-Klasse: **CONDITIONAL CURRENT CONTRACT**

Dieses Dokument ist der **Implementierungs-Contract für die erste autoritative Work-Mutation**: genau zwei Application Commands, `completeWorkItem` (`work.complete`, `open → done`) und `reopenWorkItem` (`work.reopen`, `done → open`), über dem einzigen Work Carrier `public.tasks`. Es legt fest, was ein späterer Implementierungs-Agent bauen **muss**, was er wählen **darf** und was **nicht** Teil der Welle ist — und woran die Umsetzung objektiv gemessen wird.

**Was dieses Dokument nicht ist:** keine Work-Semantik (die besitzt ausschließlich [`25`](25-universal-work-model.md); bei einem Widerspruch gewinnt `25`, und der Widerspruch ist ein Befund), kein Live-Zustand ([`16`](16-current-state.md)), keine Oberfläche des Arbeitskorbs ([`26`](26-arbeitskorb-ui-contract.md) bleibt read-only), kein Audit-Vertrag ([`13`](13-crm-audit-retention.md)), kein allgemeiner Operations-Vertrag ([`23`](23-operations-errors-feedback.md)). Wo dieses Dokument Security-Regeln festlegt, sind es **Zielregeln der Welle**; die aktuelle Durchsetzung beschreibt [`22`](22-security-and-access.md), bis die Welle ausgeliefert ist.

**Begründung:** [`06`](06-decision-log.md) „2026-10-14 – Work 3". **Sequenz:** Gate **G-4a** in [`25`](25-universal-work-model.md) Abschnitt 23 (vom Product Owner vor G-1/G-3 gezogen). **Offene Punkte:** [`17`](17-known-issues-and-planned-waves.md) G.7. **Basis:** `main` `8059b0d0c48209e79c9c4ad5a71a27471fab4020`.

> **Herkunft.** Dieser Contract fasst eine read-only forensische Discovery (Agent A, nicht im Repository) und sechs Product-Owner-Entscheidungen (D1–D6, Abschnitt 3) zusammen. Jede Tatsachenaussage über den heutigen Zustand wurde für dieses Dokument gegen `main` `8059b0d0` erneut geprüft und mit Fundstelle belegt (Abschnitt 2). **Was hier steht, ist der Contract** — Formulierungen der Discovery, die hier nicht stehen, gelten nicht.

### Kennzeichnung

| Marke | Bedeutung |
|---|---|
| **FACT** | belegtes heutiges Repository-Verhalten (`main` `8059b0d0`) |
| **PO DECISION** | vom Product Owner freigegebene Entscheidung D1–D6 |
| **CONTRACT** | normative Anforderung an die Work-3-Implementierung (**MUSS** / **DARF NICHT**) |
| **IMPLEMENTATION CHOICE** | innerhalb der Contract-Grenzen frei wählbar |
| **OUT OF SCOPE** | ausdrücklich nicht Teil von Work 3 |
| **KNOWN LEGACY** | heutiges Verhalten, das bis zur Migration durch Work 3 besteht |

---

## 1. Zweck und Scope

Work 2 hat den autoritativen **Lesepfad** geschaffen (`public.get_work_items` → `getWorkItems` → Arbeitskorb). Work 3 schafft den ersten autoritativen **Schreibpfad** — und zwar für den **einzigen** Lifecycle, den der Carrier heute speichern kann ([`25`](25-universal-work-model.md) §6.2):

```text
open (done_date IS NULL)  ◀── work.reopen ──  done (done_date IS NOT NULL)
                          ── work.complete ──▶
```

Zielarchitektur (**CONTRACT**):

```text
Konsument (Task.tsx-Checkbox; später Arbeitskorb, MCP, Automation)
   ↓  fordert eine Absicht an: „erledigen" / „wieder öffnen" + Ziel + Idempotenzschlüssel
Application Command  completeWorkItem / reopenWorkItem      (Eingabeprüfung, Fehler-/Ergebnisvertrag)
   ↓
Port  WorkLifecycleCommands                                 (Data Provider)
   ↓
Supabase-Adapter + Operation Wrapper                        (operation_id → x-nora-operation-id)
   ↓
RPC  public.complete_work_item / public.reopen_work_item    (eine Transaktion)
   ├─ Actor aus der Session        (current_sales_id)
   ├─ Autorisierung                 (can_write: office | admin)
   ├─ Idempotenz                    (idempotency_check / _persist)
   ├─ Zeilensperre + Zustand lesen  (Server bestimmt den Ist-Zustand)
   ├─ Transition oder unverändert   (done_date = Transaktionszeit | NULL | nichts)
   └─ Audit über den bestehenden Trigger (task.completed / task.reopened, request_id = operation_id)
   ↓
Work Read Model zeigt die neue Wahrheit (Konsument liest neu, rekonstruiert nichts)
```

**Der Konsument fordert eine Handlung an. Er besitzt die Geschäftsregel nicht.** Er sendet weder Zielzustand noch Zeitstempel noch Actor.

**Scope (CONTRACT):** genau zwei Commands, ihre RPCs, ihr Application-/Port-/Adapter-Pfad, die Schließung des rohen `done_date`-Schreibrechts (Abschnitt 16), die Umstellung der bestehenden Task-Checkbox (Abschnitt 17), die Demo-Entsprechung (Abschnitt 20) und die Tests (Abschnitt 22). Alles andere: Abschnitt 24.

---

## 2. Ausgangslage (FACT, geprüft gegen `main` `8059b0d0`)

| # | Tatsache | Fundstelle |
|---|---|---|
| F-1 | `public.tasks` hat acht Spalten; Lifecycle allein über `done_date` (`NULL` = offen). Kein `status`, `updated_at`, `version`, `completed_by`, Cancel-/Archivzustand | [`25`](25-universal-work-model.md) §4.2; `supabase/schemas/01_tables.sql` |
| F-2 | `get_work_items` liest `state = open ⟺ done_date IS NULL`; `p_state_scope` `open` (Default) \| `done` \| `all` | [`25`](25-universal-work-model.md) §21.1, §21.3 |
| F-3 | Die Work-Identität ist `public.nora_entity_uuid('task', id)` = UUIDv5 über `'task:<id>'` (Namespace `6ba7b811-…`), `IMMUTABLE`, nicht umkehrbar; das Work-DTO (`WorkItem`) enthält **keine** Träger-ID | `20260628150000_checklists_snippets_audit.sql`; `application/queries/getWorkItems.ts` |
| F-4 | `Task.tsx` schaltet Erledigt **und** Wieder-öffnen über **eine** Funktion `handleCheck`: `update("tasks", { data: { done_date: task.done_date ? null : new Date().toISOString() } })` — der Browser entscheidet die Richtung und erzeugt den Zeitstempel. Zwei Auslöser: die Checkbox und (mobil) ein Tippen auf den Zeilenkörper. Nach einem Erfolg wird die `tasks`-Liste **absichtlich nicht** invalidiert | `tasks/Task.tsx` Z. 76–97, 119–129 |
| F-5 | Der generische Update-Pfad (`ra-supabase-core` → `@raphiniert/ra-data-postgrest` 2.5.1, Lockfile) sendet nur **geänderte** Felder (`getChanges(data, previousData)`) und entfernt den Primärschlüssel; ohne Änderung findet kein Request statt | `package-lock.json`; `ra-data-postgrest/esm/index.js` `update`, `getChanges` |
| F-6 | Weitere legitime Task-Schreibpfade über generisches CRUD: Bearbeiten-Dialog (`TaskEdit`, `EditBase`), „Morgen"/„Nächste Woche" (`due_date`), Kontakt-Zusammenführung (`contact_id`), Anlage (`AddTask`, `TaskCreateSheet`), JSON-Import (`create` **inkl.** `done_date`) | `tasks/Task.tsx` Z. 233–261; `providers/commons/mergeContacts.ts`; `misc/useImportFromJson.ts` Z. 559–567 |
| F-7 | Grants: `authenticated` hält `SELECT, INSERT, UPDATE, DELETE` auf `public.tasks` (Tabellenebene), `service_role` `SELECT, INSERT, UPDATE`, `anon` nichts | `supabase/schemas/06_grants.sql` Z. 141–143 |
| F-8 | RLS: `Tasks update writers … using/with check (nora_private.can_write())`; `SELECT using is_active_user()`; `DELETE` nur `is_admin()`. **Kein Ownership-Prädikat** | `supabase/schemas/05_policies.sql` Z. 53–57 |
| F-9 | `can_write()` = `has_role(['admin','office'])` über `current_role()`; die Session-Bindung (`jwt_session_is_live()`) sitzt in `current_role()`/`is_active_user()` | `20260714140000_nora_rbac_hardening.sql`; [`22`](22-security-and-access.md) §8.1 |
| F-10 | `nora_private.current_sales_id()`: Actor nur aus der Sitzung (`safe_auth_uid()` → `sales.user_id`), nicht deaktiviert, lebende Sitzung; kein Actor-Argument; liest `nora.audit_actor_user_id` nie | `02_functions.sql` Z. 5652–5676; [`25`](25-universal-work-model.md) §21.2 |
| F-11 | Audit-Trigger `audit_task_row` (`AFTER I/U/D`, `SECURITY DEFINER`): `done_date NULL → NOT NULL` ⇒ `task.completed`, `NOT NULL → NULL` ⇒ `task.reopened`, sonst `task.updated` (nur bei nichtleerem Diff). Actor über `write_audit_event` → `resolve_audit_actor()` → `safe_auth_uid()` aus den PostgREST-Sitzungs-GUCs; `request_id` über `current_operation_id()` aus dem Header `x-nora-operation-id`. `audit_events.created_at default now()` | `02_functions.sql` Z. 1262–1475, 1892–1957; `01_tables.sql` |
| F-12 | Ein `UPDATE` nur auf `done_date` löst **weder** die Kontextprüfung (`enforce_task_company_context` kehrt bei unverändertem `contact_id`/`company_id` sofort zurück) **noch** `guard_active_assignment` (nur `UPDATE OF sales_id`) aus | `02_functions.sql` Z. 1984–2001; `04_triggers.sql` |
| F-13 | Idempotenz-Primitive: `idempotency_check(command, key, fingerprint)` nimmt einen Advisory-Xact-Lock je `(command, key)`, liefert das gespeicherte Ergebnis oder wirft `23505` / `NORA_IDEMPOTENCY_CONFLICT`; `idempotency_persist` schreibt in **derselben** Transaktion. Scope `(command, idempotency_key, actor_id = safe_auth_uid())`. Nicht `SECURITY DEFINER` — nur aus einem DEFINER-RPC aufrufbar | `02_functions.sql` Z. 3165–3260; `01_tables.sql` `nora_private.idempotency_records` |
| F-14 | Command-Präzedenz: `SECURITY DEFINER`, Owner `postgres`, `search_path = ''`, Auth im Körper (`NORA_PERMISSION_DENIED`), optionaler Schlüssel, `_meta.disposition = executed \| replayed` | `create_quick_capture_task`, `create_customer_with_contact` u. a. in `02_functions.sql` |
| F-15 | Ausführungsdisposition hat **genau zwei** Werte `executed \| replayed` | [`23`](23-operations-errors-feedback.md) §3.1 |
| F-16 | Spaltenbezogene Grant-Präzedenz: `grant update (email) on table public.sales to nora_identity_manager`; Trigger-Präzedenz für Spaltenschutz: `prevent_sales_privilege_escalation` | `06_grants.sql` Z. 534; [`22`](22-security-and-access.md) §6.4 |
| F-17 | Die geparkte `mcp` Edge Function (nicht deployt) setzt `role authenticated` und führt `UPDATE tasks SET done_date = NOW() WHERE id = …` als rohes SQL aus | `supabase/functions/mcp/index.ts` Z. 681–735; [`17`](17-known-issues-and-planned-waves.md) H („`mcp` … PARKED") |
| F-18 | FakeRest simuliert bestehende Commands (z. B. `createQuickCaptureTask`, `setPrimaryContact`) über den Operation-Katalog; die Work-**Lese**schnittstelle antwortet dort `unavailable` | `providers/fakerest/dataProvider.ts`; [`06`](06-decision-log.md) „Alpha Work 2" Punkt 7 |
| F-19 | CI (`.github/workflows/check.yml`) führt ESLint, Prettier, Secret-Scan, Typecheck, Vitest (App + Functions), Build/Bundle-Budget und Playwright-E2E gegen eine lokale Supabase (`make test-e2e-ci`) aus — **keine** SQL-, Session- oder Concurrency-Suite aus `supabase/tests/` | `.github/workflows/check.yml`; `Makefile` |
| F-20 | `supabase/tests/public_privilege_hardening_verification.sql` prüft für `authenticated` auf `public.tasks` exakt `SELECT,INSERT,UPDATE,DELETE` (Tabellenebene) | Z. 98–112 |

---

## 3. Produktentscheidungen (PO DECISION) und ihre Wirkung

| # | Entscheidung | Contract-Wirkung |
|---|---|---|
| **D1** | Gate-Reihenfolge: die ersten `open ⇄ done`-Commands dürfen als **G-4a** vor G-1/G-3 umgesetzt werden | [`25`](25-universal-work-model.md) §23 trägt die Sequenzänderung ausdrücklich (alte Voraussetzung bleibt sichtbar); G-4 im Übrigen (claim/assign/defer/resume, `allowed_actions`) bleibt „nach G-1/G-3". Entscheidungseintrag in [`06`](06-decision-log.md) |
| **D2** | Jeder authentifizierte Nora-Benutzer mit Schreibrolle (`office`, `admin`) darf **jede** Work-Aufgabe erledigen oder wieder öffnen; `sales_id`/Holder ist **keine** Security Boundary | Autorisierung = `current_sales_id() IS NOT NULL AND can_write()` — sonst nichts (Abschnitt 6). Kein Holder-, Team- oder Vorgesetztenprädikat; `viewer` wird abgewiesen |
| **D3** | `complete` auf erledigter Arbeit ist **erfolgreich**, ändert `done_date` nicht, erzeugt kein zweites `task.completed` und ist für den Aufrufer von „ausgeführt" unterscheidbar | `transition = unchanged` (Abschnitt 7, 13). **Symmetrisch** für `reopen` auf offener Arbeit — keine Asymmetrie, kein PO-Folgepunkt |
| **D4** | Work 3 definiert eine **autoritative** Command-Grenze für **beide** Richtungen; die Checkbox nutzt sie; direktes `done_date`-Schreiben durch normale Clients ist danach kein Bypass mehr | Abschnitte 16 (Schließung) und 17 (Umstellung); andere Task-Felder bleiben über CRUD schreibbar |
| **D5** | Unvollständige Work (fehlender/leerer Titel) darf erledigt und wieder geöffnet werden; `actionable`/UI-Gültigkeit ist **kein** Autorisierungsprädikat | Kein Titel-, `validity`- oder `actionable`-Prädikat im Command; Test Pflicht (Abschnitt 22) |
| **D6** | Der Abschlusszeitpunkt ist serverautoritativ; der Client liefert kein `done_date` | `done_date = now()` (Transaktionszeit) nur bei tatsächlicher Transition (Abschnitt 8) |

---

## 4. Command-Oberfläche (Application Layer)

### 4.1 Öffentliche Commands (CONTRACT)

| | `completeWorkItem` | `reopenWorkItem` |
|---|---|---|
| Work-Command | `work.complete` | `work.reopen` |
| Transition | `open → done` | `done → open` |
| Operation-Katalog | `work.complete` | `work.reopen` |
| Idempotenz-Scope (Server) | `work.complete` | `work.reopen` |
| RPC (einzige Stelle, die ihn kennt: der Supabase-Adapter) | `public.complete_work_item` | `public.reopen_work_item` |
| Audit bei Transition | genau ein `task.completed` | genau ein `task.reopened` |

Beide Commands sind **absichtsspezifisch**. Es gibt **keinen** generischen „Status setzen"-Command, **kein** `toggle`, **keinen** Zielzustand als Parameter.

### 4.2 Eingabe (CONTRACT)

```ts
type WorkCommandTarget =
  | { workId: WorkId }                        // Work-native Konsumenten (Arbeitskorb, MCP)
  | { carrier: "task"; carrierId: number };   // Träger-native Legacy-Konsumenten (Task.tsx)

type WorkLifecycleCommandInput = {
  target: WorkCommandTarget;
  /** Pflicht. Eine UUID je Benutzerabsicht; ein Retry derselben Absicht verwendet denselben Schlüssel. */
  idempotencyKey: string;
  /** Optional, nur Korrelation dieses Versuchs ([`23`] §2.1, Falle 38). Nie Identität, nie Idempotenz. */
  operationId?: string;
};
```

Eingaberegeln (vor jedem Netzwerkaufruf geprüft; Verstoß ⇒ `invalid_request`, **kein** Request):

- `target` hat **genau** eine der beiden Formen. `workId` ist eine UUID-Zeichenkette; `carrierId` ist eine sichere ganze Zahl ≥ 0 (`0` ist gültig — [`03`](03-data-model-guardrails.md) §2.1, nullish statt truthy); `carrier` ist exakt `"task"`.
- `idempotencyKey` ist eine UUID-Zeichenkette und **Pflicht** (Begründung: Abschnitt 11.1).
- **Jedes andere Feld wird abgewiesen, nie ignoriert** — ausdrücklich u. a. `actorId`, `salesId`, `userId`, `completedBy`, `doneDate`, `done_date`, `doneAt`, `isDone`, `nextState`, `state`. Begründung wie bei `getWorkItems` ([`06`](06-decision-log.md) „Alpha Work 2" Punkt 2): ein still ignoriertes Feld ließe den Aufrufer glauben, er habe Actor, Zeitpunkt oder Richtung bestimmt.

### 4.3 Ergebnis (CONTRACT)

```ts
type WorkLifecycleCommandResult = {
  workId: WorkId;                       // kanonische Work-Identität des Ziels (immer gesetzt, auch bei carrierId-Eingabe)
  state: "done" | "open";               // complete ⇒ immer "done"; reopen ⇒ immer "open"
  doneAt: string | null;                // Server-timestamptz wörtlich (nie über JS-Date interpretiert); "done" ⇒ gesetzt, "open" ⇒ null
  transition: "applied" | "unchanged";  // hat dieser Command den Zustand tatsächlich geändert?
  disposition: "executed" | "replayed"; // Ausführungsdisposition nach [`23`] §3 — wurde in diesem Request ausgeführt?
};
```

Bedeutung und Abgrenzung: Abschnitt 13. Das Ergebnis ist **bewusst minimal** — kein Task-Objekt, kein Work-Item; die Lesewahrheit bleibt das Work Read Model (Abschnitt 18).

### 4.4 Fehler (CONTRACT)

`WorkCommandError` mit geschlossenem `reason`, optionalem `code` (kanonischer `NoraErrorCode` ausschließlich aus dem `DETAIL` des Servers) und `normalized` (bestehende Transportklassifikation über `normalizeCrmError`). Vollständige Taxonomie: Abschnitt 14. **Ein Fehler ist nie ein Erfolg mit `unchanged`**, und ein `unchanged` ist nie ein Fehler.

### 4.5 Port und Schichtung (CONTRACT)

```text
Konsument → completeWorkItem / reopenWorkItem (Application Command)
          → WorkLifecycleCommands (Port, vom konfigurierten Data Provider erfüllt)
          → Supabase: Adapter + Operation Wrapper → RPC
            FakeRest: Demo-Simulation (Abschnitt 20)
```

- Konsumenten rufen **nur** die Application Commands auf, nie den Port und nie den RPC.
- Der Supabase-Adapter ist die **einzige** Stelle, die RPC-Namen, Parameter (`p_work_id`, `p_task_id`, `p_idempotency_key`) und den jsonb-Umschlag kennt — Präzedenz `workItemsRpcAdapter.ts`.
- Der Operation Wrapper folgt `executeCreateQuickCaptureTask.ts`: `manager.execute(OPERATION_CATALOG["work.complete" | "work.reopen"], …)`, Header `x-nora-operation-id` am RPC-Aufruf, `_meta.disposition` über `extractRpcDisposition`. Der Katalog erhält genau zwei neue Einträge (`resourceType: "tasks"`).
- **Kein** Command-Bus, **kein** generisches Command-Framework, **kein** zweites Operation-Vokabular.

**IMPLEMENTATION CHOICE:** Dateinamen und -orte (Vorschlag: `application/commands/workLifecycle.ts`, `providers/supabase/workLifecycleRpcAdapter.ts`, `operations/executeWorkLifecycleCommand.ts`), interne Hilfsfunktionen, Testdateinamen.

---

## 5. Identität

**FACT.** Die Work-Identität `work_id = nora_entity_uuid('task', id)` ist deterministisch, aber nicht umkehrbar; das Work-DTO trägt keine Träger-ID (F-3). Der einzige Work-3-Konsument (die Task-Checkbox) kennt dagegen nur `task.id`.

**CONTRACT.**

1. Die **kanonische Zielidentität** jedes Commands ist `work_id`. Beide Eingabeformen werden **serverseitig** darauf abgebildet:
   - `{ workId }` → `v_work_id := p_work_id`
   - `{ carrier: "task", carrierId }` → `v_work_id := public.nora_entity_uuid('task', p_task_id)`
2. Der Client **berechnet nie** eine `work_id` (keine UUIDv5-Nachbildung im Browser) und liest nie eine `task.id` aus einem Work-Item heraus. Jede Form wird so gesendet, wie der Konsument sie besitzt.
3. Der Server löst die Trägerzeile auf und sperrt sie in **einem** Schritt (Abschnitt 9, Schritt 6): für die `carrierId`-Form über `public.tasks.id`, für die `workId`-Form über `public.nora_entity_uuid('task', t.id) = v_work_id`. Beide Wege sind äquivalent, weil `nora_entity_uuid` je `id` eindeutig ist.
4. Wird keine Zeile gefunden (nie existiert, inzwischen gelöscht — auch über die stillen Löschpfade aus [`17`](17-known-issues-and-planned-waves.md) G.7), endet der Command in `not_found` (Abschnitt 14) — **kein** stiller Erfolg.
5. **Keine** neue Tabelle, **keine** `work_items`-Persistenz, **keine** neue Spalte, **keine** Abbildungstabelle ([`25`](25-universal-work-model.md) D-1/D-51).
6. `work_id` ist **kein Autorisierungstoken** ([`25`](25-universal-work-model.md) §21.3) — die Autorisierung (Abschnitt 6) gilt unabhängig davon, wie das Ziel benannt wurde.

**IMPLEMENTATION CHOICE.** Ein Ausdrucksindex auf `nora_entity_uuid('task', id)` wird in Work 3 **nicht** angelegt, solange kein Bedarf gemessen ist (Disziplin von [`25`](25-universal-work-model.md) D-53; die Funktion ist `IMMUTABLE` und damit später indexierbar). Die Auflösung über die Trägerzeile ist bei heutigem Bestand eine vernachlässigbare Sequenzsuche; wird sie messbar, ist ein Index eine eigene, begründete Änderung.

---

## 6. Actor und Autorisierung

**CONTRACT.**

- **Actor** = `nora_private.current_sales_id()` der aufrufenden Sitzung — und nichts sonst ([`25`](25-universal-work-model.md) D-26). Der RPC hat **keinen** Actor-Parameter; die Application-Eingabe hat **kein** Actor-Feld (Abschnitt 4.2). `nora_private.resolve_audit_actor()` und der GUC `nora.audit_actor_user_id` sind **keine** Work-Actor-Quelle ([`25`](25-universal-work-model.md) §21.2).
- **Autorisierung** wird **bei jeder Ausführung** im RPC-Körper geprüft, in dieser Reihenfolge und **vor** jeder Eingabe- oder Zielauswertung:
  1. `current_sales_id() IS NULL` (keine Sitzung, deaktiviert, tote Sitzung, unbekannter Benutzer) ⇒ `42501`, `DETAIL = NORA_PERMISSION_DENIED`.
  2. `NOT nora_private.can_write()` (Rolle `viewer`) ⇒ `42501`, `DETAIL = NORA_PERMISSION_DENIED`.
- **PO DECISION D2:** Kein weiteres Prädikat. Insbesondere **kein** `holder = Actor`, kein `sales_id IS NOT NULL`, kein Team-/Servicebereichs-, Vorgesetzten- oder Rollenhierarchie-Prädikat. Ein `office`-Benutzer darf die Aufgabe eines anderen Mitarbeiters, eine freie (`sales_id IS NULL`) und eine einem deaktivierten Mitarbeiter gehaltene Aufgabe erledigen und wieder öffnen.
- **PO DECISION D5:** Kein Titel-, `validity`- oder `actionable`-Prädikat.
- Diese Prüfung ist mindestens so streng wie die heutige Kombination aus `Tasks select active` (`is_active_user()`) und `Tasks update writers` (`can_write()`), weil `current_sales_id()` aktive Mitarbeiter mit lebender Sitzung verlangt und `can_write()` dieselbe Session-Bindung trägt (F-9, F-10). Der RPC umgeht RLS als `SECURITY DEFINER` (Abschnitt 15) und **ersetzt** sie deshalb ausdrücklich durch diese Körperprüfung.

**OUT OF SCOPE:** Holder als Autorisierung (Gate G-7), feinere Teams (G-8).

---

## 7. Transitionssemantik

**CONTRACT.** Der Server bestimmt den Ist-Zustand ausschließlich aus der **gesperrten** Trägerzeile (Abschnitt 9). Der Konsument sendet nie, was er für den Ist- oder Zielzustand hält.

| Command | Ist-Zustand (gesperrt gelesen) | Wirkung auf `done_date` | Audit | `state` | `doneAt` | `transition` |
|---|---|---|---|---|---|---|
| `work.complete` | `open` (`NULL`) | `:= now()` | genau ein `task.completed` | `done` | neuer Wert | `applied` |
| `work.complete` | `done` | **unverändert** — kein `UPDATE` | keins | `done` | **bestehender** Wert | `unchanged` |
| `work.reopen` | `done` | `:= NULL` | genau ein `task.reopened` | `open` | `null` | `applied` |
| `work.reopen` | `open` | **unverändert** — kein `UPDATE` | keins | `open` | `null` | `unchanged` |

Verbindlich:

- **PO DECISION D3, symmetrisch angewendet:** Gleicher Zielzustand ist **Erfolg ohne Mutation**. Es wird **kein** `UPDATE`-Statement abgesetzt — auch kein wirkungsloses `SET done_date = done_date` —, damit weder ein Trigger noch eine Zeilenversion entsteht.
- Ein bestehendes `done_date` wird **niemals** überschrieben, weil `complete` erneut angefordert wurde.
- Ein Wieder-Erledigen nach einem `reopen` ist eine **neue** Transition mit neuem Zeitpunkt — das ist eine neue Absicht (neuer Idempotenzschlüssel), kein Retry.
- **KNOWN LEGACY / Carrier Capability:** `reopen` verwirft den bisherigen Abschlusszeitpunkt auf dem Träger (es gibt keine zweite Spalte). Er bleibt als Zeitpunkt des `task.completed`-Audit-Ereignisses erhalten. Kein neues Feld in Work 3 ([`01`](01-domain-model.md): kein neues DB-Feld ohne belegten Bedarf).
- `cancel`, `defer`, `resume`, `claim`, `assign` werden **nicht** berührt; insbesondere bedeutet `done` weiterhin ausschließlich „erledigt" ([`25`](25-universal-work-model.md) §6.4).

---

## 8. Serverzeit

**CONTRACT (PO DECISION D6).**

- Bei `transition = applied` für `work.complete` gilt `done_date := now()` — PostgreSQLs **Transaktionsstartzeit** (`transaction_timestamp()`) der RPC-Transaktion. **Nicht** `clock_timestamp()`, **nicht** `statement_timestamp()`, **nie** ein vom Client gesendeter Wert. Eine PostgREST-RPC ist genau eine Transaktion.
- Prüfbare Folge: Im selben Aufruf erhält die `task.completed`-Zeile `audit_events.created_at = now()` derselben Transaktion; deshalb gilt **`tasks.done_date = audit_events.created_at`** des zugehörigen `task.completed` exakt (Test Pflicht).
- `doneAt` im Ergebnis ist der gespeicherte Wert, unverändert als Server-`timestamptz`-Zeichenkette übergeben und vom Konsumenten nicht interpretiert (Präzedenz `dueAt`, [`25`](25-universal-work-model.md) §21.6).
- Bei `unchanged` wird der **bestehende** Wert gemeldet und nicht verändert; bei `replayed` wird das **ursprünglich gespeicherte** Ergebnis gemeldet (Abschnitt 11) — in keinem dieser Fälle entsteht ein neuer Zeitstempel.
- Der Zeitpunkt ist ein absoluter Zeitpunkt (`timestamptz`); seine Darstellung in `Europe/Berlin` ist Präsentation ([`26`](26-arbeitskorb-ui-contract.md) §3), keine Command-Semantik.
- **Bewusst akzeptiert:** wartet ein Command auf eine Zeilensperre, liegt `now()` vor dem Commit. Das ist die Semantik „Transaktionszeit" und keine Ungenauigkeit des Contracts.

**KNOWN LEGACY:** `isRecentlyDone` (`tasksPredicate.ts`) vergleicht `done_date` mit der Browseruhr (5-Minuten-Fenster für die Anzeige kürzlich erledigter Aufgaben). Das bleibt reine Präsentation und wird durch Work 3 nicht autoritativ; eine abweichende Geräteuhr verschiebt nur dieses Anzeigefenster.

---

## 9. Atomarität und Ablauf im RPC

**CONTRACT.** Jeder der beiden RPCs ist **eine** Transaktion mit genau dieser Schrittfolge:

| # | Schritt | Fehler ⇒ |
|---|---|---|
| 1 | `v_actor := nora_private.current_sales_id()`; `NULL` | `42501` / `NORA_PERMISSION_DENIED` |
| 2 | `NOT nora_private.can_write()` | `42501` / `NORA_PERMISSION_DENIED` |
| 3 | Eingabe prüfen: genau eines von `p_work_id`/`p_task_id` gesetzt; `p_idempotency_key` gesetzt | `22023` (ohne Nora-`DETAIL`, Präzedenz `create_quick_capture_task`) |
| 4 | `v_work_id` kanonisch bestimmen (Abschnitt 5); Fingerprint := Hash über **ausschließlich** `{ "work_id": v_work_id }` | — |
| 5 | `nora_private.idempotency_check('work.complete' \| 'work.reopen', p_idempotency_key, fingerprint)`; Treffer ⇒ gespeichertes Ergebnis mit `_meta.disposition = "replayed"` zurückgeben, **sonst nichts tun** | `23505` / `NORA_IDEMPOTENCY_CONFLICT` |
| 6 | Trägerzeile auflösen **und** mit `SELECT … FOR UPDATE` sperren; den Ist-Zustand aus dieser gesperrten Zeile lesen | keine Zeile ⇒ `DETAIL = NORA_WORK_ITEM_NOT_FOUND` |
| 7 | Gemäß Abschnitt 7 entweder **ein** `UPDATE public.tasks SET done_date = … WHERE id = <gesperrte id>` (Audit entsteht durch den bestehenden Trigger in derselben Transaktion) **oder** kein Statement | Fehler aus Trigger/Audit ⇒ ganze Transaktion bricht ab |
| 8 | Ergebnis bilden (`work_id`, `state`, `done_at`, `transition`, `_meta.disposition = "executed"`) und über `nora_private.idempotency_persist(…)` in **derselben** Transaktion speichern | — |
| 9 | Ergebnis zurückgeben | — |

Daraus folgt (**CONTRACT**):

- **Keine Mutation ohne Audit, kein Audit ohne Mutation:** das Audit-Ereignis entsteht ausschließlich durch den `AFTER UPDATE`-Trigger auf genau der Mutation; scheitert der Audit-Schreibvorgang, rollt die ganze Transaktion zurück. Der RPC **schreibt kein eigenes** Audit-Ereignis.
- **Keine Teil-Idempotenz:** der Idempotenzdatensatz wird in derselben Transaktion wie die Mutation geschrieben; ein abgebrochener Versuch hinterlässt weder Mutation noch Datensatz — der Schlüssel bleibt frei wiederholbar ([`23`](23-operations-errors-feedback.md) §3.2).
- Der RPC-Körper **DARF NICHT** Ausnahmen um Schritt 6–8 abfangen und in einen Erfolg umdeuten (kein `exception when others` um die Mutation).
- Auch ein `unchanged`-Ergebnis wird in Schritt 8 persistiert — ein Retry derselben Absicht erhält dann dasselbe `unchanged` als `replayed`.
- Die GUC-Hintertür `nora.skip_task_context_check` wird **nie** gesetzt ([`25`](25-universal-work-model.md) D-50); sie ist für ein `done_date`-only-`UPDATE` ohnehin wirkungslos (F-12).

**IMPLEMENTATION CHOICE:** der konkrete Fingerprint-Hash (Präzedenz `md5(jsonb_build_object(...)::text)`), der SQLSTATE des Not-found-Fehlers (Vorschlag `P0002`; identitätsstiftend ist allein der `DETAIL`), die Formulierung der Exception-Nachrichten (nie kanonisch).

---

## 10. Concurrency

**FACT.** `tasks` hat weder Version noch `updated_at`; rohes CRUD ist heute Last-Writer-Wins (F-1, F-4).

**CONTRACT.** Koordination ausschließlich über **Zeilensperre + erneutes Lesen** in der Command-Transaktion (Schritt 6) unter `READ COMMITTED` — dasselbe Muster, das Nora für zustandssensitive Transitionen etabliert hat ([`25`](25-universal-work-model.md) §11 Claim-Invariante; [`03`](03-data-model-guardrails.md) §3). `SELECT … FOR UPDATE` wartet auf eine konkurrierende Transaktion und liest danach die **zuletzt committete** Version. **Keine** Versionsspalte, **kein** Advisory Lock auf der Aufgabe, **keine** neue Infrastruktur.

| # | Szenario | Determinierter Ausgang |
|---|---|---|
| C-1 | zwei gleichzeitige `complete` (verschiedene Schlüssel) auf offener Aufgabe | der Erste: `applied`, setzt `done_date = T1`, ein `task.completed`; der Zweite wartet, liest `done`, `unchanged`, meldet `doneAt = T1`. **Genau ein** `task.completed`, `T1` wird nie überschrieben |
| C-2 | zwei gleichzeitige `reopen` (verschiedene Schlüssel) auf erledigter Aufgabe | der Erste `applied` (ein `task.reopened`), der Zweite `unchanged` |
| C-3 | `complete`, danach Retry mit **demselben** Schlüssel | `replayed` mit dem gespeicherten Ergebnis; keine zweite Ausführung, kein zweites Audit (Abschnitt 11) |
| C-4 | `reopen`, danach Retry mit demselben Schlüssel | wie C-3 |
| C-5 | `complete` und `reopen` gleichzeitig | die Sperre serialisiert sie. Reihenfolge complete→reopen auf offener Aufgabe: beide `applied`, Endzustand `open`, ein `task.completed` und ein `task.reopened`. Reihenfolge reopen→complete: `reopen` `unchanged`, `complete` `applied`, Endzustand `done`. Jeder Command meldet wahrheitsgemäß, was **er** getan hat; kein Zeitstempel wird verfälscht |
| C-6 | Absicht auf Basis eines veralteten UI-Zustands (UI zeigt offen, Server hat erledigt — oder umgekehrt) | der Command wirkt gegen den **Server**-Zustand: `unchanged` mit dem tatsächlichen Zustand; die UI liest danach neu (Abschnitt 18). Kein Fehler, keine stille Überschreibung |
| C-7 | gleichzeitiger Doppelklick mit **demselben** Schlüssel | `idempotency_check` serialisiert über den Advisory-Xact-Lock je `(command, key)`; der Zweite sieht nach dem Commit des Ersten dessen Datensatz ⇒ `replayed` |
| C-8 | `complete` gleichzeitig mit einer Legacy-Feldänderung (Titel, Fälligkeit, Halter) über CRUD | beide sperren dieselbe Zeile und serialisieren; keine Änderung geht verloren, weil der Command nur `done_date` schreibt und das CRUD nur geänderte Felder (F-5) |

**Sperrreihenfolge (CONTRACT):** immer erst der Idempotenz-Advisory-Lock (Schritt 5), dann die Zeilensperre (Schritt 6). Kein Pfad nimmt sie umgekehrt; damit entsteht kein Sperrzyklus zwischen Commands. Ein Konflikt-/Stale-Fehlercode ist **nicht** nötig und wird **nicht** eingeführt (Abschnitt 14).

---

## 11. Idempotenz

### 11.1 Schlüssel ist Pflicht

**CONTRACT.** `p_idempotency_key` ist bei beiden RPCs **Pflicht** (abweichend von den älteren Commands, deren Schlüssel optional ist). Begründung: beide Commands sind die zwei Richtungen **eines** Lifecycles. Ohne Schlüssel ist ein Retry nach einer zwischenzeitlichen Gegentransition von einer neuen Absicht nicht unterscheidbar — ein verlorenes Antwortpaket plus ein fremdes `reopen` würde aus einem Retry eine **neue** Erledigung machen. Mit Pflichtschlüssel ist die Ausführungsdisposition außerdem immer definiert ([`23`](23-operations-errors-feedback.md) §3.1).

### 11.2 Bestehende Primitive, bestehende Konventionen

- Scope: `(command, idempotency_key, actor)` mit `command ∈ {'work.complete', 'work.reopen'}` und `actor = safe_auth_uid()` — **unverändert** die Primitive aus F-13. Kein neues Idempotenz-System, keine neue Tabelle.
- Fingerprint: **Allowlist**, ausschließlich die kanonische Zielidentität `work_id` ([`25`](25-universal-work-model.md) §18.2). Die Eingabeform (`workId` oder `carrierId`) geht **nicht** ein — dieselbe Absicht über beide Formen ist derselbe Fingerprint.
- `operation_id` ≠ `idempotency_key` ([`23`](23-operations-errors-feedback.md) §2.3): der Schlüssel reist als RPC-Parameter, die `operation_id` als Header.

### 11.3 Retry vs. neue Absicht

| Situation | Schlüssel | Ergebnis |
|---|---|---|
| Transport-Retry (Antwort verloren, Benutzer wiederholt **dieselbe** fehlgeschlagene Aktion, Operation-Retry) | **derselbe** | `replayed`: das gespeicherte Ergebnis; keine Ausführung, kein Audit |
| neue bewusste Benutzerabsicht (neuer Klick auf die Checkbox, neuer MCP-Aufruf) | **neu** | wird gegen den aktuellen Zustand ausgeführt |
| derselbe Schlüssel, anderes Ziel (`work_id`) | derselbe | `NORA_IDEMPOTENCY_CONFLICT` |
| derselbe Schlüssel für `complete` und `reopen` | derselbe | zwei unabhängige Scopes (Präzedenz Quick Capture); fachlich bedeutungslos, aber kein Fehler — Konsumenten minten je Absicht einen neuen Schlüssel |
| Versuch scheiterte vor dem Commit | derselbe | Scope ist nicht committet ⇒ frei wiederholbar, führt normal aus |

**Wer mintet den Schlüssel (CONTRACT):** die Schicht, die die **Benutzerabsicht** besitzt — für die Task-Checkbox der Klick-Handler, **einmal pro Klick**; eine ausdrückliche „Erneut versuchen"-Aktion für **dieselbe** fehlgeschlagene Operation verwendet denselben Schlüssel. Der Adapter, der Transport und der Operation Manager minten **nie** einen Idempotenzschlüssel.

### 11.4 Kernfall: Retry nach zwischenzeitlicher Gegentransition (TRAP 4)

```text
t0  A: complete(K1)        → applied, done_date = T1, task.completed      [Antwort geht verloren]
t1  B: reopen(K2)          → applied, done_date = NULL, task.reopened
t2  A: complete(K1) Retry  → idempotency_check findet (work.complete, K1, A) mit gleichem Fingerprint
                           → replayed, Ergebnis von t0: { state: done, doneAt: T1, transition: applied }
                           → KEIN UPDATE, KEIN task.completed — die Aufgabe bleibt offen
t3  A liest neu (Abschnitt 18) → Work Read Model zeigt die Aufgabe offen
```

**CONTRACT:** Ein `replayed`-Ergebnis beschreibt die **ursprüngliche Ausführung**, nicht den aktuellen Zustand. Ein Konsument **DARF NICHT** `state`/`doneAt` eines `replayed`-Ergebnisses als aktuelle Wahrheit anzeigen; er liest nach jedem Command neu (Abschnitt 18). Will der Benutzer die Aufgabe nun erneut erledigen, ist das eine **neue** Absicht mit **neuem** Schlüssel.

**KNOWN LEGACY / Planungsnotiz:** `nora_private.idempotency_records` hat keine Retention-Policy. Work 3 erzeugt **einen** Datensatz je Lifecycle-Command — mehr Zeilen als die bisherigen Commands, bei vier Mitarbeitern unkritisch. Eine Retention ist **nicht** Teil von Work 3 ([`17`](17-known-issues-and-planned-waves.md) G.7).

---

## 12. Audit und Korrelation

**CONTRACT** — kein zweites Audit-System, keine neuen Ereignistypen:

| Fall | Audit |
|---|---|
| `complete` mit `transition = applied` | **genau ein** `task.completed` |
| `reopen` mit `transition = applied` | **genau ein** `task.reopened` |
| `unchanged` (beide Commands) | **kein** Ereignis — auch kein `task.updated` |
| `replayed` | **kein** Ereignis |
| abgewiesener Command (Fehler) | **kein** Ereignis |

- **Vokabularentscheidung** ([`25`](25-universal-work-model.md) §18.1, „vor der ersten Transition"): Work 3 verwendet die **bestehenden** Ereignisse `task.completed` / `task.reopened`. Sie bezeichnen exakt die beiden Transitionen; ein neuer Typ (`work.*` im Audit) wäre eine zweite Bezeichnung desselben Fakts. Das Namensprinzip „Commands `work.*`, Audit `task.*`" (D-47) bleibt. D-48 (neue Audit-Ereignistypen) bleibt für die übrigen G-4-Commands offen.
- **Audit-Actor:** die Sitzung des Aufrufers — über den bestehenden Pfad `write_audit_event` → `resolve_audit_actor()` → `safe_auth_uid()`, der die PostgREST-Sitzungs-GUCs liest; `SECURITY DEFINER` ändert diese GUCs nicht (F-11). Erwartet: `actor_id` = Auth-UUID des Aufrufers, `actor_sales_id` = `current_sales_id()` des Aufrufers, `actor_role_snapshot` = seine Rolle. **Nie** `System`, nie `NULL`, nie der Funktions-Owner. Der Executor-/`service_role`-Pfad von `resolve_audit_actor()` ist aus dem Command unerreichbar, weil Schritt 1 eine echte Sitzung verlangt.
- **Korrelation:** `audit_events.request_id` = die `operation_id` des Versuchs (Header `x-nora-operation-id`, über `current_operation_id()`) — bestehender Mechanismus ([`13`](13-crm-audit-retention.md), [`23`](23-operations-errors-feedback.md) §2.2). Ein `replayed`-Versuch hat **keine** eigene Audit-Zeile; seine `operation_id` korreliert nur im Operation Manager.
- Das Audit-Ereignis trägt **keinen** Diff (Bestand: `p_changes` nur für `task.updated`); der Abschlusszeitpunkt ist `created_at` des Ereignisses (Abschnitt 8).

---

## 13. Ergebnis und Disposition

**CONTRACT.** Zwei **orthogonale** Fragen, zwei Felder — weil [`23`](23-operations-errors-feedback.md) §3.1 die Ausführungsdisposition auf genau `executed | replayed` festlegt und ein dritter Wert („noop") diesen Vertrag bräche:

| Feld | Frage | Werte |
|---|---|---|
| `disposition` | Wurde der Command **in diesem Request** ausgeführt? | `executed` · `replayed` |
| `transition` | Hat die (ursprüngliche) Ausführung den Lifecycle-Zustand **geändert**? | `applied` · `unchanged` |

| Kombination | Bedeutung |
|---|---|
| `executed` + `applied` | in diesem Request ausgeführt, Zustand geändert, ein Audit-Ereignis |
| `executed` + `unchanged` | in diesem Request ausgeführt, Ziel war schon im Zielzustand (D3) |
| `replayed` + `applied` / `unchanged` | früheres Ergebnis derselben Absicht; **nichts** wurde jetzt ausgeführt; Werte beschreiben die ursprüngliche Ausführung |

- **RPC-Umschlag (CONTRACT):** `{ "work_id": uuid, "state": "done"|"open", "done_at": timestamptz|null, "transition": "applied"|"unchanged", "_meta": { "disposition": "executed"|"replayed" } }`. `_meta` ist Transportmetadatum ([`23`](23-operations-errors-feedback.md) §3.3); persistiert wird `executed`, `replayed` wird requestbezogen angefügt (Präzedenz F-14).
- **Validierung im Adapter (CONTRACT):** fehlt ein Feld, liegt ein Wert außerhalb seines geschlossenen Vokabulars, widerspricht `state` dem Command (complete ⇒ `done`, reopen ⇒ `open`), widerspricht `done_at` dem Zustand (`done` ⇒ nichtleere Zeichenkette, `open` ⇒ `null`), fehlt die Disposition, oder weicht `work_id` bei `workId`-Eingabe vom angefragten Ziel ab ⇒ `malformed_response`. Zusätzliche, unbekannte Felder werden ignoriert und nie weitergereicht (Toleranzregel aus Alpha Work 2).
- Das Ergebnis ist **keine** Lesewahrheit: es sagt, was der Command getan hat. Was jetzt gilt, sagt das Work Read Model.

---

## 14. Fehlervertrag

**CONTRACT.** `WorkCommandError.reason` ist geschlossen. Konsumenten verzweigen auf `reason` und ggf. `code`, **nie** auf `message`, Status oder SQLSTATE ([`03`](03-data-model-guardrails.md) §6).

| `reason` | Server-/Transportsignal | `code` | Zustand nach dem Fehler |
|---|---|---|---|
| `invalid_request` | Eingabe client-seitig abgewiesen (kein Request), oder Server `22023` | `null` | **sicher unverändert** |
| `permission_denied` | `42501` + `DETAIL = NORA_PERMISSION_DENIED` (kein Actor, deaktiviert, tote Sitzung, `viewer`); `42501` ohne `DETAIL` (z. B. `anon` ohne `EXECUTE`); HTTP 401 / abgelaufenes JWT. **Nicht authentifiziert ist bewusst kein eigener Grund** — wie bei der Work-Lesefläche ([`25`](25-universal-work-model.md) §21.2); die globale Sitzungsbehandlung bleibt beim Auth Provider, `normalized` behält die Transportklasse | `NORA_PERMISSION_DENIED` oder `null` | **sicher unverändert** |
| `not_found` | `DETAIL = NORA_WORK_ITEM_NOT_FOUND` | `NORA_WORK_ITEM_NOT_FOUND` | **sicher unverändert** |
| `idempotency_conflict` | `23505` + `DETAIL = NORA_IDEMPOTENCY_CONFLICT` | `NORA_IDEMPOTENCY_CONFLICT` | **sicher unverändert** (Programmierfehler des Aufrufers: Schlüssel für ein anderes Ziel wiederverwendet) |
| `malformed_response` | Antwort außerhalb des Umschlags (Abschnitt 13) | `null` | **unbekannt** — Command kann committet sein |
| `failed` | alles andere: Netzwerk, Zeitüberschreitung, 5xx, unerwarteter Serverfehler | `DETAIL`-Code, falls vorhanden, sonst `null` | **unbekannt** — Command kann committet sein |

Verbindlich:

- **Genau ein neuer `NoraErrorCode`:** `NORA_WORK_ITEM_NOT_FOUND` (Kategorie `not_found`, eigener i18n-`messageKey`). Er hat mit Work 3 einen echten, belegten Ursprung (Abschnitt 9, Schritt 6) und erfüllt damit die Regel aus `domain/noraErrorCodes.ts` („nur bei realem, belegtem Ursprung"). Er wird nicht aus SQLSTATE abgeleitet.
- **Kein** Stale-/Precondition-/Konfliktcode für Lifecycle-Zustände: mit D3 ist „schon im Zielzustand" ein Erfolg (`unchanged`), kein Fehler. Kein `NORA_WORK_STATE_CHANGED`, kein `unavailable`-Grund (die Demo simuliert, Abschnitt 20), **kein** `retryable`-Feld ([`23`](23-operations-errors-feedback.md) §5.4).
- Bei **unbekanntem** Ausgang (`failed`, `malformed_response`) liest der Konsument neu; ein Retry **mit demselben Schlüssel** ist sicher (Abschnitt 11).
- Ein Fehler ist **nie** ein `unchanged`-Erfolg und umgekehrt.

---

## 15. Security- und RPC-Vertrag

**CONTRACT.** Beide RPCs sind **`SECURITY DEFINER`**, Owner `postgres`, `search_path = ''`, vollständig schemaqualifiziert, `VOLATILE`, in `public` (PostgREST-Exposure, [`22`](22-security-and-access.md) §6.1).

**Warum `DEFINER` (eingefroren, nicht Implementierungsfreiheit):** Nach der Schließung (Abschnitt 16) hält `authenticated` kein `UPDATE` auf `done_date` mehr. Ein `SECURITY INVOKER`-RPC liefe als `authenticated` und könnte die geschützte Spalte nicht schreiben; die Schließung und der Command wären unvereinbar. `DEFINER` mit Owner `postgres` ist zugleich die etablierte Nora-Command-Präzedenz (F-14) und erfüllt [`22`](22-security-and-access.md) §7.2. Eine eigene Capability-Rolle nur für `UPDATE (done_date)` (Präzedenz `nora_identity_manager`) wäre möglich, bringt aber neue Rolle, neue RLS-Policies für diese Rolle und neue Grants ohne zusätzlichen Schutz gegenüber der Körperprüfung — sie wird **nicht** gewählt. Die W-A-Entscheidung D-57 (`INVOKER` für die **Lese**-Query) bleibt unberührt: dort war kein geschütztes Recht nötig.

**Nicht verhandelbare Invarianten (CONTRACT):**

1. Autorisierung im Körper vor allem anderen (Abschnitt 6, 9) — der RPC ersetzt bewusst die RLS, die er als Owner umgeht.
2. Signatur exakt `(p_work_id uuid, p_task_id bigint, p_idempotency_key uuid)` — **kein** Parameter für Actor, Zielzustand, Zeitstempel, Spaltenwerte oder generische Zeilenmutation. Ein zusätzliches Argument (z. B. `p_actor_sales_id`, `p_done_date`) existiert nicht und wird von PostgREST als unbekannte Funktion abgewiesen.
3. Der RPC schreibt **ausschließlich** `public.tasks.done_date` der einen gesperrten Zeile und `nora_private.idempotency_records` (über die Primitive). Keine andere Spalte, keine andere Zeile, keine andere Tabelle.
4. Grants: `revoke all on function … from public, anon, authenticated, service_role`, danach **genau ein** `grant execute … to authenticated` ([`22`](22-security-and-access.md) §6.3). **Kein** `service_role` (kein deployter Backend-Aufrufer).
5. Actor nur über `current_sales_id()`; `resolve_audit_actor()`/`nora.audit_actor_user_id` werden im Command nie gelesen (das Audit nutzt sie unverändert über den Trigger, Abschnitt 12).
6. Keine GUC-Hintertür, kein `set role`, kein `set local` im Körper.
7. Neue Prüfung durch die Security-Review: `has_function_privilege` für `anon`, `authenticated`, `service_role`, `PUBLIC` gegen die Datenbank, nie gegen `06_grants.sql` ([`22`](22-security-and-access.md) §6.2).

**Einordnung TRAP 8 (DEFINER umgeht Prüfungen):** Die Umgehung ist gewollt und begrenzt — sie betrifft nur RLS und das Spaltenrecht für **diese eine** Mutation; Rolle, Sitzung und Actor werden im Körper erneut und mindestens so streng geprüft wie bisher (Abschnitt 6).

---

## 16. Exklusive Autorität: Schließung des rohen `done_date`-Schreibrechts

### 16.1 Was „exklusive Autorität" heißt (CONTRACT)

> Nach Work 3 ändert **keine normale Anwendungs-Rolle** (`anon`, `authenticated` — also Browser, PostgREST-Client, MCP- oder Automations-Kanal unter `authenticated`) `public.tasks.done_date` einer **bestehenden** Zeile anders als über `work.complete` / `work.reopen`.

Administrative Zugänge bleiben bestehen und sind **kein** Bypass im Sinne dieses Contracts: der Datenbank-Owner `postgres` (Migrationen, die `DEFINER`-RPCs selbst, SQL-Testsuiten) und `service_role` (kein deployter Aufrufer schreibt damit Aufgaben). Für beide gilt die **normative** Regel aus Abschnitt 21: kein Anwendungskonsument benutzt sie für Lifecycle-Änderungen.

### 16.2 Mechanismus: spaltenbezogenes `UPDATE`-Recht (CONTRACT)

```sql
-- Zielzustand (Schließungsmigration; Wortlaut ist IMPLEMENTATION CHOICE, die Rechtelage ist CONTRACT)
revoke update on table public.tasks from authenticated;
grant update (text, type, due_date, sales_id, company_id, contact_id) on table public.tasks to authenticated;
```

| Rolle / Pfad | `done_date` ändern | übrige Spalten ändern | Anlegen (`INSERT`) |
|---|---|---|---|
| `authenticated` über PostgREST `PATCH /tasks` | **verweigert** (`42501`, vor jedem Trigger) | erlaubt wie heute (RLS `can_write()` unverändert) | unverändert erlaubt (Abschnitt 19) |
| `authenticated` über Upsert (`POST … Prefer: resolution=merge-duplicates`) mit `done_date` im Körper | **verweigert** — das Spaltenrecht des `ON CONFLICT DO UPDATE`-Zweigs wird für das ganze Statement geprüft, auch wenn kein Konflikt eintritt | wie oben | wie oben |
| `authenticated` über `complete_work_item` / `reopen_work_item` | **ja — der einzige Weg** | — | — |
| `anon` | kein Tabellenrecht (unverändert) | — | — |
| `service_role` | Tabellenrecht `UPDATE` **unverändert** — administrativ, kein Anwendungspfad | unverändert | unverändert |
| `postgres` (Owner, Migrationen, `DEFINER`-RPCs) | uneingeschränkt | uneingeschränkt | uneingeschränkt |
| `id` | nicht im Spaltenrecht — bleibt für `authenticated` unveränderbar (der Adapter entfernt den Primärschlüssel ohnehin, F-5) | | |

**Warum dieser Mechanismus (Abwägung):**

- **Spaltenrecht** ist deklarativ, eine Grant-Zeile statt einer Funktion, greift vor jedem Trigger, deckt `PATCH` **und** Upsert ab, ist gegen die Datenbank prüfbar (`has_column_privilege`) und hat eine Repository-Präzedenz (F-16). Er ist **wertblind**: auch ein `PATCH`, das `done_date` mit unverändertem Wert mitsendet, wird abgewiesen. Das ist hier unschädlich, weil der generische Update-Pfad nur geänderte Felder sendet (F-5), und wird durch Tests abgesichert (Abschnitt 22).
- **Trigger-Wächter** (`current_user`-Prüfung, Präzedenz `prevent_sales_privilege_escalation`) wäre wertsensitiv, ist aber prozedural, muss jeden künftigen privilegierten Pfad kennen und lässt den Fehler erst nach der Rechteprüfung entstehen. **Nicht gewählt.**
- RLS kann einzelne Spalten nicht schützen. Eine Versionsspalte schützt keine Autorität. **Nicht gewählt.**

**Folgen, die die Implementierung tragen MUSS:**

- **Neue `tasks`-Spalten** (etwa aus G-1) sind für `authenticated` erst nach einem **ausdrücklichen** Spalten-Grant schreibbar — fail-closed. Jede künftige Migration, die `tasks` erweitert, entscheidet das bewusst; das wird als Migrationsregel in der Work-3-Dokumentationsschließung festgehalten.
- `supabase/tests/public_privilege_hardening_verification.sql` wird von der Tabellenebene (`SELECT,INSERT,UPDATE,DELETE`) auf **Tabelle `SELECT,INSERT,DELETE` + Spalten-`UPDATE` ohne `done_date`** umgestellt; `supabase/schemas/06_grants.sql` spiegelt den Zielzustand.
- Die Policy `Tasks update writers` bleibt **unverändert** (Policy und Spaltenrecht gehören zusammen, [`22`](22-security-and-access.md) §6.2: die Policy bleibt lebendig für die übrigen Spalten).

### 16.3 Auslieferungsreihenfolge (CONTRACT)

Die Schließung bricht jeden noch laufenden Client, der `done_date` roh schreibt. Deshalb **drei** Schritte, nicht einer:

1. **R1 — additive Migration:** beide RPCs samt Grants. Nichts wird entzogen; alte Clients funktionieren weiter.
2. **R2 — Frontend-Release:** die Checkbox nutzt die Commands (Abschnitt 17); Production-Smoke mit echter Mitarbeiter-Sitzung (complete **und** reopen, Audit-Zeilen geprüft).
3. **R3 — Schließungsmigration:** Spaltenrecht gemäß 16.2. Danach Production-Beweis: `has_column_privilege('authenticated', 'public.tasks', 'done_date', 'UPDATE') = false`, `… 'text', 'UPDATE') = true` (ebenso `type`, `due_date`, `sales_id`, `company_id`, `contact_id`), `has_table_privilege('authenticated', 'public.tasks', 'UPDATE') = false`.

**Work 3 ist erst mit R3 abgeschlossen.** Zwischen R1 und R3 besteht die Legacy-Autorität bewusst weiter (KNOWN LEGACY). Ein nach R3 noch laufender veralteter Client (alter Service-Worker-Stand, offener Tab) erhält beim Abhaken einen **sichtbaren** Berechtigungsfehler und ändert nichts — fail-closed, keine Datenverfälschung; der PWA-Update-Lifecycle ([`24`](24-pwa-and-update-lifecycle.md)) löst das. Rückweg von R3 ist ein erneutes Tabellen-`UPDATE`-Grant — das öffnet den Bypass wieder und ist nur als Notfall-Rollback zulässig.

---

## 17. Migration der Legacy-Checkbox (`Task.tsx`)

**CONTRACT** (keine React-Änderung in diesem Dokument; hier steht nur die Grenze):

1. Checkbox und mobiler Zeilen-Tipp bleiben **sichtbar und funktional** wie heute (Darstellung unverändert, sofern nicht separat entschieden).
2. Ein Wechsel **zu** „erledigt" ruft `completeWorkItem` mit `{ carrier: "task", carrierId: task.id }` auf, ein Wechsel **zu** „offen" `reopenWorkItem`. Welche Absicht gemeint ist, leitet der Handler aus dem **angezeigten** Zustand ab — das ist eine Benutzerabsicht, keine Geschäftsregel; ist die Anzeige veraltet, antwortet der Server mit `unchanged` (Abschnitt 10, C-6).
3. **Kein** browsergenerierter Zeitstempel, **kein** `update("tasks", { done_date })`, **kein** `useUpdate` für den Lifecycle. Die übrigen Aktionen (Bearbeiten, „Morgen", „Nächste Woche", Löschen) bleiben auf generischem CRUD.
4. Je Klick ein **neuer** Idempotenzschlüssel (Abschnitt 11.3).
5. **Pending-Zustand:** solange ein Command für diese Aufgabe läuft, sind Checkbox **und** Zeilen-Tipp dieser Aufgabe gesperrt — keine zweite Absicht, bevor die erste beantwortet ist.
6. **Fehler sind sichtbar:** jeder `WorkCommandError` erzeugt eine Benutzerrückmeldung über den bestehenden Notification-Pfad ([`23`](23-operations-errors-feedback.md) §5; Darstellung [`02`](02-design-system.md)); die Checkbox zeigt danach den **neu gelesenen** Serverzustand, nie den erhofften. Text je `reason`/`code` über i18n-Schlüssel, nie Rohtext.
7. **Erfolg** braucht keine Erfolgsmeldung (wie heute). `unchanged` ist kein Fehler; ein neutraler Hinweis ist erlaubt, aber nicht verlangt.
8. **Nach jedem Ausgang** — Erfolg, `unchanged`, `replayed` oder Fehler — wird autoritativ neu gelesen (Abschnitt 18). Die heutige Ausnahme „bei Erledigt-Umschaltung **nicht** invalidieren" (F-4) entfällt.
9. **Kein optimistisches Update** des Erledigt-Zustands und kein lokales Setzen von `done_date`.

**IMPLEMENTATION CHOICE:** Hook-Form (`useMutation` o. ä.), Platzierung des Pending-Zustands, Wortlaut der Rückmeldungen, ob `unchanged` einen Hinweis zeigt.

---

## 18. Read-after-Command

**CONTRACT.**

- Der Command liefert nur das minimale Ergebnis (Abschnitt 13). **Die Lesewahrheit danach liefert ausschließlich ein erneutes Lesen**: das Work Read Model (`getWorkItems`) für Work-Konsumenten, die bestehenden `tasks`-Lesevorgänge für Legacy-Flächen.
- Nach jedem Command-Ausgang invalidiert der Konsument mindestens: alle `tasks`-Ressourcenabfragen (Listen, Einzel- und Mehrfachabrufe der Ressource `tasks`, damit Hotboard, Aktenlisten und Vorgangsaufgaben neu lesen) **und** den Work-Cache der aktuellen Identität (Präfix `["work", "items", <identity>]`, [`26`](26-arbeitskorb-ui-contract.md) §5).
- **Kein** Konsument entfernt eine Zeile lokal, weil er annimmt, was „offen" bedeutet; kein Konsument filtert `done_date` selbst, um eine erledigte Aufgabe auszublenden ([`25`](25-universal-work-model.md) §16.2, W-A-Kriterium 17). Ob eine Zeile nach dem Neulesen verschwindet, entscheidet die jeweilige Query.
- Erwartete Lesewirkung (Test Pflicht): nach `complete` (`applied`) enthält `getWorkItems(stateScope = open)` die Zeile **nicht** mehr und `done`/`all` enthalten sie mit `state = done`; nach `reopen` (`applied`) enthält `open` sie wieder.
- **KNOWN LEGACY:** Legacy-Listen zeigen kürzlich Erledigtes noch kurz an (`isRecentlyDone`, F-4/§8) — das bleibt Präsentation über dem neu gelesenen Server-`done_date`.

---

## 19. Anlage bereits erledigter Aufgaben (Import)

**FACT.** `useImportFromJson.ts` legt Aufgaben über `dataProvider.create("tasks", …)` an und übernimmt dabei `done_date` aus der Importdatei (F-6); das ist ein `INSERT`, keine Transition, und erzeugt `task.created`, nicht `task.completed`.

**CONTRACT — Klassifikation: erlaubtes Legacy-Anlageverhalten außerhalb der Transitionsautorität.**

- Ein `INSERT` mit gesetztem `done_date` ändert den Lifecycle **keines bestehenden** Arbeitsgegenstands; er kann keine offene Arbeit erledigen und keine erledigte wieder öffnen. Die exklusive Autorität aus Abschnitt 16.1 („bestehende Zeile") bleibt damit vollständig gewahrt.
- Work 3 schränkt `INSERT` deshalb **nicht** ein (keine Spaltenrechte auf `INSERT`, keine Importänderung). Den Import zu beschränken hieße, Work 3 auf Datenübernahme auszudehnen, ohne dass die Exklusivität es verlangt.
- **KNOWN LEGACY**, in [`17`](17-known-issues-and-planned-waves.md) G.7 geführt: der importierte Abschlusszeitpunkt ist eine vom Import gelieferte, nicht serverautoritative Angabe. Ob historische Abschlüsse beim Import künftig verworfen, serverseitig gestempelt oder über einen eigenen Import-Command laufen sollen, ist eine eigene spätere Entscheidung.

---

## 20. Demo / FakeRest

**CONTRACT.** Der FakeRest-Provider erfüllt den Port `WorkLifecycleCommands` mit einer **Demo-Simulation** derselben Semantik: Zustand aus dem Demo-Datensatz, `applied`/`unchanged` nach Abschnitt 7, Zeitstempel vom Provider (nicht vom Konsumenten), Idempotenz über einen In-Memory-Scope, Fehler im `PostgrestError`-Format mit `details` = kanonischer Code, über den Operation-Katalog wie die bestehenden Demo-Commands (F-18).

Begründung und Abgrenzung zur Lese-Entscheidung „Alpha Work 2 Punkt 7" (`unavailable`): dort wäre eine Nachbildung eine zweite, ungeprüfte Implementierung von Berliner Geschäftstag, Gültigkeit und Keyset-Ordnung gewesen. Die beiden Lifecycle-Commands haben keine solche Ableitungslogik; ihre Demo-Entsprechung ist trivial, und ohne sie verlöre `npm run dev:demo` die heute vorhandene Erledigt-Funktion. **Die Simulation ist nie Autorität:** sie besteht nur, weil es im Demo-Modus keinen Server gibt ([`17`](17-known-issues-and-planned-waves.md) D.3 „FakeRest ohne Datenebene-Autorisierung" gilt unverändert). Der Demo-Arbeitskorb bleibt `unavailable` ([`26`](26-arbeitskorb-ui-contract.md) §11).

---

## 21. MCP, KI und Automation

**CONTRACT (Invariante, keine Implementierung in Work 3).**

- MCP-Werkzeuge, ChatGPT-/LLM-Konsumenten und Automationen ändern den Work-Lifecycle **ausschließlich** über dieselben Application Commands bzw. dieselben RPCs `complete_work_item` / `reopen_work_item` — mit eigener echter Benutzersitzung, eigenem Idempotenzschlüssel je Absicht und ohne eigene Autorisierungs- oder Transitionslogik ([`25`](25-universal-work-model.md) §19, D-58).
- **Verboten:** `PATCH tasks.done_date`, rohes SQL (`UPDATE tasks SET done_date …`), `service_role` für Lifecycle-Änderungen, ein nachgebautes „ist schon erledigt?", ein clientseitiger Zeitstempel, ein Actor-Argument.
- Die geparkte `mcp`-Funktion mit `complete_task` (F-17) ist **kein** Architekturpräzedenz und **keine** zulässige Alternative. Nach R3 scheitert ihr Roh-`UPDATE` unter `authenticated` ohnehin an der Schließung; vor einem etwaigen Deploy muss das Werkzeug auf den Command umgestellt werden (Gate G-11). Work 3 ändert die Funktion **nicht**.

---

## 22. Testvertrag

**CONTRACT.** Jede Invariante hat mindestens einen Pflichttest. „Ort" ist der Vorschlag; Dateinamen sind IMPLEMENTATION CHOICE, die Existenz der Tests nicht.

### 22.1 Application (Vitest, in CI)

| ID | Test |
|---|---|
| A-1 | Eingabe: genau eine Zielform; ungültige UUID, negative/nicht-sichere `carrierId`, `carrier ≠ "task"`, fehlender/ungültiger Schlüssel ⇒ `invalid_request` **ohne** Port-Aufruf; `carrierId = 0` wird akzeptiert |
| A-2 | Jedes Fremdfeld (`actorId`, `salesId`, `doneDate`, `done_date`, `isDone`, `nextState`, `state`, …) ⇒ `invalid_request` ohne Port-Aufruf |
| A-3 | Port-Aufruf mit exakt der kanonischen Anfrage; `complete` ruft nie den `reopen`-Pfad und umgekehrt |
| A-4 | Fehlerabbildung je Zeile der Tabelle in Abschnitt 14 (inkl. `42501` mit/ohne `DETAIL`, 401, `22023`, `NORA_WORK_ITEM_NOT_FOUND`, `NORA_IDEMPOTENCY_CONFLICT`, Netzwerkfehler); `code` nur aus `DETAIL` |
| A-5 | Ergebnis-Validierung: jede Verletzung aus Abschnitt 13 ⇒ `malformed_response`; Fremdfelder ignoriert; `doneAt` wörtlich durchgereicht |
| A-6 | Disposition `executed`/`replayed` und Transition `applied`/`unchanged` werden unverändert gemeldet |
| A-7 | Adapter: RPC-Name, Parameter, Header `x-nora-operation-id` aus dem Operation-Kontext; Katalogeinträge `work.complete` / `work.reopen` |
| A-8 | FakeRest-Simulation: `applied`/`unchanged` symmetrisch, Zeitstempel nicht vom Aufrufer, Replay je Schlüssel, Fehler mit `details`-Code |

### 22.2 Datenbank (SQL-Suite, lokal)

| ID | Test |
|---|---|
| S-1 | `office` erledigt eine offene Aufgabe: `applied`, `done_date` gesetzt |
| S-2 | `admin` erledigt eine offene Aufgabe |
| S-3 | `viewer` ⇒ `42501` / `NORA_PERMISSION_DENIED`; deaktivierter Mitarbeiter und tote Sitzung ebenso; Zustand unverändert, kein Audit |
| S-4 | `office` erledigt und öffnet die Aufgabe **eines anderen** Mitarbeiters (D2) |
| S-5 | freie Aufgabe (`sales_id IS NULL`) und Aufgabe eines **deaktivierten** Halters sind erledigbar (kein `guard_active_assignment`-Effekt, F-12) |
| S-6 | Aufgabe mit `text` `NULL`, `''` und `'   '` ist erledigbar und wieder öffenbar (D5) |
| S-7 | Aufgabe mit historisch abweichendem Kundenkontext ist erledigbar (kein Kontext-Recheck, F-12) |
| S-8 | Serverzeit: `done_date = audit_events.created_at` des `task.completed`; kein Parameter kann den Zeitpunkt setzen |
| S-9 | `complete(open)` genau einmal `applied`; `complete(done)` `unchanged`, `done_date` bitgleich, **kein** neues Audit (auch kein `task.updated`) |
| S-10 | `reopen(done)` genau einmal `applied` (`done_date` `NULL`); `reopen(open)` `unchanged`, kein Audit |
| S-11 | Audit: exakt ein `task.completed` / `task.reopened` je `applied`; `actor_id`, `actor_sales_id`, `actor_role_snapshot` = Aufrufer, nie `System`/`NULL` |
| S-12 | Korrelation: `audit_events.request_id` = gesendete `x-nora-operation-id` (lowercase) |
| S-13 | `not_found`: unbekannte `work_id`, unbekannte `task_id`, gelöschte Aufgabe ⇒ `NORA_WORK_ITEM_NOT_FOUND`, kein Idempotenzdatensatz |
| S-14 | Eingabe: beide oder keine Zielform, fehlender Schlüssel ⇒ `22023` |
| S-15 | `workId`- und `carrierId`-Form treffen dieselbe Zeile und denselben Fingerprint (Replay über die jeweils andere Form) |
| S-16 | **Schließung (nach R3):** `authenticated`-`UPDATE` von `done_date` auf beliebigen Zeitstempel **und** auf `NULL` ⇒ `42501`; ebenso über Upsert; Zeile unverändert |
| S-17 | **Schließung erhält Legacy-Bearbeitung:** `authenticated` (`office`) ändert `text`, `type`, `due_date`, `sales_id` (aktives Ziel), `contact_id`/`company_id` erfolgreich; `viewer` weiterhin abgewiesen (RLS unverändert) |
| S-18 | Rechtelage gegen die Datenbank: Spalten-/Tabellenrechte aus 16.3; RPC-`EXECUTE` nur `authenticated` (`anon`, `service_role`, `PUBLIC` ohne); `prosecdef`, Owner `postgres`, `search_path = ''` |
| S-19 | Rollback-Atomarität: ein erzwungener Fehler nach der Mutation (z. B. im Audit-Pfad, per Testfixture) hinterlässt weder `done_date`-Änderung noch Audit noch Idempotenzdatensatz |
| S-20 | `INSERT` mit gesetztem `done_date` durch `authenticated` bleibt möglich (Abschnitt 19) und erzeugt `task.created`, kein `task.completed` |

### 22.3 Sitzung (Zwei-Sessions-Suite über GoTrue + PostgREST, lokal)

| ID | Test |
|---|---|
| SE-1 | Actor stammt aus der echten Sitzung: zwei getrennt authentifizierte Mitarbeiter (D-28) erledigen bzw. öffnen; Audit-Actor ist jeweils der richtige |
| SE-2 | Kein Impersonieren: ein RPC-Aufruf mit zusätzlichem Argument (`p_actor_sales_id`, `p_done_date`, `p_state`) wird von PostgREST abgewiesen; der Audit-Actor ist nie ein anderer Mitarbeiter |
| SE-3 | `anon` (ohne JWT) ⇒ abgewiesen; abgelaufene/widerrufene Sitzung ⇒ abgewiesen |
| SE-4 | Roher `PATCH /tasks?id=eq.…` mit `done_date` (Zeitstempel und `null`) unter echter `office`-Sitzung ⇒ abgewiesen (nach R3); `PATCH` mit `text`/`due_date` ⇒ erfolgreich |

### 22.4 Concurrency (Runner mit zwei Datenbankverbindungen, lokal — Präzedenz `contact_primary_intent_concurrency_*`)

| ID | Test |
|---|---|
| K-1 | zwei gleichzeitige `complete` (verschiedene Schlüssel): genau ein `applied`, ein `unchanged`; genau ein `task.completed`; `done_date` = Wert des Gewinners |
| K-2 | zwei gleichzeitige `reopen`: genau ein `applied`, ein `task.reopened` |
| K-3 | `complete`/`reopen`-Rennen in beiden Reihenfolgen: Endzustand und Audit gemäß C-5 |
| K-4 | gleichzeitiger Doppel-Request mit **demselben** Schlüssel: ein `executed`, ein `replayed`, ein Audit |
| K-5 | kein Zeitstempel-Überschreiben: nach beliebig vielen `complete` auf erledigter Aufgabe bleibt `done_date` bitgleich |

### 22.5 Idempotenz (SQL-Suite)

| ID | Test |
|---|---|
| I-1 | gleicher Schlüssel, gleiches Ziel ⇒ `replayed`, identisches Ergebnis, kein zweites Audit, keine zweite Mutation |
| I-2 | **Retry nach Gegentransition:** `complete(K1)` → `reopen(K2)` → `complete(K1)` ⇒ `replayed` mit Ergebnis von K1, Aufgabe **bleibt offen**, kein zweites `task.completed` |
| I-3 | gleicher Schlüssel, anderes Ziel ⇒ `NORA_IDEMPOTENCY_CONFLICT`, nichts geändert |
| I-4 | gleicher Schlüssel, anderer Mitarbeiter ⇒ eigener Scope (führt aus) |
| I-5 | ein vor dem Commit gescheiterter Versuch hinterlässt keinen Datensatz; derselbe Schlüssel führt danach normal aus |
| I-6 | `unchanged` wird persistiert und als `replayed`/`unchanged` wiedergegeben |

### 22.6 Lese-Integration (SQL- oder Session-Suite)

| ID | Test |
|---|---|
| R-1 | nach `complete` (`applied`): `get_work_items(…, 'open', …)` ohne die Zeile; `'done'` und `'all'` mit `state = done` |
| R-2 | nach `reopen` (`applied`): `'open'` enthält die Zeile wieder |

### 22.7 Legacy-Oberfläche (Vitest; Happy Path zusätzlich Playwright)

| ID | Test |
|---|---|
| U-1 | Checkbox an ⇒ `completeWorkItem`, aus ⇒ `reopenWorkItem`, je mit `{ carrier: "task", carrierId }` und frischem Schlüssel; mobiler Zeilen-Tipp ebenso |
| U-2 | **kein** `update("tasks", { done_date })` und kein clientseitiger Zeitstempel im Lifecycle-Pfad; „Morgen"/„Nächste Woche"/Bearbeiten senden nie `done_date` |
| U-3 | Pending sperrt Checkbox und Zeilen-Tipp; ein zweiter Klick löst keinen zweiten Command aus |
| U-4 | Fehler je `reason` ⇒ sichtbare Rückmeldung; danach Neulesen |
| U-5 | Erfolg und `unchanged` ⇒ Invalidierung der `tasks`-Abfragen und des Work-Caches; kein lokales Entfernen |
| E-1 | **Playwright (CI):** gegen die lokale Supabase eine Aufgabe über die Checkbox erledigen und wieder öffnen; der Zustand übersteht ein Neuladen |

Nicht verlangt: eine Mutationsoberfläche im Arbeitskorb (OUT OF SCOPE, Abschnitt 24).

---

## 23. CI und Release-Evidenz

**FACT (F-19):** CI führt Vitest, Typecheck, Lint, Prettier, Build und Playwright gegen eine lokale Supabase aus, **keine** Suite aus `supabase/tests/`.

**CONTRACT — ehrliche Evidenzklassen:**

| Klasse | Inhalt |
|---|---|
| **AUTOMATISIERT (CI)** | A-1 … A-8, U-1 … U-5 (Vitest); E-1 (Playwright gegen lokale Supabase mit allen Migrationen — der einzige CI-Beweis, dass RPC, Grants und Checkbox zusammen funktionieren); Typecheck, Lint, Build, Bundle-Budget |
| **PFLICHT, LOKAL/MANUELL** | S-1 … S-20, SE-1 … SE-4, K-1 … K-5, I-1 … I-6, R-1/R-2, die angepasste `public_privilege_hardening_verification.sql` und die bestehenden Task-/Audit-Suiten (`crm_audit_verification.sql`, `task_customer_context_verification.sql`, `work_read_model_verification.sql`) — lokal gegen eine frisch zurückgesetzte Datenbank, mit Ausgabe in der Release-Evidenz ([`21`](21-agent-runbooks.md) Sektion 5; Reset-Pflicht nach der Zwei-Sessions-Suite) |
| **PFLICHT, PRODUCTION** | nach R1: RPC-Existenz und Grants read-only geprüft; nach R2: Mitarbeiter-Smoke complete + reopen inkl. Audit-Zeilen und `request_id`; nach R3: Rechtelage aus 16.3 read-only gegen Production |

Niemand darf eine Suite aus der zweiten Zeile als „CI-gesichert" bezeichnen. Die Aufnahme der SQL-Suiten in CI bleibt der bestehende offene Punkt ([`17`](17-known-issues-and-planned-waves.md) B „W9", G.7) und ist **nicht** Teil von Work 3 — sie verlangt eine eigene Runner-Infrastruktur. **Klein und Teil von Work 3** ist allein E-1.

---

## 24. Ausdrücklich nicht Teil von Work 3 (OUT OF SCOPE)

`work.claim` · `work.assign` / Umhängen · `work.defer` / `work.resume` · `cancel` / `cancelled` · Löschen · Bearbeiten über Commands · `allowed_actions` im Read Model ([`25`](25-universal-work-model.md) §13 bleibt unverändert: Work 3 liefert die Commands, bewirbt sie aber nicht im Read Model) · Mutationsoberfläche im Arbeitskorb (Alpha UI 3) · Kommentare, Benachrichtigungen, E-Mail, Kalender · KI-Verhalten, MCP-Deploy oder -Umbau · Team-/Servicebereichs-Scoping, Holder als Autorisierung · neue Tabelle, neue Spalte, Versionsspalte, `updated_at`, `completed_by` · Event Sourcing, CQRS-Infrastruktur, Command-Bus, Workflow-Engine · neue Audit-Ereignistypen · Änderung des Imports · Retention für `idempotency_records` · Ablösung von Hotboard/Arbeitsboard (G-10) · Behebung der clientseitigen Fälligkeitslogik der Legacy-Flächen ([`17`](17-known-issues-and-planned-waves.md) G.7) · Aufnahme der SQL-Suiten in CI.

Work 3 **ändert** keine Semantik von `cancel`, `claim`, `assign` oder `defer`; diese bleiben Gates in [`25`](25-universal-work-model.md) §23.

---

## 25. Implementierungsfreiheiten (IMPLEMENTATION CHOICE)

Innerhalb der Contract-Grenzen frei:

- Datei-, Modul-, Hook- und Testdateinamen; interne Hilfsfunktionen; ob complete/reopen einen gemeinsamen privaten Transitionskern im SQL teilen (öffentlich bleiben es zwei RPCs).
- Fingerprint-Hashverfahren (Präzedenz `md5(jsonb_build_object(...)::text)`), SQLSTATE des Not-found-Fehlers, Exception-Nachrichten.
- Wortlaut der Migrationsdateien; ob R1 und R3 als zwei Migrationsdateien oder zusätzlich mit Assertions gebaut werden (zwei getrennte Auslieferungsschritte sind Pflicht).
- Wortlaut und i18n-Schlüssel der Benutzerrückmeldungen, ob `unchanged` einen neutralen Hinweis zeigt.
- Form des Pending-Zustands und der Invalidierung (solange Abschnitt 17/18 erfüllt sind).
- Aufbau der Concurrency-Runner (Präzedenz PowerShell + zwei `psql`-Worker).

**Nicht** frei: alles mit **CONTRACT** Markierte, insbesondere `SECURITY DEFINER`, Signatur, Pflichtschlüssel, Spaltenrecht als Schließungsmechanismus, die drei Auslieferungsschritte, die Ergebnis- und Fehlervokabulare.

---

## 26. Falsifikationsprüfung (Review-Fallen)

| Falle | Ergebnis | Begründung |
|---|---|---|
| T-1 Browser kann `done_date` noch direkt patchen | geschlossen nach R3 | Spaltenrecht ohne `done_date` (16.2); S-16, SE-4. Zwischen R1 und R3 bewusst KNOWN LEGACY (16.3) |
| T-2 Aufrufer liefert fremden Actor | geschlossen | keine Actor-Eingabe, kein Actor-Parameter; `current_sales_id()`; A-2, SE-2 |
| T-3 wiederholtes complete überschreibt den Zeitpunkt | geschlossen | `unchanged` ohne `UPDATE` (7); S-9, K-1, K-5 |
| T-4 Retry nach Gegentransition erledigt erneut | geschlossen | Pflichtschlüssel + Replay vor Zustandsprüfung (9 Schritt 5, 11.4); I-2 |
| T-5 zwei gleichzeitige completes ⇒ zwei Audits | geschlossen | `FOR UPDATE` + erneutes Lesen (10); K-1 |
| T-6 reopen bleibt roher CRUD-Bypass | geschlossen nach R3 | Spaltenrecht gilt für `NULL` ebenso; S-16 |
| T-7 Schließung bricht Titel/Fälligkeit/Halter | geschlossen | Spaltenrecht für alle übrigen Spalten, Adapter sendet nur Geänderte (F-5); S-17, SE-4, U-2 |
| T-8 `DEFINER` umgeht Prüfungen | geschlossen | Körperprüfung vor allem anderen, eng begrenzte Schreibwirkung (15); S-3, S-18 |
| T-9 Audit-Actor wird Owner/System | geschlossen | Audit-Actor aus Sitzungs-GUCs, Executor-Pfad unerreichbar (12); S-11, SE-1 |
| T-10 UI entfernt Zeilen selbst | geschlossen | Neulesen statt lokaler Entfernung (17, 18); U-5 |
| T-11 MCP/Roh-SQL bleibt zulässige Alternative | geschlossen | Invariante (21); nach R3 auch technisch blockiert |
| T-12 versehentlich Owner-only-Security | geschlossen | D2, kein Holder-Prädikat (6); S-4, S-5 |
| T-13 neue Versionsspalte/Tabelle/Framework | geschlossen | keine neue Persistenz außer zwei RPCs und einem Grant-Wechsel (5, 10, 24) |
| T-14 Tests als CI-gesichert behauptet, obwohl manuell | geschlossen | Evidenzklassen (23) |
| T-15 cancel/claim/assign/defer still verändert | geschlossen | 7, 24 |

---

## 27. Pflege dieses Dokuments

- **Status-Übergänge:** `CONTRACT CANDIDATE` → nach bestandener unabhängiger Review `CONTRACT FROZEN` → nach Auslieferung von R1–R3 Umsetzungsstand im Kopf (wie [`26`](26-arbeitskorb-ui-contract.md)). Der Freeze ist eine eigene, protokollierte Entscheidung ([`06`](06-decision-log.md)).
- **Abweichungen während der Implementierung** werden nicht still umgesetzt: sie werden hier als Änderung mit Datum und Begründung eingetragen und in [`06`](06-decision-log.md) begründet.
- **Dokumentationsschließung der Implementierung:** [`16`](16-current-state.md) (Ist-Zustand nach R3), [`22`](22-security-and-access.md) §6.13 bzw. ein neuer Abschnitt für die Durchsetzungsseite (RPCs, Spaltenrecht), [`25`](25-universal-work-model.md) §23 (G-4a umgesetzt), [`13`](13-crm-audit-retention.md) (Work-Commands als Auslöser von `task.completed`/`task.reopened`), [`21`](21-agent-runbooks.md) Sektion 5/15 (Testsequenz Work 3), [`03`](03-data-model-guardrails.md) (Migrationsregel „neue `tasks`-Spalte braucht ein ausdrückliches Spaltenrecht"), [`17`](17-known-issues-and-planned-waves.md) G.7, [`20`](20-product-changelog.md) nur, falls Benutzer etwas merken, `releases/2026-10.md` bzw. Folgemonat.
