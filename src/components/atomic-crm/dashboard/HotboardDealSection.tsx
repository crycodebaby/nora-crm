import type { LucideIcon } from "lucide-react";
import { useTranslate } from "ra-core";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

import type { Company, Deal } from "../types";
import { HotboardDealRow } from "./HotboardDealRow";

type HotboardDealSectionProps = {
  icon: LucideIcon;
  title: string;
  deals: Deal[];
  companyById: Map<string | number, Company>;
  className?: string;
};

export const HotboardDealSection = ({
  icon: Icon,
  title,
  deals,
  companyById,
  className,
}: HotboardDealSectionProps) => {
  const translate = useTranslate();

  return (
    <section className={cn("flex flex-col gap-3", className)}>
      <div className="flex items-center gap-2">
        <Icon className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden />
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
      </div>
      <Card className="nora-card divide-y overflow-hidden">
        {deals.length > 0 ? (
          deals.map((deal) => (
            <HotboardDealRow
              key={deal.id}
              deal={deal}
              companyName={companyById.get(deal.company_id)?.name}
            />
          ))
        ) : (
          <p className="px-4 py-6 text-sm text-center text-muted-foreground nora-readable">
            {translate("crm.dashboard.hotboard.empty_section")}
          </p>
        )}
      </Card>
    </section>
  );
};
