import { ListBase, ResourceContextProvider } from "ra-core";
import { render } from "vitest-browser-react";

import { buildContact, StoryWrapper } from "@/test/StoryWrapper";
import { ContactListFilter } from "./ContactListFilter";

const mockIsMobile = vi.hoisted(() => vi.fn(() => false));
vi.mock("@/hooks/use-mobile", () => ({ useIsMobile: mockIsMobile }));

/**
 * Sidebar Markierungen filter (Markierungen Identity Wave, 2026-09-07).
 *
 * Before: `perPage: 10` sorted by name, so the five duplicate rows from the
 * Production incident could crowd a real Markierung out of the sidebar, and a
 * filter applied to a Markierung past that window rendered no chip at all.
 */
const makeTags = (count: number, prefix = "Markierung") =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    name: `${prefix} ${String(index + 1).padStart(2, "0")}`,
    color: "#99c1de",
  }));

const renderFilter = async (
  tags: { id: number; name: string; color: string }[],
  initialFilter?: Record<string, unknown>,
) => {
  const screen = await render(
    <StoryWrapper
      data={{ contacts: [buildContact({ id: 1, tags: [] })], tags }}
    >
      <ResourceContextProvider value="contacts">
        <ListBase perPage={25} filterDefaultValues={initialFilter}>
          <ContactListFilter />
        </ListBase>
      </ResourceContextProvider>
    </StoryWrapper>,
  );
  return { screen };
};

describe("ContactListFilter — Markierungen", () => {
  beforeEach(() => mockIsMobile.mockReturnValue(false));

  it("shows a small vocabulary in full with no 'show more' affordance", async () => {
    const { screen } = await renderFilter(makeTags(3));

    await expect.element(screen.getByText("Markierung 01")).toBeVisible();
    await expect.element(screen.getByText("Markierung 03")).toBeVisible();
    expect(
      screen.container.ownerDocument.body.textContent?.includes("Show "),
    ).toBe(false);
  });

  it("keeps the sidebar compact when there are many Markierungen, and expands on demand", async () => {
    const { screen } = await renderFilter(makeTags(14));

    // Compact set only.
    await expect.element(screen.getByText("Markierung 08")).toBeVisible();
    expect(
      screen.container.ownerDocument.body.textContent?.includes(
        "Markierung 14",
      ),
    ).toBe(false);

    await screen.getByRole("button", { name: /Show 6 more/ }).click();
    await expect.element(screen.getByText("Markierung 14")).toBeVisible();

    await screen.getByRole("button", { name: "Show less" }).click();
    await expect
      .poll(() =>
        screen.container.ownerDocument.body.textContent?.includes(
          "Markierung 14",
        ),
      )
      .toBe(false);
  });

  it("ALWAYS renders the applied Markierung, even when it sorts past the compact set", async () => {
    // Markierung 14 is well past the cut-off but is the active filter.
    const { screen } = await renderFilter(makeTags(14), {
      "tags@cs": "{14}",
    });

    await expect.element(screen.getByText("Markierung 14")).toBeVisible();
  });

  it("a historical duplicate fixture no longer crowds a real Markierung out", async () => {
    // The pre-migration Production shape: duplicates sort first by name and
    // would have consumed the old 10-row window.
    const historical = [
      { id: 1, name: "Kunde AE", color: "#99c1de" },
      { id: 2, name: "Erfunden", color: "#f0efeb" },
      { id: 3, name: "Privatperson", color: "#99c1de" },
      { id: 4, name: "Privatperson", color: "#99c1de" },
      { id: 5, name: "Privatperson", color: "#99c1de" },
      { id: 6, name: "Privatperso", color: "#99c1de" },
      { id: 7, name: "Privatperso", color: "#99c1de" },
      { id: 8, name: "Wartungsvertrag", color: "#eddcd2" },
      { id: 9, name: "Zahlung offen", color: "#fad2e1" },
    ];
    const { screen } = await renderFilter(historical);

    // Everything up to the compact limit is visible…
    await expect.element(screen.getByText("Kunde AE")).toBeVisible();
    // …and the two that used to fall off the end are one click away.
    await screen.getByRole("button", { name: /Show 1 more/ }).click();
    await expect.element(screen.getByText("Zahlung offen")).toBeVisible();
  });
});
