import { DealRepository } from "@/modules/deals/deal.repository";
import { updateDealBody } from "@/modules/deals/deal.schemas";
import { DealService } from "@/modules/deals/deal.service";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { parseBody } from "@/shared/api/parse-body";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

function extractDealId(request: Request): string {
  const path = new URL(request.url).pathname;
  const parts = path.split("/");
  return parts[parts.length - 1];
}

/**
 * GET /api/v1/deals/:id
 * Get a deal by ID.
 */
export const GET = withApi(async (request, _context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.read");

  const dealId = extractDealId(request);
  if (!dealId) {
    return new Response(
      JSON.stringify({
        error: { code: "BAD_REQUEST", message: "Deal ID is required." },
      }),
      { status: 400 },
    );
  }

  const repo = new DealRepository(ctx.organization._id, ctx.user._id);
  const pipelineRepo = new PipelineRepository(
    ctx.organization._id,
    ctx.user._id,
  );
  const service = new DealService(repo, pipelineRepo, ctx.user._id);

  const deal = await service.getById(dealId);
  if (!deal) {
    return new Response(
      JSON.stringify({
        error: { code: "RECORD_NOT_FOUND", message: "Deal not found." },
      }),
      { status: 404 },
    );
  }

  return ok(deal);
});

/**
 * PATCH /api/v1/deals/:id
 * Update a deal.
 */
export const PATCH = withApi(async (request, _context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.update");

  const dealId = extractDealId(request);
  if (!dealId) {
    return new Response(
      JSON.stringify({
        error: { code: "BAD_REQUEST", message: "Deal ID is required." },
      }),
      { status: 400 },
    );
  }

  const body = await parseBody(request, updateDealBody);

  const repo = new DealRepository(ctx.organization._id, ctx.user._id);
  const pipelineRepo = new PipelineRepository(
    ctx.organization._id,
    ctx.user._id,
  );
  const service = new DealService(repo, pipelineRepo, ctx.user._id);

  const deal = await service.update(dealId, {
    ...body,
    expectedCloseDate: body.expectedCloseDate
      ? new Date(body.expectedCloseDate)
      : undefined,
  });

  if (!deal) {
    return new Response(
      JSON.stringify({
        error: { code: "RECORD_NOT_FOUND", message: "Deal not found." },
      }),
      { status: 404 },
    );
  }

  return ok(deal);
});

/**
 * DELETE /api/v1/deals/:id
 * Soft delete a deal.
 */
export const DELETE = withApi(async (request, _context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.delete");

  const dealId = extractDealId(request);
  if (!dealId) {
    return new Response(
      JSON.stringify({
        error: { code: "BAD_REQUEST", message: "Deal ID is required." },
      }),
      { status: 400 },
    );
  }

  const repo = new DealRepository(ctx.organization._id, ctx.user._id);
  const pipelineRepo = new PipelineRepository(
    ctx.organization._id,
    ctx.user._id,
  );
  const service = new DealService(repo, pipelineRepo, ctx.user._id);

  await service.delete(dealId);

  return ok({ deleted: true }, { status: 204 });
});
