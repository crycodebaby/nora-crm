/**
 * Contact Primary Intent — the framework-free domain model for the business
 * transition "this contact should (not) be the Hauptansprechpartner of this
 * customer" (Atomic Contact Primary Intent, 2026-09-08).
 *
 * `contacts.is_primary` is never written as a raw column by the UI anymore.
 * A contact save carries an explicit intent that the authoritative
 * application command (executeCreateContact / executeUpdateContact) hands
 * to the atomic RPC (public.create_contact / public.update_contact), which
 * applies the transition inside the same transaction as the contact write:
 *
 *   keep          → leave the primary state alone (create: ordinary contact)
 *   make_primary  → make this contact the customer's primary, replacing the
 *                   holder the user OBSERVED (stale-UI protection: the server
 *                   refuses when the actual holder differs)
 *   clear         → this contact stops being the primary
 *
 * The intent travels with the React Admin form data under a reserved key so
 * every form variant (full page, sheet) reaches the same provider entry; the
 * provider strips it before anything touches transport. No PostgreSQL
 * vocabulary leaks into UI components — the RPC mapping lives here.
 */

export type ContactIdentifier = string | number;

export type PrimaryContactIntent =
  | { kind: "keep" }
  | {
      kind: "make_primary";
      /** The current holder the user saw in the form — null = "none". */
      expectedCurrentPrimaryContactId: ContactIdentifier | null;
    }
  | { kind: "clear" };

export type PrimaryContactIntentKind = PrimaryContactIntent["kind"];

/** Reserved form-data key carrying the save intent to the data provider. */
export const CONTACT_SAVE_INTENT_FIELD = "__nora_contact_save" as const;

/** Reserved form-data key: the holder observed for the selected customer. */
export const CONTACT_PRIMARY_OBSERVED_FIELD =
  "__nora_primary_observed" as const;

/** Reserved form-data key (edit only): the contact's primary state as loaded. */
export const CONTACT_PRIMARY_ORIGINAL_FIELD =
  "__nora_primary_original" as const;

export type ContactSaveIntent = {
  primary: PrimaryContactIntent;
  /**
   * Client-owned write-intent id for CREATE (Idempotency Wave contract):
   * minted once per form session, stable across retries of the same
   * submit, distinct from the per-attempt operation id.
   */
  idempotencyKey?: string | null;
};

export type PrimaryContactObservation = {
  companyId: ContactIdentifier;
  primaryContactId: ContactIdentifier | null;
};

export type PrimaryContactOriginal = {
  companyId: ContactIdentifier | null;
  isPrimary: boolean;
};

export type ContactSaveMode = "create" | "edit";

const sameId = (a: unknown, b: unknown): boolean =>
  a != null && b != null && String(a) === String(b);

const isBlankId = (value: unknown): boolean =>
  value === undefined || value === null || value === "";

/**
 * Resolves the explicit intent from what the form knows.
 *
 * - No target customer → keep (the server forces is_primary = false).
 * - Switch ON: make_primary with the holder observed for the TARGET customer.
 *   An observation for a different customer is discarded (expected = null):
 *   the server still verifies, so a stale observation can never replace a
 *   newer holder silently — it can only be refused.
 * - Switch OFF: edit of a contact that was primary for the SAME customer →
 *   clear; otherwise keep (a customer move already drops the flag server-side).
 * - Edit, switch ON, contact already primary for the same customer → keep
 *   (nothing to transition).
 */
export const resolvePrimaryContactIntent = (input: {
  mode: ContactSaveMode;
  targetCompanyId: ContactIdentifier | null | undefined;
  wantsPrimary: boolean;
  observed?: PrimaryContactObservation | null;
  original?: PrimaryContactOriginal | null;
}): PrimaryContactIntent => {
  const { mode, targetCompanyId, wantsPrimary, observed, original } = input;

  if (isBlankId(targetCompanyId)) {
    return { kind: "keep" };
  }

  const sameCustomerAsOriginal =
    mode === "edit" &&
    original != null &&
    sameId(original.companyId, targetCompanyId);

  if (wantsPrimary) {
    if (sameCustomerAsOriginal && original?.isPrimary) {
      return { kind: "keep" };
    }
    const expected =
      observed != null && sameId(observed.companyId, targetCompanyId)
        ? (observed.primaryContactId ?? null)
        : null;
    return { kind: "make_primary", expectedCurrentPrimaryContactId: expected };
  }

  if (sameCustomerAsOriginal && original?.isPrimary) {
    return { kind: "clear" };
  }
  return { kind: "keep" };
};

type FormValues = Record<string, unknown>;

const readObserved = (value: unknown): PrimaryContactObservation | null => {
  if (!value || typeof value !== "object") return null;
  const v = value as { companyId?: unknown; primaryContactId?: unknown };
  if (isBlankId(v.companyId)) return null;
  return {
    companyId: v.companyId as ContactIdentifier,
    primaryContactId: isBlankId(v.primaryContactId)
      ? null
      : (v.primaryContactId as ContactIdentifier),
  };
};

const readOriginal = (value: unknown): PrimaryContactOriginal | null => {
  if (!value || typeof value !== "object") return null;
  const v = value as { companyId?: unknown; isPrimary?: unknown };
  return {
    companyId: isBlankId(v.companyId)
      ? null
      : (v.companyId as ContactIdentifier),
    isPrimary: v.isPrimary === true,
  };
};

/**
 * Form transform step: turns the form's helper fields + `is_primary` switch
 * into one explicit `ContactSaveIntent` on the data, and strips the helper
 * fields. `is_primary` stays on the data for backward-compatible callers and
 * tests, but the provider ignores it once an intent is present.
 */
export const attachContactSaveIntent = <T extends FormValues>(
  data: T,
  options: { mode: ContactSaveMode; idempotencyKey?: string | null },
): T & { [CONTACT_SAVE_INTENT_FIELD]: ContactSaveIntent } => {
  const {
    [CONTACT_PRIMARY_OBSERVED_FIELD]: observedRaw,
    [CONTACT_PRIMARY_ORIGINAL_FIELD]: originalRaw,
    ...rest
  } = data as FormValues;

  const primary = resolvePrimaryContactIntent({
    mode: options.mode,
    targetCompanyId: rest.company_id as ContactIdentifier | null | undefined,
    wantsPrimary: rest.is_primary === true,
    observed: readObserved(observedRaw),
    original: readOriginal(originalRaw),
  });

  const intent: ContactSaveIntent = { primary };
  if (options.mode === "create" && options.idempotencyKey) {
    intent.idempotencyKey = options.idempotencyKey;
  }

  return {
    ...(rest as T),
    [CONTACT_SAVE_INTENT_FIELD]: intent,
  };
};

/**
 * Provider entry: separates the save intent from the record payload. Returns
 * `intent = null` for callers that never attached one (bulk tag edits,
 * status changes, imports, note "last seen" bumps …).
 */
export const readContactSaveIntent = <T extends FormValues>(
  data: T,
): {
  payload: Omit<T, typeof CONTACT_SAVE_INTENT_FIELD>;
  intent: ContactSaveIntent | null;
} => {
  const {
    [CONTACT_SAVE_INTENT_FIELD]: raw,
    [CONTACT_PRIMARY_OBSERVED_FIELD]: _observed,
    [CONTACT_PRIMARY_ORIGINAL_FIELD]: _original,
    ...payload
  } = data as FormValues;
  void _observed;
  void _original;
  const intent = isContactSaveIntent(raw) ? raw : null;
  return {
    payload: payload as Omit<T, typeof CONTACT_SAVE_INTENT_FIELD>,
    intent,
  };
};

export const isPrimaryContactIntent = (
  value: unknown,
): value is PrimaryContactIntent => {
  if (!value || typeof value !== "object") return false;
  const kind = (value as { kind?: unknown }).kind;
  if (kind === "keep" || kind === "clear") return true;
  if (kind === "make_primary") {
    const expected = (value as { expectedCurrentPrimaryContactId?: unknown })
      .expectedCurrentPrimaryContactId;
    return (
      expected === null ||
      typeof expected === "number" ||
      typeof expected === "string"
    );
  }
  return false;
};

export const isContactSaveIntent = (
  value: unknown,
): value is ContactSaveIntent =>
  !!value &&
  typeof value === "object" &&
  isPrimaryContactIntent((value as { primary?: unknown }).primary);

/**
 * Conservative intent for a contact write that arrived WITHOUT an explicit
 * intent but with an `is_primary` value (older call sites). `true` becomes a
 * make_primary with no observed holder — the server accepts it only when the
 * customer has no primary yet and refuses otherwise; it can never silently
 * replace an existing Hauptansprechpartner.
 */
/**
 * The writable contact fields `public.create_contact` actually consumes —
 * the mirror of `nora_private.contact_create_fingerprint_payload`. Both sides
 * build the contact.create idempotency fingerprint from THIS projection, not
 * from raw client JSON, so two submits that differ only in keys the command
 * ignores anyway (view columns such as `company_name`/`nb_notes`, UI helper
 * fields) are recognized as the same business request and replay instead of
 * raising NORA_IDEMPOTENCY_CONFLICT (RC review 2026-09-08).
 *
 * `first_seen`/`last_seen` are deliberately absent: they are volatile client
 * timestamps defaulting to "now", so a genuine retry of one form submit must
 * still be recognized as a retry.
 */
export const CONTACT_CREATE_FINGERPRINT_FIELDS = [
  "avatar",
  "background",
  "company_id",
  "email_jsonb",
  "first_name",
  "gender",
  "has_newsletter",
  "last_name",
  "linkedin_url",
  "links_jsonb",
  "phone_jsonb",
  "sales_id",
  "status",
  "tags",
  "title",
] as const;

/** Canonical business projection of a contact.create payload (see above). */
export const contactCreateFingerprintPayload = (
  contact: Record<string, unknown>,
): Record<string, unknown> => {
  const canonical: Record<string, unknown> = {};
  for (const field of CONTACT_CREATE_FINGERPRINT_FIELDS) {
    canonical[field] = contact[field] ?? null;
  }
  return canonical;
};

export const derivePrimaryIntentFromLegacyData = (
  data: FormValues,
  mode: ContactSaveMode,
): PrimaryContactIntent | null => {
  if (!("is_primary" in data)) return null;
  if (data.is_primary === true) {
    return { kind: "make_primary", expectedCurrentPrimaryContactId: null };
  }
  return mode === "edit" ? { kind: "clear" } : { kind: "keep" };
};

/** RPC parameter mapping — the only place PostgreSQL vocabulary appears. */
export const toRpcPrimaryIntent = (
  intent: PrimaryContactIntent,
): {
  p_primary_intent: PrimaryContactIntentKind;
  p_expected_primary_contact_id: ContactIdentifier | null;
} => ({
  p_primary_intent: intent.kind,
  p_expected_primary_contact_id:
    intent.kind === "make_primary"
      ? intent.expectedCurrentPrimaryContactId
      : null,
});
