-- Atomic Contact Primary Intent — concurrency verification + cleanup.
-- Evaluates public.cpi_conc_results written by the parallel workers of
-- contact_primary_intent_concurrency_runner.ps1 and asserts the invariants
-- the design promises. Prints the raw outcome table for the release report.

\set ON_ERROR_STOP on

select scenario, worker, outcome, detail, operation_id
from public.cpi_conc_results
order by scenario, id;

do $$
declare
    v_k1 bigint := (select id from public.cpi_conc_ctx where key = 'k1');
    v_k2 bigint := (select id from public.cpi_conc_ctx where key = 'k2');
    v_k3 bigint := (select id from public.cpi_conc_ctx where key = 'k3');
    v_a bigint := (select id from public.cpi_conc_ctx where key = 'a');
    v_e bigint := (select id from public.cpi_conc_ctx where key = 'e');
    v_success int; v_changed int; v_error_other int; v_replayed int; v_executed int; v_conflict int;
    v_failures text[] := '{}';
    v_ids bigint[];
    r record;
begin
    -- Global invariant after all scenarios
    if exists (select company_id from public.contacts where is_primary and company_id is not null group by company_id having count(*) > 1) then
        v_failures := array_append(v_failures, 'more than one primary per customer after the concurrency matrix');
    end if;
    if exists (select 1 from public.contacts where is_primary and company_id is null) then
        v_failures := array_append(v_failures, 'primary without customer after the concurrency matrix');
    end if;
    if exists (select 1 from public.cpi_conc_results where detail like '%40P01%' or detail ilike '%deadlock%') then
        v_failures := array_append(v_failures, 'a deadlock occurred');
    end if;

    -- A: two make_primary on K1 both expecting A → exactly one SUCCESS, one NORA_PRIMARY_CONTACT_CHANGED
    select count(*) filter (where outcome = 'SUCCESS'),
           count(*) filter (where outcome = 'ERROR' and detail like 'NORA_PRIMARY_CONTACT_CHANGED%'),
           count(*) filter (where outcome = 'ERROR' and detail not like 'NORA_PRIMARY_CONTACT_CHANGED%')
    into v_success, v_changed, v_error_other
    from public.cpi_conc_results where scenario = 'A';
    if v_success <> 1 or v_changed <> 1 or v_error_other <> 0 then
        v_failures := array_append(v_failures, format('A: expected 1 success + 1 stale refusal, got success=%s changed=%s other=%s', v_success, v_changed, v_error_other));
    end if;
    if (select count(*) from public.contacts where company_id = v_k1 and is_primary) <> 1 then
        v_failures := array_append(v_failures, 'A: K1 does not have exactly one primary');
    end if;
    -- the winner must report the previous holder A as demoted (scenario F may
    -- legitimately promote A again later, so this is judged from the result)
    if (select (result->>'demoted_contact_id')::bigint from public.cpi_conc_results where scenario = 'A' and outcome = 'SUCCESS' limit 1) is distinct from v_a then
        v_failures := array_append(v_failures, 'A: the winner did not report the previous holder A as demoted');
    end if;

    -- B: two create+make_primary on K2 expecting D → exactly one contact created & primary, other refused, nothing half-written
    select count(*) filter (where outcome = 'SUCCESS'),
           count(*) filter (where outcome = 'ERROR' and detail like 'NORA_PRIMARY_CONTACT_CHANGED%'),
           count(*) filter (where outcome = 'ERROR' and detail not like 'NORA_PRIMARY_CONTACT_CHANGED%')
    into v_success, v_changed, v_error_other
    from public.cpi_conc_results where scenario = 'B' and worker like 'w%';
    if v_success <> 1 or v_changed <> 1 or v_error_other <> 0 then
        v_failures := array_append(v_failures, format('B: expected 1 success + 1 stale refusal, got success=%s changed=%s other=%s', v_success, v_changed, v_error_other));
    end if;
    if (select count(*) from public.contacts where company_id = v_k2 and last_name like 'NewB%') <> 1 then
        v_failures := array_append(v_failures, 'B: the refused create left a contact behind (or none was created)');
    end if;

    -- C: holder session committed a new K3 primary; both stale workers refused, nothing written by them
    if (select count(*) from public.cpi_conc_results where scenario = 'C' and outcome = 'ERROR' and detail like 'NORA_PRIMARY_CONTACT_CHANGED%') <> 1 then
        v_failures := array_append(v_failures, 'C: stale update was not refused with NORA_PRIMARY_CONTACT_CHANGED');
    end if;
    if (select count(*) from public.cpi_conc_results where scenario = 'B' and worker = 'stale-create' and outcome = 'ERROR' and detail like 'NORA_PRIMARY_CONTACT_CHANGED%') <> 1 then
        v_failures := array_append(v_failures, 'C: stale create was not refused with NORA_PRIMARY_CONTACT_CHANGED');
    end if;
    if exists (select 1 from public.contacts where last_name = 'StaleC') then
        v_failures := array_append(v_failures, 'C: the refused stale create left a contact behind');
    end if;
    if (select id from public.contacts where company_id = v_k3 and is_primary) = v_e then
        v_failures := array_append(v_failures, 'C: the holder session did not replace E');
    end if;
    -- the stale worker must have waited for the holder's commit (recorded after the holder's 4s sleep)
    if (select min(recorded_at) from public.cpi_conc_results where scenario = 'C')
       < (select first_seen + interval '3 seconds' from public.contacts where last_name = 'HolderC') then
        v_failures := array_append(v_failures, 'C: the stale worker did not block on the customer lock');
    end if;

    -- D: three parallel creates with the same key + payload → one executed, two replayed, ONE contact, same contact_id, K1 exactly one primary
    select count(*) filter (where outcome = 'SUCCESS' and detail = 'executed'),
           count(*) filter (where outcome = 'SUCCESS' and detail = 'replayed'),
           count(*) filter (where outcome = 'ERROR')
    into v_executed, v_replayed, v_error_other
    from public.cpi_conc_results where scenario = 'D';
    if v_executed <> 1 or v_replayed <> 2 or v_error_other <> 0 then
        v_failures := array_append(v_failures, format('D: expected 1 executed + 2 replayed, got executed=%s replayed=%s errors=%s', v_executed, v_replayed, v_error_other));
    end if;
    select array_agg(distinct (result->>'contact_id')::bigint) into v_ids from public.cpi_conc_results where scenario = 'D' and outcome = 'SUCCESS';
    if cardinality(v_ids) <> 1 then
        v_failures := array_append(v_failures, 'D: replays returned different contact ids');
    end if;
    if (select count(*) from public.contacts where last_name = 'IdemD') <> 1 then
        v_failures := array_append(v_failures, 'D: duplicate contact created under the same idempotency key');
    end if;
    if (select count(*) from public.audit_events where event_type = 'contact.created' and contact_id = v_ids[1]) <> 1 then
        v_failures := array_append(v_failures, 'D: duplicate contact.created audit under replay');
    end if;

    -- E: same key, different payload → one executed, one NORA_IDEMPOTENCY_CONFLICT, exactly one contact
    select count(*) filter (where outcome = 'SUCCESS'),
           count(*) filter (where outcome = 'ERROR' and detail like 'NORA_IDEMPOTENCY_CONFLICT%'),
           count(*) filter (where outcome = 'ERROR' and detail not like 'NORA_IDEMPOTENCY_CONFLICT%')
    into v_success, v_conflict, v_error_other
    from public.cpi_conc_results where scenario = 'E';
    if v_success <> 1 or v_conflict <> 1 or v_error_other <> 0 then
        v_failures := array_append(v_failures, format('E: expected 1 success + 1 idempotency conflict, got success=%s conflict=%s other=%s', v_success, v_conflict, v_error_other));
    end if;
    if (select count(*) from public.contacts where last_name like 'IdemE%') <> 1 then
        v_failures := array_append(v_failures, 'E: conflicting payload was written');
    end if;

    -- F: move+make_primary vs make_primary on the source customer → no deadlock, every customer ≤ 1 primary, outcomes explainable
    for r in select worker, outcome, detail from public.cpi_conc_results where scenario = 'F' loop
        if r.outcome = 'ERROR' and r.detail not like 'NORA_PRIMARY_CONTACT_CHANGED%' then
            v_failures := array_append(v_failures, format('F: unexpected error for %s: %s', r.worker, r.detail));
        end if;
    end loop;
    if (select count(*) from public.contacts where company_id = v_k1 and is_primary) > 1
       or (select count(*) from public.contacts where company_id = v_k3 and is_primary) > 1 then
        v_failures := array_append(v_failures, 'F: more than one primary on a customer after the move race');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'CONCURRENCY MATRIX FAILED:\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'contact_primary_intent concurrency matrix: A–F passed (no deadlock, ≤1 primary everywhere, stale/replay/conflict as designed)';
end;
$$;

-- final state for the report
select c.id, c.name,
       (select string_agg(co.last_name || case when co.is_primary then '*' else '' end, ', ' order by co.id)
        from public.contacts co where co.company_id = c.id) as contacts
from public.companies c
where c.id in (select id from public.cpi_conc_ctx where key in ('k1', 'k2', 'k3'))
order by c.id;

-- cleanup (contacts/companies/results only — sales rows stay, W6-B guard)
delete from public.contacts where company_id in (select id from public.cpi_conc_ctx where key in ('k1', 'k2', 'k3'));
delete from public.companies where id in (select id from public.cpi_conc_ctx where key in ('k1', 'k2', 'k3'));
drop table public.cpi_conc_results;
drop table public.cpi_conc_ctx;
