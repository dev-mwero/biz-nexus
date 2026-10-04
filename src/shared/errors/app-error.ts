/**
 * The error taxonomy.
 *
 * One table decides what every machine-readable code means, which HTTP status
 * it becomes, and what the client is told. Route handlers do not choose a
 * status, and services do not choose a status - they raise a code and the table
 * answers. That is the only way to keep "403 for a permission failure, 404 for
 * a record in another tenant" from drifting into whatever each handler felt
 * like at the time.
 *
 * The 404 rule is the reason this table exists at all. `RECORD_NOT_FOUND` is
 * 404 whether the record is missing, soft-deleted, or sitting in a tenant the
 * caller cannot see, and there is no code that distinguishes those three. A
 * separate `RECORD_FORBIDDEN` would reintroduce the leak: the difference
 * between 403 and 404 *is* the answer to "does this exist somewhere I cannot
 * reach", and answering it is how enumeration works.
 */

import mongoose from "mongoose";
import { ZodError } from "zod";

/** A field-level validation failure, safe to hand back to the client. */
export interface FieldDetail {
  path: string;
  message: string;
}

interface ErrorDefinition {
  status: number;
  message: string;
  /**
   * Whether the message is written for a client. `false` means the code is
   * recognised but its text is for the log, and the client gets a generic
   * message instead. True for anything a user could act on.
   */
  expose: boolean;
}

/**
 * The catalogue. Codes are the contract; messages here are the safe default
 * when a caller does not supply a better one.
 *
 * Nothing in this table may contain a fragment of an internal message, a
 * driver error, or a stack. That is the whole point of the `expose` flag, and
 * the contract test walks the table to keep it that way.
 */
export const ERROR_CATALOGUE = {
  // --- Authentication and authorization -------------------------------------
  TOKEN_NOT_REDEEMABLE: {
    status: 400,
    message: "This link is no longer valid. Request a new one.",
    expose: true,
  },
  UNAUTHENTICATED: {
    status: 401,
    message: "Sign in to continue.",
    expose: true,
  },
  SESSION_EXPIRED: {
    status: 401,
    message: "Your session has expired.",
    expose: true,
  },
  ACTIVE_ORGANIZATION_REQUIRED: {
    status: 403,
    message: "No active organization, or you are not an active member of it.",
    expose: true,
  },
  INSUFFICIENT_PERMISSION: {
    status: 403,
    message: "Not permitted.",
    expose: true,
  },
  /**
   * A cross-origin refusal, deliberately not `INSUFFICIENT_PERMISSION`.
   *
   * A 403 from the permission system means "you are who you say you are, and you
   * may not do this". A 403 from here means "this request did not come from this
   * site". They are different events, and `withApi` logs a burst of refusals
   * precisely so that somebody enumerating is visible — folding the two together
   * poisons that signal with every cross-site request a browser ever makes.
   */
  ORIGIN_NOT_ALLOWED: {
    status: 403,
    message: "This request did not come from this site.",
    expose: true,
  },
  MEMBERSHIP_INACTIVE: {
    status: 403,
    message: "Your access to this organization is not active.",
    expose: true,
  },

  // --- Records --------------------------------------------------------------
  // One code for missing, soft-deleted, and in-another-tenant. See above.
  RECORD_NOT_FOUND: { status: 404, message: "Not found.", expose: true },
  ORGANIZATION_UNAVAILABLE: {
    status: 404,
    message: "Organization not found.",
    expose: true,
  },
  INVITATION_INVALID: {
    status: 404,
    message: "This invitation link is not valid.",
    expose: true,
  },
  INVITATION_EXPIRED: {
    status: 410,
    message: "This invitation has expired.",
    expose: true,
  },
  INVITATION_USED: {
    status: 410,
    message: "This invitation has already been used.",
    expose: true,
  },
  INVITATION_REVOKED: {
    status: 410,
    message: "This invitation has been revoked.",
    expose: true,
  },

  // --- Conflicts ------------------------------------------------------------
  EMAIL_ALREADY_REGISTERED: {
    status: 409,
    message: "That email address is already registered.",
    expose: true,
  },
  MEMBERSHIP_EXISTS: {
    status: 409,
    message: "That person is already a member of this organization.",
    expose: true,
  },
  SLUG_CONFLICT: {
    status: 409,
    message: "That name is already taken.",
    expose: true,
  },
  ORGANIZATION_CREATION_FAILED: {
    status: 409,
    message: "The organization could not be created.",
    expose: true,
  },
  ROLE_PROVISIONING_FAILED: {
    status: 409,
    message: "This organization already has its system roles.",
    expose: true,
  },
  MEMBERSHIP_NOT_FOUND: {
    status: 404,
    message: "That member is not in this organization.",
    expose: true,
  },
  OWNER_REQUIRED: {
    status: 409,
    message: "This is the only active owner. Transfer ownership first.",
    expose: true,
  },
  /**
   * The record is in a state that forbids this action: a lead that cannot make
   * the requested transition, a contact already merged into another, a deal
   * already won.
   *
   * Distinct from `VALIDATION_FAILED` because the request was well-formed - the
   * caller sent a legal status, and the answer is that this particular record
   * has already moved somewhere it cannot come back from. 409 rather than 422
   * because retrying the identical request gets the identical answer.
   */
  INVALID_STATE: {
    status: 409,
    message: "This record is not in a state that allows that action.",
    expose: true,
  },
  /**
   * 422, not 404. The client sent a role id that is not usable here, which is
   * a bad request whatever the reason. The message deliberately does not say
   * "that role belongs to another organization": confirming it would answer the
   * one question a caller holding a foreign role id is asking.
   */
  ROLE_NOT_IN_ORGANIZATION: {
    status: 422,
    message: "That role is not available for this organization.",
    expose: true,
  },
  EMAIL_REQUIRED: {
    status: 422,
    message: "An email address is required.",
    expose: true,
  },

  // --- Requests -------------------------------------------------------------
  BAD_REQUEST: {
    status: 400,
    message: "The request could not be read.",
    expose: true,
  },
  INVALID_CURSOR: {
    status: 400,
    message: "The paging cursor is not valid.",
    expose: true,
  },
  VALIDATION_FAILED: {
    status: 422,
    message: "The request is not valid.",
    expose: true,
  },
  PAYLOAD_TOO_LARGE: {
    status: 413,
    message: "The request body is too large.",
    expose: true,
  },

  // --- Throttling and verification ------------------------------------------
  RATE_LIMITED: {
    status: 429,
    message: "Too many attempts. Try again shortly.",
    expose: true,
  },
  EMAIL_NOT_VERIFIED: {
    status: 403,
    message: "Verify your email address before continuing.",
    expose: true,
  },

  // --- Server ---------------------------------------------------------------
  // `expose: false`. The client gets "Something went wrong"; the real message
  // goes to the log and nowhere else. Listed so the log can name the code.
  //
  // The messages here are the generic one on purpose. A distinctive message
  // under `expose: false` is never sent, so it sits in the catalogue looking
  // like the client-facing text and invites somebody to "fix" the flag.
  INTERNAL: { status: 500, message: "Something went wrong.", expose: false },
  CONFIGURATION_INVALID: {
    status: 500,
    message: "Something went wrong.",
    expose: false,
  },
  DATABASE_ERROR: {
    status: 500,
    message: "Something went wrong.",
    expose: false,
  },
  TRANSACTION_ABORTED: {
    status: 500,
    message: "Something went wrong.",
    expose: false,
  },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_CATALOGUE;

const CATALOGUE: Record<string, ErrorDefinition> = ERROR_CATALOGUE;

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && value in CATALOGUE;
}

/** The status the table assigns to a code, or 500 for anything unknown. */
export function statusForCode(code: string): number {
  return CATALOGUE[code]?.status ?? ERROR_CATALOGUE.INTERNAL.status;
}

export interface AppErrorOptions {
  details?: FieldDetail[];
  cause?: unknown;
  /**
   * Log-only detail, never serialised. Use it for the driver message you want
   * in the log next to the code but not in the response.
   */
  internal?: string;
}

/**
 * An error that is safe to turn into a response.
 *
 * Extending `Error` rather than a plain object so it survives `throw`, a
 * `catch`, and a promise rejection unchanged - which is the only way it can
 * reach a route handler from a service without being stringified somewhere in
 * between.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: FieldDetail[];
  /** Never serialised. The log's copy of what actually happened. */
  readonly internal?: string;
  readonly expose: boolean;

  constructor(
    code: ErrorCode,
    options: AppErrorOptions & { message?: string } = {},
  ) {
    const definition = CATALOGUE[code];
    super(options.message ?? definition?.message ?? "Something went wrong.", {
      cause: options.cause,
    });
    this.name = "AppError";
    this.code = code;
    this.status = definition?.status ?? ERROR_CATALOGUE.INTERNAL.status;
    this.expose = definition?.expose ?? false;
    this.details = options.details;
    this.internal = options.internal;
  }

  // Named constructors, so a call site reads as what it means and cannot pick
  // a status by accident. The status always comes from the table.

  static notFound(code: ErrorCode = "RECORD_NOT_FOUND", message?: string) {
    return new AppError(code, { message });
  }

  static unauthorized(message?: string) {
    return new AppError("UNAUTHENTICATED", { message });
  }

  static forbidden(message?: string) {
    return new AppError("INSUFFICIENT_PERMISSION", { message });
  }

  static conflict(code: ErrorCode, message?: string) {
    return new AppError(code, { message });
  }

  static validation(details: FieldDetail[], message?: string) {
    return new AppError("VALIDATION_FAILED", { details, message });
  }

  /** An unexpected failure. Safe by construction: no internals, ever. */
  static internal(internal: string, cause?: unknown) {
    return new AppError("INTERNAL", { internal, cause });
  }
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * A zod failure, as a client-facing validation error.
 *
 * Every route in this tree validates its input with `schema.parse`, and
 * `parse` throws `ZodError` rather than returning a result. Without this,
 * a client that sends one bad field gets a 500 with `INTERNAL` — the
 * application reporting its own input handling as an unexpected fault, which
 * is both wrong and unactionable for whoever has the failing request.
 *
 * The status is `BAD_REQUEST` rather than `VALIDATION_FAILED` because the two
 * mean different things to a caller. `VALIDATION_FAILED` is this
 * application's answer: the request parsed, and the *record* it names is
 * unacceptable — a company id that does not exist, a `fromEnd` segment that is
 * not an ObjectId. A `ZodError` is the request not having parsed at all, and
 * the field paths in the issue list are the only thing the client can act on.
 * Collapsing them would leave a client unable to tell a malformed body from a
 * bad reference, which is the distinction it most needs.
 *
 * Issues are flattened to `{ path, message }` because that is the shape the
 * envelope already carries, and the raw issue list would put zod's own
 * structure into the response contract.
 */
function asBadRequest(error: ZodError): AppError {
  return new AppError("BAD_REQUEST", {
    message: "The request could not be read.",
    details: error.issues.map((issue) => ({
      path: issue.path.join(".") || "(body)",
      message: issue.message,
    })),
    cause: error,
  });
}

/**
 * A value Mongoose refused to store, as a 422.
 *
 * Mongoose reports a value it will not accept two different ways, and a write
 * from a request body can reach either one, so both are answered here.
 *
 * A `ValidationError` is the schema saying no: `value: -5` against `min: 0`, a
 * 200-character name against `maxlength: 160`. It only ever appears once the
 * repository writes with `runValidators` — see `TenantRepository` — because
 * Mongoose does not validate updates otherwise.
 *
 * A `CastError` is Mongoose failing to make the value into the declared type at
 * all: `"not-a-date"` into a `Date`, a string that is not an id into an
 * `ObjectId`. Casting happens before validation and whether or not validation
 * is enabled, so this class of typo produced a 500 with a stack trace in the log
 * on every field that cannot be cast, which is most of them — the client told
 * the server had broken, and the error log filled with a fault that was never
 * one.
 *
 * `VALIDATION_FAILED` rather than `BAD_REQUEST`, for the reason the zod arm
 * above already gives: the body parsed, and it is the record it names that is
 * unacceptable. A client distinguishing "I sent you nonsense JSON" from "your
 * schema rejected my value" is the distinction it most needs, and this is the
 * second of the two.
 */
function asMongooseError(error: unknown): AppError | null {
  if (error instanceof mongoose.Error.ValidationError) {
    return new AppError("VALIDATION_FAILED", {
      details: Object.entries(error.errors).map(([path, failure]) =>
        mongooseFieldDetail(failure, path),
      ),
      cause: error,
    });
  }

  if (error instanceof mongoose.Error.CastError) {
    return new AppError("VALIDATION_FAILED", {
      details: [mongooseFieldDetail(error)],
      cause: error,
    });
  }

  return asBsonError(error);
}

/**
 * The backstop for an id that never became an `ObjectId`.
 *
 * `new Types.ObjectId("garbage")` throws a `BSONError` from the `bson` package,
 * which is not a Mongoose `ValidationError` and not a `CastError`, so the two
 * arms above let it fall to the default and the caller got a 500 for their own
 * typo. This is finding S9's residual: fixing it per-endpoint meant every route
 * that constructs an id by hand had to remember, and the route that forgot was
 * `PATCH /api/v1/crm/contacts/:id` — three unvalidated string fields, a 500 each.
 * A mapping at the boundary covers the ones nobody has found yet.
 *
 * Reached through `mongoose.mongo.BSON` rather than a direct `bson` import, since
 * `bson` is not a declared dependency here and would be reaching into a
 * transitive one for a single class name.
 *
 * `BSONVersionError` extends `BSONError` and is excluded on purpose: a driver
 * that cannot talk to the server it is connected to is this process's problem,
 * not a caller's typo, and dressing it as `VALIDATION_FAILED` would point the
 * person reading the log at the request instead of the deployment. It stays a
 * 500.
 */
function asBsonError(error: unknown): AppError | null {
  const { BSONError, BSONVersionError } = mongoose.mongo.BSON;

  if (error instanceof BSONError && !(error instanceof BSONVersionError)) {
    return new AppError("VALIDATION_FAILED", {
      // No `details`. The message is not built from the schema the way a
      // `CastError`'s is, and there is no field name to point at — the value
      // could have been a path segment, a query parameter or a body field, and
      // guessing which would be worse than saying the id was not valid.
      message: "Not a valid identifier.",
      cause: error,
    });
  }

  return null;
}

/**
 * One Mongoose field failure as the envelope's `{ path, message }`.
 *
 * `key` is preferred over the failure's own `path`, and the order is the point.
 * Mongoose keys `ValidationError.errors` by the full dotted path while setting
 * `ValidatorError.path` to the leaf only, so a colour rejected inside
 * `stages.0` arrives with the key `stages.0.color` and a `path` of `color`. A
 * client told `color` highlights nothing — there is no field called `color` in
 * a document that has `stages` — and the map is the only place the full path
 * exists at all. The failure's own `path` is the fallback for a cast error
 * thrown on its own, which never went through that map.
 */
function mongooseFieldDetail(
  failure: mongoose.Error.ValidatorError | mongoose.Error.CastError,
  key?: string,
): FieldDetail {
  const path = key || failure.path || "(document)";

  // A `CastError`'s own message embeds the value that failed to cast — see
  // `mongoose/lib/error/cast.js`, which formats `Cast to <kind> failed for
  // value <inspect(value)>`. So the message here is rebuilt from the schema type
  // rather than taken from the error: the type is ours, the value is the
  // caller's, and the caller already knows what they sent.
  if (failure instanceof mongoose.Error.CastError) {
    return { path, message: `Not a valid ${failure.kind}.` };
  }

  return { path, message: validatorMessage(failure) };
}

const DEFAULT_FIELD_MESSAGE = "Not a value this field accepts.";

/**
 * A declared bound as text, or null when it is not one this can render.
 *
 * Numbers are the common case (`min: 0`, `maxlength: 160`). A `Date` bound is
 * rendered as an instant, which is what a date field's client needs and is
 * still schema data rather than caller input. Anything else is refused rather
 * than interpolated, so an unexpected bound cannot put an object into a
 * response.
 */
function boundText(bound: unknown): string | null {
  if (typeof bound === "number" && Number.isFinite(bound)) return String(bound);
  if (bound instanceof Date && !Number.isNaN(bound.getTime())) {
    return bound.toISOString();
  }
  return null;
}

/**
 * What a failed validator is worth saying to the client.
 *
 * Mongoose's own message cannot be forwarded here, and the reason is written
 * down in `mongoose/lib/error/messages.js`: every built-in template
 * interpolates `{VALUE}` — ``Path `name` (`{VALUE}`, length {LENGTH}) is
 * longer than the maximum allowed length ({MAXLENGTH}).`` Forwarding it would
 * put whatever the caller sent into the response body and into the log line.
 * That value is the caller's, is of no length this codebase controls, and a
 * client rendering an error message as markup would be reflecting its own input
 * straight back.
 *
 * The bound the schema declared is worth forwarding: it is ours, it is fixed,
 * and it is the only part of the message the caller can act on. So the message
 * is rebuilt from the validator's type and the option that failed — never from
 * `value`, which is also why `properties.value` is not read anywhere below.
 *
 * A validator written in this codebase keeps its own message. That message was
 * written for a person to read, and the schema author chose not to put the
 * value in it.
 */
function validatorMessage(failure: mongoose.Error.ValidatorError): string {
  // The bound a built-in failed on (`min`, `max`, `minlength`, `maxlength`) is
  // carried alongside the message on the validator, and lands in `properties`
  // with the rest of the validator's definition. The declared type omits those
  // keys, which is a typing gap rather than an absent value.
  const properties = failure.properties as {
    type?: string;
    min?: unknown;
    max?: unknown;
    minlength?: unknown;
    maxlength?: unknown;
  };

  switch (properties.type) {
    case "required":
      return "This field is required.";
    case "min": {
      const bound = boundText(properties.min);
      return bound === null
        ? "Below the smallest value this field accepts."
        : `Must be ${bound} or greater.`;
    }
    case "max": {
      const bound = boundText(properties.max);
      return bound === null
        ? "Above the largest value this field accepts."
        : `Must be ${bound} or less.`;
    }
    case "minlength": {
      const bound = boundText(properties.minlength);
      return bound === null
        ? "Too short."
        : `Must be at least ${bound} characters.`;
    }
    case "maxlength": {
      const bound = boundText(properties.maxlength);
      return bound === null
        ? "Too long."
        : `Must be at most ${bound} characters.`;
    }
    // The allowed values are schema data rather than caller input, so they could
    // be listed, but the lists here run to twenty-one colours and a view's own
    // custom fields. Naming the path is enough to find the list.
    case "enum":
      return "Not one of the allowed values.";
    case "match":
      return "Not in the expected format.";
    case "user defined":
      return failure.message || DEFAULT_FIELD_MESSAGE;
    default:
      return DEFAULT_FIELD_MESSAGE;
  }
}

/**
 * Reduce a thrown value to the code it should be reported under, or null.
 *
 * In this order because each arm is strictly more specific than the one after
 * it: an `AppError` is already the answer, a zod failure and a Mongoose failure
 * are recognisable classes from two different libraries, and anything else is
 * not ours to interpret.
 *
 * `instanceof` rather than a check on `name` and a shape, for the same reason
 * `isZodError` below is: this is the function that decides what a caller is
 * told, and a structural match would let an object written anywhere in the tree
 * choose its own 422 and its own message.
 */
function asAppError(error: unknown): AppError | null {
  if (isAppError(error)) return error;
  if (isZodError(error)) return asBadRequest(error);
  return asMongooseError(error);
}

/**
 * True only for a real zod failure.
 *
 * `instanceof` rather than a check on `name === "ZodError"` and an `issues`
 * array. The structural version also matches any plain object shaped like one,
 * and this is the function that decides what a caller is told — so it would let
 * `{ name: "ZodError", issues: [{ message: <anything> }] }` written anywhere in
 * the tree choose its own 400 and its own message. The single-copy assumption
 * is worth more than the tolerance.
 */
function isZodError(error: unknown): error is ZodError {
  return error instanceof ZodError;
}

export interface ErrorPayload {
  code: string;
  message: string;
  details?: FieldDetail[];
}

/**
 * The `AppError` a thrown value should be reported as, or null.
 *
 * Exported for the one caller that needs the error itself rather than what it
 * says to a client: `withApi` chooses a log level from whether the failure is
 * exposed, and that is a question about the mapped error, not about the
 * response. Anything else should reach for `toErrorPayload` and
 * `toErrorStatus`, which are the contract and cannot be got wrong.
 */
export function toAppError(error: unknown): AppError | null {
  return asAppError(error);
}

/**
 * Reduce any thrown value to something a client may see.
 *
 * The default arm is the important one. Anything not recognised becomes a
 * generic 500 and keeps its message - a Mongo duplicate-key error, a driver
 * timeout, a `TypeError` with a variable name in it - on this side of the
 * boundary. That is the single behaviour this function exists to guarantee,
 * and the contract test throws objects built to get past every other check.
 *
 * The recognised set is small and is named in `asAppError` above: an
 * `AppError` this codebase raised, a `ZodError` from a route's own schema, and
 * a Mongoose `ValidationError` or `CastError` from a write. Each is a failure
 * attributable to a request rather than to this process, which is the only
 * reason any of them is allowed past the default arm.
 */
export function toErrorPayload(error: unknown): ErrorPayload {
  const appError = asAppError(error);

  if (appError) {
    return {
      code: appError.code,
      message: appError.expose
        ? appError.message
        : ERROR_CATALOGUE.INTERNAL.message,
      ...(appError.details?.length ? { details: appError.details } : {}),
    };
  }

  return {
    code: "INTERNAL",
    message: ERROR_CATALOGUE.INTERNAL.message,
  };
}

/** The status a thrown value should be reported as. */
export function toErrorStatus(error: unknown): number {
  const appError = asAppError(error);
  return appError ? appError.status : ERROR_CATALOGUE.INTERNAL.status;
}
