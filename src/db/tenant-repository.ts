import {
  type Model,
  type PipelineStage,
  type QueryFilter,
  type QueryOptions,
  Types,
} from "mongoose";

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
 * Write input with the scope removed, so the repository supplies it.
 *
 * A document saved without `organizationId` would be invisible to every scoped
 * query, and therefore invisible to the user who just created it — a support
 * ticket rather than an error.
 */
export type TenantCreateInput<T extends TenantDocument> = Omit<
  T,
  "organizationId" | "_id" | "createdAt" | "updatedAt"
>;

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

export abstract class TenantRepository<T extends TenantDocument> {
  readonly organizationId: Types.ObjectId;

  constructor(
    protected readonly model: Model<T>,
    organizationId: OrganizationRef,
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
   */
  protected scope(
    filter: ScopedFilter<T> = {} as ScopedFilter<T>,
  ): QueryFilter<T> {
    return { ...filter, organizationId: this.organizationId } as QueryFilter<T>;
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
    return this.model.create({
      ...input,
      organizationId: this.organizationId,
    } as T);
  }

  async insertMany(inputs: TenantCreateInput<T>[]) {
    const documents = inputs.map(
      (input) => ({ ...input, organizationId: this.organizationId }) as T,
    );
    return this.model.insertMany(documents);
  }

  updateOne(
    filter: ScopedFilter<T>,
    update: UpdateOf<T>,
    options?: UpdateOptionsOf<T>,
  ) {
    return this.model.updateOne(this.scope(filter), update, options);
  }

  updateMany(
    filter: ScopedFilter<T>,
    update: UpdateOf<T>,
    options?: ManyUpdateOptionsOf<T>,
  ) {
    return this.model.updateMany(this.scope(filter), update, options);
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
      update,
      { returnDocument: "after", ...options },
    );
  }

  deleteById(id: Types.ObjectId | string, options?: DeleteOptionsOf<T>) {
    // Same trap as findByIdAndUpdate: Model.findByIdAndDelete is
    // findOneAndDelete({ _id: id }). Exposed here so no call site reaches for
    // the unsafe one by name.
    //
    // The cast is for an upstream typing gap, not for the scope: every
    // findOneAndDelete overload in Mongoose 9's .d.ts types the filter as
    // `Query<any, any>`, while the runtime accepts the plain filter object
    // findOneAndUpdate does. The scope below is still applied and still
    // tested.
    return this.model.findOneAndDelete(
      this.scope({ _id: id } as ScopedFilter<T>) as never,
      options as never,
    );
  }

  deleteOne(filter: ScopedFilter<T>, options?: DeleteOptionsOf<T>) {
    return this.model.deleteOne(this.scope(filter), options);
  }

  deleteMany(filter: ScopedFilter<T>, options?: DeleteOptionsOf<T>) {
    return this.model.deleteMany(this.scope(filter), options);
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
