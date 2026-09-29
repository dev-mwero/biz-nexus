import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A pending invitation to join an organisation.
 *
 * Kept as a document rather than a `Membership` in `INVITED` state, so that an
 * invitation is revocable and expirable without touching the membership
 * collection, and so that a not-yet-accepted invitation cannot be mistaken for
 * access.
 *
 * Per docs/DATABASE.md §3.
 */

export const INVITATION_TTL_DAYS = 7;

export interface Invitation extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  email: string;
  /** Role granted on acceptance. Must belong to the same organisation. */
  roleId: Types.ObjectId;
  /** SHA-256 of the emailed token. The raw token is never stored. */
  tokenHash: string;
  invitedBy: Types.ObjectId;
  expiresAt: Date;
  acceptedAt: Date | null;
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const invitationSchema = new Schema<Invitation>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      maxlength: 254,
    },
    roleId: { type: Schema.Types.ObjectId, required: true, ref: "Role" },
    tokenHash: { type: String, required: true, unique: true },
    invitedBy: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    expiresAt: { type: Date, required: true },
    acceptedAt: { type: Date, default: null },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "invitations" },
);

invitationSchema.plugin(auditFields());
invitationSchema.plugin(softDelete({ scopeField: "organizationId" }));

/**
 * One open invitation per address per organisation.
 *
 * Partial on `acceptedAt: null`, which is what makes "resend" work: once an
 * invitation is accepted the index no longer covers that row, so the same
 * address can be invited again later without the historical record blocking
 * it. A plain unique index here would make invitations permanently single-use
 * per address, which is not the intent.
 *
 * Note the trade-off this accepts: a revoked invitation is still `acceptedAt:
 * null` and still occupies the index slot until it TTLs out at seven days.
 * Revoke-then-reinvite within that window requires revoking and replacing the
 * row, which the 1.20 service does in one update.
 */
invitationSchema.index(
  { organizationId: 1, email: 1 },
  { unique: true, partialFilterExpression: { acceptedAt: null } },
);

// Expired and revoked invitations are cleaned up by the database.
invitationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const InvitationModel: Model<Invitation> =
  (mongoose.models.Invitation as Model<Invitation>) ??
  mongoose.model<Invitation>("Invitation", invitationSchema);

export const invitationSchemaDefinition = invitationSchema;
