-- Nora W8-C S2A2.1 — central attachment liveness resolver: database contract verification
--
-- Self-contained and rollback-safe: every fixture is created inside a DO block
-- that terminates with ROLLBACK_W8C_S2A21_TEST, so the block's subtransaction
-- undoes it. The only session object is the temporary assertion helper
-- pg_temp.s2a21_expect, which disappears with the session. Requires the
-- clean-reference universe of a fresh `npx supabase db reset --local`
-- (section 5 checks that precondition explicitly and fails loudly otherwise).
--
-- Usage (local only):
--   docker exec -i supabase_db_atomic-crm-demo psql -U postgres -d postgres \
--     -v ON_ERROR_STOP=1 -f - < supabase/tests/attachment_liveness_resolver_verification.sql
--
-- What it proves:
--   1. function shape: exact signatures, text return, STABLE, SECURITY DEFINER
--      (resolver) / INVOKER (helpers), owner postgres, search_path = '' on
--      all three and row_security = off on the resolver only, no overloads,
--      no API-role ACL entry, no `when others`, no dynamic SQL, no network /
--      Storage / Edge reference, no excluded surface read
--   2. API boundary: anon / authenticated / service_role cannot execute any of
--      the three functions (catalog AND a real `set local role` call -> 42501)
--   3. URL helper: canonical Production / local origin, foreign origin,
--      different key, different bucket, and every malformed attachment-shaped
--      form (query, fragment, %, %2F, //, slash in key, empty key, '..',
--      relative, padded, case mutation, sign/, authenticated/, render/) plus
--      data:, blob:, favicon and ordinary foreign URLs
--   4. file-value helper: every approved path/src combination, including the
--      SECOND-KEY case (path k1 + local src k2 keeps BOTH keys live); JSON
--      null is absence (none), any other non-object JSON stays unknown
--   5. clean-universe baseline and S1 public.attachments
--   6. S2 contact_notes.attachments (jsonb[] via unnest)
--   7. S3 deal_notes.attachments (jsonb[] via unnest)
--   8. S4 companies.logo
--   9. S5 configuration branding (URL-ONLY strings, object form, blank, wrong
--      type, malformed) and the S5r residual tripwire (storage URL markers,
--      relative object/public/attachments/<key>, attachments/<key>, the
--      candidate key verbatim e.g. {"path": <key>})
--  10. S6 contacts.avatar and S7 sales.avatar; JSON-null values on every
--      jsonb surface do not poison an unrelated candidate
--  11. result composition: LIVE dominates UNKNOWN ACROSS surfaces with the
--      ambiguity on an EARLIER-evaluated surface than the live proof,
--      UNKNOWN prevents a false DEAD, invalid input raises 22023, padded keys
--      are compared exactly
--  12. real SQL errors propagate — schema drift is never mapped to 'unknown';
--      an RLS-visibility drift of the definer raises (row_security = off)
--      instead of returning a filtered false 'dead'
--  13. REGISTRY COMPLETENESS GUARD: every reference-capable column in public /
--      nora_private is classified REGISTERED or EXCLUDED; a simulated future
--      column (deals.cover jsonb, tasks.attachments jsonb[],
--      companies.banner_url text) is flagged until classified
--  14. queue vocabulary: skipped_live is terminal, requires completed_at, can
--      carry no claim, is neither active nor due, does not block a later
--      pending job, and only the W8-C S2A2.2 inspect primitive
--      (nora_private.attachment_deletion_inspect) produces it; the S2A1
--      capture still produces only pending; queue ACL unchanged
--
-- NOT proven here (out of S2A2.1 scope by design): claim / lease / inspect /
-- fail and retry behaviour (attachment_deletion_queue_execution_verification.sql),
-- any physical storage deletion. 'dead' is an observation, never a deletion
-- permission.

\set ON_ERROR_STOP on

\echo '=== W8-C S2A2.1: attachment liveness resolver verification ==='

-- Session-scoped assertion helper (pg_temp, vanishes with the session).
create function pg_temp.s2a21_expect(p_label text, p_key text, p_expected text)
returns text[]
language plpgsql
as $$
declare
    v_actual text;
begin
    v_actual := nora_private.attachment_storage_key_liveness(p_key);
    if v_actual is distinct from p_expected then
        return array[format('%s: liveness(%L) = %s, expected %s', p_label, p_key, v_actual, p_expected)];
    end if;
    return '{}'::text[];
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. Function shape and hygiene
-- ---------------------------------------------------------------------------
do $$
declare
    r          record;
    v_src      text;
    v_failures text[] := '{}';
begin
    for r in
        select * from (values
            ('nora_private.attachment_storage_key_liveness(text)',      'attachment_storage_key_liveness', true,
             array['search_path=""', 'row_security=off']),
            ('nora_private.attachment_url_liveness(text,text)',         'attachment_url_liveness',         false,
             array['search_path=""']),
            ('nora_private.attachment_file_value_liveness(jsonb,text)', 'attachment_file_value_liveness',  false,
             array['search_path=""'])
        ) as t(sig, fname, definer, config)
    loop
        if to_regprocedure(r.sig) is null then
            v_failures := v_failures || format('%s does not exist', r.sig);
            continue;
        end if;

        if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'nora_private' and p.proname = r.fname) <> 1 then
            v_failures := v_failures || format('%s is overloaded', r.fname);
        end if;

        if not exists (select 1 from pg_proc p
                       join pg_language l on l.oid = p.prolang
                       where p.oid = to_regprocedure(r.sig)
                         and p.prorettype = 'text'::regtype
                         and not p.proretset
                         and p.provolatile = 's'
                         and p.prosecdef = r.definer
                         and l.lanname = 'plpgsql'
                         and pg_get_userbyid(p.proowner) = 'postgres'
                         and p.proconfig = r.config) then
            v_failures := v_failures || format('%s is not plpgsql / returns text / STABLE / %s / owner postgres / settings exactly %s',
                r.sig, case when r.definer then 'SECURITY DEFINER' else 'SECURITY INVOKER' end, r.config);
        end if;

        -- the ACL may name the owner only
        if exists (select 1 from pg_proc p, aclexplode(p.proacl) acl
                   where p.oid = to_regprocedure(r.sig)
                     and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) <> 'postgres')) then
            v_failures := v_failures || format('%s carries an ACL entry for a role other than postgres', r.sig);
        end if;
        if (select p.proacl is null from pg_proc p where p.oid = to_regprocedure(r.sig)) then
            v_failures := v_failures || format('%s has a default ACL (PUBLIC may EXECUTE)', r.sig);
        end if;

        select p.prosrc into v_src from pg_proc p where p.oid = to_regprocedure(r.sig);

        -- errors must propagate: no catch-all anywhere
        if v_src ~* '\mwhen\s+others\M' then
            v_failures := v_failures || format('%s contains `when others`', r.sig);
        end if;
        -- hard-coded registry: no dynamic SQL
        if v_src ~* '\mexecute\M' then
            v_failures := v_failures || format('%s uses dynamic SQL', r.sig);
        end if;
        -- database work only: no network, no Storage, no Edge Function
        if v_src ~* '(pg_net|\mnet\.|\mhttp_|extensions\.http|dblink|\mstorage\.|functions/v1|supabase_functions)' then
            v_failures := v_failures || format('%s references a network / Storage / Edge Function facility', r.sig);
        end if;
        -- excluded surfaces never participate
        if v_src ~* '(audit_events|idempotency_records|operation_errors|eligibility_snapshot|\mauth\.)' then
            v_failures := v_failures || format('%s reads an excluded surface', r.sig);
        end if;
        -- nothing here writes the queue (skipped_live is vocabulary only)
        if v_src ~* '(\minsert\M|\mupdate\M|\mdelete\M|attachment_storage_deletion_queue)' then
            v_failures := v_failures || format('%s writes data or touches the queue', r.sig);
        end if;
    end loop;

    -- the two helpers read no table at all
    for r in
        select * from (values
            ('nora_private.attachment_url_liveness(text,text)'),
            ('nora_private.attachment_file_value_liveness(jsonb,text)')
        ) as t(sig)
    loop
        if (select p.prosrc from pg_proc p where p.oid = to_regprocedure(r.sig)) ~* '\m(from|join)\s+(public|nora_private)\.' then
            v_failures := v_failures || format('%s reads a table', r.sig);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (function shape):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  1. function shape: STABLE, definer/invoker as specified, owner postgres, search_path empty, row_security off on the resolver only, no catch-all, no dynamic SQL, no network';
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. API boundary: no API role may execute any of the three functions
-- ---------------------------------------------------------------------------
do $$
declare
    v_role     text;
    v_sig      text;
    v_state    text;
    v_failures text[] := '{}';
begin
    foreach v_sig in array array['nora_private.attachment_storage_key_liveness(text)',
                                 'nora_private.attachment_url_liveness(text,text)',
                                 'nora_private.attachment_file_value_liveness(jsonb,text)'] loop
        foreach v_role in array array['public','anon','authenticated','service_role'] loop
            if has_function_privilege(v_role, v_sig, 'EXECUTE') then
                v_failures := v_failures || format('%s holds EXECUTE on %s', v_role, v_sig);
            end if;
        end loop;
    end loop;

    -- behavioural: a real call under each API role fails the permission check
    foreach v_role in array array['anon','authenticated','service_role'] loop
        foreach v_sig in array array['select nora_private.attachment_storage_key_liveness(''s2a21-k1.pdf'')',
                                     'select nora_private.attachment_url_liveness(''x'', ''s2a21-k1.pdf'')',
                                     'select nora_private.attachment_file_value_liveness(''{}''::jsonb, ''s2a21-k1.pdf'')'] loop
            v_state := 'no error';
            execute format('set local role %I', v_role);
            begin
                execute v_sig;
            exception when others then
                v_state := sqlstate;
            end;
            reset role;
            if v_state <> '42501' then
                v_failures := v_failures || format('%s: %s -> %s, expected 42501', v_role, v_sig, v_state);
            end if;
        end loop;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (API boundary):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  2. API boundary: anon / authenticated / service_role cannot execute resolver or helpers (42501)';
end;
$$;

-- ---------------------------------------------------------------------------
-- 3. URL helper
-- ---------------------------------------------------------------------------
do $$
declare
    c_p constant text := 'https://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/public/attachments/';
    c_l constant text := 'http://127.0.0.1:54321/storage/v1/object/public/attachments/';
    c_f constant text := 'https://attacker.example.net/storage/v1/object/public/attachments/';
    r          record;
    v_actual   text;
    v_failures text[] := '{}';
begin
    for r in
        select * from (values
            -- canonical, allowlisted origins
            ('3.01 prod canonical same key',        c_p || 'k1.pdf',                                  'k1.pdf', 'live'),
            ('3.02 prod canonical other key',       c_p || 'k1.pdf',                                  'k2.pdf', 'none'),
            ('3.03 local canonical same key',       c_l || 'k1.pdf',                                  'k1.pdf', 'live'),
            ('3.04 local canonical other key',      c_l || 'k1.pdf',                                  'k2.pdf', 'none'),
            ('3.05 legacy key 0.<digits>',          c_p || '0.123456789',                             '0.123456789', 'live'),
            -- canonical shape, foreign origin
            ('3.06 foreign canonical same key',     c_f || 'k1.pdf',                                  'k1.pdf', 'unknown'),
            ('3.07 foreign canonical other key',    c_f || 'k1.pdf',                                  'k2.pdf', 'none'),
            ('3.08 prod host over http',            'http://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/public/attachments/k1.pdf', 'k1.pdf', 'unknown'),
            ('3.09 origin host case mutation',      'https://KIXXROXTFZBCBZCTOHEX.supabase.co/storage/v1/object/public/attachments/k1.pdf', 'k1.pdf', 'unknown'),
            ('3.10 scheme case mutation',           'HTTPS://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/public/attachments/k1.pdf', 'k1.pdf', 'unknown'),
            ('3.11 userinfo spoof of prod origin',  'https://kixxroxtfzbcbzctohex.supabase.co@attacker.example.net/storage/v1/object/public/attachments/k1.pdf', 'k1.pdf', 'unknown'),
            -- clearly different bucket
            ('3.12 other bucket public',            'https://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/public/avatars/k1.pdf', 'k1.pdf', 'none'),
            ('3.13 other bucket sign',              'https://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/sign/avatars/k1.pdf?token=abc', 'k1.pdf', 'none'),
            -- malformed but attachment-shaped: fail closed, for ANY candidate key
            ('3.14 query',                          c_p || 'k1.pdf?download=1',                       'k1.pdf', 'unknown'),
            ('3.15 query, other key',               c_p || 'k1.pdf?download=1',                       'zz.pdf', 'unknown'),
            ('3.16 fragment',                       c_p || 'k1.pdf#page=2',                           'k1.pdf', 'unknown'),
            ('3.17 percent encoding',               c_p || 'k%31.pdf',                                'k1.pdf', 'unknown'),
            ('3.18 encoded slash',                  c_p || 'dir%2Fk1.pdf',                            'k1.pdf', 'unknown'),
            ('3.19 duplicate slash before key',     c_p || '/k1.pdf',                                 'k1.pdf', 'unknown'),
            ('3.20 duplicate slash after origin',   'https://kixxroxtfzbcbzctohex.supabase.co//storage/v1/object/public/attachments/k1.pdf', 'k1.pdf', 'unknown'),
            ('3.21 slash in key',                   c_p || 'dir/k1.pdf',                              'k1.pdf', 'unknown'),
            ('3.22 empty key',                      c_p,                                              'k1.pdf', 'unknown'),
            ('3.23 dot-dot key',                    c_p || '..',                                      '..',     'unknown'),
            ('3.24 dot key',                        c_p || '.',                                       '.',      'unknown'),
            ('3.25 relative storage URL',           '/storage/v1/object/public/attachments/k1.pdf',   'k1.pdf', 'unknown'),
            ('3.26 leading padding',                ' ' || c_p || 'k1.pdf',                           'k1.pdf', 'unknown'),
            ('3.27 trailing padding',               c_p || 'k1.pdf ',                                 'k1.pdf', 'unknown'),
            ('3.28 trailing newline',               c_p || 'k1.pdf' || chr(10),                       'k1.pdf', 'unknown'),
            ('3.29 bucket case mutation',           'https://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/public/Attachments/k1.pdf', 'k1.pdf', 'unknown'),
            ('3.30 path case mutation',             'https://kixxroxtfzbcbzctohex.supabase.co/Storage/v1/object/public/attachments/k1.pdf', 'k1.pdf', 'unknown'),
            ('3.31 sign path',                      'https://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/sign/attachments/k1.pdf?token=abc', 'k1.pdf', 'unknown'),
            ('3.32 authenticated path',             'https://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/authenticated/attachments/k1.pdf', 'k1.pdf', 'unknown'),
            ('3.33 render path',                    'https://kixxroxtfzbcbzctohex.supabase.co/storage/v1/render/image/public/attachments/k1.pdf?width=200', 'k1.pdf', 'unknown'),
            ('3.34 over-long canonical key',        c_p || repeat('a', 513),                          repeat('a', 513), 'unknown'),
            -- never a bucket reference
            ('3.35 data URI',                       'data:image/png;base64,iVBORw0KGgo=',             'k1.pdf', 'none'),
            ('3.36 blob URL',                       'blob:https://nora.ergart.de/5f1c0a6e',           'k1.pdf', 'none'),
            ('3.37 favicon service',                'https://favicon.show/ergart.de',                 'k1.pdf', 'none'),
            ('3.38 ordinary foreign URL',           'https://www.example.com/docs/k1.pdf',            'k1.pdf', 'none'),
            ('3.39 bundled app asset',              './logos/nora-monogram-light.png',                'k1.pdf', 'none'),
            ('3.40 empty string',                   '',                                               'k1.pdf', 'none'),
            ('3.41 blank string',                   '   ',                                            'k1.pdf', 'none'),
            ('3.42 NULL',                           null,                                             'k1.pdf', 'none')
        ) as t(label, url, key, expected)
    loop
        v_actual := nora_private.attachment_url_liveness(r.url, r.key);
        if v_actual is distinct from r.expected then
            v_failures := v_failures || format('%s: url_liveness(%L, %L) = %s, expected %s',
                r.label, r.url, r.key, v_actual, r.expected);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (URL helper):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  3. URL helper: canonical/allowlisted -> live, foreign same key -> unknown, malformed attachment-shaped -> unknown, data/blob/favicon/foreign -> none';
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. File-value helper (RAFile-like objects)
-- ---------------------------------------------------------------------------
do $$
declare
    c_p constant text := 'https://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/public/attachments/';
    c_l constant text := 'http://127.0.0.1:54321/storage/v1/object/public/attachments/';
    c_f constant text := 'https://attacker.example.net/storage/v1/object/public/attachments/';
    r          record;
    v_actual   text;
    v_failures text[] := '{}';
begin
    for r in
        select * from (values
            -- USABLE path, no meaningful src
            ('4.01 path only, match',               jsonb_build_object('path', 'k1.pdf'),                                   'k1.pdf', 'live'),
            ('4.02 path only, other key',           jsonb_build_object('path', 'k1.pdf'),                                   'k2.pdf', 'none'),
            ('4.03 path + favicon src',             jsonb_build_object('path', 'k1.pdf', 'src', 'https://favicon.show/x'),  'k2.pdf', 'none'),
            -- USABLE path + matching local src
            ('4.04 path + same local src, match',   jsonb_build_object('path', 'k1.pdf', 'src', c_p || 'k1.pdf'),           'k1.pdf', 'live'),
            ('4.05 path + same local src, other',   jsonb_build_object('path', 'k1.pdf', 'src', c_p || 'k1.pdf'),           'k2.pdf', 'none'),
            -- USABLE path k1 + local src k2: BOTH keys live
            ('4.06 path k1 + local src k2, k1',     jsonb_build_object('path', 'k1.pdf', 'src', c_l || 'k2.pdf'),           'k1.pdf', 'live'),
            ('4.07 path k1 + local src k2, k2',     jsonb_build_object('path', 'k1.pdf', 'src', c_l || 'k2.pdf'),           'k2.pdf', 'live'),
            ('4.08 path k1 + prod src k2, k2',      jsonb_build_object('path', 'k1.pdf', 'src', c_p || 'k2.pdf'),           'k2.pdf', 'live'),
            ('4.09 path k1 + local src k2, k3',     jsonb_build_object('path', 'k1.pdf', 'src', c_l || 'k2.pdf'),           'k3.pdf', 'none'),
            -- USABLE path k1 + foreign canonical src k2
            ('4.10 path k1 + foreign src k2, k1',   jsonb_build_object('path', 'k1.pdf', 'src', c_f || 'k2.pdf'),           'k1.pdf', 'live'),
            ('4.11 path k1 + foreign src k2, k2',   jsonb_build_object('path', 'k1.pdf', 'src', c_f || 'k2.pdf'),           'k2.pdf', 'unknown'),
            ('4.12 path k1 + foreign src k2, k3',   jsonb_build_object('path', 'k1.pdf', 'src', c_f || 'k2.pdf'),           'k3.pdf', 'none'),
            -- USABLE path + malformed src
            ('4.13 path + malformed src, match',    jsonb_build_object('path', 'k1.pdf', 'src', c_p || 'k1.pdf?x=1'),       'k1.pdf', 'live'),
            ('4.14 path + malformed src, other',    jsonb_build_object('path', 'k1.pdf', 'src', c_p || 'k1.pdf?x=1'),       'k2.pdf', 'unknown'),
            -- ABSENT path: src fallback
            ('4.15 src only, match',                jsonb_build_object('src', c_p || 'k1.pdf'),                            'k1.pdf', 'live'),
            ('4.16 src only, other key',            jsonb_build_object('src', c_p || 'k1.pdf'),                            'k2.pdf', 'none'),
            ('4.17 JSON-null path + src',           jsonb_build_object('path', null, 'src', c_l || 'k1.pdf'),               'k1.pdf', 'live'),
            ('4.18 empty path + src',               jsonb_build_object('path', '', 'src', c_p || 'k1.pdf'),                 'k1.pdf', 'live'),
            ('4.19 blank path + src',               jsonb_build_object('path', '   ', 'src', c_p || 'k1.pdf'),              'k1.pdf', 'live'),
            ('4.20 src data URI',                   jsonb_build_object('src', 'data:image/png;base64,AAAA'),                'k1.pdf', 'none'),
            ('4.21 src favicon',                    jsonb_build_object('src', 'https://favicon.show/ergart.de'),            'k1.pdf', 'none'),
            ('4.22 src foreign canonical same key', jsonb_build_object('src', c_f || 'k1.pdf'),                            'k1.pdf', 'unknown'),
            ('4.23 src malformed',                  jsonb_build_object('src', c_p || 'k1.pdf#x'),                          'k9.pdf', 'unknown'),
            ('4.24 JSON-null src',                  jsonb_build_object('src', null),                                        'k1.pdf', 'none'),
            -- MALFORMED path
            ('4.25 numeric path',                   jsonb_build_object('path', 42),                                         'k1.pdf', 'unknown'),
            ('4.26 numeric path + live src',        jsonb_build_object('path', 42, 'src', c_p || 'k1.pdf'),                 'k1.pdf', 'live'),
            ('4.27 absolute path',                  jsonb_build_object('path', '/k1.pdf'),                                  'k1.pdf', 'unknown'),
            ('4.28 URL in path',                    jsonb_build_object('path', c_p || 'k1.pdf'),                            'k1.pdf', 'unknown'),
            ('4.29 untrimmed path',                 jsonb_build_object('path', ' k1.pdf'),                                  'k1.pdf', 'unknown'),
            ('4.30 untrimmed path + live src',      jsonb_build_object('path', ' k1.pdf', 'src', c_p || 'k1.pdf'),          'k1.pdf', 'live'),
            ('4.31 over-long path',                 jsonb_build_object('path', repeat('a', 513)),                           'k1.pdf', 'unknown'),
            ('4.32 object path',                    jsonb_build_object('path', jsonb_build_object('k', 'k1.pdf')),          'k1.pdf', 'unknown'),
            -- non-string src
            ('4.33 numeric src',                    jsonb_build_object('src', 123),                                         'k1.pdf', 'unknown'),
            ('4.34 path + numeric src, match',      jsonb_build_object('path', 'k1.pdf', 'src', 123),                       'k1.pdf', 'live'),
            ('4.35 path + numeric src, other',      jsonb_build_object('path', 'k1.pdf', 'src', 123),                       'k2.pdf', 'unknown'),
            -- whole-value shapes
            ('4.36 empty object',                   '{}'::jsonb,                                                            'k1.pdf', 'none'),
            ('4.37 unrelated object',               jsonb_build_object('title', 'plan.pdf'),                                'k1.pdf', 'none'),
            ('4.38 JSON string',                    to_jsonb(c_p || 'k1.pdf'),                                              'k1.pdf', 'unknown'),
            ('4.39 JSON array',                     '[]'::jsonb,                                                            'k1.pdf', 'unknown'),
            ('4.40 JSON number',                    '42'::jsonb,                                                            'k1.pdf', 'unknown'),
            ('4.41 JSON null is absence',           'null'::jsonb,                                                          'k1.pdf', 'none'),
            ('4.42 SQL NULL',                       null::jsonb,                                                            'k1.pdf', 'none'),
            ('4.43 JSON boolean',                   'true'::jsonb,                                                          'k1.pdf', 'unknown'),
            ('4.44 JSON string "null"',             '"null"'::jsonb,                                                        'k1.pdf', 'unknown'),
            ('4.45 JSON array holding null',        '[null]'::jsonb,                                                        'k1.pdf', 'unknown')
        ) as t(label, val, key, expected)
    loop
        v_actual := nora_private.attachment_file_value_liveness(r.val, r.key);
        if v_actual is distinct from r.expected then
            v_failures := v_failures || format('%s: file_value_liveness(%s, %L) = %s, expected %s',
                r.label, coalesce(r.val::text, 'NULL'), r.key, v_actual, r.expected);
        end if;
    end loop;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (file-value helper):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  4. file-value helper: all path/src combinations, second-key LIVE, malformed -> unknown, {} / JSON null -> none, other non-object JSON -> unknown';
end;
$$;

-- ---------------------------------------------------------------------------
-- 5.–11. Registry behaviour against real rows (as postgres, rolled back)
--
-- Every surface is set, asserted and reset to its clean value before the next
-- surface, so each 'dead' expectation is meaningful: the only reference in the
-- universe is the one the subtest just wrote.
-- ---------------------------------------------------------------------------
do $$
declare
    c_p constant text := 'https://kixxroxtfzbcbzctohex.supabase.co/storage/v1/object/public/attachments/';
    c_l constant text := 'http://127.0.0.1:54321/storage/v1/object/public/attachments/';
    c_f constant text := 'https://attacker.example.net/storage/v1/object/public/attachments/';
    v_user     uuid := gen_random_uuid();
    v_sales    bigint;
    v_company  bigint; v_contact bigint; v_deal bigint;
    v_cnote    bigint; v_dnote bigint;
    v_a        bigint;
    v_key      text;
    v_state    text;
    v_msg      text;
    v_failures text[] := '{}';
begin
    -- ---- 5a. clean-universe precondition ------------------------------------
    if nora_private.attachment_storage_key_liveness('s2a21-baseline-' || gen_random_uuid()::text) <> 'dead' then
        raise exception 'FAIL (precondition): the reference universe is not clean — run this suite after a fresh `npx supabase db reset --local`';
    end if;

    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'w8c-s2a21-owner@nora.test', 'x', now(),
            '{"provider":"email","providers":["email"]}', '{"first_name":"Lea","last_name":"Liveness"}', now(), now());
    select id into v_sales from public.sales where user_id = v_user;

    insert into public.companies (name, sales_id) values ('W8-C S2A2.1 Kunde', v_sales) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Lebendig', 'Keit', v_company, v_sales) returning id into v_contact;
    insert into public.deals (name, company_id, stage, sales_id)
        values ('W8-C S2A2.1 Vorgang', v_company, 'opportunity', v_sales) returning id into v_deal;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Liveness', now(), v_sales) returning id into v_cnote;
    insert into public.deal_notes (deal_id, text, date, sales_id)
        values (v_deal, 'Liveness', now(), v_sales) returning id into v_dnote;

    -- the fixtures themselves reference nothing
    v_failures := v_failures || pg_temp.s2a21_expect('5a clean fixture universe', 's2a21-k1.pdf', 'dead');

    -- ---- 5b. S1 public.attachments ------------------------------------------
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a21-k1.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;
    v_failures := v_failures || pg_temp.s2a21_expect('5b S1 matching storage_key',  's2a21-k1.pdf',    'live');
    v_failures := v_failures || pg_temp.s2a21_expect('5b S1 different clean key',  's2a21-other.pdf', 'dead');
    v_failures := v_failures || pg_temp.s2a21_expect('5b S1 exact, not prefix',    's2a21-k1',        'dead');
    delete from public.attachments where id = v_a;
    v_failures := v_failures || pg_temp.s2a21_expect('5b S1 after metadata delete', 's2a21-k1.pdf',   'dead');

    -- ---- 6. S2 contact_notes.attachments (jsonb[]) --------------------------
    update public.contact_notes set attachments = array[
        jsonb_build_object('path', 's2a21-k1.pdf', 'src', c_p || 's2a21-k1.pdf', 'title', 'a.pdf')]
        where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6a contact note path',        's2a21-k1.pdf',    'live');
    v_failures := v_failures || pg_temp.s2a21_expect('6a contact note other key',   's2a21-other.pdf', 'dead');

    update public.contact_notes set attachments = array[
        jsonb_build_object('src', c_p || 's2a21-k2.pdf', 'title', 'b.pdf')]
        where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6b contact note src fallback', 's2a21-k2.pdf',   'live');

    update public.contact_notes set attachments = array[
        jsonb_build_object('path', 's2a21-x1.pdf'),
        jsonb_build_object('path', 's2a21-x2.pdf'),
        jsonb_build_object('path', 's2a21-k3.pdf')]
        where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6c match after first element', 's2a21-k3.pdf',   'live');
    v_failures := v_failures || pg_temp.s2a21_expect('6c first element',             's2a21-x1.pdf',   'live');
    v_failures := v_failures || pg_temp.s2a21_expect('6d unrelated key only',        's2a21-k1.pdf',   'dead');

    update public.contact_notes set attachments = array[
        jsonb_build_object('path', 's2a21-x1.pdf'),
        '"just-a-string"'::jsonb]
        where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6e malformed element -> unknown', 's2a21-k1.pdf', 'unknown');

    update public.contact_notes set attachments = array[
        '"just-a-string"'::jsonb,
        jsonb_build_object('path', 's2a21-k1.pdf')]
        where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6f live dominates malformed sibling', 's2a21-k1.pdf', 'live');

    update public.contact_notes set attachments = array[
        jsonb_build_object('path', 's2a21-k1.pdf', 'src', c_l || 's2a21-k2.pdf')]
        where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6g conflicting path/src: path key', 's2a21-k1.pdf', 'live');
    v_failures := v_failures || pg_temp.s2a21_expect('6g conflicting path/src: src key',  's2a21-k2.pdf', 'live');

    update public.contact_notes set attachments = null where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6h NULL array', 's2a21-k1.pdf', 'dead');
    update public.contact_notes set attachments = '{}'::jsonb[] where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6i empty array', 's2a21-k1.pdf', 'dead');
    update public.contact_notes set attachments = array[null::jsonb] where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6j array of SQL NULL', 's2a21-k1.pdf', 'dead');
    -- JSON null element = absence: it does not poison an unrelated candidate
    update public.contact_notes set attachments = array['null'::jsonb] where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6k JSON-null element, unrelated key', 's2a21-k1.pdf', 'dead');
    update public.contact_notes set attachments = array['null'::jsonb, jsonb_build_object('path', 's2a21-k1.pdf')] where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6k JSON-null element beside a live one', 's2a21-k1.pdf', 'live');
    -- ... while every other non-object element still fails closed
    update public.contact_notes set attachments = array['42'::jsonb] where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6l number element -> unknown', 's2a21-k1.pdf', 'unknown');
    update public.contact_notes set attachments = array['[]'::jsonb] where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('6l array element -> unknown',  's2a21-k1.pdf', 'unknown');
    update public.contact_notes set attachments = null where id = v_cnote;

    -- ---- 7. S3 deal_notes.attachments (jsonb[]) -----------------------------
    update public.deal_notes set attachments = array[jsonb_build_object('path', 's2a21-d1.pdf')] where id = v_dnote;
    v_failures := v_failures || pg_temp.s2a21_expect('7a deal note path',        's2a21-d1.pdf', 'live');
    v_failures := v_failures || pg_temp.s2a21_expect('7a deal note other key',   's2a21-d9.pdf', 'dead');

    update public.deal_notes set attachments = array[jsonb_build_object('src', c_l || 's2a21-d2.pdf')] where id = v_dnote;
    v_failures := v_failures || pg_temp.s2a21_expect('7b deal note src fallback', 's2a21-d2.pdf', 'live');

    update public.deal_notes set attachments = array[jsonb_build_object('path', 42)] where id = v_dnote;
    v_failures := v_failures || pg_temp.s2a21_expect('7c deal note malformed -> unknown', 's2a21-d1.pdf', 'unknown');

    update public.deal_notes set attachments = array[
        jsonb_build_object('path', 's2a21-d1.pdf', 'src', c_p || 's2a21-d2.pdf')] where id = v_dnote;
    v_failures := v_failures || pg_temp.s2a21_expect('7d deal note conflicting: path key', 's2a21-d1.pdf', 'live');
    v_failures := v_failures || pg_temp.s2a21_expect('7d deal note conflicting: src key',  's2a21-d2.pdf', 'live');

    update public.deal_notes set attachments = array['null'::jsonb] where id = v_dnote;
    v_failures := v_failures || pg_temp.s2a21_expect('7e deal note JSON-null element, unrelated key', 's2a21-d1.pdf', 'dead');
    update public.deal_notes set attachments = array['true'::jsonb] where id = v_dnote;
    v_failures := v_failures || pg_temp.s2a21_expect('7f deal note boolean element -> unknown', 's2a21-d1.pdf', 'unknown');
    update public.deal_notes set attachments = null where id = v_dnote;

    -- ---- 8. S4 companies.logo -----------------------------------------------
    update public.companies set logo = jsonb_build_object('path', 's2a21-l1.png', 'src', c_p || 's2a21-l1.png')
        where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('8a logo local path', 's2a21-l1.png', 'live');

    update public.companies set logo = jsonb_build_object('src', c_l || 's2a21-l2.png') where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('8b logo local src',  's2a21-l2.png', 'live');

    update public.companies set logo = jsonb_build_object('src', 'https://favicon.show/ergart.de') where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('8c logo favicon -> dead', 's2a21-l1.png', 'dead');

    update public.companies set logo = '"logo.png"'::jsonb where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('8d logo non-object -> unknown', 's2a21-l1.png', 'unknown');
    update public.companies set logo = '42'::jsonb where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('8d logo number -> unknown', 's2a21-l1.png', 'unknown');

    update public.companies set logo = 'null'::jsonb where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('8e logo JSON null, unrelated key', 's2a21-l1.png', 'dead');
    update public.companies set logo = null where id = v_company;

    -- ---- 9. S5 configuration branding + S5r residual tripwire ---------------
    update public.configuration set config = jsonb_build_object('lightModeLogo', c_p || 's2a21-b1.png');
    v_failures := v_failures || pg_temp.s2a21_expect('9a lightModeLogo URL-only', 's2a21-b1.png', 'live');
    v_failures := v_failures || pg_temp.s2a21_expect('9a other key',              's2a21-b9.png', 'dead');

    update public.configuration set config = jsonb_build_object('darkModeLogo', c_l || 's2a21-b2.png');
    v_failures := v_failures || pg_temp.s2a21_expect('9b darkModeLogo URL-only',  's2a21-b2.png', 'live');

    update public.configuration set config = jsonb_build_object(
        'lightModeLogo', jsonb_build_object('src', c_p || 's2a21-b3.png'),
        'darkModeLogo',  jsonb_build_object('path', 's2a21-b4.png'));
    v_failures := v_failures || pg_temp.s2a21_expect('9c lightModeLogo object src', 's2a21-b3.png', 'live');
    v_failures := v_failures || pg_temp.s2a21_expect('9c darkModeLogo object path', 's2a21-b4.png', 'live');

    update public.configuration set config = jsonb_build_object('lightModeLogo', '', 'darkModeLogo', null);
    v_failures := v_failures || pg_temp.s2a21_expect('9d blank / null branding', 's2a21-b1.png', 'dead');

    update public.configuration set config = jsonb_build_object(
        'lightModeLogo', './logos/nora-monogram-light.png', 'darkModeLogo', './logos/nora-monogram-dark.png');
    v_failures := v_failures || pg_temp.s2a21_expect('9e bundled default logos', 's2a21-b1.png', 'dead');

    update public.configuration set config = jsonb_build_object('lightModeLogo', c_p || 's2a21-b1.png?v=2');
    v_failures := v_failures || pg_temp.s2a21_expect('9f malformed bucket URL, same key',  's2a21-b1.png', 'unknown');
    v_failures := v_failures || pg_temp.s2a21_expect('9f malformed bucket URL, other key', 's2a21-b9.png', 'unknown');

    update public.configuration set config = jsonb_build_object('darkModeLogo', 42);
    v_failures := v_failures || pg_temp.s2a21_expect('9g wrong JSON type (number)', 's2a21-b1.png', 'unknown');
    update public.configuration set config = jsonb_build_object('lightModeLogo', '[]'::jsonb);
    v_failures := v_failures || pg_temp.s2a21_expect('9g wrong JSON type (array)',  's2a21-b1.png', 'unknown');

    update public.configuration set config = jsonb_build_object('title', 'Nora', 'loginBanner', c_p || 's2a21-r1.png');
    v_failures := v_failures || pg_temp.s2a21_expect('9h residual tripwire, referenced key', 's2a21-r1.png', 'unknown');
    v_failures := v_failures || pg_temp.s2a21_expect('9h residual tripwire, other key',      's2a21-b9.png', 'unknown');

    update public.configuration set config = jsonb_build_object('nested', jsonb_build_object('img', 'https://x.example/storage/v1/object/public/avatars/a.png'));
    v_failures := v_failures || pg_temp.s2a21_expect('9i residual tripwire, nested other bucket', 's2a21-b9.png', 'unknown');

    update public.configuration set config = jsonb_build_object('title', 'Nora', 'website', 'https://ergart.de/kontakt',
                                                                 'lightModeLogo', c_p || 's2a21-b1.png');
    v_failures := v_failures || pg_temp.s2a21_expect('9j residual ordinary text does not trip', 's2a21-b9.png', 'dead');
    v_failures := v_failures || pg_temp.s2a21_expect('9j branding still live beside it',       's2a21-b1.png', 'live');

    -- S5r non-URL forms: relative bucket paths and an unregistered path object
    update public.configuration set config = jsonb_build_object('heroImage', 'object/public/attachments/s2a21-r2.png');
    v_failures := v_failures || pg_temp.s2a21_expect('9l residual relative object/public/attachments/<key>', 's2a21-r2.png', 'unknown');
    v_failures := v_failures || pg_temp.s2a21_expect('9l ... bucket path segment trips for any key',        's2a21-b9.png', 'unknown');

    update public.configuration set config = jsonb_build_object('heroImage', 'attachments/s2a21-r3.png');
    v_failures := v_failures || pg_temp.s2a21_expect('9m residual attachments/<key>',        's2a21-r3.png', 'unknown');
    update public.configuration set config = jsonb_build_object('heroImage', 'ATTACHMENTS%2Fs2a21-r3.png');
    v_failures := v_failures || pg_temp.s2a21_expect('9m residual ATTACHMENTS%2F<key>',      's2a21-r3.png', 'unknown');

    update public.configuration set config = jsonb_build_object('heroImage', jsonb_build_object('path', 's2a21-r4.png'));
    v_failures := v_failures || pg_temp.s2a21_expect('9n residual {"path": <key>}',          's2a21-r4.png', 'unknown');
    v_failures := v_failures || pg_temp.s2a21_expect('9n ... not a global poison for another key', 's2a21-b9.png', 'dead');

    update public.configuration set config = jsonb_build_object('pages', jsonb_build_array(jsonb_build_object('img', 's2a21-r5.png')));
    v_failures := v_failures || pg_temp.s2a21_expect('9o residual bare key, nested array',   's2a21-r5.png', 'unknown');

    update public.configuration set config = jsonb_build_object('title', 'Anhänge (attachments) im Objekt / Vorgang',
                                                                 'website', 'https://ergart.de/leistungen/fenster');
    v_failures := v_failures || pg_temp.s2a21_expect('9p benign text with the words does not trip', 's2a21-b9.png', 'dead');

    -- the tripwire never masks a LIVE proof elsewhere
    update public.configuration set config = jsonb_build_object('heroImage', jsonb_build_object('path', 's2a21-r4.png'));
    update public.companies set logo = jsonb_build_object('path', 's2a21-r4.png') where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('9q residual {"path": <key>} + live company logo', 's2a21-r4.png', 'live');
    update public.companies set logo = null where id = v_company;

    update public.configuration set config = '[]'::jsonb;
    v_failures := v_failures || pg_temp.s2a21_expect('9k non-object config -> unknown', 's2a21-b1.png', 'unknown');
    update public.configuration set config = '{}'::jsonb;

    -- ---- 10. S6 contacts.avatar / S7 sales.avatar ---------------------------
    update public.contacts set avatar = jsonb_build_object('src', c_l || 's2a21-a1.png') where id = v_contact;
    v_failures := v_failures || pg_temp.s2a21_expect('10a contact avatar local src', 's2a21-a1.png', 'live');
    update public.contacts set avatar = jsonb_build_object('src', 'https://favicon.show/ergart.de') where id = v_contact;
    v_failures := v_failures || pg_temp.s2a21_expect('10b contact avatar favicon', 's2a21-a1.png', 'dead');
    update public.contacts set avatar = '"avatar.png"'::jsonb where id = v_contact;
    v_failures := v_failures || pg_temp.s2a21_expect('10c contact avatar malformed', 's2a21-a1.png', 'unknown');
    update public.contacts set avatar = 'null'::jsonb where id = v_contact;
    v_failures := v_failures || pg_temp.s2a21_expect('10c contact avatar JSON null, unrelated key', 's2a21-a1.png', 'dead');
    update public.contacts set avatar = null where id = v_contact;

    update public.sales set avatar = jsonb_build_object('src', 'data:image/png;base64,iVBORw0KGgo=') where id = v_sales;
    v_failures := v_failures || pg_temp.s2a21_expect('10d sales avatar data URI', 's2a21-a2.png', 'dead');
    update public.sales set avatar = jsonb_build_object('src', c_p || 's2a21-a2.png', 'path', 's2a21-a2.png') where id = v_sales;
    v_failures := v_failures || pg_temp.s2a21_expect('10e sales avatar local src', 's2a21-a2.png', 'live');
    update public.sales set avatar = 'null'::jsonb where id = v_sales;
    v_failures := v_failures || pg_temp.s2a21_expect('10f sales avatar JSON null, unrelated key', 's2a21-a2.png', 'dead');
    update public.sales set avatar = null where id = v_sales;

    v_failures := v_failures || pg_temp.s2a21_expect('10g universe clean again', 's2a21-k1.pdf', 'dead');

    -- ---- 11. result composition ---------------------------------------------
    -- LIVE dominates UNKNOWN, even when the ambiguity sits on another surface.
    -- Own key: the 5b metadata delete captured a pending deletion intent for
    -- s2a21-k1.pdf, and since W8-C S3A (20260919120000) reference admission
    -- rejects a NEW public.attachments row for a key with an active intent.
    -- The resolver contract under test is key-agnostic.
    insert into public.attachments (deal_note_id, storage_key, file_name, mime_type)
        values (v_dnote, 's2a21-k11.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;
    update public.companies set logo = '[]'::jsonb where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('11a live + unrelated unknown -> live', 's2a21-k11.pdf', 'live');
    v_failures := v_failures || pg_temp.s2a21_expect('11b no live + unknown -> unknown',     's2a21-k2.pdf', 'unknown');
    delete from public.attachments where id = v_a;
    -- a single malformed registered value is enough to prevent a false 'dead'
    v_failures := v_failures || pg_temp.s2a21_expect('11c malformed value prevents false dead', 's2a21-k11.pdf', 'unknown');
    update public.companies set logo = null where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('11d clean -> dead', 's2a21-k11.pdf', 'dead');

    -- CROSS-SURFACE LIVE over UNKNOWN. Resolver order: S1, S2 contact_notes,
    -- S3 deal_notes, S4 companies, S5 branding, S6 contacts, S7 sales, S5r.
    -- In every case the ambiguity sits on a surface evaluated BEFORE the live
    -- proof, and a control first shows the ambiguity alone yields 'unknown'
    -- (so the case is not vacuous). A resolver that returned 'unknown' as
    -- soon as an ambiguous surface was seen fails these assertions.

    -- CASE A: S2 malformed element, then S7 sales.avatar proves live
    update public.contact_notes set attachments = array['"just-a-string"'::jsonb] where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('11h A control: S2 malformed alone', 's2a21-x1.png', 'unknown');
    update public.sales set avatar = jsonb_build_object('path', 's2a21-x1.png') where id = v_sales;
    v_failures := v_failures || pg_temp.s2a21_expect('11h A: S2 malformed + later S7 live', 's2a21-x1.png', 'live');
    update public.sales set avatar = null where id = v_sales;
    update public.contact_notes set attachments = null where id = v_cnote;

    -- CASE B: S5r tripwire, with a live company logo (S4) for the same key
    update public.configuration set config = jsonb_build_object('loginBanner', c_p || 's2a21-x2.png');
    v_failures := v_failures || pg_temp.s2a21_expect('11i B control: S5r tripwire alone', 's2a21-x2.png', 'unknown');
    update public.companies set logo = jsonb_build_object('path', 's2a21-x2.png') where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('11i B: S5r tripwire + S4 live', 's2a21-x2.png', 'live');
    update public.companies set logo = null where id = v_company;
    update public.configuration set config = '{}'::jsonb;

    -- CASE B': S5 malformed branding, then S6 contacts.avatar proves live
    update public.configuration set config = jsonb_build_object('darkModeLogo', 42);
    v_failures := v_failures || pg_temp.s2a21_expect('11j B'' control: S5 malformed alone', 's2a21-x3.png', 'unknown');
    update public.contacts set avatar = jsonb_build_object('src', c_l || 's2a21-x3.png') where id = v_contact;
    v_failures := v_failures || pg_temp.s2a21_expect('11j B'': S5 malformed + later S6 live', 's2a21-x3.png', 'live');
    update public.contacts set avatar = null where id = v_contact;
    update public.configuration set config = '{}'::jsonb;

    -- CASE C: S2 foreign-origin canonical URL for the key, then S3 path proves live
    update public.contact_notes set attachments = array[jsonb_build_object('src', c_f || 's2a21-x4.png')] where id = v_cnote;
    v_failures := v_failures || pg_temp.s2a21_expect('11k C control: S2 foreign canonical alone', 's2a21-x4.png', 'unknown');
    update public.deal_notes set attachments = array[jsonb_build_object('path', 's2a21-x4.png')] where id = v_dnote;
    v_failures := v_failures || pg_temp.s2a21_expect('11k C: S2 foreign canonical + later S3 live', 's2a21-x4.png', 'live');
    update public.deal_notes set attachments = null where id = v_dnote;
    update public.contact_notes set attachments = null where id = v_cnote;

    -- CASE D: S4 malformed logo, then S7 sales.avatar proves live
    update public.companies set logo = '[]'::jsonb where id = v_company;
    v_failures := v_failures || pg_temp.s2a21_expect('11l D control: S4 malformed alone', 's2a21-x5.png', 'unknown');
    update public.sales set avatar = jsonb_build_object('path', 's2a21-x5.png') where id = v_sales;
    v_failures := v_failures || pg_temp.s2a21_expect('11l D: S4 malformed + later S7 live', 's2a21-x5.png', 'live');
    update public.sales set avatar = null where id = v_sales;
    update public.companies set logo = null where id = v_company;

    v_failures := v_failures || pg_temp.s2a21_expect('11m clean -> dead after cross-surface cases', 's2a21-x1.png', 'dead');

    -- invalid candidate input: 22023 + machine-readable prefix
    foreach v_key in array array[null, '', '   ', repeat('x', 513)] loop
        v_state := 'no error'; v_msg := null;
        begin
            perform nora_private.attachment_storage_key_liveness(v_key);
        exception when others then
            v_state := sqlstate; v_msg := sqlerrm;
        end;
        if v_state <> '22023' or v_msg not like 'NORA_ATTACHMENT_LIVENESS_INVALID_KEY%' then
            v_failures := v_failures || format('11e invalid key %L -> %s %s, expected 22023 NORA_ATTACHMENT_LIVENESS_INVALID_KEY',
                v_key, v_state, coalesce(v_msg, ''));
        end if;
    end loop;
    v_failures := v_failures || pg_temp.s2a21_expect('11f 512 characters is valid', repeat('x', 512), 'dead');

    -- queue-domain compatibility: a padded non-blank key is valid and is
    -- compared EXACTLY, never trimmed
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, ' s2a21-pad.pdf ', 'plan.pdf', 'application/pdf') returning id into v_a;
    v_failures := v_failures || pg_temp.s2a21_expect('11g padded key, exact match', ' s2a21-pad.pdf ', 'live');
    v_failures := v_failures || pg_temp.s2a21_expect('11g trimmed key is a different key', 's2a21-pad.pdf', 'dead');
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key) values (' s2a21-pad.pdf ');
    exception when check_violation then
        v_failures := array_append(v_failures, '11g the queue rejects a padded key the resolver accepts');
    end;
    delete from public.attachments where id = v_a;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (registry behaviour):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK  5. clean-universe baseline; S1 public.attachments exact storage_key';
    raise notice 'OK  6. S2 contact_notes.attachments: path, src fallback, later element, malformed, conflicting path/src, NULL/empty';
    raise notice 'OK  7. S3 deal_notes.attachments: path, src fallback, malformed, conflicting path/src';
    raise notice 'OK  8. S4 companies.logo: local path, local src, favicon, malformed';
    raise notice 'OK  9. S5 branding URL-only + object form, blank, defaults, malformed, wrong type; S5r residual tripwire incl. relative bucket paths and the candidate key verbatim';
    raise notice 'OK 10. S6 contacts.avatar / S7 sales.avatar';
    raise notice 'OK 11. composition: LIVE > UNKNOWN > DEAD incl. cross-surface (ambiguity before live proof), invalid input 22023, padded key exact';

    raise exception 'ROLLBACK_W8C_S2A21_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8C_S2A21_TEST' then
            raise notice 'registry fixtures rolled back';
        else
            raise;
        end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 12. Real SQL errors propagate — never mapped to 'unknown'
-- ---------------------------------------------------------------------------
do $$
declare
    v_state    text;
    v_result   text;
    v_msg      text;
    v_failures text[] := '{}';
begin
    -- a registered column disappears (schema drift)
    v_state := 'no error'; v_result := null;
    begin
        alter table public.companies rename column logo to logo_s2a21_drift;
        v_result := nora_private.attachment_storage_key_liveness('s2a21-k1.pdf');
        raise exception 'S2A21_NO_ERROR';
    exception when others then
        v_state := sqlstate;
        if sqlerrm = 'S2A21_NO_ERROR' then v_state := 'no error'; end if;
    end;
    if v_state <> '42703' then
        v_failures := v_failures || format('12a schema drift -> %s (result %s), expected 42703 undefined_column',
            v_state, coalesce(v_result, 'none'));
    end if;

    -- a helper disappears (coding / deployment bug)
    v_state := 'no error'; v_result := null;
    begin
        drop function nora_private.attachment_file_value_liveness(jsonb, text);
        v_result := nora_private.attachment_storage_key_liveness('s2a21-k1.pdf');
        raise exception 'S2A21_NO_ERROR';
    exception when others then
        v_state := sqlstate;
        if sqlerrm = 'S2A21_NO_ERROR' then v_state := 'no error'; end if;
    end;
    if v_state <> '42883' then
        v_failures := v_failures || format('12b missing helper -> %s (result %s), expected 42883 undefined_function',
            v_state, coalesce(v_result, 'none'));
    end if;

    -- RLS-visibility drift (F4). The definer is re-owned by a role WITHOUT
    -- BYPASSRLS that does not own the registered tables: every registered
    -- table has RLS enabled and no policy names that role, so a plain read
    -- would silently see zero rows. A live branding reference is planted
    -- first, so the silent answer would be a FALSE 'dead'.
    -- 12d: with row_security = off (the shipped setting) the call RAISES.
    -- 12e: control — the same drift with the setting removed answers 'dead',
    --      proving the setting is what turns the false 'dead' into an error.
    -- Role, grants, ownership and data all live in a rolled-back
    -- subtransaction.
    for v_result in select unnest(array['12d', '12e']) loop
        v_state := 'no error'; v_msg := null;
        begin
            update public.configuration
               set config = jsonb_build_object('lightModeLogo',
                   'http://127.0.0.1:54321/storage/v1/object/public/attachments/s2a21-rls.png');
            if nora_private.attachment_storage_key_liveness('s2a21-rls.png') <> 'live' then
                raise exception 'S2A21_RLS_PRECONDITION';
            end if;

            create role nora_s2a21_rls_drift nologin nobypassrls;
            grant nora_s2a21_rls_drift to postgres;
            grant usage, create on schema nora_private to nora_s2a21_rls_drift;
            grant usage on schema public to nora_s2a21_rls_drift;
            grant select on public.attachments, public.contact_notes, public.deal_notes, public.companies,
                            public.configuration, public.contacts, public.sales to nora_s2a21_rls_drift;
            grant execute on function nora_private.attachment_url_liveness(text, text),
                                      nora_private.attachment_file_value_liveness(jsonb, text) to nora_s2a21_rls_drift;
            alter function nora_private.attachment_storage_key_liveness(text) owner to nora_s2a21_rls_drift;
            if v_result = '12e' then
                alter function nora_private.attachment_storage_key_liveness(text) reset row_security;
            end if;

            v_msg := nora_private.attachment_storage_key_liveness('s2a21-rls.png');
            raise exception 'S2A21_RLS_ANSWERED:%', v_msg;
        exception when others then
            v_state := sqlstate;
            if sqlerrm like 'S2A21_RLS_ANSWERED:%' then
                v_state := 'answered ' || substr(sqlerrm, length('S2A21_RLS_ANSWERED:') + 1);
            else
                v_msg := sqlerrm;
            end if;
        end;

        if v_result = '12d' and (v_state <> '42501' or v_msg not like '%row-level security%') then
            v_failures := v_failures || format('12d RLS drift with row_security = off -> %s %s, expected 42501 row-level security error',
                v_state, coalesce(v_msg, ''));
        end if;
        if v_result = '12e' and v_state <> 'answered dead' then
            v_failures := v_failures || format('12e control (row_security reset) -> %s, expected the silent false answer dead', v_state);
        end if;
    end loop;

    if exists (select 1 from pg_roles where rolname = 'nora_s2a21_rls_drift')
       or pg_get_userbyid((select proowner from pg_proc
                           where oid = 'nora_private.attachment_storage_key_liveness(text)'::regprocedure)) <> 'postgres'
       or (select proconfig from pg_proc
           where oid = 'nora_private.attachment_storage_key_liveness(text)'::regprocedure)
          is distinct from array['search_path=""', 'row_security=off'] then
        v_failures := array_append(v_failures, '12f the RLS-drift probe was not fully rolled back');
    end if;

    -- all subtransactions rolled back: the resolver works again
    if nora_private.attachment_storage_key_liveness('s2a21-k1.pdf') <> 'dead' then
        v_failures := array_append(v_failures, '12c the resolver did not recover after the rolled-back drift');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (error propagation):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 12. schema drift and a missing helper raise (42703 / 42883); an RLS-visibility drift raises 42501 (row_security = off) where it would otherwise answer a false dead; errors are never a verdict';
end;
$$;

-- ---------------------------------------------------------------------------
-- 13. REGISTRY COMPLETENESS GUARD
--
-- Every column in public / nora_private that could carry a storage reference
-- — any json / jsonb (incl. arrays and domains), plus any string-typed column
-- whose name suggests a URL / file / image — must be classified here as
-- REGISTERED (the resolver reads it) or EXCLUDED (with the reason). A future
-- migration adding such a column fails this suite until someone decides.
-- Classification is by catalog, never by current data.
-- ---------------------------------------------------------------------------
create function pg_temp.s2a21_unclassified()
returns table (col text, typ text)
language sql
as $$
    with classified(col) as (
        values
            -- REGISTERED (resolver registry v1)
            ('public.attachments.storage_key'),                  -- S1
            ('public.contact_notes.attachments'),                -- S2
            ('public.deal_notes.attachments'),                   -- S3
            ('public.companies.logo'),                           -- S4
            ('public.configuration.config'),                     -- S5 + S5r
            ('public.contacts.avatar'),                          -- S6
            ('public.sales.avatar'),                             -- S7
            -- EXCLUDED
            ('nora_private.attachment_storage_deletion_queue.storage_key'),     -- the intent itself, not a reference
            ('public.attachments.file_name'),                                   -- display name, never a storage identity
            ('public.audit_events.old_data'),                                   -- audit: historical evidence
            ('public.audit_events.new_data'),                                   -- audit: historical evidence
            ('public.audit_events.metadata'),                                   -- audit: historical evidence
            ('nora_private.idempotency_records.result'),                        -- replay payload, not a live reference
            ('public.operation_errors.technical_context'),                      -- diagnostics, allowlisted keys only
            ('nora_private.sales_account_deletion_tickets.eligibility_snapshot'), -- lifecycle evidence snapshot
            ('public.companies.context_links'),                                 -- user-entered links
            ('public.companies.links_jsonb'),                                   -- user-entered links
            ('public.companies.email_jsonb'),                                   -- contact data
            ('public.companies.phone_jsonb'),                                   -- contact data
            ('public.companies.linkedin_url'),                                  -- user-entered link
            ('public.contacts.links_jsonb'),                                    -- user-entered links
            ('public.contacts.email_jsonb'),                                    -- contact data
            ('public.contacts.phone_jsonb'),                                    -- contact data
            ('public.contacts.linkedin_url'),                                   -- user-entered link
            ('public.google_calendar_events.html_link')                         -- external Google Calendar link
    ),
    candidates as (
        select n.nspname || '.' || c.relname || '.' || a.attname as col,
               format_type(a.atttypid, a.atttypmod) as typ
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        join pg_type t on t.oid = a.atttypid
        join pg_type bt on bt.oid = case when t.typtype = 'd' then t.typbasetype else t.oid end
        left join pg_type et on et.oid = bt.typelem and bt.typcategory = 'A'
        where n.nspname in ('public', 'nora_private')
          and c.relkind in ('r', 'p', 'm', 'f')
          and a.attnum > 0 and not a.attisdropped
          and (coalesce(et.typname, bt.typname) in ('json', 'jsonb')
               or (coalesce(et.typcategory, bt.typcategory) = 'S'
                   and a.attname ~* '(url|uri|href|link|logo|avatar|image|img|photo|picture|icon|banner|cover|thumb|file|attach|path|src|storage|bucket|object|media|document|asset|blob)'))
    )
    select 'UNCLASSIFIED ' || cand.col, cand.typ
    from candidates cand
    where cand.col not in (select classified.col from classified)
    union all
    select 'STALE CLASSIFICATION ' || classified.col, null
    from classified
    where classified.col not in (select cand.col from candidates cand)
$$;

do $$
declare
    r          record;
    v_src      text;
    v_failures text[] := '{}';
    v_flagged  text[];
begin
    -- 13a. the current schema is fully classified
    for r in select * from pg_temp.s2a21_unclassified() loop
        v_failures := v_failures || format('13a %s (%s)', r.col, coalesce(r.typ, '-'));
    end loop;

    -- 13b. every REGISTERED surface is actually read by the resolver
    select p.prosrc into v_src from pg_proc p
    where p.oid = to_regprocedure('nora_private.attachment_storage_key_liveness(text)');
    for r in
        select * from (values
            ('public.attachments',   'storage_key'),
            ('public.contact_notes', 'attachments'),
            ('public.deal_notes',    'attachments'),
            ('public.companies',     'logo'),
            ('public.configuration', 'lightModeLogo'),
            ('public.configuration', 'darkModeLogo'),
            ('public.contacts',      'avatar'),
            ('public.sales',         'avatar')
        ) as t(tbl, col)
    loop
        if position(r.tbl in v_src) = 0 or position(r.col in v_src) = 0 then
            v_failures := v_failures || format('13b registered surface %s.%s is not read by the resolver', r.tbl, r.col);
        end if;
    end loop;
    if v_src !~ 'unnest\(n\.attachments\)' then
        v_failures := array_append(v_failures, '13b the jsonb[] note surfaces are not read with unnest()');
    end if;

    -- 13c. NON-VACUITY: a future reference-bearing column is flagged
    begin
        alter table public.deals add column cover jsonb;
        alter table public.tasks add column attachments jsonb[];
        alter table public.companies add column banner_url text;
        select array_agg(u.col order by u.col) into v_flagged from pg_temp.s2a21_unclassified() u;
        raise exception 'S2A21_GUARD_PROBE_DONE';
    exception when others then
        if sqlerrm <> 'S2A21_GUARD_PROBE_DONE' then
            raise;
        end if;
    end;
    if v_flagged is distinct from array['UNCLASSIFIED public.companies.banner_url',
                                        'UNCLASSIFIED public.deals.cover',
                                        'UNCLASSIFIED public.tasks.attachments'] then
        v_failures := v_failures || format('13c the guard did not flag exactly the three simulated columns: %s',
            coalesce(array_to_string(v_flagged, ', '), '<nothing>'));
    end if;

    -- 13d. the resolver must see EVERY row: postgres bypasses RLS, or owns
    --      each registered table without FORCE ROW LEVEL SECURITY
    if not (select rolsuper or rolbypassrls from pg_roles where rolname = 'postgres') then
        for r in
            select c.oid::regclass::text as rel, pg_get_userbyid(c.relowner) as owner, c.relforcerowsecurity as forced
            from pg_class c
            where c.oid in ('public.attachments'::regclass, 'public.contact_notes'::regclass,
                            'public.deal_notes'::regclass, 'public.companies'::regclass,
                            'public.configuration'::regclass, 'public.contacts'::regclass,
                            'public.sales'::regclass)
        loop
            if r.owner <> 'postgres' or r.forced then
                v_failures := v_failures || format('13d the definer cannot see every row of %s', r.rel);
            end if;
        end loop;
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (registry completeness):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 13. registry completeness: every reference-capable column classified, registered surfaces read, future columns flagged';
end;
$$;

-- ---------------------------------------------------------------------------
-- 14. Queue vocabulary: skipped_live (produced only by the S2A2.2 inspect primitive)
-- ---------------------------------------------------------------------------
do $$
declare
    v_user     uuid := gen_random_uuid();
    v_sales    bigint;
    v_company  bigint; v_contact bigint; v_cnote bigint; v_a bigint;
    v_state    text;
    v_n        bigint;
    v_priv     text;
    v_role     text;
    v_writers  text[];
    v_failures text[] := '{}';
    v_all_privs text[] := case when current_setting('server_version_num')::int >= 170000
                               then array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']
                               else array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']
                          end;
begin
    -- ---- 14a. accepted WITH completed_at ------------------------------------
    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at)
        values ('s2a21-q1.pdf', 'skipped_live', now());

    -- ---- 14b. rejected WITHOUT completed_at ---------------------------------
    v_state := 'accepted';
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state)
            values ('s2a21-q2.pdf', 'skipped_live');
    exception when check_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        v_failures := array_append(v_failures, '14b skipped_live without completed_at was accepted');
    end if;

    -- ---- 14c. cannot carry an active claim ----------------------------------
    v_state := 'accepted';
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at, claimed_at, claimed_by)
            values ('s2a21-q3.pdf', 'skipped_live', now(), now(), 'worker-1');
    exception when check_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        v_failures := array_append(v_failures, '14c skipped_live with claim columns was accepted');
    end if;

    -- the pre-existing terminal/active invariants still hold
    v_state := 'accepted';
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at)
            values ('s2a21-q4.pdf', 'pending', now());
    exception when check_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        v_failures := array_append(v_failures, '14c an active state with completed_at was accepted');
    end if;
    v_state := 'accepted';
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state)
            values ('s2a21-q5.pdf', 'done');
    exception when check_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        v_failures := array_append(v_failures, '14c done without completed_at was accepted');
    end if;
    v_state := 'accepted';
    begin
        insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at)
            values ('s2a21-q6.pdf', 'skipped', now());
    exception when check_violation then v_state := 'rejected';
    end;
    if v_state <> 'rejected' then
        v_failures := array_append(v_failures, '14c the state vocabulary is not closed');
    end if;

    -- ---- 14d. neither active nor due (index predicates unchanged) -----------
    if exists (select 1 from pg_index i join pg_class c on c.oid = i.indexrelid
               where i.indrelid = 'nora_private.attachment_storage_deletion_queue'::regclass
                 and c.relname in ('uq__attachment_deletion_queue__active_storage_key', 'attachment_deletion_queue_due_idx')
                 and pg_get_expr(i.indpred, i.indrelid) like '%skipped_live%') then
        v_failures := array_append(v_failures, '14d skipped_live appears in an active/due index predicate');
    end if;
    if (select array_agg(m[1] order by m[1])
          from pg_index i join pg_class c on c.oid = i.indexrelid,
               regexp_matches(pg_get_expr(i.indpred, i.indrelid), '''([a-z_]+)''::text', 'g') as m
         where c.relname = 'uq__attachment_deletion_queue__active_storage_key')
       is distinct from array['claimed','failed_retryable','pending'] then
        v_failures := array_append(v_failures, '14d the active unique predicate changed');
    end if;
    if (select array_agg(m[1] order by m[1])
          from pg_index i join pg_class c on c.oid = i.indexrelid,
               regexp_matches(pg_get_expr(i.indpred, i.indrelid), '''([a-z_]+)''::text', 'g') as m
         where c.relname = 'attachment_deletion_queue_due_idx')
       is distinct from array['failed_retryable','pending'] then
        v_failures := array_append(v_failures, '14d the due predicate changed');
    end if;

    -- ---- 14e. a terminal skipped_live row does not block a later job --------
    insert into nora_private.attachment_storage_deletion_queue (storage_key) values ('s2a21-q1.pdf');
    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at)
        values ('s2a21-q1.pdf', 'skipped_live', now());
    if (select count(*) from nora_private.attachment_storage_deletion_queue
        where storage_key = 's2a21-q1.pdf' and state = 'pending') <> 1 then
        v_failures := array_append(v_failures, '14e a pending job after skipped_live was not created');
    end if;

    -- ---- 14f. the S2A1 capture still produces pending only ------------------
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at,
                            raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
    values (v_user, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'w8c-s2a21-queue@nora.test', 'x', now(),
            '{"provider":"email","providers":["email"]}', '{"first_name":"Quin","last_name":"Queue"}', now(), now());
    select id into v_sales from public.sales where user_id = v_user;
    insert into public.companies (name, sales_id) values ('W8-C S2A2.1 Queue', v_sales) returning id into v_company;
    insert into public.contacts (first_name, last_name, company_id, sales_id)
        values ('Que', 'Ue', v_company, v_sales) returning id into v_contact;
    insert into public.contact_notes (contact_id, text, date, sales_id)
        values (v_contact, 'Queue', now(), v_sales) returning id into v_cnote;

    insert into nora_private.attachment_storage_deletion_queue (storage_key, state, completed_at)
        values ('s2a21-q7.pdf', 'skipped_live', now());
    insert into public.attachments (contact_note_id, storage_key, file_name, mime_type)
        values (v_cnote, 's2a21-q7.pdf', 'plan.pdf', 'application/pdf') returning id into v_a;
    delete from public.attachments where id = v_a;
    select count(*) into v_n from nora_private.attachment_storage_deletion_queue
        where storage_key = 's2a21-q7.pdf' and state = 'pending' and completed_at is null;
    if v_n <> 1 then
        v_failures := v_failures || format('14f capture after skipped_live produced %s pending jobs, expected 1', v_n);
    end if;
    if exists (select 1 from nora_private.attachment_storage_deletion_queue
               where storage_key = 's2a21-q7.pdf' and state not in ('pending', 'skipped_live')) then
        v_failures := array_append(v_failures, '14f capture produced a state other than pending');
    end if;

    -- ---- 14g. only the W8-C S2A2.2 inspect primitive produces skipped_live --
    select array_agg(n.nspname || '.' || p.proname order by n.nspname, p.proname) into v_writers
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'nora_private')
      and p.prosrc like '%skipped_live%';
    if v_writers is distinct from array['nora_private.attachment_deletion_inspect'] then
        v_failures := v_failures || format(
            '14g skipped_live is referenced by %s - only nora_private.attachment_deletion_inspect may produce it',
            coalesce(array_to_string(v_writers, ', '), '<nothing>'));
    end if;

    -- ---- 14h. queue ACL unchanged -------------------------------------------
    foreach v_role in array array['anon','authenticated','service_role'] loop
        foreach v_priv in array v_all_privs loop
            if has_table_privilege(v_role, 'nora_private.attachment_storage_deletion_queue', v_priv) then
                v_failures := v_failures || format('14h %s holds %s on the queue', v_role, v_priv);
            end if;
        end loop;
    end loop;
    if exists (select 1 from pg_class c, aclexplode(c.relacl) acl
               where c.oid = 'nora_private.attachment_storage_deletion_queue'::regclass
                 and (acl.grantee = 0 or pg_get_userbyid(acl.grantee) <> 'postgres')) then
        v_failures := array_append(v_failures, '14h the queue ACL names a grantee other than postgres');
    end if;
    if not (select relrowsecurity from pg_class where oid = 'nora_private.attachment_storage_deletion_queue'::regclass)
       or exists (select 1 from pg_policies where schemaname = 'nora_private'
                                              and tablename = 'attachment_storage_deletion_queue') then
        v_failures := array_append(v_failures, '14h queue RLS is off or a policy exists');
    end if;

    if cardinality(v_failures) > 0 then
        raise exception E'FAIL (queue vocabulary):\n%', array_to_string(v_failures, E'\n');
    end if;
    raise notice 'OK 14. skipped_live: terminal, needs completed_at, no claim, not active/due, does not block, only the S2A2.2 inspect primitive produces it; capture still pending-only; ACL unchanged';

    raise exception 'ROLLBACK_W8C_S2A21_TEST';
exception
    when others then
        if sqlerrm = 'ROLLBACK_W8C_S2A21_TEST' then
            raise notice 'queue fixtures rolled back';
        else
            raise;
        end if;
end;
$$;

-- nothing survived: no fixture, no queue row
do $$
begin
    if exists (select 1 from nora_private.attachment_storage_deletion_queue where storage_key like 's2a21-%' or storage_key like ' s2a21-%')
       or exists (select 1 from public.attachments where storage_key like '%s2a21-%')
       or exists (select 1 from auth.users where email like 'w8c-s2a21-%') then
        raise exception 'FAIL: S2A2.1 test fixtures leaked';
    end if;
    raise notice 'OK    fixtures fully rolled back';
end;
$$;

\echo '=== W8-C S2A2.1 verification: ALL CHECKS PASSED ==='
