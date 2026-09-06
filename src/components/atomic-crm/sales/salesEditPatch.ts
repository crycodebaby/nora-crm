import type { Sale, SalesFormData } from "../types";

/**
 * Send only changed fields — pure role edits must not rewrite names.
 * The login email is never part of this PATCH (W4): it moves only through
 * "E-Mail-Adresse ändern" in the Nora-Zugang panel, and the server refuses a
 * PATCH that carries it. Avatar is not part of SalesInputs; omitted to avoid
 * accidental clears.
 */
export function buildSalesEditPatch(
  record: Sale,
  data: SalesFormData,
): Partial<Omit<SalesFormData, "password" | "email">> {
  const patch: Partial<Omit<SalesFormData, "password" | "email">> = {};
  if (data.first_name !== record.first_name) {
    patch.first_name = data.first_name;
  }
  if (data.last_name !== record.last_name) {
    patch.last_name = data.last_name;
  }
  if (data.role !== record.role) {
    patch.role = data.role;
  }
  if (data.disabled !== record.disabled) {
    patch.disabled = data.disabled;
  }
  return patch;
}
