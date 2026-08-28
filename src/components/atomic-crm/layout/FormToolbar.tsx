import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";
import { NoraCancelButton } from "../misc/NoraCancelButton";
import { useFormState } from "react-hook-form";
import { cn } from "@/lib/utils";

export const FormToolbar = ({
  className,
  saveClassName,
  saveLabel,
}: {
  className?: string;
  saveClassName?: string;
  saveLabel?: string;
}) => {
  const { isDirty } = useFormState();
  const Cancel = isDirty ? NoraCancelButton : CancelButton;

  return (
    <div
      role="toolbar"
      className={cn(
        "sticky bottom-0 flex flex-row justify-end gap-2 bg-linear-to-b from-transparent to-card to-10% pb-4 pt-4 md:pb-0",
        className,
      )}
    >
      <Cancel />
      <SaveButton label={saveLabel} className={saveClassName} />
    </div>
  );
};
