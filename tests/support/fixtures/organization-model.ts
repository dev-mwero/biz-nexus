import mongoose, { type Model, Schema } from "mongoose";
import { type AuditFields, auditFields } from "@/db/mixins/audit-fields";
import { slug } from "@/db/mixins/slug";
import { type SoftDeleteFields, softDelete } from "@/db/mixins/soft-delete";

/**
 * Shaped like `organizations`, because that is the only collection in the
 * product with a slug, and it is the reason the slug rules are what they are.
 *
 * Notably it has **no** `organizationId`: an organisation is not owned by an
 * organisation. `TenantRepository` cannot create it, which is why
 * `createWithUniqueSlug` takes a raw `Model` — a global collection with a
 * globally unique slug, created outside any tenant scope.
 *
 * Test-only. The real schema lands with the organisation models in 1.12; this
 * exists so the slug behaviour is verified against the shape it will actually
 * have rather than against a tenant collection that happens to have the field.
 */

export interface OrganizationFixture extends AuditFields, SoftDeleteFields {
  _id: mongoose.Types.ObjectId;
  name: string;
  slug: string;
  timezone: string;
  currency: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const schema = new Schema<OrganizationFixture>(
  {
    name: { type: String, required: true, minlength: 1, maxlength: 120 },
    timezone: { type: String, default: "UTC" },
    currency: { type: String, default: "USD" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true, collection: "test_organizations" },
);

schema.plugin(slug());
schema.plugin(auditFields());
schema.plugin(softDelete());

export const OrganizationFixtureModel: Model<OrganizationFixture> =
  (mongoose.models.test_organizations as Model<OrganizationFixture>) ??
  mongoose.model<OrganizationFixture>("test_organizations", schema);
