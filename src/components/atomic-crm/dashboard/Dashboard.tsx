import { useGetList } from "ra-core";

import type { Contact, ContactNote } from "../types";

import { DashboardActivityLog } from "./DashboardActivityLog";

import { DashboardStepper } from "./DashboardStepper";

import { DealsChart } from "./DealsChart";

import { NoraPageLoading } from "../misc/NoraPageLoading";
import { NoraQueryError } from "../misc/NoraQueryError";

import { Hotboard } from "./Hotboard";

import { HotContacts } from "./HotContacts";

import { Welcome } from "./Welcome";

export const Dashboard = () => {
  const {
    data: dataContact,

    total: totalContact,

    isPending: isPendingContact,
    error: contactError,
    refetch: refetchContacts,
  } = useGetList<Contact>("contacts", {
    pagination: { page: 1, perPage: 1 },
  });

  const {
    total: totalContactNotes,
    isPending: isPendingContactNotes,
    error: notesError,
    refetch: refetchNotes,
  } = useGetList<ContactNote>("contact_notes", {
    pagination: { page: 1, perPage: 1 },
  });

  const {
    total: totalDeal,
    isPending: isPendingDeal,
    error: dealsError,
    refetch: refetchDeals,
  } = useGetList<Contact>(
    "deals",

    {
      pagination: { page: 1, perPage: 1 },
    },
  );

  const isPending = isPendingContact || isPendingContactNotes || isPendingDeal;
  const hasError = Boolean(contactError || notesError || dealsError);
  const onboardingStep =
    !contactError && !notesError && !isPendingContact && !isPendingContactNotes
      ? !totalContact
        ? 1
        : !totalContactNotes
          ? 2
          : null
      : null;

  // Eine leere Seite liest sich wie ein Fehler. Solange die Startseite lädt,
  // zeigt Nora dieselbe Grobstruktur wie im geladenen Zustand.
  if (isPending && !hasError) {
    return (
      <div className="flex flex-col gap-8 mt-1">
        <NoraPageLoading variant="cards" className="min-h-[24rem]" />

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-8">
            <NoraPageLoading rows={3} />
          </div>

          <div className="lg:col-span-4">
            <NoraPageLoading rows={3} />
          </div>
        </div>
      </div>
    );
  }

  if (onboardingStep && !hasError) {
    return (
      <DashboardStepper
        step={onboardingStep}
        contactId={onboardingStep === 2 ? dataContact?.[0]?.id : undefined}
      />
    );
  }

  return (
    <div className="flex flex-col gap-8 mt-1">
      {contactError || notesError ? (
        <NoraQueryError
          error={contactError || notesError}
          onRetry={() =>
            Promise.all([
              ...(contactError ? [refetchContacts()] : []),
              ...(notesError ? [refetchNotes()] : []),
            ])
          }
        />
      ) : onboardingStep ? (
        <DashboardStepper
          step={onboardingStep}
          contactId={onboardingStep === 2 ? dataContact?.[0]?.id : undefined}
        />
      ) : null}
      <Hotboard />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-8 flex flex-col gap-6">
          {dealsError ? (
            <NoraQueryError error={dealsError} onRetry={() => refetchDeals()} />
          ) : isPendingDeal ? (
            <NoraPageLoading rows={3} />
          ) : totalDeal ? (
            <DealsChart />
          ) : null}

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
