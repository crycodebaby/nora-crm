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
--
-- IT VERIFIES ITS OWN RESULT (Alpha Storage 5 U-7). This is the emergency
-- path, so "the UPDATE ran" is not accepted as "the bucket is public":
--   * the mutation and its postcondition live in ONE block — if the bucket is
--     not public afterwards, the block raises and its own write rolls back,
--     so there is no ambiguous half-state;
--   * a second, independent postcondition block raises again, for a runner
--     that carries on past an error;
--   * the final report names a failure a FAILURE, so even a runner that shows
--     only the last result set cannot display a failed rollback as done.
--   Hard errors carry a stable DETAIL: NORA_W8E_ATTACHMENTS_BUCKET_MISSING,
--   NORA_W8E_ATTACHMENTS_STILL_PRIVATE.
--
-- RUNNER. psql with -v ON_ERROR_STOP=1 (exit code 3 on failure), or the whole
-- file verbatim as ONE Supabase MCP execute_sql call (one implicit
-- transaction: any error aborts all of it). Never psql without ON_ERROR_STOP:
-- it runs on past an error and exits 0. The verdict row is the result either
-- way — `PUBLIC — …` is success, anything else is not.

do $$
declare
    v_was_public boolean;
    v_is_public  boolean;
begin
    select b.public into v_was_public from storage.buckets b where b.id = 'attachments';

    if v_was_public is null then
        raise exception 'W8-E rollback refused: bucket "attachments" does not exist'
            using errcode = 'P0002',
                  detail = 'NORA_W8E_ATTACHMENTS_BUCKET_MISSING';
    end if;

    if v_was_public is true then
        raise notice 'W8-E rollback: attachments is already public, nothing to do';
        return;
    end if;

    update storage.buckets set public = true where id = 'attachments';

    -- Postcondition IN the mutating block: a failure here undoes the write
    -- above together with the error, never leaving "half done".
    select b.public into v_is_public from storage.buckets b where b.id = 'attachments';
    if v_is_public is not true then
        raise exception 'W8-E rollback FAILED: bucket "attachments" is still not public after the update'
            using errcode = '55000',
                  detail = 'NORA_W8E_ATTACHMENTS_STILL_PRIVATE',
                  hint = 'Do NOT revert the runtime: the old runtime needs a public bucket. Investigate storage.buckets (triggers, permissions) first.';
    end if;

    raise notice 'W8-E rollback: attachments.public false -> true';
end;
$$;

-- ---------------------------------------------------------------------------
-- POSTCONDITION — a HARD failure, independent of the block above.
--
-- Target state: attachments PUBLIC. It is checked again on its own so that a
-- runner which continues after the first error still ends on an error, and a
-- missing bucket can never be reported as anything but a failure.
-- ---------------------------------------------------------------------------
do $$
declare
    v_is_public boolean;
begin
    select b.public into v_is_public from storage.buckets b where b.id = 'attachments';
    if v_is_public is null then
        raise exception 'W8-E rollback FAILED: bucket "attachments" does not exist'
            using errcode = 'P0002',
                  detail = 'NORA_W8E_ATTACHMENTS_BUCKET_MISSING';
    end if;
    if v_is_public is not true then
        raise exception 'W8-E rollback FAILED: bucket "attachments" is still PRIVATE — do not revert the runtime'
            using errcode = '55000',
                  detail = 'NORA_W8E_ATTACHMENTS_STILL_PRIVATE';
    end if;
end;
$$;

-- The invocation returns its own result. Expected: exactly one row whose
-- verdict starts with `PUBLIC —`. Zero rows, or any other verdict, is a
-- failed rollback.
select
    b.id      as bucket,
    b.public  as is_public,
    case when b.public is true
         then 'PUBLIC — expected target state; the pre-W8-E runtime is supported again; revert the runtime next'
         else 'FAILURE — attachments is STILL PRIVATE, the rollback did not take effect; do NOT revert the runtime'
    end       as verdict
from storage.buckets b
where b.id = 'attachments';
