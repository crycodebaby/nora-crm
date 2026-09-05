import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";
import {
  buildPatchPlan,
  isAdminSale,
  isNoraRole,
  type NoraRole,
} from "./patchHelpers.ts";
import {
  buildEmployeeAccessRecord,
  isAdminActionAllowed,
  parseEmployeeAccessCommand,
  type EmployeeAccessRecord,
  type EmployeeAuthFacts,
} from "./accessState.ts";
import {
  executeAccessChange,
  LifecycleFailure,
  type LifecycleDeps,
  type LifecycleSaleRow,
} from "./lifecycle.ts";
import {
  AuditWriteFailure,
  recordEmployeeAdminEvent,
  resolveRequestOperationId,
  type EmployeeAuditDeps,
} from "./audit.ts";

function resolveInviteRedirectTo(): string {
  const siteUrl =
    Deno.env.get("SITE_URL") ??
    Deno.env.get("PUBLIC_SITE_URL") ??
    "https://nora.ergart.de";
  return `${siteUrl.replace(/\/$/, "")}/auth-callback.html`;
}

function resolveInviteRole(
  role: NoraRole | undefined,
  administrator: boolean | undefined,
): NoraRole {
  if (isNoraRole(role)) return role;
  return administrator ? "admin" : "viewer";
}

/* ------------------------------------------------------------------------ */
/* W3 — trusted audit path for the Edge-originated employee events           */
/* ------------------------------------------------------------------------ */

/**
 * Real adapter behind the audit port. The RPC is service_role-only in the
 * database and derives every snapshot itself; only the verified actor id,
 * the target, the event type, the operation id and the allowlisted `role`
 * key ever cross this boundary.
 */
const employeeAuditDeps: EmployeeAuditDeps = {
  recordEmployeeAdminEvent: async (input) => {
    const { error } = await supabaseAdmin.rpc("record_employee_admin_event", {
      p_actor_user_id: input.actorUserId,
      p_sale_id: input.salesId,
      p_event_type: input.eventType,
      p_operation_id: input.operationId,
      p_metadata: input.metadata,
    });
    if (error) throw error;
  },
  log: (entry) => console.error(JSON.stringify(entry)),
};

function auditFailureResponse(failure: AuditWriteFailure): Response {
  const { status, message, error } = failure.failure;
  return createErrorResponse(status, message, { error });
}

/** Everything the handlers need to know about the verified caller. */
type RequestContext = {
  /** From the verified JWT — never from the request body. */
  actorUserId: string;
  /** One correlation id per request, shared by all audit rows it produces. */
  operationId: string;
};

/* ------------------------------------------------------------------------ */
/* W1 — the single privileged executor for role / disabled                   */
/* ------------------------------------------------------------------------ */

const LIFECYCLE_SELECT = "id, user_id, role, disabled";

/** Projects an Auth Admin user down to the four facts the contract reads. */
function toAuthFacts(user: unknown): EmployeeAuthFacts | null {
  if (!user || typeof user !== "object") return null;
  const u = user as Record<string, unknown>;
  return {
    banned_until: (u.banned_until as string | null | undefined) ?? null,
    email_confirmed_at:
      (u.email_confirmed_at as string | null | undefined) ?? null,
    confirmed_at: (u.confirmed_at as string | null | undefined) ?? null,
    invited_at: (u.invited_at as string | null | undefined) ?? null,
  };
}

async function loadAuthFacts(
  userId: string | null | undefined,
): Promise<EmployeeAuthFacts | null> {
  if (!userId) return null;
  const { data, error } = await supabaseAdmin.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  return toAuthFacts(data.user);
}

/**
 * Real adapters behind the executor ports. The browser never reaches any of
 * these: set_sales_access_by_executor is service_role-only in the database,
 * and Auth Admin is only ever called with the service key from here.
 */
const lifecycleDeps: LifecycleDeps = {
  applyAccessChange: async ({
    actorUserId,
    salesId,
    role,
    disabled,
    operationId,
  }) => {
    const { data, error } = await supabaseAdmin.rpc(
      "set_sales_access_by_executor",
      {
        p_actor_user_id: actorUserId,
        p_sale_id: salesId,
        p_role: role,
        p_disabled: disabled,
        p_operation_id: operationId,
      },
    );
    if (error) throw error;
    return data as LifecycleSaleRow;
  },
  setAuthBan: async (userId, banned) => {
    const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
      userId,
      { ban_duration: banned ? "87600h" : "none" },
    );
    if (error || !data?.user) {
      throw error ?? new Error("auth_update_failed");
    }
  },
  readSale: async (salesId) => {
    const { data, error } = await supabaseAdmin
      .from("sales")
      .select(LIFECYCLE_SELECT)
      .eq("id", salesId)
      .maybeSingle();
    if (error || !data) return null;
    return data as LifecycleSaleRow;
  },
  readAuthFacts: loadAuthFacts,
  log: (entry) => console.error(JSON.stringify(entry)),
};

function lifecycleErrorResponse(failure: LifecycleFailure): Response {
  const { status, message, error, accessConsistency } = failure.failure;
  return createErrorResponse(status, message, {
    error,
    ...(accessConsistency ? { accessConsistency } : {}),
  });
}

async function reloadSale(salesId: number) {
  const { data, error } = await supabaseAdmin
    .from("sales")
    .select("*")
    .eq("id", salesId)
    .single();
  if (!data || error) {
    throw error ?? new Error("reload_failed");
  }
  return data;
}

async function updateSaleAvatar(user_id: string, avatar: unknown) {
  const { data: sales, error: salesError } = await supabaseAdmin
    .from("sales")
    .update({ avatar })
    .eq("user_id", user_id)
    .select("*");

  if (!sales?.length || salesError) {
    throw salesError ?? new Error("Failed to update sale");
  }
  return sales.at(0);
}

async function loadSaleByUserId(userId: string) {
  const { data, error } = await supabaseAdmin
    .from("sales")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw error;
  }
  return data;
}

async function resolveUserIdByEmail(email: string) {
  const { data, error } = await supabaseAdmin.rpc("get_user_id_by_email", {
    email,
  });
  if (error || !data?.[0]?.id) {
    return null;
  }
  return data[0].id as string;
}

/**
 * Admin-only invite: inviteUserByEmail creates the auth user (no client password),
 * handle_new_user creates the sales row, then role (and, if requested, the
 * disabled state including its Auth ban) is applied through the executor.
 */
async function inviteUser(
  req: Request,
  currentUserSale: any,
  ctx: RequestContext,
) {
  const { actorUserId, operationId } = ctx;
  // Only the fields below are read from the body. Anything else — in
  // particular any actor_* / user_id field a caller might add — is ignored:
  // the actor is the verified JWT subject, full stop.
  const { email, first_name, last_name, disabled, administrator, role } =
    await req.json();

  if (!isAdminSale(currentUserSale)) {
    return createErrorResponse(403, "Not Authorized", {
      error: "role_update_forbidden",
    });
  }

  const resolvedRole = resolveInviteRole(role, administrator);
  const redirectTo = resolveInviteRedirectTo();

  const { data: inviteData, error: inviteError } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      data: { first_name, last_name },
      redirectTo,
    });

  let userId = inviteData?.user?.id as string | undefined;

  if (inviteError) {
    const code = (inviteError as { code?: string }).code;
    const already =
      code === "email_exists" ||
      /already|exists/i.test(inviteError.message ?? "");

    if (!already) {
      console.error("Error inviting user");
      return createErrorResponse(500, "Invitation failed", {
        error: "invite_failed",
      });
    }

    const existingId = await resolveUserIdByEmail(email);
    if (!existingId) {
      return createErrorResponse(500, "Internal Server Error", {
        error: "internal_error",
      });
    }
    userId = existingId;

    const existingSale = await loadSaleByUserId(existingId);
    if (existingSale) {
      return createErrorResponse(409, "A sales for this email already exists", {
        error: "already_exists",
      });
    }

    const { error: insertError } = await supabaseAdmin.from("sales").insert({
      email,
      first_name,
      last_name,
      disabled: disabled ?? false,
      role: resolvedRole,
      administrator: resolvedRole === "admin",
      user_id: existingId,
    });
    if (insertError) {
      console.error("Error creating sale for existing auth user");
      return createErrorResponse(500, "Internal Server Error", {
        error: "internal_error",
      });
    }

    const { error: resendError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { first_name, last_name },
        redirectTo,
      });
    if (resendError) {
      console.error("Error resending invitation mail");
      return createErrorResponse(500, "Failed to send invitation mail", {
        error: "invite_mail_failed",
      });
    }
  }

  if (!userId) {
    return createErrorResponse(500, "Internal Server Error", {
      error: "internal_error",
    });
  }

  let saleRow = await loadSaleByUserId(userId);
  if (!saleRow) {
    await new Promise((r) => setTimeout(r, 250));
    saleRow = await loadSaleByUserId(userId);
  }
  if (!saleRow) {
    return createErrorResponse(500, "Sales profile missing after invite", {
      error: "internal_error",
    });
  }

  // Role and — when the admin invites someone as disabled — the disabled state
  // go through the same executor as every later change, so an invited-as-
  // disabled identity ends up banned in Auth as well, never only flagged.
  let result;
  try {
    result = await executeAccessChange(lifecycleDeps, {
      actorUserId,
      operationId,
      target: saleRow as LifecycleSaleRow,
      role: resolvedRole,
      ...(typeof disabled === "boolean" ? { disabled } : {}),
    });
  } catch (e) {
    if (e instanceof LifecycleFailure) return lifecycleErrorResponse(e);
    console.error("user.invite.access_change_failed");
    return createErrorResponse(500, "Internal Server Error", {
      error: "internal_error",
    });
  }

  // user.invited is written only now: the invitation is out, the profile
  // exists and the role is applied. The database names the actor itself.
  try {
    await recordEmployeeAdminEvent(employeeAuditDeps, {
      actorUserId,
      salesId: result.sale.id,
      eventType: "user.invited",
      operationId,
      metadata: { role: resolvedRole },
    });
  } catch (e) {
    if (e instanceof AuditWriteFailure) return auditFailureResponse(e);
    throw e;
  }

  try {
    const sale = await reloadSale(result.sale.id);
    return new Response(
      JSON.stringify({
        data: sale,
        accessConsistency: result.accessConsistency,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders } },
    );
  } catch {
    return createErrorResponse(500, "Internal Server Error", {
      error: "internal_error",
    });
  }
}

async function patchUser(
  req: Request,
  currentUserSale: any,
  ctx: RequestContext,
) {
  const { actorUserId, operationId } = ctx;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return createErrorResponse(400, "Invalid JSON body", {
      error: "invalid_payload",
    });
  }

  const planned = buildPatchPlan(body);
  if ("error" in planned) {
    return createErrorResponse(400, "Invalid request", {
      error: planned.error,
    });
  }
  const plan = planned;

  const { data: sale, error: saleLoadError } = await supabaseAdmin
    .from("sales")
    .select("*")
    .eq("id", plan.salesId)
    .single();

  if (saleLoadError || !sale) {
    return createErrorResponse(404, "Not Found", { error: "not_found" });
  }

  const isSelf = currentUserSale.id === sale.id;
  const callerIsAdmin = isAdminSale(currentUserSale);
  const wantsAccessChange = plan.wantsRole || plan.wantsDisabled;

  if (!callerIsAdmin && !isSelf) {
    return createErrorResponse(403, "Not Authorized", {
      error: "role_update_forbidden",
    });
  }

  if (wantsAccessChange && !callerIsAdmin) {
    return createErrorResponse(403, "Not Authorized", {
      error: "role_update_forbidden",
    });
  }

  // Self guard (authoritative here, repeated in the database): an admin never
  // changes their own role or access through the lifecycle API. Checked before
  // any profile write so a refused request touches nothing.
  if (wantsAccessChange && isSelf) {
    return createErrorResponse(403, "Not Authorized", {
      error: "self_access_change_forbidden",
    });
  }

  // Profile fields (self or admin). Never the ban: the Auth ban is owned by
  // the access change below, so it can only move together with sales.disabled.
  if (plan.wantsName || plan.wantsEmail) {
    const nextFirstName =
      plan.firstName !== null ? plan.firstName : sale.first_name;
    const nextLastName =
      plan.lastName !== null ? plan.lastName : sale.last_name;

    const authUpdate: {
      email?: string;
      user_metadata?: { first_name: string; last_name: string };
    } = {};

    if (plan.wantsName) {
      authUpdate.user_metadata = {
        first_name: nextFirstName,
        last_name: nextLastName,
      };
    }

    if (plan.wantsEmail && plan.email && plan.email !== sale.email) {
      authUpdate.email = plan.email;
    }

    if (Object.keys(authUpdate).length > 0) {
      const { data, error: userError } =
        await supabaseAdmin.auth.admin.updateUserById(sale.user_id, authUpdate);

      if (!data?.user || userError) {
        console.error(
          JSON.stringify({
            operation: "updateUserById",
            stage: "auth_admin",
            error: "auth_update_failed",
          }),
        );
        return createErrorResponse(500, "Internal Server Error", {
          error: "internal_error",
        });
      }
    }

    if (plan.wantsName) {
      const { error: saleUpdateError } = await supabaseAdmin
        .from("sales")
        .update({
          first_name: nextFirstName,
          last_name: nextLastName,
        })
        .eq("id", plan.salesId);

      if (saleUpdateError) {
        console.error(
          JSON.stringify({
            operation: "sales_name_update",
            stage: "sales",
            sqlstate: saleUpdateError.code ?? null,
            error: "sale_update_failed",
          }),
        );
        return createErrorResponse(500, "Internal Server Error", {
          error: "internal_error",
        });
      }
    }
  }

  if (plan.wantsAvatar) {
    try {
      await updateSaleAvatar(sale.user_id, plan.avatar);
    } catch {
      console.error(
        JSON.stringify({
          operation: "avatar_update",
          stage: "sales",
          error: "avatar_update_failed",
        }),
      );
      return createErrorResponse(500, "Internal Server Error", {
        error: "internal_error",
      });
    }
  }

  // Role / disabled — the one path. Database guards first, then Auth, then
  // verification; see lifecycle.ts for the partial-failure contract.
  if (wantsAccessChange) {
    try {
      const result = await executeAccessChange(lifecycleDeps, {
        actorUserId,
        operationId,
        target: {
          id: sale.id,
          user_id: sale.user_id,
          role: sale.role,
          disabled: sale.disabled === true,
        },
        ...(plan.wantsRole ? { role: plan.role as NoraRole } : {}),
        ...(plan.wantsDisabled && typeof plan.disabled === "boolean"
          ? { disabled: plan.disabled }
          : {}),
      });
      const updated = await reloadSale(result.sale.id);
      return new Response(
        JSON.stringify({
          data: updated,
          accessConsistency: result.accessConsistency,
        }),
        { headers: { "Content-Type": "application/json", ...corsHeaders } },
      );
    } catch (e) {
      if (e instanceof LifecycleFailure) return lifecycleErrorResponse(e);
      console.error("user.patch.access_change_failed");
      return createErrorResponse(500, "Internal Server Error", {
        error: "internal_error",
      });
    }
  }

  try {
    const newSale = await reloadSale(plan.salesId);
    return new Response(JSON.stringify({ data: newSale }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch {
    return createErrorResponse(500, "Internal Server Error", {
      error: "internal_error",
    });
  }
}

/**
 * Employee Access (V1A) — narrow admin surface.
 *
 * These handlers exist so the Nora browser never needs to see auth.users.
 * They return ONLY the fields in EmployeeAccessRecord: no tokens, no provider
 * metadata, no identities, no app_metadata, no raw Auth rows.
 */

const ACCESS_SELECT = "id, email, first_name, last_name, user_id, disabled";

/** Walks every Auth page so a large directory never silently degrades to "unknown". */
async function loadAllAuthFacts(): Promise<Map<string, EmployeeAuthFacts>> {
  const byUserId = new Map<string, EmployeeAuthFacts>();
  const PER_PAGE = 1000;
  const MAX_PAGES = 20;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({
      page,
      perPage: PER_PAGE,
    });
    if (error) throw error;

    const users = data?.users ?? [];
    for (const user of users) {
      const facts = toAuthFacts(user);
      if (user?.id && facts) byUserId.set(user.id, facts);
    }

    if (users.length < PER_PAGE || !(data as { nextPage?: number })?.nextPage) {
      break;
    }
  }

  return byUserId;
}

function accessJson(payload: {
  data: EmployeeAccessRecord | EmployeeAccessRecord[];
}) {
  return new Response(JSON.stringify(payload), {
    headers: { "Content-Type": "application/json", ...corsHeaders },
  });
}

type AccessSaleRow = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  user_id: string | null;
  disabled: boolean | null;
};

async function loadAccessSale(salesId: number): Promise<AccessSaleRow | null> {
  const { data, error } = await supabaseAdmin
    .from("sales")
    .select(ACCESS_SELECT)
    .eq("id", salesId)
    .maybeSingle();
  if (error) throw error;
  return (data as AccessSaleRow | null) ?? null;
}

/** GET /users — admin-only. Optional ?sales_id=<id> narrows to one employee. */
async function getEmployeeAccessStatus(req: Request, currentUserSale: any) {
  if (!isAdminSale(currentUserSale)) {
    return createErrorResponse(403, "Not Authorized", {
      error: "access_status_forbidden",
    });
  }

  const salesIdParam = new URL(req.url).searchParams.get("sales_id");

  try {
    if (salesIdParam !== null) {
      const salesId = Number(salesIdParam);
      if (!Number.isFinite(salesId) || salesId <= 0) {
        return createErrorResponse(400, "Invalid request", {
          error: "invalid_payload",
        });
      }

      const sale = await loadAccessSale(salesId);
      if (!sale) {
        return createErrorResponse(404, "Not Found", { error: "not_found" });
      }

      const facts = await loadAuthFacts(sale.user_id);
      return accessJson({ data: [buildEmployeeAccessRecord(sale, facts)] });
    }

    const { data: sales, error } = await supabaseAdmin
      .from("sales")
      .select(ACCESS_SELECT)
      .order("id", { ascending: true });
    if (error || !sales) throw error ?? new Error("sales_load_failed");

    const byUserId = await loadAllAuthFacts();
    const records = (sales as AccessSaleRow[]).map((sale) =>
      buildEmployeeAccessRecord(
        sale,
        sale.user_id ? (byUserId.get(sale.user_id) ?? null) : null,
      ),
    );

    return accessJson({ data: records });
  } catch {
    console.error("employee_access_status.failed");
    return createErrorResponse(500, "Internal Server Error", {
      error: "internal_error",
    });
  }
}

/**
 * "Einladung erneut senden" — only for an employee who has NOT activated yet.
 *
 * Never creates a sales row and never creates a second Auth identity: for an
 * existing but unconfirmed user GoTrue re-sends the invitation on the same
 * user. It answers email_exists ONLY when the account is already confirmed —
 * which means our derived state was stale and the employee is in fact active,
 * so we surface that explicitly instead of guessing or retrying.
 */
async function resendEmployeeInvitation(
  currentUserSale: any,
  salesId: number,
  ctx: RequestContext,
): Promise<Response> {
  if (!isAdminSale(currentUserSale)) {
    return createErrorResponse(403, "Not Authorized", {
      error: "access_action_forbidden",
    });
  }

  let sale: AccessSaleRow | null;
  try {
    sale = await loadAccessSale(salesId);
  } catch {
    return createErrorResponse(500, "Internal Server Error", {
      error: "internal_error",
    });
  }
  if (!sale) {
    return createErrorResponse(404, "Not Found", { error: "not_found" });
  }

  const facts = await loadAuthFacts(sale.user_id);
  const current = buildEmployeeAccessRecord(sale, facts);

  if (!isAdminActionAllowed(current.accessState, "resend_invitation")) {
    return createErrorResponse(409, "Action not applicable", {
      error: "action_not_applicable",
      accessState: current.accessState,
    });
  }

  const { error: inviteError } =
    await supabaseAdmin.auth.admin.inviteUserByEmail(sale.email, {
      data: { first_name: sale.first_name, last_name: sale.last_name },
      redirectTo: resolveInviteRedirectTo(),
    });

  if (inviteError) {
    const code = (inviteError as { code?: string }).code;
    const alreadyConfirmed =
      code === "email_exists" ||
      /already|exists/i.test(inviteError.message ?? "");

    if (alreadyConfirmed) {
      return createErrorResponse(409, "Action not applicable", {
        error: "action_not_applicable",
        accessState: "active",
      });
    }

    console.error("user.invitation_resend.failed");
    return createErrorResponse(500, "Failed to send invitation mail", {
      error: "invite_mail_failed",
    });
  }

  // Audit only after GoTrue accepted the resend. A failed audit write is
  // reported as audit_write_failed, never as a green resend.
  try {
    await recordEmployeeAdminEvent(employeeAuditDeps, {
      actorUserId: ctx.actorUserId,
      salesId: sale.id,
      eventType: "user.invitation_resent",
      operationId: ctx.operationId,
    });
  } catch (e) {
    if (e instanceof AuditWriteFailure) return auditFailureResponse(e);
    throw e;
  }

  // The invitation is already out. Re-reading Auth here is a convenience, not
  // a source of truth: loadAuthFacts() answers null on a transient read error,
  // which would derive "unknown" and report a bogus state for an operation
  // that actually succeeded. Fall back to the state we verified before the
  // send — a resend does not change it.
  const nextFacts = await loadAuthFacts(sale.user_id);
  return accessJson({
    data: nextFacts ? buildEmployeeAccessRecord(sale, nextFacts) : current,
  });
}

/**
 * "Passwort einrichten lassen" — only for an ACTIVE employee.
 *
 * Sends the employee a fresh link with which THEY choose their own password.
 * The administrator never sees a token and never learns the password. The
 * underlying provider mechanism is recovery; that stays an internal detail.
 * No account is created here: resetPasswordForEmail never provisions a user.
 */
async function requestEmployeePasswordSetup(
  currentUserSale: any,
  salesId: number,
  ctx: RequestContext,
): Promise<Response> {
  if (!isAdminSale(currentUserSale)) {
    return createErrorResponse(403, "Not Authorized", {
      error: "access_action_forbidden",
    });
  }

  let sale: AccessSaleRow | null;
  try {
    sale = await loadAccessSale(salesId);
  } catch {
    return createErrorResponse(500, "Internal Server Error", {
      error: "internal_error",
    });
  }
  if (!sale) {
    return createErrorResponse(404, "Not Found", { error: "not_found" });
  }

  const facts = await loadAuthFacts(sale.user_id);
  const current = buildEmployeeAccessRecord(sale, facts);

  if (!isAdminActionAllowed(current.accessState, "request_password_setup")) {
    return createErrorResponse(409, "Action not applicable", {
      error: "action_not_applicable",
      accessState: current.accessState,
    });
  }

  const { error: resetError } = await supabaseAdmin.auth.resetPasswordForEmail(
    sale.email,
    { redirectTo: resolveInviteRedirectTo() },
  );

  if (resetError) {
    console.error("user.password_setup_request.failed");
    return createErrorResponse(500, "Failed to send password setup mail", {
      error: "password_setup_mail_failed",
    });
  }

  // Audit only after the provider accepted the reset request.
  try {
    await recordEmployeeAdminEvent(employeeAuditDeps, {
      actorUserId: ctx.actorUserId,
      salesId: sale.id,
      eventType: "user.password_setup_requested",
      operationId: ctx.operationId,
    });
  } catch (e) {
    if (e instanceof AuditWriteFailure) return auditFailureResponse(e);
    throw e;
  }

  return accessJson({ data: current });
}

/**
 * POST dispatch: a body carrying "action" is an access command; a body without
 * one stays the legacy "create a new employee and invite them" payload.
 */
async function postUsers(
  req: Request,
  currentUserSale: any,
  ctx: RequestContext,
) {
  let body: Record<string, unknown>;
  try {
    body = await req.clone().json();
  } catch {
    return createErrorResponse(400, "Invalid JSON body", {
      error: "invalid_payload",
    });
  }

  const command = parseEmployeeAccessCommand(body);

  if (command && "error" in command) {
    return createErrorResponse(400, "Invalid request", {
      error: command.error,
    });
  }

  if (command) {
    return command.kind === "resend_invitation"
      ? resendEmployeeInvitation(currentUserSale, command.salesId, ctx)
      : requestEmployeePasswordSetup(currentUserSale, command.salesId, ctx);
  }

  return inviteUser(req, currentUserSale, ctx);
}

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        // user comes from GoTrue's own verification of the caller's JWT
        // (UserMiddleware → auth.getUser). Its id is the ONLY actor identity
        // the executor ever receives — never anything from the request body.
        const currentUserSale = await getUserSale(user);
        if (!user || !currentUserSale || currentUserSale.disabled) {
          return createErrorResponse(401, "Unauthorized", {
            error: "unauthorized",
          });
        }
        // W3: one correlation id per request (header or minted here); every
        // audit row this request produces carries it as request_id.
        const ctx: RequestContext = {
          actorUserId: user.id,
          operationId: resolveRequestOperationId(req),
        };

        if (req.method === "GET") {
          // Read-only: no business audit.
          return getEmployeeAccessStatus(req, currentUserSale);
        }

        if (req.method === "POST") {
          return postUsers(req, currentUserSale, ctx);
        }

        if (req.method === "PATCH") {
          return patchUser(req, currentUserSale, ctx);
        }

        return createErrorResponse(405, "Method Not Allowed", {
          error: "method_not_allowed",
        });
      }),
    ),
  ),
);
