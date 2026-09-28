-- W8-E ROLLBACK — return the `attachments` bucket to PUBLIC. THIS FILE MUTATES.
--
-- It writes exactly one column of exactly one row:
--     storage.buckets.public = true   where id = 'attachments'
--
-- WHEN TO RUN IT
--   Only as the FIRST step of a post-flip rollback. If the W8-E runtime has to
--   be rolled back after Stage C, the old runtime reaches attachments through
--   public object URLs, so the bucket must be public again BEFORE the runtime
--   is reverted. Reverting the runtime first would leave every attachment
--   broken for the length of the revert.
--
--   Correct order:   1. this file        2. revert the runtime
--   Wrong order:     1. revert runtime   2. this file     (outage in between)
--
-- WHAT IT DELIBERATELY DOES NOT DO
--   * it does not move branding objects back. The relocated copies in the
--     `branding` bucket stay, and the references keep pointing at them: that
--     state is fully supported by the OLD runtime too (a public URL is a
--     public URL), which is precisely why Stage A was designed to be safe on
--     its own. Undoing it would be pointless churn and would break branding
--     for the rollback runtime;
--   * it deletes nothing, anywhere;
--   * it does not touch policies, grants, `public.attachments`, the deletion
--     queue or note JSON. None of those changed at Stage C.
--
-- HONEST LIMIT. Running this re-exposes every object key in the bucket to
-- anonymous readers, which is exactly the residual risk W8-E exists to close.
-- It is a deliberate, temporary trade against an outage — not a neutral undo.
-- Signed URLs issued while the bucket was private keep working until they
-- expire; that is unchanged either way.

do $$
declare
    v_was_public boolean;
begin
    select b.public into v_was_public from storage.buckets b where b.id = 'attachments';

    if v_was_public is null then
        raise exception 'W8-E rollback refused: bucket "attachments" does not exist'
            using errcode = 'P0002';
    end if;

    if v_was_public is true then
        raise notice 'W8-E rollback: attachments is already public, nothing to do';
        return;
    end if;

    update storage.buckets set public = true where id = 'attachments';

    raise notice 'W8-E rollback: attachments.public false -> true';
end;
$$;

select
    b.id      as bucket,
    b.public  as is_public,
    case when b.public is true
         then 'PUBLIC — the pre-W8-E runtime is supported again; revert the runtime next'
         else 'STILL PRIVATE — the rollback did not take effect'
    end       as verdict
from storage.buckets b
where b.id = 'attachments';
