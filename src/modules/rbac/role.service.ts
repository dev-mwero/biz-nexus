import type mongoose from "mongoose";
import {
  type Role,
  RoleModel,
  SYSTEM_ROLE_KEYS,
  type SystemRoleKey,
} from "@/modules/organizations/role.model";
import { SYSTEM_ROLE_PERMISSIONS } from "@/modules/rbac/system-roles";
import { AppError } from "@/shared/errors/app-error";

/**
 * System role provisioning.
 *
 * Every organisation gets the same four roles, stored as documents in that
 * organisation rather than referenced from a global template. Four rows per
 * tenant buys per-tenant renaming and permission editing, and it makes a
 * cross-tenant role read structurally impossible rather than merely filtered.
 *
 * The permission each role starts with is the matrix in ./system-roles, not a
 * list here: 1.19 owns capability, this file owns the mechanics of writing it.
 * A tenant may then edit any of it.
 */

export { SYSTEM_ROLE_PERMISSIONS } from "@/modules/rbac/system-roles";

export const SYSTEM_ROLE_NAMES: Record<SystemRoleKey, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};

export const SYSTEM_ROLE_DESCRIPTIONS: Record<SystemRoleKey, string> = {
  OWNER: "Full control, including billing and deleting the organisation.",
  ADMIN: "Manages people, roles and records. Cannot delete the organisation.",
  MEMBER: "Works with records. Cannot manage other members.",
  VIEWER: "Read-only access.",
};

/**
 * The role granted to somebody who joins by invitation. Exactly one per
 * organisation: two defaults would make "which role do new members get?"
 * unanswerable, and 1.20 needs a single answer to it.
 */
export const DEFAULT_ROLE_KEY: SystemRoleKey = "MEMBER";

export class RoleProvisioningError extends AppError {
  constructor(message: string) {
    super("ROLE_PROVISIONING_FAILED", { message });
    this.name = "RoleProvisioningError";
  }
}

function isSystemRoleKey(key: string): key is SystemRoleKey {
  return (SYSTEM_ROLE_KEYS as readonly string[]).includes(key);
}

/**
 * Create the four system roles for an organisation.
 *
 * Idempotent by refusal, not by silence. Calling it twice throws rather than
 * quietly doing nothing, because the second call is always a bug — an
 * onboarding path running twice, or a retry after a failure that did not roll
 * back. Silently succeeding would leave that bug in place and report success,
 * and the organisation would carry roles the code never intended. The unique
 * index would catch it as an E11000 if we let it, which is why the check is
 * here instead: the same refusal with a message that says what to do.
 */
export async function provisionSystemRoles(
  organizationId: mongoose.Types.ObjectId | string,
  actorId: mongoose.Types.ObjectId | string,
  session?: mongoose.ClientSession,
): Promise<Role[]> {
  const existing = await RoleModel.find(
    { organizationId, isSystem: true },
    { key: 1 },
    { session },
  );

  if (existing.length > 0) {
    throw new RoleProvisioningError(
      `This organisation already has ${existing.length} system role(s) (${existing
        .map((role) => role.key)
        .join(", ")}). Provisioning runs once, at creation.`,
    );
  }

  const roles = await RoleModel.insertMany(
    SYSTEM_ROLE_KEYS.map((key) => ({
      organizationId,
      key,
      name: SYSTEM_ROLE_NAMES[key],
      description: SYSTEM_ROLE_DESCRIPTIONS[key],
      permissions: [...SYSTEM_ROLE_PERMISSIONS[key]],
      isSystem: true,
      isDefault: key === DEFAULT_ROLE_KEY,
      createdBy: actorId,
      updatedBy: actorId,
    })),
    // insertMany is ordered so a failure stops at the offending document
    // rather than inserting the rest; inside a transaction the whole set rolls
    // back regardless, but ordered keeps the failure legible without one.
    { session, ordered: true },
  );

  if (roles.length !== SYSTEM_ROLE_KEYS.length) {
    throw new RoleProvisioningError(
      `Expected ${SYSTEM_ROLE_KEYS.length} system roles, wrote ${roles.length}.`,
    );
  }

  return roles as Role[];
}

/** The role a new member is granted. `null` if the set is somehow absent. */
export async function findDefaultRole(
  organizationId: mongoose.Types.ObjectId | string,
  session?: mongoose.ClientSession,
): Promise<Role | null> {
  return RoleModel.findOne(
    { organizationId, isDefault: true, deletedAt: null },
    undefined,
    { session },
  );
}

export function isSystemRoleKeyExport(key: string): boolean {
  return isSystemRoleKey(key);
}
