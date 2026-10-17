import type { Types } from "mongoose";

/**
 * Events the deals module emits.
 *
 * A declaration only: the emitting service is elsewhere, and it compiles against
 * this contract rather than defining it. Events are declared by the module that
 * emits them so that subscribers - the activity timeline, the notification bell
 * - can be written against a shape only this module owns, and the two cannot
 * drift.
 *
 * If the deals module stops emitting one of these, delete it here and the
 * subscriber with it. That is the intended way one goes away.
 */
declare module "@/shared/events/registry" {
  interface DomainEventMap {
    "deal.stage_changed": {
      organizationId: Types.ObjectId;
      /** Who moved it. A stage never moves itself. */
      actorId: Types.ObjectId;
      dealId: Types.ObjectId;
      dealName: string;
      /**
       * Null on a deal's first stage. A deal created directly into a stage has
       * moved into it, and pretending otherwise makes every new deal report a
       * move from somewhere it never was.
       */
      fromStage: DealStageRef | null;
      toStage: DealStageRef;
      occurredAt: Date;
    };
    "deal.won": {
      organizationId: Types.ObjectId;
      actorId: Types.ObjectId;
      dealId: Types.ObjectId;
      dealName: string;
      value: number;
      currency: string;
      closedAt: Date;
      occurredAt: Date;
    };
    "deal.lost": {
      organizationId: Types.ObjectId;
      actorId: Types.ObjectId;
      dealId: Types.ObjectId;
      dealName: string;
      lostReason: string | null;
      closedAt: Date;
      occurredAt: Date;
    };
    /**
     * Ownership of a deal was set or changed.
     *
     * Emitted on creation - a deal is always created with an owner, so creating
     * one is the first assignment - and on any later change of owner. It is not
     * emitted for an edit that leaves the owner alone, so a subscriber may treat
     * every one of these as a real assignment.
     *
     * The actor and the owner are separate fields for a reason: assigning a deal
     * to yourself is still an assignment, and it is the subscriber's job - not
     * the emitter's - to decide nobody needs to be told about their own action.
     */
    "deal.assigned": {
      organizationId: Types.ObjectId;
      /** Who did the assigning. */
      assignedBy: Types.ObjectId;
      dealId: Types.ObjectId;
      dealName: string;
      /** The person the deal now belongs to. */
      ownerId: Types.ObjectId;
      occurredAt: Date;
    };
  }
}

/**
 * A stage, identified and named.
 *
 * Both, deliberately. The id is what a later subscriber needs to reason about
 * the deal, and the name is what the timeline has to show - and a name captured
 * at the moment of the move is the only version that stays correct after
 * somebody renames "Qualified" to "Discovery".
 */
export interface DealStageRef {
  stageId: Types.ObjectId;
  stageName: string;
}
