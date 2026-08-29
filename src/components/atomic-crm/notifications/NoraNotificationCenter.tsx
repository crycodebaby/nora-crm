/**
 * Nora notification center (Phase 7B.2).
 *
 * Subscribes to the NotificationStore and renders the visible window. Not
 * mounted into the Nora layouts yet — that is 7B.4.
 *
 * Accessibility architecture (7B.2 correction): the visual stack carries NO
 * live semantics. It is a plain labelled region so a screen-reader user can
 * navigate to it and read cards on demand. Every announcement comes from
 * NoraNotificationAnnouncer, the single owner of the live regions — see the
 * duplicate-announcement analysis in that file.
 *
 * Positioning (docs/nora/06-decision-log.md, Phase 7A section K):
 * - Desktop/tablet: bottom right, so it does not collide with the existing
 *   bottom-centre sonner toaster during the migration.
 * - Mobile: full width above MobileNavigation (fixed bottom-0, h-16) plus the
 *   safe area inset.
 * - z-index 60 (Phase 7B.4b): ABOVE the Radix dialog layer (z-50). Status
 *   notifications report the user's own action and must stay readable
 *   whatever surface is open — the original z-40 left them under the
 *   Vorgangsakte modal the Quick Capture flow redirects into. Stacking only:
 *   the region is pointer-events:none and still never covers
 *   MobileNavigation geometrically (mobile offset in index.css).
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
