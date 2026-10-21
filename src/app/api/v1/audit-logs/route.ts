import { listAuditLogs } from "@/modules/audit";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { ok, pageMeta } from "@/shared/responses/envelope";

/**
 * GET /api/v1/audit-logs
 *
 * Returns paginated audit logs for the active organization.
 * Requires `auditLogs.read`, which OWNER and ADMIN hold and MEMBER and VIEWER
 * do not: the log is the broadest read in the product and belongs to the people
 * who administer the workspace, not to every person in it.
 * Supports filtering by entityType, entityId, actorId, action, date range.
 *
 * The filtering and paging live in `listAuditLogs`; this handler parses the query
 * string and hands the values over. Keeping the query construction out of the
 * route matters more here than elsewhere: the organization scope is the whole
 * security boundary of this surface, and it is applied in one place, from the
 * session, rather than re-derived per handler.
 */
export const GET = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("auditLogs.read");

  const url = new URL(request.url);

  const page = Number.parseInt(url.searchParams.get("page") ?? "1", 10);
  const pageSize = Number.parseInt(
    url.searchParams.get("pageSize") ?? "20",
    10,
  );

  const result = await listAuditLogs({
    organizationId: context.organization._id,
    page: Number.isNaN(page) ? 1 : page,
    pageSize: Number.isNaN(pageSize) ? 20 : pageSize,
    sort: url.searchParams.get("sort"),
    entityType: url.searchParams.get("entityType"),
    entityId: url.searchParams.get("entityId"),
    actorId: url.searchParams.get("actorId"),
    action: url.searchParams.get("action"),
    from: url.searchParams.get("from"),
    to: url.searchParams.get("to"),
  });

  return Response.json(
    ok(
      result.logs,
      pageMeta({
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
      }),
    ),
  );
});
