-- Nora CRM: keep RLS identity resolution compatible with current PostgREST.
-- PostgREST exposes JWT claims as request.jwt.claims JSON. Older local tests
-- and versions also expose request.jwt.claim.sub, so both inputs stay supported.

create or replace function nora_private.safe_auth_uid()
returns uuid
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
    v_sub text;
    v_claims text;
begin
    v_sub := nullif(current_setting('request.jwt.claim.sub', true), '');

    if v_sub is null then
        v_claims := nullif(current_setting('request.jwt.claims', true), '');

        if v_claims is not null then
            begin
                v_sub := nullif(v_claims::jsonb ->> 'sub', '');
            exception
                when invalid_text_representation then
                    return null;
            end;
        end if;
    end if;

    if v_sub is null then
        return null;
    end if;

    begin
        return v_sub::uuid;
    exception
        when invalid_text_representation then
            return null;
    end;
end;
$$;

alter function nora_private.safe_auth_uid() owner to postgres;

comment on function nora_private.safe_auth_uid() is
    'Internal JWT sub reader supporting legacy claim GUC and request.jwt.claims JSON; returns NULL on missing/invalid input.';

revoke all on function nora_private.safe_auth_uid() from public;
revoke all on function nora_private.safe_auth_uid() from anon;
grant execute on function nora_private.safe_auth_uid() to authenticated;
grant execute on function nora_private.safe_auth_uid() to service_role;
