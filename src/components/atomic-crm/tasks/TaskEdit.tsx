import { useEffect, useState } from "react";
import {
  EditBase,
  Form,
  useNotify,
  useTranslate,
  CanAccess,
  type Identifier,
} from "ra-core";
import { useFormContext, useFormState } from "react-hook-form";
import { DeleteButton } from "@/components/admin/delete-button";
import { SaveButton } from "@/components/admin/form";
import {
  Dialog,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { NoraAccessGuard } from "../misc/NoraEditGuard";
import { NoraDialogContent } from "../misc/NoraDialogContent";
import { TaskFormContent } from "./TaskFormContent";

export const TaskEdit = ({
  open,
  close,
  taskId,
}: {
  taskId: Identifier;
  open: boolean;
  close: () => void;
}) => {
  const notify = useNotify();

  return (
    <Dialog open={open}>
      {open && taskId ? (
        <EditBase
          id={taskId}
          resource="tasks"
          className="mt-0"
          mutationMode="pessimistic"
          mutationOptions={{
            onSuccess: () => {
              close();
              notify("resources.tasks.updated", {
                type: "info",
              });
            },
          }}
          redirect={false}
        >
          <NoraAccessGuard resource="tasks" action="edit">
            <TaskEditDialogBody close={close} notify={notify} />
          </NoraAccessGuard>
        </EditBase>
      ) : null}
    </Dialog>
  );
};

/**
 * Stabilization Gate 2b: Form must live INSIDE the Radix Dialog portal.
 * Same root cause as DealEdit Gate 2 — Form outside portal left SaveButton
 * with button.form === null so native submit never ran.
 */
const TaskEditDialogBody = ({
  close,
  notify,
}: {
  close: () => void;
  notify: ReturnType<typeof useNotify>;
}) => {
  const translate = useTranslate();
  const [isDirty, setIsDirty] = useState(false);

  return (
    <NoraDialogContent
      open
      isDirty={isDirty}
      onRequestClose={close}
      className="lg:max-w-xl overflow-y-auto max-h-9/10 top-1/20 translate-y-0"
    >
      <DialogHeader>
        <DialogTitle>{translate("resources.tasks.action.edit")}</DialogTitle>
        <DialogDescription className="sr-only">
          {translate("resources.tasks.edit_dialog.description", {
            _: "Aufgabendaten bearbeiten und speichern.",
          })}
        </DialogDescription>
      </DialogHeader>
      <Form>
        <FormDirtyBridge onDirtyChange={setIsDirty} />
        <TaskFormContent />
        <DialogFooter className="w-full sm:justify-between gap-4">
          <CanAccess resource="tasks" action="delete">
            <DeleteButton
              mutationOptions={{
                onSuccess: () => {
                  close();
                  notify("resources.tasks.deleted", {
                    type: "info",
                    undoable: true,
                  });
                },
              }}
              redirect={false}
            />
          </CanAccess>
          <SaveButton label="ra.action.save" />
        </DialogFooter>
      </Form>
    </NoraDialogContent>
  );
};

/** Syncs RHF dirty state to NoraDialogContent (outside Form context). */
const FormDirtyBridge = ({
  onDirtyChange,
}: {
  onDirtyChange: (isDirty: boolean) => void;
}) => {
  const { isDirty, errors, isValid } = useFormState();
  const { getValues } = useFormContext();
  useEffect(() => {
    onDirtyChange(isDirty);
  }, [isDirty, onDirtyChange]);
  useEffect(() => {
    if (import.meta.env.MODE === "test") {
      (
        window as unknown as {
          __noraTaskEditForm?: () => unknown;
        }
      ).__noraTaskEditForm = () => ({
        values: getValues(),
        errors,
        isValid,
        isDirty,
      });
    }
  });
  return null;
};
