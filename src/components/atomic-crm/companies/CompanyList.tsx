import { useGetIdentity, useListContext, useTranslate } from "ra-core";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { ListPagination } from "@/components/admin/list-pagination";
import { SortButton } from "@/components/admin/sort-button";

import { TopToolbar } from "../layout/TopToolbar";
import { NoraCreateButton } from "../misc/NoraAccessActions";
import { NoraPageLoading } from "../misc/NoraPageLoading";import { CompanyEmpty } from "./CompanyEmpty";
import { CompanyListFilter } from "./CompanyListFilter";
import { ImageList } from "./GridList";

export const CompanyList = () => {
  const { identity } = useGetIdentity();
  if (!identity) return null;
  return (
    <List
      title={false}
      perPage={25}
      sort={{ field: "name", order: "ASC" }}
      actions={<CompanyListActions />}
      pagination={<ListPagination rowsPerPageOptions={[10, 25, 50, 100]} />}
    >
      <CompanyListLayout />
    </List>
  );
};

const CompanyListLayout = () => {
  const { data, isPending, filterValues } = useListContext();
  const hasFilters = filterValues && Object.keys(filterValues).length > 0;

  if (isPending) return <NoraPageLoading variant="cards" />;  if (!data?.length && !hasFilters) return <CompanyEmpty />;

  return (
    <div className="w-full flex flex-col md:flex-row gap-4 md:gap-8">
      <CompanyListFilter />
      <div className="flex flex-col flex-1 gap-4 min-w-0">
        <ImageList />
      </div>
    </div>
  );
};

const CompanyListActions = () => {
  const translate = useTranslate();
  return (
    <TopToolbar className="w-full">
      <div className="flex items-center gap-1 mr-auto">
        <SortButton fields={["name", "created_at", "nb_contacts"]} />
      </div>
      <div className="flex items-center gap-1 border-r border-border pr-3 mr-3">
        <ExportButton />
      </div>
      <NoraCreateButton
        resource="companies"
        label={translate("resources.companies.action.new", {
          _: "New Company",
        })}
      />    </TopToolbar>
  );
};
