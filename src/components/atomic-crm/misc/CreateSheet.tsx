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
  saveLabel?: string;
  contentClassName?: string;
  bodyClassName?: string;
  saveButtonClassName?: string;
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
  saveLabel,
  contentClassName,
  bodyClassName,
  saveButtonClassName,
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
          saveLabel={saveLabel}
          contentClassName={contentClassName}
          bodyClassName={bodyClassName}
          saveButtonClassName={saveButtonClassName}
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
  saveLabel,
  contentClassName,
  bodyClassName,
  saveButtonClassName,
}: {
  children: ReactNode;
  onOpenChange: (open: boolean) => void;
  title?: ReactNode;
  headerActions?: ReactNode;
  saveLabel?: string;
  contentClassName?: string;
  bodyClassName?: string;
  saveButtonClassName?: string;
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
          className={cn("h-dvh flex flex-col", contentClassName)}
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

          <div
            className={cn(
              "flex flex-1 flex-col gap-3 overflow-y-auto p-4",
              bodyClassName,
            )}
          >
            {children}
          </div>

          <SheetFooter className="flex w-full flex-row gap-4 border-t bg-background/95 pb-[max(1rem,env(safe-area-inset-bottom))] backdrop-blur-sm">
            <SaveButton
              type="button"
              label={saveLabel}
              className={cn("h-12 flex-1", saveButtonClassName)}
            />
          </SheetFooter>
          <button
            type="button"
            className="nora-touch-target ring-offset-background focus:ring-ring absolute right-1.5 top-1.5 rounded-md opacity-80 transition-opacity hover:bg-accent hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden sm:right-2 sm:top-2"
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
