import { recordActivity } from "@/modules/activities/activity.service";
import { events } from "@/shared/events/bus";

/**
 * The timeline's view of what the rest of the system does.
 *
 * This is the only place that knows which domain events are worth remembering
 * and what an activity should say about them. The service that changed a deal
 * knows none of this and must not grow any of it: it emits what happened and
 * returns. That separation is the entire reason the bus exists, and a deals
 * service that wrote its own activity rows would make every other subject -
 * tasks, notes, calls - need a second mechanism.
 *
 * The mapping is one function per event, so a new event is a new function and a
 * new line in the table, not a branch inside a shared handler.
 */

/** "Moved Renewal from Qualified to Proposal" */
function stageChangeTitle(dealName: string, to: string, from: string | null) {
  return from === null
    ? `Moved ${dealName} to ${to}`
    : `Moved ${dealName} from ${from} to ${to}`;
}

const unsubscribes: Array<() => void> = [];

/**
 * Register the activity timeline's subscribers.
 *
 * Returns an unsubscribe function for the whole set, so a test can install and
 * remove them without leaking a subscription into the next test - a subscriber
 * left attached would write a second activity for every event, which is exactly
 * the bug the bus's duplicate detection cannot catch across tests.
 *
 * Idempotent: calling it twice replaces the previous set rather than adding to
 * it.
 */
export function registerActivitySubscribers(): () => void {
  unsubscribeAll();

  unsubscribes.push(
    events.subscribe("deal.stage_changed", async (event) => {
      await recordActivity({
        organizationId: event.organizationId,
        type: "STAGE_CHANGE",
        title: stageChangeTitle(
          event.dealName,
          event.toStage.stageName,
          event.fromStage?.stageName ?? null,
        ),
        // From the event, never `new Date()`. A replayed event must not land
        // in the timeline saying the move happened just now.
        occurredAt: event.occurredAt,
        actorId: event.actorId,
        // Attributed to whoever moved it. A stage change has no other owner.
        ownerId: event.actorId,
        // The deal is the subject. The timeline for a contact or a company will
        // pick this up through whatever else records them as subjects, and
        // widening `subjects` is a change to the emitting module, not here.
        subjects: [{ entityType: "deal", entityId: event.dealId }],
        metadata: {
          fromStage: event.fromStage,
          toStage: event.toStage,
        },
      });
    }),
  );

  return unsubscribeAll;
}

function unsubscribeAll(): void {
  while (unsubscribes.length) {
    const stop = unsubscribes.pop();
    stop?.();
  }
}
