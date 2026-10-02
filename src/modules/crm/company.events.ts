import type { Types } from "mongoose";

/**
 * Company event payloads.
 * Re-exported from crm.events.ts for module-scoped access.
 */

export type CompanyCreatedPayload = {
  organizationId: Types.ObjectId;
  companyId: Types.ObjectId;
  name: string;
  actorId: Types.ObjectId;
};

export type CompanyUpdatedPayload = {
  organizationId: Types.ObjectId;
  companyId: Types.ObjectId;
  changes: Record<string, unknown>;
  actorId: Types.ObjectId;
};

export type CompanyDeletedPayload = {
  organizationId: Types.ObjectId;
  companyId: Types.ObjectId;
  actorId: Types.ObjectId;
};
