# 09 – Fensterauftrag-Prozess (Chef-Rohkonzept → Nora-Spezifikation)

**Welle 7a** — Analyse und Spezifikation  
**Status:** Nur Dokumentation — **keine** Migration, **keine** UI, **keine** Integrationen in dieser Welle.

Dieses Dokument bewertet das Chef-Rohkonzept für Fenstertausch/Fensterauftrag und übersetzt es in ein Nora-konformes fachliches und technisches Modell. Es ergänzt `01-domain-model.md`, `03-data-model-guardrails.md` und den Decision Log.

---

## 1. Fachliche Einordnung

### 1.1 Wofür der Chef-Prozess gedacht ist

Das Rohkonzept beschreibt einen **operativen End-to-End-Ablauf für Fenstertausch / Fensterauftrag** bei der Ergart Gruppe:

- Aufmaß → Angebot → Kundenfreigabe → Herstellerbestellung → Produktion → Montage → Abschluss
- mit internen Qualitätskontrollen vor Produktionsfreigabe
- mit Wunsch nach Kundenkommunikation und Transparenz („wie Paketverfolgung“)

Das ist **fachlich wertvoll** als Referenzprozess für einen Kerngeschäftszweig (`fensterservice` in `dealCategories`), aber **nicht** als universelles Schema für alle Vorgänge.

### 1.2 Allgemeine Vorgänge vs. Fensterauftrag

| Aspekt | Allgemeiner Vorgang | Fensterauftrag |
|--------|---------------------|----------------|
| Beispiele | Hausmeisterdienst, Reparatur, Wartung, Sonstiges | Fenstertausch, Fenstererneuerung, Verglasung |
| Prozesslänge | oft kürzer, weniger Hersteller/Montage | länger, mehr Zwischenschritte |
| Herstellerbezug | selten | regelmäßig |
| Aufmaß | optional | fast immer |
| Montage | optional | fast immer |
| Kanban-Dichte | schlanke allgemeine Pipeline | eigene **schlanke** Fenster-Pipeline + Checkliste |
| Technische Zuordnung (v0.3) | `deals.category` ≠ `fensterservice` | `deals.category = fensterservice` |
| Technische Zuordnung (später) | `workflow_type = general` | `workflow_type = window_order` |

**Regel:** Ein Fensterauftrag ist ein **Vorgang** (`deals`) mit fachlicher Spezialisierung — kein eigener Resource-Typ, solange keine bewiesene Modellgrenze erreicht ist.

### 1.3 Was Nora digital organisieren soll (Kontext)

Aus Projektziel und Chef-Ideen — **priorisiert für Nora**:

| Ziel | Nora-Relevanz |
|------|----------------|
| Kunden, Ansprechpartner, Vorgänge führen | ✅ Kern (bereits vorhanden) |
| Feste Prozesse und Datenhoheit | ✅ über Status, Checklisten, eigenen Speicher |
| Hotboard / operative Übersicht | ✅ Dashboard erweitern |
| Baustellen / Objekte | ⏳ spätere Domänenebene |
| Eigener Speicher statt Google Drive | ✅ Nora Storage / Attachments — kein Drive als Kern |
| Google Maps / Kalender | ⏳ sinnvolle Ergänzungen, nicht Kern |
| Zapier/Make als Prozesskern | ❌ nicht Nora-Architektur |

### 1.4 Abgrenzung: Was nicht eins zu eins übernommen wird

- **Höning** als fester Systemname → generisch **Hersteller / Lieferant**
- **S4a / S4b / S4c** als eigene Kanban-Spalten → **Checklisten- und Zahlungsunterpunkte**
- **Automatische Kunden-E-Mails** sofort → **gestuft** (Vorlagen → manuell → Automation)
- **Kundenportal / Tracking-Link** sofort → **eigenes späteres Modul** mit Sicherheitsanforderungen
- **Google Keep / Tasks / Contacts** → **nicht** Nora-Kern

---

## 2. Mapping Chef-Status → Nora

Legende **Umsetzung:**

| Stufe | Bedeutung |
|-------|-----------|
| **Sofort** | Mit vorhandenen Feldern (`stage`, `category`, Aufgaben, Notizen) sinnvoll nutzbar |
| **Später** | Braucht neue Felder, Checklisten, Termine oder Integration |
| **Nicht sinnvoll** | Passt nicht in Nora oder erzeugt Overengineering |

| Chef-Status | Empfohlener Nora-Status / Mechanismus | Status oder Checklistenpunkt? | Umsetzung | Begründung |
|-------------|----------------------------------------|-------------------------------|-----------|------------|
| **S1** Aufmaß erfolgt | `aufmass-erledigt` | **Status** | Sofort | Entspricht vorhandenem Nora-Status; Vorgang ist gemessen |
| *(vor S1)* Aufmaß geplant | `aufmass-geplant` | **Status** | Sofort | Termin vor Ort noch nicht durchgeführt |
| *(vor S1)* Erstkontakt / Termin | `kontaktiert`, `termin-vereinbart` | **Status** | Sofort | Allgemeine Vorstufen, auch außerhalb Fensterauftrag |
| **S2** Angebot versendet | `angebot-gesendet` | **Status** | Sofort | Klarer operativer Meilenstein |
| *(zwischen S2–S3)* Nachfassen | `nachfassen` + `expected_closing_date` | **Status** + Datum | Sofort | Bereits Nora-Welle 5 |
| **S3** Kundenfreigabe erhalten | `angenommen` | **Status** | Sofort | Fachlich „Auftrag erteilt“; nicht mit „Abgeschlossen“ verwechseln |
| **S4** Bestellung beim Hersteller | `wartet-auf-hersteller` | **Status** | Sofort | Generischer Wartestatus; Herstellername in Notiz/Feld später |
| **S4a** Auftragsbestätigung geprüft | `order_confirmation_verified` (Checkliste) | **Checklistenpunkt** | Später | Qualitätskontrolle, kein Kanban-Meilenstein |
| **S4b** Produktion freigegeben | `production_released` (Checkliste) | **Checklistenpunkt** | Später | Gate vor Produktionsstart — siehe Abschnitt 4 |
| **S4c** Vorkasse bezahlt | `prepayment_received` (Checkliste / Zahlungsflag) | **Checklistenpunkt** | Später | Zahlungsstatus ≠ Hauptpipeline |
| **S5** Produktion läuft | Unterstatus oder Notiz unter `wartet-auf-hersteller` | **Checklistenpunkt** (empfohlen) oder optional Status | Später | Nur als Kanban-Spalte, wenn Team es täglich braucht — sonst Checkliste |
| **S6** Montage geplant | `termin-vereinbart` (allgemein) oder `montage-geplant` (spezifisch) | **Status** + **Termin** | Später (Terminmodell) | Ohne Termin-Feld nur grob über Status; Montage ≠ Ersttermin |
| **S7** Montage abgeschlossen | `abgeschlossen` | **Status** | Sofort | Operatives Ende; Rechnung/Wartung optional danach |
| *(Ausnahme)* Abgelehnt | `abgelehnt` | **Status** | Sofort | Terminaler Ausgang |
| *(optional)* In Kalkulation | `in-kalkulation` | **Status** | Sofort | Zwischen Aufmaß und Angebot — bereits vorhanden |

**Hinweis Höning:** In UI und Daten immer **„Hersteller“ / „Lieferant“**; konkreter Name als Freitext oder Referenz (`manufacturer_id` später), nicht als Workflow-ID.

---

## 3. Status-Design — schlanke Fensterauftrag-Pipeline

### 3.1 Problem heute

Nora kennt **12 allgemeine Vorgangsstatus** (`defaultDealStages`). Das deckt viele Dienstleistungen ab, ist für **Fensterauftrag-Kanban** aber zu breit — besonders nach Kanban-Polish (leere Spalten ausblenden) wirken viele Phasen selten.

### 3.2 Empfehlung: Zwei Ebenen

| Ebene | Zweck | Anzahl |
|-------|--------|--------|
| **Hauptstatus** (`deals.stage`) | Kanban, Dashboard, Kundenkommunikation (später) | **7–8** für Fensterauftrag-Ansicht |
| **Unterpunkte** (Checkliste) | Qualität, Zahlung, interne Freigaben | **9 Punkte** (Abschnitt 4) |

### 3.3 Empfohlener schlanker Satz — **sichtbare Hauptstatus** (Fensterauftrag)

Diese Status sind **Teilmenge** der bestehenden Nora-Status-IDs — keine neuen DB-Werte nötig für v0.3c:

| # | Status-ID | Sichtbares Label | Chef-Bezug |
|---|-----------|------------------|------------|
| 1 | `neue-anfrage` | Neue Anfrage | Eingang |
| 2 | `aufmass-geplant` | Aufmaß geplant | Vor S1 |
| 3 | `aufmass-erledigt` | Aufmaß erledigt | S1 |
| 4 | `angebot-gesendet` | Angebot gesendet | S2 |
| 5 | `angenommen` | Angenommen | S3 |
| 6 | `wartet-auf-hersteller` | Wartet auf Hersteller | S4, S5 (intern differenziert per Checkliste) |
| 7 | `termin-vereinbart` | Montage geplant *(Label kontextabhängig)* | S6 |
| 8 | `abgeschlossen` | Abgeschlossen | S7 |

**Terminal / Sonderfälle** (nicht in aktiver Pipeline-Spalte): `abgelehnt`, optional `nachfassen`, `in-kalkulation` als Zwischenstatus im Formular, nicht zwingend als Kanban-Spalte.

### 3.4 UI-Konzept (spätere Welle, nicht jetzt)

- **Kanban-Filter:** „Nur Fensteraufträge“ (`category = fensterservice`) mit **reduzierter Spaltenmenge** (obige 8)
- **Allgemeines Kanban:** weiter alle Status, leere Spalten standardmäßig ausgeblendet (Kanban-Polish)
- **Statuswechsel im Formular:** volle Liste bleibt für Ausnahmen und Nicht-Fenster-Vorgänge

### 3.5 Was bewusst **keine** Hauptstatus bleiben

| Chef-Idee | Warum kein Hauptstatus |
|-----------|------------------------|
| S4a Auftragsbestätigung geprüft | Interne Kontrolle, kein tägliches Board-Thema |
| S4b Produktion freigegeben | Gate — boolescher Checklistenpunkt |
| S4c Vorkasse bezahlt | Zahlungsereignis, kein Prozessfortschritt für Kanban |
| S5 Produktion läuft | Unter `wartet-auf-hersteller` + Checkliste ausreichend |

---

## 4. Interne Kontrollcheckliste (vor Produktionsfreigabe)

### 4.1 Zweck

Digitale **Qualitäts- und Freigabesicherung** vor Herstellerproduktion — ersetzt PDF-Checklisten und mündliche „Hast du auch an … gedacht?“-Runden.

**Bringt:**

- weniger Fehlbestellungen (Maße, Farbe, Glas, Anschlag)
- nachvollziehbare Verantwortung (wer hat wann freigegeben)
- klare Voraussetzung für „Produktion freigegeben“ (S4b)
- Grundlage für spätere Dashboard-Kachel „Produktionsfreigaben offen“

### 4.2 Nutzer

| Rolle | Nutzung |
|-------|---------|
| Sachbearbeitung / Kalkulation | Punkte abhaken nach Prüfung |
| Meister / Chef | Finale Freigabe „Produktion freigegeben“ |
| Monteur (lesend) | Sieht bestätigte Spezifikation vor Montage |

### 4.3 Checklistenpunkte (Spezifikation)

| # | Punkt | Chef-Bezug | Pflicht vor Freigabe |
|---|-------|------------|----------------------|
| 1 | Maße geprüft | S1 / Aufmaß | ✅ |
| 2 | Anschlagrichtung geprüft | Aufmaß | ✅ |
| 3 | Farbe innen/außen geprüft | Kalkulation | ✅ |
| 4 | Glasart geprüft | Kalkulation | ✅ |
| 5 | Zusatzoptionen geprüft | Kalkulation | ✅ |
| 6 | Lieferadresse geprüft | S4 / Baustelle | ✅ |
| 7 | Rechnungsbetrag geprüft | Angebot/S3 | ✅ |
| 8 | Vorkasse bezahlt | S4c | ⚠️ nur wenn vertraglich Vorkasse |
| 9 | Produktion freigegeben | S4b | ✅ (Summenpunkt — erst wenn 1–7 erfüllt) |

### 4.4 Wo im CRM (Ziel-UI, nicht implementiert)

| Ort | Darstellung |
|-----|-------------|
| **Vorgangsdetail** (`DealShow`) | Abschnitt „Produktionsfreigabe“ unterhalb Status — nur bei `category = fensterservice` und Status ≥ `angenommen` |
| **Vorgang bearbeiten** | Checkliste read/write für berechtigte Rollen |
| **Dashboard** | Kachel: Vorgänge mit offener Freigabe (`angenommen` oder `wartet-auf-hersteller`, Checkliste unvollständig) |
| **Nicht** | Eigene Kanban-Spalten pro Punkt |

### 4.5 Technisches Zielmodell (spätere Welle v0.3d)

**Option A (empfohlen):** JSON-Struktur am Vorgang

```text
deals.production_checklist jsonb
  → [{ key, label, checked, checked_at, checked_by }]
```

**Option B:** eigene Tabelle `deal_checklist_items` — nur bei Bedarf für Historie/Audit.

**Guardrails:**

- Checkliste ist **am Vorgang** führend — nicht in Notizen duplizieren
- Freigabezeitpunkt und Benutzer speichern (`checked_by` → `sales.user_id`)
- Kein PDF als „Wahrheit“ — PDF ist Export, nicht Prozess

---

## 5. Hotboard / Dashboard

### 5.1 Zielbild

Das Dashboard wird zum **operativen Hotboard** — „Was muss ich heute tun?“ — nicht zur Management-Statistik allein.

### 5.2 Kacheln — Bewertung

| Kachel | Daten heute | Fehlende Felder | Ohne Google Kalender | Mit Google Kalender |
|--------|-------------|-----------------|----------------------|---------------------|
| **Heute nachfassen** | ✅ `expected_closing_date`, `stage` ≠ terminal | — | ✅ `Hotboard` | Kalender-Reminder optional |
| **Überfällige Vorgänge** | ✅ Datum < heute, aktiv | Dediziertes `follow_up_date` optional | ✅ ausbaubar aus gleichen Daten | Sync Warnungen |
| **Heutige Termine** | ⚠️ nur indirekt (`termin-vereinbart`, Aufgaben) | `appointments` Tabelle, Start/Ende, Typ | ⚠️ grob über Aufgaben (`taskTypes`: Aufmaß, Besichtigung) | ✅ echte Termine |
| **Aufmaß / Montage heute** | ⚠️ Aufgabe `aufmass` am Kontakt | Termin mit Typ + Vorgangsbezug | ⚠️ Filter Aufgaben „Aufmaß“ fällig heute | ✅ Kalender-Events |
| **Wartet auf Hersteller** | ✅ `stage = wartet-auf-hersteller` | `manufacturer_name`, Bestelldatum | ✅ `Hotboard` | — |
| **Offene Aufgaben** | ✅ `tasks` (über `contact_id`) | `deal_id` direkt am Task wäre einfacher | ✅ `HotboardOpenTasks` | Sync optional |
| **Neue Anfragen** | ✅ `stage = neue-anfrage` | `source_channel` | ✅ `Hotboard` | — |
| **Produktionsfreigaben offen** | ❌ | `production_checklist` | ❌ erst v0.3d | — |

### 5.3 Bereits implementiert (Ist) — v0.3b

- **`Hotboard`** (`Hotboard.tsx`): operative Startübersicht oben auf Desktop- und Mobile-Dashboard
  - Heute nachfassen (überfällig + heute, `expected_closing_date`)
  - Neue Anfragen (`neue-anfrage`)
  - Wartet auf Hersteller (`wartet-auf-hersteller`)
  - Angebote nachfassen (`angebot-gesendet`, `nachfassen`)
  - Offene Aufgaben (`HotboardOpenTasks`, max. 5, über `contact_id`)
- **Team-Ansicht** — alle nicht archivierten Vorgänge, nicht nur eigene (`sales_id`)
- **Navigation:** Klick → `/vorgaenge/:id/show` bzw. `/kontakte/:id/show`
- **Filterlogik:** `hotboardUtils.ts` (unit-getestet)
- `DealsChart`: Pipeline-Übersicht (statistisch, unterhalb Hotboard)
- `HotContacts`, `DashboardActivityLog`

**Bewusst nicht in v0.3b:**

| Kachel | Grund |
|--------|--------|
| Heutige Termine | Kein `appointments`-Modell |
| Aufmaß / Montage heute | Aufgaben ohne Vorgangsbezug + kein Kalender |
| Produktionsfreigaben offen | Checkliste erst v0.3d |
| Google Kalender | Integration später — echte Termine, nicht Nachfassdatum |

**Entfernt/ersetzt:** `DealFollowUpPanel` (nur 2 Bereiche, eigene Vorgänge, versteckt wenn leer)

### 5.4 Empfohlene Hotboard-Priorität (v0.3b) — ✅ umgesetzt

1. Überfällig **und** heute kombiniert mit Badge ✅
2. Neue Anfragen (`neue-anfrage`) ✅
3. Wartet auf Hersteller (alle, Team-Ansicht) ✅
4. Offene Aufgaben (prominent im Hotboard) ✅
5. Angebote nachfassen (`angebot-gesendet`, `nachfassen`) ✅
6. Nach v0.3d: Produktionsfreigaben offen
7. Nach Terminmodell + Google Kalender: Aufmaß/Montage heute

### 5.5 Layout-Prinzip

- Hotboard **oben** auf dem Dashboard (nach Onboarding-Stepper)
- Kacheln touchfreundlich (`nora-touch-target`, `nora-card`)
- Jede Kachel: Zahl + max. 5 Einträge + Link zur gefilterten Vorgangsliste

---

## 6. Kundenkommunikation (E-Mail)

### 6.1 Grundsatz

| Stufe | Beschreibung | Wann |
|-------|--------------|------|
| **0** | Keine Automatik | ✅ jetzt |
| **1** | Textvorlagen im Vorgang (Copy/E-Mail-Client) | v0.4 |
| **2** | Versand aus Nora mit **manueller Bestätigung** | v0.4+ |
| **3** | Regelbasierte Automation mit Opt-in | v0.5+ |

**Regel:** Keine vollautomatischen Status-E-Mails ohne erprobte Vorlagen und ohne Freigabekultur.

### 6.2 Bewertung pro E-Mail-Anlass

| Anlass | Nutzen | Risiko | Stufe |
|--------|--------|--------|-------|
| Angebot versendet (S2) | Kunde informiert, professionell | falscher Anhang, falscher Betrag | **1** → **2** |
| Auftragsbestätigung / Kundenfreigabe (S3) | Erwartungsmanagement | rechtliche Bindung falsch formuliert | **1** → **2** |
| Bestellung beim Hersteller (S4) | Transparenz „wir kümmern uns“ | Kunde denkt, Montage sei morgen | **2** (manuell) |
| Produktion gestartet (S5) | Paketverfolgungs-Feeling | Terminversprechen | **2** → **3** |
| Montage geplant (S6) | Terminbestätigung | falscher Termin | **2** mit Kalender-Sync |
| Montage abgeschlossen (S7) | Abschluss, Bewertungsbitte | — | **2** |
| Zahlungserinnerung Vorkasse | Cashflow | irritiert bei bereits bezahlt | **2**, nur mit Checklistenpunkt S4c |

**Technik später:** Nora-eigener Versand (Supabase Edge / SMTP) — **nicht** Zapier als Kern.

---

## 7. Kundenstatus-Link / Transparenzmodell

### 7.1 Chef-Idee

Kunde erhält Link und sieht Fortschritt „wie Paketverfolgung“.

### 7.2 Bewertung

| Aspekt | Einschätzung |
|--------|--------------|
| Fachlicher Nutzen | ✅ hoch — weniger Rückfragen, professionelles Bild |
| Nora-Kern jetzt | ❌ nein |
| Eigenes Modul | ✅ `customer_status_portal` oder öffentliche Route `/status/:token` |
| Sicherheit | Token pro Vorgang, Ablauf, keine internen Notizen/Herstellereinkaufspreise |
| Datenschutz | Nur freigegebene Meilensteine; DSGVO-Löschung bei Archivierung |
| Intern vs. extern | Mapping: interner Status + Checkliste → **vereinfachte** Kundenstufen (5–6) |

### 7.3 Empfohlene externe Kundenstufen (später)

1. Anfrage eingegangen  
2. Aufmaß durchgeführt  
3. Angebot unterbreitet  
4. Auftrag bestätigt / in Fertigung  
5. Montage terminiert  
6. Abgeschlossen  

**Aktuell:** nicht implementieren — erst nach stabilem internen Prozess und E-Mail-Vorlagen (v0.5).

---

## 8. Google-Integrationen

| Integration | Bewertung | Rolle in Nora |
|-------------|-----------|---------------|
| **Google Maps** | ✅ sinnvoll, **später** (v0.3f) | Baustellenadresse, Route, Karte in Objekt/Vorgang — nicht als Adressspeicher |
| **Google Kalender** | ✅ sinnvoll, **später** (v0.3g) | Echte Termine (Aufmaß, Montage); Nora bleibt führend, Sync bidirektional optional |
| **Google Drive** | ❌ nicht als Kernspeicher | Anhänge in Nora Storage / Supabase Buckets |
| **Gmail** | ⚠️ optional später | Inbound-E-Mail existiert; Outbound über Nora |
| **Google Keep / Tasks / Contacts** | ❌ nicht Nora-Kern | Aufgaben und Kontakte leben in Nora |

**Prinzip:** Nora ist **System of Record**; Google-Dienste sind **Präsentations- und Termin-Layer**, keine Prozesslogik.

---

## 9. Anti-Overengineering-Regeln

1. **Höning nicht hart verdrahten** — Feld/Notiz „Hersteller“, später `manufacturer_id` oder Lieferant als `companies` mit `sector = lieferant-hersteller`.
2. **S4a / S4b / S4c nicht als Kanban-Spalten** — Checkliste und Zahlungsflags.
3. **Keine automatischen E-Mails** ohne manuelle Freigabephase und Vorlagen.
4. **Kein Kundenportal** vor stabilem internen Prozess und Checkliste.
5. **Kein Zapier/Make** als Kernarchitektur — Nora-Workflows in DB + UI.
6. **Checkliste digital am Vorgang** — PDF nur als Export.
7. **Kein zweites Statussystem** in Tags oder Notizen.
8. **Fensterauftrag ≠ alle Vorgänge** — Filter/Workflow-Typ, nicht globale Status-Umstellung.
9. **Baustellenadresse nicht dreifach pflegen** — bis `objects`/`sites`: eine führende Adresse pro Vorgang oder Objekt.
10. **Nummern unverändert** — `KD-*` / `VG-*` bleiben Referenz in Kommunikation (siehe `08-numbering-and-global-search.md`).

---

## 10. Umsetzungsempfehlung in Phasen

| Phase | Inhalt | Abhängigkeiten |
|-------|--------|----------------|
| **v0.3a** | Globale Suche abschließen (Welle 6d) | Nummern ✅ |
| **v0.3b** | Hotboard erweitern (Kacheln Abschnitt 5.4) | vorhandene Deal/Task-Daten |
| **v0.3c** | Fensterauftrag-Workflow finalisieren: Kanban-Filter `fensterservice`, schlanke Spalten, Labels | keine DB-Pflicht |
| **v0.3d** | Digitale Kontrollcheckliste (`production_checklist`) | Migration + UI |
| **v0.3e** | Terminmodell (`appointments`: Typ Aufmaß/Montage, `deal_id`, Datum/Zeit) | Migration |
| **v0.3f** | Google Maps (Baustelle/Route) | Objekt- oder Adressmodell |
| **v0.3g** | Google Kalender (Sync Termine) | v0.3e |
| **v0.4** | E-Mail-Vorlagen + manueller Versand aus Vorgang | SMTP/Edge |
| **v0.5** | Kundenstatus-Link / Portal (Token, externe Stufen) | v0.3c–v0.4 stabil |

**Empfohlene nächste Implementierungswelle:** **v0.3a (Globale Suche)** — unabhängig vom Fensterprozess, operativ sofort nutzbar; danach **v0.3b + v0.3c** parallelisierbar.

---

## 11. Referenzen im Code (Ist-Stand)

| Thema | Ort |
|-------|-----|
| Vorgangsstatus | `defaultConfiguration.ts` → `defaultDealStages` |
| Dienstleistung / Fenster | `defaultDealCategories` → `fensterservice` |
| Kanban | `DealListContent.tsx`, `getVisibleDealStages` |
| Dashboard Hotboard | `Hotboard.tsx`, `hotboardUtils.ts`, `HotboardOpenTasks.tsx` |
| Nachfassdatum | `deals.expected_closing_date` |
| Zuständig | `deals.sales_id` |
| Aufgaben | `tasks.contact_id` (Umweg über Ansprechpartner) |
| Nummern | `deals.case_number`, `companies.customer_number` |

---

## 12. Offene Entscheidungen (Projektinhaber)

| # | Frage | Optionen |
|---|-------|----------|
| 1 | Montage geplant: Label `termin-vereinbart` oder neuer Status `montage-geplant`? | Wiederverwendung vs. Klarheit |
| 2 | S5 Produktion läuft als Status? | Checkliste only (empfohlen) vs. eigene Spalte |
| 3 | Vorkasse immer Pflichtpunkt? | Immer anzeigen vs. nur bei Zahlungsart Vorkasse |
| 4 | Hotboard: nur eigene oder alle Vorgänge? | `sales_id`-Filter vs. Team-Ansicht |
| 5 | Externe Kundenstufen: 5 oder 6 Meilensteine? | Marketing vs. Einfachheit |
