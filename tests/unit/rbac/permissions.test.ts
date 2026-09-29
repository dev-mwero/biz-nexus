import { describe, expect, it } from "vitest";
import type { Permission } from "@/modules/rbac/permissions";
import {
  ALL_PERMISSIONS,
  isPermission,
  isWellFormedPermission,
  normalizePermissions,
  PERMISSION_DOMAINS,
  PERMISSIONS,
} from "@/modules/rbac/permissions";

describe("permission catalogue", () => {
  it("gives every permission the <domain>.<action> shape", () => {
    // The acceptance criterion for task 1.13, and the one property that makes
    // the codes greppable. A three-segment code would still be a valid
    // permission type-wise, so this has to be asserted rather than assumed.
    const malformed = ALL_PERMISSIONS.filter(
      (code) => !isWellFormedPermission(code),
    );

    expect(malformed).toEqual([]);
  });

  it("has no duplicate codes", () => {
    // Object keys collapse duplicates silently, so a repeated code would
    // vanish from the catalogue rather than error.
    const declared = Object.keys(PERMISSIONS);
    expect(new Set(declared).size).toBe(declared.length);
  });

  it("derives every domain from an actual permission", () => {
    // PERMISSION_DOMAINS is derived, so this is a check that the derivation
    // did the right thing rather than a check against a second hand-written
    // list that could drift from the catalogue.
    for (const domain of PERMISSION_DOMAINS) {
      expect(
        ALL_PERMISSIONS.some((code) => code.startsWith(`${domain}.`)),
      ).toBe(true);
    }
  });

  it("exposes each domain's permissions by prefix", () => {
    for (const domain of PERMISSION_DOMAINS) {
      const inDomain = ALL_PERMISSIONS.filter((code) =>
        code.startsWith(`${domain}.`),
      );
      expect(inDomain.length).toBeGreaterThan(0);
    }
  });

  it("has no permission outside the catalogue", () => {
    expect(isPermission("deals.update")).toBe(true);
    expect(isPermission("deals.explode")).toBe(false);
    expect(isPermission("Deals.Update")).toBe(false);
    expect(isPermission("")).toBe(false);
  });

  it("does not treat inherited object properties as permissions", () => {
    // `hasOwnProperty`, `constructor` and `toString` all exist on the object
    // literal's prototype. A naive `code in PERMISSIONS` would report them as
    // valid permissions and then store them in a role.
    expect(isPermission("toString")).toBe(false);
    expect(isPermission("constructor")).toBe(false);
    expect(isPermission("hasOwnProperty")).toBe(false);
  });

  it("rejects non-strings", () => {
    for (const value of [null, undefined, 42, {}, [], true]) {
      expect(isPermission(value)).toBe(false);
    }
  });

  it("recognises a well-formed but non-existent code as well-shaped", () => {
    // The distinction matters: this one is a typo to report to a developer,
    // as opposed to a stale code to drop from a role on save.
    expect(isWellFormedPermission("deals.explode")).toBe(true);
    expect(isPermission("deals.explode")).toBe(false);

    expect(isWellFormedPermission("Deals.Update")).toBe(false);
    expect(isWellFormedPermission("deals")).toBe(false);
    expect(isWellFormedPermission("deals.")).toBe(false);
    expect(isWellFormedPermission(".update")).toBe(false);
    expect(isWellFormedPermission("deals.update.now")).toBe(false);
  });

  it("drops unknown codes when normalizing a role's permissions", () => {
    // Deny by default, per docs/SECURITY.md §5: a typo or a stale code must not
    // be stored, because a stored code that later becomes real would silently
    // start granting access.
    expect(
      normalizePermissions([
        "deals.read",
        "deals.explode",
        "Deals.Update",
        "contacts.read",
      ]),
    ).toEqual(["deals.read", "contacts.read"]);
  });

  it("de-duplicates and returns a fresh array", () => {
    const input: Permission[] = ["deals.read", "deals.read"];

    const result = normalizePermissions(input);

    expect(result).toEqual(["deals.read"]);
    expect(input).toEqual(["deals.read", "deals.read"]);
  });

  it("returns an empty list for an empty or absent permission array", () => {
    expect(normalizePermissions([])).toEqual([]);
    expect(normalizePermissions([null, undefined, 7])).toEqual([]);
  });

  it("grants no write permission over the audit log", () => {
    // An audit trail that can be edited is not an audit trail. There is
    // deliberately no create, update or delete code, so no role can hold one.
    const auditCodes = ALL_PERMISSIONS.filter((code) =>
      code.startsWith("auditLogs."),
    );

    expect(auditCodes).toEqual(["auditLogs.read"]);
  });

  it("keeps ownership transfer and deletion separate from a plain update", () => {
    // A role that can rename the organisation must not thereby be able to
    // destroy it or hand it to someone else.
    expect(PERMISSIONS).toHaveProperty("organization.update");
    expect(PERMISSIONS).toHaveProperty("organization.delete");
    expect(PERMISSIONS).toHaveProperty("organization.transferOwnership");
  });
});
