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

/** Admin invite / edit fields. Role is never chosen by the invitee. */
export function SalesInputs() {
  const { identity } = useGetIdentity();
  const record = useRecordContext<Sale>();
  const isSelf = record?.id === identity?.id;

  return (
    <div className="space-y-4 w-full">
      <TextInput
        source="first_name"
        label="Vorname"
        validate={required()}
        helperText={false}
      />
      <TextInput
        source="last_name"
        label="Nachname"
        validate={required()}
        helperText={false}
      />
      <TextInput
        source="email"
        label="Geschäftliche E-Mail-Adresse"
        validate={[required(), email()]}
        helperText={false}
      />
      <SelectInput
        source="role"
        label="Nora-Rolle"
        choices={roleChoices}
        readOnly={isSelf}
        helperText={
          isSelf
            ? "Die eigene Rolle kann nicht geändert werden."
            : "Wird serverseitig gesetzt. Eingeladene Personen können die Rolle nicht selbst wählen."
        }
      />
      <BooleanInput
        source="disabled"
        label="Zugang deaktiviert"
        readOnly={isSelf}
        helperText={false}
      />
    </div>
  );
}
