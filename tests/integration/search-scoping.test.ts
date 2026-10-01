import { MongoMemoryServer } from "mongodb-memory-server";
import type { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { CompanyModel } from "@/modules/crm/companies/company.model";
import { ContactModel } from "@/modules/crm/contacts/contact.model";
import { DealModel } from "@/modules/crm/deals/deal.model";
import { TaskModel } from "@/modules/crm/tasks/task.model";

let mongoServer: MongoMemoryServer;
let orgId: Types.ObjectId;
let otherOrgId: Types.ObjectId;
let userId: Types.ObjectId;

beforeEach(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await connectToDatabase();

  const mongoose = await import("mongoose");
  orgId = new mongoose.Types.ObjectId();
  otherOrgId = new mongoose.Types.ObjectId();
  userId = new mongoose.Types.ObjectId();
});

afterEach(async () => {
  await mongoServer.stop();
  vi.clearAllMocks();
});

describe("Search Scoping to Organization", () => {
  beforeEach(async () => {
    // Create indexes
    await ContactModel.createIndexes();
    await CompanyModel.createIndexes();
    await DealModel.createIndexes();
    await TaskModel.createIndexes();
  });

  it("should only search contacts within the organization", async () => {
    await ContactModel.create([
      {
        organizationId: orgId,
        firstName: "John",
        lastName: "Doe",
        primaryEmail: "john@example.com",
        status: "ACTIVE",
      },
      {
        organizationId: otherOrgId,
        firstName: "Jane",
        lastName: "Doe",
        primaryEmail: "jane@example.com",
        status: "ACTIVE",
      },
    ]);

    const results = await ContactModel.find(
      { organizationId: orgId, $text: { $search: "doe" } },
      { score: { $meta: "textScore" } },
    ).lean();

    expect(results.length).toBe(1);
    expect(results[0].firstName).toBe("John");
  });

  it("should only search companies within the organization", async () => {
    await CompanyModel.create([
      {
        organizationId: orgId,
        name: "Acme Corp",
        email: "acme@example.com",
        industry: "Tech",
        status: "ACTIVE",
      },
      {
        organizationId: otherOrgId,
        name: "Beta Inc",
        email: "beta@example.com",
        industry: "Tech",
        status: "ACTIVE",
      },
    ]);

    const results = await CompanyModel.find(
      { organizationId: orgId, $text: { $search: "acme" } },
      { score: { $meta: "textScore" } },
    ).lean();

    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Acme Corp");
  });

  it("should only search deals within the organization", async () => {
    const pipelineId = new (await import("mongoose")).Types.ObjectId();
    const stageId = new (await import("mongoose")).Types.ObjectId();

    await DealModel.create([
      {
        organizationId: orgId,
        name: "Big Deal",
        value: 100000,
        status: "OPEN",
        stageId,
        pipelineId,
      },
      {
        organizationId: otherOrgId,
        name: "Small Deal",
        value: 1000,
        status: "OPEN",
        stageId,
        pipelineId,
      },
    ]);

    const results = await DealModel.find(
      { organizationId: orgId, $text: { $search: "big" } },
      { score: { $meta: "textScore" } },
    ).lean();

    expect(results.length).toBe(1);
    expect(results[0].name).toBe("Big Deal");
  });

  it("should only search tasks within the organization", async () => {
    await TaskModel.create([
      {
        organizationId: orgId,
        title: "Important Task",
        status: "TODO",
        priority: "HIGH",
        assigneeId: userId,
      },
      {
        organizationId: otherOrgId,
        title: "Other Task",
        status: "TODO",
        priority: "LOW",
        assigneeId: userId,
      },
    ]);

    const results = await TaskModel.find(
      { organizationId: orgId, $text: { $search: "important" } },
      { score: { $meta: "textScore" } },
    ).lean();

    expect(results.length).toBe(1);
    expect(results[0].title).toBe("Important Task");
  });

  it("should merge results from all collections and sort by score", async () => {
    await ContactModel.create([
      {
        organizationId: orgId,
        firstName: "Alice",
        lastName: "Johnson",
        primaryEmail: "alice@example.com",
        status: "ACTIVE",
      },
    ]);
    await CompanyModel.create([
      {
        organizationId: orgId,
        name: "Johnson & Co",
        email: "johnson@example.com",
        industry: "Consulting",
        status: "ACTIVE",
      },
    ]);

    // Search across all collections
    const [contacts, companies] = await Promise.all([
      ContactModel.find(
        { organizationId: orgId, $text: { $search: "johnson" } },
        { score: { $meta: "textScore" } },
      ).lean(),
      CompanyModel.find(
        { organizationId: orgId, $text: { $search: "johnson" } },
        { score: { $meta: "textScore" } },
      ).lean(),
    ]);

    const allResults = [
      ...contacts.map((c) => ({
        ...c,
        entityType: "contact" as const,
        score: (c as any).score,
      })),
      ...companies.map((c) => ({
        ...c,
        entityType: "company" as const,
        score: (c as any).score,
      })),
    ];

    allResults.sort((a, b) => b.score - a.score);

    expect(allResults.length).toBe(2);
    expect(allResults[0].entityType).toBeDefined();
    expect(allResults[1].entityType).toBeDefined();
  });

  it("should respect limit of 20 per collection", async () => {
    const contacts = Array.from({ length: 25 }, (_, i) => ({
      organizationId: orgId,
      firstName: `Contact${i}`,
      lastName: "Searchable",
      primaryEmail: `contact${i}@example.com`,
      status: "ACTIVE",
    }));
    await ContactModel.insertMany(contacts);

    const results = await ContactModel.find(
      { organizationId: orgId, $text: { $search: "searchable" } },
      { score: { $meta: "textScore" } },
    )
      .sort({ score: { $meta: "textScore" } })
      .limit(20)
      .lean();

    expect(results.length).toBe(20);
  });

  it("should handle empty results gracefully", async () => {
    const results = await ContactModel.find(
      { organizationId: orgId, $text: { $search: "nonexistent" } },
      { score: { $meta: "textScore" } },
    ).lean();

    expect(results.length).toBe(0);
  });
});
