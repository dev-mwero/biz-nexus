import type { z } from "zod";
import type { FieldDetail } from "@/shared/errors/app-error";

/**
 * Flatten a Zod error into the `details` shape the envelope already carries.
 *
 * The issue `path` is joined rather than nested so a client can point at the
 * input that caused the failure, and the message is Zod's own text — which is
 * written for a person and echoes no value that was sent. This mirrors what
 * `listQuery` does for query parameters, so a rejected body and a rejected query
 * string report failures the same way.
 */
export function fieldDetails(error: z.ZodError): FieldDetail[] {
  return error.issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}
