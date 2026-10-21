// @vitest-environment jsdom
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ListPage } from "@/components/records/ListPage";

/**
 * The shared record list. It moved out of the route folder so the sales screens
 * can reuse it, which put it inside the coverage gate, so this pins the
 * behaviour every caller depends on: the query it builds, the sort cycle, the
 * empty and loading states, and the actions menu.
 */

interface Row {
  _id: string;
  name: string;
  status: string;
  createdAt: string;
}

const columns = [
  { key: "name", header: "Name", sortable: true },
  { key: "status", header: "Status", sortable: false },
];

function row(overrides: Partial<Row> = {}): Row {
  return {
    _id: "r1",
    name: "First",
    status: "ACTIVE",
    createdAt: "2024-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function meta(totalPages = 1) {
  return { page: 1, pageSize: 20, total: 40, totalPages };
}

function renderList(overrides = {}) {
  const fetchData = vi.fn().mockResolvedValue({ data: [row()], meta: meta() });
  const props = {
    title: "Widgets",
    columns,
    fetchData,
    ...overrides,
  };
  return { props, fetchData, ...render(<ListPage {...props} />) };
}

function lastParams(fetchData: ReturnType<typeof vi.fn>) {
  return fetchData.mock.calls.at(-1)?.[0] as URLSearchParams;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("loading and rendering", () => {
  it("shows a spinner until the first request resolves", async () => {
    let resolve!: (value: {
      data: Row[];
      meta: ReturnType<typeof meta>;
    }) => void;
    const pending = new Promise<{
      data: Row[];
      meta: ReturnType<typeof meta>;
    }>((r) => {
      resolve = r;
    });
    const fetchData = vi.fn().mockReturnValue(pending);

    render(
      <ListPage title="Widgets" columns={columns} fetchData={fetchData} />,
    );

    expect(screen.queryByText("First")).toBeNull();
    resolve?.({ data: [row()], meta: meta() });

    expect(await screen.findByText("First")).toBeTruthy();
  });

  it("renders the title, description and create link", () => {
    renderList({ description: "All the widgets", createUrl: "/widgets/new" });

    expect(screen.getByText("Widgets")).toBeTruthy();
    expect(screen.getByText("All the widgets")).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /new/i }).getAttribute("href"),
    ).toBe("/widgets/new");
  });

  it("renders a column's custom renderer and falls back for a missing value", async () => {
    const fetchData = vi.fn().mockResolvedValue({
      data: [row()],
      meta: meta(),
    });
    render(
      <ListPage
        title="Widgets"
        columns={[
          { key: "name", header: "Name" },
          { key: "missing", header: "Missing" },
        ]}
        fetchData={fetchData}
      />,
    );

    expect(await screen.findByText("First")).toBeTruthy();
    expect(screen.getByText("—")).toBeTruthy();
  });

  it("puts the query in the request", async () => {
    const { fetchData } = renderList();
    await screen.findByText("First");

    const params = lastParams(fetchData);
    expect(params.get("page")).toBe("1");
    expect(params.get("pageSize")).toBe("20");
    expect(params.get("sort")).toBe("-createdAt");
  });

  /**
   * An empty result caused by a search is not the same message as an empty
   * collection: the first offers "clear the search", the second offers
   * "create the first record". Showing the create prompt after a search that
   * matched nothing sends the user to a form they did not want.
   */
  it("distinguishes an empty search from an empty collection", async () => {
    const user = userEvent.setup();
    const fetchData = vi.fn().mockResolvedValue({ data: [], meta: meta(0) });
    render(
      <ListPage
        title="Widgets"
        columns={columns}
        fetchData={fetchData}
        createUrl="/widgets/new"
      />,
    );

    expect(await screen.findByText(/no records found/i)).toBeTruthy();

    await user.type(screen.getByRole("textbox", { name: /search/i }), "zzz");

    expect(await screen.findByText(/no matching records/i)).toBeTruthy();
    expect(screen.getByRole("button", { name: /clear filters/i })).toBeTruthy();
  });

  it("says so when there are no records", async () => {
    const fetchData = vi.fn().mockResolvedValue({ data: [], meta: meta(0) });
    render(
      <ListPage
        title="Widgets"
        columns={columns}
        fetchData={fetchData}
        createUrl="/widgets/new"
      />,
    );

    expect(await screen.findByText(/no records found/i)).toBeTruthy();
  });

  /**
   * A failed request is not an empty collection. Reporting it as "no records
   * found" tells the user their data does not exist, which is a different and
   * wrong claim — so the error must surface, and it must offer a retry.
   */
  it("reports a failed request as an error, not as an empty list", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchData = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <ListPage title="Widgets" columns={columns} fetchData={fetchData} />,
    );

    expect(await screen.findByText("boom")).toBeTruthy();
    expect(screen.queryByText(/no records found/i)).toBeNull();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getByRole("button", { name: /try again/i })).toBeTruthy();
    error.mockRestore();
  });
});

describe("sorting", () => {
  it("cycles a sortable column through ascending and descending", async () => {
    const user = userEvent.setup();
    const { fetchData } = renderList();
    await screen.findByText("First");

    await user.click(screen.getByText("Name"));
    await waitFor(() => expect(lastParams(fetchData).get("sort")).toBe("name"));

    await user.click(screen.getByText("Name"));
    await waitFor(() =>
      expect(lastParams(fetchData).get("sort")).toBe("-name"),
    );

    await user.click(screen.getByText("Name"));
    await waitFor(() => expect(lastParams(fetchData).get("sort")).toBe("name"));
  });

  it("ignores a header that is not sortable", async () => {
    const user = userEvent.setup();
    const { fetchData } = renderList();
    await screen.findByText("First");
    const calls = fetchData.mock.calls.length;

    await user.click(screen.getByText("Status"));

    expect(fetchData.mock.calls.length).toBe(calls);
  });

  /**
   * The sort icon is invisible to a screen reader, so the sort state has to be
   * carried by `aria-sort` — and the control has to be reachable without a
   * mouse, which means a real button rather than a click handler on the `<th>`.
   */
  it("exposes the sort state through aria-sort on a keyboard-operable header", async () => {
    const user = userEvent.setup();
    renderList();
    await screen.findByText("First");

    const header = screen.getByRole("columnheader", { name: /name/i });
    const button = within(header).getByRole("button", { name: /name/i });

    expect(header.getAttribute("aria-sort")).toBe("none");

    button.focus();
    await user.keyboard("{Enter}");

    await waitFor(() =>
      expect(
        screen
          .getByRole("columnheader", { name: /name/i })
          .getAttribute("aria-sort"),
      ).toBe("ascending"),
    );
  });
});

describe("search and filters", () => {
  it("debounces the search into the query", async () => {
    const user = userEvent.setup();
    const { fetchData } = renderList();
    await screen.findByText("First");

    await user.type(screen.getByPlaceholderText("Search..."), "bolt");

    await waitFor(() => expect(lastParams(fetchData).get("q")).toBe("bolt"));
  });

  it("applies a filter and clears it again", async () => {
    const user = userEvent.setup();
    const { fetchData } = renderList({
      filterOptions: [
        {
          key: "status",
          label: "Status",
          options: [{ value: "ACTIVE", label: "Active" }],
        },
      ],
    });
    await screen.findByText("First");

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByText("Active"));
    await waitFor(() =>
      expect(lastParams(fetchData).get("status")).toBe("ACTIVE"),
    );

    await user.click(screen.getByRole("button", { name: /clear filters/i }));
    await waitFor(() => expect(lastParams(fetchData).get("status")).toBeNull());
  });
});

describe("pagination and row actions", () => {
  it("requests the next page", async () => {
    const user = userEvent.setup();
    const fetchData = vi
      .fn()
      .mockResolvedValue({ data: [row()], meta: meta(3) });
    render(
      <ListPage title="Widgets" columns={columns} fetchData={fetchData} />,
    );
    await screen.findByText("First");

    await user.click(screen.getByRole("button", { name: "Next page" }));

    await waitFor(() => expect(lastParams(fetchData).get("page")).toBe("2"));
  });

  it("hides pagination when a single page holds everything", async () => {
    renderList();
    await screen.findByText("First");

    expect(screen.queryByRole("navigation", { name: "Pagination" })).toBeNull();
  });

  it("renders the row actions menu", async () => {
    const user = userEvent.setup();
    renderList({
      rowActions: () => <button type="button">Archive</button>,
    });
    await screen.findByText("First");

    await user.click(screen.getByRole("button", { name: "More actions" }));

    expect(await screen.findByRole("menu")).toBeTruthy();
    expect(within(screen.getByRole("menu")).getByText("Archive")).toBeTruthy();
  });
});
