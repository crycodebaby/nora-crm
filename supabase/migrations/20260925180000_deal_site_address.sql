-- The Einsatzort belongs to the deal, not to its customer. Existing deals
-- remain unknown until a person edits them; no customer address is backfilled.
alter table public.deals
    add column site_street text,
    add column site_city text,
    add column site_floor text,
    add column site_tenant_name text;

comment on column public.deals.site_street is 'Street and house number of the deal jobsite, independent of the customer address.';
comment on column public.deals.site_city is 'City of the deal jobsite.';
comment on column public.deals.site_floor is 'Optional floor at the deal jobsite.';
comment on column public.deals.site_tenant_name is 'Optional tenant or doorbell name at the deal jobsite; not a customer relation.';
