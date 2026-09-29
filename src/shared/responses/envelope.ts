import {
  type AppError,
  type ErrorPayload,
  toErrorPayload,
  toErrorStatus,
} from "@/shared/errors/app-error";

/**
 * The two response shapes every endpoint returns.
 *
 * One envelope, always, so the client has exactly two shapes to write against
 * and never has to test for a bare object or a bare string. `data` on success,
 * `error` on failure, never both, never neither.
 *
 * These are pure functions rather than `Response` builders. The route-handler
 * wrapper in 1.23 owns the `Response`; keeping the envelope independent of it
 * means the contract is testable without constructing a request, and the same
 * `ok` works in a Server Action where there is no route handler at all.
 */

export interface ResponseMeta {
  [key: string]: unknown;
}

export interface SuccessEnvelope<T> {
  data: T;
  meta?: ResponseMeta;
}

export interface ErrorEnvelope {
  error: ErrorPayload & { requestId?: string };
}

export function ok<T>(data: T, meta?: ResponseMeta): SuccessEnvelope<T> {
  return meta === undefined ? { data } : { data, meta };
}

export function fail(error: unknown, requestId?: string): ErrorEnvelope {
  const payload = toErrorPayload(error);
  return {
    error: requestId === undefined ? payload : { ...payload, requestId },
  };
}

export function statusOf(error: unknown): number {
  return toErrorStatus(error);
}

export interface PageMeta extends ResponseMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/**
 * Paging metadata for a list response.
 *
 * Clamped at zero rather than left to produce `NaN` or `-1`, because a
 * `totalPages: -1` in a JSON response is a bug the client finds at runtime
 * instead of one the server finds here. `page` is floored at 1 for the same
 * reason: the database query has already run by the time this is called.
 */
export function pageMeta(input: {
  page: number;
  pageSize: number;
  total: number;
}): PageMeta {
  const pageSize = Math.max(1, Math.trunc(input.pageSize));
  const total = Math.max(0, Math.trunc(input.total));
  const page = Math.max(1, Math.trunc(input.page));

  return {
    page,
    pageSize,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / pageSize),
  };
}

export type { AppError };
