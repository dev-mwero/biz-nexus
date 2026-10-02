/**
 * The entire permission universe.
 *
 * Permissions are code and roles are per-organisation data, deliberately
 * split. Permissions change when the *product* changes, and that should be a
 * code review and a deploy. Roles change when a *customer* changes, and that
 * should take ten seconds and touch no other tenant. See
 * `docs/decisions/0004-per-organization-roles.md`.
 *
 * A permission that is not in this object does not exist. Nothing can insert
 * one: not a database row, not an API payload, not an admin UI. A typo is a
 * compile error at every call site that uses `Permission`, which is the
 * property that makes the catalogue worth the verbosity.
 *
 * Every code is `<domain>.<action>`, and `isWellFormedPermission` below
 * enforces that at test time rather than trusting review to catch it.
 */

export const PERMISSIONS = {
  // Organisation and access control. `organization.delete` and
  // `organization.transferOwnership` are separated from `update` because they
  // are the two irreversible, ownership-changing operations, and a role that
  // can rename the organisation must not be able to destroy it.
  "organization.read": {},
  "organization.update": {},
  "organization.delete": {},
  "organization.transferOwnership": {},
  "organization.settings": {},

  // Members and roles.
  "users.read": {},
  "users.invite": {},
  "users.update": {},
  "users.remove": {},

  "roles.read": {},
  "roles.create": {},
  "roles.update": {},
  "roles.delete": {},

  "invitations.read": {},
  "invitations.create": {},
  "invitations.revoke": {},

  // CRM.
  "companies.read": {},
  "companies.create": {},
  "companies.update": {},
  "companies.delete": {},

  "contacts.read": {},
  "contacts.create": {},
  "contacts.update": {},
  "contacts.delete": {},

  "leads.read": {},
  "leads.create": {},
  "leads.update": {},
  "leads.delete": {},
  "leads.convert": {},

  "deals.read": {},
  "deals.create": {},
  "deals.update": {},
  "deals.delete": {},
  // Distinct from `update`. A stage move is what changes the forecast, and an
  // organisation that lets people edit deal details but not push them through
  // the pipeline is a real and common arrangement.
  "deals.move": {},

  "tags.read": {},
  "tags.create": {},
  "tags.update": {},
  "tags.delete": {},

  "fieldDefinitions.read": {},
  "fieldDefinitions.create": {},
  "fieldDefinitions.update": {},
  "fieldDefinitions.delete": {},

  // Pipelines.
  "pipelines.read": {},
  "pipelines.create": {},
  "pipelines.update": {},
  "pipelines.delete": {},

  // Activities and tasks.
  "activities.read": {},
  "activities.create": {},
  "activities.update": {},
  "activities.delete": {},

  "tasks.read": {},
  "tasks.create": {},
  "tasks.update": {},
  "tasks.delete": {},

  // Notifications, audit and saved views.
  "notifications.read": {},
  "notifications.update": {},

  // Audit logs are read-only by design. There is no create, update or delete
  // permission, and adding one is a security decision rather than a feature.
  "auditLogs.read": {},

  // Dashboard and search.
  "dashboard.read": {},
  "search.read": {},

  "savedViews.read": {},
  "savedViews.create": {},
  "savedViews.update": {},
  "savedViews.delete": {},
} as const;

/** The union of every permission that exists. */
export type Permission = keyof typeof PERMISSIONS;

/** Every permission, as a readonly array. Derived, so it cannot drift. */
export const ALL_PERMISSIONS = Object.keys(
  PERMISSIONS,
) as readonly Permission[];

/**
 * The permission domains, derived from the catalogue.
 *
 * A domain is the leading segment before the first dot. Deriving it means a
 * new domain appears by adding a permission, with no second list to update and
 * no opportunity for the two to disagree.
 */
export const PERMISSION_DOMAINS = [
  ...new Set(
    ALL_PERMISSIONS.map((permission) =>
      permission.slice(0, permission.indexOf(".")),
    ),
  ),
].sort();

/** Whether a string is a permission that exists. */
export function isPermission(value: unknown): value is Permission {
  return typeof value === "string" && Object.hasOwn(PERMISSIONS, value);
}

/**
 * Whether a string is shaped like a permission: `<domain>.<action>`, both parts
 * non-empty and lower camel case.
 *
 * Separate from `isPermission` because it answers a different question. This
 * one catches a *mistyped* code in a database row or an API payload, which is
 * how a role ends up holding `"Deals.Update"` and silently granting nothing.
 */
export function isWellFormedPermission(value: string): boolean {
  return /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/.test(value);
}

/**
 * Discard anything not in the catalogue.
 *
 * Applied when a role's permissions are saved, per docs/SECURITY.md §5: deny by
 * default. A stale code from a renamed permission, a typo, or a hand-edited row
 * is dropped rather than stored, so it cannot appear to grant access and cannot
 * later be revived by re-introducing a permission with the same name.
 */
export function normalizePermissions(values: readonly unknown[]): Permission[] {
  return [...new Set(values.filter(isPermission))];
}
