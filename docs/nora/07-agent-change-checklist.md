# 07 – Agent Change Checklist

Vor jeder Änderung:

- [ ] `AGENTS.md` gelesen
- [ ] relevante `docs/nora/*.md` gelesen
- [ ] Ziel der Änderung verstanden
- [ ] geprüft, ob UI, Konfiguration, Demo-Daten oder Datenmodell betroffen sind
- [ ] keine unnötige DB-/Migration-Änderung geplant
- [ ] keine Resource-Namen blind umbenannt
- [ ] keine `dist/`-Dateien direkt bearbeitet

Während der Änderung:

- [ ] sichtbare Texte in Deutsch gepflegt
- [ ] keine Denglisch-Begriffe eingeführt
- [ ] Nora-Brandfarbe zentral/konsequent genutzt
- [ ] alte Atomic-Werte nicht unnötig gebrochen
- [ ] Datenmodell-Doppelungen vermieden

Nach der Änderung:

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] bei Demo-Daten: `npm run dev:demo`
- [ ] manuelle Prüfung relevanter Seiten
- [ ] bei Kanban/Detail: Zoom 125 %/150 %, Hell/Dunkel, Maus + Trackpad
- [ ] Decision Log ergänzt, falls fachliche/architektonische Entscheidung
- [ ] Commit-Nachricht klar formuliert

Bei Nummern-/DB-Änderungen zusätzlich:

- [ ] `npx supabase db reset --local` (Migration reproduzierbar?)
- [ ] NULL/Duplikat/Format-Check für `customer_number` / `case_number`
- [ ] Immutability lokal getestet (`UPDATE` muss fehlschlagen)
- [ ] INSERT mit Fake-Nummer erzeugt **keine** Client-Nummer (Hardening)
- [ ] `next_*` nicht per RPC für `anon`/`authenticated` ausführbar
- [ ] Keine zweite Nummernlogik in Demo/CSV/UI-Formularen

Bei Checklisten-/Audit-Migration (ab v0.3d2) zusätzlich:

- [ ] `docs/nora/10-checklists-snippets-audit.md` gelesen
- [ ] Kein JSONB-only als Haupt-Checklistenmodell
- [ ] `label_snapshot` an `checklist_run_items` vorhanden
- [ ] `audit_events` append-only (kein UPDATE/DELETE für App-Rollen)
- [ ] `service_area_code` nicht mit `company_id` verwechselt
- [ ] Vorlagen/Snippets: `is_active = false` statt DELETE
- [ ] Keine Audit-Daten in Notizen/Freitext
- [ ] FKs für deal, company, contact, checklist_run konsistent
- [ ] `npx supabase db reset --local` nach Migration
- [ ] `supabase/tests/checklists_audit_verification.sql` ausführen (Docker: `supabase_db_atomic-crm-demo`)
- [ ] Checklisten-Start über RPC `start_checklist_run_from_template` — keine manuellen Run-Item-Inserts vom Client
- [ ] v0.3d4: `DealProductionChecklistSection` in `DealShow` — Demo-Hinweis bei `VITE_IS_DEMO`

Bei RBAC-/Kalender-Änderungen (ab v0.4a) zusätzlich:

- [ ] `docs/nora/11-google-calendar-rbac.md` gelesen
- [ ] Keine parallele Benutzerverwaltung — Rolle an `sales`, nicht neue User-Tabelle
- [ ] Kein zweites Terminsystem (`appointments`) — nur `google_calendar_events` als Cache
- [ ] Google Kalender = System of Record für Termine; Nora nur Cache + Verknüpfung
- [ ] Keine private iCal-Adresse; keine Tokens in Frontend, Audit oder Data-API-Tabellen
- [ ] Kalender-ID nicht in UI-Komponenten hardcoden
- [ ] `origin = google` vs. `origin = nora` bei Schreiboperationen beachten
- [ ] OAuth-Scopes minimal: read-only zuerst, write als eigene Welle
- [ ] `service_role` niemals im Browser
- [ ] Bestehende Google-Labels/Farben/Freigaben nicht über Nora ändern
- [ ] Audit-Events für Kalender über bestehende `audit_events` — keine neue Audit-Tabelle

Bei RBAC-/RLS-Härtung (v0.4b / v0.4b.1 / v0.4b.2) zusätzlich:

- [ ] Migrationen `20260714120000` + `20260714140000` + `20260714150000` angewendet
- [ ] **Keine Testrolle** nach `db reset` ohne Setup (`rbac_rls_production_check.sql`)
- [ ] Lokaler Testfluss: `production_check` → `first_admin_parallel` → `setup` → `matrix` → `final_hardening` → `checklists_audit` → `crm_audit` → `google_calendar` → `teardown` → `production_check`
- [ ] Matrix als `postgres` mit `SET LOCAL ROLE nora_rls_test` — **kein** festes Testpasswort in Git
- [ ] `nora_private` nicht in `config.toml` schemas
- [ ] `nora_role_manager` NOLOGIN — kein Mitgliedschaft für `authenticated`
- [ ] Teamlisten nutzen `sales_directory`, nicht `sales` (außer Admin-Verwaltung / eigenes Profil)
- [ ] Keine GUC-Namen `nora.allow_sales_privilege_change` / `nora.privilege_rpc_token` im Code
- [ ] `supabase/tests/checklists_audit_verification.sql`
- [ ] `canAccess.ts` spiegelt Rollenmatrix; DB bleibt autoritativ

Bei Google-Kalender-Grundlage (v0.4c.1) zusätzlich:

- [ ] `docs/nora/14-google-calendar-readonly-implementation.md` gelesen
- [ ] Migration `20260716120000_google_calendar_readonly.sql` angewendet
- [ ] `supabase/tests/google_calendar_verification.sql` im Testfluss (nach `crm_audit`, vor `teardown`)
- [ ] Keine `GOOGLE_*` Secrets in `VITE_*`
- [ ] Edge Functions nur serverseitig; OAuth-Stubs geben 501/503 ohne Credentials — **kein** Fake-Erfolg
- [ ] Demo: Hinweis „Google Kalender im Demomodus nicht verbunden“ — kein Fake-OAuth
- [ ] Schema-Dateien (`01_tables` … `06_grants`) mit Migration synchron halten

Bei rollenbewusster UX (v0.3k) zusätzlich:

- [ ] Schreib-/Lösch-Buttons über `NoraAccessActions` oder `CanAccess` — nicht nur RLS-Fehler
- [ ] `NoraReadOnlyBanner` für Viewer; keine Create-Aktion in Leerzuständen
- [ ] Office: Archivieren sichtbar, Delete ausgeblendet
- [ ] `normalizeCrmError` / `withCrmErrorHandler` — keine PostgREST-Rohtexte in Notifications
- [ ] `DemoRoleSwitcher` nur bei `VITE_IS_DEMO=true`
- [ ] `noraRbacUx.test.ts` grün

Bei v0.3k.1 (Dialog-Polish) zusätzlich:

- [ ] `NoraAccessGuard` auf allen direkt erreichbaren Edit-/Create-Routen
- [ ] Dirty-Dialog: X/Escape + blockiertes Outside-Close; Quick-Capture-Draft bleibt bei Abbrechen
- [ ] `NoraShowBoundary` / `NoraListBoundary` / GlobalSearch-Fehler mit Retry
- [ ] Import nur Admin; Import-Fähigkeiten in Decision-Log dokumentiert
- [ ] `noraV03k1Ux.test.ts` grün
- [ ] Manuelle Demo-Abnahme admin / office / viewer (Hotboard, Kanban, Show, Mobile)

Bei v0.3k.2 (Demo-Rollensimulation) zusätzlich:

- [ ] `demoSession.ts` ist einzige Demo-Session-Quelle — kein `setItem(DEFAULT_USER)` beim Import
- [ ] `DemoRoleSwitcher` aktualisiert Profilmenü und Berechtigungen nach Wechsel
- [ ] `demoRoleSimulation.test.ts` grün
- [ ] `docs/nora/12-role-ux-acceptance.md` gepflegt

Bei CRM-Audit (v0.3l / v0.3l.1) zusätzlich:

- [ ] `docs/nora/13-crm-audit-retention.md` gelesen
- [ ] `npx supabase db reset --local` nach Audit-Migration
- [ ] `supabase/tests/crm_audit_verification.sql` ausführen (Docker: `supabase_db_atomic-crm-demo`)
- [ ] `supabase/tests/rbac_rls_matrix.sql` — Audit-Zeilen: Admin global ✅, Office nur RPC ✅, Viewer ❌
- [ ] `supabase/tests/checklists_audit_verification.sql` — Checklisten-Audit unverändert, keine Doppel-Events
- [ ] Kein Client-INSERT auf `audit_events`; Schreibweg nur Trigger + `nora_audit_writer`
- [ ] Office: kein direktes `SELECT` auf `audit_events`; nur `get_entity_audit_events`
- [ ] Viewer: `EntityAuditHistory` ausgeblendet (`CanAccess audit_events show`)
- [ ] UI: keine rohen JSON-Dumps; `deal.stage_changed` und `deal.status_changed` gleiches Label
- [ ] `auditUx.test.ts` grün
- [ ] `npm run typecheck` / `npm run build`
- [ ] `npm run dev:demo` — Rollenmatrix manuell: Admin `/audit` + Akte; Office nur Akte; Viewer weder noch
- [ ] Demo-Seed: synthetische Events mit `source = demo`, fiktive Personen

Wenn ein Fehler entsteht:

1. Ursache dokumentieren.
2. Keine hektische Komplettumschreibung.
3. Kleine, nachvollziehbare Korrektur.
4. Bestehende Daten nicht unnötig migrieren oder löschen.
