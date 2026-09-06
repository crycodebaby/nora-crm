import {
  withLifecycleCallbacks,
  type CreateParams,
  type DataProvider,
  type Identifier,
  type RaRecord,
  type ResourceCallbacks,
  type UpdateParams,
} from "ra-core";
import fakeRestDataProvider from "ra-data-fakerest";

import type {
  Company,
  Contact,
  ContactNote,
  Deal,
  DealNote,
  Sale,
  SalesFormData,
  SignUpData,
  Task,
} from "../../types";
import type { StartChecklistRunFromTemplateArgs } from "../../types/checklists";
import type { ConfigurationContextValue } from "../../root/ConfigurationContext";
import { getActivityLog } from "../commons/activity";
import { getCompanyAvatar } from "../commons/getCompanyAvatar";
import { getContactAvatar } from "../commons/getContactAvatar";
import { mergeContacts } from "../commons/mergeContacts";
import {
  nextCaseNumberForFakeRest,
  nextCustomerNumberForFakeRest,
} from "../../misc/numbering";
import { performGlobalSearch } from "../../misc/globalSearch";
import { withCrmErrorHandler } from "../../misc/withCrmErrorHandler";
import { createOperationContext } from "../../operations/operationContext";
import { executeDealUpdate } from "../../operations/executeDealUpdate";
import { OPERATION_CATALOG } from "../../operations/operationCatalog";
import { getDefaultOperationManager } from "../../operations/operationManager";
import type {
  CreateCustomerWithContactParams,
  CreateCustomerWithContactResult,
} from "../../operations/executeCreateCustomerWithContact";
import type {
  CreateCustomerFromContactParams,
  CreateCustomerFromContactResult,
} from "../../operations/executeCreateCustomerFromContact";
import type {
  CreateQuickCaptureCaseParams,
  CreateQuickCaptureCaseResult,
} from "../../operations/executeCreateQuickCaptureCase";
import type {
  CreateQuickCaptureTaskParams,
  CreateQuickCaptureTaskResult,
} from "../../operations/executeCreateQuickCaptureTask";
import {
  readOperationIdFromMeta,
  withOperationIdParams,
} from "../../operations/operationTransport";
import type {
  GetEntityAuditEventsParams,
  GetGlobalAuditEventsParams,
} from "../../audit/auditTypes";
import type { CrmDataProvider } from "../types";
import {
  filterDemoEntityAuditEvents,
  filterDemoGlobalAuditEvents,
  getDemoAuditStorageStats,
} from "./dataGenerator/noraDemoAuditSeed";
import { setActiveDemoSale } from "./demoSession";
import { authProvider as defaultAuthProvider } from "./authProvider";
import generateData from "./dataGenerator";
import type { Db } from "./dataGenerator/types";
import { withSupabaseFilterAdapter } from "./internal/supabaseAdapter";
import {
  isTaskContextCheckSkipped,
  isEffectiveContactOfCompany,
} from "./internal/taskContextCheck";
import { NORA_ERROR_CODES, throwNoraError } from "../../domain/noraErrorCodes";

import type {
  EmployeeAccessRecord,
  EmployeeAccountDeletionResult,
  EmployeeDeletionPreview,
  EmployeeEmailChangeResult,
  EmployeeOffboardingResult,
  EmployeeDependencyPreview,
} from "../../sales/employeeAccessContract";
import type { EmployeeMailDeliveryStatus } from "../../sales/emailDeliveryContract";
/**
 * FakeRest mirror of nora_private.idempotency_check/idempotency_persist
 * (Idempotency Wave, 2026-08-29) — minimal contract parity, not a
 * transactional mechanism (FakeRest is single-threaded JS, so the
 * advisory-lock/unique-violation concurrency proof the real RPCs need
 * doesn't apply here). Keyed by (command, idempotencyKey, actorId), mirrors
 * the server's (command, idempotency_key, actor_id) scope.
 */
const fakeRestIdempotencyStore = new Map<
  string,
  { fingerprint: string; result: unknown }
>();

const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_key, val) => {
    if (val && typeof val === "object" && !Array.isArray(val)) {
      return Object.keys(val)
        .sort()
        .reduce((acc: Record<string, unknown>, k) => {
          acc[k] = (val as Record<string, unknown>)[k];
          return acc;
        }, {});
    }
    return val;
  });

/**
 * Operation Status Contract v1 (2026-08-29): mirrors the `_meta.disposition`
 * ("executed" | "replayed") the real RPCs now report — see
 * 20260829150000_operation_status_disposition.sql. `disposition` stays
 * undefined when no idempotencyKey was supplied, matching the server
 * contract (never assume "executed" for an unprotected legacy call).
 */
type FakeRestIdempotentRun<T> = {
  result: T;
  disposition?: "executed" | "replayed";
};

const runWithFakeRestIdempotency = async <T>(
  command: string,
  idempotencyKey: Identifier | null | undefined,
  actorId: Identifier | null | undefined,
  fingerprintInput: unknown,
  run: () => Promise<T>,
): Promise<FakeRestIdempotentRun<T>> => {
  if (idempotencyKey == null) {
    return { result: await run() };
  }
  const mapKey = `${command}:${String(idempotencyKey)}:${String(actorId ?? "")}`;
  const fingerprint = stableStringify(fingerprintInput);
  const existing = fakeRestIdempotencyStore.get(mapKey);
  if (existing) {
    if (existing.fingerprint !== fingerprint) {
      throwNoraError(
        "Idempotency-Key wurde mit einem anderen fachlichen Request wiederverwendet.",
        NORA_ERROR_CODES.IDEMPOTENCY_CONFLICT,
      );
    }
    return { result: existing.result as T, disposition: "replayed" };
  }
  const result = await run();
  fakeRestIdempotencyStore.set(mapKey, { fingerprint, result });
  return { result, disposition: "executed" };
};

/**
 * FakeRest mirror of nora_private.guard_active_assignment() (User Lifecycle
 * W2 hardening, 2026-09-05): a disabled employee may stay referenced by an
 * existing record but may not be newly assigned as the responsible employee.
 * Applies to companies/contacts/deals/tasks on create, and on update only
 * when sales_id actually changes. Historical authorship (contact_notes,
 * deal_notes) is deliberately not guarded.
 */
const assertEmployeeAssignable = async (
  dataProvider: DataProvider,
  nextSalesId: Identifier | null | undefined,
  previousSalesId?: Identifier | null,
) => {
  if (nextSalesId == null) return;
  if (
    previousSalesId !== undefined &&
    String(previousSalesId) === String(nextSalesId)
  ) {
    return;
  }
  const { data: candidates } = await dataProvider.getList<Sale>("sales", {
    filter: { id: nextSalesId },
    pagination: { page: 1, perPage: 1 },
    sort: { field: "id", order: "ASC" },
  });
  if (candidates[0]?.disabled) {
    throwNoraError(
      "Dieser Mitarbeiter ist deaktiviert und kann nicht neu zugewiesen werden",
      NORA_ERROR_CODES.EMPLOYEE_NOT_ASSIGNABLE,
    );
  }
};

const guardAssignmentOnCreate = async <
  T extends RaRecord & { sales_id?: Identifier | null },
>(
  params: CreateParams<T>,
  dataProvider: DataProvider,
) => {
  await assertEmployeeAssignable(dataProvider, params.data.sales_id);
  return params;
};

const guardAssignmentOnUpdate = async <
  T extends RaRecord & { sales_id?: Identifier | null },
>(
  params: UpdateParams<T>,
  dataProvider: DataProvider,
) => {
  if ("sales_id" in params.data) {
    await assertEmployeeAssignable(
      dataProvider,
      params.data.sales_id,
      params.previousData?.sales_id ?? null,
    );
  }
  return params;
};

/**
 * FakeRest mirror of nora_private.create_customer_with_contact_core() (Self
 * Contact Wave, 2026-08-26) — shared by createCustomerWithContact,
 * createCustomerFromContact and createQuickCaptureCase so the demo provider
 * does not duplicate this logic per call site, matching the server-side
 * shared-core design.
 */
const createCustomerWithContactCore = async (
  dataProvider: DataProvider,
  params: {
    company: Record<string, unknown> | null;
    existingCompanyId: Identifier | null;
    contact: Record<string, unknown> | null;
    existingContactId: Identifier | null;
    selfContactId: Identifier | null;
    markSelf: boolean;
    /** Only relevant for the `contact` (brand-new) branch — default true. */
    contactIsPrimary?: boolean;
  },
): Promise<{ company_id: number; contact_id: number | null }> => {
  let companyId: number;
  let customerKind: string | undefined;

  if (params.existingCompanyId != null) {
    const { data: existingCompany } = await dataProvider.getOne("companies", {
      id: params.existingCompanyId,
    });
    companyId = existingCompany.id;
    customerKind = existingCompany.customer_kind;
  } else {
    if (!params.company) {
      throw new Error("p_company required");
    }
    customerKind = (params.company.customer_kind as string) ?? "business";
    // dataProvider (lifecycle-wrapped), not baseDataProvider — first_seen/
    // last_seen/customer_number/nb_contacts defaults must run.
    const { data: company } = await dataProvider.create("companies", {
      data: params.company,
    });
    companyId = company.id;
  }

  let contactId: number | null = null;

  const markCompanySelfContact = async (id: number) => {
    const { data: previousCompany } = await dataProvider.getOne("companies", {
      id: companyId,
    });
    // Mirrors the companies_summary SQL view formula: nb_contacts counts
    // regular company_id members plus the self contact when it isn't
    // already one of them (Freddie scenario) — FakeRest keeps nb_contacts
    // as a persisted counter (see afterCreate/afterDelete below), so it
    // must be bumped explicitly here instead of being recomputed on read.
    const { data: selfContact } = await dataProvider.getOne("contacts", {
      id,
    });

    if (customerKind === "individual") {
      // Individual Name Invariant, CREATE-path — mirrors
      // nora_private.create_customer_with_contact_core()'s CREATE-path
      // guard: a Privatkundenakte's representing contact must have a
      // resolvable name (Error Contract Wave, 2026-08-28).
      const derivedName =
        `${selfContact.first_name ?? ""} ${selfContact.last_name ?? ""}`.trim();
      if (derivedName === "") {
        throwNoraError(
          "Privatkundenakte benoetigt einen Vor- oder Nachnamen des repraesentierenden Kontakts",
          NORA_ERROR_CODES.INDIVIDUAL_NAME_REQUIRED,
        );
      }

      // Mirrors uq_companies_self_contact_individual: one person has at
      // most one Privatkundenakte. Backstop for the client-side pre-check
      // in createCustomerFromContact.ts (findExistingPrivateCustomerRecord)
      // so a race/bypass still yields the same NoraErrorCode.
      const { data: conflicting } = await dataProvider.getList("companies", {
        filter: { self_contact_id: id, customer_kind: "individual" },
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "id", order: "ASC" },
      });
      const conflict = conflicting.find(
        (c: any) => String(c.id) !== String(companyId),
      );
      if (conflict) {
        throwNoraError(
          "Für diese Person existiert bereits eine Privatkundenakte",
          NORA_ERROR_CODES.PRIVATE_CUSTOMER_ALREADY_EXISTS,
        );
      }
    }

    const alreadyMember =
      String(selfContact.company_id ?? "") === String(companyId);
    await dataProvider.update("companies", {
      id: companyId,
      data: {
        self_contact_id: id,
        nb_contacts: alreadyMember
          ? previousCompany.nb_contacts
          : (previousCompany.nb_contacts ?? 0) + 1,
      },
      previousData: previousCompany,
    });
  };

  if (params.selfContactId != null) {
    const { data: existing } = await dataProvider.getOne("contacts", {
      id: params.selfContactId,
    });
    await markCompanySelfContact(existing.id);
    contactId = Number(existing.id);
  } else if (params.existingContactId != null) {
    const { data: existing } = await dataProvider.getOne("contacts", {
      id: params.existingContactId,
    });
    await dataProvider.update("contacts", {
      id: params.existingContactId,
      data: { company_id: companyId, is_primary: true },
      previousData: existing,
    });
    contactId = Number(params.existingContactId);
    if (customerKind === "individual" || params.markSelf) {
      await markCompanySelfContact(contactId);
    }
  } else if (params.contact) {
    // A new contact for an EXISTING company may need to coexist with an
    // already-primary contact — mirrors
    // nora_private.create_customer_with_contact_core()'s p_contact_is_primary
    // handling: demote any previous primary first instead of blindly
    // hardcoding is_primary=true (would otherwise create two primaries).
    const isPrimary = params.contactIsPrimary ?? true;
    if (isPrimary) {
      const { data: siblings } = await dataProvider.getList("contacts", {
        filter: { company_id: companyId },
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "id", order: "ASC" },
      });
      await Promise.all(
        siblings
          .filter((c: any) => c.is_primary)
          .map((c: any) =>
            dataProvider.update("contacts", {
              id: c.id,
              data: { is_primary: false },
              previousData: c,
            }),
          ),
      );
    }
    const { data: contact } = await dataProvider.create("contacts", {
      data: {
        ...params.contact,
        company_id: companyId,
        is_primary: isPrimary,
      },
    });
    contactId = contact.id;
    if (customerKind === "individual" || params.markSelf) {
      await markCompanySelfContact(contact.id);
    }
  }

  return { company_id: companyId, contact_id: contactId };
};

const TASK_MARKED_AS_DONE = "TASK_MARKED_AS_DONE";
const TASK_MARKED_AS_UNDONE = "TASK_MARKED_AS_UNDONE";
const TASK_DONE_NOT_CHANGED = "TASK_DONE_NOT_CHANGED";

/**
 * Mirrors nora_private.enforce_task_company_context() (see
 * supabase/migrations/*_unified_tasks_wave.sql, extended by the Self
 * Contact Wave): when a task's contact_id is set, derive company_id from
 * the contact's effective context if not given, or reject a company_id
 * that doesn't match it — unless the contact is the given company's
 * self_contact (isEffectiveContactOfCompany). A task must always end up
 * with a company_id or a contact_id.
 */
const deriveTaskCompanyContext = async (
  data: Partial<Task>,
  dataProvider: DataProvider,
): Promise<Partial<Pick<Task, "company_id">>> => {
  if (data.contact_id != null) {
    const { data: contact } = await dataProvider.getOne("contacts", {
      id: data.contact_id,
    });
    if (contact?.company_id != null) {
      if (data.company_id == null) {
        return { company_id: contact.company_id };
      }
      if (
        data.company_id !== contact.company_id &&
        !(await isEffectiveContactOfCompany(
          data.contact_id,
          data.company_id,
          dataProvider,
        ))
      ) {
        throwNoraError(
          "tasks.company_id does not match the effective contact context of the selected contact",
          NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT,
        );
      }
    } else if (
      data.company_id != null &&
      !(await isEffectiveContactOfCompany(
        data.contact_id,
        data.company_id,
        dataProvider,
      ))
    ) {
      throwNoraError(
        "tasks.company_id does not match contact (no employer, not the representing person of that customer record)",
        NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT,
      );
    }
  }

  if (data.company_id == null && data.contact_id == null) {
    throw new Error("A task must have a company_id or a contact_id");
  }

  return {};
};

const processCompanyLogo = async (params: any) => {
  let logo = params.data.logo;

  if (typeof logo !== "object" || logo === null || !logo.src) {
    logo = await getCompanyAvatar(params.data);
  } else if (logo.rawFile instanceof File) {
    const base64Logo = await convertFileToBase64(logo);
    logo = { src: base64Logo, title: logo.title };
  }

  return {
    ...params,
    data: {
      ...params.data,
      logo,
    },
  };
};

async function processContactAvatar(
  params: UpdateParams<Contact>,
): Promise<UpdateParams<Contact>>;

async function processContactAvatar(
  params: CreateParams<Contact>,
): Promise<CreateParams<Contact>>;

async function processContactAvatar(
  params: CreateParams<Contact> | UpdateParams<Contact>,
): Promise<CreateParams<Contact> | UpdateParams<Contact>> {
  const { data } = params;
  if (data.avatar?.src || !data.email_jsonb || !data.email_jsonb.length) {
    return params;
  }
  const avatarUrl = await getContactAvatar(data);

  // Clone the data and modify the clone
  const newData = { ...data, avatar: { src: avatarUrl || undefined } };

  return { ...params, data: newData };
}

async function fetchAndUpdateCompanyData(
  params: UpdateParams<Contact>,
  dataProvider: DataProvider,
): Promise<UpdateParams<Contact>>;

async function fetchAndUpdateCompanyData(
  params: CreateParams<Contact>,
  dataProvider: DataProvider,
): Promise<CreateParams<Contact>>;

async function fetchAndUpdateCompanyData(
  params: CreateParams<Contact> | UpdateParams<Contact>,
  dataProvider: DataProvider,
): Promise<CreateParams<Contact> | UpdateParams<Contact>> {
  const { data } = params;
  const newData = { ...data };

  if (!newData.company_id) {
    return params;
  }

  const { data: company } = await dataProvider.getOne("companies", {
    id: newData.company_id,
  });

  if (!company) {
    return params;
  }

  newData.company_name = company.name;
  return { ...params, data: newData };
}

export interface CreateFakeRestDataProviderOptions {
  db?: Db;
  latency?: number;
  authProvider?: Pick<typeof defaultAuthProvider, "getIdentity">;
  silent?: boolean;
}

const processConfigLogo = async (logo: any): Promise<string> => {
  if (typeof logo === "string") return logo;
  if (logo?.rawFile instanceof File) {
    return (await convertFileToBase64(logo)) as string;
  }
  return logo?.src ?? "";
};

const preserveAttachmentMimeType = <
  NoteType extends { attachments?: Array<{ rawFile?: File; type?: string }> },
>(
  note: NoteType,
): NoteType => ({
  ...note,
  attachments: (note.attachments ?? []).map((attachment) => ({
    ...attachment,
    type: attachment.type ?? attachment.rawFile?.type,
  })),
});

export const createDataProvider = ({
  db = generateData(),
  latency = 300,
  authProvider,
  silent = false,
}: CreateFakeRestDataProviderOptions = {}): CrmDataProvider => {
  const baseDataProvider = fakeRestDataProvider(db, !silent, latency);
  let taskUpdateType = TASK_DONE_NOT_CHANGED;
  const getIdentity = async () =>
    authProvider?.getIdentity?.() ?? defaultAuthProvider.getIdentity?.();

  const updateCompany = async (
    companyId: Identifier,
    updateFn: (company: Company) => Partial<Company>,
  ) => {
    const { data: company } = await dataProvider.getOne<Company>("companies", {
      id: companyId,
    });

    return await dataProvider.update("companies", {
      id: companyId,
      data: {
        ...updateFn(company),
      },
      previousData: company,
    });
  };

  /** W5 demo parity: real counts from the demo store, notes separate. */
  const countDemoDependencies = async (
    salesId: Identifier,
  ): Promise<EmployeeDependencyPreview> => {
    const count = async (
      resource: string,
      predicate: (row: Record<string, unknown>) => boolean = () => true,
    ) => {
      const { data } = await dataProvider.getList<
        Record<string, unknown> & { id: Identifier }
      >(resource, {
        filter: { sales_id: salesId },
        pagination: { page: 1, perPage: 10000 },
        sort: { field: "id", order: "ASC" },
      });
      return data.filter(predicate).length;
    };
    return {
      companies: await count("companies"),
      contacts: await count("contacts"),
      openDeals: await count("deals", (d) => d.archived_at == null),
      openTasks: await count("tasks", (t) => t.done_date == null),
      contactNotes: await count("contact_notes"),
      dealNotes: await count("deal_notes"),
    };
  };

  const dataProviderWithCustomMethod: CrmDataProvider = {
    ...baseDataProvider,
    async globalSearch(query: string) {
      return performGlobalSearch(dataProvider, query);
    },
    async getList(resource: string, params: any) {
      if (resource === "activity_log") {
        const { filter = {}, pagination } = params;
        const all = await getActivityLog(
          withSupabaseFilterAdapter(baseDataProvider),
          filter.company_id,
          filter.sales_id,
        );
        const { page, perPage } = pagination;
        const start = (page - 1) * perPage;
        return { data: all.slice(start, start + perPage), total: all.length };
      }
      return baseDataProvider.getList(resource, params);
    },
    // Wave 2: deal.update via Operation Manager; Wave 1 header transport unchanged.
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
    unarchiveDeal: async (deal: Deal) => {
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
          dataProvider.update("deals", {
            id: updatedDeal.id,
            data: updatedDeal,
            previousData: deals.find((d) => d.id === updatedDeal.id),
          }),
        ),
      );
    },
    signUp: async ({
      email,
      password,
      first_name,
      last_name,
    }: SignUpData): Promise<{
      id: string;
      email: string;
      password: string;
    }> => {
      const user = await baseDataProvider.create("sales", {
        data: {
          email,
          first_name,
          last_name,
        },
      });

      return {
        ...user.data,
        password,
      };
    },
    salesCreate: async ({ ...data }: SalesFormData): Promise<Sale> => {
      const response = await dataProvider.create("sales", {
        data: {
          ...data,
          password: "new_password",
        },
      });

      return response.data;
    },
    salesUpdate: async (
      id: Identifier,
      data: Partial<Omit<SalesFormData, "password">>,
    ): Promise<Sale> => {
      const { data: previousData } = await dataProvider.getOne<Sale>("sales", {
        id,
      });

      if (!previousData) {
        throw new Error("User not found");
      }

      const { data: sale } = await dataProvider.update<Sale>("sales", {
        id,
        data,
        previousData,
      });
      return { ...sale, user_id: sale.id.toString() };
    },
    isInitialized: async (): Promise<boolean> => {
      const sales = await dataProvider.getList<Sale>("sales", {
        filter: {},
        pagination: { page: 1, perPage: 1 },
        sort: { field: "id", order: "ASC" },
      });
      if (sales.data.length === 0) {
        return false;
      }
      return true;
    },
    /**
     * Employee Access (V1A) — FakeRest parity. The demo has no Supabase Auth,
     * so the state is derived from the demo sales row alone: "disabled" when
     * the row is disabled, otherwise "active". No mail is ever sent; the two
     * commands answer with the unchanged record so the admin UI is exercisable
     * in demo mode without pretending an email left the building.
     */
    getEmployeeAccessStatus: async (
      salesId?: Identifier,
    ): Promise<EmployeeAccessRecord[]> => {
      if (salesId != null) {
        const { data } = await dataProvider.getOne<Sale>("sales", {
          id: salesId,
        });
        return data ? [toDemoAccessRecord(data)] : [];
      }
      const { data } = await dataProvider.getList<Sale>("sales", {
        filter: {},
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "id", order: "ASC" },
      });
      return data.map(toDemoAccessRecord);
    },
    resendEmployeeInvitation: async (
      salesId: Identifier,
    ): Promise<EmployeeAccessRecord> => {
      const { data } = await dataProvider.getOne<Sale>("sales", {
        id: salesId,
      });
      return toDemoAccessRecord(data);
    },
    requestEmployeePasswordSetup: async (
      salesId: Identifier,
    ): Promise<EmployeeAccessRecord> => {
      const { data } = await dataProvider.getOne<Sale>("sales", {
        id: salesId,
      });
      return toDemoAccessRecord(data);
    },

    /**
     * "E-Mail-Adresse ändern" (W4) — FakeRest parity. The demo has one
     * identity store, so the change is the same guards (unchanged, invalid,
     * already used — case-insensitive) followed by one update. No mail.
     */
    changeEmployeeLoginEmail: async (input: {
      salesId: Identifier;
      newEmail: string;
      operationId?: string;
    }): Promise<EmployeeEmailChangeResult> => {
      const { data: sale } = await dataProvider.getOne<Sale>("sales", {
        id: input.salesId,
      });
      if (!sale) throw new Error("not_found");
      const next = input.newEmail.trim().toLowerCase();
      if (!next || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) {
        throw new Error("invalid_email");
      }
      const current = String(sale.email ?? "")
        .trim()
        .toLowerCase();
      if (next === current) throw new Error("email_unchanged");
      const { data: all } = await dataProvider.getList<Sale>("sales", {
        filter: {},
        pagination: { page: 1, perPage: 1000 },
        sort: { field: "id", order: "ASC" },
      });
      if (
        all.some(
          (other) =>
            String(other.id) !== String(sale.id) &&
            String(other.email ?? "")
              .trim()
              .toLowerCase() === next,
        )
      ) {
        throw new Error("email_already_in_use");
      }
      const { data: updated } = await dataProvider.update<Sale>("sales", {
        id: input.salesId,
        data: { email: next },
        previousData: sale,
      });
      return {
        record: toDemoAccessRecord(updated),
        previousEmail: sale.email,
        invitationSent: false,
      };
    },

    /**
     * "Zugang beenden" (W5) — FakeRest parity. The demo has one store and no
     * sessions to revoke: the access flag goes off through the same update
     * the edit form uses (which also maintains the sales_directory /
     * sales_identities projections), the dependency counts are real demo
     * counts, nothing is mailed. A second call replays.
     */
    offboardEmployee: async (input: {
      salesId: Identifier;
      operationId?: string;
    }): Promise<EmployeeOffboardingResult> => {
      const { data: sale } = await dataProvider.getOne<Sale>("sales", {
        id: input.salesId,
      });
      if (!sale) throw new Error("not_found");
      const currentUser = await getIdentity();
      if (currentUser && String(currentUser.id) === String(sale.id)) {
        throw new Error("self_access_change_forbidden");
      }
      const wasDisabled = sale.disabled === true;
      const updated = wasDisabled
        ? sale
        : (
            await dataProvider.update<Sale>("sales", {
              id: input.salesId,
              data: { disabled: true },
              previousData: sale,
            })
          ).data;
      const dependencies = await countDemoDependencies(sale.id);
      return {
        record: { ...toDemoAccessRecord(updated), dependencies },
        disposition: wasDisabled ? "replayed" : "executed",
        sessionsRevoked: 0,
        dependencies,
      };
    },

    /**
     * "Benutzerkonto endgültig löschen" (W6-B) — deliberately NOT available in
     * demo mode. The real path is a database-guarded, login-provider-driven
     * transaction with server-side eligibility; FakeRest has no Auth store,
     * no audit guard and no data-level authorization, so a demo "deletion"
     * would pretend a security model that does not exist here (documented
     * demo gap, 17-known-issues). The record says `supported: false` and the
     * command refuses with a typed code; the UI shows the explanation and no
     * destructive control.
     */
    deleteEmployeeAccount: async (_input: {
      salesId: Identifier;
      confirmationName: string;
      adminTargetConfirmed: boolean;
      operationId?: string;
    }): Promise<EmployeeAccountDeletionResult> => {
      throw new Error("demo_unsupported");
    },

    /**
     * Delivery observability (V1C-B) — FakeRest parity.
     *
     * The demo sends no mail, so there is no delivery history to report and
     * none is invented. The surface then renders no delivery status at all,
     * which is precisely the behaviour a real employee with no history gets.
     */
    getEmployeeMailDeliveryStatus: async (
      _salesId?: Identifier,
    ): Promise<EmployeeMailDeliveryStatus[]> => [],
    updatePassword: async (id: Identifier): Promise<true> => {
      const currentUser = await getIdentity();
      if (!currentUser) {
        throw new Error("User not found");
      }
      const { data: previousData } = await dataProvider.getOne<Sale>("sales", {
        id: currentUser.id,
      });

      if (!previousData) {
        throw new Error("User not found");
      }

      await dataProvider.update("sales", {
        id,
        data: {
          password: "demo_newPassword",
        },
        previousData,
      });

      return true;
    },
    mergeContacts: async (sourceId: Identifier, targetId: Identifier) => {
      return mergeContacts(sourceId, targetId, baseDataProvider);
    },
    createCustomerWithContact: async (
      params: CreateCustomerWithContactParams,
    ): Promise<CreateCustomerWithContactResult> =>
      getDefaultOperationManager().execute(
        OPERATION_CATALOG["customer.createWithContact"],
        {},
        async () =>
          createCustomerWithContactCore(dataProvider, {
            company: params.company,
            existingCompanyId: null,
            contact: params.contact ?? null,
            existingContactId: params.existingContactId ?? null,
            selfContactId: params.selfContactId ?? null,
            markSelf: params.markSelf ?? false,
          }),
      ),
    createCustomerFromContact: async (
      params: CreateCustomerFromContactParams,
    ): Promise<CreateCustomerFromContactResult> =>
      getDefaultOperationManager().execute(
        OPERATION_CATALOG["contact.convertToCustomer"],
        {},
        async (context) => {
          const identity = await getIdentity();
          const { result, disposition } = await runWithFakeRestIdempotency(
            "create_customer_with_contact",
            params.idempotencyKey,
            identity?.id,
            {
              company: params.company,
              contactId: params.contactId,
            },
            () =>
              createCustomerWithContactCore(dataProvider, {
                company: params.company,
                existingCompanyId: null,
                contact: null,
                existingContactId: null,
                selfContactId: params.contactId,
                markSelf: false,
              }),
          );
          if (disposition) {
            context.reportOutcome({
              execution: disposition,
              result: {
                companyId: result.company_id,
                contactId: result.contact_id,
              },
            });
          }
          return result;
        },
      ),
    createQuickCaptureCase: async (
      params: CreateQuickCaptureCaseParams,
    ): Promise<CreateQuickCaptureCaseResult> =>
      getDefaultOperationManager().execute(
        OPERATION_CATALOG["quickCapture.createCase"],
        // Parity with the Supabase path (Phase 7B.3): an explicitly supplied
        // correlation id is used verbatim; without one the manager mints.
        { operationId: params.operationId },
        async (context) => {
          const identity = await getIdentity();
          const { result, disposition } = await runWithFakeRestIdempotency(
            "quick_capture_case.core",
            params.idempotencyKey,
            identity?.id,
            {
              company: params.company ?? null,
              existingCompanyId: params.existingCompanyId ?? null,
              contact: params.contact ?? null,
              existingContactId: params.existingContactId ?? null,
              selfContactId: params.selfContactId ?? null,
              deal: params.deal,
              contactIsPrimary: params.contactIsPrimary ?? true,
            },
            async () => {
              // "Already effective" (existing company + existing contact
              // that already belongs to it) is reference-only — no
              // company_id/is_primary mutation, mirrors
              // create_quick_capture_case()'s v_reference_contact_id split.
              // Picking an existing contact of an already-established
              // customer record must not silently promote/demote who is
              // primary.
              let referenceContactId: Identifier | null = null;
              let coreExistingContactId: Identifier | null =
                params.existingContactId ?? null;

              if (
                params.existingCompanyId != null &&
                params.existingContactId != null
              ) {
                if (
                  !(await isEffectiveContactOfCompany(
                    params.existingContactId,
                    params.existingCompanyId,
                    dataProvider,
                  ))
                ) {
                  throwNoraError(
                    "Quick Capture darf einen bestehenden Kontakt nicht einem Kunden zuordnen, zu dessen effektivem Kontaktkreis er nicht gehört.",
                    NORA_ERROR_CODES.CONTACT_NOT_IN_CUSTOMER_CONTEXT,
                  );
                }
                referenceContactId = params.existingContactId;
                coreExistingContactId = null;
              }

              const core = await createCustomerWithContactCore(dataProvider, {
                company: params.company ?? null,
                existingCompanyId: params.existingCompanyId ?? null,
                contact: params.contact ?? null,
                existingContactId: coreExistingContactId,
                selfContactId: params.selfContactId ?? null,
                markSelf: false,
                contactIsPrimary: params.contactIsPrimary ?? true,
              });

              const company_id = core.company_id;
              const contact_id =
                referenceContactId != null
                  ? Number(referenceContactId)
                  : core.contact_id;

              const { data: deal } = await dataProvider.create("deals", {
                data: {
                  ...params.deal,
                  company_id,
                  contact_ids: contact_id != null ? [contact_id] : [],
                },
              });

              return { company_id, contact_id, deal_id: deal.id };
            },
          );
          if (disposition) {
            context.reportOutcome({
              execution: disposition,
              result: {
                companyId: result.company_id,
                contactId: result.contact_id,
                dealId: result.deal_id,
              },
            });
          }
          return result;
        },
      ),
    createQuickCaptureTask: async (
      params: CreateQuickCaptureTaskParams,
    ): Promise<CreateQuickCaptureTaskResult> =>
      getDefaultOperationManager().execute(
        OPERATION_CATALOG["quickCapture.createTask"],
        { operationId: params.operationId },
        async (context) => {
          const identity = await getIdentity();
          const { result, disposition } = await runWithFakeRestIdempotency(
            "quick_capture_case.task",
            params.idempotencyKey,
            identity?.id,
            {
              companyId: params.companyId,
              contactId: params.contactId ?? null,
              type: params.type ?? null,
              text: params.text ?? null,
              dueDate: params.dueDate ?? null,
              salesId: params.salesId ?? null,
            },
            async () => {
              if (params.companyId == null && params.contactId == null) {
                throw new Error("p_company_id or p_contact_id required");
              }
              const { data: task } = await dataProvider.create<Task>("tasks", {
                data: {
                  contact_id: params.contactId ?? undefined,
                  company_id: params.companyId ?? undefined,
                  type: params.type ?? undefined,
                  text: params.text ?? undefined,
                  due_date: params.dueDate ?? undefined,
                  sales_id: params.salesId ?? undefined,
                } as Task,
              });
              return { task_id: Number(task.id) };
            },
          );
          if (disposition) {
            context.reportOutcome({
              execution: disposition,
              result: { taskId: result.task_id },
            });
          }
          return result;
        },
      ),
    setPrimaryContact: async (contactId: Identifier): Promise<void> => {
      await getDefaultOperationManager().execute(
        OPERATION_CATALOG["contact.setPrimary"],
        { resourceId: contactId },
        async () => {
          const { data: contact } = await dataProvider.getOne("contacts", {
            id: contactId,
          });
          if (contact.company_id == null) {
            throw new Error("contact has no company");
          }
          const { data: siblings } = await dataProvider.getList("contacts", {
            filter: { company_id: contact.company_id },
            pagination: { page: 1, perPage: 1000 },
            sort: { field: "id", order: "ASC" },
          });
          await Promise.all(
            siblings
              .filter(
                (c: Contact) => c.id !== contact.id && (c as any).is_primary,
              )
              .map((c: Contact) =>
                dataProvider.update("contacts", {
                  id: c.id,
                  data: { is_primary: false },
                  previousData: c,
                }),
              ),
          );
          await dataProvider.update("contacts", {
            id: contact.id,
            data: { is_primary: true },
            previousData: contact,
          });
        },
      );
    },
    startChecklistRunFromTemplate: async (
      _args: StartChecklistRunFromTemplateArgs,
    ): Promise<string> => {
      throw new Error("CHECKLISTS_NOT_AVAILABLE_IN_DEMO");
    },
    getConfiguration: async (): Promise<ConfigurationContextValue> => {
      const { data } = await baseDataProvider.getOne("configuration", {
        id: 1,
      });
      return (data?.config as ConfigurationContextValue) ?? {};
    },
    updateConfiguration: async (
      config: ConfigurationContextValue,
    ): Promise<ConfigurationContextValue> => {
      const { data: prev } = await baseDataProvider.getOne("configuration", {
        id: 1,
      });
      await baseDataProvider.update("configuration", {
        id: 1,
        data: { config },
        previousData: prev,
      });
      return config;
    },
    getEntityAuditEvents: async (params: GetEntityAuditEventsParams) => {
      const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
      const data = filterDemoEntityAuditEvents(
        params.entityType,
        params.entityId,
        limit,
        params.before,
      );
      return { data, limit };
    },
    getGlobalAuditEvents: async (params: GetGlobalAuditEventsParams = {}) => {
      const limit = Math.min(Math.max(params.limit ?? 50, 1), 200);
      const data = filterDemoGlobalAuditEvents({
        limit,
        before: params.before,
        entityType: params.entityType,
        eventType: params.eventType,
        actorSalesId: params.actorSalesId,
        from: params.from,
        to: params.to,
        businessNumber: params.businessNumber,
      });
      return { data, limit };
    },
    getAuditStorageStats: async () => getDemoAuditStorageStats(),
  };

  const dataProvider = withLifecycleCallbacks(
    withSupabaseFilterAdapter(dataProviderWithCustomMethod),
    [
      {
        resource: "configuration",
        beforeUpdate: async (params) => {
          const config = params.data.config;
          if (config) {
            config.lightModeLogo = await processConfigLogo(
              config.lightModeLogo,
            );
            config.darkModeLogo = await processConfigLogo(config.darkModeLogo);
          }
          return params;
        },
      },
      {
        resource: "sales",
        beforeCreate: async (params) => {
          const { data } = params;
          if (data.role == null) {
            data.role = data.administrator ? "admin" : "viewer";
          }
          if (data.administrator == null) {
            data.administrator = data.role === "admin";
          }
          return params;
        },
        afterSave: async (data) => {
          const entry = {
            id: data.id,
            first_name: data.first_name,
            last_name: data.last_name,
            avatar: data.avatar,
          };
          // The FakeRest store copies the seed arrays, so `db.*` mutations
          // never reach what getList/getMany serve. Both read models are
          // maintained through the store itself (W2; the directory sync was
          // a silent no-op before).
          const upsertProjection = async (
            resource: "sales_directory" | "sales_identities",
            row: Record<string, unknown> & { id: Identifier },
          ) => {
            const { data: existing } = await baseDataProvider.getList(
              resource,
              {
                filter: { id: row.id },
                pagination: { page: 1, perPage: 1 },
                sort: { field: "id", order: "ASC" },
              },
            );
            if (existing.length > 0) {
              await baseDataProvider.update(resource, {
                id: row.id,
                data: row,
                previousData: existing[0],
              });
            } else {
              await baseDataProvider.create(resource, { data: row });
            }
          };
          const removeProjection = async (
            resource: "sales_directory" | "sales_identities",
            id: Identifier,
          ) => {
            const { data: existing } = await baseDataProvider.getList(
              resource,
              {
                filter: { id },
                pagination: { page: 1, perPage: 1 },
                sort: { field: "id", order: "ASC" },
              },
            );
            if (existing.length > 0) {
              await baseDataProvider.delete(resource, {
                id,
                previousData: existing[0],
              });
            }
          };

          // sales_directory = ACTIVE employees only (assignment pickers)
          if (!data.disabled) {
            await upsertProjection("sales_directory", entry);
          } else {
            await removeProjection("sales_directory", data.id);
          }

          // sales_identities keeps every employee, disabled included (W2):
          // a deactivated employee must still resolve by name on old records.
          await upsertProjection("sales_identities", {
            ...entry,
            disabled: data.disabled === true,
          });

          // Since the current user is stored in localStorage in fakerest authProvider
          // we need to update it to keep information up to date in the UI
          const currentUser = await getIdentity();
          if (currentUser?.id === data.id) {
            setActiveDemoSale(data);
          }
          return data;
        },
        beforeDelete: async (params) => {
          if (params.meta?.identity?.id == null) {
            throw new Error("Identity MUST be set in meta");
          }

          const newSaleId = params.meta.identity.id as Identifier;

          const [companies, contacts, contactNotes, deals] = await Promise.all([
            dataProvider.getList("companies", {
              filter: { sales_id: params.id },
              pagination: {
                page: 1,
                perPage: 10_000,
              },
              sort: { field: "id", order: "ASC" },
            }),
            dataProvider.getList("contacts", {
              filter: { sales_id: params.id },
              pagination: {
                page: 1,
                perPage: 10_000,
              },
              sort: { field: "id", order: "ASC" },
            }),
            dataProvider.getList("contact_notes", {
              filter: { sales_id: params.id },
              pagination: {
                page: 1,
                perPage: 10_000,
              },
              sort: { field: "id", order: "ASC" },
            }),
            dataProvider.getList("deals", {
              filter: { sales_id: params.id },
              pagination: {
                page: 1,
                perPage: 10_000,
              },
              sort: { field: "id", order: "ASC" },
            }),
          ]);

          await Promise.all([
            dataProvider.updateMany("companies", {
              ids: companies.data.map((company) => company.id),
              data: {
                sales_id: newSaleId,
              },
            }),
            dataProvider.updateMany("contacts", {
              ids: contacts.data.map((company) => company.id),
              data: {
                sales_id: newSaleId,
              },
            }),
            dataProvider.updateMany("contact_notes", {
              ids: contactNotes.data.map((company) => company.id),
              data: {
                sales_id: newSaleId,
              },
            }),
            dataProvider.updateMany("deals", {
              ids: deals.data.map((company) => company.id),
              data: {
                sales_id: newSaleId,
              },
            }),
          ]);

          // Demo-only reassignment path (no UI, no Supabase equivalent): the
          // projections follow the deleted row through the store.
          for (const resource of [
            "sales_directory",
            "sales_identities",
          ] as const) {
            const { data: existing } = await baseDataProvider.getList(
              resource,
              {
                filter: { id: params.id },
                pagination: { page: 1, perPage: 1 },
                sort: { field: "id", order: "ASC" },
              },
            );
            if (existing.length > 0) {
              await baseDataProvider.delete(resource, {
                id: params.id,
                previousData: existing[0],
              });
            }
          }

          return params;
        },
      } satisfies ResourceCallbacks<Sale>,
      {
        resource: "contacts",
        beforeCreate: async (createParams, dataProvider) => {
          await guardAssignmentOnCreate(createParams, dataProvider);
          const params = {
            ...createParams,
            data: {
              ...createParams.data,
              first_seen:
                createParams.data.first_seen ?? new Date().toISOString(),
              last_seen:
                createParams.data.last_seen ?? new Date().toISOString(),
            },
          };
          const newParams = await processContactAvatar(params);
          return fetchAndUpdateCompanyData(newParams, dataProvider);
        },
        afterCreate: async (result) => {
          if (result.data.company_id != null) {
            await updateCompany(result.data.company_id, (company) => ({
              nb_contacts: (company.nb_contacts ?? 0) + 1,
            }));
          }

          return result;
        },
        beforeUpdate: async (params, dataProvider) => {
          await guardAssignmentOnUpdate(params, dataProvider);
          // Individual Name Invariant, rename-path — mirrors
          // nora_private.sync_individual_company_name(): renaming this
          // contact's first_name/last_name to blank is rejected if it
          // currently represents a Privatkundenakte (Error Contract Wave,
          // 2026-08-28).
          if ("first_name" in params.data || "last_name" in params.data) {
            const derivedName =
              `${params.data.first_name ?? ""} ${params.data.last_name ?? ""}`.trim();
            if (derivedName === "") {
              const { data: represented } = await dataProvider.getList(
                "companies",
                {
                  filter: {
                    self_contact_id: params.id,
                    customer_kind: "individual",
                  },
                  pagination: { page: 1, perPage: 1 },
                  sort: { field: "id", order: "ASC" },
                },
              );
              if (represented.length > 0) {
                throwNoraError(
                  "Privatkundenakte benoetigt einen Vor- oder Nachnamen (companies.name darf nicht leer werden)",
                  NORA_ERROR_CODES.INDIVIDUAL_NAME_REQUIRED,
                );
              }
            }
          }
          const newParams = await processContactAvatar(params);
          return fetchAndUpdateCompanyData(newParams, dataProvider);
        },
        beforeDelete: async (params, dataProvider) => {
          // Mirrors nora_private.guard_self_contact_delete(): the person
          // representing a Privatkundenakte cannot be deleted (Error
          // Contract Wave, 2026-08-28).
          const { data: represented } = await dataProvider.getList(
            "companies",
            {
              filter: {
                self_contact_id: params.id,
                customer_kind: "individual",
              },
              pagination: { page: 1, perPage: 1 },
              sort: { field: "id", order: "ASC" },
            },
          );
          if (represented.length > 0) {
            throwNoraError(
              "Person hinter einer Privatkundenakte kann nicht geloescht werden — zuerst die Kundenakte anpassen",
              NORA_ERROR_CODES.SELF_CONTACT_DELETE_BLOCKED,
            );
          }
          return params;
        },
        afterDelete: async (result, dataProvider) => {
          if (result.data.company_id != null) {
            await updateCompany(result.data.company_id, (company) => ({
              nb_contacts: (company.nb_contacts ?? 1) - 1,
            }));
          }

          // Mirrors nora_private.delete_contact_only_tasks() +
          // tasks_contact_id_fkey ON DELETE SET NULL: tasks that also carry
          // a company_id survive with contact_id cleared; tasks that only
          // had this (now-deleted) contact are removed, same as before.
          const { data: orphanedTasks } = await dataProvider.getList<Task>(
            "tasks",
            {
              pagination: { page: 1, perPage: 1000 },
              sort: { field: "id", order: "ASC" },
              filter: { contact_id: result.data.id },
            },
          );
          await Promise.all(
            (orphanedTasks ?? []).map((task) =>
              task.company_id != null
                ? dataProvider.update("tasks", {
                    id: task.id,
                    data: { contact_id: null },
                    previousData: task,
                  })
                : dataProvider.delete("tasks", {
                    id: task.id,
                    previousData: task,
                  }),
            ),
          );

          return result;
        },
      } satisfies ResourceCallbacks<Contact>,
      {
        resource: "tasks",
        beforeCreate: async (params, dataProvider) => {
          await guardAssignmentOnCreate(params, dataProvider);
          const derived = await deriveTaskCompanyContext(
            params.data,
            dataProvider,
          );
          return {
            ...params,
            data: { ...params.data, ...derived },
          };
        },
        afterCreate: async (result, dataProvider) => {
          // update the task count in the related contact
          const { contact_id } = result.data;
          if (contact_id == null) return result;
          const { data: contact } = await dataProvider.getOne("contacts", {
            id: contact_id,
          });
          await dataProvider.update("contacts", {
            id: contact_id,
            data: {
              nb_tasks: (contact.nb_tasks ?? 0) + 1,
            },
            previousData: contact,
          });
          return result;
        },
        beforeUpdate: async (params, dataProvider) => {
          await guardAssignmentOnUpdate(params, dataProvider);
          const { data, previousData } = params;
          if (previousData.done_date !== data.done_date) {
            taskUpdateType = data.done_date
              ? TASK_MARKED_AS_DONE
              : TASK_MARKED_AS_UNDONE;
          } else {
            taskUpdateType = TASK_DONE_NOT_CHANGED;
          }

          // Historical context is only (re-)validated/derived when the
          // task's own contact_id/company_id is actually being changed —
          // never on a routine field-only update (text/due_date/done_date/
          // type/sales_id), and never on a partial update that doesn't
          // touch either field at all (e.g. "postpone", "mark done").
          // Mirrors nora_private.enforce_task_company_context().
          if (isTaskContextCheckSkipped()) {
            return params;
          }
          const contactIdTouched =
            "contact_id" in data &&
            (data.contact_id ?? null) !== (previousData.contact_id ?? null);
          const companyIdTouched =
            "company_id" in data &&
            (data.company_id ?? null) !== (previousData.company_id ?? null);
          if (!contactIdTouched && !companyIdTouched) {
            return params;
          }

          const effectiveData = {
            ...data,
            contact_id:
              "contact_id" in data ? data.contact_id : previousData.contact_id,
            company_id:
              "company_id" in data ? data.company_id : previousData.company_id,
          };
          const derived = await deriveTaskCompanyContext(
            effectiveData,
            dataProvider,
          );
          return {
            ...params,
            data: { ...data, ...derived },
          };
        },
        afterUpdate: async (result, dataProvider) => {
          // update the contact: if the task is done, decrement the nb tasks, otherwise increment it
          const { contact_id } = result.data;
          if (contact_id == null) return result;
          const { data: contact } = await dataProvider.getOne("contacts", {
            id: contact_id,
          });
          if (taskUpdateType !== TASK_DONE_NOT_CHANGED) {
            await dataProvider.update("contacts", {
              id: contact_id,
              data: {
                nb_tasks:
                  taskUpdateType === TASK_MARKED_AS_DONE
                    ? (contact.nb_tasks ?? 0) - 1
                    : (contact.nb_tasks ?? 0) + 1,
              },
              previousData: contact,
            });
          }
          return result;
        },
        afterDelete: async (result, dataProvider) => {
          // update the task count in the related contact
          const { contact_id } = result.data;
          if (contact_id == null) return result;
          const { data: contact } = await dataProvider.getOne("contacts", {
            id: contact_id,
          });
          await dataProvider.update("contacts", {
            id: contact_id,
            data: {
              nb_tasks: (contact.nb_tasks ?? 0) - 1,
            },
            previousData: contact,
          });
          return result;
        },
      } satisfies ResourceCallbacks<Task>,
      {
        resource: "companies",
        beforeCreate: async (params, dataProvider) => {
          await guardAssignmentOnCreate(params, dataProvider);
          const createParams = await processCompanyLogo(params);

          return {
            ...createParams,
            data: {
              ...createParams.data,
              created_at: new Date().toISOString(),
              customer_number:
                createParams.data.customer_number ??
                nextCustomerNumberForFakeRest(),
            },
          };
        },
        beforeUpdate: async (params, dataProvider) => {
          await guardAssignmentOnUpdate(params, dataProvider);
          return await processCompanyLogo(params);
        },
        afterUpdate: async (result, dataProvider) => {
          // get all contacts of the company and for each contact, update the company_name
          const { id, name } = result.data;
          const { data: contacts } = await dataProvider.getList("contacts", {
            filter: { company_id: id },
            pagination: { page: 1, perPage: 1000 },
            sort: { field: "id", order: "ASC" },
          });

          const contactIds = contacts.map((contact) => contact.id);
          await dataProvider.updateMany("contacts", {
            ids: contactIds,
            data: { company_name: name },
          });
          return result;
        },
      } satisfies ResourceCallbacks<Company>,
      {
        resource: "deals",
        beforeCreate: async (params, dataProvider) => {
          await guardAssignmentOnCreate(params, dataProvider);
          const created_at = new Date().toISOString();
          return {
            ...params,
            data: {
              ...params.data,
              created_at,
              updated_at: created_at,
              case_number:
                params.data.case_number ??
                nextCaseNumberForFakeRest(created_at),
            },
          };
        },
        afterCreate: async (result) => {
          await updateCompany(result.data.company_id, (company) => ({
            nb_deals: (company.nb_deals ?? 0) + 1,
          }));

          return result;
        },
        beforeUpdate: async (params, dataProvider) => {
          await guardAssignmentOnUpdate(params, dataProvider);
          return {
            ...params,
            data: {
              ...params.data,
              updated_at: new Date().toISOString(),
            },
          };
        },
        afterDelete: async (result) => {
          await updateCompany(result.data.company_id, (company) => ({
            nb_deals: (company.nb_deals ?? 1) - 1,
          }));

          return result;
        },
      } satisfies ResourceCallbacks<Deal>,
      {
        resource: "contact_notes",
        beforeSave: async (params) => preserveAttachmentMimeType(params),
      } satisfies ResourceCallbacks<ContactNote>,
      {
        resource: "deal_notes",
        beforeSave: async (params) => preserveAttachmentMimeType(params),
      } satisfies ResourceCallbacks<DealNote>,
    ],
  ) as CrmDataProvider;

  return dataProvider;
};

/** W6-B: demo has no real deletion path — the record says so explicitly. */
const DEMO_DELETION_UNSUPPORTED: EmployeeDeletionPreview = {
  supported: false,
  eligible: false,
  reasons: [],
  role: "viewer",
  businessHistory: {
    companies: 0,
    contacts: 0,
    deals: 0,
    tasks: 0,
    contactNotes: 0,
    dealNotes: 0,
  },
  provenance: {
    checklistTemplates: 0,
    savedTextSnippets: 0,
    googleCalendarConnections: 0,
    auditEventsAsActor: 0,
  },
  technical: {
    auditEventsAsTarget: 0,
    emailDeliveryEventsAttributable: 0,
    emailDeliveryEventsForeign: 0,
  },
};

/** Demo-only projection of a sales row onto the Employee Access Contract. */
function toDemoAccessRecord(sale: Sale): EmployeeAccessRecord {
  return {
    employeeId: Number(sale.id),
    email: sale.email,
    accessState: sale.disabled ? "disabled" : "active",
    disabled: Boolean(sale.disabled),
    // Demo has one source of truth, so the two facts can never disagree.
    noraDisabled: Boolean(sale.disabled),
    accessConsistency: "consistent",
    identityConsistency: "consistent",
    invitedAt: null,
    activatedAt: null,
    deletion: {
      ...DEMO_DELETION_UNSUPPORTED,
      role:
        sale.role === "admin" || sale.role === "office" ? sale.role : "viewer",
    },
  };
}

export const dataProvider = withCrmErrorHandler(createDataProvider());

/**
 * Convert a `File` object returned by the upload input into a base 64 string.
 * That's not the most optimized way to store images in production, but it's
 * enough to illustrate the idea of dataprovider decoration.
 */
const convertFileToBase64 = (file: { rawFile: Blob }): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    // We know result is a string as we used readAsDataURL
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file.rawFile);
  });
