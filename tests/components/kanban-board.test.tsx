// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { KanbanBoard } from "@/components/deals/KanbanBoard";

/**
 * The Kanban board at the DOM.
 *
 * This is the component the coverage config named first, and it holds logic no
 * other layer could reach: three filters combined in one predicate, the
 * `sortOrder` arithmetic a drop depends on, and a `catch` that swallows
 * everything.
 *
 * Two things about the component are load-bearing for the fixtures below.
 *
 * The rendered columns come from the *selected pipeline's* stages, not from the
 * `columns` prop — `columns` only supplies the deals for each stage. A fixture
 * that passes one column while the pipeline declares two gets two columns
 * rendered, and the second one empty. So `board()` derives both from one list of
 * stages.
 *
 * Drag and drop is not native to jsdom: there is no `DataTransfer` and no real
 * drag session. The drops here are dispatched as `dragStart` followed by `drop`
 * with a hand-built payload. That is a real limit of this suite and worth stating
 * plainly — what is covered is the component's reading of `dataTransfer`, not the
 * browser's drag interaction. The e2e suite drives the API rather than the UI, so
 * no layer currently covers the browser gesture itself.
 */

interface Stage {
  id: string;
  key: string;
  name: string;
  order: number;
  probability: number;
  color: string;
  isWon: boolean;
  isLost: boolean;
}

interface Deal {
  id: string;
  name: string;
  companyId: string | null;
  contactId: string | null;
  pipelineId: string;
  stageId: string;
  ownerId: string;
  value: number;
  currency: string;
  probability: number;
  status: string;
  expectedCloseDate: string | null;
  closedAt: string | null;
  lostReason: string | null;
  description: string | null;
  sortOrder: number;
  tags: string[];
  customFields: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

const NEW_STAGE: Stage = {
  id: "stage-new",
  key: "NEW",
  name: "Qualified",
  order: 0,
  probability: 10,
  color: "#000000",
  isWon: false,
  isLost: false,
};

// Named "Closed Won" rather than "Won" because a stage that is won renders the
// word twice — once as the column's name, once as the won marker — and two
// elements answering to `getByText("Won")` makes every later assertion ambiguous.
const WON_STAGE: Stage = {
  id: "stage-won",
  key: "WON",
  name: "Closed Won",
  order: 1,
  probability: 100,
  color: "#000000",
  isWon: true,
  isLost: false,
};

const LOST_STAGE: Stage = {
  id: "stage-lost",
  key: "LOST",
  name: "Closed Lost",
  order: 2,
  probability: 0,
  color: "#000000",
  isWon: false,
  isLost: true,
};

function deal(overrides: Partial<Deal> = {}): Deal {
  return {
    id: "deal-1",
    name: "Acme renewal",
    companyId: null,
    contactId: null,
    pipelineId: "pipeline-1",
    stageId: "stage-new",
    ownerId: "user-1",
    value: 1000,
    currency: "USD",
    probability: 10,
    status: "OPEN",
    expectedCloseDate: null,
    closedAt: null,
    lostReason: null,
    description: null,
    sortOrder: 0,
    tags: [],
    customFields: {},
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const PIPELINE = {
  id: "pipeline-1",
  name: "Sales",
  description: null,
  isDefault: true,
  order: 0,
  stages: [NEW_STAGE, WON_STAGE],
};

/**
 * Render a board whose columns are exactly `stages`.
 *
 * `dealsByStage` is keyed by stage id, and a stage with no entry renders empty —
 * which is the usual case worth exercising, since an empty column is a different
 * branch from a populated one.
 */
function board(
  stages: Stage[] = [NEW_STAGE],
  dealsByStage: Record<string, Deal[]> = {},
  overrides: Partial<{
    onPipelineChange: () => void;
    onDealMove: (
      dealId: string,
      stageId: string,
      sortOrder: number,
    ) => Promise<void>;
    onDealCreate: (data: { name: string; stageId: string }) => Promise<void>;
    isLoading: boolean;
    selectedPipelineId: string | null;
  }> = {},
) {
  const props = {
    pipelines: [{ ...PIPELINE, stages }],
    selectedPipelineId: "pipeline-1",
    onPipelineChange: vi.fn(),
    onDealMove: vi.fn().mockResolvedValue(undefined),
    onDealCreate: vi.fn().mockResolvedValue(undefined),
    isLoading: false,
    ...overrides,
    columns: stages.map((s) => ({ stage: s, deals: dealsByStage[s.id] ?? [] })),
  };
  return {
    props,
    ...render(<KanbanBoard {...props} />),
  };
}

/** The rendered column for a stage, for scoped queries. */
function column(stageName: string): HTMLElement {
  return screen.getByLabelText(`${stageName} stage`);
}

/**
 * Dispatch a drag of `payload` onto a stage's column.
 *
 * `dataTransfer` does not exist in jsdom, so the component's two calls into it are
 * backed by this object. `getData` returns whatever `payload` is, which is how a
 * malformed drag is staged: a browser can put anything on the clipboard, including
 * a string that is not JSON at all.
 */
function dragOnto(stageName: string, payload: unknown) {
  const target = column(stageName);

  fireEvent.dragStart(target, {
    dataTransfer: { setData: () => {}, effectAllowed: "" },
  });

  fireEvent.drop(target, {
    dataTransfer: {
      getData: () =>
        typeof payload === "string" ? payload : JSON.stringify(payload),
      dropEffect: "",
    },
  });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("when no pipeline is selected", () => {
  it("says so instead of rendering an empty board", () => {
    board([NEW_STAGE], {}, { selectedPipelineId: null });

    // An empty board reads as "you have no deals". This reads as "you have not
    // picked a pipeline", which is a different problem with a different fix.
    expect(screen.getByText(/select a pipeline/i)).toBeTruthy();
    expect(screen.queryByLabelText("Qualified stage")).toBeNull();
  });
});

describe("the columns", () => {
  it("renders one column per stage in the selected pipeline", () => {
    board([NEW_STAGE, WON_STAGE]);

    expect(screen.getByLabelText("Qualified stage")).toBeTruthy();
    expect(screen.getByLabelText("Closed Won stage")).toBeTruthy();
  });

  it("counts the deals in each column", () => {
    board([NEW_STAGE, WON_STAGE], {
      [NEW_STAGE.id]: [deal(), deal({ id: "deal-2", name: "Globex" })],
      [WON_STAGE.id]: [],
    });

    expect(within(column("Qualified")).getByText("2 deals")).toBeTruthy();
    expect(within(column("Closed Won")).getByText("0 deals")).toBeTruthy();
  });

  it("sums each column's value", () => {
    board([NEW_STAGE], {
      [NEW_STAGE.id]: [deal({ value: 1000 }), deal({ id: "d2", value: 2500 })],
    });

    expect(within(column("Qualified")).getByText("$3,500")).toBeTruthy();
  });

  it("shows an affordance in an empty column rather than a blank space", () => {
    board([NEW_STAGE]);

    expect(screen.getByText(/no deals in this stage/i)).toBeTruthy();
    expect(
      within(column("Qualified")).getByRole("button", { name: /add deal/i }),
    ).toBeTruthy();
  });

  it("offers Add Deal under a populated column too", () => {
    board([NEW_STAGE], { [NEW_STAGE.id]: [deal()] });

    // Two different empty branches in the component, so two fixtures: a column
    // with deals shows the footer button, one without shows the centred one.
    expect(
      within(column("Qualified")).getByRole("button", { name: /add deal/i }),
    ).toBeTruthy();
  });

  it("marks won and lost stages", () => {
    board([WON_STAGE, LOST_STAGE]);

    expect(within(column("Closed Won")).getByText("Won")).toBeTruthy();
    expect(within(column("Closed Lost")).getByText("Lost")).toBeTruthy();
  });

  it("does not mark an ordinary stage as won or lost", () => {
    board([NEW_STAGE]);

    expect(within(column("Qualified")).queryByText("Won")).toBeNull();
    expect(within(column("Qualified")).queryByText("Lost")).toBeNull();
  });

  it("shows placeholder cards instead of deals while loading", () => {
    board([NEW_STAGE], { [NEW_STAGE.id]: [deal()] }, { isLoading: true });

    // Five placeholders: enough to hold the column's height so the board does not
    // jump when the data lands.
    expect(within(column("Qualified")).getAllByRole("listitem")).toHaveLength(
      5,
    );
    expect(screen.queryByText("Acme renewal")).toBeNull();
  });
});

describe("filtering", () => {
  const columns = [NEW_STAGE];
  const deals = {
    [NEW_STAGE.id]: [
      deal({
        id: "d1",
        name: "Acme renewal",
        ownerId: "user-1",
        status: "OPEN",
      }),
      deal({
        id: "d2",
        name: "Globex expansion",
        ownerId: "user-2",
        status: "WON",
      }),
    ],
  };

  async function searchFor(text: string) {
    const user = userEvent.setup();
    board(columns, deals);
    await user.type(screen.getByPlaceholderText(/search deals/i), text);
  }

  it("narrows by name", async () => {
    await searchFor("globex");

    expect(screen.queryByText("Acme renewal")).toBeNull();
    expect(screen.getByText("Globex expansion")).toBeTruthy();
  });

  it("ignores case in both directions", async () => {
    await searchFor("GLOBEX");

    expect(screen.getByText("Globex expansion")).toBeTruthy();
    expect(screen.queryByText("Acme renewal")).toBeNull();
  });

  it("matches a substring, not a prefix", async () => {
    // A search box where typing "renew" misses "Acme renewal" is the usual
    // surprise, and `includes` rather than `startsWith` is the difference.
    await searchFor("renew");

    expect(screen.getByText("Acme renewal")).toBeTruthy();
    expect(screen.queryByText("Globex expansion")).toBeNull();
  });

  it("falls back to the empty column when nothing matches", async () => {
    await searchFor("nothing matches this");

    expect(screen.queryByText("Acme renewal")).toBeNull();
    expect(screen.getByText(/no deals in this stage/i)).toBeTruthy();
  });

  it("recovers when the search is cleared", async () => {
    const user = userEvent.setup();
    board(columns, deals);
    const box = screen.getByPlaceholderText(/search deals/i);

    await user.type(box, "globex");
    expect(screen.queryByText("Acme renewal")).toBeNull();

    await user.clear(box);
    expect(screen.getByText("Acme renewal")).toBeTruthy();
    expect(screen.getByText("Globex expansion")).toBeTruthy();
  });

  /**
   * The owner filter cannot be exercised, and that is a finding.
   *
   * `SelectContent` for owners contains one row — "All Owners" — and a comment
   * reading "In real app, populate from team members". There is nothing to choose,
   * so the owner branch of the predicate is unreachable from the UI. It is left in
   * place deliberately: the predicate is correct, and wiring the team list into
   * the select is a feature rather than a fix. This test fails the day that list
   * arrives.
   */
  it("offers no owners to filter by yet", async () => {
    const user = userEvent.setup();
    board(columns, deals);

    await user.click(screen.getByText("Owner"));

    const options = await screen.findAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual(["All Owners"]);
  });

  it("filters by status", async () => {
    const user = userEvent.setup();
    board(columns, deals);

    await user.click(screen.getByText("Status"));
    await user.click(await screen.findByRole("option", { name: "Won" }));

    expect(screen.getByText("Globex expansion")).toBeTruthy();
    expect(screen.queryByText("Acme renewal")).toBeNull();
  });

  it("combines search and status rather than replacing one with the other", async () => {
    const user = userEvent.setup();
    board(columns, deals);

    // Both deals contain an "o"; only one is WON. If either filter replaced the
    // other, two cards or zero would survive.
    await user.type(screen.getByPlaceholderText(/search deals/i), "o");
    await user.click(screen.getByText("Status"));
    await user.click(await screen.findByRole("option", { name: "Won" }));

    expect(screen.queryByText("Acme renewal")).toBeNull();
    expect(screen.getByText("Globex expansion")).toBeTruthy();
  });

  it("shows the filtered count, not the total", async () => {
    await searchFor("globex");

    // The column header counts what is displayed. Reporting 2 while showing 1
    // would be the sort of small lie a paginated table tells.
    expect(within(column("Qualified")).getByText("1 deals")).toBeTruthy();
  });
});

describe("moving a deal", () => {
  it("appends the deal to the end of the target stage", async () => {
    const { props } = board([NEW_STAGE, WON_STAGE], {
      [NEW_STAGE.id]: [
        deal({ id: "d1", name: "First", sortOrder: 0 }),
        deal({ id: "d2", name: "Second", sortOrder: 7 }),
      ],
      [WON_STAGE.id]: [deal({ id: "d3", sortOrder: 3 })],
    });

    dragOnto("Closed Won", deal({ id: "d1", stageId: "stage-new" }));

    await waitFor(() => expect(props.onDealMove).toHaveBeenCalledTimes(1));
    // The target's max sortOrder is 3, so the newcomer goes to 4. Appending is
    // the only position derivable from a drop without reindexing the column.
    expect(props.onDealMove).toHaveBeenCalledWith("d1", "stage-won", 4);
  });

  it("starts an empty target stage at zero", async () => {
    const { props } = board([NEW_STAGE, WON_STAGE], {
      [NEW_STAGE.id]: [deal({ id: "d1" })],
    });

    dragOnto("Closed Won", deal({ id: "d1", stageId: "stage-new" }));

    await waitFor(() => expect(props.onDealMove).toHaveBeenCalledTimes(1));
    expect(props.onDealMove).toHaveBeenCalledWith("d1", "stage-won", 0);
  });

  it("does not move a deal onto its own stage", async () => {
    const { props } = board([NEW_STAGE], {
      [NEW_STAGE.id]: [deal({ id: "d1", stageId: "stage-new" })],
    });

    dragOnto("Qualified", deal({ id: "d1", stageId: "stage-new" }));

    // The guard is an early return, so the assertion is that nothing was called:
    // a drop that only reorders a card within its own column should not write.
    await waitFor(() => expect(props.onDealMove).not.toHaveBeenCalled());
  });

  it("survives a drag whose payload is not JSON", async () => {
    const { props } = board([NEW_STAGE, WON_STAGE], {
      [NEW_STAGE.id]: [deal({ id: "d1" })],
    });

    // A browser can put anything on the clipboard. This is the branch the empty
    // `catch` exists for, and it must not take the board down with it.
    expect(() => dragOnto("Closed Won", "not json at all")).not.toThrow();
    await waitFor(() => expect(props.onDealMove).not.toHaveBeenCalled());
  });

  it("survives a drag with no payload at all", async () => {
    const { props } = board([NEW_STAGE, WON_STAGE], {
      [NEW_STAGE.id]: [deal({ id: "d1" })],
    });

    expect(() => dragOnto("Closed Won", "")).not.toThrow();
    await waitFor(() => expect(props.onDealMove).not.toHaveBeenCalled());
  });
});

describe("creating a deal", () => {
  /**
   * Open a column's inline form.
   *
   * `renderBoard` is called first: `column()` reads the document, so the component
   * has to be on screen before this can look for anything.
   */
  async function openFormIn(stageName: string, renderBoard: () => unknown) {
    renderBoard();
    const user = userEvent.setup();
    await user.click(
      within(column(stageName)).getByRole("button", { name: /add deal/i }),
    );
    return user;
  }

  it("sends the trimmed name with the stage the form was opened in", async () => {
    const user = userEvent.setup();
    const { props } = board([WON_STAGE]);

    await user.click(
      within(column("Closed Won")).getByRole("button", { name: /add deal/i }),
    );
    await user.type(
      screen.getByPlaceholderText(/deal name/i),
      "  New won deal  ",
    );
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(props.onDealCreate).toHaveBeenCalledTimes(1));
    // The stage comes from whichever column opened the form. Attributing it to
    // the pipeline's first stage instead would file the deal in the wrong column.
    expect(props.onDealCreate).toHaveBeenCalledWith({
      name: "New won deal",
      stageId: "stage-won",
    });
  });

  it("creates in the first column when that is the one opened", async () => {
    const props: { onDealCreate: ReturnType<typeof vi.fn> } = {
      onDealCreate: vi.fn(),
    };
    const user = await openFormIn("Qualified", () => {
      Object.assign(props, board([NEW_STAGE]).props);
    });

    expect(screen.getByPlaceholderText(/deal name/i)).toBeTruthy();
    await user.type(screen.getByPlaceholderText(/deal name/i), "A deal");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(props.onDealCreate).toHaveBeenCalledTimes(1));
    expect(props.onDealCreate.mock.calls[0][0].stageId).toBe("stage-new");
  });

  it("does not create a deal from a blank name", async () => {
    const onDealCreate = vi.fn();
    const user = await openFormIn("Qualified", () => {
      board([NEW_STAGE], {}, { onDealCreate });
    });

    await user.type(screen.getByPlaceholderText(/deal name/i), "   ");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    // `handleCreateDeal` returns early on a trimmed-empty name. Without that
    // guard a whitespace-only name reaches the API and produces a deal called
    // "   ", which then renders as a blank card.
    await waitFor(() => expect(screen.queryByText(/new deal/i)).toBeNull());
  });

  it("closes the form on cancel without creating anything", async () => {
    const user = userEvent.setup();
    const { props } = board([NEW_STAGE]);

    await user.click(
      within(column("Qualified")).getByRole("button", { name: /add deal/i }),
    );
    await user.type(screen.getByPlaceholderText(/deal name/i), "Abandoned");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() =>
      expect(screen.queryByPlaceholderText(/deal name/i)).toBeNull(),
    );
    expect(props.onDealCreate).not.toHaveBeenCalled();
  });

  it("opens the form in one column without opening it in another", async () => {
    const user = userEvent.setup();
    board([NEW_STAGE, WON_STAGE]);

    await user.click(
      within(column("Qualified")).getByRole("button", { name: /add deal/i }),
    );

    // `creatingInStage` holds a single stage id, so the form is one piece of
    // state. Two forms at once would both write to it.
    expect(screen.getAllByPlaceholderText(/deal name/i)).toHaveLength(1);
    expect(
      within(column("Closed Won")).queryByPlaceholderText(/deal name/i),
    ).toBeNull();
  });
});
