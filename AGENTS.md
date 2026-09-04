# Nora CRM – Agenten-Startdatei

Status: CURRENT · Zweck: AGENT SAFETY + NAVIGATION · Verbindlich für jeden Coding-Agenten · Zuletzt geprüft: 2026-09-04

Diese Datei ersetzt die frühere Regel „alle Nora-Dokumente lesen". Pflicht für jede Aufgabe sind nur diese Datei, `docs/nora/00-project-context.md` und `docs/nora/16-current-state.md`. Alles Weitere nach Abschnitt D.

## A. Nora in 30 Sekunden

- Nora ist die interne Kunden- und Vorgangsverwaltung der Ergart Gruppe (Fenster- und Hausmeisterservice). **Produktivsystem mit echten Geschäftsdaten** unter `nora.ergart.de`, Datenbank `nora-crm-prod` (Supabase).
- Nora ist **kein generisches Sales-CRM**, kein ERP, kein Field-Service-System.
- Technische Basis: Atomic CRM (React, ra-core, shadcn, Supabase/PostgreSQL). Interne Namen bleiben englisch, alles Sichtbare ist deutsch.
- Kernobjekte: `companies` = Kunden · `contacts` = Kontakte/Ansprechpartner · `deals` = Vorgänge · `tasks` = Aufgaben · `sales` = Mitarbeiter · `tags` = Markierungen.
- Zwei Betriebsmodi: Supabase (Produktion, `npm run dev`) und FakeRest-Demo (`npm run dev:demo`). Beide müssen dieselbe Fachsemantik zeigen.

## B. Kritische Sicherheitsregeln

1. **Die Datenbank ist die Sicherheitsgrenze.** RLS und SECURITY-DEFINER-RPCs mit `nora_private.can_write()` / `is_admin()` entscheiden. `canAccess.ts` ist nur ein UI-Spiegel. Kein zweites Rechtemodell, keine parallele Benutzertabelle, kein `security_invoker`-Umbau wegen eines Advisor-Labels (`03`).
2. **Keine Migration ohne belegten fachlichen Bedarf und Decision-Log-Eintrag.** Migrationen sind additiv; bereits angewendete Migrationen werden nie editiert.
3. **Schreibzugriff auf die Produktionsdatenbank** (`nora-crm-prod`, `apply_migration`, SQL-Writes, Dashboard-Toggles) nur mit ausdrücklicher Freigabe des Product Owners in derselben Session, mit Zielprojekt-Check vor jedem Write und Bookkeeping-Check danach (`07`).
4. **Push auf `origin/main` ist ein Production-Deployment.** Vercel baut jeden Push auf `main` automatisch nach `nora.ergart.de`. Nie ohne ausdrückliche PO-Freigabe pushen, nie „nebenbei" mergen. Schema-abhängige Releases laufen DB-first (`07`).
5. **Den lokalen Arbeitsbaum `main` nie verändern, wenn er dirty ist.** Kein `reset`, kein `stash`, kein `clean`, kein `pull`. Eigene Arbeit in einem isolierten Worktree auf eigenem Branch. Bestehende Stashes nie anfassen, außer ausdrücklich verlangt.
6. **`.cursor/mcp.json` nie lesen, ändern oder committen**, außer ausdrücklich verlangt.
7. **Release-Status nur mit Nachweis.** `PRODUCTION VERIFIED` setzt den in `07` definierten Nachweis voraus; lokale Tests reichen nie. `PO UX ACCEPTED` darf ausschließlich der Product Owner erklären.
8. **Deutsche Routen sind kanonisch** (`/kunden`, `/kontakte`, `/vorgaenge`), gebaut über `noraCreatePath()`. Englische Pfade sind nur Legacy-Eingang über `LegacyPathRedirect` — der Redirect ist tragend, nicht entfernen (`04`).
9. **Resource-Namen** (`contacts`, `companies`, `deals`, `tasks`, `tags`, `sales`) nie umbenennen. DataProvider, Tabellen, Tests und gespeicherte Daten hängen daran.
10. **Eine Welle, ein Thema.** Unabhängige Änderungen nicht mischen, keine Aufräumarbeiten nebenbei, keine Dependency-Updates im Feature-Commit.
11. **Geerbter Atomic-CRM-Bestand ist nicht automatisch Nora-Verhalten.** `README.md`, `doc/`, `.github/CONTRIBUTING.md`, `CHANGELOG.md` und `.claude/skills/*` sind Upstream-Material. Nora-Dokumentation und Decision Log haben Vorrang. Konkret: Nora-Schreibpfade sind serverseitige RPCs (SECURITY DEFINER, ein Funktionskörper = eine Transaktion, `DETAIL = NORA_*`), **nicht** „Edge Function bevorzugt, RPC weniger", wie der Upstream-Skill `backend-dev` behauptet.
12. **Der geerbte MCP-Server** (`supabase/functions/mcp`, Profil-Abschnitt „MCP Server") ist kein Nora-Feature: nicht deployen, nicht erweitern, nicht als „die KI-Integration" behandeln. Status PARKED (`15`, `16`).

## C. Architektur in 60 Sekunden

```
UI (React / ra-core, src/components/atomic-crm/*)
  → Application Commands (application/commands/*, bisher zwei)
  → Domain-Regeln (domain/*, framework-frei)
  → Execution / Korrelation (operations/*, DataProvider Supabase | FakeRest)
  → Supabase / PostgreSQL (RLS, SECURITY-DEFINER-RPCs, Trigger, Audit)
```

- Der Großteil der CRUD-Flows läuft weiterhin direkt über den ra-core-DataProvider. Application Commands existieren nur für die atomaren Schreibpfade (Schnellerfassung, Kontakt → Kundenakte).
- Bewusst **nicht** vorhanden: Hexagonal-Ports, CQRS, Event Bus, Outbox, Microservices, generische KI-/MCP-Schicht. Nicht einführen ohne konkreten Bedarf.
- Details, Reifegrad und Zielrichtung: `docs/nora/15-architecture.md`.

## D. Lesen nach Aufgabe

| Aufgabe | Pflichtlektüre (zusätzlich zu AGENTS, 00, 16) |
|---|---|
| Fachlogik: Kunde, Kontakt, Vorgang, Aufgabe | `01-domain-model.md`, `03-data-model-guardrails.md` |
| UI, UX, Komponenten, Design, Notifications, PWA-Fläche | `02-design-system.md` |
| Datenbank, Migration, RLS, RPC, Security | `03-data-model-guardrails.md`, `15-architecture.md`, `07` (Migration + SECURITY DEFINER) |
| Routing, sichtbare Texte, i18n | `04-routing-i18n.md` |
| Architektur, neue Commands, externe Schnittstellen | `15-architecture.md` |
| Release, Deployment, Production-Verifikation | `07-agent-change-checklist.md`, `16-current-state.md` |
| Planung, Backlog, geparkte Themen | `17-known-issues-and-planned-waves.md` |
| Begründung einer bestehenden Entscheidung | `06-decision-log.md` — gezielt nach dem Titel suchen, nicht komplett lesen |
| Demo-Daten | `05-demo-data-guidelines.md` |
| Nummern, globale Suche | `08` · Fensterprozess `09` · Checklisten/Audit `10`, `13` · RBAC-Spezifikation, Kalender `11`, `14` · Rollen-UX-Protokoll `12` (historischer Snapshot) |

Wenn eine Änderung fachliche oder architektonische Entscheidungen berührt: Eintrag in `06` mit Kontext, Entscheidung, Begründung und verworfenen Alternativen. Kein Release-Protokoll dort.

## E. Verifikation

Vor jedem Commit dieselben Gates wie CI (`.github/workflows/check.yml`):

```bash
npm run lint
npm run prettier
npm run typecheck
npx vitest run                      # app + supabase/functions
npm run build && node ./scripts/check-bundle-budget.mjs
```

- UI oder Demo-Daten: `npm run dev:demo` und die betroffenen Seiten im Browser prüfen (Hell/Dunkel, 125 %/150 % Zoom, Mobile).
- Datenbank: `npx supabase db reset --local` plus die betroffenen `supabase/tests/*.sql` in der Reihenfolge aus `07`.
- Nach einem Deployment: Nora ist eine PWA mit wartendem Service Worker. Ein Reload zeigt den **alten** Build; Smoke nur nach „Jetzt aktualisieren" oder in frischem Profil (`07`).
- Windows: der Husky-Hook kann an `make registry-gen` scheitern. Wenn alle Gates grün sind, ist `git commit --no-verify` lokal zulässig.

## F. Niemals

- UI-Guards als Sicherheitsnachweis ausgeben oder Autorisierung nur im Frontend „testen".
- Rohes `error.message` als i18n-Key oder Business-Code verwenden (Error Contract, `03`).
- Ein zweites Terminsystem, eine zweite Benutzertabelle, eine zweite Audit-Tabelle, ein zweites Nummernsystem oder eine zweite Feedback-Schicht für denselben Flow anlegen.
- Den französischen Katalog schleichend abbauen (`04`).
- Zukünftige Ideen (ChatGPT/MCP-Anbindung, Premium-UI-Redesign, Archive-Lifecycle, größerer Privatkunden-Workflow) als vorhanden beschreiben.
- Dokumentierte Status (`DEPLOYED`, `PRODUCTION VERIFIED`, `PO UX ACCEPTED`) ohne Nachweis ändern.
- `dist/` bearbeiten.
