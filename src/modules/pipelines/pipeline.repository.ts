import { Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import {
  type Pipeline,
  PipelineModel,
  type PipelineStage,
} from "@/modules/pipelines/pipeline.model";

/**
 * Repository for pipeline operations.
 *
 * All operations are scoped to the organizationId provided at construction.
 */
export class PipelineRepository extends TenantRepository<Pipeline> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(PipelineModel, organizationId, actorId);
  }

  /**
   * Find all pipelines for the organization, ordered by display order.
   */
  findAll() {
    return this.find({}, { projection: { stages: 0 } })
      .sort({ order: 1 })
      .lean();
  }

  /**
   * Find all pipelines with stages included.
   */
  findAllWithStages() {
    return this.find({}).sort({ order: 1 }).lean();
  }

  /**
   * Find the default pipeline for the organization.
   */
  findDefault() {
    return this.findOne({ isDefault: true }).lean();
  }

  /**
   * Find a pipeline by ID with stages.
   */
  findByIdWithStages(id: Types.ObjectId | string) {
    return this.findById(id).lean();
  }

  /**
   * Find a pipeline by ID without stages (lighter).
   */
  findByIdLean(id: Types.ObjectId | string) {
    return this.findById(id, { projection: { stages: 0 } }).lean();
  }

  /**
   * Create a new pipeline with stages.
   */
  async createPipeline(input: {
    name: string;
    description?: string | null;
    isDefault?: boolean;
    order?: number;
    stages?: Omit<PipelineStage, "_id">[];
  }): Promise<Pipeline> {
    const stages = (input.stages ?? []).map((stage) => ({
      ...stage,
      _id: new Types.ObjectId(),
    }));

    const created = await super.create({
      name: input.name,
      description: input.description ?? null,
      isDefault: input.isDefault ?? false,
      order: input.order ?? 0,
      stages,
    } as never);

    return created;
  }

  /**
   * Update pipeline metadata (name, description, order, isDefault).
   * Does not touch stages — use reorderStages or replaceStages for that.
   */
  updateMetadata(
    id: Types.ObjectId | string,
    input: {
      name?: string;
      description?: string | null;
      order?: number;
      isDefault?: boolean;
    },
  ) {
    return this.findByIdAndUpdate(id, { $set: input });
  }

  /**
   * Atomically replace the entire stages array.
   * This is the only way to reorder, add, remove, or rename stages.
   * Returns the updated pipeline with new stages.
   */
  async replaceStages(
    id: Types.ObjectId | string,
    stages: Omit<PipelineStage, "_id">[],
  ): Promise<Pipeline | null> {
    const stagesWithIds = stages.map((stage) => ({
      ...stage,
      _id: new Types.ObjectId(),
    }));

    const update = { $set: { stages: stagesWithIds } };
    const now = new Date();
    (update.$set as Record<string, unknown>).updatedAt = now;

    const result = await this.model.findOneAndUpdate(
      this.scope({ _id: id } as never),
      update,
      { returnDocument: "after" },
    );

    return result;
  }

  /**
   * Check if a pipeline has any deals referencing it.
   */
  async hasDeals(id: Types.ObjectId | string): Promise<boolean> {
    const DealModel = (await import("@/modules/deals/deal.model")).DealModel;
    return (
      (await DealModel.exists({ pipelineId: id, deletedAt: null })) !== null
    );
  }

  /**
   * Check if a stage exists in a pipeline.
   */
  async hasStage(
    pipelineId: Types.ObjectId | string,
    stageId: Types.ObjectId | string,
  ): Promise<boolean> {
    const pipeline = await this.findById(pipelineId, {
      projection: { stages: 1 },
    }).lean();
    if (!pipeline) return false;
    return pipeline.stages.some(
      (stage) => stage._id.toString() === stageId.toString(),
    );
  }

  /**
   * Get a stage by ID from a pipeline.
   */
  async getStage(
    pipelineId: Types.ObjectId | string,
    stageId: Types.ObjectId | string,
  ): Promise<PipelineStage | null> {
    const pipeline = await this.findById(pipelineId, {
      projection: { stages: 1 },
    }).lean();
    if (!pipeline) return null;
    return (
      pipeline.stages.find(
        (stage) => stage._id.toString() === stageId.toString(),
      ) ?? null
    );
  }

  /**
   * Find the first stage in a pipeline (lowest order).
   */
  async getFirstStage(
    pipelineId: Types.ObjectId | string,
  ): Promise<PipelineStage | null> {
    const pipeline = await this.findById(pipelineId, {
      projection: { stages: 1 },
    }).lean();
    if (!pipeline || pipeline.stages.length === 0) return null;
    return pipeline.stages.reduce((prev, curr) =>
      prev.order < curr.order ? prev : curr,
    );
  }

  /**
   * Find the won stage in a pipeline, if any.
   */
  async getWonStage(
    pipelineId: Types.ObjectId | string,
  ): Promise<PipelineStage | null> {
    const pipeline = await this.findById(pipelineId, {
      projection: { stages: 1 },
    }).lean();
    if (!pipeline) return null;
    return pipeline.stages.find((stage) => stage.isWon) ?? null;
  }

  /**
   * Find the lost stage in a pipeline, if any.
   */
  async getLostStage(
    pipelineId: Types.ObjectId | string,
  ): Promise<PipelineStage | null> {
    const pipeline = await this.findById(pipelineId, {
      projection: { stages: 1 },
    }).lean();
    if (!pipeline) return null;
    return pipeline.stages.find((stage) => stage.isLost) ?? null;
  }

  /**
   * Soft delete a pipeline. Only allowed if no deals reference it.
   */
  async softDeleteIfUnused(
    id: Types.ObjectId | string,
  ): Promise<{ deleted: boolean; dealCount: number }> {
    const DealModel = (await import("@/modules/deals/deal.model")).DealModel;

    // First check if the pipeline exists in this organization
    const pipeline = await this.findById(id, { projection: { _id: 1 } }).lean();
    if (!pipeline) {
      return { deleted: false, dealCount: 0 };
    }

    const dealCount = await DealModel.countDocuments({
      pipelineId: id,
      deletedAt: null,
      organizationId: this.organizationId,
    });

    if (dealCount > 0) {
      return { deleted: false, dealCount };
    }

    await this.softDeleteById(id);
    return { deleted: true, dealCount: 0 };
  }
}
