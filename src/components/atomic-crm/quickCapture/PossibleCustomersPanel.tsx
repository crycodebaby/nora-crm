import { Loader2 } from "lucide-react";
import { useTranslate } from "ra-core";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

import { BusinessNumber } from "../misc/BusinessNumber";
import type { Company } from "../types";
import type { CustomerListEntry } from "./mergeCustomerSearchResults";

type PossibleCustomersPanelProps = {
  entries: CustomerListEntry[];
  isPending?: boolean;
  selectedCompanyId?: Company["id"];
  showPanel: boolean;
  onUseCompany: (company: Company) => void;
  onCreateNew: () => void;
  className?: string;
};

export const PossibleCustomersPanel = ({
  entries,
  isPending,
  selectedCompanyId,
  showPanel,
  onUseCompany,
  onCreateNew,
  className,
}: PossibleCustomersPanelProps) => {
  const translate = useTranslate();

  if (!showPanel) return null;

  const hasContent = isPending || entries.length > 0;

  return (
    <section
      className={cn(
        "rounded-md border border-border bg-card p-4 space-y-3",
        className,
      )}
      aria-live="polite"
    >
      <div className="space-y-1">
        <h3 className="text-sm font-semibold tracking-tight">
          {translate("crm.quick_capture.duplicates.possible_customers")}
        </h3>
        <p className="text-xs text-muted-foreground">
          {translate("crm.quick_capture.duplicates.possible_customers_hint")}
        </p>
      </div>

      {isPending ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
          <Loader2 className="size-4 animate-spin" />
          {translate("crm.common.loading")}
        </div>
      ) : null}

      {!isPending && hasContent ? (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li
              key={entry.company.id}
              className={cn(
                "rounded-md border border-border bg-background p-3 space-y-2.5",
                selectedCompanyId === entry.company.id &&
                  "border-[var(--nora-brand)]/40 bg-[var(--nora-brand-soft)]/30",
              )}
            >
              <div className="space-y-1.5">
                {entry.company.customer_number ? (
                  <BusinessNumber
                    value={entry.company.customer_number}
                    kind="customer"
                    size="md"
                    variant="badge"
                  />
                ) : null}
                <p className="text-sm font-semibold leading-snug">
                  {entry.company.name}
                </p>
              </div>

              {(entry.displayLocation ||
                entry.displayPhone ||
                entry.displayEmail) && (
                <div className="text-xs text-muted-foreground space-y-0.5">
                  {entry.displayLocation ? (
                    <p>{entry.displayLocation}</p>
                  ) : null}
                  {entry.displayPhone ? <p>{entry.displayPhone}</p> : null}
                  {entry.displayEmail ? <p>{entry.displayEmail}</p> : null}
                </div>
              )}

              {entry.reasons.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {entry.reasons.map((reason) => (
                    <Badge
                      key={reason}
                      variant="secondary"
                      className="text-[10px] font-normal px-2 py-0"
                    >
                      {translate(
                        `crm.quick_capture.duplicates.reasons.${reason}`,
                      )}
                    </Badge>
                  ))}
                </div>
              ) : null}

              <Button
                type="button"
                size="sm"
                variant="outline"
                className="nora-touch-target w-full sm:w-auto"
                onClick={() => onUseCompany(entry.company)}
              >
                {translate("crm.quick_capture.duplicates.use_this_customer")}
              </Button>
            </li>
          ))}
        </ul>
      ) : null}

      {!isPending && !entries.length ? (
        <p className="text-xs text-muted-foreground py-1">
          {translate("crm.search.no_results")}
        </p>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-9 px-2 text-muted-foreground w-full sm:w-auto"
        onClick={onCreateNew}
      >
        {translate("crm.quick_capture.duplicates.create_new_customer")}
      </Button>
    </section>
  );
};
