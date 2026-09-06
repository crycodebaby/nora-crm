# Nora Documentation

Stand: 2026-09-06. Dies ist der **Navigationsindex** der Nora-Dokumentation: welches Dokument wofür zuständig ist und in welcher Reihenfolge ein neuer Agent liest. Er ist **keine** Architekturbeschreibung, kein Zustandsbericht, kein Decision Log und keine Release-Historie — dafür gibt es die verlinkten Dokumente.

## Start here

Für einen neuen Engineering-/KI-Agenten:

1. dieser Index (`README.md`)
2. [`16-current-state.md`](16-current-state.md) — was ist heute live, Truth Hierarchy, Themen-Tabelle
3. [`01-domain-model.md`](01-domain-model.md) — aktuelles Fach-/Domänenmodell
4. [`03-data-model-guardrails.md`](03-data-model-guardrails.md) — durable Invarianten und Fallen
5. das Architekturdokument des betroffenen Subsystems (Tabelle „Architekturbereiche" unten)
6. [`17-known-issues-and-planned-waves.md`](17-known-issues-and-planned-waves.md) — nur die für die Aufgabe relevanten offenen Punkte

Vor jeder Änderung außerdem: [`07-agent-change-checklist.md`](07-agent-change-checklist.md).

**Nicht standardmäßig lesen:** das vollständige Decision Log ([`06-decision-log.md`](06-decision-log.md)) und das Release-Archiv ([`releases/`](releases/README.md)). Beide werden nur geöffnet, wenn historische Begründung oder Release-Evidenz gebraucht wird (siehe „Kontextdisziplin").

## Dokument-Zuständigkeiten

| Dokument | Zuständig für |
|---|---|
| [`00-project-context.md`](00-project-context.md) | Betrieb, Produktziel, Nicht-Ziele |
| [`01-domain-model.md`](01-domain-model.md) | aktuelles Fach-/Domänenmodell (Kunde ≠ Kontakt ≠ Vorgang ≠ Aufgabe, Rollen, Mitarbeiter-Kurzfassung) |
| [`02-design-system.md`](02-design-system.md) | aktueller UX-/Design-System-Vertrag (Tokens, Systemereignisse, Onboarding-Gestaltung) |
| [`03-data-model-guardrails.md`](03-data-model-guardrails.md) | durable technische Invarianten, Datenmodell-Fallen, Grants-/RLS-Guardrails, Migrationsregeln |
| [`04-routing-i18n.md`](04-routing-i18n.md) | deutsche Routen, i18n-Konventionen |
| [`05-demo-data-guidelines.md`](05-demo-data-guidelines.md) | FakeRest-/Demo-Daten |
| [`06-decision-log.md`](06-decision-log.md) | durable Entscheidungen **mit Begründung** (thematischer Index am Anfang) |
| [`07-agent-change-checklist.md`](07-agent-change-checklist.md) | Checkliste für Implementierung, Release-Reihenfolge, Dokumentations-Abschluss |
| [`08-numbering-and-global-search.md`](08-numbering-and-global-search.md) · [`09-window-order-workflow.md`](09-window-order-workflow.md) · [`10-checklists-snippets-audit.md`](10-checklists-snippets-audit.md) | Spezifikationen: Nummern/Suche, Fensterauftrag, Checklisten/Textbausteine |
| [`11-google-calendar-rbac.md`](11-google-calendar-rbac.md) · [`14-google-calendar-readonly-implementation.md`](14-google-calendar-readonly-implementation.md) | Rollenmodell/RBAC-Matrix, Google-Kalender-Integration |
| [`12-role-ux-acceptance.md`](12-role-ux-acceptance.md) | Rollen-UX-Abnahmeprotokoll |
| [`13-crm-audit-retention.md`](13-crm-audit-retention.md) | aktueller Audit-Vertrag (Ereignisse, Actor-Modell, Retention) |
| [`16-current-state.md`](16-current-state.md) | aktuelle Live-Momentaufnahme und Navigation |
| [`17-known-issues-and-planned-waves.md`](17-known-issues-and-planned-waves.md) | **nur genuin offene** Bugs, Restrisiken, geplante Wellen |
| [`18-email-delivery-observability.md`](18-email-delivery-observability.md) | E-Mail-Zustellbeobachtung (Brevo-Vertrag, Operator-Konfiguration) |
| [`19-user-lifecycle-architecture.md`](19-user-lifecycle-architecture.md) | aktuelle User-Lifecycle-Architektur, Roadmap W1–W10 |
| [`20-product-changelog.md`](20-product-changelog.md) | benutzerseitige Nora-Produkthistorie |
| [`releases/`](releases/README.md) | **historische** Release-Evidenz (RC-SHAs, Migrationen, Ledger, Edge-Versionen, Live-Beweise, Originalwortlaut alter Einträge) |

## Architekturbereiche

| Bereich | Autoritative Dokumente |
|---|---|
| Kern-CRM / Domäne (Kunden, Kontakte, Vorgänge, Aufgaben, Notizen) | [`01`](01-domain-model.md) + [`03`](03-data-model-guardrails.md) |
| Mitarbeiter-/User-Lifecycle (Einladung, Rolle, Zugang, Anmeldeadresse, Offboarding, Session-Bindung) | [`19`](19-user-lifecycle-architecture.md) |
| Rollen / RBAC / RLS | [`11`](11-google-calendar-rbac.md) Abschnitt C, [`03`](03-data-model-guardrails.md) |
| Audit | [`13`](13-crm-audit-retention.md) |
| E-Mail-Zustellung | [`18`](18-email-delivery-observability.md) |
| Google Kalender | [`11`](11-google-calendar-rbac.md), [`14`](14-google-calendar-readonly-implementation.md) |
| Fehler-/Operations-/Feedback-Contract | [`06`](06-decision-log.md) (Error Contract, Operation Status, Notification), [`03`](03-data-model-guardrails.md) Fallen 33–38 |
| PWA / Update-Verhalten | [`02`](02-design-system.md), [`06`](06-decision-log.md) „PWA-Update-Lifecycle" |
| Routing / i18n | [`04`](04-routing-i18n.md) |
| Design / UX | [`02`](02-design-system.md), [`12`](12-role-ux-acceptance.md) |
| Nummern, Suche, Fensterauftrag, Checklisten | [`08`](08-numbering-and-global-search.md), [`09`](09-window-order-workflow.md), [`10`](10-checklists-snippets-audit.md) |

## Source-of-Truth-Prinzip

Wenn aktuelle Dokumentation und historische Release-Evidenz sich widersprechen:

1. **Tatsächlicher Zustand gewinnt:** aktueller Code, Migrationen, verifizierter Production-Zustand (vollständige Truth Hierarchy in [`16`](16-current-state.md) Abschnitt 7).
2. **Aktuelle Architektur-/Guardrail-Dokumente** (`01`, `03`, `13`, `16`, `18`, `19`, …) beschreiben den *beabsichtigten aktuellen Vertrag*.
3. **Das Decision Log** (`06`) erklärt das *Warum*.
4. **Das Release-Archiv** (`releases/`) erklärt, *was historisch passiert ist* — mit dem Wissensstand des jeweiligen Datums.

**Historische Release-Dokumente sind niemals die autoritative Quelle für den aktuellen Zustand.** Ein Archiveintrag, der „RC, nicht deployt" sagt, beschreibt seinen Tag, nicht heute.

Zwei SHAs sind zwei Fakten: der **Repository-/Dokumentationskopf** (aktueller `main`, wandert mit jedem Docs-Commit) und der **letzte Laufzeit-Release** (steht in [`16`](16-current-state.md) Abschnitt 4). Ein Docs-Commit ist kein Laufzeit-Release.

## Kontextdisziplin für Agenten

Für normale Arbeit werden **nur die zuständigen aktuellen Dokumente** geladen. Nicht automatisch einlesen:

- das vollständige Decision Log,
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
| Rolle eines Mitarbeiters | `sales.role` | [`19`](19-user-lifecycle-architecture.md) §3, [`11`](11-google-calendar-rbac.md) |
| Zugang aktiv/deaktiviert | `sales.disabled` + Auth-Bann; Status abgeleitet, nie gespeichert | [`19`](19-user-lifecycle-architecture.md) §4 |
| Wem darf Neues zugewiesen werden? | `sales_directory` (nur aktive) | [`19`](19-user-lifecycle-architecture.md) §8 |
| Wer war zuständig / hat geschrieben? | `sales_identities` (alle, inkl. deaktivierte) | [`19`](19-user-lifecycle-architecture.md) §7 |
| Kunden · Ansprechpartner · Vorgänge · Aufgaben | `companies` · `contacts` · `deals` · `tasks` | [`01`](01-domain-model.md) |
| Änderungsverlauf | `audit_events` (append-only) | [`13`](13-crm-audit-retention.md) |
| Termine | Google Kalender (Nora liest; System of Record bleibt Google) | [`11`](11-google-calendar-rbac.md) |

## Produkt-Changelog

[`20-product-changelog.md`](20-product-changelog.md) enthält die **Nora-eigenen** Produktänderungen für Büro, Leitung und IT. Eine künftige Seite `/changelog` in Nora zeigt genau dieses Produkt-Changelog — **nicht** das Atomic-CRM-Upstream-`CHANGELOG.md` im Repository-Root. Die Oberfläche dafür ist nicht Teil dieser Dokumentationswelle.
