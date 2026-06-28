import { required } from "ra-core";
import { AutocompleteArrayInput } from "@/components/admin/autocomplete-array-input";
import { ReferenceArrayInput } from "@/components/admin/reference-array-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { TextInput } from "@/components/admin/text-input";
import { NumberInput } from "@/components/admin/number-input";
import { DateInput } from "@/components/admin/date-input";
import { SelectInput } from "@/components/admin/select-input";

import { contactOptionText } from "../misc/ContactOption";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { AutocompleteCompanyInput } from "../companies/AutocompleteCompanyInput.tsx";

export const DealInputs = () => {
  const { dealStages, dealCategories } = useConfigurationContext();

  return (
    <div className="flex flex-col gap-5">
      <TextInput source="name" validate={required()} helperText={false} />

      <ReferenceInput source="company_id" reference="companies">
        <AutocompleteCompanyInput
          label="resources.deals.fields.company_id"
          validate={required()}
          modal
        />
      </ReferenceInput>

      <ReferenceArrayInput source="contact_ids" reference="contacts_summary">
        <AutocompleteArrayInput
          label="resources.deals.fields.contact_ids"
          optionText={contactOptionText}
          helperText={false}
        />
      </ReferenceArrayInput>

      <TextInput source="description" multiline rows={3} helperText={false} />

      <SelectInput
        source="stage"
        choices={dealStages}
        optionText="label"
        optionValue="value"
        defaultValue="anfrage"
        helperText={false}
        validate={required()}
      />

      <SelectInput
        source="category"
        choices={dealCategories}
        optionText="label"
        optionValue="value"
        helperText={false}
      />

      <NumberInput
        source="amount"
        defaultValue={0}
        helperText={false}
        validate={required()}
      />

      <DateInput
        validate={required()}
        source="expected_closing_date"
        helperText={false}
        defaultValue={new Date().toISOString().split("T")[0]}
      />
    </div>
  );
};
