import { Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import {
  type Company,
  CompanyModel,
  type CompanyStatus,
} from "./company.model";
import { ContactModel } from "./contact.model";

/**
 * Company repository.
 *
 * All queries are automatically scoped to the organisation by TenantRepository.
 */
export class CompanyRepository extends TenantRepository<Company> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(CompanyModel, organizationId, actorId);
  }

  /** Find companies with filters, sorting, and pagination. */
  async findWithFilters(
    filters: {
      status?: CompanyStatus;
      ownerId?: Types.ObjectId;
      tagIds?: Types.ObjectId[];
      q?: string;
      parentId?: Types.ObjectId | null;
    },
    options: { sort?: string; page?: number; pageSize?: number } = {},
  ) {
    const { sort = "-createdAt", page = 1, pageSize = 20 } = options;
    const filter = this.scope({});

    if (filters.status) filter.status = filters.status;
    if (filters.ownerId) filter.ownerId = filters.ownerId;
    if (filters.parentId !== undefined) filter.parentId = filters.parentId;
    if (filters.tagIds?.length) filter.tags = { $in: filters.tagIds };

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
        .lean<Company[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }

  /** Find a company by domain (for auto-association). */
  async findByDomain(domain: string) {
    return this.findOne({ domain: domain.toLowerCase() });
  }

  /** Find children of a parent company. */
  async findChildren(parentId: Types.ObjectId | string) {
    return this.model
      .find(this.scope({ parentId }))
      .sort({ name: 1 })
      .lean<Company[]>()
      .exec();
  }

  /** Get companies for a select/dropdown (id + name only). */
  async getForSelect() {
    return this.model
      .find(this.scope({}))
      .select({ _id: 1, name: 1 })
      .sort({ name: 1 })
      .lean<{ _id: Types.ObjectId; name: string }[]>()
      .exec();
  }

  /**
   * Get contact count for a single company.
   * Includes contacts directly assigned to this company.
   */
  async getContactCount(companyId: Types.ObjectId | string): Promise<number> {
    return ContactModel.countDocuments({
      organizationId: this.organizationId,
      companyId,
      deletedAt: null,
    }).exec();
  }

  /**
   * Get contact counts for multiple companies (bulk).
   * Returns a map of companyId -> contactCount.
   */
  async getContactCounts(
    companyIds: (Types.ObjectId | string)[],
  ): Promise<Map<string, number>> {
    if (companyIds.length === 0) return new Map();

    const objectIds = companyIds.map((id) =>
      typeof id === "string" ? new Types.ObjectId(id) : id,
    );

    const results = await ContactModel.aggregate([
      {
        $match: {
          organizationId: this.organizationId,
          companyId: { $in: objectIds },
          deletedAt: null,
        },
      },
      {
        $group: {
          _id: "$companyId",
          count: { $sum: 1 },
        },
      },
    ]).exec();

    const map = new Map<string, number>();
    for (const r of results) {
      map.set(r._id.toString(), r.count);
    }
    return map;
  }

  /**
   * Get contact count including all descendant companies in the hierarchy.
   * Walks the tree recursively to sum contacts at all levels.
   */
  async getContactCountWithDescendants(
    companyId: Types.ObjectId | string,
  ): Promise<number> {
    const allCompanyIds = await this.getAllDescendantIds(companyId);
    allCompanyIds.push(
      typeof companyId === "string" ? new Types.ObjectId(companyId) : companyId,
    );

    const map = await this.getContactCounts(allCompanyIds);
    let total = 0;
    for (const count of map.values()) {
      total += count;
    }
    return total;
  }

  /**
   * Get all descendant company IDs recursively.
   * Returns array of ObjectIds (including nested children).
   */
  async getAllDescendantIds(
    parentId: Types.ObjectId | string,
  ): Promise<Types.ObjectId[]> {
    const descendants: Types.ObjectId[] = [];
    const toProcess: Types.ObjectId[] = [
      typeof parentId === "string" ? new Types.ObjectId(parentId) : parentId,
    ];

    while (toProcess.length > 0) {
      const currentId = toProcess.pop()!;
      const children = await this.model
        .find(this.scope({ parentId: currentId }))
        .select({ _id: 1 })
        .lean<{ _id: Types.ObjectId }[]>()
        .exec();

      for (const child of children) {
        descendants.push(child._id);
        toProcess.push(child._id);
      }
    }

    return descendants;
  }

  /**
   * Get full hierarchy path from root to this company.
   * Returns array from root ancestor down to the company.
   */
  async getHierarchyPath(
    companyId: Types.ObjectId | string,
  ): Promise<Company[]> {
    const path: Company[] = [];
    let current = await this.findById(companyId);
    while (current) {
      path.unshift(current);
      if (current.parentId) {
        current = await this.findById(current.parentId);
      } else {
        break;
      }
    }
    return path;
  }

  /**
   * Get root ancestor of a company.
   */
  async getRootAncestor(
    companyId: Types.ObjectId | string,
  ): Promise<Company | null> {
    let current = await this.findById(companyId);
    while (current?.parentId) {
      current = await this.findById(current.parentId);
    }
    return current ?? null;
  }

  /**
   * Check if a company is an ancestor of another.
   */
  async isAncestorOf(
    potentialAncestorId: Types.ObjectId | string,
    companyId: Types.ObjectId | string,
  ): Promise<boolean> {
    const ancestorId =
      typeof potentialAncestorId === "string"
        ? new Types.ObjectId(potentialAncestorId)
        : potentialAncestorId;
    let current = await this.findById(companyId);
    while (current) {
      if (current._id.equals(ancestorId)) return true;
      if (!current.parentId) break;
      current = await this.findById(current.parentId);
    }
    return false;
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
