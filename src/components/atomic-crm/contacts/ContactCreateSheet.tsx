import { useGetIdentity, useTranslate } from "ra-core";
import { CreateSheet } from "../misc/CreateSheet";
import { ContactInputs } from "./ContactInputs";
import {
  cleanupContactForCreate,
  defaultEmailJsonb,
  defaultPhoneJsonb,
} from "./contactModel";

export interface ContactCreateSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export const ContactCreateSheet = ({
  open,
  onOpenChange,
}: ContactCreateSheetProps) => {
  const { identity } = useGetIdentity();
  const translate = useTranslate();
  return (
    <CreateSheet
      resource="contacts"
      title={translate("resources.contacts.action.new")}
      saveLabel="resources.contacts.action.create"
      contentClassName="gap-0 bg-muted [&>[data-slot=sheet-header]]:bg-background"
      bodyClassName="mx-auto w-full max-w-6xl gap-4 p-3 sm:p-5"
      saveButtonClassName="nora-primary-action min-h-12 transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
      defaultValues={{
        sales_id: identity?.id,
        email_jsonb: defaultEmailJsonb,
        phone_jsonb: defaultPhoneJsonb,
      }}
      transform={cleanupContactForCreate}
      open={open}
      onOpenChange={onOpenChange}
    >
      <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
        {translate("resources.contacts.create_form.intro")}
      </p>
      <ContactInputs variant="create" />
    </CreateSheet>
  );
};
