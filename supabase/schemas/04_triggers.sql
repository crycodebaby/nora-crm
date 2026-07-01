--
-- Triggers
-- This file declares all triggers.
--

-- Auto-populate sales_id from current auth user on insert
create or replace trigger set_company_sales_id_trigger
    before insert on public.companies
    for each row execute function public.set_sales_id_default();

create or replace trigger set_contact_sales_id_trigger
    before insert on public.contacts
    for each row execute function public.set_sales_id_default();

create or replace trigger set_contact_notes_sales_id_trigger
    before insert on public.contact_notes
    for each row execute function public.set_sales_id_default();

create or replace trigger set_deal_sales_id_trigger
    before insert on public.deals
    for each row execute function public.set_sales_id_default();

create or replace trigger set_deal_notes_sales_id_trigger
    before insert on public.deal_notes
    for each row execute function public.set_sales_id_default();

create or replace trigger set_task_sales_id_trigger
    before insert on public.tasks
    for each row execute function public.set_sales_id_default();

-- Auto-fetch company logo from website favicon on save
create or replace trigger company_saved
    before insert or update on public.companies
    for each row execute function public.handle_company_saved();

-- Lowercase contact emails before insert or update (must run before contact_saved)
create or replace trigger "10_lowercase_contact_emails"
    before insert or update on public.contacts
    for each row execute function public.lowercase_email_jsonb();

-- Auto-fetch contact avatar from email on save (runs after lowercase_contact_emails)
create or replace trigger "20_contact_saved"
    before insert or update on public.contacts
    for each row execute function public.handle_contact_saved();

-- Update contact.last_seen when a contact note is created
create or replace trigger on_public_contact_notes_created_or_updated
    after insert on public.contact_notes
    for each row execute function public.handle_contact_note_created_or_updated();

-- Cleanup storage attachments when contact notes are updated or deleted
create or replace trigger on_contact_notes_attachments_updated_delete_note_attachments
    after update on public.contact_notes
    for each row
    when (old.attachments is distinct from new.attachments)
    execute function public.cleanup_note_attachments();

create or replace trigger on_contact_notes_deleted_delete_note_attachments
    after delete on public.contact_notes
    for each row execute function public.cleanup_note_attachments();

-- Cleanup storage attachments when deal notes are updated or deleted
create or replace trigger on_deal_notes_attachments_updated_delete_note_attachments
    after update on public.deal_notes
    for each row
    when (old.attachments is distinct from new.attachments)
    execute function public.cleanup_note_attachments();

create or replace trigger on_deal_notes_deleted_delete_note_attachments
    after delete on public.deal_notes
    for each row execute function public.cleanup_note_attachments();

-- Auth triggers: sync auth.users to public.sales
create or replace trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

create or replace trigger on_auth_user_updated
    after update on auth.users
    for each row execute function public.handle_update_user();

-- Nora CRM: business numbers
create or replace trigger assign_customer_number_trigger
    before insert on public.companies
    for each row execute function public.assign_customer_number();

create or replace trigger prevent_customer_number_change_trigger
    before update on public.companies
    for each row execute function public.prevent_customer_number_change();

create or replace trigger assign_case_number_trigger
    before insert on public.deals
    for each row execute function public.assign_case_number();

create or replace trigger prevent_case_number_change_trigger
    before update on public.deals
    for each row execute function public.prevent_case_number_change();

-- Nora CRM v0.3d2: checklists, snippets, audit

create or replace trigger set_checklist_templates_updated_at
    before update on public.checklist_templates
    for each row execute function public.set_updated_at();

create or replace trigger set_checklist_template_items_updated_at
    before update on public.checklist_template_items
    for each row execute function public.set_updated_at();

create or replace trigger set_checklist_runs_updated_at
    before update on public.checklist_runs
    for each row execute function public.set_updated_at();

create or replace trigger set_checklist_run_items_updated_at
    before update on public.checklist_run_items
    for each row execute function public.set_updated_at();

create or replace trigger set_saved_text_snippets_updated_at
    before update on public.saved_text_snippets
    for each row execute function public.set_updated_at();

create or replace trigger set_checklist_run_defaults_trigger
    before insert on public.checklist_runs
    for each row execute function public.set_checklist_run_defaults();

create or replace trigger prevent_audit_events_update
    before update on public.audit_events
    for each row execute function public.prevent_audit_mutation();

create or replace trigger prevent_audit_events_delete
    before delete on public.audit_events
    for each row execute function public.prevent_audit_mutation();

create or replace trigger audit_deal_stage_change_trigger
    after update of stage on public.deals
    for each row execute function public.audit_deal_stage_change();

create or replace trigger audit_checklist_run_changes_trigger
    after insert or update on public.checklist_runs
    for each row execute function public.audit_checklist_run_changes();

create or replace trigger audit_checklist_run_item_changes_trigger
    after update on public.checklist_run_items
    for each row execute function public.audit_checklist_run_item_changes();

create or replace trigger audit_saved_text_snippet_changes_trigger
    after insert or update on public.saved_text_snippets
    for each row execute function public.audit_saved_text_snippet_changes();
