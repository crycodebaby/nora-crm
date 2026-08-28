# 03 – Datenmodell-Guardrails

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

`error.message` ist niemals ein stabiler Business-Code — freier DB-/Exception-Text darf nicht direkt an einen i18n-Key angehängt werden (erzeugt nie-übersetzte Keys, die dem Büropersonal als Rohtext angezeigt werden). `normalizeCrmError.ts`/`CrmErrorKind` (`misc/normalizeCrmError.ts`) ist die einzige Stelle, die technische Fehler auf stabile `messageKey`s abbildet — bei neuen Business-Rejections (neue RPC-Exception-Texte) dort ein neues Pattern/`CrmErrorKind` ergänzen, kein zweites Error-Framework bauen. **Verifizierter, in dieser Session behobener Fall:** `application/commands/createQuickCaptureCase.ts` reichte bei einem RPC-Fehlschlag den rohen `error.message` unverändert als `QuickCaptureSubmitError`-Code durch, den `QuickCaptureDialog.tsx` direkt in einen i18n-Key-Suffix einsetzte — behoben durch `normalizeCrmError()` mit neuem `contact_not_in_customer_context`/`self_contact_delete_blocked`-Mapping (Pre-Production Hardening Patch, 2026-08-27).

**Error Contract Wave (2026-08-28) — Nachtrag:** `normalizeCrmError()` ist jetzt machine-code-first. Für migrierte RPCs/Trigger ist die maßgebliche Quelle nicht mehr der Nachrichtentext, sondern `DETAIL = 'NORA_<CODE>'` (`PostgrestError.details`), definiert in `domain/noraErrorCodes.ts` (`NoraErrorCode`, `NORA_ERROR_DEFINITIONS`). Neue Business-Rejections bekommen dort einen neuen `NoraErrorCode` **und** serverseitig `USING DETAIL = 'NORA_<CODE>'` — kein neues Regex-Pattern als primären Mechanismus. Ein Regex-Pattern auf Nachrichtentext bleibt nur als Legacy-Fallback für nicht migrierte Aufrufer zulässig, niemals als einzige Erkennung für einen neuen Code. `error.message` bleibt weiterhin niemals ein Business-Code — das gilt jetzt auch für `error.details`: nur ein in `NORA_ERROR_CODES` kanonisch gelisteter Wert wird akzeptiert (kein `startsWith("NORA_")`-Raten).

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
- **Öffentliche RPCs** in `public`: `set_sales_role_by_admin`, `start_checklist_run_from_template`
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

`public.init_state` und `public.sales_directory` sind verifizierte, bewusste Ausnahmen mit geprüfter minimaler Datenprojektion — siehe `17-known-issues-and-planned-waves.md` „Security Advisor Findings — assessed 2026-08-28" und `06-decision-log.md` „2026-08-28 – Intentional privileged read views". Für diese beiden Views gilt zusätzlich: Änderungen an Projektion, Grants, zugrunde liegender RLS oder `security_invoker` erfordern eine neue Security-Bewertung, keine Wiederverwendung der alten Einstufung.

Die vom Advisor gemeldeten ausführbaren `SECURITY DEFINER`-Functions/RPCs (`anon_security_definer_function_executable` / `authenticated_security_definer_function_executable`) wurden in der Folge-Session „Residual Security Advisor Closure" (2026-08-28) bewertet — siehe `17-known-issues-and-planned-waves.md` und `06-decision-log.md`. Wichtige Unterscheidung für künftige Agenten: eine Function mit Rückgabetyp `trigger` oder `event_trigger` kann **nicht** direkt aufgerufen werden (Postgres-Engine-Restriktion, unabhängig von EXECUTE-Grants; PostgREST exponiert sie ohnehin nicht als RPC) — ein Advisor-Warning dazu ist strukturell ein Falsch-Positiv, kein Nachweis für Exposure. Ein Advisor-Warning zu einer Function mit „echtem" Rückgabetyp (z. B. `jsonb`, `uuid`, `void`) muss dagegen immer einzeln geprüft werden (Grants, serverseitige Auth-Checks, search_path).

Ebenso wurde geprüft: ein gesetzter `search_path = public` (statt `''`) bei `SECURITY DEFINER` ist auf Production nur deshalb unkritisch, weil keine client-facing Rolle (`anon`/`authenticated`/`PUBLIC`) `CREATE` auf `public` besitzt. Diese Grant-Voraussetzung vor jeder neuen `SECURITY DEFINER`-Function mit nicht-leerem `search_path` erneut prüfen — nicht pauschal von der aktuellen Bewertung ausgehen, falls sich Schema-Grants künftig ändern.

### sales-Datenexposition (v0.4b.2)

| Ressource | Wer liest | Felder |
|-----------|-----------|--------|
| `public.sales_directory` | alle aktiven Rollen | `id`, `first_name`, `last_name`, `avatar` — Teamlisten, Betreuer-Auswahl |
| `public.sales` | Admin: alle Zeilen; sonst nur eigene Zeile | vollständiges Profil inkl. `role`, `email`, `disabled` nur für Admin-Verwaltung / eigenes Profil |

Direkte Data-API-Updates auf `role`, `disabled`, `administrator`, `user_id`, `email` bleiben blockiert (Trigger). Rollenänderung nur über `set_sales_role_by_admin` → `nora_private.apply_sales_role_change` (Owner `nora_role_manager`).

Erster Sign-up: `handle_new_user` nutzt `pg_advisory_xact_lock(89142421, 1)` — exakt ein Admin unter Parallelität.

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

## Migrationsregel

Vor einer Migration dokumentieren:

- Warum ist das Feld nötig?
- Welche bestehenden Workflows belegen den Bedarf?
- Welche alten Daten müssen migriert werden?
- Welche UI-Stellen müssen angepasst werden?
- Gibt es eine rückwärtskompatible Lösung?
