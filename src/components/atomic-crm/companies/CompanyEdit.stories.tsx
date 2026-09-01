import type { Meta } from "@storybook/react-vite";
import type { DataProvider } from "ra-core";
import { Route, Routes } from "react-router";

import { CompanyEdit } from "./CompanyEdit";
import { buildCompany, StoryWrapper } from "@/test/StoryWrapper";
import type { Company } from "../types";

const meta = {
  title: "Atomic CRM/Companies/Company Edit",
  parameters: {
    layout: "fullscreen",
  },
} satisfies Meta;

export default meta;

export const CompanyEditBasic = ({
  dataProvider = {},
  company = {},
  silent,
}: {
  dataProvider?: Partial<DataProvider>;
  company?: Partial<Company>;
  silent?: boolean;
}) => (
  <StoryWrapper
    initialEntries={["/kunden/1"]}
    data={{
      companies: [buildCompany({ id: 1, ...company })] as any,
    }}
    dataProvider={dataProvider}
    silent={silent}
  >
    <Routes>
      <Route path="/kunden/:id" element={<CompanyEdit />} />
    </Routes>
  </StoryWrapper>
);
