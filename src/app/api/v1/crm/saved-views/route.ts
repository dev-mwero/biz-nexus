import { z } from "zod";
import {
  type CreateSavedViewInput,
  SavedViewError,
  SavedViewService,
} from "@/modules/crm";
import { queryFromSearchParams } from "@/shared/api/search-params";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok, pageMeta } from "@/shared/responses/envelope";

const SAVED_VIEW_ENTITY_TYPES = [
  "CONTACT",
  "COMPANY",
  "LEAD",
  "DEAL",
  "TASK",
] as const;

const createSavedViewSchema = z.object({
  entityType: z.enum(SAVED_VIEW_ENTITY_TYPES),
  name: z.string().min(1).max(60),
  filters: z.record(z.string(), z.unknown()).default({}),
  sort: z.string().default(""),
  columns: z
    .array(
      z.object({
        key: z.string(),
        width: z.number().int().positive().max(600).optional(),
      }),
    )
    .default([]),
  isShared: z.boolean().default(false),
});

const listQuerySchema = z.object({
  entityType: z.enum(SAVED_VIEW_ENTITY_TYPES),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

/**
 * GET /api/v1/crm/saved-views/:entityType
 * List saved views for an entity type (personal + shared).
 * Permission: {entity}.read
 */
export const GET = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("savedViews.read");

  const { searchParams } = new URL(request.url);
  const query = listQuerySchema.parse(queryFromSearchParams(searchParams, []));

  const service = new SavedViewService(
    context.organization._id,
    context.user._id,
  );

  const [personal, shared] = await Promise.all([
    service.listByUser(context.user._id, query.entityType),
    service.listShared(query.entityType),
  ]);

  // Combine and deduplicate (shared views might overlap with personal if user created them)
  const all = [...personal, ...shared];
  const seen = new Set<string>();
  const unique = all.filter((v) => {
    const key = v._id.toString();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const start = (query.page - 1) * query.pageSize;
  const paginated = unique.slice(start, start + query.pageSize);

  return ok(
    paginated,
    pageMeta({
      page: query.page,
      pageSize: query.pageSize,
      total: unique.length,
    }),
  );
});

/**
 * POST /api/v1/crm/saved-views
 * Create a new saved view.
 * Permission: {entity}.create (validated via savedViews.create)
 */
export const POST = withApi(
  async (request: Request) => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("savedViews.create");

    const body = await request.json();
    const input = createSavedViewSchema.parse(body);

    const service = new SavedViewService(
      context.organization._id,
      context.user._id,
    );

    try {
      const savedView = await service.create({
        organizationId: context.organization._id,
        actorId: context.user._id,
        userId: context.user._id,
        ...input,
      });

      return ok(savedView);
    } catch (error) {
      // The service raises SLUG_CONFLICT when the caller already owns a view at
      // this name and scope; the catalogue has no narrower duplicate-name code.
      if (error instanceof SavedViewError && error.code === "SLUG_CONFLICT") {
        throw new AppError("SLUG_CONFLICT", { message: error.message });
      }
      throw error;
    }
  },
  { status: 201 },
);
