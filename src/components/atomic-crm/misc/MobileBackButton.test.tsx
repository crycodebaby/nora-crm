import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { describe, expect, it } from "vitest";

import "@/index.css";
import { StoryWrapper } from "@/test/StoryWrapper";
import { MobileBackButton } from "./MobileBackButton";

describe("MobileBackButton (Alpha UI 1 hardening)", () => {
  it("offers a touch-sized hit area around the small chevron", async () => {
    await render(
      <StoryWrapper>
        <MobileBackButton to="/" />
      </StoryWrapper>,
    );
    const button = page.getByRole("button", { name: "Back" });
    await expect.element(button).toBeVisible();
    const rect = (
      document.querySelector('button[type="button"]') as HTMLElement
    ).getBoundingClientRect();
    expect(rect.width).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeGreaterThanOrEqual(44);
  });
});
