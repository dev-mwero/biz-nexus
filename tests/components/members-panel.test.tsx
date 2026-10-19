// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MembersPanel } from "@/components/settings/members-panel";

/**
 * The member directory, against a stubbed `fetch`.
 *
 * The behaviour that matters is the gating: which controls a caller is shown at
 * all, and which requests the controls that are shown actually make. A viewer
 * must not be offered a Suspend button that 403s, and the Suspend that is offered
 * must send `status: "SUSPENDED"` rather than a `roleKey` — a PATCH that carries
 * the wrong field is a request that reports success and changes the wrong thing.
 */

interface Member {
  id: string;
  userId: string;
  name: string;
  email: string;
  roleKey: string;
  status: string;
  title: string | null;
  joinedAt: string | null;
}

const OWNER: Member = {
  id: "m-owner",
  userId: "u-owner",
  name: "Dana Okafor",
  email: "dana@acme.test",
  roleKey: "OWNER",
  status: "ACTIVE",
  title: null,
  joinedAt: "2026-01-02T00:00:00.000Z",
};

const MEMBER: Member = {
  id: "m-member",
  userId: "u-member",
  name: "Sam Ito",
  email: "sam@acme.test",
  roleKey: "MEMBER",
  status: "ACTIVE",
  title: null,
  joinedAt: "2026-01-03T00:00:00.000Z",
};

const SUSPENDED: Member = {
  ...MEMBER,
  id: "m-suspended",
  userId: "u-suspended",
  name: "Kim Alvarez",
  email: "kim@acme.test",
  status: "SUSPENDED",
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(
  members: Member[],
  failure?: { status: number; message: string },
) {
  const calls: Call[] = [];

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (method !== "GET" && failure) {
      return Response.json(
        { error: { code: "OWNER_REQUIRED", message: failure.message } },
        { status: failure.status },
      );
    }

    if (method === "GET") return Response.json({ data: members });
    return Response.json({ data: MEMBER });
  });

  vi.stubGlobal("fetch", impl);
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const DEFAULT_PERMISSIONS = { canUpdate: true, canRemove: true };

async function panel(
  members: Member[] = [OWNER, MEMBER],
  options: {
    currentUserId?: string | null;
    canUpdate?: boolean;
    canRemove?: boolean;
    failure?: { status: number; message: string };
  } = {},
) {
  const {
    currentUserId = "u-owner",
    canUpdate = DEFAULT_PERMISSIONS.canUpdate,
    canRemove = DEFAULT_PERMISSIONS.canRemove,
    failure,
  } = options;
  const calls = stubFetch(members, failure);
  const user = userEvent.setup();
  render(
    <MembersPanel
      currentUserId={currentUserId}
      canUpdate={canUpdate}
      canRemove={canRemove}
    />,
  );
  await screen.findByText(OWNER.email);
  return { calls, user };
}

describe("the directory", () => {
  it("asks for suspended members as well as active ones", async () => {
    const { calls } = await panel();

    expect(
      calls.some((call) => call.url.includes("includeSuspended=true")),
    ).toBe(true);
  });

  it("lists every member with their email", async () => {
    await panel([OWNER, MEMBER, SUSPENDED]);

    expect(screen.getByText(OWNER.email)).toBeTruthy();
    expect(screen.getByText(MEMBER.email)).toBeTruthy();
    expect(screen.getByText(SUSPENDED.email)).toBeTruthy();
  });

  it("marks the caller's own row", async () => {
    await panel([OWNER, MEMBER], { currentUserId: "u-member" });

    expect(screen.getByText("(you)")).toBeTruthy();
  });

  it("shows a suspended member's status", async () => {
    await panel([OWNER, SUSPENDED]);

    expect(screen.getByText("SUSPENDED")).toBeTruthy();
  });

  it("shows the owner's role and never a role select for them", async () => {
    await panel([OWNER, MEMBER]);

    expect(screen.getByText("Owner")).toBeTruthy();
    // OWNER is not assignable, so the row that holds it is not a control.
    expect(screen.queryByText("Admin")).toBeNull();
  });

  it("offers a retry when the directory cannot be loaded", async () => {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push({
          method: init?.method ?? "GET",
          url: String(input),
          body: undefined,
        });
        return new Response("nope", { status: 500 });
      }),
    );
    const user = userEvent.setup();
    render(<MembersPanel currentUserId="u-owner" canUpdate canRemove />);

    expect(
      await screen.findByText(/could not load the member directory/i),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
  });
});

describe("gating", () => {
  it("offers no write controls to a caller without the permissions", async () => {
    await panel([OWNER, MEMBER], {
      canUpdate: false,
      canRemove: false,
    });

    expect(screen.queryByRole("button", { name: /suspend/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    // The directory is still readable — that is what users.read buys.
    expect(screen.getByText(MEMBER.email)).toBeTruthy();
  });

  it("offers suspend but not remove with only users.update", async () => {
    await panel([OWNER, MEMBER], { canRemove: false });

    expect(screen.getByRole("button", { name: /suspend/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
  });

  it("offers leave on the caller's own row instead of remove", async () => {
    await panel([OWNER, MEMBER], { currentUserId: "u-member" });

    expect(screen.getByRole("button", { name: /leave/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /suspend/i })).toBeTruthy();
  });
});

describe("writes", () => {
  it("suspends a member with a status, not a role", async () => {
    const { calls, user } = await panel([OWNER, MEMBER]);

    await user.click(screen.getByRole("button", { name: /suspend/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true),
    );
    const patch = calls.find((call) => call.method === "PATCH");

    expect(patch?.url).toContain(`/members/${MEMBER.id}`);
    expect(patch?.body).toEqual({ status: "SUSPENDED" });
  });

  it("restores a suspended member", async () => {
    const { calls, user } = await panel([OWNER, SUSPENDED]);

    await user.click(screen.getByRole("button", { name: /restore/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true),
    );
    expect(calls.find((call) => call.method === "PATCH")?.body).toEqual({
      status: "ACTIVE",
    });
  });

  it("removes a member and refetches the directory", async () => {
    const { calls, user } = await panel([OWNER, MEMBER]);

    await user.click(screen.getByRole("button", { name: /remove/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "DELETE")).toBe(true),
    );
    expect(calls.find((call) => call.method === "DELETE")?.url).toContain(
      `/members/${MEMBER.id}`,
    );
    // The list is refetched rather than patched in place, so a member the server
    // still lists does not silently disappear from the table.
    await waitFor(() =>
      expect(
        calls.filter((call) => call.method === "GET").length,
      ).toBeGreaterThan(1),
    );
  });

  it("leaves the organisation from the caller's own row", async () => {
    const { calls, user } = await panel([OWNER, MEMBER], {
      currentUserId: "u-member",
    });

    await user.click(screen.getByRole("button", { name: /leave/i }));

    await waitFor(() =>
      expect(
        calls.some(
          (call) =>
            call.method === "POST" &&
            call.url.includes("/organizations/current/leave"),
        ),
      ).toBe(true),
    );
  });

  it("surfaces the server's refusal instead of hiding it", async () => {
    const { user } = await panel([OWNER, MEMBER], {
      failure: {
        status: 409,
        message:
          "This is the only active owner. Transfer ownership before suspending them.",
      },
    });

    await user.click(screen.getByRole("button", { name: /suspend/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(screen.getByText(/only active owner/i)).toBeTruthy();
  });
});
