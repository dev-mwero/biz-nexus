import type { QueryOptions, Types } from "mongoose";
import { TenantRepository } from "@/db/tenant-repository";
import {
  type FieldDefinition,
  FieldDefinitionModel,
  type FieldEntityType,
} from "./field-definition.model";

/**
 * Field definition repository.
 *
 * All queries are automatically scoped to the organisation by TenantRepository.
 */
export class FieldDefinitionRepository extends TenantRepository<FieldDefinition> {
  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    super(FieldDefinitionModel, organizationId, actorId);
  }

  /** Find all definitions for an entity type, ordered by display order. */
  async findByEntityType(entityType: FieldEntityType) {
    return this.model
      .find(this.scope({ entityType }))
      .sort({ order: 1, key: 1 })
      .lean<FieldDefinition[]>()
      .exec();
  }

  /** Find a definition by entity type and key. */
  async findByEntityTypeAndKey(entityType: FieldEntityType, key: string) {
    return this.findOne({ entityType, key });
  }

  /** Find definitions by IDs. */
  findByIds(
    ids: (Types.ObjectId | string)[],
    options?: QueryOptions<FieldDefinition>,
  ) {
    return super.findByIds(ids, options);
  }
}
