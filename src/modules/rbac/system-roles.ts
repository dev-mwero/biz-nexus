import type { SystemRoleKey } from "@/modules/organizations/role.model";
import {
  ALL_PERMISSIONS,
  isPermission,
  PERMISSION_DOMAINS,
  type Permission,
} from "@/modules/rbac/permissions";

/**
 * The permission matrix for the four system roles.
 *
 * ADR 0004: permissions are code, roles are per-organisation data. This file is
 * the code half — the *starting point* for a tenant's roles, which they may
 * then edit. Nothing here is a hard limit: an owner can widen a role, and that
 * is the product's whole point. It is what every organisation gets before
 * anyone touches it.
 *
 * The sets are derived from the catalogue rather than written out as 61 strings.
 * A hand-written list is a list that goes stale: add `widgets.read` to
 * PERMISSIONS, and a hand-written VIEWER silently keeps denying it to every
 * viewer in every tenant. Deriving means the interesting question is only ever
 * asked about *domains* — which domains does this role touch — and the
 * individual codes follow.
 *
 * `satisfies` rather than an annotation, so a permission that does not exist is
 * a compile error here, as ADR 0004 requires. A typo in this file would
 * otherwise grant nothing and look like a working role.
 */

/** Read-only. A viewer sees the pipeline but cannot restructure it. */
export const RECORD_DOMAINS: readonly string[] = [
  "companies",
  "contacts",
  "leads",
  "deals",
  "tags",
  "fieldDefinitions",
  "pipelines",
  "activities",
  "tasks",
  "savedViews",
] as const;

/**
 * Domains a member may write records in.
 *
 * `fieldDefinitions` and `pipelines` are deliberately absent. Both describe the
 * *shape* of everybody's records rather than their content, and changing either
 * retroactively alters what other people's data means. A member is somebody who
 * works the pipeline; who it is for is a manager's decision.
 */
export const WRITABLE_RECORD_DOMAINS: readonly string[] = [
  "companies",
  "contacts",
  "leads",
  "deals",
  "tags",
  "activities",
  "tasks",
  "savedViews",
] as const;

/**
 * Who is in the room, and who shapes it. `organization.*` plus the members,
 * roles and invitations that populate it.
 */
export const ACCESS_CONTROL_DOMAINS: readonly string[] = [
  "organization",
  "users",
  "roles",
  "invitations",
] as const;

/**
 * Read-only for everyone except OWNER.
 *
 * The audit log exists so that a change is attributable, and the people it
 * attributes are the members. Handing every member read access to it would make
 * the log noise rather than a control, and it is the broadest read in the
 * product — it names who did what across the whole tenant.
 */
export const OWNER_ONLY_READS = [
  "auditLogs.read",
] as const satisfies readonly Permission[];

function inDomains(
  permission: Permission,
  domains: readonly string[],
): boolean {
  const domain = permission.slice(0, permission.indexOf("."));
  return domains.includes(domain);
}

/** Every `<domain>.read`. Derived, so a new domain's read comes along. */
export function readPermissionsIn(domains: readonly string[]): Permission[] {
  return ALL_PERMISSIONS.filter(
    (permission) =>
      permission.endsWith(".read") && inDomains(permission, domains),
  );
}

/** Every permission in a domain, read and write. */
export function allPermissionsIn(domains: readonly string[]): Permission[] {
  return ALL_PERMISSIONS.filter((permission) => inDomains(permission, domains));
}

/**
 * The write half of the record domains, *excluding* their reads.
 *
 * Excluding rather than including, because MEMBER is built on top of VIEWER and
 * that base already supplies every read in the product. Adding the whole domain
 * on top of it would list each read twice. The duplicate check below is what
 * caught it; the derivation is written this way so it cannot recur.
 */
const WRITABLE_RECORD_PERMISSIONS = allPermissionsIn(
  WRITABLE_RECORD_DOMAINS,
).filter((permission) => !permission.endsWith(".read"));

/**
 * A viewer reads, and does nothing else.
 *
 * Read *everywhere* except the audit log — including the member directory, the
 * role list and the organisation itself. Restricting those would be theatre: a
 * viewer can already see their colleagues' names on every record they read, so
 * hiding the directory denies nothing and only makes the product feel broken.
 * What matters is that a viewer cannot change anything, and this set has no
 * non-read permission in it. `1.19`'s acceptance criterion is checked by a test
 * that asserts exactly that, structurally.
 */
const VIEWER: readonly Permission[] = ALL_PERMISSIONS.filter(
  (permission) =>
    permission.endsWith(".read") &&
    !OWNER_ONLY_READS.includes(permission as never),
);

/**
 * A member works records and nothing else.
 *
 * Viewer, plus writes across the record domains they actually use, plus the two
 * permissions that are not plain writes and are easy to forget:
 * `leads.convert` and `deals.move`. Both are the operations a salesperson
 * exists to perform, and both were split out of `update` precisely so a tenant
 * could allow one without the other — a role matrix that omitted them while
 * granting `leads.update` would be actively misleading.
 */
const MEMBER: readonly Permission[] = [
  ...VIEWER,
  ...WRITABLE_RECORD_PERMISSIONS,
  "notifications.update",
];

/**
 * An admin runs the organisation, but does not own it.
 *
 * Everything except the three operations that destroy or transfer it:
 * `organization.delete`, `organization.transferOwnership` and
 * `organization.settings`. Billing and ownership are separated from ordinary
 * settings so that a compromised or careless admin account cannot quietly
 * repoint the subscription or hand the tenant to somebody else. An admin can do
 * almost everything, which is the point of the role.
 */
const ADMIN: readonly Permission[] = ALL_PERMISSIONS.filter(
  (permission) =>
    ![
      "organization.delete",
      "organization.transferOwnership",
      "organization.settings",
    ].includes(permission),
);

/** Everything. There is nothing above an owner, so nothing is withheld. */
const OWNER: readonly Permission[] = ALL_PERMISSIONS;

export const SYSTEM_ROLE_PERMISSIONS = {
  OWNER,
  ADMIN,
  MEMBER,
  VIEWER,
} as const satisfies Record<SystemRoleKey, readonly Permission[]>;

export type SystemRolePermissions = typeof SYSTEM_ROLE_PERMISSIONS;

/**
 * Fail loudly at import time rather than quietly at request time.
 *
 * `satisfies` catches a permission that does not exist. It cannot catch a
 * duplicate, and a duplicate is not harmless — it inflates the array written to
 * every new organisation, and the role editor would render the same permission
 * twice. Cheap to check once, at module load, rather than in every test.
 */
for (const [key, permissions] of Object.entries(SYSTEM_ROLE_PERMISSIONS)) {
  const seen = new Set<Permission>();
  for (const permission of permissions) {
    if (!isPermission(permission)) {
      throw new Error(
        `${key} holds "${permission}", which is not in the permission catalogue.`,
      );
    }
    if (seen.has(permission)) {
      throw new Error(`${key} holds "${permission}" more than once.`);
    }
    seen.add(permission);
  }
}

/** Whether a role holds a permission, in code, for tests and the role editor. */
export function systemRoleHas(
  key: SystemRoleKey,
  permission: Permission,
): boolean {
  return (SYSTEM_ROLE_PERMISSIONS[key] as readonly Permission[]).includes(
    permission,
  );
}

export { PERMISSION_DOMAINS };
