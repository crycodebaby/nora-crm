# 25 – Universal Work Model v1 (Domain Contract)

Stand: 2026-09-21 · Status: **FROZEN** · Load-Klasse: **CONDITIONAL CURRENT CONTRACT**

Dies ist der **kanonische, eingefrorene Domain- und Application-Contract für Work** in Nora: was ein Arbeitsgegenstand ist, welche Persistenz ihn tragen darf, welchen Lebenszyklus er hat, wie Fälligkeit und Zuständigkeit bewertet werden, wer als Akteur gilt, was der Arbeitskorb standardmäßig liefert — und was die erste Umsetzungswelle **W-A** beweisen muss.

Der Freeze wurde am **2026-09-21** nach unabhängigem Architecture Review mit **DOMAIN FREEZE PASS** und **W-A GO** abgeschlossen. Die Entscheidungen in diesem Dokument sind **geschlossen** und werden nicht erneut geöffnet; wo Nachfolgearbeit vorgesehen ist, steht sie als benanntes Decision Gate in Abschnitt 23.

**Begründungen in Kurzform:** [`06`](06-decision-log.md), Eintrag „Universal Work Model v1". **Spätere Decision Gates:** Abschnitt 23 dieses Dokuments — dort und nur dort steht, was bewusst offen geblieben ist. **Verwandte offene Punkte am Kern-CRM:** [`17`](17-known-issues-and-planned-waves.md) Sektion G. **Datenmodell-Invarianten:** [`03`](03-data-model-guardrails.md). **Security:** [`22`](22-security-and-access.md). **Audit:** [`13`](13-crm-audit-retention.md).

> **Re-publication.** Dieses Dokument wurde am **2026-09-21** nach einem unabhängigen Re-publication Review unverändert im Contract, aber mit vier belegten Präzisierungen (F-1 bis F-4: Abschnitt 18.2, 21.5, 21.3, 9.1) erneut kanonisch abgelegt. **Der Domain Freeze wurde dabei nicht neu beschlossen** — Freeze-Datum und Status oben bleiben unverändert; die Präzisierungen korrigieren bzw. vervollständigen ausschließlich Evidenzaussagen, keine Entscheidung.

> **Geltung.** Dieses Dokument ist **eigenständig und vollständig**. Es ersetzt die nicht im Repository abgelegten Arbeitsfassungen „Domain Design Freeze Candidate" v1, v2 und v3 vollständig. Frühere Formulierungen aus diesen Fassungen, die hier nicht stehen, gelten **nicht** als Contract. Was hier steht, ist der Contract.

---

## 0. Was dieser Contract tut — und was nicht

**Er tut:** den fachlichen Begriff *Work* definieren, seine Träger benennen, seine Zustände, Zeit- und Zuständigkeitssemantik festlegen und den Scope der ersten Read-Model-Welle W-A objektiv prüfbar machen.

**Er tut nicht:** implementieren. Dieses Dokument enthält keine Migration, kein SQL, keinen RPC-Namen und keine Signatur. W-A ist zum Zeitpunkt dieses Freeze **freigegeben, aber nicht begonnen**.

**Nicht Scope:** Communication/E-Mail, Kalender, Anhänge, MCP-Transport, Hotboard-Redesign, Security-Remediation, Error-Observatory-Altlasten.

---

## 1. Ziel und Scope

Nora soll eine operative Arbeitsoberfläche werden, auf der ein Mitarbeiter zuverlässig erkennt: was zu tun ist, wem es gehört, was frei ist, wann es fällig ist, worauf gewartet wird, wann es wieder vorzulegen ist, wann es erledigt wurde und zu welchem Kunden es gehört.

**Work** ist Noras fachlicher Begriff für „eine konkrete Arbeit, die jemand tun muss".

Work ist ein **Domain- und Application-Vertrag über bestehenden Arbeitsträgern** — **keine** neue persistierte Universal-Entity. Es gibt keine `public.work_items`-Tabelle und kein polymorphes `entity_type`/`entity_id`-Modell. Work wird von **Work Carriern** getragen: konkreten, fachlich eigenständigen Persistenzen, die den Work-Vertrag strukturell erfüllen können.

In v1 ist **`public.tasks` der einzige Work Carrier.** Checklisten sind in v1 kein Work Carrier (Abschnitt 4.3).

**Der Arbeitskorb ist nicht die Domäne.** Er ist Read Model und Produktoberfläche — nie eine eigene Wahrheit, nie eine eigene Persistenz.

```
Quelle / Ereignis / Vorgang / Zustand
        ↓  fachliche Bewertung
konkrete notwendige Handlung
        ↓  Zuständigkeit
Work  →  Attention  →  Arbeitskorb
```

Eine Quelle ist nicht automatisch Arbeit. Ein Zustand ist nicht automatisch Arbeit. Ein Datum ist nicht automatisch Arbeit.

---

## 2. Domain-Vokabular

| Begriff | Bedeutung | Ebene |
|---|---|---|
| **Work** | Ein Arbeitsgegenstand: eine konkrete, zurechenbare, beendbare Handlung | Fachlich / Application |
| **Work Carrier** | Eine konkrete Tabelle, die einen Work-Gegenstand trägt | Persistenz |
| **Carrier Capability** | Was ein konkreter Träger tatsächlich speichern **und** auditieren kann | Persistenz ↔ Contract |
| **Row Validity** | Ob eine **einzelne Zeile** des Trägers ein fachlich gültiger Work-Gegenstand ist | Zeilenebene |
| **Holder** | Der zuständige Mitarbeiter (`sales.id`) | Domain State |
| **Actor** | Der handelnde Mitarbeiter aus der authentifizierten Session | Security |
| **Query Subject** | Der Mitarbeiter, nach dem eine Abfrage ggf. *filtert* — nicht die Security Identity | Application |
| **Attention** | Abgeleiteter Aufmerksamkeitszustand (`actionable`, `overdue`, `due_today`) | Derived Read State |
| **Application Query** | Serverseitige, akteursbezogene Lesefrage | Application |
| **Application Command** | Serverseitige, autorisierte Zustandsänderung | Application |
| **Arbeitskorb** | Die Produktoberfläche / das Read Model | Presentation |
| **Hotboard / Arbeitsboard** | **Bestehende** Ist-Flächen (`Hotboard.tsx`, `HotboardFocusBoard`, Welle v0.3j) | Legacy-Ist |

**Namensregel (eingefroren).** `Work` ist der Domain-/Application-Begriff. `Arbeitskorb` ist Read Model und Oberfläche. `Hotboard` und `Arbeitsboard` sind bestehende Flächen; sie bestimmen die künftige Domain-Sprache **nicht**, und ihre Ablösung wird separat geplant (Gate G-10). Kein Presentation-Begriff (Neu, Heute, Überfällig, Wartet, Farben, Icons, Routen) wird jemals Domain State oder Contract-Feld.

---

## 3. Work vs. Work Carrier

### 3.1 Die Trennung

**Work** ist der Vertrag. **Der Carrier** ist die Tabelle, die ihn erfüllt. Ein Contract-Feld, das ein Träger nicht tragen kann, wird **maschinenlesbar als nicht-verfügbar ausgewiesen** — nie geraten, nie clientseitig ersetzt.

> **Grundsatz (eingefroren).** Der Universal Work Contract darf Zielsemantik definieren. **Ein konkreter Träger darf nur die Capability anbieten, die er tatsächlich speichern und auditieren kann.**

### 3.2 Der Work-Abgrenzungstest

Ein Kandidat ist nur dann Work, wenn er **alle vier** Fragen beantwortet:

| # | Frage | Prüft |
|---|---|---|
| 1 | Was ist konkret zu tun? | Handlungsidentität |
| 2 | Wer tut es / kann es halten? | Zurechenbarkeit |
| 3 | **Kann eine Fälligkeit ausgedrückt werden, *wenn* fachlich eine gesetzt ist?** | Zeitliche Ausdrucksfähigkeit |
| 4 | Woran erkennt man das Ende? | Abschlusskriterium |

Der Test wird gegen die **Carrier Capability** geführt, nicht gegen die fachliche Vorstellbarkeit. „Man könnte dafür eine Spalte anlegen" ist keine bestandene Prüfung. Ein Träger, der Frage 2 oder 3 nicht **speichern** kann, ist kein Work Carrier — er ist Kontext oder Fortschritt.

> **Zu Frage 3, ausdrücklich.** Geprüft wird die **Ausdrucksfähigkeit**, nicht eine Pflicht. Eine Arbeit ohne Termin („Dokumentation vervollständigen") ist **legitime, vollständige Arbeit**. `due_at = null` bedeutet *unbefristet / keine gesetzte Fälligkeit* und ist **kein** Fehlerzustand.

---

## 4. Carrier Capability

### 4.1 Die vier Fähigkeiten auf `public.tasks`

| # | Fähigkeit | `public.tasks` |
|---|---|---|
| 1 | eine konkrete Handlung benennen | `text` |
| 2 | Zuständigkeit (Holder) tragen | `sales_id` → `sales` |
| 3 | eine Fälligkeit ausdrücken, *wenn* fachlich eine gesetzt ist | `due_date` |
| 4 | Abschluss erkennbar machen | `done_date` |

`public.tasks` erfüllt alle vier Fähigkeiten.

### 4.2 `public.tasks` ist der einzige Work Carrier in v1

`public.tasks` besitzt **genau acht Spalten**:

| Spalte | Typ | Work-Bedeutung |
|---|---|---|
| `id` | `bigint` | Trägeridentität |
| `text` | `text` **nullable** | Titel |
| `type` | `text` **nullable** | Work Type |
| `due_date` | `timestamptz` **nullable** | Fälligkeit |
| `done_date` | `timestamptz` **nullable** | Abschluss |
| `sales_id` | `bigint` **nullable**, FK `NO ACTION` | Holder |
| `company_id` | `bigint` **nullable**, FK `ON DELETE CASCADE` | Kundenkontext (historisch) |
| `contact_id` | `bigint` **nullable**, FK `ON DELETE SET NULL` | Kontaktkontext |

**Nicht vorhanden:** `state`, `deferred`, `reappear_at`, `deferral_reason`, `cancelled_at`, `deal_id`, `created_at`, `updated_at`, `priority`.

**Constraint:** `CHECK (company_id IS NOT NULL OR contact_id IS NOT NULL)` — mindestens ein Kontext ist Pflicht.

**Trigger:** `enforce_task_company_context` (BEFORE I/U) · `guard_active_assignment` (BEFORE INSERT OR UPDATE **OF** `sales_id`) · `set_task_sales_id_trigger` (**BEFORE INSERT only**) · `audit_task_row` (AFTER I/U/D).

**RLS:** `SELECT USING is_active_user()` · `INSERT`/`UPDATE` mit `can_write()` (admin|office) · `DELETE` nur `is_admin()`. **Kein Ownership-Prädikat.**

`public.tasks` ist der einzige geprüfte Kandidat, der Frage 2 **und** Frage 3 mit einer echten Spalte beantwortet, und der einzige, dessen Halter dieselbe Identität trägt wie der Rest der Domäne (`sales.id`, `bigint`).

### 4.3 Warum Checklisten kein Work Carrier sind

Geprüfte Kandidaten und ihr Ergebnis:

| Kandidat | F1 Handlung | F2 Halter | F3 Fälligkeit | F4 Ende | Verdict v1 |
|---|---|---|---|---|---|
| `public.tasks` | ✅ `text` / `type` | ✅ `sales_id → sales.id` (nullable) | ✅ `due_date` | ⚠️ nur `done_date` | **WORK CARRIER** |
| `public.checklist_run_items` | ✅ `label_snapshot` | ❌ keine Halterspalte; `checked_by` wird nachträglich erzwungen | ❌ keine Spalte | ✅ `is_checked` | **KEIN Carrier** |
| `public.checklist_runs` | ⚠️ nur als Aggregat | ❌ `started_by`/`completed_by` = Provenienz, `uuid` statt `sales.id` | ❌ keine Spalte | ✅ `status` + `completed_at` | **KEIN Carrier** (bester Zukunftskandidat) |

`checklist_run_items` und `checklist_runs` sind in Work v1 **keine** Work Carrier. Checklisten bleiben **fachlicher Kontext und Fortschritt am Vorgang**.

Der **Lauf** (`checklist_runs`) wird als künftiger Carrier-Kandidat protokolliert. Er ist auf der Lifecycle-Achse sogar **stärker** als `tasks` — `status CHECK IN ('open','completed','cancelled')`, `completed_at`, `completed_by`, `deal_id NOT NULL`, `service_area_code NOT NULL`, Aggregationsinvariante `uq_checklist_runs_one_open_per_deal_template`. Ihm fehlen genau zwei Dinge: **Halter** und **Fälligkeit**. Eine erneute Aufnahme setzt belegte fachliche Semantik für beide voraus (Gate G-6). Keine Migration wird dafür geplant.

**Mengenbegründung.** 27 ungeprüfte Punkte, davon 24 pflichtig, gegenüber 11 offenen Aufgaben. Punkte als Träger ergäben am ersten Tag 24 von 35 Arbeitskorbzeilen (69 %) und reproduzierten die visuelle Unruhe des Hotboards. Das ist ein Symptom des falschen Schnitts, nicht seine Ursache — aber es bestätigt ihn.

---

## 5. Row Validity

Carrier Capability sagt **nichts** darüber, ob eine einzelne Zeile ein gültiger Work-Gegenstand ist. Die beiden Ebenen werden nie vermischt.

**Belegter Grund.** Das Schema erzwingt die fachlichen Mindestbedingungen nicht: `attnotnull = false` auf `text`, `type`, `due_date`, `sales_id`; die einzige CHECK ist `tasks_company_or_contact_check`. Die heutige Durchsetzung liegt **im Formular** (`TaskFormContent.tsx`) — und [`22`](22-security-and-access.md) schließt die UI als Autorität aus. Ein zweiter ausgelieferter Schreibpfad umgeht sie bereits: `useImportFromJson.ts` legt Tasks **ohne `type`** und optional **ohne `due_date`** an.

### 5.1 Gültige Work-Ausprägungen

Kein Defekt, kein Sonderfall:

| Zustand | Bedeutung |
|---|---|
| `sales_id IS NULL` | unassigned — gültig, niemand hält die Arbeit |
| `due_date IS NULL` | keine Fälligkeit gesetzt — gültig |
| `type IS NULL` | fehlende optionale Klassifizierung — gültig, solange eine konkrete Handlung benannt ist |

### 5.2 Unvollständige Work-Row

> `text IS NULL` **oder** `btrim(text) = ''`
> → die konkrete Handlung ist nicht benennbar → der Work-Abgrenzungstest ist nicht erfüllt.

**Contract-Semantik:**

```
validity       = valid | incomplete
invalid_reason = null | missing_title      -- nur bei validity = incomplete
title          = null, wenn nicht benennbar
```

**Verbindlich:**

- Eine unvollständige Row **verschwindet nicht** still aus dem Read Model.
- `title` wird **nicht** clientseitig repariert, nicht ersetzt, nicht erfunden.
- Sie wird **nicht** als normale gültige Work-Zeile ausgegeben.
- Ein nicht-visueller Konsument erkennt maschinenlesbar: *die persistierte Task existiert, ihre Work-Projektion ist fachlich unvollständig.*

Keine weitere Abstraktion. `invalid_reason` ist ein **geschlossenes Vokabular mit genau einem Wert** in v1.

> Der Bestand ist zum Zeitpunkt des Freeze vollständig (keine unvollständige Zeile). Diese Regel ist **Robustheit des Contracts**, keine neue Produktfunktion — und die Zusage, dass eine solche Zeile, falls sie entsteht, sichtbar bleibt.

---

## 6. Lifecycle

### 6.1 Target Lifecycle (Zielsemantik)

```
open ──defer──▶ deferred ──resume/reappear──▶ open
  │                  │
  └──complete────────┴──▶ done ──reopen──▶ open
```

### 6.2 Heute auf `public.tasks` persistierbar

```
open (done_date IS NULL) ◀──reopen──▶ done (done_date IS NOT NULL)
```

Mehr nicht. `deferred`, `reappear_at` und `deferral_reason` haben **keinen Speicherort**. Der Contract führt deshalb in v1 genau zwei Zustände: `state = open | done`. **Kein `cancelled`.**

### 6.3 `deferred` / Wiedervorlage — spätere Zielsemantik

Die fachliche Lösung ist eingefroren:

```
actionable = (state = open)
          OR (state = deferred AND reappear_at <= now())
```

Kein Cron, kein Worker, kein Trigger schreibt den Zustand auf `open` zurück. Das folgt exakt dem etablierten Nora-Muster „abgeleiteter Status wird nie gespeichert" ([`19`](19-user-lifecycle-architecture.md) §4 Zugangsstatus, [`03`](03-data-model-guardrails.md) §5 Falle 35).

**Aber:** Wiedervorlage ist **nicht** Teil von W-A. Die erste Lifecycle-Migrationswelle (Gate G-1) schafft einen konkreten, **trägerspezifischen** Speicherort auf `public.tasks`. Es wird **kein** neues Universal-Work-Persistenzmodell nur dafür eingeführt.

### 6.4 `cancel` ist nicht in v1

`public.tasks` kennt nur `done_date`. Der Audit-Trigger interpretiert `done_date NULL → NOT NULL` **zwingend** als `task.completed`, und `audit_events` ist append-only.

**Eingefroren:**

- `public.tasks` unterstützt in Work v1 **kein** `work.cancel`.
- Die Abbildung `cancel → done_date` ist **verboten**. Sie erzeugt eine dauerhaft falsche, nie korrigierbare Geschäftshistorie.
- `cancel` verlangt eine eigene Domain-, Schema- **und** Audit-Welle (Gate G-5).
- **`cancelled` ist nicht Teil des eingefrorenen Target Lifecycle.**

**Begründung.** Die fachliche Unterscheidung („Kunde hat abgesagt" ≠ „wir haben es erledigt") ist real. Aber der Bedarf ist unbelegt: `checklist_runs.status` bietet `'cancelled'` seit der Checklisten-Welle an, und **keiner** der existierenden Läufe nutzt ihn; das einzige jemals geschriebene Checklisten-Audit-Ereignis ist `checklist.run_started`. Nora hat eine stehende Entscheidungsregel: *„Ein neues DB-Feld darf erst eingeführt werden, wenn ein konkreter Vorgang den Bedarf belegt"* ([`01`](01-domain-model.md)). `cancelled` bleibt als **reserviertes Wort** benannt, damit niemand den Begriff für etwas anderes benutzt.

---

## 7. Fälligkeit und Zeitsemantik

### 7.1 `due_at` und `due_precision`

```
due_at        timestamptz, nullable
due_precision day | instant | unknown
```

`due_at = null` ist ein **gültiger** Work-Zustand: unbefristete Arbeit.

Alle Tages- und Zeitpunktvergleiche erfolgen serverseitig in **`Europe/Berlin`**. Der Geschäftstag ist:

```
due_day := (due_at AT TIME ZONE 'Europe/Berlin')::date
today   := (now()  AT TIME ZONE 'Europe/Berlin')::date
```

**Jeder Präzisionswert hat eine definierte fachliche Konsequenz.** Ein Diskriminator ohne Wirkung wäre ein Contract-Defekt.

### 7.2 `due_precision = day`

Die Fälligkeit bezeichnet einen **Geschäftstag**.

```
due_today := due_day = today
overdue   := due_day < today
```

`due_today` und `overdue` schließen sich gegenseitig aus.

### 7.3 `due_precision = instant`

Die Fälligkeit bezeichnet einen **echten Zeitpunkt**.

```
due_today := due_day = today
overdue   := due_at < now()
```

Beide können **gleichzeitig wahr** sein. Beispiel: fällig heute 14:00, jetzt 17:30 → `due_today = true`, `overdue = true`.

Das ist kein Widerspruch: **`due_today` beschreibt den Kalendertag, `overdue` das Überschreiten der Frist.** Es sind zwei Fragen, nicht zwei Antworten auf eine Frage.

### 7.4 `due_precision = unknown`

Legacy-/Carrier-Zustand: der Träger kennt die ursprüngliche Fälligkeitsabsicht nicht. Konservativ gilt die **Geschäftstagsregel**:

```
due_today := due_day = today
overdue   := due_day < today
```

**Ausdrücklich verboten:** jede Uhrzeit-Heuristik. Insbesondere darf `00:00 UTC` bzw. `02:00 Europe/Berlin` **nicht** automatisch als `day` interpretiert werden.

> **Belegter Grund für dieses Verbot.** Der Bestand trägt elf verschiedene Berliner Uhrzeiten; genau drei Zeilen liegen auf UTC-Mitternacht (= 02:00 Berlin) und stammen aus `create_quick_capture_task(p_due_date date)`. Eine Heuristik wäre verführerisch und trotzdem falsch — sie würde **Absicht erfinden, wo keine gespeichert ist**.

Nora verwendet diese Tri-State-Ehrlichkeit bereits: `nora_private.attachment_storage_key_liveness()` liefert `live | dead | unknown`, `mail_kind = unknown` ist im E-Mail-Contract etabliert.

**Protokollierter Defekt.** `create_quick_capture_task(p_due_date date)` erzeugt Fälligkeiten um 02:00 Europe/Berlin. Er wird in der Lifecycle-Migrationswelle (G-1) behoben, sobald `due_precision` Speicher bekommt — nicht vorher, nicht in W-A.

### 7.5 `due_at = null`

```
due_today := false
overdue   := false
```

Kein Attention-Signal, kein Fehler.

### 7.6 Was W-A tatsächlich liefert

`public.tasks` hat **keine** `due_precision`-Spalte, und W-A führt keine ein. Daher gilt:

> **W-A liefert für jede bestehende Task-Zeile `due_precision = unknown`** — und damit ausschließlich die Geschäftstagsregel.

`day` und `instant` sind im Contract vollständig definiert, aber in W-A **nicht erreichbar**. Sie werden erreichbar, sobald eine spätere Welle die Fälligkeitsabsicht persistiert (G-1). Ein Konsument darf in W-A keine anderen Werte erwarten.

---

## 8. `expected_closing_date` ≠ Work Due

`deals.expected_closing_date` ist in Nora **bereits** umgewidmet zum **„Nächsten Nachfassdatum"** des Vorgangs — dokumentiert in [`01`](01-domain-model.md) („Kein separates Nachfassdatum") und als Guardrail in [`03`](03-data-model-guardrails.md) §1.2 Falle 6 („Kein Ersatz-Nachfassfeld in Notizen oder Aufgaben"). Es ist **keine** Abschlussprognose.

| | `deals.expected_closing_date` | Work Due (`due_at`) |
|---|---|---|
| Gegenstand | Der **Vorgang** | Eine **konkrete Handlung** |
| Bedeutung | Nachfass-/Aufmerksamkeitsdatum | Fälligkeit der Handlung |
| Träger | `deals` (`date`) | Work Carrier |

Die beiden Begriffe werden **nicht synchronisiert, nicht voneinander abgeleitet und nicht gegenseitig ersetzt.**

Ein fälliges `expected_closing_date` kann die Entscheidung **motivieren**: „Hier fehlt konkrete Arbeit." Es **ist** kein Arbeitsgegenstand. Diese Trennung ist keine neue Regel, sondern die Anwendung von [`03`](03-data-model-guardrails.md) Falle 4: *Vorgangsstatus und Aufgabenstatus sind zwei Fakten und werden nicht vermischt.*

---

## 9. Holder- / Zuständigkeitsmodell

| Frage | Antwort | Quelle |
|---|---|---|
| Holder-Identität | `sales.id` (`bigint`) | [`03`](03-data-model-guardrails.md) §2.2 |
| Name eines **bestehenden** Halters | `sales_identities` (alle Zeilen, inkl. deaktivierter) | [`19`](19-user-lifecycle-architecture.md) §7 |
| Gültige **neue** Zuweisungsziele | `sales_directory` (nur aktive) | [`19`](19-user-lifecycle-architecture.md) §8 |
| Darf ein deaktivierter Mitarbeiter Halter bleiben? | **Ja.** INAKTIV ≠ NICHT-EXISTENT | [`03`](03-data-model-guardrails.md) §2.2 |
| Wer erzwingt „Ziel muss aktiv sein"? | `nora_private.guard_active_assignment()` — existiert bereits, `DETAIL = NORA_EMPLOYEE_NOT_ASSIGNABLE` | Production |
| Toleriert der Guard `sales_id = NULL`? | **Ja**, er kehrt sofort zurück | Production |

**Der Anzeigename ist nie die Identität.** Die Identität ist die Holder-ID.

**Holder ist Domain State, keine Security Boundary.** Heute gilt `tasks UPDATE USING can_write()` ohne Ownership-Prädikat: jeder Büro-/Admin-Benutzer darf jede fremde Aufgabe abschließen, umhängen und freigeben. Ob Holder je zur Authorization wird, ist eine Security-Welle (Gate G-7) und **nicht** Teil dieses Vertrags. Als **fachliche Vorbedingung** (z. B. `work.claim` verlangt `holder IS NULL`) ist Holder sehr wohl relevant — siehe Abschnitt 13.

### 9.1 Freie Arbeit (`unassigned`)

`tasks.sales_id` ist nullable; eine neue Assignment-Entity ist **nicht** nötig.

> **Eingefroren.** Die geteilte Funktion `public.set_sales_id_default()` wird **niemals** global geändert, um freie Tasks zu ermöglichen. Sie hängt an **sechs** `BEFORE INSERT`-Triggern: `companies`, `contacts`, `contact_notes`, `deals`, `deal_notes` und `tasks` (u. a. `set_task_sales_id_trigger` und `set_deal_sales_id_trigger`). Eine Änderung des Rumpfes veränderte still die Vorgangsanlage, wo „Default beim Anlegen = aktueller Benutzer" eine dokumentierte Fachregel ist. Eine spätere Claiming-/Unassigned-Welle (Gate G-3) ändert ausschließlich **task-spezifische** Create-/Trigger-Semantik.

**Präzisierung.** Der Trigger feuert **nur `BEFORE INSERT`**. Freigeben (`UPDATE … SET sales_id = NULL`) funktioniert heute bereits; `nora_private.guard_active_assignment()` erlaubt `NULL` bei UPDATE ausdrücklich. Blockiert ist ausschließlich das **Anlegen** freier Arbeit.

---

## 10. Actor Identity und Scope

### 10.1 Der Actor stammt ausschließlich aus der authentifizierten Session

> Der handelnde Actor stammt **ausschließlich** aus der authentifizierten Nora-Session.

Konzeptionell: `auth.uid()` → Nora Employee (`sales.id`).

Der Actor ist **niemals**:

- eine vom Client übergebene `actor_id`
- ein `localStorage`-Wert
- ein Query-Parameter
- ein MCP-Argument

Der heute ausgelieferte Pfad — `HotboardOpenTasks.tsx` (`filter: identity?.id ? { sales_id: identity.id } : {}`), gespeist aus dem `localStorage`-Cache `RaStore.auth.current_sale` (`authProvider.ts`), inklusive stillem `{}`-Fallback, der bei fehlender Identität **alle** Tasks als „meine" zeigt — ist **kein Präzedenzfall** für den Work Contract und wird von ihm nicht fortgeschrieben.

Der gültige Präzedenzfall existiert in Nora bereits: `public.get_global_audit_events` prüft die Autorisierung aus der Session (`nora_private.is_admin()` → `safe_auth_uid()`, gespeist nur aus `request.jwt.claim.sub`) und behandelt `p_actor_sales_id` als reinen Filter.

> Der Begriff „akteursparametrisiert" ist **ersatzlos entfernt**. Er ließ die unzulässige Lesart *Actor-als-Parameter* zu.

### 10.2 Query Subject ≠ Security Actor

Ein Mitarbeiter, nach dem eine Query ggf. filtert, ist ein **Query Subject** — **nicht** die Security Identity.

| Sicht | Actor | Scope / Subject | Default-`state` |
|---|---|---|---|
| **Meine Arbeit** | authentifizierte Session | Subject = Actor selbst; Work mit `holder = Actor` | `open` |
| **Team** | **dieselbe** Session | alles, was dieser Actor gemäß Nora-Security sehen darf — künftig einschließlich unassigned | `open` |
| *(später)* Admin filtert nach Mitarbeiter X | Admin-Session | Subject = Mitarbeiter X, mit eigener Authorization | `open` |

Beide Sichten verwenden **denselben Application Contract**. Kein frei gesetzter `actor_id`-Parameter. Die Default-Zeilenmenge beider Sichten definiert Abschnitt 17.

### 10.3 Der Zwei-Akteure-Test

> Dieselbe Application Query wird unter **zwei getrennt authentifizierten Sessions** zweier echter Mitarbeiter ausgeführt.

**Nicht:** eine Session, die zwei verschiedene `actor_id`-Werte setzt.

---

## 11. Claim- und Assign-Zielrichtung

Beide werden gebraucht; sie sind **nicht dasselbe**. Keine Implementation in diesem Vertrag, keine in W-A.

| | `work.claim` | `work.assign` |
|---|---|---|
| Vorbedingung | `holder IS NULL` | keine Halterbedingung |
| Ziel | **immer** der aktuelle Akteur | ein expliziter aktiver Mitarbeiter |
| Nebenläufigkeit | konditionales Update | Observed-State-Konflikt |
| Konflikt | Verlierer ändert nichts, erhält aktuellen Halter | Abweichender Halter ⇒ vollständiger Rollback |

**Claim-Invariante (eingefroren).** Zwei gleichzeitige Claims auf denselben freien Gegenstand — **exakt einer gewinnt.** Tragfähige Richtung: ein serverseitiges konditionales `UPDATE … WHERE id = ? AND sales_id IS NULL RETURNING …`. Unter `READ COMMITTED` serialisiert die Zeilensperre; der Zweite sieht nach dem Commit des Ersten `sales_id IS NOT NULL`, trifft null Zeilen und verliert. **Keine neue Infrastruktur, kein Advisory Lock, keine Versionsspalte.**

**Assign-Invariante (eingefroren).** `tasks` hat weder `updated_at` noch Versionsspalte. `assign` trägt deshalb den **beobachteten Halter** explizit mit — exakt das etablierte Muster `PrimaryContactIntent` aus [`03`](03-data-model-guardrails.md) §3.1: Absicht statt Rohspalte, ein Transitionskern, beobachteter Halter, vollständiger Rollback bei Abweichung, kanonischer `NoraErrorCode` statt stillem Überschreiben (Präzedenz `NORA_PRIMARY_CONTACT_CHANGED`).

Neue Zuweisungsziele kommen aus `sales_directory` (nur aktive).

---

## 12. Core Actions vs. Contributed Actions

### 12.1 Core Work Actions — gehören zum Work Model

`work.claim` · `work.assign` · `work.complete` · `work.reopen` · später `work.defer` / `work.resume`

### 12.2 Contributed Subsystem Actions — gehören **nicht** zum Work Model

`communication.send_customer_message` · `calendar.create_appointment` · …

Diese Aktionen werden vom jeweiligen Subsystem **registriert**, dürfen dort zusätzliche fachliche Vorbedingungen prüfen (z. B. „existiert eine gültige Empfängeradresse?") und werden dort autoritativ validiert. Das Work Model kennt diese Regeln **nicht** und darf sie nicht kennen. Es macht lediglich die beigetragene Action Capability maschinenlesbar sichtbar.

**In W-A werden keine Subsystem Actions ausgewiesen.** Keine Communication-Architektur wird hier entworfen.

---

## 13. `allowed_actions` — erst bei existierenden Commands

### 13.1 Die zwei Ebenen, die nicht vermischt werden

| | **Authorization** | **Business Precondition** |
|---|---|---|
| Frage | Darf dieser Benutzer diese Art Command grundsätzlich? | Ist diese Aktion im aktuellen Domainzustand zulässig? |
| Heute | `sales.role` (admin/office/viewer) + RLS + `can_write()` | z. B. `work.claim` erfordert `holder IS NULL` |
| Holder darin? | **Nein** — Holder ist heute **keine** Security Boundary | **Ja** — Holder ist sehr wohl fachliche Vorbedingung |

### 13.2 Eingefrorene Formulierung

> **Core allowed actions ergeben sich aus: Lifecycle · Rolle / Authorization · Carrier Capability · konkreten fachlichen Zustandsvorbedingungen (Holder, Terminalzustand).**
>
> `allowed_actions` ist **serverseitig abgeleitet**, wird **nie gespeichert** und ist **nie autoritativ**. Das ausführende Command prüft alles erneut — Rolle, Vorbedingung und Trägerfähigkeit.

### 13.3 Kein `allowed_actions` ohne autoritativen Command

Es existiert heute **kein** autoritativer `work.complete`, `work.reopen`, `work.claim` oder `work.assign`. Belegt durch vollständigen Function-Census: der einzige Task-Application-Command ist `create_quick_capture_task`. Abschluss läuft heute über rohes CRUD (`Task.tsx`, `update("tasks", { done_date })`).

> **Eingefrorene Regel.** Nora bewirbt niemals eine ausführbare Action, für die kein autoritativer Application Command existiert.

Konsequenz: **W-A publiziert kein `allowed_actions`-Feld.** Auch keine `carrier_capabilities`-Abstraktion als Ersatz — W-A ist ein Read-Model-Proof und braucht sie nicht.

`allowed_actions` wird erst in den Contract aufgenommen, wenn eine Work-Command-Welle (Gate G-4) mindestens einen echten autoritativen Command bereitstellt. Dann gilt unverändert Abschnitt 13.2.

---

## 14. Kontextmodell

Ein Work-Gegenstand trägt fachlichen Kontext:

```
context.customer : Kunde   (nullable)
context.contact  : Kontakt (nullable)
context.case     : NICHT in v1
```

**Mindestens ein Kontext ist Pflicht** — das ist bereits DB-Invariante (`tasks_company_or_contact_check`).

### 14.1 `tasks.company_id` ist historisch, nicht berechnet

Er ist der Kundenkontext zum Zeitpunkt der Erstellung bzw. der letzten bewussten Kontextänderung und wird **nie** nachgeführt, wenn der Kontakt später den Kunden wechselt ([`03`](03-data-model-guardrails.md) §1.3 Falle 7a). Eine Abweichung zu `contact.company_id` ist ein **erwarteter Zustand, kein Datenfehler**. Der Work Contract gibt `context.customer` aus der **Aufgabe** aus, nie live vom Kontakt — genau wie das Audit es bereits tut.

### 14.2 `context.customer = null` ist ein legitimer Domainzustand

**Evidenz.** Acht Kontakte haben `company_id IS NULL`. Drei Aufgaben haben `company_id IS NULL` **und** einen Kontakt ohne Kunden. Für diese ist **auf keinem Weg** ein Kundenkontext auflösbar.

> **Eingefroren.** `context.customer = null` bedeutet **„Dieser Arbeitsgegenstand besitzt keinen Kundenkontext."**
>
> Es bedeutet **nicht**: Fehler · nicht geladen · unbekannt · „der Client soll nachauflösen".

Ein MCP-Konsument muss „kein Kundenkontext" von „Feld nicht angefordert" unterscheiden können. Kein Konsument darf einen Kunden nachschlagen, den der Server als `null` ausgewiesen hat.

### 14.3 Kein Case-/Deal-Kontext in v1

`public.tasks` hat **kein** `deal_id`/`case_id`. Vorgangskontext wäre nur per Heuristik herstellbar.

**Evidenz gegen eine Heuristik heute:**

| Messung | Wert |
|---|---|
| Offene Aufgaben mit **null** erreichbaren aktiven Vorgängen | **6 von 11** |
| Aktive Vorgänge mit **irgendeiner** offenen Aufgabe | **4 von 12** |
| Aktive Vorgänge mit leerem/`NULL` `contact_ids` | **8 von 12** |
| Kunden mit mehr als einem aktiven Vorgang | 1 — latente Mehrdeutigkeit |

`deals.contact_ids` ist `bigint[]` **ohne FK-Integrität je Element** (dokumentierte Domain-Debt, [`17`](17-known-issues-and-planned-waves.md) G.2).

> **Eingefroren.** W-A publiziert **kein** `context.case` / `context.deal`. **Keine Deal-Heuristik** — lieber kein Feld als ein geratenes. Eine Vermutung wird niemals als maschinenlesbare Wahrheit ausgegeben.

Die fachliche Zielrichtung bleibt plausibel: freistehende Arbeit soll künftig optional direkt zu einem Vorgang gehören können. Das ist Gate G-2.

---

## 15. Team-Definition

> **Team = alle Arbeitsgegenstände, die der aktuelle Akteur gemäß Nora-Security sehen darf.**

Keine zusätzliche Servicebereichs-Semantik in v1.

**Begründung, evidenzbasiert:**

1. Das ist bereits wörtlich der Ist-Zustand: `create policy "Tasks select active" … using (nora_private.is_active_user())` (`supabase/schemas/05_policies.sql`) — aktive `sales`-Zeile **und** lebende Session, **kein** Pro-Benutzer-Scoping. Alle aktiven Mitarbeiter sehen dieselben offenen Aufgaben.
2. Es gibt **keine** Servicebereichszuordnung an Mitarbeitern — `public.sales` hat keine solche Spalte.
3. Es existieren **zwei unterschiedliche Bereichsvokabulare**: `deals.category` (`fensterservice` | `hausmeisterdienst`) und `checklist_runs.service_area_code` (`FENS` | `HAUS` | `IMMO`).
4. Kein belegter Bedarf für komplexeres Scoping bei vier Mitarbeitern.

Feinere Teams / Servicebereiche werden **bewusst später** entschieden (Gate G-8).

**Beide Sichten tragen denselben Contract.** W-A muss beweisen, dass **derselbe** Application Contract „Meine Arbeit" und „Team-Arbeit" trägt — nicht zwei Queries, sondern eine parametrisierte. Finale API-Namensgebung wird hier **nicht** erzwungen.

---

## 16. Attention / Derived Read State

### 16.1 Die drei Ebenen

| Ebene | Inhalt | Gespeichert? |
|---|---|---|
| **Domain State** | `state`, `holder`, `due_at`, `due_precision`, Kontext, Completion Provenance | **Ja** |
| **Derived Read State** | `actionable`, `overdue`, `due_today`, `is_mine`, `is_unassigned`, `allowed_actions`, `attention` | **Nie** |
| **Presentation** | Neu · Heute · Überfällig · Wartet · Badges · Farben · Icons · Routing | **Nie im Contract** |

### 16.2 Harte Regeln

- **Kein abgeleiteter Read-State wird gespeichert.**
- **Kein Presentation-Begriff wird Domain State.**
- **Kein Konsument — UI, MCP oder Automation — berechnet Core-Domainregeln selbst.**
- Geschäftszeitzone für jeden Read-State: **`Europe/Berlin`**, serverseitig (Abschnitt 7).

### 16.3 `actionable`

```
actionable = state = open AND validity = valid
```

`actionable` bedeutet ausdrücklich **nicht** „mir zugewiesen", **nicht** „fällig" und **nicht** „gehört in den Arbeitskorb". Es ist ein **Ausgabefeld** und **niemals** ein Default-Filter — siehe Abschnitt 17.

### 16.4 Klasse „Neu" ist nicht ableitbar

`tasks` hat **kein `created_at`**. Als Tie-Break taugt `id` (bigserial, monoton) — als **Zeitstempel** taugt er nicht und wird nie als solcher ausgegeben. Eine Präsentationsklasse „Neu" ist auf diesem Träger nicht ableitbar und **nicht** Teil von W-A.

### 16.5 „Klärungsbedarf"

Noch **keine** automatische Work-Erzeugung aus `deals.expected_closing_date`. Es besteht keine harte Architekturabhängigkeit — das Read Model ist trägerbasiert und funktioniert vollständig ohne diese Klasse. **Default gilt: NICHT in W-A.**

Falls sie später entsteht (Gate G-9), ist sie eine **Read-Model-Klasse**: kein Work Domain Object, kein Task, kein persistierter Work State. Endstatus müssen dann ausgeschlossen werden — die Evidenz zeigt, warum: alle zwölf aktiven Vorgänge sind nach ECD fällig oder überfällig, sieben davon ohne offene Arbeit, und **zwei dieser sieben stehen im Status `abgeschlossen`** (insgesamt fünf aktive Vorgänge in einem Endstatus tragen noch ein ECD).

---

## 17. Arbeitskorb — operative Default-Query

Der Arbeitskorb ist Read Model und Produktoberfläche (Abschnitt 1). Seine Default-Query ist hiermit festgelegt.

Zwei Ebenen, die **nie** vermischt werden:

> **Der allgemeine Work Contract** kann `state = open` **und** `state = done` darstellen. Beide Zustände bleiben gültiger Bestandteil des Work Read Models.
>
> **Die operative Arbeitskorb-Query** („Meine Arbeit", „Team-Arbeit") liefert standardmäßig **ausschließlich `state = open`** — und darin **beide** Validity-Zustände.

### 17.1 Default-Scope

**Default-Scope = `state = open`.** Validity ist **kein** Ausschlusskriterium.

| `state` | `validity` | im Default-Arbeitskorb |
|---|---|---|
| `open` | `valid` | **ja** |
| `open` | `incomplete` | **ja** |
| `done` | `valid` | nein |
| `done` | `incomplete` | nein |

**Erledigte Arbeit.** `state = done` wird **nicht** standardmäßig geliefert. Erledigte Work Items sind ausschließlich über einen **expliziten Query-Parameter bzw. expliziten Scope** anforderbar.

> Der konkrete Parametername wird im Freeze **nicht** festgelegt. Kandidaten wie `include_done`, `state`, `scope` gehören in die W-A-Implementierungsplanung — genau wie RPC-Name und Signatur (Abschnitt 21.1).

### 17.2 `actionable` ist niemals der Default-Filter

`actionable` bleibt ein serverseitig abgeleitetes **Ausgabefeld**.

> **Begründung, verbindlich.** `actionable` bündelt `state` und `validity`. Als Filter eingesetzt entfernt es offene `incomplete`-Rows und bricht die Zusage aus Abschnitt 5.2, dass eine unvollständige Zeile nicht still aus dem Read Model verschwindet. Der Default-Scope filtert deshalb **nur** über `state`.

Korbzugehörigkeit und Handlungsfähigkeit sind zwei verschiedene Aussagen.

### 17.3 Unvollständige Rows im Korb

Eine offene Row mit `validity = incomplete` erscheint im Default-Arbeitskorb — mit `title = null`, `validity = incomplete`, `invalid_reason = missing_title` und `actionable = false`. Sie wird als solche ausgewiesen, **nicht repariert, nicht ersetzt, nicht ausgeblendet** (Abschnitt 5.2).

### 17.4 Die beiden Sichten

**Meine Arbeit** = alle **sichtbaren offenen** Work Items, deren Holder der authentifizierte Actor ist. Einschließlich `validity = incomplete`, falls eine solche Row existiert.

**Team-Arbeit** = alle **sichtbaren offenen** Work Items im erlaubten Scope. Einschließlich `validity = incomplete`. Künftig einschließlich unassigned.

---

## 18. Audit-, Operation- und Idempotenz-Prinzipien

### 18.1 Audit-Namensprinzip (eingefroren)

> **Application Commands sprechen `work.*`. Das Audit bleibt trägerspezifisch `task.*`.**

Heute existieren: `task.created` · `task.updated` · `task.completed` · `task.reopened` · `task.deleted`. `nora_private.audit_task_changes()` erfasst bereits `sales_id`, ein Halterwechsel ist also als `task.updated` mit Diff auditiert — aber **nicht als Geschäftsereignis erkennbar**.

**Prinzip.** Eine echte neue Task-Transition soll später als **eigenes fachliches Audit-Ereignis** erscheinen, wenn sonst relevante Semantik in einem unspezifischen `task.updated` verloren ginge. Der Stream ist append-only — die Entscheidung über das Vokabular fällt **vor** der ersten Transition, nicht danach. **Keine neuen Eventtypen werden durch diesen Vertrag implementiert.** Audit-Contract: [`13`](13-crm-audit-retention.md).

### 18.2 Operation und Idempotenz

- `operation_id` (Korrelation) und `idempotency_key` (fachliche Retry-Absicht) sind **zwei verschiedene Konzepte** und werden nie vermischt ([`03`](03-data-model-guardrails.md) §3.4, Falle 38; [`23`](23-operations-errors-feedback.md) §2).
- `audit_events.request_id` trägt trotz des historischen Spaltennamens die `operation_id` — keine zweite Request-ID.
- Idempotenz läuft über die vorhandenen Primitive `nora_private.idempotency_check` / `idempotency_persist`, mit Fingerprint über die **Allowlist der schreibbaren Felder**, nie über rohe Client-JSON.
- Fehleridentität ist **immer** ein kanonischer `NoraErrorCode` als `DETAIL = 'NORA_<CODE>'`. Freitext-/Regex-Erkennung definiert niemals die Identität eines neuen fachlichen Codes ([`03`](03-data-model-guardrails.md) §6).

> **Befund, protokolliert (korrigiert).** `operationCatalog.ts` enthält heute **keinen** `task.*`-Eintrag; `AddTask.tsx` und `Task.tsx` schreiben über rohes `useCreate`/`useUpdate` — ohne `operation_id`, ohne Idempotenz, ohne Error-Contract-Pfad. **Ein korrelierter Task-Schreibvorgang existiert jedoch bereits:** `quickCapture.createTask` (`resourceType = "tasks"`) → `executeCreateQuickCaptureTask.ts` → Application Command `create_quick_capture_task`. Eine künftige Core Work Transition wäre deshalb **nicht** der erste korrelierte Task-Schreibvorgang überhaupt, sondern der **erste im Core-Work-Lifecycle** (Abschnitt 12.1). Das bereits etablierte Operation-Vokabular wird **wiederverwendet** — `quickCapture.createTask` auf der Task-Seite, `deal.assign` als vorbereiteter Katalogeintrag —; ein zweites paralleles Vokabular wird **nicht** erfunden.

### 18.3 Verbotene Abkürzung

`enforce_task_company_context()` trägt eine GUC-Hintertür (`current_setting('nora.skip_task_context_check', true)`). **Für Work Commands ausdrücklich verboten** — ein `set local` dort schaltete die Kontextinvariante still ab.

---

## 19. LLM/MCP-Readiness

Nora UI, MCP-Konsumenten und Automationen verwenden später **dieselben** Application Queries und Commands.

**Verboten:**

- SQL für das LLM
- PostgREST-Rohtabellenzugriff
- `service_role` im KI-Client
- clientseitiges Nachbauen von Lifecycle
- clientseitig berechnete `allowed_actions`
- KI-eigene Business Rule
- UI-Routen, Farben, Icons oder fertige Presentation-Texte im Contract
- Titel-/Namensstrings statt stabiler IDs

**Erlaubt:** Das LLM darf suchen, lesen, zusammenfassen, interpretieren, Vorschläge erzeugen und Commands **anfordern**. Domainzustand verändert ausschließlich ein autorisierter Nora Application Command, der Rechte und Vorbedingungen **selbst erneut** prüft.

### 19.1 Konsument-Garantien

Der Contract stellt sicher, dass ein nicht-visueller Konsument **niemals**:

| darf nicht | verhindert durch |
|---|---|
| Actor Identity frei behaupten | Abschnitt 10.1 — Actor nur aus Session |
| bei fehlender Kunden-ID raten | `context.customer` ist explizit `null` (14.2) |
| Vorgangskontext raten | Feld existiert nicht (14.3) |
| `due_precision` selbst interpretieren | Abschnitt 7 — jeder Wert hat definierte Wirkung |
| `overdue` selbst nachrechnen | serverseitig berechnet (21.3) |
| Holder-Namen als Identität verwenden | Identität ist die Holder-ID, nicht der Anzeigename (9) |
| eine Action aufrufen, die Nora nur behauptet | Abschnitt 13.3 — kein `allowed_actions` ohne Command |
| Rohspalten von `tasks` kennen müssen | Read Model trägt ausschließlich Contract-Felder |
| eine unvollständige Row für gültig halten | Abschnitt 5.2 — `validity` maschinenlesbar |
| eine erledigte Aufgabe für offene Arbeit halten | Abschnitt 17.1 — Default-Scope `state = open` |

Diese Richtung ist **keine neue Entscheidung**: [`03`](03-data-model-guardrails.md) §5 Falle 36 legt bereits fest, dass künftige KI-/Automatisierungs-Konsumenten über anwendungsseitige Read-Models gehen, und [`17`](17-known-issues-and-planned-waves.md) G.2 führt „Application Queries / Read Models" als offenen Punkt. **W-A ist die erste Umsetzung einer bestehenden Entscheidung, keine neue Richtung.**

**W-A baut kein MCP.** Es schafft den ersten stabilen maschinenlesbaren Query Contract, auf den MCP später aufsetzen kann (Gate G-11).

---

## 20. W-A — Scope

W-A ist der **Architecture-/Read-Model-Proof**: der Beweis, dass der Work Contract über einen realen Carrier serverseitig und aktorrichtig projizierbar ist. W-A ist **kein** Produkt-Feature.

**Träger: ausschließlich `public.tasks`.** Read-only, keine Writes.

### 20.1 W-A enthält NICHT

`allowed_actions` · `context.case`/`context.deal` · Checklisten · `deferred` · `cancel` · Claim-Write · Assign-Write · Communication · Kalender · Anhänge · MCP · Hotboard-Änderung · Klärungsbedarf · Klasse „Neu" · Team-/Servicebereichs-Scoping · neue Work-Tabelle · Änderung an `public.tasks`-Spalten · Lifecycle-Spalten · `deal_id` · `due_precision`-Spalte · jede neue fachliche Persistenz.

### 20.2 Was W-A verändern darf — und was nicht

> **W-A verändert keine fachlichen Domain-Tabellen und keine Work-Persistenz.**

Insbesondere: keine Lifecycle-Persistenz, keine Spaltenänderung an `public.tasks`, keine Änderung an `set_sales_id_default()`.

---

## 21. W-A — PostgreSQL Application Query / RPC

### 21.1 Ausführungsort

> **W-A wird als echte serverseitige PostgreSQL Application Query / RPC umgesetzt.**

**Begründung.** Nora ist ein statisches SPA (`"build": "tsc && vite build"`, kein `api/`, kein SSR-Framework); serverseitig existieren nur Postgres und die deployten Edge Functions. Global Search (`misc/globalSearch.ts`) ist Browser-Orchestrierung über PostgREST und **kein** serverseitiger Präzedenzfall. Die Kombination *serverseitige Query* + *keine Businesslogik im Client* + *keine Migration* + *keine neue View/RPC* ist in Noras Runtime nicht realisierbar.

**Keine Edge Function nur zur Vermeidung einer Migration.** Der Ausführungsort ist bewusst der, an dem Noras bestehende serverseitige Read-Contracts liegen (`get_global_audit_events`, `get_entity_audit_events`, `employee_email_delivery_status`, `get_audit_storage_stats`).

**Im Freeze bewusst noch nicht festgelegt** (gehört in die W-A-Implementierungsplanung): finaler RPC-Name · exakte SQL-Signatur · `SECURITY INVOKER` vs. `SECURITY DEFINER` · konkrete Query-Implementation · Parametername für den expliziten `done`-Scope · Indexe ohne belegten Bedarf.

### 21.2 Eine minimale DB-Migration ist zulässig

> Eine **minimale DB-Migration** zur Bereitstellung dieses read-only Contracts und seiner **notwendigen Grants** ist zulässig.

Die frühere Forderung „W-A ist migrationsfrei" **entfällt**. An ihre Stelle tritt die Regel aus Abschnitt 20.2.

> **Bekannte Implementierungsvoraussetzung, keine Freeze-Entscheidung.** Ein Resolver `auth.uid() → sales.id` existiert heute nicht (`nora_private` kennt `safe_auth_uid`, `current_role`, `is_admin`, `can_write`, `has_role`, `is_active_user` — aber kein `current_sales_id()`). Er gehört zum read-only Contract und fällt unter die zulässige minimale Migration.

Wer diese Migration schreibt, liest zusätzlich [`21`](21-agent-runbooks.md) Sektion 1 (Ledger-Hazard) sowie [`22`](22-security-and-access.md) und [`21`](21-agent-runbooks.md) Sektion 4/5.

### 21.3 Read Model Contract

| Feld | Quelle / Ableitung | Semantik |
|---|---|---|
| `work_id` | `nora_entity_uuid('task', id)` | stabile, je Zeile eindeutige Work-Identität (UUIDv5 über `'task:<id>'`). **Kein Autorisierungstoken** — berechenbar, nicht geheim. Bereits die Audit-Entity-Id; **keine neue ID-Welt** |
| `carrier` | konstant `task` | benennt den Träger, ohne Rohspalten zu exponieren |
| `title` | `tasks.text`, **normalisiert** | nullable; auf `null` normalisiert, wenn `tasks.text IS NULL` **oder** `btrim(tasks.text) = ''` — für `NULL`, `''` und `'   '` gilt damit einheitlich `validity = incomplete`, `invalid_reason = missing_title`, `title = null` (Abschnitte 5.2 und 17.3). Nichtleerer Text bleibt unverändert. `null` ⟺ `validity = incomplete`. Nie clientseitig ersetzt |
| `work_type` | `tasks.type` | nullable, **offener String**. Vokabular liegt serverseitig in `public.configuration.config.taskTypes`, ist aber **nicht** per FK/CHECK erzwungen — der Konsument darf keine geschlossene Menge annehmen |
| `validity` | abgeleitet | `valid \| incomplete` |
| `invalid_reason` | abgeleitet | `null \| missing_title` |
| `state` | `done_date IS NULL` | `open \| done`. Kein `cancelled` in v1 |
| `context.customer` | `tasks.company_id` | nullable — **explizit `null`, nie geraten** |
| `context.contact` | `tasks.contact_id` | nullable. Schema-CHECK garantiert: mindestens eines von beiden ist gesetzt |
| `holder` | `tasks.sales_id` → Identität | nullable. Auflösbar über `public.sales_identities` (enthält auch deaktivierte Mitarbeiter). **Der Anzeigename ist nie die Identität** |
| `is_mine` | `holder = Actor` | `false`, wenn `holder` null |
| `is_unassigned` | `tasks.sales_id IS NULL` | siehe Anmerkung unten |
| `due_at` | `tasks.due_date` | nullable |
| `due_precision` | konstant `unknown` in W-A | Abschnitt 7.6 |
| `actionable` | abgeleitet | `state = open AND validity = valid`. **Ausgabefeld, niemals Default-Filter** (Abschnitt 17.2) |
| `overdue` | abgeleitet, Abschnitt 7 | serverseitig berechnet |
| `due_today` | abgeleitet, Abschnitt 7 | serverseitig berechnet |

> **Anmerkung zu `is_unassigned`.** Heute erreichbar, aber leer. `set_task_sales_id_trigger` (BEFORE **INSERT**) füllt `sales_id` aus der Session; `nora_private.guard_active_assignment()` erlaubt `NULL` bei UPDATE ausdrücklich. Bestand: 0 Zeilen. Das Feld ist wahrheitsgemäß und wird erst mit der Claiming-Welle (G-3) fachlich relevant. **`set_sales_id_default()` darf dafür nicht geändert werden** (Abschnitt 9.1).

### 21.4 Sortierung und Pagination

**Totale, deterministische Ordnung:**

```
ORDER BY due_at ASC NULLS LAST, work_id ASC
```

Total, weil `work_id` je Zeile eindeutig ist. `NULLS LAST` ist fachlich gewollt: überfällig → heute → künftig → unbefristet.

**Pagination:** Keyset/Cursor über das vollständige Sorttupel `(due_at, work_id)` — nie über Offset. Stabilität (keine Lücken, keine Duplikate) gilt über einen **unveränderten Zeilenbestand**; ändert sich `due_at` einer Zeile zwischen zwei Seiten, ist Verschiebung inhärent und kein Contract-Bruch.

> Sortierung und Pagination werden über die **Default-Zeilenmenge** der jeweiligen Sicht geprüft (Abschnitt 17), nicht über den Gesamtbestand.

> **Zu Indexen.** Der bestehende Teilindex `tasks_due_date_open_idx on public.tasks (due_date) where done_date is null` (`supabase/schemas/01_tables.sql`) deckt genau den Default-Zugriffspfad ab — und trägt *kein* Validity-Prädikat. Die Zustandsgrenze liegt damit dort, wo Nora sie heute schon zieht. Ein **Indexbedarf ist dennoch nicht belegt und wird im Freeze nicht entschieden.**

### 21.5 Security-Grenze

Der spätere RPC **muss**:

- den Actor aus der authentifizierten Session ableiten,
- die vorhandene Nora-Security respektieren,
- **keiner** Client-Identität vertrauen,
- **keine** `service_role`-Semantik an den Client geben,
- **keine** Rohdaten außerhalb des Work Contracts leaken.

`SECURITY INVOKER` vs. `SECURITY DEFINER` wird **jetzt nicht entschieden** — das gehört in den W-A-Implementierungs- und Security-Review. Falls `SECURITY DEFINER` gewählt wird, muss die Function ihre Authorization vollständig selbst durchsetzen und die Grants explizit begrenzen (`revoke all` vor `grant`, [`03`](03-data-model-guardrails.md) §4; [`22`](22-security-and-access.md)).

> **Benannte Kollision mit offenen Tracks.** Eine `SECURITY DEFINER` Application Query umgeht `is_active_user()` und **vergrößert** die Fläche, die die offene Security-Welle ([`17`](17-known-issues-and-planned-waves.md) A) vorfindet. W-A muss so gebaut werden, dass es sie nicht vergrößert. Ebenfalls benannt: für eine serverseitige Application Query existiert heute **kein** FakeRest-Äquivalent ([`03`](03-data-model-guardrails.md) §5) — eine reale, bewusst akzeptierte W-A-Kost. Und: es gibt **zwei** belegte stille Work-Löschpfade — `tasks_company_id_fkey ON DELETE CASCADE` löscht Arbeit bei einer **Kundenlöschung** still mit, und `delete_contact_only_tasks_before_contact_delete_trigger` (BEFORE DELETE auf `public.contacts` → `nora_private.delete_contact_only_tasks()`) löscht bei einer **Kontaktlöschung** die kontaktgebundenen Aufgaben **ohne** Customer-Kontext (`company_id IS NULL`); Aufgaben mit `company_id` überleben und behalten diesen historischen Kontext. Normativ unverändert: **kein Work-Pfad darf Aufgaben als dauerhaft annehmen.**

---

## 22. W-A PASS/FAIL

**PASS**, wenn **eine** serverseitige Application Query alle 21 Punkte erfüllt. **Ein einziger FAIL-Punkt ist ein FAIL.**

| # | Kriterium |
|---|---|
| 1 | Eine serverseitige PostgreSQL Application Query / RPC existiert |
| 2 | Sie wurde durch eine **minimale** DB-Migration ausgeliefert |
| 3 | Keine Domain-Tabelle wurde für W-A strukturell verändert |
| 4 | Dieselbe Query läuft unter **zwei getrennt authentifizierten echten Mitarbeiter-Sessions** |
| 5 | Actor wird serverseitig aus der Session abgeleitet |
| 6 | **Meine-Arbeit-Sicht liefert genau die offenen Work Items des authentifizierten Actors** — `state = open` **und** `holder = Actor`, validity-unabhängig. `done` erscheint nicht |
| 7 | **Team-Sicht liefert genau die offenen für den Actor sichtbaren Work Items** — `state = open`, validity-unabhängig. `done` erscheint nicht |
| 8 | Stabile totale Sortierung |
| 9 | Stabile Pagination ohne Lücken/Duplikate **über die Default-Zeilenmenge** aus Kriterium 6 bzw. 7 |
| 10 | `context.customer = null` bleibt explizit |
| 11 | Keine Deal-Heuristik |
| 12 | `due_at` darf `null` sein |
| 13 | `due_precision` bestehender Tasks = `unknown` |
| 14 | `overdue`/`due_today` serverseitig nach der Präzisionssemantik aus Abschnitt 7 |
| 15 | Unvollständige Row maschinenlesbar erkennbar — und, falls offen, **im Default-Arbeitskorb enthalten**, nicht ausgefiltert |
| 16 | Keine Datumsarithmetik im Konsumenten (`tasksPredicate.ts` wird von der Fläche nicht importiert) |
| 17 | Keine Lifecycle-Businesslogik im Konsumenten (kein clientseitiges `done_date`-Filtern, kein clientseitiges `slice` als Domainregel) |
| 18 | Kein `allowed_actions` in W-A |
| 19 | Keine Writes |
| 20 | Kein MCP |
| 21 | Keine Hotboard-Änderung |

### 22.1 Testanker

Zahlen sind **Testanker, keine Contract-Bestandteile.** Stand des Freeze, read-only erhoben:

| Zahl | Bedeutung |
|---|---|
| **11** | **Default operative Work Queue** — offene Tasks; Anker für die Team-Sicht (Kriterien 7 und 9) |
| **15** | **gesamter vorhandener Task-Bestand** — Anker ausschließlich für den ungefilterten allgemeinen Work Contract bzw. einen explizit angeforderten Scope inklusive `done` |
| **4** | erledigte Tasks — nur über expliziten Scope erreichbar, nie im Default |
| **3 Holder** | Meine-Arbeit-Anker ist **pro Holder** die Menge seiner offenen Tasks, keine feste Gesamtzahl |
| **0 unassigned** | Feld wahrheitsgemäß, fachlich erst mit der Claiming-Welle relevant (Abschnitt 21.3) |
| **0 unvollständige Rows** | Kriterium 15 ist mit dem heutigen Bestand **nicht aus Live-Daten belegbar** und bleibt Contract-Zusage. Wie es geprüft wird, gehört in die W-A-Implementierungsplanung |

Arithmetisch geschlossen: 11 offen + 4 erledigt = 15 gesamt.

**Einschränkung, bewusst akzeptiert.** Da der Bestand null unassigned Tasks hat, kann `is_unassigned` in W-A nur durch die **Vertragsform** bewiesen werden, nicht durch Bestandsdaten. Freie Arbeit **anzulegen** ist nicht migrationsfrei (Abschnitt 9.1) und W-A schreibt nicht.

---

## 23. Spätere Decision Gates

Bewusst offene Punkte. Jedes Gate braucht eigenen Entwurf, eigene Review und eigenen Release. Keines ist durch diesen Freeze begonnen.

| Gate | Gegenstand | Voraussetzung |
|---|---|---|
| **G-1 Lifecycle Persistence** | `deferred`, `reappear_at`, `deferral_reason`, `due_precision` auf `tasks` | Nach W-A-PASS; eine Migrationswelle; behebt zugleich das 02:00-Artefakt aus Abschnitt 7.4 |
| **G-2 Direct Case Context for Tasks** | Optionaler echter FK `tasks.deal_id`; kein polymorphes `entity_type`/`entity_id` | Löst die Entscheidung „Unified Tasks Wave" ausdrücklich ab und muss diese Ablösung begründen |
| **G-3 Claiming & Unassigned** | Task-spezifische Create-/Trigger-Semantik für freie Arbeit | Niemals über `set_sales_id_default()` |
| **G-4 Work Command Layer** | Erste `work.*` Application Commands + Audit-Vokabular | Nach G-1/G-3 |
| **G-5 Cancel** | Eigene Domain-, Schema- und Audit-Welle | Nur bei belegter Produktanforderung |
| **G-6 Checklist Run as Carrier** | Halter- und Fälligkeitssemantik für Läufe | Belegter fachlicher Bedarf |
| **G-7 Holder as Authorization** | Ownership-Prädikat in RLS/Commands | Security-Welle |
| **G-8 Team / Servicebereich** | Feineres Scoping | Belegter Bedarf |
| **G-9 Klärungsbedarf** | Read-Model-Klasse mit Endstatus-Ausschluss | Produktentscheidung |
| **G-10 Arbeitskorb vs. Hotboard/Arbeitsboard** | Ablösungsplan der bestehenden Flächen | Produktentscheidung |
| **G-11 MCP Tool Surface** | `listMyWork`, `getWork`, `work.*` als Werkzeuge | Nach G-4 |

---

## 24. Decision Matrix

Der vollständige Stand der eingefrorenen Entscheidungen. `FROZEN` = geschlossen, nicht erneut zu öffnen. `REJECTED` = für v1 abgelehnt. `DEFERRED` = bewusst offen, mit benanntem Gate.

| # | Entscheidung | Status | Begründung |
|---|---|---|---|
| D-1 | Work = Vertrag über bestehenden Trägern, keine `work_items`-Tabelle | **FROZEN** | Kein Befund verlangt eine Universal-Entity |
| D-2 | Kein polymorphes `entity_type`/`entity_id` | **FROZEN** | Präzedenz [`03`](03-data-model-guardrails.md) §1.8: bei Anhängen genau deswegen abgelehnt (FK-Integrität) |
| D-3 | `public.tasks` ist der einzige Work Carrier in v1 | **FROZEN** | Einziger Kandidat, der F2 **und** F3 speichert |
| D-4 | `checklist_run_item` ist kein Work Carrier | **FROZEN** | Fällt bei F2 und F3 durch; 24/35 Arbeitskorbzeilen wären Checklistenpunkte |
| D-5 | `checklist_run` ist kein Work Carrier in v1 | **FROZEN** | Kein Halter, keine Fälligkeit — trotz stärkerem Lifecycle |
| D-6 | `checklist_run` als künftiger Carrier-Kandidat | **DEFERRED** (G-6) | Wiederaufnahme nur mit belegter Halter- und Fälligkeitssemantik |
| D-7 | Carrier Capability ≠ Row Validity | **FROZEN** | Trägerfähigkeit sagt nichts über die Gültigkeit einer Zeile |
| D-8 | Work-Abgrenzungstest Frage 3 = **Ausdrucksfähigkeit**, nicht Pflicht | **FROZEN** | Arbeit ohne Termin ist legitime Arbeit |
| D-9 | `due_at = null` ist ein gültiger Work-Zustand | **FROZEN** | Unbefristete Arbeit ist normal, kein Fehlerzustand |
| D-10 | Row Validity: `validity` + `invalid_reason = missing_title` | **FROZEN** | Schema erzwingt die Mindestbedingungen nicht; zweiter Schreibpfad umgeht das Formular bereits |
| D-11 | Unvollständige Row verschwindet nie still; kein Client-Repair | **FROZEN** | Maschinenlesbare Ehrlichkeit statt stiller Korrektur |
| D-12 | `work.cancel` auf `tasks` | **REJECTED (v1)** | `done_date`-Abbildung erzeugt falsches `task.completed` in append-only Audit |
| D-13 | `cancelled` im Target Lifecycle | **REJECTED** (G-5) | Bedarf unbelegt; `checklist_runs.status='cancelled'` existiert und wurde nie benutzt. Wort bleibt reserviert |
| D-14 | `deferred` + `reappear_at`, `actionable` abgeleitet, kein Cron/Worker | **FROZEN (Semantik)** | Folgt [`19`](19-user-lifecycle-architecture.md) §4 / [`03`](03-data-model-guardrails.md) §5: abgeleiteter Status wird nie gespeichert |
| D-15 | `deferred`-Persistenz | **DEFERRED** (G-1) | Verlangt trägerspezifische Migration; nicht W-A; kein Universal-Persistenzmodell dafür |
| D-16 | Fälligkeit: `due_at` + `due_precision` (`day \| instant \| unknown`) | **FROZEN** | Einzige Variante, die „heute erledigen" **und** „bis 14:00" ohne impliziten Cast ausdrückt |
| D-17 | **Jeder `due_precision`-Wert hat eine definierte Wirkung**; `overdue` bei `instant` = `due_at < now()`; `due_today` + `overdue` gleichzeitig zulässig | **FROZEN** | Ein Diskriminator ohne Wirkung war ein Contract-Defekt. `due_today` = Kalendertag, `overdue` = Frist — zwei Fragen |
| D-18 | Geschäftszeitzone `Europe/Berlin`, serverseitig | **FROZEN** | Eine Zeitzone, nie die Browser-Zeitzone |
| D-19 | `due_precision = unknown` auf `tasks`; Uhrzeit-Heuristik verboten | **FROZEN** | Träger hält die Absicht nicht fest; Tri-State-Präzedenz (`liveness`, `mail_kind`) |
| D-20 | `create_quick_capture_task(date)` → 02:00-Artefakt | **DEFERRED** (G-1, protokollierter Defekt) | Behebung in der Lifecycle-Migrationswelle, nicht in W-A |
| D-21 | ECD ≠ Work Due; keine Synchronisation/Ableitung/Ersetzung | **FROZEN** | ECD ist bereits „Nächstes Nachfassdatum" ([`01`](01-domain-model.md), [`03`](03-data-model-guardrails.md) Falle 6); Falle 4 |
| D-22 | Holder = `sales.id`; Namen `sales_identities`, Ziele `sales_directory` | **FROZEN** | [`03`](03-data-model-guardrails.md) §2.2, [`19`](19-user-lifecycle-architecture.md) §7/§8; `guard_active_assignment()` erzwingt es bereits |
| D-23 | Holder ist **keine** Authorization, aber **sehr wohl** Business Precondition | **FROZEN** | `tasks UPDATE USING can_write()`, kein Ownership-Prädikat |
| D-24 | Holder als Authorization | **DEFERRED** (G-7) | Security-Welle, außerhalb dieses Vertrags |
| D-25 | `set_sales_id_default()` wird nie global geändert | **FROZEN** | Geteilt zwischen `tasks` und `deals`; Änderung veränderte still die Vorgangsanlage |
| D-26 | **Actor ausschließlich aus der authentifizierten Session** | **FROZEN** | Begriff „akteursparametrisiert" entfernt; der Hotboard-`localStorage`-Pfad ist kein Präzedenzfall |
| D-27 | Query Subject ≠ Security Actor; Mitarbeiterfilter hat eigene Authorization | **FROZEN** | Präzedenz `get_global_audit_events`: Autorisierung aus Session, `p_actor_sales_id` ist reiner Filter |
| D-28 | Zwei-Akteure-Test = **zwei getrennte Sessions** | **FROZEN** | Schließt die unzulässige Lesart „eine Session, zwei `actor_id`" aus |
| D-29 | Claim = konditionales Update auf `sales_id IS NULL`, genau einer gewinnt | **FROZEN (Richtung)** | Ohne neue Infrastruktur unter `READ COMMITTED` tragfähig |
| D-30 | Assign = explizite Absicht + beobachteter Halter + ein Transitionskern | **FROZEN (Muster)** | [`03`](03-data-model-guardrails.md) §3.1 `PrimaryContactIntent` |
| D-31 | Core Actions vs. Contributed Subsystem Actions strikt getrennt | **FROZEN** | Work Model kennt keine Communication-/Calendar-Regel |
| D-32 | `allowed_actions` abgeleitet, nicht gespeichert, nicht autoritativ | **FROZEN** | Command prüft erneut |
| D-33 | **Kein `allowed_actions` in W-A**, keine `carrier_capabilities`-Ersatzabstraktion | **FROZEN** | Kein autoritativer `work.*`-Command existiert; Nora bewirbt keine Action ohne Command |
| D-34 | `context.customer = null` ist legitimer Domainzustand | **FROZEN** | Drei Aufgaben, acht Kontakte ohne Kunden |
| D-35 | `tasks.company_id` ist historisch, nie nachgeführt | **FROZEN** | [`03`](03-data-model-guardrails.md) §1.3 Falle 7a |
| D-36 | `context.case` / `context.deal` in W-A | **REJECTED** | 6/11 Aufgaben ohne erreichbaren Vorgang; `contact_ids` ohne FK-Integrität |
| D-37 | Decision Gate „Direct Case Context for Tasks" | **DEFERRED** (G-2) | Löst „Unified Tasks Wave" ausdrücklich ab; kein polymorphes Modell |
| D-38 | Team v1 = alles gemäß Nora-Security Sichtbare | **FROZEN** | Bereits RLS-Ist-Zustand; keine Servicebereichsspalte an `sales`; zwei Bereichsvokabulare |
| D-39 | Feinere Teams / Servicebereiche | **DEFERRED** (G-8) | Bewusst später, kein belegter Bedarf bei vier Mitarbeitern |
| D-40 | Kein abgeleiteter Read-State wird gespeichert; kein Presentation-Begriff wird Domain State | **FROZEN** | [`03`](03-data-model-guardrails.md) §5 Falle 35, [`19`](19-user-lifecycle-architecture.md) §4 |
| D-41 | **Arbeitskorb-Default = `state = open`, beide Validity-Zustände** | **FROZEN** | Legt die Zeilenmenge fest, gegen die geprüft wird; Ausschluss nur über `state`, nie über `validity` |
| D-42 | `done` nur über **expliziten** Scope; Parametername im Freeze offen | **FROZEN** | Erledigte Arbeit ist Teil des Contracts, nicht des operativen Korbs |
| D-43 | **`actionable` ist Ausgabefeld, niemals Default-Filter** | **FROZEN** | Es bündelt `state` und `validity`; als Filter entfernte es offene `incomplete`-Rows und bräche D-11 |
| D-44 | Klasse „Neu" / Recency-Sortierung | **REJECTED (v1)** | Kein `created_at` auf `tasks`; `id` ist Tie-Break, kein Zeitstempel |
| D-45 | „Klärungsbedarf" in W-A | **REJECTED** | Keine harte Architekturabhängigkeit |
| D-46 | „Klärungsbedarf" als spätere Read-Model-Klasse | **DEFERRED** (G-9) | Endstatus müssen ausgeschlossen werden (fünf aktive Vorgänge im Endstatus mit ECD) |
| D-47 | Commands `work.*`, Audit `task.*` | **FROZEN (Namensprinzip)** | Append-only; Vokabular vor der ersten Transition entscheiden |
| D-48 | Neue Audit-Eventtypen | **DEFERRED** (G-4) | Nur Prinzip definiert, keine Implementation |
| D-49 | `operation_id` ≠ `idempotency_key`; Fehleridentität = kanonischer `NoraErrorCode` | **FROZEN** | [`03`](03-data-model-guardrails.md) §3.4 Falle 38 und §6; [`23`](23-operations-errors-feedback.md) §2 |
| D-50 | GUC-Hintertür `nora.skip_task_context_check` für Work Commands | **REJECTED** | Ein `set local` schaltete die Kontextinvariante still ab |
| D-51 | Work-Identität = `nora_entity_uuid('task', id)` | **FROZEN** | `IMMUTABLE`, deterministisch, bereits Audit-Entity-Id. Keine neue ID-Welt |
| D-52 | Sortierung `due_at ASC NULLS LAST, work_id ASC`; Keyset über `(due_at, work_id)`, nie Offset | **FROZEN** | Total, weil `work_id` eindeutig ist; `NULLS LAST` fachlich gewollt |
| D-53 | Indexbedarf für W-A | **DEFERRED** | Nicht belegt; im Freeze nicht entschieden |
| D-54 | **W-A = serverseitige PostgreSQL Application Query / RPC** | **FROZEN** | Nora ist ein statisches SPA; die Kombination aus v1 war in Noras Runtime nicht realisierbar. Keine Edge Function zur Migrationsvermeidung |
| D-55 | **Minimale DB-Migration für Read Contract + Grants zulässig** | **FROZEN** | Read Contract ist ohne Migration nicht serverseitig herstellbar; „W-A ist migrationsfrei" entfällt |
| D-56 | W-A verändert keine Domain-Tabelle und keine Work-Persistenz | **FROZEN** | Work bleibt Vertrag, keine neue Tabelle |
| D-57 | `SECURITY INVOKER` vs. `SECURITY DEFINER` für W-A | **DEFERRED** | Gehört in den W-A-Implementierungs- und Security-Review |
| D-58 | LLM/MCP über dieselben Application Queries/Commands | **FROZEN** | Bereits entschieden ([`03`](03-data-model-guardrails.md) §5 Falle 36, [`17`](17-known-issues-and-planned-waves.md) G.2) |
| D-59 | MCP-spezifische Architektur in W-A | **REJECTED** (G-11) | W-A schafft nur den Query Contract |
| D-60 | Namen: Work / Arbeitskorb / Hotboard-Arbeitsboard als Legacy | **FROZEN** | Ist-Begriffe bestimmen die Domain-Sprache nicht |

### 24.1 Berührte bestehende Nora-Entscheidungen

| Bestehende Entscheidung | Verhältnis zu diesem Contract |
|---|---|
| **„Unified Tasks Wave" (2026-08-25, `PRODUCTION VERIFIED`)** — *„kein `deal_id`, keine `task_links`-Architektur"*; Guardrail [`03`](03-data-model-guardrails.md) §1.3 Falle 7 | **Nicht geändert, aber ausdrücklich zur Überprüfung gestellt.** Gate G-2 (D-37) ist der einzige zulässige Ort, diese Entscheidung abzulösen — mit eigener Begründung. Bis dahin bleibt sie in Kraft. |
| **Nichts anderes.** | Dieser Contract ändert keine weitere bestehende Nora-Entscheidung. Alle übrigen Festlegungen sind Anwendungen bestehender Guardrails auf eine neue Fläche. |

### 24.2 Bestätigte bestehende Nora-Entscheidungen

| Entscheidung | Ort | Bestätigt durch |
|---|---|---|
| Kunde ≠ Kontakt ≠ Vorgang ≠ Aufgabe; Vorgangsstatus ≠ Aufgabenstatus | [`03`](03-data-model-guardrails.md) §1.1, Falle 4 | Abschnitt 8, 16.5 |
| `tasks.company_id` ist historisch, nie nachgeführt | [`03`](03-data-model-guardrails.md) §1.3 Falle 7a | Abschnitt 14.1 |
| Keine polymorphe Owner-Spalte | [`03`](03-data-model-guardrails.md) §1.8 | D-2 |
| Referenzen auf `sales.id` sind `NO ACTION`; INAKTIV ≠ NICHT-EXISTENT | [`03`](03-data-model-guardrails.md) §2.2 | Abschnitt 9 |
| Ein Transitionskern, explizite Absicht, beobachteter Halter | [`03`](03-data-model-guardrails.md) §3.1 | Abschnitt 11 |
| Abgeleiteter Status wird nie gespeichert | [`03`](03-data-model-guardrails.md) §5 Falle 35, [`19`](19-user-lifecycle-architecture.md) §4 | Abschnitt 16 |
| Rohtabellen sind keine Abfrageschnittstelle für Automatisierung | [`03`](03-data-model-guardrails.md) §5 Falle 36 | Abschnitt 19 |
| `operation_id` ≠ `idempotency_key` | [`03`](03-data-model-guardrails.md) §3.4, Falle 38 | Abschnitt 18.2 |
| Fehleridentität ist ein kanonischer `NoraErrorCode`, nie Freitext | [`03`](03-data-model-guardrails.md) §6 Falle 33 | Abschnitt 18.2 |
| Security wird serverseitig durchgesetzt; die UI ist keine Security Boundary | [`16`](16-current-state.md), [`22`](22-security-and-access.md) | Abschnitt 5, 13 |
| Kein neues DB-Feld ohne belegten Bedarf | [`01`](01-domain-model.md) | D-13 |
| Nora ist kein generisches Sales-CRM, kein ERP, kein Field-Service-System | [`00`](00-project-context.md), `AGENTS.md` | Abschnitt 1 |
