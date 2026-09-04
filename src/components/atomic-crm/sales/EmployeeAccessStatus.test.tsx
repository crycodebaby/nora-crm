import { render } from "vitest-browser-react";
import { EmployeeAccessStatus } from "./EmployeeAccessStatus";
import {
  EMPLOYEE_ACCESS_STATES,
  EMPLOYEE_ACCESS_STATE_LABEL,
} from "./employeeAccessContract";

describe("EmployeeAccessStatus", () => {
  it.each(EMPLOYEE_ACCESS_STATES)(
    "renders %s as glyph + word, never colour alone",
    async (state) => {
      const screen = await render(
        <EmployeeAccessStatus state={state} data-testid="pill" />,
      );
      const pill = screen.getByTestId("pill");
      await expect
        .element(pill)
        .toHaveTextContent(EMPLOYEE_ACCESS_STATE_LABEL[state]);
      await expect.element(pill).toHaveAttribute("data-state", state);
      expect(
        screen.container.querySelectorAll('[data-testid="pill"] svg'),
      ).toHaveLength(1);
    },
  );

  it("keeps the unknown state visible with its technical hint", async () => {
    const screen = await render(
      <EmployeeAccessStatus state="unknown" showHint />,
    );
    await expect.element(screen.getByText("Zugang unklar")).toBeVisible();
    await expect
      .element(screen.getByText("Technische Prüfung erforderlich"))
      .toBeVisible();
  });

  it("adds no hint to states that need none", async () => {
    const screen = await render(
      <EmployeeAccessStatus state="active" showHint />,
    );
    await expect.element(screen.getByText("Zugang aktiv")).toBeVisible();
    await expect
      .poll(
        () =>
          screen.container.textContent?.includes(
            "Technische Prüfung erforderlich",
          ) ?? false,
      )
      .toBe(false);
  });
});
