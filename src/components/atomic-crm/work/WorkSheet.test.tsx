import { userEvent } from "vitest/browser";

import { buildCompany, buildContact } from "@/test/StoryWrapper";
import { buildWorkItem, renderSurface } from "./testing/workTestKit";

/**
 * Mobile read-only sheet (docs/nora/26 §9, AC-14, AC-20). Level C.
 */
const FORBIDDEN = [
  "Aufgabe öffnen",
  "Aufgabe bearbeiten",
  "Weiter zur Aufgabe",
];

const setup = async () => {
  const t = await renderSurface({
    variant: "mobile",
    companies: [buildCompany({ id: 1, name: "Fensterbau Nord" })],
    contacts: [
      buildContact({ id: 5, first_name: "Ada", last_name: "Lovelace" }),
    ],
  });
  const withContact = buildWorkItem({
    title: "Rückruf Ada",
    workType: "Anruf",
    context: { customerId: 1, contactId: 5 },
  });
  const customerOnly = buildWorkItem({
    title: "Angebot prüfen",
    context: { customerId: 1, contactId: null },
  });
  await t.waitForRequests(1);
  t.work.respond(0, [withContact, customerOnly], null);
  await expect.poll(() => t.rowIds().length).toBe(2);
  const rowButton = (title: string) =>
    t.screen.getByRole("button", { name: new RegExp(title) });
  return { ...t, withContact, customerOnly, rowButton };
};

describe("Arbeitskorb mobile sheet", () => {
  it("opens a read-only sheet with own German close, context actions and no Work request", async () => {
    const t = await setup();
    const row = t.rowButton("Rückruf Ada");
    expect(row.element().getAttribute("aria-haspopup")).toBe("dialog");
    await row.click();
    const dialog = t.screen.getByRole("dialog", { name: "Rückruf Ada" });
    await expect.element(dialog).toBeVisible();
    const text = dialog.element().textContent ?? "";
    // No built-in (English, tiny) close button.
    expect(text).not.toContain("Close");
    await expect
      .element(dialog.getByRole("button", { name: "Schließen" }))
      .toBeVisible();
    const contact = dialog.getByRole("link", { name: /Kontakt öffnen/ });
    const customer = dialog.getByRole("link", { name: /Kundenakte öffnen/ });
    expect(contact.element().getAttribute("href")).toMatch(
      /\/kontakte\/5\/show$/,
    );
    expect(customer.element().getAttribute("href")).toMatch(
      /\/kunden\/1\/show$/,
    );
    await expect.element(contact).toHaveTextContent(/Ada Lovelace/);
    expect(text).toContain("Anruf");
    for (const label of FORBIDDEN) expect(text).not.toContain(label);
    expect(text).not.toContain(
      "In der mobilen Ansicht zeigt die Kundenakte keine Aufgaben.",
    );
    expect(t.work.calls).toHaveLength(1);

    // Escape closes; focus returns to the row button.
    await userEvent.keyboard("{Escape}");
    await expect
      .poll(() => document.querySelector('[role="dialog"]'))
      .toBeNull();
    await expect.element(row).toHaveFocus();
  });

  it("explains the customer action when there is no contact, and the close button returns focus", async () => {
    const t = await setup();
    const row = t.rowButton("Angebot prüfen");
    await row.click();
    const dialog = t.screen.getByRole("dialog");
    await expect
      .element(dialog)
      .toHaveTextContent(
        "In der mobilen Ansicht zeigt die Kundenakte keine Aufgaben.",
      );
    expect(
      dialog.getByRole("link", { name: /Kontakt öffnen/ }).query(),
    ).toBeNull();
    await dialog.getByRole("button", { name: "Schließen" }).click();
    await expect
      .poll(() => document.querySelector('[role="dialog"]'))
      .toBeNull();
    await expect.element(row).toHaveFocus();
  });

  it("follows the current snapshot after a revalidation and notes a vanished row", async () => {
    const t = await setup();
    await t.rowButton("Rückruf Ada").click();
    const dialog = t.screen.getByRole("dialog");
    await expect.element(dialog).toHaveTextContent(/Demnächst/);
    void t.queryClient.invalidateQueries({ queryKey: ["work"] });
    await t.waitForRequests(2);
    t.work.respond(
      1,
      [
        {
          ...t.withContact,
          derived: { ...t.withContact.derived, overdue: true },
        },
        t.customerOnly,
      ],
      null,
    );
    await expect.element(dialog).toHaveTextContent(/Überfällig/);
    expect(t.work.calls).toHaveLength(2);
    void t.queryClient.invalidateQueries({ queryKey: ["work"] });
    await t.waitForRequests(3);
    t.work.respond(2, [t.customerOnly], null);
    await expect
      .element(dialog)
      .toHaveTextContent(
        "Diese Aufgabe ist nach der Aktualisierung nicht mehr in dieser Ansicht.",
      );
    expect(dialog.element().textContent).toContain("Rückruf Ada");
  });

  it("closing the sheet of a vanished row focuses its neighbour (AC-20)", async () => {
    const t = await setup();
    await t.rowButton("Rückruf Ada").click();
    const dialog = t.screen.getByRole("dialog");
    await expect.element(dialog).toBeVisible();
    void t.queryClient.invalidateQueries({ queryKey: ["work"] });
    await t.waitForRequests(2);
    t.work.respond(1, [t.customerOnly], null);
    await expect
      .element(dialog)
      .toHaveTextContent(
        "Diese Aufgabe ist nach der Aktualisierung nicht mehr in dieser Ansicht.",
      );
    // The notice is announced (it is a status), not only shown.
    expect(
      dialog.element().querySelector('[role="status"]')?.textContent,
    ).toContain("nicht mehr in dieser Ansicht");
    await t.screen.getByRole("button", { name: "Schließen" }).click();
    await expect.element(t.rowButton("Angebot prüfen")).toHaveFocus();
  });

  it("closes at once on permission_denied and focuses the tab panel", async () => {
    const t = await setup();
    await t.rowButton("Rückruf Ada").click();
    await expect.element(t.screen.getByRole("dialog")).toBeVisible();
    void t.queryClient.invalidateQueries({ queryKey: ["work"] });
    await t.waitForRequests(2);
    t.work.fail(1, "permission_denied");
    await expect
      .poll(() => document.querySelector('[role="dialog"]'))
      .toBeNull();
    expect(document.body.textContent).not.toContain("Rückruf Ada");
    await expect
      .poll(() => document.activeElement?.getAttribute("role"))
      .toBe("tabpanel");
  });

  it("closes when navigating to the contact", async () => {
    const t = await setup();
    await t.rowButton("Rückruf Ada").click();
    await t.screen
      .getByRole("dialog")
      .getByRole("link", { name: /Kontakt öffnen/ })
      .click();
    await expect.poll(t.location).toBe("/kontakte/5/show");
    await expect
      .poll(() => document.querySelector('[role="dialog"]'))
      .toBeNull();
  });
});
