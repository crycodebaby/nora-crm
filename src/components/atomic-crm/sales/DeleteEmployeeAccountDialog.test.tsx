import { render } from "vitest-browser-react";
import { vi } from "vitest";
import { StoryWrapper } from "@/test/StoryWrapper";
import { DeleteEmployeeAccountDialog } from "./DeleteEmployeeAccountDialog";
import type {
  EmployeeAccessRecord,
  EmployeeAccountDeletionResult,
  EmployeeDeletionPreview,
} from "./employeeAccessContract";

const record = (
  over: Partial<EmployeeAccessRecord> = {},
): EmployeeAccessRecord => ({
  employeeId: 7,
  email: "fritz.fake@example.test",
  accessState: "disabled",
  disabled: true,
  noraDisabled: true,
  accessConsistency: "consistent",
  identityConsistency: "consistent",
  invitedAt: "2026-09-01T08:00:00.000Z",
  activatedAt: null,
  ...over,
});

const preview = (
  over: Partial<EmployeeDeletionPreview> = {},
): EmployeeDeletionPreview => ({
  supported: true,
  eligible: true,
  reasons: [],
  role: "office",
  businessHistory: {
    companies: 0,
    contacts: 0,
    deals: 0,
    tasks: 0,
    contactNotes: 0,
    dealNotes: 0,
  },
  provenance: {
    checklistTemplates: 0,
    savedTextSnippets: 0,
    googleCalendarConnections: 0,
    auditEventsAsActor: 0,
  },
  technical: {
    auditEventsAsTarget: 4,
    emailDeliveryEventsAttributable: 0,
    emailDeliveryEventsForeign: 0,
  },
  ...over,
});

const executed: EmployeeAccountDeletionResult = {
  employeeId: 7,
  disposition: "executed",
};

const renderDialog = async (
  opts: {
    deletion?: EmployeeDeletionPreview;
    deleteEmployeeAccount?: (...args: unknown[]) => Promise<unknown>;
  } = {},
) => {
  const deleteEmployeeAccount =
    opts.deleteEmployeeAccount ?? vi.fn(async () => executed);
  const onDeleted = vi.fn<(result: EmployeeAccountDeletionResult) => void>();
  const onRefused = vi.fn<() => void>();
  const screen = await render(
    <StoryWrapper dataProvider={{ deleteEmployeeAccount } as never}>
      <DeleteEmployeeAccountDialog
        salesId={7}
        record={record()}
        deletion={opts.deletion ?? preview()}
        employeeName="Fritz Fake"
        onDeleted={onDeleted}
        onRefused={onRefused}
      />
    </StoryWrapper>,
  );
  return { screen, deleteEmployeeAccount, onDeleted, onRefused };
};

describe("DeleteEmployeeAccountDialog (W6-B)", () => {
  it("names the employee prominently and shows email, role, state and the six all-time counts", async () => {
    const { screen } = await renderDialog();
    await screen.getByTestId("employee-account-deletion-trigger").click();

    await expect
      .element(screen.getByTestId("employee-account-deletion-name"))
      .toHaveTextContent("Fritz Fake");
    await expect
      .element(screen.getByTestId("employee-account-deletion-email"))
      .toHaveTextContent("fritz.fake@example.test");
    await expect
      .element(screen.getByTestId("employee-account-deletion-role"))
      .toHaveTextContent("Büro");
    await expect
      .element(screen.getByTestId("employee-account-deletion-form"))
      .toHaveTextContent("Zugang deaktiviert");
    const counts = screen.getByTestId("employee-account-deletion-history");
    await expect.element(counts).toHaveTextContent("Kunden0");
    await expect
      .element(counts)
      .toHaveTextContent("Vorgänge (auch archivierte)0");
    await expect
      .element(counts)
      .toHaveTextContent("Aufgaben (auch erledigte)0");
    await expect.element(counts).toHaveTextContent("Vorgangsnotizen0");
    await expect
      .element(screen.getByTestId("employee-account-deletion-consequence"))
      .toHaveTextContent(
        "Das Nora-Benutzerkonto und die Anmeldeidentität werden endgültig gelöscht.",
      );
    const text = screen
      .getByTestId("employee-account-deletion-form")
      .element().textContent;
    expect(text).not.toMatch(/jwt|token|gotrue|session|auth\.users|ticket/i);
    expect(text).not.toMatch(/alle personenbezogenen daten/i);
  });

  it("keeps the destructive button disabled until the full name is typed exactly", async () => {
    const { screen, deleteEmployeeAccount } = await renderDialog();
    await screen.getByTestId("employee-account-deletion-trigger").click();
    const submit = screen.getByTestId("employee-account-deletion-submit");
    await expect.element(submit).toBeDisabled();

    const input = screen.getByTestId("employee-account-deletion-confirmation");
    await input.fill("Fritz Fak");
    await expect.element(submit).toBeDisabled();
    await input.fill("fritz fake");
    await expect.element(submit).toBeDisabled();
    await input.fill("  Fritz   Fake ");
    await expect.element(submit).toBeEnabled();
    expect(deleteEmployeeAccount).not.toHaveBeenCalled();
  });

  it("requires the extra checkbox for an administrator target", async () => {
    const { screen } = await renderDialog({
      deletion: preview({ role: "admin" }),
    });
    await screen.getByTestId("employee-account-deletion-trigger").click();
    await expect
      .element(screen.getByTestId("employee-account-deletion-role"))
      .toHaveTextContent("Administrator");
    const submit = screen.getByTestId("employee-account-deletion-submit");
    await screen
      .getByTestId("employee-account-deletion-confirmation")
      .fill("Fritz Fake");
    await expect.element(submit).toBeDisabled();
    await screen
      .getByTestId("employee-account-deletion-admin-confirmation")
      .click();
    await expect.element(submit).toBeEnabled();
  });

  it("does not render the admin checkbox for a non-admin target", async () => {
    const { screen } = await renderDialog();
    await screen.getByTestId("employee-account-deletion-trigger").click();
    await expect
      .element(screen.getByTestId("employee-account-deletion-form"))
      .toBeVisible();
    expect(
      screen.container.ownerDocument.querySelectorAll(
        "[data-testid='employee-account-deletion-admin-confirmation']",
      ).length,
    ).toBe(0);
  });

  it("submits the typed name through the command and reports success only from the server result", async () => {
    const deleteEmployeeAccount = vi.fn(async () => executed);
    const { screen, onDeleted } = await renderDialog({ deleteEmployeeAccount });
    await screen.getByTestId("employee-account-deletion-trigger").click();
    await screen
      .getByTestId("employee-account-deletion-confirmation")
      .fill("Fritz Fake");
    await screen.getByTestId("employee-account-deletion-submit").click();

    await expect.poll(() => deleteEmployeeAccount).toHaveBeenCalledTimes(1);
    const call = deleteEmployeeAccount.mock.calls[0] as unknown[];
    expect(call[0]).toMatchObject({
      salesId: 7,
      confirmationName: "Fritz Fake",
      adminTargetConfirmed: false,
    });
    await expect.poll(() => onDeleted).toHaveBeenCalledTimes(1);
    await expect
      .poll(
        () =>
          document.body.textContent?.includes(
            "Das Benutzerkonto von Fritz Fake wurde endgültig gelöscht.",
          ) ?? false,
      )
      .toBe(true);
  });

  it("shows the server's refusal in product words, keeps the dialog open and never navigates away", async () => {
    const { screen, onDeleted, onRefused } = await renderDialog({
      deleteEmployeeAccount: vi.fn(async () => {
        throw new Error("business_history_exists");
      }),
    });
    await screen.getByTestId("employee-account-deletion-trigger").click();
    await screen
      .getByTestId("employee-account-deletion-confirmation")
      .fill("Fritz Fake");
    await screen.getByTestId("employee-account-deletion-submit").click();

    await expect
      .element(screen.getByTestId("employee-account-deletion-error"))
      .toHaveTextContent(
        "Dieser Mitarbeiter ist Teil der Geschäftshistorie und kann nicht endgültig gelöscht werden.",
      );
    await expect
      .element(screen.getByTestId("employee-account-deletion-form"))
      .toBeVisible();
    expect(onDeleted).not.toHaveBeenCalled();
    await expect.poll(() => onRefused).toHaveBeenCalledTimes(1);
  });

  it("explains a confirmation mismatch reported by the server (current name changed meanwhile)", async () => {
    const { screen } = await renderDialog({
      deleteEmployeeAccount: vi.fn(async () => {
        throw new Error("confirmation_mismatch");
      }),
    });
    await screen.getByTestId("employee-account-deletion-trigger").click();
    await screen
      .getByTestId("employee-account-deletion-confirmation")
      .fill("Fritz Fake");
    await screen.getByTestId("employee-account-deletion-submit").click();
    await expect
      .element(screen.getByTestId("employee-account-deletion-error"))
      .toHaveTextContent("stimmt nicht mit dem aktuellen Namen");
  });

  it("reports a replayed deletion as already done", async () => {
    const { screen } = await renderDialog({
      deleteEmployeeAccount: vi.fn(async () => ({
        employeeId: 7,
        disposition: "already_deleted",
      })),
    });
    await screen.getByTestId("employee-account-deletion-trigger").click();
    await screen
      .getByTestId("employee-account-deletion-confirmation")
      .fill("Fritz Fake");
    await screen.getByTestId("employee-account-deletion-submit").click();
    await expect
      .poll(
        () =>
          document.body.textContent?.includes(
            "war bereits endgültig gelöscht",
          ) ?? false,
      )
      .toBe(true);
  });
});
