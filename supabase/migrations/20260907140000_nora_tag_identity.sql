-- Nora Markierungen Identity (2026-09-07): one logical Markierung exists at
-- most once, and no business record may silently lose one.
--
-- Why this migration exists
-- -------------------------
-- A Production usability incident produced five redundant public.tags rows
-- (3x "Privatperson", 2x "Privatperso"), all with zero usage. The reproduced
-- root cause is a client bug: TagsListEdit.handleTagCreated spread
-- `record.tags` unguarded, so on a contact whose contacts.tags column was
-- NULL the attach step threw `TypeError: record.tags is not iterable` AFTER
-- the tags row had already been INSERTed. The dialog therefore never closed
-- and showed no error, so the office user pressed "Speichern" again — and
-- every press created one more row.
--
-- The client fix alone is not enough: nothing in the database ever prevented
-- two rows from carrying the same logical name, and a second browser tab, a
-- CSV import or a retried request could recreate the same situation. This
-- migration makes the invariant a property of the data, not of the UI.
--
-- Canonical name contract (nora_private.tag_name_key)
-- ---------------------------------------------------
--   key(name) := lower(btrim(name))
-- Surrounding whitespace is insignificant, case is insignificant. Nothing
-- else is normalized on purpose: internal spacing and spelling stay
-- meaningful, so "Privatperso" and "Privatperson" remain two DIFFERENT
-- logical Markierungen here. Collapsing that typo is a product decision about
-- meaning, not a mechanical one, and this migration must never guess it — it
-- is left to a human through "Markierungen verwalten".
--
-- Cleanup is data-driven: no Production id is hard-coded anywhere below, and
-- an ambiguous duplicate group aborts the whole migration instead of picking
-- a winner.

-- ---------------------------------------------------------------------------
-- 1. The canonical name rule, as one authoritative definition
-- ---------------------------------------------------------------------------
create or replace function nora_private.tag_name_key(p_name text)
returns text
language sql
immutable
strict
parallel safe
set search_path = ''
as $$
    select pg_catalog.lower(pg_catalog.btrim(p_name));
$$;

comment on function nora_private.tag_name_key(text) is
    'Canonical identity of a Markierung name: lower(btrim(name)). Backs uq__tags__normalized_name; changing it requires dropping that index first, which is deliberate.';

-- ---------------------------------------------------------------------------
-- 2. Pre-flight: refuse to run on data this migration may not decide about
-- ---------------------------------------------------------------------------
do $$
declare
    v_stale       text;
    v_blank_used  text;
    v_ambiguous   text;
begin
    -- 2a. A tag id referenced by a contact but absent from public.tags would
    --     make the rewrite below lose a reference silently.
    select string_agg(distinct x.tag_id::text, ', ' order by x.tag_id::text)
      into v_stale
      from public.contacts c
      cross join lateral unnest(c.tags) as x(tag_id)
     where c.tags is not null
       and not exists (select 1 from public.tags t where t.id = x.tag_id);
    if v_stale is not null then
        raise exception
            'Nora Markierungen: contacts reference tag id(s) that do not exist: %. Resolve manually — this migration will not drop references.',
            v_stale;
    end if;

    -- 2b. A blank-named tag that is actually in use carries meaning we cannot
    --     reconstruct. Unused blank rows are removed further below.
    select string_agg(t.id::text, ', ' order by t.id)
      into v_blank_used
      from public.tags t
     where btrim(t.name) = ''
       and exists (select 1 from public.contacts c where c.tags @> array[t.id]);
    if v_blank_used is not null then
        raise exception
            'Nora Markierungen: blank-named tag(s) % are in use; name them before migrating.',
            v_blank_used;
    end if;

    -- 2c. Genuine product conflict: within one duplicate group, two or more
    --     rows are REFERENCED and they do not agree on colour. Merging would
    --     visibly change a categorisation somebody deliberately made, so the
    --     migration stops instead of choosing.
    select string_agg(g.name_key, ', ' order by g.name_key)
      into v_ambiguous
      from (
          select nora_private.tag_name_key(t.name) as name_key
            from public.tags t
           where exists (select 1 from public.contacts c where c.tags @> array[t.id])
           group by nora_private.tag_name_key(t.name)
          having count(*) > 1
             and count(distinct t.color) > 1
      ) g;
    if v_ambiguous is not null then
        raise exception
            'Nora Markierungen: duplicate group(s) [%] contain several USED rows with different colours. A human must decide which one survives (Markierungen verwalten).',
            v_ambiguous;
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Deterministic canonical row per duplicate group
--    most used first, then the oldest (lowest) id — never arbitrary.
-- ---------------------------------------------------------------------------
drop table if exists nora_tag_canonical_map;
create temporary table nora_tag_canonical_map as
with usage as (
    select t.id,
           t.name,
           nora_private.tag_name_key(t.name) as name_key,
           (select count(*) from public.contacts c where c.tags @> array[t.id]) as usage_count
      from public.tags t
),
canonical as (
    select distinct on (name_key) name_key, id as canonical_id
      from usage
     order by name_key, usage_count desc, id asc
)
select u.id            as tag_id,
       c.canonical_id  as canonical_id,
       u.name_key      as name_key,
       u.usage_count   as usage_count
  from usage u
  join canonical c on c.name_key = u.name_key;

-- Snapshot of every contact's LOGICAL tag set before the rewrite, so step 5
-- can prove nothing was lost rather than assert it.
drop table if exists nora_tag_before;
create temporary table nora_tag_before as
select c.id as contact_id,
       coalesce((
           select array_agg(distinct m.canonical_id order by m.canonical_id)
             from unnest(c.tags) as x(tag_id)
             join nora_tag_canonical_map m on m.tag_id = x.tag_id
       ), '{}'::bigint[]) as expected_tags
  from public.contacts c
 where c.tags is not null;

-- ---------------------------------------------------------------------------
-- 4. Rewrite every reference to its canonical id, de-duplicated, order kept
-- ---------------------------------------------------------------------------
update public.contacts c
   set tags = sub.new_tags
  from (
      select c2.id,
             coalesce((
                 select array_agg(d.canonical_id order by d.first_pos)
                   from (
                       select distinct on (m.canonical_id)
                              m.canonical_id,
                              u.ord as first_pos
                         from unnest(c2.tags) with ordinality as u(tag_id, ord)
                         join nora_tag_canonical_map m on m.tag_id = u.tag_id
                        order by m.canonical_id, u.ord
                   ) d
             ), '{}'::bigint[]) as new_tags
        from public.contacts c2
       where c2.tags is not null
  ) sub
 where c.id = sub.id
   and c.tags is distinct from sub.new_tags;

-- ---------------------------------------------------------------------------
-- 5. Prove no contact lost a logical Markierung
-- ---------------------------------------------------------------------------
do $$
declare v_lost text;
begin
    select string_agg(b.contact_id::text, ', ' order by b.contact_id)
      into v_lost
      from nora_tag_before b
      join public.contacts c on c.id = b.contact_id
     where coalesce((select array_agg(distinct x.tag_id order by x.tag_id)
                       from unnest(c.tags) as x(tag_id)), '{}'::bigint[])
           is distinct from b.expected_tags;
    if v_lost is not null then
        raise exception
            'Nora Markierungen: reference rewrite changed the logical tag set of contact(s) %; aborting.',
            v_lost;
    end if;
end
$$;

-- ---------------------------------------------------------------------------
-- 6. Remove the now-unreferenced redundant rows and any unused blank row
-- ---------------------------------------------------------------------------
delete from public.tags t
 using nora_tag_canonical_map m
 where m.tag_id = t.id
   and m.canonical_id <> t.id;

delete from public.tags t
 where btrim(t.name) = ''
   and not exists (select 1 from public.contacts c where c.tags @> array[t.id]);

-- ---------------------------------------------------------------------------
-- 7. Normalise the surviving display names (trim only — casing is the user's)
-- ---------------------------------------------------------------------------
update public.tags
   set name = btrim(name)
 where name <> btrim(name);

-- ---------------------------------------------------------------------------
-- 8. contacts.tags hygiene — NULL was the trigger of the whole incident
-- ---------------------------------------------------------------------------
update public.contacts
   set tags = '{}'::bigint[]
 where tags is null;

update public.contacts c
   set tags = sub.deduped
  from (
      select c2.id,
             coalesce((
                 select array_agg(d.tag_id order by d.first_pos)
                   from (
                       select distinct on (u.tag_id) u.tag_id, u.ord as first_pos
                         from unnest(c2.tags) with ordinality as u(tag_id, ord)
                        where u.tag_id is not null
                        order by u.tag_id, u.ord
                   ) d
             ), '{}'::bigint[]) as deduped
        from public.contacts c2
       where c2.tags is not null
  ) sub
 where c.id = sub.id
   and c.tags is distinct from sub.deduped;

alter table public.contacts alter column tags set default '{}'::bigint[];
alter table public.contacts alter column tags set not null;

-- ---------------------------------------------------------------------------
-- 9. The invariant itself
-- ---------------------------------------------------------------------------
alter table public.tags drop constraint if exists tags_name_not_blank;
alter table public.tags
    add constraint tags_name_not_blank check (btrim(name) <> '');

drop index if exists public.uq__tags__normalized_name;
create unique index uq__tags__normalized_name
    on public.tags (nora_private.tag_name_key(name));

comment on index public.uq__tags__normalized_name is
    'One logical Markierung name exists at most once. Concurrency-safe: a losing concurrent INSERT gets 23505 and the client re-resolves the winner instead of creating a second row.';

-- ---------------------------------------------------------------------------
-- 10. Keep it true for every future write, from any client
-- ---------------------------------------------------------------------------
create or replace function nora_private.normalize_tag_name()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.name := pg_catalog.btrim(new.name);
    if new.name = '' then
        raise exception 'Der Name der Markierung darf nicht leer sein.'
            using errcode = '23514', detail = 'NORA_TAG_NAME_REQUIRED';
    end if;
    return new;
end;
$$;

comment on function nora_private.normalize_tag_name() is
    'Stores Markierung names trimmed and rejects blank ones, so the unique index and the UI agree on what a name is.';

create or replace trigger normalize_tag_name_trigger
    before insert or update of name on public.tags
    for each row execute function nora_private.normalize_tag_name();

-- contacts.tags: NULL becomes '{}' and a tag id can never appear twice on the
-- same contact, whatever the caller sends (Contact attachment safety).
create or replace function nora_private.normalize_contact_tags()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.tags is null then
        new.tags := '{}'::bigint[];
        return new;
    end if;

    new.tags := coalesce((
        select pg_catalog.array_agg(d.tag_id order by d.first_pos)
          from (
              select distinct on (u.tag_id) u.tag_id, u.ord as first_pos
                from pg_catalog.unnest(new.tags) with ordinality as u(tag_id, ord)
               where u.tag_id is not null
               order by u.tag_id, u.ord
          ) d
    ), '{}'::bigint[]);

    return new;
end;
$$;

comment on function nora_private.normalize_contact_tags() is
    'contacts.tags is always a non-null, duplicate-free bigint[] with first-occurrence order preserved.';

create or replace trigger normalize_contact_tags_trigger
    before insert or update of tags on public.contacts
    for each row execute function nora_private.normalize_contact_tags();

-- A Markierung that is still attached to a contact may not be deleted — that
-- is what would leave stale ids inside contacts.tags.
create or replace function nora_private.guard_tag_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
    v_refs bigint;
begin
    select count(*) into v_refs
      from public.contacts c
     where c.tags @> array[old.id];

    if v_refs > 0 then
        raise exception
            'Markierung wird noch von % Kontakt(en) verwendet und kann nicht gelöscht werden.', v_refs
            using errcode = '23503', detail = 'NORA_TAG_IN_USE';
    end if;

    return old;
end;
$$;

comment on function nora_private.guard_tag_delete() is
    'Refuses deletion of a Markierung that is still referenced, so contacts.tags can never contain a dangling id.';

create or replace trigger guard_tag_delete_trigger
    before delete on public.tags
    for each row execute function nora_private.guard_tag_delete();

drop table if exists nora_tag_canonical_map;
drop table if exists nora_tag_before;

-- ---------------------------------------------------------------------------
-- 11. Terminal assertions — the migration certifies its own result
-- ---------------------------------------------------------------------------
do $$
declare
    v_dupes    bigint;
    v_blank    bigint;
    v_stale    bigint;
    v_dupe_ids bigint;
    v_nulls    bigint;
begin
    select count(*) into v_dupes
      from (
          select 1 from public.tags
           group by nora_private.tag_name_key(name)
          having count(*) > 1
      ) d;
    if v_dupes > 0 then
        raise exception 'Nora Markierungen: % duplicate normalized name(s) survived', v_dupes;
    end if;

    select count(*) into v_blank from public.tags where btrim(name) = '' or name <> btrim(name);
    if v_blank > 0 then
        raise exception 'Nora Markierungen: % blank or untrimmed tag name(s) survived', v_blank;
    end if;

    select count(*) into v_nulls from public.contacts where tags is null;
    if v_nulls > 0 then
        raise exception 'Nora Markierungen: % contact(s) still have NULL tags', v_nulls;
    end if;

    select count(*) into v_stale
      from public.contacts c
      cross join lateral unnest(c.tags) as x(tag_id)
     where not exists (select 1 from public.tags t where t.id = x.tag_id);
    if v_stale > 0 then
        raise exception 'Nora Markierungen: % reference(s) to a removed tag id survived', v_stale;
    end if;

    select count(*) into v_dupe_ids
      from public.contacts c
     where coalesce(array_length(c.tags, 1), 0)
           is distinct from (select count(distinct y.tag_id) from unnest(c.tags) as y(tag_id));
    if v_dupe_ids > 0 then
        raise exception 'Nora Markierungen: % contact(s) carry a duplicate tag id', v_dupe_ids;
    end if;

    if to_regclass('public.uq__tags__normalized_name') is null then
        raise exception 'Nora Markierungen: uq__tags__normalized_name missing';
    end if;

    if not exists (
        select 1 from pg_trigger
         where tgrelid = 'public.tags'::regclass and tgname = 'guard_tag_delete_trigger'
    ) then
        raise exception 'Nora Markierungen: guard_tag_delete_trigger missing';
    end if;
end
$$;
