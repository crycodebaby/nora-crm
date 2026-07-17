# 11 – Google Kalender-Architektur und Nora-Rollenmodell (RBAC)

**Welle v0.4a** — Spezifikation  
**Status:** v0.4c.1 Grundlage implementiert — OAuth/Sync folgen v0.4c.2+ (siehe `14-google-calendar-readonly-implementation.md`)

Dieses Dokument spezifiziert die Google-Kalender-Integration und das Nora-Rollenmodell (`admin`, `office`, `viewer`) auf Basis des **bestehenden** Auth-/Benutzermodells. Es ergänzt `01-domain-model.md`, `03-data-model-guardrails.md`, `10-checklists-snippets-audit.md` und den Decision Log.

**Zielgruppe:** Implementierungs-Agenten in v0.4b ff. — damit keine parallele Benutzerverwaltung, kein zweites Terminsystem und keine Token-Leaks entstehen.

---

## 0. Ausgangslage (Ist-Analyse)

### 0.1 Kanonischer CRM-Benutzer

| Aspekt | Ist-Zustand |
|--------|-------------|
| Auth-Identität | Supabase Auth (`auth.users`, UUID) |
| CRM-Profil | **`public.sales`** (bigint PK) — **einzige** Benutzertabelle |
| Verknüpfung | `sales.user_id` → `auth.users.id` (1:1, unique) |
| App-Identity | React-admin nutzt **`sales.id`** (bigint), nicht `auth.users.id` |
| Privileg heute | `sales.administrator boolean` → App-Rolle `"admin"` / `"user"` |
| Admin-Prüfung DB | `public.is_admin()` — EXISTS auf `sales` mit `administrator = true` |
| Erster Nutzer | Sign-up nur wenn `init_state.is_initialized = 0`; erster `sales`-Datensatz erhält `administrator = TRUE` |
| Weitere Nutzer | Nur Admin über Edge Function `users` (service role) |
| Deaktivierung | `sales.disabled` + Auth-Ban über Edge Function — **nicht** in `checkAuth` geprüft |

**Regel v0.4a:** Keine zweite parallele Benutzerverwaltung. Rollen werden an **`sales`** angehängt, nicht in einer separaten User-Tabelle.

### 0.2 Bestehende RLS (Kern-CRM)

| Tabelle | SELECT | INSERT | UPDATE | DELETE |
|---------|--------|--------|--------|--------|
| `companies` | authenticated | authenticated | authenticated | authenticated |
| `contacts` | authenticated | authenticated | authenticated | authenticated |
| `deals` | authenticated | authenticated | authenticated | authenticated |
| `tasks` | authenticated | authenticated | authenticated | authenticated |
| `sales` | authenticated | — (entfernt) | — (entfernt) | — |
| `checklist_templates` / `_items` | authenticated | **is_admin()** | **is_admin()** | — |
| `checklist_runs` / `_items` | authenticated | authenticated | authenticated | — |
| `saved_text_snippets` | authenticated | authenticated | authenticated | — |
| `audit_events` | **admin only** (direkt); office via RPC | System only | blockiert | blockiert |
| `configuration` | authenticated | **is_admin()** | **is_admin()** | — |

**Befund:** Kern-CRM ist faktisch **Single-Tenant, alle authenticated = voller CRUD**. UI blockiert Nicht-Admins nur für `sales` und `configuration` (`canAccess.ts`) — **nicht API-sicher**.

### 0.3 Ownership-Felder (ohne RLS-Durchsetzung)

`companies.sales_id`, `contacts.sales_id`, `deals.sales_id`, `tasks.sales_id` werden per Trigger `set_sales_id_default()` auf den aktuellen Benutzer gesetzt — **Attribution**, kein Zugriffsschutz.

Checklisten/Audit nutzen **`auth.uid()`** (UUID) für `started_by`, `checked_by`, `actor_id` — nicht `sales.id`. Bei RBAC-Migration Angleichung dokumentieren (Abschnitt D).

---

## A. System-of-Record-Regel

| Domäne | Führendes System | Nora speichert |
|--------|------------------|----------------|
| Terminzeit (Start/Ende) | **Google Kalender** | Cache (`starts_at`, `ends_at`) |
| Titel, Ort | **Google Kalender** | Cache |
| Wiederholung / Serie | **Google Kalender** | Cache (`recurrence_rule` / JSON-Spiegel) |
| Existenz des Termins | **Google Kalender** | `google_event_id` + Sync-Status |
| CRM-Verknüpfung | **Nora** | `company_id`, `contact_id`, `deal_id` |
| Herkunft / Eigentum | **Nora** | `origin` (`google` \| `nora`) |
| Audit | **Nora** | `audit_events` |

**Kein zweites eigenständiges Nora-Terminmodell.** Keine Tabelle `appointments` als führende Quelle. `google_calendar_events` ist **Cache + Verknüpfung**, nicht paralleler Kalender.

**Abgrenzung zu bestehenden Feldern:**

- `deals.expected_closing_date` = **Nachfassdatum**, kein Kalendertermin
- `deals.stage = termin-vereinbart` = Vorgangsstatus, kein Ersatz für Kalender-Sync
- Hotboard „Heutige Termine“ (v0.4d) liest aus `google_calendar_events`, nicht aus `expected_closing_date`

---

## B. Kalender-Sicherheitsregeln

| Regel | Umsetzung |
|-------|-----------|
| **Genau eine** konfigurierte Geschäfts-Kalender-ID | Feld `google_calendar_connections.calendar_id` — Singleton pro Nora-Instanz |
| Kalender-ID **nicht** in UI-Komponenten hart codieren | Nur Konfiguration / DB / Edge-Function-Secrets |
| **Keine** private iCal-Adresse | Weder technisch noch in Doku verwenden |
| **Keine** öffentliche Embed-Integration | Kein iframe/öffentlicher Google-Embed |
| **Keine** Änderung von Kalenderfreigaben über Nora | Sharing bleibt manuell in Google Admin |
| **Keine** Änderung bestehender Labels/Farben in Google | Nora liest/schreibt Event-Felder, nicht Kalender-Metadaten |
| Bestehende Google-Termine zunächst **read-only** in Nora | `origin = google` → kein PATCH/DELETE Richtung Google in v0.4c–d |
| Nora darf später nur **eindeutig Nora-eigene** Termine ändern/löschen | `origin = nora` + Extended Properties in Google |
| Testkalender separat angelegt | ID wird in v0.4c konfiguriert, nicht im Repo hardcodiert |

---

## C. Rollenmodell

### C.1 Rollen

| Rolle | Zielnutzer | Kurzbeschreibung |
|-------|------------|------------------|
| `admin` | Chef / IT | Vollzugriff CRM, Kalender verbinden, Rollen verwalten |
| `office` | Sekretärin / Büro | Operativer CRM-Alltag, Termine lesen/erstellen, Nora-Termine bearbeiten |
| `viewer` | extern / schreibgeschützt | Nur Lesen — Hotboard, Akten, Termine |

**Zielrolle Sekretärin:** `office`.

### C.2 Mapping vom Ist-Zustand

| Heute | Ziel v0.4b |
|-------|------------|
| `sales.administrator = true` | `role = admin` |
| `sales.administrator = false` | `role = viewer` (Least Privilege; **kein** automatisches `office`) |
| — | `role = office` nur für explizit benannte und geprüfte Nutzer |

`administrator` bleibt in v0.4b **übergangsweise** synchronisiert (`administrator = (role = 'admin')`) — Entfernung erst nach UI/Edge-Function-Migration.

### C.3 Berechtigungsmatrix

Legende: ✅ erlaubt · 🔶 eingeschränkt · ❌ verboten · ⚙️ nur Admin · 🔧 System/Edge Function

| Aktion | admin | office | viewer |
|--------|:-----:|:------:|:------:|
| **Kunden** lesen | ✅ | ✅ | ✅ |
| Kunden anlegen | ✅ | ✅ | ❌ |
| Kunden bearbeiten | ✅ | ✅ | ❌ |
| Kunden löschen/archivieren | ✅ | 🔶 | ❌ |
| **Kontakte** lesen | ✅ | ✅ | ✅ |
| Kontakte anlegen | ✅ | ✅ | ❌ |
| Kontakte bearbeiten | ✅ | ✅ | ❌ |
| Kontakte löschen | ✅ | 🔶 | ❌ |
| **Vorgänge** lesen | ✅ | ✅ | ✅ |
| Vorgänge anlegen | ✅ | ✅ | ❌ |
| Vorgänge bearbeiten (Status, Felder) | ✅ | ✅ | ❌ |
| Vorgänge archivieren | ✅ | ✅ | ❌ |
| Vorgänge löschen | ✅ | 🔶 | ❌ |
| **Aufgaben** lesen | ✅ | ✅ | ✅ |
| Aufgaben anlegen/erledigen | ✅ | ✅ | ❌ |
| Aufgaben löschen | ✅ | 🔶 | ❌ |
| **Checklisten** lesen | ✅ | ✅ | ✅ |
| Checkliste starten / Punkte haken | ✅ | ✅ | ❌ |
| Checklisten-**Vorlagen** bearbeiten | ✅ | ❌ | ❌ |
| **Textbausteine** lesen | ✅ | ✅ | ✅ |
| Textbausteine anlegen (Plus) | ✅ | ✅ | ❌ |
| Textbausteine deaktivieren (Minus) | ✅ | 🔶 | ❌ |
| **Audit** global lesen (`/audit`) | ✅ | ❌ | ❌ |
| **Audit** in Akte lesen | ✅ | ✅ | ❌ |
| Audit schreiben/löschen | 🔧 | 🔧 | 🔧 |
| **Kalender** Termine lesen | ✅ | ✅ | ✅ |
| Kalendertermin **erstellen** (Nora → Google) | ✅ | ✅ | ❌ |
| Termin mit Kunde/Vorgang **verknüpfen** | ✅ | ✅ | ❌ |
| **Nora-Termin** bearbeiten | ✅ | ✅ | ❌ |
| **Nora-Termin** löschen | ✅ | ✅ | ❌ |
| **Google-Termin** bearbeiten (fremd) | ❌* | ❌* | ❌ |
| **Kalenderverbindung** verwalten (OAuth) | ⚙️ | ❌ | ❌ |
| **Nutzerrollen** verwalten | ⚙️ | ❌ | ❌ |
| Nutzer einladen / deaktivieren | ⚙️ | ❌ | ❌ |
| App-**Konfiguration** | ⚙️ | ❌ | ❌ |

\* v0.4a–f: Google-Termine (`origin = google`) sind **read-only** für alle Rollen in Nora. Spätere Bearbeitung fremder Google-Termine ist **offene Entscheidung** (Abschnitt L).

**🔶 Eingeschränkt (offen, Tendenz):**

- `office` löscht Kunden/Vorgänge nicht physisch — nur **archivieren** / Status „abgeschlossen“
- `office` deaktiviert nur **eigene** Textbausteine
- ~~`viewer` sieht Audit nur auf verknüpften Kunden/Vorgängen~~ — **entschieden v0.3l:** Viewer kein Audit-Zugriff

### C.4 Audit-Zugriff (Stand v0.3l)

| Mechanismus | admin | office | viewer |
|-------------|:-----:|:------:|:------:|
| Direktes `SELECT` auf `audit_events` | ✅ | ❌ | ❌ |
| RPC `get_entity_audit_events` | ✅ | ✅ | ❌ |
| RPC `get_global_audit_events` | ✅ | ❌ | ❌ |
| UI `/audit` | ✅ | ❌ | ❌ |
| UI `EntityAuditHistory` in Akte | ✅ | ✅ | ❌ |

Office liest Audit **ausschließlich** über die kontrollierte RPC — kein globales Durchsuchen der Tabelle. Geplante `calendar.*`-Events (Abschnitt J) nutzen dieselbe `audit_events`-Tabelle und dieselben Lese-Regeln.

---

## D. Technische RBAC-Optionen

### D.1 Vergleich

| Option | Beschreibung | Pro | Contra |
|--------|--------------|-----|--------|
| **A) Rolle an `sales`** | `sales.role text` mit CHECK (`admin`,`office`,`viewer`) | Eine Quelle, passt zu 1:1 Auth-Modell, einfache Migration | Jede Policy braucht JOIN/Subquery auf `sales` |
| **B) `user_roles` + `role_permissions`** | Normalisierte Rollen-Tabellen | Flexibel für viele Rollen/Rechte | Overkill für 3 Rollen; zweite Benutzer-Dimension |
| **C) JWT Custom Claims** | Supabase Auth Hook setzt `role` im Token | Schnelle RLS ohne JOIN | Keine Live-Änderung ohne Re-Login; zweite Wahrheit wenn nicht synchron |
| **D) RLS mit DB-Abfrage** | `current_nora_role()` liest `sales.role` per `auth.uid()` | Immer aktuell | JOIN-Kosten pro Policy |
| **E) Hybrid DB + JWT** | DB = Wahrheit; Hook spiegelt `role` ins JWT für RLS | Performance + Aktualität via Hook bei Rollenänderung | Etwas mehr Infrastruktur |

### D.2 Empfehlung (v0.4b)

**Option A + D als Primärmodell**, optional **E** ab v0.4c wenn Policy-Performance relevant wird.

```text
auth.users.id
    → sales.user_id (unique)
    → sales.role ∈ { admin, office, viewer }
    → public.current_nora_role()  -- SECURITY DEFINER, stable
    → public.has_nora_role(text[])  -- Hilfsfunktion für RLS
```

**Nicht empfohlen:**

- Separate `profiles`- oder `crm_users`-Tabelle — bricht kanonisches `sales`-Modell
- `user_roles` für nur 3 statische Rollen
- JWT allein ohne DB-Rückfall

### D.3 Konkrete Migrationsbausteine (v0.4b → v0.4b.1 implementiert)

| Baustein | Inhalt |
|----------|--------|
| Spalte | `sales.role text not null default 'viewer'` + CHECK-Constraint |
| Backfill | `administrator = true` → `role = 'admin'`; sonst `role = 'viewer'`; `office` nur manuell |
| Internes Schema | `nora_private` — Helper nicht in PostgREST (`config.toml` schemas) |
| Funktionen (intern) | `safe_auth_uid()`, `is_active_user()`, `current_role()`, `has_role()`, `can_write()`, `is_admin()` |
| Öffentliche RPCs | `set_sales_role_by_admin`, `start_checklist_run_from_template` |
| `search_path` | `''` auf SECURITY DEFINER; vollständig schemaqualifiziert |
| GUC | ~~GUC-Token~~ → **`nora_role_manager`** Capability (v0.4b.2) |
| View | `sales_directory` — reduzierte Teamliste (v0.4b.2) |
| RLS Kern-CRM | Tiered policies über `nora_private.*` |
| Edge Function `users` | `set_sales_role_by_admin` RPC |
| Frontend `canAccess` | Matrix aus Abschnitt C |
| Testrolle | **nur lokal** — `rbac_rls_setup.sql` / `teardown.sql`, nie in Migration |
| Actor-ID | Kurzfristig `auth.uid()` in Policies/RPCs |

### D.3.1 SECURITY DEFINER-Inventar (Stand v0.4b.1)

| Funktion | Owner | EXECUTE | Data-API | Grund SECURITY DEFINER |
|----------|-------|---------|----------|------------------------|
| `nora_private.safe_auth_uid` | postgres | authenticated, service_role | nein | Safe JWT-sub (invalid → NULL) |
| `nora_private.is_active_user` | postgres | authenticated, service_role | nein | sales-Lookup für RLS |
| `nora_private.current_role` | postgres | authenticated, service_role | nein | Rolle für RLS |
| `nora_private.has_role` | postgres | authenticated, service_role | nein | Matrix-Check für RLS |
| `nora_private.can_write` | postgres | authenticated, service_role | nein | office/admin für RLS |
| `nora_private.is_admin` | postgres | authenticated, service_role | nein | admin für RLS |
| `public.set_sales_role_by_admin` | postgres | authenticated, service_role | ja | Delegiert an `apply_sales_role_change` |
| `nora_private.apply_sales_role_change` | **nora_role_manager** | postgres only | nein | Privileg-UPDATE als Capability-Owner |
| `nora_private.resolve_first_signup_role` | postgres | (intern) | nein | Advisory lock für ersten Admin |
| `public.handle_new_user` | postgres | (Trigger) | nein | sales bei Auth-Signup |

`anon` hat kein EXECUTE auf interne Helper und keinen Tabellen-GRANT auf CRM-Tabellen.

### D.4 Keine doppelte Rollenquelle

| Quelle | Status |
|--------|--------|
| `sales.role` | ✅ **einzige führende Quelle** |
| `sales.administrator` | ⚠️ Deprecated-Spiegel bis v0.5 |
| JWT `app_metadata.role` | optional Spiegel, nie führend |
| Frontend `canAccess` | UI-Guard, spiegelt DB — kein eigenes Rechtemodell |

---

## E. Kalender-Datenmodell (Spezifikation)

Neue Tabellen dürfen **UUID** als PK nutzen. FKs zu `companies`, `contacts`, `deals` sind **`bigint`**.

### E.1 `google_calendar_connections`

**Zweck:** Singleton-Verbindungsstatus zum **einen** Geschäftskalender. Enthält **keine** Tokens.

| Spalte | Typ | Pflicht | Hinweis |
|--------|-----|---------|---------|
| `id` | `uuid` | ✅ | PK, `gen_random_uuid()` |
| `calendar_id` | `text` | ✅ | Google Calendar ID des Geschäftskalenders |
| `calendar_summary` | `text` | | Cache: Anzeigename aus Google (read-only Info) |
| `status` | `text` | ✅ | `disconnected` \| `connected` \| `error` \| `token_expired` |
| `scopes_granted` | `text[]` | ✅ | z. B. `{calendar.events.owned.readonly}` |
| `connected_by` | `uuid` | | FK → `auth.users` — wer OAuth abgeschlossen hat |
| `connected_at` | `timestamptz` | | |
| `disconnected_at` | `timestamptz` | | |
| `last_sync_at` | `timestamptz` | | |
| `last_sync_status` | `text` | | `success` \| `failed` \| `partial` |
| `last_sync_error` | `text` | | keine Tokens, nur Fehlermeldung |
| `sync_token` | `text` | | später für inkrementellen Sync (v0.4g) |
| `created_at` | `timestamptz` | ✅ | |
| `updated_at` | `timestamptz` | ✅ | |

**Constraints / Indexe:**

- Partial unique: **max. eine** Zeile mit `status = 'connected'` (oder strikt Singleton: nur 1 Zeile gesamt — Entscheidung L.8)
- Index auf `status`
- **Kein** Refresh Token in dieser Tabelle

**RLS (Ziel):**

| Operation | admin | office | viewer |
|-----------|-------|--------|--------|
| SELECT | ✅ | ✅ (read-only Metadaten) | ✅ (read-only) |
| INSERT/UPDATE/DELETE | ✅ | ❌ | ❌ |

**Löschverhalten:** `ON DELETE` — keine FK-Kinder; Disconnect setzt `status = 'disconnected'`, löscht Tokens in Secret-Ablage. Zeile historisch behalten oder soft-delete — Tendenz: **behalten** für Audit.

**Audit:** `calendar.connected`, `calendar.disconnected` (Abschnitt J).

### E.2 `google_calendar_events`

**Zweck:** Gespiegelte Google-Events + Nora-CRM-Verknüpfung.

| Spalte | Typ | Pflicht | Hinweis |
|--------|-----|---------|---------|
| `id` | `uuid` | ✅ | PK |
| `google_event_id` | `text` | ✅ | Google Event ID |
| `google_calendar_id` | `text` | ✅ | muss = `connections.calendar_id` |
| `origin` | `text` | ✅ | `google` \| `nora` — CHECK |
| `title` | `text` | | Cache |
| `location` | `text` | | Cache |
| `starts_at` | `timestamptz` | ✅ | Cache — Hotboard-Queries |
| `ends_at` | `timestamptz` | ✅ | Cache |
| `is_all_day` | `boolean` | ✅ | default `false` |
| `timezone` | `text` | | IANA, z. B. `Europe/Berlin` |
| `recurrence_rule` | `text` | | RRULE-Zusammenfassung oder NULL |
| `recurring_event_id` | `text` | | Master-Series-ID bei Instanzen |
| `status` | `text` | | `confirmed` \| `tentative` \| `cancelled` |
| `etag` | `text` | | Google ETag für Optimistic Concurrency (v0.4f) |
| `html_link` | `text` | | Link zur Google-UI — **nicht** iCal |
| `extended_properties_private` | `jsonb` | | Spiegel Nora-Metadaten aus Google Extended Properties |
| `company_id` | `bigint` | | FK → `companies.id` |
| `contact_id` | `bigint` | | FK → `contacts.id` |
| `deal_id` | `bigint` | | FK → `deals.id` |
| `linked_by` | `uuid` | | `auth.uid()` beim Verknüpfen |
| `linked_at` | `timestamptz` | | |
| `synced_at` | `timestamptz` | ✅ | letzter erfolgreicher Cache-Refresh |
| `created_at` | `timestamptz` | ✅ | |
| `updated_at` | `timestamptz` | ✅ | |

**Constraints / Indexe:**

- `UNIQUE (google_calendar_id, google_event_id)`
- Index `(starts_at)` — Hotboard „Heute“
- Index `(deal_id)` WHERE `deal_id IS NOT NULL`
- Index `(company_id)` WHERE `company_id IS NOT NULL`
- Index `(origin, starts_at)`
- Optional: Index auf `(recurring_event_id)` für Serien

**FK-Löschverhalten:**

- `company_id`, `contact_id`, `deal_id`: `ON DELETE SET NULL` — Event bleibt im Kalender-Cache, Verknüpfung fällt weg
- Kein `ON DELETE CASCADE` auf Google-Events

**RLS (Ziel):**

| Operation | admin | office | viewer |
|-----------|-------|--------|--------|
| SELECT | ✅ | ✅ | ✅ |
| UPDATE Verknüpfung (`company_id`/`contact_id`/`deal_id`) | ✅ | ✅ | ❌ |
| INSERT (Nora-Termin anlegen) | ✅ | ✅ | ❌ |
| UPDATE Cache-Felder (Titel, Zeit, …) | 🔧 | 🔧 | ❌ |
| DELETE Zeile | 🔧 | 🔧** | ❌ |

\*\* office darf nur `origin = nora` löschen (über RPC/Edge Function, nicht direktes DELETE aller Events)

**Sync-Schreiben:** Cache-Updates (`title`, `starts_at`, `etag`, …) ausschließlich durch **Edge Function / service_role** — nicht durch Browser-Client.

**Audit:** `calendar.event_linked`, `calendar.event_created`, `calendar.event_updated`, `calendar.event_deleted`, `calendar.sync_completed`, `calendar.sync_failed`.

### E.3 Veralteter Kandidat `appointments`

Die Guardrails-Liste enthielt `appointments` als Kandidaten — **verworfen** zugunsten von `google_calendar_events`. Kein paralleles Modell einführen.

---

## F. Secret-Modell

| Secret | Ablage | Zugriff |
|--------|--------|---------|
| Google **Client ID** | Edge Function Env (öffentlich im OAuth-Flow) | Edge Functions |
| Google **Client Secret** | **Nur** Supabase Edge Function Secrets | Edge Functions |
| **Refresh Token** | Verschlüsselte Secret-Ablage (Supabase Vault oder dedizierte Tabelle, nur `service_role`) | Edge Functions |
| **Access Token** | Kurzlebig im Function-Memory | nie persistieren |
| OAuth **State** / PKCE | Function-Memory oder kurzlebige DB-Zeile ohne Token | Edge Functions |

**Verboten:**

- Tokens im **Frontend** / `localStorage` / React-State persistieren
- Tokens in **`audit_events`** (`old_data`/`new_data`/`metadata`)
- Tokens in **`google_calendar_connections`** oder **`google_calendar_events`**
- **`service_role`** im Browser oder in `VITE_*` Env-Vars
- Private **iCal-URL** als Sync-Ersatz

**Empfohlene Secret-Tabelle (v0.4c, optional):**

`google_calendar_oauth_secrets` — nur `service_role` GRANT, RLS deny all, Spalte `refresh_token_encrypted` + `connection_id` FK. Alternativ: Supabase Vault Secret pro Instanz.

---

## G. OAuth-Phasen

| Phase | Scope | Welle |
|-------|-------|-------|
| Read-only | `https://www.googleapis.com/auth/calendar.events.owned.readonly` | v0.4c |
| Write (eigene Events) | `https://www.googleapis.com/auth/calendar.events.owned` | v0.4e–f |
| **Nicht** | Voller `calendar`-Scope | — |
| **Nicht** | `calendar.readonly` auf alle Kalender | — |

**Regeln:**

- Genau **ein** Test-/Geschäftskalender — ID in `google_calendar_connections.calendar_id`
- OAuth-Flow nur für **`admin`** (Kalenderverbindung verwalten)
- Scope-Erweiterung read → write ist **eigene Welle** (v0.4e) mit Re-Consent
- Kein Google Workspace Domain-Wide Delegation in v0.4 — nur OAuth des verbindenden Admin-Kontos

---

## H. Sync-Modell (stufenweise)

| Stufe | Welle | Beschreibung |
|-------|-------|--------------|
| 1 — Manueller read-only Sync | v0.4c | Admin/Function-Trigger „Jetzt synchronisieren“; `events.list` mit Zeitfenster |
| 2 — Periodischer Sync | v0.4d | Cron/scheduled Edge Function (z. B. alle 15 min); Fehler in `last_sync_error` |
| 3 — `syncToken` | v0.4g | Inkrementell; `google_calendar_connections.sync_token` |
| 4 — Google Push (Webhook) | v0.4g | `channels.watch` + Verification; Channel-Renewal |

**Sync-Verhalten:**

- Upsert in `google_calendar_events` per `(google_calendar_id, google_event_id)`
- Gelöschte Events in Google → `status = cancelled` oder Zeile entfernen (Entscheidung L.9)
- Nora-Verknüpfungen bei Re-Sync **erhalten** (nur Cache-Felder überschreiben)
- Kein Sync in v0.4a

---

## I. Termin-Eigentum

### I.1 `origin`-Werte

| `origin` | Bedeutung | Nora-Schreiben | Google-Schreiben |
|----------|-----------|----------------|------------------|
| `google` | In Google angelegt, von Nora gespiegelt | Nur Verknüpfung | read-only (v0.4c–d) |
| `nora` | Über Nora angelegt | Bearbeiten/Löschen (office/admin) | über API mit `calendar.events.owned` |

### I.2 Nora-Metadaten in Google

Nora-eigene Termine erhalten **versteckte Extended Properties** (private):

```json
{
  "nora_origin": "nora",
  "nora_event_id": "<uuid>",
  "nora_deal_id": "12345",
  "nora_company_id": "42"
}
```

**Erkennungsregel:** Beim Sync hat ein Event `origin = nora`, wenn `extendedProperties.private.nora_origin = nora` gesetzt ist — auch nach Export aus Nora.

### I.3 Bearbeitungsregeln

| Aktion | `origin = google` | `origin = nora` |
|--------|-------------------|-----------------|
| Lesen / Hotboard | ✅ alle Rollen | ✅ alle Rollen |
| CRM-Verknüpfung setzen | admin, office | admin, office |
| Titel/Zeit ändern | ❌ (v0.4a–f) | admin, office (v0.4f) |
| Löschen | ❌ | admin, office + **Bestätigungsdialog** |
| Google-Labels/Farben ändern | ❌ | ❌ |

### I.4 Konfliktschutz (v0.4f)

- `etag` bei jedem Sync speichern
- Update an Google mit `If-Match: etag`
- Bei 412 Precondition Failed → UI-Hinweis „Termin wurde extern geändert“ + Refresh

---

## J. Audit (`audit_events`)

Bestehende Tabelle — **keine neue Audit-Tabelle**. CRM-Audit (v0.3l) und Checklisten-Audit (v0.3d2) teilen sich dieselbe append-only-Tabelle; Kalender-Events folgen dem gleichen Muster.

### J.1 Neue `event_type`-Werte

| `event_type` | Auslöser | `entity_type` |
|--------------|----------|---------------|
| `calendar.connected` | OAuth erfolgreich, `connections.status = connected` | `google_calendar_connection` |
| `calendar.disconnected` | Admin trennt Verbindung | `google_calendar_connection` |
| `calendar.sync_completed` | Sync erfolgreich | `google_calendar_connection` |
| `calendar.sync_failed` | Sync-Fehler | `google_calendar_connection` |
| `calendar.event_linked` | CRM-FKs gesetzt/geändert | `google_calendar_event` |
| `calendar.event_created` | Nora legt Termin an | `google_calendar_event` |
| `calendar.event_updated` | Nora ändert Nora-Termin | `google_calendar_event` |
| `calendar.event_deleted` | Nora löscht Nora-Termin | `google_calendar_event` |

### J.2 Audit-Felder

| Feld | Verwendung |
|------|------------|
| `entity_id` | `nora_entity_uuid('google_calendar_event', id)` oder direkt UUID des Event-Datensatzes |
| `company_id`, `contact_id`, `deal_id` | Kontext aus Verknüpfung |
| `metadata` | `{ "google_event_id": "...", "origin": "nora" }` — **ohne Tokens** |
| `actor_id` | `auth.uid()` des auslösenden Nutzers |

Schreiben nur über **SECURITY DEFINER** / Trigger / Edge Function — analog bestehendem Checklisten-Audit.

---

## K. Phasenplan

| Phase | Inhalt | Abhängigkeiten |
|-------|--------|----------------|
| **v0.4a** | Spezifikation (dieses Dokument) | ✅ |
| **v0.4b** | RBAC-Migration: `sales.role`, RLS, `canAccess`, Edge Function `users` | v0.4a |
| **v0.4c** | Google OAuth read-only, manueller Sync, `google_calendar_*` Tabellen | v0.4b |
| **v0.4d** | Hotboard-Terminkarten, periodischer Sync | v0.4c |
| **v0.4e** | Nora-Termine erstellen (write scope) | v0.4c, Re-Consent |
| **v0.4f** | Nora-Termine ändern/löschen, ETag-Konflikte | v0.4e |
| **v0.4g** | `syncToken`, Google Push Webhooks | v0.4d |

**Bewusst nicht in v0.4a:** Migration, Edge Functions, OAuth, UI, Secrets.

---

## L. Offene Entscheidungen

| # | Frage | Optionen | Tendenz v0.4a |
|---|-------|----------|---------------|
| L.1 | Welche Tabelle repräsentiert einen Benutzer? | `sales` vs. neue Tabelle | **`sales`** (bestätigt) |
| L.2 | Wer erhält initial `admin`? | Erster Sign-up vs. manuell | **Erster Sign-up** bleibt; Backfill `administrator=true` → `role=admin` |
| L.3 | Darf `office` Kunden/Vorgänge **löschen**? | Löschen vs. nur archivieren | **Nur archivieren** — kein physisches DELETE |
| L.4 | Darf `office` **bestehende Google-Termine** später bearbeiten? | Nie / nur Verknüpfung / mit Einschränkung | **Nur Verknüpfung**; Bearbeitung in Google direkt |
| L.5 | Kalender zusätzlich mit Sekretärin bei **Google** teilen? | Ja (empfohlen) / nur Nora | **Ja** — Google-Sharing unabhängig von Nora; Nora-OAuth bleibt Admin-Konto |
| L.6 | Welche **Eventtypen** in Nora anzeigen? | Alle / ohne transparente / ohne ganztägig | **Alle bestätigten** im Zeitfenster; `cancelled` ausblenden |
| L.7 | **Wiederkehrende Termine** darstellen? | Master only / expandierte Instanzen / beides | **Expandierte Instanzen** im Sync-Zeitfenster; `recurring_event_id` für Gruppierung |
| L.8 | `google_calendar_connections` Singleton | Strikt 1 Zeile vs. Historie mehrerer Zeilen | **Historie** mit max. 1× `status=connected` |
| L.9 | Gelöschte Google-Events | Zeile löschen vs. `status=cancelled` | **`cancelled` + aus Hotboard filtern** |
| L.10 | `viewer` Audit-Zugriff | Voller Audit vs. kontextbezogen vs. keiner | **Kein Zugriff** (v0.3l) |
| L.11 | JWT Custom Claim für Rolle | Ja (Hybrid) vs. nur DB | **Erst DB**; Hybrid optional wenn Performance-Problem |
| L.12 | `sales.administrator` entfernen | v0.4b / v0.5 / nie | **Deprecated-Spiegel bis v0.5** |
| L.13 | Demo/FakeRest Kalender | Stub vs. deaktiviert | **Deaktiviert** mit Hinweis (wie Checklisten in Demo) |
| L.14 | Hotboard-Zeitfenster | Heute / heute+morgen / 7 Tage | **Heute + morgen** (operativer Büro-Alltag) |

---

## M. Anti-Duplizierungsregeln

| ❌ Nicht | ✅ Stattdessen |
|----------|----------------|
| Zweites Terminsystem (`appointments`) | `google_calendar_events` als Cache |
| Private iCal-URL | Google Calendar API mit OAuth |
| Kalender-ID in React-Komponenten | `google_calendar_connections` / Konfiguration |
| Tokens in `audit_events` | Nur Event-Metadaten ohne Secrets |
| Parallele Benutzerverwaltung | `sales.role` |
| `expected_closing_date` als Terminersatz | Kalender-Cache für Hotboard |
| Google-Labels/Farben über Nora ändern | Unverändert in Google belassen |
| Alle Google-Termine editierbar | Nur `origin = nora` |

---

## N. Referenzen

| Dokument / Code | Inhalt |
|-----------------|--------|
| `01-domain-model.md` | Domänenbegriffe, geplante Kalender-Erweiterung |
| `03-data-model-guardrails.md` | Falle 17 (Google als Prozesskern), Termin-Guardrails |
| `06-decision-log.md` | Entscheidung v0.4a |
| `07-agent-change-checklist.md` | RBAC- und Kalender-Checklisten |
| `10-checklists-snippets-audit.md` | Audit-Muster, `is_admin()` |
| `supabase/schemas/01_tables.sql` | `sales`, `audit_events` |
| `supabase/schemas/05_policies.sql` | Bestehende RLS |
| `src/.../canAccess.ts` | UI-Rollenmatrix (spiegelt RLS, ersetzt sie nicht) |
| `src/.../normalizeCrmError.ts` | Fehlerübersetzung für UI (v0.3k) |
| `src/.../NoraReadOnlyBanner.tsx` | Viewer-Lesemodus (kompakt ab v0.3k.1) |
| `src/.../NoraAccessGuard.tsx` | Edit-Route-Redirects (v0.3k.1) |
| `src/.../NoraDialogContent.tsx` | Dirty-Close für Modals (v0.3k.1) |
| `src/.../NoraShowBoundary.tsx` | Show-Lade-/Fehlerzustände (v0.3k.1) |
| `src/.../ImportPage.tsx` | JSON-Import — nur Admin bis Assistent (v0.3k.1) |
| `src/.../demoSession.ts` | Kanonische FakeRest-Demo-Session (v0.3k.2) |
| `src/.../DemoRoleSwitcher.tsx` | Demo-Rollentest (nur FakeRest) |
