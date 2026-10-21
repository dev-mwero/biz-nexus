import { passwordHash } from "@tests/support/auth-contract";
import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  DELETE as productDelete,
  GET as productGet,
  PATCH as productPatch,
} from "@/app/api/v1/products/[id]/route";
import {
  GET as productsGet,
  POST as productsPost,
} from "@/app/api/v1/products/route";
import { connectToDatabase } from "@/db/connection";
import { SessionModel, UserModel } from "@/modules/identity";
import { issueSession } from "@/modules/identity/session.service";
import {
  createOrganization,
  MembershipModel,
  OrganizationModel,
  RoleModel,
} from "@/modules/organizations";
import { ProductModel } from "@/modules/products";
import { SESSION_COOKIE } from "@/shared/auth/session-cookie";

/**
 * The product endpoints, called as a client calls them.
 *
 * The service suite already proves the rules the catalogue enforces. This proves
 * the layer above it: that the real handler reads the id the same way production
 * does, that the guard runs before the body, that a foreign id is a 404 and not a
 * 403, and that the wire contract - 201, 204, the standard error envelope - is
 * what `docs/API.md` publishes. A defect in any of those is invisible to a
 * service test.
 *
 * The product routes are not in `tests/support/crm-route.ts`: that table exists
 * for the CRM handlers and reaching through it from here would tie this suite to
 * CRM's path table. The requests are built here instead, against the module
 * exports, exactly as the CRM suite does underneath its helper.
 */

const ORIGIN = "http://localhost:3000";
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

type Handler = (request: Request) => Promise<Response>;

async function call(
  handler: Handler,
  method: string,
  path: string,
  init: { body?: unknown; token?: string } = {},
): Promise<Response> {
  const headers = new Headers({ origin: ORIGIN });
  if (init.token) headers.set("cookie", `${SESSION_COOKIE}=${init.token}`);

  let body: string | undefined;
  if (init.body !== undefined) {
    body = JSON.stringify(init.body);
    headers.set("content-type", "application/json");
  }

  return handler(new Request(new URL(path, ORIGIN), { method, headers, body }));
}

const listProducts = (token: string, query = "") =>
  call(productsGet, "GET", `/api/v1/products${query}`, { token });

const createProduct = (token: string, body: unknown) =>
  call(productsPost, "POST", "/api/v1/products", { token, body });

const getProduct = (token: string, id: string) =>
  call(productGet, "GET", `/api/v1/products/${id}`, { token });

const patchProduct = (token: string, id: string, body: unknown) =>
  call(productPatch, "PATCH", `/api/v1/products/${id}`, { token, body });

const deleteProduct = (token: string, id: string) =>
  call(productDelete, "DELETE", `/api/v1/products/${id}`, { token });

interface TestOrg {
  userId: Types.ObjectId;
  organizationId: Types.ObjectId;
  token: string;
}

async function setupTestOrg(): Promise<TestOrg> {
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

  return { userId: user._id, organizationId: organization._id, token };
}

/**
 * Move the owner's membership onto a provisioned system role.
 *
 * Repointing rather than creating a second membership: `{organizationId,
 * userId}` is unique and the index is right to refuse a duplicate. The session
 * is unchanged, so the same token now carries the new role - which is what makes
 * the write refusals below a statement about the permission and not about a
 * missing session or a second tenant.
 */
async function repointRole(
  organizationId: Types.ObjectId,
  userId: Types.ObjectId,
  key: "MEMBER" | "VIEWER",
): Promise<void> {
  const role = await RoleModel.findOne({ organizationId, key });
  if (!role) throw new Error(`no ${key} role was provisioned`);
  await MembershipModel.updateOne(
    { organizationId, userId },
    { $set: { roleId: role._id } },
  );
}

async function json(response: Response) {
  return response.json() as Promise<{
    data: any;
    meta?: any;
    error?: { code: string; message: string; details?: unknown[] };
  }>;
}

function expectNotFound(body: Awaited<ReturnType<typeof json>>) {
  expect(body.error?.code).toBe("RECORD_NOT_FOUND");
  expect(typeof body.error?.message).toBe("string");
}

beforeAll(async () => {
  await connectToDatabase();
  await ProductModel.createIndexes();
});

afterEach(async () => {
  await Promise.all([
    ProductModel.deleteMany({}),
    OrganizationModel.deleteMany({}),
    UserModel.deleteMany({}),
    SessionModel.deleteMany({}),
    MembershipModel.deleteMany({}),
    RoleModel.deleteMany({}),
  ]);
});

describe("Product API", () => {
  let org: TestOrg;

  beforeEach(async () => {
    org = await setupTestOrg();
  });

  describe("CRUD", () => {
    it("creates, lists, reads, updates and deletes a product", async () => {
      const created = await createProduct(org.token, {
        name: "Widget",
        sku: "W-1",
        type: "PRODUCT",
        unitPriceMinor: 1250,
        unitLabel: "each",
      });
      expect(created.status).toBe(201);
      const createdBody = await json(created);
      const id = createdBody.data._id;
      expect(OBJECT_ID.test(id)).toBe(true);
      expect(createdBody.data.name).toBe("Widget");
      expect(createdBody.data.unitPriceMinor).toBe(1250);

      const listed = await listProducts(org.token);
      expect(listed.status).toBe(200);
      const listedBody = await json(listed);
      expect(listedBody.data).toHaveLength(1);
      expect(listedBody.data[0]._id).toBe(id);
      expect(listedBody.meta.total).toBe(1);

      const fetched = await getProduct(org.token, id);
      expect(fetched.status).toBe(200);
      expect((await json(fetched)).data.name).toBe("Widget");

      const patched = await patchProduct(org.token, id, {
        name: "Renamed",
        unitPriceMinor: 2000,
      });
      expect(patched.status).toBe(200);
      const patchedBody = await json(patched);
      expect(patchedBody.data.name).toBe("Renamed");
      expect(patchedBody.data.unitPriceMinor).toBe(2000);

      const deleted = await deleteProduct(org.token, id);
      expect(deleted.status).toBe(204);

      const gone = await getProduct(org.token, id);
      expect(gone.status).toBe(404);
      expectNotFound(await json(gone));
    });
  });

  describe("create validation", () => {
    it("rejects a missing name with the standard envelope", async () => {
      const res = await createProduct(org.token, {
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      expect(res.status).toBe(422);
      const body = await json(res);
      expect(body.error?.code).toBe("VALIDATION_FAILED");
      expect(Array.isArray(body.error?.details)).toBe(true);
    });

    it("rejects a negative price", async () => {
      const res = await createProduct(org.token, {
        name: "Negative",
        type: "PRODUCT",
        unitPriceMinor: -1,
      });
      expect(res.status).toBe(422);
      expect((await json(res)).error?.code).toBe("VALIDATION_FAILED");
    });

    it("rejects a fractional price", async () => {
      const res = await createProduct(org.token, {
        name: "Fractional",
        type: "PRODUCT",
        unitPriceMinor: 10.5,
      });
      expect(res.status).toBe(422);
      expect((await json(res)).error?.code).toBe("VALIDATION_FAILED");
    });

    it("rejects an unknown key", async () => {
      const res = await createProduct(org.token, {
        name: "Unknown",
        type: "PRODUCT",
        unitPriceMinor: 1000,
        slug: "nope",
      });
      expect(res.status).toBe(422);
      expect((await json(res)).error?.code).toBe("VALIDATION_FAILED");
    });

    it("ignores a currency sent by the client and stores the organisation's", async () => {
      const res = await createProduct(org.token, {
        name: "Currency Probe",
        type: "PRODUCT",
        unitPriceMinor: 1000,
        currency: "GBP",
      });
      expect(res.status).toBe(201);
      expect((await json(res)).data.currency).toBe("USD");
    });
  });

  describe("update validation", () => {
    it("rejects a currency on PATCH", async () => {
      const created = await createProduct(org.token, {
        name: "Widget",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      const id = (await json(created)).data._id;

      const res = await patchProduct(org.token, id, { currency: "GBP" });
      expect(res.status).toBe(422);
      expect((await json(res)).error?.code).toBe("VALIDATION_FAILED");
    });

    it("archives a product through a status change", async () => {
      const created = await createProduct(org.token, {
        name: "Widget",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      const id = (await json(created)).data._id;

      const res = await patchProduct(org.token, id, { status: "ARCHIVED" });
      expect(res.status).toBe(200);
      expect((await json(res)).data.status).toBe("ARCHIVED");
    });
  });

  describe("duplicate SKU", () => {
    it("refuses a case-insensitive duplicate with 409 SLUG_CONFLICT", async () => {
      await createProduct(org.token, {
        name: "First",
        sku: "ABC-1",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });

      const res = await createProduct(org.token, {
        name: "Second",
        sku: "abc-1",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      expect(res.status).toBe(409);
      expect((await json(res)).error?.code).toBe("SLUG_CONFLICT");
    });
  });

  describe("list", () => {
    async function seed() {
      await createProduct(org.token, {
        name: "Charlie",
        type: "PRODUCT",
        unitPriceMinor: 3000,
      });
      await createProduct(org.token, {
        name: "Alpha",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      await createProduct(org.token, {
        name: "Bravo Service",
        type: "SERVICE",
        unitPriceMinor: 2000,
      });
    }

    it("sorts by unitPriceMinor", async () => {
      await seed();
      const res = await listProducts(org.token, "?sort=unitPriceMinor");
      const body = await json(res);
      expect(body.data.map((p: any) => p.unitPriceMinor)).toEqual([
        1000, 2000, 3000,
      ]);
    });

    it("filters by type", async () => {
      await seed();
      const res = await listProducts(org.token, "?type=SERVICE");
      const body = await json(res);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("Bravo Service");
    });

    it("filters by status", async () => {
      await seed();
      const list = await listProducts(org.token, "?sort=unitPriceMinor");
      const id = (await json(list)).data[0]._id;
      await patchProduct(org.token, id, { status: "ARCHIVED" });

      const res = await listProducts(org.token, "?status=ARCHIVED");
      const body = await json(res);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]._id).toBe(id);
    });

    it("text searches products", async () => {
      await createProduct(org.token, {
        name: "Searchable Widget",
        description: "A distinctive thing",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      await createProduct(org.token, {
        name: "Other Item",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });

      const res = await listProducts(org.token, "?q=Searchable");
      const body = await json(res);
      expect(body.data).toHaveLength(1);
      expect(body.data[0].name).toBe("Searchable Widget");
    });

    it("paginates", async () => {
      await seed();
      const res = await listProducts(org.token, "?page=1&pageSize=2");
      const body = await json(res);
      expect(body.data).toHaveLength(2);
      expect(body.meta.total).toBe(3);
      expect(body.meta.page).toBe(1);
      expect(body.meta.pageSize).toBe(2);
    });
  });

  describe("authorization", () => {
    it("lets a MEMBER read but refuses every product write", async () => {
      const created = await createProduct(org.token, {
        name: "Widget",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      const id = (await json(created)).data._id;

      await repointRole(org.organizationId, org.userId, "MEMBER");

      const read = await listProducts(org.token);
      expect(read.status).toBe(200);

      const post = await createProduct(org.token, {
        name: "Blocked",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      expect(post.status).toBe(403);
      expect((await json(post)).error?.code).toBe("INSUFFICIENT_PERMISSION");

      const patch = await patchProduct(org.token, id, { name: "Blocked" });
      expect(patch.status).toBe(403);

      const del = await deleteProduct(org.token, id);
      expect(del.status).toBe(403);
    });

    it("lets a VIEWER read but refuses every product write", async () => {
      const created = await createProduct(org.token, {
        name: "Widget",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      const id = (await json(created)).data._id;

      await repointRole(org.organizationId, org.userId, "VIEWER");

      const read = await listProducts(org.token);
      expect(read.status).toBe(200);

      const post = await createProduct(org.token, {
        name: "Blocked",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      expect(post.status).toBe(403);

      const patch = await patchProduct(org.token, id, { name: "Blocked" });
      expect(patch.status).toBe(403);

      const del = await deleteProduct(org.token, id);
      expect(del.status).toBe(403);
    });
  });

  describe("tenant isolation", () => {
    it("answers 404 for a product in another organisation", async () => {
      const other = await setupTestOrg();
      const created = await createProduct(other.token, {
        name: "Foreign",
        type: "PRODUCT",
        unitPriceMinor: 1000,
      });
      const foreignId = (await json(created)).data._id;

      const read = await getProduct(org.token, foreignId);
      expect(read.status).toBe(404);
      expectNotFound(await json(read));

      const patch = await patchProduct(org.token, foreignId, {
        name: "Hijacked",
      });
      expect(patch.status).toBe(404);
      expectNotFound(await json(patch));

      const del = await deleteProduct(org.token, foreignId);
      expect(del.status).toBe(404);
      expectNotFound(await json(del));
    });
  });
});
