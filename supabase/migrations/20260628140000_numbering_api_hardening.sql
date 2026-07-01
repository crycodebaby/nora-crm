-- Nora CRM: Hardening — Nummern nur per Trigger, keine Client-RPC auf Zählerfunktionen

create or replace function public.assign_customer_number()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
    new.customer_number := public.next_customer_number();
    return new;
end;
$$;

create or replace function public.assign_case_number()
returns trigger
language plpgsql
security definer
set search_path to public
as $$
begin
    new.case_number := public.next_case_number(coalesce(new.created_at, now()));
    return new;
end;
$$;

-- Interne Zähler-/Formatfunktionen: nicht per PostgREST-RPC für Client-Rollen
revoke all on function public.next_customer_number() from public;
revoke all on function public.next_customer_number() from anon;
revoke all on function public.next_customer_number() from authenticated;

revoke all on function public.next_case_number(timestamp with time zone) from public;
revoke all on function public.next_case_number(timestamp with time zone) from anon;
revoke all on function public.next_case_number(timestamp with time zone) from authenticated;

revoke all on function public.format_customer_number(bigint) from public;
revoke all on function public.format_customer_number(bigint) from anon;
revoke all on function public.format_customer_number(bigint) from authenticated;

revoke all on function public.format_case_number(integer, bigint) from public;
revoke all on function public.format_case_number(integer, bigint) from anon;
revoke all on function public.format_case_number(integer, bigint) from authenticated;

grant execute on function public.next_customer_number() to service_role;
grant execute on function public.next_case_number(timestamp with time zone) to service_role;
grant execute on function public.format_customer_number(bigint) to service_role;
grant execute on function public.format_case_number(integer, bigint) to service_role;
