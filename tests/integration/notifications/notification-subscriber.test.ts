import { Types } from "mongoose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  listNotifications,
  NotificationModel,
  registerNotifications,
  unreadCount,
} from "@/modules/notifications";
import { events } from "@/shared/events/bus";

/**
 * The bell, driven by events.
 *
 * A service assigns a task or a deal, emits the matching event, and returns;
 * this is the subscriber that decides a person should hear about it. The test
 * runs the real registration -- channel and subscriber together -- so it fails
 * if either half is missing, which is the failure the whole change exists to
 * fix: in production both halves were absent and the bell was silent.
 */

const org = new Types.ObjectId();
const assignee = new Types.ObjectId();
const assigner = new Types.ObjectId();
const bystander = new Types.ObjectId();
const taskId = new Types.ObjectId();

beforeAll(async () => {
  await connectToDatabase();
  registerNotifications();
});

beforeEach(async () => {
  await NotificationModel.deleteMany({});
});

function assignedTask(overrides: Record<string, unknown> = {}) {
  return {
    organizationId: org,
    taskId,
    taskTitle: "Call the client",
    assigneeId: assignee,
    assignedBy: assigner,
    ...overrides,
  };
}

describe("task.assigned", () => {
  it("rings the assignee's bell", async () => {
    await events.emit("task.assigned", assignedTask());

    const rows = await listNotifications({
      organizationId: org,
      userId: assignee,
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("TASK_ASSIGNED");
    expect(rows[0].body).toBe("Call the client");
    expect(rows[0].readAt).toBeNull();
    expect(await unreadCount({ organizationId: org, userId: assignee })).toBe(
      1,
    );
  });

  it("deep-links to the task itself", async () => {
    await events.emit("task.assigned", assignedTask());

    const row = await NotificationModel.findOne({ userId: assignee }).lean();
    expect(row?.data.url).toBe(`/tasks/${taskId.toString()}`);
  });

  it("does not ring the assigner's bell when they assign to themselves", async () => {
    await events.emit(
      "task.assigned",
      assignedTask({ assigneeId: assigner, assignedBy: assigner }),
    );

    // Not an error, and not a row either: the person who did the assigning
    // already knows, and a bell that rings at the person holding the pen is
    // noise they learn to ignore.
    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it("addresses the notification to the assignee and no one else", async () => {
    await events.emit("task.assigned", assignedTask());

    expect(await NotificationModel.countDocuments({ userId: assignee })).toBe(
      1,
    );
    expect(await NotificationModel.countDocuments({ userId: assigner })).toBe(
      0,
    );
    expect(await NotificationModel.countDocuments({ userId: bystander })).toBe(
      0,
    );
  });

  it("scopes the notification to the organization the task belongs to", async () => {
    const otherOrg = new Types.ObjectId();
    await events.emit(
      "task.assigned",
      assignedTask({ organizationId: otherOrg }),
    );

    expect(
      await listNotifications({ organizationId: org, userId: assignee }),
    ).toHaveLength(0);
    expect(
      await listNotifications({ organizationId: otherOrg, userId: assignee }),
    ).toHaveLength(1);
  });

  it("notifies again when the same person is assigned again", async () => {
    // Deliberate: the subscriber sets no `dedupeKey`. Deduplication is for a
    // transport that can redeliver an event, and this bus cannot -- so a key
    // scoped to the entity would only suppress a genuine re-assignment. Two
    // emissions are two notifications, and the second one is one the user
    // should see.
    await events.emit("task.assigned", assignedTask());
    await events.emit("task.assigned", assignedTask());

    expect(await NotificationModel.countDocuments({ userId: assignee })).toBe(
      2,
    );
  });
});

describe("deal.assigned", () => {
  const dealId = new Types.ObjectId();
  const dealOwner = new Types.ObjectId();

  function assignedDeal(overrides: Record<string, unknown> = {}) {
    return {
      organizationId: org,
      dealId,
      dealName: "Big Deal",
      ownerId: dealOwner,
      assignedBy: assigner,
      occurredAt: new Date(),
      ...overrides,
    };
  }

  it("rings the new owner's bell, deep-linking to the deal", async () => {
    await events.emit("deal.assigned", assignedDeal());

    const rows = await listNotifications({
      organizationId: org,
      userId: dealOwner,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].type).toBe("DEAL_ASSIGNED");
    expect(rows[0].body).toBe("Big Deal");
    expect(rows[0].data.url).toBe(`/deals/${dealId.toString()}`);
  });

  it("stays quiet when someone assigns a deal to themselves", async () => {
    // Creation emits an assignment even when the creator is the owner, so this
    // is the everyday path -- a person creating their own deal -- and it must
    // not ring their bell.
    await events.emit(
      "deal.assigned",
      assignedDeal({ ownerId: assigner, assignedBy: assigner }),
    );

    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it("addresses the notification to the new owner and no one else", async () => {
    await events.emit("deal.assigned", assignedDeal());

    expect(await NotificationModel.countDocuments({ userId: dealOwner })).toBe(
      1,
    );
    expect(await NotificationModel.countDocuments({ userId: assigner })).toBe(
      0,
    );
    expect(await NotificationModel.countDocuments({ userId: assignee })).toBe(
      0,
    );
  });
});
