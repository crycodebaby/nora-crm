-- Nora Performance Hygiene Wave (2026-09-03)
--
-- Supabase Performance Advisor findings, assessed 2026-09-03:
--
-- 1. auth_rls_initplan (WARN): three policies call auth.uid() directly in
--    their USING/WITH CHECK expression. Postgres then evaluates auth.uid()
--    once per candidate row instead of once per statement. Wrapping the call
--    as (select auth.uid()) turns it into an InitPlan that is evaluated a
--    single time. Semantics are identical — auth.uid() is STABLE and cannot
--    change within a statement.
--
-- 2. unindexed_foreign_keys (INFO): four FK columns outside the 2026-08-15
--    core index wave lack a covering index. Nullable FK columns get partial
--    indexes (matching the google_calendar_events_company_id_idx style);
--    NOT NULL columns get plain btree indexes.
--
-- No grants, no projection, no security semantics change — the policy
-- expressions are byte-identical apart from the (select ...) wrapping, so the
-- 2026-08-28 Security Advisor assessment remains valid.

-- ---------------------------------------------------------------------------
-- 1. RLS initplan fixes
-- ---------------------------------------------------------------------------

drop policy if exists "Sales select own or admin" on public.sales;
create policy "Sales select own or admin" on public.sales
    for select to authenticated
    using (
        nora_private.is_active_user()
        and (user_id = (select auth.uid()) or nora_private.is_admin())
    );

drop policy if exists "Sales update own profile" on public.sales;
create policy "Sales update own profile" on public.sales
    for update to authenticated
    using (nora_private.is_active_user() and user_id = (select auth.uid()))
    with check (nora_private.is_active_user() and user_id = (select auth.uid()));

drop policy if exists "Saved text snippets update writers" on public.saved_text_snippets;
create policy "Saved text snippets update writers" on public.saved_text_snippets
    for update to authenticated
    using (
        nora_private.is_admin()
        or (nora_private.has_role(array['office']) and created_by = (select auth.uid()))
    )
    with check (
        nora_private.is_admin()
        or (nora_private.has_role(array['office']) and created_by = (select auth.uid()))
    );

-- ---------------------------------------------------------------------------
-- 2. Missing FK covering indexes
-- ---------------------------------------------------------------------------

create index if not exists checklist_run_items_template_item_id_idx
    on public.checklist_run_items using btree (template_item_id)
    where template_item_id is not null;

create index if not exists checklist_runs_contact_id_idx
    on public.checklist_runs using btree (contact_id)
    where contact_id is not null;

create index if not exists checklist_runs_template_id_idx
    on public.checklist_runs using btree (template_id);

create index if not exists google_calendar_events_contact_id_idx
    on public.google_calendar_events using btree (contact_id)
    where contact_id is not null;
