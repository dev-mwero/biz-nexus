import { Types } from "mongoose";
import { z } from "zod";
import { organizationFeedCursor } from "@/modules/activities";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";

const feedQuerySchema = z.object({
  cursor: z
    .string()
    .regex(/^[0-9a-fA-F]{24}$/)
    .optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  before: z.union([z.iso.datetime({ offset: true }), z.iso.date()]).optional(),
});

export const GET = withApi(async (request) => {
  const guards = guardsFor(request);
  const { organization } = await guards.requirePermission("activities.read");

  const url = new URL(request.url);
  const searchParams = url.searchParams;
  const parsed = feedQuerySchema.safeParse({
    cursor: searchParams.get("cursor") ?? undefined,
    limit: searchParams.get("limit") ?? undefined,
    before: searchParams.get("before") ?? undefined,
  });

  if (!parsed.success) {
    const fieldErrors = parsed.error.flatten().fieldErrors;
    const details: { path: string; message: string }[] = [];
    for (const [path, errors] of Object.entries(fieldErrors)) {
      if (errors && errors.length > 0) {
        details.push({ path, message: errors[0] });
      }
    }
    throw AppError.validation(details, "Invalid query parameters");
  }

  const { cursor, limit, before } = parsed.data;

  const result = await organizationFeedCursor({
    organizationId: organization._id,
    cursor,
    limit,
    before: before ? new Date(before) : undefined,
  });

  return ok({
    activities: result.activities,
    nextCursor: result.nextCursor,
  });
});
