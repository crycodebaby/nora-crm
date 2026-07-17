// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  isMeaningfulEventChange,
  mapGoogleEventToCacheRow,
  minimizeDescription,
} from "./mapGoogleEvent.ts";

describe("minimizeDescription", () => {
  it("strips html and returns null for empty", () => {
    expect(minimizeDescription("<p><br/></p>")).toBeNull();
    expect(minimizeDescription("<b>Treffen</b> morgen")).toBe("Treffen morgen");
  });
});

describe("mapGoogleEventToCacheRow", () => {
  it("maps timed events", () => {
    const mapped = mapGoogleEventToCacheRow(
      {
        id: "evt1",
        summary: "Besichtigung",
        start: { dateTime: "2026-07-15T10:00:00+02:00" },
        end: { dateTime: "2026-07-15T11:00:00+02:00" },
        status: "confirmed",
      },
      "2026-07-15T08:00:00.000Z",
    );
    expect(mapped?.is_all_day).toBe(false);
    expect(mapped?.starts_at).toContain("2026-07-15");
    expect(mapped?.start_date).toBeNull();
  });

  it("maps all-day events without timestamps", () => {
    const mapped = mapGoogleEventToCacheRow(
      {
        id: "evt2",
        summary: "Ganztag",
        start: { date: "2026-07-20" },
        end: { date: "2026-07-21" },
      },
      "2026-07-15T08:00:00.000Z",
    );
    expect(mapped?.is_all_day).toBe(true);
    expect(mapped?.starts_at).toBeNull();
    expect(mapped?.start_date).toBe("2026-07-20");
    expect(mapped?.end_date).toBe("2026-07-20");
  });

  it("marks cancelled events", () => {
    const mapped = mapGoogleEventToCacheRow(
      {
        id: "evt3",
        status: "cancelled",
        start: { dateTime: "2026-07-15T10:00:00+02:00" },
        end: { dateTime: "2026-07-15T11:00:00+02:00" },
      },
      "2026-07-15T08:00:00.000Z",
    );
    expect(mapped?.deleted_at).not.toBeNull();
  });
});

describe("isMeaningfulEventChange", () => {
  it("detects etag changes", () => {
    const base = mapGoogleEventToCacheRow(
      {
        id: "evt4",
        etag: '"1"',
        start: { dateTime: "2026-07-15T10:00:00+02:00" },
        end: { dateTime: "2026-07-15T11:00:00+02:00" },
      },
      "2026-07-15T08:00:00.000Z",
    )!;
    const changed = { ...base, google_etag: '"2"' };
    expect(
      isMeaningfulEventChange(
        {
          google_etag: base.google_etag,
          google_updated_at: base.google_updated_at,
          title_snapshot: base.title_snapshot,
          location_snapshot: base.location_snapshot,
          google_status: base.google_status,
          deleted_at: base.deleted_at,
        },
        changed,
      ),
    ).toBe(true);
  });
});
