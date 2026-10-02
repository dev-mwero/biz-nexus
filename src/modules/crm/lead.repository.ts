import type { PipelineStage, Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import {
  LEAD_STATUSES,
  type Lead,
  LeadModel,
  type LeadStatus,
} from "./lead.model";

/**
 * Lead repository.
 *
 * All queries are automatically scoped to the organisation by TenantRepository.
 */
export class LeadRepository extends TenantRepository<Lead> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(LeadModel, organizationId, actorId);
  }

  /** Find leads with filters, sorting, and pagination. */
  async findWithFilters(
    filters: {
      status?: LeadStatus;
      source?: string;
      ownerId?: Types.ObjectId;
      scoreMin?: number;
      scoreMax?: number;
      q?: string;
      createdFrom?: Date;
      createdTo?: Date;
    },
    options: { sort?: string; page?: number; pageSize?: number } = {},
  ) {
    const { sort = "-createdAt", page = 1, pageSize = 20 } = options;
    const filter = this.scope({});

    if (filters.status) filter.status = filters.status;
    if (filters.source) filter.source = filters.source;
    if (filters.ownerId) filter.ownerId = filters.ownerId;
    if (filters.scoreMin !== undefined || filters.scoreMax !== undefined) {
      filter.score = {};
      if (filters.scoreMin !== undefined)
        (filter.score as Record<string, number>).$gte = filters.scoreMin;
      if (filters.scoreMax !== undefined)
        (filter.score as Record<string, number>).$lte = filters.scoreMax;
    }

    if (filters.createdFrom || filters.createdTo) {
      filter.createdAt = {};
      if (filters.createdFrom)
        (filter.createdAt as Record<string, Date>).$gte = filters.createdFrom;
      if (filters.createdTo)
        (filter.createdAt as Record<string, Date>).$lte = filters.createdTo;
    }

    // Text search
    if (filters.q?.trim()) {
      const escaped = filters.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      filter.$text = { $search: escaped };
    }

    const [items, total] = await Promise.all([
      this.model
        .find(filter)
        .sort(this.parseSort(sort))
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .lean<Lead[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }

  /** Find a lead by ID that hasn't been converted yet. */
  async findUnconvertedById(id: Types.ObjectId | string) {
    return this.findOne({ _id: id, status: { $ne: "CONVERTED" } });
  }

  /** Get leads for a select/dropdown (id + title only). */
  async getForSelect() {
    return this.model
      .find(this.scope({ status: { $ne: "CONVERTED" } }))
      .select({ _id: 1, title: 1 })
      .sort({ createdAt: -1 })
      .lean<{ _id: Types.ObjectId; title: string }[]>()
      .exec();
  }

  /**
   * Get lead counts by status (status funnel).
   * Returns an object with counts for each status.
   */
  async getStatusFunnel(): Promise<Record<LeadStatus, number>> {
    const pipeline: PipelineStage[] = [
      { $match: this.scope({}) },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ];

    const results = await this.model.aggregate(pipeline).exec();

    const funnel: Record<LeadStatus, number> = {
      NEW: 0,
      CONTACTED: 0,
      QUALIFIED: 0,
      UNQUALIFIED: 0,
      CONVERTED: 0,
      LOST: 0,
    };

    for (const r of results) {
      if (LEAD_STATUSES.includes(r._id as LeadStatus)) {
        funnel[r._id as LeadStatus] = r.count;
      }
    }

    return funnel;
  }

  /**
   * Get lead counts by source and status (source funnel).
   * Returns array of { source, status, count }.
   */
  async getSourceFunnel(): Promise<
    Array<{ source: string; status: LeadStatus; count: number }>
  > {
    const pipeline: PipelineStage[] = [
      { $match: this.scope({}) },
      {
        $group: {
          _id: { source: "$source", status: "$status" },
          count: { $sum: 1 },
        },
      },
      { $sort: { "_id.source": 1, "_id.status": 1 } },
    ];

    const results = await this.model.aggregate(pipeline).exec();

    return results.map((r) => ({
      source: r._id.source,
      status: r._id.status as LeadStatus,
      count: r.count,
    }));
  }

  /**
   * Get lead conversion rate (converted / total).
   */
  async getConversionRate(): Promise<{
    converted: number;
    total: number;
    rate: number;
  }> {
    const [converted, total] = await Promise.all([
      this.model.countDocuments(this.scope({ status: "CONVERTED" })).exec(),
      this.model.countDocuments(this.scope({})).exec(),
    ]);

    return {
      converted,
      total,
      rate: total > 0 ? converted / total : 0,
    };
  }

  private parseSort(sort: string): Record<string, 1 | -1> {
    const result: Record<string, 1 | -1> = {};
    for (const part of sort.split(",")) {
      const trimmed = part.trim();
      if (trimmed.startsWith("-")) {
        result[trimmed.slice(1)] = -1;
      } else {
        result[trimmed] = 1;
      }
    }
    return result;
  }
}
