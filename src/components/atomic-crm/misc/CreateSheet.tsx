import { SaveButton } from "@/components/admin/form";
import {
  Sheet,
  SheetContent,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  CreateBase,
  Form,
  useNotify,
  useRedirect,
  useResourceContext,
  useTranslate,
  type CreateBaseProps,
  type FormProps,
} from "ra-core";
import { XIcon } from "lucide-react";
import { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { useNoraDirtyDialog } from "./useNoraDirtyDialog";

export interface CreateSheetProps extends CreateBaseProps {
  children: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  defaultValues?: FormProps["defaultValues"];
  headerActions?: ReactNode;
}

export const CreateSheet = ({
  children,
  open,
  onOpenChange,
  title = "Create",
  redirect: redirectTo = "show",
  mutationOptions,
  defaultValues,
  headerActions,
  ...createBaseProps
}: CreateSheetProps) => {
  const resource = useResourceContext(createBaseProps);
  const translate = useTranslate();
  const notify = useNotify();
  const redirect = useRedirect();

  const handleSuccess = (...args: any[]) => {
    if (mutationOptions?.onSuccess) {
      return mutationOptions.onSuccess(
        ...(args as Parameters<typeof mutationOptions.onSuccess>),
      );
    }
    const [data] = args;
    notify(`resources.${resource}.notifications.created`, {
      type: "info",
      messageArgs: {
        smart_count: 1,
        _: translate(`ra.notification.created`, {
          smart_count: 1,
        }),
      },
      undoable: createBaseProps.mutationMode === "undoable",
    });
    redirect(redirectTo, resource, data.id, data);
    onOpenChange(false);
  };

  const enhancedMutationOptions = {
    ...mutationOptions,
    onSuccess: handleSuccess,
  };

  if (!open) return null;

  return (
    <CreateBase
      {...createBaseProps}
      redirect={redirectTo}
      mutationOptions={enhancedMutationOptions}
    >
      <Form defaultValues={defaultValues} className="contents">
        <CreateSheetBody
          onOpenChange={onOpenChange}
          title={title}
          headerActions={headerActions}
        >
          {children}
        </CreateSheetBody>
      </Form>
    </CreateBase>
  );
};

const CreateSheetBody = ({
  children,
  onOpenChange,
  title,
  headerActions,
}: {
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  headerActions?: ReactNode;
}) => {
  const { requestClose, dirtyConfirmDialog } = useNoraDirtyDialog({
    onClose: () => onOpenChange(false),
  });

  return (
    <>
      <Sheet
        open
        onOpenChange={(next) => {
          if (!next) requestClose();
        }}
      >
        <SheetContent
          side="bottom"
          className="h-dvh flex flex-col"
          aria-describedby={undefined}
          preventOutsideClose
          showClose={false}
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            requestClose();
          }}
        >
          <SheetHeader className="border-b">
            <div
              className={cn(
                "flex items-center gap-2",
                headerActions && "pr-12",
              )}
            >
              <SheetTitle className="min-w-0 flex-1 truncate">
                {typeof title === "string" ? (
                  <span className="text-xl font-semibold">{title}</span>
                ) : (
                  title
                )}
              </SheetTitle>
              {headerActions && <div className="shrink-0">{headerActions}</div>}
            </div>
          </SheetHeader>

          <div className="flex-1 overflow-y-auto flex flex-col gap-3 p-4">
            {children}
          </div>

          <SheetFooter className="border-t flex flex-row w-full gap-4">
            <SaveButton className="flex-1 h-12" />
          </SheetFooter>
          <button
            type="button"
            className="ring-offset-background focus:ring-ring absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden"
            onClick={requestClose}
            aria-label="Close"
          >
            <XIcon className="size-6 md:size-4" />
          </button>
        </SheetContent>
      </Sheet>
      {dirtyConfirmDialog}
    </>
  );
};
