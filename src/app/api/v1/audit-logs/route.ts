import type { Types } from "mongoose";
import { AuditLogModel } from "@/modules/audit";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";

/**
 * GET /api/v1/audit-logs
 *
 * Returns paginated audit logs for the active organization.
 * OWNER only. Supports filtering by entityType, entityId, actorId, action, date range.
 * Requires: auditLogs.read
 */
export const GET = withApi(async (request: Request): Promise<Response> => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("auditLogs.read");

  const url = new URL(request.url);
  const page = Math.max(parseInt(url.searchParams.get("page") ?? "1", 10), 1);
  const pageSize = Math.min(
    Math.max(parseInt(url.searchParams.get("pageSize") ?? "20", 10), 1),
    100,
  );
  const sort = url.searchParams.get("sort") ?? "-createdAt";
  const entityType = url.searchParams.get("entityType");
  const entityId = url.searchParams.get("entityId");
  const actorId = url.searchParams.get("actorId");
  const action = url.searchParams.get("action");
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");

  const filter: Record<string, unknown> = {
    organizationId: context.organization._id,
  };

  if (entityType) filter.entityType = entityType;
  if (entityId && Types.ObjectId.isValid(entityId))
    filter.entityId = new Types.ObjectId(entityId);
  if (actorId && Types.ObjectId.isValid(actorId))
    filter.actorId = new Types.ObjectId(actorId);
  if (action) filter.action = action;

  if (from || to) {
    filter.createdAt = {};
    if (from) {
      const fromDate = new Date(from);
      if (!Number.isNaN(fromDate.getTime())) {
        (filter.createdAt as Record<string, Date>).$gte = fromDate;
      }
    }
    if (to) {
      const toDate = new Date(to);
      if (!Number.isNaN(toDate.getTime())) {
        (filter.createdAt as Record<string, Date>).$lte = toDate;
      }
    }
  }

  // Validate sort field
  const allowedSortFields = [
    "createdAt",
    "-createdAt",
    "actorName",
    "-actorName",
    "action",
    "-action",
    "entityType",
    "-entityType",
  ];
  const sortField = allowedSortFields.includes(sort) ? sort : "-createdAt";

  const [logs, total] = await Promise.all([
    AuditLogModel.find(filter)
      .sort(
        sortField.startsWith("-")
          ? { [sortField.slice(1)]: -1 }
          : { [sortField]: 1 },
      )
      .skip((page - 1) * pageSize)
      .limit(pageSize)
      .lean(),
    AuditLogModel.countDocuments(filter),
  ]);

  const totalPages = Math.ceil(total / pageSize);

  return Response.json({
    data: logs,
    meta: { page, pageSize, total, totalPages },
  });
});
