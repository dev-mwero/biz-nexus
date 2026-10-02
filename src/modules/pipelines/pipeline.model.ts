import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A pipeline with embedded stages.
 *
 * Stages are embedded, not a separate collection. They are always read with
 * their pipeline, never queried independently, always fewer than thirty, and must
 * be reorderable atomically. Embedding makes a reorder a single update with no
 * possibility of a partially applied move.
 *
 * Per docs/DATABASE.md §5.
 */

export interface PipelineStage {
  _id: Types.ObjectId;
  /** Machine key, stable across renames. Uppercase, snake_case. */
  key: string;
  /** Display name. Editable. */
  name: string;
  /** Position within the pipeline. */
  order: number;
  /** Default probability for deals in this stage. 0–100. */
  probability: number;
  /** Token name from the design system, not a hex literal. */
  color: string;
  /** Deals moved here are WON. At most one per pipeline. */
  isWon: boolean;
  /** Deals moved here are LOST. At most one per pipeline. */
  isLost: boolean;
}

export interface Pipeline extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  description: string | null;
  /** At most one per organisation. */
  isDefault: boolean;
  /** Position in the pipeline list. */
  order: number;
  stages: PipelineStage[];
  createdAt: Date;
  updatedAt: Date;
}

const stageSchema = new Schema<PipelineStage>(
  {
    _id: { type: Schema.Types.ObjectId, required: true, auto: true },
    key: {
      type: String,
      required: true,
      trim: true,
      uppercase: true,
      match: /^[A-Z][A-Z0-9_]*$/,
    },
    name: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 60,
      trim: true,
    },
    order: { type: Number, required: true, min: 0 },
    probability: { type: Number, required: true, min: 0, max: 100, default: 0 },
    color: {
      type: String,
      required: true,
      enum: [
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
      ],
      default: "blue",
    },
    isWon: { type: Boolean, default: false },
    isLost: { type: Boolean, default: false },
  },
  { _id: false },
);

const pipelineSchema = new Schema<Pipeline>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    name: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 80,
      trim: true,
    },
    description: { type: String, default: null },
    isDefault: { type: Boolean, default: false },
    order: { type: Number, required: true, min: 0, default: 0 },
    stages: { type: [stageSchema], default: () => [] },
  },
  { timestamps: true, collection: "pipelines" },
);

pipelineSchema.plugin(auditFields());
pipelineSchema.plugin(softDelete({ scopeField: "organizationId" }));

// Unique name per organisation
pipelineSchema.index({ organizationId: 1, name: 1 }, { unique: true });

// At most one default per organisation (unique partial index)
pipelineSchema.index(
  { organizationId: 1, isDefault: 1 },
  { unique: true, partialFilterExpression: { isDefault: true } },
);

// Ordering for the pipeline list
pipelineSchema.index({ organizationId: 1, order: 1 });

/**
 * Validate that a pipeline has at most one won stage and one lost stage.
 */
pipelineSchema.path("stages").validate((stages: PipelineStage[]) => {
  const won = stages.filter((s) => s.isWon).length;
  const lost = stages.filter((s) => s.isLost).length;
  return won <= 1 && lost <= 1;
}, "A pipeline may have at most one won stage and one lost stage.");

/**
 * Validate that stage keys are unique within a pipeline.
 */
pipelineSchema.path("stages").validate((stages: PipelineStage[]) => {
  const keys = stages.map((s) => s.key);
  return new Set(keys).size === keys.length;
}, "Stage keys must be unique within a pipeline.");

/**
 * Validate that stage orders are unique within a pipeline.
 */
pipelineSchema.path("stages").validate((stages: PipelineStage[]) => {
  const orders = stages.map((s) => s.order);
  return new Set(orders).size === orders.length;
}, "Stage orders must be unique within a pipeline.");

export const PipelineModel: Model<Pipeline> =
  (mongoose.models.Pipeline as Model<Pipeline>) ??
  mongoose.model<Pipeline>("Pipeline", pipelineSchema);

export const pipelineSchemaDefinition = pipelineSchema;
