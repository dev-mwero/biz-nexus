import type { Types } from "mongoose";

/**
 * Events the CRM modules emit.
 *
 * Modules declare their own events by merging into DomainEventMap.
 * Subscribers (activity timeline, audit log) depend on these shapes.
 */

declare module "@/shared/events/registry" {
  interface DomainEventMap {
    // Tag events
    "tag.created": {
      organizationId: Types.ObjectId;
      tagId: Types.ObjectId;
      name: string;
      actorId: Types.ObjectId;
    };
    "tag.updated": {
      organizationId: Types.ObjectId;
      tagId: Types.ObjectId;
      changes: Record<string, unknown>;
      actorId: Types.ObjectId;
    };
    "tag.deleted": {
      organizationId: Types.ObjectId;
      tagId: Types.ObjectId;
      actorId: Types.ObjectId;
    };
    "tag.merged": {
      organizationId: Types.ObjectId;
      sourceTagId: Types.ObjectId;
      targetTagId: Types.ObjectId;
      actorId: Types.ObjectId;
    };

    // Field definition events
    "fieldDefinition.created": {
      organizationId: Types.ObjectId;
      fieldDefinitionId: Types.ObjectId;
      entityType: string;
      key: string;
      actorId: Types.ObjectId;
    };
    "fieldDefinition.updated": {
      organizationId: Types.ObjectId;
      fieldDefinitionId: Types.ObjectId;
      changes: Record<string, unknown>;
      actorId: Types.ObjectId;
    };
    "fieldDefinition.deleted": {
      organizationId: Types.ObjectId;
      fieldDefinitionId: Types.ObjectId;
      entityType: string;
      key: string;
      actorId: Types.ObjectId;
    };

    // Saved view events
    "savedView.created": {
      organizationId: Types.ObjectId;
      savedViewId: Types.ObjectId;
      entityType: string;
      name: string;
      actorId: Types.ObjectId;
    };
    "savedView.updated": {
      organizationId: Types.ObjectId;
      savedViewId: Types.ObjectId;
      changes: Record<string, unknown>;
      actorId: Types.ObjectId;
    };
    "savedView.deleted": {
      organizationId: Types.ObjectId;
      savedViewId: Types.ObjectId;
      actorId: Types.ObjectId;
    };

    // Company events
    "company.created": {
      organizationId: Types.ObjectId;
      companyId: Types.ObjectId;
      name: string;
      actorId: Types.ObjectId;
    };
    "company.updated": {
      organizationId: Types.ObjectId;
      companyId: Types.ObjectId;
      changes: Record<string, unknown>;
      actorId: Types.ObjectId;
    };
    "company.deleted": {
      organizationId: Types.ObjectId;
      companyId: Types.ObjectId;
      actorId: Types.ObjectId;
    };

    // Contact events
    "contact.created": {
      organizationId: Types.ObjectId;
      contactId: Types.ObjectId;
      name: string;
      actorId: Types.ObjectId;
    };
    "contact.updated": {
      organizationId: Types.ObjectId;
      contactId: Types.ObjectId;
      changes: Record<string, unknown>;
      actorId: Types.ObjectId;
    };
    "contact.deleted": {
      organizationId: Types.ObjectId;
      contactId: Types.ObjectId;
      actorId: Types.ObjectId;
    };
    "contact.merged": {
      organizationId: Types.ObjectId;
      sourceContactId: Types.ObjectId;
      targetContactId: Types.ObjectId;
      actorId: Types.ObjectId;
    };

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
 * Payload for the lead.converted event, re-exported for convenience.
 */
export type LeadConvertedPayload = {
  organizationId: Types.ObjectId;
  leadId: Types.ObjectId;
  contactId: Types.ObjectId;
  companyId: Types.ObjectId | null;
  dealId: Types.ObjectId | null;
  actorId: Types.ObjectId;
};
