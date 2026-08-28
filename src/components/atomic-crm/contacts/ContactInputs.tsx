import {
  email,
  required,
  useSimpleFormIterator,
  useRecordContext,
  useTranslate,
  useUpdate,
  useNotify,
} from "ra-core";
import type { ClipboardEventHandler, FocusEvent, ReactNode } from "react";
import { useEffect, useState } from "react";
import { useFormContext, useFormState, useWatch } from "react-hook-form";
import type { LucideIcon } from "lucide-react";
import { Building2, Ellipsis, Mail, Plus, UserRound } from "lucide-react";
import { Separator } from "@/components/ui/separator";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { useIsMobile } from "@/hooks/use-mobile";
import { BooleanInput } from "@/components/admin/boolean-input";
import { ReferenceInput } from "@/components/admin/reference-input";
import { TextInput } from "@/components/admin/text-input";
import { RadioButtonGroupInput } from "@/components/admin/radio-button-group-input";
import { SelectInput } from "@/components/admin/select-input";
import { ArrayInput } from "@/components/admin/array-input";
import { SimpleFormIterator } from "@/components/admin/simple-form-iterator";

import { ContactDetailTypeInput } from "../misc/ContactDetailTypeInput";
import { getContactMethodTypeChoices } from "../misc/contactMethodTypes";
import {
  getLinkTypeChoices,
  isValidUrl,
  DEFAULT_LINK_TYPE,
} from "../misc/linksModel";
import { StatusSelector } from "../notes";
import type { Sale, Contact } from "../types";
import { Avatar } from "./Avatar";
import { AutocompleteCompanyInput } from "../companies/AutocompleteCompanyInput.tsx";
import { SALES_DIRECTORY_REFERENCE_PROPS } from "../sales/salesDirectoryReference";
import { contactGender, translateContactGenderLabel } from "./contactModel.ts";

export const ContactInputs = ({
  variant = "default",
}: {
  variant?: "default" | "create";
}) =>
  variant === "create" ? <ContactCreateInputs /> : <ContactDefaultInputs />;

const ContactCreateInputs = () => {
  const { errors, submitCount } = useFormState();
  const [additionalValue, setAdditionalValue] = useState("");
  const hasAdditionalErrors = Boolean(
    errors.links_jsonb ||
      errors.background ||
      errors.has_newsletter ||
      errors.sales_id,
  );

  useEffect(() => {
    if (submitCount > 0 && hasAdditionalErrors) {
      setAdditionalValue("additional");
    }
  }, [hasAdditionalErrors, submitCount]);

  return (
    <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-2 xl:gap-5">
      <div className="flex min-w-0 flex-col gap-4 xl:gap-5">
        <CreateFormSection
          icon={UserRound}
          title="resources.contacts.create_form.person"
          description="resources.contacts.create_form.person_help"
        >
          <ContactIdentityInputs showHeading={false} />
        </CreateFormSection>
        <CreateFormSection
          icon={Building2}
          title="resources.contacts.create_form.customer"
          description="resources.contacts.create_form.customer_help"
        >
          <ContactPositionInputs />
        </CreateFormSection>
      </div>

      <div className="flex min-w-0 flex-col gap-4 xl:gap-5">
        <CreateFormSection
          icon={Mail}
          title="resources.contacts.create_form.contact_methods"
          description="resources.contacts.create_form.contact_methods_help"
        >
          <ContactPersonalInformationInputs
            showHeading={false}
            showLinks={false}
            descriptiveAddButtons
          />
        </CreateFormSection>

        <Accordion
          type="single"
          collapsible
          value={additionalValue}
          onValueChange={setAdditionalValue}
          className="rounded-xl border bg-card shadow-sm"
        >
          <AccordionItem value="additional" className="border-b-0">
            <AccordionTrigger className="min-h-16 px-4 py-3 hover:no-underline sm:px-5">
              <SectionHeading
                icon={Ellipsis}
                title="resources.contacts.create_form.additional"
                description="resources.contacts.create_form.additional_help"
              />
            </AccordionTrigger>
            <AccordionContent className="px-4 pb-5 sm:px-5">
              <div className="nora-form-section border-t pt-5">
                <ContactLinksInputs descriptiveAddButton />
                <ContactMiscInputs showHeading={false} />
              </div>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </div>
    </div>
  );
};

const ContactDefaultInputs = () => {
  const isMobile = useIsMobile();

  return (
    <div className="flex flex-col gap-3 p-1 relative md:static">
      <div className="absolute top-0 right-1 md:static">
        <Avatar />
      </div>
      <div className="flex gap-8 md:gap-10 flex-col md:flex-row">
        <div className="flex flex-col gap-8 flex-1">
          <ContactIdentityInputs />
          <ContactPositionInputs />
        </div>
        {isMobile ? null : (
          <Separator orientation="vertical" className="flex-shrink-0" />
        )}
        <div className="flex flex-col gap-8 flex-1">
          <ContactPersonalInformationInputs />
          <ContactMiscInputs />
        </div>
      </div>
    </div>
  );
};

const CreateFormSection = ({
  icon,
  title,
  description,
  children,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  children: ReactNode;
}) => (
  <section className="rounded-xl border bg-card p-4 shadow-sm transition-shadow duration-200 sm:p-5 motion-reduce:transition-none">
    <SectionHeading icon={icon} title={title} description={description} />
    <div className="mt-5">{children}</div>
  </section>
);

const SectionHeading = ({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
}) => {
  const translate = useTranslate();

  return (
    <div className="flex min-w-0 items-start gap-3 text-left">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-[color-mix(in_oklab,var(--nora-brand)_12%,transparent)] text-[var(--nora-brand)] dark:bg-[color-mix(in_oklab,var(--nora-brand)_18%,transparent)]">
        <Icon className="size-[18px]" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-base font-semibold leading-5 text-foreground">
          {translate(title)}
        </span>
        <span className="mt-1 block text-sm font-normal leading-5 text-muted-foreground">
          {translate(description)}
        </span>
      </span>
    </div>
  );
};

const ContactIdentityInputs = ({ showHeading = true }) => {
  const translate = useTranslate();
  return (
    <div className="nora-form-section">
      {showHeading ? (
        <h6>{translate("resources.contacts.field_categories.identity")}</h6>
      ) : null}
      <RadioButtonGroupInput
        label={false}
        row
        source="gender"
        choices={contactGender}
        helperText={false}
        optionText={(choice) => translateContactGenderLabel(choice, translate)}
        translateChoice={false}
        optionValue="value"
        defaultValue={contactGender[0].value}
      />
      <TextInput source="first_name" validate={required()} helperText={false} />
      <TextInput source="last_name" validate={required()} helperText={false} />
    </div>
  );
};

const ContactPositionInputs = () => {
  const companyId = useWatch({ name: "company_id" });
  return (
    // Keine Sektionsüberschrift hier: "Position" wäre nur eine Wiederholung
    // des title-Feld-Labels selbst (Root Cause der doppelten "Position"-
    // Anzeige auf /kontakte/create) — das Feld behält sein reguläres Label
    // aus Accessibility-Gründen (echter Accessible Name statt nur einer
    // visuell benachbarten Überschrift).
    <div className="nora-form-section">
      <TextInput source="title" helperText={false} />
      <ReferenceInput source="company_id" reference="companies" perPage={10}>
        <AutocompleteCompanyInput label="resources.contacts.fields.company_id" />
      </ReferenceInput>
      {companyId !== undefined && companyId !== null && companyId !== "" ? (
        <BooleanInput
          source="is_primary"
          helperText="resources.contacts.helper.is_primary"
        />
      ) : null}
    </div>
  );
};

const ContactPersonalInformationInputs = ({
  showHeading = true,
  showLinks = true,
  descriptiveAddButtons = false,
}: {
  showHeading?: boolean;
  showLinks?: boolean;
  descriptiveAddButtons?: boolean;
}) => {
  const translate = useTranslate();
  const { getValues, setValue } = useFormContext();
  const personalInfoTypes = getContactMethodTypeChoices(translate);

  // set first and last name based on email
  const handleEmailChange = (email: string) => {
    const { first_name, last_name } = getValues();
    if (first_name || last_name || !email) return;
    const [first, last] = email.split("@")[0].split(".");
    setValue("first_name", first.charAt(0).toUpperCase() + first.slice(1));
    setValue(
      "last_name",
      last ? last.charAt(0).toUpperCase() + last.slice(1) : "",
    );
  };

  const handleEmailPaste: ClipboardEventHandler<
    HTMLTextAreaElement | HTMLInputElement
  > = (e) => {
    const email = e.clipboardData?.getData("text/plain");
    handleEmailChange(email);
  };

  const handleEmailBlur = (
    e: FocusEvent<HTMLTextAreaElement | HTMLInputElement>,
  ) => {
    const email = e.target.value;
    handleEmailChange(email);
  };

  return (
    <div className="nora-form-section">
      {showHeading ? (
        <h6>
          {translate("resources.contacts.field_categories.personal_info")}
        </h6>
      ) : null}
      <ArrayInput source="email_jsonb" helperText={false}>
        <SimpleFormIterator
          inline
          disableReordering
          disableClear
          addButton={
            descriptiveAddButtons ? (
              <ContactMethodAddButton label="resources.contacts.create_form.add_email" />
            ) : undefined
          }
          className="[&>ul>li]:border-b-0 [&>ul>li]:pb-0 [&>ul>li]:min-w-0 [&>ul>li>.simple-form-iterator-item-actions]:pt-0"
        >
          <TextInput
            source="email"
            className="w-full"
            helperText={false}
            label={false}
            placeholder={translate("resources.contacts.fields.email")}
            validate={email()}
            onPaste={handleEmailPaste}
            onBlur={handleEmailBlur}
          />
          <ContactDetailTypeInput
            choices={personalInfoTypes}
            defaultValue="Work"
          />
        </SimpleFormIterator>
      </ArrayInput>
      <ArrayInput source="phone_jsonb" helperText={false}>
        <SimpleFormIterator
          inline
          disableReordering
          disableClear
          addButton={
            descriptiveAddButtons ? (
              <ContactMethodAddButton label="resources.contacts.create_form.add_phone" />
            ) : undefined
          }
          className="[&>ul>li]:border-b-0 [&>ul>li]:pb-0 [&>ul>li]:min-w-0 [&>ul>li>.simple-form-iterator-item-actions]:pt-0"
        >
          <TextInput
            source="number"
            className="w-full"
            helperText={false}
            label={false}
            placeholder={translate("resources.contacts.fields.phone_number")}
          />
          <ContactDetailTypeInput
            choices={personalInfoTypes}
            defaultValue="Mobile"
          />
        </SimpleFormIterator>
      </ArrayInput>
      {showLinks ? <ContactLinksInputs /> : null}
    </div>
  );
};

const ContactLinksInputs = ({
  descriptiveAddButton = false,
}: {
  descriptiveAddButton?: boolean;
}) => {
  const translate = useTranslate();
  const linkTypes = getLinkTypeChoices(translate);

  return (
    <ArrayInput source="links_jsonb" helperText={false}>
      <SimpleFormIterator
        inline
        disableReordering
        disableClear
        addButton={
          descriptiveAddButton ? (
            <ContactMethodAddButton label="resources.contacts.create_form.add_link" />
          ) : undefined
        }
        className="[&>ul>li]:border-b-0 [&>ul>li]:pb-0 [&>ul>li]:min-w-0 [&>ul>li>.simple-form-iterator-item-actions]:pt-0"
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
  );
};

const ContactMethodAddButton = ({ label }: { label: string }) => {
  const { add } = useSimpleFormIterator();
  const translate = useTranslate();

  return (
    <Button
      type="button"
      variant="ghost"
      className="min-h-11 justify-start px-2 text-muted-foreground hover:text-foreground"
      onClick={() => add()}
    >
      <Plus className="size-4" aria-hidden="true" />
      {translate(label)}
    </Button>
  );
};

const ContactMiscInputs = ({ showHeading = true }) => {
  const translate = useTranslate();
  return (
    <div className="nora-form-section">
      {showHeading ? (
        <h6>{translate("resources.contacts.field_categories.misc")}</h6>
      ) : null}
      <TextInput source="background" multiline helperText={false} />
      <BooleanInput source="has_newsletter" helperText={false} />
      <ReferenceInput source="sales_id" {...SALES_DIRECTORY_REFERENCE_PROPS}>
        <SelectInput
          helperText={false}
          optionText={saleOptionRenderer}
          validate={required()}
        />
      </ReferenceInput>
    </div>
  );
};

const saleOptionRenderer = (choice: Sale) =>
  `${choice.first_name} ${choice.last_name}`;

export const ContactStatusSelector = () => {
  const record = useRecordContext<Contact>();
  const [update] = useUpdate<Contact>();
  const notify = useNotify();
  if (!record) return null;

  const handleStatusChange = (nextStatus: string) => {
    if (nextStatus === record?.status) return;

    update(
      "contacts",
      {
        id: record.id,
        data: { status: nextStatus },
        previousData: record,
      },
      {
        mutationMode: "optimistic",
        onError: (error) => {
          notify(
            typeof error === "string"
              ? error
              : error?.message || "ra.notification.http_error",
            {
              type: "error",
              messageArgs: {
                _: typeof error === "string" ? error : error?.message,
              },
            },
          );
        },
      },
    );
  };

  return (
    <div className="[&_button]:w-auto">
      <StatusSelector
        status={record?.status}
        setStatus={handleStatusChange}
        triggerClassName="w-full"
      />
    </div>
  );
};
