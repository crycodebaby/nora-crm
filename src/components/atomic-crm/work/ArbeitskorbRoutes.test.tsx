/**
 * `/arbeitskorb` is registered in both Admin trees (docs/nora/26 §4) and
 * reaches the surface through the configured provider's Work port — the
 * real CRM root, lazily loaded page, real `getWorkItems`.
 */
import { page } from "vitest/browser";
import { render } from "vitest-browser-react";

import { StoryWrapper } from "@/test/StoryWrapper";
import type {
  WorkItemsPage,
  WorkItemsRequest,
} from "../application/queries/getWorkItems";
import { buildWorkItem } from "./testing/workTestKit";

const renderAt = async (entry: string) => {
  const requests: WorkItemsRequest[] = [];
  const getWorkItems = async (
    request: WorkItemsRequest,
  ): Promise<WorkItemsPage> => {
    requests.push(request);
    return {
      items: [buildWorkItem({ title: `Routen-Aufgabe ${request.scope}` })],
      scope: request.scope,
      stateScope: request.stateScope,
      pageSize: request.pageSize ?? 50,
      nextCursor: null,
    };
  };
  await render(
    <StoryWrapper
      initialEntries={[entry]}
      dataProvider={{ getWorkItems } as never}
    >
      <p>Startseite</p>
    </StoryWrapper>,
  );
  return { requests };
};

const pageText = () => document.body.textContent ?? "";

describe.each([
  ["desktop", 1280, 800],
  ["mobile", 390, 844],
] as const)("Arbeitskorb route (%s Admin)", (surface, width, height) => {
  beforeAll(async () => {
    await page.viewport(width, height);
  });

  it("renders the surface on /arbeitskorb with the URL view", async () => {
    const { requests } = await renderAt("/arbeitskorb?sicht=team");
    await expect
      .poll(() => pageText(), { timeout: 10_000 })
      .toContain("Routen-Aufgabe team");
    expect(pageText()).not.toContain("Startseite");
    expect(
      [...document.querySelectorAll("h1")].filter(
        (h1) => h1.textContent === "Work basket",
      ),
    ).toHaveLength(1);
    // Mobile rows open the read-only sheet; desktop rows are not controls.
    expect(
      document.querySelectorAll(
        'li[data-work-id] button[aria-haspopup="dialog"]',
      ).length,
    ).toBe(surface === "mobile" ? 1 : 0);
    expect(requests).toEqual([
      { scope: "team", stateScope: "open", pageSize: 50, cursor: null },
    ]);
  });

  it("defaults to Meine Arbeit without a view parameter", async () => {
    const { requests } = await renderAt("/arbeitskorb");
    await expect
      .poll(() => pageText(), { timeout: 10_000 })
      .toContain("Routen-Aufgabe mine");
    expect(requests[0]).toEqual({
      scope: "mine",
      stateScope: "open",
      pageSize: 50,
      cursor: null,
    });
  });
});
