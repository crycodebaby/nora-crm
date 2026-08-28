import {
  CreateBase,
  Form,
  useGetIdentity,
  useTranslate,
  type MutationMode,
} from "ra-core";

import { ContactInputs } from "./ContactInputs";
import { FormToolbar } from "../layout/FormToolbar";
import { NoraAccessGuard } from "../misc/NoraEditGuard";
import {
  cleanupContactForCreate,
  defaultEmailJsonb,
  defaultPhoneJsonb,
} from "./contactModel";

export const ContactCreate = ({
  mutationMode,
}: {
  mutationMode?: MutationMode;
}) => {
  const { identity } = useGetIdentity();
  const translate = useTranslate();

  return (
    <CreateBase
      redirect="show"
      transform={cleanupContactForCreate}
      mutationMode={mutationMode}
    >
      <NoraAccessGuard
        resource="contacts"
        action="create"
        redirectTarget="list"
      >
        <div className="mx-auto w-full max-w-6xl px-3 pb-6 pt-3 sm:px-5 sm:pt-5 lg:px-6">
          <header className="mb-5 max-w-2xl sm:mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {translate("resources.contacts.action.new")}
            </h1>
            <p className="mt-1.5 text-sm leading-6 text-muted-foreground sm:text-base">
              {translate("resources.contacts.create_form.intro")}
            </p>
          </header>

          <Form
            defaultValues={{
              sales_id: identity?.id,
              email_jsonb: defaultEmailJsonb,
              phone_jsonb: defaultPhoneJsonb,
            }}
          >
            <ContactInputs variant="create" />
            <FormToolbar
              saveLabel="resources.contacts.action.create"
              className="z-10 -mx-3 mt-5 border-t bg-background/95 px-3 backdrop-blur-sm supports-[backdrop-filter]:bg-background/85 sm:mx-0 sm:rounded-xl sm:border sm:px-4 sm:shadow-sm [&>button]:min-h-11 [&>button:last-child]:min-w-40"
              saveClassName="nora-primary-action transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100"
            />
          </Form>
        </div>
      </NoraAccessGuard>
    </CreateBase>
  );
};
