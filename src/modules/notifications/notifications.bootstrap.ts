import { registerChannel } from "@/modules/notifications/notification.service";
import { registerNotificationSubscribers } from "@/modules/notifications/notification.subscriber";
import { inAppChannel } from "@/modules/notifications/notification-in-app.channel";

/**
 * Turn the notifications subsystem on.
 *
 * Two halves that only work together. `registerChannel` installs the handler
 * that answers to `IN_APP`; `registerNotificationSubscribers` attaches the
 * listeners that turn domain events into `notify()` calls. Without the channel,
 * every `notify()` throws `unsupportedChannel`. Without the subscribers, no
 * event ever reaches `notify()`. Both used to be missing from production, and
 * only a test installed either.
 *
 * Called from `instrumentation.node.ts` at server startup. Returns a stop
 * function for tests; production never calls it.
 */
export function registerNotifications(): () => void {
  registerChannel(inAppChannel);
  return registerNotificationSubscribers();
}
