import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  createWithUniqueSlug,
  ensureUniqueSlug,
  isDuplicateKeyOn,
  SlugConflictError,
  slugify,
} from "@/db/mixins/slug";
import { makeCompanyFixtures } from "../../support/fixtures/mixin-models";
import {
  type OrganizationFixture,
  OrganizationFixtureModel,
} from "../../support/fixtures/organization-model";

const ORG = new Types.ObjectId("64b0000000000000000000a1");
const OTHER_ORG = new Types.ObjectId("64b0000000000000000000b2");
const ALICE = new Types.ObjectId("64b0000000000000000000c3");

// Its own collection, so this suite running in parallel cannot wipe the mixin
// suite's rows between a seed and an assertion.
const { model: SlugCompanyModel, Repository: SlugCompanyRepository } =
  makeCompanyFixtures("slug");

beforeEach(async () => {
  await connectToDatabase();
  await SlugCompanyModel.deleteMany({});
});

afterEach(async () => {
  await SlugCompanyModel.deleteMany({});
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
    expect(await ensureUniqueSlug(SlugCompanyModel, "Acme Corporation")).toBe(
      "acme-corporation",
    );
  });

  it("appends a counter when the base is taken", async () => {
    await new SlugCompanyRepository(ORG, ALICE).create({
      name: "Acme",
      slug: "acme",
    });

    expect(await ensureUniqueSlug(SlugCompanyModel, "Acme")).toBe("acme-2");
  });

  it("keeps counting past several collisions", async () => {
    for (const slug of ["acme", "acme-2", "acme-3"]) {
      await new SlugCompanyRepository(ORG, ALICE).create({ name: slug, slug });
    }

    expect(await ensureUniqueSlug(SlugCompanyModel, "Acme")).toBe("acme-4");
  });

  /**
   * Uniqueness is global by design, so the check necessarily crosses
   * organisations. Two tenants named "Acme" get "acme" and "acme-2" rather
   * than both holding "acme" and resolving ambiguously in a URL.
   */
  it("treats a slug held by another organisation as taken", async () => {
    await new SlugCompanyRepository(OTHER_ORG, ALICE).create({
      name: "Acme",
      slug: "acme",
    });

    expect(await ensureUniqueSlug(SlugCompanyModel, "Acme")).toBe("acme-2");
  });

  it("lets a company keep its own slug when renaming", async () => {
    const repo = new SlugCompanyRepository(ORG, ALICE);
    const company = await repo.create({ name: "Acme", slug: "acme" });

    // Excluding itself is what stops a rename from colliding with itself and
    // appending "-2" to a company that already owns the name.
    expect(
      await ensureUniqueSlug(SlugCompanyModel, "Acme Corp", {
        excludeId: company._id,
      }),
    ).toBe("acme-corp");
  });

  it("falls back to a random slug when the name has no latin characters", async () => {
    const slug = await ensureUniqueSlug(SlugCompanyModel, "日本語");
    expect(slug).toMatch(/^org-[a-z0-9]{6}$/);
  });

  it("gives up loudly rather than looping forever", async () => {
    await new SlugCompanyRepository(ORG, ALICE).create({
      name: "Acme",
      slug: "acme",
    });

    await expect(
      ensureUniqueSlug(SlugCompanyModel, "Acme", { maxAttempts: 1 }),
    ).rejects.toBeInstanceOf(SlugConflictError);
  });

  it("produces a slug that the unique index accepts end to end", async () => {
    // The pre-check is a convenience; the index is the guarantee. This asserts
    // the two agree, which is the part that would otherwise only be discovered
    // in production.
    await new SlugCompanyRepository(ORG, ALICE).create({
      name: "Acme",
      slug: "acme",
    });
    const second = await ensureUniqueSlug(SlugCompanyModel, "Acme");

    await expect(
      new SlugCompanyRepository(ORG, ALICE).create({
        name: "Acme 2",
        slug: second,
      }),
    ).resolves.toMatchObject({ slug: "acme-2" });
  });
});

describe("createWithUniqueSlug", () => {
  beforeEach(async () => {
    await connectToDatabase();
    await OrganizationFixtureModel.deleteMany({});
  });

  afterEach(async () => {
    await OrganizationFixtureModel.deleteMany({});
  });

  const build = (slug: string) =>
    ({ name: "Acme", slug }) as unknown as Omit<OrganizationFixture, "_id">;

  it("creates on the base slug when it is free", async () => {
    const created = await createWithUniqueSlug(
      OrganizationFixtureModel,
      "Acme Corporation",
      build,
    );

    expect(created.slug).toBe("acme-corporation");
  });

  it("retries and succeeds when a concurrent write takes the slug", async () => {
    // The case the pre-check cannot cover on its own: the check passes, then
    // the unique index rejects. Without the retry this is a 500 for a name
    // that was free a moment ago and is now held by its own twin.
    await OrganizationFixtureModel.create({ name: "Acme", slug: "acme" });

    const created = await createWithUniqueSlug(
      OrganizationFixtureModel,
      "Acme",
      build,
    );

    expect(created.slug).toBe("acme-2");
  });

  it("resolves a genuine collision under concurrent creates", async () => {
    // Ten simultaneous creates of one name. Every pre-check passes, so the
    // pre-check is useless here and the retry is the whole mechanism.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        createWithUniqueSlug(OrganizationFixtureModel, "Concurrent", build),
      ),
    );

    const created = results.filter((r) => r.status === "fulfilled");
    const slugs = created.map(
      (r) => (r as PromiseFulfilledResult<{ slug: string }>).value.slug,
    );
    expect(created).toHaveLength(10);
    expect(new Set(slugs).size).toBe(10);
    expect(await OrganizationFixtureModel.countDocuments({})).toBe(10);
  });

  it("gives up rather than looping forever when the range is exhausted", async () => {
    // The whole budget taken, so there is genuinely nowhere left to go. The
    // point is that it fails loudly and quickly rather than spinning.
    for (const slug of ["acme", "acme-2", "acme-3", "acme-4"]) {
      await OrganizationFixtureModel.create({ name: slug, slug });
    }

    await expect(
      createWithUniqueSlug(OrganizationFixtureModel, "Acme", build, {
        maxAttempts: 2,
      }),
    ).rejects.toBeInstanceOf(SlugConflictError);
  });

  it("lands on the lowest free suffix for an ordinary single race", async () => {
    // One collision is the common case, and it must be deterministic. Jitter
    // applied here would hand out -2 or -5 at random, leaving gaps in the
    // sequence and making the outcome untestable.
    await OrganizationFixtureModel.create({ name: "Acme", slug: "acme" });

    for (let i = 0; i < 5; i += 1) {
      const created = await createWithUniqueSlug(
        OrganizationFixtureModel,
        "Acme",
        build,
      );
      expect(created.slug).toBe("acme-2");
      await OrganizationFixtureModel.collection.deleteOne({ slug: "acme-2" });
    }
  });

  it("resolves under sustained contention, not just a single race", async () => {
    // Ten writers against one name is a thundering herd, not a race: without
    // jitter on the retry offset every writer finds -2 free, all ten insert,
    // and nine retry into the same collision in lockstep.
    const results = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        createWithUniqueSlug(OrganizationFixtureModel, "Concurrent", build),
      ),
    );

    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    expect(await OrganizationFixtureModel.countDocuments({})).toBe(10);
  });
});

describe("isDuplicateKeyOn", () => {
  /**
   * The discriminator is the safety property of the retry. Retrying on a
   * duplicate of any field would append "-2" to a value that is not ours to
   * change — a duplicate email would become user-2@example.com, and the caller
   * would receive a successful registration for an address they do not own.
   */
  const duplicate = (keyPattern: Record<string, unknown>) =>
    Object.assign(new Error("E11000 duplicate key error"), {
      code: 11000,
      keyPattern,
    });

  it("matches only the field the index actually covers", () => {
    expect(isDuplicateKeyOn(duplicate({ slug: 1 }), "slug")).toBe(true);
    expect(isDuplicateKeyOn(duplicate({ email: 1 }), "slug")).toBe(false);
    expect(isDuplicateKeyOn(duplicate({ slug: 1, email: 1 }), "slug")).toBe(
      true,
    );
  });

  it("ignores errors that are not duplicate keys", () => {
    expect(isDuplicateKeyOn(new Error("validation failed"), "slug")).toBe(
      false,
    );
    expect(isDuplicateKeyOn(null, "slug")).toBe(false);
    expect(isDuplicateKeyOn("nope", "slug")).toBe(false);
    expect(
      isDuplicateKeyOn(Object.assign(new Error("x"), { code: 11001 }), "slug"),
    ).toBe(false);
  });

  it("assumes a bare driver duplicate is a slug conflict", () => {
    // keyPattern is populated by the driver and preserved through Mongoose's
    // wrapper. A duplicate that reaches us without one is not something to
    // silently drop, so it is retried rather than surfaced.
    expect(
      isDuplicateKeyOn(
        Object.assign(new Error("E11000"), { code: 11000 }),
        "slug",
      ),
    ).toBe(true);
  });
});
