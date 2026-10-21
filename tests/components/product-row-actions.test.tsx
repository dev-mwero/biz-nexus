// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductRowActions } from "@/components/products/ProductRowActions";
import type { ProductRecord } from "@/components/products/types";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

/**
 * The product row actions.
 *
 * The two things that matter: a destructive write waits for a confirmation,
 * and it hits the endpoint the row belongs to. A menu item that archives the
 * wrong product, or archives without asking, is invisible to every layer below
 * the DOM.
 */

function product(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    _id: "p1",
    name: "Consulting hour",
    sku: "CONS-IV",
    description: null,
    type: "SERVICE",
    status: "ACTIVE",
    unitPriceMinor: 1250,
    currency: "USD",
    unitLabel: "hour",
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function stubFetch(status = 200) {
  const calls: { url: string; init?: RequestInit }[] = [];
  const impl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    if (status === 204) return new Response(null, { status: 204 });
    return new Response(JSON.stringify({ data: {} }), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", impl);
  return calls;
}

function renderActions(overrides = {}) {
  const onChanged = vi.fn();
  const props = {
    product: product(),
    canUpdate: true,
    canDelete: true,
    onChanged,
    ...overrides,
  };
  return { onChanged, ...render(<ProductRowActions {...props} />) };
}

beforeEach(() => {
  vi.stubGlobal(
    "confirm",
    vi.fn(() => true),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("affordances", () => {
  it("offers edit, archive and delete to a writer", () => {
    renderActions();

    expect(screen.getByRole("link", { name: /edit/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /archive/i })).toBeTruthy();
    expect(screen.getByRole("button", { name: /delete/i })).toBeTruthy();
  });

  it("offers nothing to a member with no write permission", () => {
    renderActions({ canUpdate: false, canDelete: false });

    expect(screen.queryByRole("link", { name: /edit/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /archive/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("hides delete but keeps archive for an updater who cannot delete", () => {
    renderActions({ canDelete: false });

    expect(screen.getByRole("button", { name: /archive/i })).toBeTruthy();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });
});

describe("archiving", () => {
  it("asks before archiving", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.mocked(confirm);
    renderActions();
    stubFetch();

    await user.click(screen.getByRole("button", { name: /archive/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toMatch(/consulting hour/i);
  });

  it("patches the product's status and reports a change", async () => {
    const user = userEvent.setup();
    const calls = stubFetch();
    const { onChanged } = renderActions();

    await user.click(screen.getByRole("button", { name: /archive/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("/api/v1/products/p1");
    expect(calls[0].init?.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      status: "ARCHIVED",
    });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("does nothing when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    vi.mocked(confirm).mockReturnValue(false);
    const calls = stubFetch();
    const { onChanged } = renderActions();

    await user.click(screen.getByRole("button", { name: /archive/i }));

    expect(calls).toHaveLength(0);
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("offers restore for an archived product and sends ACTIVE", async () => {
    const user = userEvent.setup();
    const calls = stubFetch();
    renderActions({ product: product({ status: "ARCHIVED" }) });

    await user.click(screen.getByRole("button", { name: /unarchive/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({
      status: "ACTIVE",
    });
  });
});

describe("deleting", () => {
  it("asks, then deletes and reports a change", async () => {
    const user = userEvent.setup();
    const calls = stubFetch(204);
    const { onChanged } = renderActions();

    await user.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].init?.method).toBe("DELETE");
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it("reports a failed delete without refreshing", async () => {
    const user = userEvent.setup();
    stubFetch(500);
    const { onChanged } = renderActions();
    const { toast } = await import("sonner");

    await user.click(screen.getByRole("button", { name: /delete/i }));

    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(onChanged).not.toHaveBeenCalled();
  });
});
