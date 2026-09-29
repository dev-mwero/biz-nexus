import mongoose, { type Model, Schema, type Types } from "mongoose";

/**
 * A notification addressed to one user.
 *
 * Per docs/DATABASE.md §8. Global vs tenant: the row is tenant-owned by
 * `organizationId` because the bell is an organization-scoped surface, but it is
 * addressed to a single `userId` and no read path may cross that boundary. A
 * notification is never visible to anyone but its recipient.
 *
 * `updatedAt` is present, unlike the audit log, because `readAt` is written
 * after creation. This collection is mutable by design.
 */

export const NOTIFICATION_TYPES = [
  "TASK_ASSIGNED",
  "MENTION",
  "DEAL_ASSIGNED",
  "TASK_OVERDUE",
  "SYSTEM",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/**
 * Only IN_APP is implemented. The rest exist in the type so that adding a
 * provider later is not a change to every call site's types, and so the schema
 * can record what was intended even where delivery is not yet available.
 */
export const NOTIFICATION_CHANNELS = [
  "IN_APP",
  "EMAIL",
  "SMS",
  "PUSH",
  "WHATSAPP",
] as const;

export type NotificationChannelName = (typeof NOTIFICATION_CHANNELS)[number];

export interface Notification {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  type: NotificationType;
  channel: NotificationChannelName;
  title: string;
  body: string;
  /** Deep link and entity references. Redacted before it is written. */
  data: Record<string, unknown>;
  /**
   * Idempotency for a redelivered event. Absent, not null, when unused: see the
   * index below for why that distinction is load-bearing.
   */
  dedupeKey?: string;
  /** First read, not last touched. Set once and never rewritten. */
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<Notification>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Organization",
    },
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    type: { type: String, required: true, enum: NOTIFICATION_TYPES },
    channel: {
      type: String,
      required: true,
      enum: NOTIFICATION_CHANNELS,
      default: "IN_APP",
    },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: { type: Schema.Types.Mixed, default: () => ({}) },
    // No default. A `null` default would be indexed by a sparse unique index,
    // and every notification without a dedupe key for one user would then
    // collide with every other.
    dedupeKey: { type: String },
    readAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "notifications" },
);

// The bell, and the unread count beside it.
notificationSchema.index({
  organizationId: 1,
  userId: 1,
  readAt: 1,
  createdAt: -1,
});

// Idempotency, and nothing else.
//
// A *sparse* unique index is the obvious reading of the spec and it is wrong:
// sparse skips documents missing the field, and a schema default of `null` is
// not a missing field, so every undeduped notification for a user would collide
// on the null. A partial filter is explicit about the only case that should be
// unique - a document that actually carries a string key - and cannot be broken
// by a later change to the default.
notificationSchema.index(
  { organizationId: 1, userId: 1, dedupeKey: 1 },
  {
    unique: true,
    partialFilterExpression: { dedupeKey: { $type: "string" } },
    name: "notification_dedupe_unique",
  },
);

export const NotificationModel: Model<Notification> =
  (mongoose.models.Notification as Model<Notification>) ??
  mongoose.model<Notification>("Notification", notificationSchema);

export const notificationSchemaDefinition = notificationSchema;
