import mongoose, { type Model, Schema } from "mongoose";
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

export type { ScopedFilter, TenantCreateInput };
