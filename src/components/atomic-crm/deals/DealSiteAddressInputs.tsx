import { useEffect, useRef, useState } from "react";
import { useGetOne, useRecordContext } from "ra-core";
import { useFormContext, useWatch } from "react-hook-form";
import { X } from "lucide-react";

import { TextInput } from "@/components/admin/text-input";
import type { Company, Deal } from "../types";
import { NoraFormRow } from "../misc/NoraFormGroup";

const addressFields = [
  "site_street",
  "site_city",
  "site_floor",
  "site_tenant_name",
] as const;

/**
 * Einsatzort inputs — the frozen site-address contract (06, 2026-09-25).
 *
 * On create, the customer's street and city are *proposed* while no site
 * field was touched; any manual edit or a deliberate clear ends proposals
 * for this form. On edit nothing is proposed. Floor and tenant are never
 * proposed. Only the layout changed in Alpha UI 1; labels, accessible
 * names and the clear affordance are unchanged.
 */
export const DealSiteAddressInputs = () => {
  const record = useRecordContext<Deal>();
  const { control, setValue, getValues } = useFormContext<Deal>();
  const companyId = useWatch({ control, name: "company_id" });
  const floor = useWatch({ control, name: "site_floor" });
  const tenant = useWatch({ control, name: "site_tenant_name" });
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const showDetails = detailsExpanded || Boolean(floor || tenant);
  // A user edit (including clearing or undoing it) permanently ends suggestions
  // for this form. Programmatic suggestions do not count as user interaction.
  const manuallyEdited = useRef(
    addressFields.some((field) => Boolean(getValues(field))),
  );
  const previousCompanyId = useRef<string | null>(null);
  const { data: company } = useGetOne<Company>(
    "companies",
    { id: companyId },
    { enabled: record?.id == null && companyId != null },
  );

  useEffect(() => {
    if (
      record?.id != null ||
      manuallyEdited.current ||
      !company ||
      companyId == null
    )
      return;
    const key = String(companyId);
    if (String(company.id) !== key || previousCompanyId.current === key) return;
    previousCompanyId.current = key;
    setValue("site_street", company.address ?? "", { shouldDirty: true });
    setValue("site_city", company.city ?? "", { shouldDirty: true });
  }, [company, companyId, record?.id, setValue]);

  const clear = () => {
    manuallyEdited.current = true;
    addressFields.forEach((field) =>
      setValue(field, null, { shouldDirty: true, shouldTouch: true }),
    );
    setDetailsExpanded(false);
  };

  return (
    <div
      className="flex flex-col gap-3"
      onChangeCapture={() => {
        manuallyEdited.current = true;
      }}
    >
      <NoraFormRow cols="wide-narrow">
        <TextInput
          source="site_street"
          label="Straße und Hausnummer"
          helperText={false}
          placeholder="Straße und Hausnummer"
        />
        <div className="flex min-w-0 items-end gap-2">
          <TextInput
            source="site_city"
            label="Ort"
            helperText={false}
            placeholder="Ort"
            className="min-w-0 flex-1"
          />
          <button
            type="button"
            onClick={clear}
            aria-label="Einsatzadresse vollständig löschen"
            title="Einsatzadresse löschen"
            className="mb-px inline-flex size-11 shrink-0 items-center justify-center rounded-lg text-[var(--nora-text-muted)] hover:bg-destructive/10 hover:text-destructive focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--nora-accent-ring)]"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </NoraFormRow>
      {showDetails ? (
        <NoraFormRow cols="2">
          <TextInput
            source="site_floor"
            label="Etage"
            helperText={false}
            placeholder="Optional"
          />
          <TextInput
            source="site_tenant_name"
            label="Klingelschild / Mietername"
            helperText={false}
            placeholder="Optional"
          />
        </NoraFormRow>
      ) : (
        <button
          type="button"
          onClick={() => setDetailsExpanded(true)}
          className="min-h-9 w-fit rounded-md text-left text-[13px] font-medium text-[var(--nora-accent-text)] hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[var(--nora-accent-ring)]"
        >
          Etage oder Klingelschild ergänzen
        </button>
      )}
    </div>
  );
};
