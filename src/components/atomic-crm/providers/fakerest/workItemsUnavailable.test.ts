import { describe, expect, it } from "vitest";

import { createDataProvider } from "./dataProvider";
import generateData from "./dataGenerator";
import {
  WorkQueryError,
  getWorkItems,
} from "../../application/queries/getWorkItems";

/**
 * Alpha Work 2 — the demo has no authoritative Work query (docs/nora/17
 * G.7). It must say so explicitly instead of answering from the raw task
 * fixtures or with an empty page.
 */
describe("FakeRest — Work read port", () => {
  it("refuses with `unavailable` even though the demo has tasks — no raw-task fallback, no fake empty page", async () => {
    const db = generateData();
    expect(db.tasks.length).toBeGreaterThan(0);
    const dataProvider = createDataProvider({ db, silent: true, latency: 0 });

    for (const scope of ["mine", "team"] as const) {
      const failure = await getWorkItems(dataProvider, { scope }).catch(
        (error: unknown) => error,
      );
      expect(failure).toBeInstanceOf(WorkQueryError);
      expect((failure as WorkQueryError).reason).toBe("unavailable");
    }
  });
});
