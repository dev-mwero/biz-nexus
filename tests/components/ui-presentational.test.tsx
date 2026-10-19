// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MetricCard,
  MetricCardSkeleton,
} from "@/components/dashboard/metric-card";
import { EmptyState, EmptyTableRow } from "@/components/ui/empty-state";

/**
 * The presentational pieces a screen is assembled from.
 *
 * Small, and deliberately so: these are the components whose bugs are invisible
 * in review because they render *something* either way. `MetricCard` carries a
 * documented past bug of exactly that kind — a plain number routed through
 * currency formatting, so two won deals read "$2.00" — and the test below is
 * what keeps the fix true.
 */

afterEach(cleanup);

describe("MetricCard", () => {
  it("renders a caller-formatted value verbatim", () => {
    // The server formatted it in the organisation's own currency already.
    render(
      <MetricCard title="Revenue" value={1234} formattedValue="$1,234.00" />,
    );

    expect(screen.getByText("$1,234.00")).toBeTruthy();
    expect(screen.queryByText("$1,234")).toBeNull();
  });

  it("does not put a currency sign on a bare number", () => {
    // The regression this component documents: a count is not money.
    render(<MetricCard title="Deals won" value={2} />);

    expect(screen.getByText("2")).toBeTruthy();
    expect(screen.queryByText("$2.00")).toBeNull();
  });

  it("formats a bare number in the viewer's locale", () => {
    render(<MetricCard title="Contacts" value={12345} />);

    expect(screen.getByText((12345).toLocaleString())).toBeTruthy();
  });

  it("renders a string value as given", () => {
    render(<MetricCard title="Stage" value="Qualified" />);

    expect(screen.getByText("Qualified")).toBeTruthy();
  });

  it("shows a skeleton instead of the value while loading", () => {
    render(
      <MetricCard
        title="Revenue"
        value={1234}
        formattedValue="$1,234.00"
        loading
      />,
    );

    expect(screen.queryByText("$1,234.00")).toBeNull();
    expect(screen.getByText("Revenue")).toBeTruthy();
  });

  it("hides the trend while loading", () => {
    render(
      <MetricCard
        title="Revenue"
        value={1}
        loading
        trend={{ value: 12.5, label: "vs last month" }}
      />,
    );

    expect(screen.queryByText("vs last month")).toBeNull();
  });

  it("marks an upward trend in words as well as an arrow", () => {
    render(
      <MetricCard
        title="Revenue"
        value={1}
        trend={{ value: 12.5, label: "vs last month" }}
      />,
    );

    // The arrow is `aria-hidden`; a screen reader gets only this.
    expect(screen.getByText("Trending up")).toBeTruthy();
    expect(screen.getByText("+12.5%")).toBeTruthy();
  });

  it("marks a downward trend and prefixes the sign", () => {
    render(
      <MetricCard
        title="Revenue"
        value={1}
        trend={{ value: -8, label: "vs last month" }}
      />,
    );

    expect(screen.getByText("Trending down")).toBeTruthy();
    expect(screen.getByText("-8.0%")).toBeTruthy();
  });

  it("says no change for a flat trend, and does not invent a sign", () => {
    render(
      <MetricCard
        title="Revenue"
        value={1}
        trend={{ value: 0, label: "vs last month" }}
      />,
    );

    expect(screen.getByText("No change")).toBeTruthy();
    expect(screen.getByText("0.0%")).toBeTruthy();
  });

  it("renders a skeleton variant with no accessible content", () => {
    const { container } = render(<MetricCardSkeleton />);

    expect(container.querySelector('[aria-hidden="true"]')).toBeTruthy();
  });
});

describe("EmptyState", () => {
  it("shows the title and description", () => {
    render(
      <EmptyState
        title="No contacts yet"
        description="Add one to get started."
      />,
    );

    expect(screen.getByText("No contacts yet")).toBeTruthy();
    expect(screen.getByText("Add one to get started.")).toBeTruthy();
  });

  it("builds a link from a descriptor with an href", () => {
    render(
      <EmptyState
        title="No deals"
        action={{ label: "Create a deal", href: "/deals/new" }}
      />,
    );

    const link = screen.getByRole("link", { name: "Create a deal" });
    expect(link.getAttribute("href")).toBe("/deals/new");
  });

  it("builds a button from a descriptor with a handler", async () => {
    const onClick = vi.fn();
    const user = userEvent.setup();
    render(
      <EmptyState
        title="No results"
        action={{ label: "Clear filters", onClick }}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Clear filters" }));

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("renders arbitrary children as the action", () => {
    render(
      <EmptyState
        title="No results"
        action={<span data-testid="custom-action">custom</span>}
      />,
    );

    expect(screen.getByTestId("custom-action")).toBeTruthy();
  });

  it("renders nothing for the action when none is given", () => {
    render(<EmptyState title="No results" />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("EmptyTableRow", () => {
  it("spans the table's columns so the headers stay aligned", () => {
    const { container } = render(
      <table>
        <tbody>
          <EmptyTableRow colSpan={4}>
            <span>Nothing here</span>
          </EmptyTableRow>
        </tbody>
      </table>,
    );

    const cell = container.querySelector("td");
    expect(cell?.getAttribute("colspan")).toBe("4");
    expect(screen.getByText("Nothing here")).toBeTruthy();
  });
});
