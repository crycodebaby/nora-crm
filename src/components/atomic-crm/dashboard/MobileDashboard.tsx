import { useGetList } from "ra-core";
import { Skeleton } from "@/components/ui/skeleton";
import { NoraQueryError } from "../misc/NoraQueryError";

import type { Contact, ContactNote } from "../types";
import { DashboardActivityLog } from "./DashboardActivityLog";
import { DashboardStepper } from "./DashboardStepper";
import { Hotboard } from "./Hotboard";
import { MobileContent } from "../layout/MobileContent";
import MobileHeader from "../layout/MobileHeader";
import { Link } from "react-router";
import noraMonogram from "@/assets/nora-monogram.png";

const Wrapper = ({ children }: { children: React.ReactNode }) => {
  return (
    <>
      <MobileHeader>
        <Link to="/" className="flex items-center gap-2 text-foreground">
          <img
            className="size-9 object-contain"
            src={noraMonogram}
            alt=""
            aria-hidden="true"
          />
          <span className="text-base font-semibold">Nora</span>
        </Link>
      </MobileHeader>
      <MobileContent>{children}</MobileContent>
    </>
  );
};

const Loading = () => (
  <Wrapper>
    <Skeleton className="h-4 w-3/4 mb-4" />
    <Skeleton className="h-4 w-full mb-2" />
    <Skeleton className="h-4 w-full mb-2" />
    <Skeleton className="h-4 w-full mb-2" />
    <Skeleton className="h-4 w-full mb-2" />
  </Wrapper>
);

export const MobileDashboard = () => {
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
  const isPending = isPendingContact || isPendingContactNotes;

  const error = contactError || notesError;
  if (error) {
    return (
      <Wrapper>
        <NoraQueryError
          error={error}
          onRetry={() => Promise.all([refetchContacts(), refetchNotes()])}
          className="my-8"
        />
      </Wrapper>
    );
  }

  // Der bisherige Ein-Sekunden-Vorlauf zeigte genau während des üblichen
  // Ladevorgangs eine leere Seite. Der Ladezustand erscheint jetzt sofort.
  if (isPending) {
    return <Loading />;
  }

  if (!totalContact) {
    return (
      <Wrapper>
        <DashboardStepper step={1} />
      </Wrapper>
    );
  }

  if (!totalContactNotes) {
    return (
      <Wrapper>
        <DashboardStepper step={2} contactId={dataContact?.[0]?.id} />
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <div className="flex flex-col gap-8 mt-1">
        <Hotboard />
        <DashboardActivityLog />
      </div>
    </Wrapper>
  );
};
