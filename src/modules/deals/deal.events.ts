import type { Types } from "mongoose";

/**
 * Events the deals module emits.
 *
 * A declaration only, for now: no deals service exists yet, so nothing
 * implements this contract. It is here because events are declared by the
 * module that emits them, and the activity timeline needs to know the shape of
 * `deal.stage_changed` before anything emits it. Putting the declaration in
 * the subscriber instead would let the two drift - the timeline would be
 * written against a shape only it believes in, and the first deals service to
 * emit would compile against a different one.
 *
 * If the deals module turns out not to need this event, delete this file and
 * the subscriber with it. That is the intended way this goes away.
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
