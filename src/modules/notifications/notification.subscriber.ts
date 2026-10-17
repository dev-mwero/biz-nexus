import type { Types } from "mongoose";
import { notify } from "@/modules/notifications/notification.service";
import { events } from "@/shared/events/bus";

/**
 * The bell's view of what happens to people.
 *
 * A notification is addressed to a person, and this is the only place that
 * decides which domain events are worth telling someone about. The task service
 * emits `task.assigned` and returns; it does not know a bell exists. That
 * separation is the entire reason the bus is here.
 *
 * The mapping is one subscriber per event, so a new notification is a new
 * function and a new push below, not a branch inside a shared handler.
 *
 * **No `dedupeKey` is set, deliberately.** Deduplication exists for a transport
 * that can redeliver an event, and this bus cannot: it dispatches in-process,
 * once, and awaits each subscriber before `emit` resolves. A key scoped to the
 * entity -- `task:<id>:assigned`, the shape `notification.service` is tested
 * with -- would also suppress a genuine later re-assignment to the same person,
 * trading a duplicate that cannot happen for a notification that should. The
 * mechanism stays in the service and stays tested; a future durable transport
 * is what should turn it on, keyed on the event's own id rather than the
 * entity's.
 */

const unsubscribes: Array<() => void> = [];

/**
 * Register the bell's subscribers.
 *
 * Returns an unsubscribe function for the whole set, so a test can install and
 * remove them without leaking a subscription into the next test -- a subscriber
 * left attached would notify twice for every event, which is exactly the bug the
 * bus's duplicate detection cannot catch across tests.
 *
 * Idempotent: calling it twice replaces the previous set rather than adding to
 * it, so a double start-up does not double every notification.
 */
export function registerNotificationSubscribers(): () => void {
  unsubscribeAll();

  unsubscribes.push(
    events.subscribe("task.assigned", async (event) => {
      // Being handed your own task is not news, and every "create a task, then
      // assign it to yourself" flow would otherwise ring the bell the user is
      // already looking at.
      if (sameId(event.assigneeId, event.assignedBy)) return;

      await notify({
        organizationId: event.organizationId,
        userId: event.assigneeId,
        type: "TASK_ASSIGNED",
        title: "A task was assigned to you",
        body: event.taskTitle,
        data: { url: `/tasks/${event.taskId.toString()}` },
      });
    }),
  );

  return unsubscribeAll;
}

function sameId(a: Types.ObjectId, b: Types.ObjectId): boolean {
  return a.equals(b);
}

function unsubscribeAll(): void {
  while (unsubscribes.length) {
    unsubscribes.pop()?.();
  }
}
