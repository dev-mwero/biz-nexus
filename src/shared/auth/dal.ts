import type { Types } from "mongoose";
import { cookies } from "next/headers";
import { type Session, type User, UserModel } from "@/modules/identity";
import { verifySessionToken } from "@/modules/identity/session.service";
import type { Membership, Organization, Role } from "@/modules/organizations";
import {
  MembershipModel,
  OrganizationModel,
  RoleModel,
} from "@/modules/organizations";
import { isPermission, type Permission } from "@/modules/rbac/permissions";

/**
 * The Data Access Layer: steps 1 to 3 of the request lifecycle in
 * docs/ARCHITECTURE.md §4.
 *
 * Authenticate, resolve the organisation, authorize — in that order, before a
 * request is allowed to touch data. Every route that needs authorization calls
 * a guard, so the check cannot be forgotten: forgetting means calling a function
 * that does not exist.
 *
 * The guards are built from a token source rather than reading the cookie
 * directly. That is not indirection for its own sake — it is the only way to
 * test the security-critical code without standing up a Next.js request
 * context, and these are the tests that matter most.
 */

import { SESSION_COOKIE } from "@/shared/auth/session-cookie";
import { AppError } from "@/shared/errors/app-error";

export { SESSION_COOKIE };

/** Where a session token comes from. Async, because reading cookies is. */
export type TokenSource = () => Promise<string | null | undefined>;

export class AuthError extends AppError {
  constructor(
    code: AuthErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    // The status is no longer passed in. It comes from the error catalogue, so
    // a 401/403 decision cannot be made at a call site and then drift.
    super(code, { message, cause: options?.cause });
    this.name = "AuthError";
  }
}

/**
 * No `NOT_A_MEMBER`. Not an oversight: requireOrg deliberately returns one
 * answer for "session without a usable organisation" and "session that is not a
 * member of it", because distinguishing them tells an attacker which sessions
 * belong to real accounts. A code that exists but is never thrown would invite
 * somebody to start throwing it.
 */
export type AuthErrorCode =
  | "UNAUTHENTICATED"
  | "ACTIVE_ORGANIZATION_REQUIRED"
  | "INSUFFICIENT_PERMISSION";

export interface AuthContext {
  session: Session;
  user: User;
  organization: Organization;
  membership: Membership;
  role: Role;
}

async function findActiveMembership(
  organizationId: Types.ObjectId,
  userId: Types.ObjectId,
) {
  return MembershipModel.findOne({
    organizationId,
    userId,
    status: "ACTIVE",
    deletedAt: null,
  });
}

export interface AuthGuards {
  getSession(): Promise<Session | null>;
  requireUser(): Promise<User>;
  requireOrg(): Promise<AuthContext>;
  requirePermission(permission: Permission): Promise<AuthContext>;
}

/**
 * The cookie source, read through `next/headers` so this module stays usable
 * from a Server Action as well as a route handler.
 */
const cookieToken: TokenSource = async () => {
  const jar = await cookies();
  return jar.get(SESSION_COOKIE)?.value;
};

/**
 * Resolve the caller's session, or null.
 *
 * Null rather than a thrown error, because the proxy in 1.16 needs exactly
 * this: an optimistic answer for a redirect, with no database access of its own.
 */
export async function getSession(): Promise<Session | null> {
  return resolveSession(await cookieToken());
}

/** Resolve a session from an explicit token. The testable core. */
export async function resolveSession(
  token: string | null | undefined,
): Promise<Session | null> {
  if (!token) return null;
  return verifySessionToken(token);
}

/**
 * Build the full authorization context, or null if there is no session.
 *
 * Deliberately does not fail on a missing organisation. "Signed in but not in
 * an organisation" is a real state - a new user, or one who was removed from
 * every organisation - and the guards decide what it means for the operation
 * being attempted.
 */
async function buildContext(
  token: string | null | undefined,
): Promise<AuthContext | null> {
  const session = await resolveSession(token);
  if (!session) return null;

  // No `deletedAt` here. `users` is not a soft-delete collection - the tenant
  // repository's soft-delete list does not include it, so the field is never
  // written and the filter would only ever be a condition the schema knows
  // nothing about. Erasure of a user is a hard delete.
  const user = await UserModel.findOne({
    _id: session.userId,
    status: "ACTIVE",
  });
  if (!user) return null;

  if (!session.activeOrganizationId) return null;

  const organizationId = session.activeOrganizationId;

  // A suspended or deleted organisation must not be usable through a session
  // that outlived the change. Not doing this is how a cancelled account keeps
  // working for the length of a session.
  const organization = await OrganizationModel.findOne({
    _id: organizationId,
    isActive: true,
    deletedAt: null,
  });
  if (!organization) return null;

  const membership = await findActiveMembership(organizationId, user._id);
  if (!membership) return null;

  const role = await RoleModel.findOne({
    _id: membership.roleId,
    organizationId,
    deletedAt: null,
  });
  // The organisation check here is the point. MongoDB has no foreign keys, so
  // nothing stops a membership pointing at another tenant's role. Without this
  // assertion, a membership could grant the permissions of a role owned by
  // somebody else.
  if (!role) return null;

  return { session, user, organization, membership, role };
}

function unauthenticated(): AuthError {
  return new AuthError("UNAUTHENTICATED", "Sign in to continue.");
}

/**
 * Build a set of guards over one token source.
 *
 * A route should normally call `requirePermission` once and keep the returned
 * context, rather than calling three guards and querying the database three
 * times. The separate guards exist for the cases that need them and for
 * readable failure messages.
 */
export function createAuthGuards(source: TokenSource): AuthGuards {
  return {
    async getSession() {
      return resolveSession(await source());
    },

    async requireUser() {
      const session = await resolveSession(await source());
      if (!session) throw unauthenticated();

      const user = await UserModel.findOne({
        _id: session.userId,
        status: "ACTIVE",
      });
      if (!user) throw unauthenticated();

      return user;
    },

    async requireOrg() {
      const context = await buildContext(await source());
      if (!context) {
        // Deliberately one message for "no session" and "session without a
        // usable organisation". Distinguishing them tells an attacker which
        // sessions belong to real accounts.
        const session = await resolveSession(await source());
        throw session
          ? new AuthError(
              "ACTIVE_ORGANIZATION_REQUIRED",
              "No active organization, or you are not an active member of it.",
            )
          : unauthenticated();
      }

      return context;
    },

    async requirePermission(permission: Permission) {
      // A permission code that is not in the catalogue cannot be satisfied by
      // any role. Checking here rather than trusting the type means a value
      // that reached us from outside TypeScript is denied instead of compared
      // against a list it was never in.
      if (!isPermission(permission)) {
        throw new AuthError("INSUFFICIENT_PERMISSION", "Not permitted.");
      }

      const context = await buildContext(await source());
      if (!context) {
        const session = await resolveSession(await source());
        throw session
          ? new AuthError(
              "ACTIVE_ORGANIZATION_REQUIRED",
              "No active organization, or you are not an active member of it.",
            )
          : unauthenticated();
      }

      // Compared against the stored array, not a normalised copy. A stale code
      // in the database simply never matches anything a caller can ask for,
      // which is the correct outcome: it grants nothing and hides nothing.
      if (!context.role.permissions.includes(permission)) {
        throw new AuthError("INSUFFICIENT_PERMISSION", "Not permitted.");
      }

      return context;
    },
  };
}

/**
 * The guards used by routes and Server Actions.
 *
 * `createAuthGuards` is exported for tests, which supply a token directly. This
 * instance reads the request cookie, and is the only one production code
 * should reach for.
 */
export const auth = createAuthGuards(cookieToken);
