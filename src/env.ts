import { z } from "zod";

/**
 * The environment, validated once.
 *
 * Two things this module is for, and both of them exist because the alternative
 * is a bug nobody finds until production.
 *
 * First: an unset variable is a startup failure, not a runtime surprise. A
 * missing `SESSION_SECRET` that surfaces as a 500 on the first password reset is
 * a bad afternoon; a missing one that throws on boot is a two-second fix. Every
 * problem is reported at once, because discovering them one deploy at a time is
 * the failure mode this replaces.
 *
 * Second: a placeholder left over from `.env.example` must not survive to
 * production. Development gets a documented allowance; production does not, and
 * `console` mail is refused outright because an environment that silently
 * prints password-reset links to a log is a data leak with extra steps.
 *
 * Rules for keeping this honest:
 *
 *   - Nothing outside this file may read `process.env`. A test enforces it.
 *   - Client-visible variables are declared in `clientEnv` with literal member
 *     access, because that is the only form Next can inline at build time.
 *   - Values are read once. If a test needs to change the environment it
 *     re-imports the module with `vi.resetModules()`, never mutates the
 *     exported object.
 */

/* ── Schemas ──────────────────────────────────────────────────────────────── */

/**
 * Values that only mean "someone copied the template".
 *
 * Matched as sentinels rather than as a length or entropy check: the failure
 * being defended against is a copy-paste, and a copy-paste has a tell. A real
 * 32-byte secret that happens to be short is a different bug, caught by the
 * length rule.
 */
const PLACEHOLDER_PATTERN =
  /^(replace[-_ ]?with.*|changeme.*|your[-_ ].*|<.*>|todo.*|xxx+)$/i;

const REQUIRED = "Required, but not set";

const mongoUriSchema = z
  .string({ error: REQUIRED })
  .min(1, REQUIRED)
  .refine(
    (value) =>
      value.startsWith("mongodb://") || value.startsWith("mongodb+srv://"),
    {
      message:
        "Must start with mongodb:// or mongodb+srv://. A bare hostname is not a connection string.",
    },
  );

/**
 * `MAIL_FROM` in the RFC 5322 form: an optional display name, then the address.
 *
 * The display name is not a nicety — `BizNexus <no-reply@example.com>` is what
 * makes a password-reset email legible in an inbox instead of a bare address,
 * and it is the form `.env.example` documents. A plain `z.email()` rejects it,
 * which would mean the documented setup fails to boot.
 */
const MAIL_FROM_PATTERN =
  /^(?:(?:"[^"]*"|[^<>",]+)\s*)?<?[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+>?$/;

const mailFromSchema = z
  .string({ error: REQUIRED })
  .trim()
  .min(1, REQUIRED)
  .regex(
    MAIL_FROM_PATTERN,
    "Must be an email address, optionally with a display name: 'BizNexus <no-reply@example.com>'",
  );

const serverSchema = z
  .object({
    NODE_ENV: z
      .enum(["development", "test", "production"])
      .default("development"),
    APP_NAME: z
      .string({ error: REQUIRED })
      .min(1, REQUIRED)
      .default("BizNexus"),
    /** No trailing slash, so it can be concatenated with a path. */
    APP_URL: z
      .url("Must be an absolute URL, for example http://localhost:3000")
      .refine((value) => !value.endsWith("/"), {
        message: "Must not end with a trailing slash",
      }),

    MONGODB_URI: mongoUriSchema,

    /**
     * 32 bytes of entropy, base64. It signs short-lived stateless tokens, not
     * sessions: sessions are opaque and database-backed, so leaking this does
     * not hand an attacker anyone's session.
     */
    SESSION_SECRET: z
      .string({
        error: `${REQUIRED}. Generate with: openssl rand -base64 32`,
      })
      .min(
        32,
        "Must be at least 32 characters. Generate with: openssl rand -base64 32",
      ),

    MAIL_DRIVER: z.enum(["console", "resend", "smtp"]).default("console"),
    MAIL_FROM: mailFromSchema,
    RESEND_API_KEY: z.string({ error: REQUIRED }).min(1, REQUIRED).optional(),
    SMTP_HOST: z.string({ error: REQUIRED }).min(1, REQUIRED).optional(),
    SMTP_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
    SMTP_USER: z.string().optional(),
    SMTP_PASSWORD: z.string().optional(),

    RATELIMIT_DRIVER: z.enum(["memory", "redis"]).default("memory"),
    UPSTASH_REDIS_REST_URL: z.url().optional(),
    UPSTASH_REDIS_REST_TOKEN: z
      .string({ error: REQUIRED })
      .min(1, REQUIRED)
      .optional(),

    /** Public values, re-declared here so client code never touches process.env. */
    NEXT_PUBLIC_APP_NAME: z
      .string({ error: REQUIRED })
      .min(1, REQUIRED)
      .optional(),
  })
  .superRefine((env, ctx) => {
    /* ── Conditional requirements ──────────────────────────────────────────
       A driver that is not selected must not need credentials, and one that is
       selected must have them. Validating only the selected set is what keeps
       a half-configured production deployment from booting. */

    const required = (key: string, message: string) => {
      if (!env[key as keyof typeof env]) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message,
        });
      }
    };

    if (env.MAIL_DRIVER === "resend") {
      required("RESEND_API_KEY", "Required when MAIL_DRIVER is resend");
    }

    if (env.MAIL_DRIVER === "smtp") {
      required("SMTP_HOST", "Required when MAIL_DRIVER is smtp");
      required("SMTP_PORT", "Required when MAIL_DRIVER is smtp");
      required("SMTP_USER", "Required when MAIL_DRIVER is smtp");
      required("SMTP_PASSWORD", "Required when MAIL_DRIVER is smtp");
    }

    if (env.RATELIMIT_DRIVER === "redis") {
      required(
        "UPSTASH_REDIS_REST_URL",
        "Required when RATELIMIT_DRIVER is redis",
      );
      required(
        "UPSTASH_REDIS_REST_TOKEN",
        "Required when RATELIMIT_DRIVER is redis",
      );
    }

    /* ── Production hardening ─────────────────────────────────────────────
       These are the rules that make a copied `.env.example` fail loudly
       instead of running a staging environment in production. */

    if (env.NODE_ENV !== "production") return;

    if (PLACEHOLDER_PATTERN.test(env.SESSION_SECRET)) {
      ctx.addIssue({
        code: "custom",
        path: ["SESSION_SECRET"],
        message:
          "Still the placeholder from .env.example. Generate a real secret: openssl rand -base64 32",
      });
    }

    if (env.MAIL_DRIVER === "console") {
      ctx.addIssue({
        code: "custom",
        path: ["MAIL_DRIVER"],
        message:
          "Refusing to start in production with the console mail driver. Verification and password-reset links would be written to the log instead of sent. Set MAIL_DRIVER to resend or smtp.",
      });
    }

    if (
      env.APP_URL.startsWith("http://") &&
      !env.APP_URL.includes("localhost")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_URL"],
        message:
          "Must be https in production. A plaintext origin exposes session cookies to interception.",
      });
    }
  });

export type ServerEnv = z.infer<typeof serverSchema>;

/* ── Failure ──────────────────────────────────────────────────────────────── */

export class EnvValidationError extends Error {
  readonly issues: string[];

  constructor(issues: string[]) {
    super(
      [
        `Invalid environment — ${issues.length} problem${issues.length === 1 ? "" : "s"}:`,
        ...issues.map((issue) => `  • ${issue}`),
        "",
        "See .env.example for the full contract.",
      ].join("\n"),
    );
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = issue.path.join(".");
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

/* ── Parse ────────────────────────────────────────────────────────────────── */

/**
 * Parsed and frozen at module load, which is what makes this a boot check
 * rather than a check that happens if something remembers to call it.
 */
function load(): ServerEnv {
  const result = serverSchema.safeParse(process.env);

  if (!result.success) {
    throw new EnvValidationError(formatIssues(result.error));
  }

  return Object.freeze(result.data);
}

export const env: ServerEnv = load();

/**
 * Values safe to reference from a client component.
 *
 * Written as literal `process.env.NEXT_PUBLIC_*` members rather than a loop over
 * a schema. Next inlines those specific expressions at build time and has no way
 * to evaluate a computed lookup, so a `for` loop here would produce a runtime
 * `undefined` in the browser with no build error — the exact silent failure
 * this module exists to prevent.
 */
export const clientEnv = Object.freeze({
  appName: process.env.NEXT_PUBLIC_APP_NAME ?? env.APP_NAME,
});

/** True when running against anything other than a developer's machine. */
export const isProduction = env.NODE_ENV === "production";

/** True when a test suite is driving. Kept separate from `!isProduction`. */
export const isTest = env.NODE_ENV === "test";
