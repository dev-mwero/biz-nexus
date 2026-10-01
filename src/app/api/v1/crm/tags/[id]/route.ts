import type { Types } from "mongoose";
import { z } from "zod";
import { TagError, TagService, type UpdateTagInput } from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { fail, ok } from "@/shared/responses/envelope";

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
export const GET = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("tags.read");

    const { id } = await params;
    const service = new TagService(context.organization._id, context.user._id);

    const tag = await service.getById(id);
    if (!tag) {
      throw new AppError("RECORD_NOT_FOUND", { message: "Tag not found." });
    }

    return ok(tag);
  },
);

/**
 * PATCH /api/v1/crm/tags/:id
 * Update a tag.
 * Permission: tags.update
 */
export const PATCH = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("tags.update");

    const { id } = await params;
    const body = await request.json();
    const input = updateTagSchema.parse(body);

    const service = new TagService(context.organization._id, context.user._id);

    try {
      const tag = await service.update(
        id,
        input as UpdateTagInput,
        context.user._id,
      );
      return ok(tag);
    } catch (error) {
      if (error instanceof TagError && error.code === "CONFLICT") {
        throw new AppError("CONFLICT", { message: error.message });
      }
      if (error instanceof TagError && error.code === "RECORD_NOT_FOUND") {
        throw new AppError("RECORD_NOT_FOUND", { message: "Tag not found." });
      }
      throw error;
    }
  },
);

/**
 * DELETE /api/v1/crm/tags/:id
 * Soft delete a tag.
 * Permission: tags.delete
 */
export const DELETE = withApi(
  async (request: Request, { params }: { params: Promise<{ id: string }> }) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("tags.delete");

    const { id } = await params;
    const service = new TagService(context.organization._id, context.user._id);

    try {
      await service.delete(id, context.user._id);
      return new Response(null, { status: 204 });
    } catch (error) {
      if (error instanceof TagError && error.code === "RECORD_NOT_FOUND") {
        throw new AppError("RECORD_NOT_FOUND", { message: "Tag not found." });
      }
      if (error instanceof TagError && error.code === "CONFLICT") {
        throw new AppError("CONFLICT", { message: error.message });
      }
      throw error;
    }
  },
);
