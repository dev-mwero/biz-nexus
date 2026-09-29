import mongoose, { type Model, Schema } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { type SlugFields, slug } from "@/db/mixins/slug";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";
import { type TenantDocument, TenantRepository } from "@/db/tenant-repository";

/**
 * Fixtures for the three mixins, so the tests exercise the real schemas rather
 * than a hand-built approximation of them. A fixture that adds the fields
 * without applying the mixin would pass every field test and prove nothing
 * about the marker the repository reads.
 */

export interface MixinCompany
  extends TenantDocument,
    AuditFields,
    SoftDeleteFields,
    SlugFields {
  _id: mongoose.Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Built per test file, on purpose.
 *
 * An earlier version exported one shared `test_mixin_companies` model that
 * both the mixin suite and the slug suite imported. Vitest runs files in
 * parallel workers against one in-memory replica set, so each file's
 * `deleteMany` in `beforeEach` wiped the other's rows mid-test — eight
 * failures that passed in isolation and only appeared in the full run. A
 * failure that depends on what else is running is a false signal in both
 * directions, and it costs more to diagnose than a shared model saves.
 *
 * The collection name is part of the model name, so two suites cannot collide
 * even if they are added to the same worker.
 */
export function makeCompanyFixtures(suffix: string) {
  const modelName = `mixin_company_${suffix}`;
  const collection = `test_mixin_companies_${suffix}`;

  const schema = new Schema<MixinCompany>(
    {
      organizationId: {
        type: Schema.Types.ObjectId,
        required: true,
        index: true,
      },
      name: { type: String, required: true },
    },
    { timestamps: true, collection },
  );

  schema.plugin(softDelete());
  schema.plugin(auditFields());
  schema.plugin(slug());

  const model: Model<MixinCompany> =
    (mongoose.models[modelName] as Model<MixinCompany>) ??
    mongoose.model<MixinCompany>(modelName, schema);

  class Repository extends TenantRepository<MixinCompany> {
    constructor(
      organizationId: mongoose.Types.ObjectId | string,
      actorId?: mongoose.Types.ObjectId | string,
    ) {
      super(model, organizationId, actorId);
    }
  }

  return { model, Repository, collection };
}

export const { model: MixinCompanyModel, Repository: MixinCompanyRepository } =
  makeCompanyFixtures("default");

/** A schema with none of the mixins, to prove the repository adapts. */
export interface PlainRecord extends TenantDocument {
  _id: mongoose.Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const plainSchema = new Schema<PlainRecord>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: { type: String, required: true },
  },
  { timestamps: true, collection: "test_plain_records" },
);

export const PlainRecordModel: Model<PlainRecord> =
  (mongoose.models.test_plain_records as Model<PlainRecord>) ??
  mongoose.model<PlainRecord>("test_plain_records", plainSchema);

export class PlainRecordRepository extends TenantRepository<PlainRecord> {
  constructor(organizationId: mongoose.Types.ObjectId | string) {
    super(PlainRecordModel, organizationId);
  }
}
