import { Truck, Users } from "lucide-react";
import { useGetIdentity, useTranslate } from "ra-core";
import { ToggleFilterButton } from "@/components/admin/toggle-filter-button";

import { FilterCategory } from "../filters/FilterCategory";
import { ResponsiveFilters } from "../misc/ResponsiveFilters";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { useIsMobile } from "@/hooks/use-mobile";

export const CompanyListFilter = () => {
  const { identity } = useGetIdentity();
  const { companySectors } = useConfigurationContext();
  const translate = useTranslate();
  const isMobile = useIsMobile();

  return (
    <ResponsiveFilters>
      <FilterCategory
        icon={<Truck className="h-4 w-4" />}
        label="resources.companies.filters.customer_type"
      >
        {companySectors.map((sector) => (
          <ToggleFilterButton
            className="w-auto md:w-full justify-between h-10 md:h-8"
            label={sector.label}
            key={sector.value}
            value={{ sector: sector.value }}
            size={isMobile ? "lg" : undefined}
          />
        ))}
      </FilterCategory>

      <FilterCategory
        icon={<Users className="h-4 w-4" />}
        label="resources.companies.fields.sales_id"
      >
        <ToggleFilterButton
          className="w-full justify-between h-10 md:h-8"
          label={translate("crm.common.me")}
          value={{ sales_id: identity?.id }}
          size={isMobile ? "lg" : undefined}
        />
      </FilterCategory>
    </ResponsiveFilters>
  );
};
