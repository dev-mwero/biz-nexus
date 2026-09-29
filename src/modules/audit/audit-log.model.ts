import mongoose, { type Model, Schema, type Types } from "mongoose";

/**
 * The audit log.
 *
 * Append-only. There is no update path, no delete path, and no soft-delete
 * field, in this service or in any other: an audit log that can be edited is not
 * an audit log, it is a changelog with extra steps. `tests/unit/architecture/
 * audit-log.test.ts` enforces that by scanning the source, because the guarantee
 * here is the absence of code, and nothing in the type system can express the
 * absence of a method.
 *
 * The schema has no `updatedAt` on purpose. `timestamps: true` would add one,
 * and its presence is the signal that a document is expected to change.
 *
 * `actorName` and `entityLabel` are denormalised copies. Both exist so a row
 * still reads correctly after the user is deleted, or the record renamed: an
 * audit log that renders "Unknown user" for every action of somebody who has
 * left is much less useful than one that renders the name as it was.
 */

export const AUDIT_ACTIONS = {
  // Naming: `<entityType>.<action>`, the entity singular and lowercase.
  //
  // Deliberately not the permission vocabulary (`contacts.create`) and not the
  // event vocabulary (`contact.created`). All three coexist and they are three
  // different questions: what a role may do, what happened, and how the change
  // is filed. A single string trying to be all three ends up plural in one
  // place and singular in another, and the mismatch is only visible at runtime.
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  STAGE_CHANGE: "stage_change",
  SETTINGS_UPDATE: "settings.update",
} as const;

export type AuditAction = string;

export interface AuditChanges {
  /** Values before the action. Only fields that changed are present. */
  before: Record<string, unknown>;
  /** Values after the action. A field that was removed is `null`. */
  after: Record<string, unknown>;
}

export interface AuditLog {
  _id: Types.ObjectId;
  createdAt: Date;
  organizationId: Types.ObjectId;
  /** Null for a system action with no human behind it. */
  actorId: Types.ObjectId | null;
  /** Kept even when the user row is gone, so the log still reads. */
  actorName: string;
  action: AuditAction;
  entityType: string;
  entityId: Types.ObjectId | null;
  entityLabel: string | null;
  changes: AuditChanges;
  metadata: Record<string, unknown>;
  ip: string | null;
  userAgent: string | null;
}

const auditLogSchema = new Schema<AuditLog>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    actorId: { type: Schema.Types.ObjectId, default: null },
    actorName: { type: String, required: true, default: "System" },
    action: { type: String, required: true },
    entityType: { type: String, required: true },
    entityId: { type: Schema.Types.ObjectId, default: null },
    entityLabel: { type: String, default: null },
    // One Mixed value rather than a nested `{ before, after }` subdocument.
    // A subdocument gets an auto-generated `_id` from mongoose, so every audit
    // row would carry a meaningless random id inside its own diff, which a
    // client rendering the change list would have to know to ignore. The shape
    // is guaranteed by `diffRecords`, which only ever returns before and after.
    changes: {
      type: Schema.Types.Mixed,
      required: true,
      default: () => ({ before: {}, after: {} }),
    },
    metadata: { type: Schema.Types.Mixed, default: () => ({}) },
    ip: { type: String, default: null },
    userAgent: { type: String, default: null },
  },
  // No `updatedAt`. Nothing about an audit row is ever expected to change.
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
    collection: "audit_logs",
  },
);

// A tenant's audit screen: newest first.
auditLogSchema.index({ organizationId: 1, createdAt: -1 });
// "History of this record".
auditLogSchema.index({
  organizationId: 1,
  entityType: 1,
  entityId: 1,
  createdAt: -1,
});
// "What did this user do".
auditLogSchema.index({ organizationId: 1, actorId: 1, createdAt: -1 });

export const AuditLogModel: Model<AuditLog> =
  (mongoose.models.AuditLog as Model<AuditLog>) ??
  mongoose.model<AuditLog>("AuditLog", auditLogSchema);

export const auditLogSchemaDefinition = auditLogSchema;
