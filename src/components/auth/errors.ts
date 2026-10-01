"use client";

/**
 * Turning an error envelope into something a form can render.
 *
 * Every endpoint in this API answers a failure with the same envelope —
 * `{ error: { code, message, details? } }` — and `details` is the only part that
 * says which input was wrong. Four forms need that translation and none of them
 * should each grow their own copy of it: a form that silently drops a field
 * error looks identical to a form that has no error, and the difference between
 * those two is whether the visitor can fix what is in front of them.
 *
 * The rule is that anything addressed to a field this form owns becomes a field
 * error, and everything else becomes one message above the form. A `details`
 * path naming an input this form does not have is not discarded either — it
 * becomes the form-level message, because dropping it would leave a rejected
 * request with nothing on screen to explain itself.
 */

/** One `{path, message}` pair from the error envelope. */
export interface FieldDetail {
  path: string;
  message: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: FieldDetail[];
}

/** Field errors keyed by input name, plus at most one form-level message. */
export interface FormError {
  fields: Record<string, string>;
  form: string | null;
}

const GENERIC_MESSAGE = "Something went wrong. Try again.";

/**
 * Read a failed response as the envelope it is meant to be.
 *
 * A non-JSON body is treated as a form-level failure rather than thrown. The
 * envelope is a contract, but a proxy in front of this API can answer with HTML,
 * and a form that renders a parse error instead of a sentence is a form that
 * tells the visitor nothing.
 */
export async function readErrorPayload(
  response: Response,
): Promise<ErrorPayload> {
  try {
    const body: unknown = await response.json();
    if (body && typeof body === "object" && "error" in body) {
      const { error } = body as { error: Partial<ErrorPayload> };
      if (error && typeof error === "object") {
        return {
          code: typeof error.code === "string" ? error.code : "INTERNAL",
          message:
            typeof error.message === "string" ? error.message : GENERIC_MESSAGE,
          ...(Array.isArray(error.details)
            ? { details: error.details as FieldDetail[] }
            : {}),
        };
      }
    }
  } catch {
    // Fall through to the generic message below.
  }

  return { code: "INTERNAL", message: GENERIC_MESSAGE };
}

/**
 * Split an envelope onto the form's own fields.
 *
 * `fieldNames` is the list the form actually renders, and it is passed in rather
 * than inferred: the server's vocabulary is the request body's, which is not
 * always the form's. A form that renders `confirmPassword` and posts
 * `password` twice has no field the server could ever name.
 *
 * The first detail wins for any given field. A second message for the same input
 * is a second opinion about one box, and two sentences in the space reserved for
 * one pushes the submit button down the page.
 */
export function toFormError(
  payload: ErrorPayload,
  fieldNames: readonly string[],
): FormError {
  const fields: Record<string, string> = {};
  const unmatched: string[] = [];

  for (const detail of payload.details ?? []) {
    const name = detail.path.split(".")[0];
    if (fieldNames.includes(name)) {
      fields[name] ??= detail.message;
    } else {
      unmatched.push(detail.message);
    }
  }

  // A validation failure whose messages all landed on fields leaves nothing to
  // say above the form. A detail that named no field on this form — and a
  // refusal that carried no details at all, such as a 401 — has to explain
  // itself there instead.
  const form =
    unmatched.length > 0
      ? unmatched.join(" ")
      : (payload.details?.length ?? 0) > 0
        ? null
        : payload.message;

  return { fields, form };
}
