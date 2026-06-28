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
