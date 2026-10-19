// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvitationsPanel } from "@/components/settings/invitations-panel";

/**
 * Invitations, against a stubbed `fetch`.
 *
 * The token is the reason this suite exists. There is no mailer, so the POST
 * response carries the raw invitation token exactly once and the inviter has to
 * pass it on by hand — if the panel dropped it, it would have created invitations
 * nobody can accept, and the failure would look like a success. The other half is
 * the gating: `canInvite` and `canRevoke` each decide whether a control exists.
 */

interface Invitation {
  _id: string;
  email: string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
}

function invitation(overrides: Partial<Invitation> = {}): Invitation {
  return {
    _id: "inv1",
    email: "pending@acme.test",
    createdAt: "2026-10-01T00:00:00.000Z",
    expiresAt: "2026-10-08T00:00:00.000Z",
    acceptedAt: null,
    ...overrides,
  };
}

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(
  options: {
    invitations?: Invitation[];
    inviteFails?: boolean;
    inviteBody?: unknown;
  } = {},
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

    if (method === "POST") {
      if (options.inviteFails) {
        return Response.json(
          {
            error: {
              code: "ROLE_NOT_IN_ORGANIZATION",
              message: "That role is not available for this organization.",
            },
          },
          { status: 422 },
        );
      }
      return Response.json({
        data: {
          invitation: invitation({ email: "new@acme.test" }),
          token: "tok_live_once",
          replaced: false,
          ...(options.inviteBody as object),
        },
      });
    }

    return Response.json({ data: options.invitations ?? [] });
  });

  vi.stubGlobal("fetch", impl);
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function panel(
  options: Parameters<typeof stubFetch>[0] = {},
  perms = {
    canInvite: true,
    canRevoke: true,
  },
) {
  const calls = stubFetch(options);
  const user = userEvent.setup();
  render(<InvitationsPanel {...perms} />);
  await waitFor(() =>
    expect(screen.queryByText("Team invitations")).toBeTruthy(),
  );
  return { calls, user };
}

describe("the list", () => {
  it("says so when there is nothing pending", async () => {
    await panel({ invitations: [] });

    expect(screen.getByText("No pending invitations.")).toBeTruthy();
  });

  it("lists the invitations it was given", async () => {
    await panel({ invitations: [invitation({ email: "one@acme.test" })] });

    expect(screen.getByText("one@acme.test")).toBeTruthy();
  });
});

describe("gating", () => {
  it("hides the invite form without invitations.create", async () => {
    await panel({}, { canInvite: false, canRevoke: true });

    expect(
      screen.queryByRole("button", { name: /send invitation/i }),
    ).toBeNull();
  });

  it("hides revoke without invitations.revoke", async () => {
    await panel(
      { invitations: [invitation()] },
      { canInvite: true, canRevoke: false },
    );

    expect(screen.queryByRole("button", { name: /revoke/i })).toBeNull();
  });
});

describe("inviting", () => {
  it("refuses a blank address without a request", async () => {
    const { calls, user } = await panel();

    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(calls.some((call) => call.method === "POST")).toBe(false);
  });

  it("posts the address and the default role", async () => {
    const { calls, user } = await panel();

    await user.type(
      screen.getByPlaceholderText("teammate@company.com"),
      "new@acme.test",
    );
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "POST")).toBe(true),
    );
    const post = calls.find((call) => call.method === "POST");

    expect(post?.body).toEqual({ email: "new@acme.test", roleKey: "MEMBER" });
  });

  it("shows the token once, because there is no mailer", async () => {
    const { user } = await panel();

    await user.type(
      screen.getByPlaceholderText("teammate@company.com"),
      "new@acme.test",
    );
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    expect(await screen.findByText("tok_live_once")).toBeTruthy();
    expect(screen.getByText(/cannot be shown again/i)).toBeTruthy();
    expect(screen.getByText(/invitation created/i)).toBeTruthy();
  });

  it("says the invitation replaced an earlier one when it did", async () => {
    const { user } = await panel({ inviteBody: { replaced: true } });

    await user.type(
      screen.getByPlaceholderText("teammate@company.com"),
      "new@acme.test",
    );
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    expect(await screen.findByText(/invitation replaced/i)).toBeTruthy();
  });

  it("shows the server's refusal instead of a token", async () => {
    const { user } = await panel({ inviteFails: true });

    await user.type(
      screen.getByPlaceholderText("teammate@company.com"),
      "new@acme.test",
    );
    await user.click(screen.getByRole("button", { name: /send invitation/i }));

    expect(await screen.findByText(/that role is not available/i)).toBeTruthy();
    expect(screen.queryByText("tok_live_once")).toBeNull();
  });
});

describe("revoking", () => {
  it("deletes the invitation and refetches", async () => {
    const { calls, user } = await panel({ invitations: [invitation()] });

    await user.click(screen.getByRole("button", { name: /revoke/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "DELETE")).toBe(true),
    );
    expect(calls.find((call) => call.method === "DELETE")?.url).toContain(
      "/invitations/inv1",
    );
    await waitFor(() =>
      expect(
        calls.filter((call) => call.method === "GET").length,
      ).toBeGreaterThan(1),
    );
  });
});
