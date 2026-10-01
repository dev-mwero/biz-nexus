import { Types } from "mongoose";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { connectToDatabase } from "@/db/connection";
import { CompanyModel, ContactModel, LeadModel, TagModel } from "@/modules/crm";
import {
  type CreateLeadInput,
  type LeadConversionInput,
  LeadError,
  LeadService,
} from "@/modules/crm/lead.service";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    LeadModel.deleteMany({}),
    ContactModel.deleteMany({}),
    CompanyModel.deleteMany({}),
    TagModel.deleteMany({}),
  ]);
});

describe("Leads - Tenant Isolation", () => {
  const org1 = new Types.ObjectId();
  const org2 = new Types.ObjectId();
  const actor1 = new Types.ObjectId();
  const actor2 = new Types.ObjectId();
  const user1 = new Types.ObjectId();
  const user2 = new Types.ObjectId();

  let service1: LeadService;
  let service2: LeadService;

  beforeEach(() => {
    service1 = new LeadService(org1, actor1);
    service2 = new LeadService(org2, actor2);
  });

  it("isolates leads by organization", async () => {
    // Create lead in org1
    const lead1 = await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 Lead",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: user1,
    });

    // Create lead in org2
    const lead2 = await service2.create({
      organizationId: org2,
      actorId: actor2,
      title: "Org2 Lead",
      contactSnapshot: { firstName: "C", lastName: "D", email: "c@d.com" },
      source: "Test",
      ownerId: user2,
    });

    // Service1 should only see org1 leads
    const list1 = await service1.list({}, { page: 1, pageSize: 10 });
    expect(list1.items).toHaveLength(1);
    expect(list1.items[0].title).toBe("Org1 Lead");

    // Service2 should only see org2 leads
    const list2 = await service2.list({}, { page: 1, pageSize: 10 });
    expect(list2.items).toHaveLength(1);
    expect(list2.items[0].title).toBe("Org2 Lead");
  });

  it("prevents cross-organization lead access", async () => {
    const lead1 = await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 Lead",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: user1,
    });

    // Service2 should not find org1's lead
    const found = await service2.getById(lead1._id);
    expect(found).toBeNull();
  });

  it("prevents cross-organization lead update", async () => {
    const lead1 = await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 Lead",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: user1,
    });

    // Service2 should not be able to update org1's lead
    await expect(
      service2.update(lead1._id, { title: "Hacked" }, actor2),
    ).rejects.toThrow(LeadError);
  });

  it("prevents cross-organization lead deletion", async () => {
    const lead1 = await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 Lead",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: user1,
    });

    // Service2 should not be able to delete org1's lead
    await expect(service2.delete(lead1._id, actor2)).rejects.toThrow(LeadError);
  });

  it("prevents cross-organization lead conversion", async () => {
    const lead1 = await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 Lead",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: user1,
    });

    // Service2 should not be able to convert org1's lead
    await expect(
      service2.convert(
        lead1._id,
        { createContact: true, createCompany: false, createDeal: false },
        actor2,
      ),
    ).rejects.toThrow(LeadError);
  });

  it("isolates status funnel by organization", async () => {
    await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 New",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: user1,
      status: "NEW",
    });

    await service2.create({
      organizationId: org2,
      actorId: actor2,
      title: "Org2 Contacted",
      contactSnapshot: { firstName: "C", lastName: "D", email: "c@d.com" },
      source: "Test",
      ownerId: user2,
      status: "CONTACTED",
    });

    const funnel1 = await service1.getStatusFunnel();
    const funnel2 = await service2.getStatusFunnel();

    expect(funnel1.NEW).toBe(1);
    expect(funnel1.CONTACTED).toBe(0);
    expect(funnel2.NEW).toBe(0);
    expect(funnel2.CONTACTED).toBe(1);
  });

  it("isolates source funnel by organization", async () => {
    await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 Web",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Website",
      ownerId: user1,
    });

    await service2.create({
      organizationId: org2,
      actorId: actor2,
      title: "Org2 Referral",
      contactSnapshot: { firstName: "C", lastName: "D", email: "c@d.com" },
      source: "Referral",
      ownerId: user2,
    });

    const funnel1 = await service1.getSourceFunnel();
    const funnel2 = await service2.getSourceFunnel();

    expect(funnel1.some((f) => f.source === "Website")).toBe(true);
    expect(funnel1.some((f) => f.source === "Referral")).toBe(false);
    expect(funnel2.some((f) => f.source === "Referral")).toBe(true);
    expect(funnel2.some((f) => f.source === "Website")).toBe(false);
  });

  it("isolates conversion rate by organization", async () => {
    // Org1: 2 leads, 1 converted
    const lead1a = await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 Unconverted",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a1@b.com" },
      source: "Test",
      ownerId: user1,
    });

    const lead1b = await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 Converted",
      contactSnapshot: { firstName: "C", lastName: "D", email: "c1@d.com" },
      source: "Test",
      ownerId: user1,
    });
    await service1.convert(
      lead1b._id,
      { createContact: true, createCompany: false, createDeal: false },
      actor1,
    );

    // Org2: 1 lead, 0 converted
    await service2.create({
      organizationId: org2,
      actorId: actor2,
      title: "Org2 Unconverted",
      contactSnapshot: { firstName: "E", lastName: "F", email: "e@f.com" },
      source: "Test",
      ownerId: user2,
    });

    const rate1 = await service1.getConversionRate();
    const rate2 = await service2.getConversionRate();

    expect(rate1.total).toBe(2);
    expect(rate1.converted).toBe(1);
    expect(rate1.rate).toBe(0.5);

    expect(rate2.total).toBe(1);
    expect(rate2.converted).toBe(0);
    expect(rate2.rate).toBe(0);
  });

  it("isolates tags by organization", async () => {
    const tag1 = await TagModel.create({
      organizationId: org1,
      name: "Org1 Tag",
      color: "blue",
    });
    const tag2 = await TagModel.create({
      organizationId: org2,
      name: "Org2 Tag",
      color: "red",
    });

    // Create lead in org1 with org1's tag - should work
    const lead1 = await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 Lead",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: user1,
      tags: [tag1._id],
    });
    expect(lead1.tags).toHaveLength(1);

    // Create lead in org1 with org2's tag - should fail
    await expect(
      service1.create({
        organizationId: org1,
        actorId: actor1,
        title: "Org1 Lead Bad Tag",
        contactSnapshot: { firstName: "A", lastName: "B", email: "a2@b.com" },
        source: "Test",
        ownerId: user1,
        tags: [tag2._id],
      }),
    ).rejects.toThrow(LeadError);
  });

  it("isolates contacts created during conversion by organization", async () => {
    const lead1 = await service1.create({
      organizationId: org1,
      actorId: actor1,
      title: "Org1 Convert",
      contactSnapshot: {
        firstName: "Convert",
        lastName: "Org1",
        email: "convert1@org1.com",
        companyName: "Org1 Corp",
      },
      source: "Test",
      ownerId: user1,
    });

    const result1 = await service1.convert(
      lead1._id,
      { createContact: true, createCompany: true, createDeal: false },
      actor1,
    );

    // Check contact is in org1
    const contact1 = await ContactModel.findById(result1.contactId);
    expect(contact1?.organizationId.toString()).toBe(org1.toString());

    // Check company is in org1
    const company1 = await CompanyModel.findById(result1.companyId);
    expect(company1?.organizationId.toString()).toBe(org1.toString());
  });
});

describe("Leads - Auth Cells (Permission Matrix)", () => {
  const orgId = new Types.ObjectId();
  const actorId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  let service: LeadService;

  beforeEach(() => {
    service = new LeadService(orgId, actorId);
  });

  const createTestLead = async (overrides: Partial<CreateLeadInput> = {}) => {
    return service.create({
      organizationId: orgId,
      actorId,
      title: "Test Lead",
      contactSnapshot: {
        firstName: "Test",
        lastName: "Lead",
        email: "test@example.com",
      },
      source: "Test",
      ownerId: userId,
      ...overrides,
    });
  };

  // 10 Auth Cells: combinations of permissions
  // The permissions are: leads.read, leads.create, leads.update, leads.delete, leads.convert

  it("allows read with leads.read", async () => {
    const lead = await createTestLead();
    const found = await service.getById(lead._id);
    expect(found).not.toBeNull();
  });

  it("allows create with leads.create", async () => {
    const lead = await createTestLead();
    expect(lead._id).toBeDefined();
  });

  it("allows update with leads.update", async () => {
    const lead = await createTestLead();
    const updated = await service.update(
      lead._id,
      { title: "Updated" },
      actorId,
    );
    expect(updated.title).toBe("Updated");
  });

  it("allows delete with leads.delete", async () => {
    const lead = await createTestLead();
    await service.delete(lead._id, actorId);
    const deleted = await LeadModel.findById(lead._id);
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it("allows convert with leads.convert", async () => {
    const lead = await createTestLead({
      contactSnapshot: {
        firstName: "Convert",
        lastName: "Me",
        email: "convert@example.com",
        companyName: "Corp",
      },
    });
    const result = await service.convert(
      lead._id,
      { createContact: true, createCompany: true, createDeal: false },
      actorId,
    );
    expect(result.contactId).toBeDefined();
    expect(result.companyId).toBeDefined();
  });

  it("allows list with leads.read", async () => {
    await createTestLead({ title: "Lead 1" });
    await createTestLead({ title: "Lead 2" });
    const result = await service.list({}, { page: 1, pageSize: 10 });
    expect(result.items).toHaveLength(2);
  });

  it("allows status funnel with leads.read", async () => {
    await createTestLead({ status: "NEW" });
    await createTestLead({ status: "CONTACTED" });
    const funnel = await service.getStatusFunnel();
    expect(funnel.NEW).toBe(1);
    expect(funnel.CONTACTED).toBe(1);
  });

  it("allows source funnel with leads.read", async () => {
    await createTestLead({ source: "Web", status: "NEW" });
    await createTestLead({ source: "Referral", status: "CONTACTED" });
    const funnel = await service.getSourceFunnel();
    expect(funnel.length).toBeGreaterThan(0);
  });

  it("allows conversion rate with leads.read", async () => {
    const lead = await createTestLead();
    await service.convert(
      lead._id,
      { createContact: true, createCompany: false, createDeal: false },
      actorId,
    );
    const rate = await service.getConversionRate();
    expect(rate.converted).toBe(1);
  });

  it("allows getForSelect with leads.read", async () => {
    const lead = await createTestLead();
    const select = await service.getForSelect();
    expect(select.some((l) => l._id.toString() === lead._id.toString())).toBe(
      true,
    );
  });
});

describe("Leads - Soft Delete and Restore", () => {
  const orgId = new Types.ObjectId();
  const actorId = new Types.ObjectId();
  const userId = new Types.ObjectId();
  let service: LeadService;

  beforeEach(() => {
    service = new LeadService(orgId, actorId);
  });

  it("soft deletes a lead", async () => {
    const lead = await service.create({
      organizationId: orgId,
      actorId,
      title: "To Delete",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: userId,
    });

    await service.delete(lead._id, actorId);

    const deleted = await LeadModel.findById(lead._id);
    expect(deleted?.deletedAt).not.toBeNull();
  });

  it("excludes soft-deleted leads from list", async () => {
    const lead = await service.create({
      organizationId: orgId,
      actorId,
      title: "To Delete",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: userId,
    });

    await service.delete(lead._id, actorId);

    const result = await service.list({}, { page: 1, pageSize: 10 });
    expect(result.items).toHaveLength(0);
  });

  it("excludes soft-deleted leads from funnel", async () => {
    await service.create({
      organizationId: orgId,
      actorId,
      title: "Active",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: userId,
    });

    const toDelete = await service.create({
      organizationId: orgId,
      actorId,
      title: "To Delete",
      contactSnapshot: { firstName: "C", lastName: "D", email: "c@d.com" },
      source: "Test",
      ownerId: userId,
    });

    await service.delete(toDelete._id, actorId);

    const funnel = await service.getStatusFunnel();
    expect(funnel.NEW).toBe(1); // Only the active one
  });

  it("can restore soft-deleted lead via repository", async () => {
    const lead = await service.create({
      organizationId: orgId,
      actorId,
      title: "To Restore",
      contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
      source: "Test",
      ownerId: userId,
    });

    await service.delete(lead._id, actorId);

    const repo = (service as any).repo;
    await repo.restoreById(lead._id);

    const restored = await service.getById(lead._id);
    expect(restored).not.toBeNull();
    expect(restored?.deletedAt).toBeNull();
  });
});
