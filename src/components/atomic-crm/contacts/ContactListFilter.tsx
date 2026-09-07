import { endOfYesterday, startOfMonth, startOfWeek, subMonths } from "date-fns";
import { CheckSquare, Clock, Tag, TrendingUp, Users } from "lucide-react";
import { useGetIdentity, useListContext, useTranslate } from "ra-core";
import { useMemo, useState } from "react";
import { ToggleFilterButton } from "@/components/admin/toggle-filter-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

import { useTags } from "../tags/useTags";
import type { Tag as TagRecord } from "../types";

import { FilterCategory } from "../filters/FilterCategory";
import { Status } from "../misc/Status";
import { useConfigurationContext } from "../root/ConfigurationContext";
import { ResponsiveFilters } from "../misc/ResponsiveFilters";
import { useIsMobile } from "@/hooks/use-mobile";
import { ActiveFilterButton } from "../misc/ActiveFilterButton";

/**
 * Markierungen sidebar (Markierungen Identity Wave, 2026-09-07).
 *
 * Before this wave the sidebar loaded only the first 10 Markierungen by name,
 * so the duplicate rows from the Production incident could push a real one
 * out of the list — and a filter on a Markierung outside that window rendered
 * no chip at all, leaving the user filtered by something invisible.
 *
 * Now: the full (small) vocabulary is loaded, a compact set is shown, and the
 * rest is one click away. The ACTIVE Markierung is always rendered, whatever
 * its position, so the sidebar can never hide the filter it is applying.
 */
const VISIBLE_TAG_COUNT = 8;

const tagFilterValue = (tag: TagRecord) => ({ "tags@cs": `{${tag.id}}` });

const TagBadge = ({ tag }: { tag: TagRecord }) => (
  <Badge
    variant="secondary"
    className="text-black text-sm md:text-xs font-normal cursor-pointer"
    style={{ backgroundColor: tag.color }}
  >
    {tag.name}
  </Badge>
);

const ContactTagFilterSection = () => {
  const translate = useTranslate();
  const { data: tags = [] } = useTags();
  const { filterValues } = useListContext();
  const activeValue = (filterValues ?? {})["tags@cs"];
  const [expanded, setExpanded] = useState(false);

  const visibleTags = useMemo(() => {
    if (expanded) return tags;
    const head = tags.slice(0, VISIBLE_TAG_COUNT);
    // The applied filter stays visible even when it sorts past the cut-off.
    const active = tags.find((tag: TagRecord) => activeValue === `{${tag.id}}`);
    return active && !head.includes(active) ? [...head, active] : head;
  }, [tags, expanded, activeValue]);

  const hiddenCount = tags.length - visibleTags.length;

  return (
    <FilterCategory label="resources.contacts.filters.tags" icon={<Tag />}>
      {visibleTags.map((tag) => (
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          key={tag.id}
          label={<TagBadge tag={tag} />}
          value={tagFilterValue(tag)}
        />
      ))}
      {(hiddenCount > 0 || expanded) && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="w-auto md:w-full justify-start h-10 md:h-8 px-2.5 text-muted-foreground cursor-pointer"
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? translate("resources.tags.filters.show_less")
            : translate("resources.tags.filters.show_more", {
                smart_count: hiddenCount,
              })}
        </Button>
      )}
    </FilterCategory>
  );
};

export const ContactListFilter = () => {
  const { noteStatuses } = useConfigurationContext();
  const isMobile = useIsMobile();
  const { identity } = useGetIdentity();

  return (
    <ResponsiveFilters>
      <FilterCategory
        label="resources.contacts.fields.last_seen"
        icon={<Clock />}
      >
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          label="resources.contacts.filters.today"
          value={{
            "last_seen@gte": endOfYesterday().toISOString(),
            "last_seen@lte": undefined,
          }}
          size={isMobile ? "lg" : undefined}
        />
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          label="resources.contacts.filters.this_week"
          value={{
            "last_seen@gte": startOfWeek(new Date()).toISOString(),
            "last_seen@lte": undefined,
          }}
          size={isMobile ? "lg" : undefined}
        />
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          label="resources.contacts.filters.before_this_week"
          value={{
            "last_seen@gte": undefined,
            "last_seen@lte": startOfWeek(new Date()).toISOString(),
          }}
          size={isMobile ? "lg" : undefined}
        />
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          label="resources.contacts.filters.before_this_month"
          value={{
            "last_seen@gte": undefined,
            "last_seen@lte": startOfMonth(new Date()).toISOString(),
          }}
          size={isMobile ? "lg" : undefined}
        />
        <ToggleFilterButton
          className="w-auto md:w-full justify-between h-10 md:h-8"
          label="resources.contacts.filters.before_last_month"
          value={{
            "last_seen@gte": undefined,
            "last_seen@lte": subMonths(
              startOfMonth(new Date()),
              1,
            ).toISOString(),
          }}
          size={isMobile ? "lg" : undefined}
        />
      </FilterCategory>

      <FilterCategory
        label="resources.notes.fields.status"
        icon={<TrendingUp />}
      >
        {noteStatuses.map((status) => (
          <ToggleFilterButton
            key={status.value}
            className="w-auto md:w-full justify-between h-10 md:h-8"
            label={
              <span>
                {status.label} <Status status={status.value} />
              </span>
            }
            value={{ status: status.value }}
            size={isMobile ? "lg" : undefined}
          />
        ))}
      </FilterCategory>

      <ContactTagFilterSection />

      <FilterCategory
        icon={<CheckSquare />}
        label="resources.contacts.filters.tasks"
      >
        <ToggleFilterButton
          className="w-full justify-between h-10 md:h-8"
          label="resources.tasks.filters.with_pending"
          value={{ "nb_tasks@gt": 0 }}
          size={isMobile ? "lg" : undefined}
        />
      </FilterCategory>

      <FilterCategory
        icon={<Users />}
        label="resources.contacts.fields.sales_id"
      >
        <ToggleFilterButton
          className="w-full justify-between h-10 md:h-8"
          label="crm.common.me"
          value={{ sales_id: identity?.id }}
          size={isMobile ? "lg" : undefined}
        />
      </FilterCategory>
    </ResponsiveFilters>
  );
};

export const ContactListFilterSummary = () => {
  const { noteStatuses } = useConfigurationContext();
  const { identity } = useGetIdentity();
  // Full list on purpose: this row renders the chip for whatever filter is
  // applied, so it must never be windowed.
  const { data } = useTags();
  const { filterValues } = useListContext();
  const hasFilters = !!Object.entries(filterValues || {}).filter(
    ([key]) => key !== "q",
  ).length;

  if (!hasFilters) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-start mb-4 gap-1">
      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.today"
        value={{
          "last_seen@gte": endOfYesterday().toISOString(),
          "last_seen@lte": undefined,
        }}
      />
      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.this_week"
        value={{
          "last_seen@gte": startOfWeek(new Date()).toISOString(),
          "last_seen@lte": undefined,
        }}
      />
      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.before_this_week"
        value={{
          "last_seen@gte": undefined,
          "last_seen@lte": startOfWeek(new Date()).toISOString(),
        }}
      />
      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.before_this_month"
        value={{
          "last_seen@gte": undefined,
          "last_seen@lte": startOfMonth(new Date()).toISOString(),
        }}
      />
      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.before_last_month"
        value={{
          "last_seen@gte": undefined,
          "last_seen@lte": subMonths(startOfMonth(new Date()), 1).toISOString(),
        }}
      />

      {noteStatuses.map((status) => (
        <ActiveFilterButton
          key={status.value}
          className="w-auto justify-between h-8"
          label={
            <span>
              {status.label} <Status status={status.value} />
            </span>
          }
          value={{ status: status.value }}
        />
      ))}

      {data &&
        data.map((record) => (
          <ActiveFilterButton
            className="w-auto justify-between h-8"
            key={record.id}
            label={
              <Badge
                variant="secondary"
                className="text-black text-sm md:text-xs font-normal cursor-pointer"
                style={{
                  backgroundColor: record?.color,
                }}
              >
                {record?.name}
              </Badge>
            }
            value={{ "tags@cs": `{${record.id}}` }}
          />
        ))}

      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.tasks.filters.with_pending"
        value={{ "nb_tasks@gt": 0 }}
      />

      <ActiveFilterButton
        className="w-auto justify-between h-8"
        label="resources.contacts.filters.managed_by_me"
        value={{ sales_id: identity?.id }}
      />
    </div>
  );
};
