import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import { ensureUniqueSlug, SlugConflictError, slugify } from "@/db/mixins/slug";
import {
  MixinCompanyModel,
  MixinCompanyRepository,
} from "../../support/fixtures/mixin-models";

const ORG = new Types.ObjectId("64b0000000000000000000a1");
const OTHER_ORG = new Types.ObjectId("64b0000000000000000000b2");
const ALICE = new Types.ObjectId("64b0000000000000000000c3");

beforeEach(async () => {
  await connectToDatabase();
  await MixinCompanyModel.deleteMany({});
});

afterEach(async () => {
  await MixinCompanyModel.deleteMany({});
});

describe("slugify", () => {
  it("lowercases and joins words with hyphens", () => {
    expect(slugify("Acme Corporation")).toBe("acme-corporation");
  });

  it("collapses runs of punctuation", () => {
    expect(slugify("Acme  ///  Corp!!")).toBe("acme-corp");
  });

  it("trims leading and trailing hyphens", () => {
    expect(slugify("  --Acme--  ")).toBe("acme");
  });

  it("keeps digits", () => {
    expect(slugify("Acme 24/7")).toBe("acme-24-7");
  });

  /**
   * The cases a regex-only implementation gets wrong. Each of these is a real
   * company name and each produces a different, broken slug if the combining
   * marks are not stripped separately.
   */
  it("strips accents rather than the letter they sit on", () => {
    // "Café" -> "cafe", not "caf". A naive [^a-z0-9] replacement drops the é
    // entirely because the accent is a separate code point.
    expect(slugify("Café")).toBe("cafe");
    expect(slugify("Ångström")).toBe("angstrom");
    expect(slugify("Naïve Über")).toBe("naive-uber");
  });

  it("spells out letters that have no accent decomposition", () => {
    // ø and æ do not decompose under NFKD, so they survive normalisation and
    // would be stripped as "not a-z" rather than transliterated.
    expect(slugify("Blåbær")).toBe("blabaer");
    expect(slugify("Søren")).toBe("soren");
    expect(slugify("Straße")).toBe("strasse");
  });

  it("truncates on a word boundary", () => {
    const slug = slugify("The Very Long Company Name That Goes On", {
      maxLength: 20,
    });
    expect(slug.length).toBeLessThanOrEqual(20);
    expect(slug.endsWith("-")).toBe(false);
    expect(slug).toBe("the-very-long");
  });

  it("returns an empty string for a script with no latin characters", () => {
    // Not an error. The caller has to handle it, and the test documents that
    // it is possible rather than asserting it cannot happen.
    expect(slugify("日本語")).toBe("");
  });
});

describe("ensureUniqueSlug", () => {
  it("returns the base slug when it is free", async () => {
    expect(await ensureUniqueSlug(MixinCompanyModel, "Acme Corporation")).toBe(
      "acme-corporation",
    );
  });

  it("appends a counter when the base is taken", async () => {
    await new MixinCompanyRepository(ORG, ALICE).create({
      name: "Acme",
      slug: "acme",
    });

    expect(await ensureUniqueSlug(MixinCompanyModel, "Acme")).toBe("acme-2");
  });

  it("keeps counting past several collisions", async () => {
    for (const slug of ["acme", "acme-2", "acme-3"]) {
      await new MixinCompanyRepository(ORG, ALICE).create({ name: slug, slug });
    }

    expect(await ensureUniqueSlug(MixinCompanyModel, "Acme")).toBe("acme-4");
  });

  /**
   * Uniqueness is global by design, so the check necessarily crosses
   * organisations. Two tenants named "Acme" get "acme" and "acme-2" rather
   * than both holding "acme" and resolving ambiguously in a URL.
   */
  it("treats a slug held by another organisation as taken", async () => {
    await new MixinCompanyRepository(OTHER_ORG, ALICE).create({
      name: "Acme",
      slug: "acme",
    });

    expect(await ensureUniqueSlug(MixinCompanyModel, "Acme")).toBe("acme-2");
  });

  it("lets a company keep its own slug when renaming", async () => {
    const repo = new MixinCompanyRepository(ORG, ALICE);
    const company = await repo.create({ name: "Acme", slug: "acme" });

    // Excluding itself is what stops a rename from colliding with itself and
    // appending "-2" to a company that already owns the name.
    expect(
      await ensureUniqueSlug(MixinCompanyModel, "Acme Corp", {
        excludeId: company._id,
      }),
    ).toBe("acme-corp");
  });

  it("falls back to a random slug when the name has no latin characters", async () => {
    const slug = await ensureUniqueSlug(MixinCompanyModel, "日本語");
    expect(slug).toMatch(/^org-[a-z0-9]{6}$/);
  });

  it("gives up loudly rather than looping forever", async () => {
    await new MixinCompanyRepository(ORG, ALICE).create({
      name: "Acme",
      slug: "acme",
    });

    await expect(
      ensureUniqueSlug(MixinCompanyModel, "Acme", { maxAttempts: 1 }),
    ).rejects.toBeInstanceOf(SlugConflictError);
  });

  it("produces a slug that the unique index accepts end to end", async () => {
    // The pre-check is a convenience; the index is the guarantee. This asserts
    // the two agree, which is the part that would otherwise only be discovered
    // in production.
    await new MixinCompanyRepository(ORG, ALICE).create({
      name: "Acme",
      slug: "acme",
    });
    const second = await ensureUniqueSlug(MixinCompanyModel, "Acme");

    await expect(
      new MixinCompanyRepository(ORG, ALICE).create({
        name: "Acme 2",
        slug: second,
      }),
    ).resolves.toMatchObject({ slug: "acme-2" });
  });
});
