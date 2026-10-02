import { Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import {
  type Deal,
  DealModel,
  type DealStatus,
} from "@/modules/deals/deal.model";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";

/**
 * Repository for deal operations.
 *
 * All operations are scoped to the organizationId provided at construction.
 */
export class DealRepository extends TenantRepository<Deal> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(DealModel, organizationId, actorId);
  }

  /**
   * Find deals with filters, pagination, and sorting.
   */
  findDeals(
    filter: Record<string, unknown> = {},
    options: {
      sort?: Record<string, 1 | -1>;
      limit?: number;
      skip?: number;
      projection?: Record<string, unknown>;
    } = {},
  ) {
    const { sort = { createdAt: -1 }, limit, skip, projection } = options;
    return this.find(filter, projection, { sort, limit, skip }).lean();
  }

  /**
   * Count deals matching a filter.
   */
  countDeals(filter: Record<string, unknown> = {}) {
    return this.countDocuments(filter);
  }

  /**
   * Find a deal by ID, lean.
   *
   * Named rather than overriding `findById`. The override was reading as a
   * convenience and was in fact a stack overflow: it shadowed the base method
   * and called `this.findById`, which resolved to itself, so every read of a
   * deal recursed until the process died. The base implementation stays the
   * single one that applies the tenant scope and the foreign-id-returns-null
   * rule; this only adds `.lean()` for callers that want a plain object.
   */
  async findDealById(id: Types.ObjectId | string): Promise<Deal | null> {
    return this.findById(id).lean<Deal | null>().exec();
  }

  /**
   * Create a new deal.
   *
   * Applies the column defaults the schema cannot infer from an absent field,
   * then delegates to the base writer so the scope and the author stamps stay in
   * one place. `super.create`, not `this.create`, for the same reason as
   * `findById` above.
   */
  create(input: {
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
    sortOrder?: number;
    tags?: (Types.ObjectId | string)[];
    customFields?: Record<string, unknown>;
  }): ReturnType<TenantRepository<Deal>["create"]> {
    const status: DealStatus = "OPEN";
    const toObjectId = (id: Types.ObjectId | string) =>
      id instanceof Types.ObjectId ? id : new Types.ObjectId(id);

    return super.create({
      name: input.name,
      companyId: input.companyId ? toObjectId(input.companyId) : null,
      contactId: input.contactId ? toObjectId(input.contactId) : null,
      pipelineId: toObjectId(input.pipelineId),
      stageId: toObjectId(input.stageId),
      ownerId: toObjectId(input.ownerId),
      value: input.value ?? 0,
      currency: input.currency ?? "USD",
      probability: input.probability ?? 0,
      status,
      expectedCloseDate: input.expectedCloseDate ?? null,
      closedAt: null,
      lostReason: null,
      description: input.description ?? null,
      sortOrder: input.sortOrder ?? 0,
      tags: input.tags?.map(toObjectId) ?? [],
      customFields: input.customFields ?? {},
    });
  }

  /**
   * Update a deal.
   */
  update(id: Types.ObjectId | string, update: Record<string, unknown>) {
    return this.findByIdAndUpdate(id, { $set: update });
  }

  /**
   * Move a deal to a new stage with a new sort order.
   * Returns the updated deal.
   */
  async move(
    id: Types.ObjectId | string,
    stageId: Types.ObjectId | string,
    sortOrder: number,
  ): Promise<Deal | null> {
    return this.findByIdAndUpdate(
      id,
      { $set: { stageId, sortOrder, updatedBy: this.actorId } },
      { returnDocument: "after" },
    );
  }

  /**
   * Update deal status (WON/LOST) with closedAt and lostReason.
   */
  async updateStatus(
    id: Types.ObjectId | string,
    status: DealStatus,
    closedAt: Date,
    lostReason?: string | null,
  ): Promise<Deal | null> {
    return this.findByIdAndUpdate(
      id,
      {
        $set: {
          status,
          closedAt,
          lostReason: lostReason ?? null,
          updatedBy: this.actorId,
        },
      },
      { returnDocument: "after" },
    );
  }

  /**
   * Get deals for a Kanban board - optimized for virtualized columns.
   * Accepts optional stageId to fetch a single column.
   */
  async getKanbanDeals(
    pipelineId: Types.ObjectId | string,
    stageId?: Types.ObjectId | string,
  ) {
    const filter: Record<string, unknown> = {
      pipelineId,
      status: "OPEN",
    };
    if (stageId) {
      filter.stageId = stageId;
    }
    return this.findDeals(filter, { sort: { sortOrder: 1, createdAt: 1 } });
  }

  /**
   * Get the next sortOrder for a deal in a stage (append to end).
   */
  async getNextSortOrder(
    pipelineId: Types.ObjectId | string,
    stageId: Types.ObjectId | string,
  ): Promise<number> {
    const maxDeal = await this.model
      .findOne(
        this.scope({ pipelineId, stageId, status: "OPEN" } as never),
        { sortOrder: 1 },
        { sort: { sortOrder: -1 } },
      )
      .lean();
    return (maxDeal?.sortOrder ?? -1) + 1;
  }

  /**
   * Get deal summary statistics for a pipeline.
   */
  async getPipelineSummary(pipelineId: Types.ObjectId | string) {
    return this.model
      .aggregate([
        { $match: this.scope({ pipelineId, deletedAt: null } as never) },
        {
          $group: {
            _id: { stageId: "$stageId", status: "$status" },
            count: { $sum: 1 },
            totalValue: { $sum: "$value" },
          },
        },
      ])
      .exec();
  }

  /**
   * Get deals for dashboard/forecast (open deals with expected close date).
   */
  async getOpenDealsForForecast() {
    return this.findDeals(
      { status: "OPEN", expectedCloseDate: { $ne: null } },
      { sort: { expectedCloseDate: 1 } },
    );
  }
}
