import { required, useRecordContext, useTranslate } from "ra-core";
import { useWatch } from "react-hook-form";
import { Link } from "react-router-dom";
import { ReferenceInput } from "@/components/admin/reference-input";
import { TextInput } from "@/components/admin/text-input";
import { SelectInput } from "@/components/admin/select-input";
import { RadioButtonGroupInput } from "@/components/admin/radio-button-group-input";
import { ArrayInput } from "@/components/admin/array-input";
import { SimpleFormIterator } from "@/components/admin/simple-form-iterator";
import { Separator } from "@/components/ui/separator";
import { useIsMobile } from "@/hooks/use-mobile";

import ImageEditorField from "../misc/ImageEditorField";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Company, Sale } from "../types";
import { BusinessNumber } from "../misc/BusinessNumber";
import { getTranslatedCompanySizeLabel } from "./getTranslatedCompanySizeLabel";
import { sizes } from "./sizes";
import { SALES_DIRECTORY_REFERENCE_PROPS } from "../sales/salesDirectoryReference";
import {
  getContactMethodTypeChoices,
  DEFAULT_COMPANY_PHONE_TYPE,
  DEFAULT_COMPANY_EMAIL_TYPE,
} from "../misc/contactMethodTypes";
import {
  getLinkTypeChoices,
  isValidUrl,
  DEFAULT_LINK_TYPE,
} from "../misc/linksModel";
import { customerKindChoices } from "./customerKind";
import { noraCreatePath } from "../routing/noraRoutes";

export const CompanyInputs = () => {
  const isMobile = useIsMobile();
  const record = useRecordContext<Company>();
  // Business-only fields (Branche, Größe, Umsatz, Steuernummer) sind für eine
  // Privatperson fachlich irrelevant — siehe AGENTS-Auftrag Abschnitt 8.
  const customerKind = useWatch({
    name: "customer_kind",
    defaultValue: record?.customer_kind ?? "business",
  });

  return (
    <div className="flex flex-col gap-5 p-1">
      <CompanyDisplayInputs />
      <div className={`flex gap-8 ${isMobile ? "flex-col" : "flex-row"}`}>
        <div className="flex flex-col gap-8 flex-1">
          <CompanyContactInputs />
          {customerKind === "individual" ? null : <CompanyContextInputs />}
        </div>
        <Separator orientation={isMobile ? "horizontal" : "vertical"} />
        <div className="flex flex-col gap-8 flex-1">
          <CompanyAddressInputs />
          <CompanyAdditionalInformationInputs />
        </div>
      </div>
    </div>
  );
};

const CompanyDisplayInputs = () => {
  const translate = useTranslate();
  const record = useRecordContext<Company>();
  const customerKind = useWatch({
    name: "customer_kind",
    defaultValue: record?.customer_kind ?? "business",
  });
  // Beim Neuanlegen einer Privatperson wird der Kundenname aus Vor-/Nachname
  // abgeleitet (siehe CustomerCreateForm) — kein doppeltes Pflichtfeld.
  const nameIsDerived = !record && customerKind === "individual";
  // Self Contact Wave (2026-08-26): beim Bearbeiten einer Privatkundenakte
  // mit self_contact_id bleibt contacts die kanonische Personenquelle —
  // companies.name ist eine serverseitig synchronisierte Ableitung (siehe
  // nora_private.sync_individual_company_name()) und wird hier NICHT als
  // frei editierbares zweites Namensfeld angeboten. Ohne self_contact_id
  // (z. B. sehr alte Bestandsdaten) fällt es weich auf editierbar zurück.
  const nameIsReadOnlyIndividual =
    !!record && customerKind === "individual" && record.self_contact_id != null;
  return (
    <div className="flex flex-col gap-2 flex-1">
      {nameIsDerived ? null : nameIsReadOnlyIndividual ? (
        <div className="flex gap-4 flex-1 flex-row items-center">
          <ImageEditorField
            source="logo"
            type="avatar"
            width={60}
            height={60}
            emptyText={record?.name.charAt(0)}
            linkPosition="bottom"
          />
          <div className="flex flex-col gap-1">
            <p className="text-lg font-semibold">{record.name}</p>
            <Link
              to={noraCreatePath({
                resource: "contacts",
                type: "edit",
                id: record.self_contact_id ?? undefined,
              })}
              className="text-sm text-primary hover:underline w-fit"
            >
              {translate("resources.companies.fields.name_from_contact_hint", {
                _: "Im Ansprechpartner-Datensatz bearbeiten",
              })}
            </Link>
          </div>
        </div>
      ) : (
        <div className="flex gap-4 flex-1 flex-row">
          <ImageEditorField
            source="logo"
            type="avatar"
            width={60}
            height={60}
            emptyText={record?.name.charAt(0)}
            linkPosition="bottom"
          />
          <TextInput
            source="name"
            className="w-full h-fit"
            validate={required()}
            helperText={false}
            placeholder={translate("resources.companies.fields.name", {
              _: "Company name",
            })}
          />
        </div>
      )}
      {record?.customer_number ? (
        <p className="text-sm text-muted-foreground">
          {translate("resources.companies.fields.customer_number")}:{" "}
          <BusinessNumber value={record.customer_number} />
        </p>
      ) : null}
      <RadioButtonGroupInput
        source="customer_kind"
        label="resources.companies.fields.customer_kind"
        row
        choices={customerKindChoices}
        optionText={(choice) =>
          translate(choice.label, { _: choice.defaultLabel })
        }
        translateChoice={false}
        optionValue="value"
        helperText={false}
        defaultValue="business"
      />
    </div>
  );
};

const CompanyContactInputs = () => {
  const translate = useTranslate();
  const emailTypes = getContactMethodTypeChoices(translate);
  const linkTypes = getLinkTypeChoices(translate);
  return (
    <div className="nora-form-section">
      <h6>
        {translate("resources.companies.field_categories.contact", {
          _: "Company info",
        })}
      </h6>
      <ArrayInput source="email_jsonb" helperText={false}>
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
            placeholder={translate("resources.companies.fields.email", {
              _: "E-Mail",
            })}
            validate={isEmailField}
          />
          <SelectInput
            source="type"
            helperText={false}
            label={false}
            optionText="name"
            choices={emailTypes}
            defaultValue={DEFAULT_COMPANY_EMAIL_TYPE}
            className="w-28 min-w-28"
          />
        </SimpleFormIterator>
      </ArrayInput>
      <ArrayInput source="phone_jsonb" helperText={false}>
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
            placeholder={translate("resources.companies.fields.phone_number")}
          />
          <SelectInput
            source="type"
            helperText={false}
            label={false}
            optionText="name"
            choices={emailTypes}
            defaultValue={DEFAULT_COMPANY_PHONE_TYPE}
            className="w-28 min-w-28"
          />
        </SimpleFormIterator>
      </ArrayInput>
      <ArrayInput source="links_jsonb" helperText={false}>
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
            placeholder={translate("resources.companies.fields.link_url", {
              _: "URL",
            })}
            validate={isValidUrl}
          />
          <SelectInput
            source="type"
            helperText={false}
            label={false}
            optionText="name"
            choices={linkTypes}
            defaultValue={DEFAULT_LINK_TYPE}
            className="w-28 min-w-28"
          />
        </SimpleFormIterator>
      </ArrayInput>
    </div>
  );
};

const isEmailField = (value: string) => {
  if (!value) return undefined;
  const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!EMAIL_REGEX.test(value)) {
    return {
      message: "crm.validation.invalid_email",
      args: { _: "Must be a valid email" },
    };
  }
};

const CompanyContextInputs = () => {
  const translate = useTranslate();
  const { companySectors } = useConfigurationContext();
  const translatedSizes = sizes.map((size) => ({
    ...size,
    name: getTranslatedCompanySizeLabel(size, translate),
  }));
  return (
    <div className="nora-form-section">
      <h6>
        {translate("resources.companies.field_categories.context", {
          _: "Context",
        })}
      </h6>
      <SelectInput
        source="sector"
        choices={companySectors}
        optionText="label"
        optionValue="value"
        helperText={false}
      />
      <SelectInput source="size" choices={translatedSizes} helperText={false} />
      <TextInput source="revenue" helperText={false} />
      <TextInput source="tax_identifier" helperText={false} />
    </div>
  );
};

const CompanyAddressInputs = () => {
  const translate = useTranslate();
  return (
    <div className="nora-form-section">
      <h6>
        {translate("resources.companies.field_categories.address", {
          _: "Address",
        })}
      </h6>
      <TextInput source="address" helperText={false} />
      <TextInput source="city" helperText={false} />
      <TextInput source="zipcode" helperText={false} />
      <TextInput source="state_abbr" helperText={false} />
      <TextInput source="country" helperText={false} />
    </div>
  );
};

const CompanyAdditionalInformationInputs = () => {
  const translate = useTranslate();
  return (
    <div className="nora-form-section">
      <h6>
        {translate("resources.companies.field_categories.additional_info", {
          _: "Additional information",
        })}
      </h6>
      <TextInput source="description" multiline helperText={false} />
      <ReferenceInput source="sales_id" {...SALES_DIRECTORY_REFERENCE_PROPS}>
        <SelectInput
          helperText={false}
          optionText={saleOptionRenderer}
          emptyText="—"
        />
      </ReferenceInput>
    </div>
  );
};

const saleOptionRenderer = (choice: Sale) =>
  `${choice.first_name} ${choice.last_name}`;
