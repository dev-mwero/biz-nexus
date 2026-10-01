import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";

/**
 * A saved view (filter/sort/column configuration) for an entity type.
 *
 * Views are personal by default (`isShared: false`). Filters are validated
 * against the entity's list-query schema at write time, so a saved view can
 * never contain an unsafe filter.
 *
 * Per docs/DATABASE.md §9.
 */
export const SAVED_VIEW_ENTITY_TYPES = [
  "CONTACT",
  "COMPANY",
  "LEAD",
  "DEAL",
  "TASK",
] as const;

export type SavedViewEntityType = (typeof SAVED_VIEW_ENTITY_TYPES)[number];

export interface SavedView extends AuditFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  userId: Types.ObjectId;
  entityType: SavedViewEntityType;
  name: string;
  /** Validated filter object. Keys match the resource's list-query schema. */
  filters: Record<string, unknown>;
  /** Sort string, e.g. "-createdAt" or "lastName,firstName". */
  sort: string;
  /** Visible columns, in order, with optional widths. */
  columns: Array<{ key: string; width?: number }>;
  isShared: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const savedViewSchema = new Schema<SavedView>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Organization",
    },
    userId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    entityType: {
      type: String,
      required: true,
      enum: SAVED_VIEW_ENTITY_TYPES,
    },
    name: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 60,
      trim: true,
    },
    filters: { type: Schema.Types.Mixed, default: () => ({}) },
    sort: { type: String, default: "" },
    columns: {
      type: [
        {
          key: { type: String, required: true },
          width: { type: Number, min: 50, max: 600 },
        },
      ],
      default: () => [],
    },
    isShared: { type: Boolean, default: false },
  },
  { timestamps: true, collection: "saved_views" },
);

savedViewSchema.plugin(auditFields());

// Unique per organisation + user + entity type + name
savedViewSchema.index(
  { organizationId: 1, userId: 1, entityType: 1, name: 1 },
  { unique: true },
);

export const SavedViewModel: Model<SavedView> =
  (mongoose.models.SavedView as Model<SavedView>) ??
  mongoose.model<SavedView>("SavedView", savedViewSchema);

export const savedViewSchemaDefinition = savedViewSchema;
