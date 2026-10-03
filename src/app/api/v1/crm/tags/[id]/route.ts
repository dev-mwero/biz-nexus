import { z } from "zod";
import { TagError, TagService, type UpdateTagInput } from "@/modules/crm";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../_lib/path-param";

const updateTagSchema = z
  .object({
    name: z.string().min(1).max(40).optional(),
    color: z
      .enum([
        "slate",
        "gray",
        "zinc",
        "neutral",
        "stone",
        "red",
        "orange",
        "amber",
        "yellow",
        "lime",
        "green",
        "emerald",
        "teal",
        "cyan",
        "sky",
        "blue",
        "indigo",
        "violet",
        "purple",
        "fuchsia",
        "pink",
        "rose",
      ])
      .optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided",
  );

/**
 * GET /api/v1/crm/tags/:id
 * Get a tag by ID.
 * Permission: tags.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("tags.read");

  const id = pathParam(request);
  const service = new TagService(context.organization._id, context.user._id);

  const tag = await service.getById(id);
  if (!tag) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Tag not found." });
  }

  return ok(tag);
});

/**
 * PATCH /api/v1/crm/tags/:id
 * Update a tag.
 * Permission: tags.update
 */
export const PATCH = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("tags.update");

  const id = pathParam(request);
  const body = await readJson(request);
  const input = updateTagSchema.parse(body);

  const service = new TagService(context.organization._id, context.user._id);

  try {
    // The schema narrows to exactly the fields the service accepts, so this is a
    // narrowing of an already-checked shape rather than a way of silencing the
    // compiler.
    const tag = await service.update(
      id,
      input as UpdateTagInput,
      context.user._id,
    );
    return ok(tag);
  } catch (error) {
    // The service raises SLUG_CONFLICT for a rename onto a name that is already
    // in use within the organization; the catalogue has no narrower
    // duplicate-name code.
    if (error instanceof TagError && error.code === "SLUG_CONFLICT") {
      throw new AppError("SLUG_CONFLICT", { message: error.message });
    }
    if (error instanceof TagError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", { message: "Tag not found." });
    }
    throw error;
  }
});

/**
 * DELETE /api/v1/crm/tags/:id
 * Soft delete a tag.
 * Permission: tags.delete
 */
export const DELETE = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("tags.delete");

  const id = pathParam(request);
  const service = new TagService(context.organization._id, context.user._id);

  try {
    await service.delete(id, context.user._id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof TagError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", { message: "Tag not found." });
    }
    throw error;
  }
});
