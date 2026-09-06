# Release-Archiv (historische Evidenz)

Dieses Verzeichnis ist das **Release-History-Archiv** von Nora CRM. Es enthält historische Implementierungs-, Verifikations- und Release-Evidenz: RC-SHAs, Migrations-Hashes, Testzahlen, Production-Preflights, Live-Beweise, Ledger-Korrekturen, Zwischenfälle und Restbefunde — jeweils mit dem Wissensstand des jeweiligen Datums.

**Es ist keine Beschreibung der aktuellen Architektur.** Ein Agent, der verstehen will, wie Nora heute funktioniert, liest `../16-current-state.md`, die Domänen-/Architektur-Dokumente (`../01-…`, `../03-…`, `../19-…`) und die durable Entscheidungen in `../06-decision-log.md` — **nicht** dieses Archiv. Ein Release-/Forensik-Reviewer, der einen früheren Release rekonstruieren will, findet hier den Originalwortlaut.

## Struktur

| Datei | Zeitraum | Inhalt |
|---|---|---|
| `2026-06.md` | Juni 2026 | Atomic-CRM-Basis, Welle 1–7b, v0.3b–v0.3f (Nummern, Suche, Hotboard, Checklisten, Schnellerfassung) |
| `2026-07.md` | Juli 2026 | v0.3f–v0.3l (Demo-Daten, UX, Rollen-UX, CRM-Audit), v0.4a–v0.4c.2c (RBAC/RLS, Google Kalender), Mitarbeiterzugang-Redesign, DB-Lint |
| `2026-08.md` | August 2026 | Foundation Waves 1–3, Stabilization Gates, Kernindizes, Customer & Contact Workflow, Unified Tasks, Self Contact, Pre-Production Hardening, Error Contract, Idempotency, Operation Status, Security-Advisor-Bewertungen, Notification 7A/7B, Kanban Navigation Rail, PWA-1B–1C.3 |
| `2026-09.md` | September 2026 | PWA Update State Contract V2 / Visual Polish 2 / Completion Acknowledgement, Customer Create Speed & Clarity, Employee Onboarding & Access V1A/V1B/V1C-A/V1C-B, Security Hardening Wave 0, User Lifecycle W1–W5 |

Jede Monatsdatei beginnt mit einer **Release-Chronik** (Tabelle: Welle, Status, Release-SHA, Migration, Edge, Evidenz) und enthält danach die **unverändert** aus `06-decision-log.md` (Stand `96fb1082`) verschobenen Originaleinträge.

## Regeln

- Einträge hier werden nicht umgeschrieben. Spätere Erkenntnisse kommen als datierter Nachtrag, nie als stille Korrektur.
- Neue Release-Evidenz (RC-SHA, Migration, Ledger, Edge-Version, Live-Beweis, Zwischenfall) gehört in die Chronik-Tabelle des jeweiligen Monats und — bei Bedarf — als eigener Abschnitt darunter.
- Durable Entscheidungen (Regeln, die künftige Architektur- oder Produktentscheidungen leiten) gehören zusätzlich knapp in `../06-decision-log.md` mit Link hierher.
- Aktuelle Zustände (was ist live, welche Edge-Version, welcher Ledger-Kopf) gehören nach `../16-current-state.md`, nicht hierher.
