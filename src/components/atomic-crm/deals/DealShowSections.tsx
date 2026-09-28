import type { ReactNode } from "react";
import { Building2, MapPin, UserRound } from "lucide-react";
import { useListContext, useTranslate } from "ra-core";

import { ReferenceArrayField } from "@/components/admin/reference-array-field";
import { ReferenceField } from "@/components/admin/reference-field";

import { Avatar } from "../contacts/Avatar";
import { CompanyAvatar } from "../companies/CompanyAvatar";
import { BusinessNumber } from "../misc/BusinessNumber";
import { NoraIdentityRow } from "../misc/NoraIdentityRow";
import { NoraLongText } from "../misc/NoraLongText";
import { NoraMetaPair } from "../misc/NoraMetaPair";
import { NoraSectionCard } from "../misc/NoraSectionCard";
import { NoraStatusPill } from "../misc/NoraStatusPill";
import { noraCreatePath } from "../routing/noraRoutes";
import type { Company, Contact, Deal } from "../types";
import { DealFollowUpBadge } from "./DealFollowUpBadge";
import { isDealTerminalStage } from "./dealUtils";
import type { DealShowFacts } from "./useDealShowFacts";

/*
 * Shared building blocks of the Vorgang detail surfaces.
 *
 * The desktop dialog and the mobile page compose the same pieces so both
 * answer the first-screen questions in the same order: which Vorgang, what
 * status, who pays, where, who is responsible, what is next.
 */

/** Number + status + category on one line, then the title. */
export const DealTitleBlock = ({
  deal,
  facts,
  as: Heading = "h2",
  className,
}: {
  deal: Deal;
  facts: DealShowFacts;
  as?: "h1" | "h2";
  className?: string;
}) => {
  const translate = useTranslate();
  const terminal = isDealTerminalStage(deal.stage);
  return (
    <div className={className}>
      <div className="nora-entity-header-top">
        <BusinessNumber
          value={deal.case_number}
          kind="case"
          size="sm"
          variant="badge"
        />
        {facts.stageLabel ? (
          <NoraStatusPill
            tone={terminal ? "success" : "accent"}
            title={translate("resources.deals.fields.stage")}
          >
            <span className="sr-only">
              {translate("resources.deals.fields.stage")}:{" "}
            </span>
            {facts.stageLabel}
          </NoraStatusPill>
        ) : null}
        {facts.categoryLabel ? (
          <NoraStatusPill
            tone="quiet"
            title={translate("resources.deals.fields.category")}
          >
            <span className="sr-only">
              {translate("resources.deals.fields.category")}:{" "}
            </span>
            {facts.categoryLabel}
          </NoraStatusPill>
        ) : null}
      </div>
      <Heading className="nora-t-title mt-2">{deal.name}</Heading>
    </div>
  );
};

/** One quiet line under the title: customer · Einsatzort · responsible. */
export const DealHeaderContextLine = ({
  deal,
  facts,
}: {
  deal: Deal;
  facts: DealShowFacts;
}) => {
  const translate = useTranslate();
  const site = [deal.site_street?.trim(), deal.site_city?.trim()]
    .filter(Boolean)
    .join(", ");
  // Each item carries its own leading separator so a wrapped line never
  // ends in a dangling dot.
  return (
    <p className="nora-t-support mt-1.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
      <ReferenceField
        source="company_id"
        reference="companies"
        link="show"
        className="font-medium text-foreground"
      />
      {site ? (
        <span className="inline-flex min-w-0 items-center gap-2">
          <span aria-hidden>·</span>
          <span className="inline-flex min-w-0 items-center gap-1">
            <MapPin className="size-3.5 shrink-0" aria-hidden />
            <span className="sr-only">
              {translate("resources.deals.site.title")}:{" "}
            </span>
            <span className="min-w-0 truncate">{site}</span>
          </span>
        </span>
      ) : null}
      {facts.salesName ? (
        <span className="inline-flex items-center gap-2">
          <span aria-hidden>·</span>
          <span>
            {translate("resources.deals.fields.sales_id")}: {facts.salesName}
          </span>
        </span>
      ) : null}
    </p>
  );
};

/** The customer as a compact identity (logo if present, name, number). */
export const DealCustomerIdentity = ({
  size = "md",
  showRole,
}: {
  size?: "sm" | "md";
  showRole?: boolean;
}) => {
  const translate = useTranslate();
  return (
    <ReferenceField
      source="company_id"
      reference="companies"
      link={false}
      render={({ referenceRecord }) => {
        const company = referenceRecord as Company | undefined;
        if (!company) return null;
        return (
          <NoraIdentityRow
            size={size}
            name={company.name}
            to={noraCreatePath({
              resource: "companies",
              type: "show",
              id: company.id,
            })}
            role={
              showRole ? translate("resources.deals.roles.client") : undefined
            }
            context={
              company.customer_number ? (
                <BusinessNumber
                  value={company.customer_number}
                  kind="customer"
                  variant="inline"
                  size="sm"
                />
              ) : undefined
            }
            visual={
              company.logo?.src ? (
                <CompanyAvatar record={company} width={40} />
              ) : (
                <Building2 className="size-4" aria-hidden />
              )
            }
          />
        );
      }}
    />
  );
};

/** All linked people. Their relation to this Vorgang is not persisted, so
 * they are shown as contacts with their own facts and no invented role. */
export const DealContactIdentities = ({
  size = "md",
}: {
  size?: "sm" | "md";
}) => (
  <ReferenceArrayField source="contact_ids" reference="contacts_summary">
    <DealContactIdentityList size={size} />
  </ReferenceArrayField>
);

const DealContactIdentityList = ({ size }: { size: "sm" | "md" }) => {
  const { data, error, isPending } = useListContext<
    Contact & { company_name?: string }
  >();
  const translate = useTranslate();
  if (isPending || error) return <div className="h-8" />;
  return (
    <div className="nora-identity-list">
      {data.map((contact) => (
        <NoraIdentityRow
          key={contact.id}
          size={size}
          name={`${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim()}
          to={noraCreatePath({
            resource: "contacts",
            type: "show",
            id: contact.id,
          })}
          context={
            contact.title && contact.company_name
              ? translate("resources.contacts.position_at_company", {
                  title: contact.title,
                  company: contact.company_name,
                })
              : contact.title || contact.company_name || undefined
          }
          visual={
            contact.avatar?.src || contact.first_name || contact.last_name ? (
              <Avatar record={contact} width={40} />
            ) : (
              <UserRound className="size-4" aria-hidden />
            )
          }
        />
      ))}
    </div>
  );
};

/** The stored Einsatzort — deal fields only, never the customer address. */
export const DealSiteBlock = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  const street = deal.site_street?.trim();
  const city = deal.site_city?.trim();
  const floor = deal.site_floor?.trim();
  const tenant = deal.site_tenant_name?.trim();
  const hasAny = Boolean(street || city || floor || tenant);
  if (!hasAny) {
    return (
      <p className="nora-t-meta">{translate("resources.deals.site.empty")}</p>
    );
  }
  return (
    <div className="nora-site-address">
      <MapPin className="nora-site-address-icon" aria-hidden />
      <span className="min-w-0 break-words">
        <span className="block">
          <span className="sr-only">
            {translate("resources.deals.site.title")}:{" "}
          </span>
          {[street, city].filter(Boolean).join(" · ") || "—"}
        </span>
        {floor || tenant ? (
          <span className="nora-site-address-detail">
            {[
              floor && `${translate("resources.deals.site.floor")} ${floor}`,
              tenant && `${translate("resources.deals.site.tenant")} ${tenant}`,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        ) : null}
      </span>
    </div>
  );
};

/** Auftraggeber · Ansprechpartner · Einsatzort in one predictable strip. */
export const DealPartiesSection = ({ deal }: { deal: Deal }) => {
  const translate = useTranslate();
  return (
    <NoraSectionCard title={translate("resources.deals.sections.context")}>
      <div className="nora-deal-parties">
        <div className="nora-deal-party">
          <span className="nora-t-eyebrow">
            {translate("resources.deals.roles.client")}
          </span>
          <DealCustomerIdentity />
        </div>
        <div className="nora-deal-party">
          <span className="nora-t-eyebrow">
            {translate("resources.deals.fields.contact_ids")}
          </span>
          {deal.contact_ids?.length ? (
            <DealContactIdentities />
          ) : (
            <p className="nora-t-meta">
              {translate("resources.deals.contacts.empty")}
            </p>
          )}
        </div>
        <div className="nora-deal-party">
          <span className="nora-t-eyebrow">
            {translate("resources.deals.site.title")}
          </span>
          <DealSiteBlock deal={deal} />
        </div>
      </div>
    </NoraSectionCard>
  );
};

/** Status · next contact · estimate · responsible, as four meta pairs. */
export const DealKeyFacts = ({
  deal,
  facts,
  className,
}: {
  deal: Deal;
  facts: DealShowFacts;
  className?: string;
}) => {
  const translate = useTranslate();
  return (
    <dl className={className ?? "nora-meta-grid"}>
      <NoraMetaPair
        label={translate("resources.deals.fields.expected_closing_date")}
        value={facts.followUpDateLabel}
        extra={
          facts.showFollowUp && facts.followUpStatus === "upcoming" ? (
            <DealFollowUpBadge
              dateString={deal.expected_closing_date}
              variant="inline"
              className="nora-urgency-badge-sm"
            />
          ) : null
        }
      />
      <NoraMetaPair
        label={translate("resources.deals.fields.amount")}
        value={facts.amountLabel}
      />
      <NoraMetaPair
        label={translate("resources.deals.fields.sales_id")}
        value={facts.salesName}
      />
    </dl>
  );
};

export const DealDescriptionSection = ({
  deal,
  collapsedHeight,
}: {
  deal: Deal;
  collapsedHeight?: number;
}) => {
  const translate = useTranslate();
  if (!deal.description?.trim()) return null;
  return (
    <NoraSectionCard title={translate("resources.deals.fields.description")}>
      <NoraLongText text={deal.description} collapsedHeight={collapsedHeight} />
    </NoraSectionCard>
  );
};

export const DealArchivedBanner = ({ children }: { children?: ReactNode }) => {
  const translate = useTranslate();
  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-4 py-2.5 text-[14px] font-medium"
      role="status"
      style={{
        borderColor: "var(--nora-accent-border)",
        background: "var(--nora-accent-soft)",
        color: "var(--nora-accent-text)",
      }}
    >
      {translate("resources.deals.archived.title")}
      {children}
    </div>
  );
};
