/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { defaultDealStages } from "./dealStageModel";
import {
  ensureCanonicalDealStages,
  findDealLabel,
  getDealStageColorToken,
  isDealTerminalStage,
  normalizeDealStageValue,
  resolveDealStageColumn,
} from "./dealStageModel";

describe("dealStageModel", () => {
  it("exposes seven canonical stages including Kein Status", () => {
    expect(defaultDealStages.map((s) => s.value)).toEqual([
      "none",
      "requested",
      "quote_sent",
      "ordered",
      "in_production",
      "on_site",
      "completed",
    ]);
  });

  it("normalizes null and empty to none", () => {
    expect(normalizeDealStageValue(null)).toBe("none");
    expect(normalizeDealStageValue("")).toBe("none");
    expect(normalizeDealStageValue("requested")).toBe("requested");
  });

  it("maps legacy stages into canonical columns", () => {
    expect(resolveDealStageColumn("neue-anfrage")).toBe("requested");
    expect(resolveDealStageColumn("angebot-gesendet")).toBe("quote_sent");
    expect(resolveDealStageColumn("nachfassen")).toBe("quote_sent");
    expect(resolveDealStageColumn("angenommen")).toBe("ordered");
    expect(resolveDealStageColumn("wartet-auf-hersteller")).toBe(
      "in_production",
    );
    expect(resolveDealStageColumn("abgeschlossen")).toBe("completed");
  });

  it("labels canonical and legacy values", () => {
    expect(findDealLabel(defaultDealStages, "requested")).toBe("Angefragt");
    expect(findDealLabel(defaultDealStages, null)).toBe("Kein Status");
    expect(findDealLabel(defaultDealStages, "abgelehnt")).toBe("Abgelehnt");
    expect(findDealLabel(defaultDealStages, "neue-anfrage")).toBe("Angefragt");
  });

  it("resolves color tokens without using complaint purple for deals", () => {
    expect(getDealStageColorToken("quote_sent")).toBe("quote_sent");
    expect(getDealStageColorToken("unknown-x")).toBe("legacy");
    expect(getDealStageColorToken("requested")).not.toBe("complaint");
  });

  it("treats completed and rejected as terminal", () => {
    expect(isDealTerminalStage("completed")).toBe(true);
    expect(isDealTerminalStage("abgelehnt")).toBe(true);
    expect(isDealTerminalStage("ordered")).toBe(false);
    expect(isDealTerminalStage("requested")).toBe(false);
  });

  it("replaces stale stored configs with canonical stages", () => {
    const ensured = ensureCanonicalDealStages([
      { value: "neue-anfrage", label: "Neue Anfrage" },
    ]);
    expect(ensured[0]?.value).toBe("none");
    expect(ensured.some((s) => s.value === "requested")).toBe(true);
  });
});
