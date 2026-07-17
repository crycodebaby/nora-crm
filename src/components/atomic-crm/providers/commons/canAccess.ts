// FIXME: This should be exported from the ra-core package
type CanAccessParams<
  RecordType extends Record<string, any> = Record<string, any>,
> = {
  action: string;
  resource: string;
  record?: RecordType;
};

export type NoraRole = "admin" | "office" | "viewer";

const READ_ACTIONS = new Set([
  "list",
  "show",
  "read",
  "export",
  "getOne",
  "getList",
  "getMany",
  "getManyReference",
]);

const WRITE_ACTIONS = new Set([
  "create",
  "edit",
  "update",
  "write",
  "clone",
]);

const DELETE_ACTIONS = new Set(["delete", "remove"]);

const isReadAction = (action: string) => READ_ACTIONS.has(action);

const isWriteAction = (action: string) => WRITE_ACTIONS.has(action);

const isDeleteAction = (action: string) => DELETE_ACTIONS.has(action);

/** UI guard mirroring DB RLS — database remains authoritative. */
export const canAccess = <
  RecordType extends Record<string, any> = Record<string, any>,
>(
  role: NoraRole,
  params: CanAccessParams<RecordType>,
) => {
  const { action, resource } = params;

  if (resource === "google_calendar_connections") {
    return role === "admin" && isReadAction(action);
  }

  if (role === "admin") {
    return true;
  }

  if (resource === "sales" || resource === "configuration") {
    return false;
  }

  if (resource === "sales_directory") {
    return isReadAction(action);
  }

  if (resource === "audit_events") {
    if (role === "viewer") {
      return false;
    }
    if (role === "office") {
      if (action === "list") {
        return false;
      }
      return isReadAction(action);
    }
  }

  if (role === "viewer") {
    return isReadAction(action);
  }

  if (role === "office") {
    if (isDeleteAction(action)) {
      return false;
    }
    if (isReadAction(action) || isWriteAction(action)) {
      return true;
    }
    return false;
  }

  return false;
};

export const resolveNoraRole = (sale: {
  role?: NoraRole | null;
  administrator?: boolean;
}): NoraRole => {
  if (
    sale.role === "admin" ||
    sale.role === "office" ||
    sale.role === "viewer"
  ) {
    return sale.role;
  }
  return sale.administrator ? "admin" : "viewer";
};
