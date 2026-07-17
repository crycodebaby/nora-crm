# Nora CRM – Agenten-Startdatei

Diese Datei ist der verpflichtende Einstiegspunkt für KI-Agenten, die an Nora CRM arbeiten.

## Sofortregel

Bevor Code geändert wird, muss der Agent diese Datei und die referenzierten Dokumente lesen:

1. `docs/nora/00-project-context.md`
2. `docs/nora/01-domain-model.md`
3. `docs/nora/02-design-system.md`
4. `docs/nora/03-data-model-guardrails.md`
5. `docs/nora/04-routing-i18n.md`
6. `docs/nora/05-demo-data-guidelines.md`
7. `docs/nora/06-decision-log.md`
8. `docs/nora/07-agent-change-checklist.md`
9. `docs/nora/11-google-calendar-rbac.md`
10. `docs/nora/12-role-ux-acceptance.md` (Rollen-UX-Abnahmeprotokoll)

Wenn eine Änderung fachliche Entscheidungen berührt, muss der Agent `docs/nora/06-decision-log.md` ergänzen oder einen neuen Decision-Eintrag vorschlagen.

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
