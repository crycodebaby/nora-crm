--
-- Row Level Security
-- This file declares RLS policies for all tables.
--

-- Enable RLS on all tables
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
create policy "Enable read access for authenticated users" on public.companies for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.companies for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.companies for update to authenticated using (true) with check (true);
create policy "Company Delete Policy" on public.companies for delete to authenticated using (true);

-- Contacts
create policy "Enable read access for authenticated users" on public.contacts for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.contacts for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.contacts for update to authenticated using (true) with check (true);
create policy "Contact Delete Policy" on public.contacts for delete to authenticated using (true);

-- Contact Notes
create policy "Enable read access for authenticated users" on public.contact_notes for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.contact_notes for insert to authenticated with check (true);
create policy "Contact Notes Update policy" on public.contact_notes for update to authenticated using (true);
create policy "Contact Notes Delete Policy" on public.contact_notes for delete to authenticated using (true);

-- Deals
create policy "Enable read access for authenticated users" on public.deals for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.deals for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.deals for update to authenticated using (true) with check (true);
create policy "Deals Delete Policy" on public.deals for delete to authenticated using (true);

-- Deal Notes
create policy "Enable read access for authenticated users" on public.deal_notes for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.deal_notes for insert to authenticated with check (true);
create policy "Deal Notes Update Policy" on public.deal_notes for update to authenticated using (true);
create policy "Deal Notes Delete Policy" on public.deal_notes for delete to authenticated using (true);

-- Sales
create policy "Enable read access for authenticated users" on public.sales for select to authenticated using (true);

-- Tags
create policy "Enable read access for authenticated users" on public.tags for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.tags for insert to authenticated with check (true);
create policy "Enable update for authenticated users only" on public.tags for update to authenticated using (true);
create policy "Enable delete for authenticated users only" on public.tags for delete to authenticated using (true);

-- Tasks
create policy "Enable read access for authenticated users" on public.tasks for select to authenticated using (true);
create policy "Enable insert for authenticated users only" on public.tasks for insert to authenticated with check (true);
create policy "Task Update Policy" on public.tasks for update to authenticated using (true);
create policy "Task Delete Policy" on public.tasks for delete to authenticated using (true);

-- Configuration (admin-only for writes)
create policy "Enable read for authenticated" on public.configuration for select to authenticated using (true);
create policy "Enable insert for admins" on public.configuration for insert to authenticated with check (public.is_admin());
create policy "Enable update for admins" on public.configuration for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Favicons excluded domains
create policy "Enable access for authenticated users only" on public.favicons_excluded_domains to authenticated using (true) with check (true);

-- Checklists (v0.3d2)
create policy "Checklist templates read" on public.checklist_templates for select to authenticated using (true);
create policy "Checklist templates insert admin" on public.checklist_templates for insert to authenticated with check (public.is_admin());
create policy "Checklist templates update admin" on public.checklist_templates for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Checklist template items read" on public.checklist_template_items for select to authenticated using (true);
create policy "Checklist template items insert admin" on public.checklist_template_items for insert to authenticated with check (public.is_admin());
create policy "Checklist template items update admin" on public.checklist_template_items for update to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Checklist runs read" on public.checklist_runs for select to authenticated using (true);
create policy "Checklist runs insert" on public.checklist_runs for insert to authenticated with check (true);
create policy "Checklist runs update" on public.checklist_runs for update to authenticated using (true) with check (true);

create policy "Checklist run items read" on public.checklist_run_items for select to authenticated using (true);
create policy "Checklist run items insert" on public.checklist_run_items for insert to authenticated with check (true);
create policy "Checklist run items update" on public.checklist_run_items for update to authenticated using (true) with check (true);

create policy "Saved text snippets read" on public.saved_text_snippets for select to authenticated using (true);
create policy "Saved text snippets insert" on public.saved_text_snippets for insert to authenticated with check (true);
create policy "Saved text snippets update" on public.saved_text_snippets for update to authenticated using (true) with check (true);

create policy "Audit events read" on public.audit_events for select to authenticated using (true);
