import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * A contact in the CRM.
 *
 * Per docs/DATABASE.md §4.
 */
export const CONTACT_STATUSES = [
  "LEAD",
  "PROSPECT",
  "CUSTOMER",
  "INACTIVE",
] as const;

export type ContactStatus = (typeof CONTACT_STATUSES)[number];

export interface ContactEmail {
  label: string;
  value: string;
  isPrimary: boolean;
}

export interface ContactPhone {
  label: string;
  value: string;
  isPrimary: boolean;
}

export interface Contact extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  firstName: string;
  lastName: string;
  salutation?: string | null;
  jobTitle?: string | null;
  companyId?: Types.ObjectId | null;
  ownerId: Types.ObjectId;
  primaryEmail?: string | null;
  emails: ContactEmail[];
  phones: ContactPhone[];
  status: ContactStatus;
  tags: Types.ObjectId[];
  notes?: string | null;
  customFields: Record<string, unknown>;
  lastContactedAt?: Date | null;
  mergedIntoId?: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const emailSchema = new Schema<ContactEmail>(
  {
    label: { type: String, trim: true, maxlength: 40 },
    value: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      maxlength: 255,
    },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

const phoneSchema = new Schema<ContactPhone>(
  {
    label: { type: String, trim: true, maxlength: 40 },
    value: { type: String, required: true, trim: true, maxlength: 50 },
    isPrimary: { type: Boolean, default: false },
  },
  { _id: false },
);

const contactSchema = new Schema<Contact>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "Organization",
    },
    firstName: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 80,
      trim: true,
    },
    lastName: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 80,
      trim: true,
    },
    salutation: { type: String, maxlength: 20, trim: true, default: null },
    jobTitle: { type: String, maxlength: 100, trim: true, default: null },
    companyId: {
      type: Schema.Types.ObjectId,
      ref: "Company",
      default: null,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      required: true,
      ref: "User",
    },
    primaryEmail: {
      type: String,
      maxlength: 255,
      trim: true,
      lowercase: true,
      default: null,
    },
    emails: { type: [emailSchema], default: () => [] },
    phones: { type: [phoneSchema], default: () => [] },
    status: {
      type: String,
      required: true,
      enum: CONTACT_STATUSES,
      default: "LEAD",
    },
    tags: [{ type: Schema.Types.ObjectId, ref: "Tag" }],
    notes: { type: String, maxlength: 2000, trim: true, default: null },
    customFields: { type: Schema.Types.Mixed, default: () => ({}) },
    lastContactedAt: { type: Date, default: null },
    mergedIntoId: {
      type: Schema.Types.ObjectId,
      ref: "Contact",
      default: null,
    },
  },
  { timestamps: true, collection: "contacts" },
);

contactSchema.plugin(auditFields());
contactSchema.plugin(softDelete({ scopeField: "organizationId" }));

// Indexes per DATABASE.md §4
contactSchema.index({ organizationId: 1, lastName: 1, firstName: 1 });
contactSchema.index({ organizationId: 1, companyId: 1, lastName: 1 });
contactSchema.index({ organizationId: 1, ownerId: 1, updatedAt: -1 });
contactSchema.index({ organizationId: 1, status: 1, createdAt: -1 });
contactSchema.index({ organizationId: 1, primaryEmail: 1 });
contactSchema.index({ organizationId: 1, tags: 1 });
contactSchema.index({
  organizationId: 1,
  firstName: "text",
  lastName: "text",
  primaryEmail: "text",
  notes: "text",
});

export const ContactModel: Model<Contact> =
  (mongoose.models.Contact as Model<Contact>) ??
  mongoose.model<Contact>("Contact", contactSchema);

export const contactSchemaDefinition = contactSchema;
