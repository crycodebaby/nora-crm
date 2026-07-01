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
import { DeleteButton } from "@/components/admin/delete-button";
import { EditButton } from "@/components/admin/edit-button";
import { ReferenceArrayField } from "@/components/admin/reference-array-field";
import { ReferenceField } from "@/components/admin/reference-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";

import { CompanyAvatar } from "../companies/CompanyAvatar";
import { NoteCreate } from "../notes/NoteCreate";
import { NotesIterator } from "../notes/NotesIterator";
import { useGetSalesName } from "../sales/useGetSalesName";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Deal } from "../types";
import { BusinessNumber } from "../misc/BusinessNumber";
import { ContactList } from "./ContactList";
import { DealFollowUpBadge } from "./DealFollowUpBadge";
import { DealProductionChecklistSection } from "../checklists/DealProductionChecklistSection";
import { DealTasksSection } from "./DealTasksSection";
import {
  findDealLabel,
  formatDealAmount,
  formatISODateString,
  isDealTerminalStage,
} from "./dealUtils";

export const DealShow = ({ open, id }: { open: boolean; id?: string }) => {
  const redirect = useRedirect();
  const handleClose = () => {
    redirect("list", "deals");
  };

  return (
    <Dialog open={open} onOpenChange={(open) => !open && handleClose()}>
      <DialogContent className="lg:max-w-4xl p-4 overflow-y-auto max-h-9/10 top-1/20 translate-y-0">
        {id ? (
          <ShowBase id={id}>
            <DealShowContent />
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
  const salesName = useGetSalesName(record.sales_id);

  return (
    <>
      <div className="space-y-6">
        {record.archived_at ? <ArchivedTitle /> : null}

        <div className="flex justify-between items-start gap-4">
          <div className="flex items-start gap-4 min-w-0">
            <ReferenceField
              source="company_id"
              reference="companies"
              link="show"
            >
              <CompanyAvatar />
            </ReferenceField>
            <div className="min-w-0">
              <BusinessNumber value={record.case_number} />
              <h2 className="text-2xl font-semibold tracking-tight">
                {record.name}
              </h2>
              <span className="nora-muted text-sm mt-1 block">
                <ReferenceField
                  source="company_id"
                  reference="companies"
                  link="show"
                />
              </span>
            </div>
          </div>
          <div className={`flex gap-2 shrink-0 ${record.archived_at ? "" : "pr-12"}`}>
            {record.archived_at ? (
              <>
                <UnarchiveButton record={record} />
                <DeleteButton />
              </>
            ) : (
              <>
                <ArchiveButton record={record} />
                <EditButton />
              </>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 nora-card p-4">
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
              showFollowUp ? (
                <DealFollowUpBadge dateString={record.expected_closing_date} />
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

        {!!record.contact_ids?.length && (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold tracking-tight">
              {translate("resources.deals.fields.contact_ids")}
            </h3>
            <ReferenceArrayField
              source="contact_ids"
              reference="contacts_summary"
            >
              <ContactList />
            </ReferenceArrayField>
          </section>
        )}

        {record.description ? (
          <section className="space-y-2">
            <h3 className="text-sm font-semibold tracking-tight">
              {translate("resources.deals.fields.description")}
            </h3>
            <p className="nora-readable text-sm whitespace-pre-line">
              {record.description}
            </p>
          </section>
        ) : null}

        <section className="space-y-3">
          <h3 className="text-sm font-semibold tracking-tight">
            {translate("resources.deals.tasks.title")}
          </h3>
          <DealTasksSection />
        </section>

        <DealProductionChecklistSection />

        <section className="space-y-3">
          <Separator />
          <h3 className="text-sm font-semibold tracking-tight">
            {translate("resources.notes.name", { smart_count: 2 })}
          </h3>
          <InfiniteListBase
            resource="deal_notes"
            filter={{ deal_id: record.id }}
            sort={{ field: "date", order: "DESC" }}
            perPage={25}
            disableSyncWithLocation
            storeKey={false}
            empty={<NoteCreate reference={"deals"} />}
          >
            <NotesIterator reference="deals" />
          </InfiniteListBase>
        </section>
      </div>
    </>
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
  <div className="flex flex-col gap-1">
    <span className="text-xs text-muted-foreground tracking-wide uppercase">
      {label}
    </span>
    <div className="text-sm font-medium flex flex-wrap items-center gap-2">
      {children ?? value}
      {extra}
    </div>
  </div>
);

const ArchivedTitle = () => {
  const translate = useTranslate();
  return (
    <div className="bg-orange-500 px-6 py-4">
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
      size="sm"
      variant="outline"
      className="flex items-center gap-2 h-9"
    >
      <Archive className="w-4 h-4" />
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
      size="sm"
      variant="outline"
      className="flex items-center gap-2 h-9"
    >
      <ArchiveRestore className="w-4 h-4" />
      {translate("resources.deals.unarchived.action")}
    </Button>
  );
};
