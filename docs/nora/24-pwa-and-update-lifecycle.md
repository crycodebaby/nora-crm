# 24 – PWA und Update-Lifecycle (Technical Contract)

Stand: 2026-09-11 · Status: **CURRENT** · Load-Klasse: **CONDITIONAL CURRENT CONTRACT** — **sektionsweise laden** (§0–§9), nie als ganze Datei.

Dies ist der **technische Contract für Noras PWA-Schicht**: Service-Worker-Registrierung, Update-Lifecycle, Update-Erkennung, Aktivierung und Reload, Precache-Grenze, Offline-Grenze, Installability-Grenze und das Verhalten mehrerer offener Tabs.

Hier steht, **was technisch wahr sein muss**. Wie eine Änderung durchzuführen, zu smoke-testen und nachzuweisen ist, steht in [`21`](21-agent-runbooks.md) Sektion 14. Warum diese Architektur gewählt wurde, steht in [`06`](06-decision-log.md). Was der Benutzer sieht, steht in [`02`](02-design-system.md). Dieses Dokument führt bewusst **keine** Routingtabelle — der einzige kanonische Router ist [`README.md`](README.md).

Vor CR5 lagen diese Regeln verstreut in [`06`](06-decision-log.md) (als „Durable Regeln" im Rationale-Dokument), in [`21`](21-agent-runbooks.md) §14 (als `Interim-Contract` im Runbook), in [`02`](02-design-system.md) (als technische Nebensätze in der Präsentation) und in [`17`](17-known-issues-and-planned-waves.md) E (als akzeptierte Limitationen in der Open-State-Liste). Seit CR5 gilt: **`24` = was technisch wahr sein muss, `21` §14 = wie man es verifiziert.**

---

## 0. Scope und Ownership-Abgrenzung

| Dokument | Zuständig für |
|---|---|
| **`24` (dieses)** | Service-Worker-Registrierung · Update-Lifecycle und technische Zustände/Invarianten · Update-Erkennung und Prüfkadenz · Aktivierung, Reload-Ownership und Abschluss-Handoff · Cache-/Precache-Grenze · Offline-Grenze · Installability-Grenze · Multi-Tab- und Stale-Client-Verhalten |
| [`02`](02-design-system.md) | **Präsentation**: sichtbare Zustände, Copy, Komposition, Orb/Ring, Choreografie, Motion, Reduced Motion, A11y, Kontrast, Tokens, Dev-Werkzeug |
| [`21`](21-agent-runbooks.md) §14 | **Verifikation**: Live-Smoke nach Deployment, Build-/Release-Identität, Testmethodik (frisches Profil, `unregister()`), Asset-Hash-/DOM-Prüfung, Lesen des ausgelieferten Bibliothekscodes |
| [`06`](06-decision-log.md) | **Rationale**: warum Prompt-Modus statt `autoUpdate`, warum ein Update kein Fehlerbild sein darf, warum ein Reload nie ungefragt in ein Formular fallen darf, historische Herkunft |
| [`17`](17-known-issues-and-planned-waves.md) E | **noch nicht wahr**: offene Produkt- und Verifikationspunkte der PWA-Fläche |
| [`releases/`](releases/README.md) | historische Evidenz: Messwerte, RC-SHAs, Reproduktionen, Release-Beweise |

**Cross-Owner [`22`](22-security-and-access.md):** ausschließlich dort, wo Cache- oder Browser-Storage-Grenzen eine Security-/Privacy-Bedeutung bekommen — siehe §5 und §6. `24` dupliziert keine Security-Regel.

`24` besitzt **nicht**: die eingebettete Commit-SHA als Build-Identität (→ [`21`](21-agent-runbooks.md) §14), den Operations-/Fehler-Contract (→ [`23`](23-operations-errors-feedback.md)), die React-Query-Persistenz außerhalb der PWA-Schicht (→ §6).

---

## 1. Registrierung und Architekturgrenze

**Durable invariants.**

- **Genau eine PWA-Registrierungsgrenze.** Das virtuelle Modul `virtual:pwa-register` wird an **einer** Stelle geladen: `pwa/pwaRegistration.ts` exportiert daraus `noraRegisterSW`. Keine zweite Importstelle, kein Import aus einer Komponente.
- **`main` startet den Store, nicht der Baum.** `src/main.tsx` ruft `pwaUpdateStore.start(noraRegisterSW)` beim App-Start auf. Der Service Worker gehört zum Fenster, nicht zur angemeldeten Sitzung: eine Registrierung weiter unten im Komponentenbaum würde die Login-Seite und abgemeldete Benutzer auslassen.
- **Der Store bleibt framework- und UI-frei.** `pwaUpdateStore.ts` kennt kein React, keine sichtbaren Texte und keine Präsentation; dadurch bleibt der Lifecycle ohne Build-Setup testbar.
- **Die UI konsumiert den PWA-Zustand ausschließlich über `usePwaUpdate()`.** Präsentationskomponenten fassen `navigator.serviceWorker`, Workbox oder die `ServiceWorkerRegistration` **nie** direkt an.
- **E2E-Builds laufen ohne Service Worker** (`disable: mode === "e2e"`). Ein E2E-Lauf beweist deshalb nichts über PWA-Verhalten.
- **Ein PWA-Update ist keine Business-Operation.** Es bekommt **kein `operationId`**, **keinen Idempotency-Key**, **keinen Eintrag im OperationManager** und **keinen Eintrag im Notification-/Operation-Store**. Der vollständige Operations-Contract steht in [`23`](23-operations-errors-feedback.md) und wird hier nicht wiederholt — `24` benennt nur die Grenze: der Update-Lifecycle liegt vollständig außerhalb davon.

---

## 2. Update-Lifecycle und State Contract

**Durable invariants.**

- **`registerType: "prompt"`.** Ein neu installierter Service Worker bleibt **WAITING**, solange ein kontrolliertes Dokument den alten Worker benutzt. Kein `skipWaiting` beim Install, **kein `clients.claim()`**. Erst eine bewusst ausgelöste Aktualisierung sendet SKIP_WAITING.
- **Der Browser ist die Wahrheit.** Der Store liest an **jedem** Entscheidungspunkt die Browser-Fakten selbst (`syncFacts()`: Controller, wartender Worker, installierender Worker, aktiver Worker). Kein Polling — Resynchronisationspunkte sind `statechange` beobachteter Worker, `controllerchange` und die Rückkehr auf den Tab.
- **`onNeedRefresh` ist ein Entdeckungssignal, kein Aktivierungserfolg.** Es sagt weder, dass ein Worker wartet, noch dass SKIP_WAITING etwas bewirken wird, noch dass dieses Dokument je ein `controllerchange` sehen wird.
- **`applying` ≠ `activated`.** `applying` heißt: die Aktivierung wurde **angefordert**. `activated` heißt: der Browser hat die Übernahme **vollzogen** (`controllerchange` auf `navigator.serviceWorker`).
- **`activated` ist monoton** innerhalb einer Dokument-Lebensdauer: einmal `true`, bleibt es bis zum Reload `true`. Kein Retry, kein Commit und kein Watchdog nimmt es zurück.
- **`reloadRequired` besitzt eine eigene Invariante:**

  ```text
  ¬failed
  ∧ ( activated
      ∨ ( entdeckt ∧ ¬waiting ∧ ¬installing
          ∧ ( ¬controlled ∨ active ≠ controller ) ) )
  ```

  Lesart: ein Update wurde entdeckt, es wartet und installiert nichts mehr — der entdeckte Worker ist also aktiv geworden — und dieses Dokument hängt nicht an ihm. In diesem Fall ist SKIP_WAITING wirkungslos und ein Reload die einzige ehrliche Aktion. Bewusst **nicht** „kein wartender Worker" allein: ohne entdecktes Update sagt das nur, dass es nichts zu tun gibt. Der führende `¬failed`-Guard gehört zur Invariante: ein positiv bewiesener Fehlschlag (abgelehnte Aktivierungsanfrage) hat Vorrang, und `reloadRequired` gilt dann **nicht** — auch nicht neben `activated`.
- **`updateServiceWorker()` resolved ≠ Aktivierungserfolg.** Das Promise aus `virtual:pwa-register` trägt keine Information über die Übernahme. Lehnt es ab, ist das der **einzige** positive Fehlerbeweis — und nur dann gilt `failed`.
- **Ein Timeout oder eine ausbleibende Aktivierung ist nie automatisch `failed`.** Beim Ablauf einer Frist werden nur die Browser-Fakten neu gelesen und eingeordnet.
- **`controllerchange` ist das belastbare Aktivierungssignal** — aber nur für einen **kontrollierten** Client. Ein unkontrolliertes Dokument sieht es per Spezifikation nie; für dieses ist `reloadRequired` die Wahrheit.
- **Nora besitzt den finalen Reload** nach erfolgreicher Übernahme (§4).

**Zustände des Stores** (technisch, nicht sichtbar): `idle` · `updateAvailable` · `applying` · `reloadRequired` · `failed`. Welches Bild die Oberfläche daraus ableitet, besitzt [`02`](02-design-system.md).

### Was ein Reload tatsächlich liefert

Die Frage „welcher Build ist nach einem Reload sichtbar?" hat **keine** universelle Antwort. Sie hängt am Controller-Zustand des Dokuments:

- **Kontrolliertes Dokument / bestehender Client.** Ist ein Vorgänger-Worker aktiv und kontrolliert dieses Dokument, kann ein gewöhnlicher Reload im Prompt-Modus weiterhin den **vom aktiven Worker kontrollierten Vorgänger-Build** liefern. Der neue Worker bleibt WAITING, bis das Update bewusst ausgelöst wird. Das ist gewollt: der Precache des laufenden Builds bleibt konsistent.
- **Unkontrolliertes Dokument.** Bei Erstbesuch, Hard Reload oder gelöschten Site-Daten kann dieses Dokument ohne kontrollierenden Worker starten. Das ist eine Aussage über **dieses** Dokument, nicht über die Registrierung: benutzt kein anderer Client mehr den bisherigen Worker, kann der neue Worker sich **selbst aktivieren**; sind dagegen noch andere Nora-Tabs kontrolliert, kann er weiterhin WAITING bleiben (§8). Hier darf **nicht** behauptet werden, ein Reload liefere zwingend den Vorgänger-Build. Genau für diese Abweichung existiert `reloadRequired`.

**Die belastbare Regel:** ein Reload allein garantiert nicht allgemein, welcher Build anschließend sichtbar ist — der Browser- und Controller-Zustand entscheidet. Daraus folgt die Verifikationsregel in [`21`](21-agent-runbooks.md) §14: ein Reload ist kein belastbarer PWA-Live-Smoke.

---

## 3. Update-Erkennung und Prüfkadenz

**Durable invariant.** Nora bleibt als Arbeitsanwendung lange geöffnet. Der Browser prüft von sich aus nur bei Navigationen auf einen neuen Worker — ohne eigene Prüfung würde ein Deployment in einem tagelang offenen Tab nie ankommen. Nora prüft deshalb selbst: ein periodischer Intervall-Check plus eine gedrosselte Prüfung bei `visibilitychange` (Rückkehr auf den Tab). Beim Zurückkehren werden **erst** die Fakten neu gelesen (ein anderer Tab kann inzwischen aktiviert haben), **dann** wird nach Neuem gesucht.

**Current technical parameters** (Contract, aber bewusst änderbar — siehe §9):

| Parameter | Wert | Konstante |
|---|---|---|
| regelmäßiger Update-Check | 60 min | `UPDATE_CHECK_INTERVAL_MS` |
| Mindestabstand zwischen zwei Prüfungen (egal wodurch ausgelöst) | 30 min | `UPDATE_CHECK_MIN_INTERVAL_MS` |

**Offline-Guard.** Ein Check unterbleibt, solange `navigator.onLine` falsch ist: offline liefert `registration.update()` keinen sinnvollen Befund und darf vor allem keinen falschen „neue Version"-Hinweis erzeugen.

**Ein fehlgeschlagener Update- oder Registrierungscheck ist kein Business-/Operation-Error.** Die laufende Version bleibt gültig; der nächste Versuch folgt ohnehin. Es entsteht daraus kein Fehlerzustand, keine Fehlermeldung und kein Eintrag in einer Fehlerarchitektur.

---

## 4. Aktivierung, Reload und Abschluss

**Durable invariants.**

- **SKIP_WAITING fällt nur bei bewusster Update-Anwendung.** `applyUpdate()` liest zuerst die Fakten neu und sendet die Anfrage **genau dann**, wenn ein Worker wartet. Bereits übernommen → keine Anfrage (`activated`); nichts wartet bzw. Dokument unkontrolliert → keine Anfrage (`reloadRequired`); sonst kein Effekt (`noop`). Höchstens **eine** Anfrage pro Versuch.
- **Der Watchdog beginnt beim eigentlichen Auslösen** — nach `applyUpdate()`, nie am Anfang einer vorgelagerten Inszenierung. Beim Ablauf werden die Fakten neu gelesen und eingeordnet (`activated` / `reloadRequired` / `waiting` / `failed` / `nothing`). Der Befund `waiting` beendet den laufenden Versuch kontrolliert, damit ein zweiter Versuch eine **echte** zweite Anfrage senden kann; Registrierung, Worker und Listener bleiben unangetastet.
- **Nora besitzt den Reload.** Im kontrollierten Tab lädt der Client aus `virtual:pwa-register` beim `controlling`-Ereignis in der Regel selbst neu. Für alle anderen Fälle — insbesondere das unkontrollierte Dokument, das nach eigenem SKIP_WAITING nie ein `controllerchange` sieht — lädt Nora nach einer kurzen Frist selbst neu.
- **Snooze verwirft nichts.** „Später" blendet nur den Hinweis aus; der wartende Worker bleibt erhalten, und der Hinweis darf nach Ablauf erneut erscheinen. Die Ablehnung lebt **nur im Speicher** — kein `localStorage`. Ein **neuer Fakt** (neues Update, vollzogene Übernahme) hebt sie sofort auf.
- **Completion-Handoff: das Abschluss-Signal wird einmalig über den Reload hinweg übergeben und nie bei `failed` erzeugt.** Das Dokument, das den Erfolg gesehen hat, ist nach dem Reload weg; damit die frisch geladene Version den Abschluss bestätigen kann, trägt genau ein Bit den Erfolg über den Reload. Es wird nur an den beiden Stellen gesetzt, an denen Nora die Übernahme **weiß**: beim `controllerchange` im Store und bei Noras eigenem Reload. Nie bei `failed`, nie bei einem noch offenen Versuch (der Watchdog findet den Worker weiterhin wartend — es ist nichts übernommen; Präsentationszustand `slow`), nie bei „Später", nie bei einem gewöhnlichen Reload (F5). Es wird beim ersten Lesen eines Dokuments konsumiert und danach nicht erneut ausgeliefert. Der konkrete Speichermechanismus (`sessionStorage`-Key) ist **Implementation Detail** und kein Contract; die durable Regel ist die Einmaligkeit und die Bindung an einen belegten Erfolg.
- **Das Abschluss-Signal ist kein Zustand des Update-Lifecycles.** Der State Contract aus §2 bleibt davon unberührt; das Bit ist ein reiner Übergabepunkt zwischen zwei Dokument-Lebensdauern.

**Current technical parameters:**

| Parameter | Wert | Konstante |
|---|---|---|
| Watchdog nach `applyUpdate()` | 5 s | `ACTIVATION_WATCHDOG_MS` |
| Nora-eigener Reload nach Übernahme/Reload-Befund | 1,5 s | `RELOAD_FALLBACK_MS` |
| Snooze („Später") | 2 h | `DISMISS_RESHOW_AFTER_MS` |

**Nicht hier:** die rund achtsekündige Übergangsinszenierung vor dem Commit ist **Präsentation** (lokaler State, nicht im Store) und gehört [`02`](02-design-system.md). `24` besitzt sie nicht als technischen Lifecycle-Contract.

---

## 5. Cache- und Precache-Grenze

**Current technical mechanism:** `vite-plugin-pwa` im **`generateSW`**-Modus (Workbox erzeugt den Service Worker; es gibt keinen handgeschriebenen `sw.js`).

**Effective precache classes** (aktuelle Workbox-Glob):

```text
js · css · html · ico · png · svg · woff · woff2
```

**Kein Service-Worker-Runtime-Caching.** Es ist **kein** `runtimeCaching` konfiguriert. Daraus folgt als zentrale Current Truth:

> **Der Service Worker cacht keine API-, Supabase-/PostgREST- oder Edge-Function-Antworten und damit keine Geschäftsdaten.** Der Precache enthält ausschließlich statische Build-Artefakte der oben genannten Klassen.

**Cross-Owner [`22`](22-security-and-access.md):** soll Runtime-Caching für Geschäftsdaten eingeführt werden, ist das zusätzlich ein Security-/Privacy-Change — dann ist [`22`](22-security-and-access.md) verpflichtend zu laden. Die dortigen Regeln werden hier nicht dupliziert.

**Effective current configuration** (aus den Plugin-Defaults der aktuell verwendeten Version, **nicht** in `vite.config.ts` gesetzt):

| Einstellung | Effektiver Wert |
|---|---|
| `navigateFallback` | `index.html` |
| `cleanupOutdatedCaches` | wirksam (`true`) |

Diese beiden Werte gelten **mit der aktuell verwendeten Plugin-Version und der effektiven Konfiguration** — sie sind nicht unabhängig davon garantiert. Bei einem Plugin-Upgrade oder einer Strategieänderung müssen sie **neu verifiziert** werden; wer sie braucht, setzt sie explizit.

**Current technical parameter:** maximale Dateigröße pro Precache-Eintrag **5 MiB** (`maximumFileSizeToCacheInBytes`).

### Production-Exclusion-Grenze

Die PWA-Konsequenz der Production-Build-Hygiene — der vollständige Contract liegt beim bestehenden Owner:

> Alles, was in die konfigurierten Workbox-Glob-Klassen fällt **und im Production-Build existiert**, kann in den Precache gelangen und damit an jeden Client ausgeliefert werden.

Diagnose- und Entwickler-Artefakte werden deshalb **nicht** durch symptomatische `globIgnores` in der PWA-Konfiguration geschützt, sondern sollen bereits **am Production-Build-Boundary nicht entstehen**. Die Build-Regel dazu (`ANALYZE === "true"`) bleibt bei ihrem bestehenden Owner in `vite.config.ts` und wird hier **nicht** zu einem PWA-Contract umdefiniert. Begründung und Herkunft: [`06`](06-decision-log.md), Eintrag „Visualizer Production Exclusion".

---

## 6. Offline-Grenze

**Nora ist eine PWA, aber keine Offline-Anwendung.**

**Current truth:**

- **App-Shell und precachte statische Assets** (die Klassen aus §5) können offline aus dem Service-Worker-Cache verfügbar sein.
- **Geschäftsdaten besitzen keinen Service-Worker-Offline-Contract.** Supabase-/PostgREST-/Edge-Antworten werden vom Service Worker nicht runtime-gecacht (§5).
- Es existiert **keine eigene Offline-Fallback-Seite** und **kein `offlineReady`-UI-Zustand**. Nora zeigt keinen eigenen Offline-Modus an.
- Die Update-Erkennung ist offline bewusst stillgelegt (§3).

**Ausdrückliche Abgrenzung — kein Umkehrschluss.** „Der Service Worker cacht keine Geschäftsdaten" ist **nicht** dasselbe wie „Nora speichert keine Geschäftsdaten im Browser". Außerhalb der PWA-Schicht existiert eine React-Query-Persistenz auf der Mobile-Fläche, die Geschäftsdaten browserseitig ablegt. Diese liegt **nicht** in der Zuständigkeit von `24` und wird hier weder beschrieben noch bewertet — sie ist eine Security-/Privacy-Frage und als offener Punkt in [`17`](17-known-issues-and-planned-waves.md) Abschnitt A.12 geführt (Security-Contract: [`22`](22-security-and-access.md)). Eine Aussage der Form „Nora speichert keine Kundendaten im Browser" wäre **falsch** und darf in keinem Dokument stehen.

---

## 7. Installability-Grenze

**Nachgewiesene Current Truth:**

- `public/site.webmanifest` existiert und ist in `index.html` verlinkt.
- Standalone-Metadaten existieren (`display: "standalone"`, `start_url`, `scope`, `id`, `theme_color`, `background_color`).
- Icons existieren (192×192, 512×512, `apple-touch-icon`, Favicons).
- iOS-PWA-Metadaten existieren (`apple-mobile-web-app-capable`, `-status-bar-style`, `-title`).
- Es gibt **keinen `beforeinstallprompt`-Handler** und **keine Nora-eigene Install-UI**.
- Es gibt **keine funktionale Standalone-Erkennung**: die einzige `display-mode: standalone`-Abfrage im Code dient der Safe-Area-Höhe der Mobile-Navigation unter iOS, nicht einer Installations- oder Funktionsentscheidung.

**Grenze.** Nora liefert die browserseitigen PWA-/Manifest-Grundlagen, besitzt derzeit aber **keinen abgenommenen Installability-Product-Contract**. Es wird ausdrücklich **nicht** behauptet, Nora sei auf jedem unterstützten Browser installierbar — das ist nicht verifiziert und kein zugesagtes Produktverhalten. Ob Installability ein bewusstes Produktziel werden soll, ist offen: [`17`](17-known-issues-and-planned-waves.md) Abschnitt E.

**Manifest-Dateien sind heute nicht Teil des Workbox-Precaches:** `.webmanifest` und `.json` fallen nicht unter die aktuelle Glob (§5). Das ist eine dokumentierte Tatsache, keine Änderungsanforderung.

---

## 8. Multi-Tab und Stale Clients

**`ACCEPTED LIMITATION` — bewusst so, kein offener Punkt.**

- **Aktualisiert ein Benutzer in einem Tab, laden die anderen offenen Nora-Tabs ebenfalls neu** bzw. übernehmen die neue Controller-Situation. Ungespeicherte Eingaben in diesen Tabs gehen dabei verloren.
- **Es gibt bewusst keine Cross-Tab-Schutzarchitektur** für ungespeicherte Eingaben: es existiert kein zentraler „Reload ist jetzt sicher"-Mechanismus, und er wurde bewusst nicht gebaut. Die Präsentation begegnet dem mit einem Speicherhinweis vor dem Aktualisieren ([`02`](02-design-system.md)), nicht mit Technik.
- **Ein Tab kann die Aktivierung eines anderen Tabs vorfinden.** Der Store liest die Fakten bei Rückkehr auf den Tab neu; ergibt sich daraus `reloadRequired`, startet keine Choreografie, sondern es wird ein Reload angeboten (§2, Präsentation in [`02`](02-design-system.md)).

**Bewusst nicht behandelte Plugin-/Browser-Eigenheiten** (Boundary, keine offenen Punkte): der Befund `nothing` (der entdeckte Worker verschwindet ohne Ersatz); kontrollierte Nicht-Klick-Tabs, die nach Fremdaktivierung sofort neu laden; ein sehr kurz nach der Registrierung gefundener Worker, der im unkontrollierten Dokument kein Entdeckungssignal auslöst. Der State Contract aus §2 wird dafür nicht wieder geöffnet. Historische Reproduktionen und Messwerte: [`releases/`](releases/README.md).

---

## 9. Durable Invariants vs. Current Technical Parameters

Zwei Klassen von Aussagen in diesem Dokument — sie werden unterschiedlich behandelt:

| Klasse | Beispiele | Regel bei Änderung |
|---|---|---|
| **Durable invariants** | Prompt statt Auto-Apply · UI greift nie direkt auf Service Worker/Workbox zu · Update ≠ Business-Operation · Aktivierungserfolg braucht einen Browser-Fakt · `activated` ist monoton · kein Runtime-Caching von Geschäftsdaten | Eine Änderung ist eine **Architekturentscheidung**: Eintrag in [`06`](06-decision-log.md) erforderlich |
| **Current technical parameters** | 60 min Intervall · 30 min Mindestabstand · 5 s Watchdog · 1,5 s Reload-Fallback · 2 h Snooze · 5 MiB Precache-Limit · effektive Plugin-Defaults (§5) | Ebenfalls Current Contract, aber **bewusst änderbar**: Contract- und Verifikationsreview ([`21`](21-agent-runbooks.md) §14), keine Verletzung einer Architekturregel |
