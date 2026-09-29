import { Types } from "mongoose";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEventBus, events, recordEvents } from "@/shared/events/bus";
import type { EventName } from "@/shared/events/registry";
import "@/modules/organizations/organization.events";

/**
 * The in-process event bus.
 *
 * The acceptance criterion for 1.25 is one sentence - a throwing subscriber
 * cannot break the emitter - so that is the first test, and it is tested for
 * all three ways a subscriber can fail: throwing synchronously, rejecting, and
 * failing after a successful subscriber has already run.
 *
 * `createEventBus` rather than the singleton throughout, because a module-level
 * bus shared by every test in a file is a bus whose subscriber count depends on
 * which tests ran first. The singleton gets its own tests, since it is what
 * services actually use.
 */

const organization = {
  organizationId: new Types.ObjectId(),
  actorId: new Types.ObjectId(),
  name: "Acme",
  slug: "acme",
  occurredAt: new Date("2026-03-04T10:00:00.000Z"),
};

describe("the acceptance criterion", () => {
  it("cannot be broken by a subscriber that throws", async () => {
    const failures: unknown[] = [];
    const bus = createEventBus({
      onSubscriberFailure: (failure) => failures.push(failure.error),
    });
    const after = vi.fn();

    bus.subscribe("organization.created", () => {
      throw new Error("subscriber is broken");
    });
    bus.subscribe("organization.created", after);

    // The emit resolves. That is the whole guarantee: the request that caused
    // this event has already succeeded on the server, and a broken activity
    // timeline must not turn it into a 500.
    await expect(bus.emit("organization.created", organization)).resolves.toBe(
      undefined,
    );

    // The second subscriber still ran. Isolation means the failure is contained,
    // not that it aborts the rest of the dispatch.
    expect(after).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(1);
  });

  it("cannot be broken by a subscriber that rejects", async () => {
    const bus = createEventBus({ onSubscriberFailure: () => {} });
    const after = vi.fn();

    bus.subscribe("organization.created", async () => {
      await Promise.resolve();
      throw new Error("subscriber rejected");
    });
    bus.subscribe("organization.created", after);

    await expect(bus.emit("organization.created", organization)).resolves.toBe(
      undefined,
    );
    expect(after).toHaveBeenCalledTimes(1);
  });

  it("isolates a failure that is not an Error", async () => {
    const failures: unknown[] = [];
    const bus = createEventBus({
      onSubscriberFailure: (failure) => failures.push(failure.error),
    });

    bus.subscribe("organization.created", () => {
      throw "a bare string";
    });

    await expect(bus.emit("organization.created", organization)).resolves.toBe(
      undefined,
    );
    expect(failures).toEqual(["a bare string"]);
  });

  it("reports which subscriber failed, and which event", async () => {
    const failures: Array<{ event: EventName; index: number; error: unknown }> =
      [];
    const bus = createEventBus({
      onSubscriberFailure: (failure) => failures.push(failure),
    });

    bus.subscribe("organization.created", () => {});
    bus.subscribe("organization.created", () => {
      throw new Error("second one");
    });

    await bus.emit("organization.created", organization);

    // Two subscribers that both throw the same message cannot be told apart in
    // a log without the index.
    expect(failures).toHaveLength(1);
    expect(failures[0].event).toBe("organization.created");
    expect(failures[0].index).toBe(1);
    expect((failures[0].error as Error).message).toBe("second one");
  });

  it("does nothing at all when nobody is listening", async () => {
    const bus = createEventBus();
    await expect(bus.emit("organization.created", organization)).resolves.toBe(
      undefined,
    );
  });
});

describe("delivery", () => {
  it("passes the payload and a context", async () => {
    const bus = createEventBus();
    const seen = vi.fn();
    bus.subscribe("organization.created", seen);

    await bus.emit("organization.created", organization);

    expect(seen).toHaveBeenCalledTimes(1);
    const [payload, context] = seen.mock.calls[0] as [
      typeof organization,
      { name: string; occurredAt: Date },
    ];
    expect(payload).toEqual(organization);
    expect(context.name).toBe("organization.created");
  });

  it("gives every subscriber the same occurredAt", async () => {
    const bus = createEventBus();
    const times: Date[] = [];
    const collect = (_payload: unknown, context: { occurredAt: Date }) => {
      times.push(context.occurredAt);
    };

    bus.subscribe("organization.created", collect);
    bus.subscribe("organization.created", async (_payload, context) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      collect(undefined, context);
    });

    await bus.emit("organization.created", organization);

    // Subscribers that compute their own timestamp disagree by however long
    // they took to run, and two records of one event with different times is
    // worse than one imprecise time.
    expect(times).toHaveLength(2);
    expect(times[0]).toBe(times[1]);
  });

  it("awaits an async subscriber, so its write has happened by the time emit returns", async () => {
    // This is why emit is async. Fire-and-forget would make every test that
    // emits an event and then checks a database row a race.
    const bus = createEventBus();
    const order: string[] = [];

    bus.subscribe("organization.created", async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      order.push("subscriber");
    });

    await bus.emit("organization.created", organization);
    order.push("after emit");

    expect(order).toEqual(["subscriber", "after emit"]);
  });

  it("dispatches in registration order", async () => {
    const bus = createEventBus();
    const order: string[] = [];
    for (const label of ["first", "second", "third"]) {
      bus.subscribe("organization.created", () => {
        order.push(label);
      });
    }

    await bus.emit("organization.created", organization);

    expect(order).toEqual(["first", "second", "third"]);
  });

  it("does not deliver one event to another event's subscribers", async () => {
    const bus = createEventBus();
    const joined = vi.fn();
    bus.subscribe("membership.joined", joined);

    await bus.emit("organization.created", organization);

    expect(joined).not.toHaveBeenCalled();
  });

  it("passes one payload object to every subscriber, so it must be read-only", async () => {
    // Pinned deliberately. Cloning per subscriber would be a real cost on
    // every event for a hazard no subscriber is currently exposed to, and if
    // that trade is ever made the change should be noticed here rather than
    // inferred from a comment.
    const bus = createEventBus();
    const seen: unknown[] = [];
    bus.subscribe("organization.created", (payload) => {
      seen.push(payload);
    });
    bus.subscribe("organization.created", (payload) => {
      seen.push(payload);
    });

    await bus.emit("organization.created", organization);

    expect(seen[0]).toBe(seen[1]);
  });
});

describe("unsubscribing", () => {
  it("stops delivery and is safe to call twice", () => {
    const bus = createEventBus();
    const subscriber = vi.fn();
    const stop = bus.subscribe("organization.created", subscriber);

    stop();
    stop();

    expect(bus.count("organization.created")).toBe(0);
  });

  it("only removes its own subscriber", async () => {
    const bus = createEventBus();
    const kept = vi.fn();
    const stopFirst = bus.subscribe("organization.created", vi.fn());
    bus.subscribe("organization.created", kept);

    stopFirst();
    await bus.emit("organization.created", organization);

    expect(kept).toHaveBeenCalledTimes(1);
  });

  it("does not skip the next subscriber when one removes itself mid-emit", async () => {
    // A module tearing itself down from inside its own handler is the obvious
    // way this happens, and it is the case that bites: removing the element
    // the loop is currently on shifts every later one down by a position, so an
    // iterator over the live list steps over the next subscriber entirely.
    const bus = createEventBus();
    const second = vi.fn();
    const third = vi.fn();

    let stopFirst = () => {};
    stopFirst = bus.subscribe("organization.created", () => {
      stopFirst();
    });
    bus.subscribe("organization.created", second);
    bus.subscribe("organization.created", third);

    await bus.emit("organization.created", organization);

    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
  });

  it("does not skip a subscriber when an earlier one is removed mid-emit", async () => {
    const bus = createEventBus();
    let stopFirst = () => {};
    stopFirst = bus.subscribe("organization.created", vi.fn());
    const last = vi.fn();

    bus.subscribe("organization.created", () => {
      stopFirst();
    });
    bus.subscribe("organization.created", last);

    await bus.emit("organization.created", organization);

    expect(last).toHaveBeenCalledTimes(1);
  });

  it("forgets an event once its last subscriber leaves", () => {
    const bus = createEventBus();
    const stop = bus.subscribe("organization.created", vi.fn());
    expect(bus.count("organization.created")).toBe(1);

    stop();

    expect(bus.count("organization.created")).toBe(0);
  });
});

describe("duplicate registration", () => {
  it("refuses to register the same subscriber twice", async () => {
    // A dev-server reload or two import paths resolving to one file would
    // otherwise produce two audit rows and two notifications per event, with
    // nothing anywhere reporting an error.
    const failures: unknown[] = [];
    const bus = createEventBus({
      onSubscriberFailure: (failure) => failures.push(failure.error),
    });
    const subscriber = vi.fn();

    bus.subscribe("organization.created", subscriber);
    bus.subscribe("organization.created", subscriber);

    await bus.emit("organization.created", organization);

    expect(subscriber).toHaveBeenCalledTimes(1);
    expect(failures).toHaveLength(1);
    expect((failures[0] as Error).message).toMatch(/twice/);
  });

  it("still allows two different functions for one event", async () => {
    const bus = createEventBus();
    const first = vi.fn();
    const second = vi.fn();

    bus.subscribe("organization.created", first);
    bus.subscribe("organization.created", second);
    await bus.emit("organization.created", organization);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });
});

describe("the application singleton", () => {
  const cleanups: Array<() => void> = [];

  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  it("records emissions for a test and cleans up after itself", async () => {
    const recorder = recordEvents("organization.created");
    cleanups.push(recorder.stop);

    await events.emit("organization.created", organization);

    expect(recorder.payloads()).toEqual([organization]);
    expect(recorder.received[0].context.name).toBe("organization.created");
  });

  it("leaves no subscriber behind after stop", async () => {
    const before = events.count("organization.created");
    const recorder = recordEvents("organization.created");
    expect(events.count("organization.created")).toBe(before + 1);

    recorder.stop();

    expect(events.count("organization.created")).toBe(before);
  });
});

/**
 * Compile-time only, never called.
 *
 * `tsc --noEmit` is part of `npm run validate`, and a `@ts-expect-error` fails
 * the build if the line it guards stops being an error. That is the only thing
 * protecting the guarantee this module exists for: an event name that quietly
 * stops being checked, or a payload that quietly stops being checked, and the
 * first symptom is an event nothing subscribes to.
 */
function compileTimeChecks(): void {
  const org = new Types.ObjectId();

  async function inner() {
    // @ts-expect-error - not an event in the registry
    await events.emit("organization.destroyed", organization);
    // organizationId is required, and is what makes an event recordable in the
    // tenant-scoped audit and activity logs.
    // @ts-expect-error - missing organizationId
    await events.emit("organization.created", { actorId: org });
    await events.emit("organization.created", {
      ...organization,
      // @ts-expect-error - occurredAt is a Date, not a string
      occurredAt: "2026-03-04T10:00:00.000Z",
    });
    // A subscriber's payload is fixed by the event it subscribes to.
    // @ts-expect-error - membership.joined has no organizationId-only payload
    events.subscribe("membership.joined", (payload) => payload.roleId);
  }
  void inner;
}
void compileTimeChecks;
