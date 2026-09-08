-- One REAL database session of the concurrency matrix. Invoked N times in
-- parallel by contact_primary_intent_concurrency_runner.ps1 with psql
-- variables:
--   scenario  A|B|C|D|E|F
--   worker    label
--   fire_at   unix epoch (float) — every worker sleeps until this instant so
--             the commands genuinely overlap
--   target    contact id (update scenarios) or customer id (create scenarios)
--   expected  expected primary contact id ('' = null)
--   key       idempotency key uuid ('' = null)
--   payload   contact json, base64 (create scenarios)
--   patch     patch json, base64 (update scenarios)
-- Outcome is recorded in public.cpi_conc_results as postgres.

\set ON_ERROR_STOP off

-- psql variables are not expanded inside dollar-quoted bodies: hand them over
-- as session GUCs first.
select set_config('cpi.scenario', :'scenario', false),
       set_config('cpi.worker', :'worker', false),
       set_config('cpi.fire_at', :'fire_at', false),
       set_config('cpi.target', :'target', false),
       set_config('cpi.expected', :'expected', false),
       set_config('cpi.key', :'key', false),
       set_config('cpi.payload', case when :'payload' = '' then '' else convert_from(decode(:'payload', 'base64'), 'utf8') end, false),
       set_config('cpi.patch', case when :'patch' = '' then '' else convert_from(decode(:'patch', 'base64'), 'utf8') end, false),
       set_config('cpi.intent', :'intent', false);

do $$
declare
    v_scenario text := current_setting('cpi.scenario', true);
    v_worker text := current_setting('cpi.worker', true);
    v_fire_at double precision := nullif(current_setting('cpi.fire_at', true), '')::double precision;
    v_expected bigint := nullif(current_setting('cpi.expected', true), '')::bigint;
    v_key uuid := nullif(current_setting('cpi.key', true), '')::uuid;
    v_target bigint := nullif(current_setting('cpi.target', true), '')::bigint;
    v_result jsonb;
    v_detail text; v_sqlstate text; v_message text;
    v_op uuid := gen_random_uuid();
begin
    if v_fire_at is not null then
        perform pg_sleep(greatest(0, v_fire_at - extract(epoch from clock_timestamp())));
    end if;

    perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-0000000000c1', true);
    perform set_config('nora.operation_id', v_op::text, true);
    execute 'set local role authenticated';

    begin
        if v_scenario in ('A') then
            v_result := public.update_contact(v_target, '{}'::jsonb, 'make_primary', v_expected);
        elsif v_scenario in ('B', 'D', 'E') then
            v_result := public.create_contact(current_setting('cpi.payload', true)::jsonb, 'make_primary', v_expected, v_key);
        elsif v_scenario = 'C' then
            v_result := public.update_contact(v_target, '{}'::jsonb, 'make_primary', v_expected);
        elsif v_scenario = 'F' then
            v_result := public.update_contact(v_target, current_setting('cpi.patch', true)::jsonb, current_setting('cpi.intent', true), v_expected);
        else
            raise exception 'unknown scenario %', v_scenario;
        end if;
        execute 'reset role';
        insert into public.cpi_conc_results (scenario, worker, outcome, detail, operation_id, result)
        values (v_scenario, v_worker, 'SUCCESS', coalesce(v_result->'_meta'->>'disposition', ''), v_op, v_result);
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail, v_sqlstate = returned_sqlstate, v_message = message_text;
        execute 'reset role';
        insert into public.cpi_conc_results (scenario, worker, outcome, detail, operation_id, result)
        values (v_scenario, v_worker, 'ERROR', coalesce(v_detail, '') || ' [' || v_sqlstate || '] ' || v_message, v_op, null);
    end;
end;
$$;
