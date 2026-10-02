import { Types } from "mongoose";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { CompanyModel } from "@/modules/crm/company.model";
import { CompanyRepository } from "@/modules/crm/company.repository";
import { ContactModel } from "@/modules/crm/contact.model";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([CompanyModel.deleteMany({}), ContactModel.deleteMany({})]);
});

describe("CompanyRepository - Hierarchy & Contact Rollups", () => {
  const orgId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  let repo: CompanyRepository;

  beforeEach(() => {
    repo = new CompanyRepository(orgId, userId);
  });

  describe("findChildren", () => {
    it("returns direct children of a parent company", async () => {
      const parent = await CompanyModel.create({
        organizationId: orgId,
        name: "Parent Co",
        ownerId: userId,
      });
      const child1 = await CompanyModel.create({
        organizationId: orgId,
        name: "Child 1",
        ownerId: userId,
        parentId: parent._id,
      });
      const child2 = await CompanyModel.create({
        organizationId: orgId,
        name: "Child 2",
        ownerId: userId,
        parentId: parent._id,
      });
      // Grandchild - should not be returned
      await CompanyModel.create({
        organizationId: orgId,
        name: "Grandchild",
        ownerId: userId,
        parentId: child1._id,
      });
      // Unrelated company
      await CompanyModel.create({
        organizationId: orgId,
        name: "Unrelated",
        ownerId: userId,
      });

      const children = await repo.findChildren(parent._id);

      expect(children).toHaveLength(2);
      expect(children.map((c) => c.name).sort()).toEqual([
        "Child 1",
        "Child 2",
      ]);
    });

    it("returns empty array when no children exist", async () => {
      const parent = await CompanyModel.create({
        organizationId: orgId,
        name: "Lonely Parent",
        ownerId: userId,
      });

      const children = await repo.findChildren(parent._id);
      expect(children).toHaveLength(0);
    });
  });

  describe("getHierarchyPath", () => {
    it("returns full path from root to company", async () => {
      const root = await CompanyModel.create({
        organizationId: orgId,
        name: "Root",
        ownerId: userId,
      });
      const child = await CompanyModel.create({
        organizationId: orgId,
        name: "Child",
        ownerId: userId,
        parentId: root._id,
      });
      const grandchild = await CompanyModel.create({
        organizationId: orgId,
        name: "Grandchild",
        ownerId: userId,
        parentId: child._id,
      });

      const path = await repo.getHierarchyPath(grandchild._id);

      expect(path).toHaveLength(3);
      expect(path.map((c) => c.name)).toEqual(["Root", "Child", "Grandchild"]);
    });

    it("returns single company for root", async () => {
      const root = await CompanyModel.create({
        organizationId: orgId,
        name: "Root",
        ownerId: userId,
      });

      const path = await repo.getHierarchyPath(root._id);
      expect(path).toHaveLength(1);
      expect(path[0].name).toBe("Root");
    });
  });

  describe("getRootAncestor", () => {
    it("returns root ancestor", async () => {
      const root = await CompanyModel.create({
        organizationId: orgId,
        name: "Root",
        ownerId: userId,
      });
      const child = await CompanyModel.create({
        organizationId: orgId,
        name: "Child",
        ownerId: userId,
        parentId: root._id,
      });
      const grandchild = await CompanyModel.create({
        organizationId: orgId,
        name: "Grandchild",
        ownerId: userId,
        parentId: child._id,
      });

      const ancestor = await repo.getRootAncestor(grandchild._id);
      expect(ancestor?._id.toString()).toBe(root._id.toString());
    });

    it("returns self for root company", async () => {
      const root = await CompanyModel.create({
        organizationId: orgId,
        name: "Root",
        ownerId: userId,
      });

      const ancestor = await repo.getRootAncestor(root._id);
      expect(ancestor?._id.toString()).toBe(root._id.toString());
    });
  });

  describe("isAncestorOf", () => {
    it("returns true for direct parent", async () => {
      const parent = await CompanyModel.create({
        organizationId: orgId,
        name: "Parent",
        ownerId: userId,
      });
      const child = await CompanyModel.create({
        organizationId: orgId,
        name: "Child",
        ownerId: userId,
        parentId: parent._id,
      });

      const result = await repo.isAncestorOf(parent._id, child._id);
      expect(result).toBe(true);
    });

    it("returns true for grandparent", async () => {
      const root = await CompanyModel.create({
        organizationId: orgId,
        name: "Root",
        ownerId: userId,
      });
      const child = await CompanyModel.create({
        organizationId: orgId,
        name: "Child",
        ownerId: userId,
        parentId: root._id,
      });
      const grandchild = await CompanyModel.create({
        organizationId: orgId,
        name: "Grandchild",
        ownerId: userId,
        parentId: child._id,
      });

      const result = await repo.isAncestorOf(root._id, grandchild._id);
      expect(result).toBe(true);
    });

    it("returns false for sibling", async () => {
      const parent = await CompanyModel.create({
        organizationId: orgId,
        name: "Parent",
        ownerId: userId,
      });
      const child1 = await CompanyModel.create({
        organizationId: orgId,
        name: "Child 1",
        ownerId: userId,
        parentId: parent._id,
      });
      const child2 = await CompanyModel.create({
        organizationId: orgId,
        name: "Child 2",
        ownerId: userId,
        parentId: parent._id,
      });

      const result = await repo.isAncestorOf(child1._id, child2._id);
      expect(result).toBe(false);
    });

    it("returns false for unrelated company", async () => {
      const company1 = await CompanyModel.create({
        organizationId: orgId,
        name: "Company 1",
        ownerId: userId,
      });
      const company2 = await CompanyModel.create({
        organizationId: orgId,
        name: "Company 2",
        ownerId: userId,
      });

      const result = await repo.isAncestorOf(company1._id, company2._id);
      expect(result).toBe(false);
    });
  });

  describe("getAllDescendantIds", () => {
    it("returns all descendant IDs recursively", async () => {
      const root = await CompanyModel.create({
        organizationId: orgId,
        name: "Root",
        ownerId: userId,
      });
      const child1 = await CompanyModel.create({
        organizationId: orgId,
        name: "Child 1",
        ownerId: userId,
        parentId: root._id,
      });
      const child2 = await CompanyModel.create({
        organizationId: orgId,
        name: "Child 2",
        ownerId: userId,
        parentId: root._id,
      });
      const grandchild = await CompanyModel.create({
        organizationId: orgId,
        name: "Grandchild",
        ownerId: userId,
        parentId: child1._id,
      });
      const greatGrandchild = await CompanyModel.create({
        organizationId: orgId,
        name: "Great Grandchild",
        ownerId: userId,
        parentId: grandchild._id,
      });

      const descendants = await repo.getAllDescendantIds(root._id);

      expect(descendants).toHaveLength(4);
      const names = await CompanyModel.find({ _id: { $in: descendants } })
        .select("name")
        .lean();
      expect(names.map((n) => n.name).sort()).toEqual([
        "Child 1",
        "Child 2",
        "Grandchild",
        "Great Grandchild",
      ]);
    });

    it("returns empty array for leaf company", async () => {
      const leaf = await CompanyModel.create({
        organizationId: orgId,
        name: "Leaf",
        ownerId: userId,
      });

      const descendants = await repo.getAllDescendantIds(leaf._id);
      expect(descendants).toHaveLength(0);
    });
  });

  describe("Contact Rollups", () => {
    let parent: any;
    let child1: any;
    let child2: any;
    let grandchild: any;

    beforeEach(async () => {
      parent = await CompanyModel.create({
        organizationId: orgId,
        name: "Parent Co",
        ownerId: userId,
      });
      child1 = await CompanyModel.create({
        organizationId: orgId,
        name: "Child 1",
        ownerId: userId,
        parentId: parent._id,
      });
      child2 = await CompanyModel.create({
        organizationId: orgId,
        name: "Child 2",
        ownerId: userId,
        parentId: parent._id,
      });
      grandchild = await CompanyModel.create({
        organizationId: orgId,
        name: "Grandchild",
        ownerId: userId,
        parentId: child1._id,
      });
    });

    describe("getContactCount", () => {
      it("returns count of direct contacts for a company", async () => {
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Contact",
          lastName: "One",
          ownerId: userId,
          companyId: parent._id,
          emails: [
            { label: "Work", value: "one@example.com", isPrimary: true },
          ],
        });
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Contact",
          lastName: "Two",
          ownerId: userId,
          companyId: parent._id,
          emails: [
            { label: "Work", value: "two@example.com", isPrimary: true },
          ],
        });
        // Contact for child - should not count for parent
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Contact",
          lastName: "Child",
          ownerId: userId,
          companyId: child1._id,
          emails: [
            { label: "Work", value: "child@example.com", isPrimary: true },
          ],
        });

        const count = await repo.getContactCount(parent._id);
        expect(count).toBe(2);
      });

      it("returns 0 when no contacts", async () => {
        const count = await repo.getContactCount(parent._id);
        expect(count).toBe(0);
      });
    });

    describe("getContactCounts (bulk)", () => {
      it("returns map of companyId -> contact count", async () => {
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Contact",
          lastName: "One",
          ownerId: userId,
          companyId: parent._id,
          emails: [
            { label: "Work", value: "one@example.com", isPrimary: true },
          ],
        });
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Contact",
          lastName: "Two",
          ownerId: userId,
          companyId: parent._id,
          emails: [
            { label: "Work", value: "two@example.com", isPrimary: true },
          ],
        });
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Contact",
          lastName: "Child",
          ownerId: userId,
          companyId: child1._id,
          emails: [
            { label: "Work", value: "child@example.com", isPrimary: true },
          ],
        });

        const counts = await repo.getContactCounts([
          parent._id,
          child1._id,
          child2._id,
        ]);

        expect(counts.get(parent._id.toString())).toBe(2);
        expect(counts.get(child1._id.toString())).toBe(1);
        // Companies with no contacts are not in the map
        expect(counts.get(child2._id.toString())).toBeUndefined();
      });

      it("handles empty array", async () => {
        const counts = await repo.getContactCounts([]);
        expect(counts.size).toBe(0);
      });
    });

    describe("getContactCountWithDescendants", () => {
      it("returns total contacts including all descendants", async () => {
        // 2 contacts at parent
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Parent",
          lastName: "Contact 1",
          ownerId: userId,
          companyId: parent._id,
          emails: [{ label: "Work", value: "p1@example.com", isPrimary: true }],
        });
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Parent",
          lastName: "Contact 2",
          ownerId: userId,
          companyId: parent._id,
          emails: [{ label: "Work", value: "p2@example.com", isPrimary: true }],
        });
        // 1 contact at child1
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Child1",
          lastName: "Contact",
          ownerId: userId,
          companyId: child1._id,
          emails: [{ label: "Work", value: "c1@example.com", isPrimary: true }],
        });
        // 1 contact at grandchild
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Grandchild",
          lastName: "Contact",
          ownerId: userId,
          companyId: grandchild._id,
          emails: [{ label: "Work", value: "gc@example.com", isPrimary: true }],
        });
        // 1 contact at child2
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Child2",
          lastName: "Contact",
          ownerId: userId,
          companyId: child2._id,
          emails: [{ label: "Work", value: "c2@example.com", isPrimary: true }],
        });

        const total = await repo.getContactCountWithDescendants(parent._id);
        expect(total).toBe(5);
      });

      it("returns direct count for leaf company", async () => {
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Child1",
          lastName: "Contact",
          ownerId: userId,
          companyId: child1._id,
          emails: [{ label: "Work", value: "c1@example.com", isPrimary: true }],
        });

        const total = await repo.getContactCountWithDescendants(child1._id);
        expect(total).toBe(1);
      });

      it("includes grandchild contacts in child1 total", async () => {
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Child1",
          lastName: "Contact",
          ownerId: userId,
          companyId: child1._id,
          emails: [{ label: "Work", value: "c1@example.com", isPrimary: true }],
        });
        await ContactModel.create({
          organizationId: orgId,
          firstName: "Grandchild",
          lastName: "Contact",
          ownerId: userId,
          companyId: grandchild._id,
          emails: [{ label: "Work", value: "gc@example.com", isPrimary: true }],
        });

        const total = await repo.getContactCountWithDescendants(child1._id);
        expect(total).toBe(2);
      });
    });
  });

  describe("Tenant Isolation", () => {
    it("only returns companies from the same organization", async () => {
      const org2 = new Types.ObjectId();
      const repo2 = new CompanyRepository(org2, userId);

      await CompanyModel.create({
        organizationId: orgId,
        name: "Org 1 Company",
        ownerId: userId,
      });
      await CompanyModel.create({
        organizationId: org2,
        name: "Org 2 Company",
        ownerId: userId,
      });

      const companies = await repo.getForSelect();
      expect(companies).toHaveLength(1);
      expect(companies[0].name).toBe("Org 1 Company");
    });

    it("hierarchy methods respect organization scope", async () => {
      const org2 = new Types.ObjectId();
      const repo2 = new CompanyRepository(org2, userId);

      const parent = await CompanyModel.create({
        organizationId: orgId,
        name: "Parent",
        ownerId: userId,
      });
      await CompanyModel.create({
        organizationId: orgId,
        name: "Child",
        ownerId: userId,
        parentId: parent._id,
      });

      // Create same structure in org2
      const parent2 = await CompanyModel.create({
        organizationId: org2,
        name: "Parent 2",
        ownerId: userId,
      });
      await CompanyModel.create({
        organizationId: org2,
        name: "Child 2",
        ownerId: userId,
        parentId: parent2._id,
      });

      const children1 = await repo.findChildren(parent._id);
      const children2 = await repo2.findChildren(parent2._id);

      expect(children1).toHaveLength(1);
      expect(children2).toHaveLength(1);
      expect(children1[0].name).toBe("Child");
      expect(children2[0].name).toBe("Child 2");
    });
  });
});
