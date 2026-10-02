import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A lead in the CRM.
 *
 * Per docs/DATABASE.md §4.
 */
export const LEAD_STATUSES = [
  "NEW",
  "CONTACTED",
  "QUALIFIED",
  "UNQUALIFIED",
  "CONVERTED",
  "LOST",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export interface LeadContactSnapshot {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  companyName?: string | null;
}

export interface Lead extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  title: string;
  contactId?: Types.ObjectId | null;
  contactSnapshot: LeadContactSnapshot;
  companyId?: Types.ObjectId | null;
  source: string;
  status: LeadStatus;
  score: number;
  ownerId: Types.ObjectId;
  tags: Types.ObjectId[];
  notes?: string | null;
  customFields: Record<string, unknown>;
  convertedAt?: Date | null;
  convertedContactId?: Types.ObjectId | null;
  convertedCompanyId?: Types.ObjectId | null;
  convertedDealId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const contactSnapshotSchema = new Schema<LeadContactSnapshot>(
  {
    firstName: { type: String, required: true, trim: true, maxlength: 80 },
    lastName: { type: String, required: true, trim: true, maxlength: 80 },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 255,
    },
    phone: { type: String, trim: true, maxlength: 50, default: null },
    companyName: { type: String, trim: true, maxlength: 160, default: null },
  },
  { _id: false },
);

const leadSchema = new Schema<Lead>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Organization",
    },
    title: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 200,
      trim: true,
    },
    contactId: {
      type: Schema.Types.ObjectId,
      ref: "Contact",
      default: null,
    },
    contactSnapshot: { type: contactSnapshotSchema, required: true },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    source: { type: String, required: true, trim: true, maxlength: 100 },
    status: {
      type: String,
      required: true,
      enum: LEAD_STATUSES,
      default: "NEW",
    },
    score: { type: Number, default: 0, min: 0, max: 100 },
    ownerId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    tags: [{ type: Schema.Types.ObjectId, ref: "Tag", default: () => [] }],
    notes: { type: String, maxlength: 2000, trim: true, default: null },
    customFields: { type: Schema.Types.Mixed, default: () => ({}) },
    convertedAt: { type: Date, default: null },
    convertedContactId: {
      type: Schema.Types.ObjectId,
      ref: "Contact",
      default: null,
    },
    convertedCompanyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    convertedDealId: {
      type: Schema.Types.ObjectId,
      ref: "Deal",
      default: null,
    },
  },
  { timestamps: true, collection: "leads" },
);

leadSchema.plugin(auditFields());
leadSchema.plugin(softDelete({ scopeField: "organizationId" }));

// Indexes per DATABASE.md §4
leadSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
leadSchema.index({ organizationId: 1, ownerId: 1, createdAt: -1 });
leadSchema.index({ organizationId: 1, source: 1, status: 1 });
leadSchema.index({ organizationId: 1, convertedAt: 1 });

export const LeadModel: Model<Lead> =
  (mongoose.models.Lead as Model<Lead>) ??
  mongoose.model<Lead>("Lead", leadSchema);

export const leadSchemaDefinition = leadSchema;

/**
 * Allowed status transitions for leads.
 * NEW -> CONTACTED, UNQUALIFIED, LOST
 * CONTACTED -> QUALIFIED, UNQUALIFIED, LOST
 * QUALIFIED -> CONVERTED, UNQUALIFIED, LOST
 * UNQUALIFIED -> (no transitions)
 * CONVERTED -> (no transitions)
 * LOST -> (no transitions)
 */
export const LEAD_STATUS_TRANSITIONS: Record<LeadStatus, LeadStatus[]> = {
  NEW: ["CONTACTED", "UNQUALIFIED", "LOST"],
  CONTACTED: ["QUALIFIED", "UNQUALIFIED", "LOST"],
  QUALIFIED: ["CONVERTED", "UNQUALIFIED", "LOST"],
  UNQUALIFIED: [],
  CONVERTED: [],
  LOST: [],
};
