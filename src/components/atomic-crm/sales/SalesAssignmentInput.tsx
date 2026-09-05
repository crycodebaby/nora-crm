import { useMemo } from "react";
import type { Validator } from "ra-core";
import { useGetList, useGetManyAggregate, useRecordContext } from "ra-core";

import { SelectInput } from "@/components/admin/select-input";
import type { SalesDirectory, SalesIdentity } from "../types";
import { SALES_DIRECTORY_REFERENCE_PROPS } from "./salesDirectoryReference";
import {
  SALES_IDENTITIES_RESOURCE,
  formatSalesIdentityName,
} from "./salesIdentityReference";

type SalesAssignmentInputProps = {
  source?: string;
  validate?: Validator | Validator[];
  emptyText?: string;
  helperText?: string | false;
};

type AssignmentChoice = SalesDirectory & { disabled?: boolean };

/**
 * "Zuständig" picker (User Lifecycle W2).
 *
 * Choices come from `sales_directory` (active employees only). If the record
 * is currently assigned to an employee who is no longer in the directory
 * (disabled since), that employee is resolved through `sales_identities` and
 * shown as the current value — visibly, by name, but as a non-selectable
 * option. Moving away is allowed; choosing them again is not (the database
 * enforces the same rule: NORA_EMPLOYEE_NOT_ASSIGNABLE).
 */
export const SalesAssignmentInput = ({
  source = "sales_id",
  validate,
  emptyText,
  helperText = false,
}: SalesAssignmentInputProps) => {
  const record = useRecordContext<Record<string, unknown>>();
  const currentId = record?.[source] as SalesDirectory["id"] | null | undefined;

  const { data: directory, isPending: directoryPending } =
    useGetList<SalesDirectory>(SALES_DIRECTORY_REFERENCE_PROPS.reference, {
      pagination: { page: 1, perPage: SALES_DIRECTORY_REFERENCE_PROPS.perPage },
      sort: SALES_DIRECTORY_REFERENCE_PROPS.sort,
    });

  const currentMissing =
    currentId != null &&
    !directoryPending &&
    !(directory ?? []).some((row) => String(row.id) === String(currentId));

  const { data: identities } = useGetManyAggregate<SalesIdentity>(
    SALES_IDENTITIES_RESOURCE,
    { ids: currentMissing ? [currentId as SalesDirectory["id"]] : [] },
    { enabled: currentMissing },
  );

  const choices = useMemo<AssignmentChoice[]>(() => {
    const active = directory ?? [];
    const current = currentMissing ? identities?.[0] : undefined;
    if (!current) return active;
    return [{ ...current, disabled: true }, ...active];
  }, [directory, identities, currentMissing]);

  return (
    <SelectInput
      source={source}
      choices={choices}
      isPending={directoryPending}
      optionText={formatSalesIdentityName}
      translateChoice={false}
      helperText={helperText}
      emptyText={emptyText}
      validate={validate}
    />
  );
};
