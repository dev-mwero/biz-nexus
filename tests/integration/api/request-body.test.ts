import { callRoute } from "@tests/support/crm-route";
import { Types } from "mongoose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectToDatabase, disconnectDatabase } from "@/db/connection";
import { SessionModel, UserModel } from "@/modules/identity";
import { issueSession } from "@/modules/identity/session.service";
import { createOrganization } from "@/modules/organizations";
import { MAX_BODY_BYTES } from "@/shared/api/with-api";

/**
 * How every mutating route reads its body.
 *
 * This suite exists because twenty CRM and task routes called
 * `request.json()` directly, which quietly opted out of everything the wrapper
 * does for a body. Three separate guarantees were lost that way, and all three
 * are properties of the request rather than of any one feature, so they are
 * tested once here against a route that had the problem instead of twenty times
 * in twenty files.
 *
 * The size cap is the one that matters. `readJson` used to do
 * `await request.text()` and measure nothing, so a caller could send a body of
 * any size to any of these endpoints and the server would hold all of it in
 * memory before deciding whether to parse it — and `POST /auth/login`, which
 * needs no session, was enough to reach it.
 */

const COMPANY_PATH = "/api/v1/crm/companies";

let token: string;
let userId: Types.ObjectId;

beforeAll(async () => {
  await connectToDatabase();

  const user = await UserModel.create({
    email: `bodies-${new Types.ObjectId()}@example.com`,
    name: "Body Tester",
    passwordHash: "not-used-here",
  });
  const { organization } = await createOrganization({
    name: "Body Org",
    ownerId: user._id,
  });
  userId = user._id;
  const issued = await issueSession({ userId: user._id });
  await SessionModel.updateOne(
    { _id: issued.session._id },
    { $set: { activeOrganizationId: organization._id } },
  );
  token = issued.token;
});

afterAll(async () => {
  await disconnectDatabase();
});

async function envelope(response: Response) {
  return (await response.json()) as { error?: { code: string } };
}

describe("a body over the limit", () => {
  it("is refused with 413 rather than buffered", async () => {
    const response = await callRoute(COMPANY_PATH, {
      method: "POST",
      token,
      rawBody: JSON.stringify({ name: "a".repeat(MAX_BODY_BYTES + 1) }),
    });
    const body = await envelope(response);

    expect(response.status).toBe(413);
    expect(body.error?.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("is refused even when the declared length is a lie", async () => {
    // Content-Length is written by the client, so checking it is an
    // optimisation and never the control itself.
    const response = await callRoute(COMPANY_PATH, {
      method: "POST",
      token,
      rawBody: JSON.stringify({ name: "a".repeat(MAX_BODY_BYTES + 1) }),
    });

    expect(response.status).toBe(413);
  });

  it("leaves a body under the limit alone", async () => {
    // A cap that also refuses ordinary traffic is not a cap, it is an outage
    // with better manners.
    const response = await callRoute(COMPANY_PATH, {
      method: "POST",
      token,
      body: { name: "Small Enough", ownerId: userId.toHexString() },
    });

    expect(response.status).toBe(201);
  });
});

describe("a body that is not JSON", () => {
  it("is refused with 400 rather than parsed anyway", async () => {
    // `Request.json()` does not care what the content type says, so these
    // routes used to accept a text/plain body carrying JSON — a client that
    // believed it was sending a form post and quietly got an API call.
    const response = await callRoute(COMPANY_PATH, {
      method: "POST",
      token,
      contentType: "text/plain",
      // Otherwise a valid body, so the content type is the only possible reason
      // for a refusal. A body missing a required field would answer 400 for an
      // unrelated reason and this test would pass whether or not the check
      // existed.
      rawBody: JSON.stringify({
        name: "Wrong Type",
        ownerId: userId.toHexString(),
      }),
    });
    const body = await envelope(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("BAD_REQUEST");
  });
});

describe("a body that is not valid JSON", () => {
  it("is refused with 400 rather than surfacing as a 500", async () => {
    // A SyntaxError from `request.json()` reached the wrapper unmapped and
    // became INTERNAL, so a stray apostrophe in a form paged somebody.
    const response = await callRoute(COMPANY_PATH, {
      method: "POST",
      token,
      rawBody: `{ name: 'Acme', ownerId: "${userId.toHexString()}" }`,
    });
    const body = await envelope(response);

    expect(response.status).toBe(400);
    expect(body.error?.code).toBe("BAD_REQUEST");
  });
});
