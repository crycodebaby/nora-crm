# 07 – Agent Change Checklist

Vor jeder Änderung:

- [ ] `AGENTS.md` gelesen
- [ ] relevante `docs/nora/*.md` gelesen
- [ ] Ziel der Änderung verstanden
- [ ] geprüft, ob UI, Konfiguration, Demo-Daten oder Datenmodell betroffen sind
- [ ] keine unnötige DB-/Migration-Änderung geplant
- [ ] keine Resource-Namen blind umbenannt
- [ ] keine `dist/`-Dateien direkt bearbeitet

Während der Änderung:

- [ ] sichtbare Texte in Deutsch gepflegt
- [ ] keine Denglisch-Begriffe eingeführt
- [ ] Nora-Brandfarbe zentral/konsequent genutzt
- [ ] alte Atomic-Werte nicht unnötig gebrochen
- [ ] Datenmodell-Doppelungen vermieden

Nach der Änderung:

- [ ] `npm run typecheck`
- [ ] `npm run build`
- [ ] bei Demo-Daten: `npm run dev:demo`
- [ ] manuelle Prüfung relevanter Seiten
- [ ] Decision Log ergänzt, falls fachliche/architektonische Entscheidung
- [ ] Commit-Nachricht klar formuliert

Bei Nummern-/DB-Änderungen zusätzlich:

- [ ] `npx supabase db reset --local` (Migration reproduzierbar?)
- [ ] NULL/Duplikat/Format-Check für `customer_number` / `case_number`
- [ ] Immutability lokal getestet (`UPDATE` muss fehlschlagen)
- [ ] INSERT mit Fake-Nummer erzeugt **keine** Client-Nummer (Hardening)
- [ ] `next_*` nicht per RPC für `anon`/`authenticated` ausführbar
- [ ] Keine zweite Nummernlogik in Demo/CSV/UI-Formularen

Wenn ein Fehler entsteht:

1. Ursache dokumentieren.
2. Keine hektische Komplettumschreibung.
3. Kleine, nachvollziehbare Korrektur.
4. Bestehende Daten nicht unnötig migrieren oder löschen.
