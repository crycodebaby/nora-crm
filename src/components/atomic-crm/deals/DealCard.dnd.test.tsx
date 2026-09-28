import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { beforeEach, describe, expect, it } from "vitest";

import "@/index.css";
import { StoryWrapper, buildCompany } from "@/test/StoryWrapper";
import type { Deal } from "../types";

const baseDeal = (overrides: Partial<Deal>): Deal => ({
  id: 1,
  name: "Vorgang",
  case_number: "VG-2026-000001",
  company_id: 1,
  contact_ids: [],
  category: "fensterservice",
  stage: "neue-anfrage",
  description: "",
  amount: 100,
  created_at: "2026-09-01T08:00:00.000Z",
  updated_at: "2026-09-01T08:00:00.000Z",
  expected_closing_date: "2099-09-30",
  sales_id: 0,
  index: 0,
  ...overrides,
});

const MOVING = baseDeal({
  id: 7,
  name: "Balkontür schließt nicht",
  case_number: "VG-2026-000007",
  site_street: "Westring 14",
  site_city: "Ratingen",
  site_floor: "2. OG",
  site_tenant_name: "Mieter Schmidt",
  description: "Sehr lange Beschreibung ".repeat(40),
});
const STAYING = baseDeal({ id: 8, name: "Griff defekt", index: 1 });
const OTHER = baseDeal({
  id: 9,
  name: "Aufmaß vorbereiten",
  stage: "kontaktiert",
});

const handle = (id: number) =>
  document.querySelector(
    `[data-rfd-drag-handle-draggable-id="${id}"]`,
  ) as HTMLElement | null;

const columnOf = (id: number) =>
  handle(id)
    ?.closest("[data-rfd-droppable-id]")
    ?.getAttribute("data-rfd-droppable-id") ?? null;

describe("Deal Kanban card (Alpha UI 1)", () => {
  beforeEach(async () => {
    await page.viewport(1280, 900);
    await render(
      <StoryWrapper
        initialEntries={["/vorgaenge"]}
        data={{
          companies: [buildCompany({ id: 1, name: "Familie Weber" })],
          deals: [MOVING, STAYING, OTHER],
        }}
      >
        <div />
      </StoryWrapper>,
    );
    await expect
      .element(page.getByText("Balkontür schließt nicht").first())
      .toBeVisible();
  });

  it("keeps the card to what a board decision needs", async () => {
    const card = handle(7)!;
    expect(card).not.toBeNull();
    expect(card.textContent).toContain("VG-2026-000007");
    await expect.poll(() => card.textContent ?? "").toContain("Familie Weber");
    expect(card.textContent).toContain("Westring 14 · Ratingen");
    // secondary site details and the long description stay off the card
    expect(card.textContent).not.toContain("2. OG");
    expect(card.textContent).not.toContain("Mieter Schmidt");
    expect(card.textContent).not.toContain("Sehr lange Beschreibung");
    // the site line is a single truncating line
    const site = card.querySelector(
      ".nora-deal-card-site > span",
    ) as HTMLElement;
    expect(site).not.toBeNull();
    expect(getComputedStyle(site).whiteSpace).toBe("nowrap");
    expect(getComputedStyle(site).overflow).toBe("hidden");
  });

  it("keeps horizontal scrolling inside the board, never on the document", async () => {
    const scroll = document.querySelector(".nora-kanban-scroll") as HTMLElement;
    expect(scroll).not.toBeNull();
    // containing block for absolutely positioned descendants (sr-only spans)
    expect(getComputedStyle(scroll).position).toBe("relative");
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(
      window.innerWidth + 1,
    );
    expect(scroll.scrollWidth).toBeGreaterThanOrEqual(scroll.clientWidth);
  });

  it("still moves a card to another status via keyboard drag and drop", async () => {
    expect(columnOf(7)).toBe("neue-anfrage");

    handle(7)!.focus();
    await userEvent.keyboard(" ");
    await new Promise((r) => setTimeout(r, 150));
    await userEvent.keyboard("{ArrowRight}");
    await new Promise((r) => setTimeout(r, 150));
    await userEvent.keyboard(" ");

    await expect.poll(() => columnOf(7), { timeout: 5000 }).toBe("kontaktiert");
    // the neighbour did not move
    expect(columnOf(8)).toBe("neue-anfrage");
  });
});
