import type { Types } from "mongoose";
import {
  type Notification,
  type NotificationChannelName,
  NotificationModel,
  type NotificationType,
} from "@/modules/notifications/notification.model";
import {
  type NotificationChannel,
  type NotificationToDeliver,
  unsupportedChannel,
} from "@/modules/notifications/notification-channel";
import { AppError } from "@/shared/errors/app-error";
import { redact } from "@/shared/lib/redact";

/**
 * The bell.
 *
 * Every read here is scoped by `organizationId` *and* `userId`. Scoping by
 * `organizationId` alone is the bug this module is most likely to grow: the
 * organization is the tenant, and a notification is addressed to one person, so
 * "in this tenant" is necessary and not sufficient. A notification id is
 * therefore never enough to read one, and a miss is RECORD_NOT_FOUND whether
 * the row is absent, another user's, or in another tenant - the same answer in
 * all three cases, so an id cannot be probed.
 */

export interface NotifyInput {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  title: string;
  body: string;
  /** Deep link and entity references. Redacted before it is stored. */
  data?: Record<string, unknown>;
  /**
   * Makes the send idempotent. A redelivered event with the same key produces
   * no second row, and no error: the caller asked once and the effect happened
   * once, which is the outcome they wanted.
   */
  dedupeKey?: string;
  channel?: NotificationChannelName;
  /** Set from an event payload, so a replay cannot backdate the notification. */
  occurredAt?: Date;
}

/**
 * Channels, by name.
 *
 * A registry rather than a `switch`, so that adding EMAIL is adding a function
 * and a line here, and not a branch in the middle of `notify`. A channel that
 * is not registered throws: see `unsupportedChannel`.
 */
const CHANNELS: Partial<Record<NotificationChannelName, NotificationChannel>> =
  {};

export function registerChannel(channel: NotificationChannel): void {
  CHANNELS[channel.channel] = channel;
}

export function registeredChannels(): NotificationChannelName[] {
  return Object.keys(CHANNELS) as NotificationChannelName[];
}

/**
 * Deliver one notification.
 *
 * Returns the row, or `null` when the same `dedupeKey` had already been
 * delivered. `null` rather than a throw, and rather than the existing row: a
 * redelivered event is a success from the caller's point of view, and handing
 * back a second copy of the notification would invite a caller to treat "I got
 * one" as a new delivery and act on it twice.
 */
export async function notify(input: NotifyInput): Promise<Notification | null> {
  const channel = input.channel ?? "IN_APP";
  const handler = CHANNELS[channel];
  if (!handler) throw unsupportedChannel(channel);

  const payload: NotificationToDeliver = {
    organizationId: input.organizationId,
    userId: input.userId,
    type: input.type,
    title: input.title,
    body: input.body,
    // A deep link is built from ids and occasionally from a one-time token, and
    // this row is shown in a list for as long as the notification exists.
    data: (redact(input.data ?? {}) as Record<string, unknown>) ?? {},
    ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
    ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
  };

  try {
    await handler.deliver(payload);
  } catch (error) {
    // Only the dedupe conflict is expected, and only for IN_APP. Anything else
    // - a network failure to a real provider, say - is a genuine failure and
    // must not be mistaken for "already sent".
    if (isDuplicateKey(error)) return null;
    throw error;
  }

  return null;
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

export interface ReadScope {
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
}

/**
 * Mark one notification read.
 *
 * Idempotent, and `readAt` is only ever set once: a second click updates
 * nothing, so the time recorded is when the user actually first read it and not
 * when they last touched it. Marking an already-read notification is a success,
 * not a conflict - a double-click on a button should not raise an error.
 */
export async function markRead(
  scope: ReadScope,
  notificationId: Types.ObjectId,
  at: Date = new Date(),
): Promise<Notification> {
  const updated = await NotificationModel.findOneAndUpdate(
    {
      _id: notificationId,
      organizationId: scope.organizationId,
      userId: scope.userId,
      readAt: null,
    },
    { $set: { readAt: at } },
    { returnDocument: "after" },
  );

  if (updated) return updated;

  // Either it was already read, or it is not this user's to read. Re-fetching
  // is what distinguishes the two, and the two are then treated identically.
  const existing = await NotificationModel.findOne({
    _id: notificationId,
    organizationId: scope.organizationId,
    userId: scope.userId,
  });

  if (!existing) throw AppError.notFound();
  return existing;
}

/** Mark everything unread as read. Scoped, so it cannot touch another user. */
export async function markAllRead(
  scope: ReadScope,
  at: Date = new Date(),
): Promise<number> {
  const result = await NotificationModel.updateMany(
    {
      organizationId: scope.organizationId,
      userId: scope.userId,
      readAt: null,
    },
    { $set: { readAt: at } },
  );

  return result.modifiedCount;
}

export const BELL_PAGE_SIZE = 20;

export interface ListNotificationsInput extends ReadScope {
  limit?: number;
  /**
   * Newest-first cursor: the `createdAt` of the last row from the previous
   * page. Keyset rather than an offset, because a notification can arrive
   * between two requests and an offset would then skip or repeat a row - which
   * for a list that ends in "everything is read" means a notification that is
   * silently never shown.
   */
  before?: Date;
}

/**
 * The bell's contents, newest first.
 *
 * Not `listQuery`. That builder lets the caller choose a sort from an
 * allow-list, and for a bell the order is part of the answer, not a preference:
 * newest first is what a user means by "notifications". Allowing a caller to
 * re-sort it would make every ordering a special case somewhere in the UI.
 */
export async function listNotifications(
  input: ListNotificationsInput,
): Promise<Notification[]> {
  const limit = Math.min(Math.max(input.limit ?? BELL_PAGE_SIZE, 1), 100);

  return NotificationModel.find({
    organizationId: input.organizationId,
    userId: input.userId,
    ...(input.before ? { createdAt: { $lt: input.before } } : {}),
  })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit)
    .lean<Notification[]>()
    .exec();
}

export async function unreadCount(scope: ReadScope): Promise<number> {
  return NotificationModel.countDocuments({
    organizationId: scope.organizationId,
    userId: scope.userId,
    readAt: null,
  });
}
