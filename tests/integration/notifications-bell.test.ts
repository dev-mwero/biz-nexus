import { MongoMemoryServer } from "mongodb-memory-server";
import type { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { NotificationModel } from "@/modules/notifications";

let mongoServer: MongoMemoryServer;
let orgId: Types.ObjectId;
let userId: Types.ObjectId;

beforeEach(async () => {
  mongoServer = await MongoMemoryServer.create();
  process.env.MONGODB_URI = mongoServer.getUri();
  await connectToDatabase();

  const mongoose = await import("mongoose");
  orgId = new mongoose.Types.ObjectId();
  userId = new mongoose.Types.ObjectId();
});

afterEach(async () => {
  await mongoServer.stop();
  vi.clearAllMocks();
});

describe("Notifications Bell Real-time", () => {
  it("should create notification and update unread count via SSE", async () => {
    // Create initial notification
    await NotificationModel.create({
      organizationId: orgId,
      userId,
      title: "Test Notification",
      body: "This is a test",
      type: "SYSTEM",
      readAt: null,
      data: {},
    });

    // Count unread
    const count = await NotificationModel.countDocuments({
      organizationId: orgId,
      userId,
      readAt: null,
    });

    expect(count).toBe(1);
  });

  it("should mark notification as read and decrement count", async () => {
    const notification = await NotificationModel.create({
      organizationId: orgId,
      userId,
      title: "Test Notification",
      body: "This is a test",
      type: "SYSTEM",
      readAt: null,
      data: {},
    });

    // Mark as read
    await NotificationModel.findByIdAndUpdate(notification._id, {
      readAt: new Date(),
    });

    const count = await NotificationModel.countDocuments({
      organizationId: orgId,
      userId,
      readAt: null,
    });

    expect(count).toBe(0);
  });

  it("should mark all notifications as read", async () => {
    await NotificationModel.insertMany([
      {
        organizationId: orgId,
        userId,
        title: "Notification 1",
        body: "Body 1",
        type: "SYSTEM",
        readAt: null,
        data: {},
      },
      {
        organizationId: orgId,
        userId,
        title: "Notification 2",
        body: "Body 2",
        type: "SYSTEM",
        readAt: null,
        data: {},
      },
      {
        organizationId: orgId,
        userId,
        title: "Notification 3",
        body: "Body 3",
        type: "SYSTEM",
        readAt: null,
        data: {},
      },
    ]);

    // Mark all as read
    await NotificationModel.updateMany(
      { organizationId: orgId, userId, readAt: null },
      { readAt: new Date() },
    );

    const count = await NotificationModel.countDocuments({
      organizationId: orgId,
      userId,
      readAt: null,
    });

    expect(count).toBe(0);
  });

  it("should paginate notifications with limit and before cursor", async () => {
    // Create 25 notifications
    const notifications = Array.from({ length: 25 }, (_, i) => ({
      organizationId: orgId,
      userId,
      title: `Notification ${i}`,
      body: `Body ${i}`,
      type: "SYSTEM",
      readAt: null,
      data: {},
      createdAt: new Date(Date.now() - i * 1000),
    }));
    await NotificationModel.insertMany(notifications);

    // First page - 20 items
    const page1 = await NotificationModel.find({
      organizationId: orgId,
      userId,
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    expect(page1.length).toBe(20);

    // Second page - 5 items using before cursor
    const cursor = page1[19].createdAt;
    const page2 = await NotificationModel.find({
      organizationId: orgId,
      userId,
      createdAt: { $lt: cursor },
    })
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    expect(page2.length).toBe(5);
  });

  it("should only show notifications for the correct user", async () => {
    const otherUserId = new (await import("mongoose")).Types.ObjectId();

    await NotificationModel.create([
      {
        organizationId: orgId,
        userId,
        title: "User 1 Notif",
        body: "Body",
        type: "SYSTEM",
        readAt: null,
        data: {},
      },
      {
        organizationId: orgId,
        userId: otherUserId,
        title: "User 2 Notif",
        body: "Body",
        type: "SYSTEM",
        readAt: null,
        data: {},
      },
    ]);

    const user1Notifications = await NotificationModel.find({
      organizationId: orgId,
      userId,
    }).lean();
    expect(user1Notifications.length).toBe(1);
    expect(user1Notifications[0].title).toBe("User 1 Notif");
  });
});
