import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A deal in a pipeline.
 *
 * Per docs/DATABASE.md §4.
 */

export const DEAL_STATUSES = ["OPEN", "WON", "LOST"] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export interface Deal extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  companyId: Types.ObjectId | null;
  contactId: Types.ObjectId | null;
  pipelineId: Types.ObjectId;
  stageId: Types.ObjectId;
  ownerId: Types.ObjectId;
  /** Stored in major units (e.g., 24000 = $24,000). */
  value: number;
  currency: string;
  /** 0–100. */
  probability: number;
  status: DealStatus;
  expectedCloseDate: Date | null;
  closedAt: Date | null;
  lostReason: string | null;
  description: string | null;
  /** Position within a Kanban column. */
  sortOrder: number;
  tags: Types.ObjectId[];
  customFields: Record<string, unknown>;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const dealSchema = new Schema<Deal>(
  {
    organizationId: { type: Schema.Types.ObjectId, required: true },
    name: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 160,
      trim: true,
    },
    companyId: { type: Schema.Types.ObjectId, default: null, ref: "Company" },
    contactId: { type: Schema.Types.ObjectId, default: null, ref: "Contact" },
    pipelineId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Pipeline",
    },
    stageId: { type: Schema.Types.ObjectId, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    value: { type: Number, required: true, default: 0, min: 0 },
    currency: { type: String, required: true, default: "USD" },
    probability: { type: Number, required: true, default: 0, min: 0, max: 100 },
    status: {
      type: String,
      required: true,
      enum: DEAL_STATUSES,
      default: "OPEN",
    },
    expectedCloseDate: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    lostReason: { type: String, default: null },
    description: { type: String, default: null },
    sortOrder: { type: Number, required: true, default: 0, min: 0 },
    tags: [{ type: Schema.Types.ObjectId, ref: "Tag", default: [] }],
    customFields: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true, collection: "deals" },
);

dealSchema.plugin(auditFields());
dealSchema.plugin(softDelete({ scopeField: "organizationId" }));

// Kanban column fetch — the hottest read
dealSchema.index({
  organizationId: 1,
  pipelineId: 1,
  stageId: 1,
  sortOrder: 1,
});

// Open deals, forecast, overdue
dealSchema.index({
  organizationId: 1,
  status: 1,
  expectedCloseDate: 1,
});

// "My deals"
dealSchema.index({
  organizationId: 1,
  ownerId: 1,
  updatedAt: -1,
});

// Company 360
dealSchema.index({
  organizationId: 1,
  companyId: 1,
  createdAt: -1,
});

// Win-rate reporting
dealSchema.index({
  organizationId: 1,
  closedAt: -1,
});

// Text search
dealSchema.index({
  organizationId: 1,
  name: "text",
  description: "text",
});

export const DealModel: Model<Deal> =
  (mongoose.models.Deal as Model<Deal>) ??
  mongoose.model<Deal>("Deal", dealSchema);

export const dealSchemaDefinition = dealSchema;
