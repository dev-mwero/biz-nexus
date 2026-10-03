import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { type User, UserModel } from "@/modules/identity";
import { hashPassword, hashToken } from "@/modules/identity/password";
import {
  acceptInvitation,
  changeMemberRole,
  createOrganization,
  InvitationError,
  InvitationModel,
  inviteMember,
  listInvitations,
  listMembers,
  MembershipError,
  MembershipModel,
  type Organization,
  OrganizationModel,
  RoleModel,
  removeMember,
  revokeInvitation,
  setMembershipStatus,
} from "@/modules/organizations";
import { type AppError, toErrorPayload } from "@/shared/errors/app-error";

/**
 * Invitations and membership changes.
 *
 * The token is the whole security surface, so the cases that matter are the
 * ones a link can be reused, expired, or replayed: a forwarded email, a stale
 * link in a shared thread, a revoked invitation, a role that changed hands
 * while the email was in flight.
 */

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
    RoleModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    InvitationModel.deleteMany({}),
  ]);
});

const PASSWORD = "correct horse battery staple";

async function makeUser(email?: string): Promise<User> {
  return UserModel.create({
    email: email ?? `user-${new Types.ObjectId()}@example.com`,
    name: "Someone",
    passwordHash: await hashPassword(PASSWORD),
  });
}

interface Fixture {
  owner: User;
  organization: Organization;
  roleIds: Record<string, Types.ObjectId>;
}

async function withOrg(): Promise<Fixture> {
  const owner = await makeUser();
  const { organization } = await createOrganization({
    name: "Acme",
    ownerId: owner._id,
  });
  const roles = await RoleModel.find({ organizationId: organization._id });
  const roleIds: Record<string, Types.ObjectId> = {};
  for (const role of roles) roleIds[role.key] = role._id;

  return { owner, organization, roleIds };
}

describe("inviteMember", () => {
  it("stores only the hash of the token", async () => {
    const { owner, organization, roleIds } = await withOrg();

    const { token, invitation } = await inviteMember({
      organizationId: organization._id,
      email: "new@example.com",
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });

    expect(invitation.tokenHash).toBe(hashToken(token));
    expect(invitation.tokenHash).not.toBe(token);
    // And the raw token appears nowhere in the document.
    expect(JSON.stringify(invitation)).not.toContain(token);
  });

  it("keeps the token digest out of anything serialised", async () => {
    const { owner, organization, roleIds } = await withOrg();

    const { token, invitation } = await inviteMember({
      organizationId: organization._id,
      email: "new@example.com",
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });

    // The digest is the lookup key `acceptInvitation` resolves a token with, so
    // a response carrying it would be a response carrying the ability to accept
    // every outstanding invitation. Asserted on the digest, not the raw token:
    // the raw token is already covered above, and only one of the two is the
    // thing the redaction exists for.
    //
    // Through `JSON.stringify` rather than `invitation.toJSON()`. The service
    // returns the document it created but types it as the lean `Invitation`
    // interface, so the transform is not visible in the type — only in what
    // reaches a socket, which is also the thing being asserted.
    expect(JSON.stringify(invitation)).not.toContain(token);
    expect(JSON.stringify(invitation)).not.toContain(hashToken(token));

    // On a document read back from the database too, not only on the one the
    // insert returned — the transform belongs to the schema, not to a call site.
    const stored = await InvitationModel.findById(invitation._id);
    expect(JSON.stringify(stored)).not.toContain(hashToken(token));
    expect(
      JSON.stringify(await listInvitations(organization._id)),
    ).not.toContain(hashToken(token));

    // The field itself is untouched, so acceptance still resolves by hash.
    expect(stored?.tokenHash).toBe(hashToken(token));
  });

  it("issues a distinct token every time", async () => {
    const { owner, organization, roleIds } = await withOrg();

    const first = await inviteMember({
      organizationId: organization._id,
      email: "a@example.com",
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    const second = await inviteMember({
      organizationId: organization._id,
      email: "b@example.com",
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });

    expect(first.token).not.toBe(second.token);
  });

  it("lowercases and trims the address", async () => {
    const { owner, organization, roleIds } = await withOrg();

    const { invitation } = await inviteMember({
      organizationId: organization._id,
      email: "  MiXeD@Example.COM ",
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });

    expect(invitation.email).toBe("mixed@example.com");
  });

  it("grants the default role when none is named", async () => {
    const { owner, organization } = await withOrg();

    const { invitation } = await inviteMember({
      organizationId: organization._id,
      email: "new@example.com",
      invitedBy: owner._id,
    });

    const role = await RoleModel.findById(invitation.roleId);
    expect(role?.key).toBe("MEMBER");
  });

  it("expires after the documented TTL", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const now = new Date("2026-01-01T00:00:00.000Z");

    const { invitation } = await inviteMember({
      organizationId: organization._id,
      email: "new@example.com",
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
      now,
    });

    const days = (invitation.expiresAt.getTime() - now.getTime()) / 86_400_000;
    expect(days).toBe(7);
  });

  it("refuses a role from another organisation", async () => {
    // The cross-collection integrity rule. MongoDB has no foreign keys, so this
    // write would succeed without the check and the invitee would join with
    // another tenant's role.
    const { owner, organization } = await withOrg();
    const other = await withOrg();
    const foreignRole = await RoleModel.findById(other.roleIds.ADMIN);
    if (!foreignRole) throw new Error("missing fixture role");

    await expect(
      inviteMember({
        organizationId: organization._id,
        email: "new@example.com",
        roleId: foreignRole._id,
        invitedBy: owner._id,
      }),
    ).rejects.toBeInstanceOf(InvitationError);
  });

  it("refuses to hand out the OWNER role", async () => {
    // The escalation this closes. An ADMIN holds `invitations.create` and is
    // denied `organization.transferOwnership` by the system matrix, so an
    // invitation that can name OWNER is a way around the one permission that
    // role was withheld for. Two accounts are enough: invite a colleague you
    // control as OWNER, then accept the link from the second one.
    const { owner, organization, roleIds } = await withOrg();

    await expect(
      inviteMember({
        organizationId: organization._id,
        email: "successor@example.com",
        roleId: roleIds.OWNER,
        invitedBy: owner._id,
      }),
    ).rejects.toThrow(/transfer/i);
  });

  it("writes no invitation when the role was refused", async () => {
    // The row the throw is supposed to have prevented. A refusal that still left
    // an invitation behind would be a live link sitting in the collection,
    // waiting for the acceptance-side check to also be wrong.
    const { owner, organization, roleIds } = await withOrg();

    await expect(
      inviteMember({
        organizationId: organization._id,
        email: "successor@example.com",
        roleId: roleIds.OWNER,
        invitedBy: owner._id,
      }),
    ).rejects.toThrow();

    expect(await InvitationModel.countDocuments({})).toBe(0);
  });

  it("refuses to invite somebody who is already a member", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const member = await makeUser("member@example.com");
    await acceptInvitation(
      (
        await inviteMember({
          organizationId: organization._id,
          email: member.email,
          roleId: roleIds.MEMBER,
          invitedBy: owner._id,
        })
      ).token,
      member._id,
    );

    await expect(
      inviteMember({
        organizationId: organization._id,
        email: "MEMBER@example.com",
        roleId: roleIds.ADMIN,
        invitedBy: owner._id,
      }),
    ).rejects.toThrow(/already a member/);
  });

  it("refuses a blank address", async () => {
    const { owner, organization } = await withOrg();

    await expect(
      inviteMember({
        organizationId: organization._id,
        email: "   ",
        invitedBy: owner._id,
      }),
    ).rejects.toThrow();
  });
});

describe("resending", () => {
  it("replaces the open invitation and invalidates the old token", async () => {
    // The whole point of resend. If the first link kept working, somebody who
    // asked to be re-invited would have two live links, and the one in the
    // first email would be the one a leaver still has.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");

    const first = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    const second = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });

    expect(second.replaced).toBe(true);
    expect(second.token).not.toBe(first.token);
    await expect(acceptInvitation(first.token, invitee._id)).rejects.toThrow();
    await expect(
      acceptInvitation(second.token, invitee._id),
    ).resolves.toBeDefined();
  });

  it("can invite the same address again after the invitation was revoked", async () => {
    // A revoked invitation still has acceptedAt: null, so it still occupies the
    // {organizationId, email} partial-unique slot until the TTL sweeps it seven
    // days later. The service has to reclaim the slot explicitly or every
    // revoke is a seven-day ban on re-inviting that person.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");

    const first = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    await revokeInvitation(organization._id, first.invitation._id, owner._id);

    await expect(
      inviteMember({
        organizationId: organization._id,
        email: invitee.email,
        roleId: roleIds.VIEWER,
        invitedBy: owner._id,
      }),
    ).resolves.toBeDefined();
  });

  it("keeps at most one open invitation per address", async () => {
    const { owner, organization, roleIds } = await withOrg();

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await inviteMember({
        organizationId: organization._id,
        email: "new@example.com",
        roleId: roleIds.MEMBER,
        invitedBy: owner._id,
      });
    }

    expect(
      await InvitationModel.countDocuments({
        organizationId: organization._id,
        email: "new@example.com",
        acceptedAt: null,
      }),
    ).toBe(1);
  });

  it("can invite the same address again after acceptance", async () => {
    // The partial index exists for this. A plain unique index would make an
    // address permanently single-use per organisation.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");

    const first = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    await acceptInvitation(first.token, invitee._id);

    await removeMember(
      organization._id,
      (await MembershipModel.findOne({ userId: invitee._id }))
        ?._id as Types.ObjectId,
      owner._id,
    );

    await expect(
      inviteMember({
        organizationId: organization._id,
        email: invitee.email,
        roleId: roleIds.VIEWER,
        invitedBy: owner._id,
      }),
    ).resolves.toBeDefined();
  });
});

describe("acceptInvitation", () => {
  it("creates an active membership", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");

    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.VIEWER,
      invitedBy: owner._id,
    });

    const { membership, organization: joined } = await acceptInvitation(
      token,
      invitee._id,
    );

    expect(membership.status).toBe("ACTIVE");
    expect(membership.userId).toEqual(invitee._id);
    expect(membership.organizationId).toEqual(organization._id);
    expect(membership.roleId).toEqual(roleIds.VIEWER);
    expect(membership.joinedAt).toBeInstanceOf(Date);
    expect(joined._id).toEqual(organization._id);
  });

  it("rejects an expired token — the acceptance criterion", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");

    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
      now: new Date("2026-01-01T00:00:00.000Z"),
    });

    await expect(
      acceptInvitation(
        token,
        invitee._id,
        new Date("2026-01-09T00:00:00.000Z"),
      ),
    ).rejects.toThrow(/expired/i);
  });

  it("rejects a reused token — the acceptance criterion", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");

    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });

    await acceptInvitation(token, invitee._id);

    // The link was forwarded, or opened twice. Either way it works once.
    await expect(acceptInvitation(token, invitee._id)).rejects.toThrow();
  });

  it("rejects a revoked token", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");

    const { token, invitation } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    await revokeInvitation(organization._id, invitation._id, owner._id);

    await expect(acceptInvitation(token, invitee._id)).rejects.toThrow(
      /revoked/i,
    );
  });

  it("rejects an unknown token", async () => {
    const invitee = await makeUser("new@example.com");

    await expect(
      acceptInvitation("not-a-real-token", invitee._id),
    ).rejects.toThrow(/not valid/i);
  });

  it("grants exactly one membership when two acceptances race", async () => {
    // The single-use guarantee is one conditional update, so this is a property
    // of the write rather than a promise about timing. Two callers, two
    // attempts, one winner.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");

    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });

    const results = await Promise.allSettled([
      acceptInvitation(token, invitee._id),
      acceptInvitation(token, invitee._id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    expect(fulfilled).toHaveLength(1);
    expect(
      await MembershipModel.countDocuments({
        organizationId: organization._id,
        userId: invitee._id,
      }),
    ).toBe(1);
  });

  it("rejects a token whose role was reassigned in the meantime", async () => {
    // An invitation is a stored promise. If the role it names has since been
    // deleted, honouring it would grant a role that no longer exists, and the
    // check at invite time cannot help - the email may have been in flight for
    // seven days.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");

    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });

    await RoleModel.updateOne(
      { _id: roleIds.MEMBER },
      { $set: { deletedAt: new Date() } },
    );

    await expect(acceptInvitation(token, invitee._id)).rejects.toThrow();
  });

  it("rejects an OWNER invitation that reached the database by another route", async () => {
    // The acceptance-side half of the OWNER refusal. `inviteMember` no longer
    // writes one, but the row is the thing that grants the role, and the row can
    // arrive from somewhere the service does not control: a deploy predating the
    // fix, a hand-written insert, a future caller that forgets the rule. The
    // check at the door is the primary defence; this one is what makes the
    // invariant hold rather than merely being enforced on the usual path.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("successor@example.com");

    // Written past `inviteMember` on purpose. Going through the service would
    // test the door again, not the window.
    const token = "a-token-this-test-generated";
    await InvitationModel.create({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.OWNER,
      tokenHash: hashToken(token),
      invitedBy: owner._id,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      acceptedAt: null,
      revokedAt: null,
    } as never);

    await expect(acceptInvitation(token, invitee._id)).rejects.toThrow(
      /transfer/i,
    );
    expect(
      await MembershipModel.countDocuments({
        organizationId: organization._id,
        userId: invitee._id,
      }),
    ).toBe(0);
  });

  it("restores a removed member rather than duplicating them", async () => {
    // The {organizationId, userId} index is not partial, so a soft-deleted
    // membership still blocks a fresh insert. Restoring is the only way back.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");

    const first = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    const { membership } = await acceptInvitation(first.token, invitee._id);
    await removeMember(organization._id, membership._id, owner._id);

    const second = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.VIEWER,
      invitedBy: owner._id,
    });
    const rejoined = await acceptInvitation(second.token, invitee._id);

    expect(rejoined.membership._id).toEqual(membership._id);
    expect(rejoined.membership.roleId).toEqual(roleIds.VIEWER);
    expect(
      await MembershipModel.countDocuments({
        organizationId: organization._id,
        userId: invitee._id,
      }),
    ).toBe(1);
  });

  it("refuses an account that does not exist", async () => {
    // Nothing checked this, so any id produced a membership pointing at an
    // account that was never created - and every later read of that membership
    // had to cope with a user that was not there.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser();
    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.VIEWER,
      invitedBy: owner._id,
    });

    const ghost = new Types.ObjectId();

    await expect(acceptInvitation(token, ghost)).rejects.toMatchObject({
      code: "RECORD_NOT_FOUND",
    });
  });

  it("writes no membership for an account that does not exist", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser();
    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.VIEWER,
      invitedBy: owner._id,
    });
    const ghost = new Types.ObjectId();

    await acceptInvitation(token, ghost).catch(() => {});

    expect(await MembershipModel.countDocuments({ userId: ghost })).toBe(0);
  });

  it("refuses a suspended account", async () => {
    // A suspended user cannot sign in, so accepting an invitation would hand
    // them an ACTIVE membership and route around the suspension.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser();
    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.VIEWER,
      invitedBy: owner._id,
    });
    await UserModel.updateOne(
      { _id: invitee._id },
      { $set: { status: "SUSPENDED" } },
    );

    await expect(acceptInvitation(token, invitee._id)).rejects.toMatchObject({
      code: "RECORD_NOT_FOUND",
    });
  });

  it("does not answer differently for suspended than for missing", async () => {
    // The difference between "no such user" and "that user is suspended" is an
    // oracle over user ids, and this function's contract is that it never
    // becomes one.
    const { owner, organization, roleIds } = await withOrg();

    const tokenFor = async (email: string) => {
      const { token } = await inviteMember({
        organizationId: organization._id,
        email,
        roleId: roleIds.VIEWER,
        invitedBy: owner._id,
      });
      return token;
    };

    const ghostToken = await tokenFor("ghost-target@example.com");
    const suspended = await makeUser("suspended-target@example.com");
    const suspendedToken = await tokenFor("suspended-target@example.com");
    await UserModel.updateOne(
      { _id: suspended._id },
      { $set: { status: "SUSPENDED" } },
    );

    const missing = await acceptInvitation(
      ghostToken,
      new Types.ObjectId(),
    ).catch((error: unknown) => error);
    const suspendedError = await acceptInvitation(
      suspendedToken,
      suspended._id,
    ).catch((error: unknown) => error);

    expect((missing as AppError).code).toBe((suspendedError as AppError).code);
    expect((missing as AppError).message).toBe(
      (suspendedError as AppError).message,
    );
    expect((missing as AppError).status).toBe(
      (suspendedError as AppError).status,
    );
  });

  it("keeps the reason out of the response", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("suspended-leak@example.com");
    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.VIEWER,
      invitedBy: owner._id,
    });
    await UserModel.updateOne(
      { _id: invitee._id },
      { $set: { status: "SUSPENDED" } },
    );

    const error = (await acceptInvitation(token, invitee._id).catch(
      (caught: unknown) => caught,
    )) as AppError;

    // A log needs the reason. A response must not: "suspended" tells a caller
    // holding an invite token something about the account behind it.
    expect(error.internal).toMatch(/suspended/);
    expect(JSON.stringify(toErrorPayload(error))).not.toMatch(/suspended/i);
    expect(JSON.stringify(toErrorPayload(error))).not.toContain(
      invitee._id.toString(),
    );
  });

  it("leaves the invitation usable after a refused account", async () => {
    // The account check is not part of consuming the token, so a suspended user
    // who is reinstated can still use the link they were sent.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser();
    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.VIEWER,
      invitedBy: owner._id,
    });
    await UserModel.updateOne(
      { _id: invitee._id },
      { $set: { status: "SUSPENDED" } },
    );
    await acceptInvitation(token, invitee._id).catch(() => {});

    await UserModel.updateOne(
      { _id: invitee._id },
      { $set: { status: "ACTIVE" } },
    );

    const { membership } = await acceptInvitation(token, invitee._id);
    expect(membership.status).toBe("ACTIVE");
  });
});

describe("revokeInvitation", () => {
  it("will not revoke an invitation from another organisation", async () => {
    const { owner, organization } = await withOrg();
    const other = await withOrg();

    const { invitation } = await inviteMember({
      organizationId: other.organization._id,
      email: "new@example.com",
      roleId: other.roleIds.MEMBER,
      invitedBy: other.owner._id,
    });

    expect(
      await revokeInvitation(organization._id, invitation._id, owner._id),
    ).toBe(false);
  });

  it("will not revoke an already-accepted invitation", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");
    const { token, invitation } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    await acceptInvitation(token, invitee._id);

    expect(
      await revokeInvitation(organization._id, invitation._id, owner._id),
    ).toBe(false);
  });
});

describe("listInvitations", () => {
  it("returns only this organisation's open, unexpired invitations", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const other = await withOrg();

    await inviteMember({
      organizationId: organization._id,
      email: "mine@example.com",
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    await inviteMember({
      organizationId: other.organization._id,
      email: "theirs@example.com",
      roleId: other.roleIds.MEMBER,
      invitedBy: other.owner._id,
    });

    const mine = await listInvitations(organization._id);
    expect(mine).toHaveLength(1);
    expect(mine[0]?.email).toBe("mine@example.com");
  });

  it("hides expired invitations unless asked", async () => {
    const { owner, organization, roleIds } = await withOrg();
    await inviteMember({
      organizationId: organization._id,
      email: "stale@example.com",
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
      now: new Date(Date.now() - 30 * 86_400_000),
    });

    expect(await listInvitations(organization._id)).toHaveLength(0);
    expect(
      await listInvitations(organization._id, { includeExpired: true }),
    ).toHaveLength(1);
  });
});

describe("membership changes", () => {
  it("changes a role", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");
    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    const { membership } = await acceptInvitation(token, invitee._id);

    const updated = await changeMemberRole(
      organization._id,
      membership._id,
      roleIds.ADMIN,
      owner._id,
    );

    expect(updated.roleId).toEqual(roleIds.ADMIN);
  });

  it("refuses a role from another organisation", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const other = await withOrg();
    const invitee = await makeUser("new@example.com");
    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    const { membership } = await acceptInvitation(token, invitee._id);
    const foreign = await RoleModel.findById(other.roleIds.ADMIN);
    if (!foreign) throw new Error("missing fixture role");

    await expect(
      changeMemberRole(
        organization._id,
        membership._id,
        foreign._id,
        owner._id,
      ),
    ).rejects.toBeInstanceOf(MembershipError);
  });

  it("refuses to grant OWNER as though it were a role change", async () => {
    // Ownership transfer is its own operation with its own permission and its
    // own confirmation. Making it a role edit is how an admin silently creates
    // a second owner.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");
    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    const { membership } = await acceptInvitation(token, invitee._id);

    await expect(
      changeMemberRole(
        organization._id,
        membership._id,
        roleIds.OWNER,
        owner._id,
      ),
    ).rejects.toThrow(/transfer/i);
  });

  it("will not act on a membership from another organisation", async () => {
    const { owner, organization } = await withOrg();
    const other = await withOrg();
    const foreignMembership = await MembershipModel.findOne({
      organizationId: other.organization._id,
    });
    if (!foreignMembership) throw new Error("missing fixture membership");

    await expect(
      changeMemberRole(
        organization._id,
        foreignMembership._id,
        other.roleIds.ADMIN,
        owner._id,
      ),
    ).rejects.toBeInstanceOf(MembershipError);
  });

  it("refuses to suspend the only active owner", async () => {
    const { owner, organization } = await withOrg();
    const membership = await MembershipModel.findOne({
      organizationId: organization._id,
    });
    if (!membership) throw new Error("missing fixture membership");

    await expect(
      setMembershipStatus(
        organization._id,
        membership._id,
        "SUSPENDED",
        owner._id,
      ),
    ).rejects.toThrow(/only active owner/i);
  });

  it("refuses to remove the only active owner", async () => {
    const { owner, organization } = await withOrg();
    const membership = await MembershipModel.findOne({
      organizationId: organization._id,
    });
    if (!membership) throw new Error("missing fixture membership");

    await expect(
      removeMember(organization._id, membership._id, owner._id),
    ).rejects.toThrow(/only active owner/i);
  });

  it("suspends a member and restores them again", async () => {
    // Suspension is a status on a live row, not a deletion, so it is
    // reversible without a fresh invitation.
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");
    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    const { membership } = await acceptInvitation(token, invitee._id);

    const suspended = await setMembershipStatus(
      organization._id,
      membership._id,
      "SUSPENDED",
      owner._id,
    );
    expect(suspended.status).toBe("SUSPENDED");
    expect(suspended.deletedAt).toBeNull();
    expect(await listMembers(organization._id)).toHaveLength(1);

    const restored = await setMembershipStatus(
      organization._id,
      membership._id,
      "ACTIVE",
      owner._id,
    );
    expect(restored.status).toBe("ACTIVE");
    expect(
      await listMembers(organization._id, { includeSuspended: true }),
    ).toHaveLength(2);
  });

  it("soft-deletes on removal so the unique index still applies", async () => {
    const { owner, organization, roleIds } = await withOrg();
    const invitee = await makeUser("new@example.com");
    const { token } = await inviteMember({
      organizationId: organization._id,
      email: invitee.email,
      roleId: roleIds.MEMBER,
      invitedBy: owner._id,
    });
    const { membership } = await acceptInvitation(token, invitee._id);

    const removed = await removeMember(
      organization._id,
      membership._id,
      owner._id,
    );

    expect(removed.deletedAt).toBeInstanceOf(Date);
    // Still present, which is the point: the row holds the unique slot.
    expect(await MembershipModel.countDocuments({})).toBe(2);
    expect(await listMembers(organization._id)).toHaveLength(1);
  });
});
