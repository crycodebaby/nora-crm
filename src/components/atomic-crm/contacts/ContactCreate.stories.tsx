import type { Meta } from "@storybook/react-vite";

import { ContactCreate } from "./ContactCreate";
import { ContactCreateSheet } from "./ContactCreateSheet";
import { buildCompany, buildContact, StoryWrapper } from "@/test/StoryWrapper";
import type { DataProvider } from "ra-core";

const meta = {
  title: "Atomic CRM/Contacts/Contact Create",
  parameters: {
    layout: "fullscreen",
  },
  globals: {
    viewport: { value: "responsive", isRotated: false },
  },
} satisfies Meta;

export default meta;

const contactCreateCompanies = [
  buildCompany({ id: 10, name: "Familie Krüger" }),
  buildCompany({
    id: 11,
    name: "Rheinbogen Immobilienservice GmbH",
    customer_number: "K-0042",
  }),
];

export const ContactCreateBasic = ({
  dataProvider = {},
  silent,
}: {
  dataProvider?: Partial<DataProvider>;
  silent?: boolean;
}) => (
  <StoryWrapper
    initialEntries={["/contacts/create"]}
    data={{
      companies: contactCreateCompanies,
      contacts: [
        buildContact({
          id: 1,
          email_jsonb: [],
          phone_jsonb: [],
        }),
      ] as any,
    }}
    dataProvider={dataProvider}
    silent={silent}
  >
    <ContactCreate />
  </StoryWrapper>
);

export const ContactCreateBasicWithError = () => (
  <StoryWrapper
    initialEntries={["/contacts/create"]}
    data={{
      contacts: [
        buildContact({
          id: 1,
          email_jsonb: [],
          phone_jsonb: [],
        }),
      ] as any,
    }}
    dataProvider={{
      create: async (resource, params) => {
        if (resource === "contacts") {
          throw new Error("Failed to create contact");
        }
        return { data: params.data as any };
      },
    }}
  >
    <ContactCreate />
  </StoryWrapper>
);

export const ContactCreateMobile = Object.assign(
  () => (
    <StoryWrapper
      initialEntries={["/"]}
      data={{ companies: contactCreateCompanies }}
      silent
    >
      <ContactCreateSheet open onOpenChange={() => undefined} />
    </StoryWrapper>
  ),
  {
    parameters: {
      viewport: { defaultViewport: "mobile1" },
    },
  },
);

export const ContactCreateTablet = Object.assign(() => <ContactCreateBasic />, {
  parameters: {
    viewport: { defaultViewport: "ipad" },
  },
});
