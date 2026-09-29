import type { Types } from "mongoose";
import type {
  NotificationChannelName,
  NotificationType,
} from "@/modules/notifications/notification.model";
import { AppError } from "@/shared/errors/app-error";

/**
 * How a notification leaves the system.
 *
 * The channel is a seam, not a strategy hierarchy. There is exactly one real
 * implementation today, and the reason for the interface is that a call site
 * should not have to change when a second one appears: `notify()` names a
 * channel, and whichever one that is, it delivers.
 */

export interface NotificationToDeliver {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, unknown>;
  dedupeKey?: string;
  /**
   * When the thing happened, as opposed to when this call was made. A replayed
   * event must not arrive in the bell as if it had just occurred, or a
   * redelivery reorders history.
   */
  occurredAt?: Date;
}

export interface NotificationChannel {
  readonly channel: NotificationChannelName;
  deliver(notification: NotificationToDeliver): Promise<void>;
}

/**
 * Asking for a channel that does not exist is a bug, not a delivery outcome.
 *
 * The tempting behaviour is to record the notification and quietly skip
 * delivery, on the reasoning that a stored row is better than a thrown error.
 * It is the opposite: the caller believes an email went to a customer, the row
 * sits unread in a bell nobody is watching, and the failure surfaces days later
 * as a support ticket. A loud failure at the call site is recoverable in
 * minutes; a silent no-op is not.
 *
 * Not exposed to the client: it says "this deployment has no email provider",
 * which is useful to a developer and nothing to a user. Reusing
 * CONFIGURATION_INVALID rather than adding a code, because that is what it is -
 * a gap in what this deployment can do - and the catalogue already reserves the
 * not-exposed 500s for exactly this class of thing.
 */
export function unsupportedChannel(channel: NotificationChannelName): AppError {
  return AppError.internal(
    `notification channel ${channel} is not implemented in this deployment`,
    new Error(`unsupported notification channel: ${channel}`),
  );
}
