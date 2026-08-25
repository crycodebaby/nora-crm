-- Nora CRM – Core Indexes
-- Reconstructed 2026-08-25 to close a repo/production drift: this migration
-- was applied directly to nora-crm-prod (confirmed via read-only inspection,
-- `supabase migration list` on the remote project) but the file was never
-- committed to the repo. Content below matches the index definitions actually
-- present on production (`pg_indexes`), so `supabase db reset --local` now
-- mirrors production's real migration history and a future `supabase db push`
-- won't see a conflicting/missing remote migration.
--
-- Purely additive — performance indexes only, no data or behavior change.

create index if not exists companies_created_at_idx
    on public.companies using btree (created_at desc);

create index if not exists companies_sales_id_idx
    on public.companies using btree (sales_id)
    where (sales_id is not null);

create index if not exists contacts_first_seen_idx
    on public.contacts using btree (first_seen desc);

create index if not exists contacts_sales_id_idx
    on public.contacts using btree (sales_id)
    where (sales_id is not null);

create index if not exists contact_notes_date_idx
    on public.contact_notes using btree (date desc);

create index if not exists contact_notes_sales_id_idx
    on public.contact_notes using btree (sales_id)
    where (sales_id is not null);

create index if not exists deal_notes_date_idx
    on public.deal_notes using btree (date desc);

create index if not exists deal_notes_sales_id_idx
    on public.deal_notes using btree (sales_id)
    where (sales_id is not null);

create index if not exists deals_created_at_idx
    on public.deals using btree (created_at desc);

create index if not exists deals_sales_id_idx
    on public.deals using btree (sales_id)
    where (sales_id is not null);

create index if not exists deals_archived_at_idx
    on public.deals using btree (archived_at)
    where (archived_at is not null);

create index if not exists deals_expected_closing_active_idx
    on public.deals using btree (expected_closing_date)
    where (archived_at is null);

create index if not exists deals_stage_index_active_idx
    on public.deals using btree (stage, index)
    where (archived_at is null);

create index if not exists tasks_contact_id_idx
    on public.tasks using btree (contact_id);

create index if not exists tasks_sales_id_idx
    on public.tasks using btree (sales_id)
    where (sales_id is not null);

create index if not exists tasks_due_date_open_idx
    on public.tasks using btree (due_date)
    where (done_date is null);

create index if not exists google_calendar_connections_status_idx
    on public.google_calendar_connections using btree (status);

create index if not exists google_calendar_events_company_id_idx
    on public.google_calendar_events using btree (company_id)
    where (company_id is not null);

create index if not exists google_calendar_events_deal_id_idx
    on public.google_calendar_events using btree (deal_id)
    where (deal_id is not null);

create index if not exists google_calendar_events_connection_starts_idx
    on public.google_calendar_events using btree (connection_id, starts_at)
    where (deleted_at is null and is_all_day = false);

create index if not exists google_calendar_events_connection_start_date_idx
    on public.google_calendar_events using btree (connection_id, start_date)
    where (deleted_at is null and is_all_day = true);
