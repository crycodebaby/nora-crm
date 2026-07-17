import { email, required, useGetIdentity, useRecordContext } from "ra-core";
import { BooleanInput } from "@/components/admin/boolean-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";

import type { Sale } from "../types";

const roleChoices = [
  { id: "admin", name: "Administrator" },
  { id: "office", name: "Büro" },
  { id: "viewer", name: "Lesen" },
];

export function SalesInputs() {
  const { identity } = useGetIdentity();
  const record = useRecordContext<Sale>();
  const isSelf = record?.id === identity?.id;

  return (
    <div className="space-y-4 w-full">
      <TextInput source="first_name" validate={required()} helperText={false} />
      <TextInput source="last_name" validate={required()} helperText={false} />
      <TextInput
        source="email"
        validate={[required(), email()]}
        helperText={false}
      />
      <SelectInput
        source="role"
        choices={roleChoices}
        readOnly={isSelf}
        helperText={false}
      />
      <BooleanInput
        source="disabled"
        readOnly={isSelf}
        helperText={false}
      />
    </div>
  );
}
