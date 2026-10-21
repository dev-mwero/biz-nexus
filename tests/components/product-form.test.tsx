// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProductForm,
  type ProductFormSubmission,
} from "@/components/products/ProductForm";

/**
 * The product form, at the DOM.
 *
 * The price is the reason this is worth testing here rather than in the money
 * module: the form is where a human's decimal string becomes an integer, and
 * the conversion is currency-dependent. A USD price of "12.50" is 1250 minor
 * units; a JPY price of "12.5" is not a price at all.
 */

function renderCreate(overrides = {}) {
  const onSubmit = vi.fn();
  const props = {
    mode: "create" as const,
    currency: "USD",
    onSubmit,
    cancelHref: "/products",
    ...overrides,
  };
  return { onSubmit, ...render(<ProductForm {...props} />) };
}

function renderEdit(overrides = {}) {
  const onSubmit = vi.fn();
  const props = {
    mode: "edit" as const,
    currency: "USD",
    initial: {
      name: "Consulting hour",
      type: "SERVICE" as const,
      unitPriceMinor: 1250,
      status: "ACTIVE" as const,
    },
    onSubmit,
    cancelHref: "/products",
    ...overrides,
  };
  return { onSubmit, ...render(<ProductForm {...props} />) };
}

const submit = () => screen.getByRole("button", { name: /create product/i });
const save = () => screen.getByRole("button", { name: /save changes/i });

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("validation", () => {
  it("refuses a blank name without submitting", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();

    await user.type(screen.getByLabelText(/^name/i), "   ");
    await user.type(screen.getByLabelText(/unit price/i), "10");
    await user.click(submit());

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses a price that is not a number", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();

    await user.type(screen.getByLabelText(/^name/i), "Widget");
    await user.type(screen.getByLabelText(/unit price/i), "abc");
    await user.click(submit());

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses a negative price", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();

    await user.type(screen.getByLabelText(/^name/i), "Widget");
    await user.type(screen.getByLabelText(/unit price/i), "-5");
    await user.click(submit());

    expect(await screen.findByText(/cannot be negative/i)).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("refuses more decimals than the currency has", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate({ currency: "JPY" });

    await user.type(screen.getByLabelText(/^name/i), "Widget");
    await user.type(screen.getByLabelText(/unit price/i), "12.5");
    await user.click(submit());

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe("submitting", () => {
  it("sends the price as integer minor units and trims the text fields", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();

    await user.type(screen.getByLabelText(/^name/i), "  Consulting hour  ");
    await user.type(screen.getByLabelText("SKU"), "  CONS-IV  ");
    await user.type(screen.getByLabelText(/unit label/i), "  hour  ");
    await user.type(screen.getByLabelText(/unit price/i), "12.50");
    await user.click(submit());

    expect(onSubmit).toHaveBeenCalledTimes(1);
    const submission = onSubmit.mock.calls[0][0] as ProductFormSubmission;
    expect(submission).toEqual({
      name: "Consulting hour",
      sku: "CONS-IV",
      description: null,
      type: "PRODUCT",
      unitPriceMinor: 1250,
      unitLabel: "hour",
      status: "ACTIVE",
    });
  });

  it("parses a zero-decimal currency without inventing cents", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate({ currency: "JPY" });

    await user.type(screen.getByLabelText(/^name/i), "Widget");
    await user.type(screen.getByLabelText(/unit price/i), "1250");
    await user.click(submit());

    const submission = onSubmit.mock.calls[0][0] as ProductFormSubmission;
    expect(submission.unitPriceMinor).toBe(1250);
  });

  it("sends a cleared optional field as null", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderCreate();

    await user.type(screen.getByLabelText(/^name/i), "Widget");
    await user.type(screen.getByLabelText(/unit price/i), "10");
    await user.click(submit());

    const submission = onSubmit.mock.calls[0][0] as ProductFormSubmission;
    expect(submission.sku).toBeNull();
    expect(submission.description).toBeNull();
    expect(submission.unitLabel).toBeNull();
  });

  it("shows a server error passed in", () => {
    renderCreate({ formError: "A product with SKU CONS-IV already exists." });

    expect(
      screen.getByText(/a product with sku cons-iv already exists/i),
    ).toBeTruthy();
  });
});

describe("editing", () => {
  it("renders the existing price in major units", () => {
    renderEdit();

    const price = screen.getByLabelText(/unit price/i) as HTMLInputElement;
    expect(price.value).toBe("12.5");
  });

  it("offers the status select and carries the change into the submission", async () => {
    const user = userEvent.setup();
    const { onSubmit } = renderEdit();

    await user.click(screen.getAllByRole("combobox")[1]);
    await user.click(await screen.findByText("Archived"));
    await user.click(save());

    const submission = onSubmit.mock.calls[0][0] as ProductFormSubmission;
    expect(submission.status).toBe("ARCHIVED");
  });

  it("does not offer the status select when creating", () => {
    renderCreate();

    expect(screen.queryByLabelText("Status")).toBeNull();
  });
});
