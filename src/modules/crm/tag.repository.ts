import type { QueryOptions, Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import { type Tag, TagModel } from "./tag.model";

/**
 * Tag repository.
 *
 * All queries are automatically scoped to the organisation by TenantRepository.
 */
export class TagRepository extends TenantRepository<Tag> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(TagModel, organizationId, actorId);
  }

  /** Find by name (case-insensitive) within the organisation. */
  async findByName(name: string) {
    return this.findOne({ name: { $regex: new RegExp(`^${name}$`, "i") } });
  }

  /** Search tags by name prefix. */
  async searchByName(query: string, limit = 20) {
    return this.model
      .find(this.scope({ name: { $regex: `^${query}`, $options: "i" } }))
      .sort({ usageCount: -1, name: 1 })
      .limit(limit)
      .lean<Tag[]>()
      .exec();
  }

  /** Get tags sorted by usage count (most used first). */
  async getPopular(limit = 20) {
    return this.model
      .find(this.scope({}))
      .sort({ usageCount: -1, name: 1 })
      .limit(limit)
      .lean<Tag[]>()
      .exec();
  }

  /** Increment usage count. */
  async incrementUsage(tagId: Types.ObjectId | string, delta: number) {
    return this.updateOne({ _id: tagId }, { $inc: { usageCount: delta } });
  }

  /** Find tags by IDs. */
  findByIds(ids: (Types.ObjectId | string)[], options?: QueryOptions<Tag>) {
    return super.findByIds(ids, options);
  }
}
