/**
 * Shared type-choices for email_jsonb / phone_jsonb entries — used by both
 * companies (Kunde) and contacts (Ansprechpartner). Values are stored as-is
 * in the DB (existing "Work"/"Home"/"Other" rows stay valid); "Mobile",
 * "Central", "Direct" are additive (Customer & Contact Workflow Wave).
 */

export const CONTACT_METHOD_TYPES = [
  "Work",
  "Mobile",
  "Central",
  "Direct",
  "Home",
  "Other",
] as const;

export type ContactMethodType = (typeof CONTACT_METHOD_TYPES)[number];

type TranslateFn = (key: string, options?: { [key: string]: any }) => string;

const contactMethodTypeMap: Record<string, string> = {
  Work: "work",
  Mobile: "mobile",
  Central: "central",
  Direct: "direct",
  Home: "home",
  Other: "other",
};

export const translateContactMethodTypeLabel = (
  type: string,
  translate: TranslateFn,
) =>
  translate(
    `resources.contacts.inputs.personal_info_types.${contactMethodTypeMap[type] ?? type.toLowerCase()}`,
    { _: type },
  );

export const getContactMethodTypeChoices = (translate: TranslateFn) =>
  CONTACT_METHOD_TYPES.map((type) => ({
    id: type,
    name: translateContactMethodTypeLabel(type, translate),
  }));

/** Default type for a company's first phone entry — a company's main line is "Zentrale". */
export const DEFAULT_COMPANY_PHONE_TYPE: ContactMethodType = "Central";
export const DEFAULT_COMPANY_EMAIL_TYPE: ContactMethodType = "Work";
export const DEFAULT_CONTACT_PHONE_TYPE: ContactMethodType = "Mobile";
export const DEFAULT_CONTACT_EMAIL_TYPE: ContactMethodType = "Work";
