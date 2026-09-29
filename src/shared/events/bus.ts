import type {
  DomainEventMap,
  EventContext,
  EventName,
  EventPayload,
  Subscriber,
} from "@/shared/events/registry";

/**
 * The in-process domain event bus.
 *
 * Events decouple, they do not orchestrate. A service emits what happened and
 * returns; the audit log, the activity timeline, and later the automation
 * engine are subscribers. None of them is called by the service directly, and
 * none of them can make the service's request fail.
 *
 * **Non-durable, and honest about it.** Subscribers live in the memory of one
 * process. An event emitted while the process is down does not happen, and
 * there is no queue to replay it from. That is a deliberate trade for a single
 * application at MVP scale, and it is the reason the audit log is written by a
 * subscriber here rather than by this bus being trusted as the record: the
 * audit row is the durable artefact, the event is the notification that it
 * should exist. Moving to a broker is a Stage 7 change and this interface is
 * the seam for it.
 */

/** A subscriber that failed. Reported, never thrown at the emitter. */
export interface SubscriberFailure {
  event: EventName;
  /** Index in registration order, which is how the two are told apart. */
  index: number;
  error: unknown;
}

export interface EventBusOptions {
  /**
   * Called once per failing subscriber, after the failure has been caught.
   *
   * The bus deliberately does not import the route wrapper's logger. This module
   * sits below the API layer, and the one thing it must never do is log an
   * error object in a way that could reach a response. Handing the raw error to
   * a caller-supplied reporter keeps the decision about what a log line looks
   * like with whoever owns logging, and lets a test assert on it directly.
   */
  onSubscriberFailure?: (failure: SubscriberFailure) => void;
}

export interface EventBus {
  /**
   * Registers a subscriber. Returns the function that removes it.
   *
   * Registration order is dispatch order. It is stable and it is the only
   * ordering guarantee, and it is not a substitute for a dependency between
   * subscribers: two subscribers for the same event must not need to run in a
   * particular order, because the next module to register one will change it.
   */
  subscribe<K extends EventName>(
    name: K,
    subscriber: Subscriber<K>,
  ): () => void;

  /**
   * Dispatches to every subscriber of `name`, in order, awaiting each.
   *
   * Async and awaited on purpose. The subscribers that matter here write to the
   * database, and a test that emits an event and then asserts on the row needs
   * the write to have happened. Fire-and-forget would make that a race, and
   * would let a request return before the audit trail exists for it.
   *
   * Every subscriber gets the same payload object. It is not cloned per
   * subscriber, so a subscriber must treat it as read-only; a subscriber that
   * mutates it changes what the next one sees. Cloning would be a real cost on
   * every event to contain a mistake no subscriber currently makes, and it
   * would hide the mistake behind a deep copy rather than surface it.
   *
   * A subscriber that throws or rejects is caught, reported, and skipped. The
   * remaining subscribers still run, and `emit` still resolves: a broken
   * activity-timeline subscriber must not fail the request that changed a deal
   * stage, and it must not stop the audit log from being written either.
   */
  emit<K extends EventName>(name: K, payload: EventPayload<K>): Promise<void>;

  /** Subscriber count for an event. Test and shutdown diagnostics. */
  count(name: EventName): number;
}

export function createEventBus(options: EventBusOptions = {}): EventBus {
  const { onSubscriberFailure } = options;
  const subscribers = new Map<EventName, Array<Subscriber<EventName>>>();

  return {
    subscribe(name, subscriber) {
      const existing = subscribers.get(name);
      if (existing === undefined) {
        subscribers.set(name, [subscriber as Subscriber<EventName>]);
      } else {
        // A module loaded twice - a dev-server reload, two import paths
        // resolving to the same file - would otherwise register its subscriber
        // twice and every event would be handled twice. Two audit rows, two
        // notifications, no error anywhere.
        if (existing.includes(subscriber as Subscriber<EventName>)) {
          onSubscriberFailure?.({
            event: name,
            index: existing.length,
            error: new Error(
              "duplicate subscriber registered; it would handle each event twice",
            ),
          });
          return () => {};
        }
        existing.push(subscriber as Subscriber<EventName>);
      }

      let attached = true;
      return () => {
        if (!attached) return;
        attached = false;
        const list = subscribers.get(name);
        if (list === undefined) return;
        const at = list.indexOf(subscriber as Subscriber<EventName>);
        if (at !== -1) list.splice(at, 1);
        if (list.length === 0) subscribers.delete(name);
      };
    },

    async emit(name, payload) {
      const list = subscribers.get(name);
      if (list === undefined) return;

      // Dispatched over a snapshot. A subscriber is allowed to unsubscribe
      // itself or a sibling - that is how a module tears down - and mutating
      // the list while walking it would skip whichever subscriber came next.
      const targets = [...list];
      const context: EventContext<EventName> = {
        name,
        occurredAt: new Date(),
      };

      for (const [index, subscriber] of targets.entries()) {
        try {
          await subscriber(payload as never, context);
        } catch (error) {
          onSubscriberFailure?.({ event: name, index, error });
        }
      }
    },

    count(name) {
      return subscribers.get(name)?.length ?? 0;
    },
  };
}

/**
 * The application bus.
 *
 * A factory so that tests can build an isolated one, and a singleton because
 * modules register their subscribers at import time and need the same instance
 * the services emit on.
 */
export const events: EventBus = createEventBus({
  onSubscriberFailure: ({ event, index, error }) => {
    const reason = error instanceof Error ? error.message : String(error);
    // Server-side only, and deliberately minimal: this is a subscriber failing
    // after the request has already succeeded, so the line exists to tell
    // someone that a subsystem is not keeping up, not to describe the event.
    console.error(
      `[events] subscriber ${index} for "${event}" failed and was skipped: ${reason}`,
    );
  },
});

/**
 * A test helper: records every emission of `name` and cleans up after itself.
 *
 * Subscribing to the real singleton rather than a fresh bus is deliberate. The
 * thing worth testing is that the bus services actually emit on has the
 * subscribers a module registered, and a fresh bus would agree with a
 * differently-wired one.
 */
export function recordEvents<K extends EventName>(name: K) {
  const received: Array<{
    payload: EventPayload<K>;
    context: EventContext<K>;
  }> = [];
  const stop = events.subscribe(name, (payload, context) => {
    received.push({ payload, context });
  });

  return {
    received,
    /** The payloads only, for the common assertion. */
    payloads: () => received.map((entry) => entry.payload),
    stop,
  };
}

export type { DomainEventMap, EventName, EventPayload };
