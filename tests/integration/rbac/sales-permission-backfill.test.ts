import mongoose, { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { RoleModel } from "@/modules/organizations/role.model";
import { backfillSalesPermissions } from "../../../scripts/backfill-sales-permissions.mjs";

/**
 * The real backfill, against real role documents.
 *
 * The pure tests prove the merge is additive. This one proves the script
 * actually reaches the collection, updates only `permissions`, leaves custom
 * roles alone, and writes nothing on a second run.
 */

const ORG = new Types.ObjectId("64e0000000000000000000a1");
const ACTOR = new Types.ObjectId("64e0000000000000000000c3");

const silent = { info() {}, error() {} };

beforeEach(async () => {
  await connectToDatabase();
  await RoleModel.deleteMany({ organizationId: ORG });

  // Simulate an organisation provisioned before Stage 2: it has the CRM
  // permissions, not the sales ones.
  await RoleModel.create([
    {
      organizationId: ORG,
      key: "OWNER",
      name: "Owner",
      permissions: ["deals.read", "deals.create"],
      isSystem: true,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    },
    {
      organizationId: ORG,
      key: "ADMIN",
      name: "Admin",
      permissions: ["deals.read", "deals.create"],
      isSystem: true,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    },
    {
      organizationId: ORG,
      key: "MEMBER",
      name: "Member",
      permissions: ["deals.read", "deals.create"],
      isSystem: true,
      isDefault: true,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    },
    {
      organizationId: ORG,
      key: "VIEWER",
      name: "Viewer",
      permissions: ["deals.read"],
      isSystem: true,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    },
    {
      organizationId: ORG,
      key: "SALES_OPS",
      name: "Sales ops",
      permissions: ["deals.read"],
      isSystem: false,
      createdBy: ACTOR,
      updatedBy: ACTOR,
    },
  ]);
});

afterEach(async () => {
  await RoleModel.deleteMany({ organizationId: ORG });
});

describe("backfillSalesPermissions", () => {
  it("unions the sales permissions into existing system roles", async () => {
    await backfillSalesPermissions({ connection: mongoose, log: silent });

    const roles = await RoleModel.find({ organizationId: ORG });
    const byKey = new Map(roles.map((role) => [role.key, role]));

    expect(byKey.get("VIEWER")?.permissions).toEqual(
      expect.arrayContaining([
        "products.read",
        "quotations.read",
        "salesOrders.read",
      ]),
    );
    expect(byKey.get("VIEWER")?.permissions).not.toContain("quotations.create");

    expect(byKey.get("MEMBER")?.permissions).toEqual(
      expect.arrayContaining([
        "quotations.create",
        "quotations.convert",
        "salesOrders.update",
      ]),
    );
    expect(byKey.get("MEMBER")?.permissions).not.toContain("products.create");

    expect(byKey.get("ADMIN")?.permissions).toContain("products.update");
    expect(byKey.get("OWNER")?.permissions).toContain("products.delete");

    // Existing permissions survive.
    expect(byKey.get("OWNER")?.permissions).toContain("deals.create");
  });

  it("does not touch a custom role", async () => {
    await backfillSalesPermissions({ connection: mongoose, log: silent });

    const custom = await RoleModel.findOne({
      organizationId: ORG,
      key: "SALES_OPS",
    });

    expect(custom?.permissions).toEqual(["deals.read"]);
  });

  it("writes nothing on a second run", async () => {
    await backfillSalesPermissions({ connection: mongoose, log: silent });
    const afterFirst = await RoleModel.find({ organizationId: ORG }).lean();

    await backfillSalesPermissions({ connection: mongoose, log: silent });

    const afterSecond = await RoleModel.find({ organizationId: ORG }).lean();

    // Equality of the whole documents, permissions included, is the property:
    // a second run neither adds a duplicate nor rewrites an unrelated field.
    expect(afterSecond).toEqual(afterFirst);
  });
});
