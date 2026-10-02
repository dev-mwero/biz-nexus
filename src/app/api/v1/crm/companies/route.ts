import { Types } from "mongoose";
import { z } from "zod";
import {
  CompanyError,
  CompanyService,
  type CreateCompanyInput,
} from "@/modules/crm";
import { queryFromSearchParams } from "@/shared/api/search-params";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok, pageMeta } from "@/shared/responses/envelope";

/**
 * Read an id that a query string may express as absent.
 *
 * Three states, not two. `undefined` means the parameter was not sent and the
 * caller wants no filter; `null` means the caller explicitly asked for records
 * with no such link; anything else is an id. The literal string `"null"` is the
 * only way a URL can carry the second state, and a malformed id is a client
 * error reported as such rather than a BSON exception that reaches the client
 * as a 500.
 */
function parseNullableId(
  value: string | null | undefined,
): Types.ObjectId | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "" || value === "null") return null;
  if (!Types.ObjectId.isValid(value)) {
    throw AppError.validation(
      [{ path: "parentId", message: 'Must be an id or "null"' }],
      "Invalid query parameters",
    );
  }
  return new Types.ObjectId(value);
}

const COMPANY_STATUSES = [
  "PROSPECT",
  "CUSTOMER",
  "PARTNER",
  "SUPPLIER",
  "INACTIVE",
] as const;

const addressSchema = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    postalCode: z.string().optional(),
    country: z.string().length(2).optional(),
  })
  .optional();

const createCompanySchema = z.object({
  name: z.string().min(1).max(160),
  legalName: z.string().max(160).optional(),
  industry: z.string().max(100).optional(),
  website: z.string().url().optional().nullable(),
  email: z.string().email().optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  billingAddress: addressSchema,
  shippingAddress: addressSchema,
  ownerId: z.string().min(1),
  status: z.enum(COMPANY_STATUSES).default("PROSPECT"),
  tags: z.array(z.string()).default([]),
  notes: z.string().max(2000).optional().nullable(),
  customFields: z.record(z.string(), z.unknown()).default({}),
  size: z.number().int().positive().optional().nullable(),
  annualRevenue: z.number().nonnegative().optional().nullable(),
  parentId: z.string().optional().nullable(),
  domain: z.string().max(255).optional().nullable(),
});

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sort: z.string().default("-createdAt"),
  status: z.enum(COMPANY_STATUSES).optional(),
  ownerId: z.string().optional(),
  tag: z.array(z.string()).default([]),
  q: z.string().max(200).optional(),
  parentId: z.string().optional().nullable(),
});

/**
 * GET /api/v1/crm/companies
 * List companies with filters, sorting, and pagination.
 * Permission: companies.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("companies.read");

  const { searchParams } = new URL(request.url);
  const query = listQuerySchema.parse(
    queryFromSearchParams(searchParams, ["tag"]),
  );

  const service = new CompanyService(
    context.organization._id,
    context.user._id,
  );

  const filters = {
    status: query.status,
    ownerId: query.ownerId ? new Types.ObjectId(query.ownerId) : undefined,
    tagIds: query.tag.map((id) => new Types.ObjectId(id)),
    q: query.q,
    // A query string has no null, so `parentId=null` is how a client asks for
    // root companies — the filter is "has no parent", and `undefined` means
    // "no filter at all". The two are different and conflating them makes the
    // tree view unfilterable. Validated rather than handed to
    // `new Types.ObjectId`, which throws a BSON error that surfaces as a 500
    // for what is a malformed query.
    parentId: parseNullableId(query.parentId),
  };

  const result = await service.list(filters, {
    sort: query.sort,
    page: query.page,
    pageSize: query.pageSize,
  });

  return ok(
    result.items,
    pageMeta({
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
    }),
  );
});

/**
 * POST /api/v1/crm/companies
 * Create a new company.
 * Permission: companies.create
 */
export const POST = withApi(
  async (request: Request) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("companies.create");

    const body = await request.json();
    const input = createCompanySchema.parse(body);

    const service = new CompanyService(
      context.organization._id,
      context.user._id,
    );

    try {
      const company = await service.create({
        organizationId: context.organization._id,
        actorId: context.user._id,
        name: input.name,
        // The service stores the absence of a value as null; the input type says
        // "not supplied" as undefined, so an absent field is translated rather
        // than passed through.
        legalName: input.legalName ?? undefined,
        industry: input.industry ?? undefined,
        website: input.website ?? undefined,
        email: input.email ?? undefined,
        phone: input.phone ?? undefined,
        billingAddress: input.billingAddress,
        shippingAddress: input.shippingAddress,
        ownerId: new Types.ObjectId(input.ownerId),
        status: input.status,
        tags: input.tags.map((id) => new Types.ObjectId(id)),
        notes: input.notes ?? undefined,
        customFields: input.customFields,
        size: input.size ?? undefined,
        annualRevenue: input.annualRevenue ?? undefined,
        parentId: input.parentId
          ? new Types.ObjectId(input.parentId)
          : undefined,
        domain: input.domain ?? undefined,
      });

      return ok(company);
    } catch (error) {
      // A domain is the company's unique identifier, so the refusal is the same
      // kind of refusal as a name that is taken.
      if (error instanceof CompanyError && error.code === "CONFLICT") {
        throw new AppError("SLUG_CONFLICT", { message: error.message });
      }
      if (error instanceof CompanyError && error.code === "VALIDATION_FAILED") {
        throw new AppError("VALIDATION_FAILED", { message: error.message });
      }
      throw error;
    }
  },
  { status: 201 },
);
