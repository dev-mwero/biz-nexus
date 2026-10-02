import type { ClientSession, Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import { recordActivity } from "@/modules/activities/activity.service";
import { recordAction } from "@/modules/audit/audit.service";
import type { DealStageRef } from "@/modules/deals";
import {
  type Deal,
  DealModel,
  type DealStatus,
} from "@/modules/deals/deal.model";
import {
  DEAL_EDITABLE_FIELDS,
  type DealEditableField,
  type DealRepository,
  type DealUpdatePayload,
} from "@/modules/deals/deal.repository";
import { UserModel } from "@/modules/identity";
import type { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { AppError, type ErrorCode } from "@/shared/errors/app-error";
import { events } from "@/shared/events/bus";

/**
 * A deal operation that could not be carried out.
 *
 * Each site names its own code, because the status is the client's answer:
 * a deal that is not there is a 404 and must stay one, a deal that is already
 * won is a 409, and a pipeline with no won stage is a 422 the caller can fix.
 * A single catch-all code would flatten those into one indistinguishable status
 * and leave the route handlers string-matching on messages to tell them apart.
 */
export class DealError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, { message });
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
 * What `DealService.update` will accept off the wire.
 *
 * The editable fields of `DealUpdatePayload`, plus the two keys this method
 * refuses. Naming them here is deliberate: the rejection can only happen for a
 * field the caller was able to pass, and a field the type cannot mention is a
 * field the caller cannot be told off for.
 */
export interface UpdateDealInput extends Partial<DealUpdatePayload> {
  pipelineId?: CreateDealInput["pipelineId"];
  stageId?: CreateDealInput["stageId"];
}

/**
 * The runtime half of the editable-field allowlist. See
 * `DEAL_EDITABLE_FIELDS` for why this cannot be derived from the zod schema:
 * both are erased before the service runs.
 */
const EDITABLE_FIELD_SET: ReadonlySet<string> = new Set<string>(
  DEAL_EDITABLE_FIELDS,
);

/**
 * The answer to a `stageId` or `pipelineId` in an update.
 *
 * Said once, here, because the service is the layer that knows what the move
 * endpoint maintains. The route's schema lets these two keys through precisely
 * so they arrive here and get this sentence.
 */
const MOVE_STAGE_HINT =
  "To change a deal's stage, use POST /api/v1/deals/:id/move. That endpoint maintains status, closedAt, and lostReason together with events and audit entries.";

/**
 * Copy one editable field across, if it was supplied.
 *
 * Generic in the key rather than writing `payload[key] = input[key]` inside a
 * loop over the tuple. With a union of keys on the left-hand side TypeScript
 * demands the value satisfy the *intersection* of every payload field type, and
 * a caller reaching for a suppression to get past that is exactly the mistake
 * worth making impossible. Generic, the key is one key, the value's type is the
 * one that belongs to it, and a field whose types disagree between `input` and
 * `DealUpdatePayload` fails here rather than at runtime.
 */
function copyEditableField<K extends DealEditableField>(
  payload: DealUpdatePayload,
  source: Partial<DealUpdatePayload>,
  key: K,
): void {
  if (key in source) {
    payload[key] = source[key];
  }
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
   * The audit actor for a write inside a transaction.
   *
   * `RecordActionInput.actor` is `{ id, name }`, not a bare id, and the name is
   * denormalised onto the audit row precisely so the log still reads after the
   * user is deleted. This service is constructed with an id alone, so the name
   * has to be read.
   *
   * Read inside the caller's session rather than separately, so the audit row
   * cannot name an actor that the transaction has not committed. A user who has
   * genuinely been deleted yields "System": that is `recordAction`'s own
   * documented fallback, and it is the honest reading of an actor we can no
   * longer name. The same pattern appears in `invitation.service`.
   */
  private async auditActor(session: ClientSession) {
    const actor = await UserModel.findOne({ _id: this.actorId }, undefined, {
      session,
    })
      .select("name")
      .lean<{ name?: string } | null>()
      .exec();

    return { id: this.actorId, name: actor?.name ?? "System" };
  }

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
    return this.dealRepo.findDealById(id);
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
        "VALIDATION_FAILED",
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
   *
   * Only the fields in `EDITABLE_FIELD_SET` are written. This is the check the
   * security fix rests on, and it is a runtime check on purpose: the zod schema
   * in the route and the `UpdateDealInput` type are both gone by the time this
   * method is called, and a caller inside the process - a script, a job, a
   * future endpoint that forgets to validate - is not obliged to have been to
   * the route at all. Every field the pipeline owns, and every field the tenant
   * owns, is written by the method that is responsible for it.
   *
   * Stage changes are refused in favour of `POST /api/v1/deals/:id/move`, which
   * maintains the derived state around them.
   */
  async update(
    id: Types.ObjectId | string,
    input: UpdateDealInput,
  ): Promise<Deal | null> {
    for (const key of Object.keys(input)) {
      if (key === "stageId" || key === "pipelineId") {
        throw new DealError("VALIDATION_FAILED", MOVE_STAGE_HINT);
      }
      if (!EDITABLE_FIELD_SET.has(key)) {
        throw new DealError(
          "VALIDATION_FAILED",
          `The field "${key}" cannot be updated via this endpoint.`,
        );
      }
    }

    const payload: DealUpdatePayload = {};
    for (const key of DEAL_EDITABLE_FIELDS) {
      copyEditableField(payload, input, key);
    }

    return this.dealRepo.update(id, payload);
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
        throw new DealError("RECORD_NOT_FOUND", "Deal not found.");
      }

      // Validate target stage belongs to deal's pipeline
      const stage = await this.pipelineRepo.getStage(
        deal.pipelineId,
        input.stageId,
      );
      if (!stage) {
        throw new DealError(
          "VALIDATION_FAILED",
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
        throw new DealError("RECORD_NOT_FOUND", "Deal not found after update.");
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
        actor: await this.auditActor(session),
        action: "deal.stage_change",
        entityType: "deal",
        entityId: deal._id,
        entityLabel: deal.name,
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
        metadata: { reason: input.reason },
        occurredAt,
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
        throw new DealError("RECORD_NOT_FOUND", "Deal not found.");
      }

      if (deal.status === "WON") {
        throw new DealError("INVALID_STATE", "Deal is already won.");
      }

      if (deal.status === "LOST") {
        throw new DealError(
          "INVALID_STATE",
          "Cannot win a lost deal. Reopen it first.",
        );
      }

      // Get the pipeline's won stage
      const wonStage = await this.pipelineRepo.getWonStage(deal.pipelineId);
      if (!wonStage) {
        throw new DealError(
          "VALIDATION_FAILED",
          "This pipeline has no 'Won' stage configured.",
        );
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
        throw new DealError("RECORD_NOT_FOUND", "Deal not found after update.");
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
        actor: await this.auditActor(session),
        action: "deal.won",
        entityType: "deal",
        entityId: deal._id,
        entityLabel: deal.name,
        before: {
          stageId: deal.stageId,
          status: deal.status,
          probability: deal.probability,
        },
        after: { stageId: wonStage._id, status: "WON", probability: 100 },
        occurredAt,
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
        throw new DealError("RECORD_NOT_FOUND", "Deal not found.");
      }

      if (deal.status === "LOST") {
        throw new DealError("INVALID_STATE", "Deal is already lost.");
      }

      if (deal.status === "WON") {
        throw new DealError(
          "INVALID_STATE",
          "Cannot lose a won deal. Reopen it first.",
        );
      }

      // Get the pipeline's lost stage
      const lostStage = await this.pipelineRepo.getLostStage(deal.pipelineId);
      if (!lostStage) {
        throw new DealError(
          "VALIDATION_FAILED",
          "This pipeline has no 'Lost' stage configured.",
        );
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
        throw new DealError("RECORD_NOT_FOUND", "Deal not found after update.");
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
        actor: await this.auditActor(session),
        action: "deal.lost",
        entityType: "deal",
        entityId: deal._id,
        entityLabel: deal.name,
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
        metadata: { reason },
        occurredAt,
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
