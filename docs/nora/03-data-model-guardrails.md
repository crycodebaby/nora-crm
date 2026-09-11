# 03 – Datenmodell- und Persistenz-Guardrails

Stand: 2026-09-10 · Load-Klasse: **ALWAYS**

Dieses Dokument hält die **universellen Daten- und Persistenzinvarianten** von Nora fest: Regeln, die bei praktisch jeder Datenmodell- oder Persistenzänderung gelten, unabhängig von Subsystem und Release.

**Nicht hier:** Security und Access (Rollen, RBAC, RLS, Grants, `SECURITY DEFINER`, Session-Autorisierung) → [`22`](22-security-and-access.md). Subsystemspezifische Guardrails → ihr Owner ([`08`](08-numbering-and-global-search.md) Nummern · [`09`](09-window-order-workflow.md) Fensterauftrag · [`10`](10-checklists-snippets-audit.md) Checklisten · [`11`](11-google-calendar-rbac.md) Kalender · [`13`](13-crm-audit-retention.md) Audit · [`19`](19-user-lifecycle-architecture.md) Lifecycle). Operative Test-/Verifikationsschritte → [`21`](21-agent-runbooks.md) sektionsweise. Begründungen → [`06`](06-decision-log.md). Release-Evidenz → `releases/`.

Der **globale Fallen-Index** (§7) löst jede Fallen-Nummer 1–40 auf ihren heutigen Owner auf; die Nummern sind dauerhaft stabil.

## Oberstes Ziel

Doppelte Datenhaltung und rekursive Modellfehler vermeiden.

## Grundregeln

1. Eine Information hat genau einen fachlich führenden Ort.
2. UI-Labels dürfen geändert werden, technische IDs nur mit Begründung.
3. Datenbankänderungen erfordern eine explizite Entscheidung.
4. Demo-Daten dürfen echte Architekturprobleme nicht verstecken.
5. Kein neues Feld, nur weil ein Formular leer wirkt.
6. Keine Resource-Namen blind umbenennen.

---

## 1. Kern-Entitätsinvarianten

### 1.1 Die vier Entitäten bleiben getrennt

**Kunde** = Unternehmen/Haushalt/Verwaltung (`companies`) · **Kontakt** = Person beim Kunden (`contacts`) · **Vorgang** = das Anliegen (`deals`) · **Aufgabe** = eine To-do-Zeile (`tasks`).

Eine Firma wird nie zusätzlich als Kontakt gespeichert. **Vorgangsstatus** (Stand des Vorgangs) und **Aufgabenstatus** (erledigt ja/nein) sind zwei Fakten und werden nicht vermischt. Fachliche Details: [`01`](01-domain-model.md). *(Fallen 1, 4)*

### 1.2 Ein führender Ort je Information

- **Kundentyp** liegt in `companies.sector`. Nicht zusätzlich als Tag pflegen — außer der Tag ist bewusst eine eigenständige Markierung. *(Falle 3)*
- **Nächstes Nachfassdatum** liegt in `deals.expected_closing_date`. Kein Ersatz-Nachfassfeld in Notizen oder Aufgaben, solange kein eigenes DB-Feld beschlossen ist. *(Falle 6)*
- **Baustellenadressen** sind noch keine eigenen Objekte. Bis dahin Adressen nicht willkürlich in mehrere Textfelder kopieren. *(Falle 2)*
- **Hersteller/Lieferanten** können als Firmen-Datensatz erscheinen, aber ein echtes Herstellerfeld am Vorgang existiert nicht. Nicht so tun, als sei das gelöst. *(Falle 5)*
- **Privatpersonen:** `companies.name` wird beim Anlegen aus Vor-/Nachname abgeleitet (`buildCustomerCreatePayload.ts`) und ist im Edit-Formular die einzige führende Quelle — kein zweites Namensfeld, kein virtuelles Vor-/Nachname-Feld im Edit. Ein Empty-Name-Guard verhindert `companies.name = ''` bei Whitespace-only-Namen. *(Falle 28)*

### 1.3 Aufgaben: kein `deal_id`, `company_id` ist historisch

`tasks` hat **kein** `deal_id`. Aufgaben aus der Vorgangsansicht laufen über die verknüpften Ansprechpartner (`deal.contact_ids`) — es gibt keine direkte Vorgangs-Aufgaben-Relation in der Datenbank. `deal_id` an `tasks` war und ist explizit **nicht** beschlossen. *(Falle 7)*

`tasks.contact_id` **und** `tasks.company_id` sind beide nullable, mindestens eines ist gesetzt (Unified Tasks Wave). **`tasks.company_id` ist kein berechnetes Feld** und wird **nicht** nachgeführt, wenn sich `contacts.company_id` später ändert: es ist der historische Kundenkontext zum Zeitpunkt der Erstellung bzw. der letzten bewussten Kontextänderung (serverseitig via `nora_private.enforce_task_company_context()`).

> Für den **aktuellen** Kunden eines Kontakts ist `contact.company_id` zuständig, nie `task.company_id`. Eine Abweichung zwischen beiden ist ein normaler, erwarteter Zustand — **kein** Datenfehler. *(Falle 7a)*

### 1.4 `self_contact_id` ist nicht `contacts.company_id`

„Diese Person ist selbst der Kunde" wird über **`companies.self_contact_id`** ausgedrückt — nicht dadurch, dass man `contacts.company_id` auf die neue Kundenakte umhängt. Die Arbeitgeber-/Ansprechpartner-Beziehung in `contacts.company_id` bleibt unangetastet: eine Person kann Ansprechpartner einer Firma bleiben und gleichzeitig `self_contact_id` einer **anderen** Kundenakte sein. *(Falle 29)*

### 1.5 `is_primary` gilt nur im Company-Kontext

`contacts.is_primary` ist **nur** aussagekräftig, wenn zusätzlich `contact.company_id` zu der betrachteten Kundenakte passt (`explicitPrimaryContact` in `domain/customerContactContext.ts`). Ein `is_primary = true` bei abweichendem `company_id` ist für *diese* Kundenakte bedeutungslos. Beim Kundenwechsel reist die Rolle nie mit: `company_id = null` ⇒ `is_primary = false`. *(Falle 30)*

### 1.6 Effective-Contact-Semantik: genau drei Implementierungen, eine Wahrheit

Die Regel „gehört dieser Kontakt zu dieser Kundenakte?" existiert an genau drei Stellen und nirgends sonst:

| Ebene | Implementierung |
|---|---|
| SQL | `nora_private.is_effective_contact_of_company()` |
| TypeScript | `domain/customerContactContext.ts::resolveCustomerContacts()` |
| FakeRest | `providers/fakerest/internal/taskContextCheck.ts` |

Keine Ad-hoc-Logik in `CompanyShow`, in der Aufgaben-Kontaktauswahl oder in Quick Capture. Wer die Regel ändert, ändert **alle drei** Stellen **und** die gemeinsam benannte Szenario-Matrix `domain/effectiveContactContext.contractCases.ts` synchron (Fallnamen identisch in TS und SQL) — Testsequenz: [`21`](21-agent-runbooks.md) §15. *(Falle 31)*

---

## 2. IDs, Nullability und Referenzintegrität

### 2.1 Numerische ID `0` ist gültig — Nullish statt Truthiness

```text
if (!identity?.id) return;         // FALSCH: identity.id = 0 gilt als „keine Identity"
if (identity?.id == null) return;  // richtig
```

Nora verwendet reale numerische IDs **einschließlich `0`** (`demoSession.ts`: Default-Demo-Admin hat `identity.id = 0`). Existenzprüfungen für numerische Entity-/Identity-IDs verwenden `== null` (nullish), nie Truthiness, wenn fachlich „nicht vorhanden" gemeint ist. UUID-/String-IDs sind nicht betroffen. *(Falle 32)*

### 2.2 Referenzen auf `sales.id` sind immer `NO ACTION`

> **Jede Referenz auf `sales.id` verwendet `NO ACTION`** — nicht `CASCADE`, nicht `SET NULL`, sofern nicht eine neue explizite Architekturentscheidung etwas anderes festlegt.

Urheberschaft und Zuständigkeit sind Geschäftsgeschichte. Die heute sechs Referenzen sind `companies`, `contacts`, `deals`, `deal_notes`, `contact_notes`, `tasks` (jeweils `sales_id`); `sales.user_id → auth.users` ist in Gegenrichtung ebenfalls `NO ACTION`.

Folgen:

- Ein referenzierter Mitarbeiter kann auf **keinem** Pfad gelöscht werden — die Datenbank verweigert (`23503`).
- **INAKTIV / ARCHIVIERT ist nicht NICHT-EXISTENT.** Ein deaktivierter Mitarbeiter bleibt Identitätsanker für alles Bestehende: Namen bestehender Datensätze kommen aus `sales_identities` (alle Zeilen), Auswahllisten für Neues aus `sales_directory` (nur aktive). Kein „Unbekannt".
- **Neue Referenz auf `sales.id`?** Als `NO ACTION`-FK anlegen, die Referenzzählung in `lifecycle_reference_integrity_verification.sql` erhöhen und die Referenzliste in [`19`](19-user-lifecycle-architecture.md) §7 erweitern. Trägt die neue Tabelle Mitarbeiter-Urheberschaft oder -Zuständigkeit, kommt sie zusätzlich als Blocker in `nora_private.employee_deletion_preview`.
- Test-Datenpurge nie über `CASCADE`; SQL-Suiten räumen `sales`-Fixtures per Rollback auf, nie per `DELETE`.

*(Falle 39 · Lösch- und Lifecycle-Modell: [`19`](19-user-lifecycle-architecture.md) §7, §15)*

### 2.3 Server vergibt IDs und Nummern, nie der Client

Kunden- und Vorgangsnummern werden ausschließlich serverseitig per `BEFORE INSERT`-Trigger vergeben und sind nach Vergabe unveränderlich. Kein Eingabefeld, keine Client-Generierung, keine parallele Nummernquelle in CSV oder Demo-JSON. Vollständiger Contract: [`08`](08-numbering-and-global-search.md). *(Fallen 8–13)*

---

## 3. Transaktionen, Sperren und Concurrency

Diese Regeln gelten für **jede** Operation, die mehrere Zeilen konsistent bewegen muss. Sie wurden am Hauptansprechpartner-Wechsel erarbeitet, sind aber nicht auf ihn beschränkt.

### 3.1 Ein Transitionskern, kein zweiter Demote-Pfad

Eine Rollen- oder Zustandsverschiebung, die eine Datenbank-Invariante wahren muss, läuft über **einen** kontrollierten Kern und nie über einen zweiten, nachgebauten Pfad. Beim Hauptansprechpartner ist dieser Kern `nora_private.prepare_primary_contact_slot` (Lock, No-op bei bereits primär, Verifikation des beobachteten Halters); `create_contact`, `update_contact`, `set_primary_contact` und `create_customer_with_contact_core` laufen alle darauf.

`contacts.is_primary` wird von der Oberfläche **nie** als rohe Spalte geschrieben. Der Pfad lautet: Formular → **explizite Absicht** (`PrimaryContactIntent`: `keep` | `make_primary` + beobachteter Halter | `clear`) → ein Application Command (eine Operation, eine UUID) → eine RPC-Transaktion → der eine Demote-Kern.

Die RPCs lesen `is_primary` aus der Nutzlast **nie** — nur die Absicht bewegt die Rolle. Ein `make_primary` trägt immer den Halter, den der Benutzer gesehen hat (`null` = keinen); weicht der tatsächliche Halter ab, wird **alles** zurückgerollt (`NORA_PRIMARY_CONTACT_CHANGED`), nie still ersetzt. Rohe additive Pfade, die die Rolle nicht berühren (Import mit `is_primary = false`, Status-/Markierungs-Updates, `last_seen`), bleiben erlaubt. *(Falle 40)*

Verallgemeinert: **wer eine Invariante über mehrere Zeilen wahren muss, drückt die Absicht explizit aus und lässt genau eine Stelle sie ausführen** — er verteilt die Regel nicht über die Aufrufer.

### 3.2 Ein Unique Index ist die letzte Verteidigung, nicht der Koordinationsmechanismus

`uq_contacts_one_primary_per_company` verhindert den Endzustand, koordiniert aber nichts. Wer sich auf einen Constraint-Treffer als Ablaufsteuerung verlässt, baut eine Race Condition mit Fehlermeldung. Ein Legacy-Constraint-Treffer wird in `normalizeCrmError` **nur** über den Constraint-Namen erkannt, nie über ein breites `duplicate key`-Muster.

### 3.3 Advisory Lock vor konfliktträchtiger Zeilensperre

> **Eine DB-Zeile ist kein improvisierter Mutex.**

Jede Hauptansprechpartner-Transition nimmt `nora_private.lock_customers_for_primary_transition` — einen **transaktionsgebundenen Advisory Lock** (Namespace `nora_primary_contact`, bei Kundenwechsel beide Kunden in **aufsteigender Kunden-Id**) — **bevor** sie eine Kontakt- oder Kundenzeile sperrt oder schreibt.

Die durable Lock-Reihenfolge als Invariante:

> Jede Transition nimmt die Advisory-Transitionssperren ihrer Kunden in aufsteigender Kunden-Id, **bevor** sie eine Kontakt- oder Kundenzeile sperrt oder schreibt; und **jedes Warten auf eine Kontaktzeile liegt vor jedem Erwerb einer Kundenzeilensperre.**

**Warum eine Zeilensperre auf `public.companies` als Mutex unerreichbar ist:** dieselbe Kundenzeile wird unvermeidbar auch *kontaktzeilen-zuerst* gesperrt — vom Trigger `nora_private.sync_individual_company_name` (schreibt `companies` aus einem laufenden `UPDATE public.contacts`) und vom FK-`KEY SHARE` jedes Kontakt-`INSERT`/Kundenwechsels. Diese Pfade lassen sich nicht umsortieren; „Kundenzeile zuerst überall" ist deshalb nicht unvollständig umgesetzt, sondern **unmöglich**. Zwei Release-Blocker waren genau dieser Zyklus.

**Verallgemeinerung:** wer einen neuen konfliktträchtigen Schreibpfad baut, prüft nicht nur die eigenen Sperren, sondern auch die, die Trigger und Fremdschlüssel *implizit* nehmen — und rennt ihn gegen **bestehende** Befehle und gegen **rohe** Schreibpfade, nicht nur gegen sich selbst. Testmatrizen, Runner, Real-Session-Verifikation: [`21`](21-agent-runbooks.md) §15.

### 3.4 Atomarität statt Teilzustand

Eine fachlich zusammengehörige Anlage läuft in **einer** Transaktion (RPC), nicht als zwei Browser-Requests: `create_customer_with_contact`, `create_quick_capture_case`, `create_contact`/`update_contact`. Ein bewusst separater Best-Effort-Schritt danach (z. B. die optionale Aufgabe der Schnellerfassung) ist erlaubt und dokumentiert — er darf den Kern nicht zurückrollen.

Idempotenz läuft über die vorhandenen Primitive (`idempotency_check`/`idempotency_persist`) und einen Fingerprint über die **Allowlist der schreibbaren Felder** der Geschäftsanfrage — nicht über die rohe Client-JSON, sonst löst eine View-Spalte oder ein UI-Hilfsfeld einen falschen `NORA_IDEMPOTENCY_CONFLICT` aus. **`operation_id` (Korrelation) und `idempotency_key` (fachliche Retry-Absicht) sind zwei verschiedene Konzepte** und werden nicht vermischt; `audit_events.request_id` trägt trotz des historischen Spaltennamens die `operation_id` — keine zweite, unabhängige Request-ID.

---

## 4. Migrationsinvarianten

Vor einer Migration dokumentieren: Warum ist das Feld nötig? Welche bestehenden Workflows belegen den Bedarf? Welche alten Daten müssen migriert werden? Welche UI-Stellen sind betroffen? Gibt es eine rückwärtskompatible Lösung?

Technische Regeln (Begründung jeweils in [`06`](06-decision-log.md)):

- **Bereits angewendete Migrationen werden nie editiert.** `supabase/schemas/*.sql` wird synchron nachgezogen; nach jedem Production-Apply den Ledger gegen den Dateinamen-Zeitstempel prüfen — Ledger-Hazard und Vorgehen: [`21`](21-agent-runbooks.md) Sektion 1.
- **Deklarative Schemas sind ein Abbild, keine Wahrheit.** `supabase/schemas/*.sql` wird von keinem `db reset` ausgeführt (`config.toml` konfiguriert kein `[db.migrations] schema_paths`). Autoritativ sind `supabase/migrations/` und die laufende Datenbank. Das gilt besonders für `06_grants.sql`: **niemals** als Privilegien-Source-of-Truth verwenden — Privilegien gegen die Datenbank prüfen ([`22`](22-security-and-access.md) Abschnitt 6.2).
- **View-Spalten nur am Ende erweitern:** neue Spalten in `companies_summary`/`contacts_summary` (oder jeder anderen View) ans **Ende** der `select`-Liste — `create or replace view` interpretiert eine verschobene Position als Umbenennung (`42P16`).
- **Signaturänderung einer RPC = `DROP FUNCTION` + `CREATE`:** ein zusätzlicher Parameter per `CREATE OR REPLACE` erzeugt eine Überladung, die PostgREST nicht auflösen kann (`PGRST203`).
- **Kein `CREATE INDEX CONCURRENTLY`** in CLI-Migrationen (die laufen in einer Transaktion); bei großen Tabellen eine eigene nicht-transaktionale Migration.
- **Grants: immer `revoke all` vor `grant`.** Neue Tabelle in `public` = neue Grant-Zeile; neue Function = eigenes `revoke`. Die Objekttypen haben **entgegengesetzte** Defaults — vollständiger Contract: [`22`](22-security-and-access.md) Abschnitt 6.3.
- **Berührt die Migration Session-Bindung oder `auth.sessions`?** Dann gilt das Hard Gate: Leserecht **und** echte Lookup-Probe vorab prüfen, im Fehlerfall abbrechen — [`22`](22-security-and-access.md) Abschnitt 8.1.

---

## 5. Persistenz- und Infrastructure-Boundary

- **`nora_private` ist nicht über die Data API erreichbar** (`config.toml` exponiert nur `public`); interne Helper leben dort. Was in `public` liegt, ist potenziell erreichbar — die Platzierung ist eine Sicherheitsentscheidung ([`22`](22-security-and-access.md) Abschnitt 6.1).
- **Ein gespeicherter Statuswert ist nicht automatisch der Live-Status.** Beispiel: `idempotency_records.result._meta.disposition` wird beim Erstschreiben unveränderlich als `"executed"` persistiert und bleibt das für immer; die **externe** Disposition (`executed` vs. `replayed`) wird bei jedem Request serverseitig frisch berechnet und nie aus der gespeicherten Zeile übernommen. Wer eine Admin-Ansicht oder ein Reporting auf einer solchen Spalte baut, gibt sie **nicht** als „letzte bekannte Disposition" aus — sie ist ein eingefrorener Schreibzeitpunkt-Wert. *(Falle 35)*
- **Rohtabellen sind keine Abfrageschnittstelle für Automatisierung.** Künftige KI-/Automatisierungs-Konsumenten von Geschäftshistorie gehen über anwendungsseitige Read-Models/Queries, niemals über roh generiertes SQL gegen `audit_events` oder andere Rohtabellen. Contract: [`13`](13-crm-audit-retention.md). *(Falle 36)*
- **Demo/FakeRest ist eine Parität, kein Ersatz.** FakeRest kennt die Datenbank-Guards nicht und hat keine Autorisierung auf Datenebene; Production-Code wird nie für Demo-Parität geschwächt, und ein fehlender Demo-Pfad ist kein Beleg für eine Production-Lücke.
- **Lokaler Zustand ist pro Benutzer gescoped** (`nora-quick-capture-draft:{identity.id}`, mit Schema-Version und Staleness-Schwelle). Ein alter globaler `localStorage`-Key wird beim Upgrade **entfernt**, nie migriert.

---

## 6. Universeller DB-Fehlervertrag

> **`error.message` ist niemals ein stabiler Business-Code.** Das gilt genauso für `error.details`.

```text
notify(`crm.errors.${error.message}`)          // FALSCH: roher Postgres-Exception-Text
notify(normalizeCrmError(error).messageKey);   // richtig: stabiler messageKey
```

Freier DB-/Exception-Text an einen i18n-Key angehängt erzeugt nie-übersetzte Keys, die dem Büropersonal als Rohtext erscheinen. `misc/normalizeCrmError.ts` ist die **einzige** Stelle, die technische Fehler auf stabile `messageKey`s abbildet.

Der Vertrag ist **machine-code-first**:

- Die Business-Identität eines Fehlers ist ein kanonischer `NoraErrorCode` aus `domain/noraErrorCodes.ts`, serverseitig als `DETAIL = 'NORA_<CODE>'` gesetzt.
- Nur ein in `NORA_ERROR_CODES` **kanonisch gelisteter** Wert wird akzeptiert — kein `startsWith("NORA_")`-Raten.
- Die menschenlesbare `MESSAGE` bleibt frei umformulierbar und diagnostisch; sie ist **nie** die Quelle der Business-Identität. Zwei Origins mit demselben Code dürfen unterschiedlichen Text tragen.
- **Freitext-/Regex-Erkennung definiert niemals die Identität eines neuen fachlichen `NoraErrorCode`.** Für einen neuen Code ist sie weder der primäre noch ein zulässiger Mechanismus; bestehende Regex-Pfade bleiben als Legacy-Compatibility für nicht migrierte Aufrufer bewusst stehen. Davon zu unterscheiden ist die **bewusst unterstützte generische Permission-Denied-Normalisierung** (RLS-Text · `42501` · `PGRST301` · `insufficient_privilege` · HTTP `403`) für Zugriffsablehnungen **ohne** kanonisches Nora-`DETAIL`: sie greift **unabhängig davon, an welcher serverseitigen Grenze die Ablehnung entsteht** — Datenbank/RLS ebenso wie ein anderer HTTP-`403`-Pfad —, ist ein technischer Infrastructure-/Compatibility-Fallback, kein fachlicher Code-Ursprung, und bleibt zulässig. Abgebildet wird auch sie ausschließlich in `normalizeCrmError`.

Der **operative Ablauf** zur Einführung und Verifikation eines neuen Fehlercodes (Definition, Migration, Presentation-Mapping, FakeRest-Parität, Suiten) steht in [`21`](21-agent-runbooks.md) Sektion 12. *(Falle 33)*

---

## 7. Globaler Fallen-Index

Die Fallen-Nummern bilden einen **flachen, dauerhaft stabilen globalen Namensraum 1–40**. Eine Falle behält ihre Nummer, auch wenn ihr Inhalt in ein anderes Dokument wandert: **Falle 25 bleibt Falle 25.** Es gibt keine Renummerierung, und historische Release-Dokumente werden deshalb nicht umgeschrieben.

Dieser Index ist ein **Resolver für Cross-References**, keine zweite Inhaltsquelle: er nennt Nummer, Kurzname und kanonischen Current Owner. Der Inhalt steht beim Owner.

| # | Kurzname | Kanonischer Current Owner |
|---|---|---|
| 1 | Kunde und Ansprechpartner vermischen | `03` §1.1 |
| 2 | Baustellenadresse doppelt pflegen | `03` §1.2 |
| 3 | Kundentyp gleichzeitig in Tags, `sector`, Notizen | `03` §1.2 |
| 4 | Vorgangsstatus und Aufgabenstatus vermischen | `03` §1.1 |
| 5 | Hersteller als Kunde missbrauchen | `03` §1.2 |
| 6 | Nachfassdatum doppelt pflegen | `03` §1.2 |
| 7 | Aufgaben am Vorgang ohne Ansprechpartner | `03` §1.3 |
| 7a | `tasks.company_id` als live abgeleiteten Wert behandeln | `03` §1.3 |
| 8 | Kundennummer als Tag oder in Notizen | [`08`](08-numbering-and-global-search.md) |
| 9 | Vorgangsnummer im Titel oder in Freitext | [`08`](08-numbering-and-global-search.md) |
| 10 | Telefonnummer als Ersatz für KD-/VG-Nummer | [`08`](08-numbering-and-global-search.md) |
| 11 | Nummern nachträglich ändern / im Frontend vergeben | [`08`](08-numbering-and-global-search.md) · `03` §2.3 |
| 12 | Parallele Nummernsysteme (CSV, Demo, DB) | [`08`](08-numbering-and-global-search.md) |
| 13 | API-Umgehung der Nummernvergabe | [`08`](08-numbering-and-global-search.md) |
| 14 | Chef-Unterstatus als eigene Kanban-Spalten | [`09`](09-window-order-workflow.md) |
| 15 | Herstellername im Datenmodell verdrahten | [`09`](09-window-order-workflow.md) |
| 16 | Kunden-Tracking-Link ohne Datentrennung | [`09`](09-window-order-workflow.md) |
| 17 | Google als Prozesskern | [`11`](11-google-calendar-rbac.md) Abschnitt A |
| 18 | JSONB-only-Checkliste am Vorgang | [`10`](10-checklists-snippets-audit.md) |
| 19 | Servicebereich über `company_id` | [`10`](10-checklists-snippets-audit.md) |
| 20 | Audit in Notizen oder Freitext | [`10`](10-checklists-snippets-audit.md) · [`13`](13-crm-audit-retention.md) |
| 21 | Checklisten-ID in Notizen statt FK | [`10`](10-checklists-snippets-audit.md) |
| 22 | Zweites Terminsystem (`appointments`) | [`11`](11-google-calendar-rbac.md) Abschnitte A · E.3 |
| 23 | Private iCal-Adresse als Integration | [`11`](11-google-calendar-rbac.md) Abschnitt B |
| 24 | Kalender-ID in UI-Komponenten | [`11`](11-google-calendar-rbac.md) Abschnitt B |
| 25 | Parallele Benutzerverwaltung für Rollen | [`22`](22-security-and-access.md) Abschnitt 4.1 |
| 26 | OAuth-Tokens in CRM-Tabellen oder Audit | [`11`](11-google-calendar-rbac.md) Abschnitt F · [`22`](22-security-and-access.md) Abschnitt 5 |
| 27 | Google-Termine pauschal editierbar | [`11`](11-google-calendar-rbac.md) Abschnitt I |
| 28 | Privatperson-Namensfeld doppelt vorhalten | `03` §1.2 |
| 29 | `self_contact_id` mit `contacts.company_id` verwechseln | `03` §1.4 |
| 30 | `is_primary` unabhängig vom `company_id`-Kontext lesen | `03` §1.5 |
| 31 | Effective-Contact-Regel mehrfach implementieren | `03` §1.6 |
| 32 | Numerische Entity-/Demo-IDs per Truthiness prüfen | `03` §2.1 |
| 33 | `error.message` als i18n-Key oder Business-Code | `03` §6 · Ablauf: [`21`](21-agent-runbooks.md) §12 |
| 34 | `SECURITY DEFINER` blind auf Advisor-Finding umstellen | [`22`](22-security-and-access.md) Abschnitt 7.1 |
| 35 | Gespeicherte `disposition` als Live-Status lesen | `03` §5 (Persistenz) · [`23`](23-operations-errors-feedback.md) §3 (Ausführungssemantik) |
| 36 | KI/Automatisierung mit rohem SQL gegen `audit_events` | [`13`](13-crm-audit-retention.md) · `03` §5 |
| 37 | Presentation erfindet einen Core-Lifecycle | [`23`](23-operations-errors-feedback.md) §5 |
| 38 | Vorgegebene `operationId` ungeprüft registrieren | [`23`](23-operations-errors-feedback.md) §2 |
| 39 | Namen aus `sales_directory`; FK auf `sales.id` mit `CASCADE` | `03` §2.2 · [`19`](19-user-lifecycle-architecture.md) §7 |
| 40 | `contacts.is_primary` als rohe Spalte schreiben | `03` §3.1 · Tests: [`21`](21-agent-runbooks.md) §15 |

---

## 8. Datenmodell-Erweiterungen

Kein neues Feld ohne belegten Bedarf (Grundregel 5). Implementierte Erweiterungen stehen nicht mehr hier — sie sind Teil des aktuellen Modells ([`01`](01-domain-model.md), [`19`](19-user-lifecycle-architecture.md), [`10`](10-checklists-snippets-audit.md)) und ihrer Entscheidung in [`06`](06-decision-log.md).

Noch **nicht** entschiedene, nirgends anders geführte Kandidaten: `follow_up_date` (falls `expected_closing_date` wieder Abschlussdatum werden soll), `priority` und `service_type` am Vorgang, `objects`/`sites` (Baustelle), `measurements` (Aufmaß), `manufacturer_status`, `source_channel` (heute Präfix `Quelle: …` in `deals.description`), `files`/`photos`, `workflow_type` (falls `category` nicht reicht). Geplante Domain-Wellen und ihr Status: [`17`](17-known-issues-and-planned-waves.md) Abschnitt G.

**Verworfen:** eine Tabelle `appointments` als führende Terminquelle (stattdessen `google_calendar_events` als Cache; Google bleibt System of Record — [`11`](11-google-calendar-rbac.md)) und `deals.production_checklist` als JSONB-Hauptmodell (stattdessen relationale Checklisten — [`10`](10-checklists-snippets-audit.md)).
