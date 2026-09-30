import { Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import {
  EMAIL_VERIFICATION_TTL_HOURS,
  EmailVerificationTokenModel,
} from "@/modules/identity/email-verification-token.model";
import {
  generateToken,
  hashPassword,
  hashToken,
} from "@/modules/identity/password";
import { type User, UserModel } from "@/modules/identity/user.model";
import { AppError } from "@/shared/errors/app-error";

const HOUR_MS = 60 * 60 * 1000;

export interface RegisterUserInput {
  email: string;
  name: string;
  password: string;
  requestIp?: string | null;
}

export interface RegisterUserResult {
  /** Public projection. There is no password hash on this type to leak. */
  user: PublicUser;
  userId: Types.ObjectId;
  /** Raw token, for the mailer. The database only ever holds its digest. */
  verificationToken: string;
}

/**
 * Create an account and its first verification token, or neither.
 *
 * Both writes are in one transaction. A user with no way to verify is an account
 * nobody can finish setting up, and it cannot be distinguished from one whose
 * verification mail bounced, so it is a support ticket rather than a retry.
 *
 * The bcrypt hash and the token are computed *before* the transaction opens.
 * `withTransaction` retries its callback on a write conflict, so anything
 * generated inside it changes on the retry - and a retried registration would
 * hand the caller a token that does not match the hash in the database, which
 * presents as a verification link that has never worked. Hashing outside also
 * keeps a deliberately slow operation from holding a transaction open against
 * every other writer.
 */
export async function registerUser(
  input: RegisterUserInput,
): Promise<RegisterUserResult> {
  const email = input.email.trim().toLowerCase();
  const token = generateToken();
  const tokenHash = hashToken(token);
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  try {
    const created = await withTransaction(async (session) => {
      const [created] = await UserModel.create(
        [
          {
            email,
            name: input.name.trim(),
            passwordHash,
            emailVerifiedAt: null,
          },
        ],
        { session },
      );

      await EmailVerificationTokenModel.create(
        [
          {
            userId: created._id,
            tokenHash,
            expiresAt: new Date(
              now.getTime() + EMAIL_VERIFICATION_TTL_HOURS * HOUR_MS,
            ),
            usedAt: null,
            requestIp: input.requestIp ?? null,
          },
        ],
        { session },
      );

      return created;
    });

    // Returns the allow-list projection, not the document. `select: false` governs
    // queries and not a document we just built, so `created` carries the bcrypt
    // hash like any other field, and a Next.js route handler that returns a
    // Mongoose document serialises every field it has. Handing back the
    // projection means a route that forgets to shape the response cannot leak the
    // hash - there is nothing on this type to leak.
    return {
      user: toPublicUser(created),
      userId: created._id,
      verificationToken: token,
    };
  } catch (error) {
    // The unique index is the real arbiter, not a pre-check. Checking for an
    // existing user and then inserting is a race: two simultaneous registrations
    // for one address both pass the check, and the loser fails at insert with an
    // opaque driver error instead of a message a user can act on.
    if (isDuplicateKey(error)) {
      // No address in this string. `redact` works on object keys and never
      // inspects a string, `email` is not one of its sensitive keys, and
      // `withApi` now forwards `internal` to warn-level logs — so an address
      // here goes verbatim into a log line for every duplicate registration.
      // The index name is the diagnostic that matters, and it is not PII. There
      // is no user id either: the insert is what failed, so there is nothing to
      // name.
      throw new AppError("EMAIL_ALREADY_REGISTERED", {
        internal: "registerUser: duplicate key on the users email unique index",
      });
    }
    throw error;
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/**
 * Issue a fresh verification token, invalidating any outstanding one.
 *
 * Reissue replaces rather than adds. A user who requested three links and used
 * the first has proved they can read the address, so the other two are live
 * credentials for nothing - and if the first request came from somebody
 * enumerating addresses, the tokens it triggered are exactly the ones that
 * should not still work.
 */
export async function issueEmailVerificationToken(
  userId: Types.ObjectId | string,
  requestIp?: string | null,
  now = new Date(),
): Promise<{ token: string }> {
  const user = new Types.ObjectId(String(userId));
  const token = generateToken();

  await withTransaction(async (session) => {
    await EmailVerificationTokenModel.updateMany(
      { userId: user, usedAt: null },
      { $set: { usedAt: now } },
      { session },
    );

    await EmailVerificationTokenModel.create(
      [
        {
          userId: user,
          tokenHash: hashToken(token),
          expiresAt: new Date(
            now.getTime() + EMAIL_VERIFICATION_TTL_HOURS * HOUR_MS,
          ),
          usedAt: null,
          requestIp: requestIp ?? null,
        },
      ],
      { session },
    );
  });

  return { token };
}

export interface VerifyEmailResult {
  ok: boolean;
  /** True when the address was already verified, so the UI can say so. */
  alreadyVerified?: boolean;
}

/**
 * Consume a verification token.
 *
 * Single use, enforced by one conditional update rather than a read followed by
 * a write, so two concurrent redemptions of a forwarded link cannot both
 * succeed.
 *
 * Every failure is `ok: false` with no reason. "Expired", "already used" and
 * "never existed" are three different answers to the same question from outside
 * the system, and returning which one happened turns a verification link into a
 * way to test whether a token was ever real.
 *
 * The one exception is a spent token on an address that is *already* verified,
 * which is a success with `alreadyVerified: true`. That branch was the reason
 * the field existed, and it was unreachable: the claim filter requires
 * `usedAt: null`, so the second click on a link the user had already followed
 * was refused with `TOKEN_NOT_REDEEMABLE` — the exact outcome the endpoint's
 * docstring says it exists to prevent. A user who clicks twice, or whose mail
 * client prefetches the link, gets told their account is broken when it is
 * fine. The spent token is still refused for the write: only `verifiedAt` is
 * left to decide, and an address that is already verified is a no-op.
 *
 * The cost is that this is not a perfectly uniform oracle. A spent token
 * answers 200 when the address is verified and 400 when it is not, so somebody
 * holding a spent token learns the verification state of the address it belongs
 * to. That is a narrow answer about an address they already proved they can
 * read, and it buys not telling a legitimate user that their account is broken.
 */
export async function verifyEmailToken(
  token: string,
  now = new Date(),
): Promise<VerifyEmailResult> {
  const claimed = await EmailVerificationTokenModel.findOneAndUpdate(
    { tokenHash: hashToken(token), usedAt: null, expiresAt: { $gt: now } },
    { $set: { usedAt: now } },
    { returnDocument: "after" },
  );

  if (!claimed) {
    return spentButVerified(token);
  }

  const result = await UserModel.updateOne(
    { _id: claimed.userId, emailVerifiedAt: null },
    { $set: { emailVerifiedAt: now } },
  );

  return { ok: true, alreadyVerified: result.modifiedCount === 0 };
}

/**
 * Was this a token we once issued, spent, for an address already verified?
 *
 * Reads the row rather than trusting the caller's claim, and answers false for
 * anything it is unsure about — a token that never existed must stay
 * indistinguishable from one that expired.
 */
async function spentButVerified(token: string): Promise<VerifyEmailResult> {
  const spent = await EmailVerificationTokenModel.findOne({
    tokenHash: hashToken(token),
    usedAt: { $ne: null },
  });
  if (!spent) return { ok: false };

  const user = await UserModel.findOne({
    _id: spent.userId,
    emailVerifiedAt: { $ne: null },
  });
  // `expiresAt` is deliberately not re-checked. A link that was valid and was
  // used stays used; the question here is only whether the address it verified
  // is now verified, and the click that asks does not redeem it a second time
  // either way.
  return user ? { ok: true, alreadyVerified: true } : { ok: false };
}

/** The public shape of a user. Never includes `passwordHash`. */
export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
}

/**
 * Project a user for a response.
 *
 * An explicit allow-list rather than a projection or a spread. `passwordHash` is
 * `select: false`, which protects a query that forgot to ask for it, and this
 * protects the response from a field that is added to the schema next quarter -
 * a new field on `users` should not become a new field in every API response
 * without somebody deciding it should.
 */
export function toPublicUser(user: User): PublicUser {
  return {
    id: user._id.toString(),
    email: user.email,
    name: user.name,
    avatarUrl: user.avatarUrl ?? null,
    emailVerified: user.emailVerifiedAt !== null,
  };
}
