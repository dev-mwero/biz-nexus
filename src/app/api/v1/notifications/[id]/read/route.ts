import { Types } from "mongoose";
import { markRead } from "@/modules/notifications";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../_lib/path-param";

/**
 * PATCH /api/v1/notifications/:id/read
 *
 * Marks a single notification as read.
 * Requires: notifications.update
 */
export const PATCH = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("notifications.update");

  // `withApi` hands the handler `(request, ApiContext)`; Next's `{ params }` is
  // never passed, so the id is read from the path and validated before it is
  // used. A malformed id is a 404 rather than a 422 because the caller is not
  // asking about a field of a body — it is asking for a record that cannot
  // exist.
  const id = pathParam(request);
  if (!Types.ObjectId.isValid(id)) {
    throw new AppError("RECORD_NOT_FOUND");
  }

  const notification = await markRead(
    {
      organizationId: context.organization._id,
      userId: context.user._id,
    },
    new Types.ObjectId(id),
  );

  return ok(notification);
});
