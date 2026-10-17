import { afterEach, describe, expect, it } from "vitest";
import { registerSubsystems } from "@/instrumentation.node";
import { events } from "@/shared/events/bus";

/**
 * Startup wiring.
 *
 * The activity timeline reads domain events off the in-process bus, and for the
 * life of the project the only thing that ever subscribed it was a test. In
 * production every `deal.stage_changed` was emitted into a bus with no
 * listeners, so the timeline a user opened was empty and stayed empty. The
 * bug was not in the subscriber -- that code was correct and tested -- it was
 * that nothing ran it. This file asserts the wiring itself: that start-up
 * attaches the subscribers, that it attaches them to the bus services emit on,
 * and that running it twice does not double every timeline entry.
 */

describe("registerSubsystems", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("attaches the timeline subscribers for the events the timeline reads", () => {
    const stageChanged = events.count("deal.stage_changed");
    const completed = events.count("task.completed");
    const assigned = events.count("task.assigned");

    cleanups.push(registerSubsystems());

    expect(events.count("deal.stage_changed")).toBe(stageChanged + 1);
    expect(events.count("task.completed")).toBe(completed + 1);
    expect(events.count("task.assigned")).toBe(assigned + 1);
  });

  it("is idempotent, so a double startup does not double the timeline", () => {
    cleanups.push(registerSubsystems());
    const afterFirst = events.count("deal.stage_changed");

    // A dev-server reload, or two code paths both running start-up, must not
    // register the subscriber twice. Two subscribers means every stage change
    // writes two activity rows, and nothing anywhere reports an error.
    cleanups.push(registerSubsystems());

    expect(events.count("deal.stage_changed")).toBe(afterFirst);
  });

  it("detaches everything it attached, for the tests that install it", () => {
    const before = events.count("deal.stage_changed");
    const stop = registerSubsystems();

    stop();

    expect(events.count("deal.stage_changed")).toBe(before);
  });

  it("shares the one bus the services emit on", () => {
    // The subscribers are reached through `@/shared/events/bus`, as are the
    // services that emit. If start-up were evaluated against a second module
    // instance the subscribers would sit on a different bus and every event
    // would be delivered to nobody -- the exact failure this change removes.
    const global = globalThis as typeof globalThis & {
      __bizNexusEvents?: unknown;
    };

    expect(global.__bizNexusEvents).toBe(events);
  });
});
