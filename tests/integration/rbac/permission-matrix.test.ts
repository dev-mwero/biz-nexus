import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { SessionModel, UserModel } from "@/modules/identity";
import { hashPassword } from "@/modules/identity/password";
import { issueSession } from "@/modules/identity/session.service";
import {
  createOrganization,
  MembershipModel,
  OrganizationModel,
  RoleModel,
  type SystemRoleKey,
} from "@/modules/organizations";
import { SYSTEM_ROLE_PERMISSIONS } from "@/modules/rbac";
import { ALL_PERMISSIONS } from "@/modules/rbac/permissions";
import { type AuthError, createAuthGuards } from "@/shared/auth/dal";

/**
 * The full matrix, one cell at a time.
 *
 * `system-role-enforcement.test.ts` picks representative permissions per role
 * and proves the interesting cases. This one is the other kind of test: no
 * judgement about which permissions matter, just every cell of
 * 61 permissions x 4 roles checked in both directions.
 *
 * Both directions, because a one-directional sweep is a test that can pass for
 * the wrong reason. "Everything the matrix grants is allowed" passes even if the
 * guard ignores the matrix entirely and allows everything. Only the refusal half
 * pins the guard to the table.
 *
 * The refusal assertion is on the error code and status, not just "it threw".
 * A 401 would also be a rejection, and a 401 is the wrong answer: it tells the
 * caller to sign in again when they are already signed in, and the frontend
 * would bounce them to the login page for a permissions problem.
 */

const ROLE_KEYS = Object.keys(SYSTEM_ROLE_PERMISSIONS) as SystemRoleKey[];

interface Actor {
  token: string;
  guards: ReturnType<typeof createAuthGuards>;
  roleId: Types.ObjectId;
}

beforeAll(async () => {
  await connectToDatabase();
});

/**
 * Four real organisations, one per system role.
 *
 * Separate organisations rather than four memberships in one, so a leaked
 * pointer between actors cannot make one role's answer stand in for another's.
 */
const actors = new Map<SystemRoleKey, Actor>();

beforeAll(async () => {
  for (const key of ROLE_KEYS) {
    const user = await UserModel.create({
      email: `${key.toLowerCase()}-${new Types.ObjectId()}@example.com`,
      name: key,
      passwordHash: await hashPassword("correct horse battery staple"),
    });
    const { organization } = await createOrganization({
      name: `Acme ${key}`,
      ownerId: user._id,
    });
    const role = await RoleModel.findOne({
      organizationId: organization._id,
      key,
    });
    if (!role) throw new Error(`no ${key} role was provisioned`);

    const { token, session } = await issueSession({ userId: user._id });
    await SessionModel.updateOne(
      { _id: session._id },
      { $set: { activeOrganizationId: organization._id } },
    );
    await MembershipModel.updateOne(
      { organizationId: organization._id, userId: user._id },
      { $set: { roleId: role._id } },
    );

    actors.set(key, {
      token,
      guards: createAuthGuards(async () => token),
      roleId: role._id,
    });
  }
});

afterAll(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
    RoleModel.deleteMany({}),
    MembershipModel.deleteMany({}),
  ]);
});

describe.each(ROLE_KEYS)("every permission for %s", (key) => {
  const actor = () => {
    const found = actors.get(key);
    if (!found) throw new Error(`no actor for ${key}`);
    return found;
  };
  const granted = SYSTEM_ROLE_PERMISSIONS[key];
  const refused = ALL_PERMISSIONS.filter((p) => !granted.includes(p));

  it("is allowed exactly what the matrix grants", async () => {
    const refusals: string[] = [];
    for (const permission of granted) {
      try {
        await actor().guards.requirePermission(permission);
      } catch (error) {
        refusals.push(`${permission}: ${(error as Error).message}`);
      }
    }
    // Reported as one diff rather than a failure per cell, because 61 separate
    // failures naming 61 identical things hides the interesting case: the
    // permission that was granted and refused at once.
    expect(refusals).toEqual([]);
  });

  it(`refuses the ${refused.length} permissions the matrix withholds`, async () => {
    const wrongAnswer: string[] = [];
    for (const permission of refused) {
      try {
        await actor().guards.requirePermission(permission);
        wrongAnswer.push(permission);
      } catch (error) {
        if (
          (error as AuthError).code !== "INSUFFICIENT_PERMISSION" ||
          (error as AuthError).status !== 403
        ) {
          wrongAnswer.push(`${permission}: wrong error ${String(error)}`);
        }
      }
    }
    expect(wrongAnswer).toEqual([]);
  });

  it("covers the whole catalogue, with no permission untested", async () => {
    // Guards against a later permission being added to the catalogue without
    // any assertion covering it, which is the failure mode a hand-written sweep
    // accumulates silently.
    const checked = new Set([...granted, ...refused]);
    expect(checked.size).toBe(ALL_PERMISSIONS.length);
    expect([...checked].sort()).toEqual([...ALL_PERMISSIONS].sort());
  });
});

describe("the sweep is exhaustive", () => {
  it("refuses nothing to the owner", async () => {
    // The one role with no refusals. If the catalogue ever gains a permission
    // OWNER does not hold, this is where it should fail first.
    expect(SYSTEM_ROLE_PERMISSIONS.OWNER).toEqual(ALL_PERMISSIONS);
  });

  it("strictly widens from viewer to owner", async () => {
    // A role set that is not a subset of the one above it means somebody gained
    // a power nobody thought about granting them. Viewers are the floor.
    const { VIEWER, MEMBER, ADMIN, OWNER } = SYSTEM_ROLE_PERMISSIONS;
    for (const permission of ALL_PERMISSIONS) {
      if (VIEWER.includes(permission)) {
        expect(MEMBER.includes(permission)).toBe(true);
      }
      if (MEMBER.includes(permission)) {
        expect(ADMIN.includes(permission)).toBe(true);
      }
      if (ADMIN.includes(permission)) {
        expect(OWNER.includes(permission)).toBe(true);
      }
    }
  });

  it("withholds exactly the three organization lifecycle writes from an admin", async () => {
    // Pinned as a set rather than as a count. These three are what stand
    // between a compromised admin account and an organisation that no longer
    // belongs to its members, so a fourth one quietly appearing, or one of these
    // quietly reappearing, both have to be deliberate.
    const writes = ALL_PERMISSIONS.filter((p) => !p.endsWith(".read"));
    const withheld = writes.filter(
      (p) => !SYSTEM_ROLE_PERMISSIONS.ADMIN.includes(p),
    );
    expect(withheld.sort()).toEqual([
      "organization.delete",
      "organization.settings",
      "organization.transferOwnership",
    ]);
  });

  it("gives the viewer no writes at all", async () => {
    // Not "some writes": none. A read-only role that can also change one thing
    // is a role nobody will remember the exception for.
    expect(
      SYSTEM_ROLE_PERMISSIONS.VIEWER.filter((p) => !p.endsWith(".read")),
    ).toEqual([]);
  });

  it("curates exactly one read: the audit log", async () => {
    // The audit log is the one read that is not a read. It reports who changed
    // what, across the whole organisation, so every member seeing it is an
    // information disclosure rather than a convenience. It is also the only
    // read VIEWER is kept out of, which is worth stating outright: if a second
    // read is withheld from VIEWER, that is a decision, not a default.
    const reads = ALL_PERMISSIONS.filter((p) => p.endsWith(".read"));
    expect(
      reads.filter((p) => !SYSTEM_ROLE_PERMISSIONS.VIEWER.includes(p)),
    ).toEqual(["auditLogs.read"]);
  });
});
