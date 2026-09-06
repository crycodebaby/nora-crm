import { render } from "vitest-browser-react";
import { StoryWrapper } from "@/test/StoryWrapper";
import { EmployeeAccessPanel } from "./EmployeeAccessPanel";
import type { EmployeeAccessRecord } from "./employeeAccessContract";

const record = (
  over: Partial<EmployeeAccessRecord> = {},
): EmployeeAccessRecord => ({
  employeeId: 7,
  email: "eva.e@ergart.de",
  accessState: "active",
  disabled: false,
  noraDisabled: false,
  accessConsistency: "consistent",
  identityConsistency: "consistent",
  invitedAt: "2026-09-01T08:00:00.000Z",
  activatedAt: "2026-09-02T09:00:00.000Z",
  ...over,
});

const renderPanel = (over: Partial<EmployeeAccessRecord>) =>
  render(
    <StoryWrapper
      dataProvider={
        {
          getEmployeeAccessStatus: async () => [record(over)],
          getEmployeeMailDeliveryStatus: async () => [],
        } as never
      }
    >
      <EmployeeAccessPanel salesId={7} />
    </StoryWrapper>,
  );

describe("EmployeeAccessPanel — Zugang beenden (W5)", () => {
  it("offers the distinct action for an active employee", async () => {
    const screen = await renderPanel({ accessState: "active" });
    await expect
      .element(screen.getByTestId("employee-offboarding-trigger"))
      .toHaveTextContent("Zugang beenden");
    await expect
      .element(screen.getByTestId("employee-offboarding"))
      .toHaveTextContent("Beendet den Nora-Zugang sofort.");
  });

  it("offers it for an invited employee too", async () => {
    const screen = await renderPanel({
      accessState: "invited",
      activatedAt: null,
    });
    await expect
      .element(screen.getByTestId("employee-offboarding-trigger"))
      .toBeVisible();
  });

  it.each(["disabled", "unknown"] as const)(
    "does not offer it for a %s employee",
    async (state) => {
      const screen = await renderPanel({
        accessState: state,
        disabled: state === "disabled",
        noraDisabled: state === "disabled",
      });
      await expect
        .element(screen.getByTestId("employee-access-state"))
        .toBeVisible();
      await expect
        .poll(
          () =>
            screen.container.querySelectorAll(
              "[data-testid='employee-offboarding-trigger']",
            ).length,
        )
        .toBe(0);
    },
  );

  it("names the open assignments with links after access ended, and asks for a new login on reactivation", async () => {
    const screen = await renderPanel({
      accessState: "disabled",
      disabled: true,
      noraDisabled: true,
      dependencies: {
        companies: 2,
        contacts: 0,
        openDeals: 1,
        openTasks: 4,
        contactNotes: 9,
        dealNotes: 0,
      },
    });
    const followUp = screen.getByTestId("employee-offboarding-followup-panel");
    await expect
      .element(followUp)
      .toHaveTextContent(
        "Es bestehen noch 2 Kunden, 1 Vorgang und 4 offene Aufgaben, die anschließend neu zugewiesen werden sollten.",
      );
    await expect.element(followUp).toHaveTextContent("Kunden anzeigen (2)");
    await expect.element(followUp).toHaveTextContent("Vorgänge anzeigen (1)");
    await expect.element(followUp).toHaveTextContent("Offene Aufgaben (4)");
    const kundenLink = followUp
      .element()
      .querySelector("a[href*='kunden']") as HTMLAnchorElement | null;
    expect(kundenLink?.getAttribute("href")).toContain(
      encodeURIComponent(JSON.stringify({ sales_id: 7 })),
    );
    await expect
      .element(screen.getByTestId("employee-access-panel"))
      .toHaveTextContent("Eine neue Anmeldung ist danach erforderlich.");
  });

  it("stays quiet about assignments when nothing is open", async () => {
    const screen = await renderPanel({
      accessState: "disabled",
      disabled: true,
      noraDisabled: true,
      dependencies: {
        companies: 0,
        contacts: 0,
        openDeals: 0,
        openTasks: 0,
        contactNotes: 3,
        dealNotes: 1,
      },
    });
    await expect
      .element(screen.getByTestId("employee-access-state"))
      .toHaveTextContent("Zugang deaktiviert");
    await expect
      .poll(
        () =>
          screen.container.querySelectorAll(
            "[data-testid='employee-offboarding-followup-panel']",
          ).length,
      )
      .toBe(0);
  });
});
