import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { CompanyModel } from "@/modules/crm/company.model";
import { type Contact, ContactModel } from "@/modules/crm/contact.model";
import { ContactRepository } from "@/modules/crm/contact.repository";

const ORG_ID = new Types.ObjectId("64b0000000000000000000a1");
const ACTOR_ID = new Types.ObjectId("64b0000000000000000000c3");
const COMPANY_ID = new Types.ObjectId("64b0000000000000000000d4");

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([ContactModel.deleteMany({}), CompanyModel.deleteMany({})]);
});

function createTestContact(
  overrides: Record<string, unknown> = {},
): Omit<
  Contact,
  | "organizationId"
  | "_id"
  | "createdAt"
  | "updatedAt"
  | "createdBy"
  | "updatedBy"
  | "deletedAt"
> {
  return {
    firstName: "John",
    lastName: "Doe",
    ownerId: ACTOR_ID,
    emails: [{ label: "Work", value: "john@example.com", isPrimary: true }],
    phones: [{ label: "Mobile", value: "+15551234567", isPrimary: true }],
    status: "LEAD",
    tags: [],
    customFields: {},
    ...overrides,
  } as Omit<
    Contact,
    | "organizationId"
    | "_id"
    | "createdAt"
    | "updatedAt"
    | "createdBy"
    | "updatedBy"
    | "deletedAt"
  >;
}

describe("ContactRepository", () => {
  let repo: ContactRepository;

  beforeEach(() => {
    repo = new ContactRepository(ORG_ID, ACTOR_ID);
  });

  describe("CRUD", () => {
    it("creates a contact", async () => {
      const contact = await repo.create(createTestContact());

      expect(contact._id).toBeInstanceOf(Types.ObjectId);
      expect(contact.organizationId).toEqual(ORG_ID);
      expect(contact.firstName).toBe("John");
      expect(contact.lastName).toBe("Doe");
      // Repository doesn't set primaryEmail from emails; that's done by the service
      expect(contact.emails).toHaveLength(1);
      expect(contact.emails[0].value).toBe("john@example.com");
      expect(contact.status).toBe("LEAD");
    });

    it("finds a contact by ID", async () => {
      const created = await repo.create(createTestContact());
      const found = await repo.findById(created._id);

      expect(found).not.toBeNull();
      expect(found?._id.toString()).toBe(created._id.toString());
    });

    it("returns null for non-existent contact", async () => {
      const found = await repo.findById(new Types.ObjectId());
      expect(found).toBeNull();
    });

    it("updates a contact", async () => {
      const created = await repo.create(createTestContact());
      const updated = await repo.findByIdAndUpdate(created._id, {
        $set: { firstName: "Jane", jobTitle: "Engineer" },
      });

      expect(updated?.firstName).toBe("Jane");
      expect(updated?.jobTitle).toBe("Engineer");
    });

    it("soft deletes a contact", async () => {
      const created = await repo.create(createTestContact());
      await repo.softDeleteById(created._id);

      const deleted = await ContactModel.findById(created._id);
      expect(deleted?.deletedAt).not.toBeNull();
    });

    it("restores a soft-deleted contact", async () => {
      const created = await repo.create(createTestContact());
      await repo.softDeleteById(created._id);
      await repo.restoreById(created._id);

      const restored = await ContactModel.findById(created._id);
      expect(restored?.deletedAt).toBeNull();
    });
  });

  describe("findWithFilters", () => {
    beforeEach(async () => {
      // Create test contacts
      await repo.create(
        createTestContact({
          firstName: "Alice",
          lastName: "Anderson",
          primaryEmail: "alice@example.com",
          emails: [
            { label: "Work", value: "alice@example.com", isPrimary: true },
          ],
          status: "LEAD",
          ownerId: ACTOR_ID,
        }),
      );
      await repo.create(
        createTestContact({
          firstName: "Bob",
          lastName: "Brown",
          primaryEmail: "bob@example.com",
          emails: [
            { label: "Work", value: "bob@example.com", isPrimary: true },
          ],
          status: "PROSPECT",
          ownerId: ACTOR_ID,
        }),
      );
      await repo.create(
        createTestContact({
          firstName: "Carol",
          lastName: "Clark",
          primaryEmail: "carol@example.com",
          emails: [
            { label: "Work", value: "carol@example.com", isPrimary: true },
          ],
          status: "CUSTOMER",
          ownerId: ACTOR_ID,
        }),
      );
    });

    it("filters by status", async () => {
      const result = await repo.findWithFilters({ status: "LEAD" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].firstName).toBe("Alice");
    });

    it("filters by ownerId", async () => {
      const otherOwner = new Types.ObjectId();
      await repo.create(
        createTestContact({
          firstName: "Other",
          lastName: "Owner",
          primaryEmail: "other@example.com",
          emails: [
            { label: "Work", value: "other@example.com", isPrimary: true },
          ],
          ownerId: otherOwner,
        }),
      );

      const result = await repo.findWithFilters({ ownerId: ACTOR_ID });
      expect(result.items).toHaveLength(3);
    });

    it("filters by companyId", async () => {
      await repo.create(
        createTestContact({
          firstName: "Company",
          lastName: "Contact",
          primaryEmail: "company@example.com",
          emails: [
            { label: "Work", value: "company@example.com", isPrimary: true },
          ],
          companyId: COMPANY_ID,
        }),
      );

      const result = await repo.findWithFilters({ companyId: COMPANY_ID });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].firstName).toBe("Company");
    });

    it("filters by tagIds", async () => {
      const tagId = new Types.ObjectId();
      await repo.create(
        createTestContact({
          firstName: "Tagged",
          lastName: "Contact",
          primaryEmail: "tagged@example.com",
          emails: [
            { label: "Work", value: "tagged@example.com", isPrimary: true },
          ],
          tags: [tagId],
        }),
      );

      const result = await repo.findWithFilters({ tagIds: [tagId] });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].firstName).toBe("Tagged");
    });

    it("filters by hasEmail", async () => {
      await repo.create(
        createTestContact({
          firstName: "NoEmail",
          lastName: "Contact",
          primaryEmail: null,
          emails: [],
        }),
      );

      const withEmail = await repo.findWithFilters({ hasEmail: true });
      expect(withEmail.items).toHaveLength(3);

      const withoutEmail = await repo.findWithFilters({ hasEmail: false });
      expect(withoutEmail.items).toHaveLength(1);
      expect(withoutEmail.items[0].firstName).toBe("NoEmail");
    });

    it("filters by date range", async () => {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

      const result = await repo.findWithFilters({
        createdFrom: yesterday,
        createdTo: tomorrow,
      });
      expect(result.items).toHaveLength(3);
    });

    it("performs text search", async () => {
      const result = await repo.findWithFilters({ q: "Alice" });
      expect(result.items).toHaveLength(1);
      expect(result.items[0].firstName).toBe("Alice");
    });

    it("paginates results", async () => {
      const page1 = await repo.findWithFilters({}, { page: 1, pageSize: 2 });
      expect(page1.items).toHaveLength(2);
      expect(page1.total).toBe(3);

      const page2 = await repo.findWithFilters({}, { page: 2, pageSize: 2 });
      expect(page2.items).toHaveLength(1);
    });

    it("sorts results", async () => {
      const result = await repo.findWithFilters({}, { sort: "firstName" });
      expect(result.items.map((c) => c.firstName)).toEqual([
        "Alice",
        "Bob",
        "Carol",
      ]);
    });
  });

  describe("findByPrimaryEmail", () => {
    it("finds contact by primary email", async () => {
      await repo.create(
        createTestContact({
          primaryEmail: "unique@example.com",
          emails: [
            { label: "Work", value: "unique@example.com", isPrimary: true },
          ],
        }),
      );

      const found = await repo.findByPrimaryEmail("unique@example.com");
      expect(found).not.toBeNull();
      expect(found?.primaryEmail).toBe("unique@example.com");
    });

    it("returns null for non-existent email", async () => {
      const found = await repo.findByPrimaryEmail("nonexistent@example.com");
      expect(found).toBeNull();
    });
  });

  describe("findByCompany", () => {
    it("finds contacts for a company", async () => {
      await repo.create(
        createTestContact({
          firstName: "Contact1",
          primaryEmail: "c1@example.com",
          emails: [{ label: "Work", value: "c1@example.com", isPrimary: true }],
          companyId: COMPANY_ID,
        }),
      );
      await repo.create(
        createTestContact({
          firstName: "Contact2",
          primaryEmail: "c2@example.com",
          emails: [{ label: "Work", value: "c2@example.com", isPrimary: true }],
          companyId: COMPANY_ID,
        }),
      );

      const contacts = await repo.findByCompany(COMPANY_ID);
      expect(contacts).toHaveLength(2);
    });

    it("respects limit", async () => {
      await repo.create(
        createTestContact({
          firstName: "Contact1",
          primaryEmail: "c1@example.com",
          emails: [{ label: "Work", value: "c1@example.com", isPrimary: true }],
          companyId: COMPANY_ID,
        }),
      );
      await repo.create(
        createTestContact({
          firstName: "Contact2",
          primaryEmail: "c2@example.com",
          emails: [{ label: "Work", value: "c2@example.com", isPrimary: true }],
          companyId: COMPANY_ID,
        }),
      );

      const contacts = await repo.findByCompany(COMPANY_ID, { limit: 1 });
      expect(contacts).toHaveLength(1);
    });
  });

  describe("getForSelect", () => {
    it("returns contacts with id and name only", async () => {
      await repo.create(
        createTestContact({
          firstName: "Select",
          lastName: "Test",
          primaryEmail: "select@example.com",
          emails: [
            { label: "Work", value: "select@example.com", isPrimary: true },
          ],
        }),
      );

      const contacts = await repo.getForSelect();
      expect(contacts).toHaveLength(1);
      expect(contacts[0]).toHaveProperty("_id");
      expect(contacts[0]).toHaveProperty("firstName");
      expect(contacts[0]).toHaveProperty("lastName");
      expect(contacts[0]).not.toHaveProperty("emails");
    });
  });

  describe("findMerged", () => {
    it("finds merged contacts", async () => {
      const target = await repo.create(
        createTestContact({ firstName: "Target" }),
      );
      const source = await repo.create(
        createTestContact({ firstName: "Source" }),
      );

      await ContactModel.findByIdAndUpdate(source._id, {
        mergedIntoId: target._id,
      });

      const merged = await repo.findMerged();
      expect(merged).toHaveLength(1);
      expect(merged[0]._id.toString()).toBe(source._id.toString());
      expect(merged[0].mergedIntoId?.toString()).toBe(target._id.toString());
    });
  });
});
