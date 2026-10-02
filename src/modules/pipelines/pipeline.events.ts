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
    "pipeline.created": {
      organizationId: Types.ObjectId;
      actorId: Types.ObjectId;
      pipelineId: Types.ObjectId;
      name: string;
      isDefault: boolean;
      occurredAt: Date;
    };

    "pipeline.updated": {
      organizationId: Types.ObjectId;
      actorId: Types.ObjectId;
      pipelineId: Types.ObjectId;
      changes: Record<string, unknown>;
      occurredAt: Date;
    };

    "pipeline.deleted": {
      organizationId: Types.ObjectId;
      actorId: Types.ObjectId;
      pipelineId: Types.ObjectId;
      name: string;
      occurredAt: Date;
    };

    "pipeline.stages_reordered": {
      organizationId: Types.ObjectId;
      actorId: Types.ObjectId;
      pipelineId: Types.ObjectId;
      stageCount: number;
      occurredAt: Date;
    };

    "pipeline.default_changed": {
      organizationId: Types.ObjectId;
      actorId: Types.ObjectId;
      previousDefaultId: Types.ObjectId | null;
      newDefaultId: Types.ObjectId;
      occurredAt: Date;
    };
  }
}
