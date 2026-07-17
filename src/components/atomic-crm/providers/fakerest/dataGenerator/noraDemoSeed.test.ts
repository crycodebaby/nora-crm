/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import generateData from "./index";
import {
  DUesseldorf_COMPANY_SEEDS,
  DUesseldorf_CONTACT_SEEDS,
  DUesseldorf_DEAL_SEEDS,
  DUesseldorf_TASK_SEEDS,
} from "./noraDuesseldorfSeedData";

describe("Nora Düsseldorf demo seed", () => {
  const db = generateData();

  it("generates expected entity counts", () => {
    expect(db.companies).toHaveLength(25);
    expect(db.contacts).toHaveLength(30);
    expect(db.deals).toHaveLength(20);
    expect(db.tasks).toHaveLength(20);
    expect(db.contact_notes.length).toBeGreaterThanOrEqual(8);
    expect(db.deal_notes.length).toBeGreaterThanOrEqual(4);
  });

  it("assigns KD and VG numbers in Nora format", () => {
    expect(db.companies[0]?.customer_number).toMatch(/^KD-\d{6}$/);
    expect(db.deals[0]?.case_number).toMatch(/^VG-\d{4}-\d{6}$/);
  });

  it("covers customer without contacts (WEG Königsallee)", () => {
    const weg = db.companies.find((c) => c.name === "WEG Königsallee 12");
    expect(weg).toBeDefined();
    expect(db.contacts.filter((c) => c.company_id === weg?.id)).toHaveLength(0);
  });

  it("covers customer with multiple contacts", () => {
    const rheinbogen = db.companies.find(
      (c) => c.name === "Rheinbogen Immobilienservice GmbH",
    );
    expect(
      db.contacts.filter((c) => c.company_id === rheinbogen?.id).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("covers contact without email but with phone", () => {
    const hansen = db.contacts.find((c) => c.last_name === "Hansen");
    expect(hansen?.email_jsonb).toHaveLength(0);
    expect(hansen?.phone_jsonb.length).toBeGreaterThan(0);
  });

  it("covers deal without order value", () => {
    const noAmount = db.deals.find((d) => d.amount === 0);
    expect(noAmount).toBeDefined();
    expect(noAmount?.stage).toBe("wartet-auf-hersteller");
  });

  it("covers overdue follow-up deal for hotboard", () => {
    const overdue = db.deals.find(
      (d) => d.name.includes("Hotelzimmer") && d.stage === "nachfassen",
    );
    expect(overdue).toBeDefined();
    expect(overdue!.expected_closing_date < new Date().toISOString().slice(0, 10)).toBe(
      true,
    );
  });

  it("includes duplicate-test customers (Becker, Schneider)", () => {
    const beckerNames = db.companies.filter((c) =>
      c.name.toLowerCase().includes("becker"),
    );
    expect(beckerNames.length).toBeGreaterThanOrEqual(2);

    const sharedEmailContacts = db.contacts.filter(
      (c) => c.email_jsonb[0]?.email === "sabine.becker@nora-demo.local",
    );
    expect(sharedEmailContacts.length).toBe(2);
  });

  it("uses only existing deal stages and categories", () => {
    const stages = new Set(db.deals.map((d) => d.stage));
    const allowedStages = [
      "neue-anfrage",
      "kontaktiert",
      "termin-vereinbart",
      "aufmass-geplant",
      "aufmass-erledigt",
      "in-kalkulation",
      "wartet-auf-hersteller",
      "angebot-gesendet",
      "nachfassen",
      "angenommen",
      "abgelehnt",
      "abgeschlossen",
    ];
    for (const stage of stages) {
      expect(allowedStages).toContain(stage);
    }

    const categories = new Set(db.deals.map((d) => d.category));
    const allowedCategories = [
      "hausmeisterdienst",
      "fensterservice",
      "reparatur",
      "wartung",
      "sonstiges",
    ];
    for (const category of categories) {
      expect(allowedCategories).toContain(category);
    }
  });

  it("seed source arrays match generator output counts", () => {
    expect(DUesseldorf_COMPANY_SEEDS).toHaveLength(25);
    expect(DUesseldorf_CONTACT_SEEDS).toHaveLength(30);
    expect(DUesseldorf_DEAL_SEEDS).toHaveLength(20);
    expect(DUesseldorf_TASK_SEEDS).toHaveLength(20);
  });

  describe("realistic order values", () => {
    const FENSTER_MAX = 20_000;
    const HAUSMEISTER_MAX = 6_000;
    const PIPELINE_MIN = 60_000;
    const PIPELINE_MAX = 120_000;

    it("keeps fensterservice deals within demo ceiling", () => {
      for (const deal of db.deals.filter((d) => d.category === "fensterservice")) {
        expect(deal.amount).toBeLessThanOrEqual(FENSTER_MAX);
      }
    });

    it("keeps hausmeisterdienst deals within plausible range", () => {
      for (const deal of db.deals.filter(
        (d) => d.category === "hausmeisterdienst",
      )) {
        expect(deal.amount).toBeLessThanOrEqual(HAUSMEISTER_MAX);
      }
    });

    it("has no negative amounts", () => {
      for (const deal of db.deals) {
        expect(deal.amount).toBeGreaterThanOrEqual(0);
      }
    });

    it("includes at least one deal without calculated value", () => {
      expect(db.deals.some((d) => d.amount === 0)).toBe(true);
    });

    it("includes small, medium and larger orders", () => {
      const amounts = db.deals
        .map((d) => d.amount)
        .filter((amount) => amount > 0);
      expect(amounts.some((a) => a < 1_000)).toBe(true);
      expect(amounts.some((a) => a >= 1_000 && a < 5_000)).toBe(true);
      expect(amounts.some((a) => a >= 5_000)).toBe(true);
    });

    it("keeps total demo pipeline in a plausible band", () => {
      const total = db.deals.reduce((sum, deal) => sum + deal.amount, 0);
      expect(total).toBeGreaterThanOrEqual(PIPELINE_MIN);
      expect(total).toBeLessThanOrEqual(PIPELINE_MAX);
    });

    it("matches seed amounts in source data", () => {
      for (const seed of DUesseldorf_DEAL_SEEDS) {
        expect(db.deals.find((d) => d.id === seed.id)?.amount).toBe(
          seed.amountEur,
        );
      }
    });

    it("maps amountEur to deals.amount without cent conversion", () => {
      const seed = DUesseldorf_DEAL_SEEDS.find((s) => s.amountEur === 650);
      expect(seed).toBeDefined();
      const deal = db.deals.find((d) => d.id === seed!.id);
      expect(deal?.amount).toBe(650);
      expect(deal?.amount).not.toBe(6.5);
      expect(deal?.amount).not.toBe(65_000);
    });

    it("counts exactly 20 deals across categories", () => {
      expect(db.deals).toHaveLength(20);

      const byCategory = db.deals.reduce<Record<string, number>>(
        (acc, deal) => {
          acc[deal.category] = (acc[deal.category] ?? 0) + 1;
          return acc;
        },
        {},
      );

      expect(byCategory.fensterservice).toBe(13);
      expect(byCategory.hausmeisterdienst).toBe(4);
      expect(byCategory.reparatur).toBe(2);
      expect(byCategory.wartung).toBe(1);
      expect(
        Object.values(byCategory).reduce((sum, count) => sum + count, 0),
      ).toBe(20);
    });

    it("keeps total demo pipeline at 60.020 €", () => {
      const total = db.deals.reduce((sum, deal) => sum + deal.amount, 0);
      expect(total).toBe(60_020);
    });
  });
});
