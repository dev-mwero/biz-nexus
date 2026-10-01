import { z } from "zod";
import {
  SavedViewError,
  SavedViewService,
  type UpdateSavedViewInput,
} from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../_lib/path-param";

const updateSavedViewSchema = z
  .object({
    name: z.string().min(1).max(60).optional(),
    filters: z.record(z.string(), z.unknown()).optional(),
    sort: z.string().optional(),
    columns: z
      .array(
        z.object({
          key: z.string(),
          width: z.number().int().positive().max(600).optional(),
        }),
      )
      .optional(),
    isShared: z.boolean().optional(),
  })
  .refine(
    (data) => Object.keys(data).length > 0,
    "At least one field must be provided",
  );

/**
 * GET /api/v1/crm/saved-views/:id
 * Get a saved view by ID.
 * Permission: savedViews.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("savedViews.read");

  const id = pathParam(request);
  const service = new SavedViewService(
    context.organization._id,
    context.user._id,
  );

  const savedView = await service.getById(id);
  if (!savedView) {
    throw new AppError("RECORD_NOT_FOUND", {
      message: "Saved view not found.",
    });
  }

  return ok(savedView);
});

/**
 * PATCH /api/v1/crm/saved-views/:id
 * Update a saved view.
 * Permission: savedViews.update (owner only, or shared with {entity}.update)
 * Note: The API layer enforces ownership; the service also checks.
 */
export const PATCH = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("savedViews.update");

  const id = pathParam(request);
  const body = await request.json();
  const input = updateSavedViewSchema.parse(body);

  const service = new SavedViewService(
    context.organization._id,
    context.user._id,
  );

  try {
    // The schema narrows to exactly the fields the service accepts, so this is a
    // narrowing of an already-checked shape rather than a way of silencing the
    // compiler.
    const savedView = await service.update(
      id,
      input as UpdateSavedViewInput,
      context.user._id,
      context.user._id,
    );
    return ok(savedView);
  } catch (error) {
    if (error instanceof SavedViewError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", {
        message: "Saved view not found.",
      });
    }
    // The service raises SLUG_CONFLICT when the caller already owns a view at
    // this name and scope; the catalogue has no narrower duplicate-name code.
    if (error instanceof SavedViewError && error.code === "SLUG_CONFLICT") {
      throw new AppError("SLUG_CONFLICT", { message: error.message });
    }
    if (
      error instanceof SavedViewError &&
      error.code === "INSUFFICIENT_PERMISSION"
    ) {
      throw new AppError("INSUFFICIENT_PERMISSION", {
        message: error.message,
      });
    }
    throw error;
  }
});

/**
 * DELETE /api/v1/crm/saved-views/:id
 * Delete a saved view.
 * Permission: savedViews.delete (owner only)
 */
export const DELETE = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("savedViews.delete");

  const id = pathParam(request);
  const service = new SavedViewService(
    context.organization._id,
    context.user._id,
  );

  try {
    await service.delete(id, context.user._id, context.user._id);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof SavedViewError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", {
        message: "Saved view not found.",
      });
    }
    if (
      error instanceof SavedViewError &&
      error.code === "INSUFFICIENT_PERMISSION"
    ) {
      throw new AppError("INSUFFICIENT_PERMISSION", {
        message: error.message,
      });
    }
    throw error;
  }
});
