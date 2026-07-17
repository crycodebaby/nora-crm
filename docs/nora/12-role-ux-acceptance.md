# Nora CRM – Rollen-UX-Abnahmeprotokoll (v0.3k.2)

Stand: 2026-07-14  
Demo: `npm run dev:demo` (http://localhost:5180/)  
Referenz-Logins: `admin@nora.demo`, `office@nora.demo`, `viewer@nora.demo` (Passwort: `demo`)

Legende **Ergebnis**: ✅ OK · ⚠️ Teilweise · ❌ Abweichung · 🔲 Noch manuell zu prüfen

---

## A. DemoRoleSwitcher (Fix v0.3k.2)

| Bereich | Erwartung | Tatsächlich | Ergebnis | Abweichung |
|---|---|---|---|---|
| Wechsel Admin → Viewer | Identität Vera Viewer, Lesemodus, kein Quick Capture | Profil „Vera Viewer“, Banner sichtbar, Quick Capture weg | ✅ | — |
| Wechsel Office → Viewer (auf `/kunden/create`) | Redirect auf erlaubte Route, Viewer-UI | `#/` mit Lesemodus, Profil „V“ | ✅ | Create-URL wird beim Wechsel korrekt verlassen |
| Profilmenü nach Wechsel | Name = aktiver Demo-Benutzer | „Vera Viewer“ / „Otto Office“ — nicht Anna Admin | ✅ | Ursache behoben: kein `setItem(DEFAULT_USER)` beim Modul-Import |
| Viewer Menü | Kein Users/Settings/Import | Nur Profile, Changelog, Logout | ✅ | — |
| Office Menü | Kein Users/Settings/Import | Nur Profile, Changelog, Logout | ✅ | — |
| Session nach Reload | Gleiche Rolle aus `localStorage["user"]` | Viewer bleibt Viewer | ✅ | — |
| Hinweistext | Demo simuliert nur UI | „Demo role — simulates UI only…“ sichtbar | ✅ | — |
| Demo-Login ohne Logout | Identität und UI synchron | Nach Fix: `finalizeDemoSessionSwitch` nach Login | ✅ | v0.3k.2.1: kontrollierter Reload nach Demo-Login |

---

## B. Admin (`admin@nora.demo`)

| Bereich | Erwartung | Tatsächlich | Ergebnis | Abweichung |
|---|---|---|---|---|
| Hotboard / Arbeitsboard | Lesen + Schreibaktionen | Quick Capture, Capture new inquiry sichtbar | ✅ | Browser vor Wechsel / Code |
| Quick Capture | Verfügbar | Button im Header (Admin) | ✅ | — |
| Kunden/Kontakte/Vorgänge CRUD | Anlegen, bearbeiten, archivieren | `canAccess` + NoraAccessActions | 🔲 | Vollständiger Klickpfad durch Mensch |
| Benutzer/Rollen | Verwaltung sichtbar | Users-Menü via `CanAccess sales list` | 🔲 | Separater Admin-Login empfohlen |
| Einstellungen / Import | Sichtbar für Admin | Header-Menü + Route-Guard | 🔲 | — |
| Mobile Navigation | Create-Menü für Admin | `MobileNavigation` + CanAccess | 🔲 | — |

---

## C. Office (`office@nora.demo`)

| Bereich | Erwartung | Tatsächlich | Ergebnis | Abweichung |
|---|---|---|---|---|
| Direkter Login (nach Logout) | Otto Office, Quick Capture, kein Lesemodus | Profil „Otto Office“, Quick Capture sichtbar | ✅ | — |
| Fachliche Schreibaktionen | Kunden/Kontakte/Vorgänge/Aufgaben/Notizen | „New Company“ + Create-Formular unter `#/kunden/create` | ✅ | — |
| Kein Löschen | Delete ausgeblendet | NoraDeleteButton + canAccess (Unit) | 🔲 | Manuell auf Show-Seite prüfen |
| Kein Import/Settings/Users | Menü ausgeblendet | Profilmenü ohne Admin-Einträge | ✅ | — |
| Quick Capture | Verfügbar | Header-Button sichtbar | ✅ | — |
| `/settings` direkt | Kein Zugriff | `#/access-denied` | ✅ | — |
| `/import` direkt | Kein Zugriff | Redirect `#/` | ✅ | — |
| `/sales` direkt | Kein Zugriff | `#/access-denied` | ✅ | — |
| Kanban Drag | Erlaubt | Code: `DealListContent` office write | 🔲 | Manuell |

---

## D. Viewer (`viewer@nora.demo` / DemoRoleSwitcher)

| Bereich | Erwartung | Tatsächlich | Ergebnis | Abweichung |
|---|---|---|---|---|
| Lesemodus-Banner | Sichtbar, kompakt | „Read-only mode…“ | ✅ | — |
| Quick Capture | Ausgeblendet | Nicht im Header nach Viewer-Wechsel | ✅ | — |
| Capture new inquiry (Hotboard) | Ausgeblendet | Button fehlt | ✅ | — |
| Aufgaben anlegen (Hotboard) | Ausgeblendet | „No entries“, kein Add-Task | ✅ | — |
| Kanban Drag | Deaktiviert | Code: viewer → drag disabled | 🔲 | Manuell |
| Benutzer/Settings/Import | Nicht im Menü | Nicht in Dropdown | ✅ | — |

---

## E. Direkte URL-Tests

### Viewer-Session

| URL | Erwartung | Tatsächlich | Ergebnis | Abweichung |
|---|---|---|---|---|
| `/kunden/create` | Kein Formular | `#/access-denied` | ✅ | Kein leerer Screen |
| `/kunden/1` (Edit) | Redirect Show/List | Code: NoraAccessGuard → show | 🔲 | Einmalig manuell |
| `/kunden/1/show` | Lesen OK | Kundenakte lesbar | ✅ | — |
| `/settings` | Redirect / Zugriff verweigert | 🔲 | 🔲 | — |
| `/import` | Redirect / Zugriff verweigert | 🔲 | 🔲 | — |
| `/sales` | Kein Zugriff | 🔲 | 🔲 | — |
| `/kontakte/create` | Kein Formular | 🔲 | 🔲 | — |
| `/vorgaenge/:id/edit` | Kein Formular | 🔲 | 🔲 | — |
| Redirect-Schleife | Keine | Keine bei create/settings | ✅ | — |

### Office-Session

| URL | Erwartung | Tatsächlich | Ergebnis | Abweichung |
|---|---|---|---|---|
| `/kunden/create` | Formular sichtbar | Create-Formular nach Navigation über „New Company“ | ✅ | Direkte Hash-Navigation kann kurz `access-denied` zeigen wenn canAccess-Cache von vorheriger Rolle noch warm ist — nach Reload/Role-Switch OK |
| `/settings` | Kein Zugriff | `#/access-denied` | ✅ | — |
| `/import` | Kein Zugriff | Redirect `#/` | ✅ | — |
| `/sales` | Kein Zugriff | `#/access-denied` | ✅ | — |

---

## F. Dialog- / Dirty-Verhalten (v0.3k.1 Basis)

| Dialog | Erwartung | Tatsächlich | Ergebnis | Abweichung |
|---|---|---|---|---|
| Quick Capture Abbrechen | Draft bleibt | Unit-Test `persistDraft` | ✅ | — |
| Quick Capture Entwurf verwerfen | Draft weg | Bestehende Logik | 🔲 | Manuell |
| DealEdit X/Escape dirty | Bestätigung | NoraDialogContent | 🔲 | Manuell |
| Außenklick | Blockiert | `preventOutsideClose` | 🔲 | Manuell |
| Fokus-Rückkehr | Zum Auslöser | `useDialogFocusReturn` | 🔲 | Manuell |

---

## G. Responsive / Zoom

| Viewport | Bereich | Erwartung | Ergebnis | Abweichung |
|---|---|---|---|---|
| 1440 px 100 % | Header, Hotboard, Switcher | Nutzbar | ✅ (Browser) | — |
| 125 % / 150 % | Dialog-Footer sichtbar | Scrollbar, keine Abschnitte | 🔲 | Manuell |
| Tablet / Mobile | Navigation, Banner | Kompakt, erreichbar | 🔲 | Manuell |

---

## H. Automatisierte Tests (2026-07-14)

| Suite | Ergebnis |
|---|---|
| `demoRoleSimulation.test.ts` | 14/14 ✅ |
| `noraV03k1Ux.test.ts` | 10/10 ✅ |
| `noraRbacUx.test.ts` | 8/8 ✅ |
| `npm run typecheck` | ✅ |
| `npm run build` | ✅ |
| `npm run dev:demo` | ✅ (Port 5180) |

---

## Verbleibende Abweichungen / offene Punkte

1. **Vollständige manuelle Matrix für Admin** mit separatem Login — 🔲-Einträge in Abschnitt B.
2. **Office:** physisches Löschen, Kanban-Drag — noch manuell.
3. **Viewer:** verbleibende direkte URLs (`/settings`, `/import`, `/kontakte/create`, Edit-URLs).
4. **Zoom 125 %/150 %** und **Tablet/Mobile** — noch nicht vollständig dokumentiert.
5. **Dialog-/Dirty-Tests** — Quick Capture X/Escape, DealEdit, Sheets — manuell offen.
6. Kein **production-ready**-Status — drei Rollen müssen vollständig manuell abgenommen werden.

---

## Technische Referenz (kanonische Demo-Quelle)

| Frage | Antwort |
|---|---|
| Wo gespeichert? | `localStorage["user"]` (`NORA_DEMO_USER_STORAGE_KEY`) |
| Wer schreibt? | `demoSession.setActiveDemoSale`, `authProvider.login`, `useSwitchDemoRole` |
| Wer liest? | `authProvider.getIdentity`, `canAccess`, `checkAuth`, `useNoraRole` |
| Cache-Invalidierung | `REACT_QUERY_OFFLINE_CACHE` löschen + `queryClient.clear()` + kontrollierter `location.assign` via `finalizeDemoSessionSwitch` |
| Demo-Login | `LoginPage` ruft nach erfolgreichem Login `useFinalizeDemoLogin` auf (gleicher Ablauf wie Role-Switcher) |
| Statische Demo-Benutzer | `DEMO_SALES_BY_ROLE` in `demoSession.ts` |
| Post-Switch-Routing | `resolveDemoPostSwitchUrl` / `resolveDemoReloadPath` |
