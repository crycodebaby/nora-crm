/**
 * Effective Contact Context — the single Nora domain rule answering "which
 * people belong to this customer record, and who is the preferred one to
 * show/preselect". Framework-free (no React, no Supabase) so it can be
 * unit-tested in isolation and reused identically by CompanyShow, the
 * Aufgabe contact picker, and Quick Capture Schritt 2 — no per-screen
 * ad-hoc reimplementation (Self Contact Wave, 2026-08-26).
 *
 * Mirrors the server-side authority nora_private.is_effective_contact_of_company():
 * a contact belongs to a company if contact.company_id = company.id OR
 * company.self_contact_id = contact.id.
 *
 * Three distinct roles are deliberately not conflated:
 * - selfContact: the person representing this customer record
 *   (company.self_contact_id), independent of contact.company_id.
 * - explicitPrimaryContact: a contact with is_primary=true AND
 *   contact.company_id = company.id. A contact's is_primary flag is only
 *   meaningful for the company it actually belongs to — a primary flag on a
 *   contact whose company_id points elsewhere must never be read as
 *   "primary here".
 * - preferredContact: the single best default for display/preselection —
 *   explicitPrimaryContact if present, otherwise selfContact.
 */

export type CustomerContactContextCompany = {
  id: unknown;
  self_contact_id?: unknown;
};

export type CustomerContactContextContact = {
  id: unknown;
  company_id?: unknown;
  is_primary?: boolean;
};

export type EffectiveContactContext<
  TContact extends CustomerContactContextContact,
> = {
  /** Every contact belonging to this customer record — company_id match OR self_contact_id, deduplicated. */
  members: TContact[];
  /** The contact with is_primary=true whose company_id actually matches this company — never a self-contact-only match. */
  explicitPrimaryContact: TContact | null;
  /** The company's self_contact_id, resolved against the loaded contact set — null if not loaded/found. */
  selfContact: TContact | null;
  /** explicitPrimaryContact if present, otherwise selfContact — the single best default for preselection/display. */
  preferredContact: TContact | null;
};

const sameId = (a: unknown, b: unknown): boolean =>
  a != null && b != null && String(a) === String(b);

/**
 * Resolves the Effective Contact Context from an already-loaded set of
 * contacts. Callers MUST ensure the self_contact_id contact is included in
 * `contacts` even if its company_id points elsewhere (see Acceptance Check
 * "Effective Contact Context auch wirklich laden") — this function does no
 * fetching of its own.
 */
export const resolveCustomerContacts = <
  TContact extends CustomerContactContextContact,
>(
  company: CustomerContactContextCompany | null | undefined,
  contacts: TContact[],
): EffectiveContactContext<TContact> => {
  if (!company) {
    return {
      members: [],
      explicitPrimaryContact: null,
      selfContact: null,
      preferredContact: null,
    };
  }

  const membersById = new Map<string, TContact>();
  for (const contact of contacts) {
    if (sameId(contact.company_id, company.id)) {
      membersById.set(String(contact.id), contact);
    }
  }

  const selfContact =
    company.self_contact_id != null
      ? (contacts.find((c) => sameId(c.id, company.self_contact_id)) ?? null)
      : null;
  if (selfContact) {
    membersById.set(String(selfContact.id), selfContact);
  }

  const explicitPrimaryContact =
    contacts.find(
      (c) => c.is_primary === true && sameId(c.company_id, company.id),
    ) ?? null;

  return {
    members: [...membersById.values()],
    explicitPrimaryContact,
    selfContact,
    preferredContact: explicitPrimaryContact ?? selfContact,
  };
};

/** True if `contact` belongs to `company`'s effective contact context (company_id match OR self_contact_id match). */
export const isEffectiveContactOfCompany = (
  contact: CustomerContactContextContact | null | undefined,
  company: CustomerContactContextCompany | null | undefined,
): boolean => {
  if (!contact || !company) return false;
  return (
    sameId(contact.company_id, company.id) ||
    sameId(contact.id, company.self_contact_id)
  );
};
