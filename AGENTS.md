# Nora CRM – Agenten-Startdatei

Diese Datei ist der verpflichtende Einstiegspunkt für KI-Agenten, die an Nora CRM arbeiten.

## Sofortregel

Bevor Code geändert wird, liest der Agent zuerst diese Datei und danach `docs/nora/README.md`.

**`docs/nora/README.md` ist der einzige kanonische Router der Nora-Dokumentation.** Leseeinstieg, Dokument-Zuständigkeiten, Load-Klassen und Kontextdisziplin stehen dort — und nur dort. Diese Datei führt bewusst **keine zweite Dokumentenliste**; sie enthält nur die universellen Agentenregeln.

Immer geladen (Always-Kontext):

- `docs/nora/README.md` — der Router, immer zuerst
- `docs/nora/16-current-state.md` — kompakte Momentaufnahme: was ist heute live
- `docs/nora/01-domain-model.md` — Domain Core
- `docs/nora/03-data-model-guardrails.md` — globale Daten-Guardrails
- `docs/nora/07-agent-change-checklist.md` — Change Protocol

Alles Weitere wird **aufgabenbezogen** geladen; welches Dokument für welches Thema zuständig ist, steht im Router. Nicht pauschal als Standardkontext laden:

- `docs/nora/06-decision-log.md` — nur bei Entscheidungs-/Begründungsbedarf, und dann gezielt über den thematischen Index bzw. den benannten Eintrag, nicht als ganze Datei
- `docs/nora/17-known-issues-and-planned-waves.md` — nur die für die Aufgabe relevante Sektion; vollständig nur bei Roadmap-, Release- oder Cross-Cutting-Review
- `docs/nora/releases/` — historische Release-Evidenz (RC-SHAs, Migrationen, Live-Beweise); für die Orientierung **nicht** nötig, nur für Regression, Release-Abstammung oder Rekonstruktion

Wenn eine Änderung fachliche Entscheidungen berührt, muss der Agent `docs/nora/06-decision-log.md` ergänzen oder einen neuen Decision-Eintrag vorschlagen. Das Produkt-Changelog (`docs/nora/20-product-changelog.md`) wird bei benutzerspürbaren Änderungen ergänzt. Dokumentations-Abschlusscheck: `docs/nora/07-agent-change-checklist.md`.

## Produktziel

Nora CRM ist eine angepasste Kunden- und Vorgangsverwaltung für einen deutschen Hausmeister- und Fensterservice-Betrieb.

Nora ist kein generisches Sales-CRM, kein ERP und kein vollständiges Field-Service-System. Nora v0.1 soll zunächst zuverlässig beantworten:

- Wer ist der Kunde?
- Wer ist der Ansprechpartner?
- Worum geht es im Vorgang?
- Was ist der aktuelle Status?
- Wer muss als Nächstes was tun?
- Welche Notizen, Aufgaben und Nachfassungen gehören dazu?

## Technische Grundregel

Interne Atomic-CRM-Resource-Namen bleiben vorerst stabil:

- `contacts` = sichtbar: Kontakte
- `companies` = sichtbar: Kunden
- `deals` = sichtbar: Vorgänge
- `tasks` = sichtbar: Aufgaben
- `tags` = sichtbar: Markierungen

Keine harte Umbenennung dieser Ressourcen ohne explizite Entscheidung, weil Datenprovider, Supabase-Tabellen, Relations, Tests und gespeicherte Daten davon abhängen können.

## Keine Änderungen ohne Prüfung

Vor jeder Änderung prüfen:

- Ist es nur UI/Label/Theme?
- Ist es Konfiguration?
- Betrifft es FakeRest-Demo-Daten?
- Betrifft es Supabase-Tabellen oder Migrationen?
- Betrifft es gespeicherte `localStorage`-Konfiguration?
- Entsteht dadurch doppelte Datenhaltung?

Wenn Datenmodell oder Persistenz berührt werden, ist besondere Vorsicht Pflicht.

## Standard-Verifikation

Nach Änderungen mindestens:

```bash
npm run typecheck
npm run build
```

Für Demo-Daten zusätzlich:

```bash
npm run dev:demo
```

## Commit-Hinweis unter Windows

Der aktuelle Husky-Hook kann unter Windows wegen `make registry-gen` fehlschlagen. Wenn `typecheck` und `build` erfolgreich waren, kann lokal vorübergehend committed werden mit:

```bash
git commit --no-verify -m "..."
```

Der Hook selbst sollte später Windows-tauglich gemacht werden.
