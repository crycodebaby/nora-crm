import { ShowBase, useShowContext, useTranslate } from "ra-core";
import { Link } from "react-router";

import { MobileContent } from "../layout/MobileContent";
import MobileHeader from "../layout/MobileHeader";
import { MobileBackButton } from "../misc/MobileBackButton";
import { NoraSectionCard } from "../misc/NoraSectionCard";
import { NoraShowBoundary } from "../misc/NoraShowBoundary";
import type { Deal } from "../types";
import { DealFollowUpBadge } from "./DealFollowUpBadge";
import { useDealShowFacts } from "./useDealShowFacts";
import {
  DealArchivedBanner,
  DealDescriptionSection,
  DealKeyFacts,
  DealPartiesSection,
  DealTitleBlock,
} from "./DealShowSections";

/**
 * Mobile Vorgang detail page (W7-M1).
 *
 * The desktop Vorgang is a dialog layered on a loaded Kanban board, and its
 * actions (Schließen → Vorgangsliste, Bearbeiten → Edit-Route, Archivieren →
 * Vorgangsliste) all target surfaces that deliberately do not exist on the
 * mobile app. Reusing that shell would only move the dead end, so mobile gets
 * its own read-only page and shares the *content* derivation instead — see
 * `useDealShowFacts` and the shared blocks in `DealShowSections`.
 *
 * Scope is the fachliche core a Vorgang has to answer away from the desk:
 * Worum geht es, wie ist der Status, wer ist zuständig, was steht als
 * Nächstes an. Untersektionen of the desktop dialog (Aufgaben, Produktions-
 * freigabe, Notizen, Änderungshistorie) are out of scope for W7-M1.
 */
export const DealShowMobile = () => (
  <ShowBase
    queryOptions={{
      // Load-bearing, not cosmetic: ra-core's default onError notifies and
      // then redirects to the resource list. On mobile that is /deals →
      // /vorgaenge, which has no mobile list and renders an empty page. A
      // missing or failing Vorgang must instead stay here and show the
      // NoraShowBoundary error state.
      onError: () => {},
    }}
  >
    <NoraShowBoundary>
      <DealShowMobileContent />
    </NoraShowBoundary>
  </ShowBase>
);

const DealShowMobileContent = () => {
  const translate = useTranslate();
  const { record } = useShowContext<Deal>();
  const facts = useDealShowFacts(record);

  if (!record) return null;

  const isAlert =
    facts.followUpStatus === "today" || facts.followUpStatus === "overdue";

  return (
    <>
      <MobileHeader>
        {/* Every mobile entry point into a Vorgang (Hotboard, globale Suche,
            Quick Capture, Deep Link, Legacy-Link) can be reached cold, so back
            must resolve without a history stack — and /vorgaenge has no mobile
            list. The Startseite is the one destination that always exists,
            which is also what the Kundenakte does. */}
        <MobileBackButton to="/" />
        <div className="flex flex-1 min-w-0">
          <Link to="/" className="flex-1 min-w-0">
            <h1 className="truncate text-xl font-semibold">
              {translate("resources.deals.forcedCaseName")}
            </h1>
          </Link>
        </div>
      </MobileHeader>

      <MobileContent>
        <div className="flex flex-col gap-4">
          {record.archived_at ? <DealArchivedBanner /> : null}

          <DealTitleBlock deal={record} facts={facts} className="mt-1" />

          {isAlert ? (
            <DealFollowUpBadge
              dateString={record.expected_closing_date}
              variant="alert"
              showDate
            />
          ) : null}

          <NoraSectionCard
            title={translate("resources.deals.sections.overview")}
          >
            <DealKeyFacts
              deal={record}
              facts={facts}
              className="grid grid-cols-2 gap-x-4 gap-y-4"
            />
          </NoraSectionCard>

          <DealPartiesSection deal={record} />

          <DealDescriptionSection deal={record} collapsedHeight={220} />
        </div>
      </MobileContent>
    </>
  );
};
