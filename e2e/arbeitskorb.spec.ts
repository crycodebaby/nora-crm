/**
 * Alpha UI 2 — Arbeitskorb end to end (docs/nora/26 §17, levels E).
 *
 * Runs against the disposable local Supabase stack with the one canonical
 * E2E employee (docs/nora/21 §16): every row is a real `public.tasks` row
 * read through the real Work query. Style-dependent criteria (motion,
 * contrast, sizes) are only measurable here (docs/nora/26 §17).
 */
import type { Browser, Locator, Page } from "@playwright/test";
import { loginAsAdmin } from "./helpers/auth";
import { expect, test, type E2eTaskSeed } from "./fixtures";

const DAY = 24 * 60 * 60 * 1000;
const at = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * DAY).toISOString();

const TIME = /\b\d{1,2}:\d{2}\b/;

type Seeded = {
  sonnenhof: number;
  nord: number;
  erika: number;
};

/**
 * Two customers, one contact (of Sonnenhof), five own open tasks covering
 * every group plus an incomplete row, and one unassigned task (Team only).
 * Server order: overdue → today → upcoming → none (due_at ASC NULLS LAST).
 */
const seedBasket = async ({
  adminId,
  createCompany,
  createContact,
  createTasks,
  extra,
}: {
  adminId: number | string;
  createCompany: (args: {
    name: string;
    salesId: number | string;
  }) => Promise<{ id: number }>;
  createContact: (args: {
    first_name: string;
    last_name: string;
    company_id?: number | string | null;
    sales_id: number | string;
  }) => Promise<{ id: number }>;
  createTasks: (tasks: E2eTaskSeed[]) => Promise<unknown>;
  extra?: (ids: Seeded) => E2eTaskSeed[];
}): Promise<Seeded> => {
  const sonnenhof = (
    await createCompany({ name: "Hausverwaltung Sonnenhof", salesId: adminId })
  ).id;
  const nord = (
    await createCompany({ name: "Fensterbau Nord", salesId: adminId })
  ).id;
  const erika = (
    await createContact({
      first_name: "Erika",
      last_name: "Muster",
      company_id: sonnenhof,
      sales_id: adminId,
    })
  ).id;
  const ids = { sonnenhof, nord, erika };
  await createTasks([
    {
      text: "Dachrinne prüfen",
      due_date: at(-3),
      sales_id: adminId,
      contact_id: erika,
    },
    {
      text: "Angebot nachfassen",
      due_date: at(0),
      sales_id: adminId,
      company_id: nord,
      type: "Anruf",
    },
    {
      text: "Fenster reinigen",
      due_date: at(5),
      sales_id: adminId,
      company_id: sonnenhof,
    },
    { text: null, due_date: at(6), sales_id: adminId, company_id: nord },
    {
      text: "Schlüssel abholen",
      due_date: null,
      sales_id: adminId,
      contact_id: erika,
    },
    {
      text: "Treppenhaus kontrollieren",
      due_date: at(2),
      sales_id: null,
      company_id: nord,
    },
    ...(extra ? extra(ids) : []),
  ]);
  return ids;
};

const surface = (page: Page) => page.locator("[data-arbeitskorb]");
const rows = (page: Page) => surface(page).locator("li[data-work-id]");
const row = (page: Page, title: string) =>
  rows(page).filter({ hasText: title });
const groupHeadings = (page: Page) =>
  surface(page).locator("section > h2").allTextContents();

/** Rows rendered and the list's entry fade (M1, 220 ms) settled. */
const listSettled = async (page: Page) => {
  await expect(rows(page).first()).toBeVisible();
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== "running"),
  );
};

const openArbeitskorb = async (page: Page, query = "") => {
  await page.goto(`/#/arbeitskorb${query}`);
  await listSettled(page);
};

const tab = (page: Page, name: "Meine Arbeit" | "Team") =>
  page.getByRole("tab", { name, exact: true });

const historyLength = (page: Page) => page.evaluate(() => history.length);

const box = async (locator: Locator) => {
  const value = await locator.boundingBox();
  if (!value) throw new Error("element has no box");
  return value;
};

// ---------------------------------------------------------------------------
// Desktop
// ---------------------------------------------------------------------------

test.describe("desktop", () => {
  test.skip(({ isMobile }) => isMobile, "desktop surface");

  test("entry, structure, server groups, names, links and the URL view", async ({
    page,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    loginAsAdmin,
  }) => {
    const ids = await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
    });
    await loginAsAdmin(e2eAdmin);

    // §14: fourth primary entry, between Startseite and Kunden.
    const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
    await expect(nav.getByRole("link")).toHaveText([
      "Startseite",
      "Arbeitskorb",
      "Kunden",
      "Vorgänge",
    ]);
    await nav.getByRole("link", { name: "Arbeitskorb" }).click();
    await expect(page).toHaveURL(/\/#\/arbeitskorb$/);
    await expect(rows(page).first()).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Arbeitskorb" }),
    ).toHaveAttribute("aria-current", "page");

    // AC-21: one main, one page h1 inside it, h2 + ol per group.
    await expect(page.locator("main")).toHaveCount(1);
    await expect(
      page.locator("main h1").filter({ hasText: /^Arbeitskorb$/ }),
    ).toHaveCount(1);
    expect(await groupHeadings(page)).toEqual([
      "Überfällig",
      "Heute",
      "Demnächst",
      "Ohne Fälligkeit",
    ]);
    await expect(surface(page).locator("section > ol")).toHaveCount(4);
    for (const section of await surface(page).locator("section").all()) {
      const headingId = await section.locator("h2").getAttribute("id");
      expect(await section.getAttribute("aria-labelledby")).toBe(headingId);
    }
    await expect(page.getByRole("tablist")).toHaveCount(1);
    const mine = tab(page, "Meine Arbeit");
    await expect(mine).toHaveAttribute("aria-selected", "true");
    const panelId = await mine.getAttribute("aria-controls");
    await expect(page.locator(`[id="${panelId}"]`)).toHaveAttribute(
      "role",
      "tabpanel",
    );

    // Server order and the incomplete row at its position (AC-03, AC-08).
    await expect(rows(page)).toHaveCount(5);
    const texts = await rows(page).allTextContents();
    expect(texts[0]).toContain("Dachrinne prüfen");
    expect(texts[1]).toContain("Angebot nachfassen");
    expect(texts[2]).toContain("Fenster reinigen");
    expect(texts[3]).toContain("Ohne Bezeichnung");
    expect(texts[3]).toContain("Unvollständig");
    expect(texts[4]).toContain("Schlüssel abholen");
    // Spoken urgency: group word + long date in the row text (§13.2).
    await expect(row(page, "Dachrinne prüfen")).toContainText(
      /Überfällig, \w+, \d+\. \w+ \d{4}/,
    );

    // AC-10 (E): real names under the employee session.
    await expect(row(page, "Dachrinne prüfen")).toContainText(
      "Hausverwaltung Sonnenhof",
    );
    await expect(row(page, "Dachrinne prüfen")).toContainText("Erika Muster");
    await expect(row(page, "Angebot nachfassen")).toContainText(
      "Fensterbau Nord",
    );
    await expect(row(page, "Angebot nachfassen")).toContainText("Anruf");

    // AC-12: no Work time anywhere in date, meta or holder areas.
    for (const item of await rows(page).all()) {
      const title =
        (await item.locator("[id^='arbeitskorb-titel-']").textContent()) ?? "";
      const text = ((await item.textContent()) ?? "").replace(title, "");
      expect(text).not.toMatch(TIME);
    }

    // AC-13: context links are real anchors, described by the row title.
    const dachrinne = row(page, "Dachrinne prüfen");
    const customerLink = dachrinne.getByRole("link", {
      name: /Hausverwaltung Sonnenhof/,
    });
    const contactLink = dachrinne.getByRole("link", { name: /Erika Muster/ });
    expect(await customerLink.getAttribute("href")).toMatch(
      new RegExp(`#/kunden/${ids.sonnenhof}/show/tasks$`),
    );
    expect(await contactLink.getAttribute("href")).toMatch(
      new RegExp(`#/kontakte/${ids.erika}/show$`),
    );
    const describedBy = await customerLink.getAttribute("aria-describedby");
    await expect(page.locator(`[id="${describedBy}"]`)).toHaveText(
      "Dachrinne prüfen",
    );
    await expect(customerLink).toHaveAccessibleName(
      "Kunde: Hausverwaltung Sonnenhof",
    );
    expect(
      await dachrinne.evaluate(
        (li) => li.getAttribute("onclick") === null && li.tagName === "LI",
      ),
    ).toBe(true);
    await expect(surface(page).locator("a button, button a")).toHaveCount(0);

    // AC-05: view switch by replace, holder only in Team, reload keeps it.
    const before = await historyLength(page);
    await tab(page, "Team").click();
    await expect(page).toHaveURL(/\/#\/arbeitskorb\?sicht=team$/);
    expect(await historyLength(page)).toBe(before);
    await expect(row(page, "Treppenhaus kontrollieren")).toContainText(
      "Nicht zugewiesen",
    );
    await expect(row(page, "Dachrinne prüfen")).toContainText("Ich");
    await page.reload();
    await expect(tab(page, "Team")).toHaveAttribute("aria-selected", "true");
    await expect(rows(page)).toHaveCount(6);

    // Invalid view → mine, normalized by replace; nothing in storage.
    await page.goto("/#/arbeitskorb?sicht=xyz&foo=1");
    await expect(page).toHaveURL(/\/#\/arbeitskorb\?foo=1&sicht=mine$/);
    await expect(tab(page, "Meine Arbeit")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    const storage = await page.evaluate(() =>
      JSON.stringify({ ...localStorage, ...sessionStorage }),
    );
    expect(storage).not.toMatch(/sicht=|"sicht"|Dachrinne|cursor|arbeitskorb/i);
  });

  test("keyboard order, arrow-key view switch and focus on load more", async ({
    page,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    loginAsAdmin,
  }) => {
    await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
      extra: ({ sonnenhof }) =>
        Array.from({ length: 50 }, (_, index) => ({
          text: `Reinigung Etage ${String(index + 1).padStart(2, "0")}`,
          due_date: at(10 + index),
          sales_id: e2eAdmin.id,
          company_id: sonnenhof,
        })),
    });
    await loginAsAdmin(e2eAdmin);
    await openArbeitskorb(page);

    // AC-19: tabs → refresh → tab panel → first context link.
    await tab(page, "Meine Arbeit").focus();
    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Team")).toBeFocused();
    await expect(tab(page, "Team")).toHaveAttribute("aria-selected", "true");
    await expect(page).toHaveURL(/sicht=team/);
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "Meine Arbeit")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(rows(page).first()).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(
      page.getByRole("button", { name: "Arbeitskorb aktualisieren" }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("tabpanel")).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      row(page, "Dachrinne prüfen").getByRole("link").first(),
    ).toBeFocused();

    // 55 own rows: page 1 has 50, "Weitere laden" appends the rest (AC-07).
    await expect(rows(page)).toHaveCount(50);
    await expect(surface(page)).toContainText(
      "50 Aufgaben geladen · weitere vorhanden",
    );
    const more = page.getByRole("button", { name: "Weitere laden" });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(rows(page)).toHaveCount(55);
    // AC-20: focus moves to the first appended row's first context link.
    await expect(rows(page).nth(50).getByRole("link").first()).toBeFocused();
    await expect(surface(page)).toContainText(
      "Alle 55 offenen Aufgaben angezeigt",
    );
    await expect(more).toHaveCount(0);
  });

  test("customer link opens the task tab; back restores view and scroll", async ({
    page,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    loginAsAdmin,
  }) => {
    const ids = await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
      extra: ({ sonnenhof }) =>
        Array.from({ length: 30 }, (_, index) => ({
          text: `Wartung Haus ${String(index + 1).padStart(2, "0")}`,
          due_date: at(10 + index),
          sales_id: e2eAdmin.id,
          company_id: sonnenhof,
        })),
    });
    await loginAsAdmin(e2eAdmin);
    await openArbeitskorb(page, "?sicht=team");
    const target = row(page, "Wartung Haus 20");
    // Centre it: the fixed app header covers the top of the viewport.
    await target.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(200);

    // Keyboard activation: the fixed app header makes pointer retries that
    // re-scroll the row flaky; the link itself is the hit target (checked).
    const customerLink = target.getByRole("link", {
      name: /Hausverwaltung Sonnenhof/,
    });
    expect(
      await customerLink.evaluate((link) => {
        const r = link.getBoundingClientRect();
        return link.contains(
          document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2),
        );
      }),
    ).toBe(true);
    await customerLink.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(
      new RegExp(`#/kunden/${ids.sonnenhof}/show/tasks$`),
    );
    await expect(page.getByRole("tab", { selected: true })).toContainText(
      /Aufgabe/,
    );

    await page.goBack();
    await expect(page).toHaveURL(/\/#\/arbeitskorb\?sicht=team$/);
    await expect(tab(page, "Team")).toHaveAttribute("aria-selected", "true");
    await expect(row(page, "Wartung Haus 20")).toBeVisible();
    // AC-15: the snapshot renders at once from cache, scroll comes back.
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(scrolled - 80);
  });

  test("navigation keeps four entries unclipped at 768, 1024 and 1280 px", async ({
    page,
    e2eAdmin,
    loginAsAdmin,
  }) => {
    await loginAsAdmin(e2eAdmin);
    await page.goto("/#/arbeitskorb");
    for (const width of [768, 1024, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const nav = page.getByRole("navigation", { name: "Hauptnavigation" });
      const links = nav.getByRole("link");
      await expect(links).toHaveCount(4);
      const boxes = await Promise.all(
        (await links.all()).map((link) => box(link)),
      );
      const tops = new Set(boxes.map((b) => Math.round(b.y)));
      expect({ width, rows: tops.size }).toEqual({ width, rows: 1 });
      for (const link of await links.all()) {
        const clipped = await link.evaluate(
          (el) =>
            el.scrollWidth > el.clientWidth + 1 ||
            el.getBoundingClientRect().right > window.innerWidth,
        );
        expect({ width, clipped }).toEqual({ width, clipped: false });
      }
      expect(
        await page.evaluate(
          () =>
            document.documentElement.scrollWidth <=
            document.documentElement.clientWidth,
        ),
      ).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// Mobile
// ---------------------------------------------------------------------------

test.describe("mobile", () => {
  test.skip(({ isMobile }) => !isMobile, "mobile surface");

  test("start entry, unchanged bottom navigation, structure and touch targets", async ({
    page,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    createNotes,
    loginAsAdmin,
  }) => {
    const ids = await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
    });
    // Regular start state needs a contact note (no onboarding step).
    await createNotes({
      contactId: ids.erika,
      salesId: e2eAdmin.id,
      notes: [{ text: "Erste Notiz." }],
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(e2eAdmin);

    const entry = page.getByRole("link", { name: "Arbeitskorb", exact: true });
    await expect(entry).toBeVisible();
    expect((await box(entry)).height).toBeGreaterThanOrEqual(44);
    const bottomNav = page.locator("nav.fixed.bottom-0");
    const navItems = await bottomNav.locator("a, button").count();
    await entry.click();
    await expect(page).toHaveURL(/\/#\/arbeitskorb$/);
    await expect(rows(page).first()).toBeVisible();

    // §14: bottom navigation unchanged, nothing marked active here.
    await expect(bottomNav.locator("a, button")).toHaveCount(navItems);
    await expect(
      bottomNav.locator('[class*="bg-[var(--nora-brand-soft)]"]'),
    ).toHaveCount(0);

    // AC-21 mobile: one main; the page h1 in the header, outside main.
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.locator("header h1")).toHaveText("Arbeitskorb");
    await expect(page.locator("main h1")).toHaveCount(0);
    expect(await groupHeadings(page)).toEqual([
      "Überfällig",
      "Heute",
      "Demnächst",
      "Ohne Fälligkeit",
    ]);

    // AC-23 at 375 px.
    for (const target of [
      tab(page, "Meine Arbeit"),
      tab(page, "Team"),
      page.getByRole("button", { name: "Arbeitskorb aktualisieren" }),
      rows(page).first().getByRole("button"),
    ]) {
      const { height, width } = await box(target);
      expect(height).toBeGreaterThanOrEqual(44);
      expect(width).toBeGreaterThanOrEqual(44);
    }
    // Names are text in mobile rows, never links (§9).
    await expect(surface(page).locator("li a")).toHaveCount(0);
    await expect(row(page, "Dachrinne prüfen")).toContainText("Erika Muster");
  });

  test("read-only sheet, truthful context actions, history back", async ({
    page,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    loginAsAdmin,
  }) => {
    const ids = await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(e2eAdmin);
    await openArbeitskorb(page, "?sicht=team");

    const workRequests: string[] = [];
    page.on("request", (request) => {
      if (request.url().includes("/rpc/get_work_items")) {
        workRequests.push(request.url());
      }
    });

    // Contact + customer: "Kontakt öffnen" first, no hint (§9).
    const rowButton = row(page, "Dachrinne prüfen").getByRole("button");
    await expect(rowButton).toHaveAttribute("aria-haspopup", "dialog");
    await rowButton.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole("heading")).toHaveText("Dachrinne prüfen");
    await expect(sheet).toContainText("Zuständig:");
    const actions = sheet.getByRole("link");
    await expect(actions).toHaveCount(2);
    await expect(actions.nth(0)).toContainText("Kontakt öffnen");
    await expect(actions.nth(1)).toContainText("Kundenakte öffnen");
    await expect(sheet).not.toContainText(
      /Aufgabe öffnen|Aufgabe bearbeiten|Weiter zur Aufgabe/,
    );
    await expect(sheet).not.toContainText(
      "In der mobilen Ansicht zeigt die Kundenakte keine Aufgaben.",
    );
    const close = sheet.getByRole("button", { name: "Schließen" });
    // AC-23: sheet actions and close ≥ 48 px; no built-in English close.
    for (const target of [actions.nth(0), actions.nth(1), close]) {
      expect((await box(target)).height).toBeGreaterThanOrEqual(48);
    }
    await expect(sheet.getByRole("button", { name: "Close" })).toHaveCount(0);

    // Escape closes, focus returns to the row button (AC-19, AC-20).
    await page.keyboard.press("Escape");
    await expect(sheet).toHaveCount(0);
    await expect(rowButton).toBeFocused();

    // Keyboard open, "Schließen" closes.
    await page.keyboard.press("Enter");
    await expect(page.getByRole("dialog")).toBeVisible();
    await page.getByRole("button", { name: "Schließen" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(rowButton).toBeFocused();

    // Customer only: hint, no contact action.
    await row(page, "Angebot nachfassen").getByRole("button").click();
    await expect(page.getByRole("dialog")).toContainText(
      "In der mobilen Ansicht zeigt die Kundenakte keine Aufgaben.",
    );
    await expect(
      page.getByRole("dialog").getByRole("link", { name: /Kontakt öffnen/ }),
    ).toHaveCount(0);
    await page.keyboard.press("Escape");
    expect(workRequests).toEqual([]); // AC-14: the sheet asks for no Work.

    // Kontakt öffnen → contact record; back → Arbeitskorb in Team.
    await rowButton.click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: /Kontakt öffnen/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`#/kontakte/${ids.erika}/show$`));
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL(/\/#\/arbeitskorb\?sicht=team$/);
    await expect(tab(page, "Team")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // Kundenakte öffnen → customer record (no tab suffix on mobile).
    await row(page, "Dachrinne prüfen").getByRole("button").click();
    await page
      .getByRole("dialog")
      .getByRole("link", { name: /Kundenakte öffnen/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`#/kunden/${ids.sonnenhof}/show$`));
    await page.goBack();
    await expect(page).toHaveURL(/\/#\/arbeitskorb\?sicht=team$/);
  });

  test("back from a record restores view and scroll position", async ({
    page,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    loginAsAdmin,
  }) => {
    const ids = await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
      extra: ({ sonnenhof }) =>
        Array.from({ length: 50 }, (_, index) => ({
          text: `Wartung Haus ${String(index + 1).padStart(2, "0")}`,
          due_date: at(10 + index),
          sales_id: e2eAdmin.id,
          company_id: sonnenhof,
        })),
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(e2eAdmin);
    await openArbeitskorb(page, "?sicht=team");
    // 56 rows: page 1 holds 50, so "Weitere laden" exists (AC-23 at 375 px).
    const more = page.getByRole("button", { name: "Weitere laden" });
    const moreBox = await box(more);
    expect(moreBox.height).toBeGreaterThanOrEqual(44);
    expect(moreBox.width).toBeGreaterThanOrEqual(44);
    const target = row(page, "Wartung Haus 20").getByRole("button");
    await target.evaluate((element) =>
      element.scrollIntoView({ block: "center" }),
    );
    const scrolled = await page.evaluate(() => window.scrollY);
    expect(scrolled).toBeGreaterThan(200);

    await target.focus();
    await page.keyboard.press("Enter");
    await page
      .getByRole("dialog")
      .getByRole("link", { name: /Kundenakte öffnen/ })
      .click();
    await expect(page).toHaveURL(new RegExp(`#/kunden/${ids.sonnenhof}/show$`));

    await page.goBack();
    await expect(page).toHaveURL(/\/#\/arbeitskorb\?sicht=team$/);
    await expect(tab(page, "Team")).toHaveAttribute("aria-selected", "true");
    await expect(row(page, "Wartung Haus 20")).toBeVisible();
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(scrolled - 80);
  });

  test("empty Meine Arbeit offers a Team button that switches by replace", async ({
    page,
    e2eAdmin,
    createCompany,
    createTasks,
    loginAsAdmin,
  }) => {
    const nord = (
      await createCompany({ name: "Fensterbau Nord", salesId: e2eAdmin.id })
    ).id;
    await createTasks([
      {
        text: "Treppenhaus kontrollieren",
        due_date: at(2),
        sales_id: null,
        company_id: nord,
      },
    ]);
    await page.setViewportSize({ width: 375, height: 812 });
    await loginAsAdmin(e2eAdmin);
    await page.goto("/#/arbeitskorb?sicht=mine");
    await expect(
      page
        .getByRole("tabpanel")
        .getByText("Keine offenen Aufgaben in Meine Arbeit."),
    ).toBeVisible();
    const showTeam = page.getByRole("button", { name: "Team ansehen" });
    expect((await box(showTeam)).height).toBeGreaterThanOrEqual(44);
    const before = await historyLength(page);
    await showTeam.click();
    await expect(page).toHaveURL(/sicht=team$/);
    await expect(tab(page, "Team")).toBeFocused();
    expect(await historyLength(page)).toBe(before);
    await expect(row(page, "Treppenhaus kontrollieren")).toContainText(
      "Nicht zugewiesen",
    );
  });

  test("no horizontal overflow at 320, 375 and 390 px", async ({
    page,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    loginAsAdmin,
  }) => {
    await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
      extra: ({ nord }) => [
        {
          text: "Sehr langer Aufgabentitel mit Hausverwaltungsgesellschaftsbezeichnung und Fensterreinigungsauftragsnummer ohne Leerzeichenumbruchmöglichkeitsgarantie",
          due_date: at(4),
          sales_id: e2eAdmin.id,
          company_id: nord,
          type: "Besichtigungstermintyp",
        },
      ],
    });
    await loginAsAdmin(e2eAdmin);
    await openArbeitskorb(page, "?sicht=team");
    for (const width of [320, 375, 390]) {
      await page.setViewportSize({ width, height: 800 });
      await expect(rows(page).first()).toBeVisible();
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect({ width, overflow }).toEqual({ width, overflow: 0 });
    }
  });
});

// ---------------------------------------------------------------------------
// Both surfaces
// ---------------------------------------------------------------------------

test.describe("states", () => {
  test("a failing or refused Work query is never the empty state", async ({
    page,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    loginAsAdmin,
  }) => {
    await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
    });
    await loginAsAdmin(e2eAdmin);

    await page.route("**/rest/v1/rpc/get_work_items*", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ code: "XX000", message: "boom" }),
      }),
    );
    await page.goto("/#/arbeitskorb");
    await expect(
      page
        .getByRole("tabpanel")
        .getByText("Der Arbeitskorb konnte nicht geladen werden."),
    ).toBeVisible();
    await expect(page.getByText(/Keine offenen Aufgaben/)).toHaveCount(0);
    await expect(rows(page)).toHaveCount(0);

    await page.unroute("**/rest/v1/rpc/get_work_items*");
    await page.getByRole("button", { name: "Erneut versuchen" }).click();
    await expect(row(page, "Dachrinne prüfen")).toBeVisible();

    // A refusal on revalidation removes the snapshot (AC-09).
    await page.route("**/rest/v1/rpc/get_work_items*", (route) =>
      route.fulfill({
        status: 403,
        contentType: "application/json",
        body: JSON.stringify({
          code: "42501",
          details: "NORA_PERMISSION_DENIED",
          message: "permission denied",
        }),
      }),
    );
    await page
      .getByRole("button", { name: "Arbeitskorb aktualisieren" })
      .click();
    await expect(
      page
        .getByText(
          "Kein Zugriff auf den Arbeitskorb. Bitte neu anmelden, falls das unerwartet ist.",
        )
        .first(),
    ).toBeVisible();
    await expect(rows(page)).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Zur Startseite" }),
    ).toBeVisible();
  });

  test("offline keeps the snapshot and never loads as empty", async ({
    page,
    context,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    loginAsAdmin,
  }) => {
    await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
    });
    await loginAsAdmin(e2eAdmin);
    await openArbeitskorb(page, "?sicht=mine");

    await context.setOffline(true);
    expect(await page.evaluate(() => navigator.onLine)).toBe(false);
    await expect(surface(page)).toContainText(/Offline · Stand \d{2}:\d{2}/);
    await expect(rows(page)).toHaveCount(5);

    await tab(page, "Team").click();
    await expect(
      page
        .getByText(
          "Keine Verbindung. Der Arbeitskorb lädt, sobald Nora wieder online ist.",
        )
        .first(),
    ).toBeVisible();
    await expect(page.getByText(/Im Team sind keine/)).toHaveCount(0);

    await context.setOffline(false);
    await expect(row(page, "Treppenhaus kontrollieren")).toBeVisible();
  });

  test("reduced motion: no running animation, no transition in the surface", async ({
    page,
    isMobile,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    loginAsAdmin,
  }) => {
    await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
    });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loginAsAdmin(e2eAdmin);
    expect(
      await page.evaluate(
        () => matchMedia("(prefers-reduced-motion: reduce)").matches,
      ),
    ).toBe(true);
    await openArbeitskorb(page);

    const motion = () =>
      page.evaluate(() => {
        const roots = [
          ...document.querySelectorAll(
            '[data-arbeitskorb], [data-arbeitskorb-sheet], [data-slot="sheet-overlay"]',
          ),
        ];
        const inside = (node: Node | null) =>
          !!node && roots.some((root) => root === node || root.contains(node));
        const running = document.getAnimations().filter((animation) => {
          const target = (animation.effect as KeyframeEffect | null)?.target;
          return inside(target ?? null) && animation.playState === "running";
        }).length;
        const transitions = roots
          .flatMap((root) => [root, ...root.querySelectorAll("*")])
          .filter((element) =>
            getComputedStyle(element)
              .transitionDuration.split(",")
              .some((value) => parseFloat(value) > 0),
          ).length;
        return { running, transitions };
      });

    expect(await motion()).toEqual({ running: 0, transitions: 0 });
    await tab(page, "Team").click();
    await expect(row(page, "Treppenhaus kontrollieren")).toBeVisible();
    expect(await motion()).toEqual({ running: 0, transitions: 0 });
    if (isMobile) {
      await row(page, "Dachrinne prüfen").getByRole("button").click();
      await expect(page.getByRole("dialog")).toBeVisible();
      expect(await motion()).toEqual({ running: 0, transitions: 0 });
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await motion()).toEqual({ running: 0, transitions: 0 });
    }
    // The announcement still arrives without motion.
    await expect(surface(page).locator('[role="status"]')).toContainText(
      /Team: 6 offene Aufgaben/,
    );
  });

  test("contrast of urgency, meta, holder and status in light and dark", async ({
    page,
    isMobile,
    e2eAdmin,
    createCompany,
    createContact,
    createTasks,
    loginAsAdmin,
  }) => {
    await seedBasket({
      adminId: e2eAdmin.id,
      createCompany,
      createContact,
      createTasks,
    });
    // Reduced motion only removes the hover transition lag from the reading.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await loginAsAdmin(e2eAdmin);
    await openArbeitskorb(page, "?sicht=team");

    for (const theme of ["light", "dark"] as const) {
      await page.evaluate((mode) => {
        document.documentElement.classList.remove("light", "dark");
        document.documentElement.classList.add(mode);
      }, theme);
      for (const hover of [false, true]) {
        const overdue = row(page, "Dachrinne prüfen");
        if (hover) await overdue.hover();
        else await page.mouse.move(0, 0);
        const result = await page.evaluate(measureContrast, { isMobile });
        for (const [name, value] of Object.entries(result.text)) {
          expect
            .soft(value, `${theme} hover=${hover} text ${name}`)
            .toBeGreaterThanOrEqual(4.5);
        }
        for (const [name, value] of Object.entries(result.indicator)) {
          expect
            .soft(value, `${theme} hover=${hover} indicator ${name}`)
            .toBeGreaterThanOrEqual(3);
        }
        expect(result.tokens).toEqual({
          date: "--nora-accent-text",
          line: theme === "light" ? "--nora-accent-strong" : "--nora-accent",
          icon: theme === "light" ? "--nora-accent-strong" : "--nora-accent",
        });
      }
    }
  });
});

/**
 * Runs in the page. Contrast from computed colours (WCAG 2.x formula), with
 * oklch/oklab converted to sRGB through a 1×1 canvas and translucent
 * backgrounds composited over their ancestors down to an opaque ground.
 * Text pairs must reach 4.5:1, indicators 3:1 (docs/nora/26 §13.6, AC-25).
 */
function measureContrast({ isMobile }: { isMobile: boolean }) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  type Rgba = [number, number, number, number];
  const toRgba = (color: string): Rgba => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const over = (top: Rgba, bottom: Rgba): Rgba => {
    const a = top[3] + bottom[3] * (1 - top[3]);
    if (a === 0) return [0, 0, 0, 0];
    const mix = (i: number) =>
      (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a;
    return [mix(0), mix(1), mix(2), a];
  };
  const background = (element: Element): Rgba => {
    const layers: Rgba[] = [];
    for (let node: Element | null = element; node; node = node.parentElement) {
      const layer = toRgba(getComputedStyle(node).backgroundColor);
      if (layer[3] > 0) layers.push(layer);
      if (layer[3] >= 1) break;
    }
    let result: Rgba = toRgba(getComputedStyle(document.body).backgroundColor);
    if (result[3] < 1) result = over(result, [255, 255, 255, 1]);
    for (const layer of layers.reverse()) result = over(layer, result);
    return result;
  };
  const luminance = ([r, g, b]: Rgba) => {
    const channel = (v: number) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  };
  const ratio = (fg: Rgba, bg: Rgba) => {
    const solid = over(fg, bg);
    const [l1, l2] = [luminance(solid), luminance(bg)].sort((a, b) => b - a);
    return (l1 + 0.05) / (l2 + 0.05);
  };
  const textRatio = (element: Element | null) => {
    if (!element) return 0;
    return ratio(toRgba(getComputedStyle(element).color), background(element));
  };

  const overdueRow = [...document.querySelectorAll("li[data-work-id]")].find(
    (li) => li.textContent?.includes("Dachrinne prüfen"),
  )!;
  const teamRow = [...document.querySelectorAll("li[data-work-id]")].find(
    (li) => li.textContent?.includes("Fenster reinigen"),
  )!;
  const metaOf = (li: Element) =>
    li.querySelector(isMobile ? "button > span:nth-of-type(3)" : "p.mt-0\\.5");
  const holderOf = (li: Element) =>
    isMobile
      ? li.querySelector("button > span:last-of-type")
      : li.querySelector(":scope > p");
  const status = document.querySelector("[data-arbeitskorb] div.min-h-11 > p");
  const overdueDate = overdueRow.querySelector(
    ".nora-arbeitskorb-overdue-date",
  );
  const icon = document.querySelector(".nora-arbeitskorb-overdue-icon");

  const shadow = getComputedStyle(overdueRow).boxShadow;
  const lineColor = shadow.match(/^(.*?\))\s/)?.[1] ?? shadow;
  const rowBg = background(overdueRow);

  const rootStyle = getComputedStyle(document.documentElement);
  const tokenOf = (value: string, names: string[]) =>
    names.find((name) => {
      const token = rootStyle.getPropertyValue(name).trim();
      if (!token) return false;
      const a = toRgba(token);
      const b = toRgba(value);
      return a.every((channel, i) => Math.abs(channel - b[i]) <= 1);
    }) ?? value;
  const accentTokens = [
    "--nora-accent-text",
    "--nora-accent-strong",
    "--nora-accent",
  ];

  return {
    text: {
      overdueDate: textRatio(overdueDate),
      meta: textRatio(metaOf(overdueRow)),
      metaPlain: textRatio(metaOf(teamRow)),
      holder: textRatio(holderOf(teamRow)),
      status: textRatio(status),
    },
    indicator: {
      line: ratio(toRgba(lineColor), rowBg),
      icon: icon
        ? ratio(toRgba(getComputedStyle(icon).color), background(icon))
        : 0,
    },
    tokens: {
      date: tokenOf(getComputedStyle(overdueDate!).color, accentTokens),
      line: tokenOf(lineColor, accentTokens.slice(1)),
      icon: tokenOf(getComputedStyle(icon!).color, accentTokens.slice(1)),
    },
  };
}

// ---------------------------------------------------------------------------
// Business time zone (AC-11, E): identical dates in every browser zone.
// ---------------------------------------------------------------------------

const ZONE_CASES: { title: string; dueAt: string; expected: string }[] = [
  // 02:00 Berlin (the quick-capture artefact time).
  {
    title: "Zone 02 Uhr Berlin",
    dueAt: "2026-11-20T01:00:00Z",
    expected: "Fr., 20.11.2026",
  },
  // UTC date (19th) differs from the Berlin date (20th).
  {
    title: "Zone UTC-Tag",
    dueAt: "2026-11-19T23:30:00Z",
    expected: "Fr., 20.11.2026",
  },
  // Microseconds, last instant of a Berlin day.
  {
    title: "Zone Mikrosekunden",
    dueAt: "2026-11-03T22:59:59.999999Z",
    expected: "Di., 03.11.2026",
  },
  // Spring forward (Berlin 03:30 CEST) and fall back (02:30 CEST).
  {
    title: "Zone Sommerzeitbeginn",
    dueAt: "2027-03-28T01:30:00Z",
    expected: "So., 28.03.2027",
  },
  {
    title: "Zone Sommerzeitende",
    dueAt: "2027-10-31T00:30:00Z",
    expected: "So., 31.10.2027",
  },
  // New year in Berlin, still 31.12. in UTC.
  {
    title: "Zone Jahreswechsel",
    dueAt: "2026-12-31T23:30:00Z",
    expected: "Fr., 01.01.2027",
  },
];
const ZONES = [
  "Europe/Berlin",
  "UTC",
  "America/New_York",
  "Pacific/Kiritimati",
];

const datesInZone = async (
  browser: Browser,
  timezoneId: string,
  credentials: { email: string; password: string },
  baseURL: string,
) => {
  const context = await browser.newContext({
    timezoneId,
    locale: "de-DE",
    baseURL,
    viewport: { width: 1280, height: 900 },
  });
  try {
    const page = await context.newPage();
    await page.goto("/");
    // The zone must really be in effect before anything is measured.
    expect(
      await page.evaluate(
        () => Intl.DateTimeFormat().resolvedOptions().timeZone,
      ),
    ).toBe(timezoneId);
    await loginAsAdmin(page, credentials);
    await page.goto("/#/arbeitskorb");
    await expect(rows(page)).toHaveCount(ZONE_CASES.length);
    const result: Record<string, string> = {};
    for (const zoneCase of ZONE_CASES) {
      result[zoneCase.title] =
        (await row(page, zoneCase.title)
          .locator("span[aria-hidden='true']")
          .first()
          .textContent()) ?? "";
    }
    return result;
  } finally {
    await context.close();
  }
};

test.describe("business time zone", () => {
  test.skip(({ isMobile }) => isMobile, "zone proof runs once");

  test("the visible business date is identical in every browser zone", async ({
    browser,
    e2eAdmin,
    createCompany,
    createTasks,
    baseURL,
  }) => {
    const nord = (
      await createCompany({ name: "Fensterbau Nord", salesId: e2eAdmin.id })
    ).id;
    await createTasks(
      ZONE_CASES.map((zoneCase) => ({
        text: zoneCase.title,
        due_date: zoneCase.dueAt,
        sales_id: e2eAdmin.id,
        company_id: nord,
      })),
    );
    const expected = Object.fromEntries(
      ZONE_CASES.map((zoneCase) => [zoneCase.title, zoneCase.expected]),
    );
    for (const zone of ZONES) {
      const dates = await datesInZone(browser, zone, e2eAdmin, baseURL!);
      expect({ zone, dates }).toEqual({ zone, dates: expected });
    }
  });
});
