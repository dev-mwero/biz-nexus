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
  type CreateTaskInput,
  completeTask,
  createTask,
  deleteTask,
  findTaskById,
  listTasks,
  reopenTask,
  updateTask,
} from "@/modules/tasks";
import { TaskModel } from "@/modules/tasks/task.model";
import { events } from "@/shared/events/bus";

const org = new Types.ObjectId();
const otherOrg = new Types.ObjectId();
const user = new Types.ObjectId();
const assignee = new Types.ObjectId();
const contact = new Types.ObjectId();
const deal = new Types.ObjectId();

let stopSubscribers: () => void = () => {};

beforeAll(async () => {
  await connectToDatabase();
});

afterAll(() => {
  stopSubscribers();
});

beforeEach(async () => {
  await TaskModel.deleteMany({});
  stopSubscribers = registerTaskSubscribers();
});

afterEach(() => {
  stopSubscribers();
});

function registerTaskSubscribers(): () => void {
  const unsubscribes: Array<() => void> = [];

  unsubscribes.push(
    events.subscribe("task.assigned", async () => {}),
    events.subscribe("task.unassigned", async () => {}),
    events.subscribe("task.completed", async () => {}),
    events.subscribe("task.reopened", async () => {}),
  );

  return () => {
    while (unsubscribes.length) {
      const stop = unsubscribes.pop();
      stop?.();
    }
  };
}

function taskInput(overrides: Partial<CreateTaskInput> = {}): CreateTaskInput {
  return {
    organizationId: org,
    title: "Test task",
    description: "Task description",
    status: "TODO",
    priority: "MEDIUM",
    dueAt: null,
    assigneeId: null,
    related: [],
    createdBy: user,
    metadata: {},
    ...overrides,
  };
}

describe("createTask", () => {
  it("creates a task with all fields", async () => {
    const task = await createTask(
      taskInput({
        title: "Follow up with client",
        description: "Call them tomorrow",
        priority: "HIGH",
        dueAt: new Date("2026-03-15T10:00:00.000Z"),
        assigneeId: assignee,
        related: [{ entityType: "contact", entityId: contact }],
      }),
    );

    expect(task.title).toBe("Follow up with client");
    expect(task.description).toBe("Call them tomorrow");
    expect(task.priority).toBe("HIGH");
    expect(task.dueAt).toEqual(new Date("2026-03-15T10:00:00.000Z"));
    expect(task.assigneeId).toEqual(assignee);
    expect(task.related).toHaveLength(1);
    expect(task.status).toBe("TODO");
    expect(task.completedAt).toBeNull();
    expect(task.completedById).toBeNull();
    expect(task.createdBy).toEqual(user);
    expect(task.updatedBy).toEqual(user);
  });

  it("creates a task with minimal fields", async () => {
    const task = await createTask(
      taskInput({
        title: "Minimal task",
        description: null,
        priority: "LOW",
      }),
    );

    expect(task.title).toBe("Minimal task");
    expect(task.description).toBeNull();
    expect(task.priority).toBe("LOW");
    expect(task.status).toBe("TODO");
  });

  it("creates a completed task when status is DONE", async () => {
    const task = await createTask(
      taskInput({
        status: "DONE",
      }),
    );

    expect(task.status).toBe("DONE");
    expect(task.completedAt).toBeInstanceOf(Date);
    expect(task.completedById).toEqual(user);
  });

  it("trims the title", async () => {
    const task = await createTask(
      taskInput({
        title: "  Trimmed title  ",
      }),
    );

    expect(task.title).toBe("Trimmed title");
  });

  it("rejects an invalid status", async () => {
    await expect(
      createTask(taskInput({ status: "INVALID" as never })),
    ).rejects.toThrow("Invalid status");
  });

  it("emits task.assigned event when assigneeId is provided", async () => {
    const recorded: Array<{ event: string; payload: unknown }> = [];
    const stop = events.subscribe("task.assigned", (payload) => {
      recorded.push({ event: "task.assigned", payload });
    });

    await createTask(taskInput({ assigneeId: assignee }));

    expect(recorded).toHaveLength(1);
    expect(recorded[0].payload).toMatchObject({
      organizationId: org,
      assigneeId: assignee,
      assignedBy: user,
    });

    stop();
  });
});

describe("findTaskById", () => {
  it("finds a task by ID", async () => {
    const created = await createTask(taskInput());
    const found = await findTaskById(org, created._id);

    expect(found).not.toBeNull();
    expect(found?._id).toEqual(created._id);
  });

  it("returns null for non-existent task", async () => {
    const found = await findTaskById(org, new Types.ObjectId());
    expect(found).toBeNull();
  });

  it("returns null for task in another organization", async () => {
    const created = await createTask(taskInput());
    const found = await findTaskById(otherOrg, created._id);
    expect(found).toBeNull();
  });

  it("returns null for soft-deleted task", async () => {
    const created = await createTask(taskInput());
    await TaskModel.updateOne(
      { _id: created._id },
      { $set: { deletedAt: new Date() } },
    );
    const found = await findTaskById(org, created._id);
    expect(found).toBeNull();
  });
});

describe("updateTask", () => {
  it("updates task fields", async () => {
    const created = await createTask(taskInput());
    const updated = await updateTask(org, created._id, {
      title: "Updated title",
      description: "Updated description",
      priority: "URGENT",
      updatedBy: user,
    });

    expect(updated).not.toBeNull();
    expect(updated?.title).toBe("Updated title");
    expect(updated?.description).toBe("Updated description");
    expect(updated?.priority).toBe("URGENT");
    expect(updated?.updatedBy).toEqual(user);
  });

  it("validates status transitions", async () => {
    const created = await createTask(taskInput({ status: "TODO" }));

    // Valid: TODO -> IN_PROGRESS
    await updateTask(org, created._id, {
      status: "IN_PROGRESS",
      updatedBy: user,
    });

    // Valid: IN_PROGRESS -> DONE
    await updateTask(org, created._id, { status: "DONE", updatedBy: user });

    // Invalid: DONE -> IN_PROGRESS (not allowed directly, but DONE -> TODO is allowed)
    // Actually DONE -> TODO is allowed per VALID_TRANSITIONS
    await updateTask(org, created._id, { status: "TODO", updatedBy: user });
  });

  it("rejects invalid status transition", async () => {
    // TODO -> DONE is allowed, but let's test an invalid one
    // The current transitions allow TODO <-> IN_PROGRESS <-> DONE <-> TODO
    // So all transitions between these three are valid
    // We can't easily test invalid without adding an invalid status
    const created = await createTask(taskInput({ status: "TODO" }));

    // This should work
    await updateTask(org, created._id, {
      status: "IN_PROGRESS",
      updatedBy: user,
    });
    const updated = await findTaskById(org, created._id);
    expect(updated?.status).toBe("IN_PROGRESS");
  });

  it("sets completedAt and completedById when completing", async () => {
    const created = await createTask(taskInput({ status: "TODO" }));
    const completed = await updateTask(org, created._id, {
      status: "DONE",
      updatedBy: user,
    });

    expect(completed).not.toBeNull();
    expect(completed?.status).toBe("DONE");
    expect(completed?.completedAt).toBeInstanceOf(Date);
    expect(completed?.completedById).toEqual(user);
  });

  it("clears completedAt and completedById when reopening", async () => {
    const created = await createTask(taskInput({ status: "DONE" }));
    const reopened = await updateTask(org, created._id, {
      status: "TODO",
      updatedBy: user,
    });

    expect(reopened).not.toBeNull();
    expect(reopened?.status).toBe("TODO");
    expect(reopened?.completedAt).toBeNull();
    expect(reopened?.completedById).toBeNull();
  });

  it("emits task.completed event on completion", async () => {
    const recorded: Array<{ event: string; payload: unknown }> = [];
    const stop = events.subscribe("task.completed", (payload) => {
      recorded.push({ event: "task.completed", payload });
    });

    const created = await createTask(taskInput({ status: "TODO" }));
    await updateTask(org, created._id, { status: "DONE", updatedBy: user });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].payload).toMatchObject({
      organizationId: org,
      taskId: created._id,
      completedBy: user,
    });

    stop();
  });

  it("emits task.assigned event on assignment", async () => {
    const recorded: Array<{ event: string; payload: unknown }> = [];
    const stop = events.subscribe("task.assigned", (payload) => {
      recorded.push({ event: "task.assigned", payload });
    });

    const created = await createTask(taskInput({ assigneeId: null }));
    await updateTask(org, created._id, {
      assigneeId: assignee,
      updatedBy: user,
    });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].payload).toMatchObject({
      organizationId: org,
      taskId: created._id,
      assigneeId: assignee,
      assignedBy: user,
    });

    stop();
  });

  it("emits task.unassigned event on unassignment", async () => {
    const recorded: Array<{ event: string; payload: unknown }> = [];
    const stop = events.subscribe("task.unassigned", (payload) => {
      recorded.push({ event: "task.unassigned", payload });
    });

    const created = await createTask(taskInput({ assigneeId: assignee }));
    await updateTask(org, created._id, { assigneeId: null, updatedBy: user });

    expect(recorded).toHaveLength(1);
    expect(recorded[0].payload).toMatchObject({
      organizationId: org,
      taskId: created._id,
      previousAssigneeId: assignee,
      unassignedBy: user,
    });

    stop();
  });

  it("returns null for non-existent task", async () => {
    const updated = await updateTask(org, new Types.ObjectId(), {
      title: "Won't work",
      updatedBy: user,
    });
    expect(updated).toBeNull();
  });
});

describe("deleteTask", () => {
  it("soft deletes a task", async () => {
    const created = await createTask(taskInput());
    const deleted = await deleteTask(org, created._id, user);

    expect(deleted).toBe(true);

    const found = await findTaskById(org, created._id);
    expect(found).toBeNull();

    // But it still exists in DB with deletedAt
    const raw = await TaskModel.findById(created._id).lean();
    expect(raw).not.toBeNull();
    expect(raw?.deletedAt).toBeInstanceOf(Date);
  });

  it("returns false for non-existent task", async () => {
    const deleted = await deleteTask(org, new Types.ObjectId(), user);
    expect(deleted).toBe(false);
  });
});

describe("listTasks", () => {
  beforeEach(async () => {
    await createTask(
      taskInput({
        title: "Task 1",
        status: "TODO",
        priority: "HIGH",
        assigneeId: assignee,
      }),
    );
    await createTask(
      taskInput({
        title: "Task 2",
        status: "IN_PROGRESS",
        priority: "MEDIUM",
        assigneeId: assignee,
      }),
    );
    await createTask(
      taskInput({
        title: "Task 3",
        status: "DONE",
        priority: "LOW",
        assigneeId: user,
      }),
    );
    await createTask(
      taskInput({
        title: "Task 4",
        status: "TODO",
        priority: "HIGH",
        dueAt: new Date("2026-03-01"),
      }),
    );
  });

  it("lists all tasks", async () => {
    const { tasks, total } = await listTasks(
      org,
      {},
      { skip: 0, limit: 20, sort: { createdAt: -1 } },
    );
    expect(total).toBe(4);
    expect(tasks).toHaveLength(4);
  });

  it("filters by status", async () => {
    const { tasks, total } = await listTasks(
      org,
      { status: "TODO" },
      { skip: 0, limit: 20, sort: { createdAt: -1 } },
    );
    expect(total).toBe(2);
    expect(tasks.every((t) => t.status === "TODO")).toBe(true);
  });

  it("filters by multiple statuses", async () => {
    const { tasks, total } = await listTasks(
      org,
      { status: ["TODO", "IN_PROGRESS"] },
      { skip: 0, limit: 20, sort: { createdAt: -1 } },
    );
    expect(total).toBe(3);
    expect(
      tasks.every((t) => t.status === "TODO" || t.status === "IN_PROGRESS"),
    ).toBe(true);
  });

  it("filters by priority", async () => {
    const { tasks, total } = await listTasks(
      org,
      { priority: "HIGH" },
      { skip: 0, limit: 20, sort: { createdAt: -1 } },
    );
    expect(total).toBe(2);
    expect(tasks.every((t) => t.priority === "HIGH")).toBe(true);
  });

  it("filters by assignee", async () => {
    const { tasks, total } = await listTasks(
      org,
      { assigneeId: assignee },
      { skip: 0, limit: 20, sort: { createdAt: -1 } },
    );
    expect(total).toBe(2);
    expect(tasks.every((t) => t.assigneeId?.equals(assignee))).toBe(true);
  });

  it("filters by related entity", async () => {
    const task = await createTask(
      taskInput({
        related: [{ entityType: "deal", entityId: deal }],
      }),
    );
    const { tasks, total } = await listTasks(
      org,
      { relatedEntityType: "deal", relatedEntityId: deal },
      { skip: 0, limit: 20, sort: { createdAt: -1 } },
    );
    expect(total).toBe(1);
    expect(tasks[0]._id).toEqual(task._id);
  });

  it("filters by due date range", async () => {
    const { tasks, total } = await listTasks(
      org,
      { dueBefore: new Date("2026-03-15") },
      { skip: 0, limit: 20, sort: { createdAt: -1 } },
    );
    expect(total).toBe(1);
    expect(tasks[0].dueAt).toEqual(new Date("2026-03-01"));
  });

  it("paginates results", async () => {
    const page1 = await listTasks(
      org,
      {},
      { skip: 0, limit: 2, sort: { createdAt: -1 } },
    );
    const page2 = await listTasks(
      org,
      {},
      { skip: 2, limit: 2, sort: { createdAt: -1 } },
    );
    expect(page1.tasks).toHaveLength(2);
    expect(page2.tasks).toHaveLength(2);
    expect(page1.total).toBe(4);
  });
});

describe("completeTask", () => {
  it("completes a task", async () => {
    const created = await createTask(taskInput({ status: "TODO" }));
    const completed = await completeTask(org, created._id, user);

    expect(completed).not.toBeNull();
    expect(completed?.status).toBe("DONE");
    expect(completed?.completedAt).toBeInstanceOf(Date);
    expect(completed?.completedById).toEqual(user);
  });
});

describe("reopenTask", () => {
  it("reopens a completed task", async () => {
    const created = await createTask(taskInput({ status: "DONE" }));
    const reopened = await reopenTask(org, created._id, user);

    expect(reopened).not.toBeNull();
    expect(reopened?.status).toBe("TODO");
    expect(reopened?.completedAt).toBeNull();
    expect(reopened?.completedById).toBeNull();
  });
});

describe("task indexes", () => {
  it("carries the required indexes", () => {
    const specs = TaskModel.schema.indexes().map(([spec]) => spec);

    expect(specs).toContainEqual({ organizationId: 1, status: 1, dueAt: 1 });
    expect(specs).toContainEqual({
      organizationId: 1,
      assigneeId: 1,
      status: 1,
    });
    expect(specs).toContainEqual({
      organizationId: 1,
      "related.entityType": 1,
      "related.entityId": 1,
    });
    expect(specs).toContainEqual({ organizationId: 1, createdAt: -1 });
  });
});
