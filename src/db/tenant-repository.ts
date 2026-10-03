import {
  type Model,
  type PipelineStage,
  type QueryFilter,
  type QueryOptions,
  Types,
} from "mongoose";
import { hasAuditFields } from "@/db/mixins/audit-fields";
import { isSoftDeleteSchema } from "@/db/mixins/soft-delete";

/**
 * The tenant scope, and the only place in the application that decides it.
 *
 * MongoDB has no row-level security. Every query in this database is
 * cross-tenant unless something stops it, and a query that omits
 * `organizationId` does not fail — it returns another customer's names,
 * emails, notes and deal values, silently, and no test notices unless someone
 * wrote a test for that exact call.
 *
 * The defence is to make the mistake unexpressible rather than merely
 * discouraged. `organizationId` is captured once, in the constructor, from the
 * session's active organisation, and merged into every filter this class
 * issues. It is not a parameter to any method, so no call site can omit it,
 * pass the wrong one, or override it. See ADR-0003.
 *
 * The corollary matters as much: the correct code is the short code.
 * `repo.findById(id)` is shorter than `Company.findOne({ _id: id, organizationId })`,
 * so the secure path is also the lazy one. Security that costs extra effort
 * under deadline does not survive a deadline.
 */

/** The shape every tenant-owned document has. */
export type TenantDocument = {
  organizationId: Types.ObjectId;
};

/**
 * A filter with the scope removed from the caller's reach.
 *
 * The `& { organizationId?: never }` is doing the work, and it is there because
 * the obvious version does not. `Omit<QueryFilter<T>, "organizationId">` alone
 * looks correct and enforces nothing: Mongoose's `QueryFilter` carries a string
 * index signature, so `string extends keyof QueryFilter<T>` is true, `Omit`
 * cannot remove a key from an index signature, and every one of these compiles
 * clean:
 *
 *   repo.find({ organizationId: otherOrg })
 *   repo.find({ name: "x", organizationId: otherOrg })
 *   repo.find({ organizationId: { $ne: org } })
 *
 * Intersecting with `never` pins the one key that matters even where the index
 * signature would otherwise admit it. A type test using `@ts-expect-error`
 * enforces it, so a future Mongoose change that loosens this fails
 * `npm run typecheck` rather than passing review.
 *
 * Narrowing the type is not redundant with merging at runtime.
 * `{ ...filter, organizationId: this.org }` already wins over anything a caller
 * passed, so a caller-supplied `organizationId` would be ignored — but
 * silently. Ignoring a value someone wrote is its own bug, because the code
 * reads as though it worked.
 */
export type ScopedFilter<T> = Omit<QueryFilter<T>, "organizationId"> & {
  organizationId?: never;
};

/**
 * Write input with everything the repository manages removed.
 *
 * `deletedAt` is the field that makes this list worth writing down. The first
 * version omitted only `organizationId`, `_id` and the timestamps, so a model
 * carrying the audit and soft-delete mixins required the caller to supply
 * `createdBy`, `updatedBy` and `deletedAt` — the exact fields the repository
 * stamps. The failure is a compile error rather than a leak, but the fix is to
 * be asked for something you are given, which trains a caller to satisfy the
 * signature with a literal that is then overwritten.
 *
 * `deletedAt` stays available and optional: an import replaying historical rows
 * needs to say that some of them were already deleted, and Mongoose's default
 * covers the common case of a live row.
 */
const REPOSITORY_MANAGED = [
  "organizationId",
  "_id",
  "createdAt",
  "updatedAt",
  "createdBy",
  "updatedBy",
  "deletedAt",
] as const;

export type TenantCreateInput<T extends TenantDocument> = Omit<
  T,
  (typeof REPOSITORY_MANAGED)[number]
> &
  (T extends { deletedAt?: infer D } ? { deletedAt?: D } : unknown);

export type OrganizationRef = Types.ObjectId | string;

/**
 * Option and update types taken from the driver signatures rather than named
 * imports. Mongoose 9 splits them per operation — `QueryOptions` for reads,
 * `UpdateOptions` for writes, and the two differ in ways that matter, such as
 * whether `session` accepts null. Deriving them means a future version cannot
 * silently widen a signature this module is relying on.
 */
type UpdateOf<T> = Parameters<Model<T>["updateOne"]>[1];
type UpdateOptionsOf<T> = NonNullable<Parameters<Model<T>["updateOne"]>[2]>;
type ManyUpdateOptionsOf<T> = NonNullable<
  Parameters<Model<T>["updateMany"]>[2]
>;
type FindOneAndUpdateOptionsOf<T> = NonNullable<
  Parameters<Model<T>["findOneAndUpdate"]>[2]
>;
type DeleteOptionsOf<T> = NonNullable<Parameters<Model<T>["deleteOne"]>[1]>;

function toObjectId(
  organizationId: OrganizationRef,
  context: string,
): Types.ObjectId {
  if (organizationId instanceof Types.ObjectId) return organizationId;
  try {
    return new Types.ObjectId(organizationId);
  } catch {
    throw new Error(
      `${context} received an invalid organizationId: ${JSON.stringify(String(organizationId))}`,
    );
  }
}

/**
 * Schema validation, on for every update this class issues.
 *
 * Mongoose validates a document on `create` and on `save`, and validates
 * nothing on an update unless it is asked to. The result is that every
 * constraint declared on every schema in this application — `value: { min: 0 }`,
 * `probability: { max: 100 }`, `name: { minlength: 1, maxlength: 160 }` — is
 * enforced the first time a record comes in and silently ignored the second time
 * it comes in through a different door. `PATCH /api/v1/deals/:id` took
 * `value: -5` and `probability: 999` while `POST` refused both, and the 999 then
 * went on to `getOpenDealsForForecast` and the dashboard, weighting a forecast
 * beyond anything the schema permits. Nothing fails, so nothing is noticed.
 *
 * Forced on rather than offered as an option. An option is one omission away
 * from being off again, and the omission is invisible in review because an
 * unvalidated write looks exactly like a validated one. The three update
 * methods spread this *after* the caller's options for the same reason: a
 * caller passing `runValidators: false` must not be able to reopen the hole this
 * closes.
 *
 * A caller that genuinely cannot satisfy its own schema is a bug to report, not
 * a reason to add an escape hatch — the alternative is a flag whose one known
 * user would be the bug being fixed.
 *
 * This does constrain one existing write: `TagRepository.incrementUsage` sends a
 * server-computed `$inc`, and Mongoose 9 runs update validators over `$set` and
 * `$push` but not over the target path of an `$inc`, so the count it maintains
 * is unaffected. That was checked against
 * `mongoose/lib/helpers/updateValidators.js` rather than assumed.
 */
const VALIDATE_UPDATES = { runValidators: true } as const;

export abstract class TenantRepository<T extends TenantDocument> {
  readonly organizationId: Types.ObjectId;

  /**
   * The user making the request, used only to stamp `createdBy`/`updatedBy`.
   *
   * Optional because not every operation has a user behind it: a migration, a
   * scheduled job, a seed script. Those write without an author rather than
   * writing a misleading one.
   */
  readonly actorId: Types.ObjectId | null;

  constructor(
    protected readonly model: Model<T>,
    organizationId: OrganizationRef,
    actorId?: OrganizationRef | null,
  ) {
    // Validated here rather than left to Mongoose. A blank id reaches MongoDB
    // as a cast error at query time, or worse, as a filter that matches
    // nothing and reads like "this organisation has no contacts". Failing at
    // construction puts the mistake in the first stack trace, on the request
    // that caused it, instead of in a user's empty list.
    if (
      organizationId === "" ||
      organizationId === null ||
      organizationId === undefined
    ) {
      throw new Error(
        `${this.constructor.name} requires an organizationId. It comes from the session, never from a request body.`,
      );
    }
    this.organizationId = toObjectId(organizationId, this.constructor.name);
    this.actorId =
      actorId == null ? null : toObjectId(actorId, this.constructor.name);
  }

  /**
   * Merge the scope into a filter. Every read and every write in this class
   * goes through here, which is what makes the guarantee a property of the
   * class rather than a habit of the call site.
   *
   * `organizationId` is spread last on purpose. Even though `ScopedFilter` has
   * already removed the key from the type, a caller can still reach it through
   * `any`, and a spread that lost to its own argument would be the worst
   * possible outcome — silently, and only for the queries that matter most.
   *
   * `deletedAt` is added whenever the model opted in to soft delete, so a
   * deleted row is invisible to reads, writes and deletes alike. Doing it here
   * rather than in query middleware is the ADR-0003 pattern applied to the
   * second axis of isolation: one method to audit, and the exceptions below are
   * named rather than configured.
   */
  protected scope(
    filter: ScopedFilter<T> = {} as ScopedFilter<T>,
  ): QueryFilter<T> {
    return {
      ...filter,
      ...(this.softDeletes ? { deletedAt: null } : {}),
      organizationId: this.organizationId,
    } as QueryFilter<T>;
  }

  private get softDeletes(): boolean {
    return isSoftDeleteSchema(this.model.schema);
  }

  private get audits(): boolean {
    return hasAuditFields(this.model.schema);
  }

  /** Just `updatedBy`, for the soft-delete writes that manage their own $set. */
  private actorStamps(): Record<string, unknown> {
    return this.audits && this.actorId ? { updatedBy: this.actorId } : {};
  }

  // -- Reads -------------------------------------------------------------

  find(
    filter?: ScopedFilter<T>,
    projection?: Record<string, unknown>,
    options?: QueryOptions<T>,
  ) {
    return this.model.find(this.scope(filter), projection, options);
  }

  findOne(
    filter?: ScopedFilter<T>,
    projection?: Record<string, unknown>,
    options?: QueryOptions<T>,
  ) {
    return this.model.findOne(this.scope(filter), projection, options);
  }

  /**
   * The most common call in the application, and the one with the worst
   * failure mode: a foreign id must return null, never another organisation's
   * record. The scope is in the filter rather than applied to the result
   * afterwards, so a miss is a miss at the database.
   */
  findById(id: Types.ObjectId | string, options?: QueryOptions<T>) {
    return this.model.findOne(
      this.scope({ _id: id } as ScopedFilter<T>),
      undefined,
      options,
    );
  }

  findByIds(ids: (Types.ObjectId | string)[], options?: QueryOptions<T>) {
    return this.model.find(
      this.scope({ _id: { $in: ids } } as ScopedFilter<T>),
      undefined,
      options,
    );
  }

  async exists(filter?: ScopedFilter<T>): Promise<boolean> {
    return (await this.model.exists(this.scope(filter))) !== null;
  }

  countDocuments(filter?: ScopedFilter<T>): Promise<number> {
    return this.model.countDocuments(this.scope(filter));
  }

  // -- Writes ------------------------------------------------------------

  create(input: TenantCreateInput<T>) {
    return this.model.create({ ...input, ...this.stamps("create") } as T);
  }

  async insertMany(inputs: TenantCreateInput<T>[]) {
    const documents = inputs.map(
      (input) => ({ ...input, ...this.stamps("create") }) as T,
    );
    return this.model.insertMany(documents);
  }

  /**
   * The scope and the author, applied together on write.
   *
   * Spread last so neither can be reached through the caller's input — a
   * client that can name its own author is an audit log that records what the
   * client wanted. When the model has no audit fields, or no acting user is
   * known (a migration, a scheduled job, a seed), the stamp is absent rather
   * than null: a null in that column reads as "deleted by nobody", which is a
   * different claim from "this collection is not tracked".
   */
  private stamps(operation: "create" | "update"): Record<string, unknown> {
    const base: Record<string, unknown> = {
      organizationId: this.organizationId,
    };
    if (!this.audits || !this.actorId) return base;
    return operation === "create"
      ? { ...base, createdBy: this.actorId, updatedBy: this.actorId }
      : { ...base, updatedBy: this.actorId };
  }

  updateOne(
    filter: ScopedFilter<T>,
    update: UpdateOf<T>,
    options?: UpdateOptionsOf<T>,
  ) {
    return this.model.updateOne(
      this.scope(filter),
      { ...update, ...this.stamps("update") },
      { ...options, ...VALIDATE_UPDATES },
    );
  }

  updateMany(
    filter: ScopedFilter<T>,
    update: UpdateOf<T>,
    options?: ManyUpdateOptionsOf<T>,
  ) {
    return this.model.updateMany(
      this.scope(filter),
      { ...update, ...this.stamps("update") },
      { ...options, ...VALIDATE_UPDATES },
    );
  }

  /**
   * `findOneAndUpdate` and not `findByIdAndUpdate`, and the difference is the
   * whole point of this method.
   *
   * `Model.findByIdAndUpdate(id, ...)` is implemented as
   * `findOneAndUpdate({ _id: id }, ...)` — it *replaces* the filter rather than
   * merging into it. Handing it `{ _id, organizationId }` looks like a scoped
   * update, passes a code review, and silently updates a record belonging to
   * another organisation. It was written this way in the first draft of this
   * repository and caught only because the isolation suite runs against a real
   * database and asserts on the modified document rather than on a return
   * value.
   *
   * `findOneAndUpdate` takes a filter and honours all of it, so the scope
   * actually reaches MongoDB.
   *
   * This is also the method most of the application's client-supplied updates
   * arrive through, which is why `runValidators` matters most here. Validation
   * covers the paths an update touches and nothing else, so a partial update is
   * not made to satisfy `required` on fields it never mentions.
   */
  findByIdAndUpdate(
    id: Types.ObjectId | string,
    update: UpdateOf<T>,
    options?: FindOneAndUpdateOptionsOf<T> & {
      returnDocument?: "after" | "before";
    },
  ) {
    return this.model.findOneAndUpdate(
      this.scope({ _id: id } as ScopedFilter<T>),
      { ...update, ...this.actorStamps() },
      {
        returnDocument: "after",
        ...options,
        ...VALIDATE_UPDATES,
      },
    );
  }

  /**
   * Hard delete, refused outright on a soft-delete collection.
   *
   * The collection-level convention is that deletion means setting
   * `deletedAt`. Leaving a `deleteOne` that quietly does the opposite means
   * the wrong call is a one-word slip with no error and no recovery, and it
   * reads identically to the correct call at the call site. So the method
   * throws instead, and names the two operations that are actually allowed:
   * `softDeleteOne` for the normal path, `hardDeleteOne` for erasure.
   */
  deleteOne(filter: ScopedFilter<T>, options?: DeleteOptionsOf<T>) {
    if (this.softDeletes) {
      throw new Error(
        `${this.constructor.name} is a soft-delete collection. Use softDeleteOne() to hide a record, or hardDeleteById() if the data must genuinely be erased.`,
      );
    }
    return this.model.deleteOne(this.scope(filter), options);
  }

  deleteMany(filter: ScopedFilter<T>, options?: DeleteOptionsOf<T>) {
    if (this.softDeletes) {
      throw new Error(
        `${this.constructor.name} is a soft-delete collection. Use softDeleteMany() to hide records, or hardDeleteMany() if the data must genuinely be erased.`,
      );
    }
    return this.model.deleteMany(this.scope(filter), options);
  }

  // -- Soft delete --------------------------------------------------------
  //
  // `scope()` hides deleted rows from every method above, which is the
  // default DATABASE.md requires. These are the deliberate exceptions, named
  // so a grep for "with deleted" or "restore" finds every one.

  async softDeleteOne(filter: ScopedFilter<T>, options?: UpdateOptionsOf<T>) {
    return this.model.updateOne(
      this.scope(filter),
      { $set: { deletedAt: new Date(), ...this.actorStamps() } },
      options,
    );
  }

  /** Soft-delete every match, returning the count for an honest UI. */
  async softDeleteMany(filter: ScopedFilter<T>, options?: UpdateOptionsOf<T>) {
    return this.model.updateMany(
      this.scope(filter),
      { $set: { deletedAt: new Date(), ...this.actorStamps() } },
      options,
    );
  }

  /**
   * Irreversible. Reserved for a genuine erasure request, where the obligation
   * to remove the data outweighs the ability to restore it.
   *
   * Named `hardDelete*` rather than permitted through `delete*` so that
   * `grep -r "hardDelete"` returns every place in the codebase that can
   * destroy a record irreversibly. That list should be short enough to read
   * during an audit.
   *
   * There is deliberately no `deleteById`. An earlier version had one, added so
   * that no call site would reach for the unsafe `findByIdAndDelete` by name —
   * but it went straight to `findOneAndDelete` with no soft-delete guard, so on
   * a soft-delete collection it destroyed rows that `deleteOne` and `deleteMany`
   * both refuse to touch. The same name meaning "erase" on one schema and
   * "refuse" on another is the hazard itself, so the method is gone rather than
   * reworded. `softDeleteById` and `hardDeleteById` say which one they mean.
   *
   * A soft delete takes a filter rather than an id because the screens that use
   * it are bulk actions — "archive these twelve selected rows" — and a
   * `softDeleteByIds` would invite passing a list that quietly drops duplicates.
   */
  async hardDeleteById(
    id: Types.ObjectId | string,
    options?: DeleteOptionsOf<T>,
  ) {
    return this.model.deleteOne(
      { _id: id, organizationId: this.organizationId } as QueryFilter<T>,
      options as never,
    );
  }

  async hardDeleteMany(filter: ScopedFilter<T>, options?: DeleteOptionsOf<T>) {
    return this.model.deleteMany(
      { ...filter, organizationId: this.organizationId } as QueryFilter<T>,
      options as never,
    );
  }

  /** Delete by setting `deletedAt`. A hard delete is a separate, named choice. */
  async softDeleteById(
    id: Types.ObjectId | string,
    options?: UpdateOptionsOf<T>,
  ) {
    const result = await this.model.updateOne(
      this.scope({ _id: id } as ScopedFilter<T>),
      { $set: { deletedAt: new Date(), ...this.actorStamps() } },
      options,
    );
    return result;
  }

  /**
   * Bring a soft-deleted row back.
   *
   * Written as a direct model call rather than through `scope()`, because the
   * point is precisely to reach a row that `scope()` hides. It is the only way
   * out of the deleted state, and it is a named method rather than a filter
   * flag so that "who undeleted this" is answerable.
   */
  async restoreById(id: Types.ObjectId | string, options?: UpdateOptionsOf<T>) {
    return this.model.updateOne(
      { _id: id, organizationId: this.organizationId },
      { $set: { deletedAt: null, ...this.actorStamps() } },
      options,
    );
  }

  /** Reads that include deleted rows. An audit or trash view only. */
  findWithDeleted(
    filter?: ScopedFilter<T>,
    projection?: Record<string, unknown>,
    options?: QueryOptions<T>,
  ) {
    return this.model.find(
      { ...filter, organizationId: this.organizationId } as QueryFilter<T>,
      projection,
      options,
    );
  }

  findOnlyDeleted(
    filter?: ScopedFilter<T>,
    projection?: Record<string, unknown>,
    options?: QueryOptions<T>,
  ) {
    return this.model.find(
      {
        ...filter,
        organizationId: this.organizationId,
        deletedAt: { $ne: null },
      } as QueryFilter<T>,
      projection,
      options,
    );
  }

  countWithDeleted(filter?: ScopedFilter<T>): Promise<number> {
    return this.model.countDocuments({
      ...filter,
      organizationId: this.organizationId,
    } as QueryFilter<T>);
  }

  // -- The escape hatch --------------------------------------------------

  /**
   * The only way to read across tenants, and it costs a sentence explaining
   * why.
   *
   * `reason` is a required string rather than a boolean or a comment, so every
   * use is greppable and every use is a review decision. There are two
   * legitimate cases in this product and both are inherent to their operation
   * rather than a convenience: resolving a user by email during login, which
   * happens before an organisation exists, and accepting an invitation, which
   * spans the inviting and the invited organisation.
   *
   * A service layer has no reason to call this. If one does, that is a design
   * problem, not a missing filter.
   */
  findUnscoped(
    reason: string,
    filter: QueryFilter<T> = {},
    options?: QueryOptions<T>,
  ) {
    this.assertReason(reason, "findUnscoped");
    return this.model.find(filter, undefined, options);
  }

  findUnscopedById(
    reason: string,
    id: Types.ObjectId | string,
    options?: QueryOptions<T>,
  ) {
    this.assertReason(reason, "findUnscopedById");
    // Written as findOne rather than findById so it is obvious this is a plain
    // lookup with no scope, and so the architecture test can forbid the
    // by-id variants everywhere without an exception for this method.
    return this.model.findOne(
      { _id: id } as QueryFilter<T>,
      undefined,
      options,
    );
  }

  private assertReason(reason: string, method: string) {
    if (typeof reason !== "string" || reason.trim().length < 10) {
      throw new Error(
        `${method} requires a real reason (at least 10 characters) explaining why this query spans tenants. It is greppable on purpose.`,
      );
    }
  }
}

type AggregateStage = Record<string, unknown>;

/**
 * A pipeline whose first stage is a `$match`. Expressed as a variadic tuple
 * rather than `PipelineStage[]` so that a pipeline not starting with a match
 * is a type error as well as a runtime one.
 */
type ScopedPipeline = [
  first: { $match: Record<string, unknown> },
  ...rest: AggregateStage[],
];

/**
 * Aggregates are the hole in a `find`-based scope, so they get their own
 * wrapper rather than a method on the base class.
 *
 * A pipeline has no filter to merge into, and a `$lookup` reaches into
 * collections this repository knows nothing about. The check is therefore
 * positional: the first stage must be a `$match` that constrains
 * `organizationId`, before any `$lookup` can widen the result.
 *
 * Requiring the match to be *first* rather than merely present is deliberate.
 * A `$match` after a `$lookup` is correct and still a data leak, because the
 * lookup has already read the other collection.
 */
export class TenantAggregateRepository<T extends TenantDocument> {
  readonly organizationId: Types.ObjectId;

  constructor(
    protected readonly model: Model<T>,
    organizationId: OrganizationRef,
  ) {
    if (
      organizationId === "" ||
      organizationId === null ||
      organizationId === undefined
    ) {
      throw new Error("TenantAggregateRepository requires an organizationId.");
    }
    this.organizationId = toObjectId(
      organizationId,
      "TenantAggregateRepository",
    );
  }

  /**
   * Requires the caller to write the leading `$match` rather than injecting
   * it. An injected match reads as safe in the method body and quietly changes
   * the pipeline's meaning when a caller has already written one, which is
   * exactly the class of bug this module exists to remove.
   */
  aggregate<R = Record<string, unknown>>(pipeline: ScopedPipeline) {
    const [first] = pipeline;

    if (!first || typeof first !== "object" || !("$match" in first)) {
      throw new Error(
        "aggregate must begin with a $match on organizationId. Every other stage is a widened net.",
      );
    }

    const constrained = (first.$match as Record<string, unknown>)
      .organizationId;
    const isScoped =
      typeof constrained === "object" &&
      constrained !== null &&
      "$in" in constrained;

    if (!constrained || !isScoped) {
      throw new Error(
        "aggregate must begin with a $match on organizationId as { $in: [...] }. " +
          "A $match after a $lookup is still a cross-tenant read, because the lookup already happened.",
      );
    }

    return this.model.aggregate<R>(pipeline as PipelineStage[]);
  }
}
