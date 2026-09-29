/**
 * The event registry.
 *
 * `emit("deal.stage_chaged", ...)` has to be a compile error, not a runtime
 * string that quietly reaches no subscriber. That is the whole point of this
 * file: an event name and its payload are one declaration, and the compiler
 * checks both.
 *
 * Modules own their own events. A module that emits `contact.created` declares
 * it in `contact.events.ts` by merging into `DomainEventMap`:
 *
 * ```ts
 * declare module "@/shared/events/registry" {
 *   interface DomainEventMap {
 *     "contact.created": { organizationId: Types.ObjectId; contactId: Types.ObjectId };
 *   }
 * }
 * ```
 *
 * One interface rather than a central table, because the alternative is a
 * shared file every module has to be edited to use, and that is how a module
 * ends up reaching into another module's types. The cost is that the list of
 * events is spread across the tree; `rg 'interface DomainEventMap' src` finds
 * them all, and every `*.events.ts` is a module's public event surface.
 *
 * Deliberately not enforced here: that every event carries an `organizationId`.
 * It is a real rule in this system and the audit and activity subscribers
 * depend on it, but expressing it as a constraint on a merged interface is not
 * something TypeScript can check without a generic the augmenting module has
 * to remember to supply. It is checked where it can be, in the subscribers.
 */

/**
 * It has to stay an `interface` and not become a `type` alias. A type alias
 * cannot be merged into by `declare module`, and biome's autofix for
 * `noEmptyInterface` rewrites this to one - which breaks every module's event
 * declaration at once, at the far end of the tree, with a "duplicate
 * identifier" that names neither the cause nor the place.
 */
// biome-ignore lint/suspicious/noEmptyInterface: this empty interface is the extension point modules merge into
export interface DomainEventMap {}

/** Every event name in the registry. */
export type EventName = keyof DomainEventMap & string;

/** The payload a given event carries. */
export type EventPayload<K extends EventName> = DomainEventMap[K];

/**
 * What every subscriber is told beyond the payload itself.
 *
 * `occurredAt` is captured once, at emit, rather than read by each subscriber:
 * a subscriber that computed its own timestamp would disagree with the audit
 * row by a few milliseconds, and two records of the same event with different
 * times is worse than one slightly imprecise time.
 */
export interface EventContext<K extends EventName> {
  name: K;
  occurredAt: Date;
}

export type Subscriber<K extends EventName> = (
  payload: EventPayload<K>,
  context: EventContext<K>,
) => void | Promise<void>;
