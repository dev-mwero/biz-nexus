import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SlugFields, slug } from "@/db/mixins/slug";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A tenant. The one collection that is global but *belongs* to somebody:
 * `createdBy` records the user who created it, which is why this is the only
 * global collection carrying audit fields.
 *
 * It has no `organizationId` of its own — it is the organisation. Every other
 * tenant-owned collection carries a reference back to this one, and that
 * reference is the entire isolation mechanism described in docs/DATABASE.md §1.
 *
 * Per docs/DATABASE.md §3.
 */

export interface Organization
  extends AuditFields,
    SlugFields,
    SoftDeleteFields {
  _id: Types.ObjectId;
  name: string;
  logoUrl: string | null;
  /** IANA identifier. Stored verbatim; interpreted only at render time. */
  timezone: string;
  /** ISO 4217. */
  currency: string;
  dateFormat: string;
  /** 0 = Sunday. Matches `Date.prototype.getDay`, so no conversion is needed. */
  weekStartsOn: number;
  settings: Record<string, unknown>;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const organizationSchema = new Schema<Organization>(
  {
    name: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 120,
      trim: true,
    },
    logoUrl: { type: String, default: null },
    timezone: { type: String, default: "UTC" },
    currency: { type: String, default: "USD" },
    dateFormat: { type: String, default: "YYYY-MM-DD" },
    weekStartsOn: { type: Number, default: 1, min: 0, max: 6 },
    settings: { type: Schema.Types.Mixed, default: () => ({}) },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "organizations" },
);

organizationSchema.plugin(slug());
organizationSchema.plugin(auditFields());
organizationSchema.plugin(softDelete());

// Newest first, for the "your organisations" list and admin tooling.
organizationSchema.index({ createdAt: -1 });

export const OrganizationModel: Model<Organization> =
  (mongoose.models.Organization as Model<Organization>) ??
  mongoose.model<Organization>("Organization", organizationSchema);

export const organizationSchemaDefinition = organizationSchema;
