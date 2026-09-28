import { useQueryClient } from "@tanstack/react-query";
import {
  Form,
  useDataProvider,
  useGetIdentity,
  useListContext,
  useRedirect,
  useTranslate,
  type GetListResult,
} from "ra-core";
import { Create } from "@/components/admin/create";
import { SaveButton } from "@/components/admin/form";
import { FormToolbar } from "@/components/admin/simple-form";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

import { noraCreatePath } from "../routing/noraRoutes";
import type { Deal } from "../types";
import { DealInputs } from "./DealInputs";

export const DealCreate = ({ open }: { open: boolean }) => {
  const redirect = useRedirect();
  const translate = useTranslate();
  const dataProvider = useDataProvider();
  const { data: allDeals } = useListContext<Deal>();

  const handleClose = () => {
    redirect(noraCreatePath({ resource: "deals", type: "list" }));
  };

  const queryClient = useQueryClient();

  const onSuccess = async (deal: Deal) => {
    if (!allDeals) {
      redirect(noraCreatePath({ resource: "deals", type: "list" }));
      return;
    }
    // increase the index of all deals in the same stage as the new deal
    // first, get the list of deals in the same stage
    const deals = allDeals.filter(
      (d: Deal) => d.stage === deal.stage && d.id !== deal.id,
    );
    // update the actual deals in the database
    await Promise.all(
      deals.map(async (oldDeal) =>
        dataProvider.update("deals", {
          id: oldDeal.id,
          data: { index: oldDeal.index + 1 },
          previousData: oldDeal,
        }),
      ),
    );
    // refresh the list of deals in the cache as we used dataProvider.update(),
    // which does not update the cache
    const dealsById = deals.reduce(
      (acc, d) => ({
        ...acc,
        [d.id]: { ...d, index: d.index + 1 },
      }),
      {} as { [key: string]: Deal },
    );
    const now = Date.now();
    queryClient.setQueriesData<GetListResult | undefined>(
      { queryKey: ["deals", "getList"] },
      (res) => {
        if (!res) return res;
        return {
          ...res,
          data: res.data.map((d: Deal) => dealsById[d.id] || d),
        };
      },
      { updatedAt: now },
    );
    redirect(noraCreatePath({ resource: "deals", type: "list" }));
  };

  const { identity } = useGetIdentity();

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      <DialogContent className="nora-deal-form-dialog sm:max-w-3xl overflow-y-auto max-h-9/10 top-1/20 translate-y-0 p-0">
        <DialogTitle className="sr-only">Neuen Vorgang anlegen</DialogTitle>
        <Create
          resource="deals"
          mutationOptions={{ onSuccess }}
          title={false}
          disableBreadcrumb
        >
          <Form
            defaultValues={{
              sales_id: identity?.id,
              contact_ids: [],
              index: 0,
            }}
            className="flex flex-col"
          >
            <header className="nora-deal-form-head">
              <p className="nora-t-eyebrow">
                {translate("resources.deals.forcedCaseName")}
              </p>
              <h2 className="nora-t-title">
                {translate("resources.deals.action.create")}
              </h2>
            </header>
            <div className="nora-deal-form-body">
              <DealInputs />
            </div>
            <FormToolbar className="nora-deal-form-toolbar">
              <SaveButton />
            </FormToolbar>
          </Form>
        </Create>
      </DialogContent>
    </Dialog>
  );
};
