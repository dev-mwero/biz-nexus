import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A company (account) in the CRM.
 *
 * Companies can have a parent/child hierarchy via `parentId`. The `domain`
 * field enables automatic contact-to-company association on email domain match.
 *
 * Per docs/DATABASE.md §4.
 */
export const COMPANY_STATUSES = [
  "PROSPECT",
  "CUSTOMER",
  "PARTNER",
  "SUPPLIER",
  "INACTIVE",
] as const;

export type CompanyStatus = (typeof COMPANY_STATUSES)[number];

export interface Address {
  line1?: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface Company extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  legalName?: string | null;
  industry?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: Address | null;
  shippingAddress?: Address | null;
  ownerId: Types.ObjectId;
  status: CompanyStatus;
  tags: Types.ObjectId[];
  notes?: string | null;
  /** Custom field values, validated against field_definitions. Never indexed. */
  customFields: Record<string, unknown>;
  size?: number | null;
  annualRevenue?: number | null;
  /** Parent company for hierarchy. */
  parentId?: Types.ObjectId | null;
  /** Email domain for auto-association. Lowercased, no protocol. */
  domain?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const addressSchema = new Schema<Address>(
  {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    city: { type: String, trim: true },
    state: { type: String, trim: true },
    postalCode: { type: String, trim: true },
    country: { type: String, trim: true, uppercase: true, maxlength: 2 },
  },
  { _id: false },
);

const companySchema = new Schema<Company>(
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
    legalName: { type: String, maxlength: 160, trim: true, default: null },
    industry: { type: String, maxlength: 100, trim: true, default: null },
    website: {
      type: String,
      maxlength: 255,
      trim: true,
      default: null,
      validate: {
        validator: (v: string | null) => !v || /^https?:\/\//i.test(v),
        message:
          "Website must be a valid URL starting with http:// or https://",
      },
    },
    email: {
      type: String,
      maxlength: 255,
      trim: true,
      lowercase: true,
      default: null,
    },
    phone: { type: String, maxlength: 50, trim: true, default: null },
    billingAddress: { type: addressSchema, default: null },
    shippingAddress: { type: addressSchema, default: null },
    ownerId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    status: {
      type: String,
      required: true,
      enum: COMPANY_STATUSES,
      default: "PROSPECT",
    },
    tags: [{ type: Schema.Types.ObjectId, ref: "Tag" }],
    notes: { type: String, maxlength: 2000, trim: true, default: null },
    customFields: { type: Schema.Types.Mixed, default: () => ({}) },
    size: { type: Number, min: 1, default: null },
    annualRevenue: { type: Number, min: 0, default: null },
    parentId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    domain: {
      type: String,
      trim: true,
      lowercase: true,
      default: null,
      maxlength: 255,
    },
  },
  { timestamps: true, collection: "companies" },
);

companySchema.plugin(auditFields());
companySchema.plugin(softDelete({ scopeField: "organizationId" }));

// Indexes per DATABASE.md §4
companySchema.index({ organizationId: 1, name: 1 });
companySchema.index({ organizationId: 1, status: 1, createdAt: -1 });
companySchema.index({ organizationId: 1, ownerId: 1, updatedAt: -1 });
companySchema.index({ organizationId: 1, domain: 1 });
companySchema.index({
  organizationId: 1,
  name: "text",
  industry: "text",
  notes: "text",
});
companySchema.index({ organizationId: 1, tags: 1 });
companySchema.index({ organizationId: 1, parentId: 1 });

export const CompanyModel: Model<Company> =
  (mongoose.models.Company as Model<Company>) ??
  mongoose.model<Company>("Company", companySchema);

export const companySchemaDefinition = companySchema;
