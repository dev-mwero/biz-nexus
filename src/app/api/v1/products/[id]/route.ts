import { objectIdParam } from "@/app/api/_lib/path-param";
import {
  ProductError,
  ProductRepository,
  ProductService,
  updateProductBody,
} from "@/modules/products";
import { parseBody } from "@/shared/api/parse-body";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

/**
 * GET /api/v1/products/:id
 * Get a product by ID.
 * Permission: `products.read`
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("products.read");

  const id = objectIdParam(request);

  const service = new ProductService(
    new ProductRepository(ctx.organization._id, ctx.user._id),
    ctx.user._id,
  );

  const product = await service.getById(id);
  if (!product) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Product not found." });
  }

  return ok(product);
});

/**
 * PATCH /api/v1/products/:id
 * Update a product.
 * Permission: `products.update`
 */
export const PATCH = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("products.update");

  const id = objectIdParam(request);
  const body = await parseBody(request, updateProductBody);

  const service = new ProductService(
    new ProductRepository(ctx.organization._id, ctx.user._id),
    ctx.user._id,
  );

  try {
    const product = await service.update(id, body);

    // A scoped update matches nothing when the product is absent, soft-deleted,
    // or in another organisation. All three are the same answer on purpose.
    if (!product) {
      throw new AppError("RECORD_NOT_FOUND", { message: "Product not found." });
    }

    return ok(product);
  } catch (error) {
    // The service raises its own codes; each maps to a status the catalogue
    // already holds, restated here so a new code cannot quietly inherit the
    // wrong one. A non-`ProductError` - including the `AppError` raised above -
    // propagates unchanged.
    if (error instanceof ProductError) {
      if (error.code === "SLUG_CONFLICT") {
        throw new AppError("SLUG_CONFLICT", { message: error.message });
      }
      if (error.code === "VALIDATION_FAILED") {
        throw new AppError("VALIDATION_FAILED", { message: error.message });
      }
      if (error.code === "RECORD_NOT_FOUND") {
        throw new AppError("RECORD_NOT_FOUND", { message: error.message });
      }
    }
    throw error;
  }
});

/**
 * DELETE /api/v1/products/:id
 * Soft delete a product.
 * Permission: `products.delete`
 */
export const DELETE = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("products.delete");

  const id = objectIdParam(request);

  const service = new ProductService(
    new ProductRepository(ctx.organization._id, ctx.user._id),
    ctx.user._id,
  );

  try {
    await service.delete(id);
  } catch (error) {
    if (error instanceof ProductError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", { message: error.message });
    }
    throw error;
  }

  return new Response(null, { status: 204 });
});
