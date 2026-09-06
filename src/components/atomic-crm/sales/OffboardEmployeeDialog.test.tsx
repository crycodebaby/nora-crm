import { render } from "vitest-browser-react";
import { vi } from "vitest";
import { StoryWrapper } from "@/test/StoryWrapper";
import { OffboardEmployeeDialog } from "./OffboardEmployeeDialog";
import {
  EMPTY_DEPENDENCY_PREVIEW,
  type EmployeeAccessRecord,
  type EmployeeOffboardingResult,
} from "./employeeAccessContract";

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
  dependencies: {
    companies: 1,
    contacts: 0,
    openDeals: 3,
    openTasks: 5,
    contactNotes: 12,
    dealNotes: 2,
  },
  ...over,
});

const success = (rec: EmployeeAccessRecord): EmployeeOffboardingResult => ({
  record: {
    ...rec,
    accessState: "disabled",
    disabled: true,
    noraDisabled: true,
  },
  disposition: "executed",
  sessionsRevoked: 2,
  dependencies: rec.dependencies ?? EMPTY_DEPENDENCY_PREVIEW,
});

const renderDialog = async (
  rec: EmployeeAccessRecord,
  offboardEmployee: (...args: unknown[]) => Promise<unknown>,
  onChanged = vi.fn(),
) => ({
  onChanged,
  screen: await render(
    <StoryWrapper dataProvider={{ offboardEmployee } as never}>
      <OffboardEmployeeDialog salesId={7} record={rec} onChanged={onChanged} />
    </StoryWrapper>,
  ),
});

describe("OffboardEmployeeDialog (W5)", () => {
  it("shows the dependency preview and the follow-up before confirmation", async () => {
    const { screen } = await renderDialog(
      record(),
      vi.fn(async () => success(record())),
    );
    await screen.getByTestId("employee-offboarding-trigger").click();

    await expect
      .element(screen.getByTestId("employee-offboarding-email"))
      .toHaveTextContent("eva.e@ergart.de");
    await expect
      .element(screen.getByTestId("employee-offboarding-dependencies"))
      .toHaveTextContent("Kunden1");
    await expect
      .element(screen.getByTestId("employee-offboarding-dependencies"))
      .toHaveTextContent("Notizen (bleiben erhalten)14");
    await expect
      .element(screen.getByTestId("employee-offboarding-followup"))
      .toHaveTextContent(
        "Es bestehen noch 1 Kunde, 3 Vorgänge und 5 offene Aufgaben, die anschließend neu zugewiesen werden sollten. Der Zugang wird trotzdem sofort beendet.",
      );
    await expect
      .element(screen.getByTestId("employee-offboarding-form"))
      .toHaveTextContent("Es wird keine E-Mail versendet.");
    // No technical vocabulary anywhere in the dialog.
    const text = screen
      .getByTestId("employee-offboarding-form")
      .element().textContent;
    expect(text).not.toMatch(/jwt|token|gotrue|session/i);
  });

  it("submits through the command and reports success only from the server result", async () => {
    const offboardEmployee = vi.fn(async () => success(record()));
    const { screen, onChanged } = await renderDialog(
      record(),
      offboardEmployee,
    );
    await screen.getByTestId("employee-offboarding-trigger").click();
    await screen.getByTestId("employee-offboarding-submit").click();

    await expect.poll(() => offboardEmployee).toHaveBeenCalledTimes(1);
    const call = offboardEmployee.mock.calls[0] as unknown[];
    expect((call[0] as { salesId: number }).salesId).toBe(7);
    await expect.poll(() => onChanged).toHaveBeenCalledTimes(1);
    await expect
      .poll(
        () =>
          document.body.textContent?.includes(
            "Der Nora-Zugang wurde beendet. Es bestehen noch 1 Kunde, 3 Vorgänge und 5 offene Aufgaben",
          ) ?? false,
      )
      .toBe(true);
  });

  it("shows a calm error and keeps the dialog open when the server refuses", async () => {
    const { screen, onChanged } = await renderDialog(
      record(),
      vi.fn(async () => {
        throw new Error("last_active_admin_required");
      }),
    );
    await screen.getByTestId("employee-offboarding-trigger").click();
    await screen.getByTestId("employee-offboarding-submit").click();

    await expect
      .element(screen.getByTestId("employee-offboarding-error"))
      .toHaveTextContent(
        "Mindestens ein aktiver Administrator muss erhalten bleiben.",
      );
    await expect.poll(() => onChanged).toHaveBeenCalledTimes(1);
  });

  it("still offers the action when the preview could not be loaded", async () => {
    const { screen } = await renderDialog(
      record({ dependencies: undefined }),
      vi.fn(async () => success(record())),
    );
    await screen.getByTestId("employee-offboarding-trigger").click();
    await expect
      .element(screen.getByTestId("employee-offboarding-form"))
      .toHaveTextContent("Die Zuweisungen konnten nicht geladen werden.");
    await expect
      .element(screen.getByTestId("employee-offboarding-submit"))
      .toBeEnabled();
  });
});
