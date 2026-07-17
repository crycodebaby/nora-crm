import {
  EditBase,
  Form,
  useNotify,
  useTranslate,
  CanAccess,
  type Identifier,
} from "ra-core";
import { DeleteButton } from "@/components/admin/delete-button";
import { SaveButton } from "@/components/admin/form";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { NoraAccessGuard } from "../misc/NoraEditGuard";
import { NoraDialogContent } from "../misc/NoraDialogContent";
import { useNoraDirtyDialog } from "../misc/useNoraDirtyDialog";
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
          mutationOptions={{
            onSuccess: () => {
              close();
              notify("resources.tasks.updated", {
                type: "info",
                undoable: true,
              });
            },
          }}
          redirect={false}
        >
          <NoraAccessGuard resource="tasks" action="edit">
            <Form className="contents">
              <TaskEditDialogBody close={close} notify={notify} />
            </Form>
          </NoraAccessGuard>
        </EditBase>
      ) : null}
    </Dialog>
  );
};

const TaskEditDialogBody = ({
  close,
  notify,
}: {
  close: () => void;
  notify: ReturnType<typeof useNotify>;
}) => {
  const translate = useTranslate();
  const { requestClose, dirtyConfirmDialog } = useNoraDirtyDialog({
    onClose: close,
  });

  return (
    <>
      <NoraDialogContent
        open
        onRequestClose={requestClose}
        className="lg:max-w-xl overflow-y-auto max-h-9/10 top-1/20 translate-y-0"
      >
        <DialogHeader>
          <DialogTitle>{translate("resources.tasks.action.edit")}</DialogTitle>
        </DialogHeader>
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
      </NoraDialogContent>
      {dirtyConfirmDialog}
    </>
  );
};
