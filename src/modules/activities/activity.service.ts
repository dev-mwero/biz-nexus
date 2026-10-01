import type { Types } from "mongoose";
import {
  type Activity,
  type ActivityDirection,
  ActivityModel,
  type ActivitySubject,
  type ActivityType,
} from "@/modules/activities/activity.model";
import { redact } from "@/shared/lib/redact";

/**
 * The timeline.
 *
 * Reads are always scoped by `organizationId`, and the three scopes below
 * differ only in what else they filter on. A record's history and the
 * organization's feed are the same question at two widths, so they share a
 * collection and differ by a filter rather than by a second data model.
 *
 * `occurredAt` is the sort key everywhere, never `createdAt`. A call logged
 * today about last Tuesday belongs between last Tuesday's calls, and sorting by
 * write time strands it at the top of the timeline saying it happened now.
 */

export interface RecordActivityInput {
  organizationId: Types.ObjectId;
  type: ActivityType;
  title: string;
  body?: string | null;
  direction?: ActivityDirection | null;
  durationSeconds?: number | null;
  /** When it happened. Defaults to now for a direct entry. */
  occurredAt?: Date;
  /** Null for a system event. */
  actorId?: Types.ObjectId | null;
  /** Required. An activity attributed to nobody appears in no report. */
  ownerId: Types.ObjectId;
  subjects?: ActivitySubject[];
  metadata?: Record<string, unknown>;
}

/**
 * Write one entry to the timeline.
 *
 * Called both directly, for a note a user typed, and from the event
 * subscriber, for something a service did. It throws on failure for the same
 * reason the audit log does: an activity that was not recorded is a thing that
 * happened with no trace. A subscriber that cannot tolerate that is not a
 * subscriber; call this directly and handle the error where it can be seen.
 */
export async function recordActivity(
  input: RecordActivityInput,
): Promise<Activity> {
  const [created] = await ActivityModel.create([
    {
      organizationId: input.organizationId,
      type: input.type,
      title: input.title,
      body: input.body ?? null,
      direction: input.direction ?? null,
      durationSeconds: input.durationSeconds ?? null,
      // An event subscriber always passes the event's own time. Defaulting to
      // `new Date()` here is right for a note being typed and wrong for a
      // replayed event, which would then be filed as having just happened.
      occurredAt: input.occurredAt ?? new Date(),
      actorId: input.actorId ?? null,
      ownerId: input.ownerId,
      subjects: input.subjects ?? [],
      // Metadata carries channel payloads and automation data, which means it
      // eventually carries whatever those systems put in it. Redacted for the
      // same reason as the audit log: this row outlives the request.
      metadata: (redact(input.metadata ?? {}) as Record<string, unknown>) ?? {},
    },
  ]);

  return created;
}

export const ACTIVITY_PAGE_SIZE = 25;

export interface TimelineInput {
  organizationId: Types.ObjectId;
  limit?: number;
  before?: Date;
  /** Cursor-based pagination: activity _id to start after */
  afterId?: Types.ObjectId;
}

/** Everything that happened to one record, newest first. */
export async function timelineForEntity(
  input: TimelineInput & { entityId: Types.ObjectId },
): Promise<Activity[]> {
  return page(
    {
      organizationId: input.organizationId,
      "subjects.entityId": input.entityId,
      ...(input.before ? { occurredAt: { $lt: input.before } } : {}),
      ...(input.afterId ? { _id: { $lt: input.afterId } } : {}),
    },
    input.limit,
  );
}

/** The organization's feed. */
export async function organizationFeed(
  input: TimelineInput,
): Promise<Activity[]> {
  return page(
    {
      organizationId: input.organizationId,
      ...(input.before ? { occurredAt: { $lt: input.before } } : {}),
      ...(input.afterId ? { _id: { $lt: input.afterId } } : {}),
    },
    input.limit,
  );
}

/** Cursor-based pagination for organization feed. */
export async function organizationFeedCursor(
  input: TimelineInput & { cursor?: string; limit?: number },
): Promise<{ activities: Activity[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(input.limit ?? ACTIVITY_PAGE_SIZE, 1), 100);

  const filter: Record<string, unknown> = {
    organizationId: input.organizationId,
    ...(input.before ? { occurredAt: { $lt: input.before } } : {}),
  };

  // If cursor is provided, decode it (it's an _id)
  if (input.cursor) {
    filter._id = { $lt: new Types.ObjectId(input.cursor) };
  }

  const activities = await ActivityModel.find(filter)
    .sort({ occurredAt: -1, _id: -1 })
    .limit(limit + 1) // Fetch one extra to determine if there's a next page
    .lean<Activity[]>()
    .exec();

  let nextCursor: string | null = null;
  if (activities.length > limit) {
    const nextActivity = activities.pop()!;
    nextCursor = nextActivity._id.toString();
  }

  return { activities, nextCursor };
}

/** "My activity": what a member did, not what was attributed to them. */
export async function activityByActor(
  input: TimelineInput & { actorId: Types.ObjectId },
): Promise<Activity[]> {
  return page(
    {
      organizationId: input.organizationId,
      actorId: input.actorId,
      ...(input.before ? { occurredAt: { $lt: input.before } } : {}),
    },
    input.limit,
  );
}

/** "Attributed to me": including the automated work done on their behalf. */
export async function activityByOwner(
  input: TimelineInput & { ownerId: Types.ObjectId },
): Promise<Activity[]> {
  return page(
    {
      organizationId: input.organizationId,
      ownerId: input.ownerId,
      ...(input.before ? { occurredAt: { $lt: input.before } } : {}),
    },
    input.limit,
  );
}

async function page(
  filter: Record<string, unknown>,
  limit: number | undefined,
): Promise<Activity[]> {
  return (
    ActivityModel.find(filter)
      // `_id` as a tiebreaker: two activities in the same millisecond would
      // otherwise swap places between pages, and a page that repeats or drops a
      // row is a timeline that lies.
      .sort({ occurredAt: -1, _id: -1 })
      .limit(Math.min(Math.max(limit ?? ACTIVITY_PAGE_SIZE, 1), 100))
      .lean<Activity[]>()
      .exec()
  );
}
