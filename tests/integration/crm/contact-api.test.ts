import { passwordHash } from "@tests/support/auth-contract";
import { memberWithout } from "@tests/support/crm-permission-member";
import { callRoute } from "@tests/support/crm-route";
import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { CompanyModel } from "@/modules/crm/company.model";
import { ContactModel } from "@/modules/crm/contact.model";
import { ContactService } from "@/modules/crm/contact.service";
import { TagModel } from "@/modules/crm/tag.model";
import { SessionModel, UserModel } from "@/modules/identity";
import { issueSession } from "@/modules/identity/session.service";
import {
  createOrganization,
  MembershipModel,
  RoleModel,
} from "@/modules/organizations";

const CONTACT_STATUSES = ["LEAD", "PROSPECT", "CUSTOMER", "INACTIVE"] as const;

async function setupTestOrg() {
  const user = await UserModel.create({
    email: `test-${new Types.ObjectId()}@example.com`,
    name: "Test User",
    passwordHash: await passwordHash(),
  });
  const { organization } = await createOrganization({
    name: "Test Org",
    ownerId: user._id,
  });
  const { token, session } = await issueSession({ userId: user._id });
  await SessionModel.updateOne(
    { _id: session._id },
    { $set: { activeOrganizationId: organization._id } },
  );

  // Get the OWNER role for this org
  const role = await RoleModel.findOne({
    organizationId: organization._id,
    key: "OWNER",
  });

  return { user, organization, token, session, roleId: role!._id };
}

async function createContact(
  organizationId: Types.ObjectId,
  actorId: Types.ObjectId,
  overrides = {},
) {
  const service = new ContactService(organizationId, actorId);
  return service.create({
    organizationId,
    actorId,
    firstName: "John",
    lastName: "Doe",
    ownerId: actorId,
    // Unique per call. A shared `john@example.com` meant any test creating two
    // contacts hit the duplicate-primary-email guard, so every list test died
    // in its fixture rather than in an assertion about listing.
    emails: [
      {
        label: "Work",
        value: `john-${new Types.ObjectId()}@example.com`,
        isPrimary: true,
      },
    ],
    phones: [{ label: "Mobile", value: "+15551234567", isPrimary: true }],
    status: "LEAD",
    ...overrides,
  });
}

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    ContactModel.deleteMany({}),
    CompanyModel.deleteMany({}),
    TagModel.deleteMany({}),
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    RoleModel.deleteMany({}),
  ]);
});

describe("Contact API Integration", () => {
  let org: {
    user: any;
    organization: any;
    token: string;
    roleId: Types.ObjectId;
  };

  beforeEach(async () => {
    org = await setupTestOrg();
  });

  /**
   * `createRequest(method, path, body, token)` — the signature these suites
   * were written against, now dispatching to the real route handler instead of
   * a dev server on port 3000 that nothing starts.
   */
  const createRequest = (
    method: string,
    path: string,
    body?: unknown,
    token?: string,
  ) => callRoute(path, { method, body, token });

  describe("GET /api/v1/crm/contacts", () => {
    it("lists contacts with pagination", async () => {
      await createContact(org.organization._id, org.user._id, {
        firstName: "Alice",
        lastName: "A",
      });
      await createContact(org.organization._id, org.user._id, {
        firstName: "Bob",
        lastName: "B",
      });
      await createContact(org.organization._id, org.user._id, {
        firstName: "Carol",
        lastName: "C",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/contacts?page=1&pageSize=2",
        undefined,
        org.token,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data).toHaveLength(2);
      expect(data.meta.total).toBe(3);
      expect(data.meta.page).toBe(1);
      expect(data.meta.pageSize).toBe(2);
    });

    it("filters by status", async () => {
      await createContact(org.organization._id, org.user._id, {
        status: "LEAD",
      });
      await createContact(org.organization._id, org.user._id, {
        status: "PROSPECT",
      });
      await createContact(org.organization._id, org.user._id, {
        status: "CUSTOMER",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/contacts?status=PROSPECT",
        undefined,
        org.token,
      );
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].status).toBe("PROSPECT");
    });

    it("filters by q (text search)", async () => {
      await createContact(org.organization._id, org.user._id, {
        firstName: "Searchable",
        lastName: "Name",
      });
      await createContact(org.organization._id, org.user._id, {
        firstName: "Other",
        lastName: "Person",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/contacts?q=Searchable",
        undefined,
        org.token,
      );
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].firstName).toBe("Searchable");
    });

    it("sorts results", async () => {
      await createContact(org.organization._id, org.user._id, {
        firstName: "Zebra",
        lastName: "Last",
      });
      await createContact(org.organization._id, org.user._id, {
        firstName: "Alpha",
        lastName: "First",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/contacts?sort=firstName",
        undefined,
        org.token,
      );
      const data = await res.json();
      expect(data.data[0].firstName).toBe("Alpha");
      expect(data.data[1].firstName).toBe("Zebra");
    });

    it("returns 403 without contacts.read permission", async () => {
      // Create a viewer user
      const { token } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "VIEWER",
        without: "contacts.read",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/contacts",
        undefined,
        token,
      );
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/v1/crm/contacts", () => {
    it("creates a contact", async () => {
      const res = await createRequest(
        "POST",
        "/api/v1/crm/contacts",
        {
          firstName: "New",
          lastName: "Contact",
          ownerId: org.user._id.toString(),
          emails: [
            { label: "Work", value: "new@example.com", isPrimary: true },
          ],
          phones: [{ label: "Mobile", value: "+15551234567", isPrimary: true }],
          status: "LEAD",
        },
        org.token,
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.firstName).toBe("New");
      expect(data.data.lastName).toBe("Contact");
      expect(data.data.primaryEmail).toBe("new@example.com");
    });

    it("validates required fields", async () => {
      const res = await createRequest(
        "POST",
        "/api/v1/crm/contacts",
        { firstName: "Only" }, // missing lastName, ownerId
        org.token,
      );

      expect(res.status).toBe(400);
    });

    it("rejects duplicate primary email", async () => {
      // The address has to be in `emails`, not in a `primaryEmail` field: the
      // service reads the primary out of the array and `primaryEmail` is
      // denormalised on the way out. Setting it here created a contact with an
      // unrelated address, so the POST below was a genuine first use and the
      // 409 it was written to provoke never came.
      await createContact(org.organization._id, org.user._id, {
        emails: [{ label: "Work", value: "dup@example.com", isPrimary: true }],
      });

      const res = await createRequest(
        "POST",
        "/api/v1/crm/contacts",
        {
          firstName: "Second",
          lastName: "Contact",
          ownerId: org.user._id.toString(),
          emails: [
            { label: "Work", value: "dup@example.com", isPrimary: true },
          ],
        },
        org.token,
      );

      expect(res.status).toBe(409);
    });

    it("returns 403 without contacts.create permission", async () => {
      const { token, userId } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "VIEWER",
        without: "contacts.create",
      });

      const res = await createRequest(
        "POST",
        "/api/v1/crm/contacts",
        {
          firstName: "Test",
          lastName: "Contact",
          ownerId: userId.toString(),
        },
        token,
      );

      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/v1/crm/contacts/:id", () => {
    it("returns a contact by ID", async () => {
      const contact = await createContact(org.organization._id, org.user._id);

      const res = await createRequest(
        "GET",
        `/api/v1/crm/contacts/${contact._id}`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data._id).toBe(contact._id.toString());
      expect(data.data.firstName).toBe("John");
    });

    it("returns 404 for non-existent contact", async () => {
      const res = await createRequest(
        "GET",
        `/api/v1/crm/contacts/${new Types.ObjectId()}`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(404);
    });

    it("returns 403 without contacts.read permission", async () => {
      const contact = await createContact(org.organization._id, org.user._id);

      const { token } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "VIEWER",
        without: "contacts.read",
      });

      const res = await createRequest(
        "GET",
        `/api/v1/crm/contacts/${contact._id}`,
        undefined,
        token,
      );
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/v1/crm/contacts/:id", () => {
    it("updates a contact", async () => {
      const contact = await createContact(org.organization._id, org.user._id);

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/contacts/${contact._id}`,
        { firstName: "Updated", jobTitle: "Engineer" },
        org.token,
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.firstName).toBe("Updated");
      expect(data.data.jobTitle).toBe("Engineer");
    });

    it("validates company exists", async () => {
      const contact = await createContact(org.organization._id, org.user._id);
      const fakeCompanyId = new Types.ObjectId().toString();

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/contacts/${contact._id}`,
        { companyId: fakeCompanyId },
        org.token,
      );

      // 422, not 400: the body parsed — `companyId` is a well-formed ObjectId —
      // and it is the *record* it names that cannot be used. The catalogue draws
      // that line deliberately, and a caller can act on it: a 400 would say
      // the request was malformed, which it was not.
      expect(res.status).toBe(422);
      expect((await res.json()).error.code).toBe("VALIDATION_FAILED");
    });

    it("rejects duplicate primary email on update", async () => {
      await createContact(org.organization._id, org.user._id, {
        emails: [
          { label: "Work", value: "first@example.com", isPrimary: true },
        ],
      });
      const contact2 = await createContact(org.organization._id, org.user._id, {
        emails: [
          { label: "Work", value: "second@example.com", isPrimary: true },
        ],
      });

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/contacts/${contact2._id}`,
        {
          emails: [
            { label: "Work", value: "first@example.com", isPrimary: true },
          ],
        },
        org.token,
      );

      expect(res.status).toBe(409);
    });

    it("returns 403 without contacts.update permission", async () => {
      const contact = await createContact(org.organization._id, org.user._id);

      const { token } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "VIEWER",
        without: "contacts.update",
      });

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/contacts/${contact._id}`,
        { firstName: "Hack" },
        token,
      );
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/v1/crm/contacts/:id", () => {
    it("soft deletes a contact", async () => {
      const contact = await createContact(org.organization._id, org.user._id);

      const res = await createRequest(
        "DELETE",
        `/api/v1/crm/contacts/${contact._id}`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(204);

      const deleted = await ContactModel.findById(contact._id);
      expect(deleted?.deletedAt).not.toBeNull();
    });

    it("returns 404 for non-existent contact", async () => {
      const res = await createRequest(
        "DELETE",
        `/api/v1/crm/contacts/${new Types.ObjectId()}`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(404);
    });

    it("returns 403 without contacts.delete permission", async () => {
      const contact = await createContact(org.organization._id, org.user._id);

      // MEMBER has contacts.delete? Check permissions - MEMBER does have delete for contacts
      // So let's test with a custom role that has no delete
      const { token } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "MEMBER",
        without: "contacts.delete",
      });

      const res = await createRequest(
        "DELETE",
        `/api/v1/crm/contacts/${contact._id}`,
        undefined,
        token,
      );
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/v1/crm/contacts/:id/merge", () => {
    it("merges two contacts", async () => {
      const source = await createContact(org.organization._id, org.user._id, {
        firstName: "Source",
        emails: [
          { label: "Work", value: "source@example.com", isPrimary: true },
        ],
      });
      const target = await createContact(org.organization._id, org.user._id, {
        firstName: "Target",
        emails: [
          { label: "Work", value: "target@example.com", isPrimary: true },
        ],
      });

      const res = await createRequest(
        "POST",
        `/api/v1/crm/contacts/${source._id}/merge`,
        {
          sourceContactId: source._id.toString(),
          targetContactId: target._id.toString(),
        },
        org.token,
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.emails).toHaveLength(2);

      const deletedSource = await ContactModel.findById(source._id);
      expect(deletedSource?.mergedIntoId?.toString()).toBe(
        target._id.toString(),
      );
    });

    it("rejects merging a contact into itself", async () => {
      const contact = await createContact(org.organization._id, org.user._id);

      const res = await createRequest(
        "POST",
        `/api/v1/crm/contacts/${contact._id}/merge`,
        {
          sourceContactId: contact._id.toString(),
          targetContactId: contact._id.toString(),
        },
        org.token,
      );

      expect(res.status).toBe(400);
    });

    it("returns 403 without contacts.update permission", async () => {
      const source = await createContact(org.organization._id, org.user._id);
      const target = await createContact(org.organization._id, org.user._id);

      // Create a member without update permission
      const { token } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "MEMBER",
        without: "contacts.update",
      });

      const res = await createRequest(
        "POST",
        `/api/v1/crm/contacts/${source._id}/merge`,
        {
          sourceContactId: source._id.toString(),
          targetContactId: target._id.toString(),
        },
        token,
      );

      expect(res.status).toBe(403);
    });
  });
});
