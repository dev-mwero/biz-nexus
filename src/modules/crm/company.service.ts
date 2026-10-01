import type { Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import { AppError } from "@/shared/errors/app-error";
import { events } from "@/shared/events/bus";
import {
  type Address,
  type Company,
  CompanyModel,
  type CompanyStatus,
} from "./company.model";
import { CompanyRepository } from "./company.repository";
import { FieldDefinitionService } from "./field-definition.service";

export class CompanyError extends AppError {
  constructor(code: string, message: string, options?: { cause?: unknown }) {
    super(code, { message, cause: options?.cause });
    this.name = "CompanyError";
  }
}

export interface CreateCompanyInput {
  organizationId: Types.ObjectId;
  actorId: Types.ObjectId;
  name: string;
  legalName?: string;
  industry?: string;
  website?: string;
  email?: string;
  phone?: string;
  billingAddress?: Address;
  shippingAddress?: Address;
  ownerId: Types.ObjectId;
  status?: CompanyStatus;
  tags?: Types.ObjectId[];
  notes?: string;
  customFields?: Record<string, unknown>;
  size?: number;
  annualRevenue?: number;
  parentId?: Types.ObjectId;
  domain?: string;
}

export interface UpdateCompanyInput {
  name?: string;
  legalName?: string | null;
  industry?: string | null;
  website?: string | null;
  email?: string | null;
  phone?: string | null;
  billingAddress?: Address | null;
  shippingAddress?: Address | null;
  ownerId?: Types.ObjectId;
  status?: CompanyStatus;
  tags?: Types.ObjectId[];
  notes?: string | null;
  customFields?: Record<string, unknown>;
  size?: number | null;
  annualRevenue?: number | null;
  parentId?: Types.ObjectId | null;
  domain?: string | null;
}

/**
 * Company service.
 *
 * Handles company CRUD, hierarchy, and domain-based auto-association.
 * Custom fields are validated against field definitions.
 */
export class CompanyService {
  private repo: CompanyRepository;
  private fieldDefService: FieldDefinitionService;

  constructor(
    organizationId: Types.ObjectId | string,
    actorId?: Types.ObjectId | string | null,
  ) {
    this.repo = new CompanyRepository(organizationId, actorId);
    this.fieldDefService = new FieldDefinitionService(organizationId, actorId);
  }

  /** Create a new company. */
  async create(input: CreateCompanyInput): Promise<Company> {
    // Validate custom fields
    if (input.customFields) {
      const validation = await this.fieldDefService.validateValues(
        "COMPANY",
        input.customFields,
      );
      if (!validation.valid) {
        throw new CompanyError("VALIDATION_FAILED", "Invalid custom fields.", {
          cause: validation.errors,
        });
      }
      input.customFields = await this.fieldDefService.coerceValues(
        "COMPANY",
        input.customFields,
      );
    }

    // Validate parent company exists and is in same org
    if (input.parentId) {
      const parent = await this.repo.findById(input.parentId);
      if (!parent) {
        throw new CompanyError(
          "VALIDATION_FAILED",
          "Parent company not found.",
        );
      }
    }

    // Normalize domain
    if (input.domain) {
      input.domain = this.extractDomain(input.domain);
      const existing = await this.repo.findByDomain(input.domain);
      if (existing) {
        throw new CompanyError(
          "CONFLICT",
          `A company with domain "${input.domain}" already exists.`,
        );
      }
    }

    const company = await this.repo.create({
      name: input.name.trim(),
      legalName: input.legalName?.trim() ?? null,
      industry: input.industry?.trim() ?? null,
      website: input.website?.trim() ?? null,
      email: input.email?.toLowerCase().trim() ?? null,
      phone: input.phone?.trim() ?? null,
      billingAddress: input.billingAddress ?? null,
      shippingAddress: input.shippingAddress ?? null,
      ownerId: input.ownerId,
      status: input.status ?? "PROSPECT",
      tags: input.tags ?? [],
      notes: input.notes?.trim() ?? null,
      customFields: input.customFields ?? {},
      size: input.size ?? null,
      annualRevenue: input.annualRevenue ?? null,
      parentId: input.parentId ?? null,
      domain: input.domain ?? null,
    });

    await events.emit("company.created", {
      organizationId: input.organizationId,
      companyId: company._id,
      name: company.name,
      actorId: input.actorId,
    });

    return company;
  }

  /** Update a company. */
  async update(
    companyId: Types.ObjectId | string,
    input: UpdateCompanyInput,
    actorId: Types.ObjectId,
  ): Promise<Company> {
    const existing = await this.repo.findById(companyId);
    if (!existing) {
      throw new CompanyError("RECORD_NOT_FOUND", "Company not found.");
    }

    // Validate custom fields
    if (input.customFields) {
      const validation = await this.fieldDefService.validateValues(
        "COMPANY",
        input.customFields,
      );
      if (!validation.valid) {
        throw new CompanyError("VALIDATION_FAILED", "Invalid custom fields.", {
          cause: validation.errors,
        });
      }
      input.customFields = await this.fieldDefService.coerceValues(
        "COMPANY",
        input.customFields,
      );
    }

    // Validate parent company
    if (input.parentId !== undefined) {
      if (input.parentId && input.parentId.equals(companyId)) {
        throw new CompanyError(
          "VALIDATION_FAILED",
          "A company cannot be its own parent.",
        );
      }
      if (input.parentId) {
        const parent = await this.repo.findById(input.parentId);
        if (!parent) {
          throw new CompanyError(
            "VALIDATION_FAILED",
            "Parent company not found.",
          );
        }
        // Check for circular reference
        if (await this.wouldCreateCycle(companyId, input.parentId)) {
          throw new CompanyError(
            "VALIDATION_FAILED",
            "This would create a circular hierarchy.",
          );
        }
      }
    }

    // Validate domain uniqueness
    if (input.domain !== undefined && input.domain) {
      const normalized = this.extractDomain(input.domain);
      const domainCompany = await this.repo.findByDomain(normalized);
      if (domainCompany && !domainCompany._id.equals(companyId)) {
        throw new CompanyError(
          "CONFLICT",
          `A company with domain "${normalized}" already exists.`,
        );
      }
      input.domain = normalized;
    }

    const changes: Record<string, unknown> = {};
    const fields = [
      "name",
      "legalName",
      "industry",
      "website",
      "email",
      "phone",
      "billingAddress",
      "shippingAddress",
      "ownerId",
      "status",
      "tags",
      "notes",
      "customFields",
      "size",
      "annualRevenue",
      "parentId",
      "domain",
    ] as const;

    for (const field of fields) {
      if (
        input[field] !== undefined &&
        !this.deepEqual(
          input[field],
          (existing as Record<string, unknown>)[field],
        )
      ) {
        changes[field] = input[field];
      }
    }

    if (Object.keys(changes).length === 0) return existing;

    const updated = await this.repo.findByIdAndUpdate(companyId, {
      $set: changes,
    });
    if (!updated) {
      throw new CompanyError(
        "RECORD_NOT_FOUND",
        "Company not found after update.",
      );
    }

    await events.emit("company.updated", {
      organizationId: this.repo.organizationId,
      companyId: existing._id,
      changes,
      actorId,
    });

    return updated;
  }

  /** Soft delete a company. */
  async delete(
    companyId: Types.ObjectId | string,
    actorId: Types.ObjectId,
  ): Promise<void> {
    const existing = await this.repo.findById(companyId);
    if (!existing) {
      throw new CompanyError("RECORD_NOT_FOUND", "Company not found.");
    }

    // Check for dependent contacts
    const { ContactModel } = await import("./contact.model");
    const contactCount = await ContactModel.countDocuments({
      organizationId: this.repo.organizationId,
      companyId,
      deletedAt: null,
    });

    if (contactCount > 0) {
      throw new CompanyError(
        "CONFLICT",
        "Cannot delete a company with contacts. Reassign or delete contacts first.",
      );
    }

    // Check for child companies
    const children = await this.repo.findChildren(companyId);
    if (children.length > 0) {
      throw new CompanyError(
        "CONFLICT",
        "Cannot delete a company with child companies. Reassign or delete children first.",
      );
    }

    await this.repo.softDeleteById(companyId);

    await events.emit("company.deleted", {
      organizationId: this.repo.organizationId,
      companyId: existing._id,
      actorId,
    });
  }

  /** Get a company by ID. */
  async getById(companyId: Types.ObjectId | string): Promise<Company | null> {
    return this.repo.findById(companyId);
  }

  /** List companies with filters and pagination. */
  async list(
    filters: {
      status?: CompanyStatus;
      ownerId?: Types.ObjectId;
      tagIds?: Types.ObjectId[];
      q?: string;
      parentId?: Types.ObjectId | null;
    },
    options: { sort?: string; page?: number; pageSize?: number } = {},
  ) {
    return this.repo.findWithFilters(filters, options);
  }

  /** Get companies for select dropdown. */
  async getForSelect() {
    return this.repo.getForSelect();
  }

  /** Find company by domain (for auto-association). */
  async findByDomain(domain: string): Promise<Company | null> {
    return this.repo.findByDomain(this.extractDomain(domain));
  }

  /** Get child companies. */
  async getChildren(parentId: Types.ObjectId | string) {
    return this.repo.findChildren(parentId);
  }

  /** Get full hierarchy path for a company. */
  async getHierarchyPath(
    companyId: Types.ObjectId | string,
  ): Promise<Company[]> {
    return this.repo.getHierarchyPath(companyId);
  }

  /** Get root ancestor of a company. */
  async getRootAncestor(
    companyId: Types.ObjectId | string,
  ): Promise<Company | null> {
    return this.repo.getRootAncestor(companyId);
  }

  /** Get contact count for a company (direct only). */
  async getContactCount(companyId: Types.ObjectId | string): Promise<number> {
    return this.repo.getContactCount(companyId);
  }

  /** Get contact count including all descendant companies. */
  async getContactCountWithDescendants(
    companyId: Types.ObjectId | string,
  ): Promise<number> {
    return this.repo.getContactCountWithDescendants(companyId);
  }

  /** Get contact counts for multiple companies. */
  async getContactCounts(
    companyIds: (Types.ObjectId | string)[],
  ): Promise<Map<string, number>> {
    return this.repo.getContactCounts(companyIds);
  }

  /** Check if a company is an ancestor of another. */
  async isAncestorOf(
    potentialAncestorId: Types.ObjectId | string,
    companyId: Types.ObjectId | string,
  ): Promise<boolean> {
    return this.repo.isAncestorOf(potentialAncestorId, companyId);
  }

  /** Get all descendant company IDs. */
  async getAllDescendantIds(
    parentId: Types.ObjectId | string,
  ): Promise<Types.ObjectId[]> {
    return this.repo.getAllDescendantIds(parentId);
  }

  private extractDomain(input: string): string {
    try {
      const url = new URL(
        input.startsWith("http") ? input : `https://${input}`,
      );
      return url.hostname.toLowerCase().replace(/^www\./, "");
    } catch {
      return input.toLowerCase().replace(/^www\./, "");
    }
  }

  private async wouldCreateCycle(
    companyId: Types.ObjectId | string,
    newParentId: Types.ObjectId | string,
  ): Promise<boolean> {
    let current = await this.repo.findById(newParentId);
    while (current) {
      if (current._id.equals(companyId)) return true;
      if (!current.parentId) break;
      current = await this.repo.findById(current.parentId);
    }
    return false;
  }

  private deepEqual(a: unknown, b: unknown): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
  }
}
