import type { Types } from "mongoose";
import { isDuplicateKeyOn } from "@/db/mixins/slug";
import { OrganizationModel } from "@/modules/organizations";
import type { Product, ProductType } from "@/modules/products/product.model";
import {
  PRODUCT_EDITABLE_FIELDS,
  type ProductEditableField,
  type ProductRepository,
  type ProductUpdatePayload,
} from "@/modules/products/product.repository";
import { AppError, type ErrorCode } from "@/shared/errors/app-error";
import { MAX_UNIT_PRICE_MINOR } from "@/shared/lib/money";

/**
 * A product operation that could not be carried out.
 *
 * Per-site codes, for the same reason `DealError` names them: a missing product
 * is a 404 and must stay one, a duplicate SKU is a 409 the caller can fix by
 * choosing another, and a price outside the representable range is a 422. A
 * single code would flatten those into one status and leave handlers
 * string-matching messages to tell them apart.
 */
export class ProductError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, { message });
    this.name = "ProductError";
  }
}

export interface CreateProductInput {
  name: string;
  sku?: string | null;
  description?: string | null;
  type: ProductType;
  unitPriceMinor: number;
  unitLabel?: string | null;
}

/**
 * What `ProductService.update` will accept off the wire.
 *
 * Every key is optional; a key not in `PRODUCT_EDITABLE_FIELDS` is refused by
 * name at runtime. `currency` and `organizationId` are named here even though
 * they are not editable, so the caller that sends one is told which field is
 * server-owned rather than that their key was unknown.
 */
export interface UpdateProductInput extends Partial<ProductUpdatePayload> {
  currency?: string;
  organizationId?: Types.ObjectId | string;
}

/**
 * The runtime half of the editable-field allowlist. See `PRODUCT_EDITABLE_FIELDS`
 * for why this cannot be derived from the zod schema: both are erased the
 * moment the request is parsed.
 */
const EDITABLE_FIELD_SET: ReadonlySet<string> = new Set<string>(
  PRODUCT_EDITABLE_FIELDS,
);

/**
 * The SKU as the uniqueness index stores it.
 *
 * A blank SKU and an absent one are the same thing - a product with no SKU -
 * so both normalise to `undefined` and the index's partial filter leaves them
 * out. Case is folded because a SKU is an identifier a person types, and
 * `abc-1` and `ABC-1` are the same one.
 */
function normalizeSku(sku: string | null | undefined): string | undefined {
  const trimmed = sku?.trim();
  return trimmed ? trimmed.toUpperCase() : undefined;
}

/**
 * Copy one editable field across, if it was supplied.
 *
 * Generic in the key for the reason `deal.service.copyEditableField` is: with a
 * union of keys on the left, TypeScript demands the value satisfy the
 * intersection of every payload field type, and a caller reaching for a
 * suppression to get past that is the mistake worth making impossible.
 */
function copyEditableField<K extends ProductEditableField>(
  payload: ProductUpdatePayload,
  source: Partial<ProductUpdatePayload>,
  key: K,
): void {
  if (key in source) {
    payload[key] = source[key];
  }
}

export class ProductService {
  constructor(
    private readonly productRepo: ProductRepository,
    /**
     * The authenticated actor. The repository is constructed with the same id
     * and uses it to stamp `createdBy`/`updatedBy`, so the service does not read
     * this field today; it is held because every write operation is attributed
     * to an actor and the alternative - reconstructing the actor from the
     * session at each future call site - is how an audit field is one day left
     * unset. Kept in step with the `DealService` constructor.
     */
    readonly actorId: Types.ObjectId,
  ) {}

  /**
   * The organisation's currency, which is the product's currency.
   *
   * Read from the organisation the repository is already scoped to, so the
   * value cannot be steered by the request. A product's price is meaningless
   * without the currency it is denominated in, and taking that from the caller
   * is how a catalogue ends up mixing denominations.
   */
  private async organizationCurrency(): Promise<string> {
    const organization = await OrganizationModel.findOne(
      { _id: this.productRepo.organizationId, deletedAt: null },
      { currency: 1 },
    )
      .lean<{ currency?: string } | null>()
      .exec();

    if (!organization?.currency) {
      throw new ProductError(
        "VALIDATION_FAILED",
        "The organisation for this product could not be read.",
      );
    }

    return organization.currency;
  }

  /**
   * A price must be a whole number of minor units inside the representable
   * range. Anything else - a fraction of a cent, a negative, a value past the
   * cap that keeps a maximally sized document inside `MAX_SAFE_INTEGER` - is a
   * 422 rather than a stored document the money arithmetic cannot handle.
   */
  private assertPrice(unitPriceMinor: number): void {
    if (
      !Number.isInteger(unitPriceMinor) ||
      unitPriceMinor < 0 ||
      unitPriceMinor > MAX_UNIT_PRICE_MINOR
    ) {
      throw new ProductError(
        "VALIDATION_FAILED",
        `A unit price must be a whole number of minor units between 0 and ${MAX_UNIT_PRICE_MINOR}.`,
      );
    }
  }

  /**
   * Refuse a SKU already used by a live product in this organisation.
   *
   * The unique index is the real arbiter; this check turns the ordinary case
   * into a message. `excludeId` lets an update keep its own SKU, which would
   * otherwise read as a collision with itself.
   */
  private async assertSkuAvailable(
    skuNormalized: string | undefined,
    excludeId?: Types.ObjectId | string,
  ): Promise<void> {
    if (!skuNormalized) return;

    const existing = await this.productRepo.findBySkuNormalized(skuNormalized);
    if (
      existing &&
      (!excludeId || String(existing._id) !== String(excludeId))
    ) {
      throw new ProductError(
        "SLUG_CONFLICT",
        `A product with SKU "${skuNormalized}" already exists.`,
      );
    }
  }

  list(
    filter: Record<string, unknown> = {},
    options: {
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
    } = {},
  ) {
    return this.productRepo.findProducts(filter, options);
  }

  count(filter: Record<string, unknown> = {}) {
    return this.productRepo.countProducts(filter);
  }

  getById(id: Types.ObjectId | string): Promise<Product | null> {
    return this.productRepo.findProductById(id);
  }

  /**
   * Create a product.
   *
   * Only the fields this method names are copied, so an extra `currency` or
   * `organizationId` on the input is ignored rather than stored - the currency
   * is the organisation's and the tenant is the session's. Mirrors
   * `DealService.create`, where unknown keys are dropped by construction rather
   * than rejected.
   */
  async create(input: CreateProductInput): Promise<Product> {
    this.assertPrice(input.unitPriceMinor);

    const skuNormalized = normalizeSku(input.sku);
    await this.assertSkuAvailable(skuNormalized);

    const currency = await this.organizationCurrency();

    try {
      return await this.productRepo.create({
        name: input.name,
        sku: input.sku?.trim() || null,
        skuNormalized: skuNormalized ?? null,
        description: input.description?.trim() || null,
        type: input.type,
        status: "ACTIVE",
        unitPriceMinor: input.unitPriceMinor,
        currency,
        unitLabel: input.unitLabel?.trim() || null,
      });
    } catch (error) {
      if (isDuplicateKeyOn(error, "skuNormalized")) {
        throw new ProductError(
          "SLUG_CONFLICT",
          `A product with SKU "${skuNormalized}" already exists.`,
        );
      }
      throw error;
    }
  }

  /**
   * Update a product.
   *
   * The allowlist check is the security fix's runtime half: the zod schema and
   * the TypeScript type are both gone by the time this runs, and an in-process
   * caller is not obliged to have been to the route at all. `currency`,
   * `organizationId`, `skuNormalized` and the timestamps are not writable here,
   * so a request naming one is refused rather than silently ignored.
   *
   * `skuNormalized` is recomputed whenever `sku` is present - including a null
   * that clears it - so the uniqueness key cannot drift from the display value.
   */
  async update(
    id: Types.ObjectId | string,
    input: UpdateProductInput,
  ): Promise<Product | null> {
    for (const key of Object.keys(input)) {
      if (!EDITABLE_FIELD_SET.has(key)) {
        throw new ProductError(
          "VALIDATION_FAILED",
          `The field "${key}" cannot be updated via this endpoint.`,
        );
      }
    }

    const payload: ProductUpdatePayload = {};
    for (const key of PRODUCT_EDITABLE_FIELDS) {
      if (key === "sku") continue;
      copyEditableField(payload, input, key);
    }

    if ("unitPriceMinor" in input && input.unitPriceMinor !== undefined) {
      this.assertPrice(input.unitPriceMinor);
    }

    if ("sku" in input) {
      const skuNormalized = normalizeSku(input.sku);
      await this.assertSkuAvailable(skuNormalized, id);
      payload.sku = input.sku?.trim() || null;
      payload.skuNormalized = skuNormalized ?? null;
    }

    try {
      return await this.productRepo.update(id, payload);
    } catch (error) {
      if (
        isDuplicateKeyOn(error, "skuNormalized") &&
        "sku" in input &&
        input.sku
      ) {
        throw new ProductError(
          "SLUG_CONFLICT",
          `A product with SKU "${input.sku.trim().toUpperCase()}" already exists.`,
        );
      }
      throw error;
    }
  }

  /** Archive a product: a business state, not a delete. */
  archive(id: Types.ObjectId | string): Promise<Product | null> {
    return this.productRepo.update(id, { status: "ARCHIVED" });
  }

  /** Restore an archived product to the active catalogue. */
  restore(id: Types.ObjectId | string): Promise<Product | null> {
    return this.productRepo.update(id, { status: "ACTIVE" });
  }

  /**
   * Soft-delete a product.
   *
   * The existence check is not decoration: `softDeleteById` is scoped, so a
   * product in another organisation matches nothing and is not deleted. Reading
   * first is what lets this answer 404 for the miss rather than reporting a
   * success for a write that never happened. A deleted product stays in the
   * database so historical quotation and order snapshots that reference it
   * remain resolvable; it is never hard-deleted.
   */
  async delete(id: Types.ObjectId | string): Promise<void> {
    const product = await this.productRepo.findProductById(id);
    if (!product) {
      throw new ProductError("RECORD_NOT_FOUND", "Product not found.");
    }
    await this.productRepo.softDeleteById(id);
  }
}
