import type { Types } from "mongoose";
import { AppError, type ErrorCode } from "@/shared/errors/app-error";
import { events } from "@/shared/events/bus";
import {
  type SavedView,
  type SavedViewEntityType,
  SavedViewModel,
} from "./saved-view.model";
import { SavedViewRepository } from "./saved-view.repository";

export class SavedViewError extends AppError {
  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(code, { message, cause: options?.cause });
    this.name = "SavedViewError";
  }
}

export interface CreateSavedViewInput {
  organizationId: Types.ObjectId;
  actorId: Types.ObjectId;
  userId: Types.ObjectId;
  entityType: SavedViewEntityType;
  name: string;
  filters?: Record<string, unknown>;
  sort?: string;
  columns?: Array<{ key: string; width?: number }>;
  isShared?: boolean;
}

export interface UpdateSavedViewInput {
  name?: string;
  filters?: Record<string, unknown>;
  sort?: string;
  columns?: Array<{ key: string; width?: number }>;
  isShared?: boolean;
}

/**
 * Saved view service.
 *
 * Filters are validated against the entity's list-query schema at write time.
 */
export class SavedViewService {
  private repo: SavedViewRepository;

  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    this.repo = new SavedViewRepository(organizationId, actorId);
  }

  /** Create a new saved view. */
  async create(input: CreateSavedViewInput): Promise<SavedView> {
    const existing = await this.repo.findByUserEntityTypeAndName(
      input.userId,
      input.entityType,
      input.name,
    );
    if (existing) {
      throw new SavedViewError(
        "SLUG_CONFLICT",
        `A view named "${input.name}" already exists.`,
      );
    }

    // Validate filters against entity schema (simplified for MVP)
    const validatedFilters = this.validateFilters(
      input.entityType,
      input.filters ?? {},
    );

    const savedView = await this.repo.create({
      userId: input.userId,
      entityType: input.entityType,
      name: input.name.trim(),
      filters: validatedFilters,
      sort: input.sort ?? "",
      columns: input.columns ?? [],
      isShared: input.isShared ?? false,
    });

    await events.emit("savedView.created", {
      organizationId: input.organizationId,
      savedViewId: savedView._id,
      entityType: input.entityType,
      name: savedView.name,
      actorId: input.actorId,
    });

    return savedView;
  }

  /** Update a saved view. */
  async update(
    savedViewId: Types.ObjectId | string,
    input: UpdateSavedViewInput,
    actorId: Types.ObjectId,
    requesterUserId: Types.ObjectId,
  ): Promise<SavedView> {
    const existing = await this.repo.findById(savedViewId);
    if (!existing) {
      throw new SavedViewError("RECORD_NOT_FOUND", "Saved view not found.");
    }

    // Only owner can update, unless shared and user has update permission (checked at API layer)
    if (!existing.userId.equals(requesterUserId) && !existing.isShared) {
      throw new SavedViewError(
        "INSUFFICIENT_PERMISSION",
        "Only the owner can update this view.",
      );
    }

    const changes: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== existing.name) {
      const nameConflict = await this.repo.findByUserEntityTypeAndName(
        existing.userId,
        existing.entityType,
        input.name,
      );
      if (nameConflict && !nameConflict._id.equals(existing._id)) {
        throw new SavedViewError(
          "SLUG_CONFLICT",
          `A view named "${input.name}" already exists.`,
        );
      }
      changes.name = input.name.trim();
    }
    if (input.filters !== undefined) {
      changes.filters = this.validateFilters(
        existing.entityType,
        input.filters,
      );
    }
    if (input.sort !== undefined) changes.sort = input.sort;
    if (input.columns !== undefined) changes.columns = input.columns;
    if (input.isShared !== undefined) changes.isShared = input.isShared;

    if (Object.keys(changes).length === 0) return existing;

    const updated = await this.repo.findByIdAndUpdate(savedViewId, {
      $set: changes,
    });
    if (!updated) {
      throw new SavedViewError(
        "RECORD_NOT_FOUND",
        "Saved view not found after update.",
      );
    }

    await events.emit("savedView.updated", {
      organizationId: this.repo.organizationId,
      savedViewId: existing._id,
      changes,
      actorId,
    });

    return updated;
  }

  /** Delete a saved view. */
  async delete(
    savedViewId: Types.ObjectId | string,
    actorId: Types.ObjectId,
    requesterUserId: Types.ObjectId,
  ): Promise<void> {
    const existing = await this.repo.findById(savedViewId);
    if (!existing) {
      throw new SavedViewError("RECORD_NOT_FOUND", "Saved view not found.");
    }

    if (!existing.userId.equals(requesterUserId)) {
      throw new SavedViewError(
        "INSUFFICIENT_PERMISSION",
        "Only the owner can delete this view.",
      );
    }

    await this.repo.softDeleteById(savedViewId);

    await events.emit("savedView.deleted", {
      organizationId: this.repo.organizationId,
      savedViewId: existing._id,
      actorId,
    });
  }

  /** List saved views for a user and entity type. */
  async listByUser(
    userId: Types.ObjectId | string,
    entityType: SavedViewEntityType,
  ): Promise<SavedView[]> {
    return this.repo.findByUserAndEntityType(userId, entityType);
  }

  /** List shared views for an entity type. */
  async listShared(entityType: SavedViewEntityType): Promise<SavedView[]> {
    return this.repo.findShared(entityType);
  }

  /** Get a saved view by ID. */
  async getById(id: Types.ObjectId | string): Promise<SavedView | null> {
    return this.repo.findById(id);
  }

  /** Validate filters against the entity's allowed filter keys. */
  private validateFilters(
    entityType: SavedViewEntityType,
    filters: Record<string, unknown>,
  ): Record<string, unknown> {
    // Allowed filter keys per entity type (from API.md §8)
    const allowedFilters: Record<SavedViewEntityType, string[]> = {
      CONTACT: [
        "status",
        "companyId",
        "ownerId",
        "tag",
        "createdFrom",
        "createdTo",
        "hasEmail",
      ],
      COMPANY: [
        "status",
        "industry",
        "ownerId",
        "tag",
        "createdFrom",
        "createdTo",
      ],
      LEAD: [
        "status",
        "source",
        "ownerId",
        "scoreMin",
        "scoreMax",
        "createdFrom",
        "createdTo",
      ],
      DEAL: [
        "status",
        "pipelineId",
        "stageId",
        "companyId",
        "contactId",
        "ownerId",
        "valueMin",
        "valueMax",
        "closingFrom",
        "closingTo",
        "tag",
      ],
      TASK: [
        "status",
        "priority",
        "assigneeId",
        "dueFrom",
        "dueTo",
        "overdue",
        "relatedEntityType",
        "relatedEntityId",
      ],
    };

    const allowed = allowedFilters[entityType] ?? [];
    const validated: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(filters)) {
      if (allowed.includes(key)) {
        validated[key] = value;
      }
      // Unknown filters are silently dropped (could also throw)
    }

    return validated;
  }
}
