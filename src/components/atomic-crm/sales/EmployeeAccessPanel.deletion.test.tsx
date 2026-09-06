import { render } from "vitest-browser-react";
import { RecordContextProvider } from "ra-core";
import { StoryWrapper } from "@/test/StoryWrapper";
import { EmployeeAccessPanel } from "./EmployeeAccessPanel";
import type {
  EmployeeAccessRecord,
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
  dependencies: {
    companies: 0,
    contacts: 0,
    openDeals: 0,
    openTasks: 0,
    contactNotes: 0,
    dealNotes: 0,
  },
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

const sale = { id: 7, first_name: "Fritz", last_name: "Fake", role: "office" };

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
      <RecordContextProvider value={sale}>
        <EmployeeAccessPanel salesId={7} />
      </RecordContextProvider>
    </StoryWrapper>,
  );

const noTrigger = async (screen: Awaited<ReturnType<typeof renderPanel>>) =>
  expect
    .poll(
      () =>
        screen.container.querySelectorAll(
          "[data-testid='employee-account-deletion-trigger']",
        ).length,
    )
    .toBe(0);

describe("EmployeeAccessPanel — Benutzerkonto endgültig löschen (W6-B)", () => {
  it("renders the exceptional section last, separated from the routine controls", async () => {
    const screen = await renderPanel({ deletion: preview() });
    const section = screen.getByTestId("employee-account-deletion");
    await expect
      .element(section)
      .toHaveTextContent("Benutzerkonto endgültig löschen");
    await expect
      .element(section)
      .toHaveTextContent(
        "Nur für versehentlich angelegte, doppelte, Test- oder nie genutzte Konten.",
      );
    const panel = screen.getByTestId("employee-access-panel").element();
    expect(panel.lastElementChild?.getAttribute("data-testid")).toBe(
      "employee-account-deletion",
    );
  });

  it("offers the destructive control for a disabled, eligible account, with all six counts", async () => {
    const screen = await renderPanel({ deletion: preview() });
    await expect
      .element(screen.getByTestId("employee-account-deletion-eligible"))
      .toHaveTextContent("keine Geschäftshistorie in Nora");
    const counts = screen.getByTestId("employee-account-deletion-counts");
    await expect.element(counts).toHaveTextContent("Kunden0");
    await expect.element(counts).toHaveTextContent("Kontakte0");
    await expect
      .element(counts)
      .toHaveTextContent("Vorgänge (auch archivierte)0");
    await expect
      .element(counts)
      .toHaveTextContent("Aufgaben (auch erledigte)0");
    await expect.element(counts).toHaveTextContent("Kontaktnotizen0");
    await expect.element(counts).toHaveTextContent("Vorgangsnotizen0");
    await expect
      .element(screen.getByTestId("employee-account-deletion-trigger"))
      .toHaveTextContent("Benutzerkonto endgültig löschen");
  });

  it.each(["active", "invited"] as const)(
    "for a %s account it points to „Zugang beenden“ first and offers no destructive control",
    async (state) => {
      const screen = await renderPanel({
        accessState: state,
        disabled: false,
        noraDisabled: false,
        deletion: preview({ eligible: false, reasons: ["still_active"] }),
      });
      await expect
        .element(
          screen.getByTestId("employee-account-deletion-requires-offboarding"),
        )
        .toHaveTextContent(
          "Ein Benutzerkonto kann erst nach „Zugang beenden“ endgültig gelöscht werden.",
        );
      await noTrigger(screen);
    },
  );

  it("explains business history with the all-time counts and offers no destructive control", async () => {
    const screen = await renderPanel({
      deletion: preview({
        eligible: false,
        reasons: ["business_history_exists"],
        businessHistory: {
          companies: 0,
          contacts: 0,
          deals: 2,
          tasks: 1,
          contactNotes: 0,
          dealNotes: 3,
        },
      }),
    });
    await expect
      .element(screen.getByTestId("employee-account-deletion-blocked"))
      .toHaveTextContent(
        "Dieser Mitarbeiter ist Teil der Geschäftshistorie und kann nicht endgültig gelöscht werden. Beenden Sie stattdessen den Nora-Zugang. (2 Vorgänge, 1 Aufgabe und 3 Notizen)",
      );
    const counts = screen.getByTestId("employee-account-deletion-counts");
    await expect
      .element(counts)
      .toHaveTextContent("Vorgänge (auch archivierte)2");
    await expect
      .element(counts)
      .toHaveTextContent("Aufgaben (auch erledigte)1");
    await expect.element(counts).toHaveTextContent("Vorgangsnotizen3");
    await noTrigger(screen);
  });

  it("explains durable provenance (authored content / own changes) as a blocker", async () => {
    const screen = await renderPanel({
      deletion: preview({
        eligible: false,
        reasons: ["durable_provenance_exists"],
        provenance: {
          checklistTemplates: 0,
          savedTextSnippets: 2,
          googleCalendarConnections: 0,
          auditEventsAsActor: 5,
        },
      }),
    });
    await expect
      .element(screen.getByTestId("employee-account-deletion-blocked"))
      .toHaveTextContent(
        "hat in Nora gearbeitet oder Inhalte erstellt und kann nicht endgültig gelöscht werden. Das Konto bleibt als deaktivierter Mitarbeiter erhalten. (2 Textbausteine und 5 eigene Änderungen im Änderungsverlauf)",
      );
    await noTrigger(screen);
  });

  it("explains an inconsistent access or identity state without offering deletion", async () => {
    const screen = await renderPanel({
      accessConsistency: "inconsistent",
      deletion: preview({ eligible: false, reasons: ["access_inconsistent"] }),
    });
    await expect
      .element(screen.getByTestId("employee-account-deletion-blocked"))
      .toHaveTextContent("Zugangsstatus synchronisieren");
    await noTrigger(screen);
  });

  it("says so calmly when the deletion check could not be loaded", async () => {
    const screen = await renderPanel({ deletion: undefined });
    await expect
      .element(screen.getByTestId("employee-account-deletion"))
      .toHaveTextContent("Die Löschprüfung konnte nicht geladen werden.");
    await noTrigger(screen);
  });

  it("shows the documented demo limitation and no destructive control", async () => {
    const screen = await renderPanel({
      deletion: preview({ supported: false, eligible: false }),
    });
    await expect
      .element(screen.getByTestId("employee-account-deletion"))
      .toHaveTextContent(
        "In der Demo-Umgebung ist das endgültige Löschen von Benutzerkonten nicht verfügbar.",
      );
    await noTrigger(screen);
  });

  it("never uses technical vocabulary in the section", async () => {
    const screen = await renderPanel({
      deletion: preview({
        eligible: false,
        reasons: ["identity_inconsistent"],
      }),
    });
    const text = screen
      .getByTestId("employee-account-deletion")
      .element().textContent;
    expect(text).not.toMatch(
      /jwt|token|gotrue|session|auth\.users|ticket|NORA_/i,
    );
  });
});
