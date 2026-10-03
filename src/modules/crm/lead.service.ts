import type { ClientSession, Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import { PipelineRepository } from "@/modules/pipelines/pipeline.repository";
import { AppError, type ErrorCode } from "@/shared/errors/app-error";
import { events } from "@/shared/events/bus";
import { CompanyModel } from "./company.model";
import { CompanyRepository } from "./company.repository";
import { ContactModel } from "./contact.model";
import { ContactRepository } from "./contact.repository";
import { FieldDefinitionService } from "./field-definition.service";
import {
  LEAD_STATUS_TRANSITIONS,
  type Lead,
  type LeadContactSnapshot,
  type LeadStatus,
} from "./lead.model";
import { LeadRepository } from "./lead.repository";
import { TagModel } from "./tag.model";

export class LeadError extends AppError {
  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(code, { message, cause: options?.cause });
    this.name = "LeadError";
  }
}

export interface CreateLeadInput {
  organizationId: Types.ObjectId;
  actorId: Types.ObjectId;
  title: string;
  contactId?: Types.ObjectId;
  contactSnapshot: LeadContactSnapshot;
  companyId?: Types.ObjectId;
  source: string;
  status?: LeadStatus;
  score?: number;
  ownerId: Types.ObjectId;
  tags?: Types.ObjectId[];
  notes?: string;
  customFields?: Record<string, unknown>;
}

export interface UpdateLeadInput {
  title?: string;
  contactId?: Types.ObjectId | null;
  companyId?: Types.ObjectId | null;
  source?: string;
  status?: LeadStatus;
  score?: number;
  ownerId?: Types.ObjectId;
  tags?: Types.ObjectId[];
  notes?: string | null;
  customFields?: Record<string, unknown>;
}

export interface LeadConversionInput {
  createContact: boolean;
  createCompany: boolean;
  createDeal: boolean;
  deal?: {
    name: string;
    pipelineId: Types.ObjectId;
    stageId: Types.ObjectId;
    value?: number;
    expectedCloseDate?: Date;
  };
  customFields?: Record<string, unknown>;
}

/**
 * Lead service.
 *
 * Handles lead CRUD, status transitions, and the atomic conversion operation.
 * Conversion creates Contact (+ optional Company + optional Deal) in one transaction.
 */
export class LeadService {
  private repo: LeadRepository;
  private contactRepo: ContactRepository;
  private companyRepo: CompanyRepository;
  private fieldDefService: FieldDefinitionService;
  private pipelineRepo: PipelineRepository;

  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    this.repo = new LeadRepository(organizationId, actorId);
    this.contactRepo = new ContactRepository(organizationId, actorId);
    this.companyRepo = new CompanyRepository(organizationId, actorId);
    this.fieldDefService = new FieldDefinitionService(organizationId, actorId);
    this.pipelineRepo = new PipelineRepository(organizationId, actorId);
  }

  /** Create a new lead. */
  async create(input: CreateLeadInput): Promise<Lead> {
    // Validate custom fields
    if (input.customFields) {
      const validation = await this.fieldDefService.validateValues(
        "LEAD",
        input.customFields,
      );
      if (!validation.valid) {
        throw new LeadError("VALIDATION_FAILED", "Invalid custom fields.", {
          cause: validation.errors,
        });
      }
      input.customFields = await this.fieldDefService.coerceValues(
        "LEAD",
        input.customFields,
      );
    }

    // Validate contact exists if provided
    if (input.contactId) {
      const contact = await this.contactRepo.findById(input.contactId);
      if (!contact) {
        throw new LeadError(
          "VALIDATION_FAILED",
          "Referenced contact not found.",
        );
      }
    }

    // Validate company exists if provided
    if (input.companyId) {
      const company = await this.companyRepo.findById(input.companyId);
      if (!company) {
        throw new LeadError(
          "VALIDATION_FAILED",
          "Referenced company not found.",
        );
      }
    }

    // Validate tags exist if provided
    if (input.tags?.length) {
      const tagCount = await TagModel.countDocuments({
        organizationId: input.organizationId,
        _id: { $in: input.tags },
        deletedAt: null,
      }).exec();
      if (tagCount !== input.tags.length) {
        throw new LeadError("VALIDATION_FAILED", "One or more tags not found.");
      }
    }

    const lead = await this.repo.create({
      title: input.title.trim(),
      contactId: input.contactId ?? null,
      contactSnapshot: input.contactSnapshot,
      companyId: input.companyId ?? null,
      source: input.source.trim(),
      status: input.status ?? "NEW",
      score: input.score ?? 0,
      ownerId: input.ownerId,
      tags: input.tags ?? [],
      notes: input.notes?.trim() ?? null,
      customFields: input.customFields ?? {},
    });

    await events.emit("lead.created", {
      organizationId: input.organizationId,
      leadId: lead._id,
      title: lead.title,
      actorId: input.actorId,
    });

    return lead;
  }

  /** Update a lead. */
  async update(
    leadId: Types.ObjectId | string,
    input: UpdateLeadInput,
    actorId: Types.ObjectId,
  ): Promise<Lead> {
    const existing = await this.repo.findById(leadId);
    if (!existing) {
      throw new LeadError("RECORD_NOT_FOUND", "Lead not found.");
    }

    // Validate status transition
    if (input.status !== undefined && input.status !== existing.status) {
      const allowed = LEAD_STATUS_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(input.status)) {
        throw new LeadError(
          "INVALID_STATE",
          `Cannot transition from ${existing.status} to ${input.status}. Allowed: ${allowed.join(", ")}`,
        );
      }
    }

    // Validate custom fields
    if (input.customFields) {
      const validation = await this.fieldDefService.validateValues(
        "LEAD",
        input.customFields,
      );
      if (!validation.valid) {
        throw new LeadError("VALIDATION_FAILED", "Invalid custom fields.", {
          cause: validation.errors,
        });
      }
      input.customFields = await this.fieldDefService.coerceValues(
        "LEAD",
        input.customFields,
      );
    }

    // Validate contact
    if (input.contactId !== undefined && input.contactId) {
      const contact = await this.contactRepo.findById(input.contactId);
      if (!contact) {
        throw new LeadError(
          "VALIDATION_FAILED",
          "Referenced contact not found.",
        );
      }
    }

    // Validate company
    if (input.companyId !== undefined && input.companyId) {
      const company = await this.companyRepo.findById(input.companyId);
      if (!company) {
        throw new LeadError(
          "VALIDATION_FAILED",
          "Referenced company not found.",
        );
      }
    }

    // Validate tags
    if (input.tags !== undefined && input.tags.length > 0) {
      const tagCount = await TagModel.countDocuments({
        organizationId: this.repo.organizationId,
        _id: { $in: input.tags },
        deletedAt: null,
      }).exec();
      if (tagCount !== input.tags.length) {
        throw new LeadError("VALIDATION_FAILED", "One or more tags not found.");
      }
    }

    const changes: Record<string, unknown> = {};
    const fields = [
      "title",
      "contactId",
      "companyId",
      "source",
      "status",
      "score",
      "ownerId",
      "tags",
      "notes",
      "customFields",
    ] as const;

    for (const field of fields) {
      const newValue = input[field];
      const oldValue = existing[field];
      if (newValue !== undefined && !this.deepEqual(newValue, oldValue)) {
        changes[field] = newValue;
      }
    }

    if (Object.keys(changes).length === 0) return existing;

    const updated = await this.repo.findByIdAndUpdate(leadId, {
      $set: changes,
    });
    if (!updated) {
      throw new LeadError("RECORD_NOT_FOUND", "Lead not found after update.");
    }

    await events.emit("lead.updated", {
      organizationId: this.repo.organizationId,
      leadId: existing._id,
      changes,
      actorId,
    });

    return updated;
  }

  /** Soft delete a lead. */
  async delete(
    leadId: Types.ObjectId | string,
    actorId: Types.ObjectId,
  ): Promise<void> {
    const existing = await this.repo.findById(leadId);
    if (!existing) {
      throw new LeadError("RECORD_NOT_FOUND", "Lead not found.");
    }

    await this.repo.softDeleteById(leadId);

    await events.emit("lead.deleted", {
      organizationId: this.repo.organizationId,
      leadId: existing._id,
      actorId,
    });
  }

  /** Get a lead by ID. */
  async getById(leadId: Types.ObjectId | string): Promise<Lead | null> {
    return this.repo.findById(leadId);
  }

  /** List leads with filters and pagination. */
  async list(
    filters: {
      status?: LeadStatus;
      source?: string;
      ownerId?: Types.ObjectId;
      scoreMin?: number;
      scoreMax?: number;
      q?: string;
      createdFrom?: Date;
      createdTo?: Date;
    },
    options: { sort?: string; page?: number; pageSize?: number } = {},
  ) {
    return this.repo.findWithFilters(filters, options);
  }

  /** Get leads for select dropdown. */
  async getForSelect() {
    return this.repo.getForSelect();
  }

  /** Get lead status funnel (counts by status). */
  async getStatusFunnel() {
    return this.repo.getStatusFunnel();
  }

  /** Get lead source funnel (counts by source and status). */
  async getSourceFunnel() {
    return this.repo.getSourceFunnel();
  }

  /** Get lead conversion rate. */
  async getConversionRate() {
    return this.repo.getConversionRate();
  }

  /**
   * Convert a lead to a Contact (+ optional Company + optional Deal).
   *
   * This is the most complex write in the MVP. It runs in a MongoDB transaction
   * to ensure atomicity. The lead is marked CONVERTED with references to the
   * created records. Idempotent: a second call returns 409 with the created IDs.
   */
  async convert(
    leadId: Types.ObjectId | string,
    input: LeadConversionInput,
    actorId: Types.ObjectId,
  ): Promise<{
    lead: Lead;
    contactId: Types.ObjectId;
    companyId: Types.ObjectId | null;
    dealId: Types.ObjectId | null;
  }> {
    return withTransaction(async (session: ClientSession) => {
      const lead = await this.repo.findById(leadId);
      if (!lead) {
        throw new LeadError("RECORD_NOT_FOUND", "Lead not found.");
      }

      // Idempotency: if already converted, return existing IDs
      if (lead.status === "CONVERTED") {
        throw new LeadError(
          "INVALID_STATE",
          "This lead has already been converted.",
          {
            cause: {
              convertedContactId: lead.convertedContactId,
              convertedCompanyId: lead.convertedCompanyId,
              convertedDealId: lead.convertedDealId,
            },
          },
        );
      }

      // Validate deal input if creating deal
      if (input.createDeal) {
        if (!input.deal) {
          throw new LeadError(
            "VALIDATION_FAILED",
            "Deal details are required when createDeal is true.",
          );
        }
        if (!input.deal.pipelineId || !input.deal.stageId) {
          throw new LeadError(
            "VALIDATION_FAILED",
            "Deal requires pipelineId and stageId.",
          );
        }
        // The stage has to belong to the pipeline, checked through the same
        // tenant-scoped repository `POST /deals` uses, so the two paths cannot
        // disagree about what a valid pair is. It used to be a comment saying
        // this was deferred, which meant conversion accepted ids that
        // `POST /deals` refuses and wrote a deal pointing at a pipeline in
        // another tenant — invisible on the caller's own board, and a dangling
        // reference for anything that later resolves those ids.
        const stage = await this.pipelineRepo.getStage(
          input.deal.pipelineId,
          input.deal.stageId,
        );
        if (!stage) {
          throw new LeadError(
            "VALIDATION_FAILED",
            "The selected stage does not belong to the specified pipeline.",
          );
        }
      }

      let contactId: Types.ObjectId;
      let companyId: Types.ObjectId | null = null;
      let dealId: Types.ObjectId | null = null;

      // 1. Create or link Contact
      if (input.createContact) {
        const contact = await this.createContactFromLead(
          lead,
          actorId,
          session,
        );
        contactId = contact._id;
      } else if (lead.contactId) {
        contactId = lead.contactId;
      } else {
        throw new LeadError(
          "VALIDATION_FAILED",
          "Lead has no contact and createContact is false.",
        );
      }

      // 2. Create or link Company
      if (input.createCompany && lead.contactSnapshot.companyName) {
        const company = await this.createCompanyFromLead(
          lead,
          actorId,
          session,
        );
        companyId = company._id;
        // Through the tenant-scoped repository, not `ContactModel` directly.
        // `contactId` came off the lead and is therefore only as trustworthy as
        // whatever wrote the lead — and the raw model call put no
        // `organizationId` in the filter, so a lead holding a stale or forged
        // contact id would have had that contact updated in whichever tenant
        // owns the id. The scope is applied in the constructor and cannot be
        // overridden by the filter, which is the property worth having here.
        await this.contactRepo.updateOne(
          { _id: contactId },
          { $set: { companyId } },
          { session },
        );
      } else if (lead.companyId) {
        companyId = lead.companyId;
      }

      // 3. Create Deal (requires deal module)
      if (input.createDeal && input.deal) {
        const { DealModel } = await import("@/modules/deals/deal.model").catch(
          () => ({ DealModel: null }),
        );
        if (!DealModel) {
          throw new LeadError(
            "CONFIGURATION_INVALID",
            "Deals module not available.",
          );
        }

        const deal = await DealModel.create(
          [
            {
              organizationId: this.repo.organizationId,
              name: input.deal.name,
              companyId,
              contactId,
              pipelineId: input.deal.pipelineId,
              stageId: input.deal.stageId,
              ownerId: lead.ownerId,
              value: input.deal.value ?? 0,
              currency: "USD", // TODO: get from organization
              probability: 0, // Will be set from stage
              status: "OPEN",
              expectedCloseDate: input.deal.expectedCloseDate ?? null,
              tags: lead.tags,
              customFields: input.customFields ?? {},
            },
          ],
          { session },
        );
        dealId = deal[0]._id;
      }

      // 4. Update lead to CONVERTED
      const convertedAt = new Date();
      const updatedLead = await this.repo.findByIdAndUpdate(
        leadId,
        {
          $set: {
            status: "CONVERTED",
            convertedAt,
            convertedContactId: contactId,
            convertedCompanyId: companyId,
            convertedDealId: dealId,
          },
        },
        { session },
      );

      if (!updatedLead) {
        throw new LeadError(
          "RECORD_NOT_FOUND",
          "Lead not found after conversion.",
        );
      }

      // Emit conversion event
      await events.emit("lead.converted", {
        organizationId: this.repo.organizationId,
        leadId: lead._id,
        contactId,
        companyId,
        dealId,
        actorId,
      });

      return {
        lead: updatedLead,
        contactId,
        companyId,
        dealId,
      };
    });
  }

  private async createContactFromLead(
    lead: Lead,
    _actorId: Types.ObjectId,
    session: ClientSession,
  ) {
    const emails = lead.contactSnapshot.email
      ? [
          {
            label: "Primary",
            value: lead.contactSnapshot.email,
            isPrimary: true,
          },
        ]
      : [];

    const phones = lead.contactSnapshot.phone
      ? [
          {
            label: "Primary",
            value: lead.contactSnapshot.phone,
            isPrimary: true,
          },
        ]
      : [];

    const [contact] = await ContactModel.create(
      [
        {
          organizationId: this.repo.organizationId,
          firstName: lead.contactSnapshot.firstName,
          lastName: lead.contactSnapshot.lastName,
          jobTitle: lead.contactSnapshot.companyName ? undefined : "Contact",
          ownerId: lead.ownerId,
          primaryEmail: lead.contactSnapshot.email?.toLowerCase() ?? null,
          emails,
          phones,
          status: "LEAD",
          tags: lead.tags,
          notes: lead.notes,
          customFields: lead.customFields,
        },
      ],
      { session },
    );

    return contact;
  }

  private async createCompanyFromLead(
    lead: Lead,
    _actorId: Types.ObjectId,
    session: ClientSession,
  ) {
    const domain = lead.contactSnapshot.email
      ? lead.contactSnapshot.email.split("@")[1]?.toLowerCase()
      : undefined;

    const companyName = lead.contactSnapshot.companyName ?? "";

    const [company] = await CompanyModel.create(
      [
        {
          organizationId: this.repo.organizationId,
          name: companyName,
          ownerId: lead.ownerId,
          status: "PROSPECT",
          tags: lead.tags,
          notes: lead.notes,
          customFields: lead.customFields,
          domain,
        },
      ],
      { session },
    );

    return company;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
