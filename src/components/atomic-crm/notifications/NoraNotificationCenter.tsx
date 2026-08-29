/**
 * Nora notification center (Phase 7B.2).
 *
 * Subscribes to the NotificationStore and renders the visible window. Mounted
 * into both Nora layouts since 7B.4 via NoraNotificationOutlet; it keeps its
 * explicit `store` prop so it stays testable in isolation.
 *
 * Accessibility architecture (7B.2 correction): the visual stack carries NO
 * live semantics. It is a plain labelled region so a screen-reader user can
 * navigate to it and read cards on demand. Every announcement comes from
 * NoraNotificationAnnouncer, the single owner of the live regions — see the
 * duplicate-announcement analysis in that file.
 *
 * Positioning — final rule as of 7B.4c (docs/nora/06-decision-log.md,
 * "Phase 7B.4c: modal-aware Placement — Endstand"). Two requirements hold at
 * once: a status card must stay readable whatever surface is open, and it must
 * never block the action it reports on.
 * - No dialog open: desktop/tablet bottom right (clear of the bottom-centre
 *   sonner toaster still used by the unmigrated flows); mobile full width
 *   above MobileNavigation (fixed bottom-0, h-16) plus the safe area inset.
 * - Dialog or sheet open: the stack leaves the footer zone for the header area
 *   (desktop top-centred, mobile below the dialog header), only the newest card
 *   is shown, and the card body becomes click-through.
 * - z-index 60 on BOTH breakpoints: above the Radix dialog layer (z-50), the
 *   smallest clean step above it. The 7B.4b mobile exception (z-40) is gone —
 *   it only made the card invisible again.
 * All of the above lives in index.css; nothing is re-declared here. The region
 * is always pointer-events:none and never covers MobileNavigation.
 */

import { useTranslate } from "ra-core";
import { useSyncExternalStore } from "react";

import { useIsMobile } from "@/hooks/use-mobile";
import { cn } from "@/lib/utils";
import { NoraNotificationAnnouncer } from "./NoraNotificationAnnouncer";
import { NoraNotificationCard } from "./NoraNotificationCard";
import { NOTIFICATION_REGION_LABEL_KEY } from "./notificationMessages";
import {
  selectVisibleNotifications,
  type NotificationStore,
} from "./notificationStore";

/** Hard on-screen limits. Mobile has less room and a lower tolerance. */
export const VISIBLE_LIMIT_DESKTOP = 3;
export const VISIBLE_LIMIT_MOBILE = 2;

export type NoraNotificationCenterProps = {
  store: NotificationStore;
  /** Test/override hook; defaults to the responsive limit. */
  maxVisible?: number;
  /** Test/override hook; defaults to the media query. */
  forceMobile?: boolean;
};

export const NoraNotificationCenter = ({
  store,
  maxVisible,
  forceMobile,
}: NoraNotificationCenterProps) => {
  const translate = useTranslate();
  const isMobileByViewport = useIsMobile();
  const isMobile = forceMobile ?? isMobileByViewport;

  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
  );

  const limit =
    maxVisible ?? (isMobile ? VISIBLE_LIMIT_MOBILE : VISIBLE_LIMIT_DESKTOP);
  const visible = selectVisibleNotifications(snapshot, limit);

  return (
    <>
      <div
        className={cn(
          "nora-notification-region",
          isMobile && "nora-notification-region-mobile",
        )}
        data-testid="nora-notification-region"
        role="region"
        aria-label={translate(NOTIFICATION_REGION_LABEL_KEY)}
        // Explicit: this stack is NOT a live region. Announcements are owned
        // solely by NoraNotificationAnnouncer, so a card changing from pending
        // to error is announced exactly once.
        aria-live="off"
      >
        <ol className="nora-notification-list">
          {visible.map((record) => (
            <NoraNotificationCard
              key={record.notificationId}
              record={record}
              onDismiss={store.dismiss}
              onPauseDismiss={store.pauseDismiss}
              onResumeDismiss={store.resumeDismiss}
            />
          ))}
        </ol>
      </div>
      <NoraNotificationAnnouncer visible={visible} />
    </>
  );
};
