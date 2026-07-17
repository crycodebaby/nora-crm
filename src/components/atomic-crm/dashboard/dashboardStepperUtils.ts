import type { Identifier } from "ra-core";

/** Accept only a real contact id — never "undefined"/"null"/empty strings. */
export const resolveFirstContactId = (
  contactId?: Identifier | null,
): Identifier | undefined => {
  if (contactId == null) {
    return undefined;
  }

  const value = String(contactId).trim();
  if (value === "" || value === "undefined" || value === "null") {
    return undefined;
  }

  return contactId;
};
