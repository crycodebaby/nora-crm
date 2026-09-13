import type { ReactNode } from "react";
import { ShowBase, useShowContext, useTranslate } from "ra-core";
import { Link } from "react-router";

import { ReferenceArrayField } from "@/components/admin/reference-array-field";
import { ReferenceField } from "@/components/admin/reference-field";

import { MobileContent } from "../layout/MobileContent";
import MobileHeader from "../layout/MobileHeader";
import { BusinessNumber } from "../misc/BusinessNumber";
import { MobileBackButton } from "../misc/MobileBackButton";
import { NoraSectionCard } from "../misc/NoraSectionCard";
import { NoraShowBoundary } from "../misc/NoraShowBoundary";
import type { Deal } from "../types";
import { ContactList } from "./ContactList";
import { DealFollowUpBadge } from "./DealFollowUpBadge";
import { useDealShowFacts } from "./useDealShowFacts";

/**
 * Mobile Vorgang detail page (W7-M1).
 *
 * The desktop Vorgang is a dialog layered on a loaded Kanban board, and its
 * actions (Schließen → Vorgangsliste, Bearbeiten → Edit-Route, Archivieren →
 * Vorgangsliste) all target surfaces that deliberately do not exist on the
 * mobile app. Reusing that shell would only move the dead end, so mobile gets
 * its own read-only page and shares the *content* derivation instead — see
 * `useDealShowFacts`.
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
  const {
    stageLabel,
    categoryLabel,
    amountLabel,
    followUpDateLabel,
    followUpStatus,
    showFollowUp,
    salesName,
  } = useDealShowFacts(record);

  if (!record) return null;

  const isAlert = followUpStatus === "today" || followUpStatus === "overdue";

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
        {record.archived_at ? (
          <p
            className="mb-4 rounded-md bg-orange-500 px-4 py-3 text-sm font-semibold text-white"
            role="status"
          >
            {translate("resources.deals.archived.title")}
          </p>
        ) : null}

        <div className="mb-6 flex flex-col gap-2">
          <BusinessNumber
            value={record.case_number}
            kind="case"
            size="lg"
            variant="badge"
          />
          <h2 className="text-2xl font-bold">{record.name}</h2>
          <p className="text-sm text-muted-foreground">
            <ReferenceField
              source="company_id"
              reference="companies"
              link="show"
            />
          </p>
        </div>

        {isAlert ? (
          <div className="mb-6">
            <DealFollowUpBadge
              dateString={record.expected_closing_date}
              variant="alert"
              showDate
            />
          </div>
        ) : null}

        <div className="flex flex-col gap-6">
          <NoraSectionCard
            title={translate("resources.deals.sections.overview")}
          >
            <div className="flex flex-col gap-4">
              <DealMobileFact
                label={translate("resources.deals.fields.stage")}
                value={stageLabel}
              />
              {categoryLabel ? (
                <DealMobileFact
                  label={translate("resources.deals.fields.category")}
                  value={categoryLabel}
                />
              ) : null}
              <DealMobileFact
                label={translate(
                  "resources.deals.fields.expected_closing_date",
                )}
                value={followUpDateLabel}
                extra={
                  showFollowUp && followUpStatus === "upcoming" ? (
                    <DealFollowUpBadge
                      dateString={record.expected_closing_date}
                      variant="inline"
                    />
                  ) : null
                }
              />
              <DealMobileFact
                label={translate("resources.deals.fields.amount")}
                value={amountLabel}
              />
              <DealMobileFact
                label={translate("resources.deals.fields.sales_id")}
                value={salesName}
              />
            </div>
          </NoraSectionCard>

          {record.contact_ids?.length ? (
            <NoraSectionCard
              title={translate("resources.deals.fields.contact_ids")}
            >
              <ReferenceArrayField
                source="contact_ids"
                reference="contacts_summary"
              >
                <ContactList />
              </ReferenceArrayField>
            </NoraSectionCard>
          ) : null}

          {record.description ? (
            <NoraSectionCard
              title={translate("resources.deals.fields.description")}
            >
              <p className="nora-detail-body whitespace-pre-line">
                {record.description}
              </p>
            </NoraSectionCard>
          ) : null}
        </div>
      </MobileContent>
    </>
  );
};

const DealMobileFact = ({
  label,
  value,
  extra,
}: {
  label: string;
  value?: string | null;
  extra?: ReactNode;
}) => (
  <div className="flex flex-col gap-1.5">
    <span className="nora-detail-label">{label}</span>
    <div className="nora-detail-value flex flex-wrap items-center gap-2">
      {value}
      {extra}
    </div>
  </div>
);
