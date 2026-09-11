# 07 – Agent Change Protocol (universal)

Stand: 2026-09-11. Dieses Dokument enthält **nur** Regeln, die bei praktisch jeder Nora-Änderung gelten. Es gehört zur Load-Klasse ALWAYS (siehe Router [`README.md`](README.md)) und bleibt deshalb bewusst kurz.

Subsystem- und situationsabhängige Anweisungen — Datenbank/Migration, Security & Privilegien, Mitarbeiter-Lifecycle, Audit, Google Kalender, Nummern, Checklisten, Operationen/Fehler, Notifications, PWA, Rollen-UX, Demo — stehen **nicht** hier, sondern in [`21-agent-runbooks.md`](21-agent-runbooks.md). Dort werden sie **sektionsweise** geladen, nur wenn die Aufgabe sie betrifft. Welche Sektion für welche Aufgabe gilt, sagt ausschließlich der Router [`README.md`](README.md); dieses Dokument führt bewusst **keine zweite Routingtabelle**.

## Vor jeder Änderung

- [ ] `AGENTS.md` gelesen
- [ ] Router [`README.md`](README.md) gelesen und daraus die zuständigen Dokumente geladen — nicht den gesamten Dokumentationsbestand
- [ ] Ziel der Änderung verstanden
- [ ] geprüft, ob UI, Konfiguration, Demo-Daten oder Datenmodell betroffen sind
- [ ] geprüft, ob eine Runbook-Sektion in [`21`](21-agent-runbooks.md) für diese Aufgabe zuständig ist
- [ ] keine unnötige DB-/Migration-Änderung geplant
- [ ] keine Resource-Namen blind umbenannt
- [ ] keine `dist/`-Dateien direkt bearbeitet

## Während der Änderung

- [ ] sichtbare Texte in Deutsch gepflegt
- [ ] keine Denglisch-Begriffe eingeführt
- [ ] Nora-Brandfarbe zentral/konsequent genutzt
- [ ] alte Atomic-Werte nicht unnötig gebrochen
- [ ] Datenmodell-Doppelungen vermieden
- [ ] **UI ist niemals eine Security Boundary** — Zugriffsentscheidungen werden gegen Grants/RLS/Function-Body geprüft, nie gegen sichtbare UI-Zustände

## Nach jeder Änderung

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] beides läuft, nie nur eines: `npm run typecheck` ist **nicht** durch `npm run build` abgedeckt (das Root-`tsconfig` schließt Tests aus)
- [ ] bei Demo-Daten: `npm run dev:demo`
- [ ] manuelle Prüfung der relevanten Seiten
- [ ] bei Kanban/Detail: Zoom 125 %/150 %, Hell/Dunkel, Maus + Trackpad
- [ ] Zusatzschritte der betroffenen Runbook-Sektion(en) in [`21`](21-agent-runbooks.md) abgearbeitet
- [ ] Dokumentations-Abschlusscheck durchlaufen (Abschnitt unten)
- [ ] Commit-Nachricht klar formuliert

## Production-Sicherheit (gilt immer)

- [ ] Zielprojekt vor **jedem** Write gegen eine echte Production-Datenbank per `list_projects` gegen Name **und** Ref bestätigt — nicht nur einmal zu Sessionbeginn
- [ ] Kein Remote-Migration-Apply, kein Edge-Function-Deploy und kein destruktiver Live-Eingriff ohne explizite Freigabe des Product Owners
- [ ] `service_role` niemals im Browser; keine Secrets in `VITE_*`
- [ ] Bestehende Produktionsdaten werden nicht migriert oder gelöscht, um eine Änderung zu vereinfachen

## Release-/Deploy-Grundreihenfolge

Bei schemaabhängigen Wellen mit automatischem Vercel-Deploy gilt diese Reihenfolge — **nicht** Push zuerst:

1. RC einfrieren (Commit-SHA + Migration-SHA-256)
2. Production-DB-Migration
3. DB-Verifikation
4. ggf. Edge-Function-Deploy aus byteexakten RC-Blobs — **Edge Functions werden nicht von Vercel deployt**
5. Git Push
6. automatisches Vercel-Deployment
7. Live-Smoke

**Live-Smoke: ein Reload allein ist kein belastbarer PWA-Live-Smoke.** Nora ist eine PWA im Prompt-Modus; welcher Build nach einem Reload sichtbar ist, entscheidet der Browser- und Controller-Zustand. Belastbar ist nur: den Update-Hinweis auslösen **oder** ein frisches Profil/`unregister()` — und die Asset-Hashes des live ausgelieferten `index.html` gegen das DOM prüfen. Vollständige Smoke-Prozedur und Build-Identität: [`21`](21-agent-runbooks.md) Abschnitt „PWA und Update-Verhalten"; technischer PWA-/Update-Contract: [`24`](24-pwa-and-update-lifecycle.md).

## STOP-Regeln

Anhalten und den Product Owner einbeziehen, statt weiterzuarbeiten, wenn:

- der tatsächliche Production-Zustand von dem abweicht, was Repository oder Dokumentation erwarten lassen — erst read-only verifizieren, dann entscheiden, nie „nebenbei" korrigieren;
- eine Korrektur an Production-Daten, am Migrations-Ledger oder an Auth-Zuständen nötig wäre;
- eine Änderung nur durch das Aufweichen einer Guardrail aus [`03`](03-data-model-guardrails.md) machbar wäre;
- der Auftrag einen fremden, nicht angeforderten Bereich mitverändern würde.

## Dokumentations-Abschluss (nach jeder bedeutsamen Änderung)

Nicht jedes Dokument muss bei jeder Änderung angefasst werden — **nur die zuständigen**. Nach einer bedeutsamen Änderung fragen: *Hat diese Änderung Folgendes berührt?*

| Frage | Zuständiges Dokument | Was dorthin gehört |
|---|---|---|
| das Fach-/Domänenmodell (neue Entität, Begriff, Regel, Rolle)? | `01-domain-model.md` | kompakte aktuelle Beschreibung, Link auf Details |
| eine durable Daten-/Persistenzinvariante (Entitätsregel, ID/Referenzintegrität, Concurrency, Migrationsregel, Fehlervertrag)? | `03-data-model-guardrails.md` | die Regel selbst, ohne Release-Evidenz; bei einer neuen Falle auch die Zeile im Fallen-Index |
| eine Rollen-, Berechtigungs-, RLS-, Grant-, `SECURITY DEFINER`- oder Session-/Executor-Regel? | `22-security-and-access.md` | die Invariante selbst; operative Prüfschritte gehören in `21-agent-runbooks.md` Sektion 4 |
| eine durable fachliche/architektonische Entscheidung? | `06-decision-log.md` | Datum, Kontext, Entscheidung, Begründung — knapp; Eintrag in der Index-Tabelle; Link ins Archiv |
| ein dediziertes Architektur-/Spezifikationsdokument (z. B. `19-user-lifecycle-architecture.md`, `18-…`, `13-…`, `11-…`, `02-…`)? | das jeweilige Dokument | aktueller Zustand des Subsystems |
| eine wiederverwendbare operative Anweisung für ein Subsystem (Testsequenz, Verifikationsschritt, Fallstrick beim Ändern)? | `21-agent-runbooks.md` | die Anweisung in der zuständigen Sektion — nicht in dieses Dokument |
| den aktuellen Live-Zustand (Laufzeit-Release, Ledger-Kopf, Edge-Versionen, Deploy-Topologie)? | `16-current-state.md` | nur die Momentaufnahme des **heutigen** Zustands — keine Routingtabelle (die gehört in den Router) und **keine Chronik abgeschlossener Wellen**: eine abgeschlossene Welle wird in `16` nicht nachgetragen, sondern ausschließlich als Release-Evidenz in `releases/<jahr-monat>.md` archiviert. In `16` ändert sie höchstens die Zeile, die den heutigen Stand nennt |
| offene Punkte (neuer Bug, Restrisiko, geplante Welle — oder ein erledigter)? | `17-known-issues-and-planned-waves.md` | nur genuin Offenes; Erledigtes ins Archiv verschieben, nicht löschen |
| die Release-Historie (RC-SHA, Migration, Ledger, Edge-Deploy, Live-Beweis, Zwischenfall)? | `releases/<jahr-monat>.md` | Chronik-Zeile + Abschnitt mit Evidenz |
| **die Zuständigkeit selbst** (neues Dokument, verschobenes Thema, geänderter Owner, geänderte Load-Klasse)? | `docs/nora/README.md` | Zeile in `Dokument-Zuständigkeiten` **und** in `Architekturbereiche` (Contract, `06`-Eintrag, `17`-Sektion) — sonst findet die nächste Session das Thema nicht |
| etwas, das Benutzer merken? | `20-product-changelog.md` | Datum, Titel, „Was ändert sich für Sie", optional technischer Hinweis |

Zusätzlich: interne Links prüfen, wenn Überschriften verschoben oder umbenannt wurden; überholte Zwischenstände als überholt markieren statt löschen; `AGENTS.md` nur ändern, wenn sich der Always-Kontext oder eine universelle Agentenregel ändert — Dokumentzuständigkeiten und Load-Klassen gehören ausschließlich in den Router `docs/nora/README.md`, nie in eine zweite Liste.

## Wenn ein Fehler entsteht

1. Ursache dokumentieren.
2. Keine hektische Komplettumschreibung.
3. Kleine, nachvollziehbare Korrektur.
4. Bestehende Daten nicht unnötig migrieren oder löschen.
