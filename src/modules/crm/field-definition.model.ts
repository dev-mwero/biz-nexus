import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";

/**
 * A custom field definition for a specific entity type.
 *
 * Definitions live here; values are stored as a `Mixed` map on the entity
 * document and validated against these definitions at the service layer.
 * Custom fields are **never indexed** and **never used for authorization** —
 * they are presentation and segmentation only.
 *
 * Per docs/DATABASE.md §4.
 */
export const FIELD_ENTITY_TYPES = [
  "CONTACT",
  "COMPANY",
  "LEAD",
  "DEAL",
  "TASK",
] as const;

export type FieldEntityType = (typeof FIELD_ENTITY_TYPES)[number];

export const FIELD_TYPES = [
  "TEXT",
  "NUMBER",
  "DATE",
  "BOOLEAN",
  "SELECT",
  "MULTI_SELECT",
] as const;

export type FieldType = (typeof FIELD_TYPES)[number];

export interface FieldDefinition extends AuditFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  entityType: FieldEntityType;
  /** Stable machine key, snake_case. */
  key: string;
  /** Display label. */
  label: string;
  type: FieldType;
  /** For SELECT and MULTI_SELECT. */
  options: string[];
  /** Whether a value is required on create/update. */
  required: boolean;
  /** Display order within the entity type. */
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const fieldDefinitionSchema = new Schema<FieldDefinition>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Organization",
    },
    entityType: {
      type: String,
      required: true,
      enum: FIELD_ENTITY_TYPES,
    },
    key: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 40,
      trim: true,
      match: /^[a-z][a-z0-9_]*$/,
    },
    label: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 80,
      trim: true,
    },
    type: {
      type: String,
      required: true,
      enum: FIELD_TYPES,
    },
    options: { type: [String], default: () => [] },
    required: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true, collection: "field_definitions" },
);

fieldDefinitionSchema.pre("validate", function validateOptions() {
  if (
    (this.type === "SELECT" || this.type === "MULTI_SELECT") &&
    this.options.length === 0
  ) {
    this.invalidate("options", "Select fields require at least one option.");
  }
});

fieldDefinitionSchema.plugin(auditFields());

// Unique per organisation + entity type + key
fieldDefinitionSchema.index(
  { organizationId: 1, entityType: 1, key: 1 },
  { unique: true },
);

export const FieldDefinitionModel: Model<FieldDefinition> =
  (mongoose.models.FieldDefinition as Model<FieldDefinition>) ??
  mongoose.model<FieldDefinition>("FieldDefinition", fieldDefinitionSchema);

export const fieldDefinitionSchemaDefinition = fieldDefinitionSchema;
