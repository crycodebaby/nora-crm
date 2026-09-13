import { page } from "vitest/browser";
import { render } from "vitest-browser-react";
import { memoryStore } from "ra-core";
import { MemoryRouter, useLocation } from "react-router";
import cloneDeep from "lodash/cloneDeep";

import { CRM } from "../root/CRM";
import { createDataProvider } from "../providers/fakerest";
import { testI18nProvider } from "../providers/commons/i18nProvider";
import {
  buildCompany,
  buildContact,
  createCrmDb,
  createTestAuthProvider,
} from "@/test/StoryWrapper";
import type { Contact, ContactNote, Deal } from "../types";
import { FENS_PRODUCTION_RELEASE_TEMPLATE_CODE } from "../types/checklists";
import { defaultCurrency } from "../root/defaultConfiguration";
import { formatDealAmount } from "./dealUtils";

/**
 * W7-M1 — the mobile Vorgang-Detailroute.
 *
 * Before this wave the mobile surface registered no `deals` resource at all,
 * so every mobile entry point into a Vorgang (Hotboard-Karte, globale Suche,
 * Quick Capture, Deep Link, Legacy-Link) fell through to the ra-core catch-all
 * and rendered an empty main area. These tests drive the real `CRM` root at a
 * phone viewport against synthetic FakeRest data and assert the *fachlichen*
 * content of the Vorgang, not merely that a route matched — plus that no
 * mobile surface still links to the non-existent mobile Vorgangsliste, while
 * the desktop keeps both its Kanban and its dialog.
 */

const MOBILE_VIEWPORT = { width: 390, height: 844 };
const DESKTOP_VIEWPORT = { width: 1280, height: 900 };

const CASE_NUMBER = "VG-2026-000042";
const DEAL_TITLE = "Fensteraustausch Hinterhaus";
const COMPANY_NAME = "Fensterbau Nord GmbH";
const DEAL_DESCRIPTION = "Drei Fenster im Hinterhaus tauschen.";
const STAGE_LABEL = "Neue Anfrage";
const CATEGORY_LABEL = "Fensterservice";
/** Far enough out that the Nachfassen status never flips to today/overdue. */
const FOLLOW_UP_DATE = "2099-09-30";
const FOLLOW_UP_LABEL = "30. September 2099";

const COMPANY = buildCompany({
  id: 1,
  name: COMPANY_NAME,
  customer_number: "KD-000001",
  nb_contacts: 1,
  nb_deals: 1,
});

const CONTACT: Contact = buildContact({
  id: 1,
  first_name: "Ada",
  last_name: "Lovelace",
  company_id: 1,
  company_name: COMPANY_NAME,
});

/** MobileDashboard only reaches the Hotboard once at least one note exists. */
const CONTACT_NOTE: ContactNote = {
  id: 1,
  contact_id: 1,
  text: "Erstkontakt am Telefon.",
  date: "2026-09-01T09:00:00.000Z",
  sales_id: 0,
  status: "warm",
};

const DEAL: Deal = {
  id: 7,
  name: DEAL_TITLE,
  case_number: CASE_NUMBER,
  company_id: 1,
  contact_ids: [1],
  category: "fensterservice",
  stage: "neue-anfrage",
  description: DEAL_DESCRIPTION,
  amount: 4200,
  created_at: "2026-09-01T08:00:00.000Z",
  updated_at: "2026-09-01T08:00:00.000Z",
  expected_closing_date: FOLLOW_UP_DATE,
  sales_id: 0,
  index: 0,
};

/**
 * An open Produktionsfreigabe for the same Vorgang, so the Hotboard renders
 * its second Vorgang entry point (EP2) next to the Vorgangskarte (EP1).
 * FakeRest has no checklist collections by default — they are added here.
 */
const CHECKLIST_FIXTURES = {
  checklist_templates: [
    {
      id: "tpl-1",
      code: FENS_PRODUCTION_RELEASE_TEMPLATE_CODE,
      name: "Produktionsfreigabe Fenster",
      service_area_code: "FENS",
      is_active: true,
      version: 1,
      created_at: "2026-09-01T08:00:00.000Z",
      updated_at: "2026-09-01T08:00:00.000Z",
    },
  ],
  checklist_runs: [
    {
      id: "run-1",
      template_id: "tpl-1",
      deal_id: 7,
      service_area_code: "FENS",
      status: "open",
      started_at: "2026-09-02T08:00:00.000Z",
      created_at: "2026-09-02T08:00:00.000Z",
      updated_at: "2026-09-02T08:00:00.000Z",
    },
  ],
  checklist_run_items: [
    {
      id: "item-1",
      checklist_run_id: "run-1",
      label_snapshot: "Aufmaß freigegeben",
      is_required: true,
      is_checked: false,
      sort_index: 1,
      created_at: "2026-09-02T08:00:00.000Z",
      updated_at: "2026-09-02T08:00:00.000Z",
    },
  ],
};

/** Title of the Vorgang created live by the Quick Capture test (T5). */
const QUICK_CAPTURE_DEAL_TITLE = "Rolladen klemmt im Treppenhaus";

const DEAL_SHOW_PATH = "/vorgaenge/7/show";
const LEGACY_DEAL_SHOW_PATH = "/deals/7/show";

/** Reports the router location so navigation assertions are not guesswork. */
const LocationProbe = () => {
  const location = useLocation();
  return (
    <span data-testid="nora-location" style={{ display: "none" }}>
      {location.pathname}
    </span>
  );
};

const currentPath = () =>
  document.querySelector('[data-testid="nora-location"]')?.textContent ?? "";

/**
 * Text of the page body only. Deliberately excludes the notification card
 * stack: after a Quick Capture the success card repeats the Vorgang title and
 * the customer name, so asserting against the whole document would pass even
 * on a blank main area.
 */
const mainContentText = () =>
  document.getElementById("main-content")?.textContent ?? "";

/** Every rendered anchor that would land on the Vorgangsliste. */
const dealListLinkHrefs = (): string[] =>
  Array.from(document.querySelectorAll("a[href]"))
    .map((anchor) => (anchor.getAttribute("href") ?? "").replace(/[?#].*$/, ""))
    .filter((href) => href.endsWith("/vorgaenge") || href.endsWith("/deals"));

/**
 * Vorgänge for the empty-value facts (T10–T12). Only passed to the tests that
 * need them, so the Hotboard of every other test keeps exactly one Vorgang.
 * `amount` and `sales_id` are nullable in the database but not in the `Deal`
 * type, hence the casts.
 */
const DEAL_WITHOUT_AMOUNT: Deal = {
  ...DEAL,
  id: 8,
  case_number: "VG-2026-000043",
  name: "Dachrinne ohne Schätzung",
  amount: null as unknown as number,
};
const DEAL_WITH_ZERO_AMOUNT: Deal = {
  ...DEAL,
  id: 9,
  case_number: "VG-2026-000044",
  name: "Kulanz ohne Berechnung",
  amount: 0,
};
const DEAL_WITHOUT_SALES: Deal = {
  ...DEAL,
  id: 10,
  case_number: "VG-2026-000045",
  name: "Treppenhaus ohne Zuständigkeit",
  sales_id: null as unknown as Deal["sales_id"],
};
const EMPTY_VALUE_DEALS = [
  DEAL_WITHOUT_AMOUNT,
  DEAL_WITH_ZERO_AMOUNT,
  DEAL_WITHOUT_SALES,
];

const UNKNOWN = "—";
/** The regular formatting a real zero estimate must keep. */
const ZERO_AMOUNT_LABEL = formatDealAmount(0, defaultCurrency, {
  notation: "compact",
  minimumSignificantDigits: 3,
});
const AMOUNT_LABEL = "Budget";
const SALES_LABEL = "Assigned to";

/**
 * The rendered value of one Vorgang fact, located by its label — so an "—"
 * is attributed to the fact it belongs to, not found anywhere on the page.
 */
const factValue = (label: string): string | null => {
  const labelElement = Array.from(
    document.querySelectorAll(".nora-detail-label"),
  ).find((element) => element.textContent === label);
  return labelElement?.nextElementSibling?.textContent ?? null;
};

const renderCrm = async (
  initialEntries: string[] = ["/"],
  extraDeals: Deal[] = [],
) => {
  const dataProvider = createDataProvider({
    db: createCrmDb(
      cloneDeep({
        companies: [COMPANY],
        contacts: [CONTACT],
        contact_notes: [CONTACT_NOTE],
        deals: [DEAL, ...extraDeals],
        ...CHECKLIST_FIXTURES,
      }) as Parameters<typeof createCrmDb>[0],
    ),
    silent: true,
  });

  return await render(
    <MemoryRouter initialEntries={initialEntries}>
      <CRM
        dataProvider={dataProvider}
        authProvider={createTestAuthProvider()}
        i18nProvider={testI18nProvider}
        store={memoryStore()}
        disableTelemetry
      />
      <LocationProbe />
    </MemoryRouter>,
  );
};

/** The Hotboard card for the fixture Vorgang. */
const dealCard = () =>
  page.getByRole("button", { name: new RegExp(DEAL_TITLE) }).first();

/** Positive proof that the Vorgang detail really rendered, not just a route. */
const expectDealShowVisible = async () => {
  await expect.element(page.getByText(CASE_NUMBER).first()).toBeVisible();
  await expect.element(page.getByText(DEAL_TITLE).first()).toBeVisible();
  await expect.element(page.getByText(STAGE_LABEL).first()).toBeVisible();
};

beforeEach(() => {
  localStorage.clear();
});

describe("W7-M1 mobile Vorgang detail route", () => {
  beforeEach(async () => {
    await page.viewport(MOBILE_VIEWPORT.width, MOBILE_VIEWPORT.height);
  });

  /** T1 — the mobile route renders the fachlichen Kerninhalt of a Vorgang. */
  it("renders the Vorgang core content at /vorgaenge/:id/show", async () => {
    await renderCrm([DEAL_SHOW_PATH]);

    await expectDealShowVisible();

    // Kunde, Zuständigkeit, Ansprechpartner, nächster Kontakt, Beschreibung
    await expect.element(page.getByText(COMPANY_NAME).first()).toBeVisible();
    await expect.element(page.getByText("Anna Admin").first()).toBeVisible();
    await expect.element(page.getByText("Ada Lovelace").first()).toBeVisible();
    await expect.element(page.getByText(CATEGORY_LABEL).first()).toBeVisible();
    await expect
      .element(page.getByText(DEAL_DESCRIPTION).first())
      .toBeVisible();
    await expect.element(page.getByText(FOLLOW_UP_LABEL).first()).toBeVisible();
  });

  /** T3 — a cold deep link reaches the mobile page, not the desktop dialog. */
  it("serves a cold deep link with the mobile presentation", async () => {
    await renderCrm([DEAL_SHOW_PATH]);

    await expectDealShowVisible();

    // The mobile shell, not the desktop Vorgang dialog.
    await expect.element(page.getByRole("dialog")).not.toBeInTheDocument();
    await expect
      .element(page.getByRole("navigation", { name: "CRM navigation" }))
      .toBeVisible();

    // No Bearbeiten / Archivieren action: their targets do not exist on mobile.
    await expect
      .element(page.getByRole("link", { name: "Edit" }))
      .not.toBeInTheDocument();
    await expect
      .element(page.getByRole("button", { name: "Archive" }))
      .not.toBeInTheDocument();
  });

  /** T2 — Hotboard Vorgangskarte opens a real detail view, not a blank page. */
  it("opens the Vorgang from a Hotboard card", async () => {
    await renderCrm(["/"]);

    await expect.element(dealCard()).toBeVisible();
    await dealCard().click();

    await expect.poll(currentPath).toBe(DEAL_SHOW_PATH);
    await expectDealShowVisible();
  });

  /** T2 — the second Hotboard entry point: offene Produktionsfreigabe. */
  it("opens the Vorgang from a Hotboard Produktionsfreigabe", async () => {
    await renderCrm(["/"]);

    // The missing required checklist item only exists inside the
    // Produktionsfreigabe row, so clicking it identifies that row
    // unambiguously — every Hotboard button shares the same aria-label.
    const releaseRow = page.getByText(/Aufmaß freigegeben/).first();
    await expect.element(releaseRow).toBeVisible();
    await releaseRow.click();

    await expect.poll(currentPath).toBe(DEAL_SHOW_PATH);
    await expectDealShowVisible();
  });

  /** T4 — globale Suche über die VG-Nummer landet auf der Detailseite. */
  it("navigates from the mobile global search to the Vorgang", async () => {
    await renderCrm(["/"]);

    const searchButton = page.getByRole("button", { name: "Search…" });
    await expect.element(searchButton).toBeVisible();
    await searchButton.click();

    const input = page.getByRole("searchbox");
    await expect.element(input).toBeVisible();
    await input.fill(CASE_NUMBER);

    // A unique VG number is a direct hit — the search navigates on its own.
    await expect.poll(currentPath, { timeout: 5000 }).toBe(DEAL_SHOW_PATH);
    await expectDealShowVisible();
  });

  /** T6 — the legacy /deals/:id/show link redirects onto a working page. */
  it("redirects the legacy Vorgang link onto working content", async () => {
    await renderCrm([LEGACY_DEAL_SHOW_PATH]);

    await expect.poll(currentPath).toBe(DEAL_SHOW_PATH);
    await expectDealShowVisible();
  });

  /** T8 — mobile back leads to an existing view, never to /vorgaenge. */
  it("returns from the Vorgang to an existing view", async () => {
    await renderCrm(["/"]);

    await expect.element(dealCard()).toBeVisible();
    await dealCard().click();
    await expect.poll(currentPath).toBe(DEAL_SHOW_PATH);

    await page.getByRole("button", { name: "Back" }).first().click();

    await expect.poll(currentPath).toBe("/");
    expect(currentPath()).not.toBe("/vorgaenge");
    // The Startseite really rendered — the Vorgangskarte is back on screen.
    await expect.element(dealCard()).toBeVisible();
  });

  /** T5 — the real Quick Capture success redirect lands on a working page. */
  it("lands on the new Vorgang after a mobile Quick Capture", async () => {
    await renderCrm(["/"]);

    // Start the real mobile capture path: the "+" action in the bottom nav.
    await page.getByRole("button", { name: "Create" }).first().click();
    await page.getByRole("menuitem", { name: "Capture new inquiry" }).click();

    // Step 1 — capture a brand new customer.
    await page.getByRole("checkbox", { name: "Create new customer" }).click();
    await page.getByPlaceholder("Customer name").fill("Hausverwaltung Süd");
    await page.getByRole("button", { name: "Next" }).click();

    // Step 2 — an explicit "no contact" decision is a valid choice.
    await page
      .getByRole("button", { name: "Continue without a contact" })
      .click();
    await page.getByRole("button", { name: "Next" }).click();

    // Step 3 — the Vorgang itself; the category is prefilled.
    await page
      .getByRole("textbox", { name: "Name", exact: true })
      .fill(QUICK_CAPTURE_DEAL_TITLE);
    await page.getByRole("button", { name: "Save and open deal" }).click();

    // The success redirect must reach a real Vorgang detail page — asserted
    // against the page body, not the success notification card.
    await expect
      .poll(currentPath, { timeout: 10000 })
      .toMatch(/^\/vorgaenge\/\d+\/show$/);
    for (const expected of [
      QUICK_CAPTURE_DEAL_TITLE,
      "Hausverwaltung Süd",
      "Overview",
      STAGE_LABEL,
    ]) {
      await expect
        .poll(mainContentText, { timeout: 10000 })
        .toContain(expected);
    }
  });

  /** T8 — the links the Vorgang page itself offers must not be dead ends. */
  it("links from the Vorgang to the Kundenakte", async () => {
    await renderCrm([DEAL_SHOW_PATH]);
    await expectDealShowVisible();

    await page.getByRole("link", { name: COMPANY_NAME }).first().click();

    await expect.poll(currentPath).toBe("/kunden/1/show");
    await expect
      .poll(mainContentText)
      .toContain(COMPANY.customer_number as string);
  });

  /** T8 — same for the Ansprechpartner listed on the Vorgang. */
  it("links from the Vorgang to the Kontaktakte", async () => {
    await renderCrm([DEAL_SHOW_PATH]);
    await expectDealShowVisible();

    await page.getByRole("link", { name: "Ada Lovelace" }).first().click();

    await expect.poll(currentPath).toBe("/kontakte/1/show");
    await expect.poll(mainContentText).toContain("Ada Lovelace");
  });

  /** T7 — no reachable "Alle Vorgänge" dead link while no mobile list exists. */
  it("offers no link to the non-existent mobile Vorgangsliste", async () => {
    await renderCrm(["/"]);

    // Non-vacuous: the Hotboard really rendered before we assert an absence.
    await expect.element(dealCard()).toBeVisible();

    expect(dealListLinkHrefs()).toEqual([]);
  });

  /** T10 — a Vorgang without an estimate says "unknown", not "0 €". */
  it("shows a missing amount as unknown, not as zero", async () => {
    await renderCrm(
      [`/vorgaenge/${DEAL_WITHOUT_AMOUNT.id}/show`],
      EMPTY_VALUE_DEALS,
    );
    await expect
      .element(page.getByText(DEAL_WITHOUT_AMOUNT.case_number).first())
      .toBeVisible();

    await expect.poll(() => factValue(AMOUNT_LABEL)).toBe(UNKNOWN);
    expect(factValue(AMOUNT_LABEL)).not.toBe(ZERO_AMOUNT_LABEL);
  });

  /** T11 — a real zero estimate keeps its regular money formatting. */
  it("shows a real zero amount as a formatted amount", async () => {
    await renderCrm(
      [`/vorgaenge/${DEAL_WITH_ZERO_AMOUNT.id}/show`],
      EMPTY_VALUE_DEALS,
    );
    await expect
      .element(page.getByText(DEAL_WITH_ZERO_AMOUNT.case_number).first())
      .toBeVisible();

    await expect.poll(() => factValue(AMOUNT_LABEL)).toBe(ZERO_AMOUNT_LABEL);
    // NULL and ZERO are distinguishable: the zero label is a real amount.
    expect(ZERO_AMOUNT_LABEL).not.toBe(UNKNOWN);
    expect(ZERO_AMOUNT_LABEL).toContain("0");
  });

  /** T12 — no responsible employee renders the shared placeholder. */
  it("shows a missing responsible employee as unknown", async () => {
    await renderCrm(
      [`/vorgaenge/${DEAL_WITHOUT_SALES.id}/show`],
      EMPTY_VALUE_DEALS,
    );
    await expect
      .element(page.getByText(DEAL_WITHOUT_SALES.case_number).first())
      .toBeVisible();

    await expect.poll(() => factValue(SALES_LABEL)).toBe(UNKNOWN);
  });

  /** T13 — a missing Vorgang stays on its route with a safe error state. */
  it("keeps a missing Vorgang on a safe error state instead of the list", async () => {
    const missingPath = "/vorgaenge/999/show";
    await renderCrm([missingPath]);

    // The NoraShowBoundary error state, with its retry action. Filtered by
    // its message because the notification announcer is also role="alert".
    const errorState = page
      .getByRole("alert")
      .filter({ hasText: "The data could not be loaded right now." });
    await expect.element(errorState).toBeVisible();
    await expect
      .element(errorState.getByRole("button", { name: "Try again" }))
      .toBeVisible();

    // ra-core's default onError would already have redirected by now.
    expect(currentPath()).toBe(missingPath);
    expect(currentPath()).not.toBe("/vorgaenge");
    expect(currentPath()).not.toBe("/deals");

    // Not a blank dead end: the mobile navigation still offers the Startseite.
    const navigation = page.getByRole("navigation", { name: "CRM navigation" });
    await expect.element(navigation).toBeVisible();
    await navigation.getByRole("link", { name: "Dashboard" }).click();
    await expect.poll(currentPath).toBe("/");
    await expect.element(dealCard()).toBeVisible();
  });
});

describe("W7-M1 desktop regression", () => {
  beforeEach(async () => {
    await page.viewport(DESKTOP_VIEWPORT.width, DESKTOP_VIEWPORT.height);
  });

  /** T9 — the desktop keeps its Vorgang Kanban. */
  it("still renders the Vorgang Kanban at /vorgaenge", async () => {
    await renderCrm(["/vorgaenge"]);

    await expect.element(page.getByText(STAGE_LABEL).first()).toBeVisible();
    await expect.element(page.getByText(DEAL_TITLE).first()).toBeVisible();
  });

  /** T9 — the desktop keeps its Vorgang dialog with its Bearbeiten action. */
  it("still opens the Vorgang as a dialog with desktop actions", async () => {
    await renderCrm([DEAL_SHOW_PATH]);

    const dialog = page.getByRole("dialog");
    await expect.element(dialog).toBeVisible();
    await expect.element(dialog.getByText(CASE_NUMBER)).toBeVisible();
    await expect.element(dialog.getByText(DEAL_TITLE)).toBeVisible();
    await expect
      .element(dialog.getByRole("link", { name: "Edit" }))
      .toBeVisible();
  });

  /** T7 — the desktop "Alle Vorgänge" link must survive the mobile change. */
  it("keeps the Hotboard link to the Vorgangsliste", async () => {
    await renderCrm(["/"]);

    await expect.element(dealCard()).toBeVisible();

    expect(dealListLinkHrefs().length).toBeGreaterThan(0);
  });

  /** T10–T12 on desktop — the dialog consumes the same normalized facts. */
  it("shows a missing amount as unknown in the desktop dialog", async () => {
    await renderCrm(
      [`/vorgaenge/${DEAL_WITHOUT_AMOUNT.id}/show`],
      EMPTY_VALUE_DEALS,
    );
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect.poll(() => factValue(AMOUNT_LABEL)).toBe(UNKNOWN);
  });

  it("shows a real zero amount as a formatted amount in the desktop dialog", async () => {
    await renderCrm(
      [`/vorgaenge/${DEAL_WITH_ZERO_AMOUNT.id}/show`],
      EMPTY_VALUE_DEALS,
    );
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect.poll(() => factValue(AMOUNT_LABEL)).toBe(ZERO_AMOUNT_LABEL);
  });

  it("shows a missing responsible employee as unknown in the desktop dialog", async () => {
    await renderCrm(
      [`/vorgaenge/${DEAL_WITHOUT_SALES.id}/show`],
      EMPTY_VALUE_DEALS,
    );
    await expect.element(page.getByRole("dialog")).toBeVisible();
    await expect.poll(() => factValue(SALES_LABEL)).toBe(UNKNOWN);
  });
});
