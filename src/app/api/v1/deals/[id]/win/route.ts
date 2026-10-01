import { DealRepository } from "@/modules/deals/deal.repository";
import { DealService } from "@/modules/deals/deal.service";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok } from "@/shared/responses/envelope";

function extractDealId(request: Request): string {
  const path = new URL(request.url).pathname;
  const parts = path.split("/");
  // .../deals/:id/win -> parts[parts.length - 2] is the id
  return parts[parts.length - 2];
}

/**
 * POST /api/v1/deals/:id/win
 * Mark a deal as won.
 * Moves it to the pipeline's won stage, sets status to WON, probability to 100.
 */
export const POST = withApi(async (request, _context) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.move");

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

  try {
    const deal = await service.winDeal(dealId);

    return ok(deal);
  } catch (error) {
    if (error instanceof Error && error.message.includes("not found")) {
      return new Response(
        JSON.stringify({
          error: { code: "RECORD_NOT_FOUND", message: "Deal not found." },
        }),
        { status: 404 },
      );
    }
    if (error instanceof Error && error.message.includes("already won")) {
      return new Response(
        JSON.stringify({ error: { code: "CONFLICT", message: error.message } }),
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message.includes("lost deal")) {
      return new Response(
        JSON.stringify({ error: { code: "CONFLICT", message: error.message } }),
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message.includes("no 'Won' stage")) {
      return new Response(
        JSON.stringify({
          error: { code: "VALIDATION_FAILED", message: error.message },
        }),
        { status: 422 },
      );
    }
    throw error;
  }
});
