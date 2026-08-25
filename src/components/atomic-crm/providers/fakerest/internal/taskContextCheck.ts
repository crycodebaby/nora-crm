// Mirrors the Postgres `nora.skip_task_context_check` session flag used by
// merge_contacts(): reassigning a task's contact_id during a contact merge
// is identity consolidation, not a user picking a different contact for a
// task, so it must not re-validate/derive tasks.company_id against the
// winner's current company. See supabase/migrations/*_unified_tasks_wave.sql.
let skip = false;

export const withTaskContextCheckSkipped = async <T>(
  fn: () => Promise<T>,
): Promise<T> => {
  skip = true;
  try {
    return await fn();
  } finally {
    skip = false;
  }
};

export const isTaskContextCheckSkipped = () => skip;
