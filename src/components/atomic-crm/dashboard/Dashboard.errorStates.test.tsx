import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { StoryWrapper } from "@/test/StoryWrapper";
import { Dashboard } from "./Dashboard";
import { MobileDashboard } from "./MobileDashboard";
import { QuickCaptureProvider } from "../quickCapture/QuickCaptureContext";

const success = (resource: string) => {
  if (resource === "contacts") return { data: [], total: 1 };
  if (resource === "contact_notes") return { data: [], total: 1 };
  if (resource === "deals") return { data: [], total: 1 };
  return { data: [], total: 0 };
};

describe("Startseite error semantics", () => {
  it("keeps the desktop Hotboard when the deal count fails and retries that count", async () => {
    let fail = true;
    const getList = vi.fn(
      async (
        resource: string,
        params: { pagination?: { perPage: number } },
      ) => {
        if (resource === "deals" && params.pagination?.perPage === 1 && fail)
          throw new Error("query failed");
        return success(resource);
      },
    );
    await render(
      <StoryWrapper dataProvider={{ getList: getList as never }}>
        <QuickCaptureProvider>
          <Dashboard />
        </QuickCaptureProvider>
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
      .toBeVisible();
    const contactCalls = getList.mock.calls.filter(
      ([resource]) => resource === "contacts",
    ).length;
    const dealCountCalls = getList.mock.calls.filter(
      ([resource, params]) =>
        resource === "deals" && params.pagination?.perPage === 1,
    ).length;
    fail = false;
    await error.getByRole("button", { name: "Try again" }).click();
    await expect.element(error).not.toBeInTheDocument();
    expect(
      getList.mock.calls.filter(([resource]) => resource === "contacts"),
    ).toHaveLength(contactCalls);
    expect(
      getList.mock.calls.filter(
        ([resource, params]) =>
          resource === "deals" && params.pagination?.perPage === 1,
      ),
    ).toHaveLength(dealCountCalls + 1);
  });

  it("does not turn a mobile note-query error into empty onboarding progress", async () => {
    let fail = true;
    const getList = vi.fn(
      async (
        resource: string,
        params: { pagination?: { perPage: number } },
      ) => {
        if (
          resource === "contact_notes" &&
          params.pagination?.perPage === 1 &&
          fail
        )
          throw new Error("query failed");
        return success(resource);
      },
    );
    await render(
      <StoryWrapper dataProvider={{ getList: getList as never }}>
        <QuickCaptureProvider>
          <MobileDashboard />
        </QuickCaptureProvider>
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
      .toBeVisible();
    const contactCalls = getList.mock.calls.filter(
      ([resource]) => resource === "contacts",
    ).length;
    fail = false;
    await page
      .getByRole("alert")
      .getByRole("button", { name: "Try again" })
      .click();
    await expect.element(page.getByRole("alert")).not.toBeInTheDocument();
    expect(
      getList.mock.calls.filter(([resource]) => resource === "contacts"),
    ).toHaveLength(contactCalls);
  });
});
