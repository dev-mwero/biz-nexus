import type { Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import {
  type Contact,
  ContactModel,
  type ContactStatus,
} from "./contact.model";

/**
 * Contact repository.
 *
 * All queries are automatically scoped to the organisation by TenantRepository.
 */
export class ContactRepository extends TenantRepository<Contact> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(ContactModel, organizationId, actorId);
  }

  /** Find contacts with filters, sorting, and pagination. */
  async findWithFilters(
    filters: {
      status?: ContactStatus;
      companyId?: Types.ObjectId | null;
      ownerId?: Types.ObjectId;
      tagIds?: Types.ObjectId[];
      q?: string;
      createdFrom?: Date;
      createdTo?: Date;
      hasEmail?: boolean;
    },
    options: { sort?: string; page?: number; pageSize?: number } = {},
  ) {
    const { sort = "lastName,firstName", page = 1, pageSize = 20 } = options;
    const filter = this.scope({});

    if (filters.status) filter.status = filters.status;
    if (filters.companyId !== undefined) filter.companyId = filters.companyId;
    if (filters.ownerId) filter.ownerId = filters.ownerId;
    if (filters.tagIds?.length) filter.tags = { $in: filters.tagIds };
    if (filters.hasEmail === true) filter.primaryEmail = { $ne: null };
    if (filters.hasEmail === false) filter.primaryEmail = null;

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
        .lean<Contact[]>()
        .exec(),
      this.model.countDocuments(filter).exec(),
    ]);

    return { items, total };
  }

  /** Find contacts belonging to a company. */
  async findByCompany(
    companyId: Types.ObjectId | string,
    options: { sort?: string; limit?: number } = {},
  ) {
    const { sort = "lastName,firstName", limit = 50 } = options;
    return this.model
      .find(this.scope({ companyId }))
      .sort(this.parseSort(sort))
      .limit(limit)
      .lean<Contact[]>()
      .exec();
  }

  /** Find a contact by primary email (for duplicate detection). */
  async findByPrimaryEmail(email: string) {
    return this.findOne({ primaryEmail: email.toLowerCase() });
  }

  /** Get contacts for a select/dropdown (id + name only). */
  async getForSelect() {
    return this.model
      .find(this.scope({}))
      .select({ _id: 1, firstName: 1, lastName: 1 })
      .sort({ lastName: 1, firstName: 1 })
      .lean<{ _id: Types.ObjectId; firstName: string; lastName: string }[]>()
      .exec();
  }

  /** Find merged contacts (where mergedIntoId is set). */
  async findMerged() {
    return this.model
      .find(this.scope({ mergedIntoId: { $ne: null } }))
      .lean<Contact[]>()
      .exec();
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
