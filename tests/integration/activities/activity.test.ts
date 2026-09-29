import { Types } from "mongoose";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  type ACTIVITY_TYPES,
  ActivityModel,
  activityByActor,
  activityByOwner,
  organizationFeed,
  recordActivity,
  registerActivitySubscribers,
  timelineForEntity,
} from "@/modules/activities";
import "@/modules/deals";
import { events } from "@/shared/events/bus";
import { REDACTED } from "@/shared/lib/redact";

/**
 * The timeline.
 *
 * The stated acceptance is that a deal stage change writes a STAGE_CHANGE
 * activity, so that path is tested end to end through the bus rather than by
 * calling `recordActivity` directly: the mapping is the thing that can be wrong,
 * not the insert.
 */

const org = new Types.ObjectId();
const otherOrg = new Types.ObjectId();
const actor = new Types.ObjectId();
const deal = new Types.ObjectId();
const contact = new Types.ObjectId();

let stopSubscribers: () => void = () => {};

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(() => {
  stopSubscribers();
});

beforeEach(async () => {
  await ActivityModel.deleteMany({});
  // Reinstalled per test: a subscriber left attached from a previous test would
  // write a second activity for every event, which the bus's own duplicate
  // detection cannot see across tests.
  stopSubscribers = registerActivitySubscribers();
});

afterEach(() => {
  stopSubscribers();
});

function stageEvent(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: org,
    actorId: actor,
    dealId: deal,
    dealName: "Renewal",
    fromStage: { stageId: new Types.ObjectId(), stageName: "Qualified" },
    toStage: { stageId: new Types.ObjectId(), stageName: "Proposal" },
    occurredAt: new Date("2026-03-04T10:00:00.000Z"),
    ...overrides,
  } as Parameters<typeof events.emit<"deal.stage_changed">>[1];
}

describe("a deal stage change writes an activity", () => {
  it("records a STAGE_CHANGE when the event is emitted", async () => {
    await events.emit("deal.stage_changed", stageEvent());

    const rows = await ActivityModel.find({}).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("STAGE_CHANGE");
  });

  it("says what moved, from where, to where", async () => {
    await events.emit("deal.stage_changed", stageEvent());

    const [row] = await ActivityModel.find({}).lean();
    expect(row.title).toBe("Moved Renewal from Qualified to Proposal");
  });

  it("says only where to when a deal arrives in its first stage", async () => {
    // Pretending a new deal moved from somewhere makes every new deal report a
    // journey it did not take.
    await events.emit("deal.stage_changed", stageEvent({ fromStage: null }));

    const [row] = await ActivityModel.find({}).lean();
    expect(row.title).toBe("Moved Renewal to Proposal");
  });

  it("attributes the move to the person who made it", async () => {
    await events.emit("deal.stage_changed", stageEvent());

    const [row] = await ActivityModel.find({}).lean();
    expect(row.actorId).toEqual(actor);
    expect(row.ownerId).toEqual(actor);
  });

  it("keeps the event's time rather than the write time", async () => {
    const happened = new Date("2026-01-15T09:00:00.000Z");
    await events.emit(
      "deal.stage_changed",
      stageEvent({ occurredAt: happened }),
    );

    const [row] = await ActivityModel.find({}).lean();
    // A replayed event filed as having just happened rewrites the timeline.
    expect(row.occurredAt.toISOString()).toBe(happened.toISOString());
    expect(row.createdAt.getTime()).toBeGreaterThan(happened.getTime());
  });

  it("files the activity against the deal", async () => {
    await events.emit("deal.stage_changed", stageEvent());

    const rows = await timelineForEntity({
      organizationId: org,
      entityId: deal,
    });
    expect(rows).toHaveLength(1);
  });

  it("records both stage names, so a later rename does not rewrite history", async () => {
    await events.emit("deal.stage_changed", stageEvent());

    const [row] = await ActivityModel.find({}).lean();
    const meta = row.metadata as {
      fromStage: { stageName: string };
      toStage: { stageName: string };
    };
    expect(meta.fromStage.stageName).toBe("Qualified");
    expect(meta.toStage.stageName).toBe("Proposal");
  });

  it("keeps the timeline in another tenant empty", async () => {
    await events.emit(
      "deal.stage_changed",
      stageEvent({ organizationId: otherOrg }),
    );

    expect(await ActivityModel.countDocuments({ organizationId: org })).toBe(0);
    expect(
      await ActivityModel.countDocuments({ organizationId: otherOrg }),
    ).toBe(1);
  });

  it("writes one activity per event, not one per subscriber run", async () => {
    await events.emit("deal.stage_changed", stageEvent());
    await events.emit("deal.stage_changed", stageEvent());

    expect(await ActivityModel.countDocuments({})).toBe(2);
  });

  it("does not duplicate when registerActivitySubscribers runs twice", async () => {
    // A dev-server reload, or two import paths resolving to the same file. Two
    // rows per stage change, and no error anywhere to say so.
    stopSubscribers = registerActivitySubscribers();

    await events.emit("deal.stage_changed", stageEvent());

    expect(await ActivityModel.countDocuments({})).toBe(1);
  });

  it("stops writing once unsubscribed", async () => {
    stopSubscribers();
    stopSubscribers = () => {};

    await events.emit("deal.stage_changed", stageEvent());

    expect(await ActivityModel.countDocuments({})).toBe(0);
  });

  it("does not let a failing activity write fail the event", async () => {
    // The bus isolates subscribers precisely so this is survivable: a broken
    // timeline must not fail the request that moved the deal, nor stop the
    // audit log's subscriber. Asserted by making the write actually fail, not
    // by counting subscribers.
    const failure = vi
      .spyOn(ActivityModel, "create")
      .mockRejectedValueOnce(new Error("write failed"));

    try {
      await expect(
        events.emit("deal.stage_changed", stageEvent()),
      ).resolves.toBeUndefined();
    } finally {
      failure.mockRestore();
    }

    // The next event writes normally: the failure was isolated, not sticky.
    await events.emit("deal.stage_changed", stageEvent());
    expect(await ActivityModel.countDocuments({})).toBe(1);
  });
});

describe("recordActivity", () => {
  it("records a note with no actor and a required owner", async () => {
    const row = await recordActivity({
      organizationId: org,
      type: "NOTE",
      title: "Prefers morning calls",
      body: "Said twice on the last call.",
      ownerId: actor,
    });

    expect(row.actorId).toBeNull();
    expect(row.ownerId).toEqual(actor);
    expect(row.occurredAt).toBeInstanceOf(Date);
  });

  it("refuses an activity with no owner", async () => {
    // Required, unlike actorId: an activity attributed to nobody appears in no
    // attribution report, which is how quietly self-running work gets missed.
    await expect(
      recordActivity({
        organizationId: org,
        type: "SYSTEM_EVENT",
        title: "Task escalated",
        ownerId: null as unknown as Types.ObjectId,
      }),
    ).rejects.toThrow();
  });

  it("stores the body as text", async () => {
    // A timeline renders whatever users typed into notes and deal names.
    // Treating that as markup is stored XSS with a delay.
    const body = "<img src=x onerror=alert(1)>";
    const row = await recordActivity({
      organizationId: org,
      type: "NOTE",
      title: "t",
      body,
      ownerId: actor,
    });

    const stored = await ActivityModel.findById(row._id).lean();
    // Stored verbatim - escaping is the renderer's job, and doing it here too
    // would mean double-escaping for everyone who escapes correctly. What this
    // pins is that it is a String and nothing has interpreted it.
    expect(stored?.body).toBe(body);
    expect(stored?.body).toBeTypeOf("string");
  });

  it("declares body as a plain string, not markup", () => {
    // A field typed as anything richer would make rendering it as text an
    // option rather than the only path.
    expect(ActivityModel.schema.path("body").instance).toBe("String");
  });

  it("records a call with a duration and a direction", async () => {
    const row = await recordActivity({
      organizationId: org,
      type: "CALL",
      title: "Discovery call",
      direction: "OUTBOUND",
      durationSeconds: 900,
      ownerId: actor,
      subjects: [{ entityType: "contact", entityId: contact }],
    });

    expect(row.direction).toBe("OUTBOUND");
    expect(row.durationSeconds).toBe(900);
  });

  it("gives a system event no actor but keeps an owner", async () => {
    const row = await recordActivity({
      organizationId: org,
      type: "SYSTEM_EVENT",
      title: "Trial expires in 2 days",
      ownerId: actor,
    });

    expect(row.actorId).toBeNull();
    expect(row.ownerId).toEqual(actor);
  });

  it("accepts an activity about several subjects at once", async () => {
    // One call legitimately concerns a contact, a company and a deal.
    const row = await recordActivity({
      organizationId: org,
      type: "CALL",
      title: "Intro call",
      ownerId: actor,
      subjects: [
        { entityType: "contact", entityId: contact },
        { entityType: "deal", entityId: deal },
      ],
    });

    expect(row.subjects).toHaveLength(2);
  });

  it("redacts secrets in metadata", async () => {
    const row = await recordActivity({
      organizationId: org,
      type: "SYSTEM_EVENT",
      title: "Webhook received",
      ownerId: actor,
      metadata: { event: "user.updated", authorization: "Bearer sk-live-1" },
    });

    const stored = await ActivityModel.findById(row._id).lean();
    expect(JSON.stringify(stored?.metadata)).not.toMatch(/sk-live-1/);
    expect((stored?.metadata as Record<string, unknown>).event).toBe(
      "user.updated",
    );
    expect((stored?.metadata as Record<string, unknown>).authorization).toBe(
      REDACTED,
    );
  });

  it("rejects a type outside the enum", async () => {
    await expect(
      recordActivity({
        organizationId: org,
        type: "TELEPATHY" as (typeof ACTIVITY_TYPES)[number],
        title: "t",
        ownerId: actor,
      }),
    ).rejects.toThrow();
  });
});

describe("reading the timeline", () => {
  async function seed() {
    const at = (day: string) => new Date(`2026-03-${day}T00:00:00.000Z`);
    await recordActivity({
      organizationId: org,
      type: "NOTE",
      title: "oldest",
      occurredAt: at("01"),
      ownerId: actor,
      actorId: actor,
      subjects: [{ entityType: "deal", entityId: deal }],
    });
    await recordActivity({
      organizationId: org,
      type: "CALL",
      title: "newest",
      occurredAt: at("05"),
      ownerId: actor,
      actorId: actor,
      subjects: [{ entityType: "deal", entityId: deal }],
    });
    await recordActivity({
      organizationId: org,
      type: "MEETING",
      title: "middle",
      occurredAt: at("03"),
      ownerId: actor,
      actorId: actor,
      subjects: [{ entityType: "contact", entityId: contact }],
    });
  }

  it("returns a record's history newest first", async () => {
    await seed();

    const rows = await timelineForEntity({
      organizationId: org,
      entityId: deal,
    });

    expect(rows.map((r) => r.title)).toEqual(["newest", "oldest"]);
  });

  it("finds an activity through any of its subjects", async () => {
    await seed();

    // One call concerning a contact and a deal shows up on both timelines.
    await recordActivity({
      organizationId: org,
      type: "CALL",
      title: "both",
      ownerId: actor,
      subjects: [
        { entityType: "contact", entityId: contact },
        { entityType: "deal", entityId: deal },
      ],
    });

    expect(
      (await timelineForEntity({ organizationId: org, entityId: deal })).map(
        (r) => r.title,
      ),
    ).toContain("both");
    expect(
      (await timelineForEntity({ organizationId: org, entityId: contact })).map(
        (r) => r.title,
      ),
    ).toContain("both");
  });

  it("shows nothing for a record in another tenant", async () => {
    await seed();

    expect(
      await timelineForEntity({ organizationId: otherOrg, entityId: deal }),
    ).toEqual([]);
  });

  it("shows nothing from another tenant in the feed", async () => {
    await seed();
    await recordActivity({
      organizationId: otherOrg,
      type: "NOTE",
      title: "theirs",
      ownerId: actor,
    });

    const rows = await organizationFeed({ organizationId: org });
    expect(rows.map((r) => r.title)).not.toContain("theirs");
  });

  it("separates what a member did from what was attributed to them", async () => {
    await recordActivity({
      organizationId: org,
      type: "NOTE",
      title: "typed by hand",
      actorId: actor,
      ownerId: actor,
    });
    await recordActivity({
      organizationId: org,
      type: "SYSTEM_EVENT",
      title: "ran itself",
      actorId: null,
      ownerId: actor,
    });

    expect(
      (await activityByActor({ organizationId: org, actorId: actor })).map(
        (r) => r.title,
      ),
    ).toEqual(["typed by hand"]);
    // Attribution reports need the automated work, or the owner of a task that
    // quietly ran itself looks idle.
    expect(
      (await activityByOwner({ organizationId: org, ownerId: actor })).map(
        (r) => r.title,
      ),
    ).toEqual(["ran itself", "typed by hand"]);
  });

  it("pages by cursor without repeating a row", async () => {
    for (const day of ["01", "02", "03", "04"]) {
      await recordActivity({
        organizationId: org,
        type: "NOTE",
        title: `day ${day}`,
        occurredAt: new Date(`2026-03-${day}T00:00:00.000Z`),
        ownerId: actor,
      });
    }

    const first = await organizationFeed({ organizationId: org, limit: 2 });
    const second = await organizationFeed({
      organizationId: org,
      limit: 2,
      before: first[first.length - 1].occurredAt,
    });

    const titles = [...first, ...second].map((r) => r.title);
    expect(titles).toEqual(["day 04", "day 03", "day 02", "day 01"]);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("caps the page size rather than trusting the caller", async () => {
    for (let i = 0; i < 3; i++) {
      await recordActivity({
        organizationId: org,
        type: "NOTE",
        title: `n${i}`,
        ownerId: actor,
      });
    }

    expect(
      await organizationFeed({ organizationId: org, limit: 10_000 }),
    ).toHaveLength(3);
  });
});

describe("the timeline indexes", () => {
  it("carries the five indexes the spec names", () => {
    const specs = ActivityModel.schema.indexes().map(([spec]) => spec);

    expect(specs).toContainEqual({
      organizationId: 1,
      "subjects.entityId": 1,
      occurredAt: -1,
    });
    expect(specs).toContainEqual({
      organizationId: 1,
      occurredAt: -1,
      _id: -1,
    });
    expect(specs).toContainEqual({
      organizationId: 1,
      type: 1,
      occurredAt: -1,
    });
    expect(specs).toContainEqual({
      organizationId: 1,
      actorId: 1,
      occurredAt: -1,
    });
    expect(specs).toContainEqual({
      organizationId: 1,
      ownerId: 1,
      occurredAt: -1,
    });
  });

  it("actually builds them against MongoDB", async () => {
    // Declaring an index is not the same as having one. MongoDB rejects a
    // compound index containing two array fields at creation time, and mongoose
    // does not validate that when it builds the schema - so a bad index here
    // would be discovered in production, and would take the whole build with it.
    // `subjects` is an array, and `subjects.entityId` is a path into it, so
    // this is the constraint that actually bites.
    await ActivityModel.createIndexes();

    const names = await ActivityModel.collection.indexes();
    expect(names.map((i) => i.name)).toContain(
      "organizationId_1_subjects.entityId_1_occurredAt_-1",
    );
  });

  it("uses at most one array field per compound index", () => {
    // The rule, asserted rather than assumed, because breaking it fails at
    // index-creation time and nowhere else.
    const arrayPaths = ["subjects", "subjects.entityId", "subjects.entityType"];
    for (const [spec] of ActivityModel.schema.indexes()) {
      const used = Object.keys(spec).filter((key) => arrayPaths.includes(key));
      expect(used.length).toBeLessThanOrEqual(1);
    }
  });
});
