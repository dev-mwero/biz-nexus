import type { Types } from "mongoose";
import { DealRepository } from "@/modules/deals/deal.repository";
import { DealService } from "@/modules/deals/deal.service";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok, pageMeta } from "@/shared/responses/envelope";

/**
 * GET /api/v1/deals
 * List deals with filters, pagination, and sorting.
 * Query params: page, pageSize, sort, q, status, pipelineId, stageId, companyId, contactId, ownerId, valueMin, valueMax, closingFrom, closingTo, tag[]
 */
export const GET = withApi(async (request, context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.read");

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "20", 10)),
  );
  const sort = url.searchParams.get("sort") ?? "-createdAt";
  const search = url.searchParams.get("q")?.trim();

  // Build filter
  const filter: Record<string, unknown> = {};

  const status = url.searchParams.get("status");
  if (status) filter.status = status;

  const pipelineId = url.searchParams.get("pipelineId");
  if (pipelineId) filter.pipelineId = pipelineId;

  const stageId = url.searchParams.get("stageId");
  if (stageId) filter.stageId = stageId;

  const companyId = url.searchParams.get("companyId");
  if (companyId) filter.companyId = companyId;

  const contactId = url.searchParams.get("contactId");
  if (contactId) filter.contactId = contactId;

  const ownerId = url.searchParams.get("ownerId");
  if (ownerId) filter.ownerId = ownerId;

  const valueMin = url.searchParams.get("valueMin");
  if (valueMin) filter.value = { ...filter.value, $gte: parseFloat(valueMin) };

  const valueMax = url.searchParams.get("valueMax");
  if (valueMax) filter.value = { ...filter.value, $lte: parseFloat(valueMax) };

  const closingFrom = url.searchParams.get("closingFrom");
  if (closingFrom)
    filter.expectedCloseDate = {
      ...filter.expectedCloseDate,
      $gte: new Date(closingFrom),
    };

  const closingTo = url.searchParams.get("closingTo");
  if (closingTo)
    filter.expectedCloseDate = {
      ...filter.expectedCloseDate,
      $lte: new Date(closingTo),
    };

  const tags = url.searchParams.getAll("tag");
  if (tags.length > 0) filter.tags = { $in: tags };

  // Text search
  if (search) {
    filter.$text = { $search: search };
  }

  // Parse sort
  const sortObj: Record<string, 1 | -1> = {};
  const sortFields = sort.split(",");
  for (const field of sortFields) {
    if (field.startsWith("-")) {
      sortObj[field.slice(1)] = -1;
    } else {
      sortObj[field] = 1;
    }
  }

  const repo = new DealRepository(ctx.organization._id, ctx.user._id);
  const pipelineRepo = new PipelineRepository(
    ctx.organization._id,
    ctx.user._id,
  );
  const service = new DealService(repo, pipelineRepo, ctx.user._id);

  const [deals, total] = await Promise.all([
    service.list(filter, {
      sort: sortObj,
      limit: pageSize,
      skip: (page - 1) * pageSize,
    }),
    service.count(filter),
  ]);

  return ok(deals, pageMeta({ page, pageSize, total }));
});

/**
 * POST /api/v1/deals
 * Create a new deal.
 */
export const POST = withApi(async (request, context) => {
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
        error: { code: "VALIDATION_FAILED", message: "Deal name is required." },
      }),
      { status: 422 },
    );
  }

  if (!body.pipelineId) {
    return new Response(
      JSON.stringify({
        error: { code: "VALIDATION_FAILED", message: "Pipeline is required." },
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

  return ok(deal, { status: 201 });
});
