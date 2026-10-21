/**
 * The product as the API sends it.
 *
 * A local shape rather than the Mongoose `Product`: the wire has string ids and
 * ISO date strings, and importing the model would drag Mongoose into a client
 * bundle.
 */
export interface ProductRecord {
  _id: string;
  name: string;
  sku?: string | null;
  description?: string | null;
  type: "PRODUCT" | "SERVICE";
  status: "ACTIVE" | "ARCHIVED";
  unitPriceMinor: number;
  currency: string;
  unitLabel?: string | null;
  createdAt: string;
  updatedAt: string;
}

export const PRODUCT_TYPE_OPTIONS = ["PRODUCT", "SERVICE"] as const;
export const PRODUCT_STATUS_OPTIONS = ["ACTIVE", "ARCHIVED"] as const;

export type ProductType = (typeof PRODUCT_TYPE_OPTIONS)[number];
export type ProductStatus = (typeof PRODUCT_STATUS_OPTIONS)[number];
