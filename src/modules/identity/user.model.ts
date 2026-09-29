import mongoose, { type Model, Schema, type Types } from "mongoose";

/**
 * The user account. Global, not tenant-owned: a user exists before and
 * independently of any organisation, and keeps existing after leaving every
 * one of them. `organizationId` is deliberately absent — it is not nullable
 * here, it does not apply.
 *
 * Per docs/DATABASE.md §2.
 */

export const USER_STATUS = ["ACTIVE", "SUSPENDED"] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export interface UserPreferences {
  timezone?: string;
  locale?: string;
  dateFormat?: string;
  currencyFormat?: string;
}

export interface User {
  _id: Types.ObjectId;
  email: string;
  name: string;
  /**
   * bcrypt, cost 12. `select: false` so a stray `findOne` cannot leak it into a
   * log line or a serialised API response. The auth service must ask for it by
   * name, which makes every read of the hash a deliberate act in review.
   */
  passwordHash: string;
  avatarUrl: string | null;
  emailVerifiedAt: Date | null;
  lastLoginAt: Date | null;
  failedLoginCount: number;
  lockedUntil: Date | null;
  status: UserStatus;
  preferences: UserPreferences;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<User>(
  {
    email: {
      type: String,
      required: true,
      // Matched on the normalised form only, so the index and the uniqueness
      // rule agree. A user who signs up as Ada@Example.COM and one who signs
      // up as ada@example.com are the same person with one account.
      unique: true,
      lowercase: true,
      trim: true,
    },
    name: {
      type: String,
      required: true,
      minlength: 1,
      maxlength: 120,
      trim: true,
    },
    passwordHash: { type: String, required: true, select: false },
    avatarUrl: { type: String, default: null },
    emailVerifiedAt: { type: Date, default: null },
    lastLoginAt: { type: Date, default: null },
    failedLoginCount: { type: Number, default: 0, min: 0 },
    lockedUntil: { type: Date, default: null },
    status: { type: String, enum: USER_STATUS, default: "ACTIVE" },
    preferences: { type: Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true, collection: "users" },
);

export const UserModel: Model<User> =
  (mongoose.models.User as Model<User>) ??
  mongoose.model<User>("User", userSchema);

export const userSchemaDefinition = userSchema;
