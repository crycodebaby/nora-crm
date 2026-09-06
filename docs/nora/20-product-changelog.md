# 20 – Nora Produkt-Changelog

Stand: 2026-09-06

## Wozu dieses Dokument

Dieses Changelog beschreibt, **was sich für die Menschen ändert, die Nora benutzen** — Büro, Leitung, IT. Es ist verständlich ohne Quellcode und ohne Git.

Es ist **kein** Git-Log, **kein** Release-Protokoll (dafür: `releases/`) und **nicht** das Changelog von Atomic CRM (`CHANGELOG.md` im Repository-Root beschreibt das Upstream-Produkt und dessen Abhängigkeiten — es gehört nicht in dieses Dokument).

### Zukünftiger Vertrag für `/changelog`

Heute zeigt die Seite `/changelog` in Nora noch die Atomic-CRM-Datei `CHANGELOG.md` (`misc/ChangelogPage.tsx`). Das ist ein Übernahme-Rest, kein Produktentscheid. Für eine spätere Welle gilt:

- `/changelog` zeigt **Nora-Produktänderungen**, nicht die Atomic-CRM-Upstream-Historie.
- Zielgruppe: Nora-Benutzer, Product Owner, IT.
- Jeder Eintrag hat eine **verständliche Produktzusammenfassung** und optional einen **technischen Hinweis**.
- Quelle ist dieses Dokument (oder eine daraus abgeleitete Struktur) — nicht der Git-Log, nicht das Decision Log.
- Die Route und die Oberfläche werden in dieser Dokumentationswelle **nicht** gebaut.

### Regeln für Einträge

- Ein Eintrag pro spürbarer Änderung: Datum, Titel, „Was ändert sich für Sie", optional „Technischer Hinweis".
- Keine winzigen visuellen Korrekturen, keine internen Refactorings, keine Testzahlen.
- Deutsch, ohne technisches Vokabular in der Produktzusammenfassung.
- Neueste Einträge oben.

---

## 2026-09-06 — Mitarbeiterzugang beenden („Zugang beenden")

**Was ändert sich für Sie:** Administratoren können den Nora-Zugang eines Mitarbeiters mit einer eigenen Aktion sofort beenden. Nora zeigt vorher, welche Kunden, Kontakte, Vorgänge und offenen Aufgaben dieser Person noch zugeordnet sind, und danach bleibt dieser Block „Offene Zuständigkeiten" in der Mitarbeiterakte sichtbar — mit Links zu den betroffenen Listen. Notizen und die gesamte Historie bleiben erhalten; es wird keine E-Mail versendet. Bei einer späteren Reaktivierung muss sich die Person neu anmelden.

**Technischer Hinweis:** Deaktivierung, Beenden aller laufenden Sitzungen und Protokolleintrag geschehen in einer Datenbanktransaktion; der Datenzugriff ist an eine lebende Sitzung gebunden. Details: `19-user-lifecycle-architecture.md`.

## 2026-09-06 — Anmeldeadresse eines Mitarbeiters ändern

**Was ändert sich für Sie:** Administratoren können die Anmelde-E-Mail eines Mitarbeiters über die Aktion „E-Mail-Adresse ändern" anpassen. Bereits versendete Einladungs- oder Passwort-Links werden dabei ungültig; eingeladene Mitarbeiter erhalten automatisch eine neue Einladung an die neue Adresse. Die eigene Adresse kann man nicht selbst ändern — ein zweiter Administrator hilft. Im Bearbeiten-Formular ist die Anmeldeadresse nur noch lesbar.

**Technischer Hinweis:** Auth-Identität und Nora-Spiegel werden in einer Transaktion geändert; ohne Nora-Freigabe verweigert die Datenbank jede E-Mail-Änderung.

## 2026-09-06 — Änderungsverlauf nennt den handelnden Administrator

**Was ändert sich für Sie:** Einträge zu Benutzerverwaltung (Rolle geändert, Zugang deaktiviert/aktiviert, Einladung, Passwort-Link) zeigen im Änderungsverlauf jetzt den echten Administrator statt „System". Ältere Einträge bleiben unverändert.

## 2026-09-05 — Deaktivierte Mitarbeiter bleiben in der Historie sichtbar

**Was ändert sich für Sie:** Ein deaktivierter Mitarbeiter behält seinen Namen auf alten Notizen, Vorgängen, Aufgaben und im Aktivitätslog. Er kann aber nicht mehr als Zuständiger für Neues ausgewählt werden; ist er noch auf einem Datensatz eingetragen, bleibt das sichtbar, aber nicht erneut wählbar. Kontakt-Exporte funktionieren auch mit deaktivierten Autoren.

**Technischer Hinweis:** Mitarbeiter mit Geschäftsbezug sind in der Datenbank nicht löschbar; Zuweisungen an deaktivierte Mitarbeiter werden serverseitig abgelehnt.

## 2026-09-05 — Benutzerverwaltung: Schutz vor Aussperren

**Was ändert sich für Sie:** Ein Administrator kann sich nicht mehr selbst deaktivieren oder herabstufen, und der letzte aktive Administrator bleibt immer erhalten. Zeigt die Mitarbeiterakte einen widersprüchlichen Zugangsstatus, gibt es die Reparatur „Zugangsstatus synchronisieren".

## 2026-09-04 — Mitarbeiter einladen und Onboarding

**Was ändert sich für Sie:** Administratoren sehen je Mitarbeiter den Zugangsstatus („Einladung gesendet", „Zugang aktiv", „Zugang deaktiviert", „Zugang unklar") und können „Einladung erneut senden" bzw. „Passwort einrichten lassen" auslösen. Neue Mitarbeiter richten ihren Zugang auf einer eigenen Nora-Seite ein: Begrüßung → Passwort → Name → fertig. Unter dem Zugangsstatus zeigt Nora, ob die letzte Zugangs-E-Mail zugestellt wurde („Zugestellt am …", „Zustellung verzögert", „E-Mail konnte nicht zugestellt werden").

**Technischer Hinweis:** Einladungs- und Passwort-Links landen auf `/zugang-einrichten`; Zustellinformationen kommen vom E-Mail-Anbieter (Brevo), ohne Öffnungs- oder Klick-Tracking. Öffentliche Selbstregistrierung ist deaktiviert — Nora ist einladungsbasiert.

## 2026-09-01 — Kunden schneller anlegen

**Was ändert sich für Sie:** Beim Anlegen eines Kunden entfällt das Feld „Land" (Nora setzt „Deutschland"), „Bundesland" ist mit „NRW" vorbelegt und änderbar, selten benötigte Angaben (Links, Größe, Umsatz, Steuernummer) liegen eingeklappt unter „Weitere Angaben". Die Adresse steht in deutscher Reihenfolge (Straße → PLZ | Ort → Bundesland). Beim Bearbeiten bestehender Kunden ändert sich nichts.

## 2026-09-01 — Ruhigere Aktualisierung von Nora

**Was ändert sich für Sie:** Wenn eine neue Nora-Version bereitsteht, erscheint ein ruhiger Hinweis „Neue Nora-Version verfügbar". „Jetzt aktualisieren" lädt Nora nach einer kurzen Vorbereitung neu, „Später" verschiebt um zwei Stunden. Nach dem Neuladen bestätigt Nora einmal „Aktualisierung abgeschlossen". Während ein Dialog offen ist, erscheint der Hinweis nicht — ungespeicherte Eingaben werden nie durch ein Update unterbrochen. Nora behauptet nie einen Fehler, wenn die neue Version längst läuft.

**Technischer Hinweis:** Der neue Service Worker wartet, bis der Benutzer aktualisiert; ein Reload allein holt die neue Version nicht.

## 2026-09-01 — Vorgänge-Übersicht: seitliche Navigation

**Was ändert sich für Sie:** Die Vorgangsübersicht mit vielen Statusspalten hat unten eine feste Navigationsleiste: ziehbarer Griff, Pfeile pro Spalte, Klick auf die Leiste springt an die Stelle. Trackpad, Touch und Shift+Mausrad funktionieren weiterhin; Karten lassen sich wie bisher verschieben.

## 2026-08-30 — Statusmeldungen für die Schnellerfassung

**Was ändert sich für Sie:** Nach dem Speichern in der Schnellerfassung zeigt Nora eine einzelne Statuskarte (läuft / erfolgreich / teilweise / fehlgeschlagen) mit Kunde und Vorgang. Sie bleibt lesbar, auch wenn danach die Vorgangsakte geöffnet ist, und verdeckt nie eine Schaltfläche des offenen Dialogs. Andere Bereiche nutzen weiterhin die bisherigen kurzen Hinweise.

## 2026-08-28 — Verständliche Fehlermeldungen und Schutz vor Doppelanlagen

**Was ändert sich für Sie:** Fachliche Ablehnungen (z. B. „Dieser Kontakt gehört nicht zu diesem Kunden", „Für diese Person existiert bereits eine Privatkundenakte") erscheinen als klare deutsche Meldungen statt technischer Texte. Ein Doppelklick oder eine unterbrochene Verbindung beim Speichern der Schnellerfassung oder beim Anlegen einer Kundenakte aus einem Kontakt erzeugt keine doppelten Datensätze mehr.

## 2026-08-28 — Kontakt anlegen: neue Formularstruktur

**Was ändert sich für Sie:** Das Formular „Kontakt anlegen" ist in „Person", „Kundenbezug", „Kontaktmöglichkeiten" und eingeklappte „Weitere Angaben" gegliedert, mit fester Aktion „Kontakt anlegen" — auch auf dem Handy bequem; die Kundenwahl öffnet dort ein großes Auswahlfenster mit eigener Neuanlage.

## 2026-08-26 — Kontakt zur eigenen Kundenakte machen

**Was ändert sich für Sie:** Aus einem bestehenden Kontakt lässt sich mit „Kundenakte für diese Person anlegen" eine eigene Kundenakte erzeugen (Privatperson oder Firma), ohne Personendaten erneut einzutippen; der Kontakt bleibt Ansprechpartner seiner bisherigen Firma. Die Schnellerfassung fragt im Schritt „Ansprechpartner" jetzt klar: vorhandenen verwenden, anderen wählen, neu anlegen oder ohne fortfahren. Entwürfe der Schnellerfassung werden pro Benutzer gespeichert und automatisch gesichert. „Unternehmen / Selbstständig" heißt jetzt „Firma".

## 2026-08-25 — Aufgaben auf der Kundenakte

**Was ändert sich für Sie:** Die Kundenakte hat einen Tab „Aufgaben" mit allen Aufgaben dieses Kunden, auch ohne Ansprechpartner („Rechnung prüfen"). Eine Aufgabe merkt sich den Kunden, für den sie entstanden ist — auch wenn der Ansprechpartner später zu einem anderen Kunden wechselt (Nora zeigt dann „heute bei …").

## 2026-08-25 — Kunden anlegen: Firma oder Privatperson, Hauptansprechpartner

**Was ändert sich für Sie:** Beim Anlegen wählen Sie „Firma" oder „Privatperson"; bei Privatpersonen entfallen Firmenfelder, der Name wird aus Vor-/Nachname gebildet. Ein Ansprechpartner kann direkt mit angelegt, als „Unternehmer ist selbst Ansprechpartner" übernommen oder aus Bestehenden zugeordnet werden. Je Kunde gibt es genau einen Hauptansprechpartner. Kunden haben jetzt mehrere E-Mail-Adressen, Telefonnummern und Links (Website, LinkedIn, Instagram, …) — nicht mehr nur LinkedIn.

## 2026-08-25 — Nora ist produktiv

**Was ändert sich für Sie:** Nora läuft unter `nora.ergart.de` mit echten Kundendaten der Ergart Gruppe. Demo-Daten gibt es nur noch im Demo-Modus.

## 2026-07-15 — Änderungsverlauf

**Was ändert sich für Sie:** Kunden-, Kontakt- und Vorgangsakten zeigen eine Änderungshistorie (wer hat wann was geändert). Administratoren haben zusätzlich den globalen Verlauf unter „Änderungsverlauf". Notiztexte werden dort nicht im Volltext gespeichert.

## 2026-07-14 — Rollen: Administrator, Büro, Nur-Lesen

**Was ändert sich für Sie:** Jeder Benutzer hat eine Rolle. Nur-Lesen sieht alles, ändert nichts (Lesemodus-Banner). Büro arbeitet operativ, archiviert statt zu löschen. Administratoren verwalten Benutzer, Rollen, Einstellungen und Import. Google Kalender wird als einziges Terminsystem angebunden (zunächst nur lesend, Admin-Seite „Google Kalender").

## 2026-07-14 — Schnellerfassung überarbeitet, Kanban und Vorgangsakte lesbarer

**Was ändert sich für Sie:** In der Schnellerfassung sind Kunde, Ansprechpartner und Vorgang frei wechselbare Tabs; Entwürfe gehen beim Schließen nicht verloren; mögliche bestehende Kunden werden in einem Bereich vorgeschlagen. Die Vorgangsübersicht nutzt die volle Breite, Vorgangsnummern und Dringlichkeit sind deutlich lesbar, Datumsangaben sind durchgehend deutsch. „Nachfassen" heißt sichtbar „Rückmeldung ausstehend", das Nachfassdatum „Nächster Kontakttermin".

## 2026-06-28 — Kundennummern, Vorgangsnummern, globale Suche, Hotboard, Checklisten, Schnellerfassung

**Was ändert sich für Sie:** Jeder Kunde bekommt eine feste Kundennummer (`KD-000001`), jeder Vorgang eine feste Vorgangsnummer (`VG-2026-000001`) — automatisch, unveränderlich, im Kopf jeder Akte. Die Suche im Kopfbereich findet Kunden, Kontakte und Vorgänge; eine exakte Nummer öffnet direkt die Akte. Das Hotboard nach dem Login zeigt „Heute kontaktieren", „Neue Anfragen", „Wartet auf Hersteller", „Rückmeldung zu Angeboten", offene Aufgaben und offene Produktionsfreigaben. Fenstervorgänge haben eine Produktionsfreigabe-Checkliste in der Vorgangsakte. Die Schnellerfassung nimmt Anfragen aus Telefon, WhatsApp und E-Mail in einem Dialog auf und warnt vor möglichen Dubletten.

## 2026-06-28 — Nora statt Atomic CRM

**Was ändert sich für Sie:** Deutsche Oberfläche und URLs (`/kunden`, `/kontakte`, `/vorgaenge`), „Vorgänge" statt „Deals", Nora-Branding, Euro-Beträge, ruhigere Typografie und größere Bedienelemente für Tablet, öffentliche Startseite mit Anmeldung.
