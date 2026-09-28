import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import "@/index.css";
import { StoryWrapper } from "@/test/StoryWrapper";
import { DealAttentionStrip } from "./DealAttentionStrip";

const iso = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return d.toISOString().slice(0, 10);
};

describe("DealAttentionStrip (Pass A)", () => {
  it("names an overdue contact with days and date on one compact row", async () => {
    await render(
      <StoryWrapper>
        <DealAttentionStrip dateString={iso(-3)} responsible="Anna Admin" />
      </StoryWrapper>,
    );
    const strip = page.getByRole("status");
    await expect.element(strip).toBeVisible();
    await expect
      .element(strip)
      .toHaveTextContent(/Customer contact overdue|Kundenkontakt überfällig/);
    await expect.element(strip).toHaveTextContent(/3 days|3 Tagen/);
    await expect.element(strip).toHaveTextContent(/Anna Admin/);
    const rect = (
      document.querySelector(".nora-attention") as HTMLElement
    ).getBoundingClientRect();
    expect(rect.height).toBeLessThan(80);
  });

  it("uses the today wording for a contact due today", async () => {
    await render(
      <StoryWrapper>
        <DealAttentionStrip dateString={iso(0)} />
      </StoryWrapper>,
    );
    await expect
      .element(page.getByRole("status"))
      .toHaveTextContent(/Contact customer today|Heute Kunden kontaktieren/);
  });

  it("renders nothing for an upcoming date", async () => {
    await render(
      <StoryWrapper>
        <DealAttentionStrip dateString={iso(5)} />
      </StoryWrapper>,
    );
    expect(document.querySelector(".nora-attention")).toBeNull();
  });
});
