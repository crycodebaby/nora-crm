-- Local, self-contained; all fixtures and audit events roll back.
\set ON_ERROR_STOP on
begin;
do $$
declare
    field text;
    expected_comment text;
    actual_type text;
    nullable text;
    default_expression text;
    actual_comment text;
begin
    for field, expected_comment in
        select * from (values
            ('site_street', 'Street and house number of the deal jobsite, independent of the customer address.'),
            ('site_city', 'City of the deal jobsite.'),
            ('site_floor', 'Optional floor at the deal jobsite.'),
            ('site_tenant_name', 'Optional tenant or doorbell name at the deal jobsite; not a customer relation.')
        ) as expected(name, description)
    loop
        select c.data_type, c.is_nullable, c.column_default,
               col_description('public.deals'::regclass, a.attnum)
          into actual_type, nullable, default_expression, actual_comment
          from information_schema.columns c
          join pg_attribute a on a.attrelid = 'public.deals'::regclass and a.attname = c.column_name
         where c.table_schema = 'public' and c.table_name = 'deals' and c.column_name = field;
        if actual_type is distinct from 'text' or nullable is distinct from 'YES'
           or default_expression is not null or actual_comment is distinct from expected_comment then
            raise exception '% schema mismatch: type=%, nullable=%, default=%, comment=%',
                field, actual_type, nullable, default_expression, actual_comment;
        end if;
    end loop;
    raise notice 'PASS: four nullable text site columns, no defaults, exact comments';
end;
$$;
do $$
declare
    company bigint;
    deal bigint;
    field text;
    value text;
    old_value text;
    before_count integer;
    after_count integer;
    diff jsonb;
    previous_events uuid[];
begin
    insert into public.companies(name, address, city) values ('Site contract fixture', 'Kundenstraße', 'Bonn') returning id into company;
    insert into public.deals(name, company_id, stage, site_street)
        values ('Site contract fixture', company, 'neue-anfrage', 'Eigene Straße') returning id into deal;
    if (select count(*) from public.audit_events where deal_id = deal and event_type = 'deal.created') <> 1 then
        raise exception 'create must use the existing single deal.created event';
    end if;
    foreach field in array array['site_street','site_city','site_floor','site_tenant_name'] loop
        foreach value in array array['Erster Wert','Zweiter Wert',null] loop
            execute format('select %I from public.deals where id = $1', field) into old_value using deal;
            select count(*), coalesce(array_agg(id),array[]::uuid[]) into before_count, previous_events from public.audit_events where deal_id = deal;
            execute format('update public.deals set %I = $1 where id = $2', field) using value, deal;
            select count(*) into after_count from public.audit_events where deal_id = deal;
            if after_count <> before_count + 1 then raise exception '% edit/clear must create one event', field; end if;
            select metadata->'changes' into diff from public.audit_events where deal_id = deal and not(id = any(previous_events));
            if diff is distinct from jsonb_build_object(field,jsonb_build_object('old',old_value,'new',value)) then
                raise exception '% wrong diff: %',field,diff;
            end if;
            execute format('update public.deals set %I = $1 where id = $2', field) using value, deal;
            if (select count(*) from public.audit_events where deal_id = deal) <> after_count then raise exception 'no-op created an event'; end if;
        end loop;
    end loop;
    select count(*), array_agg(id) into before_count, previous_events from public.audit_events where deal_id = deal;
    update public.deals set site_street='Snapshot',site_city='Essen',site_floor='2',site_tenant_name='Test' where id=deal;
    if (select count(*) from public.audit_events where deal_id=deal) <> before_count+1 then raise exception 'multi-field change must be one event'; end if;
    select metadata->'changes' into diff from public.audit_events where deal_id=deal and not(id=any(previous_events));
    if (select count(*) from jsonb_object_keys(diff)) <> 4 then raise exception 'multi-field diff incomplete'; end if;
    update public.companies set address='Neue Kundenstraße',city='Köln' where id=company;
    if (select site_street from public.deals where id=deal) <> 'Snapshot' then raise exception 'customer update changed site'; end if;
    select count(*) into before_count from public.audit_events where deal_id=deal;
    begin
        update public.deals set site_city='Rollback' where id=deal;
        raise exception using errcode='ZX001',message='forced rollback';
    exception when sqlstate 'ZX001' then null;
    end;
    if (select count(*) from public.audit_events where deal_id=deal) <> before_count
       or (select site_city from public.deals where id=deal) <> 'Essen' then raise exception 'rollback persisted site or audit'; end if;
    raise notice 'PASS: create, each field set/change/clear, multi-field single event, no-op, snapshot, rollback';
end;
$$;
do $$
declare
    actor uuid := 'e0000000-0000-4000-8000-000000000025';
    sale_id bigint;
    customer_id bigint;
    result jsonb;
    quick_deal public.deals%rowtype;
begin
    insert into auth.users (
        instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
        recovery_sent_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, confirmation_token, email_change, email_change_token_new, recovery_token
    ) values (
        '00000000-0000-0000-0000-000000000000', actor, 'authenticated', 'authenticated',
        'site-office@nora.test', crypt('password', gen_salt('bf')), now(), now(), now(),
        '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
        now(), now(), '', '', '', ''
    );
    select id into sale_id from public.sales where user_id = actor;
    perform nora_private.apply_sales_role_change(sale_id, 'office', false);
    insert into public.companies(name, address, city)
        values ('Quick Capture site fixture', 'Kundenstraße', 'Bonn') returning id into customer_id;
    perform set_config('request.jwt.claim.sub', actor::text, true);
    execute 'set local role authenticated';
    result := public.create_quick_capture_case(
        null, customer_id, null, null, null,
        jsonb_build_object('name', 'Quick Capture site fixture', 'stage', 'neue-anfrage',
                           'site_street', 'Must not persist', 'site_city', 'Must not persist')
    );
    execute 'reset role';
    select * into quick_deal from public.deals where id = (result->>'deal_id')::bigint;
    if quick_deal.site_street is not null or quick_deal.site_city is not null
       or quick_deal.site_floor is not null or quick_deal.site_tenant_name is not null then
        raise exception 'Quick Capture silently persisted a site address: %', row_to_json(quick_deal);
    end if;
    raise notice 'PASS: Quick Capture stores no hidden site address, even if payload contains site keys';
end;
$$;
rollback;
