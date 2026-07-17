import { useGetList } from "ra-core";

import type { Contact, ContactNote } from "../types";

import { DashboardActivityLog } from "./DashboardActivityLog";

import { DashboardStepper } from "./DashboardStepper";

import { DealsChart } from "./DealsChart";

import { Hotboard } from "./Hotboard";

import { HotContacts } from "./HotContacts";

import { Welcome } from "./Welcome";

export const Dashboard = () => {
  const {
    data: dataContact,

    total: totalContact,

    isPending: isPendingContact,
  } = useGetList<Contact>("contacts", {
    pagination: { page: 1, perPage: 1 },
  });

  const { total: totalContactNotes, isPending: isPendingContactNotes } =
    useGetList<ContactNote>("contact_notes", {
      pagination: { page: 1, perPage: 1 },
    });

  const { total: totalDeal, isPending: isPendingDeal } = useGetList<Contact>(
    "deals",

    {
      pagination: { page: 1, perPage: 1 },
    },
  );

  const isPending = isPendingContact || isPendingContactNotes || isPendingDeal;

  if (isPending) {
    return null;
  }

  if (!totalContact) {
    return <DashboardStepper step={1} />;
  }

  if (!totalContactNotes) {
    return <DashboardStepper step={2} contactId={dataContact?.[0]?.id} />;
  }

  return (
    <div className="flex flex-col gap-8 mt-1">
      <Hotboard />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 flex flex-col gap-6">
          {totalDeal ? <DealsChart /> : null}

          <DashboardActivityLog />
        </div>

        <div className="lg:col-span-4 flex flex-col gap-4">
          {import.meta.env.VITE_IS_DEMO === "true" ? <Welcome /> : null}

          <HotContacts />
        </div>
      </div>
    </div>
  );
};
