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
| Betreiber oben links | Ergart Gruppe in `.nora-operator-brand` (dezenter blauer Rahmen) + Markengrafik aus `public/logos/logo_atomic_crm_*.svg` |
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
