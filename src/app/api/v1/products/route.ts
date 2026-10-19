import { z } from "zod";
import {
  type CreateProductInput,
  createProductBody,
  PRODUCT_STATUSES,
  PRODUCT_TYPES,
  ProductRepository,
  ProductService,
} from "@/modules/products";
import { parseBody } from "@/shared/api/parse-body";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { dateFromQuery, listQuery } from "@/shared/query/list-query";
import { ok } from "@/shared/responses/envelope";

const productFiltersSchema = z.object({
  status: z.enum(PRODUCT_STATUSES).optional(),
  type: z.enum(PRODUCT_TYPES).optional(),
  createdFrom: dateFromQuery.optional(),
  createdTo: dateFromQuery.optional(),
});

/**
 * The catalogue list's query grammar.
 *
 * Built once at module load so a bad sortable field, a default sort missing
 * from the allow-list, or a typo in an ordered pair is a failure at import
 * rather than on the first request - the argument `listQuery` makes for its own
 * construction-time checks.
 */
const { parse, meta } = listQuery({
  filters: productFiltersSchema,
  sortable: ["name", "unitPriceMinor", "createdAt", "updatedAt"],
  defaultSort: "-createdAt",
  searchable: true,
  orderedPairs: [["createdFrom", "createdTo"]],
});

/**
 * GET /api/v1/products
 * List products with filters, pagination, and sorting.
 * Permission: `products.read`
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("products.read");

  const parsed = parse(new URL(request.url).searchParams);
  const f = parsed.filters;

  const filter: Record<string, unknown> = {};

  if (f.status) filter.status = f.status;
  if (f.type) filter.type = f.type;

  if (f.createdFrom || f.createdTo) {
    const createdAt: Record<string, Date> = {};
    if (f.createdFrom) createdAt.$gte = f.createdFrom;
    if (f.createdTo) createdAt.$lte = f.createdTo;
    filter.createdAt = createdAt;
  }

  // `q` is a Mongo text search rather than the anchored regex the CRM lists
  // use, because the catalogue declares a text index over name, sku and
  // description. `$text` already carries the tenant equality prefix from the
  // repository, so the term cannot escape this organisation.
  if (parsed.q) {
    filter.$text = { $search: parsed.q };
  }

  const repo = new ProductRepository(ctx.organization._id, ctx.user._id);
  const service = new ProductService(repo, ctx.user._id);

  const [products, total] = await Promise.all([
    service.list(filter, {
      sort: parsed.sort,
      limit: parsed.limit,
      skip: parsed.skip,
    }),
    service.count(filter),
  ]);

  return ok(products, meta(parsed, total));
});

/**
 * POST /api/v1/products
 * Create a product.
 * Permission: `products.create`
 */
export const POST = withApi(
  async (request: Request) => {
    const guards = guardsFor(request);
    const ctx = await guards.requirePermission("products.create");

    const body = await parseBody(request, createProductBody);

    const repo = new ProductRepository(ctx.organization._id, ctx.user._id);
    const service = new ProductService(repo, ctx.user._id);

    // Only the fields `CreateProductInput` names are copied. `currency` and
    // `organizationId` are declared on the body schema - so a caller who sends
    // one is told which field is server-owned rather than that their key was
    // unknown - and are deliberately not forwarded: the currency is the
    // organisation's and the tenant is the session's.
    const input: CreateProductInput = {
      name: body.name,
      sku: body.sku,
      description: body.description,
      type: body.type,
      unitPriceMinor: body.unitPriceMinor,
      unitLabel: body.unitLabel,
    };

    const product = await service.create(input);

    return ok(product);
  },
  { status: 201 },
);
