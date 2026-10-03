import { passwordHash } from "@tests/support/auth-contract";
import { memberWithout } from "@tests/support/crm-permission-member";
import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET as stream } from "@/app/api/v1/notifications/stream/route";
import { connectToDatabase } from "@/db/connection";
import { SessionModel, UserModel } from "@/modules/identity";
import {
  createOrganization,
  MembershipModel,
  OrganizationModel,
  RoleModel,
} from "@/modules/organizations";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * The SSE endpoint has to gate on `notifications.read` like the REST endpoints
 * beside it, not merely on having an active organisation.
 *
 * `requireOrg` proves the caller belongs to a tenant; it says nothing about
 * whether they are allowed to read notifications. The stream emits an unread
 * count derived from the caller's own rows, so the data exposure is small, but
 * the endpoint was the only notifications route whose contract in docs/API.md
 * (`notifications.read`) did not match the guard.
 *
 * Only the refusal path is exercised: a permitted request opens a change stream
 * and would keep the test open.
 */

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    RoleModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
  ]);
});

async function requestStream(token: string): Promise<Response> {
  const request = new Request(
    "http://localhost:3000/api/v1/notifications/stream",
    {
      method: "GET",
      headers: {
        origin: "http://localhost:3000",
        cookie: `${SESSION_COOKIE}=${token}`,
      },
    },
  );
  return stream(request);
}

describe("GET /api/v1/notifications/stream", () => {
  let organizationId: Types.ObjectId;

  beforeEach(async () => {
    const user = await UserModel.create({
      email: `stream-owner-${new Types.ObjectId()}@example.com`,
      name: "Owner",
      passwordHash: await passwordHash(),
    });
    const { organization } = await createOrganization({
      name: "Stream Org",
      ownerId: user._id,
    });
    organizationId = organization._id;
  });

  it("returns 403 when the caller lacks notifications.read", async () => {
    const { token } = await memberWithout({
      organizationId,
      roleKey: "MEMBER",
      without: "notifications.read",
    });

    const res = await requestStream(token);
    expect(res.status).toBe(403);
  });

  it("returns 401 without a session", async () => {
    const request = new Request(
      "http://localhost:3000/api/v1/notifications/stream",
      { method: "GET", headers: { origin: "http://localhost:3000" } },
    );
    const res = await stream(request);
    expect(res.status).toBe(401);
  });
});
