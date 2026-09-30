import { z } from "zod";
import { readJson } from "@/shared/api/with-api";
import { AppError } from "@/shared/errors/app-error";

/**
 * Request schemas for the auth endpoints.
 *
 * `z.string().email()` rather than `z.email()` in one place and a regex in
 * another, so the shape of "a valid address" is decided once. The lowercasing
 * is here because normalisation belongs at the edge: every service normalises
 * again as a backstop, but a request that reaches a service still un-normalised
 * means a caller outside this module skipped the edge.
 *
 * No complexity rule on the password. docs/SECURITY.md §4 sets a length floor and
 * nothing else, and inventing a composition rule here would lock out the pass
 * phrases the rest of the document recommends.
 *
 * Every schema is a `strictObject`. The default `z.object` silently drops keys it
 * does not recognise, so a client sending `{"email": ..., "role": "OWNER"}` gets
 * a 201 and no role, and the client reasonably concludes the field was accepted.
 * Rejecting the unknown key is the honest answer: it is a typo, or it is someone
 * probing which extra fields the API will take.
 */

const email = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email("Enter a valid email address.");

/**
 * 12 characters minimum, matching docs/SECURITY.md §4.
 *
 * The floor is on length rather than composition because length is the property
 * that actually resists guessing; a rule demanding a symbol and a digit pushes
 * people toward `Passw0rd!`, which is weaker than the pass phrase it rejects.
 */
const password = z
  .string()
  .min(12, "Use at least 12 characters.")
  .max(200, "Use at most 200 characters.");

const name = z.string().trim().min(1, "Enter your name.").max(120);

export const registerBody = z.strictObject({
  email,
  name,
  password,
});

export const loginBody = z.strictObject({
  email,
  password: z.string().min(1).max(200),
});

export const forgotPasswordBody = z.strictObject({ email });

export const resetPasswordBody = z.strictObject({
  token: z.string().trim().min(1, "This reset link is not valid.").max(200),
  password,
});

export const verifyEmailBody = z.strictObject({
  token: z
    .string()
    .trim()
    .min(1, "This verification link is not valid.")
    .max(200),
});

/**
 * Parse a JSON request body, or fail with the shape every endpoint uses.
 *
 * JSON is read through the wrapper's `readJson`, not `request.json()` directly,
 * for two reasons. The content type is checked there, so `text/plain` carrying
 * JSON is refused before it is parsed; and a body over the size limit is refused
 * with a 413 rather than buffered, so a request that claims to be enormous costs
 * a header read instead of memory.
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

export { email as authEmailSchema, password as authPasswordSchema };
