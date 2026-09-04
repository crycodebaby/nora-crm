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
  mapPostgresError,
  needsAuthAdminUpdate,
  type NoraRole,
  type PatchPlan,
} from "./patchHelpers.ts";
import {
  buildEmployeeAccessRecord,
  isAdminActionAllowed,
  parseEmployeeAccessCommand,
  type EmployeeAccessRecord,
  type EmployeeAuthFacts,
} from "./accessState.ts";

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

async function writeUserInviteAudit(args: {
  actorSaleId: number;
  inviteeEmail: string;
  inviteeSaleId: number;
  role: NoraRole;
}) {
  try {
    await supabaseAdmin.rpc("insert_audit_event", {
      p_event_type: "user.invited",
      p_entity_type: "sales",
      p_entity_id: crypto.randomUUID(),
      p_metadata: {
        actor_sale_id: args.actorSaleId,
        invitee_sale_id: args.inviteeSaleId,
        invitee_email: args.inviteeEmail,
        role: args.role,
      },
    });
  } catch {
    console.error("user.invite.audit_failed");
  }
}

async function setSaleRoleAndDisabled(
  saleId: number,
  role: NoraRole,
  disabled: boolean | null,
) {
  const { error } = await supabaseAdmin.rpc("set_sales_role_by_admin", {
    p_sale_id: saleId,
    p_role: role,
    p_disabled: disabled,
  });

  if (error) {
    console.error(
      JSON.stringify({
        operation: "set_sales_role_by_admin",
        stage: "rpc",
        sqlstate: error.code ?? null,
        error: error.message ?? "unknown",
      }),
    );
    throw error;
  }

  const { data: sales, error: salesError } = await supabaseAdmin
    .from("sales")
    .select("*")
    .eq("id", saleId)
    .single();

  if (!sales || salesError) {
    throw salesError ?? new Error("Failed to load updated sale");
  }

  return sales;
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

/**
 * Admin-only invite: inviteUserByEmail creates the auth user (no client password),
 * handle_new_user creates the sales row, then role is set via secure RPC.
 */
async function inviteUser(req: Request, currentUserSale: any) {
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

  try {
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

    const sale = await setSaleRoleAndDisabled(
      saleRow.id,
      resolvedRole,
      typeof disabled === "boolean" ? disabled : null,
    );

    await writeUserInviteAudit({
      actorSaleId: currentUserSale.id,
      inviteeEmail: email,
      inviteeSaleId: sale.id,
      role: resolvedRole,
    });

    return new Response(JSON.stringify({ data: sale }), {
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  } catch (e) {
    const mapped = mapPostgresError(e as { code?: string; message?: string });
    return createErrorResponse(mapped.status, mapped.message, {
      error: mapped.error,
    });
  }
}

/**
 * Keeps the Supabase Auth ban in sync with sales.disabled.
 *
 * Both facts are authoritative for the derived access state, so applying only
 * one half is a real defect: an employee "activated" by clearing
 * sales.disabled would stay banned in Auth and still be unable to sign in.
 * Called for every disabled change, in both PATCH branches.
 */
async function syncAuthBanState(
  userId: string,
  disabled: boolean,
): Promise<boolean> {
  const { data, error } = await supabaseAdmin.auth.admin.updateUserById(
    userId,
    { ban_duration: disabled ? "87600h" : "none" },
  );

  if (!data?.user || error) {
    console.error(
      JSON.stringify({
        operation: "sync_auth_ban",
        stage: "auth_admin",
        error: "auth_update_failed",
      }),
    );
    return false;
  }
  return true;
}

async function applyRolePatch(
  plan: PatchPlan,
  sale: { id: number; role: NoraRole; disabled?: boolean },
) {
  const nextRole = plan.wantsRole ? plan.role! : (sale.role as NoraRole);
  const nextDisabled = plan.wantsDisabled
    ? plan.disabled
    : null; /* leave unchanged in RPC */
  return setSaleRoleAndDisabled(sale.id, nextRole, nextDisabled);
}

async function patchUser(req: Request, currentUserSale: any) {
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
    const status = planned.error === "invalid_role" ? 400 : 400;
    return createErrorResponse(status, "Invalid request", {
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

  if (!callerIsAdmin && !isSelf) {
    return createErrorResponse(403, "Not Authorized", {
      error: "role_update_forbidden",
    });
  }

  if ((plan.wantsRole || plan.wantsDisabled) && !callerIsAdmin) {
    return createErrorResponse(403, "Not Authorized", {
      error: "role_update_forbidden",
    });
  }

  // Role / disabled only. A pure role change still performs no Auth Admin
  // call; a disabled change must, so both authoritative facts stay in sync.
  if (
    (plan.wantsRole || plan.wantsDisabled) &&
    !plan.wantsName &&
    !plan.wantsEmail &&
    !plan.wantsAvatar
  ) {
    if (plan.wantsDisabled && typeof plan.disabled === "boolean") {
      const synced = await syncAuthBanState(sale.user_id, plan.disabled);
      if (!synced) {
        return createErrorResponse(500, "Internal Server Error", {
          error: "internal_error",
        });
      }
    }

    try {
      const updated = await applyRolePatch(plan, sale);
      return new Response(JSON.stringify({ data: updated }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch (e) {
      const mapped = mapPostgresError(e as { code?: string; message?: string });
      return createErrorResponse(mapped.status, mapped.message, {
        error: mapped.error,
      });
    }
  }

  // Profile fields (self or admin)
  if (needsAuthAdminUpdate(plan) || plan.wantsAvatar) {
    const nextFirstName =
      plan.firstName !== null ? plan.firstName : sale.first_name;
    const nextLastName =
      plan.lastName !== null ? plan.lastName : sale.last_name;

    if (plan.wantsName || plan.wantsEmail || plan.wantsDisabled) {
      const authUpdate: {
        email?: string;
        ban_duration?: string;
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

      // Same rule as the role/disabled-only branch above: a disabled change
      // always moves the Auth ban too, never only sales.disabled.
      if (plan.wantsDisabled && typeof plan.disabled === "boolean") {
        authUpdate.ban_duration = plan.disabled ? "87600h" : "none";
      }

      if (Object.keys(authUpdate).length > 0) {
        const { data, error: userError } =
          await supabaseAdmin.auth.admin.updateUserById(
            sale.user_id,
            authUpdate,
          );

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
  }

  if (plan.wantsRole || plan.wantsDisabled) {
    try {
      const updated = await applyRolePatch(plan, sale);
      return new Response(JSON.stringify({ data: updated }), {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    } catch (e) {
      const mapped = mapPostgresError(e as { code?: string; message?: string });
      return createErrorResponse(mapped.status, mapped.message, {
        error: mapped.error,
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

async function writeEmployeeAccessAudit(args: {
  eventType: "user.invitation_resent" | "user.password_setup_requested";
  actorSaleId: number;
  employeeSaleId: number;
  employeeEmail: string;
}) {
  try {
    await supabaseAdmin.rpc("insert_audit_event", {
      p_event_type: args.eventType,
      p_entity_type: "sales",
      p_entity_id: crypto.randomUUID(),
      p_metadata: {
        actor_sale_id: args.actorSaleId,
        employee_sale_id: args.employeeSaleId,
        employee_email: args.employeeEmail,
      },
    });
  } catch {
    console.error(args.eventType + ".audit_failed");
  }
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

  await writeEmployeeAccessAudit({
    eventType: "user.invitation_resent",
    actorSaleId: currentUserSale.id,
    employeeSaleId: sale.id,
    employeeEmail: sale.email,
  });

  const nextFacts = await loadAuthFacts(sale.user_id);
  return accessJson({ data: buildEmployeeAccessRecord(sale, nextFacts) });
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

  await writeEmployeeAccessAudit({
    eventType: "user.password_setup_requested",
    actorSaleId: currentUserSale.id,
    employeeSaleId: sale.id,
    employeeEmail: sale.email,
  });

  return accessJson({ data: current });
}

/**
 * POST dispatch: a body carrying "action" is an access command; a body without
 * one stays the legacy "create a new employee and invite them" payload.
 */
async function postUsers(req: Request, currentUserSale: any) {
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
      ? resendEmployeeInvitation(currentUserSale, command.salesId)
      : requestEmployeePasswordSetup(currentUserSale, command.salesId);
  }

  return inviteUser(req, currentUserSale);
}

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        const currentUserSale = await getUserSale(user);
        if (!currentUserSale || currentUserSale.disabled) {
          return createErrorResponse(401, "Unauthorized", {
            error: "unauthorized",
          });
        }

        if (req.method === "GET") {
          return getEmployeeAccessStatus(req, currentUserSale);
        }

        if (req.method === "POST") {
          return postUsers(req, currentUserSale);
        }

        if (req.method === "PATCH") {
          return patchUser(req, currentUserSale);
        }

        return createErrorResponse(405, "Method Not Allowed", {
          error: "method_not_allowed",
        });
      }),
    ),
  ),
);
