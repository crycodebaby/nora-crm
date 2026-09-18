# 16 – Aktueller Zustand (Einstiegspunkt für neue Agenten)

Stand: 2026-09-18 · Load-Klasse: **ALWAYS** · Status: **CURRENT SNAPSHOT**

Dieses Dokument besitzt den **heutigen Zustand** von Nora — nicht die Contracts der Subsysteme, nicht deren Runbooks, nicht die offenen Punkte und nicht die Release-Historie. Welches Dokument wofür zuständig ist und wann es geladen wird, entscheidet ausschließlich der Router [`README.md`](README.md); dieses Dokument führt bewusst keine zweite Routingtabelle und keine Owner-Liste. Die aktuellen Release- und Laufzeitfakten stehen hier; die historische Beweisführung (RC-SHAs, Migrations-Hashes, Testzahlen, Live-Beweise, Zwischenfälle) liegt im Archiv [`releases/`](releases/README.md). **Repository-Kopf und Laufzeit-Kopf sind zwei verschiedene Fakten** — siehe Abschnitt „Vier Fakten".

## Was ist Nora?

Nora CRM ist eine angepasste Kunden- und Vorgangsverwaltung für einen deutschen Hausmeister- und Fensterservice-Betrieb (Ergart Gruppe) auf Basis von Atomic CRM. Details: [`00-project-context.md`](00-project-context.md). Nora läuft **produktiv** unter `nora.ergart.de` und arbeitet mit **echten Produktions-/Kundendaten** (seit 2026-08-25).

## Kernressourcen

Nur das Namensmapping sichtbar ↔ technisch. Fachliche Bedeutung: [`01-domain-model.md`](01-domain-model.md). Daten- und Persistenzinvarianten sowie der Fallen-Index: [`03-data-model-guardrails.md`](03-data-model-guardrails.md). Hier stehen bewusst **keine** Invarianten.

| Sichtbar | Technisch |
|---|---|
| Kunde | `companies` |
| Ansprechpartner | `contacts` |
| Vorgang | `deals` |
| Aufgabe | `tasks` |
| Notiz | `contact_notes` / `deal_notes` |
| Markierung | `tags` |
| Mitarbeiter | `sales` |

## Security

Security wird **serverseitig** durchgesetzt; die UI ist keine Security Boundary. Der vollständige aktuelle Contract für Rollen, Berechtigungen, RLS, Grants, `SECURITY DEFINER`, Trust Boundaries sowie Session- und Executor-Integrität steht in [`22-security-and-access.md`](22-security-and-access.md), die offenen Risiken in [`17`](17-known-issues-and-planned-waves.md) Abschnitt A. Hier wird davon nichts dupliziert.

## Anhänge / Storage

Stand seit W8-B (`PRODUCTION VERIFIED` 2026-09-16), W8-C S1 und W8-C S2A1 (beide `PRODUCTION VERIFIED` 2026-09-17) und W8-C S2A2.1 (`PRODUCTION VERIFIED` 2026-09-18). Der vollständige Access-Contract dazu steht in [`22`](22-security-and-access.md) Abschnitt 6.5 (Bucket), 6.6 (Tabelle `public.attachments`), 6.7 (Löschintent-Warteschlange) und 6.8 (Liveness-Resolver), die verbliebenen Risiken in [`17`](17-known-issues-and-planned-waves.md) Abschnitt H; hier nur der Ist-Zustand.

- **Anhänge sind für die Anwendung weiterhin ein JSON-Array am Notizdatensatz.** `contact_notes.attachments` / `deal_notes.attachments` sind die **einzige live genutzte** Darstellung; jeder Upload, jede Anzeige und jedes Entfernen läuft heute ausschließlich darüber.
- **Daneben existiert seit W8-C S1 die leere Metadatentabelle `public.attachments`** (acht Spalten: `id`, `contact_note_id`, `deal_note_id`, `storage_key`, `file_name`, `mime_type`, `byte_size`, `created_at`). Sie ist ein **additives Schemafundament, keine Funktion**: kein Code in `src/**` liest oder schreibt sie, es gab **keine Migration der Bestandsanhänge**, und die Tabelle ist in Production leer. Wer sie sieht, darf daraus **keine** Anhangverwaltung, keinen Viewer und keinen Löschpfad ableiten.
- **Ein Löschen einer Zeile in `public.attachments` — auch per FK-`CASCADE` beim Löschen der Notiz — entfernt ausschließlich die Metadatenzeile, niemals die Datei im Storage.** Weder S1 noch S2A1 noch S2A2.1 enthalten einen physischen Löschpfad (siehe unten).
- **Seit W8-C S2A1 wird beim Löschen einer solchen Metadatenzeile ein Lösch-*Vorhaben* festgehalten.** Ein `AFTER DELETE`-Zeilentrigger auf `public.attachments` schreibt `OLD.storage_key` als `pending`-Auftrag in die private Warteschlange `nora_private.attachment_storage_deletion_queue`. Die Warteschlange hat **keinen Konsumenten**: kein Worker, kein Claim-/Ack-/Fail-Vertrag, kein Storage-Aufruf, kein Netzwerkaufruf. Ein Eintrag dort ist **Vorhaben, nicht Erlaubnis** — er beweist nicht, dass die Datei gelöscht werden darf. Da `public.attachments` leer und unverdrahtet ist, ist die Warteschlange in Production ebenfalls **leer**; der Mechanismus ist heute bewusst wirkungslos und existiert, bevor die erste Anhangzeile geschrieben wird. Contract: [`22`](22-security-and-access.md) Abschnitt 6.7.
- **Seit W8-C S2A2.1 existiert ein zentraler, read-only Liveness-Resolver** `nora_private.attachment_storage_key_liveness(text)`. Er beantwortet für einen Objektschlüssel, ob eine registrierte Nora-Fläche ihn noch referenziert — `live`, `dead` oder `unknown` — über `public.attachments`, die Notiz-Anhang-Arrays, Kundenlogos, die Branding-Logos (auch in reiner URL-Form), Kontakt- und Mitarbeiter-Avatare sowie einen Stolperdraht auf den übrigen `configuration`-Inhalt. Audit-Historie nimmt nicht teil. **`dead` ist eine Beobachtung, keine Löscherlaubnis.** Der Resolver ist intern (kein API-Aufrufer, keine Rolle darf ihn ausführen), schreibt nichts und ruft weder Storage noch Netzwerk auf; er hat heute **keinen produktiven Aufrufer**. Die Warteschlange kennt seitdem zusätzlich den terminalen Zustand `skipped_live` — nur als Vokabular, **nichts erzeugt ihn**. Contract: [`22`](22-security-and-access.md) Abschnitt 6.8.
- **Liveness-Zensus des Buckets (Production, 2026-09-18, read-only):** 43 Objekte im Bucket `attachments`, davon **35 `live`** und **8 `dead`**. Die 8 sind **aktuelle Verwaisungskandidaten** — zum Zeitpunkt der Beobachtung von keiner registrierten Fläche referenziert —, keine bestätigt entbehrlichen Dateien; sie wurden **nicht** gelöscht. `public.attachments` und die Warteschlange sind weiterhin leer.

- Notiz-Anhänge, Kundenlogos und Branding-Logos liegen weiterhin **in einem gemeinsamen Storage-Bucket `attachments`**.
- Der Bucket ist **weiterhin `public = true`**. Wer einen Objektschlüssel kennt, lädt die Datei ohne Anmeldung herunter. W8-B hat die **Storage-API-Autorisierung** gehärtet, **nicht** die Vertraulichkeit vorhandener Objekt-URLs.
- Bucket-Grenzen werden serverseitig erzwungen: **50 MiB** je Datei (`file_size_limit = 52428800`) und genau **neun** erlaubte MIME-Typen (JPEG, PNG, WebP, GIF, PDF, DOCX, XLSX, TXT, CSV). Geprüft wird der **deklarierte** MIME-Typ, kein Dateiinhalt.
- Policies auf `storage.objects` für diesen Bucket: `SELECT` nur für aktive Nora-Benutzer (`nora_private.is_active_user()`), `INSERT` nur für schreibberechtigte aktive Benutzer (`nora_private.can_write()`, also Büro/Admin). Für `UPDATE` und `DELETE` existiert **keine** Policy für normale Rollen — normale Rollen können über den regulären Storage-API-Pfad bestehende Objekte damit weder überschreiben noch löschen.
- **Es gibt weiterhin keinen physischen Löschpfad für Anhänge.** Die frühere Kette (Trigger → `public.cleanup_note_attachments()` → `pg_net` → Edge Function `delete_note_attachments`) ist entfernt; die Function `public.get_note_attachments_function_url()` ebenfalls. Das Löschen einer Notiz entfernt die Datei im Storage **nicht** — solche Objekte bleiben als bewusst akzeptierte Verwaisungen liegen, und auch die S2A1-Warteschlange und der S2A2.1-Resolver ändern daran nichts (die eine hält ein Vorhaben fest, der andere beobachtet; keiner löscht). Bestehende Verwaisungskandidaten sind **nicht** bereinigt. `pg_net` bleibt installiert (fremde Infrastruktur).
- Die Oberfläche (Desktop und Mobil) lehnt zu große oder nicht erlaubte Dateien bereits im Formular mit einer deutschen Meldung ab. Das ist Bedienkomfort; die Grenze wird vom Bucket erzwungen.

## Was ist live?

| Komponente | Stand | Nachweis |
|---|---|---|
| Repository-/Dokumentationskopf | aktueller `main` — hier bewusst nicht als SHA festgeschrieben, weil reine Docs-Commits ihn verschieben, ohne die Laufzeit zu ändern | `git log` |
| Letzter Laufzeit-Release | Attachment Security Hardening W8-B, Laufzeit `be77e7da53ce4eaaae1710bbcafbb8d99e5759b4` (`PRODUCTION VERIFIED` 2026-09-16) — Migration `20260915120000_nora_attachment_storage_hardening`, kein Edge-Deploy. Frontend und Migration wurden getrennt ausgeliefert (Frontend zuerst live, Migration am 2026-09-16 nachgezogen); seitdem sind beide Seiten deckungsgleich. Sichtbare Folge: beim Anhängen einer Datei an eine Notiz gelten Typ- und Größengrenzen (Abschnitt „Anhänge / Storage"). Der Build enthält die Vorgänger W7-R1B (`fd635b08`), W7-M1 (`8aa62cc`) und den Laufzeitcommit `c7501f9` (SEC-B2 Browser-Persistenz); dessen Verifikation und Abschluss sind eine eigene Welle und mit W8-B nicht mitbehauptet | Archiv `releases/2026-09.md` |
| Letzter Release mit **neuer sichtbarer** Funktionalität (W8-B bringt eine sichtbare Einschränkung, keine neue Fläche) | W7-M1 (Laufzeit `8aa62cc`, im aktuellen Build enthalten): Vorgänge lassen sich unter 768 CSS px über `/vorgaenge/:id/show` als eigene mobile Detailseite öffnen. Die mobile Vorgang-**Route** ist nur eine Anzeige — mobil sind für Vorgänge keine Listen-/Kanban-, Anlege- oder Bearbeiten-Routen registriert (andere mobile Einstiege wie die Schnellerfassung sind davon unberührt); Desktop unverändert. Routing-Contract: [`04`](04-routing-i18n.md) | Archiv `releases/2026-09.md` |
| Frontend / Deploy | Vercel-Projekt `nora-crm`, Domain `nora.ergart.de`; **jeder Push auf `main` löst ein automatisches Production-Deployment aus**. Prüfregel für die Build-/Release-Identität: [`21`](21-agent-runbooks.md) Sektion 14 | Archiv `releases/2026-09.md` |
| Datenbank | `nora-crm-prod` (`kixxroxtfzbcbzctohex`), Postgres 17.6; Migrations-Ledger **63 Einträge, Kopf `20260918120000_nora_attachment_liveness_resolver`**, deckungsgleich mit `supabase/migrations/` (63 Dateien) | Read-only Ledger-Abgleich 2026-09-18 |
| Letzte **reine DB-Änderung** ohne Laufzeitwirkung | W8-C S2A2.1 Attachment Liveness Resolver, Schema-Commit `64963155d25321dbf9b4799a87f7582e30c445fe`, Migration `20260918120000_nora_attachment_liveness_resolver` (`PRODUCTION VERIFIED` 2026-09-18). Der Commit ändert **nichts** in `src/**` — die ausgelieferte Anwendung verhält sich unverändert; der Resolver ist intern, read-only und ohne Aufrufer (Abschnitt „Anhänge / Storage"). Vorgänger derselben Art: W8-C S2A1 (`28bf7902`, Migration `20260917120000_nora_attachment_deletion_capture`) und W8-C S1 (`3df2ced8`, Migration `20260916120000_nora_attachment_foundation`), beide `PRODUCTION VERIFIED` 2026-09-17. Die Zeile „Letzter Laufzeit-Release" bleibt von allen dreien unberührt | Archiv `releases/2026-09.md` |
| Edge Function `users` | **Version 9** (`verify_jwt = false`, verifiziert JWTs selbst) | `list_edge_functions` read-only 2026-09-07 |
| Edge Function `brevo-email-events` | **Version 2** (`verify_jwt = false`, Bearer-Token) | dito |
| Alle übrigen Edge Functions im Repo (`calendar-*`, `merge_contacts`, `update_password`, `postmark`, `mcp`) | **nicht in Production deployt** — live sind ausschließlich `users` und `brevo-email-events` | dito |
| Edge Function `delete_note_attachments` | **existiert nicht mehr** — sie war nie in Production deployt und ihre Quelle ist mit W8-B aus dem Repository entfernt; der sie aufrufende DB-Pfad (Trigger → `cleanup_note_attachments()` → `pg_net`) ist in Production gelöscht | Abschnitt „Anhänge / Storage" |
| Build / CI (Repository, **nicht** Laufzeit) | **Gesamt-CI GREEN**: GitHub Actions „Check" Run #104 (ID `34791859868`) auf `7384431d917eed79000d50437a53abd514bc27c5` — alle sechs Jobs erfolgreich (Prettier, Typecheck, Test, ESLint, Build, `e2e-test`); Playwright 7 passed / 1 bewusst übersprungen / 0 failed / 0 flaky. `7384431d` ändert ausschließlich E2E-Test-Infrastruktur (E2E-B1) — **kein** Laufzeit-Release, keine Production-Verifikation, ein durch den Push ausgelöstes Vercel-Deployment wurde nicht geprüft; die Zeile „Letzter Laufzeit-Release" bleibt davon unberührt. E2E-Isolationsregeln: [`21`](21-agent-runbooks.md) Sektion 16 | Archiv `releases/2026-09.md` „E2E-Testisolation E2E-B1" |

Die Release-/Deploy-Grundreihenfolge für schemaabhängige Wellen steht in [`07-agent-change-checklist.md`](07-agent-change-checklist.md). **Bei PWA-Clients ist ein Reload allein kein belastbarer Nachweis dafür, welcher Build aktiv ist** — technischer Contract: [`24`](24-pwa-and-update-lifecycle.md); Live-Smoke: [`21`](21-agent-runbooks.md) Sektion 14.

## Vier Fakten

**Repository-Stand, DB-Deployment, Edge-Deployment und produktive Nutzbarkeit sind vier verschiedene Fakten.** Sie fallen regelmäßig auseinander, und keiner von ihnen beweist einen der anderen:

- Code auf `main` ist **kein** Beweis für ein DB- oder Edge-Deployment.
- Eine angewendete Migration ist **kein** Beweis für eine nutzbare Funktion.
- Eine vorhandene Route ist **kein** Beweis für eine funktionierende Integration.
- Der Repository-/Dokumentationskopf wandert mit jedem Docs-Commit, ohne die Laufzeit zu verändern — er ist **nicht** der Laufzeit-Release.

Der laufende Gegenbeleg ist der **Kalender**: der Code liegt vollständig auf `main`, die Integration ist aber **derzeit nicht produktiv nutzbar**. Aktueller Owner und Details: [`11`](11-google-calendar-rbac.md) und [`14`](14-google-calendar-readonly-implementation.md).

## Aktive Programmlage

Aktiv ist **Wave 7**; ihre offenen Folgepunkte (Vorgänge, mobile Vorgang-Fläche) stehen in [`17`](17-known-issues-and-planned-waves.md) Abschnitt G. Der vollständige offene Zustand — Bugs, Restrisiken, geplante Wellen — steht ausschließlich in [`17`](17-known-issues-and-planned-waves.md); dieses Dokument führt weder eine zweite Known-Issues-Liste noch eine Chronik abgeschlossener Wellen. Abgeschlossene Wellen und ihre Evidenz liegen im Archiv [`releases/`](releases/README.md).

Global zustandsprägende offene Punkte:

- Wave 7 Folgepunkte → [`17`](17-known-issues-and-planned-waves.md) Abschnitt G
- Anhänge: öffentlicher Bucket und verwaiste Objekte nach W8-B → [`17`](17-known-issues-and-planned-waves.md) Abschnitt H
- Kalender nicht produktiv nutzbar → [`11`](11-google-calendar-rbac.md) / [`14`](14-google-calendar-readonly-implementation.md)

## Welche Dokumente muss ich für welches Thema lesen?

Das entscheidet der Router: [`README.md`](README.md), Tabelle „Architekturbereiche". Sie nennt pro Bereich den aktuellen Contract, den benannten `06`-Eintrag für die Begründung, die `17`-Sektion für die offenen Punkte und die `21`-Runbook-Sektion für die operativen Zusatzschritte.

## Truth Hierarchy

Bei Widersprüchen zwischen Chatwissen, Dokumentation, Repository und Production gilt:

1. **verifizierter tatsächlicher Production-Zustand** — wenn er materiell vom Repository-Sollzustand abweicht
2. **aktueller Code und aktuelle Migrationen im Repository**
3. Git-Historie
4. aktuelle Architektur-/Contract-Dokumente (`16`, `01`, `03`, `13`, `18`, `19`, `22`, … — Zuordnung im Router)
5. durable Entscheidungen mit Begründung (`06`)
6. historische Release-Evidenz (`releases/`)
7. Chatwissen aus vorherigen Sitzungen

**Repository-Code ist dadurch nicht zweitrangig — er antwortet auf eine andere Frage.** Das Repository ist autoritativ dafür, was der **nächste Release** enthält; der verifizierte Production-Zustand ist autoritativ dafür, was **heute läuft**. Beide Fakten fallen regelmäßig auseinander: der Repository-/Dokumentationskopf wandert mit jedem Docs-Commit, ohne die Laufzeit zu verändern (Abschnitt „Was ist live?"). Erst wenn eine Aussage über den **heutigen Live-Zustand** getroffen wird und beide materiell widersprechen, gewinnt Production — und dann ist die Abweichung selbst ein Befund, der dokumentiert und nicht stillschweigend übernommen wird.

Dokumentation ist niemals autoritativer als Code, Migrationen oder verifizierter Production-Zustand. Innerhalb der Dokumentation gilt: **aktuelle Wahrheit** steht in `16`/`01`/`03`/`19`/`22` und den Subsystem-Contracts, **durable Entscheidungen** in `06`, **historische Fakten** im Archiv `releases/` — ein historischer Eintrag beschreibt den Wissensstand seines Datums, nicht den heutigen Zustand.
