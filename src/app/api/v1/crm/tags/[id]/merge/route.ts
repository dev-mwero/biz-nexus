import { Types } from "mongoose";
import { z } from "zod";
import { type MergeTagsInput, TagError, TagService } from "@/modules/crm";
import { readJson, withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../../_lib/path-param";

const mergeTagsSchema = z
  .object({
    sourceTagId: z.string().min(1),
    targetTagId: z.string().min(1),
  })
  .refine(
    (data) => data.sourceTagId !== data.targetTagId,
    "Cannot merge a tag into itself",
  );

/**
 * POST /api/v1/crm/tags/:id/merge
 * Merge this tag into another tag.
 * Permission: tags.update (or tags.delete?)
 * Note: The spec says tags.delete for the merge operation
 */
export const POST = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  // Merge requires update on target and delete on source
  const context = await guards.requirePermission("tags.update");

  // `fromEnd: 2` — this path ends in a static segment (`route.ts`), so the
  // default of 1 would read that literal as the record id.
  const id = pathParam(request, 2);
  const body = await readJson(request);
  const input = mergeTagsSchema.parse(body);

  // The :id in the path is the source tag being merged
  if (input.sourceTagId !== id) {
    throw new AppError("VALIDATION_FAILED", {
      message: "Source tag ID in body must match the path parameter.",
      details: [
        { path: "sourceTagId", message: "Must match the tag being merged." },
      ],
    });
  }

  const service = new TagService(context.organization._id, context.user._id);

  try {
    // The service reassigns documents keyed by tag, so it takes ids rather than
    // the strings the body carries.
    const mergeInput: MergeTagsInput = {
      organizationId: context.organization._id,
      actorId: context.user._id,
      sourceTagId: new Types.ObjectId(input.sourceTagId),
      targetTagId: new Types.ObjectId(input.targetTagId),
    };

    const result = await service.merge(mergeInput);

    return ok(result);
  } catch (error) {
    if (error instanceof TagError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", {
        message: "One or both tags not found.",
      });
    }
    if (error instanceof TagError && error.code === "VALIDATION_FAILED") {
      throw new AppError("VALIDATION_FAILED", { message: error.message });
    }
    throw error;
  }
});
