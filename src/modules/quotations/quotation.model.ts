import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";
import { isValidCalendarDate } from "@/shared/lib/calendar";

/**
 * A quotation's identity and lifecycle.
 *
 * The business content lives on `QuotationRevision`; this parent carries the
 * number, the current revision pointer and denormalised totals so a list does
 * not read every revision. The pointer is a string `ref` rather than an import,
 * because the revision model is registered separately and a cycle between the
 * two files would make load order matter.
 *
 * Per docs/DATABASE.md and plan §4.3.2.
 */
export const QUOTATION_STATUSES = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "VOID",
] as const;

export type QuotationStatus = (typeof QUOTATION_STATUSES)[number];

export interface Quotation extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  number: string;
  status: QuotationStatus;
  currentRevisionId: Types.ObjectId;
  currentRevisionNumber: number;
  acceptedRevisionId: Types.ObjectId | null;
  acceptedAt: Date | null;
  orderId: Types.ObjectId | null;
  convertedAt: Date | null;
  companyId: Types.ObjectId;
  companyName: string;
  contactId: Types.ObjectId | null;
  contactName: string | null;
  dealId: Types.ObjectId | null;
  ownerId: Types.ObjectId;
  currency: string;
  validUntil: string;
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const integer = {
  validator: Number.isInteger,
  message: "Must be an integer.",
};

const quotationSchema = new Schema<Quotation>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Organization",
    },
    number: { type: String, required: true, trim: true },
    status: {
      type: String,
      required: true,
      enum: QUOTATION_STATUSES,
      default: "DRAFT",
    },
    currentRevisionId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "QuotationRevision",
    },
    currentRevisionNumber: {
      type: Number,
      required: true,
      min: 1,
      integer: true,
      validate: integer,
    },
    acceptedRevisionId: {
      type: Schema.Types.ObjectId,
      ref: "QuotationRevision",
      default: null,
    },
    acceptedAt: { type: Date, default: null },
    // Forward reference: the sales-order model arrives in a later task, and a
    // string ref does not require it to exist yet.
    orderId: { type: Schema.Types.ObjectId, ref: "SalesOrder", default: null },
    convertedAt: { type: Date, default: null },
    companyId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Company",
    },
    companyName: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 160,
      trim: true,
    },
    contactId: {
      type: Schema.Types.ObjectId,
      ref: "Contact",
      default: null,
    },
    contactName: {
      type: String,
      maxlength: 160,
      trim: true,
      default: null,
    },
    dealId: { type: Schema.Types.ObjectId, ref: "Deal", default: null },
    ownerId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    currency: { type: String, required: true, trim: true },
    validUntil: {
      type: String,
      required: true,
      validate: {
        validator: isValidCalendarDate,
        message:
          "validUntil must be a real calendar date in YYYY-MM-DD format.",
      },
    },
    subtotalMinor: {
      type: Number,
      required: true,
      min: 0,
      integer: true,
      validate: integer,
    },
    taxMinor: {
      type: Number,
      required: true,
      min: 0,
      integer: true,
      validate: integer,
    },
    totalMinor: {
      type: Number,
      required: true,
      min: 0,
      integer: true,
      validate: integer,
    },
  },
  { timestamps: true, collection: "quotations" },
);

quotationSchema.plugin(auditFields());
quotationSchema.plugin(softDelete({ scopeField: "organizationId" }));

quotationSchema.index({ organizationId: 1, number: 1 }, { unique: true });
quotationSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
quotationSchema.index({ organizationId: 1, companyId: 1, createdAt: -1 });
quotationSchema.index({ organizationId: 1, contactId: 1, createdAt: -1 });
quotationSchema.index({ organizationId: 1, dealId: 1, createdAt: -1 });
quotationSchema.index({ organizationId: 1, ownerId: 1, updatedAt: -1 });
quotationSchema.index({ organizationId: 1, status: 1, validUntil: 1 });
quotationSchema.index({ organizationId: 1, totalMinor: -1 });
quotationSchema.index({ organizationId: 1, number: 1, companyName: 1 });

export const QuotationModel: Model<Quotation> =
  (mongoose.models.Quotation as Model<Quotation>) ??
  mongoose.model<Quotation>("Quotation", quotationSchema);

export const quotationSchemaDefinition = quotationSchema;
