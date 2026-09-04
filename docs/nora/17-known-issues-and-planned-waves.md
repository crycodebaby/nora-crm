# 17 – Backlog: bekannte Punkte, geplante Wellen, geparkte Themen

Status: CURRENT · Zweck: AKTIVE PLANUNG · Zuletzt geprüft: 2026-09-04

Erledigte Wellen stehen hier nicht mehr; ihre Begründung liegt in `06`, ihre Regeln in `03`/`04`/`07`. Ein Eintrag wird nur mit Code- oder Live-Nachweis in einen anderen Status verschoben.

Statuswerte: `ACTIVE` (in Arbeit) · `PLANNED` (entschieden, noch nicht begonnen) · `PARKED` (bewusst nicht in Arbeit, keine Freigabe) · `KNOWN ISSUE` (bestätigter Mangel, kein Fix eingeplant) · `PO DECISION NEEDED` (Product Owner muss entscheiden) · `UNVERIFIED` (gemeldet, nicht geprüft).

## ACTIVE

- Dokumentations-Welle „Context Spine" (AGENTS.md, 00, 15, 16, 17, 07). Danach unabhängiger PASS 2.

## PLANNED

| # | Thema | Umfang | Hinweis |
|---|---|---|---|
| P1 | Notification Phase 7C | Intents `deal.update`, `customer.createWithContact`, `contact.convertToCustomer` auf die Statusmeldungs-Karte; isolierter Task-Retry unter eigenem Idempotency-Scope; `OPERATION_CATALOG`-Literale in `DealEdit.tsx` durch i18n-Keys ersetzen | Ein Flow = eine Feedback-Schicht (`07`). Retry nie allein aus `errorCode` ableiten |
| P2 | 7C-Hardening | Registrierung einer vorgegebenen `operationId` an die tatsächlich vergebene binden (`03` Falle 38); `announced`-Set im Announcer begrenzen; langer Vorgangstitel verdrängt Kundennamen in der Kontextzeile | LOW |
| P3 | Timeout-Lifecycle für `pending`-Operationen | Eigener Mechanismus statt stiller Kapazitätslogik; kein neuer Lifecycle-Wert ohne reale Semantik | LOW; heute bleibt `pending` ewig (`operationManager.ts::enforceCapacity`) |
| P4 | Nora Loading Motion System | Ein zentrales Motion-Primitive; die zwei identischen Spinner (`ui/spinner.tsx`, `admin/spinner.tsx`) und ~13 `animate-spin`-Stellen darauf umstellen; Reduced Motion, Hell/Dunkel, 44 px | PO-Wunsch nach ruhigerem Nora-Ladekreis; PWA-Orb bleibt eigenständig |
| P5 | Mobiler Aufgaben-Bereich auf der Kundenakte | `CompanyShowContentMobile` hat keine Tab-Struktur | Desktop-Tab existiert |
| P6 | Legacy-Spalten-Cleanup | `linkedin_url`, `website`, `context_links`, `companies.phone_number` entfernen, wenn kein Import/Client mehr schreibt | kein Zeitdruck |
| P7 | Customer-Archive-/Soft-Delete-Lifecycle | `ArchiveCustomer`/`RestoreCustomer` statt physischem Löschen | nicht designt; nur Self-Contact-Delete-Invariante abgesichert |
| P8 | FakeRest-Autorisierungsparität | kleines RBAC-Modell im Demo-Provider, damit `NORA_PERMISSION_DENIED` end-to-end testbar wird | eigene Welle |
| P9 | Legacy-Regex-Pfade in `normalizeCrmError` entfernen | erst wenn alle Production-Aufrufer `DETAIL` liefern | `03` Falle 33 |
| P10 | `init_state`-Grants auf `SELECT` reduzieren | wirkungslose DML-Grants für `anon`/`authenticated` (Defense in Depth) | kleine Migration, kein Security-Fix |
| P11 | Kontakt-Unterabschnitt auf `/kunden/create` | E-Mail-Liste trägt Label „Persönliche Angaben", Telefon-/Link-Listen unbeschriftet (drei ⊕-Buttons) | MEDIUM UX; `CustomerContactCaptureInputs.tsx` |
| P12 | Demo-Seed `state_abbr` | `noraDemoSeed.ts` nutzt `NW`, Produktion und Default nutzen `NRW` | nur Demo-Daten |
| P13 | Manueller Update-Check in der PWA | Nutzer soll ein Update selbst anstoßen können | **nicht implementiert**; Code kennt nur automatische Prüfung (Tab-Rückkehr, stündlich) |
| P14 | Google Kalender | Edge Functions deployen, OAuth-E2E mit isoliertem Testkalender, dann Hotboard-Termine, Disconnect, inkrementeller Sync | Reihenfolge in `14`; Google bleibt System of Record (`11`) |
| P15 | Rollen-UX-Abnahme als lebendes Protokoll | `12-role-ux-acceptance.md` entweder archivieren oder je UI-Welle fortführen | Entscheidung in Wave 2 der Doku |

## PARKED

| Thema | Status | Regel |
|---|---|---|
| ChatGPT/Nora-Integration, MCP-Anbindung | **PARKED / MAYBE** | Keine Implementierungswelle freigegeben. Der geerbte Upstream-MCP-Server wird weder deployed noch erweitert (`15` §10). Externe Clients bekommen nie direkten SQL-Zugang |
| Premium Nora UI/Motion-Redesign | Erkundung | Nichts davon ist implementiert; keine Dokumentation darf es als live beschreiben |
| Größerer Privatkunden-Workflow | zurückgestellt | Privatperson-Modus in der Schnellerfassung und Namensfelder-Slot in `CompanyInputs` nicht in UI bauen, die das Redesign ersetzen soll |
| Kundenportal / Tracking-Link, E-Mail-Automation, Terminmodell-Schreibzugriff | nicht vor stabilem internem Prozess | `09` |

## KNOWN ISSUES

| # | Thema | Befund | Auswirkung |
|---|---|---|---|
| K1 | Edge Functions nicht deployed | In `nora-crm-prod` existiert nur `users`. `merge_contacts`, `delete_note_attachments`, `postmark`, `update_password`, `calendar-*`, `mcp` fehlen | Kontakte zusammenführen, Anhang-Löschung, Passwort-Update per Function und Kalender-Admin sind in Produktion voraussichtlich nicht funktionsfähig (nicht live provoziert). Vor jedem Deploy einer Function: Secrets und PO-Freigabe |
| K2 | „MCP Server"-Abschnitt im Profil | `ProfilePage.tsx` / `SettingsPageMobile.tsx` zeigen eine URL auf die nicht deployte Upstream-Function | Toter Link für alle Nutzer; siehe PO-Entscheidung D3 |
| K3 | `.nora-primary-action` unterschreitet 44 px | `@apply min-h-10` landet in der `utilities`-Layer und schlägt `min-h-11`/`min-h-12` am selben Element | Betrifft jede Primäraktion; im PWA-Ereignis lokal per ungelayerter Regel umgangen |
| K4 | Kontrast der Primäraktion 3,56:1 | Weiß auf `#ff3b1f` unter WCAG AA für normalen Text | projektweit; siehe D1 |
| K5 | Hartkodierte englische Pfade im Altcode | ~14 `Link`/`useMatch` auf `/contacts`, `/companies`, `/deals` (ActivityLog, CompanyShow, ContactShow, NoteShowPage u. a.) | funktionieren nur über `LegacyPathRedirect`; Redirect nicht entfernen (`04`) |
| K6 | Radix-Warnung `Missing Description or aria-describedby for DialogContent` | vorbestehend | kosmetisch |
| K7 | Demo-Redirect-Race nach Schnellerfassung | FakeRest liefert die neue Deal-ID kurz nicht lesbar → sonner „Der Eintrag existiert nicht" | nur Demo |
| K8 | Windows-Tooling-Bug in `rbac_rls_first_admin_parallel_runner.ps1` | Vorbedingungs-Regex parst `psql`-Ausgabe falsch | Workaround in `07` |

## UNVERIFIED

Gemeldet vor 2026-08-25, seither nicht geprüft; vor Bearbeitung gegen aktuellen Code/Produktion prüfen:

- Attachment-Bucket-Konfiguration in Produktion
- Rollen-Cache-Verhalten im Frontend nach Rollenwechsel (Demo-Hinweis: `canAccess`-Cache kann kurz die alte Rolle zeigen)
- Audit-Retention: keine automatische Löschung, Fristen offen (`13`)

## PO DECISION NEEDED

| # | Frage | Empfehlung |
|---|---|---|
| D1 | Markenton für Flächen mit weißem Text projektweit auf ≥ 4,5:1 absenken oder `--nora-brand-on-white` einführen? | Eigene kleine Welle zusammen mit K3 |
| D2 | Achtsekunden-Choreografie bei `prefers-reduced-motion: reduce` auf ~2,5 s kürzen? | Ja |
| D3 | „MCP Server"-Abschnitt im Profil ausblenden, solange keine Nora-Integration existiert? | Ja (Code-Änderung, eigene Mini-Welle) |
| D4 | Einmaliges Read-Then-Update der uneinheitlichen `companies.country`-Bestandswerte (`"Deutschland "`, `"DE"`, `NULL`) auf `"Deutschland"`? | Ja, als freigegebener Datenlauf; kein Constraint |
| D5 | PO-Sichtabnahme der live ausgelieferten PWA-Update-Fläche (State Contract V2 + Visual Polish 2 + Abschlussbestätigung) dokumentieren? | Kurze Abnahme, damit `16` den Status führen kann |
| D6 | Nicht deployte Edge Functions (K1): deployen oder UI-Einstiege ausblenden? | Erst Bedarf klären; Kalender braucht Secrets und Testkalender |

## Sicherheitsbewertung — assessed 2026-08-28

Diese Bewertung gilt nur für den damals geprüften Stand und ist keine Backlog-Position. Details und Begründung: `06` „2026-08-28 – Intentional privileged read views" und „Residual Security Advisor Closure".

- `public.init_state`, `public.sales_directory` (SECURITY-DEFINER-Views): `ASSESSED — LOW — KEEP`. `security_invoker = true` ist kein Fix; es würde Bootstrap bzw. Teamlisten brechen.
- `number_counters` (RLS ohne Policy), 17 Trigger-/Event-Trigger-Functions, `authenticated`-only Business-RPCs, `search_path = public`-Functions: `KEEP`, geprüft.
- `auth_leaked_password_protection`: aktiviert.

Neu bewerten, sobald sich ändert: projizierte Spalten oder Grants der beiden Views, die `sales`-RLS, `nora_private.is_active_user()`, der Sign-up-/Einladungsflow, `resolve_first_signup_role()`, Schema-Grants auf `public`, oder eine der `search_path = public`-Functions. `sales_directory` nie um `role`, `email`, `user_id`, `administrator` erweitern ohne neue Entscheidung.
