import { required, useRecordContext, useTranslate } from "ra-core";

import { AutocompleteArrayInput } from "@/components/admin/autocomplete-array-input";

import { ReferenceArrayInput } from "@/components/admin/reference-array-input";

import { ReferenceInput } from "@/components/admin/reference-input";

import { TextInput } from "@/components/admin/text-input";

import { NumberInput } from "@/components/admin/number-input";

import { DateInput } from "@/components/admin/date-input";

import { SelectInput } from "@/components/admin/select-input";



import { contactOptionText } from "../misc/ContactOption";
import { BusinessNumber } from "../misc/BusinessNumber";
import { useConfigurationContext } from "../root/ConfigurationContext";

import type { Deal, Sale } from "../types";

import { AutocompleteCompanyInput } from "../companies/AutocompleteCompanyInput.tsx";



const saleOptionRenderer = (choice: Sale) =>

  `${choice.first_name} ${choice.last_name}`;



export const DealInputs = () => {

  const translate = useTranslate();
  const record = useRecordContext<Deal>();

  const { dealStages, dealCategories } = useConfigurationContext();



  return (

    <div className="flex flex-col gap-8">

      <div className="nora-form-section">

        <h6>{translate("resources.deals.inputs.linked_to")}</h6>

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

      </div>



      <div className="nora-form-section">

        <h6>{translate("resources.deals.inputs.details")}</h6>

        {record?.case_number ? (
          <p className="text-sm text-muted-foreground">
            {translate("resources.deals.fields.case_number")}:{" "}
            <BusinessNumber value={record.case_number} />
          </p>
        ) : null}

        <TextInput source="name" validate={required()} helperText={false} />



        <SelectInput

          source="category"

          choices={dealCategories}

          optionText="label"

          optionValue="value"

          helperText={false}

        />



        <TextInput source="description" multiline rows={4} helperText={false} />

      </div>



      <div className="nora-form-section">

        <h6>{translate("resources.deals.field_categories.misc")}</h6>

        <SelectInput

          source="stage"

          choices={dealStages}

          optionText="label"

          optionValue="value"

          defaultValue="neue-anfrage"

          helperText={false}

          validate={required()}

        />



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



        <ReferenceInput

          source="sales_id"

          reference="sales"

          filter={{

            "disabled@neq": true,

          }}

        >

          <SelectInput helperText={false} optionText={saleOptionRenderer} />

        </ReferenceInput>

      </div>

    </div>

  );

};


