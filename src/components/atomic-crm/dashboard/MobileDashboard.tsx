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
import { ChevronRight, Inbox } from "lucide-react";
import { useTranslate } from "ra-core";
import { ARBEITSKORB_PATH } from "../work/arbeitskorbPath";
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
  const onboardingStep =
    !error && !isPending
      ? !totalContact
        ? 1
        : !totalContactNotes
          ? 2
          : null
      : null;

  // Der bisherige Ein-Sekunden-Vorlauf zeigte genau während des üblichen
  // Ladevorgangs eine leere Seite. Der Ladezustand erscheint jetzt sofort.
  if (isPending && !error) {
    return <Loading />;
  }

  if (onboardingStep === 1) {
    return (
      <Wrapper>
        <DashboardStepper step={1} />
      </Wrapper>
    );
  }

  if (onboardingStep === 2) {
    return (
      <Wrapper>
        <DashboardStepper step={2} contactId={dataContact?.[0]?.id} />
      </Wrapper>
    );
  }

  return (
    <Wrapper>
      <div className="flex flex-col gap-8 mt-1">
        <ArbeitskorbEntry />
        {error ? (
          <NoraQueryError
            error={error}
            onRetry={() =>
              Promise.all([
                ...(contactError ? [refetchContacts()] : []),
                ...(notesError ? [refetchNotes()] : []),
              ])
            }
          />
        ) : null}
        <Hotboard />
        <DashboardActivityLog />
      </div>
    </Wrapper>
  );
};

/**
 * Arbeitskorb entry of the regular mobile start state (docs/nora/26 §14):
 * one full-width row above the Hotboard — not a seventh bottom-nav item.
 */
const ArbeitskorbEntry = () => {
  const translate = useTranslate();
  return (
    <Link
      to={ARBEITSKORB_PATH}
      className="flex min-h-11 items-center gap-3 rounded-md border border-border bg-card px-3 py-2.5 text-foreground no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--nora-brand-ring)]"
    >
      <Inbox
        aria-hidden="true"
        className="size-5 shrink-0 text-muted-foreground"
      />
      <span className="min-w-0 flex-1 font-semibold">
        {translate("crm.work.start_entry")}
      </span>
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-muted-foreground"
      />
    </Link>
  );
};
