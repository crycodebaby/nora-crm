import { supabaseDataProvider } from "ra-supabase-core";
import {
  withLifecycleCallbacks,
  type DataProvider,
  type GetListParams,
  type Identifier,
  type ResourceCallbacks,
} from "ra-core";
import type {
  ContactNote,
  Deal,
  DealNote,
  RAFile,
  Sale,
  SalesFormData,
  SignUpData,
} from "../../types";
import type {
  StartChecklistRunFromTemplateArgs,
  StartChecklistRunFromTemplateResult,
} from "../../types/checklists";
import { START_CHECKLIST_RUN_FROM_TEMPLATE_RPC } from "../../types/checklists";
import type {
  AuditStorageStats,
  GetEntityAuditEventsParams,
  GetEntityAuditEventsResult,
  GetGlobalAuditEventsParams,
  GetGlobalAuditEventsResult,
} from "../../audit/auditTypes";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { performGlobalSearch } from "../../misc/globalSearch";
import type {
  EmployeeAccessRecord,
  EmployeeAccountDeletionResult,
  EmployeeEmailChangeResult,
  EmployeeOffboardingResult,
} from "../../sales/employeeAccessContract";
import { EMPTY_DEPENDENCY_PREVIEW } from "../../sales/employeeAccessContract";
import type {
  EmployeeMailDeliveryOutcome,
  EmployeeMailDeliveryStatus,
  EmployeeMailKind,
} from "../../sales/emailDeliveryContract";
import { withCrmErrorHandler } from "../../misc/withCrmErrorHandler";
import {
  createOperationContext,
  NORA_OPERATION_ID_HEADER,
} from "../../operations/operationContext";
import { executeDealUpdate } from "../../operations/executeDealUpdate";
import {
  executeCreateCustomerWithContact,
  type CreateCustomerWithContactParams,
  type CreateCustomerWithContactResult,
} from "../../operations/executeCreateCustomerWithContact";
import {
  executeCreateCustomerFromContact,
  type CreateCustomerFromContactParams,
  type CreateCustomerFromContactResult,
} from "../../operations/executeCreateCustomerFromContact";
import {
  executeCreateQuickCaptureCase,
  type CreateQuickCaptureCaseParams,
  type CreateQuickCaptureCaseResult,
} from "../../operations/executeCreateQuickCaptureCase";
import {
  executeCreateQuickCaptureTask,
  type CreateQuickCaptureTaskParams,
  type CreateQuickCaptureTaskResult,
} from "../../operations/executeCreateQuickCaptureTask";
import { executeSetPrimaryContact } from "../../operations/executeSetPrimaryContact";
import {
  createSupabaseOperationErrorRecorder,
  setDefaultOperationErrorRecorder,
} from "../../operations/errorObservatory";
import {
  readOperationIdFromMeta,
  withOperationIdParams,
} from "../../operations/operationTransport";
import { ATTACHMENTS_BUCKET } from "../commons/attachments";
import { getIsInitialized } from "./authProvider";
import { getSupabaseClient } from "./supabase";

// Wave 3: wire Error Observatory once for the Supabase provider process.
setDefaultOperationErrorRecorder(
  createSupabaseOperationErrorRecorder(() => getSupabaseClient()),
);

const getBaseDataProvider = () =>
  supabaseDataProvider({
    instanceUrl: import.meta.env.VITE_SUPABASE_URL,
    apiKey: import.meta.env.VITE_SB_PUBLISHABLE_KEY,
    supabaseClient: getSupabaseClient(),
    sortOrder: "asc,desc.nullslast" as any,
  });

const processCompanyLogo = async (params: any) => {
  const logo = params.data.logo;

  if (logo?.rawFile instanceof File) {
    await uploadToBucket(logo);
  }

  return {
    ...params,
    data: {
      ...params.data,
      logo,
    },
  };
};

const getDataProviderWithCustomMethods = () => {
  const baseDataProvider = getBaseDataProvider();

  const provider = {
    ...baseDataProvider,
    async globalSearch(query: string) {
      return performGlobalSearch(provider, query);
    },
    async getList(resource: string, params: GetListParams) {
      if (resource === "companies") {
        return baseDataProvider.getList("companies_summary", params);
      }
      if (resource === "contacts") {
        return baseDataProvider.getList("contacts_summary", params);
      }
      if (resource === "activity_log") {
        const { data, total } = await baseDataProvider.getList(
          "activity_log",
          params,
        );
        // Rename snake_case view columns to camelCase to match Activity type
        return {
          data: data.map((row: any) => ({
            ...row,
            contactNote: row.contact_note ?? undefined,
            dealNote: row.deal_note ?? undefined,
            contact_note: undefined,
            deal_note: undefined,
          })),
          total,
        };
      }

      return baseDataProvider.getList(resource, params);
    },
    async getOne(resource: string, params: any) {
      if (resource === "companies") {
        return baseDataProvider.getOne("companies_summary", params);
      }
      if (resource === "contacts") {
        return baseDataProvider.getOne("contacts_summary", params);
      }

      return baseDataProvider.getOne(resource, params);
    },

    /**
     * Foundation Wave 2: deal.update enters Operation Manager (owns operation_id),
     * then Wave 1 transport attaches x-nora-operation-id for audit correlation.
     * If meta already carries a valid operation id, transport-only (no nested op).
     */
    async update(resource: string, params: any) {
      if (resource === "deals") {
        const existingId = readOperationIdFromMeta(params?.meta);
        if (existingId) {
          const context = createOperationContext({
            operationType: "deal.update",
            resourceType: "deals",
            resourceId: params?.id,
            operationId: existingId,
          });
          return baseDataProvider.update(
            resource,
            withOperationIdParams(params, context),
          );
        }
        return executeDealUpdate(params, (res, nextParams) =>
          baseDataProvider.update(res, nextParams as any),
        );
      }
      return baseDataProvider.update(resource, params);
    },

    async signUp(
      _data: SignUpData,
    ): Promise<{ id: string; email: string; password: string }> {
      // Public self-registration is disabled. Users are invited by admins only.
      throw new Error(
        "Öffentliche Registrierung ist deaktiviert. Bitte nutzen Sie Ihre Einladung.",
      );
    },
    async salesCreate(body: SalesFormData) {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        data: Sale;
      }>("users", {
        method: "POST",
        body,
      });

      if (!data || error) {
        console.error("salesCreate.error", error);
        const errorDetails = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        throw new Error(errorDetails?.message || "Failed to create the user");
      }

      return data.data;
    },
    async salesUpdate(
      id: Identifier,
      data: Partial<Omit<SalesFormData, "password">>,
    ) {
      const {
        email,
        first_name,
        last_name,
        administrator,
        avatar,
        disabled,
        role,
      } = data;

      const body: Record<string, unknown> = { sales_id: id };
      if (email !== undefined) body.email = email;
      if (first_name !== undefined) body.first_name = first_name;
      if (last_name !== undefined) body.last_name = last_name;
      if (administrator !== undefined) body.administrator = administrator;
      if (avatar !== undefined) body.avatar = avatar;
      if (disabled !== undefined) body.disabled = disabled;
      if (role !== undefined) body.role = role;

      const { data: updatedData, error } =
        await getSupabaseClient().functions.invoke<{
          data: Sale;
          error?: string;
          message?: string;
        }>("users", {
          method: "PATCH",
          body,
        });

      if (error || !updatedData?.data) {
        const details = await (async () => {
          try {
            return (await error?.context?.json()) ?? {};
          } catch {
            return {};
          }
        })();
        const code =
          details?.error ??
          details?.code ??
          (error as { context?: { status?: number } })?.context?.status;
        // W1 lifecycle codes carry their own meaning — never collapse them
        // into the generic 403 below.
        if (
          code === "self_access_change_forbidden" ||
          code === "last_active_admin_required" ||
          code === "employee_access_sync_incomplete"
        ) {
          throw new Error(code);
        }
        if (
          code === "role_update_forbidden" ||
          code === 403 ||
          details?.status === 403
        ) {
          throw new Error("role_update_forbidden");
        }
        console.error("salesUpdate.error");
        throw new Error(
          typeof details?.error === "string"
            ? details.error
            : "sales_update_failed",
        );
      }

      return updatedData.data;
    },
    async updatePassword(id: Identifier) {
      const { data: passwordUpdated, error } =
        await getSupabaseClient().functions.invoke<boolean>("update_password", {
          method: "PATCH",
          body: {
            sales_id: id,
          },
        });

      if (!passwordUpdated || error) {
        console.error("update_password.error", error);
        throw new Error("Failed to update password");
      }

      return passwordUpdated;
    },

    /**
     * Employee Access (V1A). The three calls below are the ONLY way the Nora
     * browser learns anything about an employee's Auth state, and the only way
     * it triggers an access email. Every one of them is admin-gated inside the
     * users Edge Function — the UI is never the security boundary.
     */
    async getEmployeeAccessStatus(
      salesId?: Identifier,
    ): Promise<EmployeeAccessRecord[]> {
      const query =
        salesId != null
          ? `?sales_id=${encodeURIComponent(String(salesId))}`
          : "";
      const { data, error } = await getSupabaseClient().functions.invoke<{
        data: EmployeeAccessRecord[];
      }>(`users${query}`, { method: "GET" });

      if (error || !data?.data) {
        throw new Error(await readEmployeeAccessErrorCode(error));
      }
      return data.data;
    },

    async resendEmployeeInvitation(
      salesId: Identifier,
    ): Promise<EmployeeAccessRecord> {
      return invokeEmployeeAccessCommand("resend_invitation", salesId);
    },

    async requestEmployeePasswordSetup(
      salesId: Identifier,
    ): Promise<EmployeeAccessRecord> {
      return invokeEmployeeAccessCommand("request_password_setup", salesId);
    },

    /**
     * "E-Mail-Adresse ändern" (W4). The only way the browser moves a login
     * email: the users Edge Function runs the executor (database guards →
     * Auth → verification). The operation id travels as the request header
     * so the audit rows of this request carry it as request_id.
     */
    async changeEmployeeLoginEmail(input: {
      salesId: Identifier;
      newEmail: string;
      operationId?: string;
    }): Promise<EmployeeEmailChangeResult> {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        data: EmployeeAccessRecord;
        previousEmail?: string;
        invitationSent?: boolean;
      }>("users", {
        method: "POST",
        body: {
          action: "change_email",
          sales_id: input.salesId,
          new_email: input.newEmail,
        },
        ...(input.operationId
          ? { headers: { [NORA_OPERATION_ID_HEADER]: input.operationId } }
          : {}),
      });

      if (error || !data?.data) {
        throw new Error(await readEmployeeAccessErrorCode(error));
      }
      return {
        record: data.data,
        previousEmail: data.previousEmail ?? "",
        invitationSent: data.invitationSent === true,
      };
    },

    /**
     * "Zugang beenden" (W5). The only way the browser ends an employee's
     * access: the users Edge Function runs the offboarding executor
     * (database: access off + sessions revoked + audit in one transaction →
     * Auth ban → verification). The operation id travels as the request
     * header so the audit rows carry it as request_id.
     */
    async offboardEmployee(input: {
      salesId: Identifier;
      operationId?: string;
    }): Promise<EmployeeOffboardingResult> {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        data: EmployeeAccessRecord;
        disposition?: "executed" | "replayed";
        sessionsRevoked?: number;
      }>("users", {
        method: "POST",
        body: { action: "offboard", sales_id: input.salesId },
        ...(input.operationId
          ? { headers: { [NORA_OPERATION_ID_HEADER]: input.operationId } }
          : {}),
      });

      if (error || !data?.data) {
        throw new Error(await readEmployeeAccessErrorCode(error));
      }
      return {
        record: data.data,
        disposition: data.disposition === "replayed" ? "replayed" : "executed",
        sessionsRevoked:
          typeof data.sessionsRevoked === "number" ? data.sessionsRevoked : 0,
        dependencies: data.data.dependencies ?? EMPTY_DEPENDENCY_PREVIEW,
      };
    },

    /**
     * "Benutzerkonto endgültig löschen" (W6-B). The only way the browser
     * removes an employee account: the users Edge Function runs the deletion
     * executor (database guards + ticket → login-provider hard delete whose
     * database guard removes the Nora identity and writes the audit row in
     * one transaction → verification). The typed name travels to the server,
     * which compares it against the current identity itself. The operation
     * id travels as the request header so the audit row carries it.
     */
    async deleteEmployeeAccount(input: {
      salesId: Identifier;
      confirmationName: string;
      adminTargetConfirmed: boolean;
      operationId?: string;
    }): Promise<EmployeeAccountDeletionResult> {
      const { data, error } = await getSupabaseClient().functions.invoke<{
        data: { employeeId: number; deleted: boolean };
        disposition?: "executed" | "already_deleted";
      }>("users", {
        method: "POST",
        body: {
          action: "delete_account",
          sales_id: input.salesId,
          confirmation_name: input.confirmationName,
          admin_target_confirmed: input.adminTargetConfirmed === true,
        },
        ...(input.operationId
          ? { headers: { [NORA_OPERATION_ID_HEADER]: input.operationId } }
          : {}),
      });

      if (error || !data?.data?.deleted) {
        throw new Error(await readEmployeeAccessErrorCode(error));
      }
      return {
        employeeId: data.data.employeeId,
        disposition:
          data.disposition === "already_deleted"
            ? "already_deleted"
            : "executed",
      };
    },

    /**
     * Employee mail delivery observability (V1C-B read path).
     *
     * Goes through the admin-only read model
     * `public.employee_email_delivery_status()`, never through
     * `email_delivery_events` itself: the function is what decides one product
     * outcome per employee and mail kind, and it is what keeps provider
     * vocabulary (hardBounce, message ids, subjects) out of the browser
     * entirely. A non-admin caller is rejected inside the function, not here.
     */
    async getEmployeeMailDeliveryStatus(
      salesId?: Identifier,
    ): Promise<EmployeeMailDeliveryStatus[]> {
      const { data, error } = await getSupabaseClient().rpc(
        "employee_email_delivery_status",
        { p_sales_id: salesId == null ? null : Number(salesId) },
      );

      if (error) {
        console.error("employee_email_delivery_status.error");
        throw new Error("employee_mail_delivery_failed");
      }

      return (data ?? []).map((row: EmployeeMailDeliveryStatusRow) => ({
        employeeId: Number(row.employee_id),
        mailKind: row.mail_kind as EmployeeMailKind,
        outcome: row.outcome as EmployeeMailDeliveryOutcome,
        lastEventAt: row.last_event_at,
        eventCount: Number(row.event_count),
      }));
    },

    async unarchiveDeal(deal: Deal) {
      // get all deals where stage is the same as the deal to unarchive
      const { data: deals } = await baseDataProvider.getList<Deal>("deals", {
        filter: { stage: deal.stage },
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "index", order: "ASC" },
      });

      // set index for each deal starting from 1, if the deal to unarchive is found, set its index to the last one
      const updatedDeals = deals.map((d, index) => ({
        ...d,
        index: d.id === deal.id ? 0 : index + 1,
        archived_at: d.id === deal.id ? null : d.archived_at,
      }));

      return await Promise.all(
        updatedDeals.map((updatedDeal) =>
          baseDataProvider.update("deals", {
            id: updatedDeal.id,
            data: updatedDeal,
            previousData: deals.find((d) => d.id === updatedDeal.id),
          }),
        ),
      );
    },
    async isInitialized() {
      return getIsInitialized();
    },
    async mergeContacts(sourceId: Identifier, targetId: Identifier) {
      const { data, error } = await getSupabaseClient().functions.invoke(
        "merge_contacts",
        {
          method: "POST",
          body: { loserId: sourceId, winnerId: targetId },
        },
      );

      if (error) {
        console.error("merge_contacts.error", error);
        throw new Error("Failed to merge contacts");
      }

      return data;
    },
    async createCustomerWithContact(
      params: CreateCustomerWithContactParams,
    ): Promise<CreateCustomerWithContactResult> {
      return executeCreateCustomerWithContact(params, (fn, args) =>
        getSupabaseClient().rpc(fn, args as any),
      );
    },
    async createCustomerFromContact(
      params: CreateCustomerFromContactParams,
    ): Promise<CreateCustomerFromContactResult> {
      return executeCreateCustomerFromContact(params, (fn, args) =>
        getSupabaseClient().rpc(fn, args as any),
      );
    },
    async createQuickCaptureCase(
      params: CreateQuickCaptureCaseParams,
    ): Promise<CreateQuickCaptureCaseResult> {
      return executeCreateQuickCaptureCase(params, (fn, args) =>
        getSupabaseClient().rpc(fn, args as any),
      );
    },
    async createQuickCaptureTask(
      params: CreateQuickCaptureTaskParams,
    ): Promise<CreateQuickCaptureTaskResult> {
      return executeCreateQuickCaptureTask(params, (fn, args) =>
        getSupabaseClient().rpc(fn, args as any),
      );
    },
    async setPrimaryContact(contactId: Identifier): Promise<void> {
      return executeSetPrimaryContact(contactId, (fn, args) =>
        getSupabaseClient().rpc(fn, args as any),
      );
    },
    async startChecklistRunFromTemplate(
      args: StartChecklistRunFromTemplateArgs,
    ): Promise<StartChecklistRunFromTemplateResult> {
      const { data, error } = await getSupabaseClient().rpc(
        START_CHECKLIST_RUN_FROM_TEMPLATE_RPC,
        args,
      );

      if (error) {
        console.error("start_checklist_run_from_template.error", error);
        throw error;
      }

      return data as StartChecklistRunFromTemplateResult;
    },
    async getConfiguration(): Promise<ConfigurationContextValue> {
      const { data } = await baseDataProvider.getOne("configuration", {
        id: 1,
      });
      return (data?.config as ConfigurationContextValue) ?? {};
    },
    async updateConfiguration(
      config: ConfigurationContextValue,
    ): Promise<ConfigurationContextValue> {
      const { data } = await baseDataProvider.update("configuration", {
        id: 1,
        data: { config },
        previousData: { id: 1 },
      });
      return data.config as ConfigurationContextValue;
    },
    async getEntityAuditEvents(
      params: GetEntityAuditEventsParams,
    ): Promise<GetEntityAuditEventsResult> {
      const { data, error } = await getSupabaseClient().rpc(
        "get_entity_audit_events",
        {
          p_entity_type: params.entityType,
          p_entity_id: params.entityId,
          p_limit: params.limit ?? 20,
          p_before: params.before ?? null,
        },
      );

      if (error) {
        console.error("get_entity_audit_events.error", error);
        throw error;
      }

      return data as GetEntityAuditEventsResult;
    },
    async getGlobalAuditEvents(
      params: GetGlobalAuditEventsParams = {},
    ): Promise<GetGlobalAuditEventsResult> {
      const { data, error } = await getSupabaseClient().rpc(
        "get_global_audit_events",
        {
          p_limit: params.limit ?? 50,
          p_before: params.before ?? null,
          p_entity_type: params.entityType ?? null,
          p_event_type: params.eventType ?? null,
          p_actor_sales_id: params.actorSalesId ?? null,
          p_from: params.from ?? null,
          p_to: params.to ?? null,
          p_business_number: params.businessNumber ?? null,
        },
      );

      if (error) {
        console.error("get_global_audit_events.error", error);
        throw error;
      }

      return data as GetGlobalAuditEventsResult;
    },
    async getAuditStorageStats(): Promise<AuditStorageStats> {
      const { data, error } = await getSupabaseClient().rpc(
        "get_audit_storage_stats",
      );

      if (error) {
        console.error("get_audit_storage_stats.error", error);
        throw error;
      }

      return data as AuditStorageStats;
    },
  } satisfies DataProvider;

  return provider;
};

/**
 * Reads the machine-readable error code out of a failed Edge Function call.
 * Never surfaces the raw provider payload — callers map the code to German
 * copy via mapEmployeeAccessError().
 */
async function readEmployeeAccessErrorCode(error: unknown): Promise<string> {
  const context = (error as { context?: { json?: () => Promise<any> } })
    ?.context;
  try {
    const details = (await context?.json?.()) ?? {};
    if (typeof details?.error === "string") return details.error;
  } catch {
    // fall through to the neutral code
  }
  return "employee_access_failed";
}

async function invokeEmployeeAccessCommand(
  action: "resend_invitation" | "request_password_setup",
  salesId: Identifier,
): Promise<EmployeeAccessRecord> {
  const { data, error } = await getSupabaseClient().functions.invoke<{
    data: EmployeeAccessRecord;
  }>("users", {
    method: "POST",
    body: { action, sales_id: salesId },
  });

  if (error || !data?.data) {
    throw new Error(await readEmployeeAccessErrorCode(error));
  }
  return data.data;
}

/** Raw shape of one `employee_email_delivery_status()` row. */
type EmployeeMailDeliveryStatusRow = {
  employee_id: number | string;
  mail_kind: string;
  outcome: string;
  last_event_at: string;
  event_count: number | string;
};

export type CrmDataProvider = ReturnType<
  typeof getDataProviderWithCustomMethods
>;

const processConfigLogo = async (logo: any): Promise<string> => {
  if (typeof logo === "string") return logo;
  if (logo?.rawFile instanceof File) {
    await uploadToBucket(logo);
    return logo.src;
  }
  return logo?.src ?? "";
};

const lifeCycleCallbacks: ResourceCallbacks[] = [
  {
    resource: "configuration",
    beforeUpdate: async (params) => {
      const config = params.data.config;
      if (config) {
        config.lightModeLogo = await processConfigLogo(config.lightModeLogo);
        config.darkModeLogo = await processConfigLogo(config.darkModeLogo);
      }
      return params;
    },
  },
  {
    resource: "contact_notes",
    beforeSave: async (data: ContactNote, _, __) => {
      if (data.attachments) {
        data.attachments = await Promise.all(
          data.attachments.map((fi) => uploadToBucket(fi)),
        );
      }
      return data;
    },
  },
  {
    resource: "deal_notes",
    beforeSave: async (data: DealNote, _, __) => {
      if (data.attachments) {
        data.attachments = await Promise.all(
          data.attachments.map((fi) => uploadToBucket(fi)),
        );
      }
      return data;
    },
  },
  {
    resource: "sales",
    beforeSave: async (data: Sale, _, __) => {
      if (data.avatar) {
        await uploadToBucket(data.avatar);
      }
      return data;
    },
  },
  {
    resource: "contacts",
    beforeGetList: async (params) => {
      return applyFullTextSearch([
        "first_name",
        "last_name",
        "company_name",
        "title",
        "email",
        "phone",
        "background",
      ])(params);
    },
  },
  {
    resource: "companies",
    beforeGetList: async (params) => {
      return applyFullTextSearch([
        "name",
        "customer_number",
        "phone_number",
        "website",
        "zipcode",
        "city",
        "state_abbr",
      ])(params);
    },
    beforeCreate: async (params) => {
      const createParams = await processCompanyLogo(params);

      return {
        ...createParams,
        data: {
          created_at: new Date().toISOString(),
          ...createParams.data,
        },
      };
    },
    beforeUpdate: async (params) => {
      return await processCompanyLogo(params);
    },
  },
  {
    resource: "contacts_summary",
    beforeGetList: async (params) => {
      return applyFullTextSearch(["first_name", "last_name"])(params);
    },
  },
  {
    resource: "deals",
    beforeGetList: async (params) => {
      return applyFullTextSearch([
        "name",
        "category",
        "description",
        "case_number",
        "stage",
      ])(params);
    },
  },
];

export const getDataProvider = () => {
  if (import.meta.env.VITE_SUPABASE_URL === undefined) {
    throw new Error("Please set the VITE_SUPABASE_URL environment variable");
  }
  if (import.meta.env.VITE_SB_PUBLISHABLE_KEY === undefined) {
    throw new Error(
      "Please set the VITE_SB_PUBLISHABLE_KEY environment variable",
    );
  }
  return withCrmErrorHandler(
    withLifecycleCallbacks(
      getDataProviderWithCustomMethods(),
      lifeCycleCallbacks,
    ) as CrmDataProvider,
  );
};

const applyFullTextSearch = (columns: string[]) => (params: GetListParams) => {
  if (!params.filter?.q) {
    return params;
  }
  const { q, ...filter } = params.filter;
  return {
    ...params,
    filter: {
      ...filter,
      "@or": columns.reduce((acc, column) => {
        if (column === "email")
          return {
            ...acc,
            [`email_fts@ilike`]: q,
          };
        if (column === "phone")
          return {
            ...acc,
            [`phone_fts@ilike`]: q,
          };
        else
          return {
            ...acc,
            [`${column}@ilike`]: q,
          };
      }, {}),
    },
  };
};

const uploadToBucket = async (fi: RAFile) => {
  if (!fi.src.startsWith("blob:") && !fi.src.startsWith("data:")) {
    // Sign URL check if path exists in the bucket
    if (fi.path) {
      const { error } = await getSupabaseClient()
        .storage.from(ATTACHMENTS_BUCKET)
        .createSignedUrl(fi.path, 60);

      if (!error) {
        return fi;
      }
    }
  }

  const dataContent = fi.src
    ? await fetch(fi.src)
        .then((res) => {
          if (res.status !== 200) {
            return null;
          }
          return res.blob();
        })
        .catch(() => null)
    : fi.rawFile;

  if (dataContent == null) {
    // We weren't able to download the file from its src (e.g. user must be signed in on another website to access it)
    // or the file has no content (not probable)
    // In that case, just return it as is: when trying to download it, users should be redirected to the other website
    // and see they need to be signed in. It will then be their responsibility to upload the file back to the note.
    return fi;
  }

  const file = fi.rawFile;
  const fileParts = file.name.split(".");
  const fileExt = fileParts.length > 1 ? `.${file.name.split(".").pop()}` : "";
  const fileName = `${Math.random()}${fileExt}`;
  const filePath = `${fileName}`;
  const { error: uploadError } = await getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .upload(filePath, dataContent);

  if (uploadError) {
    console.error("uploadError", uploadError);
    throw new Error("Failed to upload attachment");
  }

  const { data } = getSupabaseClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .getPublicUrl(filePath);

  fi.path = filePath;
  fi.src = data.publicUrl;

  // save MIME type
  const mimeType = file.type;
  fi.type = mimeType;

  return fi;
};
