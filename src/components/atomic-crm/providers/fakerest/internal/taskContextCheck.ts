import type { DataProvider } from "ra-core";

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

/**
 * FakeRest mirror of nora_private.is_effective_contact_of_company(): a
 * contact belongs to a customer record if contacts.company_id matches it,
 * OR the company's self_contact_id points at the contact (Self Contact
 * Wave, 2026-08-26). Single shared helper — do not reimplement this
 * invariant separately per call site.
 */
export const isEffectiveContactOfCompany = async (
  contactId: unknown,
  companyId: unknown,
  dataProvider: DataProvider,
): Promise<boolean> => {
  if (contactId == null || companyId == null) return false;
  const [{ data: company }, { data: contact }] = await Promise.all([
    dataProvider.getOne("companies", { id: companyId }),
    dataProvider.getOne("contacts", { id: contactId }),
  ]);
  return (
    String(contact?.company_id ?? "") === String(companyId) ||
    String(company?.self_contact_id ?? "") === String(contactId)
  );
};
