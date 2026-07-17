import { ArrowRight } from "lucide-react";
import { useTranslate } from "ra-core";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

import { noraCreatePath } from "../routing/noraRoutes";
import type { Company, Deal } from "../types";
import { useHorizontalWheelScroll } from "../misc/useHorizontalWheelScroll";
import {
  FOCUS_BOARD_STAGES,
  prepareFocusColumnDeals,
  type FocusColumnDeals,
} from "./hotboardUtils";
import { HotboardFocusColumn } from "./HotboardFocusColumn";

type HotboardFocusBoardProps = {
  deals: Deal[];
  companyById: Map<string | number, Company>;
  className?: string;
};

const EMPTY_MESSAGE_KEYS: Record<
  (typeof FOCUS_BOARD_STAGES)[number],
  string
> = {
  "neue-anfrage": "crm.dashboard.hotboard.focus_board.empty_new_inquiries",
  nachfassen: "crm.dashboard.hotboard.focus_board.empty_follow_up",
};

export const HotboardFocusBoard = ({
  deals,
  companyById,
  className,
}: HotboardFocusBoardProps) => {
  const translate = useTranslate();
  const scrollRef = useHorizontalWheelScroll<HTMLDivElement>();

  const columns: Record<
    (typeof FOCUS_BOARD_STAGES)[number],
    FocusColumnDeals
  > = {
    "neue-anfrage": prepareFocusColumnDeals(deals, "neue-anfrage"),
    nachfassen: prepareFocusColumnDeals(deals, "nachfassen"),
  };

  return (
    <section
      className={cn("flex flex-col gap-4", className)}
      aria-label={translate("crm.dashboard.hotboard.focus_board.title")}
    >
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <h2 className="text-lg font-semibold tracking-tight">
          {translate("crm.dashboard.hotboard.focus_board.title")}
        </h2>
        <Link
          to={noraCreatePath({ resource: "deals", type: "list" })}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline nora-touch-target shrink-0"
        >
          {translate("crm.dashboard.hotboard.focus_board.open_all_deals")}
          <ArrowRight className="h-4 w-4" aria-hidden />
        </Link>
      </div>

      <div
        ref={scrollRef}
        className="nora-focus-board-scroll lg:overflow-visible overflow-x-auto pb-1"
      >
        <div className="nora-focus-board grid grid-cols-1 lg:grid-cols-2 gap-5 max-lg:grid-flow-col max-lg:auto-cols-[minmax(280px,45vw)] max-lg:w-max max-lg:min-w-full">
          {FOCUS_BOARD_STAGES.map((stage) => (
            <HotboardFocusColumn
              key={stage}
              stage={stage}
              deals={columns[stage].deals}
              total={columns[stage].total}
              remaining={columns[stage].remaining}
              companyById={companyById}
              emptyMessageKey={EMPTY_MESSAGE_KEYS[stage]}
            />
          ))}
        </div>
      </div>
    </section>
  );
};
