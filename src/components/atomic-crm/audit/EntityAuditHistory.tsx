import { Fragment, useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { CanAccess, useTranslate } from "ra-core";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";

import { NoraEmptyState } from "../misc/NoraEmptyState";
import { NoraExpandableSection } from "../misc/NoraExpandableSection";
import { NoraQueryError } from "../misc/NoraQueryError";
import { useConfigurationContext } from "../root/ConfigurationContext";
import {
  formatAuditActor,
  formatAuditDateTime,
  formatAuditEventLabel,
  formatAuditFieldLabel,
  formatAuditFieldValue,
  formatAuditSource,
  isAuditNoteContentMeta,
  parseAuditChanges,
} from "./auditFormatters";
import type { AuditEvent, EntityAuditEntityType } from "./auditTypes";
import { useEntityAuditEvents } from "./useEntityAuditEvents";

type EntityAuditHistoryProps = {
  entityType: EntityAuditEntityType;
  entityId: number;
  /** When true, renders the bare event list (no section, always loaded). */
  embedded?: boolean;
  /** Start expanded. Default: collapsed — the list can be very long. */
  defaultOpen?: boolean;
};

/**
 * The change history of one record.
 *
 * Collapsed by default and *not fetched* until first opened: the audit RPC
 * is the most expensive read on an entity surface and most visits never
 * need it. Once open, the head shows how many entries are loaded ("12" or
 * "20+" while more pages exist) — the RPC returns no total, so no total is
 * claimed. Audit authority and semantics are untouched; this is presentation.
 */
export const EntityAuditHistory = ({
  entityType,
  entityId,
  embedded = false,
  defaultOpen = false,
}: EntityAuditHistoryProps) => (
  <CanAccess resource="audit_events" action="show">
    {embedded ? (
      <EntityAuditHistoryBody
        entityType={entityType}
        entityId={entityId}
        enabled
      />
    ) : (
      <CollapsibleEntityAuditHistory
        entityType={entityType}
        entityId={entityId}
        defaultOpen={defaultOpen}
      />
    )}
  </CanAccess>
);

const CollapsibleEntityAuditHistory = ({
  entityType,
  entityId,
  defaultOpen,
}: {
  entityType: EntityAuditEntityType;
  entityId: number;
  defaultOpen: boolean;
}) => {
  const translate = useTranslate();
  const [open, setOpen] = useState(defaultOpen);
  // Once opened, keep the query alive so closing/opening does not refetch.
  const [everOpened, setEverOpened] = useState(defaultOpen);
  const query = useEntityAuditEvents(entityType, entityId, {
    enabled: everOpened,
  });
  const loaded = query.data?.pages.reduce((n, p) => n + p.data.length, 0);

  const summary =
    everOpened && loaded != null && !query.isPending
      ? query.hasNextPage
        ? translate("crm.audit.entries_loaded_more", {
            smart_count: loaded,
          })
        : translate("crm.audit.entries_loaded", { smart_count: loaded })
      : translate("crm.audit.collapsed_hint");

  return (
    <NoraExpandableSection
      title={translate("crm.audit.history_title")}
      summary={summary}
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) setEverOpened(true);
      }}
      keepMounted={everOpened}
    >
      <EntityAuditHistoryBody
        entityType={entityType}
        entityId={entityId}
        enabled={everOpened}
      />
    </NoraExpandableSection>
  );
};

const EntityAuditHistoryBody = ({
  entityType,
  entityId,
  enabled,
}: {
  entityType: EntityAuditEntityType;
  entityId: number;
  enabled: boolean;
}) => {
  const translate = useTranslate();
  const { dealStages, currency } = useConfigurationContext();
  const query = useEntityAuditEvents(entityType, entityId, { enabled });

  const events = useMemo(
    () => query.data?.pages.flatMap((page) => page.data) ?? [],
    [query.data],
  );

  const formatContext = useMemo(
    () => ({
      dealStages,
      currency,
      translateEvent: (eventType: string) =>
        translate(`crm.audit.events.${eventType}`, { _: eventType }),
      translateField: (field: string) =>
        translate(`crm.audit.fields.${field}`, { _: field }),
    }),
    [currency, dealStages, translate],
  );

  if (query.isPending) {
    return (
      <div className="flex justify-center py-8">
        <Spinner />
      </div>
    );
  }

  if (query.error) {
    return (
      <NoraQueryError error={query.error} onRetry={() => query.refetch()} />
    );
  }

  if (!events.length) {
    return (
      <NoraEmptyState
        title={translate("crm.audit.empty.title")}
        description={translate("crm.audit.empty.description")}
      />
    );
  }

  return (
    <div className="space-y-4">
      {events.map((event, index) => (
        <Fragment key={event.id}>
          <AuditEventRow event={event} formatContext={formatContext} />
          {index < events.length - 1 ? <Separator /> : null}
        </Fragment>
      ))}

      {query.hasNextPage ? (
        <div className="flex justify-center pt-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={query.isFetchingNextPage}
            onClick={() => query.fetchNextPage()}
            className="gap-2"
          >
            {query.isFetchingNextPage ? (
              <Spinner />
            ) : (
              <>
                <ChevronDown className="h-4 w-4" aria-hidden />
                {translate("crm.audit.load_more")}
              </>
            )}
          </Button>
        </div>
      ) : null}
    </div>
  );
};

const AuditEventRow = ({
  event,
  formatContext,
}: {
  event: AuditEvent;
  formatContext: Parameters<typeof formatAuditFieldValue>[2];
}) => {
  const translate = useTranslate();
  const changes = parseAuditChanges(event);
  const changeEntries = Object.entries(changes);
  const hasChanges = changeEntries.length > 0;

  return (
    <article className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="space-y-1 min-w-0">
          <p className="font-medium text-sm">
            {formatAuditEventLabel(event.event_type, formatContext)}
          </p>
          <p className="text-xs text-muted-foreground">
            {formatAuditDateTime(event.created_at)}
            {" · "}
            {formatAuditActor(event)}
            {event.actor_role_snapshot
              ? ` (${translate(`crm.audit.roles.${event.actor_role_snapshot}`, {
                  _: event.actor_role_snapshot,
                })})`
              : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-1 shrink-0">
          {event.source ? (
            <Badge variant="outline" className="text-xs">
              {formatAuditSource(event.source, (key) => translate(key))}
            </Badge>
          ) : null}
        </div>
      </div>

      {hasChanges ? (
        <Accordion type="single" collapsible className="w-full">
          <AccordionItem value="changes" className="border-none">
            <AccordionTrigger className="py-2 text-xs text-muted-foreground hover:no-underline">
              {translate("crm.audit.show_changes", {
                smart_count: changeEntries.length,
                count: changeEntries.length,
              })}
            </AccordionTrigger>
            <AccordionContent>
              <AuditChangeList
                changes={changes}
                formatContext={formatContext}
              />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : null}
    </article>
  );
};

const AuditChangeList = ({
  changes,
  formatContext,
}: {
  changes: Record<string, { old: unknown; new: unknown }>;
  formatContext: Parameters<typeof formatAuditFieldValue>[2];
}) => {
  const translate = useTranslate();
  const noteMeta = isAuditNoteContentMeta(changes);

  if (noteMeta) {
    const oldPreview = changes.old_preview?.old ?? changes.old_preview?.new;
    const newPreview = changes.new_preview?.new ?? changes.new_preview?.old;
    return (
      <dl className="space-y-2 text-sm">
        <div>
          <dt className="text-xs text-muted-foreground">
            {translate("crm.audit.note_before")}
          </dt>
          <dd className="whitespace-pre-wrap break-words">
            {formatAuditFieldValue("old_preview", oldPreview, formatContext)}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">
            {translate("crm.audit.note_after")}
          </dt>
          <dd className="whitespace-pre-wrap break-words">
            {formatAuditFieldValue("new_preview", newPreview, formatContext)}
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <dl className="space-y-2 text-sm">
      {Object.entries(changes).map(([field, change]) => (
        <div key={field}>
          <dt className="text-xs text-muted-foreground">
            {formatAuditFieldLabel(field, formatContext)}
          </dt>
          <dd className="flex flex-wrap items-center gap-2 break-words">
            <span className="text-muted-foreground line-through">
              {formatAuditFieldValue(field, change.old, formatContext)}
            </span>
            <span aria-hidden>→</span>
            <span>
              {formatAuditFieldValue(field, change.new, formatContext)}
            </span>
          </dd>
        </div>
      ))}
    </dl>
  );
};
