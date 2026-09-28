import { MapPin } from "lucide-react";
import type { Deal } from "../types";

type SiteFields = Pick<
  Deal,
  "site_street" | "site_city" | "site_floor" | "site_tenant_name"
>;

export const DealSiteAddress = ({
  deal,
  className = "",
}: {
  deal: SiteFields;
  className?: string;
}) => {
  const street = deal.site_street?.trim();
  const city = deal.site_city?.trim();
  const floor = deal.site_floor?.trim();
  const tenant = deal.site_tenant_name?.trim();
  if (!street && !city && !floor && !tenant) return null;

  return (
    <span className={`flex min-w-0 items-start gap-1.5 ${className}`}>
      <MapPin className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 break-words leading-snug">
        <span className="block">
          <span className="sr-only">Einsatzort: </span>
          {[street, city].filter(Boolean).join(" · ")}
        </span>
        {floor || tenant ? (
          <span className="mt-0.5 block text-[0.92em] opacity-85">
            {[floor && `Etage ${floor}`, tenant && `Klingelschild ${tenant}`]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
      </span>
    </span>
  );
};
