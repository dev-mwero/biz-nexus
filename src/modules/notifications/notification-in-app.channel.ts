import { NotificationModel } from "@/modules/notifications/notification.model";
import type {
  NotificationChannel,
  NotificationToDeliver,
} from "@/modules/notifications/notification-channel";

/**
 * The in-app channel: the bell.
 *
 * `notify()` has always named `IN_APP`, and until now nothing answered to that
 * name, so every call threw `unsupportedChannel` in production. Worse, the only
 * thing that ever registered a handler was the notification integration test,
 * which registered its own double — so the one place the "real" channel existed
 * was the one place that never runs in production. This is the handler the
 * service was written against.
 *
 * Delivery is a single insert, and that insert *is* the notification. There is
 * no queue, no provider, and no second store: the row a user later reads in the
 * bell is the row written here. That is why the channel is a plain object and
 * not a class — there is no connection to hold, no client to configure, and
 * nothing to close.
 *
 * Two fields are forwarded carefully rather than spread wholesale:
 *
 * - `dedupeKey` is passed through only when present. The unique index behind it
 *   is partial on `{ dedupeKey: { $type: "string" } }`, so an explicit
 *   `dedupeKey: undefined` is a document without the field and the insert
 *   succeeds; but writing the key as `undefined` at all is the kind of thing a
 *   later schema default could turn into a stored `null` and a collision for
 *   every undeduped notification.
 * - `occurredAt` becomes `createdAt`. The bell sorts by `createdAt` and shows
 *   it as "when", so a replayed event must carry the time it happened rather
 *   than the time it was replayed, or the list reorders itself on a redelivery.
 */
export const inAppChannel: NotificationChannel = {
  channel: "IN_APP",
  async deliver(notification: NotificationToDeliver): Promise<void> {
    await NotificationModel.create({
      organizationId: notification.organizationId,
      userId: notification.userId,
      type: notification.type,
      channel: "IN_APP",
      title: notification.title,
      body: notification.body,
      data: notification.data,
      ...(notification.dedupeKey ? { dedupeKey: notification.dedupeKey } : {}),
      ...(notification.occurredAt
        ? { createdAt: notification.occurredAt }
        : {}),
    });
  },
};
