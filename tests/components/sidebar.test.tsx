// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { usePathname } from "next/navigation";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Sidebar, SidebarTrigger } from "@/components/app-shell/sidebar";
import { useSession } from "@/shared/auth/session-client";

vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
  usePathname: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/shared/auth/session-client", () => ({ useSession: vi.fn() }));

/**
 * The navigation drawer, at the DOM.
 *
 * Two behaviours here are invisible in a screenshot and were both wrong:
 *
 * 1. On mobile the closed drawer is still in the document, merely translated
 *    off-canvas. A transform does not remove anything from the tab order, so a
 *    keyboard user tabbed through the whole navigation before reaching the page
 *    they could see. `inert` is the fix, and it is a property, not a layout.
 *
 * 2. On desktop the drawer is a permanent sidebar, so it must *not* claim to be
 *    a modal dialog — that would trap focus inside the navigation and make the
 *    entire app unreachable without a mouse.
 */

const SESSION = {
  user: { name: "Ada Lovelace", email: "ada@example.com" },
  activeOrganizationId: "org-1",
  organizations: [{ id: "org-1", name: "Analytical Engines" }],
  permissions: [] as string[],
};

/** jsdom has no `matchMedia`; this reports the viewport the test asks for. */
let compact = true;

beforeEach(() => {
  compact = true;
  vi.mocked(usePathname).mockReturnValue("/dashboard");
  vi.mocked(useSession).mockReturnValue({
    data: SESSION,
    refresh: vi.fn(),
  } as unknown as ReturnType<typeof useSession>);

  vi.stubGlobal(
    "matchMedia",
    (query: string) =>
      ({
        matches: compact ? query.includes("max-width") : false,
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** The drawer node, whichever role it currently claims. */
function drawer() {
  return document.getElementById("main-navigation") as HTMLElement;
}

describe("closed on a small viewport", () => {
  it("is removed from the tab order and the accessibility tree", async () => {
    render(<Sidebar isOpen={false} onClose={vi.fn()} />);

    // The media query resolves in an effect, so the first paint is the desktop
    // assumption. Wait for the viewport to be applied.
    await waitFor(() => expect(drawer().hasAttribute("inert")).toBe(true));
  });

  it("is not announced as a dialog", () => {
    render(<Sidebar isOpen={false} onClose={vi.fn()} />);

    expect(drawer().getAttribute("role")).toBeNull();
    expect(drawer().getAttribute("aria-modal")).toBeNull();
  });
});

describe("open on a small viewport", () => {
  it("becomes a modal dialog and takes focus", async () => {
    render(<Sidebar isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(drawer().getAttribute("role")).toBe("dialog"));
    expect(drawer().getAttribute("aria-modal")).toBe("true");
    expect(drawer().hasAttribute("inert")).toBe(false);

    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: /close sidebar/i }),
      ),
    );
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<Sidebar isOpen onClose={onClose} />);

    await waitFor(() => expect(drawer().getAttribute("role")).toBe("dialog"));

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalled();
  });

  it("locks the page behind it", async () => {
    render(<Sidebar isOpen onClose={vi.fn()} />);

    await waitFor(() => expect(document.body.style.overflow).toBe("hidden"));
  });

  it("returns focus to whatever opened it", async () => {
    const onClose = vi.fn();
    const { rerender } = render(<Sidebar isOpen={false} onClose={onClose} />);

    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();

    rerender(<Sidebar isOpen onClose={onClose} />);
    await waitFor(() => expect(drawer().getAttribute("role")).toBe("dialog"));

    rerender(<Sidebar isOpen={false} onClose={onClose} />);

    await waitFor(() => expect(document.activeElement).toBe(opener));
    opener.remove();
  });
});

describe("on a desktop viewport", () => {
  it("stays a plain navigation landmark whether or not it is open", async () => {
    compact = false;
    render(<Sidebar isOpen={false} onClose={vi.fn()} />);

    await waitFor(() => expect(drawer().hasAttribute("inert")).toBe(false));
    expect(drawer().getAttribute("role")).toBeNull();
  });
});

describe("the trigger", () => {
  /**
   * `aria-expanded` was hardcoded to `false` on the header's copy, so a screen
   * reader announced the drawer as collapsed even while it covered the screen.
   */
  it("announces the state it is given", () => {
    const { rerender } = render(
      <SidebarTrigger onClick={vi.fn()} isOpen={false} />,
    );
    const trigger = screen.getByRole("button", {
      name: /open main navigation/i,
    });

    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(trigger.getAttribute("aria-controls")).toBe("main-navigation");

    rerender(<SidebarTrigger onClick={vi.fn()} isOpen />);

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
  });
});
