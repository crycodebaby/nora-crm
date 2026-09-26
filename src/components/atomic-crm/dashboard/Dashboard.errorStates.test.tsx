import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { StoryWrapper } from "@/test/StoryWrapper";
import { Dashboard } from "./Dashboard";
import { MobileDashboard } from "./MobileDashboard";

const success = (resource: string) => {
  if (resource === "contacts") return { data: [], total: 0 };
  if (resource === "contact_notes") return { data: [], total: 0 };
  if (resource === "deals") return { data: [], total: 0 };
  return { data: [], total: 0 };
};

describe("Startseite error semantics", () => {
  it("does not render a partial desktop aggregate when the deals query fails", async () => {
    let fail = true;
    const getList = vi.fn(async (resource: string) => {
      if (resource === "deals" && fail) throw new Error("query failed");
      return success(resource);
    });
    await render(
      <StoryWrapper dataProvider={{ getList: getList as never }}>
        <Dashboard />
      </StoryWrapper>,
    );
    const error = page
      .getByRole("alert")
      .filter({ hasText: "The data could not be loaded right now." });
    await expect.element(error).toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "What's next?" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Hotboard" }))
      .not.toBeInTheDocument();
    fail = false;
    await error.getByRole("button", { name: "Try again" }).click();
    await expect
      .element(page.getByRole("heading", { name: "What's next?" }))
      .toBeVisible();
  });

  it("does not turn a mobile note-query error into empty onboarding progress", async () => {
    const getList = vi.fn(async (resource: string) => {
      if (resource === "contact_notes") throw new Error("query failed");
      return success(resource);
    });
    await render(
      <StoryWrapper dataProvider={{ getList: getList as never }}>
        <MobileDashboard />
      </StoryWrapper>,
    );
    await expect
      .element(
        page
          .getByRole("alert")
          .filter({ hasText: "The data could not be loaded right now." }),
      )
      .toBeVisible();
    await expect
      .element(page.getByRole("heading", { name: "What's next?" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("heading", { name: "Hotboard" }))
      .not.toBeInTheDocument();
  });
});
