import { MongoMemoryServer } from "mongodb-memory-server";
import type { Types } from "mongoose";
import { afterAll, beforeAll, describe, test } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { CompanyModel } from "@/modules/crm/company.model";
import { ContactModel } from "@/modules/crm/contact.model";
import { DealModel } from "@/modules/deals/deal.model";
import { TaskModel } from "@/modules/tasks/task.model";

/**
 * The subset of each entity the search rows carry. The `score` projected from
 * the text index is not a stored field, so it has to be added to the lean
 * result type rather than read off the document.
 */
type ScoredRow = { _id: unknown; score: number };

/** Make a query result observable so the JIT cannot elide the round trip. */
function consume(value: unknown): number {
  if (Array.isArray(value)) {
    return value.length + (value[0] ? JSON.stringify(value[0]).length : 0);
  }
  return value === undefined ? 0 : 1;
}

let mongoServer: MongoMemoryServer;
let orgId: Types.ObjectId;
let userId: Types.ObjectId;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await connectToDatabase();

  const mongoose = await import("mongoose");
  orgId = new mongoose.Types.ObjectId();
  userId = new mongoose.Types.ObjectId();

  // Create text indexes (required for $text search)
  await ContactModel.createIndexes();
  await CompanyModel.createIndexes();
  await DealModel.createIndexes();
  await TaskModel.createIndexes();

  // Seed realistic test data (smaller volume for faster benchmarks)
  const now = new Date();

  // Create ~1000 contacts
  const contacts = [];
  const firstNames = [
    "John",
    "Jane",
    "Michael",
    "Sarah",
    "David",
    "Emily",
    "Robert",
    "Lisa",
    "James",
    "Amanda",
    "William",
    "Jessica",
    "Christopher",
    "Ashley",
    "Daniel",
    "Amanda",
    "Matthew",
    "Stephanie",
    "Anthony",
    "Nicole",
  ];
  const lastNames = [
    "Smith",
    "Johnson",
    "Williams",
    "Brown",
    "Jones",
    "Garcia",
    "Miller",
    "Davis",
    "Rodriguez",
    "Martinez",
    "Hernandez",
    "Lopez",
    "Gonzalez",
    "Wilson",
    "Anderson",
    "Thomas",
    "Taylor",
    "Moore",
    "Jackson",
    "Martin",
  ];
  const companies = [
    "Acme Corp",
    "GlobalTech",
    "InnovateInc",
    "DataSystems",
    "CloudNine",
    "NextGen",
    "FutureWorks",
    "PrimeSolutions",
  ];

  for (let i = 0; i < 1000; i++) {
    const fn = firstNames[Math.floor(Math.random() * firstNames.length)];
    const ln = lastNames[Math.floor(Math.random() * lastNames.length)];
    const company = companies[Math.floor(Math.random() * companies.length)];
    contacts.push({
      organizationId: orgId,
      firstName: fn,
      lastName: ln,
      salutation: ["Mr.", "Ms.", "Dr.", ""][Math.floor(Math.random() * 4)],
      jobTitle: [
        "Manager",
        "Director",
        "VP",
        "Engineer",
        "Analyst",
        "Consultant",
      ][Math.floor(Math.random() * 6)],
      primaryEmail: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@${company.toLowerCase().replace(/\s+/g, "")}.com`,
      emails: [
        {
          label: "Work",
          value: `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@${company.toLowerCase().replace(/\s+/g, "")}.com`,
          isPrimary: true,
        },
      ],
      phones: [
        {
          label: "Work",
          value: `555-${String(Math.floor(Math.random() * 9000) + 1000)}`,
          isPrimary: true,
        },
      ],
      companyName: company,
      status: ["LEAD", "PROSPECT", "CUSTOMER", "INACTIVE"][
        Math.floor(Math.random() * 4)
      ],
      tags: [],
      notes: `Contact ${i} notes`,
      customFields: {},
      ownerId: userId,
      lastContactedAt: null,
      mergedIntoId: null,
      createdBy: userId,
      updatedBy: userId,
    });
  }
  await ContactModel.insertMany(contacts);

  // Create ~300 companies
  const companyDocs = [];
  for (let i = 0; i < 300; i++) {
    const name = `${companies[Math.floor(Math.random() * companies.length)]} ${i}`;
    companyDocs.push({
      organizationId: orgId,
      name,
      domain: `${name.toLowerCase().replace(/\s+/g, "")}${i}.com`,
      status: ["PROSPECT", "CUSTOMER", "PARTNER", "INACTIVE"][
        Math.floor(Math.random() * 4)
      ],
      ownerId: userId,
      tags: [],
      notes: `Company ${i} notes`,
      customFields: {},
      createdBy: userId,
      updatedBy: userId,
    });
  }
  await CompanyModel.insertMany(companyDocs);

  // Create ~300 deals
  const deals = [];
  for (let i = 0; i < 300; i++) {
    const status = ["OPEN", "WON", "LOST"][Math.floor(Math.random() * 3)];
    deals.push({
      organizationId: orgId,
      name: `Deal ${i} - ${companies[Math.floor(Math.random() * companies.length)]}`,
      value: Math.floor(Math.random() * 100000) + 5000,
      status,
      pipelineId: new mongoose.Types.ObjectId(),
      stageId: new mongoose.Types.ObjectId(),
      companyId: new mongoose.Types.ObjectId(),
      contactId: new mongoose.Types.ObjectId(),
      ownerId: userId,
      currency: "USD",
      probability:
        status === "WON"
          ? 100
          : status === "LOST"
            ? 0
            : Math.floor(Math.random() * 100),
      expectedCloseDate: null,
      lostReason: null,
      description: null,
      sortOrder: i,
      tags: [],
      notes: `Deal ${i} notes`,
      customFields: {},
      createdBy: userId,
      updatedBy: userId,
    });
  }
  await DealModel.insertMany(deals);

  // Create ~300 tasks
  const tasks = [];
  for (let i = 0; i < 300; i++) {
    tasks.push({
      organizationId: orgId,
      title: `Task ${i}: ${["Call", "Email", "Meeting", "Follow up", "Proposal"][Math.floor(Math.random() * 5)]} ${firstNames[Math.floor(Math.random() * firstNames.length)]}`,
      status: ["TODO", "IN_PROGRESS", "DONE"][Math.floor(Math.random() * 3)],
      priority: ["LOW", "MEDIUM", "HIGH", "URGENT"][
        Math.floor(Math.random() * 4)
      ],
      assigneeId: userId,
      dueAt: new Date(now.getTime() + Math.random() * 30 * 24 * 60 * 60 * 1000),
      tags: [],
      notes: `Task ${i} notes`,
      customFields: {},
      createdBy: userId,
      updatedBy: userId,
      description: null,
      completedAt: null,
      related: [],
      reminders: [],
      estimatedMinutes: null,
    });
  }
  await TaskModel.insertMany(tasks);
});

afterAll(async () => {
  await mongoServer.stop();
});

describe("Search Service Benchmark", () => {
  // Test queries representing real-world usage patterns
  const searchQueries = [
    "john",
    "smith",
    "acme",
    "john smith",
    "acme corp",
    "manager",
    "director",
    "global",
    "tech",
    "john.doe",
    "jane",
    "michael",
    "william",
    "engineer",
    "vp",
    "consultant",
    "data",
    "cloud",
    "nextgen",
    "future",
  ];

  test("ContactModel $text search - single query", async ({ bench }) => {
    await bench("contact $text single query", async () => {
      const query =
        searchQueries[Math.floor(Math.random() * searchQueries.length)];
      const results = await ContactModel.find(
        { organizationId: orgId, $text: { $search: query } },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(20)
        .lean<Array<ScoredRow>>();
      return consume(results);
    }).run();
  });

  test("ContactModel $text search - exact name match", async ({ bench }) => {
    await bench("contact $text exact name", async () => {
      const results = await ContactModel.find(
        { organizationId: orgId, $text: { $search: '"John Smith"' } },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(20)
        .lean<Array<ScoredRow>>();
      return consume(results);
    }).run();
  });

  test("ContactModel $text search - email domain", async ({ bench }) => {
    await bench("contact $text email domain", async () => {
      const results = await ContactModel.find(
        { organizationId: orgId, $text: { $search: "acmecorp" } },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(20)
        .lean<Array<ScoredRow>>();
      return consume(results);
    }).run();
  });

  test("CompanyModel $text search", async ({ bench }) => {
    await bench("company $text search", async () => {
      const query =
        searchQueries[Math.floor(Math.random() * searchQueries.length)];
      const results = await CompanyModel.find(
        { organizationId: orgId, $text: { $search: query } },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(20)
        .lean<Array<ScoredRow>>();
      return consume(results);
    }).run();
  });

  test("DealModel $text search", async ({ bench }) => {
    await bench("deal $text search", async () => {
      const query =
        searchQueries[Math.floor(Math.random() * searchQueries.length)];
      const results = await DealModel.find(
        { organizationId: orgId, $text: { $search: query } },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(20)
        .lean<Array<ScoredRow>>();
      return consume(results);
    }).run();
  });

  test("TaskModel $text search", async ({ bench }) => {
    await bench("task $text search", async () => {
      const query =
        searchQueries[Math.floor(Math.random() * searchQueries.length)];
      const results = await TaskModel.find(
        { organizationId: orgId, $text: { $search: query } },
        { score: { $meta: "textScore" } },
      )
        .sort({ score: { $meta: "textScore" } })
        .limit(20)
        .lean<Array<ScoredRow>>();
      return consume(results);
    }).run();
  });

  test("Multi-collection search (simulated unified search)", async ({
    bench,
  }) => {
    await bench("unified search across 4 collections", async () => {
      const query =
        searchQueries[Math.floor(Math.random() * searchQueries.length)];

      // Simulate the unified search pattern from search-ranking tests
      const [contacts, companies, deals, tasks] = await Promise.all([
        ContactModel.find(
          { organizationId: orgId, $text: { $search: query } },
          { score: { $meta: "textScore" } },
        )
          .sort({ score: { $meta: "textScore" } })
          .limit(20)
          .lean<Array<ScoredRow>>(),
        CompanyModel.find(
          { organizationId: orgId, $text: { $search: query } },
          { score: { $meta: "textScore" } },
        )
          .sort({ score: { $meta: "textScore" } })
          .limit(20)
          .lean<Array<ScoredRow>>(),
        DealModel.find(
          { organizationId: orgId, $text: { $search: query } },
          { score: { $meta: "textScore" } },
        )
          .sort({ score: { $meta: "textScore" } })
          .limit(20)
          .lean<Array<ScoredRow>>(),
        TaskModel.find(
          { organizationId: orgId, $text: { $search: query } },
          { score: { $meta: "textScore" } },
        )
          .sort({ score: { $meta: "textScore" } })
          .limit(20)
          .lean<Array<ScoredRow>>(),
      ]);

      // Merge and deduplicate by score (as in search-ranking logic)
      const allResults = [
        ...contacts.map((c) => ({ ...c, entityType: "contact" as const })),
        ...companies.map((c) => ({ ...c, entityType: "company" as const })),
        ...deals.map((d) => ({ ...d, entityType: "deal" as const })),
        ...tasks.map((t) => ({ ...t, entityType: "task" as const })),
      ];

      allResults.sort((a, b) => (b.score || 0) - (a.score || 0));

      // Deduplicate by id (keep highest score)
      const seen = new Set<string>();
      const deduplicated = allResults.filter((r) => {
        if (seen.has(String(r._id))) return false;
        seen.add(String(r._id));
        return true;
      });

      // Limit to 50 total
      return consume(deduplicated.slice(0, 50));
    }).run();
  });

  test("Contact list with filters (no text search)", async ({ bench }) => {
    await bench("filtered contact list", async () => {
      // Test filtered list performance (similar to CRM list API)
      const results = await ContactModel.find({
        organizationId: orgId,
        status: "CUSTOMER",
      })
        .sort({ lastName: 1, firstName: 1 })
        .limit(20)
        .lean();
      return consume(results);
    }).run();
  });

  test("Contact list with regex search (fallback)", async ({ bench }) => {
    await bench("regex contact list fallback", async () => {
      // Test regex-based search for short queries
      const query = "jo"; // Short query - text search may not work well
      const results = await ContactModel.find({
        organizationId: orgId,
        $or: [
          { firstName: { $regex: query, $options: "i" } },
          { lastName: { $regex: query, $options: "i" } },
          { primaryEmail: { $regex: query, $options: "i" } },
        ],
      })
        .sort({ lastName: 1, firstName: 1 })
        .limit(20)
        .lean();
      return consume(results);
    }).run();
  });
});
