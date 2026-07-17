import { EditBase, Form } from "ra-core";
import { Card, CardContent } from "@/components/ui/card";

import { CompanyInputs } from "./CompanyInputs";
import { CompanyAside } from "./CompanyAside";
import { FormToolbar } from "../layout/FormToolbar";
import { NoraAccessGuard } from "../misc/NoraEditGuard";

export const CompanyEdit = () => (
  <EditBase
    actions={false}
    redirect="show"
    transform={(values) => {
      if (values.website && !values.website.startsWith("http")) {
        values.website = `https://${values.website}`;
      }
      return values;
    }}
  >
    <NoraAccessGuard resource="companies" action="edit">
      <div className="mt-2 flex gap-8">
        <Form className="flex flex-1 flex-col gap-4 pb-2">
          <Card>
            <CardContent>
              <CompanyInputs />
              <FormToolbar />
            </CardContent>
          </Card>
        </Form>

        <CompanyAside link="show" />
      </div>
    </NoraAccessGuard>
  </EditBase>
);
