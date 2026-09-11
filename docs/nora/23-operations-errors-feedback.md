# 23 – Operationen, Fehler und Feedback (Application Contract)

Stand: 2026-09-10 · Status: **CURRENT** · Load-Klasse: **CONDITIONAL CURRENT CONTRACT** — **sektionsweise laden** (§0–§6), nie als ganze Datei.

Dies ist der **Application-Contract für Operationen, Fehlerbedeutung und Feedback** in Nora: Operation Lifecycle, Correlation und Identifier, Idempotency/Retry/Replay, das Error Observatory und die fachliche Bedeutung von Feedback-/Notification-Zuständen.

Hier steht, **was wahr sein muss**. Wie eine Änderung durchzuführen und zu beweisen ist, steht in [`21`](21-agent-runbooks.md) Sektion 11 (Operationen), 12 (Fehler) und 13 (Notifications/Feedback). Dieses Dokument führt bewusst **keine** Routingtabelle — der einzige kanonische Router ist [`README.md`](README.md).

Vor CR3 lagen diese Regeln als `Interim-Contract` in [`21`](21-agent-runbooks.md) §11–§13, obwohl `21` ausschließlich beschreiben soll, *wie* etwas sicher geändert und verifiziert wird. Seit CR3 gilt: **`23` = was wahr sein muss, `21` = wie man es sicher ändert und verifiziert.**

---

## 0. Scope und Ownership-Abgrenzung

| Dokument | Zuständig für |
|---|---|
| **`23` (dieses)** | Operation Lifecycle · Correlation · Idempotency/Retry/Replay/Ausführungsdisposition · Error Observatory und operationsseitige Fehlerbedeutung · Feedback-/Notification-**Bedeutung** auf Application-Ebene |
| [`03`](03-data-model-guardrails.md) §5 | Persistenz- und Infrastructure-Boundary (u. a. die Regel, dass ein **gespeicherter** Statuswert kein Live-Status ist) |
| [`03`](03-data-model-guardrails.md) §6 | **universeller DB-/Business-Fehlervertrag**: `NoraErrorCode`, `DETAIL`, `normalizeCrmError`, machine-code-first |
| [`13`](13-crm-audit-retention.md) | Audit-Ereignisse, Actor-Snapshot, Retention, `audit_events.request_id` |
| [`22`](22-security-and-access.md) | Security, Authorization, Actor-Vertrauen, Trust Boundaries |
| [`02`](02-design-system.md) | **Darstellung**: Layer, Position, Geometrie, Timing, Motion, Overlay, Accessibility |
| [`21`](21-agent-runbooks.md) §11 · §12 · §13 | **operative** Change-/Verification-Schritte |
| [`17`](17-known-issues-and-planned-waves.md) Abschnitt D · A.6 | genuin **offene** Punkte dieses Bereichs |
| [`06`](06-decision-log.md) | **Begründungen** (Operation Correlation FW1 · Operation Manager FW2 · Error Observatory FW3 · Error Contract · Idempotency · Operation Status v1 · Notification Presentation 7A/7B) |

**Faustregel für die Grenze zu `02`:** Könnte ein Redesign die Aussage ändern, ohne dass sich fachliches Verhalten ändert, gehört sie nach [`02`](02-design-system.md) — nicht hierher.

**Eine normale UI-, Label- oder Layout-Änderung lädt dieses Dokument nicht.**

---

## 1. Operation Lifecycle

Eine **Operation** ist ein fachlicher Ausführungsversuch, den Nora als Ganzes verfolgt — nicht ein HTTP-Request und nicht ein Klick.

### 1.1 Genau drei Lifecycle-Werte

```text
OperationStatus = pending | success | error
```

Das ist der **durable Core-Lifecycle**. Er hat **genau diese drei Werte**. `partial`, `timeout`, `failed`, `cancelled`, `blocked`, `rejected` und Ähnliches sind **keine** Core-Werte und werden nicht ergänzt, solange dieser Contract nicht ausdrücklich geändert wird. Ein Lifecycle-Wert ohne reale, serverseitig belegbare Semantik wird nicht erfunden.

Eine Presentation-Schicht **darf** zusätzliche Anzeigezustände kennen — dazu §5.

### 1.2 Manager-Invarianten

- Der **Operation Manager** erzeugt und besitzt den Lifecycle: `pending` → `success` **oder** `error`. Es gibt keinen dritten Ausgang und keinen Rücksprung.
- **Exceptions werden niemals geschluckt.** Der Manager beobachtet und protokolliert; er reicht die fachliche Exception unverändert weiter. Observability ersetzt nie den Business-Throw.
- Der Manager ist **ohne React voll funktionsfähig**. Er ist kein Hook, kein Context-Artefakt und kein Rendering-Nebeneffekt.
- **Genau ein Operation Manager pro Prozess** (Singleton). Ein Provider bindet nur an die bestehende Instanz an und erzeugt keine zweite, konkurrierende.
- Der **Operations-Katalog ist typisiert**. Er beschreibt reale Operationen; er enthält keine erfundenen Systemschritte, und ein Katalogeintrag erzwingt keine zweite Mutation.

### 1.3 Der `OperationRecord` ist In-Memory

Der `OperationRecord` selbst ist **flüchtig und prozesslokal**: keine Datenbanktabelle, kein `localStorage`, kein Realtime-Kanal. Er trägt niemals Payloads, Formularinhalte oder personenbezogene Daten — nur minimale Ergebnisreferenzen (IDs), nie Domainobjekte.

Persistiert wird ausschließlich **getrennt davon** und mit jeweils eigenem Vertrag:

| persistiert | Owner |
|---|---|
| Audit-Historie (`audit_events`) | [`13`](13-crm-audit-retention.md) |
| Error Observatory (`operation_errors`) | §4 dieses Dokuments |
| Idempotency-Zustand (`nora_private.idempotency_records`) | §3 dieses Dokuments · [`03`](03-data-model-guardrails.md) §5 |

Der Operation Manager ist deshalb **keine zweite Datenbank** und kein Ersatz für Audit.

### 1.4 Retention des In-Memory-Speichers

Abgeschlossene Records werden nach kurzer Zeit aus dem Speicher entfernt; `error` wird länger gehalten als `success`. Die konkreten Fristen sind eine Implementierungsentscheidung und **kein dauerhafter Architekturvertrag** — sie werden hier bewusst nicht als Zahlen festgeschrieben. Dauerhaft gilt dagegen:

> **Ein `pending`-Record wird nicht allein aufgrund der Retention automatisch verworfen.** Ein Kapazitätsmechanismus evakuiert nur abgeschlossene Records.

Dass `pending` damit heute **keinen** eigenen Timeout-Lifecycle hat, ist ein bekannter offener Punkt ([`17`](17-known-issues-and-planned-waves.md) D.1) — und keine Lücke, die eine Anzeige-Heuristik schließen darf (§5).

---

## 2. Correlation und Identifier

Nora kennt mehrere Identifier in diesem Bereich. Sie sind **nicht austauschbar**, und keiner von ihnen ist ein Sicherheitsmerkmal (§ Security-Grenze unten).

| Identifier | Bedeutung | Lebensdauer |
|---|---|---|
| `operation_id` | **ein Ausführungsversuch** | pro Versuch |
| `request_id` | Audit-Korrelationsspalte — trägt die `operation_id` (Owner: [`13`](13-crm-audit-retention.md)) | mit der Audit-Zeile |
| `idempotency_key` | **fachliche Absicht** / Idempotency-Scope | über Versuche hinweg stabil |
| `notificationId` | eine sichtbare Karte / ein Benutzer-Intent (§5) | Anzeige |
| `runtimeErrorId` | session-ephemere Fehlerreferenz im Browser — **kein** Server-Lookup-Key | Session |
| `persistentErrorId` | Primärschlüssel der Observatory-Zeile (§4) | dauerhaft |
| `publicErrorRef` | serverseitig erzeugte, nennbare Referenz (`NORA-E…`) für Support/Eskalation (§4) | dauerhaft |

`runtimeErrorId` ist ausdrücklich **≠** `persistentErrorId` **≠** `publicErrorRef`.

### 2.1 `operation_id` — ein Ausführungsversuch

- Die ID wird **einmal am fachlichen Einstieg gemintet**, nicht im Transport und nicht in der Datenbank.
- **Eine bereits vorhandene, gültige ID wird niemals still ersetzt.** Der Transport reicht sie nur weiter.
- **Der Server liest die `operation_id`, er erzeugt sie nicht.** Fehlt sie, bleibt die Korrelation leer — ein Aufrufer ohne Header bleibt kompatibel.
- **Ungültige Werte dürfen weich verworfen** und durch eine frisch geminte ersetzt werden; der Ablauf bricht deswegen nicht ab.
- Kanonische Darstellung ist eine **lowercase-UUID**.

> **Falle 38 — eine vorgegebene `operationId` ist nicht die vergebene.**
> Die Kontexterzeugung normalisiert: ein ungültiger Wert wird **verworfen und ersetzt**, ein gültiger lowercased. Wer eine ID vorab anmeldet und anschließend auf genau diese ID wartet, wartet bei einer ungültigen oder uppercase-UUID auf eine ID, die nie existieren wird — der wartende Zustand löst sich nie auf. Entweder ist die vorgegebene ID garantiert gültig und lowercase, **oder** die anmeldende Schicht bindet sich an die **tatsächlich vergebene** Kontext-ID. Resolver: [`03`](03-data-model-guardrails.md) §7.

### 2.2 `request_id` — Audit-Korrelation, Owner bleibt `13`

Für Audit gilt:

```text
audit_events.request_id = operation_id
```

Trotz des historischen Spaltennamens ist das **keine zweite, unabhängige Request-ID**, und es wird **keine** zusätzliche Audit-Korrelationsspalte eingeführt. Der Vertrag dieser Spalte — Befüllung, Actor-Verankerung, Retention, Sichtbarkeit — gehört vollständig zu [`13`](13-crm-audit-retention.md). `23` verweist nur darauf.

### 2.3 `idempotency_key` — fachliche Absicht

Verbindlich:

```text
operation_id  !=  idempotency_key
```

und ebenso verbindlich der **Transportweg**:

```text
operation_id     →  Correlation-Metadata / Header
idempotency_key  →  expliziter Business-/RPC-Parameter
```

**Begründung:** Der Idempotenzschlüssel steuert Geschäftslogik — er entscheidet, ob eine Ausführung stattfindet oder ein bereits committetes Ergebnis zurückgegeben wird. Er darf deshalb nicht wie bloße Korrelationsmetadata behandelt und nicht über den Korrelations-Header transportiert werden.

### 2.4 Security-Grenze

> **Kein Correlation-, Error-, Notification- oder Idempotency-Identifier ist Authentifizierung oder Autorisierung.**

Keiner dieser Werte ist ein Auth-Merkmal, ein Fähigkeitsnachweis oder eine Identität. Der Actor wird ausschließlich serverseitig bestimmt. Der vollständige Contract dazu — Trust Boundaries, Actor-Verifikation, warum Body-Felder keine Identität sind — steht in [`22`](22-security-and-access.md) Abschnitt 5. `23` übernimmt hier **keine** Security-Ownership.

---

## 3. Idempotency, Retry, Replay und Ausführungsdisposition

### 3.1 Kanonischer Begriff

Der kanonische Dokumentationsbegriff für „wurde in diesem Request tatsächlich ausgeführt oder nicht" ist:

> **Ausführungsdisposition** (`execution disposition`)

mit genau zwei Werten:

```text
executed | replayed
```

Sie ist **kein** `OperationStatus` und wird nicht mit ihm verwechselt. Wechselnde Bezeichnungen („Statuswert", „Idempotenz-Disposition", „Ausführungsstatus") werden nicht benutzt.

Die Disposition ist nur bei `status = success` bedeutungstragend und nur dann gesetzt, wenn der Server sie tatsächlich gemeldet hat. **Ohne `idempotency_key` bleibt sie undefiniert** — sie wird nie zu `executed` geraten, nur weil kein Schutz angefordert wurde.

### 3.2 Retry, Replay und Conflict sind drei verschiedene Dinge

**Retry** — ein neuer Versuch **derselben fachlichen Absicht**:

```text
gleicher idempotency_key   (die Absicht bleibt dieselbe)
frische  operation_id      (es ist ein neuer Versuch)
```

Heute gibt es in Nora **keinen generischen automatischen Retry-, Backoff- oder Queue-Mechanismus**. Ein Retry ist eine bewusste, ausgelöste Wiederholung.

**Replay** — derselbe

```text
command · idempotency_key · actor · fingerprint
```

trifft auf einen **bereits committeten** Scope. Dann gilt:

- das bestehende Ergebnis wird zurückgegeben;
- es findet **keine zweite Business-Ausführung** statt;
- es entsteht **keine zweite Audit-Zeile** ([`13`](13-crm-audit-retention.md)).

**Conflict** — derselbe Scope, aber ein **anderer Fingerprint**:

```text
NORA_IDEMPOTENCY_CONFLICT
```

Es wird **nicht still überschrieben** und nicht „das Neuere gewinnt" entschieden. Der Konflikt ist eine fachliche Ablehnung mit kanonischem Code ([`03`](03-data-model-guardrails.md) §6).

Ein **committeter** Scope ist eingefroren; ein **nicht committeter** Scope ist frei wiederholbar.

### 3.3 `executed` vs. `replayed` — geteilte Ownership (Falle 35)

Falle 35 ist bewusst auf zwei Owner verteilt, weil sie zwei verschiedene Aussagen enthält:

| Hälfte | Owner | Aussage |
|---|---|---|
| **Persistenz** | [`03`](03-data-model-guardrails.md) §5 | Ein **gespeicherter** `executed`-Wert ist kein Live-/Request-Status. |
| **Ausführungssemantik** | **`23` (hier)** | Was `executed` und `replayed` fachlich bedeuten. |

Die Ausführungssemantik:

```text
executed  = der Scope wurde in diesem Request frisch ausgeführt
replayed  = dieser Request erhielt das Ergebnis eines
            bereits committeten Scopes
```

Daraus folgt verbindlich:

- Der **persistierte** Wert bleibt für immer `executed` — er dokumentiert den Erstschreibzeitpunkt.
- `replayed` wird **requestbezogen frisch bestimmt** und nie aus der gespeicherten Zeile übernommen.
- Eine gespeicherte Disposition darf **nicht** als „letzte bekannte Disposition" dargestellt werden — weder in einer Admin-Ansicht noch in einem Reporting. Die Persistenzhälfte dieser Regel steht in [`03`](03-data-model-guardrails.md) §5.

### 3.4 Delivery-Semantik — nur so stark, wie belegt

```text
ohne idempotency_key   →  erneute Requests können erneut ausführen
mit  idempotency_key   →  effectively-once innerhalb des definierten
                          (command, key, actor)-Scopes
Error Observatory      →  best effort
```

**Nora ist nicht „exactly-once".** Es wird keine stärkere Distributed-Systems-Garantie behauptet, als der Mechanismus trägt: die Garantie gilt genau innerhalb des definierten Scopes, nicht global und nicht über Scope-Grenzen hinweg.

---

## 4. Fehlerbedeutung und Error Observatory

### 4.1 Der Fehlervertrag bleibt bei `03` §6

Nicht hier, sondern in [`03`](03-data-model-guardrails.md) §6 stehen — unverändert:

- machine-code-first als Grundprinzip;
- der kanonische `NoraErrorCode` als Business-Identität;
- dass aus freiem `message`-Text **keine** fachliche Identität abgeleitet wird;
- der serverseitige `DETAIL`-Transport;
- `normalizeCrmError` als einzige Abbildungsstelle;
- FakeRest-Parität;
- dass eine neue Business-Ablehnung **kein** neuer Transport-Kind wird.

Falle 33 bleibt bei [`03`](03-data-model-guardrails.md) §6. Der **Ablauf** zur Einführung eines neuen Codes steht in [`21`](21-agent-runbooks.md) §12.

### 4.2 `CrmErrorKind` ist eingefroren

> `CrmErrorKind` ist ein **eingefrorener technischer/Transport-Kategorienraum** und kein Erweiterungspunkt für neue fachliche Ablehnungen.

Er beschreibt Transport- und Infrastrukturklassen (Netzwerk, Service, Auth, Not-Found, Abbruch, Unbekannt) plus einige Migrations-Altlasten, die einen `NoraErrorCode` zeitlich vorwegnahmen. Ein neuer fachlicher Fehler geht deshalb:

```text
NoraErrorCode  →  normalizeCrmError  →  messageKey
```

und **nicht**:

```text
neuer CrmErrorKind
```

### 4.3 Error Observatory — Zweck und Grenze

Das Error Observatory (`operation_errors`) ist Nora's **Diagnose-Arbeitsvorrat für fehlgeschlagene fachliche Operationen**.

> **Grenze zu Audit:** Audit ist **append-only Historie** erfolgreicher Änderungen. Das Error Observatory ist ein **bearbeitbarer Diagnose-Arbeitsvorrat mit Resolution-Zustand**. Compliance-Historie und Diagnosedaten werden nicht vermischt.

`operation_errors` ist deshalb ausdrücklich **≠** `audit_events`. Die Audit-Regeln werden hier nicht dupliziert — Owner bleibt [`13`](13-crm-audit-retention.md).

### 4.4 Observatory-Invarianten

- **Genau ein Error Record pro `operation_id`.** Die `operation_id` ist NOT NULL und UNIQUE; sie dedupliziert. Ein neuer Versuch trägt eine neue `operation_id` und bleibt dadurch unterscheidbar.
- **Der Actor wird serverseitig bestimmt** — ausschließlich aus der verifizierten Auth-Identität, nie aus einem Request-Feld. Die `operation_id` ist dabei **nie** ein Auth-Merkmal (§2.4, [`22`](22-security-and-access.md) Abschnitt 5).
- **`public_ref` wird serverseitig erzeugt** und ist UNIQUE (`NORA-E…`). Sie ist die nennbare Referenz nach außen; der Client erfindet sie nicht.
- **Soft Resource References:** Verweise auf Geschäftsobjekte sind weich (kein FK auf Business-Tabellen) — eine gelöschte Ressource darf die Diagnosezeile nicht mitreißen.
- **`technical_context` folgt einer Allowlist.** Erlaubt sind eng definierte technische Felder; **nicht** erlaubt sind Request-Bodies, Secrets, Tokens, Session-IDs, Provider-Antworten oder unnötige personenbezogene Inhalte.
- **Kein freier Client-INSERT.** Geschrieben wird ausschließlich über die dafür vorgesehenen RPCs (`record_operation_error` / `report_operation_error`), nie direkt in die Tabelle.
- **Wer lesen und wer melden darf, ist Security-Contract** und steht in [`22`](22-security-and-access.md) Abschnitt 4.3 — dort auch die Regel, dass `public_ref`, `error_id` und `operation_id` keine Autorisierungstoken sind. `23` übernimmt hier **keine** Access-Ownership und führt keine zweite Berechtigungsmatrix.
- **Aufzeichnung ist best effort** und erfolgt in eigener Transaktion.
- **Ein Observatory-Ausfall ersetzt niemals die fachliche Exception** und blockiert sie nicht. Wenn die Aufzeichnung scheitert, scheitert sie still — der Business-Fehler erreicht den Aufrufer trotzdem unverändert.

### 4.5 Ist-Zustand: keine Retention-Policy

`operation_errors` besitzt **derzeit keine definierte Retention-, Purge- oder Datenschutz-Policy**. Das ist hier als Ist-Zustand festgehalten, **nicht** entschieden: eine Frist wird an dieser Stelle nicht erfunden, und es folgt aus diesem Dokument keine Migration. Offener Punkt: [`17`](17-known-issues-and-planned-waves.md) Abschnitt D.

Ebenfalls offen und hier nicht gelöst: der Operationstyp-Check des Recorders weist die bestehenden camelCase-Katalogtypen ab ([`17`](17-known-issues-and-planned-waves.md) A.6). Solange das gilt, landen technische Fehlschläge dieser Operationen **nicht** im Observatory — der Recorder ist best effort und schweigt.

---

## 5. Feedback- und Notification-Application-Contract

Dieser Abschnitt besitzt die **Bedeutung** von Feedback, **nicht sein Aussehen**. Layer, Position, Geometrie, Timing, Motion, Overlay-Verhalten, Click-through und Accessibility-Ausprägung gehören vollständig zu [`02`](02-design-system.md) (§6).

### 5.1 Intent ist nicht Operation

```text
Intent          !=  Operation
notificationId  !=  operation_id
```

Eine sichtbare Meldung berichtet über einen **Benutzer-Intent**, nicht über eine technische Operation. Ein Intent **darf mehrere `OperationRecord`s reduzieren** — etwa einen Kern-Vorgang und einen optionalen Folgeschritt — und erscheint trotzdem als **eine** Aussage.

Deshalb ist eine `notificationId` niemals eine `operation_id`, und umgekehrt.

### 5.2 Presentation-Lifecycle (Falle 37)

Der Core-Lifecycle bleibt:

```text
pending | success | error
```

Der Presentation-/Notification-Lifecycle **darf zusätzlich** kennen:

```text
partial
```

`partial` bedeutet: der Kern ist committet, ein optionaler Folgeschritt nicht. Es entsteht **ausschließlich durch Reduktion mehrerer `OperationRecord`s in der Presentation**.

> **Falle 37 — die Presentation erfindet keinen Core-Lifecycle.**
> `partial` wird **niemals in den Core zurückgeschrieben**. Der `OperationStatus` bleibt bei seinen drei Werten (§1.1). Resolver: [`03`](03-data-model-guardrails.md) §7.

Ebenso verbindlich:

> **Ein lange laufendes `pending` wird nicht heuristisch zu `timeout` oder `error` umgedeutet.** Der fehlende Timeout-Lifecycle ist ein bekannter Core-Follow-up ([`17`](17-known-issues-and-planned-waves.md) D.1) und wird nicht durch eine Anzeige-Heuristik kaschiert. Zulässig ist höchstens ein zusätzlicher Hinweis, dass es länger dauert als erwartet — bei **unverändertem** Lifecycle.

### 5.3 Feedback-Policies

- **Sichtbarkeit ist Opt-in.** Eine Operation wird sichtbar, weil ein Intent sie registriert hat — nicht automatisch, weil sie existiert.
- **Ein unbekannter oder nicht registrierter Operationstyp bleibt still.** Er erzeugt keine generische Ersatzmeldung.
- **Ein Flow gehört genau einer Feedback-Schicht.** Wird ein Flow migriert, verschwinden seine Meldungen der alten Schicht für dieselbe fachliche Aussage im selben Schritt — nie beide Schichten nebeneinander für dieselbe Aussage.
- **sonner bleibt für alle nicht migrierten Flows montiert.** Zwei Feedback-Schichten sind der bewusste, dokumentierte Zwischenzustand; eine globale Bereinigung nebenbei findet nicht statt.
- **Kein Phantom-Slot.** Ein Operation-Slot wird nur registriert, wenn die Operation auch wirklich startet — sonst hängt die Anzeige für immer auf `pending`.
- **Fehler *vor* dem Start einer Operation erzeugen keinen synthetischen `OperationRecord`.** Sonst würden Audit und Observatory verfälscht. Feldfehler bleiben inline; alles andere meldet der Aufrufer selbst.
- **Application Commands importieren nichts aus `notifications/`** — keinen Display-Kontext, keinen i18n-Key, keinen Tone. Commands nehmen nur neutrale Execution-Metadata entgegen.

### 5.4 Retry-Fähigkeit vs. Retry-Mechanismus

Die Retry-Policy im Notification-Contract besitzt die **Fähigkeit**, Retry-Semantik zu beschreiben; **aktuell sind jedoch alle Policies auf „kein Retry" gesetzt**.

```text
Contract-Fähigkeit            vorhanden
aktiver generischer Retry     nicht vorhanden
```

Es gibt heute also **keine automatischen Retries**. Retry ist außerdem nie allein aus einem `errorCode` ableitbar: er braucht **sowohl** eine explizite Command-Policy **als auch** einen kompatiblen Idempotency-Scope (§3.2). Dasselbe gilt für eine sichtbare IT-Eskalation — die Contract-Fähigkeit existiert, der Workflow dahinter nicht ([`17`](17-known-issues-and-planned-waves.md) D.2).

---

## 6. Layering-Invarianten

Die Schichten dieses Bereichs sind bewusst getrennt. Eine Verletzung dieser Trennung ist ein Architekturfehler, kein Detail.

| Schicht | darf | darf nicht |
|---|---|---|
| **Application Commands** | fachlich ausführen, neutrale Execution-Metadata annehmen, fachlich werfen | Präsentation kennen, Notification-Module importieren, Fehler schlucken |
| **Operation Manager** | Lifecycle führen, korrelieren, beobachten | Business-Entscheidungen treffen, Exceptions unterdrücken, persistieren |
| **Persistenz** (Audit · Observatory · Idempotency) | dauerhaft festhalten | den Live-Status ersetzen (§3.3), sich gegenseitig vertreten |
| **Presentation** | reduzieren, benennen, anzeigen | Core-Zustände erfinden (§5.2), in den Core zurückschreiben, Lifecycle heuristisch umdeuten |

---

**Operative Schritte zum Ändern und Verifizieren:** [`21`](21-agent-runbooks.md) §11 (Operationen) · §12 (Fehler) · §13 (Notifications und Feedback).
