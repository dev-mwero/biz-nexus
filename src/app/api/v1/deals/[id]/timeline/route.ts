import { timelineForEntity } from "@/modules/activities/activity.service";
import { DealRepository } from "@/modules/deals/deal.repository";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok, pageMeta } from "@/shared/responses/envelope";
import { objectIdParam } from "../../../../_lib/path-param";

/**
 * GET /api/v1/deals/:id/timeline
 * Get the activity timeline for a deal.
 * Query params: page, pageSize, before (ISO date)
 */
export const GET = withApi(async (request) => {
  const guards = guardsFor(request);
  const ctx = await guards.requirePermission("deals.read");

  // `.../deals/:id/timeline` — the id is the second segment from the end, and a
  // malformed one is a 422 naming the field rather than a driver exception.
  const dealId = objectIdParam(request, 2);

  // Resolve the deal through the tenant scope before reading its timeline.
  //
  // `timelineForEntity` filters on `{ organizationId, "subjects.entityId" }`, so
  // a foreign id simply matches no subject and the route answered `200 { data: [],
  // meta }`. That is a different answer from the sibling `GET /deals/:id`, which
  // 404s on the same id — and the asymmetry is the leak: an empty timeline for an
  // id that exists elsewhere is distinguishable from an empty timeline for an id
  // that exists nowhere, which turns the route into an oracle for other tenants'
  // deal ids. The existence check belongs here, ahead of the subject filter, so
  // the two routes agree.
  const repo = new DealRepository(ctx.organization._id, ctx.user._id);
  const deal = await repo.findDealById(dealId);
  if (!deal) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Deal not found" });
  }

  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(url.searchParams.get("pageSize") ?? "25", 10)),
  );
  const before = url.searchParams.get("before");

  const activities = await timelineForEntity({
    organizationId: ctx.organization._id,
    entityId: dealId,
    limit: pageSize + 1, // Fetch one extra to check if there's a next page
    before: before ? new Date(before) : undefined,
  });

  const hasMore = activities.length > pageSize;
  const data = hasMore ? activities.slice(0, pageSize) : activities;

  return ok(
    data,
    pageMeta({
      page,
      pageSize,
      total: data.length + (hasMore ? 1 : 0), // Approximate for pagination UI
    }),
  );
});
