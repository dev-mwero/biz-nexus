import type { Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import { AppError, type ErrorCode } from "@/shared/errors/app-error";
import { events } from "@/shared/events/bus";
import { type Tag, type TagColor, TagModel } from "./tag.model";
import { TagRepository } from "./tag.repository";

export class TagError extends AppError {
  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(code, { message, cause: options?.cause });
    this.name = "TagError";
  }
}

export interface CreateTagInput {
  organizationId: Types.ObjectId;
  actorId: Types.ObjectId;
  name: string;
  color?: TagColor;
}

export interface UpdateTagInput {
  name?: string;
  color?: TagColor;
}

export interface MergeTagsInput {
  organizationId: Types.ObjectId;
  actorId: Types.ObjectId;
  sourceTagId: Types.ObjectId;
  targetTagId: Types.ObjectId;
}

/**
 * Tag service.
 *
 * Business logic for tags: create, update, delete, merge.
 * Usage counts are denormalised and maintained by the service.
 */
export class TagService {
  private repo: TagRepository;

  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    this.repo = new TagRepository(organizationId, actorId);
  }

  /** Create a new tag. */
  async create(input: CreateTagInput): Promise<Tag> {
    const existing = await this.repo.findByName(input.name);
    if (existing) {
      throw new TagError(
        "SLUG_CONFLICT",
        `A tag named "${input.name}" already exists.`,
      );
    }

    const tag = await this.repo.create({
      name: input.name.trim(),
      color: input.color ?? "slate",
      usageCount: 0,
    });

    await events.emit("tag.created", {
      organizationId: input.organizationId,
      tagId: tag._id,
      name: tag.name,
      actorId: input.actorId,
    });

    return tag;
  }

  /** Update a tag. */
  async update(
    tagId: Types.ObjectId | string,
    input: UpdateTagInput,
    actorId: Types.ObjectId,
  ): Promise<Tag> {
    const tag = await this.repo.findById(tagId);
    if (!tag) {
      throw new TagError("RECORD_NOT_FOUND", "Tag not found.");
    }

    // Check name uniqueness if changing
    if (input.name && input.name !== tag.name) {
      const existing = await this.repo.findByName(input.name);
      if (existing && !existing._id.equals(tag._id)) {
        throw new TagError(
          "SLUG_CONFLICT",
          `A tag named "${input.name}" already exists.`,
        );
      }
    }

    const changes: Record<string, unknown> = {};
    if (input.name !== undefined && input.name !== tag.name) {
      changes.name = input.name;
    }
    if (input.color !== undefined && input.color !== tag.color) {
      changes.color = input.color;
    }

    if (Object.keys(changes).length === 0) return tag;

    const updated = await this.repo.findByIdAndUpdate(tagId, { $set: changes });
    if (!updated) {
      throw new TagError("RECORD_NOT_FOUND", "Tag not found after update.");
    }

    await events.emit("tag.updated", {
      organizationId: this.repo.organizationId,
      tagId: tag._id,
      changes,
      actorId,
    });

    return updated;
  }

  /** Soft delete a tag. */
  async delete(
    tagId: Types.ObjectId | string,
    actorId: Types.ObjectId,
  ): Promise<void> {
    const tag = await this.repo.findById(tagId);
    if (!tag) {
      throw new TagError("RECORD_NOT_FOUND", "Tag not found.");
    }

    if (tag.usageCount > 0) {
      throw new TagError(
        "VALIDATION_FAILED",
        "Cannot delete a tag that is in use. Merge it first.",
      );
    }

    await this.repo.softDeleteById(tagId);

    await events.emit("tag.deleted", {
      organizationId: this.repo.organizationId,
      tagId: tag._id,
      actorId,
    });
  }

  /** Merge two tags: move all references from source to target, then delete source. */
  async merge(
    input: MergeTagsInput,
  ): Promise<{ targetTag: Tag; movedCount: number }> {
    return withTransaction(async (session) => {
      const [sourceTag, targetTag] = await Promise.all([
        this.repo.findById(input.sourceTagId),
        this.repo.findById(input.targetTagId),
      ]);

      if (!sourceTag || !targetTag) {
        throw new TagError("RECORD_NOT_FOUND", "One or both tags not found.");
      }
      if (sourceTag._id.equals(targetTag._id)) {
        throw new TagError(
          "VALIDATION_FAILED",
          "Cannot merge a tag into itself.",
        );
      }

      // Update all entities referencing the source tag
      const { ContactModel } = await import("./contact.model");
      const { CompanyModel } = await import("./company.model");
      const { LeadModel } = await import("./lead.model");
      const { DealModel } = await import("@/modules/deals/deal.model").catch(
        () => ({ DealModel: null as any }),
      );
      const { TaskModel } = await import("@/modules/tasks/task.model").catch(
        () => ({ TaskModel: null as any }),
      );

      interface ModelWithTags {
        updateMany: (
          filter: Record<string, unknown>,
          update: Record<string, unknown>,
          options: { session: any },
        ) => Promise<{ modifiedCount: number }>;
      }

      const modelsToUpdate: Array<{ model: ModelWithTags; field: string }> = [
        { model: ContactModel, field: "tags" },
        { model: CompanyModel, field: "tags" },
        { model: LeadModel, field: "tags" },
      ];

      if (DealModel) modelsToUpdate.push({ model: DealModel, field: "tags" });
      if (TaskModel) modelsToUpdate.push({ model: TaskModel, field: "tags" });

      let totalMoved = 0;
      for (const { model, field } of modelsToUpdate) {
        const result = await model.updateMany(
          { organizationId: input.organizationId, [field]: input.sourceTagId },
          {
            $pull: { [field]: input.sourceTagId },
            $addToSet: { [field]: input.targetTagId },
          },
          { session },
        );
        totalMoved += result.modifiedCount;
      }

      // Update usage counts
      await this.repo.incrementUsage(input.targetTagId, sourceTag.usageCount);
      await this.repo.incrementUsage(input.sourceTagId, -sourceTag.usageCount);

      // Soft delete source tag
      await this.repo.softDeleteById(input.sourceTagId);

      const updatedTarget = await this.repo.findById(input.targetTagId);
      if (!updatedTarget) {
        throw new TagError(
          "RECORD_NOT_FOUND",
          "Target tag not found after merge.",
        );
      }

      await events.emit("tag.merged", {
        organizationId: input.organizationId,
        sourceTagId: input.sourceTagId,
        targetTagId: input.targetTagId,
        actorId: input.actorId,
      });

      return { targetTag: updatedTarget, movedCount: totalMoved };
    });
  }

  /** List all tags. */
  async list(): Promise<Tag[]> {
    return this.repo.find({}).sort({ name: 1 }).lean<Tag[]>().exec();
  }

  /** Get a tag by ID. */
  async getById(id: Types.ObjectId | string): Promise<Tag | null> {
    return this.repo.findById(id);
  }

  /** Search tags by name prefix. */
  async search(query: string, limit = 20): Promise<Tag[]> {
    return this.repo.searchByName(query, limit);
  }

  /** Get popular tags by usage count. */
  async getPopular(limit = 20): Promise<Tag[]> {
    return this.repo.getPopular(limit);
  }

  /** Bulk create tags (for seeding/import). */
  async bulkCreate(
    tags: Array<{ name: string; color?: TagColor }>,
    actorId: Types.ObjectId,
  ): Promise<Tag[]> {
    const created: Tag[] = [];
    for (const tag of tags) {
      try {
        const created_tag = await this.create({
          organizationId: this.repo.organizationId,
          actorId,
          name: tag.name,
          color: tag.color,
        });
        created.push(created_tag);
      } catch (error) {
        // Skip duplicates in bulk create
        if (error instanceof TagError && error.code === "SLUG_CONFLICT")
          continue;
        throw error;
      }
    }
    return created;
  }
}
