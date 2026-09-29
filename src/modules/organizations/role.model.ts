import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A role, stored per organisation rather than referenced from a global
 * template. Four extra documents per organisation buys per-tenant customisation
 * with no second model, and it makes cross-tenant role access structurally
 * impossible rather than merely filtered.
 *
 * Per docs/DATABASE.md §3.
 */

/** The four roles provisioned for every new organisation, in 1.18. */
export const SYSTEM_ROLE_KEYS = ["OWNER", "ADMIN", "MEMBER", "VIEWER"] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];

export interface Role extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  /** A system key, or a custom key chosen by this organisation. */
  key: string;
  /** Display name. Editable, so "Viewer" can become "Read-only" per tenant. */
  name: string;
  description: string | null;
  permissions: string[];
  /** System roles may be renamed and edited, but never deleted or shadowed. */
  isSystem: boolean;
  /** True for MEMBER: the role granted when someone is invited. */
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const roleSchema = new Schema<Role>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    key: { type: String, required: true, trim: true, uppercase: true },
    name: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 120,
      trim: true,
    },
    description: { type: String, default: null },
    permissions: { type: [String], default: [] },
    isSystem: { type: Boolean, default: false },
    isDefault: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "roles" },
);

roleSchema.plugin(auditFields());
roleSchema.plugin(softDelete({ scopeField: "organizationId" }));

// Role keys are unique *within* an organisation: "ADMIN" in two different
// organisations is two unrelated roles, and that is the point of storing them
// per tenant. MongoDB has no foreign keys, so this index is also what stops
// two roles in one organisation claiming the same key.
roleSchema.index({ organizationId: 1, key: 1 }, { unique: true });

export const RoleModel: Model<Role> =
  (mongoose.models.Role as Model<Role>) ??
  mongoose.model<Role>("Role", roleSchema);

export const roleSchemaDefinition = roleSchema;
