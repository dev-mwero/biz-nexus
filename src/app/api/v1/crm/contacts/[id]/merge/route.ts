import { z } from "zod";
import { ContactError, ContactService } from "@/modules/crm";
import { withApi } from "@/shared/api/with-api";
import { guardsFor } from "@/shared/auth/request-guards";
import { AppError } from "@/shared/errors/app-error";
import { ok } from "@/shared/responses/envelope";
import { pathParam } from "../../../../../_lib/path-param";

const mergeContactsSchema = z
  .object({
    sourceContactId: z.string().min(1),
    targetContactId: z.string().min(1),
  })
  .refine(
    (data) => data.sourceContactId !== data.targetContactId,
    "Cannot merge a contact into itself",
  );

/**
 * POST /api/v1/crm/contacts/:id/merge
 * Merge this contact into another contact.
 * Permission: contacts.update (and contacts.delete for source)
 */
export const POST = withApi(async (request: Request) => {
  const guards = guardsFor(request);
  const context = await guards.requirePermission("contacts.update");

  const id = pathParam(request);
  const body = await request.json();
  const input = mergeContactsSchema.parse(body);

  if (input.sourceContactId !== id) {
    throw new AppError("VALIDATION_FAILED", {
      message: "Source contact ID in body must match the path parameter.",
      details: [
        {
          path: "sourceContactId",
          message: "Must match the contact being merged.",
        },
      ],
    });
  }

  const service = new ContactService(
    context.organization._id,
    context.user._id,
  );

  try {
    const mergedContact = await service.merge(
      input.sourceContactId,
      input.targetContactId,
      context.user._id,
    );
    return ok(mergedContact);
  } catch (error) {
    if (error instanceof ContactError && error.code === "RECORD_NOT_FOUND") {
      throw new AppError("RECORD_NOT_FOUND", {
        message: "One or both contacts not found.",
      });
    }
    if (error instanceof ContactError && error.code === "VALIDATION_FAILED") {
      throw new AppError("VALIDATION_FAILED", { message: error.message });
    }
    // Merging into or from a contact that is already merged or deleted. There
    // is no dedicated "wrong state" code in the catalogue, and the request
    // itself is unfulfillable against this record, which is what 422 means.
    if (error instanceof ContactError && error.code === "INVALID_STATE") {
      throw new AppError("VALIDATION_FAILED", { message: error.message });
    }
    throw error;
  }
});
