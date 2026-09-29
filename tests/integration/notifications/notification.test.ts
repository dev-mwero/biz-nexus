import { Types } from "mongoose";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  listNotifications,
  markAllRead,
  markRead,
  type NotificationChannel,
  NotificationModel,
  notify,
  registerChannel,
  registeredChannels,
  unreadCount,
} from "@/modules/notifications";
import { REDACTED } from "@/shared/lib/redact";

/**
 * Notifications.
 *
 * Three things are load-bearing here and easy to get wrong in ways that pass a
 * shallow test: nobody may read a notification that is not theirs, a redelivered
 * event must not double-notify, and asking for a channel this deployment cannot
 * send must fail loudly rather than pretend to have succeeded.
 */

const org = new Types.ObjectId();
const me = new Types.ObjectId();
const them = new Types.ObjectId();
const otherOrg = new Types.ObjectId();

const scope = { organizationId: org, userId: me };

/**
 * The only real channel: persists the row. A test double records what it was
 * handed so the service's own behaviour can be separated from delivery.
 */
let delivered: unknown[] = [];

const inApp: NotificationChannel = {
  channel: "IN_APP",
  async deliver(notification) {
    delivered.push(notification);
    await NotificationModel.create({
      organizationId: notification.organizationId,
      userId: notification.userId,
      type: notification.type,
      channel: "IN_APP",
      title: notification.title,
      body: notification.body,
      data: notification.data,
      ...(notification.dedupeKey ? { dedupeKey: notification.dedupeKey } : {}),
      // A replayed event must not appear in the bell as if it just happened.
      ...(notification.occurredAt
        ? { createdAt: notification.occurredAt }
        : {}),
    });
  },
};

beforeAll(async () => {
  await connectToDatabase();
  registerChannel(inApp);
});

beforeEach(async () => {
  await NotificationModel.deleteMany({});
  delivered = [];
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

describe("notify", () => {
  it("lands a notification in the bell", async () => {
    await send({ title: "Task assigned", type: "TASK_ASSIGNED" });

    const rows = await listNotifications(scope);
    expect(rows).toHaveLength(1);
    expect(rows[0].title).toBe("Task assigned");
    expect(rows[0].type).toBe("TASK_ASSIGNED");
    expect(rows[0].channel).toBe("IN_APP");
    expect(rows[0].readAt).toBeNull();
  });

  it("returns null, because delivery is the channel's business", async () => {
    // Returning the row would invite a caller to treat "I got a notification
    // back" as proof a new one was delivered.
    expect(await send()).toBeNull();
  });

  it("delivers to the recipient and not to the sender or anyone else", async () => {
    await send();

    expect(await NotificationModel.countDocuments({ userId: me })).toBe(1);
    expect(await NotificationModel.countDocuments({ userId: them })).toBe(0);
  });

  it("does not duplicate a redelivered event", async () => {
    const key = "task.5f0:assigned";
    await send({ dedupeKey: key });
    await send({ dedupeKey: key });
    await send({ dedupeKey: key });

    // A message queue redelivers. The user should not see it three times.
    expect(await NotificationModel.countDocuments({ dedupeKey: key })).toBe(1);
  });

  it("returns null rather than throwing on a redelivery", async () => {
    await send({ dedupeKey: "k" });

    // The caller asked once and the effect happened once. An error here would
    // turn a working retry queue into a stream of failed jobs.
    expect(await send({ dedupeKey: "k" })).toBeNull();
  });

  it("deduplicates per user, not globally", async () => {
    // Two people being assigned the same task is two notifications.
    await send({ dedupeKey: "task.5f0:assigned" });
    await send({ dedupeKey: "task.5f0:assigned", userId: them });

    expect(
      await NotificationModel.countDocuments({
        dedupeKey: "task.5f0:assigned",
      }),
    ).toBe(2);
  });

  it("deduplicates per organization, not globally", async () => {
    await send({ dedupeKey: "task.5f0:assigned" });
    await send({
      dedupeKey: "task.5f0:assigned",
      organizationId: otherOrg,
      userId: them,
    });

    expect(
      await NotificationModel.countDocuments({
        dedupeKey: "task.5f0:assigned",
      }),
    ).toBe(2);
  });

  it("allows any number of notifications without a dedupe key", async () => {
    // The trap this guards: a `sparse: true` unique index also indexes a
    // document whose key is present but null, so every undeduped notification
    // for one user would collide with every other one, and the second send
    // would be silently swallowed.
    await send();
    await send();
    await send();

    expect(await NotificationModel.countDocuments({ userId: me })).toBe(3);
  });

  it("still stores a row when dedupeKey is absent, rather than writing null", async () => {
    await send();

    const row = await NotificationModel.findOne({ userId: me }).lean();
    // Present-as-null would be indexed by a sparse index and would collide.
    expect(row?.dedupeKey).toBeUndefined();
  });

  it("redacts secrets in the deep link", async () => {
    await send({ data: { href: "/app/tasks/1", token: "reset-me" } });

    const row = await NotificationModel.findOne({ userId: me }).lean();
    expect(row?.data.href).toBe("/app/tasks/1");
    expect(row?.data.token).toBe(REDACTED);
  });

  it("fails loudly for a channel this deployment cannot send", async () => {
    // The alternative - store the row, skip delivery - leaves a caller
    // believing an email went out. That failure surfaces days later as a
    // support ticket instead of at the call site.
    await expect(send({ channel: "EMAIL" })).rejects.toMatchObject({
      code: "INTERNAL",
    });
  });

  it("does not store anything for an undeliverable channel", async () => {
    await expect(send({ channel: "EMAIL" })).rejects.toThrow();

    expect(await NotificationModel.countDocuments({})).toBe(0);
  });

  it("does not leak the missing provider to the client", async () => {
    let caught: { expose?: boolean; message: string } | undefined;
    try {
      await send({ channel: "SMS" });
    } catch (error) {
      caught = error as { expose?: boolean; message: string };
    }

    // "No SMS provider is configured" is useful to a developer and tells a
    // user nothing they can act on.
    expect(caught?.expose).toBe(false);
    expect(caught?.message).not.toMatch(/sms|provider/i);
  });

  it("propagates a genuine delivery failure rather than calling it a redelivery", async () => {
    // Only a 11000 means "already sent". Swallowing every error would make a
    // broken provider look like a working one.
    const broken: NotificationChannel = {
      channel: "IN_APP",
      async deliver() {
        throw new Error("provider unreachable");
      },
    };
    const original = delivered;
    delivered = [];
    registerChannel(broken);

    try {
      await expect(send()).rejects.toThrow("provider unreachable");
    } finally {
      registerChannel(inApp);
      delivered = original;
    }
  });

  it("exposes the channels it can actually send", () => {
    expect(registeredChannels()).toContain("IN_APP");
  });
});

describe("markRead", () => {
  it("marks a notification read and stamps the time", async () => {
    await send();
    const row = await listNotifications(scope);
    const at = new Date("2026-03-04T10:00:00.000Z");

    const read = await markRead(scope, row[0]._id, at);

    expect(read.readAt?.toISOString()).toBe(at.toISOString());
    expect(await unreadCount(scope)).toBe(0);
  });

  it("keeps the first-read time when read twice", async () => {
    await send();
    const row = await listNotifications(scope);
    const first = new Date("2026-03-04T10:00:00.000Z");
    const later = new Date("2026-03-05T10:00:00.000Z");

    await markRead(scope, row[0]._id, first);
    const again = await markRead(scope, row[0]._id, later);

    // "When did they read this" is the question the field answers. Rewriting
    // it on a second click answers a question nobody asked.
    expect(again.readAt?.toISOString()).toBe(first.toISOString());
  });

  it("is a success when already read, not a conflict", async () => {
    await send();
    const row = await listNotifications(scope);
    await markRead(scope, row[0]._id);

    // A double-click on a button should not raise an error.
    await expect(markRead(scope, row[0]._id)).resolves.toBeDefined();
  });

  it("cannot mark another user's notification read", async () => {
    await send();
    const row = await listNotifications(scope);

    await expect(
      markRead({ organizationId: org, userId: them }, row[0]._id),
    ).rejects.toMatchObject({ code: "RECORD_NOT_FOUND" });

    // The failure must be a refusal, not a successful write to the wrong row.
    const stored = await NotificationModel.findById(row[0]._id).lean();
    expect(stored?.readAt).toBeNull();
  });

  it("cannot mark a notification in another organization read", async () => {
    await send();
    const row = await listNotifications(scope);

    await expect(
      markRead({ organizationId: otherOrg, userId: me }, row[0]._id),
    ).rejects.toMatchObject({ code: "RECORD_NOT_FOUND" });

    const stored = await NotificationModel.findById(row[0]._id).lean();
    expect(stored?.readAt).toBeNull();
  });

  it("cannot be used to probe whether a notification id exists", async () => {
    await send();
    const row = await listNotifications(scope);
    const missing = new Types.ObjectId();

    const other = await markRead(
      { organizationId: org, userId: them },
      row[0]._id,
    ).catch((error: unknown) => error);
    const absent = await markRead(
      { organizationId: org, userId: them },
      missing,
    ).catch((error: unknown) => error);

    // Identical, not merely similar: a differing message or status turns the
    // endpoint into an oracle for which notification ids are real.
    expect(other).toEqual(absent);
  });
});

describe("markAllRead", () => {
  it("marks only this user's unread notifications", async () => {
    await send();
    await send();
    await send({ userId: them });

    const changed = await markAllRead(scope);

    expect(changed).toBe(2);
    expect(await unreadCount(scope)).toBe(0);
    expect(await unreadCount({ organizationId: org, userId: them })).toBe(1);
  });

  it("leaves another organization's notifications alone", async () => {
    await send();
    await send({ organizationId: otherOrg, userId: me });

    await markAllRead(scope);

    expect(await unreadCount(scope)).toBe(0);
    expect(await unreadCount({ organizationId: otherOrg, userId: me })).toBe(1);
  });

  it("does not rewrite the read time of already-read notifications", async () => {
    await send();
    await send();
    const rows = await listNotifications(scope);
    const first = new Date("2026-03-04T10:00:00.000Z");
    await markRead(scope, rows[0]._id, first);

    await markAllRead(scope, new Date("2026-03-09T10:00:00.000Z"));

    const stored = await NotificationModel.findById(rows[0]._id).lean();
    expect(stored?.readAt?.toISOString()).toBe(first.toISOString());
  });
});

describe("listNotifications", () => {
  it("returns newest first", async () => {
    await send({
      title: "oldest",
      occurredAt: new Date("2026-03-01T00:00:00.000Z"),
    });
    await send({
      title: "newest",
      occurredAt: new Date("2026-03-05T00:00:00.000Z"),
    });
    await send({
      title: "middle",
      occurredAt: new Date("2026-03-03T00:00:00.000Z"),
    });

    const rows = await listNotifications(scope);

    expect(rows.map((r) => r.title)).toEqual(["newest", "middle", "oldest"]);
  });

  it("shows only the caller's notifications", async () => {
    await send();
    await send({ userId: them });

    const rows = await listNotifications(scope);

    expect(rows).toHaveLength(1);
    expect(rows.every((r) => r.userId.equals(me))).toBe(true);
  });

  it("shows nothing from another organization", async () => {
    await send();
    await send({ organizationId: otherOrg, userId: me });

    expect(await listNotifications(scope)).toHaveLength(1);
  });

  it("pages with a cursor without repeating a row", async () => {
    for (const day of ["01", "02", "03", "04", "05"]) {
      await send({
        title: `day ${day}`,
        occurredAt: new Date(`2026-03-${day}T00:00:00.000Z`),
      });
    }

    const first = await listNotifications({ ...scope, limit: 2 });
    const second = await listNotifications({
      ...scope,
      limit: 2,
      before: first[first.length - 1].createdAt,
    });

    const titles = [...first, ...second].map((r) => r.title);
    expect(titles).toEqual(["day 05", "day 04", "day 03", "day 02"]);
    expect(new Set(titles).size).toBe(titles.length);
  });

  it("caps the page size rather than trusting the caller", async () => {
    for (let i = 0; i < 5; i++) await send({ title: `n${i}` });

    expect(await listNotifications({ ...scope, limit: 10_000 })).toHaveLength(
      5,
    );
  });
});

describe("unreadCount", () => {
  it("counts only this user's unread notifications", async () => {
    await send();
    await send();
    await send({ userId: them });
    await send({ organizationId: otherOrg, userId: me });

    expect(await unreadCount(scope)).toBe(2);
  });

  it("drops to zero as they are read", async () => {
    await send();
    await send();

    expect(await unreadCount(scope)).toBe(2);
    await markAllRead(scope);
    expect(await unreadCount(scope)).toBe(0);
  });
});

describe("the bell indexes", () => {
  it("carries the bell, unread-count and dedupe indexes the spec names", () => {
    const specs = NotificationModel.schema.indexes().map(([spec]) => spec);

    expect(specs).toContainEqual({
      organizationId: 1,
      userId: 1,
      readAt: 1,
      createdAt: -1,
    });
    expect(specs).toContainEqual({
      organizationId: 1,
      userId: 1,
      dedupeKey: 1,
    });
  });

  it("makes the dedupe index unique and partial, not merely sparse", () => {
    const entry = NotificationModel.schema
      .indexes()
      .find(([, options]) => options?.name === "notification_dedupe_unique");

    expect(entry?.[1]?.unique).toBe(true);
    // `sparse` would also index a null dedupeKey, which collides every
    // undeduped notification for one user against all the others.
    expect(entry?.[1]?.sparse).toBeUndefined();
    expect(entry?.[1]?.partialFilterExpression).toEqual({
      dedupeKey: { $type: "string" },
    });
  });
});
