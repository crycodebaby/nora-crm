import { render } from "vitest-browser-react";
import { vi } from "vitest";
import { StoryWrapper } from "@/test/StoryWrapper";
import { ChangeEmployeeEmailDialog } from "./ChangeEmployeeEmailDialog";
import type {
  EmployeeAccessRecord,
  EmployeeEmailChangeResult,
} from "./employeeAccessContract";

const record = (
  over: Partial<EmployeeAccessRecord> = {},
): EmployeeAccessRecord => ({
  employeeId: 7,
  email: "alt.adresse@ergart.de",
  accessState: "active",
  disabled: false,
  noraDisabled: false,
  accessConsistency: "consistent",
  identityConsistency: "consistent",
  invitedAt: "2026-09-01T08:00:00.000Z",
  activatedAt: "2026-09-02T09:00:00.000Z",
  ...over,
});

const success = (
  rec: EmployeeAccessRecord,
  invitationSent = false,
): EmployeeEmailChangeResult => ({
  record: { ...rec, email: "neu.adresse@ergart.de" },
  previousEmail: rec.email,
  invitationSent,
});

const renderDialog = async (
  rec: EmployeeAccessRecord,
  changeEmployeeLoginEmail: (...args: unknown[]) => Promise<unknown>,
  onChanged = vi.fn(),
) => ({
  onChanged,
  screen: await render(
    <StoryWrapper dataProvider={{ changeEmployeeLoginEmail } as never}>
      <ChangeEmployeeEmailDialog
        salesId={7}
        record={rec}
        onChanged={onChanged}
      />
    </StoryWrapper>,
  ),
});

describe("ChangeEmployeeEmailDialog (W4)", () => {
  it("names the current address and the consequence for a disabled employee", async () => {
    const { screen } = await renderDialog(
      record({ accessState: "disabled", disabled: true, noraDisabled: true }),
      vi.fn(async () => success(record())),
    );
    await screen.getByTestId("employee-email-change-trigger").click();

    await expect
      .element(screen.getByTestId("employee-email-change-current"))
      .toHaveTextContent("alt.adresse@ergart.de");
    await expect
      .element(screen.getByTestId("employee-email-change-consequence"))
      .toHaveTextContent(
        "Der Nora-Zugang bleibt deaktiviert. Es wird keine Einladung versendet.",
      );
  });

  it("names the invitation consequence for an invited employee", async () => {
    const { screen } = await renderDialog(
      record({ accessState: "invited", activatedAt: null }),
      vi.fn(async () => success(record())),
    );
    await screen.getByTestId("employee-email-change-trigger").click();
    await expect
      .element(screen.getByTestId("employee-email-change-consequence"))
      .toHaveTextContent("Die bisherige Einladung wird ungültig.");
  });

  it("does not submit while the address equals the current one (case/space-insensitive)", async () => {
    const change = vi.fn(async () => success(record()));
    const { screen } = await renderDialog(record(), change);
    await screen.getByTestId("employee-email-change-trigger").click();

    await screen
      .getByLabelText("Neue Anmeldeadresse")
      .fill("  ALT.Adresse@Ergart.de ");
    await expect
      .element(screen.getByTestId("employee-email-change-submit"))
      .toBeDisabled();
    await expect
      .element(
        screen.getByText(
          "Die neue Adresse entspricht der aktuellen Anmeldeadresse.",
        ),
      )
      .toBeInTheDocument();
    expect(change).not.toHaveBeenCalled();
  });

  it("submits the trimmed address through the command, reports success only afterwards and refreshes", async () => {
    const change = vi.fn(async () => success(record()));
    const { screen, onChanged } = await renderDialog(record(), change);
    await screen.getByTestId("employee-email-change-trigger").click();

    await screen
      .getByLabelText("Neue Anmeldeadresse")
      .fill("  Neu.Adresse@ergart.de ");
    await screen.getByTestId("employee-email-change-submit").click();

    await expect.poll(() => change.mock.calls.length).toBe(1);
    // The mock is declared without parameters; read the recorded call as the
    // command input it actually received.
    const firstCall = change.mock.calls[0] as unknown as
      | [{ salesId: number; newEmail: string; operationId?: string }]
      | undefined;
    expect(firstCall?.[0]).toMatchObject({
      salesId: 7,
      newEmail: "Neu.Adresse@ergart.de",
    });
    // The operation id minted by the Operation Manager travels with the call.
    expect(firstCall?.[0]?.operationId).toMatch(/^[0-9a-f-]{36}$/);
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
    await expect
      .poll(() =>
        document.body.textContent?.includes(
          "Anmeldeadresse geändert auf neu.adresse@ergart.de.",
        ),
      )
      .toBe(true);
  });

  it("shows the typed German explanation when the address belongs to someone else", async () => {
    const change = vi.fn(async () => {
      throw new Error("email_already_in_use");
    });
    const { screen } = await renderDialog(record(), change);
    await screen.getByTestId("employee-email-change-trigger").click();
    await screen
      .getByLabelText("Neue Anmeldeadresse")
      .fill("vergeben@ergart.de");
    await screen.getByTestId("employee-email-change-submit").click();

    await expect
      .element(screen.getByTestId("employee-email-change-error"))
      .toHaveTextContent(
        "Diese E-Mail-Adresse gehört bereits zu einem anderen Benutzer.",
      );
    // The dialog stays open so the administrator can correct the address.
    await expect
      .element(screen.getByTestId("employee-email-change-current"))
      .toBeInTheDocument();
  });

  it("explains a moved-but-uninvited employee instead of claiming success", async () => {
    const change = vi.fn(async () => {
      throw new Error("email_change_invitation_failed");
    });
    const { screen, onChanged } = await renderDialog(
      record({ accessState: "invited", activatedAt: null }),
      change,
    );
    await screen.getByTestId("employee-email-change-trigger").click();
    await screen.getByLabelText("Neue Anmeldeadresse").fill("neu@ergart.de");
    await screen.getByTestId("employee-email-change-submit").click();

    await expect
      .element(screen.getByTestId("employee-email-change-error"))
      .toHaveTextContent("Einladung erneut senden");
    await expect.poll(() => onChanged.mock.calls.length).toBe(1);
  });
});
