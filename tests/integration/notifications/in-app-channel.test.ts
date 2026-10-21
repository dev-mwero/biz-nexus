import { Types } from "mongoose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  inAppChannel,
  listNotifications,
  NotificationModel,
  notify,
  registerChannel,
  unreadCount,
} from "@/modules/notifications";

/**
 * The in-app channel, on its own.
 *
 * `notification.service.test.ts` builds its own double for `IN_APP` and tests
 * the service around it. That double is a lie about production: the shipped
 * deployment had no channel at all, and `notify()` threw for every caller. This
 * file registers the channel that ships, so the persistence, the ordering field
 * and the dedupe behaviour are asserted against the thing a user's bell
 * actually reads.
 */

const org = new Types.ObjectId();
const me = new Types.ObjectId();
const them = new Types.ObjectId();

const scope = { organizationId: org, userId: me };

beforeAll(async () => {
  await connectToDatabase();
  registerChannel(inAppChannel);
});

beforeEach(async () => {
  await NotificationModel.deleteMany({});
});

async function send(overrides: Record<string, unknown> = {}) {
  return notify({
    organizationId: org,
    userId: me,
    type: "SYSTEM",
    title: "Hello",
    body: "Something happened",
    ...overrides,
  } as Parameters<typeof notify>[0]);
}

describe("the in-app channel", () => {
  it("writes the row the bell reads", async () => {
    await send({ title: "Task assigned", type: "TASK_ASSIGNED" });

    const rows = await listNotifications(scope);

    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Task assigned");
    expect(rows[0].type).toBe("TASK_ASSIGNED");
    expect(rows[0].channel).toBe("IN_APP");
    expect(rows[0].readAt).toBeNull();
    expect(await unreadCount(scope)).toBe(1);
  });

  it("addresses only the recipient", async () => {
    await send();

    expect(await NotificationModel.countDocuments({ userId: me })).toBe(1);
    expect(await NotificationModel.countDocuments({ userId: them })).toBe(0);
  });

  it("stores the deep link so the inbox can render it", async () => {
    await send({ data: { url: "/tasks/5f0" } });

    const row = await NotificationModel.findOne({ userId: me }).lean();
    expect(row?.data.url).toBe("/tasks/5f0");
  });

  it("uses occurredAt as createdAt, so a replayed event keeps its place", async () => {
    const occurredAt = new Date("2026-03-04T10:00:00.000Z");
    await send({ occurredAt });

    const row = await NotificationModel.findOne({ userId: me }).lean();
    expect(row?.createdAt?.toISOString()).toBe(occurredAt.toISOString());
  });

  it("defaults createdAt to now when the event carries no time", async () => {
    const before = Date.now();
    await send({ title: "now" });

    const row = await NotificationModel.findOne({ userId: me }).lean();
    expect(row?.createdAt?.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("collapses a redelivered event onto its dedupe key", async () => {
    await send({ dedupeKey: "task:5f0:assigned" });
    // The second and third are the same event arriving again. The caller is
    // told nothing went wrong, and the user's bell does not grow a second row.
    expect(await send({ dedupeKey: "task:5f0:assigned" })).toBeNull();
    expect(await send({ dedupeKey: "task:5f0:assigned" })).toBeNull();

    expect(
      await NotificationModel.countDocuments({
        dedupeKey: "task:5f0:assigned",
      }),
    ).toBe(1);
  });

  it("does not write a dedupe key when none was supplied", async () => {
    await send();

    const row = await NotificationModel.findOne({ userId: me }).lean();
    // Present-as-null would be a value the partial unique index could see, so a
    // field that was never supplied must be absent rather than empty.
    expect(row?.dedupeKey).toBeUndefined();
  });

  it("still allows any number of notifications without a dedupe key", async () => {
    await send();
    await send();
    await send();

    expect(await NotificationModel.countDocuments({ userId: me })).toBe(3);
  });
});
