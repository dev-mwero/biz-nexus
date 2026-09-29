import mongoose, { type Model, Schema, type Types } from "mongoose";

/**
 * The single timeline for everything that happened.
 *
 * Per docs/DATABASE.md §6. One collection and one shape for many subjects,
 * because a record's history and the organization's feed are the same question
 * asked at two scopes, and a collection per subject type would make "show me
 * everything about Acme" a fan-out.
 *
 * Append-only in practice: an activity is written once. `createdAt` is when it
 * was recorded and `occurredAt` is when it happened, and they are genuinely
 * different - a call logged on Monday about Friday's meeting has an
 * `occurredAt` of Friday. Collapsing them would make a backfilled timeline lie
 * about when things happened.
 */

export const ACTIVITY_TYPES = [
  "NOTE",
  "TASK",
  "CALL",
  "MEETING",
  "SYSTEM_EVENT",
  "STAGE_CHANGE",
  "EMAIL",
  "SMS",
  "WHATSAPP",
] as const;

export type ActivityType = (typeof ACTIVITY_TYPES)[number];

export const ACTIVITY_DIRECTIONS = ["INBOUND", "OUTBOUND"] as const;

export type ActivityDirection = (typeof ACTIVITY_DIRECTIONS)[number];

/** A record this activity is about. More than one, legitimately. */
export interface ActivitySubject {
  entityType: string;
  entityId: Types.ObjectId;
}

export interface Activity {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  type: ActivityType;
  /** Denormalised, so a list renders without loading every subject. */
  title: string;
  /**
   * Plain text. Rendered as text, never as HTML.
   *
   * A timeline renders whatever users typed into notes, messages and deal
   * names. Treating that as markup is stored XSS with a delay, so the type is
   * `String` and every consumer escapes. A field typed as anything richer would
   * make the safe thing optional.
   */
  body: string | null;
  /** Only meaningful for the channels that have one. */
  direction: ActivityDirection | null;
  durationSeconds: number | null;
  /** When it happened. Never the write time. */
  occurredAt: Date;
  /** Null for system events. */
  actorId: Types.ObjectId | null;
  /**
   * Required, unlike `actorId`: an automated event has no actor, but an
   * activity with no owner is attributed to nobody and appears in no
   * attribution report, which is how a task that quietly ran itself gets
   * missed.
   */
  ownerId: Types.ObjectId;
  subjects: ActivitySubject[];
  metadata: Record<string, unknown>;
  createdAt: Date;
}

const subjectSchema = new Schema<ActivitySubject>(
  {
    entityType: { type: String, required: true },
    entityId: {
      type: Schema.Types.ObjectId,
      required: true,
      // No `ref`: the subjects span every module's records, and a ref here
      // would either be wrong for most of them or a string that lies about the
      // model it points at.
    },
  },
  { _id: false },
);

const activitySchema = new Schema<Activity>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Organization",
    },
    type: { type: String, required: true, enum: ACTIVITY_TYPES },
    title: { type: String, required: true },
    body: { type: String, default: null },
    direction: { type: String, enum: ACTIVITY_DIRECTIONS, default: null },
    durationSeconds: { type: Number, default: null },
    occurredAt: { type: Date, required: true },
    actorId: { type: Schema.Types.ObjectId, default: null, ref: "User" },
    ownerId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    subjects: { type: [subjectSchema], default: () => [] },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    collection: "activities",
  },
);

// The per-record timeline. This is the primary read, and it is the reason
// `subjects` is an array.
//
// MongoDB permits at most one array field per compound index, so this is the
// only array path in any index here. A second one - say an index on
// `subjects.entityType` alongside it - is rejected at creation time, not at
// query time, and would take the whole index build with it.
activitySchema.index({
  organizationId: 1,
  "subjects.entityId": 1,
  occurredAt: -1,
});

// The organization feed, with `_id` as a tiebreaker so two activities written in
// the same millisecond have a stable order across pages.
activitySchema.index({ organizationId: 1, occurredAt: -1, _id: -1 });

activitySchema.index({ organizationId: 1, type: 1, occurredAt: -1 });

activitySchema.index({ organizationId: 1, actorId: 1, occurredAt: -1 });

activitySchema.index({ organizationId: 1, ownerId: 1, occurredAt: -1 });

export const ActivityModel: Model<Activity> =
  (mongoose.models.Activity as Model<Activity>) ??
  mongoose.model<Activity>("Activity", activitySchema);

export const activitySchemaDefinition = activitySchema;
