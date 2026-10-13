import { renderSurface } from "./testing/workTestKit";

vi.mock("../misc/noraDemoMode", () => ({ isNoraDemoMode: true }));

/** AC-09: in demo mode `unavailable` is the demo info state — not empty, not an error. */
describe("Arbeitskorb surface — demo mode", () => {
  it("shows the demo state for unavailable, politely, without retry", async () => {
    const t = await renderSurface();
    await t.waitForRequests(1);
    t.work.fail(0, "unavailable");
    const text =
      "Der Arbeitskorb nutzt Live-Daten und ist im Demo-Modus nicht verfügbar.";
    await expect.poll(() => document.body.textContent).toContain(text);
    expect(document.body.textContent).not.toContain("Keine offenen Aufgaben");
    expect(document.body.textContent).not.toContain("nicht erreichbar");
    expect(
      t.screen.getByRole("button", { name: "Erneut versuchen" }).query(),
    ).toBeNull();
    await expect.poll(() => t.live("polite")).toBe(text);
    expect(t.heard.filter((h) => h.channel === "alert")).toHaveLength(0);
  });
});
