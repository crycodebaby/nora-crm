-- Nora CRM: W7-R1B Deal.company_id Contract Parity (2026-09-13)
--
-- Domain contract: every Nora deal (Vorgang) belongs to exactly one company
-- (Kunde). `Deal.company_id: Identifier` has always been non-null in the
-- application domain; the database column inherited from Atomic CRM was still
-- nullable. This migration aligns the database with the domain — it does NOT
-- soften the domain type.
--
-- Scope is nullability only:
--   * no backfill, no default, no data correction, no deleted rows
--   * deals_company_id_fkey (references, ON UPDATE / ON DELETE behaviour) is
--     deliberately untouched — delete/lifecycle semantics are out of scope
--
-- Fail-closed: if any deal without a company exists, the migration aborts
-- before the DDL and nothing is applied. `SET NOT NULL` additionally runs its
-- own full validation scan under an ACCESS EXCLUSIVE lock, so a NULL row
-- written between the preflight and the DDL still fails the migration (23502)
-- instead of being silently accepted.

do $$
declare
    v_null_deals bigint;
begin
    select count(*) into v_null_deals
    from public.deals
    where company_id is null;

    if v_null_deals > 0 then
        raise exception
            'W7-R1B cannot be applied: % deal(s) without a company (public.deals.company_id IS NULL) exist',
            v_null_deals
            using errcode = '23502',
                  hint = 'Every Nora deal must belong to exactly one company. Resolve these rows with an explicit Product Owner decision; this migration never backfills.';
    end if;
end;
$$;

alter table public.deals
    alter column company_id set not null;
