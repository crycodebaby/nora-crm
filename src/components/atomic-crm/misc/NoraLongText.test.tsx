import { page, userEvent } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import "@/index.css";
import { StoryWrapper } from "@/test/StoryWrapper";
import { NoraLongText } from "./NoraLongText";

const LONG = Array.from(
  { length: 40 },
  (_, i) => `Zeile ${i + 1}: Mieter meldet Zugluft am Küchenfenster.`,
).join("\n");

const toggle = () =>
  page.getByRole("button", { name: /Show full text|Ganzen Text/ });

describe("NoraLongText (Alpha UI 1)", () => {
  it("collapses long text with a real disclosure control and keeps newlines", async () => {
    await render(
      <StoryWrapper>
        <div style={{ width: 640 }}>
          <NoraLongText text={LONG} collapsedHeight={200} />
        </div>
      </StoryWrapper>,
    );
    await expect.element(toggle()).toBeVisible();
    await expect.element(toggle()).toHaveAttribute("aria-expanded", "false");

    const body = document.querySelector(".nora-longtext") as HTMLElement;
    expect(body.getAttribute("data-collapsed")).toBe("true");
    expect(body.getBoundingClientRect().height).toBeLessThanOrEqual(210);
    expect(getComputedStyle(body).whiteSpace).toBe("pre-line");
    // a readable measure is set (68ch), never the full container width
    expect(getComputedStyle(body).maxWidth).not.toBe("none");
    expect(body.getBoundingClientRect().width).toBeLessThanOrEqual(640);

    // the disclosure control meets the Nora touch minimum
    const toggleEl = document.querySelector(
      ".nora-longtext-toggle",
    ) as HTMLElement;
    expect(toggleEl.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

    await userEvent.click(toggle());
    await expect
      .element(page.getByRole("button", { name: /Show less|Weniger/ }))
      .toHaveAttribute("aria-expanded", "true");
    expect(body.getAttribute("data-collapsed")).toBe("false");
    expect(body.getBoundingClientRect().height).toBeGreaterThan(400);
  });

  it("shows short text in full without any control", async () => {
    await render(
      <StoryWrapper>
        <NoraLongText text={"Kurz.\nZwei Zeilen."} />
      </StoryWrapper>,
    );
    await expect.element(page.getByText(/Kurz\./)).toBeVisible();
    await expect.element(toggle()).not.toBeInTheDocument();
    expect(
      document.querySelector(".nora-longtext")?.getAttribute("data-collapsed"),
    ).toBe("false");
  });
});
