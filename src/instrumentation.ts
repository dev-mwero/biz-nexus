/**
 * Server startup hook.
 *
 * Next calls `register()` once per server instance, and it must resolve before
 * the server handles a request. That is exactly the slot the environment check
 * and the subsystem wiring belong in: an unset variable should stop the process
 * here, with the full list of problems, rather than surfacing as an undefined
 * value in a handler weeks later.
 *
 * The imports are the whole mechanism. `env.ts` validates and throws at module
 * evaluation, so nothing needs to do anything except reach it. `instrumentation.node`
 * attaches the in-process event subscribers (the activity timeline) exactly once,
 * before any request can emit an event. Both are imported dynamically so they
 * happen on the Node runtime only and are not pulled into the edge bundle, where
 * these server-only modules do not exist.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("@/env");
    const { registerSubsystems } = await import("./instrumentation.node");
    registerSubsystems();
  }
}
