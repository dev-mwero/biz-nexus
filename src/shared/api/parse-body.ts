import type { z } from "zod";
import { AppError } from "@/shared/errors/app-error";
import { readJson } from "./with-api";

/**
 * Parse a JSON request body, or fail with the shape every endpoint uses.
 *
 * JSON is read through the wrapper's `readJson`, not `request.json()` directly,
 * for two reasons. The content type is checked there, so `text/plain` carrying
 * JSON is refused before it is parsed; and a body over the size limit is refused
 * with a 413 rather than buffered, so a request that claims to be enormous costs
 * a header read instead of memory.
 *
 * Lives here rather than in a feature module because it belongs to no feature.
 * It depends on `readJson` and on the error taxonomy and nothing else, and the
 * first thing that happened when it lived in `identity/auth.schemas` was a
 * second copy turning up in `deals/deal.schemas` so that deals could have a
 * request parser without an identity import.
 */
export async function parseBody<T extends z.ZodType>(
  request: Request,
  schema: T,
): Promise<z.infer<T>> {
  const raw = await readJson(request);

  const result = schema.safeParse(raw);
  if (!result.success) {
    // Every issue is reported, not just the first: fixing one field at a time
    // through a form that only ever mentions one is a miserable loop, and these
    // messages are written for the person filling the form in.
    throw AppError.validation(
      result.error.issues.map((issue) => ({
        path: issue.path.join(".") || "body",
        message: issue.message,
      })),
    );
  }
  return result.data;
}
