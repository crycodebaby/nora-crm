import type { SelectInputProps } from "@/components/admin/select-input";
import { SelectInput } from "@/components/admin/select-input";
import { cn } from "@/lib/utils";

type ContactDetailTypeInputProps = Omit<
  SelectInputProps,
  "clearable" | "helperText" | "label" | "optionText" | "source"
>;

/**
 * Type selector used next to repeatable email, phone and link values.
 *
 * The type is intrinsic to the row, so it cannot be cleared independently.
 * Users remove the complete row through the iterator action instead.
 */
export const ContactDetailTypeInput = ({
  className,
  ...props
}: ContactDetailTypeInputProps) => (
  <SelectInput
    {...props}
    source="type"
    helperText={false}
    label={false}
    optionText="name"
    clearable={false}
    className={cn("w-full min-w-0 sm:w-40 sm:min-w-40", className)}
  />
);
