/**
 * Dedicated screen-reader announcer (Phase 7B.2 accessibility correction).
 *
 * The visual card stack is deliberately NOT a live region. Nested/overlapping
 * live regions (a polite container wrapping polite status cards, plus a
 * separate alert node) announced a pending→error transition twice: once from
 * the card whose text changed, once from the alert. This module owns the only
 * live regions in the notification layer.
 *
 * Guarantee: exactly ONE announcement per (notification, lifecycle) transition,
 * routed to exactly one channel — assertive for `error`, polite for everything
 * else. A message is never written to both.
 */

import { useTranslate } from "ra-core";
import { useEffect, useRef, useState } from "react";

import type { NotificationRecord } from "./notificationModel";

/**
 * One announcement event. `sequence` is the identity of the EVENT, not of its
 * wording: two consecutive announcements with identical text are still two
 * events. It is rendered as the React key of the region's only child, so a
 * repeat replaces the child node and the live region fires again — without
 * altering a single character of the spoken text.
 *
 * (Rejected alternative: alternating trailing whitespace. It made an invisible
 * character carry the semantics, and it polluted textContent so tests could
 * only match loosely.)
 */
type Announcement = { sequence: number; text: string };

const transitionKey = (record: NotificationRecord): string =>
  `${record.notificationId}:${record.state.lifecycle}`;

const AnnouncerRegion = ({
  testId,
  role,
  live,
  announcement,
}: {
  testId: string;
  role: "status" | "alert";
  live: "polite" | "assertive";
  announcement: Announcement | null;
}) => (
  <div
    data-testid={testId}
    role={role}
    aria-live={live}
    aria-atomic="true"
    className="sr-only"
  >
    {announcement ? (
      <span key={announcement.sequence}>{announcement.text}</span>
    ) : null}
  </div>
);

export type NoraNotificationAnnouncerProps = {
  /** The records currently on screen — never the whole store. */
  visible: readonly NotificationRecord[];
};

export const NoraNotificationAnnouncer = ({
  visible,
}: NoraNotificationAnnouncerProps) => {
  const translate = useTranslate();
  const announced = useRef(new Set<string>());
  const sequence = useRef(0);
  const [polite, setPolite] = useState<Announcement | null>(null);
  const [assertive, setAssertive] = useState<Announcement | null>(null);

  useEffect(() => {
    const fresh = visible.filter(
      (record) => !announced.current.has(transitionKey(record)),
    );
    if (fresh.length === 0) return;
    for (const record of fresh) {
      announced.current.add(transitionKey(record));
    }

    const speak = (record: NotificationRecord): string => {
      const parts = [translate(record.message.titleKey)];
      if (record.message.bodyKey) {
        parts.push(
          translate(record.message.bodyKey, { ...record.message.args }),
        );
      }
      if (
        record.state.lifecycle === "error" ||
        record.state.lifecycle === "partial"
      ) {
        parts.push(translate(record.state.detailKey));
      }
      return parts.join(". ");
    };

    // Each record lands in exactly one bucket — never both.
    const assertiveTexts = fresh
      .filter((record) => record.state.lifecycle === "error")
      .map(speak);
    const politeTexts = fresh
      .filter((record) => record.state.lifecycle !== "error")
      .map(speak);

    if (politeTexts.length > 0) {
      sequence.current += 1;
      setPolite({ sequence: sequence.current, text: politeTexts.join(" ") });
    }
    if (assertiveTexts.length > 0) {
      sequence.current += 1;
      setAssertive({
        sequence: sequence.current,
        text: assertiveTexts.join(" "),
      });
    }
  }, [visible, translate]);

  return (
    <>
      <AnnouncerRegion
        testId="nora-notification-announcer-polite"
        role="status"
        live="polite"
        announcement={polite}
      />
      <AnnouncerRegion
        testId="nora-notification-announcer-assertive"
        role="alert"
        live="assertive"
        announcement={assertive}
      />
    </>
  );
};
