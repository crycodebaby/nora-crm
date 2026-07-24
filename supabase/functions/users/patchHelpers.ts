/** Pure helpers for users Edge Function PATCH — unit-testable in Node. */

export type NoraRole = "admin" | "office" | "viewer";

export function isNoraRole(value: unknown): value is NoraRole {
  return value === "admin" || value === "office" || value === "viewer";
}

export function isAdminSale(sale: {
  role?: NoraRole | string;
  administrator?: boolean;
}) {
  return sale.role === "admin" || sale.administrator === true;
}

/** Only returns a role when explicitly valid — never defaults to viewer. */
export function resolveExplicitRole(role: unknown): NoraRole | null {
  return isNoraRole(role) ? role : null;
}

export type PatchUserBody = {
  sales_id?: unknown;
  email?: unknown;
  first_name?: unknown;
  last_name?: unknown;
  avatar?: unknown;
  administrator?: unknown;
  disabled?: unknown;
  role?: unknown;
};

export type PatchPlan = {
  salesId: number;
  wantsRole: boolean;
  wantsDisabled: boolean;
  wantsName: boolean;
  wantsEmail: boolean;
  wantsAvatar: boolean;
  role: NoraRole | null;
  disabled: boolean | null;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  avatar: unknown;
};

export function buildPatchPlan(
  body: PatchUserBody,
): PatchPlan | { error: string } {
  const salesId = Number(body.sales_id);
  if (!Number.isFinite(salesId) || salesId <= 0) {
    return { error: "invalid_payload" };
  }

  const wantsRole = Object.prototype.hasOwnProperty.call(body, "role");
  const wantsDisabled = Object.prototype.hasOwnProperty.call(body, "disabled");
  const wantsFirst = Object.prototype.hasOwnProperty.call(body, "first_name");
  const wantsLast = Object.prototype.hasOwnProperty.call(body, "last_name");
  const wantsEmail = Object.prototype.hasOwnProperty.call(body, "email");
  const wantsAvatar = Object.prototype.hasOwnProperty.call(body, "avatar");
  const wantsAdministrator = Object.prototype.hasOwnProperty.call(
    body,
    "administrator",
  );

  // administrator alone is not a privilege patch without role/disabled
  void wantsAdministrator;

  let role: NoraRole | null = null;
  if (wantsRole) {
    role = resolveExplicitRole(body.role);
    if (!role) {
      return { error: "invalid_role" };
    }
  }

  let disabled: boolean | null = null;
  if (wantsDisabled) {
    if (typeof body.disabled !== "boolean") {
      return { error: "invalid_payload" };
    }
    disabled = body.disabled;
  }

  const firstName =
    wantsFirst && typeof body.first_name === "string"
      ? body.first_name.trim() || null
      : null;
  const lastName =
    wantsLast && typeof body.last_name === "string"
      ? body.last_name.trim() || null
      : null;
  const email =
    wantsEmail && typeof body.email === "string"
      ? body.email.trim() || null
      : null;

  const wantsName = Boolean(firstName || lastName);

  if (
    !wantsRole &&
    !wantsDisabled &&
    !wantsName &&
    !wantsEmail &&
    !wantsAvatar
  ) {
    return { error: "invalid_payload" };
  }

  return {
    salesId,
    wantsRole,
    wantsDisabled,
    wantsName,
    wantsEmail: Boolean(wantsEmail && email),
    wantsAvatar: Boolean(wantsAvatar && body.avatar),
    role,
    disabled,
    firstName,
    lastName,
    email,
    avatar: body.avatar,
  };
}

export function mapPostgresError(error: { code?: string; message?: string }): {
  status: number;
  error: string;
  message: string;
} {
  const code = error.code ?? "";
  const message = error.message ?? "";

  if (code === "42501" || /forbidden/i.test(message)) {
    return {
      status: 403,
      error: "role_update_forbidden",
      message: "Not authorized to change user roles",
    };
  }
  if (code === "22023" || /invalid role/i.test(message)) {
    return {
      status: 400,
      error: "invalid_role",
      message: "Invalid role",
    };
  }
  if (code === "P0002" || /not found/i.test(message)) {
    return {
      status: 404,
      error: "not_found",
      message: "User not found",
    };
  }
  return {
    status: 500,
    error: "internal_error",
    message: "Internal Server Error",
  };
}

/** Role-only patches must not call Auth Admin updateUserById. */
export function needsAuthAdminUpdate(plan: PatchPlan): boolean {
  return plan.wantsEmail || plan.wantsName || plan.wantsDisabled;
}
