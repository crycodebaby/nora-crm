# 16 – Aktueller Zustand (Einstiegspunkt für neue Agenten)

Stand: 2026-09-11 · Load-Klasse: **ALWAYS** · Status: **CURRENT SNAPSHOT**

Dieses Dokument besitzt den **heutigen Zustand** von Nora — nicht die Contracts der Subsysteme, nicht deren Runbooks, nicht die offenen Punkte und nicht die Release-Historie. Welches Dokument wofür zuständig ist und wann es geladen wird, entscheidet ausschließlich der Router [`README.md`](README.md); dieses Dokument führt bewusst keine zweite Routingtabelle und keine Owner-Liste. Die aktuellen Release- und Laufzeitfakten stehen hier; die historische Beweisführung (RC-SHAs, Migrations-Hashes, Testzahlen, Live-Beweise, Zwischenfälle) liegt im Archiv [`releases/`](releases/README.md). **Repository-Kopf und Laufzeit-Kopf sind zwei verschiedene Fakten** — siehe Abschnitt „Vier Fakten".

## Was ist Nora?

Nora CRM ist eine angepasste Kunden- und Vorgangsverwaltung für einen deutschen Hausmeister- und Fensterservice-Betrieb (Ergart Gruppe) auf Basis von Atomic CRM. Details: [`00-project-context.md`](00-project-context.md). Nora läuft **produktiv** unter `nora.ergart.de` und arbeitet mit **echten Produktions-/Kundendaten** (seit 2026-08-25).

## Kernressourcen

Nur das Namensmapping sichtbar ↔ technisch. Fachliche Bedeutung: [`01-domain-model.md`](01-domain-model.md). Daten- und Persistenzinvarianten sowie der Fallen-Index: [`03-data-model-guardrails.md`](03-data-model-guardrails.md). Hier stehen bewusst **keine** Invarianten.

| Sichtbar | Technisch |
|---|---|
| Kunde | `companies` |
| Ansprechpartner | `contacts` |
| Vorgang | `deals` |
| Aufgabe | `tasks` |
| Notiz | `contact_notes` / `deal_notes` |
| Markierung | `tags` |
| Mitarbeiter | `sales` |

## Security

Security wird **serverseitig** durchgesetzt; die UI ist keine Security Boundary. Der vollständige aktuelle Contract für Rollen, Berechtigungen, RLS, Grants, `SECURITY DEFINER`, Trust Boundaries sowie Session- und Executor-Integrität steht in [`22-security-and-access.md`](22-security-and-access.md), die offenen Risiken in [`17`](17-known-issues-and-planned-waves.md) Abschnitt A. Hier wird davon nichts dupliziert.

## Was ist live?

| Komponente | Stand | Nachweis |
|---|---|---|
| Repository-/Dokumentationskopf | aktueller `main` — hier bewusst nicht als SHA festgeschrieben, weil reine Docs-Commits ihn verschieben, ohne die Laufzeit zu ändern | `git log` |
| Letzter Laufzeit-Release | Entry-Chunk-Budget H2, Laufzeit-RC **und** Release-Kopf `5cae655fdc4accda3c2613b316293b896b466ca4` (2026-09-10) — **frontend-only**: keine Migration, kein Edge-Deploy, keine Production-DB-Änderung, keine sichtbare Funktionsänderung | Archiv `releases/2026-09.md` |
| Letzter Release mit **sichtbarer** Funktionalität | Startseite-Zuverlässigkeit W7-R1A, Laufzeit-RC **und** Release-Kopf `8fcb603dac7db3599695c031a7fc3ef702892fa3` (2026-09-08) — **frontend-only**. Fachlich ist das der heute sichtbare Stand; die beiden Laufzeit-Releases danach ändern keine Funktion | Archiv `releases/2026-09.md` |
| Frontend / Deploy | Vercel-Projekt `nora-crm`, Domain `nora.ergart.de`; **jeder Push auf `main` löst ein automatisches Production-Deployment aus**. Prüfregel für die Build-/Release-Identität: [`21`](21-agent-runbooks.md) Sektion 14 | Archiv `releases/2026-09.md` |
| Datenbank | `nora-crm-prod` (`kixxroxtfzbcbzctohex`), Postgres 17.6; Migrations-Ledger **58 Einträge, Kopf `20260908120000_nora_atomic_contact_primary_intent`**, deckungsgleich mit `supabase/migrations/` (58 Dateien) | `list_migrations` read-only 2026-09-08 |
| Edge Function `users` | **Version 9** (`verify_jwt = false`, verifiziert JWTs selbst) | `list_edge_functions` read-only 2026-09-07 |
| Edge Function `brevo-email-events` | **Version 2** (`verify_jwt = false`, Bearer-Token) | dito |
| Alle übrigen Edge Functions im Repo (`calendar-*`, `merge_contacts`, `delete_note_attachments`, `update_password`, `postmark`, `mcp`) | **nicht in Production deployt** — live sind ausschließlich `users` und `brevo-email-events` | dito |
| Build / CI | **Build-/Bundle-Gate GREEN**. **Gesamt-CI weiterhin RED** — ausschließlich wegen der dokumentierten E2E-Bootstrap-Baseline, [`17`](17-known-issues-and-planned-waves.md) Abschnitt I | Archiv `releases/2026-09.md` |

Die Release-/Deploy-Grundreihenfolge für schemaabhängige Wellen steht in [`07-agent-change-checklist.md`](07-agent-change-checklist.md). **Nach einem Deployment holt ein Reload allein den neuen Build nicht** (PWA im Prompt-Modus) — Regel und Live-Smoke: [`21`](21-agent-runbooks.md) Sektion 14.

## Vier Fakten

**Repository-Stand, DB-Deployment, Edge-Deployment und produktive Nutzbarkeit sind vier verschiedene Fakten.** Sie fallen regelmäßig auseinander, und keiner von ihnen beweist einen der anderen:

- Code auf `main` ist **kein** Beweis für ein DB- oder Edge-Deployment.
- Eine angewendete Migration ist **kein** Beweis für eine nutzbare Funktion.
- Eine vorhandene Route ist **kein** Beweis für eine funktionierende Integration.
- Der Repository-/Dokumentationskopf wandert mit jedem Docs-Commit, ohne die Laufzeit zu verändern — er ist **nicht** der Laufzeit-Release.

Der laufende Gegenbeleg ist der **Kalender**: der Code liegt vollständig auf `main`, die Integration ist aber **derzeit nicht produktiv nutzbar**. Aktueller Owner und Details: [`11`](11-google-calendar-rbac.md) und [`14`](14-google-calendar-readonly-implementation.md).

## Aktive Programmlage

Aktiv ist **Wave 7**; offen ist **W7-R1B** (`Deal.company_id` Contract-Parity). Der vollständige offene Zustand — Bugs, Restrisiken, geplante Wellen — steht ausschließlich in [`17`](17-known-issues-and-planned-waves.md); dieses Dokument führt weder eine zweite Known-Issues-Liste noch eine Chronik abgeschlossener Wellen. Abgeschlossene Wellen und ihre Evidenz liegen im Archiv [`releases/`](releases/README.md).

Global zustandsprägende offene Punkte:

- Gesamt-CI rot wegen bekannter E2E-Bootstrap-Baseline → [`17`](17-known-issues-and-planned-waves.md) Abschnitt I
- Wave 7 / W7-R1B → [`17`](17-known-issues-and-planned-waves.md) Abschnitt G
- Kalender nicht produktiv nutzbar → [`11`](11-google-calendar-rbac.md) / [`14`](14-google-calendar-readonly-implementation.md)

## Welche Dokumente muss ich für welches Thema lesen?

Das entscheidet der Router: [`README.md`](README.md), Tabelle „Architekturbereiche". Sie nennt pro Bereich den aktuellen Contract, den benannten `06`-Eintrag für die Begründung, die `17`-Sektion für die offenen Punkte und die `21`-Runbook-Sektion für die operativen Zusatzschritte.

## Truth Hierarchy

Bei Widersprüchen zwischen Chatwissen, Dokumentation, Repository und Production gilt:

1. **verifizierter tatsächlicher Production-Zustand** — wenn er materiell vom Repository-Sollzustand abweicht
2. **aktueller Code und aktuelle Migrationen im Repository**
3. Git-Historie
4. aktuelle Architektur-/Contract-Dokumente (`16`, `01`, `03`, `13`, `18`, `19`, `22`, … — Zuordnung im Router)
5. durable Entscheidungen mit Begründung (`06`)
6. historische Release-Evidenz (`releases/`)
7. Chatwissen aus vorherigen Sitzungen

**Repository-Code ist dadurch nicht zweitrangig — er antwortet auf eine andere Frage.** Das Repository ist autoritativ dafür, was der **nächste Release** enthält; der verifizierte Production-Zustand ist autoritativ dafür, was **heute läuft**. Beide Fakten fallen regelmäßig auseinander: der Repository-/Dokumentationskopf wandert mit jedem Docs-Commit, ohne die Laufzeit zu verändern (Abschnitt „Was ist live?"). Erst wenn eine Aussage über den **heutigen Live-Zustand** getroffen wird und beide materiell widersprechen, gewinnt Production — und dann ist die Abweichung selbst ein Befund, der dokumentiert und nicht stillschweigend übernommen wird.

Dokumentation ist niemals autoritativer als Code, Migrationen oder verifizierter Production-Zustand. Innerhalb der Dokumentation gilt: **aktuelle Wahrheit** steht in `16`/`01`/`03`/`19`/`22` und den Subsystem-Contracts, **durable Entscheidungen** in `06`, **historische Fakten** im Archiv `releases/` — ein historischer Eintrag beschreibt den Wissensstand seines Datums, nicht den heutigen Zustand.
