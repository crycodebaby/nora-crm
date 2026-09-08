-- Atomic Contact Primary Intent — CROSS-COMMAND concurrency worker.
--
-- One REAL database session of the cross-command matrix X-A..X-F, i.e. the
-- new primary-contact commands raced against the PRE-EXISTING paths that also
-- write public.companies and public.contacts (Quick Capture /
-- create_customer_with_contact / contact moves). The new-vs-new matrix lives
-- in contact_primary_intent_concurrency_worker.sql; this file exists because
-- the 2026-09-08 RC review found a cross-command lock-order inversion that
-- new-vs-new races could never have caught.
--
-- Invoked in parallel by contact_primary_cross_command_runner.ps1 with psql
-- variables:
--   scenario  X-A|X-B|X-C|X-D|X-E|X-F|X-G
--   role      w1 (the pre-existing path) | w2 (the new primary command)
--   round     round number — selects the fixture set in public.cpi_x_ctx
--   fire_at   unix epoch (float); every worker sleeps until this instant so
--             the two commands genuinely overlap inside Postgres
--
-- Outcome is recorded in public.cpi_x_results as postgres.

\set ON_ERROR_STOP off
set statement_timeout = '60s';

select set_config('cpix.scenario', :'scenario', false),
       set_config('cpix.role', :'role', false),
       set_config('cpix.round', :'round', false),
       set_config('cpix.fire_at', :'fire_at', false);

do $$
declare
    v_scenario text := current_setting('cpix.scenario', true);
    v_role text := current_setting('cpix.role', true);
    v_round int := current_setting('cpix.round', true)::int;
    v_fire double precision := nullif(current_setting('cpix.fire_at', true), '')::double precision;
    v_c1 bigint; v_c2 bigint; v_p1 bigint; v_p2 bigint; v_m bigint; v_q1 bigint; v_q2 bigint;
    v_detail text; v_sqlstate text; v_message text;
    v_op uuid := gen_random_uuid();
begin
    select max(case when key = 'c1' then id end), max(case when key = 'c2' then id end),
           max(case when key = 'p1' then id end), max(case when key = 'p2' then id end),
           max(case when key = 'm'  then id end), max(case when key = 'q1' then id end),
           max(case when key = 'q2' then id end)
    into v_c1, v_c2, v_p1, v_p2, v_m, v_q1, v_q2
    from public.cpi_x_ctx where round = v_round;

    if v_c1 is null then
        raise exception 'cross-command fixture for round % is missing', v_round;
    end if;

    -- every worker of the round wakes at the same instant
    if v_fire is not null then
        perform pg_sleep(greatest(0, v_fire - extract(epoch from clock_timestamp())));
    end if;

    perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-0000000000c1', true);
    perform set_config('nora.operation_id', v_op::text, true);

    begin
        if v_role = 'w1' then
            -- the PRE-EXISTING path
            if v_scenario in ('X-A', 'X-B', 'X-C') then
                -- Quick Capture against an EXISTING customer, new contact as primary
                perform public.create_quick_capture_case(
                    null, v_c1,
                    jsonb_build_object('first_name', 'XQC', 'last_name', 'R' || v_round),
                    null, null,
                    jsonb_build_object('name', 'X Vorgang R' || v_round),
                    true, null);
            elsif v_scenario = 'X-D' then
                -- create_customer_with_contact moving an EXISTING contact onto a NEW customer
                perform public.create_customer_with_contact(
                    jsonb_build_object('name', 'X Neu R' || v_round, 'customer_kind', 'business'),
                    null, v_m, null, false, null);
            else
                -- X-E / X-F / X-G: an explicit move of M from C1 to C2 (intent keep)
                perform public.update_contact(v_m, jsonb_build_object('company_id', v_c2), 'keep', null);
            end if;
        else
            -- the NEW primary command
            if v_scenario = 'X-A' then
                perform public.update_contact(v_p2, '{}'::jsonb, 'make_primary', v_p1);
            elsif v_scenario = 'X-B' then
                perform public.set_primary_contact(v_p2);
            elsif v_scenario = 'X-C' then
                perform public.create_contact(
                    jsonb_build_object('first_name', 'XNew', 'last_name', 'R' || v_round,
                                       'company_id', v_c1),
                    'make_primary', v_p1, null);
            elsif v_scenario in ('X-D', 'X-E') then
                -- primary transition on the SOURCE customer of the move
                perform public.update_contact(v_p2, '{}'::jsonb, 'make_primary', v_p1);
            elsif v_scenario = 'X-F' then
                -- primary transition on the TARGET customer of the move
                perform public.update_contact(v_q2, '{}'::jsonb, 'make_primary', v_q1);
            else
                -- X-G: the OPPOSITE-direction move. w1 moves C1 -> C2 while
                -- this session moves C2 -> C1, so the two transactions want the
                -- same pair of customers in opposite order. Only a deterministic
                -- ascending acquisition order keeps this deadlock-free.
                perform public.update_contact(v_q2, jsonb_build_object('company_id', v_c1), 'keep', null);
            end if;
        end if;

        insert into public.cpi_x_results (scenario, round, role, outcome, sqlstate, detail, operation_id)
        values (v_scenario, v_round, v_role, 'SUCCESS', '', '', v_op);
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail,
                                v_sqlstate = returned_sqlstate,
                                v_message = message_text;
        insert into public.cpi_x_results (scenario, round, role, outcome, sqlstate, detail, operation_id)
        values (v_scenario, v_round, v_role, 'ERROR', v_sqlstate,
                coalesce(nullif(v_detail, ''), v_message), v_op);
    end;
end;
$$;
