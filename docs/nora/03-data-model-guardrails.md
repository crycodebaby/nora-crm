# 03 – Datenmodell-Guardrails

Dieses Dokument hält **durable Invarianten und technische Guardrails** fest — Regeln, die unabhängig von einzelnen Releases gelten. Release-Evidenz (SHAs, Testzahlen, Live-Beweise) gehört nicht hierher, sondern ins Archiv (`releases/`); Begründungen stehen in `06-decision-log.md`; der Mitarbeiter-Lifecycle als Ganzes in `19-user-lifecycle-architecture.md`.

## Oberstes Ziel

Doppelte Datenhaltung und rekursive Modellfehler vermeiden.

## Grundregeln

1. Eine Information hat genau einen fachlich führenden Ort.
2. UI-Labels dürfen geändert werden, technische IDs nur mit Begründung.
3. Datenbankänderungen erfordern explizite Entscheidung.
4. Demo-Daten dürfen echte Architekturprobleme nicht verstecken.
5. Kein neues Feld, nur weil ein Formular leer wirkt.
6. Keine Resource-Namen blind umbenennen.

## Häufige Fallen

### Falle 1: Kunde und Ansprechpartner vermischen

Falsch:

```text
Firma als Kontakt speichern und zusätzlich als Kunde speichern.
```

Richtig:

```text
Kunde = Unternehmen / Haushalt / Verwaltung
Kontakt = Person beim Kunden
```

### Falle 2: Baustellenadresse doppelt pflegen

Später muss entschieden werden, ob Baustellenadressen eigene Objekte werden.

Bis dahin nicht willkürlich Adressen in mehrere Textfelder kopieren.

### Falle 3: Kundentyp in Tags, Sector und Notes gleichzeitig

Aktuell wird `sector` als Kundentyp verwendet. Nicht zusätzlich denselben Kundentyp als Tag speichern, außer es ist bewusst als Markierung gedacht.

### Falle 4: Vorgangsstatus und Aufgabenstatus vermischen

Vorgangsstatus beschreibt den Stand des Vorgangs.

Aufgabenstatus beschreibt, ob eine konkrete Aufgabe erledigt ist.

### Falle 5: Hersteller als Kunde missbrauchen

Lieferanten/Hersteller können in v0.1 als Kunden-/Firmen-Datensatz erscheinen, aber ein echtes Herstellerfeld am Vorgang existiert noch nicht. Nicht so tun, als sei das vollständig gelöst.

### Falle 6: Nachfassdatum doppelt pflegen

Aktuell ist **`expected_closing_date`** der führende Ort für „Nächstes Nachfassdatum“. Kein zusätzliches Nachfassfeld in Notizen oder Aufgaben als Ersatz einführen, solange kein DB-Feld beschlossen ist.

### Falle 7: Aufgaben direkt am Vorgang ohne Ansprechpartner

`tasks` haben weiterhin **kein** `deal_id`. Aufgaben aus der Vorgangsansicht (`DealTasksSection.tsx`) laufen weiterhin über verknüpfte Ansprechpartner (`deal.contact_ids`) — nicht so tun, als gäbe es eine direkte Vorgangs-Aufgaben-Relation in der DB. `deal_id` an `tasks` war und ist explizit **nicht** Teil der Unified Tasks Wave (siehe Decision Log „2026-08-25 – Unified Tasks Wave").

Seit der Unified Tasks Wave (2026-08-25) hat `tasks` zusätzlich **`company_id`** (nullable, historisch stabiler Kundenkontext — siehe Falle 7a) — `contact_id` ist jetzt ebenfalls nullable, nicht mehr die einzige Bindung.

### Falle 7a: `tasks.company_id` als live abgeleiteten Wert behandeln

`tasks.company_id` ist **kein** berechnetes Feld und wird **nicht** automatisch nachgeführt, wenn sich `contacts.company_id` später ändert. Es ist der historische Kundenkontext zum Zeitpunkt der Aufgabenerstellung bzw. letzten bewussten Kontextänderung (serverseitig via `nora_private.enforce_task_company_context()` gesetzt). Falsch: `task.company_id` in Code/UI als „aktueller Kunde des verknüpften Kontakts" interpretieren — dafür ist `contact.company_id` (live) zuständig, nicht `task.company_id` (historisch). Eine Abweichung zwischen beiden ist ein normaler, erwarteter Zustand, kein Datenfehler.

### Falle 8: Kundennummer als Tag oder in Notizen

Falsch:

```text
Tag „KD-000042“ am Kontakt, weil die Kundennummer sonst nirgends steht.
```

Richtig:

```text
Führendes Feld companies.customer_number — einmalig, unique, unveränderlich.
```

### Falle 9: Vorgangsnummer im Titel oder in Freitextnotizen

Falsch:

```text
deals.name = „VG-2026-000015 Fenstergriff defekt“
```

Richtig:

```text
deals.case_number = VG-2026-000015
deals.name = Fenstergriff defekt
```

### Falle 10: Telefonnummer als Ersatz für KD/VG-Nummern

Telefonnummern können mehrfach vorkommen, sich ändern oder unvollständig sein. Sie eignen sich für Suche, aber **nicht** als Primärreferenz in Telefonannahme oder Angebotsbezug.

### Falle 11: Nummern nachträglich ändern oder im Frontend vergeben

Nummern werden serverseitig vergeben und dürfen nach Vergabe nicht geändert werden. Kein Eingabefeld im Formular, keine Client-Generierung bei `create`.

### Falle 12: Parallele Nummernsysteme (CSV, Demo, DB)

Nicht gleichzeitig Nummern in CSV-Spalten, Demo-JSON-Kommentaren und Datenbankfeldern pflegen. **`customer_number`** und **`case_number`** sind die einzige führende Quelle — siehe `08-numbering-and-global-search.md`.

### Falle 13: API-Umgehung der Nummernvergabe

**Behoben (6c-Hardening):** `assign_*`-Trigger vergeben immer serverseitig; `next_*`/`format_*` sind für `anon`/`authenticated` nicht per RPC ausführbar. Nora-UI sendet keine Nummern; FakeRest nutzt `misc/numbering.ts` nur im Demo-Modus.

## Datenmodell-Erweiterungen – Kandidaten

Nur bei belegtem Bedarf:

| Feld / Tabelle | Zweck |
|---|---|
| `companies.customer_number` | feste Kundennummer (`KD-000001`), unique, unveränderlich — **implementiert** (Welle 6c) |
| `deals.case_number` | feste Vorgangsnummer (`VG-2026-000001`), unique, unveränderlich — **implementiert** (Welle 6c) |
| `follow_up_date` | dediziertes Nachfassdatum, falls `expected_closing_date` wieder Abschlussdatum werden soll |
| `deal_id` an `tasks` | direkte Aufgaben am Vorgang ohne Umweg über Kontakt |
| `priority` | Dringlichkeit am Vorgang |
| `service_type` | Dienstleistung am Vorgang |
| `objects` / `sites` | Baustelle / Objekt |
| `measurements` | Aufmaßdaten |
| `manufacturer_status` | Wartet auf Hersteller, Lieferant, Ersatzteil |
| `source_channel` | Google Ads, Website, Telefon, WhatsApp, Empfehlung |
| `files` / `photos` | Fotos, PDF, Angebot, Aufmaß |
| ~~`appointments`~~ | **verworfen** — stattdessen `google_calendar_events` (Cache); Google = System of Record — siehe `11-google-calendar-rbac.md` |
| `google_calendar_connections` | Singleton-Verbindung zum einen Geschäftskalender (keine Tokens) |
| `google_calendar_events` | Gespiegelte Google-Events + CRM-Verknüpfung (`origin`, `deal_id`, …) |
| `sales.role` | `admin` \| `office` \| `viewer` — keine parallele Benutzertabelle |
| `manufacturer_id` / `manufacturer_name` | Herstellerbezug am Vorgang (generisch, nicht Höning-spezifisch) |
| `service_area_code` | `FENS` / `HAUS` / `IMMO` — Geschäftszweig, **nicht** Kunde — siehe `10-checklists-snippets-audit.md` |
| `checklist_templates` / `checklist_runs` / `checklist_run_items` | modulare Checklisten — **relational, nicht JSONB-only** — **implementiert** (v0.3d2) |
| `saved_text_snippets` | wiederverwendbare Textbausteine — **implementiert** (v0.3d2) |
| `audit_events` | zentrale append-only Audit-Log-Tabelle — **implementiert** (v0.3d2) |
| `workflow_type` | `general` vs. `window_order` — falls `category` nicht reicht |
| `companies.customer_kind` | Unternehmen/Selbstständig vs. Privatperson — **implementiert** (Customer & Contact Workflow Wave, 2026-08-25) |
| `contacts.is_primary` | Hauptansprechpartner, max. 1 pro Kunde (Partial Unique Index) — **implementiert** |
| `companies.links_jsonb` / `contacts.links_jsonb` | generisches Link-Modell (Website, LinkedIn, …) — **implementiert**, ersetzt LinkedIn-only-Validierung |
| `companies.email_jsonb` / `companies.phone_jsonb` | mehrere Firmen-Kontaktmethoden mit Typ — **implementiert** |
| `create_customer_with_contact` (RPC) | atomare Kunde+Ansprechpartner-Anlage — **implementiert**, erweitert um `self_contact_id`/`mark_self` (Self Contact Wave) |
| `set_primary_contact` (RPC) | atomarer Hauptansprechpartner-Wechsel — **implementiert** |
| `companies.self_contact_id` | Person repräsentiert Kundenakte, entkoppelt von `contacts.company_id` — **implementiert** (Self Contact Wave, 2026-08-26) |
| `create_quick_capture_case` (RPC) | atomare Kunde+Kontakt+Vorgang-Anlage für Schnellerfassung — **implementiert** |
| `nora_private.is_effective_contact_of_company` | zentrale „gehört Kontakt zu Kundenakte"-Regel — **implementiert**, FakeRest-Parität in Pre-Production-Hardening-Session (2026-08-27) korrigiert |
| `nora_private.sync_individual_company_name` Empty-Name-Guard | verhindert `companies.name = ''` bei Privatkundenakte (Whitespace-only Vor-/Nachname) — **implementiert** (Pre-Production Hardening Patch, 2026-08-27) |

### Falle 29: `self_contact_id` mit `contacts.company_id` verwechseln

Falsch:

```text
Beim „Kontakt → Kundenakte"-Flow contacts.company_id auf die neue
Kundenakte umhängen, um "diese Person ist der Kunde" auszudrücken.
```

Richtig:

```text
companies.self_contact_id zeigt auf den Kontakt — contacts.company_id
(die bestehende Arbeitgeber-/Ansprechpartner-Beziehung) bleibt unangetastet.
Eine Person kann Ansprechpartner einer Firma bleiben und gleichzeitig
self_contact_id einer ANDEREN Kundenakte sein (Freddie-Szenario).
```

### Falle 30: `is_primary` unabhängig vom `company_id`-Kontext lesen

Falsch:

```text
contact.is_primary === true als "Hauptansprechpartner dieser Kundenakte"
werten, ohne zu prüfen, ob contact.company_id tatsächlich zu dieser
Kundenakte passt.
```

Richtig:

```text
is_primary ist nur aussagekräftig, wenn zusätzlich company_id passt
(explicitPrimaryContact in domain/customerContactContext.ts). Ein
is_primary=true bei abweichendem company_id ist für DIESE Kundenakte
bedeutungslos.
```

### Falle 33: `error.message` als i18n-Key oder Business-Code verwenden

Falsch:

```text
notify(`crm.quick_capture.errors.${error.message}`)   // error.message = roher Postgres-Exception-Text
```

Richtig:

```text
const normalized = normalizeCrmError(error);   // -> stabiler messageKey, z. B. "crm.errors.contact_not_in_customer_context"
notify(normalized.messageKey);
```

`error.message` ist niemals ein stabiler Business-Code — freier DB-/Exception-Text darf nicht direkt an einen i18n-Key angehängt werden (erzeugt nie-übersetzte Keys, die dem Büropersonal als Rohtext angezeigt werden). `normalizeCrmError.ts` (`misc/normalizeCrmError.ts`) ist die einzige Stelle, die technische Fehler auf stabile `messageKey`s abbildet. **Verifizierter, historischer Fall:** `application/commands/createQuickCaptureCase.ts` reichte bei einem RPC-Fehlschlag den rohen `error.message` unverändert als `QuickCaptureSubmitError`-Code durch, den `QuickCaptureDialog.tsx` direkt in einen i18n-Key-Suffix einsetzte — behoben durch `normalizeCrmError()` mit neuem `contact_not_in_customer_context`/`self_contact_delete_blocked`-Mapping (Pre-Production Hardening Patch, 2026-08-27). Diese beiden Werte existieren aus Rückwärtskompatibilitätsgründen weiter, sind aber keine Vorlage für neue Fälle — siehe aktuelle Guardrail unten.

**Aktuelle Guardrail (Error Contract Wave, 2026-08-28, PRODUCTION VERIFIED — siehe Decision Log):** `normalizeCrmError()` ist machine-code-first. Für eine neue Business-Rejection gilt ausschließlich dieser Ablauf, nicht mehr „neues Regex-Pattern/`CrmErrorKind` ergänzen":

1. Kanonischen `NoraErrorCode` in `domain/noraErrorCodes.ts` definieren (`NORA_ERROR_CODES`/`NORA_ERROR_DEFINITIONS`).
2. Serverseitig an der RAISE-Stelle `USING DETAIL = 'NORA_<CODE>'` setzen (SQL-Migration additiv, `supabase/schemas/02_functions.sql` synchron nachziehen).
3. Presentation-Mapping (`messageKey`) in `NORA_ERROR_DEFINITIONS` ergänzen.
4. FakeRest über `throwNoraError()` denselben Code werfen lassen, soweit FakeRest den Command-Pfad überhaupt modelliert — sonst als Debt dokumentieren, nicht Scope aufblasen.
5. Die menschliche `MESSAGE` bleibt frei umformulierbar/diagnostisch — nie die Quelle der Business-Identität.
6. Regex-/Nachrichtentext-Parsing ist ausschließlich ein Legacy-Compatibility-Fallback für nicht migrierte Aufrufer, niemals der primäre oder einzige Mechanismus für einen neuen Code.

`error.message` bleibt niemals ein Business-Code — das gilt jetzt auch für `error.details`: nur ein in `NORA_ERROR_CODES` kanonisch gelisteter Wert wird akzeptiert (kein `startsWith("NORA_")`-Raten). Bestehende Regex-Pfade für bereits migrierte oder noch nicht migrierte Aufrufer bleiben bewusst bestehen und wurden **nicht** entfernt — nur der Weg für *neue* Fälle hat sich geändert.

### Falle 32: Numerische Entity-/Demo-IDs per Truthiness prüfen

Falsch:

```text
if (!identity?.id) return;          // identity.id = 0 (Default-Demo-Admin) wird fälschlich als "keine Identity" behandelt
disabled={!winnerId}                // winnerId = 0 wäre ein gültiges Merge-Ziel
```

Richtig:

```text
if (identity?.id == null) return;
disabled={winnerId == null}
```

Demo/FakeRest verwendet reale numerische IDs einschließlich `0` (`demoSession.ts`: Default-Demo-Admin hat `identity.id = 0`). Existenzprüfungen für numerische Entity-/Identity-IDs müssen `== null` (nullish) statt Truthiness verwenden, wenn fachlich nur „nicht vorhanden" gemeint ist — sonst wird eine legitime ID `0` fälschlich als „fehlt" behandelt. Betraf verifiziert u. a. `QuickCaptureDialog.tsx` (`identity?.id`), `ContactMergeButton.tsx` (`winnerId`), `CompanyAside.tsx` (`record.sales_id`), `CompanyInputs.tsx`/`CompanyShow.tsx` (`self_contact_id`), `NoteCreateSheet.tsx`/`TaskCreateSheet.tsx` (`referenceRecordId`), `AddTask.tsx` (`resolvedContactId`) — behoben in der Pre-Production-Hardening-Session, siehe Decision Log. UUID-/String-IDs sind von dieser Regel nicht betroffen (leerer String ist dort meist schon fachlich ungültig).

### Falle 31: Effective-Contact-Regel mehrfach implementieren

Falsch:

```text
In CompanyShow, Aufgaben-Kontaktauswahl und Quick Capture jeweils eigene
Ad-hoc-Logik schreiben, ob ein Kontakt "zu einem Kunden gehört".
```

Richtig:

```text
nora_private.is_effective_contact_of_company() (SQL) bzw.
domain/customerContactContext.ts::resolveCustomerContacts() (TS) sind die
einzigen Implementierungen dieser Regel.
```

**Domain Contract Testing (Pre-Production Hardening Patch, 2026-08-27):** Die drei parallelen Implementierungen (SQL `nora_private.is_effective_contact_of_company`, TS `domain/customerContactContext.ts`, FakeRest `providers/fakerest/internal/taskContextCheck.ts`) werden über eine gemeinsam benannte Szenario-Matrix geprüft: `domain/effectiveContactContext.contractCases.ts` (Fälle `regular_contact` / `self_contact` / `foreign_contact` / `foreign_primary_contact` / `regular_and_self` / `missing_contact` / `missing_company`), genutzt von `customerContactContext.test.ts` und `taskContextCheck.test.ts`; identisch benannte Fälle in `supabase/tests/customer_contact_workflow_verification.sql` Abschnitt 7. **Verifizierter, in dieser Session behobener Bug:** FakeRests `isEffectiveContactOfCompany()` prüfte bisher **nur** `self_contact_id` und nie `contact.company_id = company.id` — ein regulärer Kontakt derselben Firma wurde in FakeRest fälschlich als "nicht effektiv zugehörig" abgelehnt (SQL/TS waren korrekt). Bei künftigen Änderungen an der Regel alle drei Stellen UND die Szenario-Matrix synchron halten.

### Falle 28: Privatperson-Namensfeld doppelt vorhalten

Falsch:

```text
companies.name als zweites Pflichtfeld neben contact_first_name/contact_last_name
bei der Privatperson-Anlage abfragen
```

Richtig:

```text
companies.name wird beim Anlegen einer Privatperson aus Vor-/Nachname abgeleitet
(buildCustomerCreatePayload.ts); das Kundenname-Feld ist im Create-Formular für
customer_kind = individual ausgeblendet. Im Edit-Formular bleibt companies.name
die einzige führende Quelle (kein virtuelles Vor-/Nachname-Feld dort).
```

**Veraltet / ersetzt durch 10:**

| Kandidat | Status |
|---|---|
| `production_checklist` (jsonb) | ❌ nicht als Hauptmodell — relationale Tabellen stattdessen |

### Falle 18: JSONB-only-Checkliste am Vorgang

Falsch:

```text
deals.production_checklist jsonb als einzige Quelle für Produktionsfreigabe
```

Richtig:

```text
checklist_templates + checklist_runs + checklist_run_items mit label_snapshot
```

Siehe `10-checklists-snippets-audit.md`.

### Falle 19: Servicebereich über company_id

Falsch:

```text
company_id oder sector als Ersatz für FENS/HAUS/IMMO
```

Richtig:

```text
service_area_code auf Vorlage, Lauf und Snippet — company_id bleibt Kunde
```

### Falle 20: Audit in Notizen oder Freitext

Falsch:

```text
„Produktion freigegeben von Max am 12.03.“ nur als Notiz
```

Richtig:

```text
checklist_run_items.checked_by + checked_at + audit_events
```

### Falle 21: Checklisten-ID in Notizen

Falsch:

```text
Notiz: „Checkliste abc-123-def erledigt“
```

Richtig:

```text
FK checklist_run_id in strukturierten Tabellen; Notiz optional als Kommentar am Punkt
```

## RBAC- und RLS-Guardrails (Welle v0.4b / v0.4b.1)

Details in `11-google-calendar-rbac.md`:

- **`sales.role`** ist die führende Rollenquelle (`admin` | `office` | `viewer`)
- **Interne Helper** in Schema `nora_private` — nicht in PostgREST-Schemas (`config.toml`: nur `public`)
- **Öffentliche RPCs** in `public`: `start_checklist_run_from_template` (authenticated); `set_sales_access_by_executor` ist seit User Lifecycle W1 (2026-09-05) **nur service_role** (die deprecated `set_sales_role_by_admin` wurde in W2 gelöscht) — der Browser erreicht Rollen-/Zugangsänderungen ausschließlich über die `users` Edge Function
- **`nora_private.safe_auth_uid()`** nur intern — `auth.uid()` wirft bei malformed JWT-sub; RLS-Helper nutzen safe reader
- **Capability-Rolle `nora_role_manager`** (NOLOGIN, NOBYPASSRLS) — einziger Owner von `apply_sales_role_change`; kein GUC-Token-Modell (v0.4b.2)
- **Testrolle `nora_rls_test`** nur lokal via `rbac_rls_setup.sql` — **nie** in Produktionsmigrationen
- **`anon`:** kein Tabellen-GRANT auf CRM-Tabellen; RLS + Grants zusammen prüfen

### Falle 34: `SECURITY DEFINER`-Views/Functions blind auf Advisor-Finding umstellen

Falsch:

```text
Supabase Security Advisor meldet ERROR "Security Definer View" →
sofort security_invoker=true setzen, weil der Advisor es als Fehler markiert.
```

Richtig:

```text
Vor jeder Änderung an einer SECURITY DEFINER-View/-Function oder ihrem
security_invoker prüfen: konkrete Datenprojektion, Grants (anon/authenticated/
service_role), zugrunde liegende RLS, tatsächliche Consumer, serverseitige
Auth-Checks, funktionale Abhängigkeiten. Ein Advisor-Finding ist ein
automatisiertes Signal (jede SECURITY DEFINER-View ist per Default ein
ERROR-Lint), kein Beweis für einen Exploit — und kein Beweis für
Harmlosigkeit. Beide Richtungen müssen belegt werden.
```

`public.init_state` und `public.sales_directory` sind verifizierte, bewusste Ausnahmen mit geprüfter minimaler Datenprojektion — siehe `06-decision-log.md` „2026-08-28 – Intentional privileged read views" (Einzelbewertungen im Archiv `releases/2026-08.md`, Anhang „Security Advisor Findings — assessed 2026-08-28"). Für diese beiden Views gilt zusätzlich: Änderungen an Projektion, Grants, zugrunde liegender RLS oder `security_invoker` erfordern eine neue Security-Bewertung, keine Wiederverwendung der alten Einstufung.

Die vom Advisor gemeldeten ausführbaren `SECURITY DEFINER`-Functions/RPCs (`anon_security_definer_function_executable` / `authenticated_security_definer_function_executable`) wurden in der Folge-Session „Residual Security Advisor Closure" (2026-08-28) bewertet — siehe `06-decision-log.md` und Archiv `releases/2026-08.md`. Wichtige Unterscheidung für künftige Agenten: eine Function mit Rückgabetyp `trigger` oder `event_trigger` kann **nicht** direkt aufgerufen werden (Postgres-Engine-Restriktion, unabhängig von EXECUTE-Grants; PostgREST exponiert sie ohnehin nicht als RPC) — ein Advisor-Warning dazu ist strukturell ein Falsch-Positiv, kein Nachweis für Exposure. Ein Advisor-Warning zu einer Function mit „echtem" Rückgabetyp (z. B. `jsonb`, `uuid`, `void`) muss dagegen immer einzeln geprüft werden (Grants, serverseitige Auth-Checks, search_path).

Ebenso wurde geprüft: ein gesetzter `search_path = public` (statt `''`) bei `SECURITY DEFINER` ist auf Production nur deshalb unkritisch, weil keine client-facing Rolle (`anon`/`authenticated`/`PUBLIC`) `CREATE` auf `public` besitzt. Diese Grant-Voraussetzung vor jeder neuen `SECURITY DEFINER`-Function mit nicht-leerem `search_path` erneut prüfen — nicht pauschal von der aktuellen Bewertung ausgehen, falls sich Schema-Grants künftig ändern.

### sales-Datenexposition (v0.4b.2)

| Ressource | Wer liest | Felder |
|-----------|-----------|--------|
| `public.sales_directory` | alle aktiven Rollen | `id`, `first_name`, `last_name`, `avatar` — Teamlisten, Betreuer-Auswahl |
| `public.sales_identities` (W2) | alle aktiven Rollen | `id`, `first_name`, `last_name`, `avatar`, `disabled` — **alle** Mitarbeiter inkl. deaktivierter; nur für historische Namen (Notizen, Akten, Aktivitätslog, Export), nie als Auswahlliste |
| `public.sales` | Admin: alle Zeilen; sonst nur eigene Zeile | vollständiges Profil inkl. `role`, `email`, `disabled` nur für Admin-Verwaltung / eigenes Profil |

Beide Views sind `security_invoker = false` über genau eine Tabelle und damit auto-updatable — deshalb seit W2 explizit `SELECT`-only (`revoke all` + `grant select`), unabhängig von Default-Privilegien. `DELETE` auf `public.sales` ist für `anon`/`authenticated` entzogen (zusätzlich zur fehlenden DELETE-Policy).

Direkte Data-API-Updates auf `role`, `disabled`, `administrator`, `user_id`, `email` bleiben blockiert (Trigger). Rollen-/Zugangsänderung nur über die `users` Edge Function → `set_sales_access_by_executor` (service_role, verifizierter Actor, Selbstschutz) → `nora_private.apply_sales_role_change` (Owner `nora_role_manager`). Zusätzliche Invariante seit W1: `guard_last_active_admin_trigger` lässt nie null Zeilen mit `role = 'admin' AND disabled = false` zurück (`NORA_LAST_ACTIVE_ADMIN_REQUIRED`). Seit W3 (2026-09-05) verankert der Executor den verifizierten Actor und die Operation-ID transaktionslokal für den Audit-Trigger (`nora_private.pin_audit_context`, postgres-intern); Mitarbeiter-Ereignisse aus der Edge Function laufen über `public.record_employee_admin_event` (nur `service_role`, Ereignistyp-Allowlist, Entity = `nora_entity_uuid('sales', id)`). **Neue `user.*`-Ereignisse nie über `insert_audit_event` mit `crypto.randomUUID()` schreiben** — Ereignistyp in `record_employee_admin_event` ergänzen und in `lifecycle_audit_actor_verification.sql` beweisen.

Erster Sign-up: `handle_new_user` nutzt `pg_advisory_xact_lock(89142421, 1)` — exakt ein Admin unter Parallelität.

### Mitarbeiter-Referenzintegrität und historische Identität (User Lifecycle W2, 2026-09-05)

- **Aktive Zuweisung ≠ historische Identität.** `sales_directory` beantwortet „Wem darf ich neue Arbeit zuweisen?" (nur `disabled = false`); `sales_identities` beantwortet „Wer war für diesen bestehenden Datensatz zuständig / wer hat das geschrieben?" (alle Zeilen). Picker → Directory, Anzeige bestehender Daten → Identities (`useGetSalesName`, Export).
- **Alle sechs Referenzen auf `sales.id` sind `NO ACTION`-FKs:** `companies`, `contacts`, `deals`, `deal_notes`, `contact_notes`, `tasks` (`sales_id`). Nie `CASCADE`, nie `SET NULL` — Urheberschaft und Zuständigkeit sind Geschäftsgeschichte.
- **Lösch-Modell:** referenzierter Mitarbeiter → `DELETE` wird von der Datenbank auf jedem Pfad verweigert (23503); unreferenzierter Mitarbeiter → nur `postgres`/`service_role` (künftiger kontrollierter Hard-Delete-Executor). Browser-Rollen haben kein `DELETE`-Privileg auf `sales` und keine DELETE-Policy. Kein Trigger-Guard nötig, kein versteckter Bypass.
- **Was ein späterer Executor prüfen muss:** Zählung der sechs FK-Referenzen = 0 (Preview „Kann sicher gelöscht werden?"); Snapshots in `audit_events`/`email_delivery_events` bleiben; `sales.user_id → auth.users` ist `NO ACTION` in Gegenrichtung (Auth-Identität separat behandeln). Test-Datenpurge nie über `CASCADE`.
- **Aktive Zuweisung ist autoritativ (Hardening):** `guard_active_assignment_trigger` (`BEFORE INSERT OR UPDATE OF sales_id`) auf `companies`, `contacts`, `deals`, `tasks` verweigert, einen deaktivierten Mitarbeiter **neu** zuzuweisen (`DETAIL = NORA_EMPLOYEE_NOT_ASSIGNABLE`, `NoraErrorCode` `EMPLOYEE_NOT_ASSIGNABLE`). Bestehende Referenzen, unverwandte Updates und das Wegwechseln bleiben erlaubt. Nie auf `contact_notes`/`deal_notes` (Urheberschaft). Im Formular: `SalesAssignmentInput` — aktuelle deaktivierte Zuständigkeit sichtbar, nicht wählbar.
- **Archivierungsprinzip:** INAKTIV / ARCHIVIERT ist nicht NICHT-EXISTENT. Gilt perspektivisch für Kontakte, Kunden, Vorgänge — in W2 nur für Mitarbeiter umgesetzt, kein generisches Framework.
- **Neue Referenz auf `sales.id`?** Immer als `NO ACTION`-FK anlegen, in `lifecycle_reference_integrity_verification.sql` Abschnitt 1 (Anzahl 6 → n) und Abschnitt 5 (Blockade je Tabelle) ergänzen, und die Referenzliste in `19-user-lifecycle-architecture.md` §7 erweitern (Referenzgraph im Original: Archiv `releases/2026-09.md`, Eintrag W2).

### Anmeldeadresse ist Identität (User Lifecycle W4, 2026-09-06)

- **Ein Master, ein Spiegel, ein Schreiber.** Die Login-E-Mail lebt in `auth.users.email`; `public.sales.email` ist ihr Spiegel und wird ausschließlich von `nora_private.guard_auth_email_change()` (Owner-Capability `nora_identity_manager`) innerhalb von GoTrues eigener `UPDATE`-Transaktion geschrieben. `handle_update_user` synchronisiert nur noch Namen.
- **Ticket oder Verweigerung.** Jede Änderung von `auth.users.email` ohne lebendes Ticket aus `public.prepare_sales_email_change` (nur `service_role`, verifizierter Admin-Actor) wird von der Datenbank abgelehnt (`NORA_EMAIL_CHANGE_NOT_AUTHORIZED`) — auch über die Admin API mit Service-Key, auch über GoTrue-Selbstbedienung, auch aus dem Dashboard. Mit Ticket geschehen `sales.email`, das Löschen der `auth.one_time_tokens` des Users und `user.email_changed` in derselben Transaktion.
- **Zugang und Identität sind orthogonal.** Der Identity-Manager darf nur `email` (Spalten-Grant + Trigger-Zweig); Rolle/`disabled`/Bann bleiben beim W1-Executor. Eine E-Mail-Änderung aktiviert nie, deaktiviert nie, sendet einem Deaktivierten nie eine Einladung.
- **Normalisierung = Provider-Contract.** `lower(btrim(x))`, Format geprüft, `sales.email` citext + `uq__sales__email`; Eindeutigkeit gegen beide Speicher. Nie eine Adresse ungetrimmt an GoTrue geben (400), nie auf `email_exists` hoffen (Admin-Update liefert rohes `23505`).
- **Alte Links sterben mit der Adresse.** GoTrue prüft Einladungs-/Passwort-Links gegen `auth.one_time_tokens`, nicht gegen die Token-Spalten in `auth.users`. Wer eine Identität bewegt, löscht diese Zeilen; eine neue Einladung wird danach ausdrücklich versendet (nur für Eingeladene, nie für Deaktivierte).
- **Kein generischer Profil-PATCH für Identität.** Ein PATCH-Body mit `email` wird als Ganzes abgewiesen; „Name gespeichert, E-Mail gescheitert" darf nicht existieren. Das Bearbeiten-Formular zeigt die Anmeldeadresse read-only, die Änderung ist eine eigene Aktion mit Konsequenztext je Zustand.
- **Selbständerung ist blockiert** (`NORA_SELF_EMAIL_CHANGE_FORBIDDEN`), Erfolg wird erst nach serverseitiger Verifikation beider Speicher gemeldet, ein Retry ist ein typisiertes No-op (`email_unchanged`) ohne zweites Audit und ohne zweite Einladung.

### Zugang beenden und Sitzungen (User Lifecycle W5, 2026-09-06)

- **Offboarding ist Deaktivieren + Sitzungsende + Audit in einer Transaktion** (`public.offboard_employee_by_executor`, nur `service_role`, verifizierter Admin-Actor). Der Zugang endet sofort; Person, Historie und alle sechs Referenzen bleiben (W2). Offene Zuständigkeiten blockieren nie — sie werden gezählt (`public.get_employee_dependency_preview`: Kunden, Kontakte, offene Vorgänge, offene Aufgaben; Notizen getrennt) und anschließend umverteilt.
- **Sitzungen werden in der Datenbank beendet.** GoTrue bietet keinen Admin-Logout; `nora_private.revoke_auth_sessions` löscht `auth.sessions` (Refresh-Tokens kaskadieren) und Restbestände in `auth.refresh_tokens`. Nur postgres-intern, nur aus dem Executor. Nie aus einer Edge Function oder über einen Browser-Pfad.
- **Ein JWT ist nur so lange etwas wert wie seine Sitzung — und nur, wenn sie ihm gehört (W6-A, RC).** PostgREST prüft die Sitzung nicht; Nora tut es in `nora_private.is_active_user()`/`current_role()` über `jwt_session_is_live()`. Vertrag: `session_id` vorhanden → nur live, wenn `auth.sessions.id = session_id` **und** `auth.sessions.user_id = sub`; Claim malformed (kein UUID-String, JSON `null`, Zahl, Objekt, Array) → verweigert; Claim fehlt, aber PostgREST hat ein JWT übergeben (`request.jwt.claims` gesetzt) → verweigert; nur ohne jedes übergebene JWT (Legacy-Fixture-GUCs, `psql`, Trigger-Kontexte) gilt der Kompatibilitätspfad. **Fail-closed:** kann `postgres` `auth.sessions` nicht lesen → `WARNING` „session binding DENIED" + verweigert. `service_role` und Capability-Rollen unbetroffen. Wer die RLS-Helfer anfasst, erhält die Bindung; die Claim-Klassifikation lebt nur in `nora_private.jwt_session_claim()`.
- **Migrationsregel Session-Bindung:** jede Migration, die `jwt_session_is_live()` oder `auth.sessions` berührt, prüft vorab `has_table_privilege('postgres', 'auth.sessions', 'SELECT')` **und** eine echte Lookup-Probe und bricht sonst ab (Vorbild `20260906210000_nora_lifecycle_session_authorization.sql`); `nora_private.session_binding_health()` (nur `postgres`) ist der eine Gesundheitsprimitive dafür — kein Browser-RPC. SQL-Fixtures, die `request.jwt.claims` setzen, brauchen eine echte `auth.sessions`-Zeile (Konvention: Sitzungs-ID = User-ID).
- **Idempotenz über `disposition`, nicht über neue Spalten.** `executed` (Zugang war aktiv oder es gab Sitzungen) schreibt genau ein `user.offboarded`; `replayed` ändert und schreibt nichts. Kein `offboarded_at`, kein fünfter Zugangsstatus: der Zustand ist aus `sales.disabled` + Bann + Sitzungen abgeleitet.
- **Reihenfolge und Teilausfall:** Datenbank (Guards, Zustand, Sitzungen, Audit) → Auth-Bann → Verifikation. Scheitert der Bann, ist der Zugang trotzdem aus (RLS + Sitzungen); Antwort `employee_access_sync_incomplete` mit `offboarded: true`, Konvergenz per Retry oder „Zugangsstatus synchronisieren". Nie grün ohne Verifikation.
- **Audit-Metadaten bleiben gebunden:** Zähler, Flags, Rolle, Adresse — nie Token, Sitzungs-IDs, Provider-Antworten.

## Checklisten- und Audit-Guardrails (Welle 7b)

Details in `10-checklists-snippets-audit.md`:

- relationale Tabellen als Hauptmodell — kein JSONB-only
- Vorlagenpunkte deaktivieren, nicht löschen
- Audit append-only — Client darf Events nicht ändern/löschen
- keine getrennten Audit-Tabellen pro Bereich
- Textbausteine persistent vor Plus/Minus-UI
- Checklisten-Start nur über `start_checklist_run_from_template` — nicht manuell Run + Items per Client

## Schnellerfassung (Welle v0.3e)

- **Keine Migration** — nutzt `companies`, `contacts`, `deals`, optional `tasks`
- **Quelle/Herkunft** vorerst in `deals.description` als Präfix `Quelle: …` — kein `source_channel`-Feld (später empfohlen)
- **Keine Tags** für Quelle — vermeidet Datenmodell-Duplikate
- **Dubletten** nur heuristisch (Name, Telefon, E-Mail) — keine KI
- **Atomar seit Self Contact Wave (2026-08-26)**: Kunde+Kontakt+Vorgang laufen über den Application Command `createQuickCaptureCase` → RPC `create_quick_capture_case` — kein Teilzustand zwischen diesen dreien mehr möglich. Aufgabe bleibt bewusst ein separater Best-Effort-Schritt danach (kann isoliert fehlschlagen, ohne Kunde/Kontakt/Vorgang zurückzurollen).
- **Draft** pro Benutzer gescoped (`nora-quick-capture-draft:{identity.id}`), Schema-Version + Staleness-Schwelle, Autosave + Lifecycle-Flush — siehe Decision Log „Self Contact Wave"
- **Keine** Gmail/WhatsApp/Google-Kalender-Integration — nur manuelle Quellen-Auswahl

## Dubletten-Vorschläge (Welle v0.3f)

- **Keine Migration** — nutzt bestehende `companies` / `contacts` über `performGlobalSearch`
- **Kein Auto-Merge** — Vorschläge sind informativ; Nutzer wählt bewusst
- **Zentrale Logik** in `duplicateCandidateUtils.ts`:
  - `DuplicateSearchInput` — Eingabe für Schnellerfassung und später Lexware/CSV
  - `scoreCompanyAsDuplicate` / `rankDuplicateCandidates` — deterministisches Scoring
  - Gründe: Kundennummer (100), Telefon/E-Mail (90), ähnlicher Name (50), gleiche Stadt (+20 mit Name)
  - Mindest-Score 50; max. 5 Kandidaten
- **Abfrage-Effizienz** (`useDuplicateCandidateSearch`):
  - Debounce 400 ms
  - Suche erst ab sinnvoller Eingabe (`canSearchQuery`, ≥3 Zeichen Name, gültige E-Mail/Telefon)
  - In-Memory-Cache pro Dialog-Session (`buildDuplicateSearchCacheKey`)
  - Stale-Request-Guard (`latestRequestRef`)
  - Keine parallele API-Schicht — nur `performGlobalSearch`
- **Lexware-Import (später):** Import-Assistent liefert `DuplicateSearchInput` (Name, Telefon, E-Mail, PLZ, Stadt) + Kandidatenliste aus DB; gleiche `rankDuplicateCandidates`-Funktion. Grenzen: keine Fuzzy-Adressen, keine Dubletten über Ansprechpartner ohne Firmenbezug, keine phonetische Namenssuche.

## Schnellerfassung UX (Welle v0.3g)

- **Keine Migration** — Entwürfe nur lokal im Browser, pro Benutzer gescoped (`nora-quick-capture-draft:{identity.id}` in `localStorage`, seit Self Contact Wave — der alte globale Key ohne Benutzer-Scope wird beim Upgrade entfernt, nie migriert)
- **Kein serverseitiger Entwurf** — bewusst weiterhin rein clientseitig (kein echter Nutzen für einen serverseitigen Draft identifiziert)
- **Freie Tab-Navigation** — keine Blockade durch unvollständige Felder zwischen Schritten
- **Ein Kundenvorschlags-Bereich** — `mergeCustomerSearchResults` dedupliziert Suche und Scoring
- **Kein Auto-Merge** — unverändert aus v0.3f
- **Effiziente Suche** — ein Request über `useDuplicateCandidateSearch` (kein paralleler Fetch im Dialog)

## Fensterauftrag-Guardrails (Welle 7a)

Ergänzung zu den Fallen oben — Details in `09-window-order-workflow.md`:

### Falle 14: Chef-Unterstatus als Kanban-Spalten

Falsch:

```text
S4a, S4b, S4c, S5 jeweils eigene Pipeline-Spalte
```

Richtig:

```text
Hauptstatus „Wartet auf Hersteller“ + Checkliste am Vorgang
```

### Falle 15: Höning im Datenmodell verdrahten

Falsch:

```text
stage = hoehning-bestellt
```

Richtig:

```text
stage = wartet-auf-hersteller
Notiz oder manufacturer_name = „Höning“ (oder Lieferant-Datensatz)
```

### Falle 16: Kunden-Tracking-Link ohne Trennung

Falsch:

```text
Öffentliche URL zeigt interne Notizen, Einkaufspreise, Checklistenkommentare
```

Richtig:

```text
Eigenes Portal-Modul mit Token, vereinfachten Kundenstufen, DSGVO-Löschung
```

### Falle 17: Google als Prozesskern

Falsch:

```text
Zapier/Make verbindet Drive, Keep und Gmail als Workflow-Engine
```

Richtig:

```text
Nora = System of Record für CRM; Google Kalender = System of Record für Termine
```

### Falle 22: Zweites Terminsystem in Nora

Falsch:

```text
appointments-Tabelle als führende Terminquelle parallel zu Google Kalender
```

Richtig:

```text
google_calendar_events = Cache + Verknüpfung; Zeit/Titel/Ort führend in Google
```

### Falle 23: Private iCal-Adresse für Integration

Falsch:

```text
iCal-URL des Geschäftskalenders in Nora speichern und periodisch abrufen
```

Richtig:

```text
Google Calendar API mit OAuth; Kalender-ID in google_calendar_connections
```

### Falle 24: Kalender-ID in UI-Komponenten

Falsch:

```text
const CALENDAR_ID = "abc@group.calendar.google.com" in Hotboard.tsx
```

Richtig:

```text
Konfiguration aus DB/Edge Function; UI kennt nur Event-Datensätze
```

### Falle 25: Parallele Benutzerverwaltung für Rollen

Falsch:

```text
Neue profiles- oder user_roles-Tabelle unabhängig von sales
```

Richtig:

```text
sales.role an bestehender CRM-Benutzertabelle; 1:1 zu auth.users
```

### Falle 26: OAuth-Tokens in CRM-Tabellen oder Audit

Falsch:

```text
refresh_token in `google_calendar_connections`, `audit_events.metadata` oder Frontend — stattdessen `nora_private.google_calendar_oauth_secrets`
```

Richtig:

```text
Tokens nur in Edge Function Secrets / Vault; service_role niemals im Browser
```

### Falle 27: Google-Termine pauschal editierbar

Falsch:

```text
Jeder authenticated-Nutzer darf jeden gespiegelten Termin ändern
```

Richtig:

```text
origin = google → read-only; origin = nora → office/admin mit Bestätigung beim Löschen
```

## Operation Status Contract v1 — Guardrails (Welle 2026-08-29, Phase 6C/6D.1)

### Falle 35: Gespeicherten `idempotency_records.result._meta.disposition` als aktuelle externe Ausführungsdisposition lesen

Falsch:

```text
select result -> '_meta' ->> 'disposition' from nora_private.idempotency_records
where idempotency_key = ...;
-- und diesen Wert als "was der Client gerade als Disposition sieht" interpretieren
```

Richtig:

```text
Die drei idempotenten RPCs (create_customer_with_contact, create_quick_capture_case,
create_quick_capture_task) schreiben `_meta.disposition = "executed"` beim Erstschreiben
UNVERÄNDERLICH in die gespeicherte Zeile — dieser Wert bleibt für immer "executed", auch
nach beliebig vielen Replays. Bei jedem Replay überschreibt die RPC den zurückgegebenen
Wert frisch per `v_replay || jsonb_build_object('_meta', jsonb_build_object('disposition',
'replayed'))` (jsonb `||` gewinnt auf der rechten Seite) — die externe Disposition wird
also bei JEDEM Request serverseitig neu berechnet, nie aus der gespeicherten Zeile
übernommen. Die Tabelle ist ohnehin nur über die beiden SECURITY DEFINER-Functions
(`idempotency_check`/`idempotency_persist`) erreichbar, nicht direkt per PostgREST.
Ein künftiger Agent, der z. B. eine Admin-Ansicht oder ein Reporting auf
`idempotency_records` aufbaut, darf `result._meta.disposition` NICHT als „letzte bekannte
Disposition" ausgeben — es ist ein eingefrorener Schreibzeitpunkt-Wert, kein Live-Status.
Empirisch verifiziert (Decision Log „2026-08-29 – Operation Status Contract Wave",
Nachtrag Phase 6C und 6D.1): direkte Abfrage der Zeile zeigt weiterhin `"executed"`,
während der gleichzeitige Replay-Response korrekt `"replayed"` liefert.
```

### Falle 36: KI/Automatisierung mit rohem SQL direkt gegen `audit_events`

Falsch:

```text
Ein zukünftiger LLM-/Automatisierungs-Consumer generiert eigenständig
SELECT-Statements gegen public.audit_events (oder andere Rohtabellen), um
"die Historie eines Kunden" zu beantworten.
```

Richtig:

```text
Zukünftige KI-/Automatisierungs-Konsumenten von Business-Historie gehen ausschließlich
über anwendungsseitige Read-Models/Queries (konzeptionell z. B. GetCustomerHistory(customerId)),
niemals über roh generiertes SQL direkt gegen audit_events oder andere Tabellen. Dies ist
eine Architekturregel für künftige Wellen (Notification-/Status-UI, KI-Assistenz) — in
dieser Session bewusst NICHT implementiert, nur als Guardrail dokumentiert.
```

`operation_id` (technische Korrelation über Manager/Audit/Error-Observatory hinweg, wo
unterstützt) und `idempotency_key` (fachliche Retry-Absicht) sind zwei unterschiedliche
Konzepte und dürfen nicht verwechselt werden. `audit_events.request_id` ist trotz des
historischen Spaltennamens die `operation_id`-Korrelation (befüllt aus dem Request-Header
`x-nora-operation-id`, siehe `nora_private.current_operation_id()` in Migration
`20260810160000_nora_operation_correlation.sql`) — keine zweite, unabhängige Request-ID.

### Falle 37: Presentation erfindet einen Core-Lifecycle (Welle Phase 7B)

Falsch:

```text
Die Notification braucht einen Zustand "teilweise erfolgreich", also bekommt
OperationStatus einen vierten Wert 'partial' — oder ein lange laufendes 'pending'
wird nach n Sekunden als 'error'/'timeout' dargestellt.
```

Richtig:

```text
Der technische OperationStatus bleibt 'pending' | 'success' | 'error'. Ein Presentation-
Lifecycle darf zusätzliche Werte kennen ('partial' = Core committed, optionaler Folgeschritt
nicht), diese entstehen aber ausschließlich durch Reduktion mehrerer OperationRecords in der
Presentation und werden NIE in den Core zurückgeschrieben. Ebenso wird ein lange laufendes
'pending' von der Presentation niemals zu 'error' umgedeutet — der fehlende Timeout-Lifecycle
ist ein bekannter Core-Follow-up und darf nicht durch eine Anzeige-Heuristik kaschiert werden.
Zulässig wäre höchstens ein zusätzlicher Hinweis "dauert länger als erwartet" bei
unverändertem Lifecycle und Tone.
```

### Falle 38: Eine vorgegebene `operationId` registrieren, ohne die tatsächlich vergebene zu prüfen (Welle Phase 7B)

Falsch:

```text
Eine äußere Schicht mintet eine ID, meldet sie irgendwo an (z. B. als Korrelationsziel)
und übergibt sie an manager.execute() — in der Annahme, dass genau diese ID verwendet wird.
```

Richtig:

```text
createOperationContext() normalisiert eine vorgegebene operationId: ungültige Werte werden
verworfen und durch eine frisch geminte ersetzt, gültige werden lowercased. Wer eine ID
vorab anmeldet und dann auf manager.getOperation(id) wartet, wartet bei einer ungültigen
oder uppercase-UUID also auf eine ID, die es nie geben wird — der wartende Zustand löst
sich nie auf. Vorgegebene IDs müssen daher entweder garantiert gültig und lowercase sein
(so wie createOperationId() sie liefert) oder die anmeldende Schicht muss sich an die
tatsächlich vergebene Kontext-ID binden statt an die gewünschte.
```

### Falle 39: Mitarbeiternamen aus `sales_directory` auflösen oder eine Referenz auf `sales.id` mit `CASCADE`/`SET NULL` anlegen (User Lifecycle W2)

Falsch:

```text
useGetManyAggregate("sales_directory", …) für den Autor einer alten Notiz
  → deaktivierter Mitarbeiter: leerer Name / Export-Crash
contact_notes.sales_id references sales(id) on delete cascade
  → Mitarbeiter löschen löscht Geschäftshistorie
tasks.sales_id ohne FK → Waisen, Fantasie-IDs
```

Richtig:

```text
Anzeige bestehender Daten: sales_identities (alle Zeilen, disabled-Flag)
Auswahl für Neues:        sales_directory (nur aktive)
Jede Referenz auf sales.id: FK NO ACTION; Name bleibt Name, kein „Unbekannt"
```

Details und Lösch-Modell: Abschnitt „Mitarbeiter-Referenzintegrität und historische Identität (User Lifecycle W2)" oben, Decision Log „2026-09-05 – User Lifecycle W2".

## Migrationsregel

Vor einer Migration dokumentieren:

- Warum ist das Feld nötig?
- Welche bestehenden Workflows belegen den Bedarf?
- Welche alten Daten müssen migriert werden?
- Welche UI-Stellen müssen angepasst werden?
- Gibt es eine rückwärtskompatible Lösung?

Technische Regeln, die sich aus früheren Migrationen ergeben haben (Begründung jeweils in `06-decision-log.md`):

- **Views nur am Ende erweitern:** neue Spalten in `companies_summary`/`contacts_summary` (oder jeder anderen View) ans Ende der `select`-Liste — `create or replace view` interpretiert eine verschobene Position als Umbenennung (`42P16`).
- **Signaturänderung einer RPC = `DROP FUNCTION` + `CREATE`:** ein zusätzlicher Parameter per `CREATE OR REPLACE` erzeugt eine Überladung, die PostgREST nicht auflösen kann (`PGRST203`).
- **Grants: immer `revoke all` vor `grant`:** additive Grants lassen die von den Default-Privilegien geerbten Rechte (`TRUNCATE`/`REFERENCES`/`TRIGGER`/`MAINTAIN`) stehen; ein lokaler `db reset` ist großzügiger als Production — Privilegienaussagen gegen Production prüfen.
- **Kein `CREATE INDEX CONCURRENTLY`** in CLI-Migrationen (Transaktion); bei großen Tabellen eigene nicht-transaktionale Migration.
- **Bereits angewendete Migrationen nie editieren**; `supabase/schemas/*.sql` synchron nachziehen; nach jedem Production-Apply den Ledger gegen den Dateinamen-Zeitstempel prüfen (`07-agent-change-checklist.md`).
