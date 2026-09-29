/**
 * Server startup hook.
 *
 * Next calls `register()` once per server instance, and it must resolve before
 * the server handles a request. That is exactly the slot the environment check
 * belongs in: an unset variable should stop the process here, with the full
 * list of problems, rather than surfacing as an undefined value in a handler
 * weeks later.
 *
 * The import is the whole mechanism. `env.ts` validates and throws at module
 * evaluation, so nothing here needs to do anything except reach it. It is
 * imported dynamically so the validation happens on the Node runtime only and
 * the module is not pulled into the edge bundle, where these server-only
 * variables do not exist.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/env");
  }
}
