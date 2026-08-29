# 04 – Routing, i18n und Legacy-Kompatibilität

## Deutsche URLs

Sichtbare URLs sollen deutsch sein:

| Intern | Deutsch |
|---|---|
| `contacts` | `/kontakte` |
| `companies` | `/kunden` |
| `deals` | `/vorgaenge` |

Die internen Resource-Namen bleiben wegen React Admin, DataProvider und Supabase stabil.

## Legacy-Redirects

Alte Pfade sollen nicht hart brechen:

- `/contacts` → `/kontakte`
- `/companies` → `/kunden`
- `/deals` → `/vorgaenge`

Interne alte Links dürfen über Redirects weiter funktionieren, sollten aber schrittweise auf Nora-Pfade umgestellt werden.

### ⚠️ Bekanntes Fehlermuster: interne Navigation gegen englische Ur-Code-Pfade

**Bug-Beispiel (behoben, siehe Decision Log „Live-UX-Fixes-Wave“):** `CompanyShow.tsx` (unverändert aus dem englischen Atomic-CRM-Ur-Code übernommen) navigierte beim Tab-Wechsel intern per `navigate()` auf den alten englischen Pfad `/companies/...` und erkannte den aktiven Tab per `useMatch("/companies/:id/show/:tab")`. Der `LegacyPathRedirect` (siehe oben) hat diese `/companies/...`-URL aber sofort auf `/kunden/...` zurückgeschrieben — danach passte `useMatch` nicht mehr, der Tab sprang zurück auf „Aktivität“.

**Ursache:** Ur-Code aus dem englischen Atomic CRM nutzt naturgemäß die englischen internen Pfade. Solange ein Nora-Agent so einen Code-Teil unangetastet übernimmt oder neuen Code nach diesem Vorbild schreibt, kann derselbe Fehler an anderer Stelle wieder auftreten (`ContactShow`, `DealShow`, neue Show-/List-Komponenten, o. ä. — im Rahmen dieser Wave geprüft und aktuell nicht betroffen).

**Regel für zukünftige Änderungen:**

- Interne Navigation (`navigate()`, `<Link to=...>`), Routenerkennung (`useMatch`) und Redirect-Ziele **immer** über die deutschen Nora-Pfade (`noraCreatePath()` aus `routing/noraRoutes.ts`) aufbauen — nicht über hartcodierte englische Pfade wie `/companies/...`, `/contacts/...`, `/deals/...`.
- Die englischen Pfade sind ausschließlich als **Legacy-Redirect-Eingang** gedacht (`LegacyPathRedirect`), nicht als interne Navigationsquelle.
- Bei Übernahme von Atomic-CRM-Ur-Code oder beim Schreiben neuer Show-/Tab-/Routing-Logik: explizit prüfen, ob englische Pfade hartcodiert sind, und auf `noraRoutes.ts`-Helfer umstellen.

## Öffentliche Auth-Routen (Welle 6a)

| Route | Zweck | Auth |
|---|---|---|
| `/` | Startseite für Gäste; Dashboard für eingeloggte Nutzer | Gäste: Startseite |
| `/login` | Startseite für Gäste; mit `?mode=anmelden` das Anmeldeformular | Öffentlich |
| `/login?mode=anmelden` | Anmeldung (bestehende `LoginPage` innerhalb von `StartPage`) | Öffentlich |
| `/sign-up` | Erstbenutzer-Registrierung (bestehende `SignupPage`) | Öffentlich, nur wenn noch nicht initialisiert |

Geschützte App-Routen (`/kontakte`, `/kunden`, `/vorgaenge`, …) leiten nicht eingeloggte Nutzer auf die Startseite um; von dort führt „Einloggen“ nach `/login` (optional mit `?redirect=`).

## Audit-Route (Welle v0.3l)

| Route | Zweck | Zugriff |
|---|---|---|
| `/audit` | Globaler Änderungsverlauf (`AuditPage`) | **nur Admin** (`CanAccess` + RLS) |

Navigation: Link „Änderungsverlauf“ im Header nur für Admin. Office und Viewer erreichen die Route nicht — Office sieht nur die kontextbezogene Historie in der jeweiligen Akte.

Implementierung: `AUDIT_PAGE_PATH = "/audit"` in `auditPagePath.ts`; registriert in `CRM.tsx`.

### Auth-Querverweise (Welle 6a-Polish)

Übersetzungen unter `crm.auth.nav` in allen drei Message-Katalogen:

| Schlüssel | Deutsch |
|-----------|---------|
| `sign_in` | Einloggen |
| `sign_up` | Registrieren |
| `back_to_start` | Zur Startseite |
| `no_account_yet` | Noch kein Konto? |
| `already_have_account` | Schon ein Konto? |

| Von | Aktion | Ziel |
|-----|--------|------|
| Login | Zur Startseite (oben) | `/` |
| Login | Registrieren (unter Formular) | `/sign-up` |
| Sign-up | Einloggen | `/login` |
| Sign-up | Zur Startseite | `/` |

Implementierung: gemeinsame Komponente `AuthPageNav` in `src/components/atomic-crm/login/`.

## i18n-Regeln

Deutsch ist Standard.

Englisch und Französisch dürfen technisch bestehen bleiben, aber Nora muss in Deutsch vollständig nutzbar sein.

Wenn neue sichtbare Texte eingeführt werden, müssen sie in den Message-Katalogen ergänzt werden:

- `germanCrmMessages.ts`
- `englishCrmMessages.ts`
- `frenchCrmMessages.ts`, wenn Typkompatibilität dies verlangt

## Legacy-Deal-Stages

Alte Atomic-Werte müssen sichtbar deutsch gemappt werden:

| Technischer Wert | Nora-Anzeige |
|---|---|
| `opportunity` | Neue Anfrage |
| `proposal-sent` | Angebot gesendet |
| `in-negotiation` | In Klärung |
| `in-negociation` | In Klärung |
| `won` | Angenommen |
| `lost` | Abgelehnt |
| `delayed` | Verzögert |

Nora-Werte dürfen zusätzlich existieren.

## Sichtbare Kontakt-Terminologie (Welle v0.3h)

Technische IDs und Filterlogik bleiben unverändert (`nachfassen`, `expected_closing_date`, `angebot-nachfassen`).

| Technischer Wert / Kontext | Deutsche Anzeige |
|---|---|
| `deals.stage = nachfassen` | Rückmeldung ausstehend |
| `deals.fields.expected_closing_date` | Nächster Kontakttermin |
| Hotboard „Heute …“ | Heute Kunden kontaktieren |
| Hotboard Angebotsbereich | Rückmeldung zu Angeboten |
| Badge überfällig | Kundenkontakt überfällig |
| Aufgabentyp `angebot-nachfassen` | Rückmeldung zu Angebot |

## Datums- und Zeitformat (Welle v0.3i)

Sichtbare Ausgabe über `noraDateTime.ts` / `RelativeDate` — Locale `de-DE` als Standard.

| Kontext | Beispiel |
|---|---|
| ISO-Datum | `14. Juli 2026` |
| Datum + Uhrzeit | `14. Juli 2026 um 17:13 Uhr` |
| Relativ | `Gestern um 17:13`, `In 3 Tagen` |

## Währung

Standard:

- Währung: EUR
- Locale: de-DE
- Beispiel: `0,00 €`

Keine sichtbare Dollar-Formatierung in Nora.

## RBAC- und Zustands-i18n (v0.3k)

Neue Schlüssel unter `crm.access`, `crm.errors`, `crm.unsaved_changes`, `crm.demo`:

| Schlüssel | DE (Beispiel) |
|---|---|
| `crm.access.read_only_mode` | Lesemodus |
| `crm.errors.permission_denied` | Sie haben für diese Aktion keine Berechtigung. |
| `crm.errors.delete_not_allowed` | … Archivieren Sie ihn stattdessen. |
| `crm.errors.load_failed` | Die Daten konnten gerade nicht geladen werden. |
| `crm.errors.retry` | Erneut versuchen |
| `crm.unsaved_changes.discard` | Änderungen verwerfen |
| `crm.demo.login_hint` | Demo-Konten: admin@nora.demo, … |

Demo-Benutzer (FakeRest): `admin@nora.demo`, `office@nora.demo`, `viewer@nora.demo` (Passwort: `demo`).

## Audit-i18n (Welle v0.3l)

Neue Schlüssel unter `crm.audit.*` in allen drei Message-Katalogen:

| Präfix | Beispiele (DE) |
|---|---|
| `crm.audit.page_title` | Änderungsverlauf |
| `crm.audit.history_title` | Änderungshistorie |
| `crm.audit.events.*` | `company.created`, `deal.status_changed`, `checklist.item_checked`, … |
| `crm.audit.fields.*` | `stage`, `sales_id`, `expected_closing_date`, … |
| `crm.audit.filters.*` | Entität, Ereignis, Akteur, KD/VG, Zeitraum |
| `crm.audit.empty.*` | Leerzustand in Akte |
| `crm.audit.roles.*` | admin, office, viewer |

**Legacy-Kompatibilität:** `deal.stage_changed` (Checklisten-Welle v0.3d2) wird in der UI **demselben Label** zugeordnet wie `deal.status_changed` („Vorgangsstatus geändert“). Neue Trigger schreiben kanonisch `deal.status_changed` — siehe `10-checklists-snippets-audit.md`.

Formatierung: `auditFormatters.ts` + `noraDateTime.ts` — keine hardcodierten Event-Labels in Komponenten.

## Edit-Route-Guards (v0.3k.1)

Direkt erreichbare Bearbeitungsrouten sind mit `NoraAccessGuard` geschützt:

| Route / Surface | Guard | Viewer ohne Zugriff |
|---|---|---|
| `CompanyEdit`, `ContactEdit`, `DealEdit`, `TaskEdit` | `action="edit"` | Redirect → Show |
| `CompanyCreate`, `ContactCreate` | `action="create"` | Redirect → List |
| `SalesEdit` | `sales` edit (nur Admin) | Redirect → `/sales` |
| `SettingsPage`, `ImportPage` | `configuration` edit | Redirect → `/` |

Import-Menüpunkt nur bei `CanAccess configuration edit` (Admin).

## Demo-Rollensimulation (v0.3k.2)

| Aspekt | Quelle |
|---|---|
| Aktiver Demo-Benutzer | `localStorage["user"]` via `demoSession.ts` |
| Identität | `authProvider.getIdentity()` → `saleToDemoIdentity()` |
| Berechtigungen | `authProvider.canAccess()` → `canAccess(resolveNoraRole(sale))` |
| Rollenwechsel | `useSwitchDemoRole` → `finalizeDemoSessionSwitch` (Session, Query-Cache, Reload) |
| Demo-Login | `LoginPage` → `useFinalizeDemoLogin` (gleicher Ablauf) |
| Direkte Logins | `admin@nora.demo`, `office@nora.demo`, `viewer@nora.demo` (Passwort: `demo`) |

Abnahmeprotokoll: `docs/nora/12-role-ux-acceptance.md`

## Notification-i18n (Phase 7B)

- Namespace `crm.notifications.*` in allen registrierten Katalogen: `region_label`, `errors.generic` sowie pro Intent ein Block (aktuell nur `quick_capture_case`) mit `pending|success|partial|error` × `title` / `body` / `body_no_customer`, plus `partial.detail`.
- **Keine Literal-Texte in Notification-Komponenten.** Titel, Fließtext und Detailzeile kommen immer über `translate()`; die Argumente stammen ausschließlich aus dem whitelisted Display Context (`customerName`, `contactName`, `dealTitle`, `taskTitle`).
- Fehlt ein Display-Wert, wird ein **anderer Key** gewählt (`body_no_customer`) statt ein leerer Platzhalter gerendert.
- Fehlerdetails kommen aus dem bestehenden Error Contract (`NORA_ERROR_DEFINITIONS[code].messageKey`); einziger neuer Fallback ist `crm.notifications.errors.generic`.

### Produkt-Locale-Policy

- **Deutsch ist die Primärsprache**, Englisch die unterstützte Zweitsprache. Neue Nora-Texte werden in beiden gepflegt.
- Der französische Atomic-CRM-Katalog ist **Legacy-/Kompatibilitätsbestand**. Solange er technisch registriert ist, wird seine Katalogstruktur nicht still gebrochen — neue Keys werden also mitgeführt, ohne dass daraus ein Anspruch auf redaktionelle Pflege entsteht. Ein Locale-Cleanup ist eine eigene, bewusst zu entscheidende Welle.
