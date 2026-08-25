import type { Meta } from "@storybook/react-vite";
import type { DataProvider } from "ra-core";

import { CompanyCreate } from "./CompanyCreate";
import { StoryWrapper, buildContact } from "@/test/StoryWrapper";
import type { Db } from "../providers/fakerest/dataGenerator/types";

const meta = {
  title: "Atomic CRM/Companies/Company Create",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

export const CompanyCreateBasic = ({
  dataProvider = {},
  data = {},
  silent,
}: {
  dataProvider?: Partial<DataProvider>;
  data?: Partial<Db>;
  silent?: boolean;
}) => (
  <StoryWrapper
    initialEntries={["/kunden/create"]}
    data={data}
    dataProvider={dataProvider}
    silent={silent}
  >
    <CompanyCreate />
  </StoryWrapper>
);

export const CompanyCreateWithExistingContact = (props: {
  dataProvider?: Partial<DataProvider>;
  silent?: boolean;
}) => (
  <CompanyCreateBasic
    {...props}
    data={{
      contacts: [
        buildContact({ id: 9, first_name: "Frank", last_name: "Keller" }),
      ] as any,
    }}
  />
);
