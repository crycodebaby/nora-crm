-- Atomic Contact Primary Intent — CROSS-COMMAND concurrency verification.
--
-- Evaluates public.cpi_x_results written by the parallel workers of
-- contact_primary_cross_command_runner.ps1 and cleans the fixtures up.
--
-- Assertion principle (RC review 2026-09-08, LOW "timing-dependent
-- assertion"): a concurrency test asserts OUTCOME CLASSES and INVARIANTS,
-- never one arbitrary race winner. Where the protocol genuinely does not fix
-- an order — X-A and X-C, in which Quick Capture and the new primary command
-- compete for the same slot — EITHER competitor may win, and both
-- "SUCCESS" and "NORA_PRIMARY_CONTACT_CHANGED" are correct for the new
-- command. Where the protocol DOES fix the outcome (the pre-existing path
-- always gets its customer lock and always commits; a move never touches the
-- primary of either customer), the stronger assertion is made deliberately
-- and is documented per scenario below.

\set ON_ERROR_STOP on

select scenario, role, outcome, sqlstate, count(*) as n
from public.cpi_x_results
group by 1, 2, 3, 4
order by 1, 2, 3;

do $$
declare
    v_failures text[] := '{}';
    v_rounds int := (select count(distinct round) from public.cpi_x_results);
    r record;
    v_n int;
begin
    -- ---------------------------------------------------------------- global
    -- 1. the blocker itself: not a single deadlock in any cross-command race
    if exists (select 1 from public.cpi_x_results where sqlstate = '40P01') then
        v_failures := v_failures || format('DEADLOCK (40P01) in %s cross-command race(s)',
            (select count(*) from public.cpi_x_results where sqlstate = '40P01'));
    end if;

    -- 2. no unexplained error: every failure must carry a Nora error contract
    --    DETAIL, or be the bounded concurrent-move retry (40001). A raw,
    --    untranslated 23505 out of the unique index is exactly the second
    --    defect the review found and must never appear again.
    for r in
        select scenario, role, sqlstate, detail
        from public.cpi_x_results
        where outcome = 'ERROR'
          and sqlstate <> '40001'
          and detail not like 'NORA\_%'
    loop
        v_failures := v_failures || format('%s/%s: unexplained error [%s] %s',
            r.scenario, r.role, r.sqlstate, left(r.detail, 120));
    end loop;

    -- 3. the invariant, after every race of every scenario
    if exists (
        select 1 from public.contacts
        where is_primary and company_id is not null
        group by company_id having count(*) > 1
    ) then
        v_failures := v_failures || 'more than one primary contact on a customer';
    end if;
    if exists (select 1 from public.contacts where is_primary and company_id is null) then
        v_failures := v_failures || 'a primary contact without a customer';
    end if;

    -- 4. coverage: every scenario really ran both roles in every one of its
    --    rounds (rounds are numbered globally, each scenario owns its own set)
    for r in select unnest(array['X-A', 'X-B', 'X-C', 'X-D', 'X-E', 'X-F', 'X-G']) as scenario loop
        select count(*) into v_n
        from public.cpi_x_results s
        where s.scenario = r.scenario;
        if v_n <> (select count(distinct round) * 2 from public.cpi_x_results where scenario = r.scenario) then
            v_failures := v_failures || format('%s: not exactly two worker rows per round (%s rows over %s rounds)',
                r.scenario, v_n, (select count(distinct round) from public.cpi_x_results where scenario = r.scenario));
        end if;
        if v_n = 0 then
            v_failures := v_failures || format('%s: did not run at all', r.scenario);
        end if;
    end loop;

    -- ------------------------------------------------------------ per scenario
    -- w1 is the PRE-EXISTING path (Quick Capture / create_customer_with_contact
    -- / a contact move). Since the blocker fix it takes the customer lock
    -- first and is never the victim of anything: it must always commit.
    select count(*) into v_n from public.cpi_x_results where role = 'w1' and outcome <> 'SUCCESS';
    if v_n <> 0 then
        v_failures := v_failures || format('%s pre-existing-path races did not commit', v_n);
    end if;

    -- X-A / X-C: Quick Capture and the new command compete for the SAME primary
    -- slot. Order is intentionally nondeterministic — either may win. Valid
    -- classes for the new command: SUCCESS, or the stale refusal.
    for r in
        select scenario, role, outcome, sqlstate, detail
        from public.cpi_x_results
        where scenario in ('X-A', 'X-C') and role = 'w2'
          and not (outcome = 'SUCCESS' or detail like 'NORA_PRIMARY_CONTACT_CHANGED%')
    loop
        v_failures := v_failures || format('%s/w2: expected SUCCESS or NORA_PRIMARY_CONTACT_CHANGED, got [%s] %s',
            r.scenario, r.sqlstate, left(r.detail, 120));
    end loop;

    -- X-B: set_primary_contact does not verify an observed holder, so it can
    -- only be serialized, never refused.
    select count(*) into v_n from public.cpi_x_results where scenario = 'X-B' and role = 'w2' and outcome <> 'SUCCESS';
    if v_n <> 0 then
        v_failures := v_failures || format('X-B/w2: set_primary_contact failed %s time(s)', v_n);
    end if;

    -- X-G: two moves that want the same customer pair in opposite order. Both
    -- must commit; only ascending acquisition order makes that possible.
    for r in
        select scenario, role, sqlstate, detail
        from public.cpi_x_results
        where scenario = 'X-G' and outcome <> 'SUCCESS'
    loop
        v_failures := v_failures || format('X-G/%s: opposite-direction move failed [%s] %s',
            r.role, r.sqlstate, left(r.detail, 120));
    end loop;
    for r in
        select x.round, m.id as m_id, q2.id as q2_id, c1.id as c1_id, c2.id as c2_id
        from public.cpi_x_ctx x
        join public.cpi_x_ctx m  on m.round  = x.round and m.key  = 'm'
        join public.cpi_x_ctx q2 on q2.round = x.round and q2.key = 'q2'
        join public.cpi_x_ctx c1 on c1.round = x.round and c1.key = 'c1'
        join public.cpi_x_ctx c2 on c2.round = x.round and c2.key = 'c2'
        where x.key = 'c1'
          and exists (select 1 from public.cpi_x_results s where s.round = x.round and s.scenario = 'X-G')
    loop
        if not exists (select 1 from public.contacts where id = r.m_id  and company_id = r.c2_id)
           or not exists (select 1 from public.contacts where id = r.q2_id and company_id = r.c1_id) then
            v_failures := v_failures || format('X-G round %s: the two contacts did not both reach the other customer', r.round);
        end if;
    end loop;

    -- X-D / X-E / X-F: a move never changes the primary of either customer, so
    -- the concurrent primary transition's observed holder stays valid and the
    -- transition must succeed — this is a fixed outcome, not a race winner.
    for r in
        select scenario, sqlstate, detail
        from public.cpi_x_results
        where scenario in ('X-D', 'X-E', 'X-F') and role = 'w2' and outcome <> 'SUCCESS'
    loop
        v_failures := v_failures || format('%s/w2: primary transition next to a move failed [%s] %s',
            r.scenario, r.sqlstate, left(r.detail, 120));
    end loop;

    -- X-E / X-F final state: M really moved and did not carry a primary flag.
    for r in
        select x.round, x.id as m_id, c2.id as c2_id
        from public.cpi_x_ctx x
        join public.cpi_x_ctx c2 on c2.round = x.round and c2.key = 'c2'
        where x.key = 'm'
          and exists (select 1 from public.cpi_x_results s
                      where s.round = x.round and s.scenario in ('X-E', 'X-F'))
    loop
        if not exists (
            select 1 from public.contacts
            where id = r.m_id and company_id = r.c2_id and not is_primary
        ) then
            v_failures := v_failures || format('X-E/X-F round %s: moved contact is not a non-primary of the target customer', r.round);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'CROSS-COMMAND CONCURRENCY MATRIX FAILED:\n%', array_to_string(v_failures, E'\n');
    end if;

    raise notice 'contact_primary cross-command matrix X-A..X-F over % round(s): no deadlock, no unexplained error, <=1 primary per customer',
        v_rounds;
end;
$$;

-- cleanup (contacts/companies/results only — sales rows stay, W6-B guard)
delete from public.deals where company_id in (select id from public.cpi_x_ctx where key in ('c1', 'c2'))
   or company_id in (select id from public.companies where name like 'X Neu R%');
delete from public.contacts where company_id in (select id from public.cpi_x_ctx where key in ('c1', 'c2'))
   or company_id in (select id from public.companies where name like 'X Neu R%');
update public.companies set self_contact_id = null where name like 'X %';
delete from public.companies where id in (select id from public.cpi_x_ctx where key in ('c1', 'c2'))
   or name like 'X Neu R%';
drop table public.cpi_x_results;
drop table public.cpi_x_ctx;
