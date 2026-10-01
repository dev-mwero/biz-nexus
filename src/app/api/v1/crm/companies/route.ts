import type { Types } from "mongoose";
import { z } from "zod";
import {
  CompanyError,
  CompanyService,
  type CreateCompanyInput,
} from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok, pageMeta } from "@/shared/responses/envelope";

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
  customFields: z.record(z.unknown()).default({}),
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
  const query = listQuerySchema.parse(Object.fromEntries(searchParams));

  const service = new CompanyService(
    context.organization._id,
    context.user._id,
  );

  const filters = {
    status: query.status,
    ownerId: query.ownerId
      ? new context.organization.constructor(query.ownerId)
      : undefined,
    tagIds: query.tag.map((id) => new context.organization.constructor(id)),
    q: query.q,
    parentId: query.parentId
      ? new context.organization.constructor(query.parentId)
      : undefined,
  };

  const result = await service.list(filters, {
    sort: query.sort,
    page: query.page,
    pageSize: query.pageSize,
  });

  return ok({
    data: result.items,
    meta: pageMeta({
      page: query.page,
      pageSize: query.pageSize,
      total: result.total,
    }),
  });
});

/**
 * POST /api/v1/crm/companies
 * Create a new company.
 * Permission: companies.create
 */
export const POST = withApi(async (request: Request) => {
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
      legalName: input.legalName,
      industry: input.industry,
      website: input.website,
      email: input.email,
      phone: input.phone,
      billingAddress: input.billingAddress,
      shippingAddress: input.shippingAddress,
      ownerId: new context.organization.constructor(input.ownerId),
      status: input.status,
      tags: input.tags.map((id) => new context.organization.constructor(id)),
      notes: input.notes,
      customFields: input.customFields,
      size: input.size,
      annualRevenue: input.annualRevenue,
      parentId: input.parentId
        ? new context.organization.constructor(input.parentId)
        : undefined,
      domain: input.domain,
    });

    return ok(company, undefined, { status: 201 });
  } catch (error) {
    if (error instanceof CompanyError && error.code === "CONFLICT") {
      throw new AppError("CONFLICT", { message: error.message });
    }
    if (error instanceof CompanyError && error.code === "VALIDATION_FAILED") {
      throw new AppError("VALIDATION_FAILED", { message: error.message });
    }
    throw error;
  }
});
