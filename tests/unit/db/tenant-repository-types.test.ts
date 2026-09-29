import { Types } from "mongoose";
import { describe, expect, it } from "vitest";
import type { ScopedFilter, TenantCreateInput } from "@/db/tenant-repository";
import { ContactRepository } from "../../support/fixtures/contact-repository";

/**
 * The acceptance criterion for this module is that omitting the org filter is
 * impossible. The runtime tests prove the scope is merged; these prove the
 * filter cannot be *written* unscoped in the first place.
 *
 * `@ts-expect-error` is the whole mechanism. It is not a comment: if the error
 * ever stops happening, `tsc` reports an unused directive and
 * `npm run typecheck` — which the pre-commit hook runs — fails. A type test
 * written as prose would have caught none of this.
 */

const ORG = new Types.ObjectId();
const OTHER = new Types.ObjectId("64b0000000000000000000ff");

describe("ScopedFilter", () => {
  it("rejects a caller-supplied organizationId", () => {
    const repo = new ContactRepository(ORG);

    // @ts-expect-error organizationId is the repository's to set, never the caller's
    void repo.find({ organizationId: OTHER });

    // @ts-expect-error same for a single record
    void repo.findOne({ organizationId: OTHER });

    // @ts-expect-error and for a count
    void repo.countDocuments({ organizationId: OTHER });
  });

  it("rejects a dotted organizationId escape hatch", () => {
    const repo = new ContactRepository(ORG);

    // The obvious workarounds a determined caller would try. All of them are
    // operator expressions against the same key, and all of them are type
    // errors.
    // biome-ignore-start lint/complexity/useLiteralKeys: the computed key is the point; a literal would test nothing
    // @ts-expect-error operator-style access to the scope is still the scope
    void repo.find({ ["organizationId"]: OTHER });
    // biome-ignore-end lint/complexity/useLiteralKeys: the computed key is the point; a literal would test nothing

    // @ts-expect-error a negated $ne is not a way to escape
    void repo.find({ organizationId: { $ne: ORG } });
  });

  it("still accepts an ordinary filter", () => {
    const repo = new ContactRepository(ORG);

    // The type must be narrow enough to be safe and wide enough to be usable,
    // or every call site will reach for a cast and the guard is gone.
    const filter: ScopedFilter<{ name: string }> = { name: "Alice" };
    expect(filter).toEqual({ name: "Alice" });
    expect(typeof repo.find).toBe("function");
  });
});

describe("TenantCreateInput", () => {
  it("rejects an organizationId at creation", () => {
    // A document written without the scope is invisible to every scoped read,
    // and therefore invisible to the user who just created it.
    const input: TenantCreateInput<{
      organizationId: Types.ObjectId;
      _id: Types.ObjectId;
      createdAt: Date;
      updatedAt: Date;
      name: string;
    }> = {
      // @ts-expect-error organizationId is stamped by the repository
      organizationId: OTHER,
      name: "Alice",
    };

    expect(input.name).toBe("Alice");
  });

  it("accepts a create input without a scope", () => {
    const input: TenantCreateInput<{
      organizationId: Types.ObjectId;
      _id: Types.ObjectId;
      createdAt: Date;
      updatedAt: Date;
      name: string;
    }> = { name: "Alice" };

    expect(input).toEqual({ name: "Alice" });
  });
});
