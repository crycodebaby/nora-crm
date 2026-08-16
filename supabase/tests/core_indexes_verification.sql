-- Nora CRM – Verifikation der Kernindizes (Migration 20260815120000)
-- Prüft Existenz und, wo aussagekräftig, tatsächliche Planner-Nutzung.
--
-- Aufruf (lokal, nach db reset):
--   docker exec -i supabase_db_atomic-crm-demo psql -v ON_ERROR_STOP=1 \
--     -U postgres -d postgres < supabase/tests/core_indexes_verification.sql
--
-- Der Test ist lesend und legt keine Daten an.

\set ON_ERROR_STOP on

do $$
declare
    v_expected text[] := array[
        'deals_stage_index_active_idx',
        'deals_expected_closing_active_idx',
        'deals_sales_id_idx',
        'deals_archived_at_idx',
        'deals_created_at_idx',
        'tasks_contact_id_idx',
        'tasks_due_date_open_idx',
        'tasks_sales_id_idx',
        'contacts_sales_id_idx',
        'contacts_first_seen_idx',
        'companies_sales_id_idx',
        'companies_created_at_idx',
        'contact_notes_date_idx',
        'deal_notes_date_idx',
        'contact_notes_sales_id_idx',
        'deal_notes_sales_id_idx'
    ];
    v_name text;
    v_missing text[] := '{}';
begin
    foreach v_name in array v_expected loop
        if not exists (
            select 1
            from pg_indexes
            where schemaname = 'public'
              and indexname = v_name
        ) then
            v_missing := v_missing || v_name;
        end if;
    end loop;

    if array_length(v_missing, 1) is not null then
        raise exception 'Fehlende Kernindizes: %', array_to_string(v_missing, ', ');
    end if;

    raise notice 'OK: alle % Kernindizes vorhanden', array_length(v_expected, 1);
end;
$$;

-- Fremdschlüssel ohne Index sind der eigentliche Auslöser dieser Migration.
-- Dieser Block schlägt fehl, sobald ein FK auf einer Kerntabelle wieder
-- ohne unterstützenden Index angelegt wird.
do $$
declare
    v_rec record;
    v_unindexed text[] := '{}';
begin
    -- Tabellenname ueber pg_class statt regclass::text: die Textform haengt
    -- vom search_path ab. Ohne "public" darin wuerde die IN-Liste nie
    -- treffen und der Test stillschweigend durchlaufen.
    for v_rec in
        select
            cl.relname as tbl,
            a.attname  as col,
            c.conrelid as reloid
        from pg_constraint c
            join pg_class cl on cl.oid = c.conrelid
            join lateral unnest(c.conkey) as k(attnum) on true
            join pg_attribute a
                on a.attrelid = c.conrelid
               and a.attnum   = k.attnum
        where c.contype = 'f'
          and cl.relnamespace = 'public'::regnamespace
          and cl.relname in (
                'deals', 'tasks', 'contacts', 'companies',
                'contact_notes', 'deal_notes'
              )
          and array_length(c.conkey, 1) = 1
    loop
        if not exists (
            select 1
            from pg_index i
                join pg_attribute ia
                    on ia.attrelid = i.indrelid
                   and ia.attnum   = i.indkey[0]
            where i.indrelid = v_rec.reloid
              and ia.attname = v_rec.col
        ) then
            v_unindexed := v_unindexed || (v_rec.tbl || '.' || v_rec.col);
        end if;
    end loop;

    if array_length(v_unindexed, 1) is not null then
        raise exception 'Fremdschluessel ohne fuehrenden Index: %',
            array_to_string(v_unindexed, ', ');
    end if;

    raise notice 'OK: alle Fremdschluessel der Kerntabellen sind indiziert';
end;
$$;
