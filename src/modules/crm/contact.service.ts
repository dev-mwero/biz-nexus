import { Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import { AppError, type ErrorCode } from "@/shared/errors/app-error";
import { events } from "@/shared/events/bus";
import { CompanyRepository } from "./company.repository";
import {
  type Contact,
  ContactModel,
  type ContactStatus,
} from "./contact.model";
import { ContactRepository } from "./contact.repository";
import { FieldDefinitionService } from "./field-definition.service";

export class ContactError extends AppError {
  constructor(code: ErrorCode, message: string, options?: { cause?: unknown }) {
    super(code, { message, cause: options?.cause });
    this.name = "ContactError";
  }
}

export interface EmailAddressInput {
  label: string;
  value: string;
  isPrimary?: boolean;
}

export interface PhoneNumberInput {
  label: string;
  value: string;
  isPrimary?: boolean;
}

export interface CreateContactInput {
  organizationId: Types.ObjectId;
  actorId: Types.ObjectId;
  firstName: string;
  lastName: string;
  salutation?: string;
  jobTitle?: string;
  companyId?: Types.ObjectId;
  ownerId: Types.ObjectId;
  emails?: EmailAddressInput[];
  phones?: PhoneNumberInput[];
  status?: ContactStatus;
  tags?: Types.ObjectId[];
  notes?: string;
  customFields?: Record<string, unknown>;
}

export interface UpdateContactInput {
  firstName?: string;
  lastName?: string;
  salutation?: string | null;
  jobTitle?: string | null;
  companyId?: Types.ObjectId | null;
  ownerId?: Types.ObjectId;
  emails?: EmailAddressInput[];
  phones?: PhoneNumberInput[];
  status?: ContactStatus;
  tags?: Types.ObjectId[];
  notes?: string | null;
  customFields?: Record<string, unknown>;
}

/**
 * Contact service.
 *
 * Handles contact CRUD, company association, and merge operations.
 * Primary email is denormalised for duplicate detection.
 */
export class ContactService {
  private repo: ContactRepository;
  private companyRepo: CompanyRepository;
  private fieldDefService: FieldDefinitionService;

  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    this.repo = new ContactRepository(organizationId, actorId);
    this.companyRepo = new CompanyRepository(organizationId, actorId);
    this.fieldDefService = new FieldDefinitionService(organizationId, actorId);
  }

  /** Create a new contact. */
  async create(input: CreateContactInput): Promise<Contact> {
    // Coerce and validate custom fields
    if (input.customFields) {
      input.customFields = await this.fieldDefService.coerceValues(
        "CONTACT",
        input.customFields,
      );
      const validation = await this.fieldDefService.validateValues(
        "CONTACT",
        input.customFields,
      );
      if (!validation.valid) {
        throw new ContactError("VALIDATION_FAILED", "Invalid custom fields.", {
          cause: validation.errors,
        });
      }
    }

    // Validate company exists
    if (input.companyId) {
      const company = await this.companyRepo.findById(input.companyId);
      if (!company) {
        throw new ContactError("VALIDATION_FAILED", "Company not found.");
      }
    }

    // Build emails array, ensure only one primary
    const emails = this.normalizeEmails(input.emails ?? []);
    const primaryEmail =
      emails.find((e) => e.isPrimary)?.value?.toLowerCase() ?? null;

    // Check duplicate primary email
    if (primaryEmail) {
      const existing = await this.repo.findByPrimaryEmail(primaryEmail);
      if (existing) {
        throw new ContactError(
          "SLUG_CONFLICT",
          `A contact with email "${primaryEmail}" already exists.`,
        );
      }
    }

    const contact = await this.repo.create({
      firstName: input.firstName.trim(),
      lastName: input.lastName.trim(),
      salutation: input.salutation?.trim() ?? null,
      jobTitle: input.jobTitle?.trim() ?? null,
      companyId: input.companyId ?? null,
      ownerId: input.ownerId,
      primaryEmail,
      emails,
      phones: this.normalizePhones(input.phones ?? []),
      status: input.status ?? "LEAD",
      tags: input.tags ?? [],
      notes: input.notes?.trim() ?? null,
      customFields: input.customFields ?? {},
    });

    await events.emit("contact.created", {
      organizationId: input.organizationId,
      contactId: contact._id,
      name: `${contact.firstName} ${contact.lastName}`,
      actorId: input.actorId,
    });

    return contact;
  }

  /** Update a contact. */
  async update(
    contactId: Types.ObjectId | string,
    input: UpdateContactInput,
    actorId: Types.ObjectId,
  ): Promise<Contact> {
    const existing = await this.repo.findById(contactId);
    if (!existing) {
      throw new ContactError("RECORD_NOT_FOUND", "Contact not found.");
    }

    // Skip merged contacts
    if (existing.mergedIntoId) {
      throw new ContactError(
        "INVALID_STATE",
        "This contact has been merged into another. Update the target contact instead.",
      );
    }

    // Coerce and validate custom fields
    if (input.customFields) {
      input.customFields = await this.fieldDefService.coerceValues(
        "CONTACT",
        input.customFields,
      );
      const validation = await this.fieldDefService.validateValues(
        "CONTACT",
        input.customFields,
      );
      if (!validation.valid) {
        throw new ContactError("VALIDATION_FAILED", "Invalid custom fields.", {
          cause: validation.errors,
        });
      }
    }

    // Validate company
    if (input.companyId !== undefined && input.companyId) {
      const company = await this.companyRepo.findById(input.companyId);
      if (!company) {
        throw new ContactError("VALIDATION_FAILED", "Company not found.");
      }
    }

    // Handle emails
    let primaryEmail = existing.primaryEmail;
    let emails = existing.emails;
    if (input.emails !== undefined) {
      emails = this.normalizeEmails(input.emails);
      primaryEmail =
        emails.find((e) => e.isPrimary)?.value?.toLowerCase() ?? null;

      if (primaryEmail && primaryEmail !== existing.primaryEmail) {
        const duplicate = await this.repo.findByPrimaryEmail(primaryEmail);
        if (duplicate && !duplicate._id.equals(contactId)) {
          throw new ContactError(
            "SLUG_CONFLICT",
            `A contact with email "${primaryEmail}" already exists.`,
          );
        }
      }
    }

    // Handle phones
    let phones = existing.phones;
    if (input.phones !== undefined) {
      phones = this.normalizePhones(input.phones);
    }

    const changes: Record<string, unknown> = {};
    if (input.firstName !== undefined && input.firstName !== existing.firstName)
      changes.firstName = input.firstName.trim();
    if (input.lastName !== undefined && input.lastName !== existing.lastName)
      changes.lastName = input.lastName.trim();
    if (
      input.salutation !== undefined &&
      input.salutation !== existing.salutation
    )
      changes.salutation = input.salutation?.trim() ?? null;
    if (input.jobTitle !== undefined && input.jobTitle !== existing.jobTitle)
      changes.jobTitle = input.jobTitle?.trim() ?? null;
    if (
      input.companyId !== undefined &&
      !input.companyId?.equals(existing.companyId)
    )
      changes.companyId = input.companyId ?? null;
    if (input.ownerId !== undefined && !input.ownerId.equals(existing.ownerId))
      changes.ownerId = input.ownerId;
    if (input.emails !== undefined) {
      changes.emails = emails;
      changes.primaryEmail = primaryEmail;
    }
    if (input.phones !== undefined) changes.phones = phones;
    if (input.status !== undefined && input.status !== existing.status)
      changes.status = input.status;
    if (input.tags !== undefined) changes.tags = input.tags;
    if (input.notes !== undefined && input.notes !== existing.notes)
      changes.notes = input.notes?.trim() ?? null;
    if (input.customFields !== undefined)
      changes.customFields = input.customFields;

    if (Object.keys(changes).length === 0) return existing;

    const updated = await this.repo.findByIdAndUpdate(contactId, {
      $set: changes,
    });
    if (!updated) {
      throw new ContactError(
        "RECORD_NOT_FOUND",
        "Contact not found after update.",
      );
    }

    await events.emit("contact.updated", {
      organizationId: this.repo.organizationId,
      contactId: existing._id,
      changes,
      actorId,
    });

    return updated;
  }

  /** Soft delete a contact. */
  async delete(
    contactId: Types.ObjectId | string,
    actorId: Types.ObjectId,
  ): Promise<void> {
    const existing = await this.repo.findById(contactId);
    if (!existing) {
      throw new ContactError("RECORD_NOT_FOUND", "Contact not found.");
    }

    await this.repo.softDeleteById(contactId);

    await events.emit("contact.deleted", {
      organizationId: this.repo.organizationId,
      contactId: existing._id,
      actorId,
    });
  }

  /** Merge two contacts: move all data from source to target, then soft delete source. */
  async merge(
    sourceContactId: Types.ObjectId | string,
    targetContactId: Types.ObjectId | string,
    actorId: Types.ObjectId,
  ): Promise<Contact> {
    return withTransaction(async (session) => {
      // Every read in here carries the session. A read without one is issued
      // outside the transaction, so it cannot see this transaction's own
      // uncommitted writes — and the read that returns the merged contact is
      // exactly the read that would return the contact as it was *before* the
      // merge. The write lands; the response describes the old record.
      //
      // Sequentially, not in `Promise.all`: a session carries one operation at
      // a time, and two concurrent operations on it race to advance the same
      // transaction number. The server refuses the second with "Only servers
      // in a sharded cluster can start a new transaction at the active
      // transaction number", which is a driver-level error that says nothing
      // about the merge.
      const source = await this.repo.findById(sourceContactId, { session });
      const target = await this.repo.findById(targetContactId, { session });

      if (!source || !target) {
        throw new ContactError(
          "RECORD_NOT_FOUND",
          "One or both contacts not found.",
        );
      }
      if (source._id.equals(target._id)) {
        throw new ContactError(
          "VALIDATION_FAILED",
          "Cannot merge a contact into itself.",
        );
      }
      if (source.mergedIntoId || target.mergedIntoId) {
        throw new ContactError(
          "INVALID_STATE",
          "One or both contacts have already been merged.",
        );
      }

      // Merge emails (unique by value)
      const allEmails = [...target.emails, ...source.emails];
      const seenEmails = new Set<string>();
      const mergedEmails = allEmails.filter((e) => {
        const key = e.value.toLowerCase();
        if (seenEmails.has(key)) return false;
        seenEmails.add(key);
        return true;
      });
      // Ensure only one primary
      const hasPrimary = mergedEmails.some((e) => e.isPrimary);
      if (!hasPrimary && mergedEmails.length > 0) {
        mergedEmails[0].isPrimary = true;
      }

      // Merge phones (unique by value)
      const allPhones = [...target.phones, ...source.phones];
      const seenPhones = new Set<string>();
      const mergedPhones = allPhones.filter((p) => {
        const key = p.value;
        if (seenPhones.has(key)) return false;
        seenPhones.add(key);
        return true;
      });

      // Merge tags (unique)
      const mergedTags = [
        ...new Set([...target.tags.map(String), ...source.tags.map(String)]),
      ].map((id) => new Types.ObjectId(id));

      // Merge custom fields (target wins on conflict)
      const mergedCustomFields = {
        ...source.customFields,
        ...target.customFields,
      };

      const primaryEmail =
        mergedEmails.find((e) => e.isPrimary)?.value?.toLowerCase() ?? null;

      const updated = await this.repo.findByIdAndUpdate(
        targetContactId,
        {
          $set: {
            emails: mergedEmails,
            phones: mergedPhones,
            tags: mergedTags,
            customFields: mergedCustomFields,
            primaryEmail,
            notes: [target.notes, source.notes].filter(Boolean).join("\n---\n"),
          },
        },
        { session },
      );

      // Mark source as merged
      await this.repo.findByIdAndUpdate(
        sourceContactId,
        { $set: { mergedIntoId: targetContactId } },
        { session },
      );

      // Update activities to point to target (optional, for MVP we leave as-is)

      // In the session, so it observes the write above. See the note on the
      // opening read.
      const finalTarget = await this.repo.findById(targetContactId, {
        session,
      });
      if (!finalTarget) {
        throw new ContactError(
          "RECORD_NOT_FOUND",
          "Target contact not found after merge.",
        );
      }

      await events.emit("contact.merged", {
        organizationId: this.repo.organizationId,
        sourceContactId: source._id,
        targetContactId: target._id,
        actorId,
      });

      return finalTarget;
    });
  }

  /** Get a contact by ID. */
  async getById(contactId: Types.ObjectId | string): Promise<Contact | null> {
    return this.repo.findById(contactId);
  }

  /** List contacts with filters and pagination. */
  async list(
    filters: {
      status?: ContactStatus;
      companyId?: Types.ObjectId | null;
      ownerId?: Types.ObjectId;
      tagIds?: Types.ObjectId[];
      q?: string;
      createdFrom?: Date;
      createdTo?: Date;
      hasEmail?: boolean;
    },
    options: { sort?: string; page?: number; pageSize?: number } = {},
  ) {
    return this.repo.findWithFilters(filters, options);
  }

  /** Get contacts for a company. */
  async getByCompany(
    companyId: Types.ObjectId | string,
    options: { sort?: string; limit?: number } = {},
  ) {
    return this.repo.findByCompany(companyId, options);
  }

  /** Get contacts for select dropdown. */
  async getForSelect() {
    return this.repo.getForSelect();
  }

  /** Find by primary email. */
  async findByEmail(email: string) {
    return this.repo.findByPrimaryEmail(email);
  }

  private normalizeEmails(emails: EmailAddressInput[]) {
    const result = emails.map((e) => ({
      label: e.label.trim(),
      value: e.value.trim().toLowerCase(),
      isPrimary: e.isPrimary ?? false,
    }));

    // Ensure only one primary
    let primarySet = false;
    for (const e of result) {
      if (e.isPrimary) {
        if (primarySet) e.isPrimary = false;
        else primarySet = true;
      }
    }
    // If none set as primary, make first one primary
    if (!primarySet && result.length > 0) {
      result[0].isPrimary = true;
    }

    return result;
  }

  private normalizePhones(phones: PhoneNumberInput[]) {
    return phones.map((p) => ({
      label: p.label.trim(),
      value: p.value.trim(),
      isPrimary: p.isPrimary ?? false,
    }));
  }
}
