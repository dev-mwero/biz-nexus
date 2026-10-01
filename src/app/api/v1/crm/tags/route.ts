import type { Types } from "mongoose";
import { z } from "zod";
import {
  type CreateTagInput,
  type MergeTagsInput,
  TagError,
  TagService,
  type UpdateTagInput,
} from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { fail, ok, pageMeta } from "@/shared/responses/envelope";

const createTagSchema = z.object({
  name: z.string().min(1).max(40),
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
});

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

const mergeTagsSchema = z
  .object({
    sourceTagId: z.string().min(1),
    targetTagId: z.string().min(1),
  })
  .refine(
    (data) => data.sourceTagId !== data.targetTagId,
    "Cannot merge a tag into itself",
  );

const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  q: z.string().max(200).optional(),
});

/**
 * GET /api/v1/crm/tags
 * List tags with optional search.
 * Permission: tags.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("tags.read");

  const { searchParams } = new URL(request.url);
  const query = listQuerySchema.parse(Object.fromEntries(searchParams));

  const service = new TagService(context.organization._id, context.user._id);

  if (query.q) {
    const tags = await service.search(query.q, query.pageSize);
    return ok({
      data: tags,
      meta: pageMeta({
        page: query.page,
        pageSize: query.pageSize,
        total: tags.length,
      }),
    });
  }

  const tags = await service.list();
  const start = (query.page - 1) * query.pageSize;
  const paginated = tags.slice(start, start + query.pageSize);

  return ok({
    data: paginated,
    meta: pageMeta({
      page: query.page,
      pageSize: query.pageSize,
      total: tags.length,
    }),
  });
});

/**
 * POST /api/v1/crm/tags
 * Create a new tag.
 * Permission: tags.create
 */
export const POST = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("tags.create");

  const body = await request.json();
  const input = createTagSchema.parse(body);

  const service = new TagService(context.organization._id, context.user._id);

  try {
    const tag = await service.create({
      organizationId: context.organization._id,
      actorId: context.user._id,
      name: input.name,
      color: input.color,
    });

    return ok(tag, undefined, { status: 201 });
  } catch (error) {
    if (error instanceof TagError && error.code === "CONFLICT") {
      throw new AppError("CONFLICT", { message: error.message });
    }
    throw error;
  }
});
