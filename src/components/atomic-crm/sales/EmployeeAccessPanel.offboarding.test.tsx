import { render } from "vitest-browser-react";
import { StoryWrapper } from "@/test/StoryWrapper";
import { EmployeeAccessPanel } from "./EmployeeAccessPanel";
import type {
  EmployeeAccessRecord,
  EmployeeDependencyPreview,
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
  ...over,
});

const withOpen: EmployeeDependencyPreview = {
  companies: 2,
  contacts: 0,
  openDeals: 1,
  openTasks: 4,
  contactNotes: 9,
  dealNotes: 0,
};

/** Notes only — historical authorship, never an open responsibility. */
const notesOnly: EmployeeDependencyPreview = {
  companies: 0,
  contacts: 0,
  openDeals: 0,
  openTasks: 0,
  contactNotes: 3,
  dealNotes: 1,
};

const disabled = (dependencies?: EmployeeDependencyPreview) =>
  ({
    accessState: "disabled",
    disabled: true,
    noraDisabled: true,
    dependencies,
  }) satisfies Partial<EmployeeAccessRecord>;

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

  it("asks for a new login on reactivation after access ended", async () => {
    const screen = await renderPanel(disabled(notesOnly));
    await expect
      .element(screen.getByTestId("employee-access-panel"))
      .toHaveTextContent("Eine neue Anmeldung ist danach erforderlich.");
  });
});

describe("EmployeeAccessPanel — Offene Zuständigkeiten (W5, durable section)", () => {
  it("shows the section with counts and filtered links for an ACTIVE employee, before any offboarding", async () => {
    const screen = await renderPanel({
      accessState: "active",
      dependencies: withOpen,
    });
    const section = screen.getByTestId("employee-open-responsibilities");
    await expect.element(section).toHaveTextContent("Offene Zuständigkeiten");
    await expect
      .element(screen.getByTestId("employee-open-responsibilities-counts"))
      .toHaveTextContent("Kunden2 anzeigen");
    await expect
      .element(screen.getByTestId("employee-open-responsibilities-counts"))
      .toHaveTextContent("Kontakte0");
    await expect
      .element(screen.getByTestId("employee-open-responsibilities-counts"))
      .toHaveTextContent("Vorgänge1 anzeigen");
    await expect
      .element(screen.getByTestId("employee-open-responsibilities-counts"))
      .toHaveTextContent("Offene Aufgaben4");
    await expect
      .element(section)
      .toHaveTextContent(
        "Es bestehen noch 2 Kunden, 1 Vorgang und 4 offene Aufgaben, die anschließend neu zugewiesen werden sollten.",
      );
    // The action is still offered next to it: access and responsibility are separate facts.
    await expect
      .element(screen.getByTestId("employee-offboarding-trigger"))
      .toBeVisible();
  });

  it("links every non-zero list count to the existing list filtered by this employee; tasks stay count-only", async () => {
    const screen = await renderPanel({
      accessState: "active",
      dependencies: withOpen,
    });
    const counts = screen.getByTestId("employee-open-responsibilities-counts");
    await expect.element(counts).toHaveTextContent("Kunden2");
    const anchors = Array.from(
      counts.element().querySelectorAll("a"),
    ) as HTMLAnchorElement[];
    const filter = encodeURIComponent(JSON.stringify({ sales_id: 7 }));
    expect(anchors).toHaveLength(2); // Kunden (2) and Vorgänge (1); Kontakte is 0, tasks have no list
    for (const a of anchors) {
      expect(a.getAttribute("href")).toContain(filter);
    }
    expect(
      anchors.some((a) => a.getAttribute("href")?.includes("kunden")),
    ).toBe(true);
    expect(
      anchors.some((a) => a.getAttribute("href")?.includes("kontakte")),
    ).toBe(false);
    await expect
      .element(screen.getByTestId("employee-open-responsibilities"))
      .toHaveTextContent("Offene Aufgaben finden Sie in der Aufgabenliste");
  });

  it("keeps the section visible with the zero state for an ACTIVE employee", async () => {
    const screen = await renderPanel({
      accessState: "active",
      dependencies: notesOnly,
    });
    const section = screen.getByTestId("employee-open-responsibilities");
    await expect.element(section).toHaveTextContent("Offene Zuständigkeiten");
    await expect
      .element(section)
      .toHaveTextContent("Keine offenen Zuständigkeiten.");
  });

  it("shows the section for an INVITED employee", async () => {
    const screen = await renderPanel({
      accessState: "invited",
      activatedAt: null,
      dependencies: withOpen,
    });
    const section = screen.getByTestId("employee-open-responsibilities");
    await expect.element(section).toHaveTextContent("Offene Zuständigkeiten");
    await expect.element(section).toHaveTextContent("Kunden2");
  });

  it("shows the section with counts for a DISABLED employee (remaining responsibilities stay visible)", async () => {
    const screen = await renderPanel(disabled(withOpen));
    const section = screen.getByTestId("employee-open-responsibilities");
    await expect.element(section).toHaveTextContent("Offene Zuständigkeiten");
    await expect
      .element(section)
      .toHaveTextContent(
        "Es bestehen noch 2 Kunden, 1 Vorgang und 4 offene Aufgaben, die anschließend neu zugewiesen werden sollten.",
      );
    const kundenLink = section
      .element()
      .querySelector("a[href*='kunden']") as HTMLAnchorElement | null;
    expect(kundenLink?.getAttribute("href")).toContain(
      encodeURIComponent(JSON.stringify({ sales_id: 7 })),
    );
  });

  it("keeps the section visible with the zero state for a DISABLED employee", async () => {
    const screen = await renderPanel(disabled(notesOnly));
    const section = screen.getByTestId("employee-open-responsibilities");
    await expect.element(section).toHaveTextContent("Offene Zuständigkeiten");
    await expect
      .element(section)
      .toHaveTextContent("Keine offenen Zuständigkeiten.");
  });

  it("never presents notes (historical authorship) as open responsibilities", async () => {
    const screen = await renderPanel({
      accessState: "active",
      dependencies: notesOnly, // 4 notes, nothing open
    });
    const section = screen.getByTestId("employee-open-responsibilities");
    await expect
      .element(section)
      .toHaveTextContent("Keine offenen Zuständigkeiten.");
    await expect
      .poll(() => section.element().textContent)
      .not.toContain("Notiz");
    await expect.poll(() => section.element().textContent).not.toContain("4");
  });

  it("says so calmly when the server delivered no preview", async () => {
    const screen = await renderPanel({
      accessState: "active",
      dependencies: undefined,
    });
    await expect
      .element(screen.getByTestId("employee-open-responsibilities"))
      .toHaveTextContent("Die Zuständigkeiten konnten nicht geladen werden.");
  });
});
