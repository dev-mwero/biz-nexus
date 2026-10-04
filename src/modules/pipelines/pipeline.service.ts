import type mongoose from "mongoose";
import { Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import {
  type Pipeline,
  PipelineModel,
  type PipelineStage,
} from "@/modules/pipelines/pipeline.model";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { AppError, type ErrorCode } from "@/shared/errors/app-error";
import { events } from "@/shared/events/bus";

export class PipelineError extends AppError {
  /**
   * `VALIDATION_FAILED` by default, because most of what goes wrong with a
   * pipeline is a bad request: duplicate stage keys, duplicate orders, a missing
   * field. The operations that can fail with "there is no such pipeline in this
   * organisation" pass `RECORD_NOT_FOUND` so they surface as a 404 — the
   * distinction `docs/SECURITY.md` §6 asks for, where a missing record and a
   * forbidden one must not be told apart.
   */
  constructor(message: string, code: ErrorCode = "VALIDATION_FAILED") {
    super(code, { message });
    this.name = "PipelineError";
  }
}

/**
 * Default pipeline stages for a new organization.
 */
export const DEFAULT_PIPELINE_STAGES: Omit<PipelineStage, "_id">[] = [
  {
    key: "NEW",
    name: "New",
    order: 0,
    probability: 10,
    color: "slate",
    isWon: false,
    isLost: false,
  },
  {
    key: "QUALIFIED",
    name: "Qualified",
    order: 1,
    probability: 25,
    color: "blue",
    isWon: false,
    isLost: false,
  },
  {
    key: "PROPOSAL",
    name: "Proposal",
    order: 2,
    probability: 50,
    color: "amber",
    isWon: false,
    isLost: false,
  },
  {
    key: "NEGOTIATION",
    name: "Negotiation",
    order: 3,
    probability: 75,
    color: "orange",
    isWon: false,
    isLost: false,
  },
  {
    key: "WON",
    name: "Won",
    order: 4,
    probability: 100,
    color: "green",
    isWon: true,
    isLost: false,
  },
  {
    key: "LOST",
    name: "Lost",
    order: 5,
    probability: 0,
    color: "red",
    isWon: false,
    isLost: true,
  },
];

/**
 * Service for pipeline operations.
 */
export class PipelineService {
  constructor(
    private readonly repository: PipelineRepository,
    private readonly actorId: Types.ObjectId,
  ) {}

  /**
   * Get all pipelines for the organization.
   */
  async list(): Promise<Pipeline[]> {
    return this.repository.findAllWithStages();
  }

  /**
   * Get the default pipeline.
   */
  async getDefault(): Promise<Pipeline | null> {
    return this.repository.findDefault();
  }

  /**
   * Get a pipeline by ID with stages.
   */
  async getById(id: Types.ObjectId | string): Promise<Pipeline | null> {
    return this.repository.findByIdWithStages(id);
  }

  /**
   * Create a new pipeline.
   */
  async create(input: {
    name: string;
    description?: string | null;
    isDefault?: boolean;
    order?: number;
    stages?: Omit<PipelineStage, "_id">[];
  }): Promise<Pipeline> {
    // If this is set as default, unset any existing default
    if (input.isDefault) {
      await PipelineModel.updateOne(
        { organizationId: this.repository.organizationId, isDefault: true },
        { $set: { isDefault: false, updatedBy: this.actorId } },
      );
    }

    // Determine order
    const order = input.order ?? (await this.nextOrder());

    const pipeline = await this.repository.createPipeline({
      name: input.name,
      description: input.description ?? null,
      isDefault: input.isDefault ?? false,
      order,
      stages: input.stages ?? [],
    });

    return pipeline;
  }

  /**
   * Update pipeline metadata.
   */
  async update(
    id: Types.ObjectId | string,
    input: {
      name?: string;
      description?: string | null;
      order?: number;
      isDefault?: boolean;
    },
  ): Promise<Pipeline | null> {
    // If setting as default, unset existing default
    if (input.isDefault) {
      await PipelineModel.updateOne(
        {
          organizationId: this.repository.organizationId,
          isDefault: true,
          _id: { $ne: id },
        },
        { $set: { isDefault: false, updatedBy: this.actorId } },
      );
    }

    return this.repository.updateMetadata(id, input);
  }

  /**
   * Reorder/replace stages atomically.
   * This is the single source of truth for stage mutations.
   */
  async reorderStages(
    pipelineId: Types.ObjectId | string,
    stages: Omit<PipelineStage, "_id">[],
  ): Promise<Pipeline> {
    const pipeline = await this.repository.findById(pipelineId);
    if (!pipeline) {
      throw new PipelineError("Pipeline not found.", "RECORD_NOT_FOUND");
    }

    // Validate: at most one won, one lost
    const wonCount = stages.filter((s) => s.isWon).length;
    const lostCount = stages.filter((s) => s.isLost).length;
    if (wonCount > 1 || lostCount > 1) {
      throw new PipelineError(
        "A pipeline may have at most one won stage and one lost stage.",
      );
    }

    // Validate: unique keys
    const keys = stages.map((s) => s.key);
    if (new Set(keys).size !== keys.length) {
      throw new PipelineError("Stage keys must be unique within a pipeline.");
    }

    // Validate: unique orders
    const orders = stages.map((s) => s.order);
    if (new Set(orders).size !== orders.length) {
      throw new PipelineError("Stage orders must be unique within a pipeline.");
    }

    const updated = await this.repository.replaceStages(pipelineId, stages);
    if (!updated) {
      throw new PipelineError(
        "Pipeline not found after update.",
        "RECORD_NOT_FOUND",
      );
    }

    return updated;
  }

  /**
   * Delete a pipeline. Only allowed if no deals reference it.
   *
   * The existence check comes first, and it has to. `softDeleteIfUnused` answers
   * `deleted: false` for two different situations — "no such pipeline in this
   * organisation" and "this pipeline still has deals" — and collapses them into one
   * `{ deleted: false, dealCount: 0 }`. The route read that as a conflict and
   * answered `409 Cannot delete pipeline: 0 deal(s) reference it`, which is how a
   * cross-tenant delete came to report that a pipeline the caller cannot see has no
   * deals attached to it. Both cases must be distinguishable, and neither may be
   * reported in terms of the other.
   */
  async delete(
    pipelineId: Types.ObjectId | string,
  ): Promise<{ deleted: boolean; dealCount: number }> {
    const existing = await this.repository
      .findById(pipelineId, {
        projection: { _id: 1 },
      })
      .lean();
    if (!existing) {
      throw new PipelineError("Pipeline not found.", "RECORD_NOT_FOUND");
    }

    return this.repository.softDeleteIfUnused(pipelineId);
  }

  /**
   * Provision the default pipeline for a new organization.
   * Called from organization creation, inside the same transaction.
   */
  static async provisionDefault(
    organizationId: Types.ObjectId | string,
    actorId: Types.ObjectId | string,
    session: mongoose.ClientSession,
  ): Promise<Pipeline> {
    const repo = new PipelineRepository(organizationId, actorId);

    // Check if already has a default (idempotent guard)
    const existing = await repo.findDefault();
    if (existing) return existing;

    const pipeline = await PipelineModel.create(
      [
        {
          organizationId,
          name: "Sales Pipeline",
          description: "Default sales pipeline",
          isDefault: true,
          order: 0,
          stages: DEFAULT_PIPELINE_STAGES.map((stage) => ({
            ...stage,
            _id: new Types.ObjectId(),
          })),
          createdBy: actorId,
          updatedBy: actorId,
        } as never,
      ],
      { session },
    );

    if (!pipeline[0]) {
      throw new PipelineError("Default pipeline was not created.");
    }

    return pipeline[0];
  }

  /**
   * Get the next display order for a new pipeline.
   */
  private async nextOrder(): Promise<number> {
    const pipelines = await this.repository.findAll();
    if (pipelines.length === 0) return 0;
    const maxOrder = Math.max(...pipelines.map((p) => p.order ?? 0));
    return maxOrder + 1;
  }
}
