import { commands } from "vitest/browser";

import {
  formatISODateString,
  findDealLabel,
  sumDealAmounts,
} from "./dealUtils";
import { getVisibleDealStages, type DealsByStage } from "./stages";

describe("findDealLabel", () => {
  const noraStages = [
    { value: "neue-anfrage", label: "Neue Anfrage" },
    { value: "anfrage", label: "Anfrage" },
    { value: "abgeschlossen", label: "Abgeschlossen" },
  ];

  it("maps legacy Atomic stage values to German labels", () => {
    expect(findDealLabel(noraStages, "opportunity")).toBe("Neue Anfrage");
    expect(findDealLabel(noraStages, "proposal-sent")).toBe("Angebot gesendet");
    expect(findDealLabel(noraStages, "won")).toBe("Angenommen");
    expect(findDealLabel(noraStages, "lost")).toBe("Abgelehnt");
    expect(findDealLabel(noraStages, "delayed")).toBe("Verzögert");
  });

  it("keeps Nora-specific stage labels", () => {
    expect(findDealLabel(noraStages, "neue-anfrage")).toBe("Neue Anfrage");
    expect(findDealLabel(noraStages, "anfrage")).toBe("Neue Anfrage");
    expect(findDealLabel(noraStages, "abgeschlossen")).toBe("Abgeschlossen");
  });

  it("translates legacy English labels still stored in configuration", () => {
    const legacyStages = [{ value: "opportunity", label: "Opportunity" }];
    expect(findDealLabel(legacyStages, "opportunity")).toBe("Neue Anfrage");
  });
});

describe("sumDealAmounts", () => {
  it("sums only positive amounts", () => {
    expect(
      sumDealAmounts([
        { amount: 1000 },
        { amount: 0 },
        { amount: null },
        { amount: 250 },
      ]),
    ).toBe(1250);
  });
});

describe("getVisibleDealStages", () => {
  const stages = [
    { value: "a", label: "A" },
    { value: "b", label: "B" },
    { value: "c", label: "C" },
  ];

  it("hides empty stages by default", () => {
    const byStage = {
      a: [{ id: 1 }],
      b: [],
      c: [{ id: 2 }],
    } as unknown as DealsByStage;
    expect(
      getVisibleDealStages(stages, byStage, false).map((s) => s.value),
    ).toEqual(["a", "c"]);
  });

  it("shows all stages when requested", () => {
    const byStage = {
      a: [{ id: 1 }],
      b: [],
      c: [],
    } as unknown as DealsByStage;
    expect(getVisibleDealStages(stages, byStage, true)).toHaveLength(3);
  });
});

describe("formatISODateString", () => {
  let originalTimezone: string;

  beforeEach(() => {
    originalTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  });

  afterEach(async () => {
    await commands.setTimezone(originalTimezone);
  });

  it("formats a valid ISO date string correctly", () => {
    const isoDate = "2024-06-15";
    const formattedDate = formatISODateString(isoDate);
    expect(formattedDate).toBe("15. Juni 2024");
  });

  it("should not shift the date regardless of timezone", async () => {
    // Uses CDP (Emulation.setTimezoneOverride) to actually change the browser's
    // timezone at runtime so we can catch regressions where someone replaces the
    // manual date-component parse with new Date(isoString), which would shift
    // dates in negative-offset timezones like America/New_York.
    const isoDate = "2024-06-15";
    await commands.setTimezone("America/New_York");
    expect(formatISODateString(isoDate)).toBe("15. Juni 2024");

    await commands.setTimezone("Asia/Tokyo");
    expect(formatISODateString(isoDate)).toBe("15. Juni 2024");

    await commands.setTimezone("UTC");
    expect(formatISODateString(isoDate)).toBe("15. Juni 2024");

    await commands.setTimezone("Pacific/Auckland");
    expect(formatISODateString(isoDate)).toBe("15. Juni 2024");
  });

  it("throw for an invalid date string", () => {
    const invalidDate = "invalid-date";
    expect(() => formatISODateString(invalidDate)).toThrow(
      "Invalid date format. Expected YYYY-MM-DD.",
    );
  });

  it("throw for a date string with wrong format", () => {
    const invalidDate = "15-06-2024";
    expect(() => formatISODateString(invalidDate)).toThrow(
      "Invalid date format. Expected YYYY-MM-DD.",
    );
  });
});
