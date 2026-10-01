import type { Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import { recordActivity } from "@/modules/activities/activity.service";
import { recordAction } from "@/modules/audit/audit.service";
import type { DealStageRef } from "@/modules/deals";
import {
  type Deal,
  DealModel,
  type DealStatus,
} from "@/modules/deals/deal.model";
import type { DealRepository } from "@/modules/deals/deal.repository";
import type { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { AppError } from "@/shared/errors/app-error";
import { events } from "@/shared/events/bus";

export class DealError extends AppError {
  constructor(message: string) {
    super("DEAL_OPERATION_FAILED", { message });
    this.name = "DealError";
  }
}

export interface CreateDealInput {
  name: string;
  companyId?: Types.ObjectId | string | null;
  contactId?: Types.ObjectId | string | null;
  pipelineId: Types.ObjectId | string;
  stageId: Types.ObjectId | string;
  ownerId: Types.ObjectId | string;
  value?: number;
  currency?: string;
  probability?: number;
  expectedCloseDate?: Date | null;
  description?: string | null;
  tags?: (Types.ObjectId | string)[];
  customFields?: Record<string, unknown>;
}

export interface MoveDealInput {
  stageId: Types.ObjectId | string;
  sortOrder: number;
  reason?: string;
}

export interface MoveDealResult {
  deal: Deal;
  activity: Awaited<ReturnType<typeof recordActivity>> | null;
}

/**
 * Service for deal operations.
 */
export class DealService {
  constructor(
    private readonly dealRepo: DealRepository,
    private readonly pipelineRepo: PipelineRepository,
    private readonly actorId: Types.ObjectId,
  ) {}

  /**
   * List deals with filters.
   */
  async list(
    filter: Record<string, unknown> = {},
    options: {
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
    } = {},
  ) {
    return this.dealRepo.findDeals(filter, options);
  }

  /**
   * Count deals matching a filter.
   */
  async count(filter: Record<string, unknown> = {}) {
    return this.dealRepo.countDeals(filter);
  }

  /**
   * Get a deal by ID.
   */
  async getById(id: Types.ObjectId | string): Promise<Deal | null> {
    return this.dealRepo.findById(id);
  }

  /**
   * Create a new deal.
   */
  async create(input: CreateDealInput): Promise<Deal> {
    // Validate that the stage belongs to the pipeline
    const stage = await this.pipelineRepo.getStage(
      input.pipelineId,
      input.stageId,
    );
    if (!stage) {
      throw new DealError(
        "The selected stage does not belong to the specified pipeline.",
      );
    }

    const sortOrder = await this.dealRepo.getNextSortOrder(
      input.pipelineId,
      input.stageId,
    );

    const deal = await this.dealRepo.create({
      ...input,
      sortOrder,
    });

    // Record activity for deal creation
    await recordActivity({
      organizationId: this.dealRepo.organizationId,
      type: "SYSTEM_EVENT",
      title: `Created deal "${deal.name}"`,
      occurredAt: new Date(),
      actorId: this.actorId,
      ownerId: this.actorId,
      subjects: [{ entityType: "deal", entityId: deal._id }],
      metadata: { pipelineId: input.pipelineId, stageId: input.stageId },
    });

    return deal;
  }

  /**
   * Update a deal.
   */
  async update(
    id: Types.ObjectId | string,
    input: Partial<CreateDealInput>,
  ): Promise<Deal | null> {
    // If pipelineId or stageId is being changed, validate
    if (input.pipelineId || input.stageId) {
      const deal = await this.dealRepo.findById(id);
      if (!deal) {
        throw new DealError("Deal not found.");
      }
      const pipelineId = input.pipelineId ?? deal.pipelineId;
      const stageId = input.stageId ?? deal.stageId;
      const stage = await this.pipelineRepo.getStage(pipelineId, stageId);
      if (!stage) {
        throw new DealError(
          "The selected stage does not belong to the specified pipeline.",
        );
      }
    }

    return this.dealRepo.update(id, input);
  }

  /**
   * Move a deal to a new stage.
   * This is the core operation that emits the deal.stage_changed event,
   * records a STAGE_CHANGE activity, and writes an audit entry.
   * All in a single transaction.
   */
  async moveDeal(
    dealId: Types.ObjectId | string,
    input: MoveDealInput,
  ): Promise<MoveDealResult> {
    return withTransaction(async (session) => {
      // Load the deal
      const deal = await DealModel.findOne(
        {
          _id: dealId,
          organizationId: this.dealRepo.organizationId,
          deletedAt: null,
        },
        undefined,
        { session },
      );
      if (!deal) {
        throw new DealError("Deal not found.");
      }

      // Validate target stage belongs to deal's pipeline
      const stage = await this.pipelineRepo.getStage(
        deal.pipelineId,
        input.stageId,
      );
      if (!stage) {
        throw new DealError(
          "The target stage does not belong to this deal's pipeline.",
        );
      }

      // Capture fromStage for the event
      const fromStage = await this.pipelineRepo.getStage(
        deal.pipelineId,
        deal.stageId,
      );

      // Determine new status based on stage flags
      let newStatus: DealStatus = deal.status;
      let closedAt: Date | null = deal.closedAt;
      let lostReason: string | null = deal.lostReason;

      if (stage.isWon) {
        newStatus = "WON";
        closedAt = new Date();
      } else if (stage.isLost) {
        newStatus = "LOST";
        closedAt = new Date();
        lostReason = input.reason ?? "Lost";
      } else {
        newStatus = "OPEN";
        closedAt = null;
        lostReason = null;
      }

      // Update the deal
      const updatedDeal = await DealModel.findOneAndUpdate(
        { _id: dealId, organizationId: this.dealRepo.organizationId },
        {
          $set: {
            stageId: input.stageId,
            sortOrder: input.sortOrder,
            status: newStatus,
            closedAt,
            lostReason,
            updatedBy: this.actorId,
          },
        },
        { returnDocument: "after", session },
      );

      if (!updatedDeal) {
        throw new DealError("Deal not found after update.");
      }

      // Emit the stage changed event
      const occurredAt = new Date();
      const toStageRef: DealStageRef = {
        stageId: stage._id,
        stageName: stage.name,
      };
      const fromStageRef: DealStageRef | null = fromStage
        ? { stageId: fromStage._id, stageName: fromStage.name }
        : null;

      await events.emit("deal.stage_changed", {
        organizationId: this.dealRepo.organizationId,
        actorId: this.actorId,
        dealId: deal._id,
        dealName: deal.name,
        fromStage: fromStageRef,
        toStage: toStageRef,
        occurredAt,
      });

      // Record activity (the subscriber will also do this, but we do it here for immediate consistency)
      // Actually, the activity subscriber handles this. Let's not duplicate.
      // The event will trigger the activity subscriber which records STAGE_CHANGE.

      // Record audit entry
      await recordAction({
        organizationId: this.dealRepo.organizationId,
        actorId: this.actorId,
        action: "deal.stage_change",
        entityType: "deal",
        entityId: deal._id,
        entityLabel: deal.name,
        changes: {
          before: {
            stageId: deal.stageId,
            sortOrder: deal.sortOrder,
            status: deal.status,
          },
          after: {
            stageId: input.stageId,
            sortOrder: input.sortOrder,
            status: newStatus,
          },
        },
        metadata: { reason: input.reason },
      });

      // Get the activity that was recorded by the subscriber
      // We need to fetch it since it's async
      const { timelineForEntity } = await import(
        "@/modules/activities/activity.service"
      );
      const activities = await timelineForEntity({
        organizationId: this.dealRepo.organizationId,
        entityId: deal._id,
        limit: 1,
      });
      const activity = activities[0] ?? null;

      return { deal: updatedDeal, activity };
    });
  }

  /**
   * Soft delete a deal.
   */
  async delete(id: Types.ObjectId | string): Promise<void> {
    await this.dealRepo.softDeleteById(id);
  }

  /**
   * Mark a deal as WON.
   * Moves the deal to the pipeline's won stage, sets status to WON, and emits deal.won event.
   */
  async winDeal(dealId: Types.ObjectId | string): Promise<Deal> {
    return withTransaction(async (session) => {
      // Load the deal
      const deal = await DealModel.findOne(
        {
          _id: dealId,
          organizationId: this.dealRepo.organizationId,
          deletedAt: null,
        },
        undefined,
        { session },
      );
      if (!deal) {
        throw new DealError("Deal not found.");
      }

      if (deal.status === "WON") {
        throw new DealError("Deal is already won.");
      }

      if (deal.status === "LOST") {
        throw new DealError("Cannot win a lost deal. Reopen it first.");
      }

      // Get the pipeline's won stage
      const wonStage = await this.pipelineRepo.getWonStage(deal.pipelineId);
      if (!wonStage) {
        throw new DealError("This pipeline has no 'Won' stage configured.");
      }

      const closedAt = new Date();

      // Update the deal
      const updatedDeal = await DealModel.findOneAndUpdate(
        { _id: dealId, organizationId: this.dealRepo.organizationId },
        {
          $set: {
            stageId: wonStage._id,
            status: "WON",
            closedAt,
            probability: 100,
            updatedBy: this.actorId,
          },
        },
        { returnDocument: "after", session },
      );

      if (!updatedDeal) {
        throw new DealError("Deal not found after update.");
      }

      // Emit deal.won event
      const occurredAt = new Date();
      await events.emit("deal.won", {
        organizationId: this.dealRepo.organizationId,
        actorId: this.actorId,
        dealId: deal._id,
        dealName: deal.name,
        value: deal.value,
        currency: deal.currency,
        closedAt,
        occurredAt,
      });

      // Record audit entry
      await recordAction({
        organizationId: this.dealRepo.organizationId,
        actorId: this.actorId,
        action: "deal.won",
        entityType: "deal",
        entityId: deal._id,
        entityLabel: deal.name,
        changes: {
          before: {
            stageId: deal.stageId,
            status: deal.status,
            probability: deal.probability,
          },
          after: { stageId: wonStage._id, status: "WON", probability: 100 },
        },
      });

      return updatedDeal;
    });
  }

  /**
   * Mark a deal as LOST.
   * Moves the deal to the pipeline's lost stage, sets status to LOST, and emits deal.lost event.
   */
  async loseDeal(
    dealId: Types.ObjectId | string,
    reason?: string,
  ): Promise<Deal> {
    return withTransaction(async (session) => {
      // Load the deal
      const deal = await DealModel.findOne(
        {
          _id: dealId,
          organizationId: this.dealRepo.organizationId,
          deletedAt: null,
        },
        undefined,
        { session },
      );
      if (!deal) {
        throw new DealError("Deal not found.");
      }

      if (deal.status === "LOST") {
        throw new DealError("Deal is already lost.");
      }

      if (deal.status === "WON") {
        throw new DealError("Cannot lose a won deal. Reopen it first.");
      }

      // Get the pipeline's lost stage
      const lostStage = await this.pipelineRepo.getLostStage(deal.pipelineId);
      if (!lostStage) {
        throw new DealError("This pipeline has no 'Lost' stage configured.");
      }

      const closedAt = new Date();
      const lostReason = reason ?? "Lost";

      // Update the deal
      const updatedDeal = await DealModel.findOneAndUpdate(
        { _id: dealId, organizationId: this.dealRepo.organizationId },
        {
          $set: {
            stageId: lostStage._id,
            status: "LOST",
            closedAt,
            lostReason,
            probability: 0,
            updatedBy: this.actorId,
          },
        },
        { returnDocument: "after", session },
      );

      if (!updatedDeal) {
        throw new DealError("Deal not found after update.");
      }

      // Emit deal.lost event
      const occurredAt = new Date();
      await events.emit("deal.lost", {
        organizationId: this.dealRepo.organizationId,
        actorId: this.actorId,
        dealId: deal._id,
        dealName: deal.name,
        lostReason,
        closedAt,
        occurredAt,
      });

      // Record audit entry
      await recordAction({
        organizationId: this.dealRepo.organizationId,
        actorId: this.actorId,
        action: "deal.lost",
        entityType: "deal",
        entityId: deal._id,
        entityLabel: deal.name,
        changes: {
          before: {
            stageId: deal.stageId,
            status: deal.status,
            probability: deal.probability,
            lostReason: deal.lostReason,
          },
          after: {
            stageId: lostStage._id,
            status: "LOST",
            probability: 0,
            lostReason,
          },
        },
        metadata: { reason },
      });

      return updatedDeal;
    });
  }

  /**
   * Get deals for Kanban board (virtualized columns).
   */
  async getKanbanDeals(
    pipelineId: Types.ObjectId | string,
    stageId?: Types.ObjectId | string,
  ) {
    return this.dealRepo.getKanbanDeals(pipelineId, stageId);
  }

  /**
   * Get pipeline summary for dashboard.
   */
  async getPipelineSummary(pipelineId: Types.ObjectId | string) {
    return this.dealRepo.getPipelineSummary(pipelineId);
  }
}
