import { Types } from "mongoose";
import { z } from "zod";
import {
  ContactError,
  ContactRepository,
  ContactService,
  type UpdateContactInput,
} from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../_lib/path-param";

const CONTACT_STATUSES = ["LEAD", "PROSPECT", "CUSTOMER", "INACTIVE"] as const;

const emailSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().email(),
  isPrimary: z.boolean().default(false),
});

const phoneSchema = z.object({
  label: z.string().min(1).max(40),
  value: z.string().max(50),
  isPrimary: z.boolean().default(false),
});

const updateContactSchema = z
  .object({
    firstName: z.string().min(1).max(80).optional(),
    lastName: z.string().min(1).max(80).optional(),
    salutation: z.string().max(20).optional().nullable(),
    jobTitle: z.string().max(100).optional().nullable(),
    companyId: z.string().optional().nullable(),
    ownerId: z.string().optional(),
    emails: z.array(emailSchema).optional(),
    phones: z.array(phoneSchema).optional(),
    status: z.enum(CONTACT_STATUSES).optional(),
    tags: z.array(z.string()).optional(),
    notes: z.string().max(2000).optional().nullable(),
    customFields: z.record(z.string(), z.unknown()).optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided",
  );

/**
 * GET /api/v1/crm/contacts/:id
 * Get a contact by ID.
 * Permission: contacts.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("contacts.read");

  const id = pathParam(request);
  const service = new ContactService(
    context.organization._id,
    context.user._id,
  );

  const contact = await service.getById(id);
  if (!contact) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Contact not found." });
  }

  return ok(contact);
});

/**
 * PATCH /api/v1/crm/contacts/:id
 * Update a contact.
 * Permission: contacts.update
 */
export const PATCH = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("contacts.update");

  const id = pathParam(request);
  const body = await request.json();
  const input = updateContactSchema.parse(body);

  const service = new ContactService(
    context.organization._id,
    context.user._id,
  );

  try {
    // Only the id-bearing fields need translating, and each is translated only
    // when it was supplied: an update distinguishes "clear this" from "leave
    // this alone", so `null` must survive and a missing key must stay missing.
    const { companyId, ownerId, tags, ...rest } = input;
    const updateInput: UpdateContactInput = {
      ...rest,
      ...(companyId !== undefined
        ? { companyId: companyId ? new Types.ObjectId(companyId) : null }
        : {}),
      ...(ownerId ? { ownerId: new Types.ObjectId(ownerId) } : {}),
      ...(tags ? { tags: tags.map((tagId) => new Types.ObjectId(tagId)) } : {}),
    };

    const contact = await service.update(id, updateInput, context.user._id);
    return ok(contact);
  } catch (error) {
    if (error instanceof ContactError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", {
        message: "Contact not found.",
      });
    }
    // As on create, the service's only conflict is a primary address that
    // already belongs to somebody else.
    if (error instanceof ContactError && error.code === "CONFLICT") {
      throw new AppError("EMAIL_ALREADY_REGISTERED", {
        message: error.message,
      });
    }
    // An already-soft-deleted contact cannot be updated. The catalogue has no
    // dedicated "wrong state" code, and this refusal describes a body that
    // could never succeed against this record, which is what 422 means.
    if (error instanceof ContactError && error.code === "INVALID_STATE") {
      throw new AppError("VALIDATION_FAILED", { message: error.message });
    }
    if (error instanceof ContactError && error.code === "VALIDATION_FAILED") {
      throw new AppError("VALIDATION_FAILED", { message: error.message });
    }
    throw error;
  }
});

/**
 * DELETE /api/v1/crm/contacts/:id
 * Soft delete a contact.
 * Permission: contacts.delete
 */
export const DELETE = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("contacts.delete");

  const id = pathParam(request);
  const service = new ContactService(
    context.organization._id,
    context.user._id,
  );

  try {
    await service.delete(id, context.user._id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof ContactError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", {
        message: "Contact not found.",
      });
    }
    throw error;
  }
});

/**
 * POST /api/v1/crm/contacts/:id/restore
 * Restore a soft-deleted contact.
 * Permission: contacts.update
 */
export const POST = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("contacts.update");

  const id = pathParam(request);
  const service = new ContactService(
    context.organization._id,
    context.user._id,
  );

  // The repository rather than the service: `restoreById` reaches rows the
  // tenant scope hides, which is the whole point of a restore, and the service
  // deliberately does not expose it. It is scoped to the same organization, so
  // a foreign id matches nothing and is a 404 rather than a write.
  const repo = new ContactRepository(
    context.organization._id,
    context.user._id,
  );
  const restored = await repo.restoreById(id);
  if (restored.matchedCount === 0) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Contact not found." });
  }

  const contact = await service.getById(id);
  return ok(contact);
});
