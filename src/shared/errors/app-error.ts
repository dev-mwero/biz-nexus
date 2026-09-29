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
  NO_ACTIVE_ORGANIZATION: {
    status: 403,
    message: "No active organization, or you are not an active member of it.",
    expose: true,
  },
  INSUFFICIENT_PERMISSION: {
    status: 403,
    message: "Not permitted.",
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
  ALREADY_A_MEMBER: {
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
  LAST_OWNER: {
    status: 409,
    message: "This is the only active owner. Transfer ownership first.",
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
  VALIDATION_FAILED: {
    status: 422,
    message: "The request is not valid.",
    expose: true,
  },
  INVALID_CURSOR: {
    status: 400,
    message: "The paging cursor is not valid.",
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

export interface ErrorPayload {
  code: string;
  message: string;
  details?: FieldDetail[];
}

/**
 * Reduce any thrown value to something a client may see.
 *
 * The default arm is the important one. Anything not recognised becomes a
 * generic 500 and keeps its message - a Mongo duplicate-key error, a driver
 * timeout, a `TypeError` with a variable name in it - on this side of the
 * boundary. That is the single behaviour this function exists to guarantee,
 * and the contract test throws objects built to get past every other check.
 */
export function toErrorPayload(error: unknown): ErrorPayload {
  if (isAppError(error)) {
    return {
      code: error.code,
      message: error.expose ? error.message : ERROR_CATALOGUE.INTERNAL.message,
      ...(error.details?.length ? { details: error.details } : {}),
    };
  }

  return {
    code: "INTERNAL",
    message: ERROR_CATALOGUE.INTERNAL.message,
  };
}

/** The status a thrown value should be reported as. */
export function toErrorStatus(error: unknown): number {
  return isAppError(error) ? error.status : ERROR_CATALOGUE.INTERNAL.status;
}
