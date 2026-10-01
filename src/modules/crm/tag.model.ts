import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A tag scoped to an organisation.
 *
 * Tags are first-class entities rather than bare strings because they carry
 * colours, usage counts, and a merge operation. Free-text tags would become
 * a data-quality problem within a month.
 *
 * Per docs/DATABASE.md §4 and §3.
 */
export const TAG_COLORS = [
  "slate",
  "gray",
  "zinc",
  "neutral",
  "stone",
  "red",
  "orange",
  "amber",
  "yellow",
  "lime",
  "green",
  "emerald",
  "teal",
  "cyan",
  "sky",
  "blue",
  "indigo",
  "violet",
  "purple",
  "fuchsia",
  "pink",
  "rose",
] as const;

export type TagColor = (typeof TAG_COLORS)[number];

export interface Tag extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  color: TagColor;
  /** Denormalised count of entities referencing this tag. */
  usageCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const tagSchema = new Schema<Tag>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Organization",
    },
    name: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 40,
      trim: true,
    },
    color: {
      type: String,
      required: true,
      enum: TAG_COLORS,
      default: "slate",
    },
    usageCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true, collection: "tags" },
);

tagSchema.plugin(auditFields());
tagSchema.plugin(softDelete({ scopeField: "organizationId" }));

// Unique per organisation
tagSchema.index({ organizationId: 1, name: 1 }, { unique: true });

export const TagModel: Model<Tag> =
  (mongoose.models.Tag as Model<Tag>) ?? mongoose.model<Tag>("Tag", tagSchema);

export const tagSchemaDefinition = tagSchema;
