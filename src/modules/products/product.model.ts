import mongoose, { type Model, Schema, type Types } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";
import { MAX_UNIT_PRICE_MINOR } from "@/shared/lib/money";

export const PRODUCT_TYPES = ["PRODUCT", "SERVICE"] as const;
export type ProductType = (typeof PRODUCT_TYPES)[number];

export const PRODUCT_STATUSES = ["ACTIVE", "ARCHIVED"] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

export interface Product extends AuditFields, SoftDeleteFields {
  _id: Types.ObjectId;
  organizationId: Types.ObjectId;
  name: string;
  sku?: string | null;
  skuNormalized?: string | null;
  description?: string | null;
  type: ProductType;
  status: ProductStatus;
  unitPriceMinor: number;
  currency: string;
  unitLabel?: string | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

const productSchema = new Schema<Product>(
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
    sku: {
      type: String,
      minlength: 1,
      maxlength: 64,
      trim: true,
      default: null,
    },
    skuNormalized: {
      type: String,
      maxlength: 64,
      trim: true,
      default: null,
    },
    description: {
      type: String,
      maxlength: 5000,
      trim: true,
      default: null,
    },
    type: {
      type: String,
      required: true,
      enum: PRODUCT_TYPES,
    },
    status: {
      type: String,
      required: true,
      enum: PRODUCT_STATUSES,
      default: "ACTIVE",
    },
    unitPriceMinor: {
      type: Number,
      required: true,
      min: 0,
      max: MAX_UNIT_PRICE_MINOR,
      integer: true,
    },
    currency: {
      type: String,
      required: true,
    },
    unitLabel: {
      type: String,
      maxlength: 32,
      trim: true,
      default: null,
    },
  },
  { timestamps: true, collection: "products" },
);

productSchema.plugin(auditFields());
productSchema.plugin(softDelete({ scopeField: "organizationId" }));

productSchema.index({ organizationId: 1, status: 1, type: 1, name: 1 });
productSchema.index(
  { organizationId: 1, skuNormalized: 1 },
  {
    unique: true,
    partialFilterExpression: {
      deletedAt: null,
      skuNormalized: { $type: "string" },
    },
  },
);
productSchema.index({
  organizationId: 1,
  name: "text",
  sku: "text",
  description: "text",
});
productSchema.index({ organizationId: 1, updatedAt: -1 });

export const ProductModel: Model<Product> =
  (mongoose.models.Product as Model<Product>) ??
  mongoose.model<Product>("Product", productSchema);

export const productSchemaDefinition = productSchema;
