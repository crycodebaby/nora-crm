# Nora Documentation

Stand: 2026-09-10. Dies ist der **einzige kanonische Router** der Nora-Dokumentation: welches Dokument wofür zuständig ist, wann es geladen wird und in welcher Reihenfolge ein neuer Agent liest. Er ist **keine** Architekturbeschreibung, kein Zustandsbericht, kein Decision Log und keine Release-Historie — dafür gibt es die verlinkten Dokumente.

Kein anderes Dokument führt einen konkurrierenden Dokumentenkatalog. `AGENTS.md` nennt nur den Always-Kontext und verweist hierher; `16-current-state.md` beschreibt den Zustand und verweist hierher.

## Load-Klassen

| Klasse | Dokumente | Wann |
|---|---|---|
| **ALWAYS** | `AGENTS.md` · dieser Router · [`16`](16-current-state.md) · [`01`](01-domain-model.md) · [`03`](03-data-model-guardrails.md) · [`07`](07-agent-change-checklist.md) | jede Aufgabe |
| **CONDITIONAL CURRENT CONTRACT** | die Subsystemdokumente aus der Tabelle „Architekturbereiche" — darunter [`22`](22-security-and-access.md) (Security / Access / RBAC / RLS / Grants / Authorization) | wenn das Subsystem betroffen ist |
| **CONDITIONAL RUNBOOK** | [`21`](21-agent-runbooks.md) | **nur die betroffene Sektion** (1–15, siehe Architekturbereiche) — operative Zusatzschritte beim Ändern; **nie** als ganze Datei |
| **OPEN STATE** | [`17`](17-known-issues-and-planned-waves.md) | **nur die betroffene Sektion** (A–I, siehe Architekturbereiche); vollständig nur bei Roadmap-, Release- oder Cross-Cutting-Review |
| **RATIONALE** | [`06`](06-decision-log.md) | nur bei Entscheidungs-/Begründungsbedarf, und dann **gezielt über den benannten Eintrag** aus der Architekturbereiche-Tabelle bzw. den thematischen Index in `06` — **nie** als ganze Datei |
| **HISTORY** | [`releases/`](releases/README.md) | nur für historische Evidenz, Regression, Release-Abstammung oder Rekonstruktion |

## Start here

Für einen neuen Engineering-/KI-Agenten:

1. dieser Router (`README.md`)
2. [`16-current-state.md`](16-current-state.md) — was ist heute live, Truth Hierarchy
3. [`01-domain-model.md`](01-domain-model.md) — aktuelles Fach-/Domänenmodell
4. [`03-data-model-guardrails.md`](03-data-model-guardrails.md) — universelle Daten-/Persistenzinvarianten und der globale Fallen-Index (Nummer → Owner)
5. das Architekturdokument des betroffenen Subsystems (Tabelle „Architekturbereiche" unten)
6. daraus: die zugehörige `17`-Sektion, die zugehörige `21`-Runbook-Sektion und — nur bei Begründungsbedarf — der benannte `06`-Eintrag

Vor jeder Änderung außerdem: [`07-agent-change-checklist.md`](07-agent-change-checklist.md) — das universelle Change Protocol. Es ist bewusst klein; die subsystem- und situationsabhängigen Zusatzschritte stehen sektionsweise in [`21-agent-runbooks.md`](21-agent-runbooks.md).

Bei allen Änderungen an `sales`, der `users` Edge Function, Auth oder Audit-Ereignissen `user.*` ist [`19-user-lifecycle-architecture.md`](19-user-lifecycle-architecture.md) **Pflicht**.

Bei allen Änderungen an **Rollen, Berechtigungen, RLS, Grants, `SECURITY DEFINER`, `service_role`, Session-Autorisierung oder privilegierten Read-Views** ist [`22-security-and-access.md`](22-security-and-access.md) **Pflicht** — Suchbegriffe, die dorthin führen: `SECURITY DEFINER` · `security_invoker` · RLS · Policy · Grants · Default-Privilegien · `public`-Privilegien · `sales.role` · `admin`/`office`/`viewer` · Berechtigungsmatrix · Capability-Rolle · `nora_private` · PostgREST-Exposure · `service_role` · Trust Boundary · Session-Autorisierung · `auth.sessions` · Executor · Actor-Verifikation · privilegierte Read-Views · `init_state` · `sales_directory`. Die operativen Zusatzschritte dazu stehen in [`21`](21-agent-runbooks.md) Sektion 4 und 5.

## Dokument-Zuständigkeiten

| Dokument | Zuständig für |
|---|---|
| [`00-project-context.md`](00-project-context.md) | Betrieb, Produktziel, Nicht-Ziele |
| [`01-domain-model.md`](01-domain-model.md) | aktuelles Fach-/Domänenmodell (Kunde ≠ Kontakt ≠ Vorgang ≠ Aufgabe, fachliche Rollen- und Mitarbeiter-Kurzfassung — **keine** Berechtigungsmatrix, die steht in [`22`](22-security-and-access.md)) |
| [`02-design-system.md`](02-design-system.md) | globale Designgrundlagen (Marke, Brandfarbe, Typografie, Spacing, Utilities) sowie derzeit noch Feature-/Subsystem-UX. **Nora hat kein fertiges visuelles Design-System** — offene projektweite Design-/Accessibility-Punkte stehen in [`17`](17-known-issues-and-planned-waves.md) Abschnitt F |
| [`03-data-model-guardrails.md`](03-data-model-guardrails.md) | **universelle** Daten- und Persistenzinvarianten: Kern-Entitäten, IDs/Nullability/Referenzintegrität, Transaktionen/Sperren/Concurrency, Migrationsinvarianten, universeller DB-Fehlervertrag — sowie der **globale Fallen-Index** (Nummer 1–40 → kanonischer Owner). **Kein** Security |
| [`04-routing-i18n.md`](04-routing-i18n.md) | deutsche Routen, i18n-Konventionen |
| [`05-demo-data-guidelines.md`](05-demo-data-guidelines.md) | FakeRest-/Demo-Daten |
| [`06-decision-log.md`](06-decision-log.md) | durable Entscheidungen **mit Begründung** (thematischer Index am Anfang) |
| [`07-agent-change-checklist.md`](07-agent-change-checklist.md) | **universelles** Change Protocol: Vor-/Während-/Nach-der-Änderung, Production-Sicherheit, Release-Grundreihenfolge, STOP-Regeln, Dokumentations-Abschluss — nur Regeln, die bei fast jeder Änderung gelten |
| [`08-numbering-and-global-search.md`](08-numbering-and-global-search.md) · [`09-window-order-workflow.md`](09-window-order-workflow.md) · [`10-checklists-snippets-audit.md`](10-checklists-snippets-audit.md) | Spezifikationen: Nummern/Suche, Fensterauftrag, Checklisten/Textbausteine |
| [`11-google-calendar-rbac.md`](11-google-calendar-rbac.md) · [`14-google-calendar-readonly-implementation.md`](14-google-calendar-readonly-implementation.md) | Google-Kalender-Integration: Architektur/Spezifikation und Implementierung, inkl. **kalenderspezifischem** Access, OAuth und Secrets — **die `calendar-*` Edge Functions sind nicht deployt**. Das **globale** Rollenmodell liegt seit CR2 in [`22`](22-security-and-access.md), nicht mehr hier |
| [`12-role-ux-acceptance.md`](12-role-ux-acceptance.md) | **historisches** Rollen-UX-Abnahmeprotokoll (v0.3k.2, Stand 2026-07-14) — kein aktueller Design-Contract; wird von [`21`](21-agent-runbooks.md) und [`13`](13-crm-audit-retention.md) als Abnahmevorlage referenziert |
| [`13-crm-audit-retention.md`](13-crm-audit-retention.md) | aktueller Audit-Vertrag (Ereignisse, Actor-Modell, Retention) |
| [`16-current-state.md`](16-current-state.md) | aktuelle Live-Momentaufnahme (was ist live, welche Versionen) und die Truth Hierarchy |
| [`17-known-issues-and-planned-waves.md`](17-known-issues-and-planned-waves.md) | **nur genuin offene** Bugs, Restrisiken, geplante Wellen, ungelöste Entscheidungen — sektionsweise geladen (A–I) |
| [`18-email-delivery-observability.md`](18-email-delivery-observability.md) | E-Mail-Zustellbeobachtung (Brevo-Vertrag, Operator-Konfiguration) |
| [`19-user-lifecycle-architecture.md`](19-user-lifecycle-architecture.md) | aktuelle User-Lifecycle-Architektur, Roadmap W1–W10 |
| [`20-product-changelog.md`](20-product-changelog.md) | benutzerseitige Nora-Produkthistorie |
| [`21-agent-runbooks.md`](21-agent-runbooks.md) | **conditional** Agent Runbooks: subsystem- und situationsabhängige operative Zusatzschritte beim Ändern (Testsequenzen, Verifikationen, Fallstricke) — sektionsweise geladen (1–15), nie vollständig |
| [`22-security-and-access.md`](22-security-and-access.md) | **globaler Security- und Access-Contract**: Enforcement-Prinzip, Authentication vs. Authorization, Rollen (`sales.role`) und Capability-Rollen, globale Berechtigungsmatrix, Trust Boundaries, Database Enforcement (RLS, Grants, Default-Privilegien, neue `public`-Objekte, `SECURITY DEFINER`, privilegierte Read-Views, `nora_private`, PostgREST-Exposure), Session- und Executor-Integrität |
| [`releases/`](releases/README.md) | **historische** Release-Evidenz (RC-SHAs, Migrationen, Ledger, Edge-Versionen, Live-Beweise, Originalwortlaut alter Einträge) |

## Architekturbereiche

Die **eine** Routingtabelle: pro Bereich der aktuelle Contract, der benannte `06`-Eintrag für das Warum, die `17`-Sektion für die offenen Punkte und die `21`-Runbook-Sektion für die operativen Zusatzschritte beim Ändern. `06`, `17` und `21` werden **eintrags- bzw. sektionsweise** geladen, nie als ganze Datei.

| Bereich | Aktueller Contract | Entscheidung: Eintrag in `06` | Offene Punkte: Sektion in `17` | Runbook-Sektion in `21` |
|---|---|---|---|---|
| Kern-CRM / Domäne (Kunden, Kontakte, Vorgänge, Aufgaben, Notizen) | [`01`](01-domain-model.md) + [`03`](03-data-model-guardrails.md) | Atomic Contact Primary Intent · Self Contact Wave · Unified Tasks Wave · Customer & Contact Workflow Wave | G | 15 |
| Mitarbeiter-/User-Lifecycle (Einladung, Rolle, Zugang, Anmeldeadresse, Offboarding, Session-Bindung, Hard Delete) | [`19`](19-user-lifecycle-architecture.md) | User Lifecycle W1–W6-B · V1A Zugangsstatus · V1B Präsentation | B | 6 |
| Mitarbeiter-Onboarding (Einladung → Passwort → Profil) | [`19`](19-user-lifecycle-architecture.md) Abschnitt 4 · [`02`](02-design-system.md) Abschnitt Mitarbeiter-Onboarding & Zugang · `login/employeeOnboardingFlow.ts` | V1A Zugangsstatus · V1B Präsentation | B | 6 |
| **Security / Access / Rollen / RBAC / RLS / Grants / Authorization** | [`22`](22-security-and-access.md) | Global Security & Access Owner · Wave 1 Default-Privilegien & Zielmatrix · Wave 0 TRUNCATE · RBAC/RLS v0.4b · v0.4b.1 · v0.4b.2 · Privilegierte Read-Views · Residual Advisor Closure | A | 4 · 5 |
| Audit | [`13`](13-crm-audit-retention.md) | CRM-Audit v0.3l · Checklisten/Audit-Datenmodell 7b · W3 Audit-Actor | A · B | 7 |
| E-Mail-Zustellung | [`18`](18-email-delivery-observability.md) | V1C-A Best-Effort-Korrelation · V1C-B Zustellstatus-UI | C | — |
| Google Kalender | [`14`](14-google-calendar-readonly-implementation.md) (Implementierung) · [`11`](11-google-calendar-rbac.md) (Architektur/Spezifikation) · [`22`](22-security-and-access.md) (globale Berechtigung) — **die drei `calendar-*` Edge Functions sind nicht deployt; Deployment-Stand im Kopf von `11` und `14`** | Architektur & Rollenmodell v0.4a · Read-only-Grundlage v0.4c.1 · OAuth & Sync v0.4c.2 | — | 8 |
| Fehler-/Operations-/Feedback-Contract | [`03`](03-data-model-guardrails.md) §6 (universeller DB-Fehlervertrag) und §5 (Persistenz-Boundary) · [`21`](21-agent-runbooks.md) §11–§13 (`Interim-Contract` — dieser Bereich hat noch keinen eigenen Contract-Owner) · `domain/noraErrorCodes.ts` · `operations/*` · `notifications/*` | Error Contract Wave · Operation Status Contract v1 · Idempotency Wave · Notification Presentation Contract 7A/7B · Error Observatory (FW3) · Operation Manager (FW2) · Operation Correlation (FW1) | D | 11 · 12 · 13 |
| PWA / Update-Verhalten | [`06`](06-decision-log.md) Eintrag PWA-Update-Lifecycle (die acht durablen Regeln) · [`02`](02-design-system.md) Abschnitt Anwendungs-Systemereignisse (Präsentation) · `pwa/*` | Update-Lifecycle 1B–V2 (konsolidiert) | E | 14 |
| Design / UX | [`02`](02-design-system.md) | Typografie 4 · Kanban Navigation Rail · Kontakterstellung UI-Polish · Customer Create Speed & Clarity | F | 9 |
| Rollen-UX-Abnahme (**historisches Protokoll v0.3k.2, Stand 2026-07-14** — kein aktueller Design-Contract) | [`12`](12-role-ux-acceptance.md) | Rollenbewusste UX v0.3k | G | 9 |
| Routing / i18n | [`04`](04-routing-i18n.md) | — | — | — |
| Demo-Daten / Demo-Rollensimulation | [`05`](05-demo-data-guidelines.md) · [`04`](04-routing-i18n.md) Abschnitt Demo-Rollensimulation | Basisentscheidungen 2026-06-28 | — | 10 |
| Nummern, Suche, Fensterauftrag, Checklisten | [`08`](08-numbering-and-global-search.md) · [`09`](09-window-order-workflow.md) · [`10`](10-checklists-snippets-audit.md) | Nummern 6c · Globale Suche 6d · Fensterauftrag 7a · Checklisten/Audit-Datenmodell 7b | G | 2 · 3 |
| Build, Bundle-Budget, Visualizer, CI-Baselines | [`06`](06-decision-log.md) Einträge Visualizer Production Exclusion und Kernindizes und Bundle-Budget | Visualizer Production Exclusion · Kernindizes und Bundle-Budget | I | — |
| Produkt-Changelog, `/changelog`-Vertrag | [`20`](20-product-changelog.md) | — | — | — |
| Projektziel, Nicht-Ziele | [`00`](00-project-context.md) | Basisentscheidungen 2026-06-28 | — | — |

**Unabhängig vom Subsystem:** Wer eine Migration schreibt oder gegen eine echte Production-Datenbank schreibt, liest zusätzlich [`21`](21-agent-runbooks.md) Sektion 1 (Ledger-Hazard beim `apply_migration`); wer RBAC/RLS, Grants oder `SECURITY DEFINER` ändert, [`22`](22-security-and-access.md) **plus** [`21`](21-agent-runbooks.md) Sektion 4 und 5; wer nach einem Deployment einen Live-Smoke macht, Sektion 14.

Sektionen in [`17`](17-known-issues-and-planned-waves.md): **A** Sicherheit und Privilegien · **B** Mitarbeiter-Lifecycle · **C** E-Mail-Zustellbeobachtung · **D** Operationen, Fehler, Feedback · **E** PWA und Motion · **F** Design-System (projektweit) · **G** Kunden, Kontakte, Vorgänge, Aufgaben · **H** Bekannte, nicht untersuchte Themen · **I** Build, Bundle und CI.

Die Nummer `15` ist nicht vergeben (keine `15-*.md` in der Git-Historie) — keine bewusste Reservierung.

## Source-of-Truth-Prinzip

Wenn aktuelle Dokumentation und historische Release-Evidenz sich widersprechen:

1. **Tatsächlicher Zustand gewinnt** — und zwar in dieser Reihenfolge: verifizierter Production-Zustand, dann aktueller Code und aktuelle Migrationen im Repository. Weichen beide materiell voneinander ab, beschreibt Production, was **heute läuft**, und das Repository, was der **nächste Release** enthalten wird. Vollständige Truth Hierarchy in [`16`](16-current-state.md) Abschnitt 7.
2. **Aktuelle Architektur-/Guardrail-Dokumente** (`01`, `03`, `13`, `16`, `18`, `19`, `22`, …) beschreiben den *beabsichtigten aktuellen Vertrag*.
3. **Das Decision Log** (`06`) erklärt das *Warum*.
4. **Das Release-Archiv** (`releases/`) erklärt, *was historisch passiert ist* — mit dem Wissensstand des jeweiligen Datums.

**Historische Release-Dokumente sind niemals die autoritative Quelle für den aktuellen Zustand.** Ein Archiveintrag, der „RC, nicht deployt" sagt, beschreibt seinen Tag, nicht heute.

Zwei SHAs sind zwei Fakten: der **Repository-/Dokumentationskopf** (aktueller `main`, wandert mit jedem Docs-Commit) und der **letzte Laufzeit-Release** (steht in [`16`](16-current-state.md) Abschnitt 4). Ein Docs-Commit ist kein Laufzeit-Release.

## Kontextdisziplin für Agenten

Für normale Arbeit werden **nur die zuständigen aktuellen Dokumente** geladen (Load-Klassen oben). Nicht automatisch und nicht als ganze Datei einlesen:

- das vollständige Decision Log [`06`](06-decision-log.md) — nur der benannte Eintrag aus der Architekturbereiche-Tabelle bzw. über den thematischen Index in `06`,
- das vollständige [`17`](17-known-issues-and-planned-waves.md) — nur die betroffene Sektion (A–I); vollständig nur bei Roadmap-, Release- oder Cross-Cutting-Review,
- das vollständige [`21`](21-agent-runbooks.md) — nur die Sektion, die die Architekturbereiche-Tabelle für die Aufgabe nennt,
- alle Release-Archivdateien,
- Architekturdokumente nicht betroffener Subsysteme.

Historische Evidenz wird nur geöffnet, wenn

- eine Regression untersucht wird,
- eine Release-Abstammung (SHA, Migration, Edge-Version) verifiziert werden muss,
- das *Warum* einer durablen Entscheidung verstanden werden muss,
- ein früherer Production-Zwischenfall rekonstruiert wird.

Nach einer Änderung gilt der Dokumentations-Abschlusscheck in [`07`](07-agent-change-checklist.md): nur die zuständigen Dokumente nachziehen; Erledigtes ins Archiv verschieben, nicht löschen.

## Kurzreferenz: wo liegt die Wahrheit?

Nur bereits dokumentierte und verifizierte Fakten; Details ausschließlich in den verlinkten Dokumenten.

| Frage | Führender Ort | Dokument |
|---|---|---|
| Anmeldeadresse eines Mitarbeiters | `auth.users.email` (Master), `sales.email` (Spiegel) | [`19`](19-user-lifecycle-architecture.md) §3, §9 |
| Rolle eines Mitarbeiters | `sales.role` | [`22`](22-security-and-access.md) §4, [`19`](19-user-lifecycle-architecture.md) §3 |
| Zugang aktiv/deaktiviert | `sales.disabled` + Auth-Bann; Status abgeleitet, nie gespeichert | [`19`](19-user-lifecycle-architecture.md) §4 |
| Wem darf Neues zugewiesen werden? | `sales_directory` (nur aktive) | [`19`](19-user-lifecycle-architecture.md) §8 |
| Wer war zuständig / hat geschrieben? | `sales_identities` (alle, inkl. deaktivierte) | [`19`](19-user-lifecycle-architecture.md) §7 |
| Kunden · Ansprechpartner · Vorgänge · Aufgaben | `companies` · `contacts` · `deals` · `tasks` | [`01`](01-domain-model.md) |
| Änderungsverlauf | `audit_events` (append-only) | [`13`](13-crm-audit-retention.md) |
| Termine | Google Kalender ist und bleibt System of Record. **Die Nora-Leseseite ist nicht deployt** (`calendar-*` Edge Functions fehlen in Production) — Nora zeigt derzeit keine Termine | [`11`](11-google-calendar-rbac.md), [`14`](14-google-calendar-readonly-implementation.md) |

## Produkt-Changelog

[`20-product-changelog.md`](20-product-changelog.md) enthält die **Nora-eigenen** Produktänderungen für Büro, Leitung und IT. Eine künftige Seite `/changelog` in Nora zeigt genau dieses Produkt-Changelog — **nicht** das Atomic-CRM-Upstream-`CHANGELOG.md` im Repository-Root. Die Oberfläche dafür ist nicht Teil dieser Dokumentationswelle.
