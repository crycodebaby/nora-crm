import { Globe, Link as LinkIcon, Mail, Phone } from "lucide-react";
import {
  useGetIdentity,
  useLocaleState,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { ShowButton } from "@/components/admin/show-button";
import { TextField } from "@/components/admin/text-field";
import { SelectField } from "@/components/admin/select-field";

import { NoraDeleteButton, NoraEditButton } from "../misc/NoraAccessActions";

import { formatLocalizedDate } from "../misc/relativeDateUtils";
import { AsideSection } from "../misc/AsideSection";
import { BusinessNumber } from "../misc/BusinessNumber";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Company } from "../types";
import { getTranslatedCompanySizeLabel } from "./getTranslatedCompanySizeLabel";
import { sizes } from "./sizes";
import { useGetSalesName } from "../sales/useGetSalesName";
import { translateContactMethodTypeLabel } from "../misc/contactMethodTypes";
import { translateLinkTypeLabel } from "../misc/linksModel";

interface CompanyAsideProps {
  link?: string;
}

export const CompanyAside = ({ link = "edit" }: CompanyAsideProps) => {
  const record = useRecordContext<Company>();
  const translate = useTranslate();
  if (!record) return null;

  return (
    <div className="hidden sm:block w-92 min-w-92 space-y-4">
      <div className="flex flex-row space-x-1">
        {link === "edit" ? (
          <NoraEditButton
            resource="companies"
            label={translate("resources.companies.action.edit")}
          />
        ) : (
          <ShowButton label={translate("resources.companies.action.show")} />
        )}
      </div>

      <CompanyInfo record={record} />

      <AddressInfo record={record} />

      <ContextInfo record={record} />

      <AdditionalInfo record={record} />

      {link !== "edit" && (
        <div className="mt-6 pt-6 border-t hidden sm:flex flex-col gap-2 items-start">
          <NoraDeleteButton
            resource="companies"
            className="h-6 cursor-pointer hover:bg-destructive/10! text-destructive! border-destructive! focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/40"
            size="sm"
          />
        </div>
      )}
    </div>
  );
};

export const CompanyInfo = ({ record }: { record: Company }) => {
  const translate = useTranslate();
  const emails = record.email_jsonb ?? [];
  const phones = record.phone_jsonb ?? [];
  const links = record.links_jsonb ?? [];
  const hasLegacyOnly =
    emails.length === 0 &&
    phones.length === 0 &&
    links.length === 0 &&
    (record.website || record.linkedin_url || record.phone_number);

  if (
    emails.length === 0 &&
    phones.length === 0 &&
    links.length === 0 &&
    !hasLegacyOnly
  ) {
    return null;
  }

  return (
    <AsideSection
      title={translate("resources.companies.field_categories.contact")}
    >
      {emails.map((entry, index) => (
        <div
          key={`email-${index}`}
          className="flex flex-row items-center gap-1 min-h-[24px]"
        >
          <Mail className="w-4 h-4 shrink-0" />
          <a
            className="underline hover:no-underline"
            href={`mailto:${entry.email}`}
          >
            {entry.email}
          </a>
          <span className="text-xs text-muted-foreground">
            ({translateContactMethodTypeLabel(entry.type, translate)})
          </span>
        </div>
      ))}
      {phones.map((entry, index) => (
        <div
          key={`phone-${index}`}
          className="flex flex-row items-center gap-1 min-h-[24px]"
        >
          <Phone className="w-4 h-4 shrink-0" />
          <span>{entry.number}</span>
          <span className="text-xs text-muted-foreground">
            ({translateContactMethodTypeLabel(entry.type, translate)})
          </span>
        </div>
      ))}
      {links.map((entry, index) => (
        <div
          key={`link-${index}`}
          className="flex flex-row items-center gap-1 min-h-[24px]"
        >
          {entry.type === "website" ? (
            <Globe className="w-4 h-4 shrink-0" />
          ) : (
            <LinkIcon className="w-4 h-4 shrink-0" />
          )}
          <a
            className="underline hover:no-underline truncate"
            href={
              entry.url.startsWith("http") ? entry.url : `https://${entry.url}`
            }
            target="_blank"
            rel="noopener noreferrer"
            title={entry.url}
          >
            {translateLinkTypeLabel(entry.type, translate)}
          </a>
        </div>
      ))}
      {hasLegacyOnly && (
        <>
          {record.website && (
            <div className="flex flex-row items-center gap-1 min-h-[24px]">
              <Globe className="w-4 h-4 shrink-0" />
              <a
                className="underline hover:no-underline"
                href={
                  record.website.startsWith("http")
                    ? record.website
                    : `https://${record.website}`
                }
                target="_blank"
                rel="noopener noreferrer"
              >
                {record.website.replace(/^https?:\/\//, "")}
              </a>
            </div>
          )}
          {record.phone_number && (
            <div className="flex flex-row items-center gap-1 min-h-[24px]">
              <Phone className="w-4 h-4 shrink-0" />
              <TextField source="phone_number" />
            </div>
          )}
        </>
      )}
    </AsideSection>
  );
};

export const ContextInfo = ({ record }: { record: Company }) => {
  const { companySectors } = useConfigurationContext();
  const translate = useTranslate();
  if (!record.revenue && !record.id) {
    return null;
  }

  const sector = companySectors.find((s) => s.value === record.sector);
  const sectorLabel = sector?.label;
  const translatedSizes = sizes.map((size) => ({
    ...size,
    name: getTranslatedCompanySizeLabel(size, translate),
  }));

  return (
    <AsideSection
      title={translate("resources.companies.field_categories.context")}
    >
      {sectorLabel && (
        <span>
          {translate("resources.companies.fields.sector")}: {sectorLabel}
        </span>
      )}
      {record.size && (
        <span>
          {translate("resources.companies.fields.size")}:{" "}
          <SelectField source="size" choices={translatedSizes} />
        </span>
      )}
      {record.revenue && (
        <span>
          {translate("resources.companies.fields.revenue")}:{" "}
          <TextField source="revenue" />
        </span>
      )}
      {record.tax_identifier && (
        <span>
          {translate("resources.companies.fields.tax_identifier", {})}
          : <TextField source="tax_identifier" />
        </span>
      )}
    </AsideSection>
  );
};

export const AddressInfo = ({ record }: { record: Company }) => {
  const translate = useTranslate();
  if (
    !record.address &&
    !record.city &&
    !record.zipcode &&
    !record.state_abbr
  ) {
    return null;
  }

  return (
    <AsideSection
      title={translate("resources.companies.field_categories.address")}
      noGap
    >
      <TextField source="address" />
      <TextField source="city" />
      <TextField source="zipcode" />
      <TextField source="state_abbr" />
      <TextField source="country" />
    </AsideSection>
  );
};

export const AdditionalInfo = ({ record }: { record: Company }) => {
  const translate = useTranslate();
  const [locale = "en"] = useLocaleState();
  const { identity } = useGetIdentity();
  const isCurrentUser = record.sales_id === identity?.id;
  const salesName = useGetSalesName(record.sales_id, {
    enabled: !isCurrentUser,
  });
  if (
    !record.customer_number &&
    !record.created_at &&
    !record.sales_id &&
    !record.description
  ) {
    return null;
  }

  return (
    <AsideSection
      title={translate("resources.companies.field_categories.additional_info")}
    >
      {record.customer_number ? (
        <span className="flex items-center gap-2 text-sm mb-1">
          {translate("resources.companies.fields.customer_number")}:{" "}
          <BusinessNumber value={record.customer_number} />
        </span>
      ) : null}
      {record.description && (
        <p className="text-sm  mb-1">{record.description}</p>
      )}
      {record.sales_id !== null && (
        <div className="inline-flex text-sm text-muted-foreground mb-1">
          {translate(
            isCurrentUser
              ? "resources.companies.followed_by_you"
              : "resources.companies.followed_by",
            { name: salesName },
          )}
        </div>
      )}
      {record.created_at && (
        <p className="text-sm text-muted-foreground mb-1">
          {translate("resources.companies.added_on", {
            date: formatLocalizedDate(record.created_at, locale),
          })}{" "}
        </p>
      )}
    </AsideSection>
  );
};
