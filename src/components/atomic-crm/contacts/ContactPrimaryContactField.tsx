/**
 * Hauptansprechpartner control of the contact form (Atomic Contact Primary
 * Intent, 2026-09-08).
 *
 * Shows the CURRENT holder for the selected customer next to the switch,
 * explains the replacement consequence inline (no modal), re-resolves the
 * holder whenever the customer changes (React Query keys the request by
 * customer, so a late response for a previous customer can never overwrite
 * the current one), and records what the user OBSERVED into a reserved form
 * field so the save carries an explicit intent with the expected holder.
 *
 * Pure orchestration — the business rule lives in
 * domain/contactPrimaryIntent.ts and the database command.
 */
import { useEffect, useRef } from "react";
import { useRecordContext, useTranslate } from "ra-core";
import { useFormContext, useWatch } from "react-hook-form";
import { BooleanInput } from "@/components/admin/boolean-input";

import type { Contact } from "../types";
import {
  CONTACT_PRIMARY_OBSERVED_FIELD,
  CONTACT_PRIMARY_ORIGINAL_FIELD,
  type PrimaryContactObservation,
  type PrimaryContactOriginal,
} from "../domain/contactPrimaryIntent";
import { useCurrentPrimaryContact } from "./useCurrentPrimaryContact";

const isBlankId = (value: unknown) =>
  value === undefined || value === null || value === "";

const sameId = (a: unknown, b: unknown) =>
  !isBlankId(a) && !isBlankId(b) && String(a) === String(b);

const contactDisplayName = (
  contact: Pick<Contact, "first_name" | "last_name">,
) =>
  [contact.first_name, contact.last_name]
    .filter((part) => part && String(part).trim() !== "")
    .join(" ")
    .trim();

export const ContactPrimaryContactField = ({
  mode,
}: {
  mode: "create" | "edit";
}) => {
  const translate = useTranslate();
  const record = useRecordContext<Contact>();
  const { setValue, getValues } = useFormContext();
  const companyId = useWatch({ name: "company_id" });
  const wantsPrimary = useWatch({ name: "is_primary" }) === true;
  // React Admin resets the form when the record arrives, which wipes hidden
  // helper fields set earlier — watch them and re-establish when missing.
  const originalField = useWatch({ name: CONTACT_PRIMARY_ORIGINAL_FIELD });
  const observedField = useWatch({ name: CONTACT_PRIMARY_OBSERVED_FIELD });
  const { holder, isLoading } = useCurrentPrimaryContact(companyId);

  const contactId = mode === "edit" ? (record?.id ?? null) : null;

  // Original state as loaded (edit only) — lets the transform tell
  // "stays primary" from "becomes primary" and "clears".
  const recordId = record?.id;
  const recordCompanyId = record?.company_id;
  const recordIsPrimary = record?.is_primary === true;
  // Re-established on every switch/customer change too: the record reset
  // happens once, but a later toggle must always find the original state.
  useEffect(() => {
    if (mode !== "edit" || recordId == null) return;
    const current = originalField as PrimaryContactOriginal | null | undefined;
    const original: PrimaryContactOriginal = {
      companyId: isBlankId(recordCompanyId) ? null : recordCompanyId!,
      isPrimary: recordIsPrimary,
    };
    if (
      current &&
      current.isPrimary === original.isPrimary &&
      ((current.companyId == null && original.companyId == null) ||
        sameId(current.companyId, original.companyId))
    ) {
      return;
    }
    setValue(CONTACT_PRIMARY_ORIGINAL_FIELD, original, {
      shouldDirty: false,
      shouldTouch: false,
    });
  }, [
    mode,
    recordId,
    recordCompanyId,
    recordIsPrimary,
    originalField,
    wantsPrimary,
    companyId,
    setValue,
  ]);

  // Customer changed while the form is open: the primary flag is relative to
  // the customer, so the switch resets and the old holder text goes away.
  const lastCompanyRef = useRef<unknown>(companyId);
  useEffect(() => {
    const previous = lastCompanyRef.current;
    if (
      sameId(previous, companyId) ||
      (isBlankId(previous) && isBlankId(companyId))
    ) {
      return;
    }
    lastCompanyRef.current = companyId;
    // blank → value is the initial load (edit record arriving, first pick on
    // create) — not a change the user made between two customers.
    if (isBlankId(previous)) {
      return;
    }
    if (getValues("is_primary") === true) {
      setValue("is_primary", false, { shouldDirty: true });
    }
    setValue(CONTACT_PRIMARY_OBSERVED_FIELD, null, { shouldDirty: false });
  }, [companyId, getValues, setValue]);

  // Record what the user observed for the CURRENT customer only.
  const holderId = holder ? holder.id : null;
  useEffect(() => {
    if (isBlankId(companyId) || isLoading) return;
    const current = observedField as
      | PrimaryContactObservation
      | null
      | undefined;
    if (
      current &&
      sameId(current.companyId, companyId) &&
      ((current.primaryContactId == null && holderId == null) ||
        sameId(current.primaryContactId, holderId))
    ) {
      return;
    }
    const observed: PrimaryContactObservation = {
      companyId,
      primaryContactId: holderId,
    };
    setValue(CONTACT_PRIMARY_OBSERVED_FIELD, observed, {
      shouldDirty: false,
      shouldTouch: false,
    });
  }, [companyId, holderId, isLoading, observedField, wantsPrimary, setValue]);

  if (isBlankId(companyId)) {
    return null;
  }

  const holderIsThisContact = holder != null && sameId(holder.id, contactId);
  const holderName = holder ? contactDisplayName(holder) : "";

  let statusText: string;
  let statusTone: "muted" | "emphasis" = "muted";
  if (isLoading) {
    statusText = translate("resources.contacts.primary.loading");
  } else if (holderIsThisContact) {
    statusText = translate("resources.contacts.primary.self");
  } else if (holder && wantsPrimary) {
    statusText = translate("resources.contacts.primary.replace", {
      name: holderName,
    });
    statusTone = "emphasis";
  } else if (holder) {
    statusText = translate("resources.contacts.primary.current", {
      name: holderName,
    });
  } else {
    statusText = translate("resources.contacts.primary.none");
  }

  return (
    <div className="flex flex-col gap-1" data-testid="contact-primary-field">
      <BooleanInput
        source="is_primary"
        helperText="resources.contacts.helper.is_primary"
        disabled={isLoading}
      />
      <p
        className={
          statusTone === "emphasis"
            ? "text-sm leading-5 text-foreground"
            : "text-sm leading-5 text-muted-foreground"
        }
        data-testid="contact-primary-status"
        data-tone={statusTone}
      >
        {statusText}
      </p>
    </div>
  );
};
