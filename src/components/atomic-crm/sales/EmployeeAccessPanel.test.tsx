import { render } from "vitest-browser-react";
import { vi } from "vitest";
import { StoryWrapper } from "@/test/StoryWrapper";
import { EmployeeAccessPanel } from "./EmployeeAccessPanel";
import type { EmployeeAccessRecord } from "./employeeAccessContract";
import type { EmployeeMailDeliveryStatus } from "./emailDeliveryContract";

const record = (
  over: Partial<EmployeeAccessRecord> = {},
): EmployeeAccessRecord => ({
  employeeId: 7,
  email: "test.access@ergart.de",
  accessState: "invited",
  disabled: false,
  noraDisabled: false,
  accessConsistency: "consistent",
  invitedAt: "2026-09-01T08:00:00.000Z",
  activatedAt: null,
  ...over,
});

const renderPanelRecord = (
  recordOverrides: Partial<EmployeeAccessRecord>,
  overrides: Record<string, unknown> = {},
) =>
  render(
    <StoryWrapper
      dataProvider={
        {
          getEmployeeAccessStatus: async () => [record(recordOverrides)],
          ...overrides,
        } as never
      }
    >
      <EmployeeAccessPanel salesId={7} />
    </StoryWrapper>,
  );

const renderPanel = (
  state: EmployeeAccessRecord["accessState"],
  overrides: Record<string, unknown> = {},
) => renderPanelRecord({ accessState: state }, overrides);

describe("EmployeeAccessPanel access consistency (W1)", () => {
  it("does not mention synchronization while both access facts agree", async () => {
    const screen = await renderPanel("disabled");
    await expect
      .element(screen.getByTestId("employee-access-state"))
      .toHaveTextContent("Zugang deaktiviert");
    await expect
      .poll(
        () =>
          screen.container.textContent?.includes(
            "Zugangsstatus synchronisieren",
          ) ?? false,
      )
      .toBe(false);
  });

  it("names the mismatch and offers exactly one repair when Nora disabled but Auth did not", async () => {
    const salesUpdate = vi.fn(async () => ({ id: 7, disabled: true }));
    const screen = await renderPanelRecord(
      {
        accessState: "disabled",
        disabled: true,
        noraDisabled: true,
        accessConsistency: "inconsistent",
      },
      { salesUpdate },
    );

    await expect
      .element(screen.getByTestId("employee-access-consistency"))
      .toHaveTextContent("nicht vollständig synchron");
    await expect
      .element(screen.getByTestId("employee-access-consistency"))
      .toHaveTextContent("„Zugang deaktiviert“ erneut vollständig an");

    await screen
      .getByRole("button", { name: "Zugangsstatus synchronisieren" })
      .click();

    // The repair re-applies Nora's own value — the disabled flag, nothing else.
    await expect.poll(() => salesUpdate.mock.calls.length).toBe(1);
    expect(salesUpdate).toHaveBeenCalledWith(7, { disabled: true });
  });

  it("offers the repair in the other direction too (Nora enabled, Auth banned)", async () => {
    const salesUpdate = vi.fn(async () => ({ id: 7, disabled: false }));
    const screen = await renderPanelRecord(
      {
        accessState: "disabled",
        disabled: true,
        noraDisabled: false,
        accessConsistency: "inconsistent",
      },
      { salesUpdate },
    );
    await expect
      .element(screen.getByTestId("employee-access-consistency"))
      .toHaveTextContent("„Zugang aktiv“ erneut vollständig an");
    await screen
      .getByRole("button", { name: "Zugangsstatus synchronisieren" })
      .click();
    await expect.poll(() => salesUpdate.mock.calls.length).toBe(1);
    expect(salesUpdate).toHaveBeenCalledWith(7, { disabled: false });
  });

  it("keeps quiet when the Auth side is merely unknown", async () => {
    const screen = await renderPanelRecord({
      accessState: "unknown",
      accessConsistency: "unknown",
    });
    await expect.element(screen.getByText("Zugang unklar")).toBeVisible();
    await expect
      .poll(
        () =>
          screen.container.textContent?.includes(
            "Zugangsstatus synchronisieren",
          ) ?? false,
      )
      .toBe(false);
  });
});

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

const deliveryRow = (
  over: Partial<EmployeeMailDeliveryStatus> = {},
): EmployeeMailDeliveryStatus => ({
  employeeId: 7,
  mailKind: "employee_invite",
  outcome: "delivered",
  lastEventAt: "2026-09-04T15:09:37.000Z",
  eventCount: 2,
  ...over,
});

const renderWithDelivery = (
  rows: EmployeeMailDeliveryStatus[] | (() => Promise<never>),
  state: EmployeeAccessRecord["accessState"] = "invited",
) =>
  renderPanel(state, {
    getEmployeeMailDeliveryStatus:
      typeof rows === "function" ? rows : async () => rows,
  });

describe("EmployeeAccessPanel delivery status", () => {
  it("dates a delivered mail under an impersonal heading", async () => {
    const screen = await renderWithDelivery([deliveryRow()]);
    await expect
      .element(screen.getByTestId("employee-mail-delivery-line"))
      .toHaveTextContent("Zugestellt am 04.09.2026 um 17:09");
    await expect
      .element(screen.getByTestId("employee-mail-delivery"))
      .toHaveTextContent("Letzte E-Mail-Zustellung");
  });

  it("keeps the access state as the primary information", async () => {
    const screen = await renderWithDelivery([deliveryRow()], "active");
    // The access pill still carries the state; delivery never replaces it.
    await expect
      .element(screen.getByTestId("employee-access-state"))
      .toHaveTextContent("Zugang aktiv");
    await expect
      .element(screen.getByTestId("employee-mail-delivery"))
      .toBeVisible();
  });

  it("says only that an accepted mail was sent", async () => {
    const screen = await renderWithDelivery([
      deliveryRow({ outcome: "accepted" }),
    ]);
    await expect
      .element(screen.getByTestId("employee-mail-delivery-line"))
      .toHaveTextContent("E-Mail versendet");
  });

  it("reports a delayed delivery", async () => {
    const screen = await renderWithDelivery([
      deliveryRow({ outcome: "delayed" }),
    ]);
    await expect
      .element(screen.getByTestId("employee-mail-delivery-line"))
      .toHaveTextContent("Zustellung verzögert");
  });

  it("asks the administrator to check the address when undeliverable", async () => {
    const screen = await renderWithDelivery([
      deliveryRow({ outcome: "undeliverable" }),
    ]);
    await expect
      .element(screen.getByTestId("employee-mail-delivery"))
      .toHaveTextContent("E-Mail konnte nicht zugestellt werden");
    await expect
      .element(screen.getByTestId("employee-mail-delivery"))
      .toHaveTextContent("E-Mail-Adresse prüfen");
  });

  it("states a spam report calmly", async () => {
    const screen = await renderWithDelivery([
      deliveryRow({ outcome: "spam_reported" }),
    ]);
    await expect
      .element(screen.getByTestId("employee-mail-delivery"))
      .toHaveTextContent("Als Spam markiert");
    await expect
      .element(screen.getByTestId("employee-mail-delivery"))
      .toHaveTextContent("Keine automatische erneute Zustellung");
  });

  it("renders an unknown mail kind exactly like a known one", async () => {
    const screen = await renderWithDelivery([
      deliveryRow({ mailKind: "unknown" }),
    ]);
    await expect
      .element(screen.getByTestId("employee-mail-delivery-line"))
      .toHaveTextContent("Zugestellt am 04.09.2026 um 17:09");
    // The mail is never named — best-effort correlation cannot support it.
    for (const claim of ["Einladung wurde", "Passwort-E-Mail"]) {
      await expect
        .poll(() => screen.container.textContent?.includes(claim) ?? false)
        .toBe(false);
    }
  });

  it("shows no delivery block at all when there is no history", async () => {
    const screen = await renderWithDelivery([]);
    await expect
      .element(screen.getByTestId("employee-access-panel"))
      .toBeVisible();
    await expect
      .poll(
        () =>
          screen.container.textContent?.includes("Letzte E-Mail-Zustellung") ??
          false,
      )
      .toBe(false);
  });

  it("stays silent when the admin-only read model refuses the caller", async () => {
    const screen = await renderWithDelivery(async () => {
      throw new Error("forbidden");
    });
    await expect
      .element(screen.getByTestId("employee-access-panel"))
      .toBeVisible();
    await expect
      .poll(
        () =>
          screen.container.textContent?.includes("Letzte E-Mail-Zustellung") ??
          false,
      )
      .toBe(false);
  });

  it("never renders opening, reading or click wording", async () => {
    const screen = await renderWithDelivery([deliveryRow()]);
    await expect
      .element(screen.getByTestId("employee-mail-delivery"))
      .toBeVisible();
    const text = screen.container.textContent?.toLowerCase() ?? "";
    for (const forbidden of ["geöffnet", "gelesen", "geklickt", "klick"]) {
      expect(text).not.toContain(forbidden);
    }
  });
});
