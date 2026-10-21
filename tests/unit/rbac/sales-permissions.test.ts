import { describe, expect, it } from "vitest";
import {
  RECORD_DOMAINS,
  SYSTEM_ROLE_PERMISSIONS,
  systemRoleHas,
  WRITABLE_RECORD_DOMAINS,
} from "@/modules/rbac";
import { ALL_PERMISSIONS, type Permission } from "@/modules/rbac/permissions";
import {
  mergePermissions,
  STAGE2_SALES_PERMISSIONS,
} from "../../../scripts/backfill-sales-permissions.mjs";

/**
 * The Stage 2 permission shape, and the migration that gives it to existing
 * organisations.
 *
 * The role assertions are structural over the sales domains rather than a list
 * of examples. A new sales permission added later is covered by the same test,
 * and a permission misfiled into MEMBER fails without anyone remembering to
 * extend a spot check.
 */

const SALES_DOMAINS = ["products", "quotations", "salesOrders"] as const;

function domainOf(permission: Permission): string {
  return permission.slice(0, permission.indexOf("."));
}

function salesPermissions(): Permission[] {
  return ALL_PERMISSIONS.filter((permission) =>
    (SALES_DOMAINS as readonly string[]).includes(domainOf(permission)),
  );
}

function expectedFor(key: "VIEWER" | "MEMBER" | "ADMIN" | "OWNER") {
  const sales = salesPermissions();
  if (key === "VIEWER") {
    return sales.filter((permission) => permission.endsWith(".read"));
  }
  if (key === "MEMBER") {
    return sales.filter(
      (permission) =>
        permission.endsWith(".read") || domainOf(permission) !== "products",
    );
  }
  return sales;
}

describe("sales permissions in the role matrix", () => {
  it("gives VIEWER reads and no writes", () => {
    for (const permission of [
      "products.read",
      "quotations.read",
      "salesOrders.read",
    ] as const) {
      expect(systemRoleHas("VIEWER", permission), permission).toBe(true);
    }

    expect(
      (SYSTEM_ROLE_PERMISSIONS.VIEWER as readonly Permission[]).filter(
        (permission) =>
          (SALES_DOMAINS as readonly string[]).includes(domainOf(permission)) &&
          !permission.endsWith(".read"),
      ),
    ).toEqual([]);
  });

  it("lets MEMBER write quotations and orders but not products", () => {
    for (const permission of [
      "quotations.create",
      "quotations.update",
      "quotations.delete",
      "quotations.send",
      "quotations.accept",
      "quotations.convert",
      "salesOrders.update",
    ] as const) {
      expect(
        systemRoleHas("MEMBER", permission),
        `MEMBER is missing ${permission}`,
      ).toBe(true);
    }

    for (const permission of [
      "products.create",
      "products.update",
      "products.delete",
    ] as const) {
      expect(
        systemRoleHas("MEMBER", permission),
        `MEMBER holds ${permission}`,
      ).toBe(false);
    }
  });

  it("gives ADMIN and OWNER the whole sales surface", () => {
    for (const role of ["ADMIN", "OWNER"] as const) {
      for (const permission of salesPermissions()) {
        expect(
          systemRoleHas(role, permission),
          `${role} is missing ${permission}`,
        ).toBe(true);
      }
    }
  });

  it("classifies products as readable master data and the rest as writable records", () => {
    for (const domain of SALES_DOMAINS) {
      expect(RECORD_DOMAINS).toContain(domain);
    }
    expect(WRITABLE_RECORD_DOMAINS).toContain("quotations");
    expect(WRITABLE_RECORD_DOMAINS).toContain("salesOrders");
    expect(WRITABLE_RECORD_DOMAINS).not.toContain("products");
  });
});

describe("the backfill's hardcoded lists", () => {
  it("match the catalogue for every system role", () => {
    for (const key of ["VIEWER", "MEMBER", "ADMIN", "OWNER"] as const) {
      expect(
        [...STAGE2_SALES_PERMISSIONS[key]].sort(),
        `${key} list has drifted from the catalogue`,
      ).toEqual(expectedFor(key).sort());
    }
  });

  it("are a subset of the role's current permissions", () => {
    for (const key of ["VIEWER", "MEMBER", "ADMIN", "OWNER"] as const) {
      const current = new Set(
        SYSTEM_ROLE_PERMISSIONS[key] as readonly Permission[],
      );
      for (const permission of STAGE2_SALES_PERMISSIONS[key]) {
        expect(current.has(permission as Permission), permission).toBe(true);
      }
    }
  });
});

describe("mergePermissions", () => {
  it("is additive and preserves codes the catalogue no longer knows", () => {
    const current = ["deals.read", "legacy.write"];
    const merged = mergePermissions(current, STAGE2_SALES_PERMISSIONS.MEMBER);

    expect(merged).toEqual([
      "deals.read",
      "legacy.write",
      ...STAGE2_SALES_PERMISSIONS.MEMBER,
    ]);
    // The migration must not remove a code, even a stale one: grant-nothing is
    // safe, and deleting data with no rollback is not.
    expect(merged).toContain("legacy.write");
  });

  it("is idempotent", () => {
    const once = mergePermissions([], STAGE2_SALES_PERMISSIONS.MEMBER);
    const twice = mergePermissions(once, STAGE2_SALES_PERMISSIONS.MEMBER);

    expect(twice).toEqual(once);
  });

  it("tolerates a missing or malformed permissions field", () => {
    expect(mergePermissions(null, STAGE2_SALES_PERMISSIONS.VIEWER)).toEqual([
      ...STAGE2_SALES_PERMISSIONS.VIEWER,
    ]);
    expect(
      mergePermissions(undefined, STAGE2_SALES_PERMISSIONS.VIEWER),
    ).toEqual([...STAGE2_SALES_PERMISSIONS.VIEWER]);
  });
});
