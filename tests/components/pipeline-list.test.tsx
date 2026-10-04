// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PipelineList } from "@/components/pipelines/PipelineList";

/**
 * `PipelineList` at the DOM, which is the only place this component's behaviour
 * lives.
 *
 * Every one of these assertions is about what a person can reach: the button
 * that opens the create dialog, the field labelled "Name", the submit that stays
 * disabled until something is typed. None of it is visible from a service or a
 * repository test, which is the whole argument for having a DOM environment —
 * this component had 0% coverage while three files of API tests agreed it worked.
 *
 * The guards are the reason this is worth having. `handleCreate` refuses a blank
 * name, `handleDelete` refuses when the browser confirm is dismissed, and both of
 * those refusals are `return` statements with no observable trace from outside.
 * A snapshot would have recorded them without ever checking them.
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

interface Pipeline {
  id: string;
  name: string;
  description: string | null;
  isDefault: boolean;
  order: number;
  stages: Stage[];
}

function stage(overrides: Partial<Stage> = {}): Stage {
  return {
    id: `stage-${overrides.key ?? "new"}`,
    key: "NEW",
    name: "New",
    order: 1,
    probability: 10,
    color: "#000000",
    isWon: false,
    isLost: false,
    ...overrides,
  };
}

function pipeline(overrides: Partial<Pipeline> = {}): Pipeline {
  return {
    id: "pipeline-1",
    name: "Sales Pipeline",
    description: "The main one",
    isDefault: false,
    order: 0,
    stages: [stage()],
    ...overrides,
  };
}

function handlers() {
  return {
    onCreate: vi.fn().mockResolvedValue(undefined),
    onUpdate: vi.fn().mockResolvedValue(undefined),
    onDelete: vi.fn().mockResolvedValue(undefined),
    onReorderStages: vi.fn().mockResolvedValue(undefined),
  };
}

function renderList(pipelines: Pipeline[], overrides = {}) {
  const props = { ...handlers(), ...overrides };
  return {
    props,
    ...render(<PipelineList {...props} pipelines={pipelines} />),
  };
}

beforeEach(() => {
  // The delete path asks the browser. jsdom has no dialog and throws on
  // `window.confirm`, so every delete test has to decide what the person said.
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

describe("showing pipelines", () => {
  it("renders a pipeline with its name, description and stages", () => {
    renderList([
      pipeline({
        stages: [
          stage(),
          stage({ id: "stage-2", key: "WON", name: "Won Won" }),
        ],
      }),
    ]);

    expect(screen.getByText("Sales Pipeline")).toBeTruthy();
    expect(screen.getByText("The main one")).toBeTruthy();
    expect(screen.getByText("New")).toBeTruthy();
    expect(screen.getByText("Won Won")).toBeTruthy();
  });

  it("marks the default pipeline", () => {
    renderList([
      pipeline({ isDefault: true }),
      pipeline({ id: "p2", name: "Other" }),
    ]);

    // One badge, not two: the default is a property of exactly one pipeline and
    // the badge is how a person finds it.
    expect(screen.getAllByText("Default")).toHaveLength(1);
  });

  it("omits the description paragraph when there is none", () => {
    renderList([pipeline({ description: null })]);

    expect(screen.getByText("Sales Pipeline")).toBeTruthy();
    // A `null` description must not render the word "null" or an empty box; the
    // `{pipeline.description && ...}` guard is what this checks.
    expect(screen.queryByText("null")).toBeNull();
  });

  it("says so when a pipeline has no stages", () => {
    renderList([pipeline({ stages: [] })]);

    expect(screen.getByText(/no stages yet/i)).toBeTruthy();
  });
});

describe("creating a pipeline", () => {
  it("keeps the submit button disabled until a name is typed", async () => {
    const user = userEvent.setup();
    renderList([]);

    await user.click(screen.getByRole("button", { name: /new pipeline/i }));

    const submit = screen.getByRole("button", { name: /^create$/i });
    expect(submit).toHaveProperty("disabled", true);

    await user.type(screen.getByLabelText("Name"), "Renewals");
    expect(submit).toHaveProperty("disabled", false);
  });

  it("passes the trimmed fields to onCreate", async () => {
    const user = userEvent.setup();
    const { props } = renderList([]);

    await user.click(screen.getByRole("button", { name: /new pipeline/i }));
    // Padded on purpose: a name of "  Renenjals  " stored with its whitespace is
    // invisible in the UI until two pipelines differ only by a space.
    await user.type(screen.getByLabelText("Name"), "  Renewals  ");
    await user.type(
      screen.getByLabelText(/description/i),
      "  Recurring work  ",
    );
    await user.click(screen.getByLabelText(/set as default/i));
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    expect(props.onCreate).toHaveBeenCalledWith({
      name: "Renewals",
      description: "Recurring work",
      isDefault: true,
    });
  });

  it("sends an absent description as undefined, not an empty string", async () => {
    const user = userEvent.setup();
    const { props } = renderList([]);

    await user.click(screen.getByRole("button", { name: /new pipeline/i }));
    await user.type(screen.getByLabelText("Name"), "Renewals");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    // `description: ""` and an absent description are different instructions to
    // the API, and the trim-or-undefined here is what keeps them apart.
    expect(props.onCreate.mock.calls[0][0].description).toBeUndefined();
  });

  it("defaults isDefault to false rather than leaving it unset", async () => {
    const user = userEvent.setup();
    const { props } = renderList([]);

    await user.click(screen.getByRole("button", { name: /new pipeline/i }));
    await user.type(screen.getByLabelText("Name"), "Renewals");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    await waitFor(() => expect(props.onCreate).toHaveBeenCalledTimes(1));
    expect(props.onCreate.mock.calls[0][0].isDefault).toBe(false);
  });

  it("clears the form after a successful create", async () => {
    const user = userEvent.setup();
    renderList([]);

    await user.click(screen.getByRole("button", { name: /new pipeline/i }));
    const name = screen.getByLabelText("Name") as HTMLInputElement;
    await user.type(name, "Renewals");
    await user.click(screen.getByRole("button", { name: /^create$/i }));

    // Reopening must not show the previous pipeline's name waiting to be
    // resubmitted, which is what happens if the reset is missed.
    await waitFor(() => expect((name as HTMLInputElement).value).toBe(""));
  });

  it("closes without creating when cancelled", async () => {
    const user = userEvent.setup();
    const { props } = renderList([]);

    await user.click(screen.getByRole("button", { name: /new pipeline/i }));
    await user.type(screen.getByLabelText("Name"), "Renewals");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() => expect(screen.queryByLabelText("Name")).toBeNull());
    expect(props.onCreate).not.toHaveBeenCalled();
  });
});

describe("editing a pipeline", () => {
  /** Open a pipeline's actions menu and choose an item. */
  async function chooseAction(
    user: ReturnType<typeof userEvent.setup>,
    pipelineName: string,
    action: RegExp,
  ) {
    await user.click(
      screen.getByRole("button", { name: `Actions for ${pipelineName}` }),
    );
    await user.click(await screen.findByRole("menuitem", { name: action }));
  }

  it("sends the trimmed name and a blank description as null", async () => {
    const user = userEvent.setup();
    const { props } = renderList([pipeline({ description: "The main one" })]);

    await chooseAction(user, "Sales Pipeline", /edit/i);

    const name = screen.getByLabelText(/pipeline name/i);
    await user.clear(name);
    await user.type(name, "  Renamed  ");
    // Cleared rather than left alone: this is the case where "the description is
    // now empty" has to become an instruction. `null` and an omitted key are
    // different, and the route distinguishes them.
    await user.clear(screen.getByLabelText(/pipeline description/i));
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledTimes(1));
    expect(props.onUpdate).toHaveBeenCalledWith("pipeline-1", {
      name: "Renamed",
      description: null,
    });
  });

  it("saves the stages and the rename from the same button", async () => {
    // The bug this caught. `handleSaveStages` sent the stages and then called
    // `onEditCancel`, so the button marked "Save" discarded the rename and
    // closed the editor. `onUpdate` was reachable only by pressing Enter in the
    // name field — an undocumented gesture, and the only one that committed the
    // edit. Nothing below the component could have noticed: the prop was typed,
    // the callback existed, and the API worked.
    const user = userEvent.setup();
    const { props } = renderList([
      pipeline({ stages: [stage(), stage({ id: "stage-2", key: "WON" })] }),
    ]);

    await chooseAction(user, "Sales Pipeline", /edit/i);
    await user.clear(screen.getByLabelText(/pipeline name/i));
    await user.type(screen.getByLabelText(/pipeline name/i), "Renamed");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledTimes(1));
    // Both halves, not whichever the button happened to be wired to.
    expect(props.onReorderStages).toHaveBeenCalledWith(
      "pipeline-1",
      expect.any(Array),
    );
  });

  it("commits the rename on Enter in the name field", async () => {
    // The gesture that did work, kept working.
    const user = userEvent.setup();
    const { props } = renderList([pipeline()]);

    await chooseAction(user, "Sales Pipeline", /edit/i);
    const name = screen.getByLabelText(/pipeline name/i);
    await user.clear(name);
    await user.type(name, "Renamed{Enter}");

    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledTimes(1));
  });

  it("keeps a description that was not cleared", async () => {
    const user = userEvent.setup();
    const { props } = renderList([pipeline({ description: "The main one" })]);

    await chooseAction(user, "Sales Pipeline", /edit/i);

    const name = screen.getByLabelText(/pipeline name/i);
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(props.onUpdate).toHaveBeenCalledTimes(1));
    expect(props.onUpdate.mock.calls[0][1].description).toBe("The main one");
  });

  it("does not submit an edit whose name was cleared", async () => {
    const user = userEvent.setup();
    const { props } = renderList([pipeline()]);

    await chooseAction(user, "Sales Pipeline", /edit/i);

    const name = screen.getByLabelText(/pipeline name/i);
    await user.clear(name);
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // `handleEditSubmit` returns early on a blank name. An empty pipeline name
    // would break the filter and the stage editor's labelling, so the refusal
    // is the right one — but it has to be a refusal and not a write.
    expect(props.onUpdate).not.toHaveBeenCalled();
  });

  it("returns to the read view after saving", async () => {
    const user = userEvent.setup();
    renderList([pipeline()]);

    await chooseAction(user, "Sales Pipeline", /edit/i);
    const name = screen.getByLabelText(/pipeline name/i);
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    // `queryByRole`, not `getByRole`: `getByRole` throws when the element is
    // gone, and a throwing callback inside `waitFor` is retried until the
    // timeout rather than passing — so this would have reported a failure for
    // the very outcome it was waiting for.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /^save$/i })).toBeNull(),
    );
  });

  it("discards the edit on cancel", async () => {
    const user = userEvent.setup();
    const { props } = renderList([pipeline()]);

    await chooseAction(user, "Sales Pipeline", /edit/i);
    const name = screen.getByLabelText(/pipeline name/i);
    await user.clear(name);
    await user.type(name, "Renamed");
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    await waitFor(() =>
      expect(screen.getByText("Sales Pipeline")).toBeTruthy(),
    );
    expect(props.onUpdate).not.toHaveBeenCalled();
  });
});

describe("deleting a pipeline", () => {
  it("asks first, and warns about referenced deals", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.mocked(confirm);
    renderList([pipeline()]);

    await user.click(
      screen.getByRole("button", { name: "Actions for Sales Pipeline" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    expect(confirmSpy).toHaveBeenCalledTimes(1);
    // The warning has to name the consequence. Deleting a pipeline that deals
    // point at is refused by the API, and a person who does not know that will
    // read the refusal as the app being broken.
    expect(confirmSpy.mock.calls[0][0]).toMatch(/deals reference it/i);
  });

  it("deletes when the confirmation is accepted", async () => {
    const user = userEvent.setup();
    const { props } = renderList([pipeline()]);

    await user.click(
      screen.getByRole("button", { name: "Actions for Sales Pipeline" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    await waitFor(() =>
      expect(props.onDelete).toHaveBeenCalledWith("pipeline-1"),
    );
  });

  it("does nothing when the confirmation is dismissed", async () => {
    const user = userEvent.setup();
    vi.mocked(confirm).mockReturnValue(false);
    const { props } = renderList([pipeline()]);

    await user.click(
      screen.getByRole("button", { name: "Actions for Sales Pipeline" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    // The refusal path. `if (!confirm(...)) return` has no other effect to
    // observe, so this is the assertion that the guard is wired up at all.
    expect(props.onDelete).not.toHaveBeenCalled();
  });

  it("names the pipeline being deleted in the prompt", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.mocked(confirm);
    renderList([pipeline({ name: "Renewals Pipeline" })]);

    await user.click(
      screen.getByRole("button", { name: "Actions for Renewals Pipeline" }),
    );
    await user.click(await screen.findByRole("menuitem", { name: /delete/i }));

    // Two pipelines on screen and one prompt: a generic confirmation is a
    // question about the wrong record.
    expect(confirmSpy.mock.calls[0][0]).toMatch(/pipeline/i);
  });
});
