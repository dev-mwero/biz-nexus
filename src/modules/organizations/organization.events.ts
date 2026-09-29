import type { Types } from "mongoose";

/**
 * Events this module emits.
 *
 * The only public surface another module may rely on. An event is a statement
 * that something happened, so its payload carries what a subscriber needs to
 * react and enough to attribute the action - never the caller's whole request,
 * and never anything the module treats as a secret.
 *
 * `organizationId` is on every event in this system, including the ones that
 * look like they do not need it. An event without it cannot be written to the
 * audit log or the activity timeline, which are both tenant-scoped, so an event
 * without one is an event nobody can record.
 */
declare module "@/shared/events/registry" {
  interface DomainEventMap {
    "organization.created": {
      organizationId: Types.ObjectId;
      /** The user who created it, who is also its first owner. */
      actorId: Types.ObjectId;
      name: string;
      slug: string;
      occurredAt: Date;
    };

    /**
     * A member joined an organisation they had been invited to. Separate from
     * `membership.invited` because the audit trail has to distinguish an offer
     * from an acceptance, and an event that collapses them cannot answer "when
     * did this person actually become a member".
     */
    "membership.joined": {
      organizationId: Types.ObjectId;
      actorId: Types.ObjectId;
      membershipId: Types.ObjectId;
      userId: Types.ObjectId;
      roleId: Types.ObjectId;
      occurredAt: Date;
    };
  }
}
