import { Types } from "mongoose";
import { z } from "zod";
import { DEAL_STATUSES } from "@/modules/deals";
import { DealRepository } from "@/modules/deals/deal.repository";
import { DealService } from "@/modules/deals/deal.service";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { listQuery } from "@/shared/query/list-query";
import { ok } from "@/shared/responses/envelope";

const dealFiltersSchema = z.object({
  status: z.enum(DEAL_STATUSES).optional(),
  pipelineId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  stageId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  companyId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  contactId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  ownerId: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  valueMin: z.coerce.number().nonnegative().optional(),
  valueMax: z.coerce.number().nonnegative().optional(),
  closingFrom: z.coerce.date().optional(),
  closingTo: z.coerce.date().optional(),
  tag: z.array(z.string().regex(/^[0-9a-fA-F]{24}$/)).default([]),
});

const { parse, meta } = listQuery({
  filters: dealFiltersSchema,
  sortable: ["createdAt", "updatedAt", "value", "expectedCloseDate", "name"],
  defaultSort: "-createdAt",
  searchable: true,
  orderedPairs: [
    ["valueMin", "valueMax"],
    ["closingFrom", "closingTo"],
  ],
});

/**
 * GET /api/v1/deals
 * List deals with filters, pagination, and sorting.
 * Query params: page, pageSize, sort, q, status, pipelineId, stageId, companyId, contactId, ownerId, valueMin, valueMax, closingFrom, closingTo, tag[]
 */
export const GET = withApi(async (request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.read");

  const parsed = parse(new URL(request.url).searchParams);
  const f = parsed.filters;

  const filter: Record<string, unknown> = {};

  if (f.status) filter.status = f.status;
  if (f.pipelineId) filter.pipelineId = new Types.ObjectId(f.pipelineId);
  if (f.stageId) filter.stageId = new Types.ObjectId(f.stageId);
  if (f.companyId) filter.companyId = new Types.ObjectId(f.companyId);
  if (f.contactId) filter.contactId = new Types.ObjectId(f.contactId);
  if (f.ownerId) filter.ownerId = new Types.ObjectId(f.ownerId);

  if (f.valueMin !== undefined || f.valueMax !== undefined) {
    const value: Record<string, number> = {};
    if (f.valueMin !== undefined) value.$gte = f.valueMin;
    if (f.valueMax !== undefined) value.$lte = f.valueMax;
    filter.value = value;
  }

  if (f.closingFrom || f.closingTo) {
    const expectedCloseDate: Record<string, Date> = {};
    if (f.closingFrom) expectedCloseDate.$gte = f.closingFrom;
    if (f.closingTo) expectedCloseDate.$lte = f.closingTo;
    filter.expectedCloseDate = expectedCloseDate;
  }

  if (f.tag.length > 0) {
    filter.tags = { $in: f.tag.map((id: string) => new Types.ObjectId(id)) };
  }

  if (parsed.q) {
    filter.$text = { $search: parsed.q };
  }

  const repo = new DealRepository(ctx.organization._id, ctx.user._id);
  const pipelineRepo = new PipelineRepository(
    ctx.organization._id,
    ctx.user._id,
  );
  const service = new DealService(repo, pipelineRepo, ctx.user._id);

  const [deals, total] = await Promise.all([
    service.list(filter, {
      sort: parsed.sort,
      limit: parsed.limit,
      skip: parsed.skip,
    }),
    service.count(filter),
  ]);

  return ok(deals, meta(parsed, total));
});

/**
 * POST /api/v1/deals
 * Create a new deal.
 */
export const POST = withApi(
  async (request, context) => {
    const guards = guardsFor(request);
    const ctx = await guards.requirePermission("deals.create");

    const body = await readJson<{
      name: string;
      companyId?: string | null;
      contactId?: string | null;
      pipelineId: string;
      stageId: string;
      ownerId?: string;
      value?: number;
      currency?: string;
      probability?: number;
      expectedCloseDate?: string | null;
      description?: string | null;
      tags?: string[];
      customFields?: Record<string, unknown>;
    }>(request);

    if (!body.name?.trim()) {
      return new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_FAILED",
            message: "Deal name is required.",
          },
        }),
        { status: 422 },
      );
    }

    if (!body.pipelineId) {
      return new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_FAILED",
            message: "Pipeline is required.",
          },
        }),
        { status: 422 },
      );
    }

    if (!body.stageId) {
      return new Response(
        JSON.stringify({
          error: { code: "VALIDATION_FAILED", message: "Stage is required." },
        }),
        { status: 422 },
      );
    }

    const repo = new DealRepository(ctx.organization._id, ctx.user._id);
    const pipelineRepo = new PipelineRepository(
      ctx.organization._id,
      ctx.user._id,
    );
    const service = new DealService(repo, pipelineRepo, ctx.user._id);

    const deal = await service.create({
      name: body.name.trim(),
      companyId: body.companyId,
      contactId: body.contactId,
      pipelineId: body.pipelineId,
      stageId: body.stageId,
      ownerId: body.ownerId ?? ctx.user._id,
      value: body.value ?? 0,
      currency: body.currency ?? "USD",
      probability: body.probability ?? 0,
      expectedCloseDate: body.expectedCloseDate
        ? new Date(body.expectedCloseDate)
        : null,
      description: body.description?.trim() ?? null,
      tags: body.tags,
      customFields: body.customFields,
    });

    return ok(deal);
  },
  { status: 201 },
);
