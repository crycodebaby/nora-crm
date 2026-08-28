import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  useDataProvider,
  useGetIdentity,
  useGetList,
  useGetOne,
  useNotify,
  useRedirect,
  useTranslate,
} from "ra-core";
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { BusinessNumber } from "../misc/BusinessNumber";
import { noraCreatePath } from "../routing/noraRoutes";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Company, Contact } from "../types";
import type { CrmDataProvider } from "../providers/types";
import { resolveCustomerContacts } from "../domain/customerContactContext";
import { PossibleCustomersPanel } from "./PossibleCustomersPanel";
import { useDialogFocusReturn } from "../misc/useNoraDirtyDialog";
import {
  clearQuickCaptureDraft,
  isDraftEmpty,
  loadQuickCaptureDraft,
  purgeLegacyGlobalQuickCaptureDraft,
  saveQuickCaptureDraft,
  type QuickCaptureDraft,
  type QuickCaptureStep,
} from "./quickCaptureDraft";
import { QuickCaptureStepTabs } from "./QuickCaptureStepTabs";
import {
  QUICK_CAPTURE_SOURCE_CHANNELS,
  type QuickCaptureSourceChannel,
  type QuickCaptureTaskOption,
} from "./quickCaptureUtils";
import {
  createQuickCaptureCase,
  QuickCaptureSubmitError,
} from "../application/commands/createQuickCaptureCase";
import { createOperationId } from "../operations/operationContext";
import type { CustomerListEntry } from "./mergeCustomerSearchResults";
import { useDuplicateCandidateSearch } from "./useDuplicateCandidateSearch";
import {
  validateQuickCaptureForSave,
  type QuickCaptureContactMode,
  type QuickCaptureFieldErrors,
} from "./quickCaptureValidation";

type QuickCaptureDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const defaultFollowUpDate = () => new Date().toISOString().slice(0, 10);
const AUTOSAVE_DEBOUNCE_MS = 500;

const emptyFormState = (): Omit<
  QuickCaptureDraft,
  "savedAt" | "updatedAt" | "schemaVersion"
> => ({
  step: 1,
  searchQuery: "",
  selectedCompany: null,
  createNewCompany: false,
  newCompanyName: "",
  selectedContact: null,
  createNewContact: false,
  contactFirstName: "",
  contactLastName: "",
  contactPhone: "",
  contactEmail: "",
  markNewContactPrimary: true,
  dealTitle: "",
  dealCategory: "fensterservice",
  dealDescription: "",
  sourceChannel: "phone",
  followUpDate: defaultFollowUpDate(),
  createTask: false,
  taskType: "rueckruf",
  dismissCustomerSuggestions: false,
  // Idempotency Wave (2026-08-29): minted once per fresh form state (new
  // dialog session / explicit reset) — persisted with the draft so a
  // reload/resume retry reuses the SAME key (Key Contract, see
  // docs/nora/06-decision-log.md "Idempotency Wave").
  idempotencyKey: createOperationId(),
});

export const QuickCaptureDialog = ({
  open,
  onOpenChange,
}: QuickCaptureDialogProps) => {
  const translate = useTranslate();
  const { onCloseAutoFocus } = useDialogFocusReturn(open);
  const notify = useNotify();
  const redirect = useRedirect();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const { identity } = useGetIdentity();
  const { dealCategories } = useConfigurationContext();

  // "createNewContact" from the draft shape is now a derived concept —
  // step 2 tracks an explicit tri-state contactMode instead (Self Contact
  // Wave, 2026-08-26): a "Neuen Ansprechpartner erfassen" checkbox no
  // longer silently means "this will create an entity".
  const [contactMode, setContactMode] = useState<QuickCaptureContactMode>(null);
  const [form, setForm] = useState(emptyFormState);
  const [fieldErrors, setFieldErrors] = useState<QuickCaptureFieldErrors>({});
  const [draftNotice, setDraftNotice] = useState<"restored" | "present" | null>(
    null,
  );

  const patchForm = useCallback((patch: Partial<typeof form>) => {
    setForm((current) => ({ ...current, ...patch }));
    setFieldErrors((current) => {
      const next = { ...current };
      if (
        patch.selectedCompany !== undefined ||
        patch.newCompanyName !== undefined ||
        patch.createNewCompany !== undefined
      ) {
        delete next.customer;
      }
      if (
        patch.selectedContact !== undefined ||
        patch.contactFirstName !== undefined ||
        patch.contactLastName !== undefined
      ) {
        delete next.contact;
      }
      if (patch.dealTitle !== undefined) delete next.dealTitle;
      if (patch.dealCategory !== undefined) delete next.dealCategory;
      return next;
    });
  }, []);

  const applyDraft = useCallback((draft: QuickCaptureDraft) => {
    setForm({
      step: draft.step,
      searchQuery: draft.searchQuery,
      selectedCompany: draft.selectedCompany,
      createNewCompany: draft.createNewCompany,
      newCompanyName: draft.newCompanyName,
      selectedContact: draft.selectedContact,
      createNewContact: draft.createNewContact,
      contactFirstName: draft.contactFirstName,
      contactLastName: draft.contactLastName,
      contactPhone: draft.contactPhone,
      contactEmail: draft.contactEmail,
      markNewContactPrimary: draft.markNewContactPrimary ?? true,
      dealTitle: draft.dealTitle,
      dealCategory: draft.dealCategory,
      dealDescription: draft.dealDescription,
      sourceChannel: draft.sourceChannel,
      followUpDate: draft.followUpDate,
      createTask: draft.createTask,
      taskType: draft.taskType,
      dismissCustomerSuggestions: draft.dismissCustomerSuggestions,
      // Idempotency Wave: reuse the SAME key the draft was saved with — a
      // restored draft is the same fachlicher write intent, not a new one.
      idempotencyKey: draft.idempotencyKey,
    });
    setContactMode(
      draft.selectedContact
        ? "existing"
        : draft.createNewContact
          ? "new"
          : null,
    );
    setFieldErrors({});
  }, []);

  const buildDraft = useCallback(
    (): Omit<QuickCaptureDraft, "schemaVersion" | "savedAt" | "updatedAt"> => ({
      ...form,
      createNewContact: contactMode === "new",
    }),
    [form, contactMode],
  );

  const persistDraft = useCallback(() => {
    if (identity?.id == null) return;
    const draft = buildDraft();
    if (isDraftEmpty(draft as QuickCaptureDraft)) {
      clearQuickCaptureDraft(identity.id);
      return;
    }
    saveQuickCaptureDraft(identity.id, draft as QuickCaptureDraft);
  }, [buildDraft, identity?.id]);

  const resetForm = useCallback(() => {
    setForm(emptyFormState());
    setContactMode(null);
    setFieldErrors({});
    setDraftNotice(null);
  }, []);

  // Legacy global draft key retired on first mount — never assigned to any
  // user, ownership is not determinable across users on a shared profile.
  useEffect(() => {
    purgeLegacyGlobalQuickCaptureDraft();
  }, []);

  useEffect(() => {
    if (!open || identity?.id == null) return;
    const draft = loadQuickCaptureDraft(identity.id);
    if (draft && !isDraftEmpty(draft)) {
      applyDraft(draft);
      setDraftNotice("restored");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identity?.id]);

  // Autosave while typing, in addition to save-on-close, so a plain reload
  // doesn't lose the last few seconds of input.
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || identity?.id == null) return;
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(persistDraft, AUTOSAVE_DEBOUNCE_MS);
    return () => {
      if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, identity?.id, form, contactMode]);

  // Synchronous flush on page/tab lifecycle events — a reload or tab close
  // must not lose whatever the debounce timer hasn't saved yet.
  useEffect(() => {
    if (!open) return;
    const flush = () => persistDraft();
    document.addEventListener("visibilitychange", flush);
    window.addEventListener("pagehide", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      window.removeEventListener("pagehide", flush);
    };
  }, [open, persistDraft]);

  useEffect(() => {
    setForm((current) => ({ ...current, dismissCustomerSuggestions: false }));
  }, [
    form.searchQuery,
    form.newCompanyName,
    form.contactPhone,
    form.contactEmail,
    form.createNewCompany,
  ]);

  const customerSearchEnabled =
    open && form.step === 1 && (!form.selectedCompany || form.createNewCompany);

  const { mergedEntries, isPending: customersPending } =
    useDuplicateCandidateSearch({
      enabled: customerSearchEnabled,
      searchQuery: form.searchQuery,
      newCompanyName: form.newCompanyName,
      createNewCompany: form.createNewCompany,
      contactPhone: form.contactPhone,
      contactEmail: form.contactEmail,
      dataProvider,
    });

  const showCustomerPanel =
    customerSearchEnabled &&
    !form.dismissCustomerSuggestions &&
    (customersPending ||
      mergedEntries.length > 0 ||
      form.searchQuery.trim().length > 0);

  const handleOpenChange = (next: boolean) => {
    if (!next) {
      persistDraft();
      onOpenChange(false);
      return;
    }
    onOpenChange(true);
  };

  const handleDiscardDraft = () => {
    if (identity?.id != null) clearQuickCaptureDraft(identity.id);
    resetForm();
    onOpenChange(false);
  };

  const handleUseCustomer = (company: Company) => {
    patchForm({
      selectedCompany: company,
      createNewCompany: false,
      newCompanyName: "",
      dismissCustomerSuggestions: false,
      selectedContact: null,
    });
    setContactMode(null);
  };

  const handleCreateNewCustomer = () => {
    patchForm({
      createNewCompany: true,
      dismissCustomerSuggestions: true,
      newCompanyName:
        form.newCompanyName.trim() ||
        form.searchQuery.trim() ||
        form.newCompanyName,
    });
  };

  const companyId = form.selectedCompany?.id;
  const { data: companyContacts } = useGetList<Contact>(
    "contacts",
    {
      filter: companyId != null ? { company_id: companyId } : {},
      pagination: { page: 1, perPage: 50 },
      sort: { field: "last_name", order: "ASC" },
    },
    { enabled: open && companyId != null },
  );

  // Effective Contact Context (Self Contact Wave): a self_contact can point
  // at a contact whose company_id is a DIFFERENT company — the plain
  // company_id-filtered getList above would miss it, so it is fetched
  // separately whenever it isn't already in the loaded set.
  const selfContactId = form.selectedCompany?.self_contact_id;
  const selfContactAlreadyLoaded = (companyContacts ?? []).some(
    (c) => String(c.id) === String(selfContactId),
  );
  const { data: fetchedSelfContact } = useGetOne<Contact>(
    "contacts",
    { id: selfContactId as string | number },
    {
      enabled: open && selfContactId != null && !selfContactAlreadyLoaded,
    },
  );

  const effectiveContacts = [
    ...(companyContacts ?? []),
    ...(fetchedSelfContact && !selfContactAlreadyLoaded
      ? [fetchedSelfContact]
      : []),
  ];

  const contactContext = resolveCustomerContacts(
    form.selectedCompany,
    effectiveContacts,
  );

  const sourceLabel = translate(
    `crm.quick_capture.sources.${form.sourceChannel}`,
  );

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: () => {
      if (identity?.id == null) {
        throw new QuickCaptureSubmitError("not_authenticated", "case");
      }
      return createQuickCaptureCase(dataProvider, {
        customer: form.createNewCompany
          ? { mode: "new", name: form.newCompanyName }
          : { mode: "existing", companyId: form.selectedCompany!.id },
        contact:
          contactMode === "existing" && form.selectedContact
            ? { mode: "existing", contactId: form.selectedContact.id }
            : contactMode === "new"
              ? {
                  mode: "new",
                  contact: {
                    first_name: form.contactFirstName,
                    last_name: form.contactLastName,
                    phone: form.contactPhone,
                    email: form.contactEmail,
                  },
                  markPrimary: form.markNewContactPrimary,
                }
              : { mode: "none" },
        dealTitle: form.dealTitle,
        dealCategory: form.dealCategory,
        dealDescription: form.dealDescription,
        sourceChannel: form.sourceChannel,
        sourceLabel,
        followUpDate: form.followUpDate,
        taskType: form.createTask ? form.taskType : "",
        salesId: identity.id,
        idempotencyKey: form.idempotencyKey,
      });
    },
    onSuccess: ({ dealId, taskFailed }) => {
      // Idempotency Wave (2026-08-29): a failed task keeps the draft (and
      // therefore its idempotencyKey) around — Core is already committed
      // and must never be re-run under a fresh key, and only the still-open
      // draft lets a later retry reuse the SAME key for the task. Only a
      // full success (or an explicit discard elsewhere) clears it.
      if (identity?.id != null && !taskFailed) {
        clearQuickCaptureDraft(identity.id);
      }
      resetForm();
      if (taskFailed) {
        notify("crm.quick_capture.errors.task_create_failed_partial", {
          type: "warning",
        });
      } else {
        notify("crm.quick_capture.success", { type: "info" });
      }
      onOpenChange(false);
      redirect(
        noraCreatePath({ resource: "deals", type: "show", id: dealId }),
        undefined,
        undefined,
        undefined,
        { _scrollToTop: false },
      );
    },
    onError: (error) => {
      if (error instanceof QuickCaptureSubmitError) {
        notify(`crm.quick_capture.errors.${error.message}`, { type: "error" });
        return;
      }
      notify("crm.quick_capture.errors.unknown", { type: "error" });
    },
  });

  const handleSave = () => {
    const validation = validateQuickCaptureForSave({
      selectedCompany: form.selectedCompany,
      createNewCompany: form.createNewCompany,
      newCompanyName: form.newCompanyName,
      contactMode,
      selectedContact: form.selectedContact,
      contactFirstName: form.contactFirstName,
      contactLastName: form.contactLastName,
      dealTitle: form.dealTitle,
      dealCategory: form.dealCategory,
    });

    if (!validation.valid) {
      setFieldErrors(validation.errors);
      if (validation.firstInvalidStep) {
        patchForm({ step: validation.firstInvalidStep });
      }
      return;
    }

    setFieldErrors({});
    save();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="lg:max-w-4xl p-0 gap-0 overflow-hidden max-h-[90vh] flex flex-col"
        preventOutsideClose
        onCloseClick={() => handleOpenChange(false)}
        onCloseAutoFocus={onCloseAutoFocus}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          handleOpenChange(false);
        }}
      >
        <DialogHeader className="px-5 pt-5 pb-3 border-b border-border shrink-0">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            {translate("crm.quick_capture.title")}
          </DialogTitle>
          {draftNotice ? (
            <p className="text-xs text-muted-foreground bg-muted/40 rounded-md px-2.5 py-1.5 w-fit">
              {translate(
                draftNotice === "restored"
                  ? "crm.quick_capture.draft_restored"
                  : "crm.quick_capture.draft_present",
              )}
            </p>
          ) : null}
          <QuickCaptureStepTabs
            current={form.step}
            onChange={(step) => patchForm({ step })}
          />
        </DialogHeader>

        <div className="px-5 py-4 overflow-y-auto flex-1">
          {form.step === 1 ? (
            <StepCustomer
              searchQuery={form.searchQuery}
              onSearchQueryChange={(searchQuery) => patchForm({ searchQuery })}
              selectedCompany={form.selectedCompany}
              onClearSelectedCompany={() =>
                patchForm({ selectedCompany: null })
              }
              createNewCompany={form.createNewCompany}
              onCreateNewCompanyChange={(createNewCompany) =>
                patchForm({ createNewCompany })
              }
              newCompanyName={form.newCompanyName}
              onNewCompanyNameChange={(newCompanyName) =>
                patchForm({ newCompanyName })
              }
              showCustomerPanel={showCustomerPanel}
              customerEntries={mergedEntries}
              customersPending={customersPending}
              onUseCustomer={handleUseCustomer}
              onCreateNewCustomer={handleCreateNewCustomer}
              error={fieldErrors.customer}
            />
          ) : null}

          {form.step === 2 ? (
            <StepContact
              company={form.selectedCompany}
              newCompanyName={
                form.createNewCompany ? form.newCompanyName : undefined
              }
              members={contactContext.members}
              preferredContact={contactContext.preferredContact}
              contactMode={contactMode}
              onContactModeChange={setContactMode}
              selectedContact={form.selectedContact}
              onSelectContact={(selectedContact) => {
                patchForm({ selectedContact });
                setContactMode("existing");
              }}
              contactFirstName={form.contactFirstName}
              onContactFirstNameChange={(contactFirstName) =>
                patchForm({ contactFirstName })
              }
              contactLastName={form.contactLastName}
              onContactLastNameChange={(contactLastName) =>
                patchForm({ contactLastName })
              }
              contactPhone={form.contactPhone}
              onContactPhoneChange={(contactPhone) =>
                patchForm({ contactPhone })
              }
              contactEmail={form.contactEmail}
              onContactEmailChange={(contactEmail) =>
                patchForm({ contactEmail })
              }
              markNewContactPrimary={form.markNewContactPrimary}
              onMarkNewContactPrimaryChange={(markNewContactPrimary) =>
                patchForm({ markNewContactPrimary })
              }
              error={fieldErrors.contact}
            />
          ) : null}

          {form.step === 3 ? (
            <StepDeal
              dealTitle={form.dealTitle}
              onDealTitleChange={(dealTitle) => patchForm({ dealTitle })}
              dealCategory={form.dealCategory}
              onDealCategoryChange={(dealCategory) =>
                patchForm({ dealCategory })
              }
              dealCategories={dealCategories}
              dealDescription={form.dealDescription}
              onDealDescriptionChange={(dealDescription) =>
                patchForm({ dealDescription })
              }
              sourceChannel={form.sourceChannel}
              onSourceChannelChange={(sourceChannel) =>
                patchForm({ sourceChannel })
              }
              followUpDate={form.followUpDate}
              onFollowUpDateChange={(followUpDate) =>
                patchForm({ followUpDate })
              }
              createTask={form.createTask}
              onCreateTaskChange={(createTask) => patchForm({ createTask })}
              taskType={form.taskType}
              onTaskTypeChange={(taskType) => patchForm({ taskType })}
              titleError={fieldErrors.dealTitle}
              categoryError={fieldErrors.dealCategory}
            />
          ) : null}
        </div>

        <DialogFooter className="px-5 py-4 border-t border-border shrink-0 flex-col sm:flex-row gap-3 sm:justify-between">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="nora-touch-target text-muted-foreground order-3 sm:order-1"
            disabled={isSaving}
            onClick={handleDiscardDraft}
          >
            {translate("crm.quick_capture.discard_draft")}
          </Button>

          <div className="flex flex-wrap gap-2 justify-end order-1 sm:order-2 w-full sm:w-auto">
            <Button
              type="button"
              variant="outline"
              className="nora-touch-target"
              disabled={isSaving}
              onClick={() => handleOpenChange(false)}
            >
              {translate("crm.quick_capture.cancel")}
            </Button>
            {form.step > 1 ? (
              <Button
                type="button"
                variant="outline"
                className="nora-touch-target"
                disabled={isSaving}
                onClick={() =>
                  patchForm({ step: (form.step - 1) as QuickCaptureStep })
                }
              >
                {translate("crm.quick_capture.back")}
              </Button>
            ) : null}
            {form.step < 3 ? (
              <Button
                type="button"
                variant="outline"
                className="nora-touch-target"
                disabled={isSaving}
                onClick={() =>
                  patchForm({ step: (form.step + 1) as QuickCaptureStep })
                }
              >
                {translate("crm.quick_capture.next")}
              </Button>
            ) : null}
            <Button
              type="button"
              className="nora-primary-action nora-touch-target"
              disabled={isSaving || identity?.id == null}
              onClick={handleSave}
            >
              {isSaving ? <Loader2 className="size-4 animate-spin" /> : null}
              {translate("crm.quick_capture.save_and_open")}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

const FieldError = ({ messageKey }: { messageKey?: string }) => {
  const translate = useTranslate();
  if (!messageKey) return null;
  return (
    <p className="text-sm text-destructive" role="alert">
      {translate(`crm.quick_capture.errors.${messageKey}`)}
    </p>
  );
};

type StepCustomerProps = {
  searchQuery: string;
  onSearchQueryChange: (value: string) => void;
  selectedCompany: Company | null;
  onClearSelectedCompany: () => void;
  createNewCompany: boolean;
  onCreateNewCompanyChange: (value: boolean) => void;
  newCompanyName: string;
  onNewCompanyNameChange: (value: string) => void;
  showCustomerPanel: boolean;
  customerEntries: CustomerListEntry[];
  customersPending: boolean;
  onUseCustomer: (company: Company) => void;
  onCreateNewCustomer: () => void;
  error?: string;
};

const StepCustomer = ({
  searchQuery,
  onSearchQueryChange,
  selectedCompany,
  onClearSelectedCompany,
  createNewCompany,
  onCreateNewCompanyChange,
  newCompanyName,
  onNewCompanyNameChange,
  showCustomerPanel,
  customerEntries,
  customersPending,
  onUseCustomer,
  onCreateNewCustomer,
  error,
}: StepCustomerProps) => {
  const translate = useTranslate();

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 lg:gap-6">
      <div className="space-y-4 min-w-0">
        <FieldError messageKey={error} />

        {selectedCompany && !createNewCompany ? (
          <div className="nora-card p-4 space-y-2">
            {selectedCompany.customer_number ? (
              <BusinessNumber
                value={selectedCompany.customer_number}
                variant="badge"
              />
            ) : null}
            <p className="text-sm font-semibold">{selectedCompany.name}</p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 px-2 text-muted-foreground"
              onClick={onClearSelectedCompany}
            >
              {translate("crm.quick_capture.change_customer")}
            </Button>
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="quick-capture-search">
                {translate("crm.quick_capture.search_customer")}
              </Label>
              <Input
                id="quick-capture-search"
                value={searchQuery}
                onChange={(event) => onSearchQueryChange(event.target.value)}
                placeholder={translate("crm.search.hint")}
                className="nora-touch-target"
                autoFocus
              />
            </div>

            <div className="space-y-3 nora-card p-4">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="quick-capture-new-company"
                  checked={createNewCompany}
                  onCheckedChange={(checked) =>
                    onCreateNewCompanyChange(checked === true)
                  }
                />
                <Label
                  htmlFor="quick-capture-new-company"
                  className="font-medium"
                >
                  {translate("crm.quick_capture.create_customer")}
                </Label>
              </div>
              {createNewCompany ? (
                <Input
                  value={newCompanyName}
                  onChange={(event) =>
                    onNewCompanyNameChange(event.target.value)
                  }
                  placeholder={translate(
                    "crm.quick_capture.customer_name_placeholder",
                  )}
                  className="nora-touch-target"
                />
              ) : null}
            </div>
          </>
        )}
      </div>

      <PossibleCustomersPanel
        className="min-w-0 lg:sticky lg:top-0 lg:self-start"
        entries={customerEntries}
        isPending={customersPending}
        selectedCompanyId={selectedCompany?.id}
        showPanel={showCustomerPanel && !selectedCompany}
        onUseCompany={onUseCustomer}
        onCreateNew={onCreateNewCustomer}
      />
    </div>
  );
};

type StepContactProps = {
  company: Company | null;
  newCompanyName?: string;
  members: Contact[];
  preferredContact: Contact | null;
  contactMode: QuickCaptureContactMode;
  onContactModeChange: (mode: QuickCaptureContactMode) => void;
  selectedContact: Contact | null;
  onSelectContact: (contact: Contact) => void;
  contactFirstName: string;
  onContactFirstNameChange: (value: string) => void;
  contactLastName: string;
  onContactLastNameChange: (value: string) => void;
  contactPhone: string;
  onContactPhoneChange: (value: string) => void;
  contactEmail: string;
  onContactEmailChange: (value: string) => void;
  markNewContactPrimary: boolean;
  onMarkNewContactPrimaryChange: (value: boolean) => void;
  error?: string;
};

const StepContact = ({
  company,
  newCompanyName,
  members,
  preferredContact,
  contactMode,
  onContactModeChange,
  selectedContact,
  onSelectContact,
  contactFirstName,
  onContactFirstNameChange,
  contactLastName,
  onContactLastNameChange,
  contactPhone,
  onContactPhoneChange,
  contactEmail,
  onContactEmailChange,
  markNewContactPrimary,
  onMarkNewContactPrimaryChange,
  error,
}: StepContactProps) => {
  const translate = useTranslate();

  const contextName = company?.name ?? newCompanyName;
  if (!contextName) {
    return (
      <div className="space-y-4 max-w-2xl">
        <p className="text-sm text-muted-foreground">
          {translate("crm.quick_capture.contact_step_missing_customer")}
        </p>
      </div>
    );
  }

  const otherMembers = members.filter(
    (c) => String(c.id) !== String(preferredContact?.id),
  );

  return (
    <div className="space-y-4 max-w-2xl">
      <FieldError messageKey={error} />

      <p className="text-sm text-muted-foreground">
        {translate("crm.quick_capture.contact_for")}:{" "}
        <span className="font-medium text-foreground">{contextName}</span>
      </p>

      <div className="nora-card divide-y overflow-hidden">
        {preferredContact ? (
          <button
            type="button"
            onClick={() => onSelectContact(preferredContact)}
            className={cn(
              "w-full text-left px-4 py-3 nora-touch-target hover:bg-muted/60 transition-colors",
              contactMode === "existing" &&
                String(selectedContact?.id) === String(preferredContact.id) &&
                "bg-muted/50",
            )}
          >
            <span className="text-sm font-medium">
              {translate("crm.quick_capture.contact_use_primary")}:{" "}
              {preferredContact.first_name} {preferredContact.last_name}
            </span>
          </button>
        ) : null}

        {otherMembers.map((contact) => (
          <button
            key={contact.id}
            type="button"
            onClick={() => onSelectContact(contact)}
            className={cn(
              "w-full text-left px-4 py-3 nora-touch-target hover:bg-muted/60 transition-colors",
              contactMode === "existing" &&
                String(selectedContact?.id) === String(contact.id) &&
                "bg-muted/50",
            )}
          >
            <span className="text-sm font-medium">
              {contact.first_name} {contact.last_name}
            </span>
          </button>
        ))}

        <button
          type="button"
          onClick={() => onContactModeChange("new")}
          className={cn(
            "w-full text-left px-4 py-3 nora-touch-target hover:bg-muted/60 transition-colors",
            contactMode === "new" && "bg-muted/50",
          )}
        >
          <span className="text-sm font-medium">
            {translate("crm.quick_capture.contact_create_new")}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onContactModeChange("none")}
          className={cn(
            "w-full text-left px-4 py-3 nora-touch-target hover:bg-muted/60 transition-colors",
            contactMode === "none" && "bg-muted/50",
          )}
        >
          <span className="text-sm font-medium text-muted-foreground">
            {translate("crm.quick_capture.contact_none")}
          </span>
        </button>
      </div>

      {contactMode === "new" ? (
        <div className="space-y-3 nora-card p-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{translate("resources.contacts.fields.first_name")}</Label>
              <Input
                value={contactFirstName}
                onChange={(event) =>
                  onContactFirstNameChange(event.target.value)
                }
                className="nora-touch-target"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label>{translate("resources.contacts.fields.last_name")}</Label>
              <Input
                value={contactLastName}
                onChange={(event) =>
                  onContactLastNameChange(event.target.value)
                }
                className="nora-touch-target"
              />
            </div>
            <div className="space-y-1.5">
              <Label>
                {translate("resources.contacts.fields.phone_number")}
              </Label>
              <Input
                value={contactPhone}
                onChange={(event) => onContactPhoneChange(event.target.value)}
                className="nora-touch-target"
              />
            </div>
            <div className="space-y-1.5">
              <Label>{translate("resources.contacts.fields.email")}</Label>
              <Input
                type="email"
                value={contactEmail}
                onChange={(event) => onContactEmailChange(event.target.value)}
                className="nora-touch-target"
              />
            </div>
          </div>
          <div className="flex items-start gap-2 pt-2">
            <Checkbox
              id="quick-capture-mark-primary"
              checked={markNewContactPrimary}
              onCheckedChange={(checked) =>
                onMarkNewContactPrimaryChange(checked === true)
              }
            />
            <div>
              <Label
                htmlFor="quick-capture-mark-primary"
                className="font-medium"
              >
                {translate("crm.quick_capture.contact_mark_primary")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {translate("crm.quick_capture.contact_mark_primary_hint")}
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
};

type StepDealProps = {
  dealTitle: string;
  onDealTitleChange: (value: string) => void;
  dealCategory: string;
  onDealCategoryChange: (value: string) => void;
  dealCategories: { value: string; label: string }[];
  dealDescription: string;
  onDealDescriptionChange: (value: string) => void;
  sourceChannel: QuickCaptureSourceChannel;
  onSourceChannelChange: (value: QuickCaptureSourceChannel) => void;
  followUpDate: string;
  onFollowUpDateChange: (value: string) => void;
  createTask: boolean;
  onCreateTaskChange: (value: boolean) => void;
  taskType: QuickCaptureTaskOption;
  onTaskTypeChange: (value: QuickCaptureTaskOption) => void;
  titleError?: string;
  categoryError?: string;
};

const StepDeal = ({
  dealTitle,
  onDealTitleChange,
  dealCategory,
  onDealCategoryChange,
  dealCategories,
  dealDescription,
  onDealDescriptionChange,
  sourceChannel,
  onSourceChannelChange,
  followUpDate,
  onFollowUpDateChange,
  createTask,
  onCreateTaskChange,
  taskType,
  onTaskTypeChange,
  titleError,
  categoryError,
}: StepDealProps) => {
  const translate = useTranslate();

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="space-y-1.5">
        <Label htmlFor="quick-capture-deal-title">
          {translate("resources.deals.fields.name")}
        </Label>
        <Input
          id="quick-capture-deal-title"
          value={dealTitle}
          onChange={(event) => onDealTitleChange(event.target.value)}
          className={cn(
            "nora-touch-target text-base font-medium",
            titleError && "border-destructive",
          )}
          autoFocus
        />
        <FieldError messageKey={titleError} />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{translate("resources.deals.fields.category")}</Label>
          <Select value={dealCategory} onValueChange={onDealCategoryChange}>
            <SelectTrigger
              className={cn(
                "nora-touch-target w-full",
                categoryError && "border-destructive",
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {dealCategories.map((category) => (
                <SelectItem key={category.value} value={category.value}>
                  {category.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <FieldError messageKey={categoryError} />
        </div>
        <div className="space-y-1.5">
          <Label>{translate("crm.quick_capture.source")}</Label>
          <Select
            value={sourceChannel}
            onValueChange={(value) =>
              onSourceChannelChange(value as QuickCaptureSourceChannel)
            }
          >
            <SelectTrigger className="nora-touch-target w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {QUICK_CAPTURE_SOURCE_CHANNELS.map((channel) => (
                <SelectItem key={channel} value={channel}>
                  {translate(`crm.quick_capture.sources.${channel}`)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="quick-capture-description">
          {translate("resources.deals.fields.description")}
        </Label>
        <Textarea
          id="quick-capture-description"
          value={dealDescription}
          onChange={(event) => onDealDescriptionChange(event.target.value)}
          rows={3}
          className="resize-none"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="quick-capture-follow-up">
          {translate("crm.quick_capture.follow_up_date")}
        </Label>
        <Input
          id="quick-capture-follow-up"
          type="date"
          value={followUpDate}
          onChange={(event) => onFollowUpDateChange(event.target.value)}
          className="nora-touch-target"
        />
      </div>

      <div className="nora-card p-4 space-y-3">
        <div className="flex items-center gap-2">
          <Checkbox
            id="quick-capture-task"
            checked={createTask}
            onCheckedChange={(checked) => onCreateTaskChange(checked === true)}
          />
          <Label htmlFor="quick-capture-task" className="font-medium">
            {translate("crm.quick_capture.create_task")}
          </Label>
        </div>
        {createTask ? (
          <Select
            value={taskType}
            onValueChange={(value) =>
              onTaskTypeChange(value as QuickCaptureTaskOption)
            }
          >
            <SelectTrigger className="nora-touch-target w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="rueckruf">
                {translate("crm.quick_capture.task_types.rueckruf")}
              </SelectItem>
              <SelectItem value="besichtigung">
                {translate("crm.quick_capture.task_types.besichtigung")}
              </SelectItem>
              <SelectItem value="angebot-erstellen">
                {translate("crm.quick_capture.task_types.angebot_erstellen")}
              </SelectItem>
            </SelectContent>
          </Select>
        ) : null}
      </div>
    </div>
  );
};
