import { useRecordContext, useTranslate, CanAccess } from "ra-core";
import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";
import { Badge } from "@/components/ui/badge";

import { TopToolbar } from "../layout/TopToolbar";
import { NoraListBoundary } from "../misc/NoraListBoundary";
import {
  EMPLOYEE_ACCESS_STATE_LABEL,
  type EmployeeAccessRecord,
} from "./employeeAccessContract";
import { useEmployeeAccessStatus } from "./useEmployeeAccessStatus";

const SalesListActions = () => (
  <TopToolbar>
    <ExportButton />
    <CanAccess resource="sales" action="create">
      <CreateButton label="resources.sales.action.new" />
    </CanAccess>
  </TopToolbar>
);

const filters = [<SearchInput source="q" alwaysOn />];

const OptionsField = (_props: { label?: string | boolean }) => {
  const record = useRecordContext();
  const translate = useTranslate();
  if (!record) return null;
  return (
    <div className="flex flex-row gap-1">
      {record.administrator && (
        <Badge
          variant="outline"
          className="border-blue-300 dark:border-blue-700"
        >
          {translate("resources.sales.fields.administrator")}
        </Badge>
      )}
      {record.disabled && (
        <Badge
          variant="outline"
          className="border-orange-300 dark:border-orange-700"
        >
          {translate("resources.sales.fields.disabled")}
        </Badge>
      )}
    </div>
  );
};

/**
 * Derived Nora-Zugang state (V1A). The value is computed on the server from
 * Supabase Auth + sales.disabled; nothing about it is stored on the row.
 */
const AccessStateField = ({
  statusById,
  isPending,
}: {
  statusById: Map<string, EmployeeAccessRecord>;
  isPending: boolean;
}) => {
  const record = useRecordContext();
  if (!record) return null;

  const access = statusById.get(String(record.id));
  if (!access) {
    return (
      <span className="text-sm text-muted-foreground">
        {isPending ? "…" : "—"}
      </span>
    );
  }

  return (
    <Badge variant="outline" data-testid="sales-access-state">
      {EMPLOYEE_ACCESS_STATE_LABEL[access.accessState]}
    </Badge>
  );
};

export function SalesList() {
  const { byEmployeeId, isPending } = useEmployeeAccessStatus();

  return (
    <List
      filters={filters}
      actions={<SalesListActions />}
      sort={{ field: "first_name", order: "ASC" }}
    >
      <NoraListBoundary>
        <DataTable>
          <DataTable.Col source="first_name" />
          <DataTable.Col source="last_name" />
          <DataTable.Col source="email" />
          <DataTable.Col label="Nora-Zugang">
            <AccessStateField statusById={byEmployeeId} isPending={isPending} />
          </DataTable.Col>
          <DataTable.Col label={false}>
            <OptionsField />
          </DataTable.Col>
        </DataTable>
      </NoraListBoundary>
    </List>
  );
}
