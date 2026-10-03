import { passwordHash } from "@tests/support/auth-contract";
import { memberWithout } from "@tests/support/crm-permission-member";
import { callRoute } from "@tests/support/crm-route";
import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { CompanyModel, ContactModel } from "@/modules/crm";
import { CompanyService } from "@/modules/crm/company.service";
import { ContactService } from "@/modules/crm/contact.service";
import { TagModel } from "@/modules/crm/tag.model";
import { SessionModel, UserModel } from "@/modules/identity";
import { issueSession } from "@/modules/identity/session.service";
import {
  createOrganization,
  MembershipModel,
  RoleModel,
} from "@/modules/organizations";

const COMPANY_STATUSES = [
  "PROSPECT",
  "CUSTOMER",
  "PARTNER",
  "SUPPLIER",
  "INACTIVE",
] as const;

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

async function createCompany(
  organizationId: Types.ObjectId,
  actorId: Types.ObjectId,
  overrides = {},
) {
  const service = new CompanyService(organizationId, actorId);
  return service.create({
    organizationId,
    actorId,
    name: "Test Company",
    ownerId: actorId,
    status: "PROSPECT",
    ...overrides,
  });
}

async function createContact(
  organizationId: Types.ObjectId,
  actorId: Types.ObjectId,
  companyId?: Types.ObjectId,
  overrides = {},
) {
  const service = new ContactService(organizationId, actorId);
  return service.create({
    organizationId,
    actorId,
    firstName: "John",
    lastName: "Doe",
    ownerId: actorId,
    emails: [
      {
        label: "Work",
        value: `john-${new Types.ObjectId()}@example.com`,
        isPrimary: true,
      },
    ],
    phones: [{ label: "Mobile", value: "+15551234567", isPrimary: true }],
    status: "LEAD",
    companyId,
    ...overrides,
  });
}

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    CompanyModel.deleteMany({}),
    ContactModel.deleteMany({}),
    TagModel.deleteMany({}),
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    RoleModel.deleteMany({}),
  ]);
});

describe("Company API Integration", () => {
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

  describe("GET /api/v1/crm/companies", () => {
    it("lists companies with pagination", async () => {
      await createCompany(org.organization._id, org.user._id, {
        name: "Company A",
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Company B",
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Company C",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/companies?page=1&pageSize=2",
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
      await createCompany(org.organization._id, org.user._id, {
        name: "Prospect Co",
        status: "PROSPECT",
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Customer Co",
        status: "CUSTOMER",
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Partner Co",
        status: "PARTNER",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/companies?status=CUSTOMER",
        undefined,
        org.token,
      );
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].status).toBe("CUSTOMER");
    });

    it("filters by ownerId", async () => {
      const otherUser = await UserModel.create({
        email: `other-${new Types.ObjectId()}@example.com`,
        name: "Other User",
        passwordHash: await passwordHash(),
      });

      await createCompany(org.organization._id, org.user._id, {
        name: "My Company",
      });
      await createCompany(org.organization._id, otherUser._id, {
        name: "Other Company",
      });

      const res = await createRequest(
        "GET",
        `/api/v1/crm/companies?ownerId=${org.user._id}`,
        undefined,
        org.token,
      );
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].name).toBe("My Company");
    });

    it("filters by tag", async () => {
      const tag = await TagModel.create({
        organizationId: org.organization._id,
        name: "VIP",
        // From TAG_COLORS. The filter under test is by tag id, so the colour is
        // incidental — it only has to satisfy the enum.
        color: "amber",
      });

      await createCompany(org.organization._id, org.user._id, {
        name: "Tagged Co",
        tags: [tag._id],
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Untagged Co",
      });

      const res = await createRequest(
        "GET",
        `/api/v1/crm/companies?tag=${tag._id}`,
        undefined,
        org.token,
      );
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].name).toBe("Tagged Co");
    });

    it("filters by parentId", async () => {
      const parent = await createCompany(org.organization._id, org.user._id, {
        name: "Parent Co",
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Child Co",
        parentId: parent._id,
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Orphan Co",
      });

      const res = await createRequest(
        "GET",
        `/api/v1/crm/companies?parentId=${parent._id}`,
        undefined,
        org.token,
      );
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].name).toBe("Child Co");
    });

    it("filters by parentId=null for root companies", async () => {
      const parent = await createCompany(org.organization._id, org.user._id, {
        name: "Parent Co",
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Child Co",
        parentId: parent._id,
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Another Root",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/companies?parentId=null",
        undefined,
        org.token,
      );
      const data = await res.json();
      expect(data.data).toHaveLength(2);
      expect(data.data.map((c: any) => c.name).sort()).toEqual([
        "Another Root",
        "Parent Co",
      ]);
    });

    it("text searches companies", async () => {
      await createCompany(org.organization._id, org.user._id, {
        name: "Searchable Corp",
        industry: "Tech",
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Other Company",
        industry: "Finance",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/companies?q=Searchable",
        undefined,
        org.token,
      );
      const data = await res.json();
      expect(data.data).toHaveLength(1);
      expect(data.data[0].name).toBe("Searchable Corp");
    });

    it("sorts results", async () => {
      await createCompany(org.organization._id, org.user._id, {
        name: "Zebra Corp",
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Alpha Inc",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/companies?sort=name",
        undefined,
        org.token,
      );
      const data = await res.json();
      expect(data.data[0].name).toBe("Alpha Inc");
      expect(data.data[1].name).toBe("Zebra Corp");
    });

    it("returns 403 without companies.read permission", async () => {
      const { token } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "VIEWER",
        without: "companies.read",
      });

      const res = await createRequest(
        "GET",
        "/api/v1/crm/companies",
        undefined,
        token,
      );
      expect(res.status).toBe(403);
    });

    it("rejects a sort field that is not on this resource's allow-list", async () => {
      // Sorting is a query the client controls, and a free-form field name is
      // how `$where` or a slug reaches the database. The allow-list is the
      // whole defence, so it has to be exercised through the route and not
      // only through the shared parser's unit tests.
      const res = await createRequest(
        "GET",
        "/api/v1/crm/companies?sort=__proto__",
        undefined,
        org.token,
      );
      expect(res.status).toBe(422);
    });

    it("rejects a pageSize above the hard cap", async () => {
      const res = await createRequest(
        "GET",
        "/api/v1/crm/companies?pageSize=500",
        undefined,
        org.token,
      );
      expect(res.status).toBe(422);
    });

    it("rejects a malformed ownerId instead of letting Mongo throw", async () => {
      const res = await createRequest(
        "GET",
        "/api/v1/crm/companies?ownerId=not-an-id",
        undefined,
        org.token,
      );
      expect(res.status).toBe(422);
    });
  });

  describe("POST /api/v1/crm/companies", () => {
    it("creates a company", async () => {
      const res = await createRequest(
        "POST",
        "/api/v1/crm/companies",
        {
          name: "New Company",
          ownerId: org.user._id.toString(),
          industry: "Technology",
          website: "https://example.com",
          email: "contact@example.com",
          phone: "+15551234567",
          status: "PROSPECT",
          size: 50,
          annualRevenue: 1000000,
        },
        org.token,
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.name).toBe("New Company");
      expect(data.data.industry).toBe("Technology");
      expect(data.data.status).toBe("PROSPECT");
      expect(data.data.size).toBe(50);
      expect(data.data.annualRevenue).toBe(1000000);
    });

    it("creates a company with addresses", async () => {
      const res = await createRequest(
        "POST",
        "/api/v1/crm/companies",
        {
          name: "Address Company",
          ownerId: org.user._id.toString(),
          billingAddress: {
            line1: "123 Main St",
            line2: "Suite 100",
            city: "San Francisco",
            state: "CA",
            postalCode: "94105",
            country: "US",
          },
          shippingAddress: {
            line1: "456 Oak Ave",
            city: "Los Angeles",
            state: "CA",
            postalCode: "90001",
            country: "US",
          },
        },
        org.token,
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.billingAddress.line1).toBe("123 Main St");
      expect(data.data.shippingAddress.city).toBe("Los Angeles");
    });

    it("normalizes domain on create", async () => {
      const res = await createRequest(
        "POST",
        "/api/v1/crm/companies",
        {
          name: "Domain Test Co",
          ownerId: org.user._id.toString(),
          domain: "https://www.Example.COM/path",
        },
        org.token,
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.domain).toBe("example.com");
    });

    it("validates required fields", async () => {
      const res = await createRequest(
        "POST",
        "/api/v1/crm/companies",
        { name: "Only Name" }, // missing ownerId
        org.token,
      );

      expect(res.status).toBe(400);
    });

    it("rejects duplicate domain", async () => {
      await createCompany(org.organization._id, org.user._id, {
        name: "First Co",
        domain: "example.com",
      });

      const res = await createRequest(
        "POST",
        "/api/v1/crm/companies",
        {
          name: "Second Co",
          ownerId: org.user._id.toString(),
          domain: "example.com",
        },
        org.token,
      );

      expect(res.status).toBe(409);
    });

    it("validates website URL format", async () => {
      const res = await createRequest(
        "POST",
        "/api/v1/crm/companies",
        {
          name: "Bad URL Co",
          ownerId: org.user._id.toString(),
          website: "not-a-url",
        },
        org.token,
      );

      expect(res.status).toBe(400);
    });

    it("creates company with parent", async () => {
      const parent = await createCompany(org.organization._id, org.user._id, {
        name: "Parent Co",
      });

      const res = await createRequest(
        "POST",
        "/api/v1/crm/companies",
        {
          name: "Child Co",
          ownerId: org.user._id.toString(),
          parentId: parent._id.toString(),
        },
        org.token,
      );

      expect(res.status).toBe(201);
      const data = await res.json();
      expect(data.data.parentId).toBe(parent._id.toString());
    });

    it("rejects non-existent parent", async () => {
      const res = await createRequest(
        "POST",
        "/api/v1/crm/companies",
        {
          name: "Child Co",
          ownerId: org.user._id.toString(),
          parentId: new Types.ObjectId().toString(),
        },
        org.token,
      );

      // 422, not 400. The body parsed; the id it names is not a company. That
      // distinction is the whole point of the two codes — a 400 tells the client
      // its request is unreadable, and here the request is perfectly readable
      // and the reference is what is wrong. See `VALIDATION_FAILED` in
      // `app-error.ts`, which names this exact case.
      expect(res.status).toBe(422);
    });

    it("returns 403 without companies.create permission", async () => {
      // The member is in the same organisation as `org` and holds a real
      // session. The earlier version of this test used a viewer from a
      // *different* organization, so it was asserting tenant isolation and
      // calling it a permission check — any 200 would have proved nothing about
      // `companies.create`.
      const { token, userId } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "VIEWER",
        without: "companies.create",
      });

      const res = await createRequest(
        "POST",
        "/api/v1/crm/companies",
        {
          name: "Test Company",
          ownerId: userId.toString(),
        },
        token,
      );

      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/v1/crm/companies/:id", () => {
    it("returns a company by ID", async () => {
      const company = await createCompany(org.organization._id, org.user._id);

      const res = await createRequest(
        "GET",
        `/api/v1/crm/companies/${company._id}`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data._id).toBe(company._id.toString());
      expect(data.data.name).toBe("Test Company");
    });

    it("returns 404 for non-existent company", async () => {
      const res = await createRequest(
        "GET",
        `/api/v1/crm/companies/${new Types.ObjectId()}`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(404);
    });

    it("returns 403 without companies.read permission", async () => {
      const company = await createCompany(org.organization._id, org.user._id);

      const { token } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "VIEWER",
        without: "companies.read",
      });

      const res = await createRequest(
        "GET",
        `/api/v1/crm/companies/${company._id}`,
        undefined,
        token,
      );
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/v1/crm/companies/:id", () => {
    it("updates a company", async () => {
      const company = await createCompany(org.organization._id, org.user._id);

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/companies/${company._id}`,
        { name: "Updated Company", industry: "Healthcare" },
        org.token,
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.name).toBe("Updated Company");
      expect(data.data.industry).toBe("Healthcare");
    });

    it("updates status", async () => {
      const company = await createCompany(org.organization._id, org.user._id, {
        status: "PROSPECT",
      });

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/companies/${company._id}`,
        { status: "CUSTOMER" },
        org.token,
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.status).toBe("CUSTOMER");
    });

    it("updates domain and normalizes", async () => {
      const company = await createCompany(org.organization._id, org.user._id);

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/companies/${company._id}`,
        { domain: "https://NEW-DOMAIN.ORG" },
        org.token,
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.domain).toBe("new-domain.org");
    });

    it("rejects duplicate domain on update", async () => {
      const company1 = await createCompany(org.organization._id, org.user._id, {
        name: "First Co",
        domain: "first.com",
      });
      const company2 = await createCompany(org.organization._id, org.user._id, {
        name: "Second Co",
        domain: "second.com",
      });

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/companies/${company2._id}`,
        { domain: "first.com" },
        org.token,
      );

      expect(res.status).toBe(409);
    });

    it("updates parent company", async () => {
      const parent = await createCompany(org.organization._id, org.user._id, {
        name: "Parent Co",
      });
      const child = await createCompany(org.organization._id, org.user._id, {
        name: "Child Co",
      });

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/companies/${child._id}`,
        { parentId: parent._id.toString() },
        org.token,
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.parentId).toBe(parent._id.toString());
    });

    it("rejects circular hierarchy", async () => {
      const parent = await createCompany(org.organization._id, org.user._id, {
        name: "Parent Co",
      });
      const child = await createCompany(org.organization._id, org.user._id, {
        name: "Child Co",
        parentId: parent._id,
      });

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/companies/${parent._id}`,
        { parentId: child._id.toString() },
        org.token,
      );

      // 422 again: the request parsed and named a real company, and the answer
      // is that this particular parent is not a legal one for this child.
      expect(res.status).toBe(422);
    });

    it("removes parent when set to null", async () => {
      const parent = await createCompany(org.organization._id, org.user._id, {
        name: "Parent Co",
      });
      const child = await createCompany(org.organization._id, org.user._id, {
        name: "Child Co",
        parentId: parent._id,
      });

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/companies/${child._id}`,
        { parentId: null },
        org.token,
      );

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.data.parentId).toBeNull();
    });

    it("returns 403 without companies.update permission", async () => {
      const company = await createCompany(org.organization._id, org.user._id);

      const { token } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "VIEWER",
        without: "companies.update",
      });

      const res = await createRequest(
        "PATCH",
        `/api/v1/crm/companies/${company._id}`,
        { name: "Hack" },
        token,
      );
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/v1/crm/companies/:id", () => {
    it("soft deletes a company", async () => {
      const company = await createCompany(org.organization._id, org.user._id);

      const res = await createRequest(
        "DELETE",
        `/api/v1/crm/companies/${company._id}`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(204);

      const deleted = await CompanyModel.findById(company._id);
      expect(deleted?.deletedAt).not.toBeNull();
    });

    it("returns 404 for non-existent company", async () => {
      const res = await createRequest(
        "DELETE",
        `/api/v1/crm/companies/${new Types.ObjectId()}`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(404);
    });

    it("rejects deletion when company has contacts", async () => {
      const company = await createCompany(org.organization._id, org.user._id);
      await createContact(org.organization._id, org.user._id, company._id);

      const res = await createRequest(
        "DELETE",
        `/api/v1/crm/companies/${company._id}`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(409);
    });

    it("rejects deletion when company has children", async () => {
      const parent = await createCompany(org.organization._id, org.user._id, {
        name: "Parent Co",
      });
      await createCompany(org.organization._id, org.user._id, {
        name: "Child Co",
        parentId: parent._id,
      });

      const res = await createRequest(
        "DELETE",
        `/api/v1/crm/companies/${parent._id}`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(409);
    });

    it("returns 403 without companies.delete permission", async () => {
      const company = await createCompany(org.organization._id, org.user._id);

      // Create member without delete permission
      const { token } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "MEMBER",
        without: "companies.delete",
      });

      const res = await createRequest(
        "DELETE",
        `/api/v1/crm/companies/${company._id}`,
        undefined,
        token,
      );
      expect(res.status).toBe(403);
    });
  });

  describe("POST /api/v1/crm/companies/:id/restore", () => {
    it("restores a soft-deleted company", async () => {
      const company = await createCompany(org.organization._id, org.user._id);
      await CompanyModel.findByIdAndUpdate(company._id, {
        deletedAt: new Date(),
      });

      const res = await createRequest(
        "POST",
        `/api/v1/crm/companies/${company._id}/restore`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data._id).toBe(company._id.toString());

      const restored = await CompanyModel.findById(company._id);
      expect(restored?.deletedAt).toBeNull();
    });

    it("returns 404 for non-existent company", async () => {
      const res = await createRequest(
        "POST",
        `/api/v1/crm/companies/${new Types.ObjectId()}/restore`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/crm/companies/:id/contacts", () => {
    it("lists contacts belonging to a company", async () => {
      const company = await createCompany(org.organization._id, org.user._id);
      await createContact(org.organization._id, org.user._id, company._id, {
        firstName: "Contact 1",
      });
      await createContact(org.organization._id, org.user._id, company._id, {
        firstName: "Contact 2",
      });
      await createContact(org.organization._id, org.user._id); // different company

      const res = await createRequest(
        "GET",
        `/api/v1/crm/companies/${company._id}/contacts`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(200);

      const data = await res.json();
      expect(data.data).toHaveLength(2);
      expect(data.data[0].companyId).toBe(company._id.toString());
    });

    it("returns 404 for non-existent company", async () => {
      const res = await createRequest(
        "GET",
        `/api/v1/crm/companies/${new Types.ObjectId()}/contacts`,
        undefined,
        org.token,
      );
      expect(res.status).toBe(404);
    });

    it("returns 403 without contacts.read permission", async () => {
      const company = await createCompany(org.organization._id, org.user._id);

      const { token } = await memberWithout({
        organizationId: org.organization._id,
        roleKey: "VIEWER",
        without: "contacts.read",
      });

      const res = await createRequest(
        "GET",
        `/api/v1/crm/companies/${company._id}/contacts`,
        undefined,
        token,
      );
      expect(res.status).toBe(403);
    });
  });
});
