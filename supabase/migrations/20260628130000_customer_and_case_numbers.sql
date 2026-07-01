-- Nora CRM: Kundennummern (KD-000001) und Vorgangsnummern (VG-YYYY-000001)

create table public.number_counters (
    counter_key text not null,
    year smallint not null default 0,
    last_value bigint not null default 0,
    primary key (counter_key, year)
);

revoke all on table public.number_counters from anon;
revoke all on table public.number_counters from authenticated;
revoke all on table public.number_counters from public;

alter table public.companies
    add column customer_number text;

alter table public.deals
    add column case_number text;

create or replace function public.format_customer_number(seq bigint)
returns text
language sql
immutable
set search_path to public
as $$
    select 'KD-' || lpad(seq::text, 6, '0');
$$;

create or replace function public.format_case_number(p_year integer, seq bigint)
returns text
language sql
immutable
set search_path to public
as $$
    select 'VG-' || p_year::text || '-' || lpad(seq::text, 6, '0');
$$;

create or replace function public.next_customer_number()
returns text
language plpgsql
security definer
set search_path to public
as $$
declare
    v_seq bigint;
begin
    insert into public.number_counters (counter_key, year, last_value)
    values ('customer', 0, 1)
    on conflict (counter_key, year)
    do update set last_value = public.number_counters.last_value + 1
    returning last_value into v_seq;

    return public.format_customer_number(v_seq);
end;
$$;

create or replace function public.next_case_number(p_at timestamp with time zone default now())
returns text
language plpgsql
security definer
set search_path to public
as $$
declare
    v_year integer;
    v_seq bigint;
begin
    v_year := extract(year from coalesce(p_at, now()))::integer;

    insert into public.number_counters (counter_key, year, last_value)
    values ('deal_case', v_year, 1)
    on conflict (counter_key, year)
    do update set last_value = public.number_counters.last_value + 1
    returning last_value into v_seq;

    return public.format_case_number(v_year, v_seq);
end;
$$;

create or replace function public.assign_customer_number()
returns trigger
language plpgsql
set search_path to public
as $$
begin
    if new.customer_number is null then
        new.customer_number := public.next_customer_number();
    end if;
    return new;
end;
$$;

create or replace function public.assign_case_number()
returns trigger
language plpgsql
set search_path to public
as $$
begin
    if new.case_number is null then
        new.case_number := public.next_case_number(coalesce(new.created_at, now()));
    end if;
    return new;
end;
$$;

create or replace function public.prevent_customer_number_change()
returns trigger
language plpgsql
set search_path to public
as $$
begin
    if tg_op = 'UPDATE' then
        if old.customer_number is not null
            and new.customer_number is distinct from old.customer_number then
            raise exception 'customer_number is immutable';
        end if;
    end if;
    return new;
end;
$$;

create or replace function public.prevent_case_number_change()
returns trigger
language plpgsql
set search_path to public
as $$
begin
    if tg_op = 'UPDATE' then
        if old.case_number is not null
            and new.case_number is distinct from old.case_number then
            raise exception 'case_number is immutable';
        end if;
    end if;
    return new;
end;
$$;

-- Backfill bestehender Kunden
with ordered as (
    select
        id,
        row_number() over (order by created_at asc, id asc) as rn
    from public.companies
    where customer_number is null
)
update public.companies c
set customer_number = public.format_customer_number(o.rn)
from ordered o
where c.id = o.id;

-- Backfill bestehender Vorgänge (laufende Nummer pro Jahr)
with ordered as (
    select
        id,
        extract(year from created_at)::integer as yr,
        row_number() over (
            partition by extract(year from created_at)
            order by created_at asc, id asc
        ) as rn
    from public.deals
    where case_number is null
)
update public.deals d
set case_number = public.format_case_number(o.yr, o.rn)
from ordered o
where d.id = o.id;

-- Zählerstände aus Backfill übernehmen
insert into public.number_counters (counter_key, year, last_value)
select
    'customer',
    0,
    coalesce(max((regexp_match(customer_number, '^KD-(\d+)$'))[1]::bigint), 0)
from public.companies
on conflict (counter_key, year)
do update set last_value = greatest(
    public.number_counters.last_value,
    excluded.last_value
);

insert into public.number_counters (counter_key, year, last_value)
select
    'deal_case',
    (regexp_match(case_number, '^VG-(\d{4})-'))[1]::smallint,
    max((regexp_match(case_number, '-(\d{6})$'))[1]::bigint)
from public.deals
where case_number is not null
group by 2
on conflict (counter_key, year)
do update set last_value = greatest(
    public.number_counters.last_value,
    excluded.last_value
);

alter table public.companies
    alter column customer_number set not null;

alter table public.deals
    alter column case_number set not null;

alter table public.companies
    add constraint companies_customer_number_key unique (customer_number);

alter table public.deals
    add constraint deals_case_number_key unique (case_number);

create trigger assign_customer_number_trigger
    before insert on public.companies
    for each row execute function public.assign_customer_number();

create trigger prevent_customer_number_change_trigger
    before update on public.companies
    for each row execute function public.prevent_customer_number_change();

create trigger assign_case_number_trigger
    before insert on public.deals
    for each row execute function public.assign_case_number();

create trigger prevent_case_number_change_trigger
    before update on public.deals
    for each row execute function public.prevent_case_number_change();

create or replace view public.companies_summary with (security_invoker = on) as
select
    c.id,
    c.created_at,
    c.name,
    c.sector,
    c.size,
    c.linkedin_url,
    c.website,
    c.phone_number,
    c.address,
    c.zipcode,
    c.city,
    c.state_abbr,
    c.sales_id,
    c.context_links,
    c.country,
    c.description,
    c.revenue,
    c.tax_identifier,
    c.logo,
    count(distinct d.id) as nb_deals,
    count(distinct co.id) as nb_contacts,
    c.customer_number
from public.companies c
    left join public.deals d on c.id = d.company_id
    left join public.contacts co on c.id = co.company_id
group by c.id;

grant all on function public.format_customer_number(bigint) to anon;
grant all on function public.format_customer_number(bigint) to authenticated;
grant all on function public.format_customer_number(bigint) to service_role;

grant all on function public.format_case_number(integer, bigint) to anon;
grant all on function public.format_case_number(integer, bigint) to authenticated;
grant all on function public.format_case_number(integer, bigint) to service_role;

grant all on function public.next_customer_number() to anon;
grant all on function public.next_customer_number() to authenticated;
grant all on function public.next_customer_number() to service_role;

grant all on function public.next_case_number(timestamp with time zone) to anon;
grant all on function public.next_case_number(timestamp with time zone) to authenticated;
grant all on function public.next_case_number(timestamp with time zone) to service_role;

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
