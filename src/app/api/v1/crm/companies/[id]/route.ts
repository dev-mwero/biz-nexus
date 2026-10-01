import { Types } from "mongoose";
import { z } from "zod";
import {
  CompanyError,
  CompanyRepository,
  CompanyService,
  type UpdateCompanyInput,
} from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../_lib/path-param";

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
  .optional()
  .nullable();

const updateCompanySchema = z
  .object({
    name: z.string().min(1).max(160).optional(),
    legalName: z.string().max(160).optional().nullable(),
    industry: z.string().max(100).optional().nullable(),
    website: z.string().url().optional().nullable(),
    email: z.string().email().optional().nullable(),
    phone: z.string().max(50).optional().nullable(),
    billingAddress: addressSchema,
    shippingAddress: addressSchema,
    ownerId: z.string().optional(),
    status: z.enum(COMPANY_STATUSES).optional(),
    tags: z.array(z.string()).optional(),
    notes: z.string().max(2000).optional().nullable(),
    customFields: z.record(z.string(), z.unknown()).optional(),
    size: z.number().int().positive().optional().nullable(),
    annualRevenue: z.number().nonnegative().optional().nullable(),
    parentId: z.string().optional().nullable(),
    domain: z.string().max(255).optional().nullable(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided",
  );

/**
 * GET /api/v1/crm/companies/:id
 * Get a company by ID.
 * Permission: companies.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("companies.read");

  const id = pathParam(request);
  const service = new CompanyService(
    context.organization._id,
    context.user._id,
  );

  const company = await service.getById(id);
  if (!company) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Company not found." });
  }

  return ok(company);
});

/**
 * PATCH /api/v1/crm/companies/:id
 * Update a company.
 * Permission: companies.update
 */
export const PATCH = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("companies.update");

  const id = pathParam(request);
  const body = await request.json();
  const input = updateCompanySchema.parse(body);

  const service = new CompanyService(
    context.organization._id,
    context.user._id,
  );

  try {
    // The parsed fields are strings and the service wants ids, so each id field
    // is translated where it was supplied and left absent where it was not —
    // an update distinguishes "clear this" from "leave this alone", so `null`
    // has to survive the conversion and `undefined` must not become one.
    const { ownerId, tags, parentId, ...rest } = input;
    const updateInput: UpdateCompanyInput = {
      ...rest,
      ...(ownerId ? { ownerId: new Types.ObjectId(ownerId) } : {}),
      ...(tags ? { tags: tags.map((tagId) => new Types.ObjectId(tagId)) } : {}),
      ...(parentId !== undefined
        ? { parentId: parentId ? new Types.ObjectId(parentId) : null }
        : {}),
    };

    const company = await service.update(id, updateInput, context.user._id);
    return ok(company);
  } catch (error) {
    if (error instanceof CompanyError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", {
        message: "Company not found.",
      });
    }
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
});

/**
 * DELETE /api/v1/crm/companies/:id
 * Soft delete a company.
 * Permission: companies.delete
 */
export const DELETE = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("companies.delete");

  const id = pathParam(request);
  const service = new CompanyService(
    context.organization._id,
    context.user._id,
  );

  try {
    await service.delete(id, context.user._id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof CompanyError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", {
        message: "Company not found.",
      });
    }
    // Contacts or child companies still point at this one. It is a 409 rather
    // than a 422 because the record is fine and the caller's plan for it is not;
    // `SLUG_CONFLICT` is the catalogue's general-purpose 409 and carries this
    // project's message, which is the part that says what to do about it.
    if (error instanceof CompanyError && error.code === "CONFLICT") {
      throw new AppError("SLUG_CONFLICT", { message: error.message });
    }
    throw error;
  }
});

/**
 * POST /api/v1/crm/companies/:id/restore
 * Restore a soft-deleted company.
 * Permission: companies.update
 */
export const POST = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("companies.update");

  const id = pathParam(request);

  // The repository rather than the service: `restoreById` reaches rows the
  // tenant scope hides, which is the whole point of a restore, and the service
  // deliberately does not expose it. `restoreById` is scoped to the same
  // organization, so a foreign id matches nothing and is a 404 rather than a
  // write.
  const repo = new CompanyRepository(
    context.organization._id,
    context.user._id,
  );
  const restored = await repo.restoreById(id);
  if (restored.matchedCount === 0) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Company not found." });
  }

  const service = new CompanyService(
    context.organization._id,
    context.user._id,
  );
  const company = await service.getById(id);
  return ok(company);
});
