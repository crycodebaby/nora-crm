import { render } from "vitest-browser-react";
import { vi } from "vitest";
import { StoryWrapper } from "@/test/StoryWrapper";
import { EmployeeAccessPanel } from "./EmployeeAccessPanel";
import type { EmployeeAccessRecord } from "./employeeAccessContract";

const record = (
  over: Partial<EmployeeAccessRecord> = {},
): EmployeeAccessRecord => ({
  employeeId: 7,
  email: "test.access@ergart.de",
  accessState: "invited",
  disabled: false,
  invitedAt: "2026-09-01T08:00:00.000Z",
  activatedAt: null,
  ...over,
});

const renderPanel = (
  state: EmployeeAccessRecord["accessState"],
  overrides: Record<string, unknown> = {},
) =>
  render(
    <StoryWrapper
      dataProvider={
        {
          getEmployeeAccessStatus: async () => [record({ accessState: state })],
          ...overrides,
        } as never
      }
    >
      <EmployeeAccessPanel salesId={7} />
    </StoryWrapper>,
  );

describe("EmployeeAccessPanel action gating", () => {
  it("offers only a fresh invitation while the employee has not activated", async () => {
    const screen = await renderPanel("invited");
    await expect
      .element(screen.getByRole("button", { name: "Einladung erneut senden" }))
      .toBeVisible();
    await expect
      .poll(
        () =>
          screen.container.textContent?.includes(
            "Passwort einrichten lassen",
          ) ?? false,
      )
      .toBe(false);
  });

  it("offers only password setup for an active employee", async () => {
    const screen = await renderPanel("active");
    await expect
      .element(
        screen.getByRole("button", { name: "Passwort einrichten lassen" }),
      )
      .toBeVisible();
    await expect
      .poll(
        () =>
          screen.container.textContent?.includes("Einladung erneut senden") ??
          false,
      )
      .toBe(false);
  });

  it("offers no mail action at all for a disabled employee", async () => {
    const screen = await renderPanel("disabled");
    // The wording appears twice: as the status badge and inside the hint that
    // points at the existing "Zugang deaktiviert" checkbox in the edit form.
    await expect
      .element(screen.getByTestId("employee-access-state"))
      .toHaveTextContent("Zugang deaktiviert");
    for (const label of [
      "Einladung erneut senden",
      "Passwort einrichten lassen",
    ]) {
      await expect
        .poll(() => screen.container.textContent?.includes(label) ?? false)
        .toBe(false);
    }
  });

  it("offers no action for an unresolvable identity", async () => {
    const screen = await renderPanel("unknown");
    await expect.element(screen.getByText("Zugang unklar")).toBeVisible();
    for (const label of [
      "Einladung erneut senden",
      "Passwort einrichten lassen",
    ]) {
      await expect
        .poll(() => screen.container.textContent?.includes(label) ?? false)
        .toBe(false);
    }
  });

  it("disables the action while a send is in flight, so rapid clicks cannot resend", async () => {
    let resolveSend: (v: EmployeeAccessRecord) => void = () => {};
    const send = vi.fn(
      () => new Promise<EmployeeAccessRecord>((r) => (resolveSend = r)),
    );

    const screen = await renderPanel("invited", {
      resendEmployeeInvitation: send,
    });

    const button = screen.getByRole("button", {
      name: "Einladung erneut senden",
    });
    await button.click();

    await expect.element(button).toBeDisabled();

    // Extra clicks while pending must not reach the server.
    await button.click({ force: true });
    await button.click({ force: true });
    expect(send).toHaveBeenCalledTimes(1);

    resolveSend(record());
  });
});
