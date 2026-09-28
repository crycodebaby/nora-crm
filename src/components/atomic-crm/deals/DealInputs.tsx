import { required, useTranslate } from "ra-core";

import { AutocompleteArrayInput } from "@/components/admin/autocomplete-array-input";
import { ReferenceArrayInput } from "@/components/admin/reference-array-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { TextInput } from "@/components/admin/text-input";
import { NumberInput } from "@/components/admin/number-input";
import { DateInput } from "@/components/admin/date-input";
import { SelectInput } from "@/components/admin/select-input";

import { contactOptionText } from "../misc/ContactOption";
import { NoraFormGroup, NoraFormRow } from "../misc/NoraFormGroup";
import { NoraLongTextInput } from "../misc/NoraLongTextInput";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { AutocompleteCompanyInput } from "../companies/AutocompleteCompanyInput.tsx";
import { SalesAssignmentInput } from "../sales/SalesAssignmentInput";
import { DealSiteAddressInputs } from "./DealSiteAddressInputs";

/**
 * The Vorgang form, grouped the way the office thinks about a case:
 * what is it → who pays → where is it → when is it due → the long text.
 *
 * Field sources, validation, defaults and the frozen site-address contract
 * are unchanged from the previous stacked layout; only grouping, order and
 * the width each field is allowed to take differ.
 */
export const DealInputs = () => {
  const translate = useTranslate();
  const { dealStages, dealCategories } = useConfigurationContext();

  return (
    <div className="nora-measure-form flex w-full flex-col gap-6">
      <NoraFormGroup title={translate("resources.deals.groups.case")}>
        <TextInput source="name" validate={required()} helperText={false} />
        <NoraFormRow cols="2">
          <SelectInput
            source="category"
            choices={dealCategories}
            optionText="label"
            optionValue="value"
            helperText={false}
          />
          <SelectInput
            source="stage"
            choices={dealStages}
            optionText="label"
            optionValue="value"
            defaultValue="neue-anfrage"
            helperText={false}
            validate={required()}
          />
        </NoraFormRow>
      </NoraFormGroup>

      <NoraFormGroup
        title={translate("resources.deals.groups.client")}
        hint={translate("resources.deals.groups.client_hint")}
      >
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
        <NoraFormRow cols="2">
          <SalesAssignmentInput emptyText="—" />
        </NoraFormRow>
      </NoraFormGroup>

      <NoraFormGroup title={translate("resources.deals.groups.site")}>
        <DealSiteAddressInputs />
      </NoraFormGroup>

      <NoraFormGroup title={translate("resources.deals.groups.planning")}>
        <NoraFormRow cols="2">
          <DateInput
            validate={required()}
            source="expected_closing_date"
            helperText={false}
            defaultValue={new Date().toISOString().split("T")[0]}
          />
          <NumberInput
            source="amount"
            defaultValue={0}
            helperText={false}
            validate={required()}
          />
        </NoraFormRow>
      </NoraFormGroup>

      <NoraFormGroup
        title={translate("resources.deals.groups.description")}
        hint={translate("resources.deals.groups.description_hint")}
      >
        <NoraLongTextInput source="description" helperText={false} />
      </NoraFormGroup>
    </div>
  );
};
