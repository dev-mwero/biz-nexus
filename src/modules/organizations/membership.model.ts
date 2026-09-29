import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";
/** Membership lifecycle. A membership exists as INVITED before it is ACTIVE. */
export const MEMBERSHIP_STATUS = ["INVITED", "ACTIVE", "SUSPENDED"] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[number];

/**
 * A user's standing in one organisation.
 *
 * The `{ organizationId, userId }` unique index is the load-bearing part of the
 * access model: it is what makes "am I a member?" a single indexed lookup and
 * what makes "one membership per user per organisation" a property of the data
 * rather than a convention the service layer has to remember.
 *
 * Per docs/DATABASE.md §3.
 */

export interface Membership extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  /**
   * Ref Role. Belonging to the same organisation cannot be enforced by MongoDB,
   * so the service layer asserts it before writing. Cross-collection integrity
   * is the first of the three mechanisms in docs/DATABASE.md §10.
   */
  roleId: Types.ObjectId;
  status: MembershipStatus;
  title: string | null;
  invitedBy: Types.ObjectId | null;
  invitedAt: Date | null;
  joinedAt: Date | null;
  lastActiveAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const membershipSchema = new Schema<Membership>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    roleId: { type: Schema.Types.ObjectId, required: true, ref: "Role" },
    status: { type: String, enum: MEMBERSHIP_STATUS, default: "INVITED" },
    title: { type: String, default: null, maxlength: 120 },
    invitedBy: { type: Schema.Types.ObjectId, default: null, ref: "User" },
    invitedAt: { type: Date, default: null },
    joinedAt: { type: Date, default: null },
    lastActiveAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "memberships" },
);

membershipSchema.plugin(auditFields());
membershipSchema.plugin(softDelete({ scopeField: "organizationId" }));

// One membership per user per organisation, and the "am I a member?" check.
// Every authenticated request resolves this index, so it leads on
// organizationId per the primary access pattern in docs/DATABASE.md §1.
membershipSchema.index({ organizationId: 1, userId: 1 }, { unique: true });

// "My organisations" switcher: given a user, which orgs can I act in?
membershipSchema.index({ userId: 1, status: 1 });

// Member directory, ordered by most recently active.
membershipSchema.index({ organizationId: 1, status: 1, lastActiveAt: -1 });

export const MembershipModel: Model<Membership> =
  (mongoose.models.Membership as Model<Membership>) ??
  mongoose.model<Membership>("Membership", membershipSchema);

export const membershipSchemaDefinition = membershipSchema;
