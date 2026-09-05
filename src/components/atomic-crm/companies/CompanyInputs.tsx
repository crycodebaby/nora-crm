import { required, useRecordContext, useTranslate } from "ra-core";
import { useEffect, useState } from "react";
import { useFormState, useWatch } from "react-hook-form";
import { Link } from "react-router-dom";
import { TextInput } from "@/components/admin/text-input";
import { SelectInput } from "@/components/admin/select-input";
import { RadioButtonGroupInput } from "@/components/admin/radio-button-group-input";
import { ArrayInput } from "@/components/admin/array-input";
import { SimpleFormIterator } from "@/components/admin/simple-form-iterator";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useIsMobile } from "@/hooks/use-mobile";

import ImageEditorField from "../misc/ImageEditorField";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Company } from "../types";
import { BusinessNumber } from "../misc/BusinessNumber";
import { getTranslatedCompanySizeLabel } from "./getTranslatedCompanySizeLabel";
import { sizes } from "./sizes";
import { SalesAssignmentInput } from "../sales/SalesAssignmentInput";
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
import { ContactDetailTypeInput } from "../misc/ContactDetailTypeInput";

/**
 * variant="create" (Customer Create Speed & Clarity Wave, 2026-09-01): die
 * Kundenanlage zeigt nur die im Büroalltag typischerweise benötigten Felder
 * direkt; selten benötigte Angaben (Links, Größe, Umsatz, Steuernummer) liegen
 * in einem standardmäßig eingeklappten Bereich „Weitere Angaben" — dasselbe
 * Muster wie in der Kontakterstellung (Decision Log 2026-08-28). Das Land ist
 * beim Anlegen kein sichtbares Feld (siehe buildCustomerCreatePayload).
 *
 * variant="default" (Edit) behält die bisherige Struktur — Bestandskunden
 * werden hier nicht umsortiert oder eingeklappt.
 */
export const CompanyInputs = ({
  variant = "default",
}: {
  variant?: "default" | "create";
}) => {
  const isMobile = useIsMobile();
  const record = useRecordContext<Company>();
  const isCreate = variant === "create";
  // Business-only fields (Branche, Größe, Umsatz, Steuernummer) sind für eine
  // Privatperson fachlich irrelevant — siehe AGENTS-Auftrag Abschnitt 8.
  const customerKind = useWatch({
    name: "customer_kind",
    defaultValue: record?.customer_kind ?? "business",
  });
  const isIndividual = customerKind === "individual";

  return (
    <div className="flex flex-col gap-5 p-1">
      <CompanyDisplayInputs />
      <div className={`flex gap-8 ${isMobile ? "flex-col" : "flex-row"}`}>
        <div className="flex flex-col gap-8 flex-1">
          <CompanyContactInputs showLinks={!isCreate} />
          {isIndividual ? null : <CompanyContextInputs compact={isCreate} />}
          {isCreate ? (
            <CompanyAdditionalDetailsDisclosure
              showBusinessFields={!isIndividual}
            />
          ) : null}
        </div>
        <Separator orientation={isMobile ? "horizontal" : "vertical"} />
        <div className="flex flex-col gap-8 flex-1">
          <CompanyAddressInputs showCountry={!isCreate} />
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

const CompanyContactInputs = ({
  showLinks = true,
}: {
  showLinks?: boolean;
}) => {
  const translate = useTranslate();
  const emailTypes = getContactMethodTypeChoices(translate);
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
          <ContactDetailTypeInput
            choices={emailTypes}
            defaultValue={DEFAULT_COMPANY_EMAIL_TYPE}
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
          <ContactDetailTypeInput
            choices={emailTypes}
            defaultValue={DEFAULT_COMPANY_PHONE_TYPE}
          />
        </SimpleFormIterator>
      </ArrayInput>
      {showLinks ? <CompanyLinksInput /> : null}
    </div>
  );
};

const CompanyLinksInput = () => {
  const translate = useTranslate();
  const linkTypes = getLinkTypeChoices(translate);
  return (
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
        <ContactDetailTypeInput
          choices={linkTypes}
          defaultValue={DEFAULT_LINK_TYPE}
        />
      </SimpleFormIterator>
    </ArrayInput>
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

const CompanyContextInputs = ({ compact = false }: { compact?: boolean }) => {
  const translate = useTranslate();
  const { companySectors } = useConfigurationContext();
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
      {compact ? null : <CompanyBusinessDetailInputs />}
    </div>
  );
};

/** Größe, Umsatz, Steuernummer — business-only, im Create-Flow unter „Weitere Angaben". */
const CompanyBusinessDetailInputs = () => {
  const translate = useTranslate();
  const translatedSizes = sizes.map((size) => ({
    ...size,
    name: getTranslatedCompanySizeLabel(size, translate),
  }));
  return (
    <>
      <SelectInput source="size" choices={translatedSizes} helperText={false} />
      <TextInput source="revenue" helperText={false} />
      <TextInput source="tax_identifier" helperText={false} />
    </>
  );
};

/**
 * Create-Flow: standardmäßig eingeklappte „Weitere Angaben". Ein
 * Validierungsfehler in einem eingeklappten Feld (z. B. ungültige Link-URL)
 * öffnet den Bereich nach dem Absenden automatisch — wie in ContactInputs.
 */
const CompanyAdditionalDetailsDisclosure = ({
  showBusinessFields,
}: {
  showBusinessFields: boolean;
}) => {
  const translate = useTranslate();
  const { errors, submitCount } = useFormState();
  const [value, setValue] = useState("");
  const hasErrors = Boolean(
    errors.links_jsonb ||
      errors.size ||
      errors.revenue ||
      errors.tax_identifier,
  );

  useEffect(() => {
    if (submitCount > 0 && hasErrors) {
      setValue("additional");
    }
  }, [hasErrors, submitCount]);

  return (
    <Accordion
      type="single"
      collapsible
      value={value}
      onValueChange={setValue}
      className="rounded-lg border"
      data-testid="company-additional-details"
    >
      <AccordionItem value="additional" className="border-b-0">
        <AccordionTrigger className="min-h-11 px-4 py-2 hover:no-underline">
          <span className="flex flex-col gap-0.5">
            <span className="text-base font-semibold tracking-tight text-foreground">
              {translate("resources.companies.create_form.additional", {
                _: "Additional details",
              })}
            </span>
            <span className="nora-muted">
              {translate("resources.companies.create_form.additional_help", {
                _: "Rarely needed — can also be added later.",
              })}
            </span>
          </span>
        </AccordionTrigger>
        <AccordionContent className="px-4 pb-4">
          <div className="nora-form-section border-t pt-4">
            <CompanyLinksInput />
            {showBusinessFields ? <CompanyBusinessDetailInputs /> : null}
          </div>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
};

const CompanyAddressInputs = ({
  showCountry = true,
}: {
  showCountry?: boolean;
}) => {
  const translate = useTranslate();
  return (
    <div className="nora-form-section">
      <h6>
        {translate("resources.companies.field_categories.address", {
          _: "Address",
        })}
      </h6>
      <TextInput source="address" helperText={false} />
      {/* Deutsche Lesereihenfolge: Straße → PLZ → Ort; PLZ und Ort in einer Zeile. */}
      <div className="flex gap-4">
        <TextInput
          source="zipcode"
          className="w-32 shrink-0"
          helperText={false}
        />
        <TextInput
          source="city"
          className="flex-1 min-w-0"
          helperText={false}
        />
      </div>
      <TextInput source="state_abbr" helperText={false} />
      {/* Customer Create Speed & Clarity Wave (2026-09-01): Beim Anlegen ist das
          Land kein sichtbares Feld — der kanonische Deutschland-Wert wird in
          buildCustomerCreatePayload gesetzt. Im Edit-Flow bleibt es sichtbar. */}
      {showCountry ? <TextInput source="country" helperText={false} /> : null}
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
      <SalesAssignmentInput emptyText="—" />
    </div>
  );
};
