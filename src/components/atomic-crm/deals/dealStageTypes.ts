/**
 * Canonical Nora deal stages (Vorgangsstatus).
 * Not contact/note temperature — process progress on a deal only.
 */

export const NORA_DEAL_STAGE_VALUES = [
  "none",
  "requested",
  "quote_sent",
  "ordered",
  "in_production",
  "on_site",
  "completed",
] as const;

export type NoraDealStageValue = (typeof NORA_DEAL_STAGE_VALUES)[number];

/** CSS custom-property suffix under --nora-deal-stage-* */
export type NoraDealStageColorToken =
  | "none"
  | "requested"
  | "quote_sent"
  | "ordered"
  | "in_production"
  | "on_site"
  | "completed"
  | "legacy"
  /** Reserved exclusively for future complaintStatuses — do not use for deals. */
  | "complaint";

export type DealStageDefinition = {
  value: NoraDealStageValue;
  label: string;
  colorToken: Exclude<NoraDealStageColorToken, "complaint" | "legacy">;
};

export const DEAL_STAGE_NONE: NoraDealStageValue = "none";
export const DEAL_STAGE_DEFAULT: NoraDealStageValue = "requested";
