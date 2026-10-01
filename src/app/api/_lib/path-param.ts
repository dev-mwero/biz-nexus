import { Types } from "mongoose";
import { AppError } from "@/shared/errors/app-error";

/**
 * Reading a dynamic path segment from inside a handler.
 *
 * `withApi` owns the handler's whole signature — `(request) => Response` — so a
 * handler is never handed Next's `{ params }`. The request path is the only
 * place the segment still exists, which is why every route in this tree reads it
 * from the URL rather than from a second argument that never arrives.
 *
 * `fromEnd` counts back from the end of the path so a nested route can name its
 * own segment unambiguously: `1` for `.../tags/:id`, `2` for
 * `.../tags/:id/merge`. Counting from the end rather than matching a name is
 * deliberate — a handler cannot see its own route pattern, so a name-based
 * lookup would be a guess, and a guess that resolves the wrong segment reads
 * another record.
 */
export function pathParam(request: Request, fromEnd = 1): string {
  const segments = new URL(request.url).pathname.split("/").filter(Boolean);
  const segment = segments[segments.length - fromEnd];

  if (segment === undefined) {
    throw new AppError("BAD_REQUEST", {
      message: "The request path does not contain the expected segment.",
    });
  }

  return segment;
}

/**
 * The same segment, as a validated `ObjectId`.
 *
 * Validated before constructing because `new Types.ObjectId("nonsense")` throws
 * a driver error rather than reporting a bad request, and a 422 naming the field
 * is the answer a caller can act on. The segment itself is never echoed back:
 * it is attacker-controlled text and `AppError` messages are shown to users.
 */
export function objectIdParam(request: Request, fromEnd = 1): Types.ObjectId {
  const segment = pathParam(request, fromEnd);

  if (!Types.ObjectId.isValid(segment)) {
    throw new AppError("VALIDATION_FAILED", {
      message: "The id in the request path is not a valid identifier.",
    });
  }

  return new Types.ObjectId(segment);
}
