--
-- Grants
-- This file declares all grants and default privileges for the public schema.
--

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

grant all on function public.is_admin() to anon;
grant all on function public.is_admin() to authenticated;
grant all on function public.is_admin() to service_role;

grant all on function public.lowercase_email_jsonb() to anon;
grant all on function public.lowercase_email_jsonb() to authenticated;
grant all on function public.lowercase_email_jsonb() to service_role;

grant all on function public.merge_contacts(bigint, bigint) to anon;
grant all on function public.merge_contacts(bigint, bigint) to authenticated;
grant all on function public.merge_contacts(bigint, bigint) to service_role;

grant all on function public.set_sales_id_default() to anon;
grant all on function public.set_sales_id_default() to authenticated;
grant all on function public.set_sales_id_default() to service_role;

-- Table grants
grant all on table public.companies to anon;
grant all on table public.companies to authenticated;
grant all on table public.companies to service_role;

grant all on table public.contacts to anon;
grant all on table public.contacts to authenticated;
grant all on table public.contacts to service_role;

grant all on table public.contact_notes to anon;
grant all on table public.contact_notes to authenticated;
grant all on table public.contact_notes to service_role;

grant all on table public.deals to anon;
grant all on table public.deals to authenticated;
grant all on table public.deals to service_role;

grant all on table public.deal_notes to anon;
grant all on table public.deal_notes to authenticated;
grant all on table public.deal_notes to service_role;

grant all on table public.sales to anon;
grant all on table public.sales to authenticated;
grant all on table public.sales to service_role;

grant all on table public.tags to anon;
grant all on table public.tags to authenticated;
grant all on table public.tags to service_role;

grant all on table public.tasks to anon;
grant all on table public.tasks to authenticated;
grant all on table public.tasks to service_role;

grant all on table public.configuration to anon;
grant all on table public.configuration to authenticated;
grant all on table public.configuration to service_role;

grant all on table public.favicons_excluded_domains to anon;
grant all on table public.favicons_excluded_domains to authenticated;
grant all on table public.favicons_excluded_domains to service_role;

-- View grants
grant all on table public.activity_log to anon;
grant all on table public.activity_log to authenticated;
grant all on table public.activity_log to service_role;

grant all on table public.companies_summary to anon;
grant all on table public.companies_summary to authenticated;
grant all on table public.companies_summary to service_role;

grant all on table public.contacts_summary to anon;
grant all on table public.contacts_summary to authenticated;
grant all on table public.contacts_summary to service_role;

grant all on table public.init_state to anon;
grant all on table public.init_state to authenticated;
grant all on table public.init_state to service_role;

-- Sequence grants
grant all on sequence public.companies_id_seq to anon;
grant all on sequence public.companies_id_seq to authenticated;
grant all on sequence public.companies_id_seq to service_role;

grant all on sequence public."contactNotes_id_seq" to anon;
grant all on sequence public."contactNotes_id_seq" to authenticated;
grant all on sequence public."contactNotes_id_seq" to service_role;

grant all on sequence public.contacts_id_seq to anon;
grant all on sequence public.contacts_id_seq to authenticated;
grant all on sequence public.contacts_id_seq to service_role;

grant all on sequence public."dealNotes_id_seq" to anon;
grant all on sequence public."dealNotes_id_seq" to authenticated;
grant all on sequence public."dealNotes_id_seq" to service_role;

grant all on sequence public.deals_id_seq to anon;
grant all on sequence public.deals_id_seq to authenticated;
grant all on sequence public.deals_id_seq to service_role;

grant all on sequence public.favicons_excluded_domains_id_seq to anon;
grant all on sequence public.favicons_excluded_domains_id_seq to authenticated;
grant all on sequence public.favicons_excluded_domains_id_seq to service_role;

grant all on sequence public.sales_id_seq to anon;
grant all on sequence public.sales_id_seq to authenticated;
grant all on sequence public.sales_id_seq to service_role;

grant all on sequence public.tags_id_seq to anon;
grant all on sequence public.tags_id_seq to authenticated;
grant all on sequence public.tags_id_seq to service_role;

grant all on sequence public.tasks_id_seq to anon;
grant all on sequence public.tasks_id_seq to authenticated;
grant all on sequence public.tasks_id_seq to service_role;

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

-- Checklists / audit (v0.3d2)
grant all on table public.checklist_templates to anon;
grant all on table public.checklist_templates to authenticated;
grant all on table public.checklist_templates to service_role;

grant all on table public.checklist_template_items to anon;
grant all on table public.checklist_template_items to authenticated;
grant all on table public.checklist_template_items to service_role;

grant all on table public.checklist_runs to anon;
grant all on table public.checklist_runs to authenticated;
grant all on table public.checklist_runs to service_role;

grant all on table public.checklist_run_items to anon;
grant all on table public.checklist_run_items to authenticated;
grant all on table public.checklist_run_items to service_role;

grant all on table public.saved_text_snippets to anon;
grant all on table public.saved_text_snippets to authenticated;
grant all on table public.saved_text_snippets to service_role;

grant select on table public.audit_events to anon;
grant select on table public.audit_events to authenticated;
grant all on table public.audit_events to service_role;

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

grant all on function public.audit_deal_stage_change() to anon;
grant all on function public.audit_deal_stage_change() to authenticated;
grant all on function public.audit_deal_stage_change() to service_role;

grant all on function public.audit_checklist_run_changes() to anon;
grant all on function public.audit_checklist_run_changes() to authenticated;
grant all on function public.audit_checklist_run_changes() to service_role;

grant all on function public.audit_checklist_run_item_changes() to anon;
grant all on function public.audit_checklist_run_item_changes() to authenticated;
grant all on function public.audit_checklist_run_item_changes() to service_role;

grant all on function public.audit_saved_text_snippet_changes() to anon;
grant all on function public.audit_saved_text_snippet_changes() to authenticated;
grant all on function public.audit_saved_text_snippet_changes() to service_role;

-- Default privileges
alter default privileges for role postgres in schema public grant all on sequences to postgres;
alter default privileges for role postgres in schema public grant all on sequences to anon;
alter default privileges for role postgres in schema public grant all on sequences to authenticated;
alter default privileges for role postgres in schema public grant all on sequences to service_role;

alter default privileges for role postgres in schema public grant all on functions to postgres;
alter default privileges for role postgres in schema public grant all on functions to anon;
alter default privileges for role postgres in schema public grant all on functions to authenticated;
alter default privileges for role postgres in schema public grant all on functions to service_role;

alter default privileges for role postgres in schema public grant all on tables to postgres;
alter default privileges for role postgres in schema public grant all on tables to anon;
alter default privileges for role postgres in schema public grant all on tables to authenticated;
alter default privileges for role postgres in schema public grant all on tables to service_role;
