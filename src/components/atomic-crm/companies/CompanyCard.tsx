import { Handshake } from "lucide-react";
import { Link } from "react-router";
import {
  useListContext,
  useRecordContext,
  useTranslate,
} from "ra-core";
import { useNoraAwareCreatePath } from "@/hooks/useNoraAwareCreatePath";
import { ReferenceManyField } from "@/components/admin/reference-many-field";
import { Card } from "@/components/ui/card";

import { Avatar as ContactAvatar } from "../contacts/Avatar";
import { useConfigurationContext } from "../root/ConfigurationContext";
import type { Company } from "../types";
import { BusinessNumber } from "../misc/BusinessNumber";
import { CompanyAvatar } from "./CompanyAvatar";

export const CompanyCard = (props: { record?: Company }) => {
  const createPath = useNoraAwareCreatePath();
  const record = useRecordContext<Company>(props);
  const translate = useTranslate();
  const { companySectors } = useConfigurationContext();
  if (!record) return null;

  const sector = companySectors.find((s) => s.value === record.sector);
  const sectorLabel = sector?.label;

  return (
    <Link
      to={createPath({
        resource: "companies",
        id: record.id,
        type: "show",
      })}
      className="no-underline"
    >
      <Card className="nora-card h-[208px] flex flex-col justify-between p-5 hover:bg-muted/80 transition-colors">
        <div className="flex flex-col items-center gap-1.5">
          <CompanyAvatar />
          <div className="text-center mt-1">
            <h6 className="nora-list-title text-center">{record.name}</h6>
            <BusinessNumber value={record.customer_number} kind="customer" size="md" />
            {sectorLabel ? (
              <p className="nora-muted text-xs mt-0.5">{sectorLabel}</p>
            ) : null}
          </div>
        </div>
        <div className="flex flex-row w-full justify-between gap-2">
          <div className="flex items-center">
            {record.nb_contacts ? (
              <ReferenceManyField reference="contacts" target="company_id">
                <AvatarGroupIterator />
              </ReferenceManyField>
            ) : null}
          </div>
          {record.nb_deals ? (
            <div className="flex items-center ml-2 gap-0.5">
              <Handshake className="w-4 h-4 text-muted-foreground" />
              <span className="text-sm font-medium">{record.nb_deals}</span>
              <span className="nora-muted text-xs">
                {translate("resources.deals.name", {
                  smart_count: record.nb_deals ?? 0,
                  _: "Deal |||| Deals",
                })}
              </span>
            </div>
          ) : null}
        </div>
      </Card>
    </Link>
  );
};

const AvatarGroupIterator = () => {
  const { data, total, error, isPending } = useListContext();
  if (isPending || error) return null;

  const MAX_AVATARS = 3;
  return (
    <div className="*:data-[slot=avatar]:ring-background flex -space-x-0.5 *:data-[slot=avatar]:ring-2 *:data-[slot=avatar]:grayscale-50">
      {data.slice(0, MAX_AVATARS).map((record: any) => (
        <ContactAvatar
          key={record.id}
          record={record}
          width={25}
          height={25}
          title={`${record.first_name} ${record.last_name}`}
        />
      ))}
      {total > MAX_AVATARS && (
        <span
          className="relative flex size-8 shrink-0 overflow-hidden rounded-full w-[25px] h-[25px]"
          data-slot="avatar"
        >
          <span className="bg-muted flex size-full items-center justify-center rounded-full text-[10px]">
            +{total - MAX_AVATARS}
          </span>
        </span>
      )}
    </div>
  );
};
