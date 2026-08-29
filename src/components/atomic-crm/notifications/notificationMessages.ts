/**
 * Notification message grammar (Phase 7B.1).
 *
 * Every visible sentence is built deterministically from an i18n key plus the
 * whitelisted display context — never generated, never concatenated from raw
 * strings, never taken from OPERATION_CATALOG (whose German literals are not
 * i18n keys and carry no placeholders).
 *
 * German grammar rules (docs/nora/06-decision-log.md, Phase 7A):
 * - Title: noun + participle, no article, no exclamation mark.
 * - pending: present passive ("wird erstellt"), success: elliptic perfect
 *   ("erstellt"), error: "konnte nicht … werden".
 * - Never "erfolgreich", never an emoji.
 */

import type {
  NotificationDisplayContext,
  NotificationLifecycle,
  NotificationMessage,
} from "./notificationModel";

export const NOTIFICATION_MESSAGE_ROOT = "crm.notifications";

/** Screen-reader label of the live region (consumed by 7B.2). */
export const NOTIFICATION_REGION_LABEL_KEY = `${NOTIFICATION_MESSAGE_ROOT}.region_label`;

export const notificationNamespace = (intent: string): string =>
  `${NOTIFICATION_MESSAGE_ROOT}.${intent}`;

/**
 * The key that carries the "why is this only partially done" sentence for an
 * intent. Required by every `partial` state.
 */
export const partialDetailKey = (namespace: string): string =>
  `${namespace}.partial.detail`;

/**
 * Builds title + body keys for one lifecycle.
 *
 * A missing display value selects a DIFFERENT key instead of rendering an
 * empty placeholder:
 * - dealTitle + customerName → `<ns>.<lifecycle>.body`
 * - dealTitle only          → `<ns>.<lifecycle>.body_no_customer`
 * - neither                 → no body at all (title carries the message)
 */
export const buildNotificationMessage = (input: {
  namespace: string;
  lifecycle: NotificationLifecycle;
  displayContext: NotificationDisplayContext;
}): NotificationMessage => {
  const { namespace, lifecycle, displayContext } = input;
  const base = `${namespace}.${lifecycle}`;

  const subject = displayContext.dealTitle ?? displayContext.taskTitle;
  const hasSubject = typeof subject === "string" && subject.length > 0;
  const hasCustomer =
    typeof displayContext.customerName === "string" &&
    displayContext.customerName.length > 0;

  const bodyKey = !hasSubject
    ? undefined
    : hasCustomer
      ? `${base}.body`
      : `${base}.body_no_customer`;

  return {
    titleKey: `${base}.title`,
    ...(bodyKey ? { bodyKey } : {}),
    args: displayContext,
  };
};
