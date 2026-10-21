import { registerActivitySubscribers } from "@/modules/activities";
import { registerNotifications } from "@/modules/notifications";

/**
 * The composition root for in-process subsystems.
 *
 * `events` is a plain in-process bus: nothing is subscribed to it unless a
 * module says so, and every domain event this application emits -- a deal
 * changing stage, a task being assigned -- is emitted into it by a service that
 * does not know, and must not know, who is listening. For the life of the
 * project the only caller of the registration functions below was a test, so in
 * production the activity timeline was written by nobody, the bell was addressed
 * by nobody, and every event went nowhere. The write side existed; the wiring
 * did not.
 *
 * This is where the subscribers are attached: once, at server startup. Next
 * calls `register()` in `instrumentation.ts` exactly once per server instance
 * and waits for it to resolve before serving a request, which is the only point
 * in the lifecycle where "before any event can be emitted" is guaranteed.
 * Attaching from a route module would attach and detach on every request;
 * attaching from a module a given request never reaches would leave some events
 * subscribed and others not, depending on the path taken through the tree.
 *
 * Returns a stop function that detaches everything it attached. Production
 * never calls it; it exists so a test can install the real wiring and remove it
 * again without leaking a subscription into the next test.
 */
export function registerSubsystems(): () => void {
  const stops: Array<() => void> = [
    registerActivitySubscribers(),
    registerNotifications(),
  ];

  return () => {
    for (const stop of stops) stop();
  };
}
