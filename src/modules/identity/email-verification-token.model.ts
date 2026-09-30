import mongoose, { type Model, Schema, type Types } from "mongoose";
import { SESSION_MAX_IP } from "./session.model";

/**
 * A single-use email-verification claim.
 *
 * The same shape as `PasswordResetToken` and deliberately a *separate*
 * collection. They look interchangeable and are not: they are independent
 * credentials, so a leaked "forgot password" link must not verify an email
 * address, and they have different lifetimes, so one collection would put both
 * under a single cleanup index and evict valid tokens at the wrong age.
 *
 * Per docs/DATABASE.md §2.
 */

export const EMAIL_VERIFICATION_TTL_HOURS = 24;

/** See `truncate` in session.model. Exported so the setter is not re-invented. */
const truncateIp = (value: string | null | undefined) =>
  typeof value === "string" ? value.slice(0, SESSION_MAX_IP) : (value ?? null);

export interface EmailVerificationToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** SHA-256 of the emailed token. The raw token is never stored. */
  tokenHash: string;
  expiresAt: Date;
  /** Set on redemption. A second redemption finds this non-null and is refused. */
  usedAt: Date | null;
  requestIp: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const emailVerificationTokenSchema = new Schema<EmailVerificationToken>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    // Truncating, for the same reason `sessions.ip` truncates rather than
    // validates: the value is an untrusted header from a client we do not
    // control, and refusing to issue a reset link because a user agent or a
    // proxied address was over-long would turn a cosmetic overflow into a
    // support ticket. See `SESSION_MAX_IP`.
    requestIp: { type: String, default: null, set: truncateIp },
  },
  { timestamps: true, collection: "email_verification_tokens" },
);

// "Has this account asked to re-verify too often" is answered by its newest
// tokens, newest first. Same index the password-reset collection uses for its
// own throttle.
emailVerificationTokenSchema.index({ userId: 1, createdAt: -1 });

// Cleanup is the database's job, at the TTL this credential actually has.
emailVerificationTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const EmailVerificationTokenModel: Model<EmailVerificationToken> =
  (mongoose.models.EmailVerificationToken as Model<EmailVerificationToken>) ??
  mongoose.model<EmailVerificationToken>(
    "EmailVerificationToken",
    emailVerificationTokenSchema,
  );

export const emailVerificationTokenSchemaDefinition =
  emailVerificationTokenSchema;
