/**
 * Shared "Links"-Modell für companies.links_jsonb / contacts.links_jsonb.
 * Ersetzt die frühere LinkedIn-only-Validierung durch generische, mehrfache
 * Links mit Typ (Website, LinkedIn, Instagram, Facebook, Google, Portal,
 * Sonstiges). Genutzt von CompanyInputs und ContactInputs — eine Quelle für
 * Choices, Default-Werte und Validierung (Customer & Contact Workflow Wave).
 */
import type { LinkAndType, LinkType } from "../types";

export const LINK_TYPES: LinkType[] = [
  "website",
  "linkedin",
  "instagram",
  "facebook",
  "google",
  "portal",
  "other",
];

export const DEFAULT_LINK_TYPE: LinkType = "website";

type TranslateFn = (key: string, options?: { [key: string]: any }) => string;

const linkTypeDefaultLabels: Record<LinkType, string> = {
  website: "Website",
  linkedin: "LinkedIn",
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  portal: "Portal",
  other: "Sonstiges",
};

export const translateLinkTypeLabel = (
  type: LinkType,
  translate: TranslateFn,
) =>
  translate(`resources.companies.inputs.link_types.${type}`, {
    _: linkTypeDefaultLabels[type] ?? type,
  });

export const getLinkTypeChoices = (translate: TranslateFn) =>
  LINK_TYPES.map((type) => ({
    id: type,
    name: translateLinkTypeLabel(type, translate),
  }));

/** Generic (non-LinkedIn-only) URL validator for the links array and any single URL field. */
export const isValidUrl = (url: string) => {
  if (!url) return undefined;
  const invalid = {
    message: "crm.validation.invalid_url",
    args: { _: "Must be a valid URL" },
  };
  if (/\s/.test(url)) return invalid;
  try {
    const parsed = new URL(url.includes("://") ? url : `https://${url}`);
    if (!parsed.hostname.includes(".") && parsed.hostname !== "localhost") {
      return invalid;
    }
    return undefined;
  } catch {
    return invalid;
  }
};

export const defaultLinksJsonb: LinkAndType[] = [];

/** Drops empty rows (no url) before submit — mirrors contactModel's array cleanup. */
export const cleanLinksJsonb = (
  links: LinkAndType[] | null | undefined,
): LinkAndType[] => (links ?? []).filter((l) => l && l.url);

/** Normalizes a bare URL (adds https:// if missing a scheme) — used on submit, not on every keystroke. */
export const normalizeUrl = (url: string): string =>
  url && !url.startsWith("http") ? `https://${url}` : url;
