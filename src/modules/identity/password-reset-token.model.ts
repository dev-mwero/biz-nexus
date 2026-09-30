import mongoose, { type Model, Schema, type Types } from "mongoose";
import { SESSION_MAX_IP } from "./session.model";

/**
 * A single-use password-reset claim.
 *
 * Separate from `email_verification_tokens` even though the shape is nearly
 * identical, and the difference is the reason: they have different TTLs, and a
 * shared collection would put both under one cleanup index. They are also
 * independent credentials — a leaked "forgot password" link must not verify an
 * email address.
 *
 * Per docs/DATABASE.md §2.
 */

export const PASSWORD_RESET_TTL_MINUTES = 60;

/** See `truncate` in session.model. Exported so the setter is not re-invented. */
const truncateIp = (value: string | null | undefined) =>
  typeof value === "string" ? value.slice(0, SESSION_MAX_IP) : (value ?? null);

export interface PasswordResetToken {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /** SHA-256 of the emailed token. The raw token is never stored. */
  tokenHash: string;
  expiresAt: Date;
  /**
   * Set on redemption. A second redemption of the same token finds this
   * non-null and is refused — single use, enforced by the data rather than by
   * remembering to delete the row.
   */
  usedAt: Date | null;
  requestIp: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const passwordResetTokenSchema = new Schema<PasswordResetToken>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    tokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    usedAt: { type: Date, default: null },
    // Truncating, for the same reason `sessions.ip` truncates rather than
    // validates: the value is an untrusted header from a client we do not
    // control, and refusing to record it would turn a cosmetic overflow into a
    // failed sign-in. See `SESSION_MAX_IP`.
    requestIp: { type: String, default: null, set: truncateIp },
  },
  { timestamps: true, collection: "password_reset_tokens" },
);

// Rate limiting: "has this user asked for too many resets recently" is answered
// by the newest tokens for that user, newest first.
passwordResetTokenSchema.index({ userId: 1, createdAt: -1 });

passwordResetTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const PasswordResetTokenModel: Model<PasswordResetToken> =
  (mongoose.models.PasswordResetToken as Model<PasswordResetToken>) ??
  mongoose.model<PasswordResetToken>(
    "PasswordResetToken",
    passwordResetTokenSchema,
  );

export const passwordResetTokenSchemaDefinition = passwordResetTokenSchema;
