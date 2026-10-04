// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NotificationBell } from "@/components/notifications/notification-bell";

/**
 * The notification bell at the DOM, driving a stubbed `fetch`.
 *
 * This hook owns four requests — list, unread count, mark read, mark all read —
 * plus a change stream, and it holds the unread count in state that four
 * different code paths mutate. That state is the part worth testing: the count is
 * what a person uses to decide whether to open the bell, and a count that drifts
 * from reality is worse than no count at all.
 *
 * Every `fetch` response here is written out rather than mocked by helper, so the
 * shape the component destructures — `data.data`, `data.data.count` — is part of
 * what the test pins. A default `{ ok: true, json: () => ({}) }` would pass while
 * the component read `undefined` for every notification and rendered an empty
 * bell, which is a failure mode that looks identical to "no notifications" on a
 * fresh account.
 */

interface Notification {
  _id: string;
  title: string;
  body: string;
  readAt: string | null;
  createdAt: string;
}

function notification(overrides: Partial<Notification> = {}): Notification {
  return {
    _id: "n1",
    title: "Deal moved",
    body: "Acme renewal moved to Qualified",
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

interface StubOptions {
  list?: Notification[];
  unreadCount?: number;
  /** Endpoints that answer 500, by method and path fragment. */
  fail?: Array<{ method: string; path: string }>;
}

function stubFetch(options: StubOptions = {}) {
  const calls: Array<{ method: string; url: string }> = [];

  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ method, url });

    // The URL contains the fragment, not the other way round. Written the other
    // way, nothing ever matches and every "fails" test quietly exercises the
    // success path instead.
    const shouldFail = (options.fail ?? []).some(
      (f) => url.includes(f.path) && f.method === method,
    );
    if (shouldFail) {
      return new Response("nope", { status: 500 });
    }

    if (url.includes("/unread-count")) {
      return Response.json({
        data: { count: options.unreadCount ?? 0 },
      });
    }
    if (url.includes("/read-all")) return Response.json({ data: { ok: true } });
    if (method === "PATCH" && url.includes("/read")) {
      return Response.json({ data: { ok: true } });
    }
    return Response.json({ data: options.list ?? [] });
  });

  vi.stubGlobal("fetch", impl);
  return calls;
}

/**
 * A change stream that never delivers.
 *
 * jsdom has no `EventSource`, and the hook opens one on mount and schedules
 * reconnects on error. A stub that does nothing is the quiet case: a test about
 * the unread badge should not be disturbed by a stream it is not exercising.
 */
class SilentEventSource {
  static instances: SilentEventSource[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  readonly url: string;
  closed = false;

  constructor(url: string) {
    this.url = url;
    SilentEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }
}

beforeEach(() => {
  SilentEventSource.instances = [];
  vi.stubGlobal("EventSource", SilentEventSource);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The bell's trigger, typed as the button it is.
 *
 * `getByRole("button")` is typed as returning `HTMLElement`, which has no
 * `disabled`, and casting at each call site would be noisier than one helper.
 */
function trigger(): HTMLButtonElement {
  return screen.getByRole("button", {
    name: /notifications|unread/i,
  }) as HTMLButtonElement;
}

/** Render and wait for the loading state to resolve into the real bell. */
async function bell(options: StubOptions = {}) {
  const calls = stubFetch(options);
  const user = userEvent.setup();
  render(<NotificationBell />);
  // The button stops being disabled once the first pair of fetches resolves.
  await waitFor(() => expect(trigger().disabled).toBe(false));
  return { calls, user };
}

describe("loading", () => {
  it("disables the bell and shows a spinner while fetching", () => {
    // A stub that never resolves, so the loading branch is what renders.
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
    render(<NotificationBell />);

    const button = screen.getByRole("button", { name: /notifications/i });
    expect(button).toHaveProperty("disabled", true);
  });

  it("asks for the list and the unread count", async () => {
    const { calls } = await bell();

    const urls = calls.map((call) => call.url);
    expect(urls.some((url) => url.includes("/api/v1/notifications?"))).toBe(
      true,
    );
    expect(urls.some((url) => url.includes("/unread-count"))).toBe(true);
  });

  it("subscribes to the stream once mounted", async () => {
    await bell();

    await waitFor(() => expect(SilentEventSource.instances.length).toBe(1));
    expect(SilentEventSource.instances[0].url).toBe(
      "/api/v1/notifications/stream",
    );
  });

  it("still renders the bell when both requests fail", async () => {
    // A network failure must not take the header out. The bell is the only way
    // back to the notifications screen, so an error that empties the whole
    // component removes the route to the data along with the data.
    stubFetch({ fail: [{ method: "GET", path: "/api/v1/notifications" }] });
    render(<NotificationBell />);

    await waitFor(() => expect(trigger().disabled).toBe(false));
    expect(trigger()).toBeTruthy();
  });

  it("falls back to zero unread rather than an unknown count", async () => {
    await bell({ fail: [{ method: "GET", path: "/unread-count" }] });

    // The count has to be a number. Leaving it null would render as a badge
    // reading "null" or, worse, as nothing at all while notifications are unread.
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });
});

describe("the unread badge", () => {
  it("shows nothing when there is nothing unread", async () => {
    await bell({
      list: [notification({ readAt: new Date().toISOString() })],
      unreadCount: 0,
    });

    const button = screen.getByRole("button", { name: "Notifications" });
    expect(button.textContent).not.toMatch(/\d/);
  });

  it("counts the unread notifications in its accessible name", async () => {
    await bell({ unreadCount: 3 });

    // The name is the only thing a screen reader announces, so the number has to
    // be in it and not only in the visual badge.
    expect(
      screen.getByRole("button", { name: "3 unread notifications" }),
    ).toBeTruthy();
  });

  it("caps the badge at 99+", async () => {
    await bell({ unreadCount: 120 });

    const button = screen.getByRole("button", { name: /unread/ });
    expect(button.textContent).toContain("99+");
  });

  it("shows the exact count below the cap", async () => {
    await bell({ unreadCount: 7 });

    const button = screen.getByRole("button", { name: /unread/ });
    expect(button.textContent).toContain("7");
    expect(button.textContent).not.toContain("99+");
  });

  it("announces the count in a live region", async () => {
    await bell({ unreadCount: 2 });

    const live = document.querySelector('[aria-live="polite"]');
    // A badge that changes silently is invisible to anyone not looking at it at
    // the moment it changes, which is most of the time.
    expect(live?.textContent).toBe("2 unread notifications");
  });

  it("says all caught up when nothing is unread", async () => {
    await bell({ unreadCount: 0 });

    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toBe("No unread notifications");
  });
});

describe("opening the bell", () => {
  it("shows an empty state when there are no notifications at all", async () => {
    const { user } = await bell({ list: [], unreadCount: 0 });

    await user.click(screen.getByRole("button", { name: /notifications/i }));

    expect(await screen.findByText("No notifications")).toBeTruthy();
    expect(screen.getByText(/you're all caught up/i)).toBeTruthy();
  });

  it("lists the notifications it was given", async () => {
    const { user } = await bell({
      list: [
        notification({ _id: "n1", title: "Deal moved" }),
        notification({
          _id: "n2",
          title: "Stage changed",
          readAt: new Date().toISOString(),
        }),
      ],
      unreadCount: 1,
    });

    await user.click(screen.getByRole("button", { name: /unread/i }));

    expect(await screen.findByText("Deal moved")).toBeTruthy();
    expect(screen.getByText("Stage changed")).toBeTruthy();
  });

  it("always offers a way to the full list", async () => {
    const { user } = await bell({ list: [], unreadCount: 0 });

    await user.click(screen.getByRole("button", { name: /notifications/i }));

    // Even with an empty bell, the route to the notifications screen stays
    // reachable. Without it, a notification that arrived while the bell was
    // broken is unreachable from the header.
    expect(
      await screen.findByRole("menuitem", { name: /view all notifications/i }),
    ).toBeTruthy();
  });

  it("hides Mark all read when nothing is unread", async () => {
    const { user } = await bell({ unreadCount: 0 });

    await user.click(screen.getByRole("button", { name: /notifications/i }));

    await screen.findByText("Notifications");
    expect(screen.queryByRole("button", { name: /mark all read/i })).toBeNull();
  });

  it("offers Mark all read when something is unread", async () => {
    const { user } = await bell({ unreadCount: 1 });

    await user.click(screen.getByRole("button", { name: /unread/i }));

    expect(
      await screen.findByRole("button", { name: /mark all read/i }),
    ).toBeTruthy();
  });
});

describe("marking as read", () => {
  it("marks every notification read and zeroes the badge", async () => {
    const { calls, user } = await bell({
      list: [notification({ _id: "n1" }), notification({ _id: "n2" })],
      unreadCount: 2,
    });

    await user.click(screen.getByRole("button", { name: /unread/i }));
    await user.click(
      await screen.findByRole("button", { name: /mark all read/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Notifications" }),
      ).toBeTruthy(),
    );
    expect(
      calls.some(
        (call) => call.method === "POST" && call.url.includes("/read-all"),
      ),
    ).toBe(true);
  });

  it("marks one notification read and decrements by one", async () => {
    const { calls, user } = await bell({
      list: [notification({ _id: "n1", title: "Deal moved" })],
      unreadCount: 2,
    });

    await user.click(screen.getByRole("button", { name: /unread/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /deal moved/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "1 unread notifications" }),
      ).toBeTruthy(),
    );
    expect(
      calls.some(
        (call) => call.method === "PATCH" && call.url.includes("/n1/read"),
      ),
    ).toBe(true);
  });

  it("does not let the count go below zero", async () => {
    const { user } = await bell({
      list: [notification({ _id: "n1", title: "Deal moved" })],
      // The badge says zero but the row still claims to be unread, which is the
      // state a failed unread-count request produces.
      unreadCount: 0,
    });

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /deal moved/i }),
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Notifications" }),
      ).toBeTruthy(),
    );
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("leaves an already-read notification alone", async () => {
    const { calls, user } = await bell({
      list: [
        notification({
          _id: "n1",
          title: "Already read",
          readAt: new Date().toISOString(),
        }),
      ],
      unreadCount: 0,
    });

    await user.click(screen.getByRole("button", { name: /notifications/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /already read/i }),
    );

    // The row is `disabled` and its `onSelect` guards on `readAt`, so marking it
    // again is unreachable. If either guard goes, the count decrements for a
    // notification nobody read.
    expect(calls.some((call) => call.method === "PATCH")).toBe(false);
    expect(screen.getByRole("button", { name: "Notifications" })).toBeTruthy();
  });

  it("does not mark anything when the request fails", async () => {
    const { user } = await bell({
      list: [notification({ _id: "n1", title: "Deal moved" })],
      unreadCount: 1,
      fail: [{ method: "PATCH", path: "/read" }],
    });

    await user.click(screen.getByRole("button", { name: /unread/i }));
    await user.click(
      await screen.findByRole("menuitem", { name: /deal moved/i }),
    );

    // The catch is empty and says "UI will recover on next fetch", which is only
    // true if the count was not decremented on the way past. A local decrement
    // plus a failed request is a badge that lies until something refetches.
    expect(
      screen.getByRole("button", { name: "1 unread notifications" }),
    ).toBeTruthy();
  });

  it("keeps the count when Mark all read fails", async () => {
    const { user } = await bell({
      list: [notification({ _id: "n1" })],
      unreadCount: 1,
      fail: [{ method: "POST", path: "/read-all" }],
    });

    await user.click(screen.getByRole("button", { name: /unread/i }));
    await user.click(
      await screen.findByRole("button", { name: /mark all read/i }),
    );

    expect(
      screen.getByRole("button", { name: "1 unread notifications" }),
    ).toBeTruthy();
  });
});
