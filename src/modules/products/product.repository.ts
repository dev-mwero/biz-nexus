import type { Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import { type Product, ProductModel } from "@/modules/products/product.model";

export interface ProductUpdatePayload {
  name?: string;
  sku?: string | null;
  /**
   * Derived from `sku`, and service-managed. Deliberately absent from
   * `PRODUCT_EDITABLE_FIELDS`: a client edits the SKU and the service keeps the
   * uniqueness key in step, and a client able to write this directly could
   * desynchronise the two.
   */
  skuNormalized?: string | null;
  description?: string | null;
  type?: "PRODUCT" | "SERVICE";
  status?: "ACTIVE" | "ARCHIVED";
  unitPriceMinor?: number;
  unitLabel?: string | null;
}

export const PRODUCT_EDITABLE_FIELDS = [
  "name",
  "sku",
  "description",
  "type",
  "status",
  "unitPriceMinor",
  "unitLabel",
] as const satisfies readonly (keyof ProductUpdatePayload)[];

export type ProductEditableField = (typeof PRODUCT_EDITABLE_FIELDS)[number];

/**
 * Repository for product operations.
 *
 * All operations are scoped to the organizationId provided at construction.
 */
export class ProductRepository extends TenantRepository<Product> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(ProductModel, organizationId, actorId);
  }

  findProducts(
    filter: Record<string, unknown> = {},
    options: {
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
      projection?: Record<string, unknown>;
    } = {},
  ) {
    const { sort = { createdAt: -1 }, limit, skip, projection } = options;
    return this.find(filter, projection, { sort, limit, skip }).lean();
  }

  countProducts(filter: Record<string, unknown> = {}) {
    return this.countDocuments(filter);
  }

  async findProductById(id: Types.ObjectId | string): Promise<Product | null> {
    return this.findById(id).lean<Product | null>().exec();
  }

  async findBySkuNormalized(
    skuNormalized: string | null | undefined,
  ): Promise<Product | null> {
    if (!skuNormalized) return null;
    return this.findOne({ skuNormalized }).lean<Product | null>().exec();
  }

  create(
    input: {
      name: string;
      sku?: string | null;
      skuNormalized?: string | null;
      description?: string | null;
      type: "PRODUCT" | "SERVICE";
      status?: "ACTIVE" | "ARCHIVED";
      unitPriceMinor: number;
      currency: string;
      unitLabel?: string | null;
    },
    options?: Parameters<TenantRepository<Product>["create"]>[1],
  ): ReturnType<TenantRepository<Product>["create"]> {
    return super.create(
      {
        name: input.name,
        sku: input.sku ?? null,
        skuNormalized: input.skuNormalized ?? null,
        description: input.description ?? null,
        type: input.type,
        status: input.status ?? "ACTIVE",
        unitPriceMinor: input.unitPriceMinor,
        currency: input.currency,
        unitLabel: input.unitLabel ?? null,
      },
      options,
    );
  }

  update(
    id: Types.ObjectId | string,
    update: Partial<ProductUpdatePayload>,
    options?: Parameters<TenantRepository<Product>["findByIdAndUpdate"]>[2],
  ) {
    return this.findByIdAndUpdate(id, { $set: update }, options);
  }
}
