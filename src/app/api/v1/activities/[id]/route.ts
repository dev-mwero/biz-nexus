import { Types } from "mongoose";
import { ActivityModel } from "@/modules/activities/activity.model";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

export const DELETE = withApi(async (request, { requestId }) => {
  const guards = guardsFor(request);
  const { organization, user } =
    await guards.requirePermission("activities.delete");

  const url = new URL(request.url);
  const id = url.pathname.split("/").pop();
  if (!id || !Types.ObjectId.isValid(id)) {
    throw new AppError("VALIDATION_FAILED", {
      message: "Invalid activity ID",
    });
  }

  // Check if the activity belongs to the organization and user is owner
  const activity = await ActivityModel.findOne({
    _id: new Types.ObjectId(id),
    organizationId: organization._id,
  }).lean();

  if (!activity) {
    throw new AppError("RECORD_NOT_FOUND", { message: "Activity not found" });
  }

  // Check ownership - only owner can delete
  if (!activity.ownerId.equals(user._id)) {
    throw new AppError("INSUFFICIENT_PERMISSION", {
      message: "You can only delete your own activities",
    });
  }

  await ActivityModel.deleteOne({ _id: activity._id });

  return ok({ success: true });
});
