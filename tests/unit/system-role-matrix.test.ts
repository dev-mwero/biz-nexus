import { describe, expect, it } from "vitest";
import {
  SYSTEM_ROLE_KEYS,
  type SystemRoleKey,
} from "@/modules/organizations/role.model";
import {
  ACCESS_CONTROL_DOMAINS,
  RECORD_DOMAINS,
  readPermissionsIn,
  SYSTEM_ROLE_PERMISSIONS,
  systemRoleHas,
  WRITABLE_RECORD_DOMAINS,
} from "@/modules/rbac";
import {
  ALL_PERMISSIONS,
  isPermission,
  PERMISSION_DOMAINS,
  type Permission,
} from "@/modules/rbac/permissions";

/**
 * The permission matrix.
 *
 * The acceptance criteria are two sentences — a viewer cannot write, a member
 * cannot manage members — and those are asserted structurally, over the whole
 * catalogue, rather than as a handful of spot checks. A spot check passes while
 * a permission nobody thought about is misfiled; the structural form cannot.
 */

const holds = (key: SystemRoleKey) =>
  new Set<Permission>(SYSTEM_ROLE_PERMISSIONS[key] as readonly Permission[]);

describe("system role permission matrix", () => {
  describe("OWNER", () => {
    it("holds every permission in the catalogue", () => {
      const owner = holds("OWNER");
      for (const permission of ALL_PERMISSIONS) {
        expect(owner.has(permission), `OWNER is missing ${permission}`).toBe(
          true,
        );
      }
    });

    it("holds exactly the catalogue, and nothing more", () => {
      expect(holds("OWNER").size).toBe(ALL_PERMISSIONS.length);
    });
  });

  describe("VIEWER", () => {
    it("cannot write — the acceptance criterion", () => {
      // Structural, so a permission added tomorrow is covered by the same
      // assertion rather than by remembering to extend a list of examples.
      const writes = (
        SYSTEM_ROLE_PERMISSIONS.VIEWER as readonly Permission[]
      ).filter((permission) => !permission.endsWith(".read"));

      expect(writes).toEqual([]);
    });

    it("cannot write anything, by domain", () => {
      const viewer = holds("VIEWER");
      for (const domain of PERMISSION_DOMAINS) {
        const writable = ALL_PERMISSIONS.filter(
          (permission) =>
            permission.startsWith(`${domain}.`) &&
            !permission.endsWith(".read") &&
            viewer.has(permission),
        );
        expect(writable, `VIEWER holds write permissions in ${domain}`).toEqual(
          [],
        );
      }
    });

    it("reads everything except the audit log", () => {
      const viewer = holds("VIEWER");
      const expected = ALL_PERMISSIONS.filter(
        (permission) =>
          permission.endsWith(".read") && !permission.startsWith("auditLogs."),
      );

      for (const permission of expected) {
        expect(viewer.has(permission), `VIEWER cannot read ${permission}`).toBe(
          true,
        );
      }
      expect(viewer.has("auditLogs.read")).toBe(false);
    });

    it("cannot read the audit log", () => {
      expect(systemRoleHas("VIEWER", "auditLogs.read")).toBe(false);
    });
  });

  describe("MEMBER", () => {
    it("cannot manage members — the acceptance criterion", () => {
      // "Manage" means write. A member *reads* the directory, the role list
      // and the invitation list, and that is deliberate: a member can already
      // see their colleagues' names on every record they read, so denying the
      // directory denies nothing and only makes the product feel broken. What
      // must not happen is a member changing any of it, so the assertion is on
      // the writes and it covers the whole access-control domain rather than a
      // list of the permissions that occur to have an action today.
      const writes = (
        SYSTEM_ROLE_PERMISSIONS.MEMBER as readonly Permission[]
      ).filter((permission) => {
        if (permission.endsWith(".read")) return false;
        const domain = permission.slice(0, permission.indexOf("."));
        return ACCESS_CONTROL_DOMAINS.includes(domain);
      });

      expect(writes).toEqual([]);
    });

    it("holds no access-control write, in any domain, present or future", () => {
      // The same property stated over the catalogue rather than over the role,
      // so a new `roles.archive` is covered the day it is added.
      for (const permission of ALL_PERMISSIONS) {
        const domain = permission.slice(0, permission.indexOf("."));
        if (!ACCESS_CONTROL_DOMAINS.includes(domain)) continue;
        if (permission.endsWith(".read")) continue;

        expect(
          systemRoleHas("MEMBER", permission),
          `MEMBER holds ${permission}`,
        ).toBe(false);
      }
    });

    it("cannot invite, remove, or change a person", () => {
      for (const permission of [
        "users.invite",
        "users.remove",
        "users.update",
        "invitations.create",
        "invitations.revoke",
        "roles.create",
        "roles.update",
        "roles.delete",
      ] as const) {
        expect(
          systemRoleHas("MEMBER", permission),
          `MEMBER holds ${permission}`,
        ).toBe(false);
      }
    });

    it("cannot delete or transfer the organisation", () => {
      expect(systemRoleHas("MEMBER", "organization.delete")).toBe(false);
      expect(systemRoleHas("MEMBER", "organization.transferOwnership")).toBe(
        false,
      );
    });

    it("can do the work a member exists to do", () => {
      for (const permission of [
        "contacts.create",
        "contacts.update",
        "deals.create",
        "deals.update",
        "leads.create",
        "leads.convert",
        "tasks.create",
        "activities.create",
      ] as const) {
        expect(
          systemRoleHas("MEMBER", permission),
          `MEMBER is missing ${permission}`,
        ).toBe(true);
      }
    });

    it("can move a deal through the pipeline", () => {
      // Split out from `deals.update` on purpose. A matrix that granted update
      // and omitted this would quietly make stage moves impossible, which is
      // the single most common thing a salesperson does.
      expect(systemRoleHas("MEMBER", "deals.move")).toBe(true);
    });

    it("can convert a lead", () => {
      expect(systemRoleHas("MEMBER", "leads.convert")).toBe(true);
    });

    it("cannot restructure the shape of everybody's records", () => {
      // `fieldDefinitions` and `pipelines` describe what records *mean*. A
      // member changing either retroactively alters what other people's data
      // says, so the write halves stop at the admin boundary.
      for (const domain of ["fieldDefinitions", "pipelines"] as const) {
        const writes = ALL_PERMISSIONS.filter(
          (permission) =>
            permission.startsWith(`${domain}.`) &&
            !permission.endsWith(".read"),
        );
        for (const permission of writes) {
          expect(
            systemRoleHas("MEMBER", permission),
            `MEMBER holds ${permission}`,
          ).toBe(false);
          expect(
            systemRoleHas("ADMIN", permission),
            `ADMIN is missing ${permission}`,
          ).toBe(true);
        }
      }
    });

    it("can dismiss its own notifications", () => {
      expect(systemRoleHas("MEMBER", "notifications.update")).toBe(true);
    });

    it("cannot read the audit log", () => {
      expect(systemRoleHas("MEMBER", "auditLogs.read")).toBe(false);
    });
  });

  describe("ADMIN", () => {
    it("can manage people", () => {
      for (const permission of [
        "users.invite",
        "users.remove",
        "roles.create",
        "invitations.revoke",
      ] as const) {
        expect(
          systemRoleHas("ADMIN", permission),
          `ADMIN is missing ${permission}`,
        ).toBe(true);
      }
    });

    it("cannot delete the organisation", () => {
      expect(systemRoleHas("ADMIN", "organization.delete")).toBe(false);
    });

    it("cannot transfer ownership", () => {
      expect(systemRoleHas("ADMIN", "organization.transferOwnership")).toBe(
        false,
      );
    });

    it("cannot change billing and organisation settings", () => {
      // Separated from `update` so a compromised admin account cannot quietly
      // repoint the subscription or hand the tenant away.
      expect(systemRoleHas("ADMIN", "organization.settings")).toBe(false);
      expect(systemRoleHas("ADMIN", "organization.update")).toBe(true);
    });

    it("can read the audit log", () => {
      expect(systemRoleHas("ADMIN", "auditLogs.read")).toBe(true);
    });
  });

  describe("invariants that hold across the whole catalogue", () => {
    it("every code exists in the catalogue", () => {
      for (const [key, permissions] of Object.entries(
        SYSTEM_ROLE_PERMISSIONS,
      )) {
        for (const permission of permissions) {
          expect(
            isPermission(permission),
            `${key} holds "${permission}", which does not exist`,
          ).toBe(true);
        }
      }
    });

    it("no role holds a permission twice", () => {
      for (const [key, permissions] of Object.entries(
        SYSTEM_ROLE_PERMISSIONS,
      )) {
        expect(permissions.length, `${key} holds a duplicate`).toBe(
          new Set(permissions).size,
        );
      }
    });

    it("covers all four system roles", () => {
      expect(Object.keys(SYSTEM_ROLE_PERMISSIONS).sort()).toEqual(
        [...SYSTEM_ROLE_KEYS].sort(),
      );
    });

    it("nests strictly: VIEWER ⊆ MEMBER ⊆ ADMIN ⊆ OWNER", () => {
      // A hierarchy a tenant cannot reason about is a support burden. Each role
      // is a superset of the one below it, so "upgrade somebody to Admin" needs
      // no explanation of what else changes.
      const pairs: Array<[SystemRoleKey, SystemRoleKey]> = [
        ["VIEWER", "MEMBER"],
        ["MEMBER", "ADMIN"],
        ["ADMIN", "OWNER"],
      ];

      for (const [lower, higher] of pairs) {
        const lowerSet = holds(lower);
        const higherSet = holds(higher);
        for (const permission of lowerSet) {
          expect(
            higherSet.has(permission),
            `${higher} is missing ${permission}, which ${lower} holds`,
          ).toBe(true);
        }
      }
    });

    it("each role is strictly larger than the one below it", () => {
      // Nested and identical would mean one of the four roles is decorative.
      expect(holds("MEMBER").size).toBeGreaterThan(holds("VIEWER").size);
      expect(holds("ADMIN").size).toBeGreaterThan(holds("MEMBER").size);
      expect(holds("OWNER").size).toBeGreaterThan(holds("ADMIN").size);
    });
  });

  describe("derivation, so a new permission cannot be forgotten", () => {
    it("readPermissionsIn covers exactly the live catalogue's reads in those domains", () => {
      // Stated as a property over the catalogue rather than against a
      // hypothetical domain, because the helper filters the real
      // ALL_PERMISSIONS and cannot invent a permission that does not exist. The
      // property is the one that matters: add `widgets.read` to PERMISSIONS, and
      // this test now requires it to appear here — which is the anti-drift
      // claim a hand-written list could not make.
      const derived = new Set(readPermissionsIn(RECORD_DOMAINS));
      for (const permission of ALL_PERMISSIONS) {
        if (!permission.endsWith(".read")) continue;
        const domain = permission.slice(0, permission.indexOf("."));
        const inScope = RECORD_DOMAINS.includes(domain);

        expect(
          derived.has(permission),
          `${permission} should ${inScope ? "" : "not "}be derived`,
        ).toBe(inScope);
      }
    });

    it("every read permission in a record domain is in VIEWER", () => {
      for (const permission of readPermissionsIn(RECORD_DOMAINS)) {
        expect(systemRoleHas("VIEWER", permission)).toBe(true);
      }
    });

    it("a new read permission in a record domain would reach VIEWER", () => {
      // Same property, from the role's side: VIEWER's set is exactly the
      // catalogue's reads minus the owner-only ones, so it cannot lag behind.
      const viewer = holds("VIEWER");
      const expected = ALL_PERMISSIONS.filter(
        (permission) =>
          permission.endsWith(".read") && !permission.startsWith("auditLogs."),
      );

      expect(viewer.size).toBe(expected.length);
    });

    it("WRITABLE_RECORD_DOMAINS is a subset of RECORD_DOMAINS", () => {
      for (const domain of WRITABLE_RECORD_DOMAINS) {
        expect(RECORD_DOMAINS).toContain(domain);
      }
    });
  });
});
