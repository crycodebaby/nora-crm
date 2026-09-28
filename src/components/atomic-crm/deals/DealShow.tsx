import { useMutation } from "@tanstack/react-query";
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
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { NoteCreate } from "../notes/NoteCreate";
import { NotesIterator } from "../notes/NotesIterator";
import type { Deal } from "../types";
import { NoraSectionCard } from "../misc/NoraSectionCard";
import { DealFollowUpBadge } from "./DealFollowUpBadge";
import { DealProductionChecklistSection } from "../checklists/DealProductionChecklistSection";
import { DealTasksSection } from "./DealTasksSection";
import { EntityAuditHistory } from "../audit/EntityAuditHistory";
import { useDialogFocusReturn } from "../misc/useNoraDirtyDialog";
import { NoraShowBoundary } from "../misc/NoraShowBoundary";
import { useDealShowFacts } from "./useDealShowFacts";
import { isNoraRecordId } from "../routing/noraRoutes";
import {
  DealArchivedBanner,
  DealDescriptionSection,
  DealHeaderContextLine,
  DealKeyFacts,
  DealPartiesSection,
  DealTitleBlock,
} from "./DealShowSections";

export const DealShow = ({ open, id }: { open: boolean; id?: string }) => {
  const redirect = useRedirect();
  const { onCloseAutoFocus } = useDialogFocusReturn(open);
  const canLoad = open && isNoraRecordId(id);

  const handleClose = () => {
    redirect("list", "deals");
  };

  return (
    <Dialog
      open={canLoad}
      onOpenChange={(next) => {
        if (!next) handleClose();
      }}
    >
      <DialogContent
        className="nora-deal-dialog"
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={undefined}
      >
        <DialogTitle className="sr-only">Vorgang</DialogTitle>
        {canLoad ? (
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
  const record = useRecordContext<Deal>();
  const facts = useDealShowFacts(record);
  if (!record) return null;

  const { followUpStatus } = facts;
  const isAlert = followUpStatus === "today" || followUpStatus === "overdue";

  return (
    <div className="nora-detail-scroll flex flex-col min-h-0 flex-1">
      <header className="nora-deal-dialog-header shrink-0">
        <div className="min-w-0 flex-1">
          <DealTitleBlock deal={record} facts={facts} />
          <DealHeaderContextLine deal={record} facts={facts} />
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

      <div className="nora-deal-dialog-body">
        {record.archived_at ? <DealArchivedBanner /> : null}

        {isAlert ? (
          <DealFollowUpBadge
            dateString={record.expected_closing_date}
            variant="alert"
            showDate
          />
        ) : null}

        <NoraSectionCard title={translate("resources.deals.sections.overview")}>
          <DealKeyFacts deal={record} facts={facts} />
        </NoraSectionCard>

        <DealPartiesSection deal={record} />

        <DealDescriptionSection deal={record} />

        <DealTasksSection />

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
