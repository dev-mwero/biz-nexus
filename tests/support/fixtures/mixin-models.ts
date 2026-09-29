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

const companySchema = new Schema<MixinCompany>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: { type: String, required: true },
  },
  { timestamps: true, collection: "test_mixin_companies" },
);

companySchema.plugin(softDelete());
companySchema.plugin(auditFields());
companySchema.plugin(slug());

export const MixinCompanyModel: Model<MixinCompany> =
  (mongoose.models.test_mixin_companies as Model<MixinCompany>) ??
  mongoose.model<MixinCompany>("test_mixin_companies", companySchema);

export class MixinCompanyRepository extends TenantRepository<MixinCompany> {
  constructor(
    organizationId: mongoose.Types.ObjectId | string,
    actorId?: mongoose.Types.ObjectId | string,
  ) {
    super(MixinCompanyModel, organizationId, actorId);
  }
}

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
