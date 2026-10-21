// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ProductList } from "@/components/products/ProductList";
import type { ProductRecord } from "@/components/products/types";
import { formatCurrency } from "@/shared/lib/format";

vi.mock("@/shared/auth/session-client", () => ({ useSession: vi.fn() }));

import { useSession } from "@/shared/auth/session-client";

/**
 * The product list.
 *
 * `ListPage` owns the search, sort and paging mechanics and has its own suite,
 * so this checks the parts this component supplies: the endpoint it calls, the
 * way a minor-unit price is turned back into money for display, and which
 * affordances a session's permissions turn on.
 */

const RECORD: ProductRecord = {
  _id: "p1",
  name: "Consulting hour",
  sku: "CONS-IV",
  description: "Advisory work",
  type: "SERVICE",
  status: "ACTIVE",
  unitPriceMinor: 1250,
  currency: "USD",
  unitLabel: "hour",
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
};

function session(permissions: string[]) {
  vi.mocked(useSession).mockReturnValue({
    data: { permissions },
    loading: false,
    refresh: vi.fn(),
  } as unknown as ReturnType<typeof useSession>);
}

function stubFetch() {
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      calls.push(String(input));
      return Response.json({
        data: [RECORD],
        meta: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the request", () => {
  it("reads the products endpoint with the list query", async () => {
    session(["products.read"]);
    const calls = stubFetch();
    render(<ProductList />);

    await waitFor(() =>
      expect(calls[0]?.startsWith("/api/v1/products?")).toBe(true),
    );
    expect(calls[0]).toContain("sort=-createdAt");
    expect(calls[0]).toContain("page=1");
  });
});

describe("display", () => {
  it("renders the name and the price in the record's currency", async () => {
    session(["products.read"]);
    stubFetch();
    render(<ProductList />);

    expect(await screen.findByText("Consulting hour")).toBeTruthy();
    expect(screen.getByText("CONS-IV")).toBeTruthy();
    expect(
      screen.getByText(formatCurrency(12.5, "USD"), { exact: false }),
    ).toBeTruthy();
  });
});

describe("permission affordances", () => {
  it("offers create and row actions to an admin", async () => {
    session([
      "products.read",
      "products.create",
      "products.update",
      "products.delete",
    ]);
    stubFetch();
    render(<ProductList />);

    await screen.findByText("Consulting hour");
    expect(
      screen.getByRole("link", { name: /new/i }).getAttribute("href"),
    ).toBe("/products/new");
    expect(screen.getByRole("button", { name: "More actions" })).toBeTruthy();
  });

  it("offers neither to a read-only member", async () => {
    session(["products.read"]);
    stubFetch();
    render(<ProductList />);

    await screen.findByText("Consulting hour");
    expect(screen.queryByRole("link", { name: /new/i })).toBeNull();
    expect(screen.queryByRole("button", { name: "More actions" })).toBeNull();
  });
});
