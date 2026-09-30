import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The env module parses at import time, so every case here re-imports it with
 * a fresh module registry and a hand-built `process.env`. Mutating the exported
 * object instead would test nothing about the guards, which are the point.
 */

const VALID = {
  APP_NAME: "BizNexus",
  APP_URL: "http://localhost:3000",
  MONGODB_URI: "mongodb://127.0.0.1:27017/biz_nexus",
  SESSION_SECRET: "a-secret-that-is-definitely-long-enough",
  MAIL_DRIVER: "console",
  MAIL_FROM: "BizNexus <no-reply@example.com>",
  RATELIMIT_DRIVER: "memory",
} as const;

/**
 * Every key the schema reads, cleared before each test.
 *
 * Without this, a value set by one case survives into the next and the suite
 * reports failures that belong to a previous test. The SMTP cases are the worst
 * of it: a partial SMTP config in one test satisfies "host is set" in the next.
 */
const MANAGED_KEYS = [
  "NODE_ENV",
  "NEXT_PHASE",
  "APP_NAME",
  "APP_URL",
  "MONGODB_URI",
  "SESSION_SECRET",
  "MAIL_DRIVER",
  "MAIL_FROM",
  "RESEND_API_KEY",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_PASSWORD",
  "RATELIMIT_DRIVER",
  "UPSTASH_REDIS_REST_URL",
  "UPSTASH_REDIS_REST_TOKEN",
  "NEXT_PUBLIC_APP_NAME",
] as const;

async function loadEnv(overrides: Record<string, string | undefined> = {}) {
  // Next declares NODE_ENV readonly, which is right: a running application must
  // not change it. These tests deliberately simulate a deployment, so the cast
  // is the intent rather than a shortcut.
  const writable = process.env as Record<string, string | undefined>;

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) delete writable[key];
    else writable[key] = value;
  }
  vi.resetModules();
  return import("@/env");
}

describe("env", () => {
  beforeEach(() => {
    const writable = process.env as Record<string, string | undefined>;
    for (const key of MANAGED_KEYS) delete writable[key];
    writable.NODE_ENV = "test";
    for (const [key, value] of Object.entries(VALID)) writable[key] = value;
  });

  afterAll(() => {
    const writable = process.env as Record<string, string | undefined>;
    for (const key of MANAGED_KEYS) delete writable[key];
  });

  describe("a valid environment", () => {
    it("exposes typed values", async () => {
      const { env } = await loadEnv();
      expect(env.APP_NAME).toBe("BizNexus");
      expect(env.APP_URL).toBe("http://localhost:3000");
    });

    it("defaults the optional drivers", async () => {
      const { env } = await loadEnv({ MAIL_DRIVER: undefined });
      expect(env.MAIL_DRIVER).toBe("console");
      expect(env.RATELIMIT_DRIVER).toBe("memory");
    });

    it("is frozen, so a stray mutation cannot fake a valid config", async () => {
      const { env } = await loadEnv();
      expect(Object.isFrozen(env)).toBe(true);
    });

    it("coerces a numeric port", async () => {
      const { env } = await loadEnv({
        MAIL_DRIVER: "smtp",
        SMTP_HOST: "smtp.example.com",
        SMTP_PORT: "587",
        SMTP_USER: "u",
        SMTP_PASSWORD: "p",
      });
      expect(env.SMTP_PORT).toBe(587);
      expect(typeof env.SMTP_PORT).toBe("number");
    });

    it("exposes client values through clientEnv", async () => {
      const { clientEnv } = await loadEnv({ NEXT_PUBLIC_APP_NAME: "Acme" });
      expect(clientEnv.appName).toBe("Acme");
    });

    it("falls back to the server name when no public name is set", async () => {
      const { clientEnv, env } = await loadEnv();
      expect(clientEnv.appName).toBe(env.APP_NAME);
    });
  });

  describe("MAIL_FROM", () => {
    // The display-name form is what .env.example documents. A bare z.email()
    // rejects it, so this is the regression guard for that.
    it("accepts a display name and an address", async () => {
      await expect(
        loadEnv({ MAIL_FROM: "BizNexus <no-reply@example.com>" }),
      ).resolves.toBeDefined();
    });

    it("accepts a bare address", async () => {
      await expect(
        loadEnv({ MAIL_FROM: "no-reply@example.com" }),
      ).resolves.toBeDefined();
    });

    it("accepts an unquoted display name", async () => {
      await expect(
        loadEnv({ MAIL_FROM: "BizNexus <no-reply@example.com>" }),
      ).resolves.toBeDefined();
    });

    it("rejects an address with no domain", async () => {
      await expect(
        loadEnv({ MAIL_FROM: "no-reply@localhost" }),
      ).rejects.toThrow(/MAIL_FROM/);
    });

    it("rejects a bare word", async () => {
      await expect(loadEnv({ MAIL_FROM: "nobody" })).rejects.toThrow(
        /MAIL_FROM/,
      );
    });
  });

  describe("required variables", () => {
    it("throws when a variable is missing", async () => {
      await expect(loadEnv({ MONGODB_URI: undefined })).rejects.toThrow(
        /MONGODB_URI/,
      );
    });

    it("throws when a variable is empty", async () => {
      await expect(loadEnv({ APP_NAME: "" })).rejects.toThrow(/APP_NAME/);
    });

    it("reports every problem at once, not one per boot", async () => {
      // Discovering these one deploy at a time is the failure mode this module
      // exists to remove.
      await expect(
        loadEnv({
          MONGODB_URI: undefined,
          SESSION_SECRET: undefined,
          APP_NAME: "",
        }),
      ).rejects.toThrow(/3 problems/);
    });

    it("rejects a connection string that is not a connection string", async () => {
      await expect(loadEnv({ MONGODB_URI: "localhost" })).rejects.toThrow(
        /mongodb:\/\//,
      );
    });

    it("rejects a short secret", async () => {
      await expect(loadEnv({ SESSION_SECRET: "too-short" })).rejects.toThrow(
        /32 characters/,
      );
    });

    it("rejects a trailing slash on APP_URL", async () => {
      // APP_URL is concatenated with paths; a trailing slash produces //.
      await expect(
        loadEnv({ APP_URL: "http://localhost:3000/" }),
      ).rejects.toThrow(/trailing slash/);
    });

    it("throws a typed error carrying the issues", async () => {
      // Asserted by shape, not `instanceof`: the module is re-imported per test
      // so the class identity differs from the one a static import would hold.
      // That is a test artefact, not something a caller would notice.
      const error = await loadEnv({ MONGODB_URI: undefined }).catch((e) => e);
      expect(error).toBeInstanceOf(Error);
      expect(error.name).toBe("EnvValidationError");
      expect(error.issues).toHaveLength(1);
      expect(error.issues[0]).toMatch(/MONGODB_URI/);
      expect(error.message).toMatch(/Invalid environment — 1 problem/);
    });
  });

  describe("conditional requirements", () => {
    it("requires an API key for the resend driver", async () => {
      await expect(loadEnv({ MAIL_DRIVER: "resend" })).rejects.toThrow(
        /RESEND_API_KEY/,
      );
    });

    it("accepts resend with a key", async () => {
      await expect(
        loadEnv({ MAIL_DRIVER: "resend", RESEND_API_KEY: "re_123" }),
      ).resolves.toBeDefined();
    });

    it("requires the full smtp set, not just a host", async () => {
      // A half-configured SMTP driver is the case that boots successfully and
      // then fails on the first send.
      await expect(
        loadEnv({ MAIL_DRIVER: "smtp", SMTP_HOST: "smtp.example.com" }),
      ).rejects.toThrow(/SMTP_USER/);
    });

    it("requires redis credentials for the redis limiter", async () => {
      await expect(loadEnv({ RATELIMIT_DRIVER: "redis" })).rejects.toThrow(
        /UPSTASH_REDIS_REST_URL/,
      );
    });

    it("does not require unused driver credentials", async () => {
      // A console-mail install must not be forced to invent an SMTP password.
      await expect(
        loadEnv({ MAIL_DRIVER: "console", RESEND_API_KEY: undefined }),
      ).resolves.toBeDefined();
    });
  });

  describe("production hardening", () => {
    const production = {
      NODE_ENV: "production",
      APP_URL: "https://biz-nexus.vercel.app",
      MAIL_DRIVER: "resend",
      RESEND_API_KEY: "re_123",
      SESSION_SECRET: "a-real-looking-secret-of-sufficient-length",
    } as const;

    it("accepts a fully configured production environment", async () => {
      await expect(loadEnv(production)).resolves.toBeDefined();
    });

    it("refuses the console mail driver", async () => {
      // Password-reset links printed to a log is a data leak with extra steps.
      await expect(
        loadEnv({
          ...production,
          MAIL_DRIVER: "console",
          RESEND_API_KEY: undefined,
        }),
      ).rejects.toThrow(/console mail driver/);
    });

    it("refuses a placeholder secret", async () => {
      await expect(
        loadEnv({
          ...production,
          SESSION_SECRET: "replace-with-openssl-rand-base64-32",
        }),
      ).rejects.toThrow(/placeholder/i);
    });

    it("refuses a plaintext origin that is not localhost", async () => {
      await expect(
        loadEnv({ ...production, APP_URL: "http://biz-nexus.example.com" }),
      ).rejects.toThrow(/https/);
    });

    it("allows http on localhost, so a production-mode smoke test can run", async () => {
      await expect(
        loadEnv({ ...production, APP_URL: "http://localhost:3000" }),
      ).resolves.toBeDefined();
    });

    it("accepts the .env.example secret in development", async () => {
      // The template has to be usable locally, or nobody fills it in.
      await expect(
        loadEnv({
          NODE_ENV: "development",
          SESSION_SECRET: "replace-with-openssl-rand-base64-32",
        }),
      ).resolves.toBeDefined();
    });
  });

  describe("NODE_ENV is required, not defaulted", () => {
    // The failure mode of an unvalidated NODE_ENV in front of the hardening
    // gate is off, not loud: unset means "not production", so every rule above
    // is skipped and nothing anywhere reports it.
    it("rejects an unset NODE_ENV rather than defaulting it", async () => {
      await expect(loadEnv({ NODE_ENV: undefined })).rejects.toThrow(
        /NODE_ENV/,
      );
    });

    it("rejects a value outside the three environments", async () => {
      await expect(loadEnv({ NODE_ENV: "staging" })).rejects.toThrow(
        /NODE_ENV/,
      );
    });

    it("rejects an empty NODE_ENV", async () => {
      await expect(loadEnv({ NODE_ENV: "" })).rejects.toThrow(/NODE_ENV/);
    });
  });

  describe("the build phase defers production hardening", () => {
    // `next build` sets NODE_ENV=production for itself and imports every route
    // module while collecting page data. Without this, the documented local
    // setup — `cp .env.example .env.local && npm run build` — is a hard
    // failure, which is what 1.29 introduced when the first route.ts appeared.
    const unhardened = {
      NODE_ENV: "production",
      SESSION_SECRET: "replace-with-openssl-rand-base64-32",
      MAIL_DRIVER: "console",
      RESEND_API_KEY: undefined,
      APP_URL: "http://biz-nexus.example.com",
    } as const;

    it("refuses all three in a process that will serve requests", async () => {
      await expect(loadEnv(unhardened)).rejects.toThrow(/placeholder/i);
    });

    it("resolves during page-data collection, which is not a deployment", async () => {
      const { env } = await loadEnv({
        ...unhardened,
        NEXT_PHASE: "phase-production-build",
      });
      expect(env.NODE_ENV).toBe("production");
    });

    it("still validates presence during the build", async () => {
      // The deferral is for the hardening rules only. A missing database URL is
      // a fact about the build too, and failing the build is what it is for.
      await expect(
        loadEnv({
          ...unhardened,
          NEXT_PHASE: "phase-production-build",
          MONGODB_URI: undefined,
        }),
      ).rejects.toThrow(/MONGODB_URI/);
    });

    it("still rejects a missing secret during the build", async () => {
      await expect(
        loadEnv({
          ...unhardened,
          NEXT_PHASE: "phase-production-build",
          SESSION_SECRET: undefined,
        }),
      ).rejects.toThrow(/SESSION_SECRET/);
    });

    it("does not defer for any other NEXT_PHASE value", async () => {
      // Only Next's production-build literal defers. A typo in the predicate
      // would otherwise be a silent hole rather than a failed test.
      for (const phase of [
        "phase-production-server",
        "phase-development-server",
        "phase-production-build ",
        "PRODUCTION-BUILD",
      ]) {
        await expect(
          loadEnv({ ...unhardened, NEXT_PHASE: phase }),
          phase,
        ).rejects.toThrow(/placeholder/i);
      }
    });
  });
});
