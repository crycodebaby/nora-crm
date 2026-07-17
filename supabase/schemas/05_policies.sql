--
-- Row Level Security (v0.4b.1 RBAC — nora_private helpers)
-- This file declares RLS policies for all tables.
--

alter table public.companies enable row level security;
alter table public.contacts enable row level security;
alter table public.contact_notes enable row level security;
alter table public.deals enable row level security;
alter table public.deal_notes enable row level security;
alter table public.sales enable row level security;
alter table public.tags enable row level security;
alter table public.tasks enable row level security;
alter table public.configuration enable row level security;
alter table public.favicons_excluded_domains enable row level security;
alter table public.checklist_templates enable row level security;
alter table public.checklist_template_items enable row level security;
alter table public.checklist_runs enable row level security;
alter table public.checklist_run_items enable row level security;
alter table public.saved_text_snippets enable row level security;
alter table public.audit_events enable row level security;

-- Companies
create policy "Companies select active" on public.companies for select to authenticated using (nora_private.is_active_user());
create policy "Companies insert writers" on public.companies for insert to authenticated with check (nora_private.can_write());
create policy "Companies update writers" on public.companies for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Companies delete admin" on public.companies for delete to authenticated using (nora_private.is_admin());

-- Contacts
create policy "Contacts select active" on public.contacts for select to authenticated using (nora_private.is_active_user());
create policy "Contacts insert writers" on public.contacts for insert to authenticated with check (nora_private.can_write());
create policy "Contacts update writers" on public.contacts for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Contacts delete admin" on public.contacts for delete to authenticated using (nora_private.is_admin());

-- Contact notes
create policy "Contact notes select active" on public.contact_notes for select to authenticated using (nora_private.is_active_user());
create policy "Contact notes insert writers" on public.contact_notes for insert to authenticated with check (nora_private.can_write());
create policy "Contact notes update writers" on public.contact_notes for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Contact notes delete admin" on public.contact_notes for delete to authenticated using (nora_private.is_admin());

-- Deals
create policy "Deals select active" on public.deals for select to authenticated using (nora_private.is_active_user());
create policy "Deals insert writers" on public.deals for insert to authenticated with check (nora_private.can_write());
create policy "Deals update writers" on public.deals for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Deals delete admin" on public.deals for delete to authenticated using (nora_private.is_admin());

-- Deal notes
create policy "Deal notes select active" on public.deal_notes for select to authenticated using (nora_private.is_active_user());
create policy "Deal notes insert writers" on public.deal_notes for insert to authenticated with check (nora_private.can_write());
create policy "Deal notes update writers" on public.deal_notes for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Deal notes delete admin" on public.deal_notes for delete to authenticated using (nora_private.is_admin());

-- Tasks
create policy "Tasks select active" on public.tasks for select to authenticated using (nora_private.is_active_user());
create policy "Tasks insert writers" on public.tasks for insert to authenticated with check (nora_private.can_write());
create policy "Tasks update writers" on public.tasks for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Tasks delete admin" on public.tasks for delete to authenticated using (nora_private.is_admin());

-- Sales
create policy "Sales select own or admin" on public.sales for select to authenticated using (nora_private.is_active_user() and (user_id = auth.uid() or nora_private.is_admin()));
create policy "Sales select role manager" on public.sales for select using (current_user = 'nora_role_manager');
create policy "Sales update by role manager" on public.sales for update using (current_user = 'nora_role_manager') with check (current_user = 'nora_role_manager');
create policy "Sales update own profile" on public.sales for update to authenticated using (nora_private.is_active_user() and user_id = auth.uid()) with check (nora_private.is_active_user() and user_id = auth.uid());

-- Tags
create policy "Tags select active" on public.tags for select to authenticated using (nora_private.is_active_user());
create policy "Tags insert writers" on public.tags for insert to authenticated with check (nora_private.can_write());
create policy "Tags update writers" on public.tags for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());
create policy "Tags delete admin" on public.tags for delete to authenticated using (nora_private.is_admin());

-- Configuration
create policy "Configuration select active" on public.configuration for select to authenticated using (nora_private.is_active_user());
create policy "Configuration insert admin" on public.configuration for insert to authenticated with check (nora_private.is_admin());
create policy "Configuration update admin" on public.configuration for update to authenticated using (nora_private.is_admin()) with check (nora_private.is_admin());

-- Favicons excluded domains
create policy "Favicons select active" on public.favicons_excluded_domains for select to authenticated using (nora_private.is_active_user());
create policy "Favicons insert admin" on public.favicons_excluded_domains for insert to authenticated with check (nora_private.is_admin());
create policy "Favicons update admin" on public.favicons_excluded_domains for update to authenticated using (nora_private.is_admin()) with check (nora_private.is_admin());
create policy "Favicons delete admin" on public.favicons_excluded_domains for delete to authenticated using (nora_private.is_admin());

-- Checklists
create policy "Checklist templates select active" on public.checklist_templates for select to authenticated using (nora_private.is_active_user());
create policy "Checklist templates insert admin" on public.checklist_templates for insert to authenticated with check (nora_private.is_admin());
create policy "Checklist templates update admin" on public.checklist_templates for update to authenticated using (nora_private.is_admin()) with check (nora_private.is_admin());

create policy "Checklist template items select active" on public.checklist_template_items for select to authenticated using (nora_private.is_active_user());
create policy "Checklist template items insert admin" on public.checklist_template_items for insert to authenticated with check (nora_private.is_admin());
create policy "Checklist template items update admin" on public.checklist_template_items for update to authenticated using (nora_private.is_admin()) with check (nora_private.is_admin());

create policy "Checklist runs select active" on public.checklist_runs for select to authenticated using (nora_private.is_active_user());
create policy "Checklist runs insert writers" on public.checklist_runs for insert to authenticated with check (nora_private.can_write());
create policy "Checklist runs update writers" on public.checklist_runs for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());

create policy "Checklist run items select active" on public.checklist_run_items for select to authenticated using (nora_private.is_active_user());
create policy "Checklist run items insert writers" on public.checklist_run_items for insert to authenticated with check (nora_private.can_write());
create policy "Checklist run items update writers" on public.checklist_run_items for update to authenticated using (nora_private.can_write()) with check (nora_private.can_write());

create policy "Saved text snippets select active" on public.saved_text_snippets for select to authenticated using (nora_private.is_active_user());
create policy "Saved text snippets insert writers" on public.saved_text_snippets for insert to authenticated with check (nora_private.can_write());
create policy "Saved text snippets update writers" on public.saved_text_snippets for update to authenticated using (nora_private.is_admin() or (nora_private.has_role(array['office']) and created_by = auth.uid())) with check (nora_private.is_admin() or (nora_private.has_role(array['office']) and created_by = auth.uid()));

-- Audit
create policy "Audit events read admin only" on public.audit_events for select to authenticated using (nora_private.has_role(array['admin']));
create policy "Audit events insert audit writer" on public.audit_events for insert to nora_audit_writer with check (true);

-- Google Calendar v0.4c.1
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_events enable row level security;

create policy "Google calendar connections read admin" on public.google_calendar_connections for select to authenticated using (nora_private.is_admin());
create policy "Google calendar connections read calendar writer" on public.google_calendar_connections for select to nora_calendar_writer using (true);
create policy "Google calendar connections write calendar writer" on public.google_calendar_connections for insert to nora_calendar_writer with check (true);
create policy "Google calendar connections update calendar writer" on public.google_calendar_connections for update to nora_calendar_writer using (true) with check (true);

create policy "Google calendar events read active users" on public.google_calendar_events for select to authenticated using (nora_private.is_active_user());
create policy "Google calendar events read calendar writer" on public.google_calendar_events for select to nora_calendar_writer using (true);
create policy "Google calendar events insert calendar writer" on public.google_calendar_events for insert to nora_calendar_writer with check (true);
create policy "Google calendar events update calendar writer" on public.google_calendar_events for update to nora_calendar_writer using (true) with check (true);
create policy "Google calendar events delete calendar writer" on public.google_calendar_events for delete to nora_calendar_writer using (true);

create policy "Google calendar events update calendar linker" on public.google_calendar_events for update to nora_calendar_linker using (true) with check (true);
create policy "Google calendar events read calendar linker" on public.google_calendar_events for select to nora_calendar_linker using (true);
