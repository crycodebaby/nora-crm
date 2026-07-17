import type { ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import { isValid } from "date-fns";
import { Archive, ArchiveRestore } from "lucide-react";
import {
  InfiniteListBase,
  ShowBase,
  useDataProvider,
  useNotify,
  useRecordContext,
  useRedirect,
  useRefresh,
  useTranslate,
  useUpdate,
} from "ra-core";
import { NoraDeleteButton, NoraEditButton } from "../misc/NoraAccessActions";
import { CanAccess } from "ra-core";
import { ReferenceArrayField } from "@/components/admin/reference-array-field";
import { ReferenceField } from "@/components/admin/reference-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";

import { NoteCreate } from "../notes/NoteCreate";
import { NotesIterator } from "../notes/NotesIterator";
import { useGetSalesName } from "../sales/useGetSalesName";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { BusinessNumber } from "../misc/BusinessNumber";
import { NoraSectionCard } from "../misc/NoraSectionCard";
import { ContactList } from "./ContactList";
import { DealFollowUpBadge } from "./DealFollowUpBadge";
import { DealProductionChecklistSection } from "../checklists/DealProductionChecklistSection";
import { DealTasksSection } from "./DealTasksSection";
import { EntityAuditHistory } from "../audit/EntityAuditHistory";
import { useDialogFocusReturn } from "../misc/useNoraDirtyDialog";
import { NoraShowBoundary } from "../misc/NoraShowBoundary";
import {
  findDealLabel,
  formatDealAmount,
  formatISODateString,
  getFollowUpStatus,
  isDealTerminalStage,
} from "./dealUtils";

export const DealShow = ({ open, id }: { open: boolean; id?: string }) => {
  const redirect = useRedirect();
  const { onCloseAutoFocus } = useDialogFocusReturn(open);

  const handleClose = () => {
    redirect("list", "deals");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        className="nora-deal-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        {id ? (
          <ShowBase id={id}>
            <NoraShowBoundary>
              <DealShowContent />
            </NoraShowBoundary>
          </ShowBase>
        ) : null}
      </DialogContent>
    </Dialog>
  );
};

const DealShowContent = () => {
  const translate = useTranslate();
  const { dealStages, dealCategories, currency } = useConfigurationContext();
  const record = useRecordContext<Deal>();
  if (!record) return null;

  const categoryLabel =
    dealCategories.find((c) => c.value === record.category)?.label ??
    record.category;
  const stageLabel = findDealLabel(dealStages, record.stage);
  const showFollowUp = !isDealTerminalStage(record.stage);
  const followUpStatus = showFollowUp
    ? getFollowUpStatus(record.expected_closing_date)
    : null;
  const salesName = useGetSalesName(record.sales_id);

  return (
    <div className="nora-detail-scroll flex flex-col min-h-0 flex-1">
      {record.archived_at ? <ArchivedTitle /> : null}

      <header className="nora-deal-dialog-header shrink-0">
        <div className="min-w-0 flex-1 space-y-2">
          <BusinessNumber
            value={record.case_number}
            kind="case"
            size="lg"
            variant="badge"
          />
          <h2 className="nora-deal-dialog-title">{record.name}</h2>
          <p className="nora-deal-dialog-customer">
            <ReferenceField
              source="company_id"
              reference="companies"
              link="show"
            />
          </p>
        </div>
        <div
          className={`flex flex-wrap gap-2 shrink-0 justify-end ${record.archived_at ? "" : "pr-10"}`}
        >
          {record.archived_at ? (
            <>
              <CanAccess resource="deals" action="edit">
                <UnarchiveButton record={record} />
              </CanAccess>
              <NoraDeleteButton resource="deals" />
            </>
          ) : (
            <>
              <CanAccess resource="deals" action="edit">
                <ArchiveButton record={record} />
              </CanAccess>
              <NoraEditButton resource="deals" />
            </>
          )}
        </div>
      </header>

      {followUpStatus && (followUpStatus === "today" || followUpStatus === "overdue") ? (
        <div className="px-4 md:px-6 pt-4 shrink-0">
          <DealFollowUpBadge
            dateString={record.expected_closing_date}
            variant="alert"
            showDate
          />
        </div>
      ) : null}

      <div className="px-4 md:px-6 py-6 space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <NoraSectionCard title={translate("resources.deals.sections.overview")}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DealFact
                label={translate("resources.deals.fields.stage")}
                value={stageLabel}
              />
              {record.category ? (
                <DealFact
                  label={translate("resources.deals.fields.category")}
                  value={categoryLabel}
                />
              ) : null}
              <DealFact
                label={translate("resources.deals.fields.expected_closing_date")}
                value={
                  isValid(new Date(record.expected_closing_date))
                    ? formatISODateString(record.expected_closing_date)
                    : translate("resources.deals.invalid_date")
                }
                extra={
                  showFollowUp && followUpStatus === "upcoming" ? (
                    <DealFollowUpBadge
                      dateString={record.expected_closing_date}
                      variant="inline"
                    />
                  ) : null
                }
              />
              <DealFact
                label={translate("resources.deals.fields.amount")}
                value={formatDealAmount(record.amount, currency, {
                  notation: "compact",
                  minimumSignificantDigits: 3,
                })}
              />
              <DealFact
                label={translate("resources.deals.fields.sales_id")}
                value={salesName ?? "—"}
              />
            </div>
          </NoraSectionCard>

          {!!record.contact_ids?.length && (
            <NoraSectionCard
              title={translate("resources.deals.fields.contact_ids")}
            >
              <ReferenceArrayField
                source="contact_ids"
                reference="contacts_summary"
              >
                <ContactList />
              </ReferenceArrayField>
            </NoraSectionCard>
          )}
        </div>

        {record.description ? (
          <NoraSectionCard
            title={translate("resources.deals.fields.description")}
          >
            <p className="nora-detail-body whitespace-pre-line">
              {record.description}
            </p>
          </NoraSectionCard>
        ) : null}

        <NoraSectionCard title={translate("resources.deals.tasks.title")}>
          <DealTasksSection />
        </NoraSectionCard>

        <DealProductionChecklistSection />

        <NoraSectionCard
          title={translate("resources.notes.name", { smart_count: 2 })}
        >
          <InfiniteListBase
            resource="deal_notes"
            filter={{ deal_id: record.id }}
            sort={{ field: "date", order: "DESC" }}
            perPage={25}
            disableSyncWithLocation
            storeKey={false}
            empty={
              <CanAccess resource="deal_notes" action="create">
                <NoteCreate reference={"deals"} />
              </CanAccess>
            }
          >
            <NotesIterator reference="deals" />
          </InfiniteListBase>
        </NoraSectionCard>

        <EntityAuditHistory entityType="deal" entityId={Number(record.id)} />
      </div>
    </div>
  );
};

const DealFact = ({
  label,
  value,
  extra,
  children,
}: {
  label: string;
  value?: string | null;
  extra?: React.ReactNode;
  children?: ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <span className="nora-detail-label">{label}</span>
    <div className="nora-detail-value flex flex-wrap items-center gap-2">
      {children ?? value}
      {extra}
    </div>
  </div>
);

const ArchivedTitle = () => {
  const translate = useTranslate();
  return (
    <div className="bg-orange-500 px-6 py-4 shrink-0">
      <h3 className="text-lg font-bold text-white">
        {translate("resources.deals.archived.title")}
      </h3>
    </div>
  );
};

const ArchiveButton = ({ record }: { record: Deal }) => {
  const translate = useTranslate();
  const [update] = useUpdate();
  const redirect = useRedirect();
  const notify = useNotify();
  const refresh = useRefresh();
  const handleClick = () => {
    update(
      "deals",
      {
        id: record.id,
        data: { archived_at: new Date().toISOString() },
        previousData: record,
      },
      {
        onSuccess: () => {
          redirect("list", "deals");
          notify("resources.deals.archived.success", {
            type: "info",
            undoable: false,
          });
          refresh();
        },
        onError: () => {
          notify("resources.deals.archived.error", {
            type: "error",
          });
        },
      },
    );
  };

  return (
    <Button
      onClick={handleClick}
      size="lg"
      variant="outline"
      className="flex items-center gap-2 nora-touch-target"
    >
      <Archive className="w-4 h-4" aria-hidden />
      {translate("resources.deals.archived.action")}
    </Button>
  );
};

const UnarchiveButton = ({ record }: { record: Deal }) => {
  const translate = useTranslate();
  const dataProvider = useDataProvider();
  const redirect = useRedirect();
  const notify = useNotify();
  const refresh = useRefresh();

  const { mutate } = useMutation({
    mutationFn: () => dataProvider.unarchiveDeal(record),
    onSuccess: () => {
      redirect("list", "deals");
      notify("resources.deals.unarchived.success", {
        type: "info",
        undoable: false,
      });
      refresh();
    },
    onError: () => {
      notify("resources.deals.unarchived.error", {
        type: "error",
      });
    },
  });

  const handleClick = () => {
    mutate();
  };

  return (
    <Button
      onClick={handleClick}
      size="lg"
      variant="outline"
      className="flex items-center gap-2 nora-touch-target"
    >
      <ArchiveRestore className="w-4 h-4" aria-hidden />
      {translate("resources.deals.unarchived.action")}
    </Button>
  );
};
