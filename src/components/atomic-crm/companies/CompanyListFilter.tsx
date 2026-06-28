import { Truck, Users } from "lucide-react";
import { FilterLiveForm, useGetIdentity, useTranslate } from "ra-core";
import { ToggleFilterButton } from "@/components/admin/toggle-filter-button";
import { SearchInput } from "@/components/admin/search-input";

import { FilterCategory } from "../filters/FilterCategory";
import { useConfigurationContext } from "../root/ConfigurationContext";

export const CompanyListFilter = () => {
  const { identity } = useGetIdentity();
  const { companySectors } = useConfigurationContext();
  const translate = useTranslate();

  return (
    <div className="w-56 min-w-56 flex flex-col gap-8">
      <FilterLiveForm>
        <SearchInput source="q" />
      </FilterLiveForm>

      <FilterCategory
        icon={<Truck className="h-4 w-4" />}
        label="resources.companies.filters.customer_type"
      >
        {companySectors.map((sector) => (
          <ToggleFilterButton
            className="w-full justify-between"
            label={sector.label}
            key={sector.value}
            value={{ sector: sector.value }}
          />
        ))}
      </FilterCategory>

      <FilterCategory
        icon={<Users className="h-4 w-4" />}
        label="resources.companies.fields.sales_id"
      >
        <ToggleFilterButton
          className="w-full justify-between"
          label={translate("crm.common.me")}
          value={{ sales_id: identity?.id }}
        />
      </FilterCategory>
    </div>
  );
};
