# 16 – Aktueller Zustand

Status: CURRENT · Zweck: „Was ist jetzt wahr?" · Zuletzt verifiziert: **2026-09-04** (read-only gegen Git, Vercel und Supabase)

Dieses Dokument enthält nur gegenwärtige Fakten. Begründungen stehen in `06`, Regeln in `03`/`07`, Planung in `17`. Nach jedem Release wird ausschließlich Abschnitt 1 aktualisiert; Verifikationsprotokolle gehören nicht hierher.

## 1. Production Snapshot

| Ebene | Stand |
|---|---|
| `origin/main` | `d41338ed9f325e9f81c955a4d558d90647d78149` — „Customer Create Speed & Clarity" (2026-09-01) |
| Frontend Production | Vercel-Projekt `nora-crm`, Deployment `dpl_nhRvjKjE3Sphv6QdCkdZUinq7N4A`, READY, Commit exakt `d41338ed`, Domain `nora.ergart.de` |
| Deploy-Mechanik | Jeder Push auf `main` löst automatisch ein Production-Deployment aus. DB-Migrationen werden manuell und **vor** dem Push angewendet (DB-first, `07`) |
| Datenbank | Supabase-Projekt `nora-crm-prod` (`kixxroxtfzbcbzctohex`); Migrationshistorie deckungsgleich mit `supabase/migrations/` (46/46), letzte: `20260829150000_operation_status_disposition` |
| Edge Functions deployed | **nur `users`** |
| Edge Functions im Repo, aber **nicht** deployed | `calendar-connect-start`, `calendar-connect-callback`, `calendar-sync-manual`, `merge_contacts`, `delete_note_attachments`, `postmark`, `update_password`, `mcp` |
| Produktionsdaten | real (Kunden, Kontakte, Vorgänge, Aufgaben, Benutzer). Keine Testdaten anlegen, keine Schreib-Smokes ohne freigegebenen Testpfad |
| Supabase Security Advisor | Snapshot 2026-08-28 vollständig bewertet (`KEEP`/`RESOLVED`); jede neue Migration, Function oder Grant-Änderung braucht eine neue Bewertung (`03`, Falle 34) |

## 2. Produktstand (live auf `nora.ergart.de`)

| Bereich | Stand | Details |
|---|---|---|
| Kunden, Kontakte, Vorgänge, Aufgaben, Notizen, Markierungen | live | `01` |
| Kundenart Firma/Privatperson, Hauptansprechpartner, `self_contact_id`, Links/E-Mail/Telefon als JSONB | live (DB + UI) | `01`, `03` |
| Kunde anlegen (`/kunden/create`) | live: atomare RPC `create_customer_with_contact`; kein Land-Feld, `country = "Deutschland"` gesetzt, Bundesland-Default `NRW`, „Weitere Angaben" eingeklappt | `06` 2026-09-01 |
| Kontakt anlegen (`/kontakte/create`) | live: Bereiche Person / Kundenbezug / Kontaktmöglichkeiten / Weitere Angaben, mobiles Bottom Sheet für Kundenwahl | `06` 2026-08-28 |
| Schnellerfassung | live: atomare RPC `create_quick_capture_case` + separater Task-Schritt, Idempotency-Key, Operation-Status-Disposition, Notification-Karte (einziger auf die Karte migrierter Flow) | `02`, `06` |
| Aufgaben | live: `tasks.company_id` als historischer Kundenkontext, Aufgaben-Tab auf der Kundenakte (Desktop) | `01`, `03` Falle 7a |
| Kunden-/Vorgangsnummern, globale Suche | live | `08` |
| Hotboard, Arbeitsboard | live | `02` |
| Vorgangsübersicht (Kanban) | live: Ansichten Alle/Fensterservice/Hausmeister, leere Spalten ausgeblendet, Navigation Rail — **PO UX ACCEPTED** (2026-09-01) | `02` |
| Checkliste „Produktionsfreigabe Fenster" | live im Supabase-Modus; im Demo deaktiviert | `10` |
| Änderungsverlauf (Akte) und `/audit` (Admin) | live | `13` |
| Rollen `admin` / `office` / `viewer`, RLS, `nora_private`-Helper | live | `03`, `11` |
| Zugang | Einladung durch Admin; **keine öffentliche Registrierung**; `/sign-up` ist eine Hinweisseite; öffentliche Fläche „Mitarbeiterzugang der Ergart Gruppe" | `04`, `06` 2026-07-23 |
| Error Contract (`DETAIL = NORA_*`), Operation Correlation, Error Observatory, Idempotency, Operation Status Contract v1 | live (DB + Frontend) | `03`, `15` |
| PWA-Update | live seit `fe962c58` (Lifecycle `prompt`/wartender Worker) und `672ebc76` (State Contract V2, Visual Polish 2, Abschlussbestätigung). Technisch verifiziert; eine PO-Sichtabnahme der V2-/Polish-2-Fassung ist **nicht dokumentiert** | `02`, `07` |
| Google Kalender (read-only) | Schema, RPCs, Admin-Seite `/google-kalender` und Edge Functions im Repo — **Functions nicht deployed, in Produktion nicht nutzbar**. Kein OAuth-E2E durchgeführt | `14` |
| Kontakte zusammenführen | UI vorhanden; ruft Edge Function `merge_contacts`, die **nicht deployed** ist → in Produktion voraussichtlich nicht funktionsfähig (nicht live geprüft) | `17` |
| „MCP Server"-Abschnitt im Profil | sichtbar, Link zeigt auf nicht deployte Upstream-Function; kein Nora-Feature | `15` §10, `17` |

Nicht live, nicht gebaut: Termin-Kacheln im Hotboard, Google-Schreibzugriff, Kundenportal, E-Mail-Versand aus Nora, Archive-Lifecycle, mobiler Aufgaben-Tab, Privatperson-Modus in der Schnellerfassung (`17`).

## 3. Aktiv / in Arbeit

- Auf `origin/main` ist nichts Unfertiges. Lokale Arbeitsbäume und Branches des Product Owners können unmerged Arbeit enthalten; sie sind nicht Teil dieser Wahrheit.
- Dokumentations-Welle „Context Spine" (dieser Stand).

## 4. Geparkt

| Thema | Status |
|---|---|
| ChatGPT/Nora-Integration, MCP-Anbindung | **PARKED / MAYBE** — keine Welle freigegeben; geerbter MCP-Server bleibt undeployed (`15` §10) |
| Premium Nora UI/Motion-Redesign | Design-Richtung in Erkundung — nicht implementiert; nichts davon ist live |
| Größerer Privatkunden-Workflow (Namensfelder oben, Privatperson-Modus in Schnellerfassung) | zurückgestellt — nicht in UI bauen, die für das Redesign vorgesehen ist (`17`) |

## 5. Wichtige bekannte Einschränkungen

- FakeRest hat keine Datenautorisierung; `NORA_PERMISSION_DENIED` und RBAC sind nur gegen echtes Supabase testbar.
- Etwa 14 hartkodierte englische `Link`/`useMatch`-Pfade im Altcode funktionieren nur über `LegacyPathRedirect`; der Redirect ist tragend (`04`).
- Legacy-Spalten (`linkedin_url`, `website`, `context_links`, `companies.phone_number`) bleiben als Lesefallback bestehen.
- `pending`-Operationen haben keinen Timeout; eine Notification-Karte kann `pending` bleiben, wenn eine Operation nie endet (`17`).
- `.nora-primary-action` rendert 40 px hoch und mit Kontrast 3,56:1 — offene PO-Entscheidung (`17`).
- `12-role-ux-acceptance.md` ist ein Snapshot vom 2026-07-14 und keine laufende Abnahmeinstanz; UI-Wellen seit August wurden nicht über dieses Protokoll abgenommen.
- Kein `vercel.json`: `/assets/*` wird nicht `immutable` ausgeliefert; der PWA-Precache des laufenden Builds muss intakt bleiben (`07`).

## 6. Wahrheits- und Verifikationsregeln

Bei Widersprüchen gilt:

1. aktueller Code
2. aktuelle Migrationen / DB-Zustand
3. verifizierter Production-Zustand (Vercel, Supabase, Live-Aufruf)
4. Git-Historie
5. Dokumentation
6. Chatwissen aus früheren Sitzungen

Release-Vokabular (`LOCAL VERIFIED` → `RC VERIFIED` → `DEPLOYED` → `PRODUCTION VERIFIED` → `RELEASE COMPLETE`; `PO UX ACCEPTED` orthogonal): Definitionen in `07`, Abschnitt „Release-Status-Glossar". Kein Agent erklärt `PO UX ACCEPTED`.

Volatile Fakten in Abschnitt 1 vor jedem Release-Schritt read-only neu prüfen (`git rev-parse origin/main`, Vercel `latestDeployment`, Supabase `list_migrations`, `list_edge_functions`).

## 7. Wo weiterlesen

| Frage | Dokument |
|---|---|
| Was ist Nora, für wen, Begriffe | `00-project-context.md` |
| Wie ist Nora gebaut, was fehlt bewusst | `15-architecture.md` |
| Domänenmodell | `01-domain-model.md` |
| Datenmodell-/Security-Fallen | `03-data-model-guardrails.md` |
| Design, Notifications, PWA-Fläche | `02-design-system.md` |
| Routen, Texte, Sprachen | `04-routing-i18n.md` |
| Checklisten, Testreihenfolgen, Release-Glossar | `07-agent-change-checklist.md` |
| Backlog, geparkte Themen, PO-Entscheidungen | `17-known-issues-and-planned-waves.md` |
| Warum wurde etwas so entschieden | `06-decision-log.md` (per Titel suchen) |
