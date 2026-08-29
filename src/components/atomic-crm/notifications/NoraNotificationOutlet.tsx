/**
 * Mount point for the notification stack inside the Nora layouts (Phase 7B.4).
 *
 * A one-line adapter, deliberately: NoraNotificationCenter (7B.2) keeps its
 * explicit `store` prop so it stays testable in isolation, while the layouts
 * only need to say "render the stack here". All positioning, responsiveness,
 * z-layering and accessibility live in 7B.2 — nothing is re-declared here.
 */

import { NoraNotificationCenter } from "./NoraNotificationCenter";
import { useNotificationStore } from "./NotificationProvider";

export const NoraNotificationOutlet = () => {
  const store = useNotificationStore();
  return <NoraNotificationCenter store={store} />;
};
