-- Atomic Contact Primary Intent — TRIGGER-RACE verification + cleanup.
--
-- Assertion principle: outcome classes and invariants, never one arbitrary
-- race winner and never a wall-clock duration.
--
-- What this matrix must prove:
--   * the contact-row-first customer write done by
--     nora_private.sync_individual_company_name can no longer deadlock with a
--     primary-contact transition (the second 2026-09-08 blocker),
--   * the Privatkundenakte name stays synchronized with its self contact,
--   * a rename on ONE customer does not serialize a transition on ANOTHER.

\set ON_ERROR_STOP on

select scenario, role, outcome, sqlstate, count(*) as n
from public.cpi_t_results
group by 1, 2, 3, 4
order by 1, 2, 3;

do $$
declare
    v_failures text[] := '{}';
    r record;
    v_n int;
    v_overlap int;
begin
    -- 1. the blocker: no deadlock anywhere
    if exists (select 1 from public.cpi_t_results where sqlstate = '40P01') then
        v_failures := v_failures || format('DEADLOCK (40P01) in %s trigger race(s)',
            (select count(*) from public.cpi_t_results where sqlstate = '40P01'));
    end if;

    -- 2. no unexplained failure; the raw rename must never fail at all
    for r in
        select scenario, role, sqlstate, detail
        from public.cpi_t_results
        where outcome = 'ERROR' and sqlstate <> '40001' and detail not like 'NORA\_%'
    loop
        v_failures := v_failures || format('%s/%s: unexplained error [%s] %s',
            r.scenario, r.role, r.sqlstate, left(r.detail, 120));
    end loop;
    select count(*) into v_n from public.cpi_t_results where role = 'w1' and outcome <> 'SUCCESS';
    if v_n <> 0 then
        v_failures := v_failures || format('%s raw contact-name writes did not commit', v_n);
    end if;

    -- 3. the primary transition must succeed in every scenario: a rename never
    --    changes who holds the slot, so the observed holder stays valid.
    for r in
        select scenario, role, sqlstate, detail
        from public.cpi_t_results
        where role = 'w2' and outcome <> 'SUCCESS'
    loop
        v_failures := v_failures || format('%s/w2: primary transition failed [%s] %s',
            r.scenario, r.sqlstate, left(r.detail, 120));
    end loop;

    -- 4. the invariant
    if exists (
        select 1 from public.contacts
        where is_primary and company_id is not null
        group by company_id having count(*) > 1
    ) then
        v_failures := v_failures || 'more than one primary contact on a customer';
    end if;

    -- 5. Privatkunden name synchronization survived the races: every
    --    individual customer still carries its self contact's canonical name.
    for r in
        select c.id, c.name, concat(ct.first_name, ' ', ct.last_name) as derived
        from public.companies c
        join public.contacts ct on ct.id = c.self_contact_id
        where c.customer_kind = 'individual'
          and c.id in (select id from public.cpi_t_ctx where key = 'c')
    loop
        if r.name is distinct from r.derived then
            v_failures := v_failures || format('customer %s name %L is not its self contact name %L',
                r.id, r.name, r.derived);
        end if;
    end loop;

    -- 6. T-E: a rename on customer C must NOT serialize a transition on the
    --    unrelated customer D. Proven by overlap of the two execution windows,
    --    which is impossible if one waited for the other's lock.
    select count(*) into v_overlap
    from public.cpi_t_results a
    join public.cpi_t_results b
      on b.round = a.round and b.scenario = a.scenario and b.role = 'w2'
    where a.scenario = 'T-E' and a.role = 'w1'
      and a.started_at < b.finished_at and b.started_at < a.finished_at;
    if v_overlap = 0 then
        v_failures := v_failures || 'T-E: rename and the transition on a DIFFERENT customer never overlapped - they are serializing unnecessarily';
    end if;

    -- 7. coverage
    for r in select unnest(array['T-A','T-B','T-C','T-D','T-E','T-F']) as scenario loop
        select count(*) into v_n from public.cpi_t_results where scenario = r.scenario;
        if v_n = 0 then
            v_failures := v_failures || format('%s: did not run at all', r.scenario);
        elsif v_n <> (select count(distinct round) * 2 from public.cpi_t_results where scenario = r.scenario) then
            v_failures := v_failures || format('%s: not exactly two worker rows per round', r.scenario);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'TRIGGER RACE MATRIX FAILED:\n%', array_to_string(v_failures, E'\n');
    end if;

    raise notice 'contact_primary trigger matrix T-A..T-F over % round(s): no deadlock, name sync intact, no cross-customer serialization',
        (select count(distinct round) from public.cpi_t_results);
end;
$$;

-- cleanup (contacts/companies/results only — sales rows stay, W6-B guard)
delete from public.deals where company_id in (select id from public.cpi_t_ctx where key in ('c', 'd'));
-- drop the Privatkundenakte flag together with the self contact, otherwise the
-- deferred check_individual_company_has_self_contact trigger refuses at COMMIT
update public.companies
   set customer_kind = 'business', self_contact_id = null
 where id in (select id from public.cpi_t_ctx where key in ('c', 'd'));
delete from public.contacts where company_id in (select id from public.cpi_t_ctx where key in ('c', 'd'));
delete from public.companies where id in (select id from public.cpi_t_ctx where key in ('c', 'd'));
drop table public.cpi_t_results;
drop table public.cpi_t_ctx;
