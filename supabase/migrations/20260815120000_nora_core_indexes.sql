-- Nora CRM – Kernindizes für den geerbten Atomic-CRM-Datenbestand
--
-- Kontext: Die Nora-eigenen Tabellen (audit_events, operation_errors,
-- checklist_*, google_calendar_*) sind vollständig indiziert. Der von
-- Atomic CRM geerbte Kern (deals, tasks, contacts, companies) hatte nur
-- Primärschlüssel und zwei Fremdschlüsselindizes. Genau diese Tabellen
-- tragen aber die heißen Filter- und Sortierpfade von Nora.
--
-- Rein additiv: nur CREATE INDEX IF NOT EXISTS. Keine Tabellen-, Policy-
-- oder Funktionsänderung. Altes Frontend läuft unverändert weiter.
-- Kein Remote-Apply in diesem Commit.
--
-- Hinweis zu CONCURRENTLY: die Supabase-CLI umschließt Migrationen mit
-- einer Transaktion, CREATE INDEX CONCURRENTLY ist dort nicht erlaubt.
-- Bei der aktuellen Datenmenge liegt die Sperrdauer im Millisekunden-
-- bereich. Ab etwa 100k Zeilen je Tabelle wäre eine separate, nicht
-- transaktionale Migration nötig.

-- ---------------------------------------------------------------------------
-- deals — Kanban, Nachfassen, Zuständigkeit
-- ---------------------------------------------------------------------------

-- Kanban lädt je Spalte: filter stage + sort index, immer nicht archiviert.
-- Partieller zusammengesetzter Index deckt Filter und Sortierung gemeinsam ab.
create index if not exists deals_stage_index_active_idx
    on public.deals (stage, "index")
    where archived_at is null;

-- Hotboard / Nachfass-Badges: fällige und überfällige Vorgänge.
create index if not exists deals_expected_closing_active_idx
    on public.deals (expected_closing_date)
    where archived_at is null;

-- „Meine Vorgänge", Zuständigkeitsfilter, Aktivitätsliste.
create index if not exists deals_sales_id_idx
    on public.deals (sales_id)
    where sales_id is not null;

-- Archivliste (DealArchivedList lädt mit perPage 1000).
create index if not exists deals_archived_at_idx
    on public.deals (archived_at)
    where archived_at is not null;

-- Dashboard-Zählungen und Aktivitätsliste sortieren nach Anlagedatum.
create index if not exists deals_created_at_idx
    on public.deals (created_at desc);

-- ---------------------------------------------------------------------------
-- tasks — bisher ausschließlich Primärschlüssel
-- ---------------------------------------------------------------------------

-- tasks_contact_id_fkey ist ein Fremdschlüssel OHNE Index: jedes Löschen
-- eines Kontakts löst wegen ON DELETE CASCADE einen Seq-Scan über tasks aus.
create index if not exists tasks_contact_id_idx
    on public.tasks (contact_id);

-- TasksListByDueDate lädt offene Aufgaben und sortiert nach Fälligkeit.
create index if not exists tasks_due_date_open_idx
    on public.tasks (due_date)
    where done_date is null;

create index if not exists tasks_sales_id_idx
    on public.tasks (sales_id)
    where sales_id is not null;

-- ---------------------------------------------------------------------------
-- contacts / companies — Zuständigkeit und Aktivitätsliste
-- ---------------------------------------------------------------------------

create index if not exists contacts_sales_id_idx
    on public.contacts (sales_id)
    where sales_id is not null;

-- activity.ts sortiert Kontakte nach first_seen DESC.
create index if not exists contacts_first_seen_idx
    on public.contacts (first_seen desc);

create index if not exists companies_sales_id_idx
    on public.companies (sales_id)
    where sales_id is not null;

-- companies_summary aggregiert über created_at-Sortierung im Activity Log.
create index if not exists companies_created_at_idx
    on public.companies (created_at desc);

-- ---------------------------------------------------------------------------
-- Notiztabellen — Aktivitätsliste sortiert nach date DESC
-- ---------------------------------------------------------------------------

create index if not exists contact_notes_date_idx
    on public.contact_notes (date desc);

create index if not exists deal_notes_date_idx
    on public.deal_notes (date desc);

-- contactNotes_sales_id_fkey ist ON UPDATE CASCADE ON DELETE CASCADE und war
-- bisher ohne Index — dieselbe Falle wie tasks.contact_id: das Deaktivieren
-- oder Löschen eines Benutzers löst einen Seq-Scan über contact_notes aus.
-- dealNotes_sales_id_fkey ist zwar ohne Cascade, wird aber beim Prüfen der
-- Referenz ebenfalls ungedeckt gescannt.
create index if not exists contact_notes_sales_id_idx
    on public.contact_notes (sales_id)
    where sales_id is not null;

create index if not exists deal_notes_sales_id_idx
    on public.deal_notes (sales_id)
    where sales_id is not null;
