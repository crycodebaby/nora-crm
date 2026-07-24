-- Nora CRM: recognize service_role via legacy claim GUC and request.jwt.claims JSON.
-- Root cause: set_sales_role_by_admin only read request.jwt.claim.role. PostgREST
-- (and supabase-js service-role RPCs) expose role primarily under request.jwt.claims.
-- Empty legacy GUC caused fallback to nora_private.is_admin(), which fails for
-- service_role (no sales profile) → SQLSTATE 42501 forbidden.

create or replace function nora_private.safe_auth_role()
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_role text;
    v_claims text;
begin
    v_role := nullif(current_setting('request.jwt.claim.role', true), '');

    if v_role is null then
        v_claims := nullif(current_setting('request.jwt.claims', true), '');

        if v_claims is not null then
            begin
                v_role := nullif(v_claims::jsonb ->> 'role', '');
            exception
                when invalid_text_representation then
                    return null;
            end;
        end if;
    end if;

    return v_role;
end;
$$;

alter function nora_private.safe_auth_role() owner to postgres;

comment on function nora_private.safe_auth_role() is
    'Internal JWT role reader supporting legacy request.jwt.claim.role and request.jwt.claims JSON; returns NULL on missing/invalid input. Not a client-trust surface.';

revoke all on function nora_private.safe_auth_role() from public;
revoke all on function nora_private.safe_auth_role() from anon;
grant execute on function nora_private.safe_auth_role() to authenticated;
grant execute on function nora_private.safe_auth_role() to service_role;

create or replace function public.set_sales_role_by_admin(
    p_sale_id bigint,
    p_role text,
    p_disabled boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
    if p_role is null or p_role not in ('admin', 'office', 'viewer') then
        raise exception 'invalid role: %', p_role using errcode = '22023';
    end if;

    -- service_role (Edge/admin path) OR active Nora admin JWT
    if coalesce(nora_private.safe_auth_role(), '') <> 'service_role' then
        if not nora_private.is_admin() then
            raise exception 'forbidden' using errcode = '42501';
        end if;
    end if;

    if not exists (select 1 from public.sales where id = p_sale_id) then
        raise exception 'sales profile not found: %', p_sale_id using errcode = 'P0002';
    end if;

    perform nora_private.apply_sales_role_change(p_sale_id, p_role, p_disabled);
end;
$$;

comment on function public.set_sales_role_by_admin(bigint, text, boolean) is
    'Admin or service_role only: set Nora role and optional disabled via nora_role_manager. Uses nora_private.safe_auth_role() for JWT role detection (legacy GUC + claims JSON).';

revoke all on function public.set_sales_role_by_admin(bigint, text, boolean) from public;
revoke all on function public.set_sales_role_by_admin(bigint, text, boolean) from anon;
grant execute on function public.set_sales_role_by_admin(bigint, text, boolean) to authenticated;
grant execute on function public.set_sales_role_by_admin(bigint, text, boolean) to service_role;
