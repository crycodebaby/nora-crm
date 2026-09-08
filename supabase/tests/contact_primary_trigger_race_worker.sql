-- Atomic Contact Primary Intent — TRIGGER-RACE worker (one real session).
--
-- role w1 = the RAW, intent-free contact-name write (Contact Merge / import
--           shape). It fires nora_private.sync_individual_company_name, which
--           updates public.companies while the contact row is already locked.
-- role w2 = the primary-contact command it is raced against.
--
-- Invoked in parallel by contact_primary_trigger_race_runner.ps1 with psql
-- variables: scenario, role, round, fire_at.

\set ON_ERROR_STOP off
set statement_timeout = '60s';

select set_config('cpit.scenario', :'scenario', false),
       set_config('cpit.role', :'role', false),
       set_config('cpit.round', :'round', false),
       set_config('cpit.fire_at', :'fire_at', false);

do $$
declare
    v_scenario text := current_setting('cpit.scenario', true);
    v_role text := current_setting('cpit.role', true);
    v_round int := current_setting('cpit.round', true)::int;
    v_fire double precision := nullif(current_setting('cpit.fire_at', true), '')::double precision;
    v_c bigint; v_s bigint; v_t bigint; v_d bigint; v_d1 bigint; v_d2 bigint;
    v_started timestamptz;
    v_detail text; v_sqlstate text; v_message text;
    v_tag text := 'R' || v_round || '-' || clock_timestamp()::text;
begin
    select max(case when key='c' then id end),  max(case when key='s' then id end),
           max(case when key='t' then id end),  max(case when key='d' then id end),
           max(case when key='d1' then id end), max(case when key='d2' then id end)
    into v_c, v_s, v_t, v_d, v_d1, v_d2
    from public.cpi_t_ctx where round = v_round;

    if v_c is null then
        raise exception 'trigger-race fixture for round % is missing', v_round;
    end if;

    if v_fire is not null then
        perform pg_sleep(greatest(0, v_fire - extract(epoch from clock_timestamp())));
    end if;

    perform set_config('request.jwt.claim.sub', 'c0000000-0000-4000-8000-0000000000c1', true);
    v_started := clock_timestamp();

    begin
        if v_role = 'w1' then
            -- RAW contact-name write: no save intent, no is_primary — exactly
            -- what dataProvider.mergeContacts sends, which the provider
            -- deliberately does NOT route through public.update_contact.
            -- Executed as the browser role under RLS, i.e. byte-for-byte the
            -- statement PostgREST issues for that PATCH.
            execute 'set local role authenticated';
            if v_scenario = 'T-A' then
                update public.contacts set first_name = 'TMerge' || v_tag where id = v_s;
            elsif v_scenario = 'T-B' then
                update public.contacts set last_name = 'TMerge' || v_tag where id = v_s;
            elsif v_scenario in ('T-C', 'T-D', 'T-E') then
                update public.contacts
                   set first_name = 'TMerge' || v_tag, last_name = 'TMerge' || v_tag
                 where id = v_s;
            else
                -- T-F: an ordinary NON-self contact of an ordinary customer.
                -- The sync trigger fires but updates no customer row.
                update public.contacts
                   set first_name = 'TMerge' || v_tag, last_name = 'TMerge' || v_tag
                 where id = v_d2;
            end if;
            execute 'reset role';
        else
            if v_scenario = 'T-A' then
                perform public.update_contact(v_t, '{}'::jsonb, 'make_primary', v_s);
            elsif v_scenario = 'T-B' then
                perform public.set_primary_contact(v_t);
            elsif v_scenario = 'T-C' then
                perform public.create_contact(
                    jsonb_build_object('first_name', 'TNeu', 'last_name', 'R' || v_round,
                                       'company_id', v_c),
                    'make_primary', v_s, null);
            elsif v_scenario = 'T-D' then
                perform public.create_quick_capture_case(
                    null, v_c,
                    jsonb_build_object('first_name', 'TQC', 'last_name', 'R' || v_round),
                    null, null,
                    jsonb_build_object('name', 'T Vorgang R' || v_round),
                    true, null);
            elsif v_scenario = 'T-E' then
                -- a DIFFERENT customer: must not serialize with the rename
                perform public.update_contact(v_d2, '{}'::jsonb, 'make_primary', v_d1);
            else
                -- T-F: primary transition on the same ordinary customer whose
                -- non-self contact is being renamed
                perform public.update_contact(v_d2, '{}'::jsonb, 'make_primary', v_d1);
            end if;
        end if;

        insert into public.cpi_t_results (scenario, round, role, outcome, sqlstate, detail, started_at, finished_at)
        values (v_scenario, v_round, v_role, 'SUCCESS', '', '', v_started, clock_timestamp());
    exception when others then
        get stacked diagnostics v_detail = pg_exception_detail,
                                v_sqlstate = returned_sqlstate,
                                v_message = message_text;
        execute 'reset role';
        insert into public.cpi_t_results (scenario, round, role, outcome, sqlstate, detail, started_at, finished_at)
        values (v_scenario, v_round, v_role, 'ERROR', v_sqlstate,
                coalesce(nullif(v_detail, ''), v_message), v_started, clock_timestamp());
    end;
end;
$$;
