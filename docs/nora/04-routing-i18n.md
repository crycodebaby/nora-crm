# 04 – Routing, i18n und Legacy-Kompatibilität

## Deutsche URLs

Sichtbare URLs sollen deutsch sein:

| Intern | Deutsch |
|---|---|
| `contacts` | `/kontakte` |
| `companies` | `/kunden` |
| `deals` | `/vorgaenge` |

Die internen Resource-Namen bleiben wegen React Admin, DataProvider und Supabase stabil.

## Legacy-Redirects

Alte Pfade sollen nicht hart brechen:

- `/contacts` → `/kontakte`
- `/companies` → `/kunden`
- `/deals` → `/vorgaenge`

Interne alte Links dürfen über Redirects weiter funktionieren, sollten aber schrittweise auf Nora-Pfade umgestellt werden.

## Öffentliche Auth-Routen (Welle 6a)

| Route | Zweck | Auth |
|---|---|---|
| `/` | Startseite für Gäste; Dashboard für eingeloggte Nutzer | Gäste: Startseite |
| `/login` | Startseite für Gäste; mit `?mode=anmelden` das Anmeldeformular | Öffentlich |
| `/login?mode=anmelden` | Anmeldung (bestehende `LoginPage` innerhalb von `StartPage`) | Öffentlich |
| `/sign-up` | Erstbenutzer-Registrierung (bestehende `SignupPage`) | Öffentlich, nur wenn noch nicht initialisiert |

Geschützte App-Routen (`/kontakte`, `/kunden`, `/vorgaenge`, …) leiten nicht eingeloggte Nutzer auf die Startseite um; von dort führt „Einloggen“ nach `/login` (optional mit `?redirect=`).

### Auth-Querverweise (Welle 6a-Polish)

Übersetzungen unter `crm.auth.nav` in allen drei Message-Katalogen:

| Schlüssel | Deutsch |
|-----------|---------|
| `sign_in` | Einloggen |
| `sign_up` | Registrieren |
| `back_to_start` | Zur Startseite |
| `no_account_yet` | Noch kein Konto? |
| `already_have_account` | Schon ein Konto? |

| Von | Aktion | Ziel |
|-----|--------|------|
| Login | Zur Startseite (oben) | `/` |
| Login | Registrieren (unter Formular) | `/sign-up` |
| Sign-up | Einloggen | `/login` |
| Sign-up | Zur Startseite | `/` |

Implementierung: gemeinsame Komponente `AuthPageNav` in `src/components/atomic-crm/login/`.

## i18n-Regeln

Deutsch ist Standard.

Englisch und Französisch dürfen technisch bestehen bleiben, aber Nora muss in Deutsch vollständig nutzbar sein.

Wenn neue sichtbare Texte eingeführt werden, müssen sie in den Message-Katalogen ergänzt werden:

- `germanCrmMessages.ts`
- `englishCrmMessages.ts`
- `frenchCrmMessages.ts`, wenn Typkompatibilität dies verlangt

## Legacy-Deal-Stages

Alte Atomic-Werte müssen sichtbar deutsch gemappt werden:

| Technischer Wert | Nora-Anzeige |
|---|---|
| `opportunity` | Neue Anfrage |
| `proposal-sent` | Angebot gesendet |
| `in-negotiation` | In Klärung |
| `in-negociation` | In Klärung |
| `won` | Angenommen |
| `lost` | Abgelehnt |
| `delayed` | Verzögert |

Nora-Werte dürfen zusätzlich existieren.

## Währung

Standard:

- Währung: EUR
- Locale: de-DE
- Beispiel: `0,00 €`

Keine sichtbare Dollar-Formatierung in Nora.
