import type { CSSProperties } from "react";
import type { DealStage } from "../types";
import type {
  DealStageDefinition,
  NoraDealStageColorToken,
  NoraDealStageValue,
} from "./dealStageTypes";
import {
  DEAL_STAGE_DEFAULT,
  DEAL_STAGE_NONE,
  NORA_DEAL_STAGE_VALUES,
} from "./dealStageTypes";

export const CANONICAL_DEAL_STAGE_DEFINITIONS: DealStageDefinition[] = [
  { value: "none", label: "Kein Status", colorToken: "none" },
  { value: "requested", label: "Angefragt", colorToken: "requested" },
  { value: "quote_sent", label: "Angebot gesendet", colorToken: "quote_sent" },
  { value: "ordered", label: "Beauftragt", colorToken: "ordered" },
  {
    value: "in_production",
    label: "Bestellt / In Produktion",
    colorToken: "in_production",
  },
  { value: "on_site", label: "Baustelle in Arbeit", colorToken: "on_site" },
  { value: "completed", label: "Abgeschlossen", colorToken: "completed" },
];

/** Config choices for selectors / Kanban (includes Kein Status). */
export const defaultDealStages: DealStage[] =
  CANONICAL_DEAL_STAGE_DEFINITIONS.map((stage) => ({
    value: stage.value,
    label: stage.label,
    colorToken: stage.colorToken,
  }));

export const defaultDealPipelineStatuses: string[] = ["completed"];

const CANONICAL_SET = new Set<string>(NORA_DEAL_STAGE_VALUES);

/**
 * Map historical / Atomic / early-Nora stage IDs onto canonical columns.
 * Unmapped values stay displayable as legacy but bucket to `none` only when empty.
 */
export const LEGACY_DEAL_STAGE_TO_CANONICAL: Record<
  string,
  NoraDealStageValue
> = {
  // empty / unset
  none: "none",
  // early / Atomic → requested
  opportunity: "requested",
  anfrage: "requested",
  "neue-anfrage": "requested",
  kontaktiert: "requested",
  "termin-vereinbart": "requested",
  requested: "requested",
  // quote
  "proposal-sent": "quote_sent",
  angebot: "quote_sent",
  "angebot-gesendet": "quote_sent",
  nachfassen: "quote_sent",
  quote_sent: "quote_sent",
  // ordered
  won: "ordered",
  angenommen: "ordered",
  beauftragt: "ordered",
  ordered: "ordered",
  // in production
  "in-arbeit": "in_production",
  "in-kalkulation": "in_production",
  "aufmass-geplant": "in_production",
  "aufmass-erledigt": "in_production",
  "wartet-auf-hersteller": "in_production",
  "in-negotiation": "in_production",
  "in-negociation": "in_production",
  delayed: "in_production",
  in_production: "in_production",
  // on site
  on_site: "on_site",
  // completed
  abgeschlossen: "completed",
  completed: "completed",
  // rejected — still terminal; shown as legacy until product decides otherwise
  lost: "completed",
  abgelehnt: "completed",
};

/** Visible German labels for legacy IDs that are not in defaultDealStages. */
export const LEGACY_ATOMIC_DEAL_STAGE_LABELS: Record<string, string> = {
  opportunity: "Neue Anfrage",
  "proposal-sent": "Angebot gesendet",
  "in-negotiation": "In Klärung",
  "in-negociation": "In Klärung",
  won: "Angenommen",
  lost: "Abgelehnt",
  delayed: "Verzögert",
  anfrage: "Neue Anfrage",
  angebot: "Angebot gesendet",
  beauftragt: "Angenommen",
  "in-arbeit": "In Kalkulation",
  abgeschlossen: "Abgeschlossen",
  abgelehnt: "Abgelehnt",
  "neue-anfrage": "Neue Anfrage",
  kontaktiert: "Kontaktiert",
  "termin-vereinbart": "Termin vereinbart",
  "aufmass-geplant": "Aufmaß geplant",
  "aufmass-erledigt": "Aufmaß erledigt",
  "in-kalkulation": "In Kalkulation",
  "wartet-auf-hersteller": "Wartet auf Hersteller",
  "angebot-gesendet": "Angebot gesendet",
  nachfassen: "Rückmeldung ausstehend",
  angenommen: "Angenommen",
};

const LEGACY_ENGLISH_DEAL_STAGE_LABELS: Record<string, string> = {
  Opportunity: "Neue Anfrage",
  "Proposal Sent": "Angebot gesendet",
  "In Negotiation": "In Klärung",
  "In Negociation": "In Klärung",
  Won: "Angenommen",
  Lost: "Abgelehnt",
  Delayed: "Verzögert",
};

const TERMINAL_DEAL_STAGES = new Set([
  "completed",
  "abgeschlossen",
  "abgelehnt",
  "lost",
]);

export function isCanonicalDealStage(
  value: string | null | undefined,
): value is NoraDealStageValue {
  return value != null && CANONICAL_SET.has(value);
}

/** Normalize DB/UI empties to canonical `none`. */
export function normalizeDealStageValue(
  stage: string | null | undefined,
): string {
  if (stage == null || stage === "") {
    return DEAL_STAGE_NONE;
  }
  return stage;
}

/**
 * Column / filter bucket for a stored stage.
 * Prefers explicit legacy→canonical map; unknown non-empty stays as-is for orphan columns.
 */
export function resolveDealStageColumn(
  stage: string | null | undefined,
): string {
  const normalized = normalizeDealStageValue(stage);
  if (isCanonicalDealStage(normalized)) {
    return normalized;
  }
  return LEGACY_DEAL_STAGE_TO_CANONICAL[normalized] ?? normalized;
}

export function isDealTerminalStage(stage: string | null | undefined): boolean {
  if (stage == null || stage === "") return false;
  return TERMINAL_DEAL_STAGES.has(stage);
}

export function findDealLabel(
  dealStages: DealStage[],
  dealValue: string | null | undefined,
): string {
  const normalized = normalizeDealStageValue(dealValue);
  if (normalized === DEAL_STAGE_NONE) {
    const noneFromConfig = dealStages.find((s) => s.value === DEAL_STAGE_NONE);
    return noneFromConfig?.label ?? "Kein Status";
  }

  if (LEGACY_ATOMIC_DEAL_STAGE_LABELS[normalized]) {
    // Prefer canonical label when mapped, else legacy wording
    const canonical = LEGACY_DEAL_STAGE_TO_CANONICAL[normalized];
    if (canonical && isCanonicalDealStage(canonical)) {
      const canonicalDef = CANONICAL_DEAL_STAGE_DEFINITIONS.find(
        (s) => s.value === canonical,
      );
      // Keep distinct legacy wording when it differs meaningfully (e.g. Abgelehnt)
      if (
        normalized === "abgelehnt" ||
        normalized === "lost" ||
        normalized === "angenommen" ||
        normalized === "won"
      ) {
        return LEGACY_ATOMIC_DEAL_STAGE_LABELS[normalized];
      }
      return (
        dealStages.find((s) => s.value === canonical)?.label ??
        canonicalDef?.label ??
        LEGACY_ATOMIC_DEAL_STAGE_LABELS[normalized]
      );
    }
    return LEGACY_ATOMIC_DEAL_STAGE_LABELS[normalized];
  }

  const dealStage = dealStages.find((stage) => stage.value === normalized);
  if (!dealStage?.label) {
    return normalized;
  }

  return LEGACY_ENGLISH_DEAL_STAGE_LABELS[dealStage.label] ?? dealStage.label;
}

export function getDealStageColorToken(
  stage: string | null | undefined,
): NoraDealStageColorToken {
  const column = resolveDealStageColumn(stage);
  if (isCanonicalDealStage(column)) {
    return column;
  }
  return "legacy";
}

export function getDealStageCssVars(
  stage: string | null | undefined,
): CSSProperties {
  const token = getDealStageColorToken(stage);
  return {
    ["--nora-deal-stage-color" as string]: `var(--nora-deal-stage-${token})`,
    ["--nora-deal-stage-soft" as string]: `var(--nora-deal-stage-${token}-soft)`,
  } as CSSProperties;
}

/** Apply German labels; ensure all canonical stages exist (ignore stale stored config). */
export function localizeDealStages(dealStages: DealStage[]): DealStage[] {
  const byValue = new Map(dealStages.map((s) => [s.value, s]));
  return CANONICAL_DEAL_STAGE_DEFINITIONS.map((def) => {
    const stored = byValue.get(def.value);
    return {
      value: def.value,
      label: stored?.label
        ? (LEGACY_ENGLISH_DEAL_STAGE_LABELS[stored.label] ?? stored.label)
        : def.label,
      colorToken: def.colorToken,
    };
  });
}

export function ensureCanonicalDealStages(
  dealStages: DealStage[] | undefined,
): DealStage[] {
  if (!dealStages?.length) {
    return defaultDealStages;
  }
  const hasCanonical = dealStages.some((s) => isCanonicalDealStage(s.value));
  if (!hasCanonical) {
    return defaultDealStages;
  }
  return localizeDealStages(dealStages);
}

export function getDealStageFilterOptions(
  dealStages: DealStage[] = defaultDealStages,
): DealStage[] {
  return dealStages;
}

export { DEAL_STAGE_DEFAULT, DEAL_STAGE_NONE };
