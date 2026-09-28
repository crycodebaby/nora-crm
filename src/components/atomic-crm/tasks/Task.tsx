import { useQueryClient } from "@tanstack/react-query";
import { MoreVertical } from "lucide-react";
import {
  useDeleteWithUndoController,
  useGetRecordRepresentation,
  useNotify,
  useTranslate,
  useUpdate,
} from "ra-core";
import { useEffect, useState } from "react";
import { ReferenceField } from "@/components/admin/reference-field";
import { DateField } from "@/components/admin/date-field";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import { useConfigurationContext } from "../root/ConfigurationContext";
import { useGetSalesName } from "../sales/useGetSalesName";
import type { Contact, Task as TData } from "../types";
import { getFollowUpStatus } from "../deals/dealUtils";
import { TaskEdit } from "./TaskEdit";
import { TaskEditSheet } from "./TaskEditSheet";
import { useIsMobile } from "@/hooks/use-mobile";

export const Task = ({
  task,
  showContact,
  showHolder,
  variant = "stack",
}: {
  task: TData;
  showContact?: boolean;
  /** Names the responsible employee in the meta line (existing `sales_id`). */
  showHolder?: boolean;
  /** `row`: dense grid row (type · text · due · responsible · actions). */
  variant?: "stack" | "row";
}) => {
  const isMobile = useIsMobile();
  const { taskTypes } = useConfigurationContext();
  const notify = useNotify();
  const translate = useTranslate();
  const queryClient = useQueryClient();
  const getContactRepresentation = useGetRecordRepresentation("contacts");
  const holderName = useGetSalesName(task.sales_id, {
    enabled: Boolean(showHolder) && task.sales_id != null,
  });

  const [openEdit, setOpenEdit] = useState(false);

  const handleCloseEdit = () => {
    setOpenEdit(false);
  };

  const [update, { isPending: isUpdatePending, isSuccess, variables }] =
    useUpdate();
  const { handleDelete } = useDeleteWithUndoController({
    record: task,
    redirect: false,
    mutationOptions: {
      onSuccess() {
        notify("resources.tasks.deleted", {
          undoable: true,
        });
      },
    },
  });

  const handleEdit = () => {
    setOpenEdit(true);
  };

  const handleCheck = () => () => {
    update("tasks", {
      id: task.id,
      data: {
        done_date: task.done_date ? null : new Date().toISOString(),
      },
      previousData: task,
    });
  };

  useEffect(() => {
    // We do not want to invalidate the query when a tack is checked or unchecked
    if (
      isUpdatePending ||
      !isSuccess ||
      variables?.data?.done_date != undefined
    ) {
      return;
    }

    queryClient.invalidateQueries({ queryKey: ["tasks", "getList"] });
  }, [queryClient, isUpdatePending, isSuccess, variables]);

  const labelId = `checkbox-list-label-${task.id}`;
  const matchedTaskType = taskTypes.find(
    (taskType) => taskType.value === task.type,
  );
  const typeLabel =
    task.type && task.type !== "none"
      ? (matchedTaskType?.label ?? task.type)
      : null;
  const dueStatus = task.done_date ? null : getFollowUpStatus(task.due_date);

  return (
    <>
      <div
        className="nora-task-row"
        data-done={task.done_date ? "true" : "false"}
        data-variant={variant}
        data-due={dueStatus ?? undefined}
        role={variant === "row" ? "row" : undefined}
      >
        <div className="nora-task-check">
          <Checkbox
            id={labelId}
            checked={!!task.done_date}
            onCheckedChange={handleCheck()}
            disabled={isUpdatePending}
            className="nora-task-checkbox"
            aria-label={translate("resources.tasks.done_toggle", {
              _: "Aufgabe erledigt",
            })}
          />
        </div>
        <div
          className="nora-task-body"
          onClick={isMobile ? handleCheck() : undefined}
        >
          {typeLabel ? (
            <span className="nora-task-type-cell">
              <span className="nora-task-type">{typeLabel}</span>
            </span>
          ) : (
            <span className="nora-task-type-cell" aria-hidden />
          )}
          <label htmlFor={labelId} className="nora-task-text cursor-pointer">
            {task.text}
          </label>
          <div className="nora-task-meta" data-due={dueStatus ?? undefined}>
            <span className="nora-task-due">
              <span className="nora-task-due-label">
                {translate("resources.tasks.fields.due_short")}{" "}
              </span>
              <DateField
                source="due_date"
                record={task}
                showDate
                showTime
                options={{
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                }}
              />
            </span>
            <span className="nora-task-holder">
              {showHolder && holderName ? (
                <>
                  <span className="nora-task-sep" aria-hidden>
                    ·
                  </span>
                  <span>{holderName}</span>
                </>
              ) : null}
            </span>
            {showContact && (
              <span className="nora-task-contact">
                <ReferenceField<TData, Contact>
                  source="contact_id"
                  reference="contacts_summary"
                  record={task}
                  link="show"
                  className="inline"
                  render={({ referenceRecord }) => {
                    if (!referenceRecord) return null;
                    // The task's own company_id is its historical customer
                    // context, set once and never re-synced — it may no
                    // longer match the contact's *current* company if the
                    // contact was reassigned since. That is expected, not
                    // an error; show it as a quiet note, not a warning.
                    const isHistoricalMismatch =
                      task.company_id != null &&
                      referenceRecord.company_id !== task.company_id;
                    return (
                      <>
                        {" "}
                        {translate("resources.tasks.regarding_contact", {
                          name: getContactRepresentation(referenceRecord),
                        })}
                        {isHistoricalMismatch && (
                          <span className="italic">
                            {" "}
                            {referenceRecord.company_name
                              ? translate(
                                  "resources.tasks.historical_contact_company",
                                  { company: referenceRecord.company_name },
                                )
                              : translate(
                                  "resources.tasks.historical_contact_unassigned",
                                )}
                          </span>
                        )}
                      </>
                    );
                  }}
                />
              </span>
            )}
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="nora-task-menu cursor-pointer"
              aria-label={translate("resources.tasks.actions.title")}
            >
              <MoreVertical className="size-5 md:size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={() => {
                update("tasks", {
                  id: task.id,
                  data: {
                    due_date: new Date(Date.now() + 24 * 60 * 60 * 1000)
                      .toISOString()
                      .slice(0, 10),
                  },
                  previousData: task,
                });
              }}
            >
              {translate("resources.tasks.actions.postpone_tomorrow")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={() => {
                update("tasks", {
                  id: task.id,
                  data: {
                    due_date: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
                      .toISOString()
                      .slice(0, 10),
                  },
                  previousData: task,
                });
              }}
            >
              {translate("resources.tasks.actions.postpone_next_week")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={handleEdit}
            >
              {translate("ra.action.edit")}
            </DropdownMenuItem>
            <DropdownMenuItem
              className="cursor-pointer h-12 md:h-8 px-4 md:px-2 text-base md:text-sm"
              onClick={handleDelete}
            >
              {translate("ra.action.delete")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {isMobile ? (
        <TaskEditSheet
          taskId={task.id}
          open={openEdit}
          onOpenChange={setOpenEdit}
        />
      ) : (
        <TaskEdit taskId={task.id} open={openEdit} close={handleCloseEdit} />
      )}
    </>
  );
};
