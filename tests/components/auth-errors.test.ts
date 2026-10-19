import { describe, expect, it } from "vitest";
import {
  type ErrorPayload,
  readErrorPayload,
  toFormError,
} from "@/components/auth/errors";

/**
 * The error envelope, translated for a form.
 *
 * This is the one piece of the forms that is pure: it takes the API's failure
 * shape and decides what a person sees. It had no test while four forms depended
 * on it, which is the situation where a subtle rule — "a detail naming a field
 * this form does not have must still appear" — gets dropped in a refactor and
 * nothing notices.
 */

function payload(overrides: Partial<ErrorPayload> = {}): ErrorPayload {
  return {
    code: "VALIDATION_FAILED",
    message: "The request is not valid.",
    ...overrides,
  };
}

describe("readErrorPayload", () => {
  it("reads code, message and details from the envelope", async () => {
    const response = Response.json(
      {
        error: {
          code: "VALIDATION_FAILED",
          message: "The request is not valid.",
          details: [{ path: "email", message: "Enter a valid email address." }],
        },
      },
      { status: 422 },
    );

    const result = await readErrorPayload(response);

    expect(result.code).toBe("VALIDATION_FAILED");
    expect(result.message).toBe("The request is not valid.");
    expect(result.details).toEqual([
      { path: "email", message: "Enter a valid email address." },
    ]);
  });

  it("falls back to a generic message for a non-JSON body", async () => {
    // A proxy answering with HTML is the case this exists for. Rendered as a
    // parse error, the visitor is told nothing they can act on.
    const response = new Response("<html>502 Bad Gateway</html>", {
      status: 502,
    });

    const result = await readErrorPayload(response);

    expect(result.code).toBe("INTERNAL");
    expect(result.message).toBe("Something went wrong. Try again.");
    expect(result.details).toBeUndefined();
  });

  it("falls back when the body is JSON but not an envelope", async () => {
    const result = await readErrorPayload(Response.json({ oops: true }));

    expect(result.code).toBe("INTERNAL");
    expect(result.message).toBe("Something went wrong. Try again.");
  });

  it("keeps a code and message when details are the wrong type", async () => {
    const response = Response.json({
      error: { code: "CONFLICT", message: "Already exists.", details: "no" },
    });

    const result = await readErrorPayload(response);

    expect(result.code).toBe("CONFLICT");
    expect(result.message).toBe("Already exists.");
    expect(result.details).toBeUndefined();
  });
});

describe("toFormError", () => {
  it("puts a known field's detail on that field", () => {
    const result = toFormError(
      payload({ details: [{ path: "name", message: "Name is required." }] }),
      ["name", "email"],
    );

    expect(result.fields.name).toBe("Name is required.");
    // A detail that landed on a field leaves nothing for the form level.
    expect(result.form).toBeNull();
  });

  it("takes the first message for a field and ignores the rest", () => {
    const result = toFormError(
      payload({
        details: [
          { path: "name", message: "First." },
          { path: "name", message: "Second." },
        ],
      }),
      ["name"],
    );

    expect(result.fields.name).toBe("First.");
  });

  it("keys on the first path segment only", () => {
    // The server names nested paths; the form has one box for the field.
    const result = toFormError(
      payload({ details: [{ path: "address.city", message: "Required." }] }),
      ["address"],
    );

    expect(result.fields.address).toBe("Required.");
  });

  it("promotes a detail for an unknown field to the form level", () => {
    // Dropping it would leave a rejected request with nothing on screen.
    const result = toFormError(
      payload({ details: [{ path: "roleKey", message: "Not assignable." }] }),
      ["name"],
    );

    expect(result.fields).toEqual({});
    expect(result.form).toBe("Not assignable.");
  });

  it("joins several unmatched details into the form message", () => {
    const result = toFormError(
      payload({
        details: [
          { path: "roleKey", message: "Not assignable." },
          { path: "orgId", message: "Unknown." },
        ],
      }),
      ["name"],
    );

    expect(result.form).toBe("Not assignable. Unknown.");
  });

  it("uses the envelope message when there are no details at all", () => {
    // The 401 and 403 case: nothing to attach to a field.
    const result = toFormError(payload({ message: "Not allowed." }), ["name"]);

    expect(result.fields).toEqual({});
    expect(result.form).toBe("Not allowed.");
  });

  it("says nothing above the form when every detail found a field", () => {
    const result = toFormError(
      payload({
        message: "The request is not valid.",
        details: [{ path: "email", message: "Invalid." }],
      }),
      ["email"],
    );

    expect(result.form).toBeNull();
  });

  it("treats an empty details array as no details", () => {
    const result = toFormError(payload({ details: [] }), ["name"]);

    expect(result.form).toBe("The request is not valid.");
  });
});
