--
-- Grants
-- Declarative record of the grants and default privileges of the public schema.
--
-- ===========================================================================
-- THIS FILE IS NOT EXECUTED. MIGRATIONS ARE AUTHORITATIVE.
-- ===========================================================================
-- `supabase/config.toml` does not configure `[db.migrations] schema_paths`, so
-- neither `supabase db reset` nor the e2e stack ever runs `supabase/schemas/*.sql`.
-- Only `supabase/migrations/` touches a real database. This file exists to keep a
-- readable, reviewable picture of the intended end state next to the schema; it
-- must be kept in sync with the migrations (07-agent-change-checklist.md), and it
-- must never be treated as the source of truth for a privilege question. Verify
-- privilege claims against the database (`pg_class.relacl`, `pg_default_acl`,
-- `has_table_privilege`), never against this file.
--
-- Aligned with the target matrix of
-- `20260907120000_nora_public_privilege_hardening.sql` (Security Hardening
-- Wave 1, 2026-09-07). Before that wave this file declared
-- `grant all on table ... to anon` and `alter default privileges ... grant all
-- on tables to anon, authenticated, service_role`, which contradicted both the
-- intended model and the live database.
--
-- Rules that produced the matrix below:
--   * `authenticated` gets exactly the operations its RLS policies express.
--   * `service_role` gets the read/write a traced Edge Function or executor
--     needs — never DELETE, never TRUNCATE/REFERENCES/TRIGGER/MAINTAIN.
--   * `anon` gets nothing except SELECT on `init_state` (the pre-login probe).
--   * Always `revoke all` before `grant`: additive grants leave the privileges
--     inherited from the default ACL in place.
-- ===========================================================================

-- Schema usage
grant usage on schema public to postgres;
grant usage on schema public to anon;
grant usage on schema public to authenticated;
grant usage on schema public to service_role;

-- Function grants
grant all on function public.cleanup_note_attachments() to anon;
grant all on function public.cleanup_note_attachments() to authenticated;
grant all on function public.cleanup_note_attachments() to service_role;

grant all on function public.get_avatar_for_email(text) to anon;
grant all on function public.get_avatar_for_email(text) to authenticated;
grant all on function public.get_avatar_for_email(text) to service_role;

grant all on function public.get_domain_favicon(text) to anon;
grant all on function public.get_domain_favicon(text) to authenticated;
grant all on function public.get_domain_favicon(text) to service_role;

grant all on function public.get_note_attachments_function_url() to anon;
grant all on function public.get_note_attachments_function_url() to authenticated;
grant all on function public.get_note_attachments_function_url() to service_role;

revoke all on function public.get_user_id_by_email(text) from public;
grant all on function public.get_user_id_by_email(text) to service_role;

grant all on function public.handle_company_saved() to anon;
grant all on function public.handle_company_saved() to authenticated;
grant all on function public.handle_company_saved() to service_role;

grant all on function public.handle_contact_note_created_or_updated() to anon;
grant all on function public.handle_contact_note_created_or_updated() to authenticated;
grant all on function public.handle_contact_note_created_or_updated() to service_role;

grant all on function public.handle_contact_saved() to anon;
grant all on function public.handle_contact_saved() to authenticated;
grant all on function public.handle_contact_saved() to service_role;

grant all on function public.handle_new_user() to anon;
grant all on function public.handle_new_user() to authenticated;
grant all on function public.handle_new_user() to service_role;

grant all on function public.handle_update_user() to anon;
grant all on function public.handle_update_user() to authenticated;
grant all on function public.handle_update_user() to service_role;

-- v0.4b.1: RBAC helpers in nora_private — see migration 20260714140000 for EXECUTE grants.

-- Nora User Lifecycle W1 (2026-09-04): employee access mutations have ONE
-- privileged path (users Edge Function → service_role → executor RPC).
-- No browser role may execute the RPC; see migration 20260904220000.
-- The legacy RPC set_sales_role_by_admin was dropped in W2 (20260905120000).
revoke all on function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) from public;
revoke all on function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) from anon;
revoke all on function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) from authenticated;
grant execute on function public.set_sales_access_by_executor(uuid, bigint, text, boolean, uuid) to service_role;

revoke all on function nora_private.active_admin_count(bigint) from public;
revoke all on function nora_private.active_admin_count(bigint) from anon;
revoke all on function nora_private.active_admin_count(bigint) from authenticated;
revoke all on function nora_private.active_admin_count(bigint) from service_role;
grant execute on function nora_private.active_admin_count(bigint) to postgres;

revoke all on function nora_private.guard_last_active_admin() from public;
revoke all on function nora_private.guard_last_active_admin() from anon;
revoke all on function nora_private.guard_last_active_admin() from authenticated;
revoke all on function nora_private.guard_last_active_admin() from service_role;

grant all on function public.lowercase_email_jsonb() to anon;
grant all on function public.lowercase_email_jsonb() to authenticated;
grant all on function public.lowercase_email_jsonb() to service_role;

grant all on function public.merge_contacts(bigint, bigint) to anon;
grant all on function public.merge_contacts(bigint, bigint) to authenticated;
grant all on function public.merge_contacts(bigint, bigint) to service_role;

grant all on function public.set_sales_id_default() to anon;
grant all on function public.set_sales_id_default() to authenticated;
grant all on function public.set_sales_id_default() to service_role;

-- Table grants (Security Hardening Wave 1 target matrix)
revoke all on table public.companies from anon, authenticated, service_role;
grant select, insert, update, delete on table public.companies to authenticated;
grant select, insert, update on table public.companies to service_role;

revoke all on table public.contacts from anon, authenticated, service_role;
grant select, insert, update, delete on table public.contacts to authenticated;
grant select, insert, update on table public.contacts to service_role;

revoke all on table public.contact_notes from anon, authenticated, service_role;
grant select, insert, update, delete on table public.contact_notes to authenticated;
grant select, insert, update on table public.contact_notes to service_role;

revoke all on table public.deals from anon, authenticated, service_role;
grant select, insert, update, delete on table public.deals to authenticated;
grant select, insert, update on table public.deals to service_role;

revoke all on table public.deal_notes from anon, authenticated, service_role;
grant select, insert, update, delete on table public.deal_notes to authenticated;
grant select, insert, update on table public.deal_notes to service_role;

-- User Lifecycle W2 (2026-09-05) / W6-B (2026-09-07): browser roles never delete
-- employee rows (no DELETE policy exists either), and since Security Hardening
-- Wave 1 no role holds DELETE on sales at all — the only supported deletion runs
-- as `postgres` inside nora_private.guard_auth_user_delete, driven by GoTrue's
-- DELETE on auth.users. Referenced employees are additionally protected by the
-- six NO ACTION foreign keys. `authenticated` has no INSERT either: rows are
-- created by handle_new_user (SECURITY DEFINER) and by the users Edge Function.
revoke all on table public.sales from anon, authenticated, service_role;
grant select, update on table public.sales to authenticated;
grant select, insert, update on table public.sales to service_role;

revoke all on table public.tags from anon, authenticated, service_role;
grant select, insert, update, delete on table public.tags to authenticated;
grant select, insert, update on table public.tags to service_role;

revoke all on table public.tasks from anon, authenticated, service_role;
grant select, insert, update, delete on table public.tasks to authenticated;
grant select, insert, update on table public.tasks to service_role;

revoke all on table public.configuration from anon, authenticated, service_role;
grant select, insert, update on table public.configuration to authenticated;
grant select, insert, update on table public.configuration to service_role;

revoke all on table public.favicons_excluded_domains from anon, authenticated, service_role;
grant select, insert, update, delete on table public.favicons_excluded_domains to authenticated;
grant select, insert, update on table public.favicons_excluded_domains to service_role;

revoke all on table public.number_counters from anon, authenticated, service_role;

-- View grants
-- None of these views is auto-updatable, but they were never meant to carry
-- write privileges either. `init_state` is the only object `anon` may read: the
-- login page probes it before authentication (authProvider.getIsInitialized()).
revoke all on table public.activity_log from anon, authenticated, service_role;
grant select on table public.activity_log to authenticated, service_role;

revoke all on table public.companies_summary from anon, authenticated, service_role;
grant select on table public.companies_summary to authenticated, service_role;

revoke all on table public.contacts_summary from anon, authenticated, service_role;
grant select on table public.contacts_summary to authenticated, service_role;

-- User Lifecycle W2 (2026-09-05): both identity views are SELECT-only. They are
-- security_invoker = false over one table (auto-updatable): any write
-- privilege handed out by default ACLs at CREATE VIEW time would let a
-- browser JWT write to public.sales as the view owner.
revoke all on table public.sales_directory from public, anon, authenticated, service_role;
grant select on table public.sales_directory to authenticated;
grant select on table public.sales_directory to service_role;

revoke all on table public.sales_identities from public, anon, authenticated, service_role;
grant select on table public.sales_identities to authenticated;
grant select on table public.sales_identities to service_role;

revoke all on table public.init_state from anon, authenticated, service_role;
grant select on table public.init_state to anon, authenticated, service_role;

-- Sequence grants
-- None. Every id column in public is `generated by default as identity`, and an
-- identity column needs no sequence privilege of its own — the table's INSERT
-- privilege covers it. Production has carried NULL ACLs on all public sequences
-- all along; the previous `grant all on sequence ... to anon` lines here never
-- matched the live database and were never needed.

-- Numbering: internal counter/format functions — service_role only (triggers use SECURITY DEFINER assign_*)
revoke all on function public.format_customer_number(bigint) from public;
revoke all on function public.format_customer_number(bigint) from anon;
revoke all on function public.format_customer_number(bigint) from authenticated;
grant execute on function public.format_customer_number(bigint) to service_role;

revoke all on function public.format_case_number(integer, bigint) from public;
revoke all on function public.format_case_number(integer, bigint) from anon;
revoke all on function public.format_case_number(integer, bigint) from authenticated;
grant execute on function public.format_case_number(integer, bigint) to service_role;

revoke all on function public.next_customer_number() from public;
revoke all on function public.next_customer_number() from anon;
revoke all on function public.next_customer_number() from authenticated;
grant execute on function public.next_customer_number() to service_role;

revoke all on function public.next_case_number(timestamp with time zone) from public;
revoke all on function public.next_case_number(timestamp with time zone) from anon;
revoke all on function public.next_case_number(timestamp with time zone) from authenticated;
grant execute on function public.next_case_number(timestamp with time zone) to service_role;

grant all on function public.assign_customer_number() to anon;
grant all on function public.assign_customer_number() to authenticated;
grant all on function public.assign_customer_number() to service_role;

grant all on function public.assign_case_number() to anon;
grant all on function public.assign_case_number() to authenticated;
grant all on function public.assign_case_number() to service_role;

grant all on function public.prevent_customer_number_change() to anon;
grant all on function public.prevent_customer_number_change() to authenticated;
grant all on function public.prevent_customer_number_change() to service_role;

grant all on function public.prevent_case_number_change() to anon;
grant all on function public.prevent_case_number_change() to authenticated;
grant all on function public.prevent_case_number_change() to service_role;

-- Checklists / audit (v0.3d2) — no DELETE: none of these tables has a DELETE
-- policy, so the inherited DELETE privilege was unreachable and is gone.
revoke all on table public.checklist_templates from anon, authenticated, service_role;
grant select, insert, update on table public.checklist_templates to authenticated;
grant select, insert, update on table public.checklist_templates to service_role;

revoke all on table public.checklist_template_items from anon, authenticated, service_role;
grant select, insert, update on table public.checklist_template_items to authenticated;
grant select, insert, update on table public.checklist_template_items to service_role;

revoke all on table public.checklist_runs from anon, authenticated, service_role;
grant select, insert, update on table public.checklist_runs to authenticated;
grant select, insert, update on table public.checklist_runs to service_role;

revoke all on table public.checklist_run_items from anon, authenticated, service_role;
grant select, insert, update on table public.checklist_run_items to authenticated;
grant select, insert, update on table public.checklist_run_items to service_role;

revoke all on table public.saved_text_snippets from anon, authenticated, service_role;
grant select, insert, update on table public.saved_text_snippets to authenticated;
grant select, insert, update on table public.saved_text_snippets to service_role;

-- Security Hardening Wave 0: audit_events is append-only, immutable history.
-- Revoke first, then grant. Without the revoke, the public-schema default table
-- privileges below leak TRUNCATE/REFERENCES/TRIGGER onto anon/authenticated at
-- CREATE TABLE time. TRUNCATE is fatal here: it bypasses RLS *and* the
-- prevent_audit_mutation row triggers, so neither guard can stop it.
-- See migration 20260904174013_nora_audit_events_truncate_hardening.
-- Security Hardening Wave 1 (2026-09-07): service_role loses UPDATE, DELETE and
-- the Dxtm residue here too. prevent_audit_events_update / _delete already
-- refuse both for every role; the privileges now say the same thing.
revoke all on table public.audit_events from public;
revoke all on table public.audit_events from anon, authenticated, service_role;
grant select on table public.audit_events to authenticated;
grant insert on table public.audit_events to nora_audit_writer;
grant select, insert on table public.audit_events to service_role;

-- v0.3l: nora_audit_writer capability (role created in migration 20260715120000)
grant usage on schema public to nora_audit_writer;
grant usage on schema nora_private to nora_audit_writer;
grant create on schema nora_private to nora_audit_writer;
grant insert on table public.audit_events to nora_audit_writer;
grant select on table public.sales to nora_audit_writer;
grant select on table public.companies to nora_audit_writer;
grant select on table public.deals to nora_audit_writer;
grant nora_audit_writer to postgres;

revoke all on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) from public;
revoke all on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) from anon;
revoke all on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) from authenticated;
revoke all on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) from service_role;
grant execute on function nora_private.write_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, bigint, bigint,
    jsonb, jsonb, text, text, text, text
) to postgres;

revoke all on function nora_private.resolve_audit_actor() from public;
revoke all on function nora_private.resolve_audit_actor() from anon;
revoke all on function nora_private.resolve_audit_actor() from authenticated;
revoke all on function nora_private.resolve_audit_actor() from service_role;
grant execute on function nora_private.resolve_audit_actor() to postgres;
grant execute on function nora_private.resolve_audit_actor() to nora_audit_writer;

-- Nora User Lifecycle W3 (2026-09-05): audit context pin is postgres-internal;
-- record_employee_admin_event is service_role-only (see migration 20260905180000).
revoke all on function nora_private.pin_audit_context(uuid, uuid) from public;
revoke all on function nora_private.pin_audit_context(uuid, uuid) from anon;
revoke all on function nora_private.pin_audit_context(uuid, uuid) from authenticated;
revoke all on function nora_private.pin_audit_context(uuid, uuid) from service_role;
grant execute on function nora_private.pin_audit_context(uuid, uuid) to postgres;

revoke all on function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) from public;
revoke all on function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) from anon;
revoke all on function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) from authenticated;
grant execute on function public.record_employee_admin_event(uuid, bigint, text, uuid, jsonb) to service_role;

revoke all on function nora_private.current_operation_id() from public;
revoke all on function nora_private.current_operation_id() from anon;
revoke all on function nora_private.current_operation_id() from authenticated;
revoke all on function nora_private.current_operation_id() from service_role;
grant execute on function nora_private.current_operation_id() to postgres;
grant execute on function nora_private.current_operation_id() to nora_audit_writer;

revoke all on function public.insert_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, jsonb, jsonb, jsonb
) from public;
revoke all on function public.insert_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, jsonb, jsonb, jsonb
) from anon;
revoke all on function public.insert_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, jsonb, jsonb, jsonb
) from authenticated;
grant execute on function public.insert_audit_event(
    text, text, uuid, bigint, bigint, bigint, uuid, uuid, jsonb, jsonb, jsonb
) to service_role;

grant all on function public.set_updated_at() to anon;
grant all on function public.set_updated_at() to authenticated;
grant all on function public.set_updated_at() to service_role;

grant all on function public.nora_entity_uuid(text, bigint) to anon;
grant all on function public.nora_entity_uuid(text, bigint) to authenticated;
grant all on function public.nora_entity_uuid(text, bigint) to service_role;

grant all on function public.set_checklist_run_defaults() to anon;
grant all on function public.set_checklist_run_defaults() to authenticated;
grant all on function public.set_checklist_run_defaults() to service_role;

grant all on function public.prevent_audit_mutation() to anon;
grant all on function public.prevent_audit_mutation() to authenticated;
grant all on function public.prevent_audit_mutation() to service_role;

grant all on function public.audit_company_row() to anon;
grant all on function public.audit_company_row() to authenticated;
grant all on function public.audit_company_row() to service_role;

grant all on function public.audit_contact_row() to anon;
grant all on function public.audit_contact_row() to authenticated;
grant all on function public.audit_contact_row() to service_role;

grant all on function public.audit_deal_row() to anon;
grant all on function public.audit_deal_row() to authenticated;
grant all on function public.audit_deal_row() to service_role;

grant all on function public.audit_task_row() to anon;
grant all on function public.audit_task_row() to authenticated;
grant all on function public.audit_task_row() to service_role;

grant all on function public.audit_contact_note_row() to anon;
grant all on function public.audit_contact_note_row() to authenticated;
grant all on function public.audit_contact_note_row() to service_role;

grant all on function public.audit_deal_note_row() to anon;
grant all on function public.audit_deal_note_row() to authenticated;
grant all on function public.audit_deal_note_row() to service_role;

grant all on function public.audit_sales_privilege_change() to anon;
grant all on function public.audit_sales_privilege_change() to authenticated;
grant all on function public.audit_sales_privilege_change() to service_role;

revoke all on function public.get_entity_audit_events(text, bigint, integer, timestamptz) from public;
revoke all on function public.get_entity_audit_events(text, bigint, integer, timestamptz) from anon;
grant execute on function public.get_entity_audit_events(text, bigint, integer, timestamptz) to authenticated;
grant execute on function public.get_entity_audit_events(text, bigint, integer, timestamptz) to service_role;

revoke all on function public.get_global_audit_events(
    integer, timestamptz, text, text, bigint, timestamptz, timestamptz, text
) from public;
revoke all on function public.get_global_audit_events(
    integer, timestamptz, text, text, bigint, timestamptz, timestamptz, text
) from anon;
grant execute on function public.get_global_audit_events(
    integer, timestamptz, text, text, bigint, timestamptz, timestamptz, text
) to authenticated;
grant execute on function public.get_global_audit_events(
    integer, timestamptz, text, text, bigint, timestamptz, timestamptz, text
) to service_role;

revoke all on function public.get_audit_storage_stats() from public;
revoke all on function public.get_audit_storage_stats() from anon;
grant execute on function public.get_audit_storage_stats() to authenticated;
grant execute on function public.get_audit_storage_stats() to service_role;

grant all on function public.audit_checklist_run_changes() to anon;
grant all on function public.audit_checklist_run_changes() to authenticated;
grant all on function public.audit_checklist_run_changes() to service_role;

grant all on function public.audit_checklist_run_item_changes() to anon;
grant all on function public.audit_checklist_run_item_changes() to authenticated;
grant all on function public.audit_checklist_run_item_changes() to service_role;

grant all on function public.audit_saved_text_snippet_changes() to anon;
grant all on function public.audit_saved_text_snippet_changes() to authenticated;
grant all on function public.audit_saved_text_snippet_changes() to service_role;

revoke all on function public.start_checklist_run_from_template(text, bigint, bigint) from public;
revoke all on function public.start_checklist_run_from_template(text, bigint, bigint) from anon;
grant execute on function public.start_checklist_run_from_template(text, bigint, bigint) to authenticated;
grant execute on function public.start_checklist_run_from_template(text, bigint, bigint) to service_role;

-- Default privileges (Security Hardening Wave 1, 2026-09-07)
--
-- THE ROOT CAUSE THIS WAVE FIXED. Until 2026-09-07 the three blocks below read
-- `grant all on tables/sequences/functions to anon, authenticated, service_role`,
-- so every `create table` in public handed the API roles privileges before any
-- explicit GRANT — TRUNCATE included, which bypasses RLS and fires no row
-- triggers. New objects must start with nothing and receive only what a
-- migration grants on purpose.
--
-- Note the asymmetry: for TABLES and SEQUENCES this really does yield "no
-- privileges". For FUNCTIONS, PostgreSQL's BUILT-IN default is
-- `owner + PUBLIC EXECUTE`, and that PUBLIC grant cannot be removed through
-- ALTER DEFAULT PRIVILEGES (verified 2026-09-07). Every sensitive function
-- therefore still needs its own explicit
-- `revoke all on function ... from public, anon, authenticated`, exactly as the
-- rest of this file does. See 17-known-issues-and-planned-waves.md A.8.
alter default privileges for role postgres in schema public grant all on sequences to postgres;
alter default privileges for role postgres in schema public
    revoke all on sequences from anon, authenticated, service_role;

alter default privileges for role postgres in schema public grant all on functions to postgres;
alter default privileges for role postgres in schema public
    revoke execute on functions from anon, authenticated, service_role;

alter default privileges for role postgres in schema public grant all on tables to postgres;
alter default privileges for role postgres in schema public
    revoke all on tables from anon, authenticated, service_role;

-- Google Calendar v0.4c.1 (matrix updated in Security Hardening Wave 1)
revoke all on table public.google_calendar_connections from anon, authenticated, service_role;
grant select on table public.google_calendar_connections to authenticated;
grant select, insert, update on table public.google_calendar_connections to service_role;

revoke all on table public.google_calendar_events from anon, authenticated, service_role;
grant select on table public.google_calendar_events to authenticated;
grant select, insert, update on table public.google_calendar_events to service_role;

grant select, insert, update on table public.google_calendar_connections to nora_calendar_writer;
grant select, insert, update, delete on table public.google_calendar_events to nora_calendar_writer;

-- Security Hardening Wave 1: nora_calendar_linker held CREATE on schema public
-- only so that migration 20260717120000 could run
-- `alter function ... owner to nora_calendar_linker` (Postgres requires the new
-- owner to hold CREATE on the function's schema). Nothing needs it at runtime.
-- A future calendar migration that transfers ownership again must grant CREATE
-- inside that migration and revoke it before the migration ends.
revoke create on schema public from nora_calendar_linker;

-- Foundation Wave 3: Error Observatory
revoke all on table public.operation_errors from public;
revoke all on table public.operation_errors from anon, authenticated, service_role;
grant select on table public.operation_errors to authenticated;
grant select, insert, update on table public.operation_errors to service_role;

-- V1C-A email delivery observability (was only ever declared in the migration;
-- restated here in Security Hardening Wave 1 so this file covers every public
-- table). Writes arrive through the SECURITY DEFINER RPC
-- ingest_email_delivery_event, not through a direct table write.
revoke all on table public.email_delivery_events from public;
revoke all on table public.email_delivery_events from anon, authenticated, service_role;
grant select on table public.email_delivery_events to authenticated;
grant select, insert on table public.email_delivery_events to service_role;

revoke all on function nora_private.generate_operation_error_public_ref() from public;
revoke all on function nora_private.generate_operation_error_public_ref() from anon;
revoke all on function nora_private.generate_operation_error_public_ref() from authenticated;
revoke all on function nora_private.generate_operation_error_public_ref() from service_role;
grant execute on function nora_private.generate_operation_error_public_ref() to postgres;

revoke all on function nora_private.sanitize_operation_error_context(jsonb) from public;
revoke all on function nora_private.sanitize_operation_error_context(jsonb) from anon;
revoke all on function nora_private.sanitize_operation_error_context(jsonb) from authenticated;
revoke all on function nora_private.sanitize_operation_error_context(jsonb) from service_role;
grant execute on function nora_private.sanitize_operation_error_context(jsonb) to postgres;

revoke all on function public.record_operation_error(text, uuid, text, text, text, text, text, jsonb, text) from public;
revoke all on function public.record_operation_error(text, uuid, text, text, text, text, text, jsonb, text) from anon;
grant execute on function public.record_operation_error(text, uuid, text, text, text, text, text, jsonb, text) to authenticated;
grant execute on function public.record_operation_error(text, uuid, text, text, text, text, text, jsonb, text) to service_role;

revoke all on function public.report_operation_error(uuid, text) from public;
revoke all on function public.report_operation_error(uuid, text) from anon;
grant execute on function public.report_operation_error(uuid, text) to authenticated;
grant execute on function public.report_operation_error(uuid, text) to service_role;

-- ---------------------------------------------------------------------------
-- Nora User Lifecycle W4 (2026-09-06): login-email change
-- (role nora_identity_manager is created in the migration, like nora_role_manager)
-- ---------------------------------------------------------------------------
grant usage on schema public to nora_identity_manager;
grant usage on schema nora_private to nora_identity_manager;
grant create on schema nora_private to nora_identity_manager;
grant select on table public.sales to nora_identity_manager;
grant update (email) on table public.sales to nora_identity_manager;

revoke all on table nora_private.sales_email_change_tickets from public;
revoke all on table nora_private.sales_email_change_tickets from anon;
revoke all on table nora_private.sales_email_change_tickets from authenticated;
revoke all on table nora_private.sales_email_change_tickets from service_role;

revoke all on function nora_private.normalize_login_email(text) from public;
revoke all on function nora_private.normalize_login_email(text) from anon;
revoke all on function nora_private.normalize_login_email(text) from authenticated;
revoke all on function nora_private.normalize_login_email(text) from service_role;
grant execute on function nora_private.normalize_login_email(text) to postgres;

revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from public;
revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from anon;
revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from authenticated;
revoke all on function nora_private.apply_sales_email_change(bigint, extensions.citext) from service_role;
grant execute on function nora_private.apply_sales_email_change(bigint, extensions.citext) to postgres;

revoke all on function public.prepare_sales_email_change(uuid, bigint, text, uuid) from public;
revoke all on function public.prepare_sales_email_change(uuid, bigint, text, uuid) from anon;
revoke all on function public.prepare_sales_email_change(uuid, bigint, text, uuid) from authenticated;
grant execute on function public.prepare_sales_email_change(uuid, bigint, text, uuid) to service_role;

revoke all on function public.cancel_sales_email_change(uuid) from public;
revoke all on function public.cancel_sales_email_change(uuid) from anon;
revoke all on function public.cancel_sales_email_change(uuid) from authenticated;
grant execute on function public.cancel_sales_email_change(uuid) to service_role;

revoke all on function nora_private.guard_auth_email_change() from public;
revoke all on function nora_private.guard_auth_email_change() from anon;
revoke all on function nora_private.guard_auth_email_change() from authenticated;
revoke all on function nora_private.guard_auth_email_change() from service_role;
