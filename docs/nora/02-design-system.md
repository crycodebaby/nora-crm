# 02 – Designsystem und UI-Regeln

## Markenrichtung

Nora CRM soll wirken wie:

- klar
- schnell
- hochwertig
- deutsch
- touchfreundlich
- handwerksnah, aber nicht altmodisch

## Brandfarbe

Primäre Nora-Akzentfarbe:

```text
#ff3b1f
```

Verwendung:

- primäre Buttons
- Fokusrahmen
- aktive Navigation
- aktive Filter
- wichtige Orientierungselemente

Nicht verwenden für:

- normalen Fließtext
- lange Listeninhalte
- Warnungen, wenn es semantisch keine Warnung ist

## Button-Hierarchie

Primäraktion:

- „Anlegen“
- sichtbar größer
- Nora-Rot
- touchfreundlich

Sekundäraktionen:

- „Daten herunterladen“
- „Daten aus Datei importieren“
- kleiner, ruhiger, weniger dominant
- nicht mit „Anlegen“ konkurrieren lassen

## Suchfelder

Suchfelder sollen bei Fokus Nora-Akzent zeigen:

- Border
- Fokus-Ring
- optional Such-Icon

Der Eingabetext selbst bleibt bevorzugt neutral/dunkel für Lesbarkeit.

## Listen und Touch-UX

Listen müssen auf Desktop und iPad gut funktionieren:

- mehr Zeilenhöhe als Atomic-Standard
- ausreichend Padding
- gut erkennbare Klickflächen
- keine überladene Farbigkeit
- moderate Akzentuierung, keine „bunte Tabelle“

## Typografie (Welle 4)

### Schrift

- **Primär:** `Inter Variable` über `@fontsource-variable/inter` (lokal gebundelt, kein CDN)
- **Fallback:** `ui-sans-serif`, `system-ui`, `Segoe UI`, `sans-serif`
- **Grundsatz:** Business-Tool, nicht Marketing-Website — ruhige Weights, klare Hierarchie

### Zeilenhöhe

| Kontext | Token / Wert |
|---------|----------------|
| Fließtext (Body) | `--nora-line-body: 1.55` |
| Längere Texte, Notizen | `--nora-line-readable: 1.65` |
| Überschriften | `line-height: 1.3`, `tracking-tight` |

### Basis-Textgröße

- Mobile: `15px` (über `.nora-page`)
- Desktop: `16px` (`text-base`)

## Spacing und Density (Welle 4)

**Comfortable density** — mehr Luft als Atomic-Standard, aber keine „Riesen-UI“:

| Bereich | Regel |
|---------|--------|
| Listenzeilen | `.nora-list-row`: min. 52–56 px Höhe, dezente Trennlinie |
| Listentitel | `.nora-list-title`: semibold, 15–16 px |
| Sekundärinfo | `.nora-muted`: kleiner, gedämpft |
| Formularfelder | `.nora-form-section`: gap 5 (20 px) zwischen Feldern |
| Form-Labels | medium weight, leicht erhöhter Kontrast |
| Touch-Ziele | `.nora-touch-target`: min. 44 px (`--nora-touch-min: 2.75rem`) |
| Formularbreite | `max-w-xl` in `SimpleForm` |

## Zentrale Utility-Klassen

Alle in `src/index.css` unter `@layer utilities`:

| Klasse | Zweck |
|--------|--------|
| `.nora-page` | Seiten-Wrapper; steuert Basis-Typo und Form-Feld-Regeln |
| `.nora-readable` | Längere Texte/Notizen: max. 65ch, relaxed line-height |
| `.nora-list-row` | Listenzeilen mit Padding und Trennlinie |
| `.nora-list-title` | Primärer Listentitel |
| `.nora-card` | Karten (Kunden, Vorgänge) — Border, Radius, ruhiger Schatten |
| `.nora-form-section` | Formular-Gruppierung mit konsistentem Abstand |
| `.nora-muted` | Sekundärinformationen in Listen und Karten |
| `.nora-touch-target` | Mindestgröße für Touch/iPad (44 px) |
| `.nora-primary-action` | Primär-CTA (Nora-Rot) — z. B. Formular-Submit auf Login/Sign-up |
| `.nora-secondary-action` | Outline/Ghost-Navigation — z. B. Auth-Querverweise |

**Einsatz:** Klassen gezielt an Layout-Wrapper und Listen/Form-Komponenten — nicht willkürlich in jedem Element.

## Auth-Navigation (Welle 6a-Polish)

Öffentliche Anmelde- und Registrierungsseiten nutzen `AuthPageNav` für Querverweise; der Formular-Submit bleibt die einzige Nora-rote Primäraktion.

| Seite | Oben | Unter dem Formular |
|-------|------|---------------------|
| Login (`LoginPage`) | Ghost „Zur Startseite“ → `/` | „Noch kein Konto?“ + Outline „Registrieren“ → `/sign-up` |
| Sign-up (`SignupPage`) | — | „Schon ein Konto?“ + Outline „Einloggen“ → `/login`; Ghost „Zur Startseite“ → `/` |

Alle Navigations-Buttons: `size="lg"`, `.nora-touch-target`, sekundär als Outline/Ghost.

## Vorgangs-Kanban (Welle Kanban-Polish)

Die Vorgangsübersicht (`/vorgaenge`) zeigt standardmäßig nur Status-Spalten mit mindestens einem Vorgang.

| Verhalten | Regel |
|-----------|--------|
| Leere Spalten | Standard ausgeblendet |
| Alle Status | Optional über Outline-Button „Alle Status anzeigen“ (Einstellung in `localStorage`) |
| Spaltensumme | Nur wenn Summe geschätzter Auftragswerte > 0, dezent als „Auftragswert: …“ |
| `0,00 €` | Nicht auf leeren Spalten oder ohne positive Summe |
| Drag-and-drop | Nur zwischen sichtbaren Spalten; Zielstatus in ausgeblendeter Spalte → erst „Alle Status anzeigen“ |

Statuswechsel in Vorgang-Detail/Bearbeitung bleibt unverändert (Dropdown aller Phasen).

## Globale Suche (Welle 6d)

| Element | Regel |
|---------|--------|
| Desktop | Suchfeld im `Header` zwischen Navigation und Aktionen (`md+`) |
| Mobile / Tablet | Such-Icon in `MobileNavigation` → Vollbild-Overlay |
| Fokus | `.nora-search-input` — Nora-Rot bei Fokus |
| Treffer | `.nora-touch-target`, `.nora-list-title` / `.nora-muted` |
| Primär | Globale Suche ist die **einzige** allgemeine Textsuche — keine redundante Listen-Suche auf `/kontakte` oder `/kunden` |
| Technik | `type="search"`, `autoComplete="off"`, neutrale IDs `nora-global-search` (kein `card`/`wallet`) |

Listen-Seiten (`/kontakte`, `/kunden`, …) nutzen nur **spezifische Filter** (Kundentyp, Betreuer, Status, Zeitraum, Markierungen, Aufgaben) — keine zweite Volltext-Suchleiste.

## Hotboard (Welle v0.3b)

Operative Startübersicht nach Login — „Was ist heute wichtig?“

| Element | Regel |
|---------|--------|
| Position | Oben auf Desktop- und Mobile-Dashboard (nach Onboarding-Stepper) |
| Layout | Responsives Grid: 1 Spalte (Mobile), 2 (`md`), 3 (`xl`); max. 5 Einträge pro Bereich |
| Karten | `.nora-card`, `.nora-touch-target`, `.nora-list-title`, `.nora-muted` |
| Leer | Ruhige Meldung „Keine Einträge“ pro Bereich (Bereich bleibt sichtbar) |
| Hinweis | Fußzeile: echte Termine (Aufmaß/Montage) folgen mit Terminmodell — nicht über den Kontakttermin |

**Bereiche (Daten aus vorhandenen Feldern):**

| Bereich | Datenquelle |
|---------|-------------|
| Heute Kunden kontaktieren | `deals.expected_closing_date` heute/überfällig, nicht archiviert, nicht terminal |
| Neue Anfragen | `deals.stage = neue-anfrage` |
| Wartet auf Hersteller | `deals.stage = wartet-auf-hersteller` |
| Rückmeldung zu Angeboten | `deals.stage` ∈ `angebot-gesendet`, `nachfassen` (ohne Duplikat zu „Heute Kunden kontaktieren“) |
| Offene Aufgaben | `tasks` über `contact_id`, eigene Aufgaben (`sales_id`) |

**Navigation:** Klick auf Vorgang → `/vorgaenge/:id/show`; Aufgabe → `/kontakte/:id/show` (Ansprechpartner).

**Bewusst nicht:** „Heutige Termine“, „Montage heute“, „Aufmaß heute“ — kein Terminmodell, kein Google Kalender.

## Hotboard Arbeitsboard (Welle v0.3j)

Lesender Schnellzugriff auf aktuelle Vorgänge — **kein** Drag-and-drop, **keine** Statusänderung.

| Element | Regel |
|---------|--------|
| Position | Direkt unter Hotboard-Kopf, vor den bestehenden Listen-Bereichen |
| Titel | „Arbeitsboard“ + Link „Alle Vorgänge öffnen“ → `/vorgaenge` |
| Spalten | Max. **2**: `neue-anfrage`, `nachfassen` (Label: „Rückmeldung ausstehend“) |
| Karten | Max. **5** je Spalte; Gesamtzahl im Spaltenkopf; „Weitere X Vorgänge“ bei Overflow |
| Sortierung | Überfällig → heute → nächster Kontakttermin → zuletzt erstellt |
| Karteninhalt | VG-Nummer (`BusinessNumber`), Titel, Kunde, Dienstleistungsbereich, `NoraUrgencyBadge` (überfällig/heute), optional Auftragswert |
| Klick | `/vorgaenge/:id/show` — bestehende Vorgangsakte |
| Leer | „Keine neuen Anfragen“ / „Keine offenen Rückmeldungen“ (keine leere Kanban-Fläche) |
| Desktop | Zwei gleichwertige Spalten (`lg:grid-cols-2`) |
| Tablet/Mobile | Untereinander oder horizontal wischbar (`.nora-focus-board-scroll`, Mausrad via `useHorizontalWheelScroll`) |
| Berechtigung | Lesen für admin/office/viewer — RLS bleibt autoritativ |
| Logik | `hotboardUtils` — **keine** zweite Status-/Filterlogik; Drag-and-drop nur auf `/vorgaenge` |

## Vorgangs-Kanban / Fensterfilter (Welle v0.3c)

Schlanke **Ansichtsauswahl** in der Vorgangsübersicht — nicht dominant, touchfreundlich.

| Element | Regel |
|---------|--------|
| Position | `DealKanbanToolbar` oberhalb des Kanban-Boards |
| Steuerung | `ToggleGroup` (Outline): Alle Vorgänge · Fensterservice · Hausmeisterservice |
| Persistenz | `localStorage` (`nora-deals-kanban-view`) |
| Fensterservice-Spalten | 8 bevorzugte Status (Teilmenge von `defaultDealStages`); leere Spalten standardmäßig ausgeblendet |
| Sonderstatus | Vorgänge in anderen Status (z. B. `nachfassen`) erscheinen als zusätzliche Spalte, wenn sie Vorgänge enthalten |
| S4a/S4b/S4c | Keine Kanban-Spalten — Checklistenpunkte im Vorgangsdetail (v0.3d4) |
| Leer | Kategorie-spezifische Empty-State-Meldung |
| Kombination | „Alle Status anzeigen“ zeigt alle 8 Fenster-Spalten (auch leere); „Leere ausblenden“ nutzt bestehende Logik |

**Kategorien:** `deals.category` — `fensterservice`, `hausmeisterdienst` (technische IDs aus `defaultDealCategories`).

## Vorgangs-Kanban Layout (Welle v0.3h)

| Element | Regel |
|---------|--------|
| Breite | `/vorgaenge` nutzt volle Viewport-Breite (`Layout` ohne `max-w-screen-xl`) |
| Board | `.nora-kanban-board` — CSS Grid, `grid-auto-columns: minmax(280px, 320px)` |
| Scroll | `.nora-kanban-scroll` — horizontales Scrollen bleibt; gestaltete Scrollleiste (Firefox + WebKit) |
| Spalten | `.nora-kanban-column` — stabile Mindestbreite 280 px, max. 320 px; Karten volle Spaltenbreite |
| Toolbar | `.nora-kanban-toolbar-sticky` — bleibt beim Scrollen oben sichtbar |
| Spaltenkopf | `.nora-kanban-column-header` — klar abgesetzt; optional sticky unter Toolbar |
| Karten | VG-Nummer als Badge, Titel dominant, Kunde sekundär, Kategorie/Wert gedämpft |
| Terminologie | Status-ID `nachfassen` bleibt; Anzeige „Rückmeldung ausstehend“; Kontakttermin statt „Nachfassen“ |

## Barrierefreies Kanban und Vorgangsakte (Welle v0.3i)

| Element | Regel |
|---------|--------|
| Spaltenkopf | Eigene Box mit Status (17 px), Anzahl, optional Auftragswert; `nora-kanban-column-gap` (16 px) vor Karten — kein Sticky-Overlap |
| Business-ID | `BusinessNumber` — KD/VG als Badge 14–16 px (Kanban), größer im Detail; Nora-Akzent-Outline |
| Dringlichkeit | `NoraUrgencyBadge` — Icon + Text; heute/überfällig deutlich; Farbe nicht allein |
| Kanban-Scroll | `.nora-kanban-scroll` — 16 px Höhe, greifbarer Thumb; Mausrad horizontal via `useHorizontalWheelScroll` |
| Vorgangsdetail | `.nora-deal-dialog` — `min(1100px, 96vw)`, `.nora-detail-scroll` — 14 px vertikale Scrollbar |
| Abschnitte | `NoraSectionCard` — Übersicht, Ansprechpartner, Beschreibung, Aufgaben, Checkliste, Notizen |
| Typografie | Grundtext 15–16 px, Kartentitel 17 px, Detailtitel 24–28 px, Metadaten min. 13–14 px |
| Datum/Zeit | `noraDateTime.ts` — `de-DE`, z. B. `14. Juli 2026`, `Gestern um 17:13 Uhr` |
| Icons | Kein dekoratives Einzelbuchstaben-Avatar in Vorgangskarten; Firmenname statt Buchstabe in Notizen |

## Checkliste Produktionsfreigabe Fenster (Welle v0.3d4)

Im Vorgangsdetail (`DealShow`) — zwischen Aufgaben und Notizen.

| Element | Regel |
|---------|--------|
| Container | `.nora-card` mit klarer Überschrift + Subline |
| Zeilen | Touchfreundlich (`min-h` ≈ `--nora-touch-min`), Checkbox links, Label + Badge |
| Pflicht/Optional | `Badge` outline — deutlich, nicht aggressiv |
| Primäraktion Start | `nora-primary-action` nur für „Checkliste starten“ |
| Fortschritt | Ruhiger Text „X von Y erledigt“ |
| Notiz | Kompakt: Button „Notiz“ → Textarea + Speichern/Abbrechen |
| Demo | Hinweistext statt RPC — kein Absturz |

## Hotboard Produktionsfreigaben offen (Welle v0.3d5)

`HotboardOpenProductionReleases` — gleiches Kartenlayout wie andere Hotboard-Sektionen.

| Element | Regel |
|---------|--------|
| Position | Grid in `Hotboard.tsx`, nach „Angebote nachfassen“ |
| Zeilen | Wie `HotboardDealRow`: Vorgangsnummer, Titel, Kunde, Fortschritt, max. 2 fehlende Pflichtpunkte |
| Limit | 5 Einträge |
| Demo | Bereich komplett ausgeblendet (`VITE_IS_DEMO`) |
| Akzent | Kein Nora-Rot — nur ruhige `text-muted-foreground` |

## Schnellerfassung (Welle v0.3e)

Dialog-Wizard `QuickCaptureDialog` — Ziel: neue Anfrage in 60–90 Sekunden.

| Element | Regel |
|---------|--------|
| Einstieg | Header „Schnellerfassung“ (ab `md`), Hotboard „Neue Anfrage erfassen“, Mobile Plus-Menü |
| Schritte | Frei anklickbare Tabs (Kunde / Ansprechpartner / Vorgang) — siehe v0.3g |
| Hierarchie | Vorgangstitel dominant; KD-/VG-Nummern nur in Suchtreffern klein |
| Primäraktion | `nora-primary-action` nur „Speichern und Vorgang öffnen“ / Hotboard-CTA |
| Dubletten | Siehe v0.3g — ein Bereich „Mögliche Kunden“ |
| Demo | Volle FakeRest-Unterstützung über Standard-DataProvider |

## Schnellerfassung UX (Welle v0.3g)

Flexibles Arbeitsfenster für Telefon, WhatsApp, E-Mail und Notizen — nicht linear blockiert.

| Element | Regel |
|---------|--------|
| Navigation | `QuickCaptureStepTabs` — jederzeit zwischen Kunde / Ansprechpartner / Vorgang wechseln |
| Validierung | Erst beim Speichern; Fehler inline am betroffenen Tab |
| Entwurf | `localStorage` Key `nora-quick-capture-draft` — beim Schließen speichern, beim Öffnen wiederherstellen |
| Entwurf verwerfen | Ghost-Button löscht lokalen Entwurf |
| Layout Desktop | `lg:max-w-4xl`, 2 Spalten: Eingabe links, „Mögliche Kunden“ rechts |
| Layout Mobile | Einspaltig, volle Breite bei Aktionsbuttons |
| KD-Nummer | `BusinessNumber variant="badge"` — kleiner als Kundenname, mit Abstand |

## Kundenvorschläge (Welle v0.3g)

Ein Bereich `PossibleCustomersPanel` — keine doppelte Trefferliste.

| Element | Regel |
|---------|--------|
| Titel | „Mögliche Kunden“ |
| Untertitel | „Wähle einen bestehenden Kunden aus oder lege bewusst einen neuen an.“ |
| Kandidaten | Max. 5, je Kunde einmal; Merge aus Suche + Scoring (`mergeCustomerSearchResults`) |
| Karte | Badge KD-Nummer, Name dominant, Sekundärinfos, Match-Chips |
| Aktion | „Diesen Kunden verwenden“ (outline, Desktop nicht volle Breite) |
| Sekundär | „Als neuen Kunden erfassen“ unter der Liste |
| Kein Auto-Merge | Nutzer wählt bewusst |

## Öffentliche Startseite (Welle 6a)

Nicht eingeloggte Nutzer sehen unter `/` eine minimalistische Startseite (`NoraLandingPage` via `StartPage` als `loginPage`).

| Element | Darstellung |
|---------|-------------|
| Betreiber oben links | Ergart Gruppe + Markengrafik aus `public/ergart/AE_logo_transparent.png` |
| Produkt zentral | Nora-Monogramm (`nora-monogram-*.png`) + Headline „Nora CRM“ |
| Subline | „Kunden- und Vorgangsverwaltung für die Ergart Gruppe“ |
| Primäraktion | „Einloggen“ → `/login` (Nora-Rot, touchfreundlich) |
| Sekundäraktion | „Registrieren“ → `/sign-up` (ruhiger Outline-Button) |

Eingeloggte Nutzer werden wie bisher auf das Dashboard geleitet.

## URLs und Sprache

Sichtbar deutsch:

- `/kontakte`
- `/kunden`
- `/vorgaenge`

Intern bleiben Resource-Namen englisch, solange keine bewusste Datenmodellentscheidung getroffen wurde.

## Begriffliche Regeln

Nicht verwenden:

- Deal
- Pipeline
- Opportunity
- Account
- CSV Import als sichtbarer Haupttext
- Denglisch, wenn ein sauberer deutscher Begriff existiert

Bevorzugt verwenden:

- Vorgang
- Vorgangsübersicht
- Kunde
- Ansprechpartner
- Aufgabe
- Notiz
- Daten aus Datei importieren
- Daten herunterladen

## Änderungshistorie / Audit (Welle v0.3l)

Lesende Darstellung von `audit_events` — fachlich formatiert, kein technisches Log.

| Element | Regel |
|---------|--------|
| Akten-Abschnitt | `EntityAuditHistory` in `CompanyShow`, `ContactShow`, `DealShow` — `NoraSectionCard`, Titel „Änderungshistorie“ |
| Admin-Seite | `AuditPage` unter `/audit` — Filter (Entität, Ereignis, Akteur, KD/VG, Zeitraum), Speicherstatistik dezent |
| Typografie | Grundtext 15–16 px (`.nora-page`); Metadaten `text-xs` / `text-sm`; konsistent mit Vorgangsakte |
| Businessnummern | `BusinessNumber` in Filtern und Verknüpfungen — nicht rohe IDs |
| Änderungsdetails | Accordion „X Änderungen anzeigen“; Feldlabels über `crm.audit.fields.*`; Werte über `auditFormatters` (Status, Datum, Währung) |
| Notizen | Vorschau ≤80 Zeichen — **kein** Volltext-Dump, **kein** rohes JSON |
| Leer | `NoraEmptyState` — „Noch keine Änderungen protokolliert“ |
| Laden | `Spinner` zentriert; Admin-Seite zusätzlich `NoraPageLoading` |
| Fehler | `NoraQueryError` mit manuellem „Erneut versuchen“ |
| Pagination | „Weitere laden“ (Ghost-Button) in Akte und global |
| Berechtigung | `CanAccess resource="audit_events"` — Abschnitt/Route nur wenn Rolle Zugriff hat |
| Demo | synthetische Events (`source = demo`); fiktive Personen |

**Nicht:** JSON-Rohdaten, `old_data`/`new_data` unformatiert, technische `event_type`-Strings ohne Übersetzung.

## Rollenbewusste UI (v0.3k)

- UI nutzt `CanAccess` / `NoraAccessActions` — **niemals** Ersatz für RLS.
- **Lesemodus** (`NoraReadOnlyBanner`): ein Hinweis pro Seite im Layout, nicht auf jeder Karte.
- Nicht erlaubte Aktionen **ausblenden**; erklärungsbedürftige Admin-Aktionen dürfen deaktiviert + Tooltip sein.
- **Office:** Archivieren statt Löschen sichtbar; Delete-Buttons nur für Admin.
- **Ladezustände:** Skeletons (`NoraPageLoading`) statt leerer Flächen.
- **Leerzustände:** `NoraEmptyState`; Viewer ohne „Jetzt anlegen“-Aktion.
- **Fehler:** `NoraQueryError` mit „Erneut versuchen“ — kein FakeRest-Fallback, keine Retry-Schleife.
- **Ungespeicherte Änderungen:** Bestätigung beim Abbrechen (`NoraCancelButton`).
- **Dialoge/Sheets (v0.3k.1):** `NoraDialogContent` / erweiterte `DialogContent` und `SheetContent` — X und Escape mit Dirty-Bestätigung, kein Schließen per Außenklick; Quick Capture speichert Draft beim Abbrechen (nur „Entwurf verwerfen“ löscht).
- **Edit-Guards (v0.3k.1):** `NoraAccessGuard` auf Edit/Create-Routen; Viewer → Show, Sales/Import/Settings nur Admin.
- **Fehler in Detail/Listen (v0.3k.1):** `NoraShowBoundary`, `NoraListBoundary`, Checklisten-Abschnitt mit `NoraQueryError`.
- **Lesemodus-Banner:** kompakt (eine Zeile mobil, Hinweis ab `sm`).
- **Demo-Rollensimulation (v0.3k.2):** `DemoRoleSwitcher` nur bei `VITE_IS_DEMO=true`; kanonische Session in `demoSession.ts`; Hinweis „simuliert nur die Oberfläche“.

## Statusmeldungen / Notifications (Phase 7B)

Seit Phase 7B.4 real montiert — vorerst **nur** für Quick Capture. Alle anderen Flows nutzen weiterhin sonner (`admin/notification.tsx`).

- **Eine Karte pro Benutzer-Intent**, nicht pro technischer Operation. Quick Capture bündelt Core (Kunde+Kontakt+Vorgang) und optionale Aufgabe in einer Karte.
- **Tones:** `pending` (neutral), `success`, `warning` (= Presentation-`partial`, z. B. Vorgang angelegt, Aufgabe offen), `error`. Farbe ist nie alleiniger Träger — jede Karte hat Icon **und** eigene Wortwahl.
- **Position ohne offenen Dialog:** Desktop/Tablet unten rechts; Mobile volle Breite oberhalb der `MobileNavigation` inkl. Safe Area. Bei offenem Dialog gilt stattdessen die modal-aware Position weiter unten.
- **Layering (Endstand Phase 7B.4c):** Statusmeldungen berichten über die *eigene* laufende oder abgeschlossene Aktion des Benutzers. Zwei Regeln gelten gleichzeitig und beide sind verbindlich: sie müssen **lesbar** bleiben, egal welche Oberfläche offen ist, und sie dürfen **niemals die Aktion blockieren, über die sie berichten**.
  - Nora-Layer-Reihenfolge: `Basisinhalt < Navigation/Popover < Dialog-Overlay + Dialog (z-50) < Statusmeldungen (z-60)` — auf Desktop **und** Mobile.
  - `60` ist bewusst die kleinste Stufe über der Dialogschicht — kein `999999`. Ein später bewusst eingeführter Critical-/System-Layer kann darüber liegen.
- **Modal-aware Position:** Solange ein Dialog offen ist, wechselt der Stapel aus der Footer-Zone in den Kopf-/Inhaltsbereich, weil Dialoge ihre Primäraktionen unten führen. Gesteuert allein über Radix' eigenes `data-state="open"` — keine zweite Modal-State-Maschine, kein neuer globaler Zustand. Erkannt werden **Dialog und Sheet** (`body:has([data-slot="dialog-content"][data-state="open"])` sowie dieselbe Regel für `sheet-content`); beide Slots werden ausschließlich von `ui/dialog.tsx` bzw. `ui/sheet.tsx` gesetzt, ein Fremdelement kann sie nicht versehentlich tragen. Weil die Regel an `body:has(…)` hängt und nicht an einer Elternschaft, bleibt sie auch bei Radix' Portal-Rendering und bei mehreren gleichzeitig offenen Dialogen gültig.
  - Desktop: oben zentriert. Räumt den Close-Button des Dialogs und die rechts liegenden Aktionen der Vorgangsakte („Archivieren", „Bearbeiten") frei.
  - Mobile: unterhalb des Dialog-Kopfblocks (Token `--nora-notification-modal-top-mobile`), oberhalb des Dialog-Footers — Kopfzeile, Close und Footer bleiben sichtbar.
  - Desktop und Mobile dürfen also unterschiedliche Positionen verwenden; entscheidend ist nicht die Position, sondern dass keine kritische Aktion verdeckt wird.
- **Nur die neueste Karte, solange ein Dialog offen ist.** Ein wachsender Stapel reicht sonst in das Formular hinein (zwei Fehler hintereinander verdeckten Schritt-Tabs *und* das Titel-Feld). Reine Darstellungsgrenze — der Store behält alle Einträge, sie erscheinen wieder, sobald der Dialog schließt.
- **Click-through bei offenem Dialog (die harte Garantie).** Dann ist der Kartenkörper `pointer-events: none`, nur das Schließen-Ziel bleibt `auto`. Dadurch kann eine Karte unabhängig von jeder Geometrie niemals einen Klick abfangen, der dem Dialog gilt. **Bewusster Preis:** Hover-Pause der Auto-Ausblendung wirkt bei offenem Dialog nicht — dort arbeitet der Benutzer im Dialog. Außerhalb von Dialogen bleibt die Karte `pointer-events: auto`, Hover/Focus-Pause verhält sich unverändert.
- **Nicht-modal, in jedem Zustand:** Die Region ist immer `pointer-events: none`. Kein Fokusdiebstahl, kein Focus-Trap, kein Autofocus, kein globaler Escape-Handler, keine Dialogsteuerung.
- **Keine zweite Feedback-Schicht:** 1 Benutzer-Intent = 1 Karte. Kein zusätzliches Inline-Banner, kein Mobile-Sonder-Toast, keine Dublette im Dialog — nur die Position passt sich der Oberfläche an.
- **Navigation bleibt frei:** Der höhere Layer ändert nichts an der Geometrie — die Karte liegt weiterhin oberhalb der `MobileNavigation` und verdeckt sie nie.
- **Sichtbarkeit:** max. 3 Karten Desktop, 2 mobil. Fehler und bereits sichtbare `pending`-Karten werden nicht verdrängt.
- **Timing:** Pending erscheint erst nach kurzer Verzögerung (kein Blitz bei schnellen Requests) und bleibt dann kurz stehen. Success blendet sich aus, Warning später, **Fehler bleiben bis zum Schließen**.
- **Lesbarkeit vor Kompaktheit:** Die Kontextzeile (Vorgang/Kunde) darf auf zwei Zeilen geclampt werden — sie ist Orientierung. Die Detailzeile einer Warnung oder eines Fehlers wird **nie** geclampt: sie trägt den handlungsrelevanten Teil.
- **Motion:** zurückhaltend, über die Nora-Motion-Tokens (`--nora-motion-fast/base/ease`) — Einblenden und ein Pending-Spinner, kein Bounce, keine Gamification. `prefers-reduced-motion: reduce` schaltet Transition, Animation und Spinner global ab.
- **Accessibility:** der sichtbare Stapel ist **keine** Live-Region. Ansagen kommen ausschließlich vom `NoraNotificationAnnouncer` — Fehler assertiv, alles andere polite, nie beides. Karten stehlen keinen Fokus; Close-Ziel mindestens 44×44 px.
- **Aktionen:** in 7B ausschließlich „Schließen“. Schließen beendet nur die Anzeige — es bricht keine Operation ab. Kein Retry, keine IT-Eskalation (7C bzw. Phase 8).
- **Texte:** ausschließlich aus `crm.notifications.*`. Keine Literale im UI, keine sichtbaren `NORA_*`-Codes, keine IDs, keine Kontaktdaten außer einem Namen.

## Anwendungs-Systemereignisse / Update-Experience (Wellen PWA-1C, PWA-1C.1)

Neue Kategorie neben den Statusmeldungen aus Phase 7B. Ein **Systemereignis** berichtet über die Anwendung selbst (aktuell genau ein Fall: „neue Nora-Version verfügbar"), eine **Statusmeldung** über eine Aktion, die der Benutzer gerade ausgelöst hat. Beide teilen Typografie, Radius und die Motion-Tokens — sie werden aber **nie** semantisch zusammengelegt: ein Update bekommt keine `operationId`, keinen Idempotency-Key und keinen Eintrag im Notification-/Operation-Store.

**Stand PWA-1C.1:** die erste visuelle Fassung (kleine 30-rem-Zeile, Motiv links neben Text, zwei Buttons darunter) wurde vom Product Owner als generisch verworfen. Sie war technisch korrekt und von einer beliebigen Framework-Karte nicht zu unterscheiden. Ersetzt wurde nicht die Dekoration, sondern die **Komposition** — Begründung im Decision Log, „2026-08-30 – PWA-1C.1".

### Komposition

- **Eine zentrierte Spalte, Orb als Mittelpunkt:** Orb → Titel → Text → Sicherheitshinweis → Aktionen. Der Orb sitzt horizontal **exakt** in der Mitte der Fläche (nachgemessen: 0,0 px Abweichung auf allen geprüften Breiten) und ist der visuelle Mittelpunkt des Ereignisses, kein Icon neben Text.
- **Maß:** 34 rem breit (vorher 30), Padding 2,5 rem (vorher 1,25), Orb 8,5 rem (vorher 3,25). Nicht breiter als 34 rem: die Zeilenlänge des Sicherheitshinweises liegt damit bei ~65 Zeichen und damit im lesbaren Bereich; mehr Breite würde die Textzeile verschlechtern, nicht die Komposition verbessern.
- **Surface statt Card:** Radius 1,75 rem, Hairline aus `--nora-system-hairline` (nur ein Hauch Markenwärme — bei 20 % Markenanteil las sich das im Dunkelmodus als roter Rahmen und damit genau als der „bunte Gradient-Rand", den die Art Direction ausschließt), ein flacher Zwei-Stopp-Verlauf für die Aufhellung nach oben, ein `inset`-Lichtkante und **drei** Schattenstopps (Kontakt, Mitte, Ambient). Ein einzelner großer Schatten liest sich als Filter, drei lesen sich als Objekt über einer Fläche.
- **`overflow: hidden`** am Panel: die Aura wird bewusst an der Panelkante beschnitten. An diesem Radius ist der Verlauf praktisch bei null, der Schnitt also unsichtbar, und die Aura kann nie auf die Seite dahinter auslaufen. **Nicht `hidden auto`** — damit wurde die Aura zu scrollbarer Fläche, das Panel bekam dauerhaft eine Scrollleiste und verlor 17 px Inhaltsbreite (in der gestylten App gemessen und behoben).
- **Eigener Layer, unverändert:** `Basisinhalt < Navigation/Popover < Dialog (z-50) < Statusmeldungen (z-60) < Systemereignisse (z-70)`.
- **Position gegenläufig zu den Statusmeldungen:** Statusmeldungen unten rechts (Desktop) bzw. unten (Mobile), das Systemereignis oben zentriert. Dadurch können beide Schichten nie stapeln. `--event-top` ist `clamp(4.5rem, 8vh, 7rem)` — auf hohen Displays rutscht die Komposition etwas nach unten, statt an der Oberkante zu kleben.

### Kurze Viewports

Browser-Zoom verkleinert den CSS-Viewport in **beiden** Achsen, und Höhe ist die Achse, die diese Komposition verbraucht. 1440×900 bei 150 % sind 960×600 CSS-Pixel — dort lief die volle Komposition 50 px unter den Fensterrand und „Jetzt aktualisieren" war nicht mehr erreichbar. Behoben über **höhenbasierte** (nicht breitenbasierte) Regeln, die die beiden höhenbestimmenden Werte skalieren:

| Höhe | `--event-top` | Padding | Orb |
|---|---|---|---|
| Standard | `clamp(4.5rem, 8vh, 7rem)` | 2,5 rem | 8,5 rem |
| ≤ 800 px | 4 rem | 2 rem | 6,75 rem |
| ≤ 680 px | 3,5 rem | 1,5 rem | 5,25 rem |

Die 4 rem bzw. 3,5 rem sind gegen Noras echten 46-px-Header gemessen (18 px bzw. 10 px bewusster Abstand) — enger, und das Panel liest sich als Dropdown am Header statt als eigene Systemfläche. Erst unterhalb von 520 px Höhe (Telefon im Querformat) wird zusätzlich `max-height` + vertikales Scrollen aktiviert; dort ist eine Scrollleiste der richtige Preis für erreichbare Aktionen.

### Nora Update Orb

Kein Spinner: ein Spinner sagt „warte", dieses Ereignis sagt „Nora erneuert sich". Aufbau von außen nach innen:

```
Aura (11 s)  →  Halo (17 s)  →  zwei Membranen (19 s / 26 s, Rotation 64 s / 89 s)
             →  Körper (23 s)  →  Sheen (statisch)  →  Kern (Drift 15 s, Masse 9,5 s, Morph 21 s)
```

Keine dieser Perioden ist ein Vielfaches einer anderen — die Ebenen laufen deshalb nie wieder synchron zusammen. Genau das trennt „lebendig" von „animiert"; der erste Entwurf hatte zwei synchron rotierende Schichten und las sich als animiertes Icon.

Drei Punkte, die in der gestylten App gefunden und behoben wurden und die man beim Nachbauen leicht wieder einführt:

1. **Zweistopp-Verläufe erzeugen eine Zielscheibe.** Ein `radial-gradient(closest-side, C, transparent 72%)` fällt linear ab und hat dadurch eine sichtbare Kante. Aura und Halo nutzen jetzt sechs bzw. fünf Stopps als Gauß-Näherung.
2. **Ein Kern mit Kontur ist der dritte konzentrische Kreis.** Der Kern ist deshalb weich gezeichnet (`blur`) und **nie** zentriert — jeder einzelne Drift-Keyframe liegt außerhalb der Mitte. Ein Kern, der durch den Mittelpunkt läuft, stellt die Zielscheibe für einen Moment wieder her.
3. **Der Körper darf nicht konzentrisch gefüllt sein.** Sein Verlauf ist gerichtet (Licht von oben links, Vertiefung nach unten rechts zum dunkleren Markenton) — diese eine Asymmetrie gibt der Form Volumen.

Die Aura ist rund 2,5-mal so breit wie der Orb und läuft weich in die Fläche aus. Die **phasengesteuerte** Ausdehnung liegt auf einem eigenen Wrapper (`.nora-orb-field`), das Atmen auf den Verläufen darin: eine Animation schlägt eine Transition auf derselben Eigenschaft immer, die Aura wäre sonst in Phase 2 aufgesprungen statt sich auszubreiten.

Technisch: reines CSS über `transform`, `opacity` und kontrolliert `border-radius`. Keine Animationsbibliothek, kein Canvas, kein JavaScript pro Frame.

### Warnsymbol

Die Geometrie stammt **unverändert** aus dem SVG des Product Owners (Original als Design-Asset unter `docs/nora/assets/pwa-update-warning-source.svg`, wird nicht überschrieben). Entfernt wurde nur Export-Ballast: das `fill="#000000"` am Wurzelelement, Adobe-Entities/Metadata/Namespaces, die feste 800×800-Größe und die vier leeren `<g>`-Hüllen. `viewBox` und jeder `d`-String sind byteweise identisch. **Nicht** durch ein Lucide-Icon ersetzt, nicht nachgezeichnet, nicht gerastert.

Das Original zerfällt in genau die vier Teile, die die Choreografie braucht — `frame`, `bar`, `ring`, `dot` — die beim Erscheinen in dieser Reihenfolge um je 100 ms versetzt einblenden und **danach stillstehen**. Ein dauerhaft pulsierendes Warnsymbol erzeugt Nervosität statt Aufmerksamkeit.

Farbe über eigene Tokens, nicht über `--nora-warning`: der Status-Token ist für kleinen Text auf einem Badge abgestimmt und wird bei 32 px zu einem matschigen Graubraun. `--nora-system-warning` ist wärmer und chromatischer (hell `oklch(0.58 0.17 52)`, dunkel `oklch(0.82 0.14 62)`). **Nie `--destructive`**: ein verfügbares Update ist kein Fehler und darf nicht als solcher auftreten. Die Fläche ist entsprechend warm-ruhig, kein Danger-State.

Das Symbol ist `aria-hidden="true"` — der Text unmittelbar daneben sagt bereits vollständig, dass offene Eingaben gespeichert werden sollen. Eine Bezeichnung wäre eine zweite Screenreader-Ansage derselben Warnung.

### Update-Choreografie (8 Sekunden)

„Jetzt aktualisieren" lädt **nicht** sofort neu. Es startet eine rund achtsekündige Übergangsinszenierung; erst danach fällt genau ein `applyUpdate()`.

| Phase | Zeit | Was passiert |
|---|---|---|
| `settling` | 0–1,2 s | Aktionen, Zusicherung und Sicherheitshinweis falten sich weg, das Panel proportioniert sich neu, der Orb gewinnt leicht an Präsenz |
| `converging` | 1,2–2,8 s | Die Komposition zieht sich aufs Zentrum zusammen, der Orb wächst, die Aura breitet sich aus, der Titel löst sich in Unschärfe auf |
| `sustaining` | 2,8–7,5 s | Ruhige Update-Szene: Orb, „Nora wird aktualisiert", eine kurze Zeile, drei Punkte |
| `committing` | 7,5–8,0 s | Der Orb stabilisiert sich, die Aura zieht leicht nach innen; danach `applyUpdate()` |

Regeln, die dabei nicht verhandelbar sind:

- **Keine Fortschrittsbehauptung.** Der wartende Worker ist zu diesem Zeitpunkt bereits vollständig installiert — es gibt technisch nichts zu messen. Deshalb keine Prozente, keine Schritte, kein „Installation abgeschlossen". Eine Fortschrittsanzeige ohne Messgröße wäre eine Lüge über den eigenen Zustand.
- **Eine Fläche, kein Komponententausch.** Alle Zustände leben im selben DOM-Baum. Was verschwindet, faltet sich weg (`grid-template-rows: 1fr → 0fr` plus negativer Margin, der den Flex-Gap schluckt); der Orb wächst, statt ersetzt zu werden. Es wird kein zweites Fenster montiert.
- **Der Titel wechselt erst, wenn er unsichtbar ist.** Der Textwechsel hängt an der Phase, nicht am Klick: während `converging` fährt der Titel auf Deckkraft 0, erst ab `sustaining` steht dort der neue Text und löst sich aus der Unschärfe. Hinge er am Klick, spränge er bei voller Deckkraft um — genau der harte Wechsel, den die Auflösung vermeiden soll. (In der Bildfolge gefunden und behoben.)
- **Eigene Motion-Kurve.** `--nora-choreo-ease: cubic-bezier(0.33, 0.06, 0.26, 1)` und `--nora-choreo-slow: 900ms`. `--nora-motion-ease` ist bewusst front-loaded — richtig für eine 220-ms-UI-Antwort, falsch hier: gemessen legte es zwei Drittel des Faltwegs in die ersten 200 ms, die Aktionen „verschwanden sanft" also nicht, sie fielen und krochen dann.
- **Die Szene läuft weiter**, bis der Browser tatsächlich neu lädt. Nach Sekunde acht kein leeres Fenster.
- **Drei Punkte statt bewegtem Text.** Deckkraft 0,25 → 1 → 0,25 mit versetzten Phasen über 2,4 s, `ease-in-out`. Sie tragen die fortlaufende Aktivitätssemantik, damit der Text vollkommen still stehen kann — kein Typewriter, keine springenden Buchstaben. Rein dekorativ (`aria-hidden`), der Titel sagt bereits alles.

### Recovery (korrigiert nach dem Final Review, 2026-08-30)

**Anfrage ≠ Übernahme.** Nach der Achtsekundensequenz fällt genau ein `applyUpdate()`. Das bedeutet: SKIP_WAITING wurde **angefordert** — nicht, dass der neue Worker die Kontrolle bekommen hat. Die beiden Wahrheiten sind im Store getrennt:

| Signal | Bedeutung |
|---|---|
| `applying` | Die Aktivierung wurde angefordert |
| `activated` | Der Browser hat die Übernahme vollzogen (`controllerchange`) |

Die erste Fassung leitete den Fehlschlag aus dem Promise von `updateServiceWorker()` ab. Das war falsch: der ausgelieferte Client (`vite-plugin-pwa` 1.2.0) wartet nur auf die Registrierung und feuert dann ein `postMessage` ohne `await`; `messageSkipWaiting()` verwirft sein eigenes Promise und tut ohne wartenden Worker sogar gar nichts. Das Promise resolved also **immer** und trägt keine Information. Damit war der dokumentierte Ausweg unerreichbar, und der reale Fall „Anfrage raus, Übernahme kommt nie" hätte Nora dauerhaft auf „wird aktualisiert" stehen lassen.

**Der Watchdog.** Ab `applyUpdate()` — die acht Sekunden zählen ausdrücklich nicht mit — läuft eine Frist von **5 Sekunden**. Trifft `controllerchange` ein, wird sie abgeräumt (der Client lädt dann ohnehin neu). Bleibt sie aus, erscheint der Recovery-Zustand. Trifft die Übernahme *danach* doch noch ein, verschwindet er wieder — die Oberfläche behauptet nie etwas, das gerade nicht mehr stimmt.

Die 5 Sekunden sind gemessen, nicht geraten. Gegen das echte generierte `sw.js` (38 Precache-Einträge, `cleanupOutdatedCaches`) in Chromium 148, jeweils `postMessage(SKIP_WAITING)` → `controllerchange`:

| Bedingung | n | min | Median | max |
|---|---|---|---|---|
| ohne Drosselung | 6 | 2 ms | 2 ms | 3 ms |
| CPU-Drosselung 4× | 5 | 2 ms | 3 ms | 34 ms |
| CPU-Drosselung 20× | 4 | 9 ms | 11 ms | 26 ms |

Schlechtester beobachteter Wert 34 ms; 5 s sind davon rund das 150-Fache und decken zusätzlich die Zeitgeber-Drosselung eines Hintergrund-Tabs ab (Chrome rastert dort auf ca. eine Sekunde).

**Der Reload gehört Nora, nicht dem Plugin.** Beim Messen des Watchdogs fiel ein zweiter, größerer Punkt auf: der Client aus `virtual:pwa-register` lädt nur neu, wenn Workbox die gefundene Aktualisierung als *intern* führt. Bei Noras eigener Prüfung ist das nicht der Fall (sie läuft stündlich bzw. bei Tab-Rückkehr, also lange nach dem Seitenaufbau — Workbox stuft solche Funde als extern ein und lässt `isUpdate` weg). Im Zwei-Build-Harness real gemessen: nach `SKIP_WAITING` feuert `controllerchange` genau einmal, der neue Worker übernimmt, der alte Precache verschwindet — **und die Seite bleibt stehen**. Identisch am Code vor dieser Korrektur gemessen, also kein Regressionseffekt, sondern ein ungeprüfter Zustand.

„Übernommen" ist deshalb nicht „fertig": fertig ist erst das neu geladene Dokument. Trifft `controllerchange` ein und lebt die Seite 1,5 s später immer noch, lädt Nora selbst neu. Lädt der Client doch selbst (er tut das synchron im `controlling`-Handler), kommt dieser Timer nie zum Zug — ein doppelter Reload ist damit ausgeschlossen.

**Die Copy behauptet keinen Fehler.** Titel „Aktualisierung dauert länger als erwartet", darunter „Nora konnte die neue Version noch nicht vollständig übernehmen. Sie können weiterarbeiten." Belegt ist nur das Ausbleiben, nicht das endgültige Scheitern. Keine technischen Begriffe in der Oberfläche.

**Die Aktion richtet sich nach dem echten Worker-Zustand.** Wartet noch ein Worker (`registration.waiting`), kann ein zweiter Anlauf etwas bewirken → „Erneut versuchen" startet eine vollständige neue Sequenz. Ist keiner mehr da, liefe `messageSkipWaiting()` nachweislich ins Leere → „Nora neu laden" ist dann die ehrlichere Aktion.

**Bewusst kein „Später" in Recovery.** SKIP_WAITING ist zu diesem Zeitpunkt gesendet; den Worker verlässlich wieder auf WAITING zu setzen, ist keine Fähigkeit, die Nora hat. Ein Knopf, der das verspräche, wäre eine Lüge über den eigenen Zustand. Der Ausweg ist deshalb die Aktion selbst — sie bekommt beim Eintritt in den Zustand den Fokus und ist damit sofort per Tastatur bedienbar.

### Reduced Motion

Bei `prefers-reduced-motion: reduce` (in echtem Chromium mit gesetztem Flag nachgemessen): alle Orb-Animationen `none`, der Orb behält Skalierung 1 (kein Wachsen), das Warnsymbol ist sofort vollständig sichtbar statt gestaffelt, Zustandswechsel laufen über einfache Fades. **Zwei Dinge überleben bewusst:**

1. Die Achtsekundensequenz selbst — sie ist eine Produktentscheidung, keine Dekoration; sie zu kürzen gäbe Reduced-Motion-Nutzern einen anderen Update-Ablauf.
2. Die drei Punkte, auf einer reinen Deckkraft-Keyframe (`nora-system-event-dot-fade`, ohne Scale). Sie sind das einzige verbleibende Lebenszeichen; ohne sie bliebe ein eingefrorener Bildschirm.

### Accessibility

**Sichtbare Fläche und Ansage sind getrennt** (korrigiert nach dem Final Review). Das Panel trug `role="status"`; damit kam `aria-atomic="true"`, und jede Mutation im Teilbaum ließ Screenreader die komplette Fläche erneut vorlesen — während der Achtsekundensequenz mehrfach, weil Sicherheitshinweis und Aktionen verschwinden, die Punkte auftauchen und der Titel wechselt.

Jetzt: die Fläche ist `role="group"` mit `aria-labelledby` (genau **ein** `h2` im Baum — der Crossfade nutzt keinen zweiten Titel) und `aria-describedby`, **ohne** Live-Semantik. Die einzige Live-Region ist ein winziger `sr-only`-Announcer, der pro Zustandswechsel genau eine kurze Ansage trägt: „Neue Nora-Version verfügbar" → „Nora wird aktualisiert" → ggf. „Aktualisierung dauert länger als erwartet". Konzeptionell dieselbe Trennung wie in Phase 7B (`NoraNotificationAnnouncer`), aber ohne dessen Store — hier gibt es genau drei mögliche Ansagen. Die Identität der Ansage ist eine Sequenznummer als React-Key, kein Whitespace-Trick.

**Fokus.** Kein Fokusdiebstahl, kein Focus-Trap, kein Scrim: solange das Ereignis nur dasteht, fasst es den Fokus nicht an. Löst der Benutzer die Primäraktion aus, faltet sich die Aktionszeile weg — ohne Zutun fiele der Fokus auf `<body>`. Deshalb wandert er in genau diesem Fall auf die Fläche selbst (`tabindex="-1"`, schmaler `:focus-visible`-Ring) und im Recovery-Zustand auf dessen einzige Aktion. Gesteuert über eine Bedingung, die kein Fokusdiebstahl sein kann: verschoben wird nur, wenn der Fokus beim Auslösen ohnehin schon im Panel lag.

Escape wirkt nur, wenn der Fokus im Panel liegt und noch etwas zu verwerfen ist — kein globaler Handler, der Dialogen Escape wegnimmt; während der Sequenz gibt es kein Zurück.

**Bei offenem Dialog/Sheet wird gar nichts angezeigt** (`display: none` über dieselbe `body:has([data-slot="dialog-content"][data-state="open"])`-Regel wie in 7B — keine zweite Modal-Zustandsmaschine). In der echten App mit einem echten Radix-Dialog verifiziert: `display: none`, 0 fokussierbare Elemente, nach dem Schließen wieder `flex` mit 2 fokussierbaren Elementen und `body { pointer-events: auto }`.

Touch-Ziele ≥ 44 px — **mit einer Falle**, die projektweit gilt: `.nora-primary-action` nutzt `@apply`, und Tailwind v4 verschiebt jede Regel, die das tut, in die `utilities`-Layer, wo sie nach `.min-h-*` einsortiert wird und gewinnt. Ihr `min-h-10` nagelt die Primäraktion auf 40 px fest, und **weder** eine `min-h-11`-Klasse am Element **noch** eine Regel in der `components`-Layer kann das überschreiben (Layer-Reihenfolge schlägt Spezifität). Gelöst über eine bewusst **ungelayerte** Regel — die einzige in `index.css`. Gemessen: vorher 164×40, jetzt 144×44 und 164×44 (Desktop) bzw. 422×47 (Mobile).

### Kontrast (nachgemessen, gestylte App, Canvas-aufgelöste sRGB-Werte)

| Element | Hell | Dunkel |
|---|---|---|
| Titel | 19,80 | 16,50 |
| Einleitungszeile | 4,74 | 6,67 |
| Warnhinweis (Handlungsanweisung) | 17,96 | 14,87 |
| Warnhinweis (Begründung) | 6,35 | 7,48 |
| Warnsymbol Kontur | 4,22 | 6,67 |
| Warnsymbol Akzent | 4,13 | 8,47 |
| Zusicherungszeile | 4,74 | 6,67 |
| Sekundäraktion „Später" | 19,80 | 16,50 |
| **Primäraktion „Jetzt aktualisieren"** | **3,56** | **3,56** |

Alle Werte in der Panelfläche liegen ≥ 4,5 (AA), alle grafischen ≥ 3,0 (1.4.11). Die Begründungszeile im Warnhinweis nutzt **nicht** `--muted-foreground`: gegen die warme Fläche gemessen kam sie auf 4,33 und damit knapp unter AA; sie ist so weit Richtung `--foreground` gemischt, bis 4,5 erreicht ist, bleibt aber klar der Handlungsanweisung untergeordnet.

**Eine Ausnahme, und sie ist projektweit.** Die Primäraktion trägt Weiß auf `--nora-brand` (`#ff3b1f`) und kommt damit auf **3,56** — unter AA für normalen Text (14 px / 600 zählt nicht als „large text"). Das ist **nicht** die Farbe dieser Welle, sondern die etablierte `.nora-primary-action`: dieselbe 3,56 wurde am bestehenden Header-Button „Neue Anfrage erfassen" nachgemessen. Ein lokaler Fix wäre technisch möglich (rund 15 % Schwarz in den Markenton mischen ergibt 4,76), wurde aber bewusst **nicht** gemacht: er hätte diesen einen Knopf anders eingefärbt als jede andere Primäraktion in Nora, direkt neben dem markenroten Orb, und hätte an einer vom Product Owner abgenommenen Komposition gedreht, ohne das eigentliche — globale — Problem zu lösen. Als eigener Design-System-Punkt geführt: `17-known-issues-and-planned-waves.md`.

Hell und Dunkel sind **eigene Materialien**, keine Invertierung: die Panelfläche ist im Hellen reines Weiß (bei 0,995 las sie sich als leicht schmutziges Rechteck auf Noras weißem Hintergrund — Trennung kommt dort aus Schatten und Hairline), im Dunkeln liegt sie mit 0,222 leicht **über** `--popover`; die Aura trägt im Dunkeln mehr Alpha, weil derselbe Wert auf dunklem Grund verschwindet; das Warnsymbol bekommt nur im Dunkeln einen kontrollierten Ein-Stopp-Glow, der auf Weiß nur die Kontur verschmieren würde.

### Mobile

Dieselbe DNA, komprimiert: weiterhin eine zentrierte Spalte mit dem Orb als Mittelpunkt, nur kleiner und enger (Orb 5,25 rem, Padding 1,5 rem, Radius 1,375 rem). Bewusst **nicht** die Desktop-Komposition proportional verkleinert — Padding, Orb und Typografie gehen jeweils unterschiedlich weit herunter. Die Aktionen stapeln sich über die volle Breite mit der Primäraktion oben (`flex-col-reverse`); ein umbrechender Button-Zweizeiler liest sich bei dieser Breite schlechter als ein ehrlicher Stapel.

### Tokens

Alle themenabhängigen Werte liegen als `--nora-system-*` in `:root` und `.dark` (Surface, Surface-Lift, Hairline, Inner-Light, Shadow, Aura-Alpha, Halo-Alpha, Warning, Warning-Frame, Warning-Surface, Warning-Border, Warning-Glow). Keine verstreuten Hex-/OKLCH-Literale. Alle kompositionsabhängigen Werte (`--event-top`, `--event-pad`, `--event-pad-focus`, `--event-gap`, `--orb-size`, `--orb-scale`, `--orb-aura-spread`, `--orb-aura-opacity`, `--title-opacity`, `--title-blur`, `--title-shift`) liegen als lokale Variablen auf `.nora-system-event`; die Kinder lesen sie nur. Die gesamte Achtsekundenchoreografie sind dadurch vier Selektoren statt einer Zustandskaskade durch den Baum.

### Texte

Ausschließlich aus `crm.pwa.*` (de/en/fr). Keine technischen Begriffe in der Oberfläche — kein „Service Worker", „Cache", „Build", „Deployment", „Chunk", „Reload".

### Wie man das Ereignis lokal ansieht

Im echten Betrieb erscheint es frühestens nach einem Deployment. Für die Gestaltungsarbeit gibt es deshalb ein **Dev-Werkzeug**: `pwa/devUpdateTrigger.ts` blendet im Dev-Server unten links ein kleines Panel ein mit

`Update anzeigen` · `Übernahme simulieren` · `Ablehnung` · `Hell / Dunkel` · `Orb-Tempo ×1/×8` · `Reduced Motion` · `Neu laden`

- **Der Standardweg ist der reale Fehlerfall.** Ohne weiteren Klick verhält sich das Werkzeug wie Production: die Anfrage geht raus, das Promise resolved, `controllerchange` bleibt aus — nach der Watchdog-Frist muss der Recovery-Zustand erscheinen. Genau dieser Fall war im ersten RC ungetestet.
- **Übernahme simulieren** setzt ein echtes `controllerchange` auf `navigator.serviceWorker` ab — derselbe Weg, den auch der Browser nimmt, und derselbe Listener, den der Store in Production benutzt. Kein Production-Code wird dafür verändert oder aufgeweicht.
- **Ablehnung** lässt das Promise von `updateServiceWorker()` ablehnen. In Production passiert das praktisch nie; der Schalter hält nur den Absicherungszweig im Store am Leben.
- **Orb-Tempo ×8** setzt die `playbackRate` aller zehn Orb-Animationen hoch. Die Perioden reichen bis 89 s; bei ×8 sieht man den vollständigen Morph-Zyklus in Sekunden.
- **Reduced Motion** liest die **echte** `@media (prefers-reduced-motion: reduce)`-Regel aus dem geladenen Stylesheet und injiziert sie ohne die Bedingung — sie kann dadurch nie von der tatsächlichen CSS abweichen. Nachgemessen ergibt das dasselbe Bild wie die Browsereinstellung. Grenze: es simuliert die CSS-Regel, nicht die Einstellung; `matchMedia`-Abfragen im JavaScript sehen davon nichts.

Das Werkzeug fasst ausschließlich `pwaUpdateStore` an (dieselbe Schnittstelle wie die echte Oberfläche), übernimmt die Registrierung **erst beim Klick** und ist reines DOM ohne Eintrag in `index.css`.

**Production-Freiheit ist verifiziert, nicht angenommen.** Geladen wird es nur über einen dynamischen Import innerhalb von `if (import.meta.env.DEV)` — in `src/main.tsx` **und** in `demo/main.tsx` (der Demo-Modus hat einen eigenen Einstiegspunkt; ohne den zweiten Block fehlte das Panel unter `npm run dev:demo`). Nach `npm run build` enthält `dist/` null Treffer für `nora-dev-pwa-panel`, `devUpdateTrigger`, `mountUpdateDevTrigger` und die Button-Texte. Im `build:demo`-Artefakt taucht der Modulname noch in einer `.js.map` auf (dort ist `sourcemap: true`), im ausgelieferten JavaScript jedoch nicht; der echte Production-Build baut ohne Sourcemaps.
