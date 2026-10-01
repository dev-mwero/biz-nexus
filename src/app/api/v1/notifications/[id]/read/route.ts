import { Types } from "mongoose";
import { markRead } from "@/modules/notifications";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";

/**
 * PATCH /api/v1/notifications/:id/read
 *
 * Marks a single notification as read.
 * Requires: notifications.update
 */
export const PATCH = withApi(
  async (
    request: Request,
    { params }: { params: Promise<{ id: string }> },
  ): Promise<Response> => {
    const guards = guardsFor(request);
    const context = await guards.requirePermission("notifications.update");
    const { id } = await params;

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

    return Response.json({ data: notification });
  },
);
