import { userEvent } from "vitest/browser";
import { onlineManager } from "@tanstack/react-query";

import { buildCompany, buildContact } from "@/test/StoryWrapper";
import type { WorkItem } from "../application/queries/getWorkItems";
import {
  buildIncompleteWorkItem,
  buildWorkItem,
  cursor,
  renderSurface,
} from "./testing/workTestKit";

/**
 * D2 — presentation, enrichment and states of the shared surface (level C:
 * real Admin context, German catalog, stubbed Work reader).
 */

const derived = (over: Partial<WorkItem["derived"]> = {}) => ({
  actionable: true,
  overdue: false,
  dueToday: false,
  isMine: true,
  isUnassigned: false,
  ...over,
});

const headings = () =>
  [...document.querySelectorAll("section > h2")].map((h) => h.textContent);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("Arbeitskorb surface — order and groups (AC-03, AC-04, AC-21)", () => {
  it("renders the exact server sequence across pages and repeats a recurring heading", async () => {
    const t = await renderSurface({ companies: [buildCompany({ id: 1 })] });
    const page1 = [
      buildWorkItem({ derived: derived({ overdue: true }) }),
      buildWorkItem({ dueAt: "2026-10-20T00:00:00Z" }),
    ];
    const page2 = [
      buildWorkItem({ derived: derived({ overdue: true }) }),
      buildWorkItem({ dueAt: null }),
    ];
    await t.waitForRequests(1);
    t.work.respond(0, page1, cursor("c1"));
    await expect.poll(t.rowIds).toEqual(page1.map((i) => i.workId));
    await t.screen.getByRole("button", { name: "Weitere laden" }).click();
    await t.waitForRequests(2);
    t.work.respond(1, page2, null);
    const all = [...page1, ...page2];
    await expect.poll(t.rowIds).toEqual(all.map((i) => i.workId));
    expect(headings()).toEqual([
      "Überfällig",
      "Demnächst",
      "Überfällig",
      "Ohne Fälligkeit",
    ]);
    // Structure: a section with h2 and an ordered list per group.
    for (const section of document.querySelectorAll("section")) {
      const heading = section.querySelector("h2")!;
      expect(section.getAttribute("aria-labelledby")).toBe(heading.id);
      expect(section.querySelector(":scope > ol")).not.toBeNull();
    }
    expect(document.querySelectorAll("main").length).toBe(1);
    const h1 = document.querySelectorAll("h1");
    expect(h1.length).toBe(1);
    expect(h1[0].textContent).toBe("Arbeitskorb");
  });

  it("groups by the authoritative flags even when dueAt contradicts them", async () => {
    const t = await renderSurface({ companies: [buildCompany({ id: 1 })] });
    const future = buildWorkItem({
      title: "Zukunft überfällig",
      dueAt: "2999-01-01T00:00:00Z",
      derived: derived({ overdue: true }),
    });
    const past = buildWorkItem({
      title: "Vergangen demnächst",
      dueAt: "2001-01-01T00:00:00Z",
    });
    const both = buildWorkItem({
      title: "Beides",
      dueAt: "2001-01-01T00:00:00Z",
      derived: derived({ overdue: true, dueToday: true }),
    });
    await t.waitForRequests(1);
    t.work.respond(0, [future, past, both], null);
    await expect
      .poll(headings)
      .toEqual(["Überfällig", "Demnächst", "Überfällig"]);
    const row = (item: WorkItem) =>
      document.querySelector(`li[data-work-id="${item.workId}"]`)!;
    expect(row(future).textContent).toContain(
      "Überfällig, Dienstag, 1. Januar 2999",
    );
    expect(row(past).textContent).toContain(
      "Demnächst, Montag, 1. Januar 2001",
    );
    // AC-33
    expect(row(both).textContent).toContain("heute fällig");
    // AC-12: no time in the date / meta / holder areas.
    for (const li of document.querySelectorAll("li[data-work-id]")) {
      const meta = [...li.querySelectorAll("div, p")]
        .filter((el) => !el.querySelector("[id^='arbeitskorb-titel-']"))
        .map((el) => el.textContent)
        .join(" ");
      expect(meta).not.toMatch(/\d{1,2}:\d{2}/);
    }
  });
});

describe("Arbeitskorb surface — incomplete Work (AC-08)", () => {
  it("keeps an incomplete row visible at its server position with working context links", async () => {
    const t = await renderSurface({
      companies: [buildCompany({ id: 4, name: "Fensterbau Nord" })],
    });
    const before = buildWorkItem();
    const incomplete = buildIncompleteWorkItem({
      context: { customerId: 4, contactId: null },
    });
    const after = buildWorkItem();
    await t.waitForRequests(1);
    t.work.respond(0, [before, incomplete, after], null);
    await expect
      .poll(t.rowIds)
      .toEqual([before.workId, incomplete.workId, after.workId]);
    const li = document.querySelector(
      `li[data-work-id="${incomplete.workId}"]`,
    )!;
    expect(li.textContent).toContain("Ohne Bezeichnung");
    expect(li.textContent).toContain("Unvollständig");
    const link = li.querySelector("a")!;
    expect(link.getAttribute("href")).toMatch(/\/kunden\/4\/show\/tasks$/);
    expect(incomplete.title).toBeNull();
  });
});

describe("Arbeitskorb surface — holder (AC-31)", () => {
  it("shows the holder only in team, from flags only", async () => {
    const t = await renderSurface({
      initialEntry: "/arbeitskorb?sicht=team",
      identity: 7,
      companies: [buildCompany({ id: 1 })],
    });
    const notMine = buildWorkItem({
      holder: { salesId: 7, displayName: "Nora Admin" },
      derived: derived({ isMine: false }),
    });
    const mineForeign = buildWorkItem({
      holder: { salesId: 99, displayName: "Fremd" },
      derived: derived({ isMine: true }),
    });
    const unassigned = buildWorkItem({
      holder: { salesId: 3, displayName: "Gesetzt" },
      derived: derived({ isMine: false, isUnassigned: true }),
    });
    const unknown = buildWorkItem({
      holder: null,
      derived: derived({ isMine: false }),
    });
    const unnamed = buildWorkItem({
      holder: { salesId: 4, displayName: null },
      derived: derived({ isMine: false }),
    });
    await t.waitForRequests(1);
    t.work.respond(
      0,
      [notMine, mineForeign, unassigned, unknown, unnamed],
      null,
    );
    const text = (item: WorkItem) =>
      document.querySelector(`li[data-work-id="${item.workId}"]`)
        ?.textContent ?? "";
    await expect.poll(() => text(notMine)).toContain("Zuständig: Nora Admin");
    expect(text(notMine)).not.toContain("Ich");
    expect(text(mineForeign)).toContain("Zuständig: Ich");
    expect(text(unassigned)).toContain("Zuständig: Nicht zugewiesen");
    expect(text(unknown)).toContain("Zuständig: Zuständigkeit unbekannt");
    expect(text(unnamed)).toContain("Zuständig: Mitarbeiter ohne Namen");
  });

  it("shows no holder in Meine Arbeit", async () => {
    const t = await renderSurface({ companies: [buildCompany({ id: 1 })] });
    await t.waitForRequests(1);
    t.work.respond(0, [buildWorkItem()], null);
    await expect.poll(() => t.rowIds().length).toBe(1);
    expect(
      document.querySelector("li[data-work-id]")!.textContent,
    ).not.toContain("Zuständig");
  });
});

describe("Arbeitskorb surface — context enrichment (AC-10, AC-13)", () => {
  it("batches name lookups per resource, reads ID 0, never asks for null, with minimal columns", async () => {
    const t = await renderSurface({
      companies: [
        buildCompany({ id: 0, name: "  Null  GmbH " }),
        buildCompany({ id: 2, name: "Zwei AG" }),
      ],
      contacts: [
        buildContact({ id: 5, first_name: " Ada ", last_name: "  Lovelace" }),
      ],
    });
    const items = Array.from({ length: 12 }, (_, index) =>
      buildWorkItem({
        context: {
          customerId: index % 3 === 0 ? 0 : index % 3 === 1 ? 2 : null,
          contactId: index % 3 === 2 ? 5 : null,
        },
      }),
    );
    await t.waitForRequests(1);
    t.work.respond(0, items, null);
    await expect.poll(() => document.body.textContent).toContain("Null GmbH");
    await expect
      .poll(() => document.body.textContent)
      .toContain("Ada Lovelace");
    const byResource = (resource: string) =>
      t.getManyCalls.filter((call) => call.resource === resource);
    expect(byResource("companies")).toHaveLength(1);
    expect(byResource("contacts")).toHaveLength(1);
    expect(byResource("companies")[0].params.ids.map(String).sort()).toEqual([
      "0",
      "2",
    ]);
    expect(byResource("contacts")[0].params.ids).toEqual([5]);
    expect(byResource("companies")[0].params.meta).toEqual({
      columns: ["id", "name"],
    });
    expect(byResource("contacts")[0].params.meta).toEqual({
      columns: ["id", "first_name", "last_name"],
    });
    expect(
      t.getManyCalls.some((c) => c.params.ids.includes(null as never)),
    ).toBe(false);
    // ID 0 link and accessible names.
    const zeroLink = document.querySelector<HTMLAnchorElement>(
      'a[href$="/kunden/0/show/tasks"]',
    );
    expect(zeroLink).not.toBeNull();
    expect(zeroLink!.textContent).toBe("Kunde: Null GmbH");
    const contactLink = document.querySelector('a[href$="/kontakte/5/show"]')!;
    expect(contactLink.textContent).toBe("Kontakt: Ada Lovelace");
    // aria-describedby points at the row title.
    const describedBy = zeroLink!.getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toMatch(
      /Aufgabe/,
    );
    // Rows stay in server order regardless of names.
    expect(t.rowIds()).toEqual(items.map((i) => i.workId));
  });

  it("keeps all Work when the name lookup fails, with fallbacks and one calm hint", async () => {
    const t = await renderSurface({ nameLookup: "fail" });
    const items = [
      buildWorkItem({ context: { customerId: 1, contactId: 2 } }),
      buildWorkItem({ context: { customerId: 3, contactId: null } }),
    ];
    await t.waitForRequests(1);
    t.work.respond(0, items, null);
    await expect
      .poll(() => document.body.textContent)
      .toContain("Kunde (Name nicht geladen)");
    expect(document.body.textContent).toContain("Kontakt (Name nicht geladen)");
    expect(t.rowIds()).toEqual(items.map((i) => i.workId));
    expect(
      document.querySelector('a[href$="/kunden/1/show/tasks"]'),
    ).not.toBeNull();
    expect(document.body.textContent).toContain(
      "Einige Kunden- oder Kontaktnamen konnten nicht geladen werden.",
    );
    // The Work query stays successful: summary line present, no error panel.
    expect(document.body.textContent).toContain("2 offen");
    expect(document.body.textContent).not.toContain("konnte nicht geladen");
    await expect
      .poll(() => t.heard.map((h) => h.text))
      .toContain(
        "Einige Kunden- oder Kontaktnamen konnten nicht geladen werden.",
      );
    expect(t.work.calls).toHaveLength(1);
  });

  it("shows a pending name as the kind with an accessible loading label", async () => {
    const t = await renderSurface({ nameLookup: "hang" });
    await t.waitForRequests(1);
    t.work.respond(
      0,
      [buildWorkItem({ context: { customerId: 1, contactId: null } })],
      null,
    );
    const link = t.screen.getByRole("link", {
      name: "Kunde (Name wird geladen)",
    });
    await expect.element(link).toBeVisible();
    expect(link.element().textContent).toBe("Kunde");
  });

  it("shows a record missing from a successful answer as not available, without a hint", async () => {
    const t = await renderSurface({ companies: [] });
    await t.waitForRequests(1);
    t.work.respond(
      0,
      [buildWorkItem({ context: { customerId: 42, contactId: null } })],
      null,
    );
    await expect
      .poll(() => document.body.textContent)
      .toContain("Kunde (Name nicht verfügbar)");
    expect(document.body.textContent).not.toContain("Einige Kunden");
  });
});

describe("Arbeitskorb surface — failures are never empty (AC-09, AC-34, AC-35)", () => {
  const cases = [
    ["failed", "Der Arbeitskorb konnte nicht geladen werden.", "Code: failed"],
    [
      "invalid_request",
      "Der Arbeitskorb konnte nicht geladen werden.",
      "Code: invalid_request",
    ],
    [
      "malformed_response",
      "Der Arbeitskorb konnte nicht geladen werden.",
      "Code: malformed_response",
    ],
    ["unavailable", "Der Arbeitskorb ist gerade nicht erreichbar.", null],
    ["permission_denied", "Kein Zugriff auf den Arbeitskorb.", null],
  ] as const;
  for (const [reason, text, code] of cases) {
    it(`first-load ${reason} shows its state, never the empty state`, async () => {
      const t = await renderSurface();
      await t.waitForRequests(1);
      t.work.fail(0, reason);
      await expect.poll(() => document.body.textContent).toContain(text);
      if (code) expect(document.body.textContent).toContain(code);
      expect(document.body.textContent).not.toContain("Keine offenen Aufgaben");
      expect(t.rowIds()).toEqual([]);
      await expect.poll(() => t.live("alert")).toContain(text);
      if (reason === "permission_denied") {
        await expect
          .element(t.screen.getByRole("link", { name: "Zur Startseite" }))
          .toBeVisible();
        await sleep(100);
        expect(t.work.calls).toHaveLength(1);
        expect(t.heard.filter((h) => h.channel === "alert")).toHaveLength(1);
      } else {
        await expect
          .element(t.screen.getByRole("button", { name: "Erneut versuchen" }))
          .toBeVisible();
      }
    });
  }

  it("announces a repeated retry failure every time", async () => {
    const t = await renderSurface();
    await t.waitForRequests(1);
    t.work.fail(0, "failed");
    const retry = t.screen.getByRole("button", { name: "Erneut versuchen" });
    await expect.element(retry).toBeVisible();
    await retry.click();
    await t.waitForRequests(2);
    t.work.fail(1, "failed");
    await expect
      .poll(() => document.body.textContent)
      .toMatch(/Erneut fehlgeschlagen · \d{2}:\d{2}/);
    await retry.click();
    await t.waitForRequests(3);
    t.work.fail(2, "failed");
    await expect
      .poll(
        () =>
          t.heard.filter(
            (h) =>
              h.channel === "alert" &&
              h.text.startsWith("Erneut fehlgeschlagen"),
          ).length,
      )
      .toBe(2);
  });

  it("shows both empty states only after a successful empty answer", async () => {
    const mine = await renderSurface();
    await mine.waitForRequests(1);
    mine.work.respond(0, [], null);
    await expect
      .poll(() => document.body.textContent)
      .toContain("Keine offenen Aufgaben in Meine Arbeit.");
    // No summary line, no list end at 0 rows.
    expect(document.body.textContent).not.toContain("angezeigt");
    expect(document.body.textContent).not.toContain("0 offen");
    await expect
      .poll(() => mine.live("polite"))
      .toBe("Keine offenen Aufgaben in Meine Arbeit.");
    // "Team ansehen" is a button: replace to sicht=team, focus on the Team tab.
    await mine.screen.getByRole("button", { name: "Team ansehen" }).click();
    await expect.poll(mine.location).toBe("/arbeitskorb?sicht=team");
    await expect
      .element(mine.screen.getByRole("tab", { name: "Team" }))
      .toHaveFocus();
    await mine.waitForRequests(2);
    mine.work.respond(1, [], null);
    await expect
      .poll(() => document.body.textContent)
      .toContain("Im Team sind keine offenen Aufgaben.");
  });

  it("keeps the snapshot on a refresh failure and marks it stale", async () => {
    const t = await renderSurface({ companies: [buildCompany({ id: 1 })] });
    await t.waitForRequests(1);
    t.work.respond(0, [buildWorkItem()], null);
    await expect.poll(() => t.rowIds().length).toBe(1);
    await t.screen
      .getByRole("button", { name: "Arbeitskorb aktualisieren" })
      .click();
    await t.waitForRequests(2);
    await expect
      .poll(() => document.body.textContent)
      .toContain("Wird aktualisiert …");
    t.work.fail(1, "unavailable");
    await expect
      .poll(() => document.body.textContent)
      .toMatch(/Stand \d{2}:\d{2} · Aktualisierung fehlgeschlagen/);
    expect(t.rowIds()).toHaveLength(1);
    await expect
      .poll(() => t.live("polite"))
      .toMatch(
        /^Aktualisierung fehlgeschlagen\. Angezeigt ist der Stand von \d{2}:\d{2}\.$/,
      );
  });

  it("keeps rows when load-more fails; the button retries and is described by the inline text", async () => {
    const t = await renderSurface({ companies: [buildCompany({ id: 1 })] });
    await t.waitForRequests(1);
    t.work.respond(0, [buildWorkItem()], cursor("c1"));
    const more = t.screen.getByRole("button", { name: "Weitere laden" });
    await more.click();
    await t.waitForRequests(2);
    expect(more.element().getAttribute("aria-disabled")).toBe("true");
    t.work.fail(1, "failed");
    await expect
      .poll(() => document.body.textContent)
      .toContain("Weitere Aufgaben konnten nicht geladen werden.");
    expect(t.rowIds()).toHaveLength(1);
    const describedBy = more.element().getAttribute("aria-describedby")!;
    expect(document.getElementById(describedBy)?.textContent).toBe(
      "Weitere Aufgaben konnten nicht geladen werden.",
    );
    await expect.element(more).toHaveFocus();
    // Retry via the same button; success focuses the first appended row.
    await more.click();
    await t.waitForRequests(3);
    expect(t.work.requests()[2].cursor).toBe("c1");
    const next = buildWorkItem({ context: { customerId: 1, contactId: null } });
    t.work.respond(2, [next], null);
    await expect.poll(t.rowIds).toContain(next.workId);
    await expect
      .poll(() => t.live("polite"))
      .toBe("1 weitere Aufgabe geladen.");
    await expect
      .poll(() =>
        document.activeElement?.closest("li")?.getAttribute("data-work-id"),
      )
      .toBe(next.workId);
    expect(document.body.textContent).toContain(
      "Alle 2 offenen Aufgaben angezeigt",
    );
  });

  it("shows offline without and with data", async () => {
    onlineManager.setOnline(false);
    try {
      expect(onlineManager.isOnline()).toBe(false);
      const t = await renderSurface();
      await expect
        .poll(() => document.body.textContent)
        .toContain(
          "Keine Verbindung. Der Arbeitskorb lädt, sobald Nora wieder online ist.",
        );
      expect(document.body.textContent).not.toContain("Keine offenen Aufgaben");
      onlineManager.setOnline(true);
      await t.waitForRequests(1);
      t.work.respond(
        0,
        [buildWorkItem({ context: { customerId: null, contactId: 1 } })],
        null,
      );
      await expect.poll(() => t.rowIds().length).toBe(1);
      onlineManager.setOnline(false);
      await expect
        .poll(() => document.body.textContent)
        .toMatch(/Offline · Stand \d{2}:\d{2}/);
      expect(t.rowIds()).toHaveLength(1);
      await expect
        .poll(() => t.live("polite"))
        .toMatch(
          /^Keine Verbindung\. Angezeigt ist der Stand von \d{2}:\d{2}\.$/,
        );
    } finally {
      onlineManager.setOnline(true);
    }
  });
});

describe("Arbeitskorb surface — announcements (AC-32, AC-35, R2-29)", () => {
  it("announces complete and partial success with counts from flags only", async () => {
    vi.useFakeTimers({ toFake: ["Date"], now: Date.UTC(3000, 0, 1) });
    try {
      const t = await renderSurface({ companies: [buildCompany({ id: 1 })] });
      await t.waitForRequests(1);
      t.work.respond(
        0,
        [
          buildWorkItem({
            dueAt: "2999-01-01T00:00:00Z",
            derived: derived({ overdue: true }),
          }),
          buildWorkItem({
            dueAt: "2001-01-01T00:00:00Z",
            derived: derived({ dueToday: true }),
          }),
          buildWorkItem({ dueAt: "2001-01-01T00:00:00Z" }),
        ],
        null,
      );
      await expect
        .poll(() => t.live("polite"))
        .toBe("Meine Arbeit: 3 offene Aufgaben, 1 überfällig, 1 heute.");
      expect(document.body.textContent).toContain(
        "1 überfällig · 1 heute · 3 offen",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("announces a partial set without a total", async () => {
    const partial = await renderSurface({
      initialEntry: "/arbeitskorb?sicht=team",
    });
    await partial.waitForRequests(1);
    partial.work.respond(0, [buildWorkItem()], cursor("more"));
    await expect
      .poll(() => partial.live("polite"))
      .toBe("Team: 1 Aufgabe geladen, weitere vorhanden.");
    expect(document.body.textContent).toContain(
      "1 Aufgabe geladen · weitere vorhanden",
    );
    expect(document.body.textContent).not.toMatch(/\d+ offen\b/);
  });

  it("announces revalidations: changed, manual unchanged, silent automatic", async () => {
    const t = await renderSurface({ companies: [buildCompany({ id: 1 })] });
    const row = buildWorkItem();
    await t.waitForRequests(1);
    t.work.respond(0, [row], null);
    await expect
      .poll(() => t.live("polite"))
      .toBe("Meine Arbeit: 1 offene Aufgabe.");
    const refresh = t.screen.getByRole("button", {
      name: "Arbeitskorb aktualisieren",
    });
    await refresh.click();
    await t.waitForRequests(2);
    t.work.respond(1, [row], null);
    await expect
      .poll(() => t.live("polite"))
      .toBe("Arbeitskorb aktualisiert, keine Änderungen.");
    const heardBefore = t.heard.length;
    // Automatic revalidation without change (day-change style invalidation).
    void t.queryClient.invalidateQueries({ queryKey: ["work"] });
    await t.waitForRequests(3);
    t.work.respond(2, [row], null);
    await sleep(150);
    expect(t.heard.length).toBe(heardBefore);
    // A revalidation that only changes the group key is a change.
    void t.queryClient.invalidateQueries({ queryKey: ["work"] });
    await t.waitForRequests(4);
    t.work.respond(3, [{ ...row, derived: derived({ dueToday: true }) }], null);
    await expect
      .poll(() => t.live("polite"))
      .toBe(
        "Arbeitskorb aktualisiert. Meine Arbeit: 1 offene Aufgabe, 1 heute.",
      );
  });

  it("announces a slow first load once, but never while a denied view reloads (R2-29)", async () => {
    const t = await renderSurface({ companies: [buildCompany({ id: 1 })] });
    await t.waitForRequests(1);
    await expect
      .poll(() => t.live("polite"), { timeout: 3000 })
      .toBe("Arbeitskorb wird geladen.");
    t.work.respond(0, [buildWorkItem()], null);
    await expect.poll(() => t.rowIds().length).toBe(1);
    // Denial on refresh.
    await t.screen
      .getByRole("button", { name: "Arbeitskorb aktualisieren" })
      .click();
    await t.waitForRequests(2);
    t.work.fail(1, "permission_denied");
    await expect.poll(() => t.live("alert")).toContain("Kein Zugriff");
    expect(t.rowIds()).toEqual([]);
    const loadingBefore = t.heard.filter(
      (h) => h.text === "Arbeitskorb wird geladen.",
    ).length;
    // Reload of the denied view: first-load look, no loading announcement.
    await t.screen
      .getByRole("button", { name: "Arbeitskorb aktualisieren" })
      .click();
    await t.waitForRequests(3);
    await expect
      .poll(() => document.querySelector('[aria-busy="true"]'))
      .not.toBeNull();
    await sleep(1400);
    expect(t.rowIds()).toEqual([]);
    expect(
      t.heard.filter((h) => h.text === "Arbeitskorb wird geladen.").length,
    ).toBe(loadingBefore);
    const fresh = buildWorkItem();
    t.work.respond(2, [fresh], null);
    await expect.poll(t.rowIds).toEqual([fresh.workId]);
  });
});

describe("Arbeitskorb surface — permission_denied render invariant (AC-09)", () => {
  it("drops the snapshot at once, focuses the tab panel and makes no further request", async () => {
    const t = await renderSurface({ companies: [buildCompany({ id: 1 })] });
    await t.waitForRequests(1);
    t.work.respond(0, [buildWorkItem()], cursor("c1"));
    const more = t.screen.getByRole("button", { name: "Weitere laden" });
    await more.click();
    await t.waitForRequests(2);
    t.work.fail(1, "permission_denied");
    await expect
      .poll(() => document.body.textContent)
      .toContain("Kein Zugriff auf den Arbeitskorb.");
    expect(t.rowIds()).toEqual([]);
    await expect
      .poll(() => document.activeElement?.getAttribute("role"))
      .toBe("tabpanel");
    await sleep(150);
    expect(t.work.calls).toHaveLength(2);
    expect(t.heard.filter((h) => h.channel === "alert")).toHaveLength(1);
  });
});

describe("Arbeitskorb surface — keyboard and view tabs (AC-05 C, AC-19 C, AC-21)", () => {
  it("switches views with arrow keys by replace and keeps the tablist wiring", async () => {
    const t = await renderSurface({
      initialEntry: "/arbeitskorb?sicht=xyz&foo=1",
    });
    await expect.poll(t.location).toBe("/arbeitskorb?foo=1&sicht=mine");
    const mine = t.screen.getByRole("tab", { name: "Meine Arbeit" });
    const team = t.screen.getByRole("tab", { name: "Team" });
    expect(mine.element().getAttribute("aria-selected")).toBe("true");
    const panelId = mine.element().getAttribute("aria-controls")!;
    expect(document.getElementById(panelId)?.getAttribute("role")).toBe(
      "tabpanel",
    );
    // The inactive panel exists, hidden and empty.
    const teamPanel = document.getElementById(
      team.element().getAttribute("aria-controls")!,
    )!;
    expect(teamPanel.hidden).toBe(true);
    expect(teamPanel.childElementCount).toBe(0);
    await mine.click();
    await userEvent.keyboard("{ArrowRight}");
    await expect.poll(t.location).toBe("/arbeitskorb?foo=1&sicht=team");
    await expect.element(team).toHaveAttribute("aria-selected", "true");
    // Tab order: tab → refresh → tab panel.
    await userEvent.keyboard("{Tab}");
    await expect
      .element(
        t.screen.getByRole("button", { name: "Arbeitskorb aktualisieren" }),
      )
      .toHaveFocus();
    await userEvent.keyboard("{Tab}");
    expect(document.activeElement?.getAttribute("role")).toBe("tabpanel");
  });
});
