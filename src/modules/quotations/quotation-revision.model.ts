import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { isValidCalendarDate } from "@/shared/lib/calendar";
import {
  MAX_LINE_ITEMS,
  MAX_QUANTITY_MILLI,
  MAX_TAX_RATE_BPS,
  MAX_UNIT_PRICE_MINOR,
} from "@/shared/lib/money";

/**
 * The immutable business content of a quotation.
 *
 * A revision is never soft-deleted and never edited once it leaves `DRAFT`; the
 * service enforces that, and the absence of `deletedAt` here is the persistence
 * half of the same statement. Lines are embedded because they are bounded,
 * always read with their revision, and replaced as a whole.
 *
 * Per docs/DATABASE.md and plan §4.3.3.
 */
export const QUOTATION_REVISION_STATUSES = [
  "DRAFT",
  "SENT",
  "ACCEPTED",
  "REJECTED",
  "SUPERSEDED",
  "VOID",
] as const;

export type QuotationRevisionStatus =
  (typeof QUOTATION_REVISION_STATUSES)[number];

export interface QuotationLine {
  _id: Types.ObjectId;
  position: number;
  productId: Types.ObjectId;
  productName: string;
  sku: string | null;
  unitLabel: string | null;
  listPriceMinor: number;
  unitPriceMinor: number;
  quantityMilli: number;
  taxRateBps: number;
  lineSubtotalMinor: number;
  lineTaxMinor: number;
  lineTotalMinor: number;
}

/**
 * An embedded line snapshot.
 *
 * No arithmetic invariant is checked here: `lineSubtotalMinor` and friends are
 * derived by the service through `shared/lib/money`, and duplicating the
 * formula in a schema validator would give the application two answers that
 * could disagree.
 */
const integer = {
  validator: Number.isInteger,
  message: "Must be an integer.",
};

export const quotationLineSchema = new Schema<QuotationLine>(
  {
    position: {
      type: Number,
      required: true,
      min: 0,
      integer: true,
      validate: integer,
    },
    productId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Product",
    },
    productName: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 160,
      trim: true,
    },
    sku: { type: String, maxlength: 64, trim: true, default: null },
    unitLabel: { type: String, maxlength: 32, trim: true, default: null },
    listPriceMinor: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_UNIT_PRICE_MINOR,
      integer: true,
      validate: integer,
    },
    unitPriceMinor: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_UNIT_PRICE_MINOR,
      integer: true,
      validate: integer,
    },
    quantityMilli: {
      type: Number,
      required: true,
      min: 1,
      max: MAX_QUANTITY_MILLI,
      integer: true,
      validate: integer,
    },
    taxRateBps: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_TAX_RATE_BPS,
      integer: true,
      validate: integer,
    },
    lineSubtotalMinor: {
      type: Number,
      required: true,
      min: 0,
      integer: true,
      validate: integer,
    },
    lineTaxMinor: {
      type: Number,
      required: true,
      min: 0,
      integer: true,
      validate: integer,
    },
    lineTotalMinor: {
      type: Number,
      required: true,
      min: 0,
      integer: true,
      validate: integer,
    },
  },
  { _id: true },
);

export interface CustomerSnapshot {
  companyName: string;
  contactName: string | null;
  contactEmail: string | null;
  billingAddress: string | null;
}

export const customerSnapshotSchema = new Schema<CustomerSnapshot>(
  {
    companyName: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 160,
      trim: true,
    },
    contactName: {
      type: String,
      maxlength: 160,
      trim: true,
      default: null,
    },
    contactEmail: {
      type: String,
      maxlength: 254,
      trim: true,
      default: null,
    },
    billingAddress: {
      type: String,
      maxlength: 500,
      trim: true,
      default: null,
    },
  },
  { _id: false },
);

export interface QuotationRevision extends AuditFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  quotationId: Types.ObjectId;
  revision: number;
  status: QuotationRevisionStatus;
  lineItems: QuotationLine[];
  subtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  validUntil: string;
  terms: string | null;
  notes: string | null;
  customerSnapshot: CustomerSnapshot;
  sentAt: Date | null;
  acceptedAt: Date | null;
  rejectedAt: Date | null;
  supersededAt: Date | null;
  voidedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const quotationRevisionSchema = new Schema<QuotationRevision>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Organization",
    },
    quotationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Quotation",
    },
    revision: {
      type: Number,
      required: true,
      min: 1,
      integer: true,
      validate: integer,
    },
    status: {
      type: String,
      required: true,
      enum: QUOTATION_REVISION_STATUSES,
      default: "DRAFT",
    },
    lineItems: {
      type: [quotationLineSchema],
      required: true,
      validate: {
        validator: (value: QuotationLine[]) =>
          Array.isArray(value) &&
          value.length >= 1 &&
          value.length <= MAX_LINE_ITEMS,
        message: `A quotation revision has between 1 and ${MAX_LINE_ITEMS} lines.`,
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
    validUntil: {
      type: String,
      required: true,
      validate: {
        validator: isValidCalendarDate,
        message:
          "validUntil must be a real calendar date in YYYY-MM-DD format.",
      },
    },
    terms: { type: String, maxlength: 5000, trim: true, default: null },
    notes: { type: String, maxlength: 5000, trim: true, default: null },
    customerSnapshot: {
      type: customerSnapshotSchema,
      required: true,
    },
    sentAt: { type: Date, default: null },
    acceptedAt: { type: Date, default: null },
    rejectedAt: { type: Date, default: null },
    supersededAt: { type: Date, default: null },
    voidedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "quotation_revisions" },
);

quotationRevisionSchema.plugin(auditFields());

quotationRevisionSchema.index(
  { organizationId: 1, quotationId: 1, revision: 1 },
  { unique: true },
);
quotationRevisionSchema.index({
  organizationId: 1,
  quotationId: 1,
  status: 1,
});
quotationRevisionSchema.index({
  organizationId: 1,
  quotationId: 1,
  createdAt: -1,
});

export const QuotationRevisionModel: Model<QuotationRevision> =
  (mongoose.models.QuotationRevision as Model<QuotationRevision>) ??
  mongoose.model<QuotationRevision>(
    "QuotationRevision",
    quotationRevisionSchema,
  );

export const quotationRevisionSchemaDefinition = quotationRevisionSchema;
