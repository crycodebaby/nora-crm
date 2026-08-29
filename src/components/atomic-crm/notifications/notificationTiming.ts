/**
 * Notification timing (Phase 7B.1).
 *
 * Operations can settle in ~80–150 ms (the Quick Capture core RPC is a single
 * transaction). Without a reveal delay the user sees pending flash → success →
 * gone, which reads as a glitch rather than as speed.
 *
 * This is the ONLY place where the presentation layer shifts the technical
 * truth in TIME. It never shifts it in CONTENT.
 */

export type NotificationTiming = {
  /** Below this, no pending card is rendered at all. */
  pendingRevealDelayMs: number;
  /** Once pending IS visible, it stays at least this long before flipping. */
  pendingMinVisibleMs: number;
  /** Success auto-dismiss, measured from when the success state is displayed. */
  successVisibleMs: number;
  /** Partial/warning stays longer than success — it carries an open item. */
  warningVisibleMs: number;
};

export const NOTIFICATION_TIMING: NotificationTiming = {
  pendingRevealDelayMs: 350,
  pendingMinVisibleMs: 500,
  successVisibleMs: 4_500,
  warningVisibleMs: 10_000,
};

/**
 * Auto-dismiss duration per lifecycle. `null` = never auto-dismiss.
 * Errors persist until the user closes them — a failed write may still need
 * an action, and a disappearing failure is worse than a lingering one.
 */
export const dismissDurationMs = (
  lifecycle: "pending" | "success" | "partial" | "error",
  timing: NotificationTiming = NOTIFICATION_TIMING,
): number | null => {
  switch (lifecycle) {
    case "success":
      return timing.successVisibleMs;
    case "partial":
      return timing.warningVisibleMs;
    // Pending never auto-dismisses, and a long-running pending is NEVER
    // reinterpreted as an error (Guardrail, Phase 7A).
    case "pending":
    case "error":
      return null;
  }
};

/**
 * Two different limits with two different guarantees — deliberately not
 * conflated (Phase 7B.1 correction):
 *
 * - `maxVisible` is a HARD presentation limit. Never more cards on screen,
 *   no exception. Enforced by `selectVisibleNotifications`.
 * - `retentionSoftCap` is a BEST-EFFORT retention target, not a memory
 *   guarantee. Only SETTLED entries are evictable; a pending entry is never
 *   dropped, so concurrent in-flight intents can push the live count above
 *   this value. See `enforceRetentionSoftCap` for the exact rule.
 */
export type NotificationCapacity = {
  /** Hard cap on simultaneously rendered cards. */
  maxVisible: number;
  /**
   * Retention target for settled entries. NOT a hard bound on the store —
   * see the type doc above.
   */
  retentionSoftCap: number;
};

export const NOTIFICATION_CAPACITY: NotificationCapacity = {
  maxVisible: 3,
  retentionSoftCap: 10,
};
