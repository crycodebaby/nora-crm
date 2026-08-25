import { EditBase, Form } from "ra-core";
import { Card, CardContent } from "@/components/ui/card";

import { CompanyInputs } from "./CompanyInputs";
import { CompanyAside } from "./CompanyAside";
import { FormToolbar } from "../layout/FormToolbar";
import { NoraAccessGuard } from "../misc/NoraEditGuard";
import { cleanLinksJsonb } from "../misc/linksModel";

export const CompanyEdit = () => (
  <EditBase
    actions={false}
    redirect="show"
    transform={(values) => ({
      ...values,
      links_jsonb: cleanLinksJsonb(values.links_jsonb),
      email_jsonb: (values.email_jsonb ?? []).filter((e: any) => e?.email),
      phone_jsonb: (values.phone_jsonb ?? []).filter((p: any) => p?.number),
    })}
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
