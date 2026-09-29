import mongoose, { type Model, Schema } from "mongoose";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";
import {
  type ScopedFilter,
  type TenantCreateInput,
  type TenantDocument,
  TenantRepository,
} from "@/db/tenant-repository";

/**
 * A stand-in for a real tenant collection, used to exercise the repository
 * before the domain schemas land in 1.11 and 1.12.
 *
 * Shaped like `Company` because that is the collection most likely to be
 * reached for by mistake: it has a name, a free-text field, an owner, and the
 * kind of filter a list view builds. The point of the isolation tests is that
 * the repository holds when the query is the one a real screen would write.
 */

export interface FixtureContact extends TenantDocument {
  _id: mongoose.Types.ObjectId;
  name: string;
  email: string;
  ownerId: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<FixtureContact>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    email: { type: String, required: true },
    ownerId: { type: Schema.Types.ObjectId, required: true },
  },
  { timestamps: true, collection: "test_contacts" },
);

export const ContactModel: Model<FixtureContact> =
  (mongoose.models.test_contacts as Model<FixtureContact>) ??
  mongoose.model<FixtureContact>("test_contacts", schema);

export class ContactRepository extends TenantRepository<FixtureContact> {
  constructor(organizationId: mongoose.Types.ObjectId | string) {
    super(ContactModel, organizationId);
  }
}

/**
 * A soft-delete tenant collection, for the soft-delete cross-tenant cases.
 *
 * Separate from the fixture above on purpose. `softDeleteById` issues
 * `$set: { deletedAt }`, and on a schema without that field Mongoose strips it
 * — so testing soft-delete isolation against the plain fixture would pass even
 * with the tenant scope removed. Soft delete is the default deletion path for
 * every tenant collection, so it has to be tested on a collection that actually
 * has the field.
 */
export interface SoftDeleteFixture extends TenantDocument, SoftDeleteFields {
  _id: mongoose.Types.ObjectId;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

const softDeleteSchema = new Schema<SoftDeleteFixture>(
  {
    organizationId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    name: { type: String, required: true },
  },
  { timestamps: true, collection: "test_soft_delete_contacts" },
);
softDeleteSchema.plugin(softDelete());

export const SoftDeleteContactModel: Model<SoftDeleteFixture> =
  (mongoose.models.test_soft_delete_contacts as Model<SoftDeleteFixture>) ??
  mongoose.model<SoftDeleteFixture>(
    "test_soft_delete_contacts",
    softDeleteSchema,
  );

export class SoftDeleteContactRepository extends TenantRepository<SoftDeleteFixture> {
  constructor(organizationId: mongoose.Types.ObjectId | string) {
    super(SoftDeleteContactModel, organizationId);
  }
}

export type { ScopedFilter, TenantCreateInput };
