import { describe, expect, it } from "vitest";

import {
  CONTACT_PRIMARY_OBSERVED_FIELD,
  CONTACT_PRIMARY_ORIGINAL_FIELD,
  CONTACT_SAVE_INTENT_FIELD,
  attachContactSaveIntent,
  derivePrimaryIntentFromLegacyData,
  isContactSaveIntent,
  readContactSaveIntent,
  resolvePrimaryContactIntent,
  toRpcPrimaryIntent,
} from "./contactPrimaryIntent";

describe("resolvePrimaryContactIntent", () => {
  it("create: ordinary contact keeps, Hauptansprechpartner makes primary with the observed holder", () => {
    expect(
      resolvePrimaryContactIntent({
        mode: "create",
        targetCompanyId: 20,
        wantsPrimary: false,
      }),
    ).toEqual({ kind: "keep" });
    expect(
      resolvePrimaryContactIntent({
        mode: "create",
        targetCompanyId: 20,
        wantsPrimary: true,
        observed: { companyId: 20, primaryContactId: 29 },
      }),
    ).toEqual({ kind: "make_primary", expectedCurrentPrimaryContactId: 29 });
  });

  it("create: observed holder of a DIFFERENT customer is never reused as expected", () => {
    expect(
      resolvePrimaryContactIntent({
        mode: "create",
        targetCompanyId: 21,
        wantsPrimary: true,
        observed: { companyId: 20, primaryContactId: 29 },
      }),
    ).toEqual({ kind: "make_primary", expectedCurrentPrimaryContactId: null });
  });

  it("no customer → keep, regardless of the switch", () => {
    expect(
      resolvePrimaryContactIntent({
        mode: "create",
        targetCompanyId: null,
        wantsPrimary: true,
      }),
    ).toEqual({ kind: "keep" });
    expect(
      resolvePrimaryContactIntent({
        mode: "edit",
        targetCompanyId: "",
        wantsPrimary: false,
        original: { companyId: 20, isPrimary: true },
      }),
    ).toEqual({ kind: "keep" });
  });

  it("edit matrix: B make primary, C stay primary, D clear, E stay non-primary", () => {
    const observedNone = { companyId: 20, primaryContactId: null };
    // B: non-primary → ON
    expect(
      resolvePrimaryContactIntent({
        mode: "edit",
        targetCompanyId: 20,
        wantsPrimary: true,
        observed: { companyId: 20, primaryContactId: 29 },
        original: { companyId: 20, isPrimary: false },
      }),
    ).toEqual({ kind: "make_primary", expectedCurrentPrimaryContactId: 29 });
    // C: primary stays ON → nothing to transition
    expect(
      resolvePrimaryContactIntent({
        mode: "edit",
        targetCompanyId: 20,
        wantsPrimary: true,
        observed: { companyId: 20, primaryContactId: 29 },
        original: { companyId: 20, isPrimary: true },
      }),
    ).toEqual({ kind: "keep" });
    // D: primary → OFF
    expect(
      resolvePrimaryContactIntent({
        mode: "edit",
        targetCompanyId: 20,
        wantsPrimary: false,
        observed: observedNone,
        original: { companyId: 20, isPrimary: true },
      }),
    ).toEqual({ kind: "clear" });
    // E: non-primary stays OFF
    expect(
      resolvePrimaryContactIntent({
        mode: "edit",
        targetCompanyId: 20,
        wantsPrimary: false,
        original: { companyId: 20, isPrimary: false },
      }),
    ).toEqual({ kind: "keep" });
  });

  it("edit with customer change resolves against the TARGET customer (G keep, H make primary)", () => {
    // G: was primary at 20, moves to 21 with the switch off → keep (server drops the flag)
    expect(
      resolvePrimaryContactIntent({
        mode: "edit",
        targetCompanyId: 21,
        wantsPrimary: false,
        original: { companyId: 20, isPrimary: true },
      }),
    ).toEqual({ kind: "keep" });
    // H: moves to 21 and becomes its primary, replacing the holder observed at 21
    expect(
      resolvePrimaryContactIntent({
        mode: "edit",
        targetCompanyId: 21,
        wantsPrimary: true,
        observed: { companyId: 21, primaryContactId: 40 },
        original: { companyId: 20, isPrimary: true },
      }),
    ).toEqual({ kind: "make_primary", expectedCurrentPrimaryContactId: 40 });
  });

  it("compares ids as strings (react-admin may hand over string ids)", () => {
    expect(
      resolvePrimaryContactIntent({
        mode: "edit",
        targetCompanyId: "20",
        wantsPrimary: true,
        observed: { companyId: 20, primaryContactId: "29" },
        original: { companyId: "20", isPrimary: false },
      }),
    ).toEqual({ kind: "make_primary", expectedCurrentPrimaryContactId: "29" });
  });
});

describe("attachContactSaveIntent / readContactSaveIntent", () => {
  it("turns helper fields into one intent, strips the helpers, keeps the record fields", () => {
    const data = attachContactSaveIntent(
      {
        first_name: "Träumchen",
        company_id: 20,
        is_primary: true,
        [CONTACT_PRIMARY_OBSERVED_FIELD]: {
          companyId: 20,
          primaryContactId: 29,
        },
      },
      { mode: "create", idempotencyKey: "k-1" },
    );
    expect(data).not.toHaveProperty(CONTACT_PRIMARY_OBSERVED_FIELD);
    expect(data).not.toHaveProperty(CONTACT_PRIMARY_ORIGINAL_FIELD);
    expect(data.first_name).toBe("Träumchen");
    expect(data[CONTACT_SAVE_INTENT_FIELD]).toEqual({
      primary: { kind: "make_primary", expectedCurrentPrimaryContactId: 29 },
      idempotencyKey: "k-1",
    });

    const { payload, intent } = readContactSaveIntent(data);
    expect(intent).toEqual(data[CONTACT_SAVE_INTENT_FIELD]);
    expect(payload).toEqual({
      first_name: "Träumchen",
      company_id: 20,
      is_primary: true,
    });
  });

  it("edit never carries an idempotency key; original state drives clear", () => {
    const data = attachContactSaveIntent(
      {
        id: 29,
        company_id: 20,
        is_primary: false,
        [CONTACT_PRIMARY_ORIGINAL_FIELD]: { companyId: 20, isPrimary: true },
      },
      { mode: "edit", idempotencyKey: "ignored" },
    );
    expect(data[CONTACT_SAVE_INTENT_FIELD]).toEqual({
      primary: { kind: "clear" },
    });
  });

  it("readContactSaveIntent returns null for writes without an intent and ignores garbage", () => {
    expect(readContactSaveIntent({ status: "hot" }).intent).toBeNull();
    expect(
      readContactSaveIntent({
        [CONTACT_SAVE_INTENT_FIELD]: { primary: { kind: "promote" } },
      }).intent,
    ).toBeNull();
    expect(
      isContactSaveIntent({
        primary: {
          kind: "make_primary",
          expectedCurrentPrimaryContactId: undefined,
        },
      }),
    ).toBe(false);
    expect(
      isContactSaveIntent({
        primary: {
          kind: "make_primary",
          expectedCurrentPrimaryContactId: null,
        },
      }),
    ).toBe(true);
  });
});

describe("derivePrimaryIntentFromLegacyData", () => {
  it("is_primary true without an observation becomes a make_primary with no expected holder (server verifies)", () => {
    expect(
      derivePrimaryIntentFromLegacyData({ is_primary: true }, "create"),
    ).toEqual({
      kind: "make_primary",
      expectedCurrentPrimaryContactId: null,
    });
  });
  it("is_primary false → keep on create, clear on edit; absent → null", () => {
    expect(
      derivePrimaryIntentFromLegacyData({ is_primary: false }, "create"),
    ).toEqual({ kind: "keep" });
    expect(
      derivePrimaryIntentFromLegacyData({ is_primary: false }, "edit"),
    ).toEqual({ kind: "clear" });
    expect(
      derivePrimaryIntentFromLegacyData({ title: "x" }, "edit"),
    ).toBeNull();
  });
});

describe("toRpcPrimaryIntent", () => {
  it("maps the domain intent to the RPC parameters", () => {
    expect(toRpcPrimaryIntent({ kind: "keep" })).toEqual({
      p_primary_intent: "keep",
      p_expected_primary_contact_id: null,
    });
    expect(toRpcPrimaryIntent({ kind: "clear" })).toEqual({
      p_primary_intent: "clear",
      p_expected_primary_contact_id: null,
    });
    expect(
      toRpcPrimaryIntent({
        kind: "make_primary",
        expectedCurrentPrimaryContactId: 29,
      }),
    ).toEqual({
      p_primary_intent: "make_primary",
      p_expected_primary_contact_id: 29,
    });
  });
});
