# ADR-0004 — Per-organisation role documents over a code-level permission catalogue

- **Status:** accepted
- **Date:** 2026-09-29
- **Affects:** rbac module, organizations module, every authorised operation

## Context

Every organisation needs to control who can do what. The target customer is a
generic B2B SME, so no fixed role set is adequate: a four-person company wants
"everyone does everything", a twenty-person one wants a sales-only role that
cannot see settings, and an agency wants a "delivery" role that sees projects
but not billing.

Three things must be true:

1. A user can hold a different role in every organisation they belong to.
2. An organisation can change what a role permits without a code deploy.
3. A permission can never be granted by inserting a row into a database.

## Options considered

**A fixed role enum in code** (`OWNER | ADMIN | MEMBER | VIEWER`) with hard-coded
permission sets. Simple, and fast to check in. Rejected: it fails requirement 2.
Every customer gets the same access model, which is wrong for the target market.

**A global roles collection with an `isSystem` flag**, referenced by membership.
One row per role for the whole platform. Rejected: it makes every organisation
share one role definition, so one tenant's customisation silently changes access
for every other tenant. Fixing that requires either a junction table or
duplicating, which is strictly more complex than simply not sharing.

**Permissions in the database too**, editable by an admin. Rejected: it fails
requirement 3 outright. A permission table is a lever that can be pulled to
widen access, and a bug in the admin UI becomes a privilege escalation.

**A code-level permission catalogue plus per-organisation role documents.**
Permissions are a frozen `const` in source, so they cannot be created, deleted
or renamed at runtime. Roles are documents, one set per organisation, holding an
array of permission codes. **Chosen.**

## Decision

**Permissions are code. Roles are per-organisation data.**

```ts
// src/modules/rbac/permissions.ts — the entire permission universe
export const PERMISSIONS = {
  "organization.read": {}, "organization.update": {},
  "users.read": {}, "users.invite": {}, "users.update": {}, "users.remove": {},
  "contacts.read": {}, "contacts.create": {}, "contacts.update": {}, "contacts.delete": {},
  // ...
} as const;

export type Permission = keyof typeof PERMISSIONS;
```

Every code is `<domain>.<action>`. A permission that is not in this object does
not exist. TypeScript makes a typo a compile error, and `satisfies` in the role
matrix makes a missing permission a compile error too.

**Roles are documents:**

```
{ organizationId, key, name, description, permissions[], isSystem, isDefault }
```

Unique index on `(organizationId, key)`. Four are provisioned on organisation
creation: `OWNER`, `ADMIN`, `MEMBER`, `VIEWER`.

- System roles may be **renamed** and their permissions **edited**.
- System roles may **not** be deleted, and their keys may **not** be reused.
- Organisations may create additional custom roles.

**Guards, not scattered conditions:**

```ts
const session = await requireSession();                    // 401
const org = await requireOrganization(session);            // 403 — active membership
await requirePermission(org, "deals.update");              // 403
```

`requirePermission` reads the membership, loads the role, checks the code. Every
authorised operation calls it. The check cannot be forgotten, because forgetting
it means calling a function that does not exist.

## Rationale

Splitting the two concerns this way puts each piece of data where it belongs.

Permissions change when the *product* changes. That is a code change, a code
review, and a deploy — exactly the control we want over something that can widen
access. Four years from now, when someone wants to add `deals.approve`, the
compiler walks every call site that needs updating. Nothing can grant a
permission that a developer did not write down.

Roles change when a *customer* changes. "Our interns need to see deals but not
contact details" is a configuration task, done in ten seconds, with no deploy
and no risk to another tenant.

Per-organisation role documents rather than shared templates is what makes the
second requirement true without leaking across tenants. Four extra documents per
organisation is a rounding error against the isolation guarantee it buys.

## Trade-offs accepted

| Consequence | Mitigation |
|---|---|
| Permission management needs a deployment | Correct, and desirable for something that widens access |
| Four role documents per organisation | Negligible; created in the same transaction as the organisation |
| A deleted permission code leaves stale entries in role arrays | Entries are intersected with the catalogue on every role read and write, so a stale code grants nothing |
| Custom roles are a UI surface to get right | Phase 1 ships role editing; the catalogue stays fixed, so the worst outcome is a mistuned role inside one organisation, not a platform-wide escalation |
| Every permission check costs a role load | The membership and role are memoised per request in the Data Access Layer |

## Cross-cutting rules

- **Deny by default.** A role's permission array is intersected with the
  catalogue when read. An unrecognised code is discarded, not honoured.
- **Never trust a `roleId` from the client.** A service loads the role and
  asserts `role.organizationId === activeOrganizationId` before using it. A role
  id from another organisation is `404`.
- **Ownership is not a permission.** `OWNER` exists so exactly one member can
  transfer ownership or delete the organisation. It is a role, not a bypass.
- **Self-management is restricted by design.** A member cannot remove
  themselves if they are the last `OWNER`; a `MEMBER` cannot escalate
  themselves to `ADMIN`. Both are `409` with an explanation.

## Revisit when

Enterprise customers require per-user permission overrides, or a role
hierarchy. Both are additive — a membership-level override list, or an `inherits`
field on the role — and neither disturbs the catalogue. The split between code
permissions and data roles holds either way.
