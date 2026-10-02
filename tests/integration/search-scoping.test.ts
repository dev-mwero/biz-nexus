import mongoose, { type Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { CompanyModel } from "@/modules/crm/company.model";
import { ContactModel } from "@/modules/crm/contact.model";

/** The subset of a contact/company the merged result rows need. */
type ContactSearchRow = { firstName: string; lastName: string };
type CompanySearchRow = { name: string };

import { DealModel } from "@/modules/deals/deal.model";
import { TaskModel } from "@/modules/tasks/task.model";

let orgId: Types.ObjectId;
let otherOrgId: Types.ObjectId;
let userId: Types.ObjectId;

beforeEach(async () => {
  await connectToDatabase();

  const mongoose = await import("mongoose");
  orgId = new mongoose.Types.ObjectId();
  otherOrgId = new mongoose.Types.ObjectId();
  userId = new mongoose.Types.ObjectId();
});

afterEach(async () => {
  await mongoose.connection.dropDatabase();
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
        ownerId: userId,
        primaryEmail: "john@example.com",
        status: "LEAD",
      },
      {
        organizationId: otherOrgId,
        firstName: "Jane",
        lastName: "Doe",
        ownerId: userId,
        primaryEmail: "jane@example.com",
        status: "LEAD",
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
        ownerId: userId,
        email: "acme@example.com",
        industry: "Tech",
        status: "PROSPECT",
      },
      {
        organizationId: otherOrgId,
        name: "Beta Inc",
        ownerId: userId,
        email: "beta@example.com",
        industry: "Tech",
        status: "PROSPECT",
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
        ownerId: userId,
      },
      {
        organizationId: otherOrgId,
        name: "Small Deal",
        value: 1000,
        status: "OPEN",
        stageId,
        pipelineId,
        ownerId: userId,
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
        ownerId: userId,
        primaryEmail: "alice@example.com",
        status: "LEAD",
      },
    ]);
    await CompanyModel.create([
      {
        organizationId: orgId,
        name: "Johnson & Co",
        ownerId: userId,
        email: "johnson@example.com",
        industry: "Consulting",
        status: "PROSPECT",
      },
    ]);

    // Search across all collections. `score` comes from the text index via a
    // projection rather than being a stored field, so it has to be added to
    // the lean result type the same way the search route does it.
    const [contacts, companies] = await Promise.all([
      ContactModel.find(
        { organizationId: orgId, $text: { $search: "johnson" } },
        { score: { $meta: "textScore" } },
      ).lean<Array<ContactSearchRow & { score: number }>>(),
      CompanyModel.find(
        { organizationId: orgId, $text: { $search: "johnson" } },
        { score: { $meta: "textScore" } },
      ).lean<Array<CompanySearchRow & { score: number }>>(),
    ]);

    const allResults = [
      ...contacts.map((c) => ({
        ...c,
        entityType: "contact" as const,
        score: c.score,
      })),
      ...companies.map((c) => ({
        ...c,
        entityType: "company" as const,
        score: c.score,
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
      ownerId: userId,
      primaryEmail: `contact${i}@example.com`,
      status: "LEAD" as const,
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
