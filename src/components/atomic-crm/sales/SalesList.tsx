import { useRecordContext, CanAccess } from "ra-core";
import { CreateButton } from "@/components/admin/create-button";
import { DataTable } from "@/components/admin/data-table";
import { ExportButton } from "@/components/admin/export-button";
import { List } from "@/components/admin/list";
import { SearchInput } from "@/components/admin/search-input";

import { TopToolbar } from "../layout/TopToolbar";
import { NoraListBoundary } from "../misc/NoraListBoundary";
import type { Sale } from "../types";
import { EmployeeAccessStatus } from "./EmployeeAccessStatus";
import type { EmployeeAccessRecord } from "./employeeAccessContract";
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

/** Role is a role, not a status — plain text, no badge. */
const ROLE_LABEL: Record<string, string> = {
  admin: "Administrator",
  office: "Büro",
  viewer: "Lesen",
};

const RoleField = (_props: { label?: string | boolean }) => {
  const record = useRecordContext<Sale>();
  if (!record) return null;
  const label =
    ROLE_LABEL[record.role] ?? (record.administrator ? "Administrator" : "—");
  return <span className="text-sm text-muted-foreground">{label}</span>;
};

/**
 * Derived Nora-Zugang state (V1A). The value is computed on the server from
 * Supabase Auth + sales.disabled; nothing about it is stored on the row.
 * V1B shows it as glyph + word + restrained colour — never colour alone.
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
    <EmployeeAccessStatus
      state={access.accessState}
      showHint
      data-testid="sales-access-state"
    />
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
          <DataTable.Col label="Rolle">
            <RoleField />
          </DataTable.Col>
          <DataTable.Col label="Nora-Zugang">
            <AccessStateField statusById={byEmployeeId} isPending={isPending} />
          </DataTable.Col>
        </DataTable>
      </NoraListBoundary>
    </List>
  );
}
