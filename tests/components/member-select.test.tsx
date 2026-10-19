// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemberSelect } from "@/components/members/member-select";

/**
 * The member picker, against a stubbed `fetch`.
 *
 * It replaces a text field that asked for a user ObjectId, so the two things
 * worth pinning are that it loads the directory at all and that choosing
 * "Unassigned" hands back `null` rather than the empty string Base UI uses for a
 * cleared select — the task endpoints take `assigneeId: null`, and an empty
 * string there is a validation failure that reads like a bug in the form.
 */

const MEMBERS = [
  { userId: "u1", name: "Dana Okafor", email: "dana@acme.test" },
  { userId: "u2", name: "", email: "nameless@acme.test" },
];

function stubFetch(options: { ok?: boolean } = {}) {
  const calls: string[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL) => {
    calls.push(String(input));
    if (options.ok === false) return new Response("nope", { status: 500 });
    return Response.json({ data: MEMBERS });
  });
  vi.stubGlobal("fetch", impl);
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("MemberSelect", () => {
  it("asks the directory endpoint for the members", async () => {
    const calls = stubFetch();
    render(<MemberSelect value={null} onChange={() => {}} />);

    await waitFor(() =>
      expect(
        calls.some((url) => url.includes("/organizations/current/members")),
      ).toBe(true),
    );
  });

  it("shows the placeholder while nothing is selected", async () => {
    stubFetch();
    render(<MemberSelect value={null} onChange={() => {}} />);

    expect(await screen.findByText("Unassigned")).toBeTruthy();
  });

  it("offers the members it loaded", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<MemberSelect value={null} onChange={() => {}} />);
    await screen.findByText("Unassigned");

    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByText("Dana Okafor")).toBeTruthy();
  });

  it("falls back to the address when a member has no name", async () => {
    stubFetch();
    const user = userEvent.setup();
    render(<MemberSelect value={null} onChange={() => {}} />);
    await screen.findByText("Unassigned");

    await user.click(screen.getByRole("combobox"));

    expect(await screen.findByText("nameless@acme.test")).toBeTruthy();
  });

  it("reports the chosen member's id", async () => {
    stubFetch();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MemberSelect value={null} onChange={onChange} />);
    await screen.findByText("Unassigned");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Dana Okafor"));

    expect(onChange).toHaveBeenCalledWith("u1");
  });

  it("reports null when the choice is cleared", async () => {
    stubFetch();
    const onChange = vi.fn();
    const user = userEvent.setup();
    render(<MemberSelect value="u1" onChange={onChange} />);
    await screen.findByRole("combobox");

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByText("Unassigned"));

    // `null`, not `""` — the payload the task endpoints expect.
    expect(onChange).toHaveBeenCalledWith(null);
  });

  it("still renders when the directory request fails", async () => {
    stubFetch({ ok: false });
    render(<MemberSelect value={null} onChange={() => {}} />);

    // No members to offer, but the control is still there and still usable.
    expect(await screen.findByText("Unassigned")).toBeTruthy();
  });
});
