import type { Model, QueryOptions, Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import { type Tag, TagModel } from "./tag.model";

/**
 * Derived from the model rather than imported, for the reason
 * `tenant-repository.ts` gives: `mongoose` exports no `UpdateOptions` at
 * runtime, and a hand-written options type drifts from the one the driver
 * actually accepts — quietly, because a narrower type still compiles.
 */
type UpdateOptionsOf<T> = NonNullable<Parameters<Model<T>["updateOne"]>[2]>;

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

  /**
   * Increment usage count.
   *
   * The options parameter is not decoration. Called from inside a transaction
   * during a tag merge, it is what keeps the `$inc` inside that transaction —
   * dropped, the count commits even if the merge around it aborts, and the
   * count drifts from the rows that actually carry the tag.
   */
  async incrementUsage(
    tagId: Types.ObjectId | string,
    delta: number,
    options?: UpdateOptionsOf<Tag>,
  ) {
    return this.updateOne(
      { _id: tagId },
      { $inc: { usageCount: delta } },
      options,
    );
  }

  /** Find tags by IDs. */
  findByIds(ids: (Types.ObjectId | string)[], options?: QueryOptions<Tag>) {
    return super.findByIds(ids, options);
  }
}
