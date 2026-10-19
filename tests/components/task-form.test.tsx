// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskForm } from "@/components/tasks/TaskForm";

/**
 * The task form, rendered directly rather than inside its dialog.
 *
 * Passing `open` puts the form in controlled mode, where it renders the fields
 * with no `Dialog` around them — the dialog's own open/close plumbing is not what
 * is worth testing here, and it is the part jsdom is worst at.
 *
 * The payload is the point. This form posts a shape the task endpoint validates
 * field by field, and two of those fields are easy to get wrong from the
 * interface: `dueAt` has to be an ISO string from a `datetime-local` value, and
 * `related` has to drop the client-only `rowKey` the rows are keyed by. Getting
 * either wrong is a 422 that looks like a server problem.
 */

const TASK = {
  _id: "task1",
  title: "Call the vendor",
  description: "About the renewal",
  status: "IN_PROGRESS" as const,
  priority: "HIGH" as const,
  dueAt: "2026-11-01T09:00:00.000Z",
  assigneeId: "u1",
  related: [{ entityType: "contact", entityId: "c1" }],
};

function stubFetch(options: { fail?: boolean } = {}) {
  const calls: Array<{
    method: string;
    url: string;
    body: Record<string, unknown>;
  }> = [];

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url,
      body: init?.body ? JSON.parse(String(init.body)) : {},
    });

    // The assignee picker loads the directory; everything else is the save.
    if (url.includes("/organizations/current/members")) {
      return Response.json({
        data: [{ userId: "u1", name: "Dana Okafor", email: "dana@acme.test" }],
      });
    }

    if (options.fail) {
      return Response.json(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "The request is not valid.",
          },
        },
        { status: 422 },
      );
    }

    return Response.json({ data: { ...TASK, _id: "new-task" } });
  });

  vi.stubGlobal("fetch", impl);
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function form(
  props: Partial<Parameters<typeof TaskForm>[0]> = {},
  options: { fail?: boolean } = {},
) {
  const calls = stubFetch(options);
  const user = userEvent.setup();
  const onSuccess = vi.fn();
  const onClose = vi.fn();
  render(
    <TaskForm
      organizationId="org1"
      open
      onSuccess={onSuccess}
      onClose={onClose}
      {...props}
    />,
  );
  return { calls, user, onSuccess, onClose };
}

describe("create mode", () => {
  it("starts blank with the default status and priority", async () => {
    await form();

    expect(screen.getByPlaceholderText("Task title")).toHaveProperty(
      "value",
      "",
    );
    expect(screen.getByPlaceholderText("Task details...")).toHaveProperty(
      "value",
      "",
    );
    expect(screen.getByRole("button", { name: "Create" })).toBeTruthy();
  });

  it("refuses an empty title without a request", async () => {
    const { calls, user } = await form();

    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("Title is required")).toBeTruthy();
    expect(calls.some((call) => call.url.includes("/api/v1/tasks"))).toBe(
      false,
    );
  });

  it("posts a task with a null assignee when none is chosen", async () => {
    const { calls, user } = await form();

    await user.type(screen.getByPlaceholderText("Task title"), "Book the room");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST")).toBe(true),
    );
    const post = calls.find((call) => call.method === "POST");

    expect(post?.url).toBe("/api/v1/tasks");
    expect(post?.body).toEqual({
      title: "Book the room",
      description: null,
      status: "TODO",
      priority: "MEDIUM",
      dueAt: null,
      assigneeId: null,
      related: [],
    });
  });

  it("sends the assignee the picker chose", async () => {
    const { calls, user } = await form();

    await user.type(screen.getByPlaceholderText("Task title"), "Book the room");
    await user.click(screen.getByRole("combobox", { name: "Assignee" }));
    await user.click(await screen.findByText("Dana Okafor"));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST")).toBe(true),
    );

    expect(calls.find((call) => call.method === "POST")?.body.assigneeId).toBe(
      "u1",
    );
  });

  it("calls the success and close handlers after saving", async () => {
    const { user, onSuccess, onClose } = await form();

    await user.type(screen.getByPlaceholderText("Task title"), "Book the room");
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the form open and shows the server's message on failure", async () => {
    const { user, onSuccess, onClose } = await form({}, { fail: true });

    await user.type(screen.getByPlaceholderText("Task title"), "Book the room");
    await user.click(screen.getByRole("button", { name: "Create" }));

    expect(await screen.findByText("The request is not valid.")).toBeTruthy();
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("edit mode", () => {
  it("fills the form from the task", async () => {
    const { calls } = await form({ task: TASK });

    expect(screen.getByPlaceholderText("Task title")).toHaveProperty(
      "value",
      "Call the vendor",
    );
    expect(screen.getByPlaceholderText("Task details...")).toHaveProperty(
      "value",
      "About the renewal",
    );
    // The assignee picker is fed the task's assignee id and loads the directory.
    await waitFor(() =>
      expect(
        calls.some((call) =>
          call.url.includes("/organizations/current/members"),
        ),
      ).toBe(true),
    );
  });

  it("patches the task's own url", async () => {
    const { calls, user } = await form({ task: TASK });

    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true),
    );
    const patch = calls.find((call) => call.method === "PATCH");

    expect(patch?.url).toBe("/api/v1/tasks/task1");
    expect(patch?.body.title).toBe("Call the vendor");
  });

  it("sends the existing related entities without their client key", async () => {
    const related = [
      { entityType: "contact", entityId: "c1" },
      { entityType: "deal", entityId: "d1" },
    ];
    const { calls, user } = await form({ task: { ...TASK, related } });

    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true),
    );

    // `rowKey` is how React tells two identical-looking rows apart; it is not
    // part of the payload and the endpoint would refuse it.
    expect(calls.find((call) => call.method === "PATCH")?.body.related).toEqual(
      related,
    );
  });
});

describe("related entities", () => {
  it("adds a row when both a type and a valid id are given", async () => {
    const { calls, user } = await form();

    await user.type(screen.getByPlaceholderText("Task title"), "Follow up");
    await user.type(screen.getByPlaceholderText("Type"), "contact");
    await user.type(
      screen.getByPlaceholderText("ObjectId"),
      "65f1a2b3c4d5e6f7a8b9c0d1",
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST")).toBe(true),
    );

    expect(calls.find((call) => call.method === "POST")?.body.related).toEqual([
      { entityType: "contact", entityId: "65f1a2b3c4d5e6f7a8b9c0d1" },
    ]);
  });

  it("refuses an id that is not an ObjectId", async () => {
    const { calls, user } = await form();

    await user.type(screen.getByPlaceholderText("Task title"), "Follow up");
    await user.type(screen.getByPlaceholderText("Type"), "contact");
    await user.type(screen.getByPlaceholderText("ObjectId"), "not-an-id");
    await user.click(screen.getByRole("button", { name: "Add" }));
    await user.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST")).toBe(true),
    );

    // The row is simply not added — the endpoint would reject it, and a 422 for
    // something the form could see was wrong is a round trip spent teaching the
    // server to say what the pattern already said.
    expect(calls.find((call) => call.method === "POST")?.body.related).toEqual(
      [],
    );
  });

  it("drops a row that was added", async () => {
    const { calls, user } = await form({
      task: { ...TASK, related: [{ entityType: "contact", entityId: "c1" }] },
    });

    await user.click(screen.getByRole("button", { name: "" }));
    await user.click(screen.getByRole("button", { name: "Update" }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true),
    );

    expect(calls.find((call) => call.method === "PATCH")?.body.related).toEqual(
      [],
    );
  });
});

describe("cancelling", () => {
  it("calls the close handler and sends nothing", async () => {
    const { calls, user, onClose } = await form();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });
});
