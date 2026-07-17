# 14 – Google Kalender Read-only (v0.4c)

**Status v0.4c.2:** OAuth + verschlüsselte Tokenablage + manueller Read-only-Sync implementiert  
**Migrationen:** `20260716120000_google_calendar_readonly.sql`, `20260717120000_google_calendar_oauth_sync.sql`  
**Tests:** `supabase/tests/google_calendar_verification.sql`, `supabase/functions/_shared/googleCalendar/*.test.ts`

> **Kein behaupteter OAuth-Erfolg**, solange der reale E2E-Test mit dem isolierten Testkalender nicht manuell abgeschlossen wurde.

---

## 1. System of Record

Google Kalender ist führend für Terminexistenz, Zeit, Titel, Ort und Serien. Nora speichert Cache, CRM-Verknüpfungen und Audit.

---

## 2. OAuth-Scopes (minimal, read-only)

| Scope | Zweck |
|-------|--------|
| `openid` | ID-Token / Account-Identität |
| `email` | Google-Konto-E-Mail |
| `https://www.googleapis.com/auth/calendar.events.owned.readonly` | Events lesen (owned) |
| `https://www.googleapis.com/auth/calendar.calendarlist.readonly` | **Nur serverseitig:** `CalendarList.get` für allowlistete Kalender-ID (accessRole/Owner-Prüfung). **Keine Kalenderliste in der UI.** |

Kein Schreib-Scope. Keine Gmail-Integration.

---

## 3. State + PKCE

| Mechanismus | Umsetzung |
|-------------|----------|
| OAuth-State | 32 Byte zufällig, nur **SHA-256-Hash** in `nora_private.google_oauth_states` |
| PKCE | S256-Challenge an Google; Verifier serverseitig in State-Zeile (TTL ≤ 10 min) |
| Bindung | State an `actor_auth_id` (`user_id`) |
| Consume | Atomar, einmalig (`consume_google_oauth_state`) |
| Redirect | Feste `GOOGLE_CALENDAR_OAUTH_REDIRECT_URI` (Edge Callback) |

---

## 4. Allowlist (Edge autoritativ)

1. `GOOGLE_CALENDAR_ALLOWED_ID` (Edge Secret) — **bindend**
2. `configuration.config.google_calendar.allowed_calendar_ids` — wird bei Connect synchronisiert, kann Edge-Allowlist **nicht erweitern**
3. `connection.calendar_id` muss übereinstimmen
4. Sync/API nutzen ausschließlich die allowlistete ID

Browser kann Kalender-ID nicht vorgeben.

---

## 5. Refresh-Token-Verschlüsselung

| Env | Zweck |
|-----|--------|
| `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY` | 32 Byte, Base64 — **nie `VITE_*`** |
| `GOOGLE_CALENDAR_TOKEN_KEY_VERSION` | z. B. `v1` |

Speicherung in `nora_private.google_calendar_oauth_secrets`:

- `refresh_token_ciphertext` (AES-GCM)
- `nonce` (12 Byte, Base64)
- `encryption_key_id`

**Nicht gespeichert:** Klartext-Refresh-Token, Access Token, Client Secret.

### Schlüsselrotation

1. Neues Secret + `GOOGLE_CALENDAR_TOKEN_KEY_VERSION=v2` setzen
2. Edge entschlüsselt mit passendem Key anhand `encryption_key_id`
3. Re-Connect oder manuelles Re-Encrypt (v0.4c.3+) — bestehende Zeilen behalten alte `encryption_key_id` bis Migration

---

## 6. Link-Pfad ohne GUC

- **`nora_calendar_linker`:** NOLOGIN, NOINHERIT, NOBYPASSRLS
- Interne SECURITY DEFINER-Funktionen (Owner: `nora_calendar_linker`):
  - `apply_google_calendar_event_links`
  - `clear_google_calendar_event_links`
- Öffentliche RPCs `link_/unlink_google_calendar_event` prüfen admin/office und delegieren
- Trigger `enforce_google_calendar_linker_column_scope` — nur CRM-FKs + `updated_at`
- **Kein** `nora.calendar_link_update` GUC

---

## 7. Manueller Read-only-Sync

Edge Function `calendar-sync-manual` (Admin):

- Fenster: **30 Tage zurück**, **365 Tage voraus**
- `singleEvents=true`, `showDeleted=true`, Pagination
- Ganztag über `date`, Zeittermin über `dateTime`
- Upsert: `(connection_id, google_event_id)`
- `calendar.event_imported` nur bei Erstimport
- `calendar.sync_completed` mit kompakten Summen (importiert/aktualisiert/unverändert/cancelled/errors/Zeitraum/Dauer)

Keine Google-Schreib-API-Aufrufe.

---

## 8. Datenminimierung (Pilot)

- `description_snapshot`: bevorzugt **NULL**, max. 500 Zeichen, HTML entfernt
- Keine Teilnehmer-E-Mails, Attachments, Meet-Tokens, Extended Properties

---

## 9. Audit (`retention_class = integration`)

| Code | Wann |
|------|------|
| `calendar.connected` | OAuth erfolgreich |
| `calendar.sync_started` | Manueller Sync beginnt |
| `calendar.sync_completed` | Sync erfolgreich (Summen) |
| `calendar.sync_failed` | Sync/OAuth-Fehler (ohne Tokens) |
| `calendar.event_imported` | Erstimport |
| `calendar.event_linked` / `calendar.event_unlinked` | CRM-RPC |

---

## 10. Edge Functions

| Function | Auth | Aufgabe |
|----------|------|---------|
| `calendar-connect-start` | Admin + JWT | OAuth-URL, State, PKCE, Connecting-Row |
| `calendar-connect-callback` | State/PKCE | Token-Austausch, CalendarList-Check, Redirect zur Admin-UI |
| `calendar-sync-manual` | Admin + JWT | Read-only-Sync |

Env (serverseitig): `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_ALLOWED_ID`, `GOOGLE_CALENDAR_OAUTH_REDIRECT_URI`, `GOOGLE_CALENDAR_TOKEN_ENCRYPTION_KEY`, `GOOGLE_CALENDAR_TOKEN_KEY_VERSION`, optional `GOOGLE_CALENDAR_ADMIN_RETURN_URL`.

---

## 11. Admin-UI

Route: `/google-kalender` — nur Admin.

- Verbindungsstatus, Google-E-Mail, Kalendername, letzter Sync/Fehler
- Buttons: Verbinden, Jetzt synchronisieren
- Testliste der zuletzt gecachten Events
- Demomodus: Hinweis ohne OAuth-Buttons

Hotboard-Termine: **v0.4c.3**

---

## 12. E2E-Abnahme (manuell — vom Betreiber mit echten Test-Credentials)

1. Edge-Secrets lokal setzen (nicht in Git)
2. Isolierten Google-Testkalender-ID in `GOOGLE_CALENDAR_ALLOWED_ID`
3. Als Admin `/google-kalender` öffnen → **Google Kalender verbinden**
4. Google-Zustimmung zeigt **nur Read-only-Scopes**
5. In Google: 2 Zeit-Termine, 1 Ganztag, 1 Serie anlegen
6. **Jetzt synchronisieren**
7. DB: `google_calendar_events` prüfen (Ganztag ohne Mitternachts-Timestamp)
8. Audit: `calendar.connected`, `calendar.sync_*`, `calendar.event_imported`
9. Termin in Google ändern → erneut synchronisieren → Cache aktualisiert
10. Verifizieren: Nora hat **keine** Google-Schreib-Requests ausgelöst

---

## 13. Verifikation (automatisiert)

```bash
npx supabase db reset --local
# production_check → first_admin_parallel → setup → matrix → final_hardening
# → checklists_audit → crm_audit → google_calendar → teardown → production_check
npm run test:unit:functions -- --run supabase/functions/_shared/googleCalendar
npm run typecheck && npm run build
```

---

## 14. Offene Punkte (v0.4c.3)

- Hotboard „Heute“ / „Nächste Termine“
- Disconnect-Flow
- Inkrementeller Sync (`syncToken`)
- Schlüsselrotation-Re-Encrypt-Tooling
