import type { Identifier } from "ra-core";
import { required } from "ra-core";
import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { SelectInput } from "@/components/admin/select-input";
import { TextInput } from "@/components/admin/text-input";
import { DateTimeInput } from "@/components/admin";

import { contactOptionText } from "../misc/ContactOption";
import { useConfigurationContext } from "../root/ConfigurationContext";

export const TaskFormContent = ({
  selectContact,
  companyId,
  defaultTaskType,
}: {
  /** Shows a required contact picker with no company scoping — the
   * fully-free "quick add" flow (Hotboard) where no context is known yet. */
  selectContact?: boolean;
  /** When set, shows an optional contact picker scoped to this customer's
   * own contacts — used when creating a task from the customer record,
   * where the customer is already known but the contact is not required
   * (e.g. "Rechnung prüfen" has no contact at all). */
  companyId?: Identifier | null;
  defaultTaskType?: string;
}) => {
  const { taskTypes } = useConfigurationContext();
  const showContactPicker = selectContact || companyId != null;

  return (
    <div className="flex flex-col gap-4">
      <SelectInput
        source="type"
        validate={required()}
        choices={taskTypes}
        optionText="label"
        optionValue="value"
        defaultValue={defaultTaskType ?? "rueckruf"}
        helperText={false}
      />
      <TextInput
        autoFocus
        source="text"
        validate={required()}
        multiline
        className="m-0"
        helperText={false}
      />
      {showContactPicker && (
        <ReferenceInput
          source="contact_id"
          reference="contacts_summary"
          filter={companyId != null ? { company_id: companyId } : undefined}
        >
          <AutocompleteInput
            label="resources.tasks.fields.contact_id"
            optionText={contactOptionText}
            helperText={false}
            validate={selectContact ? required() : undefined}
            modal
          />
        </ReferenceInput>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <DateTimeInput
          source="due_date"
          helperText={false}
          validate={required()}
        />
      </div>
    </div>
  );
};
