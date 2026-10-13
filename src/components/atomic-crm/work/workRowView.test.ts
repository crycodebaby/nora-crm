import type { WorkItem } from "../application/queries/getWorkItems";
import { buildIncompleteWorkItem, buildWorkItem } from "./testing/workTestKit";
import {
  presentationGroups,
  summarizeWork,
  toWorkRowView,
  workGroupKey,
  workHolderPresentation,
} from "./workRowView";

/** Rows whose flags deliberately contradict what `dueAt` "looks like". */
const flagged = (
  overdue: boolean,
  dueToday: boolean,
  dueAt: string | null,
  extra: Partial<WorkItem> = {},
) =>
  buildWorkItem({
    dueAt,
    ...extra,
    derived: {
      actionable: true,
      overdue,
      dueToday,
      isMine: true,
      isUnassigned: false,
    },
  });

describe("workGroupKey (AC-04 U) — flags only, never the clock", () => {
  it("follows the server flags against contradictory dates", () => {
    expect(workGroupKey(flagged(true, false, "2999-01-01T00:00:00Z"))).toBe(
      "overdue",
    );
    expect(workGroupKey(flagged(false, false, "2001-01-01T00:00:00Z"))).toBe(
      "upcoming",
    );
    expect(workGroupKey(flagged(false, true, "2999-01-01T00:00:00Z"))).toBe(
      "today",
    );
    expect(workGroupKey(flagged(false, false, null))).toBe("none");
    // overdue wins over dueToday (AC-33 precedence).
    expect(workGroupKey(flagged(true, true, null))).toBe("overdue");
  });

  it("is unchanged under a faked browser clock", () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(3000, 0, 1) });
    try {
      expect(workGroupKey(flagged(false, false, "2001-01-01T00:00:00Z"))).toBe(
        "upcoming",
      );
      expect(workGroupKey(flagged(true, false, "2999-01-01T00:00:00Z"))).toBe(
        "overdue",
      );
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("presentationGroups (AC-03 U) — the grouping invariant", () => {
  const flatten = (items: WorkItem[]) =>
    presentationGroups(
      items.map((item) => toWorkRowView(item, "mine")),
    ).flatMap((group) => group.rows.map((row) => row.workId));

  it("reproduces the exact server sequence, repeating headings instead of reordering", () => {
    const page1 = [
      flagged(true, false, null),
      flagged(false, false, "2026-10-20T00:00:00Z"),
    ];
    // Page 2 starts with overdue again: a non-contiguous key across the page boundary.
    const page2 = [
      flagged(true, false, null),
      flagged(false, false, null),
      buildIncompleteWorkItem(),
      flagged(false, false, "2026-10-21T00:00:00Z"),
    ];
    const sequence = [...page1, ...page2];
    expect(flatten(sequence)).toEqual(sequence.map((item) => item.workId));
    const keys = presentationGroups(
      sequence.map((item) => toWorkRowView(item, "mine")),
    ).map((group) => group.key);
    expect(keys).toEqual([
      "overdue",
      "upcoming",
      "overdue",
      "none",
      "upcoming",
    ]);
  });

  it("holds for generated sequences (no row moves, disappears or duplicates)", () => {
    const keys = [
      [true, false, null],
      [false, true, "2026-10-13T00:00:00Z"],
      [false, false, null],
      [false, false, "2026-11-01T00:00:00Z"],
    ] as const;
    for (let seed = 1; seed <= 50; seed++) {
      const length = (seed * 7) % 23;
      const sequence = Array.from({ length }, (_, index) => {
        const [overdue, today, dueAt] = keys[(seed * 31 + index * 17) % 4];
        return flagged(overdue, today, dueAt);
      });
      expect(flatten(sequence)).toEqual(sequence.map((item) => item.workId));
    }
    expect(presentationGroups([])).toEqual([]);
  });
});

describe("toWorkRowView", () => {
  it("keeps an incomplete row with a null title and never mutates the DTO", () => {
    const item = buildIncompleteWorkItem();
    const before = structuredClone(item);
    const view = toWorkRowView(item, "team");
    expect(view.title).toBeNull();
    expect(view.incomplete).toBe(true);
    expect(item).toEqual(before);
    expect(Object.isFrozen(item)).toBe(false);
  });

  it("marks overdue+dueToday as overdue plus 'heute fällig' (AC-33)", () => {
    const view = toWorkRowView(flagged(true, true, null), "mine");
    expect(view.group).toBe("overdue");
    expect(view.alsoDueToday).toBe(true);
  });

  it("keeps context identity verbatim, including id 0", () => {
    const view = toWorkRowView(
      buildWorkItem({ context: { customerId: 0, contactId: null } }),
      "mine",
    );
    expect(view.customerId).toBe(0);
    expect(view.contactId).toBeNull();
  });
});

describe("workHolderPresentation (AC-31 U) — flags only", () => {
  const holder = (
    derived: Partial<WorkItem["derived"]>,
    value: WorkItem["holder"],
  ) =>
    workHolderPresentation(
      buildWorkItem({
        holder: value,
        derived: {
          actionable: true,
          overdue: false,
          dueToday: false,
          isMine: false,
          isUnassigned: false,
          ...derived,
        },
      }),
    );

  it("never infers 'Ich' from the holder id, and follows isMine against a foreign id", () => {
    // salesId equal to the viewer's own id (7) but isMine=false → no "Ich".
    expect(
      holder({ isMine: false }, { salesId: 7, displayName: "Nora" }),
    ).toEqual({ kind: "named", name: "Nora" });
    expect(
      holder({ isMine: true }, { salesId: 999, displayName: "X" }),
    ).toEqual({
      kind: "me",
    });
  });

  it("follows isUnassigned, and never reads holder === null as unassigned", () => {
    expect(
      holder({ isUnassigned: true }, { salesId: 3, displayName: "Y" }),
    ).toEqual({ kind: "unassigned" });
    expect(holder({}, null)).toEqual({ kind: "unknown" });
    expect(holder({}, { salesId: 3, displayName: null })).toEqual({
      kind: "unnamed",
    });
  });

  it("shows no holder in the mine view", () => {
    expect(toWorkRowView(buildWorkItem(), "mine").holder).toBeNull();
    expect(toWorkRowView(buildWorkItem(), "team").holder).not.toBeNull();
  });
});

describe("summarizeWork (AC-32 U) — counts from flags", () => {
  it("counts overdue, today (not overdue) and the total over a complete set", () => {
    const items = [
      flagged(true, false, "2999-01-01T00:00:00Z"),
      flagged(true, true, null),
      flagged(false, true, "2001-01-01T00:00:00Z"),
      flagged(false, false, "2001-01-01T00:00:00Z"),
    ];
    expect(summarizeWork(items, true)).toEqual({
      complete: true,
      total: 4,
      overdue: 2,
      today: 1,
    });
  });

  it("never gives a total over an incomplete set", () => {
    expect(summarizeWork([buildWorkItem()], false)).toEqual({
      complete: false,
      loaded: 1,
    });
  });
});
