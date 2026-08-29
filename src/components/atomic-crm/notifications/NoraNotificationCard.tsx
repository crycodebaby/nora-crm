/**
 * Nora notification card (Phase 7B.2).
 *
 * Renders exactly one NotificationRecord. It owns no state and no timers —
 * every transition comes from the store; the card only draws it and reports
 * hover/focus so auto-dismiss can pause.
 *
 * Accessibility rules encoded here:
 * - The card carries NO live-region semantics. Screen-reader output comes
 *   exclusively from NoraNotificationAnnouncer, so one lifecycle transition
 *   produces exactly one announcement.
 * - The close control is at least 44×44 px (`--nora-touch-min`).
 * - The detail line is never clamped — it carries the actionable part.
 * - Colour is never alone: tone always ships with an icon and explicit wording.
 */

import { useTranslate } from "ra-core";
import {
  BotIcon,
  CircleCheckIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
  XIcon,
} from "lucide-react";
import type { ComponentType } from "react";

import { cn } from "@/lib/utils";
import {
  notificationTone,
  type NotificationRecord,
  type NotificationTone,
} from "./notificationModel";

const ICON_BY_TONE: Record<
  NotificationTone,
  ComponentType<{ className?: string }>
> = {
  pending: Loader2Icon,
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  error: OctagonXIcon,
};

export type NoraNotificationCardProps = {
  record: NotificationRecord;
  onDismiss: (notificationId: string) => void;
  onPauseDismiss?: (notificationId: string) => void;
  onResumeDismiss?: (notificationId: string) => void;
};

export const NoraNotificationCard = ({
  record,
  onDismiss,
  onPauseDismiss,
  onResumeDismiss,
}: NoraNotificationCardProps) => {
  const translate = useTranslate();
  const tone = notificationTone(record.state);
  const Icon = ICON_BY_TONE[tone];
  const detailKey =
    record.state.lifecycle === "partial" || record.state.lifecycle === "error"
      ? record.state.detailKey
      : undefined;

  const pause = () => onPauseDismiss?.(record.notificationId);
  const resume = () => onResumeDismiss?.(record.notificationId);

  return (
    <li
      // Deliberately NOT role="status": that would make every card an implicit
      // polite live region nested inside the stack, and a pending→error
      // transition would then be announced twice (once here, once by the
      // announcer). All announcements are owned by NoraNotificationAnnouncer.
      data-tone={tone}
      data-lifecycle={record.state.lifecycle}
      data-testid="nora-notification-card"
      className="nora-notification-card nora-notification-enter"
      onMouseEnter={pause}
      onMouseLeave={resume}
      // React focus/blur bubble, so this behaves like :focus-within.
      onFocus={pause}
      onBlur={resume}
    >
      <Icon
        aria-hidden="true"
        className={cn(
          "nora-notification-icon",
          tone === "pending" && "nora-notification-spin",
        )}
      />
      <div className="min-w-0 flex-1">
        {/* Provenance is shown only for a non-human initiator — a normal own
            action must not carry a redundant "you did this" line. */}
        {record.initiator.kind !== "human" && record.initiator.label ? (
          <p
            className="nora-notification-origin"
            data-testid="nora-notification-origin"
          >
            <BotIcon aria-hidden="true" className="size-3.5" />
            {record.initiator.label}
          </p>
        ) : null}
        <p className="nora-notification-title">
          {translate(record.message.titleKey)}
        </p>
        {record.message.bodyKey ? (
          <p className="nora-notification-body">
            {translate(record.message.bodyKey, { ...record.message.args })}
          </p>
        ) : null}
        {detailKey ? (
          <p className="nora-notification-detail">{translate(detailKey)}</p>
        ) : null}
      </div>
      <button
        type="button"
        className="nora-notification-close"
        aria-label={translate("ra.action.close")}
        onClick={() => onDismiss(record.notificationId)}
      >
        <XIcon aria-hidden="true" className="size-4" />
      </button>
    </li>
  );
};
