/**
 * "Ansprechpartner"-Abschnitt der Kundenanlage (/kunden/create) — Referenz-
 * implementierung für die Customer & Contact Workflow Wave. Nur für
 * customer_kind = "business" sichtbar (Privatperson erfasst Personendaten
 * bereits oben in CompanyInputs / CustomerPersonFields).
 *
 * Modus:
 *  - none:     kein Ansprechpartner
 *  - new:      neuer Ansprechpartner (eigene Felder)
 *  - self:     Unternehmer ist selbst Ansprechpartner — "Angaben übernehmen"
 *              kopiert die bereits eingegebenen Firmen-Kontaktdaten
 *  - existing: bestehenden Ansprechpartner zuordnen (wird Hauptansprechpartner)
 */
import { useTranslate } from "ra-core";
import { useFormContext, useWatch } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { TextInput } from "@/components/admin/text-input";
import { RadioButtonGroupInput } from "@/components/admin/radio-button-group-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { AutocompleteInput } from "@/components/admin/autocomplete-input";
import { ArrayInput } from "@/components/admin/array-input";
import { SimpleFormIterator } from "@/components/admin/simple-form-iterator";

import { contactOptionText } from "../misc/ContactOption";
import { ContactDetailTypeInput } from "../misc/ContactDetailTypeInput";
import {
  contactGender,
  translateContactGenderLabel,
} from "../contacts/contactModel";
import {
  getContactMethodTypeChoices,
  DEFAULT_CONTACT_EMAIL_TYPE,
  DEFAULT_CONTACT_PHONE_TYPE,
} from "../misc/contactMethodTypes";
import {
  getLinkTypeChoices,
  isValidUrl,
  DEFAULT_LINK_TYPE,
} from "../misc/linksModel";

export type ContactCaptureMode = "none" | "new" | "self" | "existing";

const CONTACT_CAPTURE_FIELD = "__contact_capture_mode";
export { CONTACT_CAPTURE_FIELD };

export const CustomerContactCaptureInputs = () => {
  const translate = useTranslate();
  const { setValue, getValues } = useFormContext();
  const mode: ContactCaptureMode = useWatch({
    name: CONTACT_CAPTURE_FIELD,
    defaultValue: "new",
  });
  const emailTypes = getContactMethodTypeChoices(translate);
  const linkTypes = getLinkTypeChoices(translate);

  const modeChoices = [
    { value: "new", label: "resources.companies.inputs.contact_capture.new" },
    {
      value: "self",
      label: "resources.companies.inputs.contact_capture.self",
    },
    {
      value: "existing",
      label: "resources.companies.inputs.contact_capture.existing",
    },
    {
      value: "none",
      label: "resources.companies.inputs.contact_capture.none",
    },
  ];

  const handleTakeOver = () => {
    const values = getValues();
    setValue("contact_email_jsonb", values.email_jsonb ?? [], {
      shouldDirty: true,
    });
    setValue("contact_phone_jsonb", values.phone_jsonb ?? [], {
      shouldDirty: true,
    });
    setValue("contact_links_jsonb", values.links_jsonb ?? [], {
      shouldDirty: true,
    });
  };

  return (
    <div className="nora-form-section">
      <h6>
        {translate("resources.companies.field_categories.contact_person", {
          _: "Ansprechpartner",
        })}
      </h6>
      <RadioButtonGroupInput
        source={CONTACT_CAPTURE_FIELD}
        label={false}
        row
        choices={modeChoices}
        optionText={(choice) => translate(choice.label)}
        translateChoice={false}
        optionValue="value"
        helperText={false}
        defaultValue="new"
      />

      {mode === "existing" ? (
        <ReferenceInput source="contact_existing_id" reference="contacts">
          <AutocompleteInput
            label="resources.companies.inputs.contact_capture.existing_contact"
            optionText={contactOptionText}
            helperText={false}
          />
        </ReferenceInput>
      ) : null}

      {mode === "new" || mode === "self" ? (
        <div className="flex flex-col gap-3">
          {mode === "self" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="w-fit"
              onClick={handleTakeOver}
            >
              {translate(
                "resources.companies.inputs.contact_capture.take_over",
                { _: "Angaben übernehmen" },
              )}
            </Button>
          ) : null}
          <RadioButtonGroupInput
            label={false}
            row
            source="contact_gender"
            choices={contactGender}
            helperText={false}
            optionText={(choice) =>
              translateContactGenderLabel(choice, translate)
            }
            translateChoice={false}
            optionValue="value"
            defaultValue={contactGender[0].value}
          />
          <TextInput
            source="contact_first_name"
            label="resources.contacts.fields.first_name"
            validate={requiredForNewContact}
            helperText={false}
          />
          <TextInput
            source="contact_last_name"
            label="resources.contacts.fields.last_name"
            validate={requiredForNewContact}
            helperText={false}
          />
          <TextInput
            source="contact_title"
            label="resources.contacts.fields.title"
            helperText={false}
          />
          <ArrayInput
            source="contact_email_jsonb"
            label="resources.contacts.field_categories.personal_info"
            helperText={false}
          >
            <SimpleFormIterator
              inline
              disableReordering
              disableClear
              className="[&>ul>li]:border-b-0 [&>ul>li]:pb-0"
            >
              <TextInput
                source="email"
                className="w-full"
                helperText={false}
                label={false}
                placeholder={translate("resources.contacts.fields.email")}
              />
              <ContactDetailTypeInput
                choices={emailTypes}
                defaultValue={DEFAULT_CONTACT_EMAIL_TYPE}
              />
            </SimpleFormIterator>
          </ArrayInput>
          <ArrayInput
            source="contact_phone_jsonb"
            label={false}
            helperText={false}
          >
            <SimpleFormIterator
              inline
              disableReordering
              disableClear
              className="[&>ul>li]:border-b-0 [&>ul>li]:pb-0"
            >
              <TextInput
                source="number"
                className="w-full"
                helperText={false}
                label={false}
                placeholder={translate(
                  "resources.contacts.fields.phone_number",
                )}
              />
              <ContactDetailTypeInput
                choices={emailTypes}
                defaultValue={DEFAULT_CONTACT_PHONE_TYPE}
              />
            </SimpleFormIterator>
          </ArrayInput>
          <ArrayInput
            source="contact_links_jsonb"
            label={false}
            helperText={false}
          >
            <SimpleFormIterator
              inline
              disableReordering
              disableClear
              className="[&>ul>li]:border-b-0 [&>ul>li]:pb-0"
            >
              <TextInput
                source="url"
                className="w-full"
                helperText={false}
                label={false}
                placeholder={translate("resources.contacts.fields.link_url", {
                  _: "URL",
                })}
                validate={isValidUrl}
              />
              <ContactDetailTypeInput
                choices={linkTypes}
                defaultValue={DEFAULT_LINK_TYPE}
              />
            </SimpleFormIterator>
          </ArrayInput>
        </div>
      ) : null}
    </div>
  );
};

const requiredForNewContact = (value: unknown) => {
  if (!value) {
    return "ra.validation.required";
  }
  return undefined;
};
