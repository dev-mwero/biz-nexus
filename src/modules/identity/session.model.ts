import mongoose, { type Model, Schema, type Types } from "mongoose";

/**
 * An authenticated browser session. Global, not tenant-owned: a session belongs
 * to a user and survives that user switching between organisations. Which
 * organisation is active is a property of the session, recorded here as
 * `activeOrganizationId` and never implied by the request.
 *
 * Per docs/DATABASE.md §2.
 */

export const SESSION_TTL_DAYS = 30;
export const SESSION_SLIDING_WINDOW_DAYS = 30;

/**
 * Truncation, not validation.
 *
 * `maxlength` would reject an over-long user agent, and rejecting it would be
 * wrong: a session that cannot be recorded is a user who cannot sign in, and
 * the field that overflowed is an untrusted header from a browser we do not
 * control. So the value is cut to fit on the way in and the session is issued.
 * The stored value is for display in "your active sessions", where a truncated
 * agent is indistinguishable from a correct one.
 */
export const SESSION_MAX_USER_AGENT = 255;

/** 45 is the longest possible IPv6 textual form, so this never cuts a real IP. */
export const SESSION_MAX_IP = 45;

const truncate = (limit: number) => (value: string | null | undefined) =>
  typeof value === "string" ? value.slice(0, limit) : (value ?? null);

export interface Session {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  /**
   * SHA-256 of the cookie token. The raw token is returned to the client once
   * and exists nowhere else — not here, not in a log, not in a backup. A
   * database leak therefore yields no usable session.
   */
  tokenHash: string;
  activeOrganizationId: Types.ObjectId | null;
  userAgent: string | null;
  ip: string | null;
  expiresAt: Date;
  lastUsedAt: Date;
  /**
   * Revocation is a timestamp rather than a deletion so that "this session was
   * ended at 14:02" is answerable afterwards. TTL still removes the row.
   */
  revokedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<Session>(
  {
    userId: { type: Schema.Types.ObjectId, required: true, ref: "User" },
    tokenHash: { type: String, required: true, unique: true },
    activeOrganizationId: {
      type: Schema.Types.ObjectId,
      default: null,
      ref: "Organization",
    },
    userAgent: {
      type: String,
      default: null,
      set: truncate(SESSION_MAX_USER_AGENT),
    },
    ip: { type: String, default: null, set: truncate(SESSION_MAX_IP) },
    expiresAt: { type: Date, required: true },
    lastUsedAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
  },
  { timestamps: true, collection: "sessions" },
);

// "Active sessions" list, and revoke-all-for-a-user on sign-out elsewhere.
sessionSchema.index({ userId: 1, revokedAt: 1 });

// Cleanup is the database's job. A TTL index means no cron, no cron to forget
// to run, and no expired rows for a session check to trip over.
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const SessionModel: Model<Session> =
  (mongoose.models.Session as Model<Session>) ??
  mongoose.model<Session>("Session", sessionSchema);

export const sessionSchemaDefinition = sessionSchema;
