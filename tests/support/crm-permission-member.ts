import { passwordHash } from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { SessionModel, UserModel } from "@/modules/identity";
import { issueSession } from "@/modules/identity/session.service";
import { MembershipModel, RoleModel } from "@/modules/organizations";

/**
 * A second user inside somebody else's organisation, holding a role that is
 * missing exactly one permission.
 *
 * The permission suites across this tree each hand-rolled a "viewer" or
 * "member" fixture, and every one of them did the same wrong thing: it created
 * a *new* organisation owned by the new user and switched to that. So the
 * request under test ran as a stranger in another tenant, and the answer was
 * the tenant-scoping answer — a 200 on an empty list, a 404 on a record in
 * another organisation — rather than the 403 the test was about. A 403 test
 * that asserts a 404 has happened by accident is worse than no test, because
 * deleting the endpoint's permission check would not make it fail.
 *
 * So the fixture has to put the user *in the organisation under test* and then
 * take one permission away. The role is copied first, never edited in place:
 * roles are per-organisation rows, and mutating the seeded one would leak the
 * stripped permission into every later test in the file.
 */
export interface MemberWithout {
  organizationId: Types.ObjectId;
  /** The system role to start from, e.g. `"MEMBER"`. */
  roleKey: string;
  /** The permission to remove, e.g. `"contacts.update"`. */
  without: string;
  /** Anything the new member's membership should start as. Defaults to active. */
  label?: string;
}

export interface MemberWithoutResult {
  userId: Types.ObjectId;
  token: string;
  roleId: Types.ObjectId;
}

/**
 * Create a user, a session pointed at `organizationId`, and a membership whose
 * role is the seeded one minus `without`.
 */
export async function memberWithout(
  input: MemberWithout,
): Promise<MemberWithoutResult> {
  const { organizationId, roleKey, without } = input;
  const suffix = new Types.ObjectId();

  const user = await UserModel.create({
    email: `${without.replace(/\./g, "-")}-${suffix}@example.com`,
    name: input.label ?? "Member",
    passwordHash: await passwordHash(),
  });

  const source = await RoleModel.findOne({
    organizationId,
    key: roleKey,
  });
  if (!source) {
    throw new Error(
      `no ${roleKey} role was provisioned for ${organizationId.toString()}`,
    );
  }

  const [role] = await RoleModel.create([
    {
      ...source.toObject(),
      _id: new Types.ObjectId(),
      key: `${source.key}-NO-${without.replace(/\./g, "-")}-${suffix}`,
      name: `${source.name} without ${without}`,
      isSystem: false,
      permissions: source.permissions.filter(
        (permission: string) => permission !== without,
      ),
      createdBy: user._id,
      updatedBy: user._id,
    },
  ]);

  const { token, session } = await issueSession({ userId: user._id });
  await SessionModel.updateOne(
    { _id: session._id },
    { $set: { activeOrganizationId: organizationId } },
  );
  await MembershipModel.create({
    organizationId,
    userId: user._id,
    roleId: role._id,
    status: "ACTIVE",
  });

  return { userId: user._id, token, roleId: role._id };
}
