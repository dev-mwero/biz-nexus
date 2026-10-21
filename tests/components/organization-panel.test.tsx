// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OrganizationPanel } from "@/components/settings/organization-panel";

/**
 * The organisation settings form, against a stubbed `fetch`.
 *
 * What is worth pinning here is not that inputs render but which requests leave
 * the component: the PATCH body — the trimmed name, the upper-cased currency, the
 * numeric `weekStartsOn` read back out of a select that holds strings — and the
 * refusal to send anything at all without a name. A form that posts
 * `{ name: "   " }` is refused by the server too, but it wastes a round trip and
 * reports it as a server error rather than as the blank box it is.
 */

const ORGANIZATION = {
  id: "org1",
  name: "Acme Ltd",
  slug: "acme-ltd",
  logoUrl: null,
  timezone: "Europe/London",
  currency: "GBP",
  dateFormat: "DD/MM/YYYY",
  weekStartsOn: 1,
  isActive: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function stubFetch(options: { failPatch?: boolean } = {}) {
  const calls: Call[] = [];

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({
      method,
      url,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });

    if (method === "PATCH") {
      if (options.failPatch) {
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
      return Response.json({ data: ORGANIZATION });
    }

    return Response.json({ data: ORGANIZATION });
  });

  vi.stubGlobal("fetch", impl);
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function panel(canUpdate = true) {
  const calls = stubFetch();
  const user = userEvent.setup();
  render(<OrganizationPanel canUpdate={canUpdate} />);
  await screen.findByLabelText("Name");
  return { calls, user };
}

describe("loading", () => {
  it("shows a skeleton before the organisation arrives", () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(<OrganizationPanel canUpdate />);

    expect(screen.getByText("Organisation")).toBeTruthy();
    expect(screen.queryByLabelText("Name")).toBeNull();
  });

  it("loads the organisation's values into the form", async () => {
    await panel();

    expect(screen.getByLabelText("Name")).toHaveProperty("value", "Acme Ltd");
    expect(screen.getByLabelText("Timezone")).toHaveProperty(
      "value",
      "Europe/London",
    );
    expect(screen.getByLabelText("Currency")).toHaveProperty("value", "GBP");
  });

  it("shows the slug but does not let it be edited", async () => {
    await panel();

    const slug = screen.getByLabelText("Slug") as HTMLInputElement;
    expect(slug.value).toBe("acme-ltd");
    expect(slug.disabled).toBe(true);
    // The reason is on screen, not only in the source.
    expect(screen.getByText(/in every invitation link/i)).toBeTruthy();
  });

  it("offers a retry when the load fails", async () => {
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
    render(<OrganizationPanel canUpdate />);

    expect(
      await screen.findByText(/could not load the organisation settings/i),
    ).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(calls.length).toBeGreaterThan(1));
  });
});

describe("permission gating", () => {
  it("disables the inputs and offers no save button without organization.update", async () => {
    await panel(false);

    expect(screen.getByLabelText("Name")).toHaveProperty("disabled", true);
    expect(screen.queryByRole("button", { name: /save changes/i })).toBeNull();
    expect(screen.getByText(/read-only/i)).toBeTruthy();
  });

  it("enables the inputs for a caller who can update", async () => {
    await panel(true);

    expect(screen.getByLabelText("Name")).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: /save changes/i })).toBeTruthy();
  });
});

describe("saving", () => {
  it("refuses to send a blank name, and says why", async () => {
    const { calls, user } = await panel();

    await user.clear(screen.getByLabelText("Name"));
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
  });

  it("sends trimmed values with a numeric week start", async () => {
    const { calls, user } = await panel();

    const name = screen.getByLabelText("Name");
    await user.clear(name);
    await user.type(name, "  Acme Holdings  ");
    const currency = screen.getByLabelText("Currency");
    await user.clear(currency);
    await user.type(currency, "eur");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() =>
      expect(calls.some((call) => call.method === "PATCH")).toBe(true),
    );
    const patch = calls.find((call) => call.method === "PATCH");

    expect(patch?.body).toEqual({
      name: "Acme Holdings",
      timezone: "Europe/London",
      // Typed lower-case, sent upper-case: the schema takes a 3-letter code.
      currency: "EUR",
      dateFormat: "DD/MM/YYYY",
      weekStartsOn: 1,
    });
  });

  it("shows the server's message when the save is refused", async () => {
    const user = userEvent.setup();
    stubFetch({ failPatch: true });
    render(<OrganizationPanel canUpdate />);
    await screen.findByLabelText("Name");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText("The request is not valid.")).toBeTruthy();
  });

  it("reports an unreachable server rather than failing silently", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === "PATCH") throw new Error("offline");
        return Response.json({ data: ORGANIZATION });
      }),
    );
    render(<OrganizationPanel canUpdate />);
    await screen.findByLabelText("Name");

    await user.click(screen.getByRole("button", { name: /save changes/i }));

    expect(await screen.findByText(/could not reach the server/i)).toBeTruthy();
  });
});
