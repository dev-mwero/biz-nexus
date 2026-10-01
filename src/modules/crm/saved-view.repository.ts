import type { Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import {
  type SavedView,
  type SavedViewEntityType,
  SavedViewModel,
} from "./saved-view.model";

/**
 * Saved view repository.
 *
 * All queries are automatically scoped to the organisation by TenantRepository.
 */
export class SavedViewRepository extends TenantRepository<SavedView> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(SavedViewModel, organizationId, actorId);
  }

  /** Find all views for a user and entity type. */
  async findByUserAndEntityType(
    userId: Types.ObjectId | string,
    entityType: SavedViewEntityType,
  ) {
    return this.model
      .find(this.scope({ userId, entityType }))
      .sort({ createdAt: -1 })
      .lean<SavedView[]>()
      .exec();
  }

  /** Find a view by user, entity type, and name. */
  async findByUserEntityTypeAndName(
    userId: Types.ObjectId | string,
    entityType: SavedViewEntityType,
    name: string,
  ) {
    return this.findOne({ userId, entityType, name });
  }

  /** Find shared views for an entity type. */
  async findShared(entityType: SavedViewEntityType) {
    return this.model
      .find(this.scope({ entityType, isShared: true }))
      .sort({ name: 1 })
      .lean<SavedView[]>()
      .exec();
  }
}
