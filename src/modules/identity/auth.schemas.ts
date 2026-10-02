import { z } from "zod";

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

export { email as authEmailSchema, password as authPasswordSchema };
