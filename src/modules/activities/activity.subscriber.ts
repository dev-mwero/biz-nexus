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

/** "Completed 'Call client' — assigned to Jane" */
function taskCompletedTitle(taskTitle: string, assigneeName?: string | null) {
  return assigneeName
    ? `Completed "${taskTitle}" — assigned to ${assigneeName}`
    : `Completed "${taskTitle}"`;
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

  unsubscribes.push(
    events.subscribe("task.completed", async (event) => {
      // The task service emits `task.completed` with the task's related entities.
      // We record a TASK_COMPLETED activity on each related entity so it appears
      // on the timeline of the contact, company, or deal the task was about.
      const subjects =
        event.related.length > 0
          ? event.related
          : [{ entityType: "task", entityId: event.taskId }];

      await recordActivity({
        organizationId: event.organizationId,
        type: "TASK",
        title: taskCompletedTitle(event.taskTitle, null), // assigneeName not available here
        occurredAt: event.occurredAt ?? new Date(),
        actorId: event.completedBy,
        ownerId: event.completedBy,
        subjects,
        metadata: {
          taskId: event.taskId.toString(),
          completedBy: event.completedBy.toString(),
        },
      });
    }),
  );

  unsubscribes.push(
    events.subscribe("task.assigned", async (event) => {
      // A TASK activity for assignment, so the timeline shows who was assigned what
      await recordActivity({
        organizationId: event.organizationId,
        type: "TASK",
        title: `Assigned "${event.taskTitle}" to ${event.assigneeId}`,
        occurredAt: new Date(),
        actorId: event.assignedBy,
        ownerId: event.assignedBy,
        subjects: [{ entityType: "task", entityId: event.taskId }],
        metadata: {
          taskId: event.taskId.toString(),
          assigneeId: event.assigneeId.toString(),
          action: "assigned",
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
