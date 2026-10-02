import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A deal in the CRM.
 *
 * Per docs/DATABASE.md §4.
 */
export const DEAL_STATUSES = ["OPEN", "WON", "LOST"] as const;

export type DealStatus = (typeof DEAL_STATUSES)[number];

export interface Deal extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  companyId?: Types.ObjectId | null;
  contactId?: Types.ObjectId | null;
  pipelineId: Types.ObjectId;
  stageId: Types.ObjectId;
  ownerId: Types.ObjectId;
  value: number;
  currency: string;
  probability: number;
  status: DealStatus;
  expectedCloseDate?: Date | null;
  closedAt?: Date | null;
  lostReason?: string | null;
  description?: string | null;
  sortOrder: number;
  tags: Types.ObjectId[];
  customFields: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const dealSchema = new Schema<Deal>(
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
      maxlength: 160,
      trim: true,
    },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    contactId: {
      type: Schema.Types.ObjectId,
      ref: "Contact",
      default: null,
    },
    pipelineId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Pipeline",
    },
    stageId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "PipelineStage",
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    value: { type: Number, default: 0, min: 0 },
    currency: {
      type: String,
      required: true,
      uppercase: true,
      minlength: 3,
      maxlength: 3,
      default: "USD",
    },
    probability: { type: Number, required: true, min: 0, max: 100, default: 0 },
    status: {
      type: String,
      required: true,
      enum: DEAL_STATUSES,
      default: "OPEN",
    },
    expectedCloseDate: { type: Date, default: null },
    closedAt: { type: Date, default: null },
    lostReason: { type: String, maxlength: 500, trim: true, default: null },
    description: { type: String, maxlength: 2000, trim: true, default: null },
    sortOrder: { type: Number, default: 0 },
    tags: [{ type: Schema.Types.ObjectId, ref: "Tag" }],
    customFields: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true, collection: "deals" },
);

dealSchema.plugin(auditFields());
dealSchema.plugin(softDelete({ scopeField: "organizationId" }));

dealSchema.index({ organizationId: 1, name: "text", description: "text" });
dealSchema.index({ organizationId: 1, status: 1, expectedCloseDate: 1 });
dealSchema.index({ organizationId: 1, ownerId: 1, updatedAt: -1 });
dealSchema.index({ organizationId: 1, companyId: 1, createdAt: -1 });
dealSchema.index({ organizationId: 1, closedAt: -1 });

export const DealModel: Model<Deal> =
  (mongoose.models.Deal as Model<Deal>) ??
  mongoose.model<Deal>("Deal", dealSchema);

export const dealSchemaDefinition = dealSchema;
