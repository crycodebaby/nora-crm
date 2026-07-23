import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { supabaseAdmin } from "../_shared/supabaseAdmin.ts";
import { corsHeaders, OptionsMiddleware } from "../_shared/cors.ts";
import { createErrorResponse } from "../_shared/utils.ts";
import { AuthMiddleware, UserMiddleware } from "../_shared/authentication.ts";
import { getUserSale } from "../_shared/getUserSale.ts";

type NoraRole = "admin" | "office" | "viewer";

function isAdminSale(sale: { role?: NoraRole; administrator?: boolean }) {
  return sale.role === "admin" || sale.administrator === true;
}

function resolveRole(
  role: NoraRole | undefined,
  administrator: boolean | undefined,
): NoraRole {
  if (role === "admin" || role === "office" || role === "viewer") {
    return role;
  }
  return administrator ? "admin" : "viewer";
}

function resolveInviteRedirectTo(): string {
  const siteUrl =
    Deno.env.get("SITE_URL") ??
    Deno.env.get("PUBLIC_SITE_URL") ??
    "https://nora.ergart.de";
  return `${siteUrl.replace(/\/$/, "")}/auth-callback.html`;
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
  } catch (error) {
    // Audit must not block invite delivery; log without secrets.
    console.error("user.invite.audit_failed");
    console.error(error);
  }
}

async function setSaleRoleAndDisabled(
  saleId: number,
  role: NoraRole,
  disabled: boolean,
) {
  const { error } = await supabaseAdmin.rpc("set_sales_role_by_admin", {
    p_sale_id: saleId,
    p_role: role,
    p_disabled: disabled,
  });

  if (error) {
    console.error("Error updating sale role:", error);
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

async function updateSaleAvatar(user_id: string, avatar: string) {
  const { data: sales, error: salesError } = await supabaseAdmin
    .from("sales")
    .update({ avatar })
    .eq("user_id", user_id)
    .select("*");

  if (!sales?.length || salesError) {
    console.error("Error updating user:", salesError);
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
 * handle_new_user creates the sales row, then role is set via secure RPC.
 * Never accepts a caller-chosen password for invites.
 */
async function inviteUser(req: Request, currentUserSale: any) {
  const { email, first_name, last_name, disabled, administrator, role } =
    await req.json();

  if (!isAdminSale(currentUserSale)) {
    return createErrorResponse(401, "Not Authorized");
  }

  const resolvedRole = resolveRole(role, administrator);
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
      return createErrorResponse(
        (inviteError as { status?: number }).status ?? 500,
        "Invitation failed",
      );
    }

    const existingId = await resolveUserIdByEmail(email);
    if (!existingId) {
      return createErrorResponse(500, "Internal Server Error");
    }
    userId = existingId;

    const existingSale = await loadSaleByUserId(existingId);
    if (existingSale) {
      return createErrorResponse(400, "A sales for this email already exists");
    }

    // Auth user exists without sales profile — create profile then set role.
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
      return createErrorResponse(500, "Internal Server Error");
    }

    // Re-send invite mail so the user can set a password.
    const { error: resendError } =
      await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
        data: { first_name, last_name },
        redirectTo,
      });
    if (resendError) {
      console.error("Error resending invitation mail");
      return createErrorResponse(500, "Failed to send invitation mail");
    }
  }

  if (!userId) {
    return createErrorResponse(500, "Internal Server Error");
  }

  try {
    // Trigger may be briefly delayed after inviteUserByEmail.
    let saleRow = await loadSaleByUserId(userId);
    if (!saleRow) {
      await new Promise((r) => setTimeout(r, 250));
      saleRow = await loadSaleByUserId(userId);
    }
    if (!saleRow) {
      return createErrorResponse(500, "Sales profile missing after invite");
    }

    const sale = await setSaleRoleAndDisabled(
      saleRow.id,
      resolvedRole,
      disabled ?? false,
    );

    await writeUserInviteAudit({
      actorSaleId: currentUserSale.id,
      inviteeEmail: email,
      inviteeSaleId: sale.id,
      role: resolvedRole,
    });

    return new Response(
      JSON.stringify({
        data: sale,
      }),
      {
        headers: { "Content-Type": "application/json", ...corsHeaders },
      },
    );
  } catch (e) {
    console.error("Error patching sale:", e);
    return createErrorResponse(500, "Internal Server Error");
  }
}

async function patchUser(req: Request, currentUserSale: any) {
  const {
    sales_id,
    email,
    first_name,
    last_name,
    avatar,
    administrator,
    disabled,
    role,
  } = await req.json();
  const { data: sale } = await supabaseAdmin
    .from("sales")
    .select("*")
    .eq("id", sales_id)
    .single();

  if (!sale) {
    return createErrorResponse(404, "Not Found");
  }

  if (!isAdminSale(currentUserSale) && currentUserSale.id !== sale.id) {
    return createErrorResponse(401, "Not Authorized");
  }

  const { data, error: userError } =
    await supabaseAdmin.auth.admin.updateUserById(sale.user_id, {
      email,
      ban_duration: disabled ? "87600h" : "none",
      user_metadata: { first_name, last_name },
    });

  if (!data?.user || userError) {
    console.error("Error patching user:", userError);
    return createErrorResponse(500, "Internal Server Error");
  }

  if (avatar) {
    await updateSaleAvatar(data.user.id, avatar);
  }

  if (!isAdminSale(currentUserSale)) {
    const { data: new_sale } = await supabaseAdmin
      .from("sales")
      .select("*")
      .eq("id", sales_id)
      .single();
    return new Response(
      JSON.stringify({
        data: new_sale,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  }

  try {
    const resolvedRole = resolveRole(role, administrator);
    const updatedSale = await setSaleRoleAndDisabled(
      sales_id,
      resolvedRole,
      disabled ?? sale.disabled ?? false,
    );
    return new Response(
      JSON.stringify({
        data: updatedSale,
      }),
      {
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      },
    );
  } catch (e) {
    console.error("Error patching sale:", e);
    return createErrorResponse(500, "Internal Server Error");
  }
}

Deno.serve(async (req: Request) =>
  OptionsMiddleware(req, async (req) =>
    AuthMiddleware(req, async (req) =>
      UserMiddleware(req, async (req, user) => {
        const currentUserSale = await getUserSale(user);
        if (!currentUserSale || currentUserSale.disabled) {
          return createErrorResponse(401, "Unauthorized");
        }

        if (req.method === "POST") {
          return inviteUser(req, currentUserSale);
        }

        if (req.method === "PATCH") {
          return patchUser(req, currentUserSale);
        }

        return createErrorResponse(405, "Method Not Allowed");
      }),
    ),
  ),
);
