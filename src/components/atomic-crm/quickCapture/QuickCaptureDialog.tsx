import { useMutation } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  useDataProvider,
  useGetIdentity,
  useGetList,
  useNotify,
  useRedirect,
  useTranslate,
} from "ra-core";
import { useCallback, useEffect, useState } from "react";

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
import { PossibleCustomersPanel } from "./PossibleCustomersPanel";
import { useDialogFocusReturn } from "../misc/useNoraDirtyDialog";
import {
  clearQuickCaptureDraft,
  isDraftEmpty,
  loadQuickCaptureDraft,
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
  QuickCaptureSubmitError,
  submitQuickCapture,
} from "./submitQuickCapture";
import type { CustomerListEntry } from "./mergeCustomerSearchResults";
import { useDuplicateCandidateSearch } from "./useDuplicateCandidateSearch";
import {
  validateQuickCaptureForSave,
  type QuickCaptureFieldErrors,
} from "./quickCaptureValidation";

type QuickCaptureDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

const defaultFollowUpDate = () => new Date().toISOString().slice(0, 10);

const emptyFormState = (): Omit<QuickCaptureDraft, "savedAt"> => ({
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
  dealTitle: "",
  dealCategory: "fensterservice",
  dealDescription: "",
  sourceChannel: "phone",
  followUpDate: defaultFollowUpDate(),
  createTask: false,
  taskType: "rueckruf",
  dismissCustomerSuggestions: false,
});

export const QuickCaptureDialog = ({
  open,
  onOpenChange,
}: QuickCaptureDialogProps) => {
  const translate = useTranslate();
  const { onCloseAutoFocus } = useDialogFocusReturn(open);
  const notify = useNotify();
  const redirect = useRedirect();
  const dataProvider = useDataProvider();
  const { identity } = useGetIdentity();
  const { dealCategories } = useConfigurationContext();

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
        patch.contactLastName !== undefined ||
        patch.createNewContact !== undefined
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
      dealTitle: draft.dealTitle,
      dealCategory: draft.dealCategory,
      dealDescription: draft.dealDescription,
      sourceChannel: draft.sourceChannel,
      followUpDate: draft.followUpDate,
      createTask: draft.createTask,
      taskType: draft.taskType,
      dismissCustomerSuggestions: draft.dismissCustomerSuggestions,
    });
    setFieldErrors({});
  }, []);

  const buildDraft = useCallback(
    (): QuickCaptureDraft => ({
      ...form,
      savedAt: new Date().toISOString(),
    }),
    [form],
  );

  const persistDraft = useCallback(() => {
    const draft = buildDraft();
    if (isDraftEmpty(draft)) {
      clearQuickCaptureDraft();
      return;
    }
    saveQuickCaptureDraft(draft);
  }, [buildDraft]);

  const resetForm = useCallback(() => {
    setForm(emptyFormState());
    setFieldErrors({});
    setDraftNotice(null);
  }, []);

  useEffect(() => {
    if (!open) return;
    const draft = loadQuickCaptureDraft();
    if (draft && !isDraftEmpty(draft)) {
      applyDraft(draft);
      setDraftNotice("restored");
    }
  }, [open, applyDraft]);

  useEffect(() => {
    setForm((current) => ({ ...current, dismissCustomerSuggestions: false }));
  }, [
    form.searchQuery,
    form.newCompanyName,
    form.contactPhone,
    form.contactEmail,
    form.createNewCompany,
    form.createNewContact,
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
    clearQuickCaptureDraft();
    resetForm();
    onOpenChange(false);
  };

  const handleUseCustomer = (company: Company) => {
    patchForm({
      selectedCompany: company,
      createNewCompany: false,
      newCompanyName: "",
      dismissCustomerSuggestions: false,
    });
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
      filter: companyId ? { company_id: companyId } : {},
      pagination: { page: 1, perPage: 50 },
      sort: { field: "last_name", order: "ASC" },
    },
    { enabled: open && !!companyId },
  );

  const sourceLabel = translate(
    `crm.quick_capture.sources.${form.sourceChannel}`,
  );

  const mustCreateContact =
    form.createNewContact || (companyContacts?.length ?? 0) === 0;

  const { mutate: save, isPending: isSaving } = useMutation({
    mutationFn: () => {
      if (!identity?.id) {
        throw new QuickCaptureSubmitError("not_authenticated", "deal");
      }
      return submitQuickCapture(dataProvider, {
        company: form.createNewCompany ? null : form.selectedCompany,
        newCompanyName: form.createNewCompany ? form.newCompanyName : "",
        contact: mustCreateContact ? null : form.selectedContact,
        newContact: {
          first_name: form.contactFirstName,
          last_name: form.contactLastName,
          phone: form.contactPhone,
          email: form.contactEmail,
        },
        dealTitle: form.dealTitle,
        dealCategory: form.dealCategory,
        dealDescription: form.dealDescription,
        sourceChannel: form.sourceChannel,
        sourceLabel,
        followUpDate: form.followUpDate,
        taskType: form.createTask ? form.taskType : "",
        salesId: identity.id,
      });
    },
    onSuccess: ({ dealId, taskFailed }) => {
      clearQuickCaptureDraft();
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
      selectedContact: form.selectedContact,
      createNewContact: form.createNewContact,
      contactFirstName: form.contactFirstName,
      contactLastName: form.contactLastName,
      companyContactsCount: companyContacts?.length ?? 0,
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
              contacts={companyContacts ?? []}
              selectedContact={form.selectedContact}
              onSelectContact={(selectedContact) =>
                patchForm({ selectedContact, createNewContact: false })
              }
              createNewContact={form.createNewContact}
              onCreateNewContactChange={(createNewContact) =>
                patchForm({ createNewContact })
              }
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
              disabled={isSaving || !identity?.id}
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
  contacts: Contact[];
  selectedContact: Contact | null;
  onSelectContact: (contact: Contact) => void;
  createNewContact: boolean;
  onCreateNewContactChange: (value: boolean) => void;
  contactFirstName: string;
  onContactFirstNameChange: (value: string) => void;
  contactLastName: string;
  onContactLastNameChange: (value: string) => void;
  contactPhone: string;
  onContactPhoneChange: (value: string) => void;
  contactEmail: string;
  onContactEmailChange: (value: string) => void;
  error?: string;
};

const StepContact = ({
  company,
  newCompanyName,
  contacts,
  selectedContact,
  onSelectContact,
  createNewContact,
  onCreateNewContactChange,
  contactFirstName,
  onContactFirstNameChange,
  contactLastName,
  onContactLastNameChange,
  contactPhone,
  onContactPhoneChange,
  contactEmail,
  onContactEmailChange,
  error,
}: StepContactProps) => {
  const translate = useTranslate();

  return (
    <div className="space-y-4 max-w-2xl">
      <FieldError messageKey={error} />

      <p className="text-sm text-muted-foreground">
        {translate("crm.quick_capture.contact_for")}:{" "}
        <span className="font-medium text-foreground">
          {company?.name ?? newCompanyName}
        </span>
      </p>

      {contacts.length > 0 && !createNewContact ? (
        <div className="nora-card divide-y overflow-hidden">
          {contacts.map((contact) => (
            <button
              key={contact.id}
              type="button"
              onClick={() => onSelectContact(contact)}
              className={cn(
                "w-full text-left px-4 py-3 nora-touch-target hover:bg-muted/60 transition-colors",
                selectedContact?.id === contact.id && "bg-muted/50",
              )}
            >
              <span className="text-sm font-medium">
                {contact.first_name} {contact.last_name}
              </span>
            </button>
          ))}
        </div>
      ) : null}

      <div className="space-y-3 nora-card p-4">
        <div className="flex items-center gap-2">
          <Checkbox
            id="quick-capture-new-contact"
            checked={createNewContact}
            onCheckedChange={(checked) =>
              onCreateNewContactChange(checked === true)
            }
          />
          <Label htmlFor="quick-capture-new-contact" className="font-medium">
            {translate("crm.quick_capture.create_contact")}
          </Label>
        </div>
        {createNewContact || contacts.length === 0 ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>{translate("resources.contacts.fields.first_name")}</Label>
              <Input
                value={contactFirstName}
                onChange={(event) =>
                  onContactFirstNameChange(event.target.value)
                }
                className="nora-touch-target"
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
        ) : null}
      </div>
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
