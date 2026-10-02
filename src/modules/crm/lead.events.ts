import type { Types } from "mongoose";

/**
 * Lead-specific events.
 *
 * These are declared by merging into the DomainEventMap in @/shared/events/registry.
 * Subscribers (activity timeline, audit log) depend on these shapes.
 */

declare module "@/shared/events/registry" {
  interface DomainEventMap {
    // Lead events
    "lead.created": {
      organizationId: Types.ObjectId;
      leadId: Types.ObjectId;
      title: string;
      actorId: Types.ObjectId;
    };
    "lead.updated": {
      organizationId: Types.ObjectId;
      leadId: Types.ObjectId;
      changes: Record<string, unknown>;
      actorId: Types.ObjectId;
    };
    "lead.deleted": {
      organizationId: Types.ObjectId;
      leadId: Types.ObjectId;
      actorId: Types.ObjectId;
    };
    "lead.converted": {
      organizationId: Types.ObjectId;
      leadId: Types.ObjectId;
      contactId: Types.ObjectId;
      companyId: Types.ObjectId | null;
      dealId: Types.ObjectId | null;
      actorId: Types.ObjectId;
    };
  }
}

/**
 * Payload for the lead.converted event.
 */
export type LeadConvertedPayload = {
  organizationId: Types.ObjectId;
  leadId: Types.ObjectId;
  contactId: Types.ObjectId;
  companyId: Types.ObjectId | null;
  dealId: Types.ObjectId | null;
  actorId: Types.ObjectId;
};

/**
 * Payload for the lead.created event.
 */
export type LeadCreatedPayload = {
  organizationId: Types.ObjectId;
  leadId: Types.ObjectId;
  title: string;
  actorId: Types.ObjectId;
};

/**
 * Payload for the lead.updated event.
 */
export type LeadUpdatedPayload = {
  organizationId: Types.ObjectId;
  leadId: Types.ObjectId;
  changes: Record<string, unknown>;
  actorId: Types.ObjectId;
};

/**
 * Payload for the lead.deleted event.
 */
export type LeadDeletedPayload = {
  organizationId: Types.ObjectId;
  leadId: Types.ObjectId;
  actorId: Types.ObjectId;
};
