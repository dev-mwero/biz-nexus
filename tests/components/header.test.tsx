// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname, useRouter } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Header } from "@/components/app-shell/header";
import { useSession } from "@/shared/auth/session-client";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shared/auth/session-client", () => ({ useSession: vi.fn() }));
// The bell has its own suite, and it opens a stream on mount. Stubbed here so
// this file tests the header's menu rather than the bell's fetches.
vi.mock("@/components/notifications/notification-bell", () => ({
  NotificationBell: () => <button type="button" aria-label="Notifications" />,
}));

/**
 * The header's account menu, at the DOM.
 *
 * The reason this file exists: every one of these actions was wired to `onSelect`,
 * which is a Radix prop. The menu is `@base-ui/react`, whose item takes `onClick`.
 * `onSelect` is not forwarded to the DOM, so React silently dropped it and all six
 * handlers across the header, the notification bell and the pipeline page did
 * nothing. Sign out, switch organization, open settings and delete pipeline were
 * all reachable, rendered, focusable, and inert.
 *
 * Nothing about that state is visible in a snapshot or a screenshot. The items
 * appear, the menu opens, the styles are right. Only clicking reaches it.
 *
 * So these tests click, and they click the things whose failure would matter most:
 * sign out leaving someone signed in, and a switch that reports success without
 * changing the session.
 */

const SESSION = {
  user: { name: "Ada Lovelace", email: "ada@example.com", avatarUrl: null },
  activeOrganizationId: "org-1",
  organizations: [
    { id: "org-1", name: "Analytical Engines" },
    { id: "org-2", name: "Difference Engines" },
  ],
};

const push = vi.fn();
const routerRefresh = vi.fn();
const refresh = vi.fn();

/** Render the header with a signed-in session, and return the account menu's trigger. */
function renderHeader(overrides: Partial<typeof SESSION> = {}) {
  vi.mocked(useSession).mockReturnValue({
    data: { ...SESSION, ...overrides },
    refresh,
  } as unknown as ReturnType<typeof useSession>);

  const onMenuClick = vi.fn();
  render(<Header onMenuClick={onMenuClick} />);
  return { onMenuClick, user: userEvent.setup() };
}

/**
 * Open the organization switcher — a separate menu from the account one — and
 * return the user driving it.
 */
async function openOrgSwitcher() {
  const { user } = renderHeader();
  await user.click(
    screen.getByRole("button", { name: /current organization/i }),
  );
  return user;
}

/** Open the account menu and return the user driving it. */
async function openAccountMenu(
  renderBoard: () => { user: ReturnType<typeof userEvent.setup> },
) {
  const { user } = renderBoard();
  await user.click(screen.getByRole("button", { name: /ada lovelace/i }));
  return user;
}

beforeEach(() => {
  push.mockReset();
  routerRefresh.mockReset();
  refresh.mockReset();
  vi.mocked(useRouter).mockReturnValue({
    push,
    refresh: routerRefresh,
  } as unknown as ReturnType<typeof useRouter>);
  vi.mocked(usePathname).mockReturnValue("/dashboard");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response("{}", { status: 200 })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("signing out", () => {
  it("posts to the logout endpoint", async () => {
    const user = await openAccountMenu(() => renderHeader());

    await user.click(
      await screen.findByRole("menuitem", { name: /sign out/i }),
    );

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/v1/auth/logout", {
        method: "POST",
      }),
    );
  });

  it("sends the user to the sign-in page", async () => {
    const user = await openAccountMenu(() => renderHeader());

    await user.click(
      await screen.findByRole("menuitem", { name: /sign out/i }),
    );

    // The half that was silently broken. Without this the user clicks Sign out,
    // the request may not even go out, and they keep a live session with no
    // indication anything happened.
    await waitFor(() => expect(push).toHaveBeenCalledWith("/sign-in"));
  });

  it("clears the cached session", async () => {
    const user = await openAccountMenu(() => renderHeader());

    await user.click(
      await screen.findByRole("menuitem", { name: /sign out/i }),
    );

    // The navigation alone would render the sign-in page over a session that is
    // still in memory. The refresh is what actually ends it.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
  });
});

describe("switching organization", () => {
  it("posts the chosen organization", async () => {
    const user = await openOrgSwitcher();

    await user.click(
      await screen.findByRole("menuitem", { name: /difference engines/i }),
    );

    await waitFor(() =>
      expect(fetch).toHaveBeenCalledWith("/api/v1/organizations/active", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ organizationId: "org-2" }),
      }),
    );
  });

  it("refreshes both the session and the page", async () => {
    const user = await openOrgSwitcher();

    await user.click(
      await screen.findByRole("menuitem", { name: /difference engines/i }),
    );

    // Two refreshes, for two different reasons: the session hook caches the
    // active org, and `router.refresh` re-runs the server components that read
    // it. Doing only the first leaves a page still scoped to the old tenant,
    // which is the worse of the two failures to debug.
    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(routerRefresh).toHaveBeenCalled();
  });

  it("offers each organization in the session", async () => {
    await openOrgSwitcher();

    expect(
      await screen.findByRole("menuitem", { name: /analytical engines/i }),
    ).toBeTruthy();
    expect(
      await screen.findByRole("menuitem", { name: /difference engines/i }),
    ).toBeTruthy();
  });
});

describe("navigation", () => {
  it("goes to settings", async () => {
    const user = await openAccountMenu(() => renderHeader());

    await user.click(
      await screen.findByRole("menuitem", { name: /settings/i }),
    );

    await waitFor(() => expect(push).toHaveBeenCalledWith("/settings"));
  });

  it("opens the mobile menu from the left", async () => {
    const { onMenuClick, user } = renderHeader();

    await user.click(
      screen.getByRole("button", { name: /open main navigation/i }),
    );

    expect(onMenuClick).toHaveBeenCalled();
  });

  it("shows who is signed in", async () => {
    await openAccountMenu(() => renderHeader());

    expect(await screen.findByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("ada@example.com")).toBeTruthy();
  });
});

describe("a session with no organizations", () => {
  it("still offers a way out", async () => {
    await openAccountMenu(() => renderHeader({ organizations: [] }));

    // The switcher has nothing to switch to. Sign out must survive that,
    // because that is the case where someone most needs it.
    expect(
      await screen.findByRole("menuitem", { name: /sign out/i }),
    ).toBeTruthy();
  });
});
