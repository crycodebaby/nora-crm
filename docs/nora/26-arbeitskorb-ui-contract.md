# 26 – Arbeitskorb (Alpha UI 2) – Oberflächen-Contract

Stand: 2026-10-13 · Status: **CONTRACT FROZEN / READY FOR IMPLEMENTATION REVIEW** · Umsetzungsstand: **nicht implementiert, nicht ausgeliefert** · Load-Klasse: **CONDITIONAL CURRENT CONTRACT**

Dieses Dokument ist der **eingefrorene Implementierungs-Contract für die erste Work-Oberfläche**, den Arbeitskorb (Alpha UI 2). Er legt fest, wie die bereits ausgelieferte Application-Leseschnittstelle `getWorkItems` ([`25`](25-universal-work-model.md) Abschnitt 21.6) konsumiert, orchestriert und dargestellt wird — und woran eine Implementierung objektiv gemessen wird.

**Was dieses Dokument nicht ist:** kein Live-Zustand (es gibt **keine** Arbeitskorb-Oberfläche in der Anwendung; [`16`](16-current-state.md) bleibt bis zur Auslieferung unverändert), keine Work-Semantik (die besitzt ausschließlich [`25`](25-universal-work-model.md)), keine Security-Durchsetzung ([`22`](22-security-and-access.md) Abschnitt 6.13). Bei einem Widerspruch zu [`25`](25-universal-work-model.md) gewinnt `25`, und der Widerspruch ist ein Befund.

**Begründung:** [`06`](06-decision-log.md) „2026-10-13 – Alpha UI 2". **Offene und nachgelagerte Punkte:** [`17`](17-known-issues-and-planned-waves.md) G.7 und I. **Basis:** `main` `c3611d3c526bbc4bb6a6ee1452983222c7e2bcd7` (Alpha Work 2 ausgeliefert).

> **Herkunft.** Der Contract wurde aus vier Arbeitsfassungen vom 2026-10-13 zusammengeführt, die **nicht** im Repository liegen: Product/UX-Discovery („Arbeitskorb — Alpha UI 2 Product/UX Proposal"), Technical Integration Discovery, Evidence Verification (T-1 … T-6, Urteil `ALPHA_UI_2_EVIDENCE_VERIFICATION_PASS`) und ein nicht eingefrorener Synthese-Entwurf. **Was hier steht, ist der Contract** — Formulierungen aus diesen Fassungen, die hier nicht stehen, gelten nicht. Wo eine Fassung einer verifizierten Evidenz widersprach, gilt die Evidenz; die Abweichungen sind in Abschnitt 22 benannt.

Begriffe: **MUSS** / **DARF NICHT** sind verbindlich; „Alpha" meint diese Welle (Alpha UI 2).

---

## 1. Produktdefinition

Der Arbeitskorb ist eine **read-only, serverseitig geordnete Liste offener Arbeit**. Er beantwortet genau eine Frage:

> **Welche Arbeit braucht gerade meine Aufmerksamkeit?**

Er ist **keine** Aufgabenverwaltung (keine Aktionen), **kein** KPI-Dashboard (keine Kennzahlen-Kacheln) und **keine** Priorisierungsmaschine (keine Umordnung, kein Score). Seine einzige Interpretationsschicht ist die **Darstellung** autoritativer Werte.

| Begriff | Festlegung |
|---|---|
| Seitenname | **Arbeitskorb** |
| Sichten | **Meine Arbeit** (`mine`, Default) · **Team** (`team`) |
| Zustandsumfang | ausschließlich **offen** (`stateScope = open`); kein Schalter für erledigt/alle |
| Eintrag | sichtbar „Aufgabe" (der Träger ist `task`, [`25`](25-universal-work-model.md) Abschnitt 4.2) |
| Ordnung | exakt die Ordnung der Query |
| Weiterarbeit | über die **Kontext-Akte** (Kunde oder Kontakt) — der Arbeitskorb selbst ändert nichts |

Der Arbeitskorb **ersetzt nichts**: Startseite (`/`), Hotboard, die mobile Navigation „Aufgaben" und die Aufgabenlisten auf Kunden-/Kontaktakten bleiben unverändert (Abschnitt 16; Ablösung ist Gate G-10).

---

## 2. Autoritätshierarchie

```text
SERVER / DOMAIN WORK AUTHORITY          public.get_work_items(...)  ([`25`] §21)
        │
        ▼
APPLICATION QUERY                        getWorkItems(reader, input)  ([`25`] §21.6)
        │
        ▼
UI QUERY ORCHESTRATION                   useWorkItems — Cache, Pagination, Refresh,
        │                                Freshness, Query-Status (Abschnitt 5)
        ▼
PRESENTATION MODEL                       toWorkRowView, Gruppierung, Datumsformat (Abschnitt 6)
        ├── Desktop-Darstellung          (Abschnitt 8)
        └── Mobil-Darstellung            (Abschnitt 9)

Getrennt davon, optional:
Work.context.customerId / contactId ──► autorisierter Batch-Lesezugriff ──► nur Anzeigename (Abschnitt 7)
```

**Work bestimmt, was die Arbeit ist. Die Application bestimmt, wie Work konsumiert wird. Die UI bestimmt nur, wie diese Wahrheit dargestellt wird.**

### 2.1 Was die UI nie besitzt

Die Oberfläche **DARF NICHT** berechnen, ableiten oder überschreiben: `overdue`, `dueToday`, `actionable`, `validity`, `state`, `isMine`, `isUnassigned`, Work-Zugehörigkeit (Membership), Work-Reihenfolge, Akteursidentität, Autorisierung, Priorität.

Sie **DARF NICHT**:

- rohe `tasks` lesen (kein `useGetList("tasks")`, kein `getList`/`getMany` auf `tasks` in der Arbeitskorb-Fläche),
- die RPC direkt aufrufen, den Namen `get_work_items` oder `p_*`-Argumente kennen,
- `dataProvider.getWorkItems(...)` direkt aufrufen — der einzige Einstieg ist die Application-Funktion `getWorkItems(reader, input)`,
- einen Akteur oder eine `sales`-ID an die Query übergeben,
- Work-UUIDs dekodieren oder daraus Task-IDs/Routen bauen,
- Vorgangs- oder Kundenkontext ableiten (z. B. aus dem Kontakt den aktuellen Kunden),
- Fehler in eine leere Liste verwandeln,
- lokal sortieren, filtern oder unvollständige Work verwerfen,
- einen Pagination-Cursor bauen, lesen, verändern, in die URL oder in Browser-Storage schreiben,
- `tasksPredicate.ts`, `NoraUrgencyBadge`/`getFollowUpStatus()` oder andere Legacy-Fälligkeitslogik importieren.

### 2.2 Grenzen der Orchestrierung und der Präsentation

**`useWorkItems` ist keine Application- und keine Domain-Autorität.** Seine Verantwortung ist abschließend: Query-Aufruf, Cache-Schlüssel, Pagination, Retry, Refresh, Lebenszyklus/Freshness und der Query-Status für die Darstellung. Künftige Konsumenten (MCP, G-11) verwenden `getWorkItems`, **nicht** diesen Hook.

**Ein Präsentations-Mapper (`toWorkRowView` o. ä.) übersetzt autoritative Fakten in sichtbare Texte, er erfindet keine neuen Work-Fakten.**

| erlaubt | verboten |
|---|---|
| `derived.overdue === true` → Gruppe „Überfällig" | `new Date(dueAt) < new Date()` → „überfällig" |
| `derived.isMine === true` → Halter „Ich" | `holder.salesId === identity.id` → „Ich" |
| `dueAt === null` → „Ohne Fälligkeit" | „bald fällig", „vor 3 Tagen", Fristarithmetik |
| `dueAt` → Kalenderdatum in `Europe/Berlin` (Abschnitt 3) | Uhrzeit anzeigen, Präzision erraten |
| `validity === "incomplete"` → „Ohne Bezeichnung" + Markierung | Titel ersetzen, Zeile ausblenden, „reparieren" |
| Zählen bereits gelieferter Flags einer **vollständig** geladenen Menge (Abschnitt 6.6) | Summen über eine unvollständige Menge als Gesamtzahl ausgeben |

Der Mapper verändert das DTO nicht (keine Mutation, keine angereicherten Felder am Work-Objekt).

---

## 3. Geschäftszeitzone `Europe/Berlin` (Darstellungskonvention)

**Nora hat genau eine Geschäftszeitzone: `Europe/Berlin`.** Serverseitig ist sie für jeden abgeleiteten Lesezustand bereits eingefroren ([`25`](25-universal-work-model.md) Abschnitte 7 und 16.2). Für die Oberfläche gilt zusätzlich:

1. **Sichtbare Work-Kalenderdaten werden in `Europe/Berlin` dargestellt** — explizit, nie in der Zeitzone des Browsers oder Geräts.
2. **Die Gerätezeitzone verändert das sichtbare Geschäftsdatum nicht.** Andere Gerätezeitzonen sind Testumgebungen, **keine** unterstützte fachliche Wahl.
3. **Es gibt keine benutzerwählbare Work-Zeitzone** in Alpha.
4. **Die Zeitzone dient ausschließlich der Darstellung von `dueAt`.** Der Browser berechnet weiterhin **nie** `overdue` oder `dueToday`.

### 3.1 Formatter-Vertrag

Ein kleiner, reiner Formatter (Arbeitsname `formatWorkDueDate`) mit:

- **Eingabe:** `dueAt: string | null` wörtlich aus dem DTO.
- **Ausgabe:** genau eine von drei Formen — `none` (für `null`), `date` (Kurztext, z. B. „Fr., 10.10.2026", und Langtext für Screenreader, z. B. „Freitag, 10. Oktober 2026"), `unreadable`.
- **Akzeptierte Grammatik:** `YYYY-MM-DDTHH:MM:SS[.f{1,6}](Z|±HH:MM)` mit vierstelligem Jahr. Alles andere — `infinity`, `-infinity`, fünfstellige Jahre, `BC`, Leerzeichen-Form, leerer String, Unsinn — ergibt `unreadable` und **wirft nie**.
- **Formatierung:** `Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", … })` mit **Wochentag, Tag, Monat und Jahr**. Das Jahr steht **immer** da (keine Abhängigkeit von „aktuellem Jahr" und damit von der Geräteuhr).
- **Nie:** Uhrzeit, relative Angaben, Fälligkeitsberechnung, Ordnungslogik, Veränderung des Quellwerts oder des Cursors.
- Formatter-Instanzen werden einmal erzeugt (Modulebene), nicht pro Zeile und Render.

### 3.2 Keine Uhrzeit

**Der Arbeitskorb zeigt für Work nie eine Uhrzeit.** Heute liefert die Query für jede Zeile `duePrecision = unknown` ([`25`](25-universal-work-model.md) Abschnitt 7.6); gespeicherte Uhrzeiten sind Artefakte (u. a. 02:00 aus der Schnellerfassung). Uhrzeiten erscheinen nur in Status- und Fehlertexten („Stand 14:32", „Erneut fehlgeschlagen · 14:33", ebenfalls in `Europe/Berlin`) — sie beschreiben Abrufe, nie die Arbeit.

---

## 4. Route, URL und Sicht

| Frage | Festlegung |
|---|---|
| Routenpfad | `/arbeitskorb` — als direkte `<Route>` in den **layout-tragenden** `<CustomRoutes>` **beider** Admin-Bäume (`DesktopAdmin` und `MobileAdmin` in `root/CRM.tsx`); **nicht** `noLayout`, **keine** Work-Resource, **kein** Eintrag in der Resource-Alias-Map |
| Laufzeit-URL | Nora läuft auf dem ra-core-**HashRouter** ([`04`](04-routing-i18n.md)): **`/#/arbeitskorb`**, **`/#/arbeitskorb?sicht=mine`**, **`/#/arbeitskorb?sicht=team`**. Ein Server-Pfad `/arbeitskorb` ohne `#` ist **keine** Arbeitskorb-URL |
| Pfadkonstante | eine zentrale Konstante (Muster `auditPagePath.ts`), genutzt für Registrierung, Links und Aktiv-Zustand |
| Sicht-Parameter | `sicht=mine` \| `sicht=team`. Fehlt er → `mine` (URL bleibt unverändert). Ungültiger oder mehrfach vorhandener Wert → `mine`, und die URL wird per **replace** auf `sicht=mine` normalisiert. Andere Parameter bleiben erhalten |
| Sichtwechsel durch den Benutzer | schreibt `sicht` per **replace** (kein neuer History-Eintrag). Begründung: „Zurück" verlässt den Arbeitskorb dorthin, woher man kam; die aktuelle Sicht steht trotzdem in der URL und wird bei der Rückkehr aus einer Akte wiederhergestellt |
| Verboten in der URL | Akteur/`sales`-ID, Cursor, `stateScope`/Zustand, Sortierung. Unbekannte Parameter werden nicht gelesen |
| Persistenz der Sicht | **nur** die URL. Kein `localStorage`, kein `sessionStorage`, kein ra-Store |

---

## 5. Query-Orchestrierung und Freshness (`useWorkItems`)

### 5.1 Aufruf

- Leser: `useDataProvider()` aus `ra-core`, als `CrmDataProvider` typisiert, wird **als `reader` an `getWorkItems`** übergeben.
- Eingabe je Seite: `{ scope, stateScope: "open", pageSize: 50, cursor }` — `scope` ausschließlich aus der validierten Sicht (Abschnitt 4), `cursor` ausschließlich der unveränderte `nextCursor` der Vorseite bzw. `null` für Seite 1. **Kein weiteres Feld** (die Application weist unbekannte Felder ab).
- Mechanik: `useInfiniteQuery` im vorhandenen Admin-`QueryClient` — **kein** zweiter `QueryClient`, kein eigener Store, kein Kopieren der Query-Daten in einen separaten Listenzustand.
- `initialPageParam: null`; nächste Seite nur, solange `nextCursor !== null`; **Ende genau dann, wenn `nextCursor === null`**. Kein Offset, keine Seitenzahl, keine geschätzte Gesamtzahl.
- Seiten werden in Lieferreihenfolge aneinandergehängt, Zeilen per `workId` geschlüsselt; **kein** Sortieren, Deduplizieren oder Filtern.

### 5.2 Cache-Identität

```text
["work", "items", <Identitäts-Partition>, <scope>, "open", 50]
```

- **Identitäts-Partition** = die Identität des angemeldeten Mitarbeiters aus dem bestehenden Auth-Provider (`useGetIdentity()`). Sie **partitioniert nur den Cache**; sie wird **nie** an `getWorkItems` übergeben und in `work/**` ausschließlich an den Baustein übergeben, der den Query-Schlüssel bildet. Die Query startet erst, wenn die Identität aufgelöst ist. Scheitert die Auflösung der Identität, zeigt die Fläche den allgemeinen Ladefehler („Der Arbeitskorb konnte nicht geladen werden." mit „Erneut versuchen", Abschnitt 11) — nie den Leerzustand und nie ein endloses Skelett.
- Ein Sichtwechsel wählt einen anderen Schlüssel und beginnt mit Cursor `null`. **Zeilen einer anderen Sicht werden nie als Platzhalter unter dem neuen Sichtnamen gezeigt** (kein `placeholderData`/`keepPreviousData` über Sichtgrenzen). Eine früher geladene Sicht darf aus **ihrem eigenen** Cache-Eintrag erscheinen und wird dabei nach 5.3 revalidiert — außer ihr letzter Fehler ist `permission_denied` (Render-Invariante in 5.4).
- Eine verspätete Antwort einer Sicht füllt nur ihren eigenen Eintrag und erscheint nie unter einer anderen Sicht oder Identität.

### 5.3 Freshness-Policy (Alpha, eingefroren)

| Einstellung | Wert | Begründung |
|---|---|---|
| `stateScope` | `open` | Arbeitskorb-Default ([`25`](25-universal-work-model.md) Abschnitt 17) |
| `staleTime` | **30 s** | verhindert Abfragestürme bei häufigem Fokuswechsel |
| `refetchOnMount` | **`"always"`** | Rückkehr aus einer Akte (dort wurde die Aufgabe ggf. erledigt oder geändert) lädt immer neu |
| `refetchOnWindowFocus` | `true` | |
| `refetchOnReconnect` | `true` | |
| `networkMode` | **`"online"`** — explizit, auf **beiden** Oberflächen (mobil ist der Default sonst `offlineFirst`) | offline wird als „offline" gezeigt, nicht als Fehler und nicht als aktueller Stand |
| `retry` | **`false`** | keine automatische Wiederholung; Wiederholen ist eine sichtbare Benutzeraktion. Konsistent mit [`23`](23-operations-errors-feedback.md) §5.4 und [`06`](06-decision-log.md) „Alpha Work 2" (Retry ist nie aus einem Fehler ableitbar) |
| `gcTime` | **5 min** (explizit, beide Oberflächen) | ein verlassener Arbeitskorb hält keinen 24-h-Schnappschuss im Speicher |
| Polling | **keins** (`refetchInterval` nicht gesetzt) | |
| Persistenz | **keine** — kein Persister, kein `localStorage`/`sessionStorage`/IndexedDB für Work oder Cursor | SEC-B2 |

### 5.4 Revalidierung ist kohärent

Jede Revalidierung — automatisch (Mount, Fokus, Reconnect, Tageswechsel) **und** manuell („Aktualisieren") — **beginnt bei Seite 1** und bezieht jeden weiteren Cursor ausschließlich aus den **frischen** Antworten dieser Revalidierung. Neu geladene Seite 1 wird **nie** mit alten Folgeseiten kombiniert. Der sichtbare Schnappschuss wird erst nach vollständigem Erfolg **als Ganzes** ersetzt; bis dahin bleibt der bisherige Schnappschuss sichtbar und ist als „wird aktualisiert" gekennzeichnet. Schlägt die Revalidierung fehl, bleibt der bisherige Schnappschuss sichtbar und wird **ausdrücklich als veraltet** gekennzeichnet (Abschnitt 11) — **außer bei `permission_denied`** (bei Revalidierung oder beim Nachladen einer Folgeseite): dann zeigt die Fläche **beim Rendern** keine Zeilen mehr, sondern „Zugriff verweigert" (Abschnitt 11), und die **übrigen, inaktiven** Work-Einträge dieser Identität werden verworfen (`removeQueries` auf das Identitäts-Präfix mit `type: "inactive"`). Der gerade angezeigte Eintrag wird **nicht** entfernt — sein Entfernen löste sofort eine neue Abfrage und damit eine Wiederholschleife aus. Eine Ablehnung erzeugt höchstens **eine** Ansage und **keine** zusätzliche Anfrage.

**Render-Invariante (Vorrang vor 5.2 und vor „Revalidierung läuft" in Abschnitt 11):** Nach einer `permission_denied`-Ablehnung wird **keine Zeile, die vor dieser Ablehnung geladen wurde, je wieder gerendert** — auch nicht während einer laufenden Revalidierung, nicht nach Rückkehr in diese Sicht, nicht im mobilen Blatt und auch dann nicht, wenn eine spätere Abfrage mit einem **anderen** `reason` scheitert. Sichtbar werden nur Zeilen aus einer **späteren erfolgreichen** Antwort. Mechanismus: bei der Ablehnung werden die Daten des angezeigten Eintrags verworfen, **ohne** den Eintrag zu entfernen (z. B. `queryClient.getQueryCache().find({ queryKey, exact: true })?.setState({ data: undefined })` — dieselbe Query-Instanz, kein Neuabruf, keine Schleife), oder ein gleichwertiger Ablehnungsmerker je Schlüssel, der erst bei Erfolg erlischt. Während ein abgelehnter Eintrag revalidiert, zeigt die Fläche den **Erstladezustand** (Abschnitt 11: Kopf, `aria-busy`, Skelett nach 300 ms) ohne neue Ansage; das Ergebnis entscheidet — Erfolg zeigt die neuen Zeilen, eine erneute Ablehnung wieder „Zugriff verweigert", ein anderer Fehler dessen Erstladefehler-Zustand **ohne** alte Zeilen. Zeilen dürfen sich dabei verschieben — Keyset-Stabilität gilt nur über einen unveränderten Bestand ([`25`](25-universal-work-model.md) Abschnitt 21.4); die UI repariert das nicht.

### 5.5 Berliner Tageswechsel

Bleibt die Seite über die Berliner Tagesgrenze offen, werden frische Server-Flags **durch Revalidierung** geholt: gemerkt wird der Berliner Kalendertag der letzten erfolgreichen Abfrage; weicht der aktuelle Berliner Kalendertag davon ab, wird die Query invalidiert. Auslöser: Fokus, `visibilitychange` und ein einzelner Timer auf die nächste Berliner Mitternacht **plus 2 Minuten Sicherheitsabstand** (eine vorgehende Geräteuhr soll nicht vor der Server-Mitternacht abfragen und die alten Flags als „neuen Tag" übernehmen). **Verglichen werden nur zwei Kalendertage (Abrufzeit vs. jetzt)** — nie das Fälligkeitsdatum einer Zeile, nie ein `overdue`/`dueToday`.

**Veralteter Tag wird sichtbar gemacht.** Ist der Berliner Kalendertag der letzten erfolgreichen Abfrage ein anderer als der aktuelle (z. B. offline oder nach gescheiterter Revalidierung über Mitternacht), trägt die Statuszeile das Datum: „Stand 12.10.2026, 17:45 · veraltet" — damit ein gestriges „Heute" nicht als heutiges gelesen wird. Auch das ist nur ein Vergleich zweier Kalendertage.

### 5.6 Sitzung, Abmeldung, Fehlerbehandlung

- Abmeldung leert den `QueryClient` (bestehendes ra-core-Verhalten). Zusätzlich verhindert die Identitäts-Partition, dass nach einem Identitätswechsel ein fremder Schnappschuss erscheint.
- `WorkQueryError` trägt einen HTTP-Status nur verschachtelt in `normalized`; eine automatische Abmeldung durch `checkError` wird **nicht** vorausgesetzt. `permission_denied` ist nicht automatisch „Sitzung abgelaufen" (Abschnitt 11).
- Keine Transport-Abbruchlogik (kein `AbortSignal` im Work-Eingang); getrennte Schlüssel verhindern Anzeigefehler über Sichtgrenzen.
- Fremde Task-Mutationen (Hotboard, Akten) invalidieren den Work-Schlüssel in Alpha **nicht** gezielt; die Rückkehr in den Arbeitskorb lädt nach 5.3 immer neu.

---

## 6. Präsentationsmodell

### 6.1 Gruppen: reine Beschriftung der Server-Sequenz

Gruppenschlüssel je Zeile, **ausschließlich** aus autoritativen Flags und `dueAt === null`, in dieser Vorrangreihenfolge:

| Schlüssel | Bedingung | sichtbare Überschrift |
|---|---|---|
| `overdue` | `derived.overdue` | **Überfällig** |
| `today` | sonst `derived.dueToday` | **Heute** |
| `none` | sonst `dueAt === null` | **Ohne Fälligkeit** |
| `upcoming` | sonst | **Demnächst** |

Die Oberfläche durchläuft die **geladene Sequenz einmal** und beginnt **nur dort eine neue Gruppe, wo sich der Schlüssel gegenüber der Vorzeile ändert** — auch über Seitengrenzen hinweg (eine Seitengrenze ist kein Gruppenwechsel). Taucht ein Schlüssel später erneut auf, **wiederholt sich die Überschrift**; Zeilen werden nie verschoben.

**Pflicht-Invariante** für jede geladene Sequenz `S`:

```text
flatten(presentationGroups(S)).map(workId) === S.map(workId)
```

Keine Zeile bewegt sich, verschwindet oder erscheint doppelt. Unvollständige Zeilen bleiben in ihrer Gruppe an ihrer Server-Position (Markierung inline, Abschnitt 6.3). Gruppenüberschriften tragen in Alpha **keine** Zahlen (wiederholte Überschriften würden Teilzahlen zeigen).

Sind `overdue` **und** `dueToday` wahr (künftig bei `duePrecision = instant` möglich, [`25`](25-universal-work-model.md) Abschnitt 7.3), steht die Zeile unter „Überfällig" und trägt zusätzlich den Text „heute fällig".

### 6.2 Datum

Darstellung nach Abschnitt 3.1: `date` → Kurz- und Langtext; `none` → „Ohne Fälligkeit" (Desktop-Datumsspalte zeigt „—"); `unreadable` → „Datum unlesbar", die Zeile bleibt an ihrer Server-Position.

### 6.3 Titel und unvollständige Zeilen

- Gültige Zeile: `title` wörtlich.
- `validity = incomplete`: Titelplatz zeigt **„Ohne Bezeichnung"** (kursiv, gedämpft) und eine Markierung **„Unvollständig"** (Icon **und** Text). `title` bleibt im DTO `null`; es gibt in Alpha **keine** Reparatur, keinen Bearbeiten-Einstieg und keine Erklärungs-Aufklappung. Die Kontext-Links funktionieren normal — dort lässt sich die Aufgabe ergänzen.
- `workType`: gedämpfter Text vor dem Kontext (z. B. „Anruf ·"); offenes Vokabular, **keine** Icon-Zuordnung; `null` → entfällt.

### 6.4 Halter (nur Sicht Team)

| Wert | Anzeige |
|---|---|
| `derived.isMine` | „Ich" |
| sonst `derived.isUnassigned` | „Nicht zugewiesen" |
| sonst `holder !== null` und `holder.displayName !== null` | Name |
| sonst `holder !== null` und `holder.displayName === null` | „Mitarbeiter ohne Namen" |
| sonst (`holder === null` ohne Flag) | „Zuständigkeit unbekannt" |

„Ich" folgt **ausschließlich** `derived.isMine`, „Nicht zugewiesen" **ausschließlich** `derived.isUnassigned` — nie einem Vergleich von `holder.salesId` mit der eigenen Identität und nie dem Schluss `holder === null` ⇒ „nicht zugewiesen". In „Meine Arbeit" wird der Halter nicht angezeigt. Der Halter ist **kein** Link. Sichtbare bzw. gesprochene Beschriftung: „Zuständig: …" (im Blatt sichtbar; in der Desktop-Spalte und der mobilen Zeile als visuell versteckter Präfix).

### 6.5 Nie angezeigt

`workId`, `carrier`, `duePrecision`, `actionable` (wirkt nur indirekt über die Unvollständig-Markierung), `holder.salesId`, Kontext-IDs als Zahl, Uhrzeiten von Work, eine Klasse „Neu" ([`25`](25-universal-work-model.md) Abschnitt 16.4).

### 6.6 Zusammenfassungszeile

- **Nur wenn die Menge vollständig geladen ist** (letzte geladene Seite hat `nextCursor === null`): „{a} überfällig · {b} heute · {n} offen" — `a` = Zeilen mit `overdue`, `b` = Zeilen mit `dueToday && !overdue`, `n` = alle geladenen Zeilen. Teile mit 0 entfallen, `n` steht immer.
- Sonst: „{n} Aufgaben geladen · weitere vorhanden". Nie eine Gesamtzahl über eine unvollständige Menge.
- Listenende bei vollständiger Menge: „Alle {n} offenen Aufgaben angezeigt" (bei `n = 1`: „1 offene Aufgabe angezeigt"); sonst der Knopf „Weitere laden".
- Bei 0 Zeilen gibt es weder Zusammenfassungszeile noch Listenende — nur den Leerzustand (Abschnitt 11).
- Alle Zahlen dieser Zeile und der Ansagen (Abschnitt 13.5) stammen ausschließlich aus `derived.overdue`/`derived.dueToday` und der Zeilenzahl — nie aus `dueAt`.

---

## 7. Kontext-Anreicherung (Anzeigenamen)

**Kontext-Identität ist Work-Autorität. Der Kontext-Anzeigename ist Präsentations-Anreicherung.** Ob eine Zeile einen Kunden- oder Kontaktkontext hat, entscheidet **allein** das DTO (`context.customerId`, `context.contactId`).

| Regel | Festlegung |
|---|---|
| Quelle | bestehende, autorisierte Provider-Lesevorgänge auf `companies` bzw. `contacts` (Basistabellen, RLS wie bei `tasks`). **Work 2 wird dafür nicht erweitert** |
| Felder | `companies`: `meta.columns = ["id", "name"]` · `contacts`: `meta.columns = ["id", "first_name", "last_name"]` — so landen Teilzeilen nicht im Detail-Cache der Akten (der Cache-Schlüssel enthält `meta`) |
| Batching | IDs je Ressource gesammelt und gebündelt gelesen (`useGetManyAggregate` oder ein `getMany` je Ressource über die gesammelten IDs). Die Zahl der Anfragen wächst höchstens mit der Zahl geladener Seiten, **nie mit der Zahl der Zeilen**. (`useGetManyAggregate` darf dabei die IDs mehrerer gleichzeitig gerenderter Seiten in **eine** Anfrage zusammenführen; bei Noras Bestand ist die URL-Länge kein Engpass.) |
| ID-Filter | `id != null` — nie eine Truthiness-Prüfung; **`0` ist eine gültige ID** und wird gelesen. `null` erzeugt keine Anfrage |
| Zuordnung | über die ID, nie über Position oder Name |
| Name | Kunde: `name` (getrimmt); Kontakt: `first_name` + `last_name` (getrimmt, Leerraum zusammengezogen); leer → „Kunde (ohne Namen)" / „Kontakt (ohne Namen)" |
| ausstehend | sichtbarer Text „Kunde" / „Kontakt", zugänglicher Name „Kunde (Name wird geladen)" / „Kontakt (Name wird geladen)" — kein doppelter Präfix; der Link funktioniert bereits |
| Lesefehler | „Kunde (Name nicht geladen)" / „Kontakt (Name nicht geladen)", Link bleibt; **ein** ruhiger Hinweis über der Liste „Einige Kunden- oder Kontaktnamen konnten nicht geladen werden." mit „Erneut versuchen" |
| Datensatz fehlt in erfolgreicher Antwort | „Kunde (Name nicht verfügbar)" / „Kontakt (Name nicht verfügbar)", Link bleibt, kein Hinweis |

Die Anreicherung **DARF NICHT**: Work entfernen, Work verändern, die Ordnung ändern, zum Work-Fehler werden, eine Leerliste auslösen, einen anderen Kontext ableiten (kein Folgen von `contact.company_id`, keine Vorgänge, keine Suche), einen `null`-Kontext „reparieren", Namen als Work-Felder speichern. Bestehende Auth-Fehlerbehandlung des Providers (z. B. abgelaufene Sitzung) bleibt unberührt; die Anreicherung unterdrückt sie nicht.

**Beförderungsregel.** Für den **ersten, visuellen** Konsumenten sind autorisierte Batch-Lesevorgänge zulässige Präsentations-Anreicherung. Braucht ein **zweiter, unabhängiger oder nicht-visueller** Konsument (z. B. MCP, Automation) denselben Anzeigekontext, wird neu bewertet, ob Nora eine Application-Fähigkeit für Anzeigekontext braucht — die UI-Logik wird dann **nicht** dupliziert, und Work 2 wird **jetzt nicht** vorsorglich erweitert.

---

## 8. Desktop (≥ 768 CSS px)

- **Seite** im bestehenden `Layout` (`main#main-content`); **kein** zweites `main`, kein zweiter Header.
- **Kopf:** `h1` „Arbeitskorb"; darunter die Sichtwahl (Abschnitt 13.3); rechts der Status „Stand HH:MM" und ein Icon-Knopf „Arbeitskorb aktualisieren". Kein Tagesdatum im Kopf.
- **Zusammenfassungszeile** (Abschnitt 6.6), Text, keine Kacheln.
- **Liste:** eine Spalte, Inhaltsbreite höchstens ca. 880 px, linksbündig an der Inhaltskante; Gruppen mit Überschrift (Abschnitt 6.1); Zeilenhöhe ca. 56–64 px.
- **Zeilenaufbau:** Datumsspalte (Wochentag + vollständiges Datum, ohne Abschneiden) · Titel (primär, vollständig, ohne Kürzung) und darunter Metazeile „Art · Kunde · Kontakt" · Halterspalte **nur in Team**.
- **Interaktion:** **die Zeile ist kein Link und hat keinen Klick-Handler** (es gibt kein Work-Detail und zwei mögliche Kontexte). Interaktiv sind ausschließlich die Kontext-Links, jeweils ein echtes `<a>` (Mittelklick und „in neuem Tab" funktionieren). Hover hebt die Zeile dezent hervor, Links werden unterstrichen.
- **Kontext-Links:** Kunde → `#/kunden/:customerId/show/tasks` (öffnet direkt den Aufgaben-Reiter der Kundenakte); Kontakt → `#/kontakte/:contactId/show`. Erzeugt über `noraCreatePath(...)` (Kunde plus Reiter-Suffix `/tasks`), nie hartcodiert englisch ([`04`](04-routing-i18n.md)). Sichtbarer Text ist der Name (Abschnitt 7); der zugängliche Name beginnt mit der Art („Kunde: …", „Kontakt: …") über einen visuell versteckten Präfix, der sichtbare Text bleibt Teil des zugänglichen Namens (bei ausstehendem Namen gilt die Sonderform aus Abschnitt 7). Jeder Kontext-Link verweist per `aria-describedby` auf den Titel seiner Zeile, damit gleichlautende Links in einer Linkliste unterscheidbar sind.
- **Dringlichkeit:** Überschrift „Überfällig" mit Icon **und** Wort; eine 2-px-Linie links an der Zeile. „Heute": Icon + Wort, Datum fett. „Demnächst"/„Ohne Fälligkeit": neutral. Keine Farbflächen, kein Pulsieren, kein Badge pro Zeile. **Töne (bestehende Tokens, keine neuen):**

  | Element | hell | dunkel |
  |---|---|---|
  | Datumstext der Gruppe „Überfällig" | `--nora-accent-text` | `--nora-accent-text` |
  | Linie und Icon „Überfällig" | `--nora-accent-strong` | `--nora-accent` |
  | übrige Texte | bestehende Text-Tokens | bestehende Text-Tokens |

  **Verboten** als Text- oder Indikatorfarbe sind `--nora-accent` im hellen Modus (erreicht auf dem App-Grund keine 3:1) und das frühere Brand-Rot `#ff3b1f`. Die Kontrastschwellen aus Abschnitt 13.6 werden gegen den **tatsächlichen** Zeilenhintergrund gemessen, auch im Hover-Zustand.
- **Pagination:** Knopf „Weitere laden" am Listenende. Er ist **während jeder laufenden Abfrage** der Liste (auch einer Revalidierung, nicht nur beim Nachladen) per `aria-disabled="true"` gesperrt — nicht per `disabled`, damit der Fokus auf ihm bleibt —, sodass ein Nachladen nie eine laufende Revalidierung abbricht und an alte Seiten anhängt. Kein Endlos-Scrollen.

---

## 9. Mobil (< 768 CSS px)

Dieselbe Work-Wahrheit, für die schmale Fläche neu komponiert. Maßgeblich ist die **Oberfläche** (< 768 CSS px → `MobileAdmin`), nicht das Gerät.

- **Seite** in `MobileLayout` nach dem bestehenden Hausmuster: `MobileHeader` mit `h1` „Arbeitskorb" (ohne Zurück-Knopf — der Arbeitskorb ist eine Einstiegsseite) als Geschwister von `MobileContent`, das `main` und den Abstand zur festen unteren Navigation stellt. Das `h1` liegt damit mobil **außerhalb** von `main` (wie auf allen mobilen Nora-Seiten). Kein Tagesdatum. `MobileHeader` und `MobileContent` werden **nicht** geändert.
- **Sichtwahl** volle Breite, mindestens 44 px hoch, als erstes Element in `MobileContent`; sie scrollt mit dem Inhalt (kein Kleben — `MobileContent` ist wegen `overflow-y-auto` ein Scroll-Container, scrollt selbst aber nie, weil das Dokument scrollt; darum greift `position: sticky` dort nicht, und Scrollpositionen werden über `window.scrollY` gemessen). Darunter Status/Aktualisieren und die Zusammenfassungszeile.
- **Zeile:** ein einziges Tap-Ziel (`button`, mindestens 64 px hoch), kartenlos:
  - Zeile 1: Titel (bis 3 Zeilen, dann gekürzt; vollständig im Blatt) bzw. „Ohne Bezeichnung" + „Unvollständig"
  - Zeile 2: Datum (mit denselben Dringlichkeitstönen wie Desktop, Abschnitt 8; „Heute" fett) · Art (falls vorhanden)
  - Zeile 3: Kundenname · Kontaktname (vorhandene Teile)
  - Zeile 4 (nur Team): Zuständig (Abschnitt 6.4)
  - Namen sind hier **Text, keine Links**. Die Gruppenüberschriften und die 2-px-Linie gelten wie auf Desktop.
- **Blatt (Bottom Sheet):** Tippen öffnet ein Blatt aus dem bestehenden Primitive `ui/sheet.tsx` (`side="bottom"`) **mit `showClose={false}`** (wie `CreateSheet`/`EditSheet`; der eingebaute Schließen-Knopf ist englisch beschriftet und zu klein). Es ist **ausschließlich eine read-only Darstellung des bereits geladenen DTO plus optionaler Anzeigenamen** — **keine** Work-Detail-Abfrage, keine Task-Route, kein Editor, keine Aktion auf Work. Das Blatt ist an die `workId` gebunden und zeigt immer die Zeile des **aktuellen** Schnappschusses; nur wenn sie nach einer Revalidierung fehlt, zeigt es den zuletzt gesehenen Stand mit dem Hinweis „Diese Aufgabe ist nach der Aktualisierung nicht mehr in dieser Ansicht." Inhalt:
  - Titel (Blatt-Titel) bzw. „Ohne Bezeichnung" + „Unvollständig"
  - Art (falls vorhanden)
  - Fälligkeit in Worten: Gruppenbezeichnung + Langdatum, bzw. „Ohne Fälligkeit" / „Datum unlesbar"
  - „Zuständig: …" (nur Team)
  - Aktionen, je mindestens 48 px hoch, in dieser Reihenfolge:
    1. **„Kontakt öffnen"** mit Kontaktname — wenn `contactId != null`; die bevorzugte operative Aktion (die mobile Kontaktakte hat einen Aufgaben-Reiter)
    2. **„Kundenakte öffnen"** mit Kundenname — wenn `customerId != null`; als Kontextinformation
  - Ist kein Kontakt vorhanden, steht unter den Aktionen der Hinweis: „In der mobilen Ansicht zeigt die Kundenakte keine Aufgaben."
  - eigener, sichtbarer Knopf **„Schließen"** (mindestens 48 px); Escape schließt ebenfalls. Die Fokusrückgabe wird **ausdrücklich** über `onCloseAutoFocus` umgesetzt (das Blatt wird programmatisch aus dem Zeilen-Knopf geöffnet, Radix kennt dann keinen Auslöser): Fokus zurück auf den Zeilen-Knopf, sonst nach Abschnitt 13.4. Eine Navigation aus dem Blatt schließt es.
- **Verbotene Beschriftungen** für die Kundenaktion: „Aufgabe öffnen", „Aufgabe bearbeiten", „Weiter zur Aufgabe" oder jede Formulierung, die verspricht, dass die mobile Kundenakte die Aufgabe zeigt. Sie zeigt mobil **keine** Aufgaben.
- **Ziele:** `#/kontakte/:contactId/show` und `#/kunden/:customerId/show` (beide mobil registriert). Kein Vorgang, kein Reiter-Suffix auf Mobil.
- Das Blatt ist **kein** URL-Zustand. Jede Navigation, auch über „Zurück", schließt das Blatt.
- Bei `permission_denied` (5.4) schließt sich ein offenes Blatt sofort, ohne den zuletzt gesehenen Stand weiter zu zeigen; der Fokus geht auf das aktive `tabpanel`.
- Die mobile Kundenakte wird in Alpha **nicht** erweitert ([`17`](17-known-issues-and-planned-waves.md) G.2, „Mobile ‚Aufgaben'-Bereich auf der Kundenakte").

---

## 10. Navigation und Rückweg

| Von | Nach | Bedingung | Versprechen |
|---|---|---|---|
| Desktop: Kundenname | `#/kunden/:id/show/tasks` | `customerId != null` | öffnet die Kundenakte im Aufgaben-Reiter (listet Aufgaben nach `company_id`) |
| Desktop: Kontaktname | `#/kontakte/:id/show` | `contactId != null` | öffnet die Kontaktakte. **Nicht** versprochen, dass jede Rolle dort die Aufgabe sieht (die Aufgabenleiste ist schreibrecht-gebunden) |
| Mobil: „Kontakt öffnen" | `#/kontakte/:id/show` | `contactId != null` | Kontaktakte; Aufgaben über deren Reiter „N Aufgabe(n)" (nicht direkt verlinkbar, nicht der Start-Reiter) |
| Mobil: „Kundenakte öffnen" | `#/kunden/:id/show` | `customerId != null` | nur die Kundenakte als Kontextinformation |
| Zeile (Desktop) / Halter / Vorgang / Task / Mitarbeiter | — | — | **kein Ziel.** Keine Work→Task-Route, keine Vorgang-Ableitung ([`25`](25-universal-work-model.md) Abschnitt 14.3), kein Mitarbeiterprofil |
| leere „Meine Arbeit" | Sicht Team | — | „Team ansehen" ist ein **Knopf** (kein Link), der denselben Sichtwechsel per replace auslöst wie der Tab und den Fokus auf den Tab „Team" setzt |

**Rückweg.** Der Rückweg in den Arbeitskorb ist die **normale Browser-/System-History**. Verifiziert ist (an einer Ersatzroute mit bereits vorhandenen Daten): „Zurück" stellt die exakte Hash-URL inklusive `sicht` wieder her, und die Scrollposition kommt zurück, solange die Liste beim Rendern bereits Daten hat. Für den Arbeitskorb heißt das: bei Rückkehr innerhalb der `gcTime` (5 min) erscheint der zwischengespeicherte Schnappschuss sofort, die Scrollposition wird wiederhergestellt und im Hintergrund revalidiert; nach längerer Abwesenheit beginnt die Liste mit dem Erstladezustand oben — in Alpha akzeptiert. Der Fokus wird nach „Zurück" nicht auf den zuletzt benutzten Link zurückgesetzt (Abschnitt 22). Die Nora-Komponente `MobileBackButton` navigiert zu festen Zielen (Kontakt → Kontaktliste, Kunde → Start) und **wird in Alpha nicht umgebaut**. Ob ein **installierter PWA-Client** auf echten Geräten einen verlässlichen Rückweg hat, ist ein **Release-Gate** (RG-1); fehlt er, ist das ein begrenzter Navigationspunkt mit eigener PO-Entscheidung **vor** dem Release — kein globaler Umbau des `MobileBackButton` während der Implementierung.

---

## 11. Zustände

| Zustand | Auslöser | Darstellung | Aktion |
|---|---|---|---|
| Erstladen | noch keine Daten | Kopf und Sichtwahl sofort; Liste reserviert, `aria-busy="true"`; Skelettzeilen erst nach **300 ms** | — |
| Leer — Meine Arbeit | Erfolg, 0 Zeilen, `nextCursor === null` | „Keine offenen Aufgaben in Meine Arbeit." | Knopf „Team ansehen" (Abschnitt 10) |
| Leer — Team | dito | „Im Team sind keine offenen Aufgaben." | — |
| Demo nicht verfügbar | `reason = unavailable` **und** Demo-Modus (`isNoraDemoMode`) | Info-Zustand: „Der Arbeitskorb nutzt Live-Daten und ist im Demo-Modus nicht verfügbar." | — |
| nicht erreichbar | `reason = unavailable` (kein Demo) | „Der Arbeitskorb ist gerade nicht erreichbar." | „Erneut versuchen" |
| Zugriff verweigert | `reason = permission_denied` | „Kein Zugriff auf den Arbeitskorb. Bitte neu anmelden, falls das unerwartet ist." | Link zur Startseite; keine Wiederholschleife |
| Ungültige Anfrage / fehlerhafte Antwort / sonstiger Fehler / Identität nicht auflösbar | `invalid_request` · `malformed_response` · `failed` · Identitätsfehler (5.2) | „Der Arbeitskorb konnte nicht geladen werden." + kleiner technischer Code (`reason`, ggf. `code`) — nie die rohe Fehlermeldung | „Erneut versuchen" |
| Wiederholung erneut gescheitert | wie oben, nach „Erneut versuchen" | Panel bleibt, ergänzt um „Erneut fehlgeschlagen · 14:33" | „Erneut versuchen" |
| Revalidierung läuft | Daten vorhanden und letzter Fehler **nicht** `permission_denied` (5.4) | Zeilen bleiben; Aktualisieren-Icon dreht sich; Status „Wird aktualisiert …" | — |
| Revalidierung fehlgeschlagen (`unavailable`, `failed`, `malformed_response`, `invalid_request`) | Fehler bei vorhandenem Schnappschuss | Schnappschuss bleibt; Status „Stand 14:32 · Aktualisierung fehlgeschlagen" (bei anderem Berliner Tag mit Datum, 5.5); Liste wird **nie** geleert | über den Knopf „Arbeitskorb aktualisieren" (kein zusätzlicher Knopf) |
| `permission_denied` bei Revalidierung oder beim Nachladen | Zugriff bei vorhandenem Schnappschuss entzogen | Schnappschuss wird nicht mehr angezeigt und durch den Zustand „Zugriff verweigert" ersetzt; die inaktiven Work-Einträge dieser Identität (andere Sicht) werden verworfen (5.4) — keine Daten ohne gültigen Zugriff, keine Wiederholschleife | Link zur Startseite |
| „Weitere laden" fehlgeschlagen (jeder `reason` außer `permission_denied`) | Fehler auf Folgeseite | geladene Zeilen bleiben; über dem Knopf der Inline-Text „Weitere Aufgaben konnten nicht geladen werden." (per `aria-describedby` am Knopf); der Knopf „Weitere laden" ist zugleich die Wiederholung | „Weitere laden" |
| Offline ohne Daten | Abfrage pausiert, kein Schnappschuss | „Keine Verbindung. Der Arbeitskorb lädt, sobald Nora wieder online ist." | — |
| Offline mit Daten | pausiert, Schnappschuss vorhanden | Schnappschuss bleibt; Status „Offline · Stand 14:32" (bei anderem Berliner Tag mit Datum) | — |
| Namen nicht geladen | Anreicherung scheitert | Abschnitt 7; Work unverändert sichtbar | „Erneut versuchen" (nur Namen) |

**Ein Fehler wird nie als erfolgreicher Leerzustand dargestellt** — für jeden `reason`. Der Leerzustand erscheint ausschließlich nach erfolgreicher Antwort mit 0 Zeilen und `nextCursor === null`. **Ein Anreicherungsfehler wird nie zum Work-Fehler.** Dieser Contract führt für den Arbeitskorb zusätzlich eine Tonregel ein (im Geist von [`02`](02-design-system.md) „Begriffliche Regeln"): kein „Alles erledigt!", kein Konfetti, keine Illustration — leer heißt „nichts offen", nicht „du hast alles geschafft".

---

## 12. Motion

**Technische Grenze:** ausschließlich bestehende Nora-Tokens (`--nora-motion-fast` 150 ms, `--nora-motion-base` 220 ms, `--nora-motion-ease`) und vorhandene Tailwind-/Radix-Mittel; **keine neue Motion-Bibliothek**, keine Listen-Exit-/Reflow-Steuerung.

| # | Anlass | Verhalten | reduzierte Bewegung |
|---|---|---|---|
| M1 | erste Daten | Liste **als Ganzes** Deckkraft 0→1 + 4 px Anstieg, 220 ms; keine Staffelung pro Zeile | sofort |
| M2 | Skelett | erst nach 300 ms; bei Datenankunft 150 ms Überblendung | gleiche Schwelle, ohne Überblendung, **ohne Pulsieren** |
| M3 | Sichtwechsel | Auswahlanzeige gleitet 220 ms; keine horizontale Seitenbewegung; keine Zeilen der alten Sicht als Platzhalter (Abschnitt 5.2) | Anzeige springt |
| M4 | „Weitere laden" | angehängte Zeilen 150 ms einblenden | sofort |
| M5 | Wiederholen | Spinner im Knopf; erneutes Scheitern ändert den Text, **kein Schütteln** | nur Text |
| M6 | Leerzustand | 220 ms einblenden | sofort |
| M7 | Blatt (mobil) | Übergänge des bestehenden Sheet-Primitives | ohne Bewegung (siehe unten) |

**Ausgeschlossen in Alpha:** animiertes Verschwinden oder Erscheinen einzelner Zeilen bei einer Revalidierung (Zeilen wechseln ohne Choreografie; die Statusansage trägt die Information), Hervorhebung „neu hinzugekommener" Zeilen, Pulsieren oder Animation überfälliger Zeilen, Scroll-Reveal, eigene Routenübergänge, jede Bewegung, die die Server-Reihenfolge verändert oder vortäuscht. **Bewegung ersetzt nie einen Ladezustand** und wartet nie auf die Antwort. Mit `prefers-reduced-motion: reduce` läuft **keine** Transition und **keine** Animation der Fläche — einschließlich Skelett, Blatt und Overlay; jede Information bleibt ohne Bewegung verständlich. Mechanismus: schlichte CSS-Deklarationen in `src/index.css` unter `@media (prefers-reduced-motion: reduce)`, die für alle Nachfahren der Fläche — verankert an einem Arbeitskorb-eigenen Wrapper, nicht am gemeinsamen `MobileContent` — `animation` und `transition-duration` auf null setzen (auch für die Tailwind-Übergänge von `ui/button` und `ui/tabs`) — für das Blatt über ein Arbeitskorb-eigenes Attribut am `SheetContent`, für das Overlay über das vorhandene `[data-slot="sheet-overlay"]` (das Overlay nimmt über `SheetContent` keine Klasse an; die Regel wirkt deshalb auch auf andere Blätter, und zwar nur unter reduzierter Bewegung — eine bewusst in Kauf genommene, rein abschwächende Nebenwirkung). `ui/sheet.tsx` bleibt unverändert.

---

## 13. Accessibility

### 13.1 Struktur

- Genau **ein** `main` (Desktop: `Layout`; Mobil: `MobileContent`) und genau **ein** `h1` „Arbeitskorb" der Seite: auf Desktop **innerhalb** von `main`, auf Mobil im Seitenkopf `MobileHeader` (Hausmuster, außerhalb von `main`). Die vorbestehende Desktop-App-Kopfzeile (`<h1>Nora</h1>` im globalen Header) ist nicht Teil dieses Contracts.
- Jede Gruppe ist ein `<section aria-labelledby>` mit `h2`; die Zeilen einer Gruppe stehen in einer **geordneten Liste** (`<ol>`), weil die Reihenfolge Bedeutung hat.
- Keine verschachtelten interaktiven Elemente (kein Link in einem Knopf, kein Knopf in einem Link); keine klickbaren `div`s; echte Links und Knöpfe.

### 13.2 Zeilenbeschriftung

Dringlichkeit wird **gesprochen**, nicht nur gefärbt: der zugängliche Text einer Zeile enthält Gruppenbezeichnung und Langdatum (z. B. „Überfällig, Freitag, 10. Oktober 2026"). Icons sind `aria-hidden`. **Farbe ist nie das einzige Dringlichkeitssignal** (Wort + Icon + Linie).

### 13.3 Sichtwahl

`role="tablist"` mit zwei `tab`s („Meine Arbeit", „Team"), die je ein `tabpanel` steuern — für jede Sicht wird ein `TabsContent` gerendert; Radix hält im Standardverhalten das Panel der inaktiven Sicht im DOM, `hidden` und ohne Inhalt, sodass `aria-controls` nie ins Leere zeigt (**kein** `forceMount` — damit wäre das inaktive Panel sichtbar und gefüllt); sichtbar ist nur der Listenbereich der gewählten Sicht; Pfeiltasten wechseln, der gewählte Tab ist per Tab-Taste erreichbar; die Auswahl spiegelt die URL (Abschnitt 4). Das `tabpanel` ist — wie im Radix-Standard — **ein** Tabstopp und zugleich das **Fokus-Ersatzziel** (13.4). Mindesthöhe der Tabs 44 px; sichtbarer Fokusring (bestehende Fokus-Klassen).

### 13.4 Fokus

- **Tab-Reihenfolge** (beide Oberflächen): Sichtwahl → „Arbeitskorb aktualisieren" → Hinweis-Knöpfe, falls vorhanden (Namen) → Listenbereich (`tabpanel`) → je Zeile in Server-Reihenfolge die Kontext-Links (Desktop) bzw. der Zeilen-Knopf (Mobil) → „Weitere laden". Zustandsbedienelemente („Erneut versuchen" eines Fehlerpanels, „Team ansehen", „Zur Startseite") stehen **innerhalb** des `tabpanel` an der Stelle der Liste und folgen in der Reihenfolge direkt auf den Listenbereich. Die Wiederholung bei veraltetem Schnappschuss ist der Knopf „Arbeitskorb aktualisieren".
- **Fokus-Ersatzziel** ist das `tabpanel`. „Nächste Zeile" heißt auf Desktop: deren erster Kontext-Link (jede Zeile hat mindestens einen Kontext, [`25`](25-universal-work-model.md) Abschnitt 21.3); auf Mobil: deren Zeilen-Knopf.
- Verschwindet das fokussierte Element durch eine Revalidierung: Fokus auf die nächste Zeile, sonst die vorherige, sonst das Ersatzziel.
- Erfolgreiches „Erneut versuchen" nach einem Erstladefehler, erfolgreiches Neuladen der Namen und das Verschwinden eines Hinweis-Knopfs: Fokus auf das Ersatzziel.
- „Weitere laden" bleibt fokussiert, solange es `aria-disabled` ist; nach Erfolg geht der Fokus auf die **erste neu angehängte Zeile** (Desktop: deren erster Kontext-Link; Mobil: deren Zeilen-Knopf); nach Misserfolg bleibt er auf dem Knopf — außer bei `permission_denied`: dann verschwindet die Liste, und der Fokus geht auf das Ersatzziel (das aktive `tabpanel`); die Meldung trägt das „Zugriff verweigert"-Alert.
- „Team ansehen" setzt den Fokus auf den Tab „Team".
- Mobiles Blatt: modale Fokusfalle, Escape und eigener „Schließen"-Knopf, Fokusrückgabe über `onCloseAutoFocus` zum Zeilen-Knopf — bzw. nach den Regeln oben, wenn er nicht mehr existiert. Zeilen-Knopf trägt `aria-haspopup="dialog"`. Blatt mit zugänglichem Titel.
- Laden von Folgeseiten und Namen stiehlt sonst nie den Fokus.

### 13.5 Ansagen

Eine `aria-live="polite"`-Region (`role="status"`) für den Listenstatus; Fehler beim Erstladen und „Zugriff verweigert" über `role="alert"`. Feste Texte (Pluralform: „1 offene Aufgabe" / „{n} offene Aufgaben"; Teile mit 0 entfallen, die Gesamtzahl steht immer; `{Stand}` ist „14:32" bzw. bei anderem Berliner Tag „12.10.2026, 17:45"):

| Übergang | Text | Kanal |
|---|---|---|
| Erstladen > 1 s | „Arbeitskorb wird geladen." | polite |
| Erfolg, vollständig | „{Sicht}: {n} offene Aufgaben, {a} überfällig, {b} heute." | polite |
| Erfolg, unvollständig | „{Sicht}: {n} Aufgaben geladen, weitere vorhanden." | polite |
| Erfolg, leer | Text des Leerzustands | polite |
| Demo nicht verfügbar | Text des Zustands | polite |
| Revalidierung mit Änderung (`workId`-Folge **oder** Gruppenschlüssel **oder** Zahlen geändert) | „Arbeitskorb aktualisiert." + Zusammenfassung | polite |
| manuelles „Aktualisieren" ohne Änderung | „Arbeitskorb aktualisiert, keine Änderungen." | polite |
| automatische Revalidierung ohne Änderung | keine Ansage | — |
| Revalidierung fehlgeschlagen — nur beim **Übergang** in den Fehlerzustand und nach jedem manuellen „Aktualisieren", nicht bei jeder weiteren automatischen Revalidierung | „Aktualisierung fehlgeschlagen. Angezeigt ist der Stand von {Stand}." | polite |
| „Weitere laden" erfolgreich | „{k} weitere Aufgaben geladen." (bei `k = 1`: „1 weitere Aufgabe geladen.") | polite |
| „Weitere laden" fehlgeschlagen | „Weitere Aufgaben konnten nicht geladen werden." | polite |
| offline mit Daten | „Keine Verbindung. Angezeigt ist der Stand von {Stand}." | polite |
| offline ohne Daten | Text des Offline-Zustands | polite |
| Namen nicht geladen | „Einige Kunden- oder Kontaktnamen konnten nicht geladen werden." (einmal je Fehlschlag) | polite |
| Erstladefehler | Text des Fehlerpanels | alert |
| erneut gescheitert | „Erneut fehlgeschlagen · {Uhrzeit}" — wird **jedes Mal erneut** angesagt | alert |
| Zugriff verweigert | Text des Zustands | alert |

Nie „erledigt" (eine Zeile kann auch durch Umverteilung die Sicht verlassen); die ganze Liste wird nie vorgelesen; Benachrichtigungen bleiben beim bestehenden `NoraNotificationAnnouncer` (keine Doppelansage).

### 13.6 Berührung, Breite, Kontrast

- Tap-Ziele mindestens **44 × 44 px**, Aktionen im Blatt einschließlich „Schließen" mindestens **48 px**.
- Keine horizontale Seitenüberbreite bis hinab zu **320 CSS px**; Desktop ohne Abschneiden der Hauptnavigation bei 768, 1024 und 1280 px.
- Textkontrast mindestens **4,5:1** (inkl. gedämpftem Metatext und Überfällig-Datum), Nicht-Text-Indikatoren mindestens **3:1** — im hellen **und** dunklen Modus, gegen den tatsächlichen Hintergrund (Abschnitt 8).

---

## 14. Einstiege

| Oberfläche | Einstieg | Festlegung |
|---|---|---|
| Desktop | **vierter primärer Navigationseintrag „Arbeitskorb"** in `layout/Header.tsx`, Reihenfolge: Startseite · **Arbeitskorb** · Kunden · Vorgänge; aktiv auf `/arbeitskorb` | ergänzt [`06`](06-decision-log.md) RC3 Punkt 1 für Desktop (Begründung im Alpha-UI-2-Eintrag) |
| Mobil | **sichtbarer Eintrag „Arbeitskorb" oben auf der angemeldeten mobilen Startseite**, über dem Hotboard, als volle Zeile (≥ 44 px) | erscheint im regulären Startzustand (auch wenn dort ein Bereichsfehler angezeigt wird); nicht im Lade- und nicht im Onboarding-Schritt |
| Mobil, untere Navigation | **unverändert sechs Einträge** — **kein** siebter Eintrag; „Aufgaben" bleibt unverändert; auf `/arbeitskorb` ist kein Eintrag als aktiv markiert | |
| Startseite / Hotboard | unverändert; `/` wird **nicht** ersetzt | Gate G-10 |

---

## 15. Ausschlüsse (Alpha UI 2)

Ausdrücklich **nicht** Teil dieser Welle:

- jede Work-Mutation: erledigen, beanspruchen (claim), zuweisen, umverteilen, zurückstellen, abbrechen, löschen, Inline-Bearbeitung, Titelreparatur, Work anlegen (auch kein „Aufgabe anlegen"-Knopf im Arbeitskorb)
- `allowed_actions`, Rekonstruktion von Task-Details, Vorgang-Ableitung, Vorgang-Links
- neue Work-Persistenz, DB-Änderungen, Migrationen, RLS, Grants, `service_role`-Zugriff, neue Berechtigungen
- MCP, KI-Zusammenfassungen, KI-Priorisierung, E-Mail, Kalender
- Schalter für erledigt/alle, Auswahl einzelner Mitarbeiter in Team, Filter, Sortierung, Suche
- clientseitiger Prioritäts-Score, clientseitige Fälligkeitsberechnung, relative Fristangaben, Uhrzeiten
- Zahlen in der Sichtwahl, Gesamtzahlen durch Laden aller Seiten, Diagramme, KPI-Kacheln, Benachrichtigungen/Badges außerhalb des Arbeitskorbs
- Ablösung von Hotboard, mobiler „Aufgaben"-Fläche oder Startseite; siebter mobiler Navigationseintrag
- Erweiterung der mobilen Kundenakte um Aufgaben; Umbau von `MobileBackButton`
- Aufräumen der Legacy-Aufgabenflächen (Abschnitt 16)
- Demo-/FakeRest-Nachbildung der Work-Query
- neue Abhängigkeiten (Paketmanifeste bleiben unverändert)

---

## 16. Koexistenz mit Legacy-Aufgabenflächen

Hotboard (`HotboardOpenTasks`), die mobile „Aufgaben"-Fläche und die Aufgabenlisten auf Kunden-/Kontaktakten berechnen Fälligkeit **clientseitig**: eine undatierte Aufgabe gilt dort als „Überfällig" (`new Date(null)` = 1970), die Gruppierung folgt der Browser-Zeitzone, und mobile Aufgabenzeilen zeigen bedeutungslose gespeicherte Uhrzeiten. **Das ändert diesen Contract nicht:** der Arbeitskorb nutzt ausschließlich autoritative Work-Flags. Ein Benutzer kann deshalb im Arbeitskorb „Ohne Fälligkeit" sehen und auf der Zielakte „Überfällig". Alpha repariert die Legacy-Flächen **nicht**; die Abweichung ist als Koexistenzrisiko und Folgearbeit in [`17`](17-known-issues-and-planned-waves.md) G.7 geführt. Sie ist **kein Release-Blocker**, weil sie vorbesteht, keine Work-Wahrheit verfälscht und nur undatierte Aufgaben bzw. Geräte außerhalb von `Europe/Berlin` betrifft.

---

## 17. Akzeptanzkriterien (Implementierung)

Jedes Kriterium ist objektiv prüfbar. Ebenen: **S** statisch (Quelltext-/Import-Prüfung im Test oder Review-Skript), **U** Unit, **C** Komponente (Vitest Browser), **I** Integration (echter Admin-/Query-Kontext, gestubbter Leser), **E** E2E (Playwright gegen die isolierte lokale Supabase, [`21`](21-agent-runbooks.md) Sektion 16), **CI** Pipeline, **Release** Release-Protokoll. Die Fläche liegt im neuen Verzeichnis `src/components/atomic-crm/work/` (heute nicht vorhanden); statische Prüfungen beziehen sich darauf plus die geänderten Einstiegsdateien aus Abschnitt 19.

**Stilabhängige Kriterien** (Bewegung, Kontrast, Maße in px) werden **nur auf Ebene E** geprüft: die Vitest-Browser-Umgebung kompiliert `index.css` ohne Tailwind ([`02`](02-design-system.md)), eine Komponentenprüfung dieser Punkte liefe leer. **Accessibility wird ohne neue Abhängigkeit geprüft** — kein `axe-core`; stattdessen die expliziten Rollen-, Struktur- und Kontrastzusicherungen unten und das manuelle Audit RG-2. Wo ein Test eine Bedingung der Umgebung voraussetzt (Zeitzone, reduzierte Bewegung, Offline), weist er zuerst nach, dass sie tatsächlich wirkt.

| # | Kriterium | Ebene |
|---|---|---|
| AC-01 | Die Fläche liest Work **nur** über `getWorkItems`: in `work/**` kein `get_work_items`, kein `p_scope`, kein `rpc(`, **kein Ressourcenname `"tasks"`** (das Pfad-Suffix `/tasks` des Kunden-Reiters ist erlaubt), kein Member-Aufruf `.getWorkItems(` (erlaubt ist nur die importierte Application-Funktion), kein Import von `tasksPredicate`, `NoraUrgencyBadge`, `getFollowUpStatus`. `dueAt` wird außerhalb von `formatWorkDueDate` nur mit `=== null`/`!== null` gelesen (kein `new Date(dueAt)`, kein `Date.parse`). Die Identität wird nur an den Baustein übergeben, der den Query-Schlüssel bildet | S, I |
| AC-02 | Jeder Aufruf erhält exakt `{ scope, stateScope: "open", pageSize: 50, cursor }`; nie ein Akteur-/`sales`-Feld; die Identität erscheint nur im Query-Schlüssel | I |
| AC-03 | Bei jeder Fixture (inkl. nicht zusammenhängender Gruppenfolge über eine Seitengrenze) gilt `renderedWorkIds === flatten(pages).map(workId)`; eine wiederkehrende Gruppe erzeugt eine zweite Überschrift statt Umordnung | U, C |
| AC-04 | Gruppen folgen nur `derived.overdue`, `derived.dueToday`, `dueAt === null`: Fixture mit `overdue = true` und „zukünftigem" `dueAt` → „Überfällig"; `overdue = false`/`dueToday = false` mit vergangenem `dueAt` → „Demnächst"; Ergebnis unverändert bei verstellter Browser-Uhr | U, C |
| AC-05 | `?sicht=team` → `scope = team`; fehlend → `mine`; `?sicht=xyz` und doppeltes `sicht` → `mine` mit Normalisierung per replace; Tab-Wechsel und „Team ansehen" per replace (History-Länge unverändert), „Team ansehen" ist ein `button` und fokussiert danach den Tab „Team"; Reload und „Zurück" aus einer Akte stellen die Sicht wieder her; kein Cursor/Akteur/Zustand in der URL; nichts davon in Browser-Storage | C, E |
| AC-06 | Es existiert keine Bedienung für erledigt/alle; jede Anfrage trägt `stateScope = "open"` | S, I |
| AC-07 | Der Cursor wird unverändert durchgereicht (Identitätsvergleich der Zeichenkette), Seite 1 mit `null`, Ende genau bei `nextCursor === null`, kein Offset; Doppelklick auf „Weitere laden" löst genau eine Anfrage aus; während einer laufenden Revalidierung ist „Weitere laden" `aria-disabled` und löst keine Anfrage aus | I |
| AC-08 | Eine `incomplete`-Zeile erscheint mit „Ohne Bezeichnung" + „Unvollständig" an ihrer Server-Position, mit funktionierenden Kontext-Links; das DTO behält `title === null` | C |
| AC-09 | Für **jeden** `WorkQueryError.reason` erscheint beim Erstladen der zugehörige Zustand aus Abschnitt 11 und **nie** der Leerzustand; Demo-Modus zeigt den Demo-Zustand; eine nicht auflösbare Identität zeigt den allgemeinen Ladefehler; bei einer Revalidierung **oder** einem Nachladen mit `permission_denied` verschwindet der Schnappschuss zugunsten von „Zugriff verweigert", ein anschließender Sichtwechsel zeigt keine zwischengespeicherten Zeilen der anderen Sicht, die Ablehnung löst genau eine Ansage und keine zusätzliche Anfrage aus, nach Ablehnung in Sicht A → Wechsel nach B → Rückkehr nach A innerhalb von 5 Minuten erscheint vor einer **erfolgreichen** Antwort keine Zeile aus A — auch nicht während der laufenden Revalidierung (dort Erstladezustand); nach Ablehnung → später gescheiterter Abfrage mit `reason = failed` erscheint keine Zeile von vor der Ablehnung, sondern der Erstladefehler-Zustand; ein bei der Ablehnung offenes mobiles Blatt schließt sich, der Fokus geht auf das aktive `tabpanel`; bei jedem anderen `reason` bleibt er mit Veraltet-Status | C, I |
| AC-10 | Scheitert die Namensanreicherung, bleiben alle Work-Zeilen, Ordnung und Links unverändert; es erscheinen die Fallback-Texte und ein Hinweis; die Work-Query ist im Erfolgszustand. Kein Lookup für `null`-IDs; ID `0` wird gelesen; die Zahl der Lookup-Anfragen hängt nicht von der Zeilenzahl ab; `meta.columns` sind exakt wie in Abschnitt 7; ausstehend, Fehler und fehlender Datensatz ergeben die drei verschiedenen Texte aus Abschnitt 7. **E:** unter der echten Mitarbeiter-Sitzung der isolierten Umgebung erscheinen die Kunden- und Kontaktnamen der gesäten Aufgaben | C, I, E |
| AC-11 | **U:** Grammatik (Abschnitt 3.1), `unreadable` für `infinity`, `-infinity`, fünfstellige Jahre, `BC`, Leerzeichen-Form, leeren String, Unsinn — ohne Ausnahme; keine Uhrzeit in der Ausgabe. **E:** dieselben `dueAt`-Werte ergeben in Playwright-Kontexten mit `timezoneId` `Europe/Berlin`, `UTC`, `America/New_York` und `Pacific/Kiritimati` **identische** Ausgaben — inkl. 02:00-Berlin-Werten, UTC-Datum ≠ Berlin-Datum, Mikrosekunden, beiden Sommerzeitwechseln und dem Jahreswechsel; jeder Kontext weist zuerst `Intl.DateTimeFormat().resolvedOptions().timeZone` = Sollzone nach, sonst schlägt der Test fehl (nicht `commands.setTimezone`, [`17`](17-known-issues-and-planned-waves.md) I.11) | U, E |
| AC-12 | Keine Work-Zeile zeigt eine Uhrzeit: Fixtures mit Titeln **ohne** Uhrzeiten; geprüft werden Datums-, Meta- und Halterbereiche (nicht der Titel und nicht die Statuszeile) auf `\d{1,2}:\d{2}` | C, E |
| AC-13 | Desktop: Kundenlink `href` endet auf `#/kunden/<id>/show/tasks`, Kontaktlink auf `#/kontakte/<id>/show`; nur für `!= null` (inkl. `0`); jeder Link hat `aria-describedby` auf den Zeilentitel; die Zeile hat keinen Klick-Handler; Klick auf den Kundenlink zeigt den Aufgaben-Reiter | C, E |
| AC-14 | Mobil: Tippen öffnet das Blatt ohne eingebauten Schließen-Knopf, mit eigenem Knopf „Schließen"; „Kontakt öffnen" führt zu `#/kontakte/<id>/show`, „Kundenakte öffnen" zu `#/kunden/<id>/show`; ohne Kontakt erscheint der Hinweis aus Abschnitt 9; keine Beschriftung enthält „Aufgabe öffnen", „Aufgabe bearbeiten" oder „Weiter zur Aufgabe"; das Blatt löst keine Work-Anfrage aus; nach einer Revalidierung zeigt das offene Blatt die geänderten Flags der aktuellen Zeile bzw. bei entfallener Zeile den Hinweis aus Abschnitt 9 | C, E |
| AC-15 | Nach Navigation in eine Akte und Rückkehr innerhalb von 5 Minuten stellt Browser-„Zurück" `#/arbeitskorb?sicht=…` und die Scrollposition (`window.scrollY`) wieder her (Desktop- und Mobil-Projekt) | E |
| AC-16 | Installierte PWA: RG-1 ist für mindestens ein iOS- und ein Android-Gerät als bestanden protokolliert, **bevor** der Release-PR gemergt wird; bis dahin gilt der Release als nicht freigegeben | Release |
| AC-17 | Query-Optionen sind exakt Abschnitt 5.3 (`staleTime` 30 000, `refetchOnMount: "always"`, Fokus/Reconnect `true`, `networkMode: "online"`, `retry: false`, `gcTime` 300 000, kein `refetchInterval`); Rückkehr auf die Seite löst eine Revalidierung aus; eine Revalidierung mit mehreren geladenen Seiten beginnt bei Seite 1 mit Cursor `null` und nutzt nur frische Cursor; schlägt sie fehl, bleibt der alte Schnappschuss mit Veraltet-Status sichtbar — außer bei `permission_denied` (dann AC-09); mit gefälschter Uhr invalidiert der Berliner Tageswechsel genau einmal (Timer 2 Minuten nach Mitternacht oder Fokus), ohne eine Zeile zu bewerten, und die Statuszeile trägt das Datum, solange der Schnappschuss von einem anderen Berliner Tag stammt | U, I |
| AC-18 | Nach Abmeldung und erneuter Anmeldung mit einer anderen Identität (gestubbter Auth-Provider im echten Admin-Kontext, Desktop- und Mobil-Admin) erscheint vor der neuen Antwort **keine** Zeile der vorherigen Identität; der Query-Schlüssel enthält die Identitäts-Partition. (E2E ohne zweiten Mitarbeiter, weil das Identitäts-Gate der E2E-Umgebung genau einen Mitarbeiter verlangt, [`21`](21-agent-runbooks.md) Sektion 16; die Prüfung mit zwei echten Konten ist RG-7) | I |
| AC-19 | Nur Tastatur: Tab-Reihenfolge exakt wie Abschnitt 13.4; alle Links erreichbar; Sichtwechsel per Pfeiltasten; „Weitere laden" und Aktualisieren bedienbar; mobiles Blatt per Tastatur öffnen/schließen (Escape und „Schließen") | C, E |
| AC-20 | Fokusregeln aus Abschnitt 13.4: Wegfall der fokussierten Zeile → definierter Nachbar bzw. `tabpanel`; nach „Weitere laden" erste neue Zeile, bei Fehlschlag bleibt der Fokus auf dem Knopf, bei `permission_denied` geht er auf das aktive `tabpanel`; nach erfolgreichem Wiederholen und verschwundenem Hinweis-Knopf → `tabpanel`; „Team ansehen" → Tab „Team"; Schließen des Blatts → Zeilen-Knopf bzw. Nachbar | C |
| AC-21 | Struktur: ein `main`; genau ein `h1` „Arbeitskorb" (Desktop innerhalb `main`, Mobil im `MobileHeader`); `h2` je Gruppe; `<ol>` je Gruppe; `tablist`/`tab`/`tabpanel` mit korrekten `aria-controls`/`aria-selected`; keine verschachtelten interaktiven Elemente; Icons `aria-hidden`; Zeilentext enthält Gruppenbezeichnung + Langdatum | C, E |
| AC-22 | Mit `prefers-reduced-motion: reduce` (Wirkung zuerst per `matchMedia` nachgewiesen) hat kein Element der Fläche — einschließlich Skelett, Blatt und Overlay — eine laufende Animation (`document.getAnimations()`, gefiltert auf Ziele innerhalb des `main` der Fläche und des Blatt-Portals, ist leer — gemessen nach abgeschlossenem Laden, nach Öffnen/Schließen des Blatts und nach Sichtwechsel; der vorbestehende App-Kopf, z. B. dessen Aktualisieren-Symbol, zählt nicht zur Fläche) und keine Transition mit Dauer > 0; die Ansagen erscheinen trotzdem | E |
| AC-23 | Gemessen bei 375 px Breite: Zeilen-Knopf, Tabs, Aktualisieren, „Weitere laden", „Team ansehen" und der Startseiten-Einstieg ≥ 44 px; Blatt-Aktionen und „Schließen" ≥ 48 px | E |
| AC-24 | Kein horizontales Überlaufen bei 320, 375 und 390 px (`documentElement.scrollWidth <= clientWidth`); Desktop-Hauptnavigation mit vier Einträgen ohne Abschneiden/Umbruch bei 768, 1024, 1280 px | E |
| AC-25 | Kontrast aus berechneten Farben (`getComputedStyle`, eigene WCAG-Formel im Test, keine Abhängigkeit; `oklch`/`oklab`-Werte werden über eine 1×1-Canvas in sRGB umgerechnet, durchscheinende Hintergründe mit ihren Vorfahren bis zu einem deckenden Grund verrechnet) gegen den tatsächlichen Hintergrund, hell und dunkel, auch im Hover: Überfällig-Datum, Metatext, Halter, Statuszeile ≥ 4,5:1; Überfällig-Linie und -Icon ≥ 3:1; Töne entsprechen der Tabelle in Abschnitt 8 | E |
| AC-26 | `package.json`/`package-lock.json` unverändert; keine neue Bibliothek (auch keine Test-Bibliothek) | S |
| AC-27 | Kein Diff unter `supabase/**`, `src/**/application/queries/**` und `src/**/providers/**` — **ausgenommen** additive Schlüssel in den Übersetzungskatalogen `providers/commons/*CrmMessages.ts` ([`04`](04-routing-i18n.md) „i18n-Regeln"); keine Migration, Policy, Grant | S |
| AC-28 | Hotboard, mobile „Aufgaben"-Fläche, `MobileBackButton`, `MobileHeader`, `MobileContent`, `ui/sheet.tsx`, Kunden-/Kontaktakten und die sechs mobilen Navigationseinträge sind unverändert; ihre bestehenden Tests laufen unverändert grün | S, C, E |
| AC-29 | Die Arbeitskorb-Seiten werden **routenweise lazy geladen**; der Entry-Chunk wächst gegenüber dem Basis-`main`-Build um höchstens **5 kB** (beide mit `scripts/check-bundle-budget.mjs` gemessen, Werte im PR festgehalten), und beide Budgets (Entry 1 050 kB, gesamt 2 600 kB) bestehen | CI |
| AC-30 | `npm run typecheck`, `npm run build`, die betroffenen Vitest-Suiten, ESLint/Prettier und `e2e/arbeitskorb.spec.ts` (Desktop- und Mobil-Projekt) laufen grün in der Gesamt-CI | CI |
| AC-31 | Halter mit **widersprüchlichen** Fixtures: `isMine = false` bei `holder.salesId` = eigene Identität → kein „Ich"; `isMine = true` bei fremder `salesId` → „Ich"; `isUnassigned = true` mit gesetztem Halter → „Nicht zugewiesen"; `holder = null` ohne Flag → „Zuständigkeit unbekannt"; `displayName = null` → „Mitarbeiter ohne Namen"; in „Meine Arbeit" kein Halter | C |
| AC-32 | Zahlen aus Flags: Fixtures, in denen Flags und `dueAt` (bei gefälschter Uhr) widersprechen, ergeben Zusammenfassung und Ansage nach den Flags; unvollständige Menge → „… geladen · weitere vorhanden" ohne Gesamtzahl; `n = 1` und Teile mit 0 nach Abschnitt 6.6/13.5; 0 Zeilen → weder Zusammenfassung noch Listenende | C |
| AC-33 | `overdue = true` und `dueToday = true` → Zeile unter „Überfällig" mit dem Text „heute fällig" | C |
| AC-34 | Zustände ohne eigene Prüfung oben: Offline ohne und mit Daten (C/I: `onlineManager.setOnline(false)`; E: Playwright `context.setOffline(true)`), „Wird aktualisiert …", „Weitere laden" fehlgeschlagen (Zeilen bleiben, Inline-Text, Knopf wiederholt), beide Leerzustandstexte, „Erneut fehlgeschlagen · …" — jeweils mit den Texten aus Abschnitt 11 | C, I, E |
| AC-35 | Ansagen: jeder Übergang aus Abschnitt 13.5 erzeugt genau den festgelegten Text im festgelegten Kanal (`status` bzw. `alert`); ein erneutes Scheitern wird erneut angesagt; eine automatische Revalidierung ohne Änderung erzeugt keine Ansage; eine Revalidierung, die nur Gruppenschlüssel ändert (Tageswechsel), erzeugt „Arbeitskorb aktualisiert." | C |

---

## 18. Release-Gates (erst bei Implementierung/Release beweisbar)

Diese Punkte sind beim Contract-Freeze **nicht** verifiziert und werden nicht als verifiziert behauptet. Sie sind Abnahmebedingungen, kein Grund für Unschärfe im Contract.

| # | Gate | Nachweis |
|---|---|---|
| RG-1 | **Installierte PWA, echte Geräte (iOS und Android):** Arbeitskorb → Kontakt/Kunde → zurück in den Arbeitskorb mit erhaltener Sicht | Protokoll je Gerät. Fehlt ein verlässlicher Rückweg: Release **anhalten**, begrenzter Navigationspunkt mit PO-Entscheidung — kein stiller `MobileBackButton`-Umbau |
| RG-2 | implementiertes Accessibility-Verhalten: Screenreader-Stichprobe VoiceOver/TalkBack (Ansagen aus 13.5, Blatt), Tastatur, Zoom 125 %/150 %, Kontrast-Stichprobe mit den Browser-Entwicklerwerkzeugen in hell und dunkel (kein neues Paket) | Protokoll |
| RG-3 | implementierte reduzierte Bewegung auf echtem Gerät | Protokoll |
| RG-4 | reales responsives Layout inkl. Abstand über der unteren Navigation (iOS-Standalone, Android-Gestenbereich) | Screenshots |
| RG-5 | tatsächliche Bundle-Größe | CI-Ausgabe `check-bundle-budget` (AC-29) |
| RG-6 | finale E2E-Flüsse grün | CI-Lauf (AC-30) |
| RG-7 | implementierte Sitzungs-/Cache-Isolation mit zwei **echten** Mitarbeiterkonten (in E2E nicht möglich, AC-18) | AC-18 grün + manuelle Prüfung: Abmelden, mit zweitem Konto anmelden, keine fremde Zeile sichtbar — Desktop und Mobil |
| RG-8 | **Production-Smoke nach dem Release** mit echter Mitarbeiter-Sitzung: beide Sichten, ein Kontext-Link je Oberfläche, Rückweg; Build-Identität nach [`21`](21-agent-runbooks.md) Sektion 14 | Release-Evidenz in `releases/` |

---

## 19. Umsetzungsschnitte

| Schnitt | Inhalt | erwartete Dateigrenzen |
|---|---|---|
| **D1 — Query Seam** | `useWorkItems` (Abschnitt 5), Query-Schlüssel, Freshness- und Tageswechsel-Mechanik, Sicht-Parsing aus der URL | neu unter `src/components/atomic-crm/work/` (Hook, Schlüssel, Sicht-Parser, Tests) |
| **D2 — Presentation** | `formatWorkDueDate`, `toWorkRowView`, Gruppierung mit Invariante, Kontext-Anreicherung, Zeilen-, Listen-, Zustands- und Blatt-Komponenten | neu unter `work/`; nutzt `ui/sheet.tsx` (mit `showClose={false}`), `ui/tabs.tsx`, `ui/button.tsx`, Nora-Utilities unverändert; eng begrenzte Ergänzung in `src/index.css` (nur bestehende Tokens; Reduced-Motion-Regeln aus Abschnitt 12) |
| **D3 — Desktop/Mobil-Integration** | Pfadkonstante, Desktop- und Mobil-Seitenhülle (lazy), Registrierung in beiden `CustomRoutes`, Desktop-Navigationseintrag, mobiler Start-Einstieg | `work/*Page*.tsx`, `root/CRM.tsx`, `layout/Header.tsx`, `dashboard/MobileDashboard.tsx`; additive Schlüssel in `providers/commons/germanCrmMessages.ts` (und, soweit die Typen es verlangen, `englishCrmMessages.ts` / `frenchCrmMessages.ts`) nach [`04`](04-routing-i18n.md) „i18n-Regeln" |
| **D4 — E2E / Hardening** | `e2e/arbeitskorb.spec.ts` (Desktop + Mobil), Zeitzonen-Kontexte, isolierte Fixtures für unvollständige/undatierte/gleichfällige Zeilen (über die vorhandenen E2E-Helfer, **ohne** zusätzlichen Mitarbeiter — das Identitäts-Gate verlangt genau einen, [`21`](21-agent-runbooks.md) Sektion 16), Überlauf-, Touch-, Kontrast- und Reduced-Motion-Messungen | `e2e/**`, isolierte Testdaten |
| **D5 — Release** | Gesamt-CI, Bundle-Messung, unabhängige Review, PO-Abnahme, Merge, Production-Smoke, Doku-Nachzug (`16`, `20`, `02`/`04`-Ist-Zustand, `17` G.7, Archiv) | `docs/nora/**` |

**Bleibt unverändert:** `application/queries/**`, `providers/**` (außer den additiven Katalogschlüsseln), `supabase/**`, Paketmanifeste, `vitest.config.ts`, `MobileBackButton`, `MobileHeader`, `MobileContent`, `ui/sheet.tsx`, Hotboard, `MobileTasksList`, `tasksPredicate.ts`, Kunden-/Kontaktakten, das E2E-Identitäts-Gate. Keine dieser Dateien ist eine verdeckte Voraussetzung.

---

## 20. Offene Entscheidungen

**Keine Implementierungsblocker.** Bewusst nach Alpha verschoben (je eigene PO-Entscheidung):

- Ablösung von Startseite/Hotboard/mobiler „Aufgaben"-Fläche durch den Arbeitskorb (Gate G-10, [`25`](25-universal-work-model.md) Abschnitt 23)
- Sicht auf erledigte Arbeit (`done`/`all`) — sinnvoll erst mit Erledigen-Aktionen (G-4)
- Aufgaben auf der mobilen Kundenakte; direkt verlinkbarer Aufgaben-Reiter der mobilen Kontaktakte
- History-bewusster Zurück-Knopf auf Mobil (ausgelöst nur, falls RG-1 scheitert, oder als eigene Navigationswelle)
- Konsistenzwelle für die Legacy-Aufgabenflächen (Abschnitt 16)
- Arbeitskorb im Demo-Modus mit Daten (eigene Entscheidung, [`17`](17-known-issues-and-planned-waves.md) G.7)
- Application-Fähigkeit für Anzeigekontext (nur nach der Beförderungsregel in Abschnitt 7)

---

## 21. Pflege dieses Dokuments

- Mit Auslieferung der Implementierung wird der Kopfstatus auf den tatsächlichen Umsetzungsstand gesetzt; Live-Fakten gehen nach [`16`](16-current-state.md), Produktsicht nach [`20`](20-product-changelog.md), Evidenz nach `releases/`.
- Eine Abweichung der Implementierung von diesem Contract ist ein Befund: entweder wird die Implementierung korrigiert oder der Contract mit eigenem [`06`](06-decision-log.md)-Eintrag geändert — nie stillschweigend.

---

## 22. Zusammenführung der Arbeitsfassungen — benannte Abweichungen

Wo die Arbeitsfassungen einander oder der verifizierten Evidenz widersprachen, gilt:

| Thema | Fassung | Contract | Grund |
|---|---|---|---|
| Sichtwechsel | UX: alte Liste gedimmt stehen lassen | keine Zeilen einer anderen Sicht als Platzhalter (5.2) | technische Discovery: kein Platzhalter über Sichtgrenzen |
| `staleTime` | Tech/Synthese: 0 · UX: 60 s Fokus-Schwelle | **30 s** + `refetchOnMount: "always"` | Evidence Verification T-5 |
| Retry | Tech: begrenzt für `failed` | **kein** automatischer Retry | [`23`](23-operations-errors-feedback.md) §5.4, [`06`](06-decision-log.md) Alpha Work 2 |
| Zeilen-Ein-/Ausblend-Choreografie | UX M5/M6 | ausgeschlossen (12) | keine Listen-Exit-Steuerung vorhanden; keine spekulative Mechanik |
| Mobile Kundenaktion | UX: „Kunde öffnen" gleichrangig | „Kontakt öffnen" bevorzugt, „Kundenakte öffnen" informativ, Hinweis ohne Kontakt (9) | T-2: mobile Kundenakte zeigt keine Aufgaben |
| Desktop-Kundenziel | `/kunden/:id/show` | `/kunden/:id/show/tasks` | T-2: Reiter direkt verlinkbar |
| Laufzeit-URL | `/arbeitskorb?sicht=…` | `/#/arbeitskorb?sicht=…` | T-3: HashRouter |
| Jahr im Datum | UX: nur bei abweichendem Jahr | immer | keine Abhängigkeit von der Geräteuhr |
| Tagesdatum im Kopf | UX: ja | nein | keine zweite, uhrabhängige „Heute"-Aussage neben der Server-Gruppe |
| Gruppenzahlen | UX: in `h2` bei vollständiger Liste | keine; nur Zusammenfassungszeile | wiederholte Überschriften würden Teilzahlen zeigen |
| Titelkürzung Desktop / „Warum?" | UX: Kürzung + „Mehr", Erklärungs-Aufklappung | Desktop ungekürzt, mobil 3 Zeilen + Blatt; keine Aufklappungen | weniger interaktive Elemente pro Zeile |
| Einstieg | Synthese: Start-Einstieg auf beiden Oberflächen | Desktop: Kopfnavigation; Mobil: Start-Einstieg (14) | T-6 |
| Leerer Name | Synthese: „Kunde öffnen" | „Kunde" / „(Name nicht geladen)" / „(Name nicht verfügbar)" (7) | unterscheidet ausstehend, Fehler und fehlenden Datensatz |
| „Team ansehen" | UX: Link | Knopf mit replace und Fokus auf den Tab (10) | Sichtwechsel einheitlich per replace |
| Fokus nach „Zurück" | UX: zurück auf den zuletzt benutzten Link | nicht in Alpha; Scrollposition ja (10) | die Seite wird beim Zurückkehren neu montiert und revalidiert; eine verlässliche Wiederherstellung wäre eigene Mechanik |
| Mobile Sichtwahl | UX: klebend unter dem Header | scrollt mit (9) | `MobileContent` ist ein eigener Scroll-Container; `position: sticky` greift dort nicht, und die gemeinsame Hülle wird nicht umgebaut |
| Accessibility-Prüfung | UX: „axe: keine Verstöße" | explizite Rollen-/Struktur-/Kontrastzusicherungen + manuelles Audit (17, RG-2) | keine neue Abhängigkeit |
| Mobiles `h1` | UX: im Kopf | im `MobileHeader`, außerhalb von `main` (13.1) | Nora-Hausmuster für mobile Seiten |
