# 18 – E-Mail-Zustellbeobachtung (Employee Access V1C-A)

Stand: 2026-09-04. Status: **BACKEND RC — nicht deployt, nicht in Produktion aktiv.**

Dieses Dokument beschreibt den technischen Vertrag und die manuelle
Konfiguration. Produktentscheidungen stehen im Decision Log
(`06-decision-log.md`, Eintrag „2026-09-04 – Employee Access V1C-A“).

## 1. Wellenstand

| Welle | Inhalt | Status |
|---|---|---|
| V1A | Employee Access (abgeleiteter Zugangsstatus, `GET /users`, zwei Admin-Aktionen) | live |
| V1B | Premium UX & Motion für Mitarbeiter/Admin | parallele RC-Entwicklung, **nicht** Teil dieser Welle |
| V1C-A | Zustellbeobachtung Backend (diese Welle) | RC |
| V1C-B | `/benutzer`-Zustell-UI | nicht begonnen |

## 2. Absender

Kanonischer Absender für Nora-Zugangs-E-Mails:

```
Nora <zugang@nora.ergart.de>
```

Sendende Domain: `nora.ergart.de`, laut Product Owner in Brevo verifiziert.

## 3. Was V1C-A beantwortet — und was nicht

Bisher weiß Nora nur: „ein Sendevorgang wurde angenommen“. V1C-A ergänzt, soweit
technisch belegbar, den Zustellausgang.

Strikt getrennte Bedeutungen:

```
NORA HAT E-MAIL ANGEFORDERT
  ≠ PROVIDER HAT ANGENOMMEN
    ≠ ZUGESTELLT
```

„Zugestellt“ heißt: das empfangende Mailsystem hat die Nachricht laut Provider
angenommen. Es beweist **nicht**, dass die Mitarbeiterin sie gelesen, den Link
geklickt oder das Onboarding abgeschlossen hat. Der Zugangsstatus
(`invited`/`active`/`disabled`/`unknown`) kommt weiterhin ausschließlich aus
V1A und niemals aus einem Zustellereignis.

**Kein Öffnungs- und Klick-Tracking.** `opened`, `uniqueOpened`, `click` und
Proxy-Opens werden bewusst weder abonniert noch gespeichert. Der Endpunkt nimmt
sie an (damit der Provider nicht endlos wiederholt) und verwirft sie.

## 4. Nora-Ereignisvertrag (providerneutral)

Der Rest von Nora sieht ausschließlich diese Werte — nie `hardBounce`,
`softBounce`, „Brevo“ oder eine `message-id`:

| Nora-Ereignis | Provider-Ereignis |
|---|---|
| `EMAIL_ACCEPTED` | `request`, `sent` |
| `EMAIL_DELIVERED` | `delivered` |
| `EMAIL_DEFERRED` | `deferred` |
| `EMAIL_SOFT_BOUNCED` | `softBounce` |
| `EMAIL_HARD_BOUNCED` | `hardBounce` |
| `EMAIL_BLOCKED` | `blocked` |
| `EMAIL_INVALID` | `invalid` |
| `EMAIL_SPAM_REPORTED` | `spam` |

Produktausgang (das, was eine UI zeigt) — `accepted`, `delayed`, `delivered`,
`undeliverable`, `spam_reported`. Deutsche Beschriftungen liegen in
`src/components/atomic-crm/sales/emailDeliveryContract.ts`.

Die Ableitung ist **semantisch, nicht ankunftsreihenfolgeabhängig**: das
späteste Ereignis nach Provider-Zeitstempel gewinnt, bei gleichem Zeitstempel
entscheidet ein Schweregrad-Rang. Ein Soft Bounce mit anschließendem
erfolgreichem Retry liest sich damit korrekt als „zugestellt“.

## 5. Korrelationsfähigkeit: `BEST_EFFORT`

Supabase Auth versendet Einladung und Passwort-Link über **SMTP**. GoTrue
erlaubt keine eigenen SMTP-Header (`X-Mailin-custom`, `X-Mailin-Tag`) und gibt
dem Aufrufer keine Provider-Message-ID zurück. Es gibt also **keinen von Nora
kontrollierten Korrelationswert in der Nachricht**.

Ein Brevo-Ereignis wird deshalb über die **Empfängeradresse** einer `sales`-Zeile
zugeordnet. Das identifiziert die Person zuverlässig, aber **nicht den einzelnen
Sendeversuch**. Jede Zeile trägt das explizit als `correlation_confidence`.

Zusätzlich wird die Mailart aus dem Betreff abgeleitet
(`Einladung zu Nora` → `employee_invite`,
`Persönliches Passwort für Nora einrichten` → `employee_password_setup`), sonst
`unknown`. Auch das ist Best-Effort: ändert jemand den Betreff im Dashboard ohne
die Zuordnung im Code, ist die Antwort `unknown` — degradiert, aber nie falsch.

**Folge für die UI (V1C-B):** zulässig ist „Zustellung“, unzulässig ist „diese
Einladung wurde zugestellt“.

### Mögliche spätere Architektur — separate Entscheidung, nicht Teil von V1C-A

Deterministische Korrelation wäre erreichbar über den Supabase **Send Email
Hook**: Supabase erzeugt den sicheren Link, Nora versendet selbst über die
Brevo-API und setzt dabei eine eigene Korrelations-ID bzw. Tags. Das ersetzt
den Auth-Mailversand und ist eine eigene Architekturentscheidung mit eigenem
Risiko — in dieser Welle bewusst **nicht** umgesetzt.

## 6. Architektur

```
Brevo  --HTTPS + Bearer-->  Edge Function brevo-email-events
                                   |
                                   v
                    public.ingest_email_delivery_event()   (SECURITY DEFINER, service_role)
                                   |
                                   v
                    public.email_delivery_events           (append-only)
                                   |
                                   v
                    public.employee_email_delivery_status() (admin-only Lesemodell für V1C-B)
```

- **Authentifizierung:** dedizierter Bearer-Token `BREVO_WEBHOOK_TOKEN`,
  konstantzeitiger Vergleich. Kein Nora-Benutzer-JWT (hinter einem
  Zustellereignis steht kein Benutzer), kein unauthentifizierter Endpunkt, und
  **niemals** der Brevo-API-Key als Webhook-Authentifizierung.
- **Idempotenz:** `dedupe_key` aus Message-ID, Provider-Ereignis-ID,
  Ereignisname, Empfänger und Zeitstempel; `on conflict do nothing`. Eine
  wiederholte Zustellung desselben Ereignisses erzeugt keine zweite Zeile.
- **Reihenfolge:** Ereignisse dürfen in beliebiger Reihenfolge eintreffen;
  `delivered` vor `sent` ist zulässig und wird nicht verworfen.
- **Antwortverhalten:** `401` fehlende/falsche Authentifizierung, `405` falsche
  Methode, `400` dauerhaft unbrauchbare Nutzlast (Retry hilft nicht), `500`
  Speicherfehler (Retry ist korrekt), `200` verstanden — ignorierte und
  doppelte Ereignisse zählen als behandelt.

### Was gespeichert wird

Provider, roher Ereignisname (nur Diagnose), Message-ID, Provider-Ereignis-ID,
Nora-Ereignistyp, Empfänger, aufgelöste `employee_sale_id` (weiche Referenz ohne
Fremdschlüssel), `recipient_match`, `correlation_confidence`, `mail_kind`,
gekürzter `reason`, `event_at`, `received_at`, `dedupe_key`.

### Was nicht gespeichert wird

Keine E-Mail-Inhalte, keine Betreffzeilen, keine Auth-Links, keine Einmal-Token,
keine Öffnungs-/Klickdaten, keine überflüssigen Provider-Felder.

### Zugriff

`email_delivery_events` hat RLS; `authenticated` besitzt nur `SELECT` und die
Policy verlangt zusätzlich `nora_private.is_admin()`. Normale Mitarbeiter sehen
die technische Zustellhistorie nicht. Es gibt **kein** `UPDATE`- und kein
`DELETE`-Grant für irgendeine Rolle — genau das macht die Tabelle append-only
(`service_role` umgeht RLS, aber keine Grants).

## 7. Manuelle Konfiguration (Operator)

Keiner dieser Werte darf in Chat, Quellcode oder Git landen.

### A. Supabase Dashboard → Project Settings → Authentication → SMTP Settings

| Feld | Wert |
|---|---|
| Enable Custom SMTP | an |
| Sender email | `zugang@nora.ergart.de` |
| Sender name | `Nora` |
| Host | Brevo SMTP-Relay-Host aus dem Brevo-Konto |
| Port | Brevo SMTP-Port (Submission, TLS) |
| Username | Brevo SMTP-Login |
| Password | Brevo SMTP-Key |

Ebenfalls im Dashboard zu prüfen: **Authentication → Email Templates** —
Betreff „Invite user“ = `Einladung zu Nora`, Betreff „Reset password“ =
`Persönliches Passwort für Nora einrichten`. Weichen die Betreffzeilen ab,
liefert die Mailart dauerhaft `unknown` (siehe Abschnitt 5).

### B. Supabase Dashboard → Edge Functions → Secrets

| Secret | Zweck |
|---|---|
| `BREVO_WEBHOOK_TOKEN` | eingehende Webhook-Authentifizierung; ausreichend langer Zufallswert, ausschließlich hierfür |

### C. Brevo → Webhook (nach dem Deployment der Edge Function)

- URL: `https://<projekt-ref>.supabase.co/functions/v1/brevo-email-events`
- Typ: transactional, Kanal: email
- Ereignisse: `request`, `delivered`, `deferred`, `softBounce`, `hardBounce`,
  `blocked`, `invalid`, `spam`
- **Nicht** abonnieren: `opened`, `uniqueOpened`, `click`, `unsubscribed`
- Authentifizierung: `auth: { "type": "bearer", "token": <BREVO_WEBHOOK_TOKEN> }`

### D. Optional — nur falls Nora die Brevo-Webhookkonfiguration selbst verwalten soll

| Secret | Zweck |
|---|---|
| `BREVO_API_KEY` | ausgehende Brevo-API-Verwaltung |

Für den reinen Empfang von Ereignissen wird der API-Key **nicht** benötigt und
sollte dann auch nicht gesetzt werden.
