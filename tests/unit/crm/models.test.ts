import { Types } from "mongoose";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { connectToDatabase } from "@/db/connection";
import {
  COMPANY_STATUSES,
  type Company,
  CompanyModel,
  companySchemaDefinition,
} from "@/modules/crm/company.model";
import {
  CONTACT_STATUSES,
  type Contact,
  ContactModel,
  contactSchemaDefinition,
} from "@/modules/crm/contact.model";
import {
  FIELD_ENTITY_TYPES,
  FIELD_TYPES,
  type FieldDefinition,
  FieldDefinitionModel,
  fieldDefinitionSchemaDefinition,
} from "@/modules/crm/field-definition.model";
import {
  LEAD_STATUS_TRANSITIONS,
  LEAD_STATUSES,
  type Lead,
  LeadModel,
  leadSchemaDefinition,
} from "@/modules/crm/lead.model";
import {
  SAVED_VIEW_ENTITY_TYPES,
  type SavedView,
  SavedViewModel,
  savedViewSchemaDefinition,
} from "@/modules/crm/saved-view.model";
import {
  TAG_COLORS,
  type Tag,
  TagModel,
  tagSchemaDefinition,
} from "@/modules/crm/tag.model";

beforeAll(async () => {
  await connectToDatabase();
});

afterEach(async () => {
  await Promise.all([
    TagModel.deleteMany({}),
    FieldDefinitionModel.deleteMany({}),
    SavedViewModel.deleteMany({}),
    CompanyModel.deleteMany({}),
    ContactModel.deleteMany({}),
    LeadModel.deleteMany({}),
  ]);
});

describe("CRM Models", () => {
  const orgId = new Types.ObjectId();
  const userId = new Types.ObjectId();

  describe("Tag Model", () => {
    it("creates a tag with valid data", async () => {
      const tag = await TagModel.create({
        organizationId: orgId,
        name: "VIP",
        color: "blue",
      });

      expect(tag._id).toBeInstanceOf(Types.ObjectId);
      expect(tag.organizationId).toEqual(orgId);
      expect(tag.name).toBe("VIP");
      expect(tag.color).toBe("blue");
      expect(tag.usageCount).toBe(0);
      expect(tag.createdAt).toBeInstanceOf(Date);
      expect(tag.updatedAt).toBeInstanceOf(Date);
    });

    it("defaults color to slate", async () => {
      const tag = await TagModel.create({
        organizationId: orgId,
        name: "Default Color",
      });

      expect(tag.color).toBe("slate");
    });

    it("enforces unique name per organization", async () => {
      await TagModel.create({ organizationId: orgId, name: "Unique" });

      await expect(
        TagModel.create({ organizationId: orgId, name: "Unique" }),
      ).rejects.toThrow();
    });

    it("allows same name in different organizations", async () => {
      const org2 = new Types.ObjectId();
      await TagModel.create({ organizationId: orgId, name: "Shared" });
      await TagModel.create({ organizationId: org2, name: "Shared" });

      const tags = await TagModel.find({ name: "Shared" });
      expect(tags).toHaveLength(2);
    });

    it("validates color enum", async () => {
      await expect(
        TagModel.create({
          organizationId: orgId,
          name: "Bad Color",
          color: "invalid",
        }),
      ).rejects.toThrow();
    });

    it("validates name length", async () => {
      await expect(
        TagModel.create({ organizationId: orgId, name: "" }),
      ).rejects.toThrow();

      await expect(
        TagModel.create({ organizationId: orgId, name: "a".repeat(41) }),
      ).rejects.toThrow();
    });

    it("validates TAG_COLORS constant", () => {
      expect(TAG_COLORS).toContain("slate");
      expect(TAG_COLORS).toContain("blue");
      expect(TAG_COLORS).toContain("red");
      expect(TAG_COLORS.length).toBeGreaterThan(20);
    });

    it("has correct indexes defined", () => {
      const indexes = tagSchemaDefinition.indexes();
      const uniqueIndex = indexes.find((idx) => idx[1].unique);
      expect(uniqueIndex).toBeDefined();
      expect(uniqueIndex![0]).toEqual({ organizationId: 1, name: 1 });
    });
  });

  describe("FieldDefinition Model", () => {
    it("creates a field definition with valid data", async () => {
      const fieldDef = await FieldDefinitionModel.create({
        organizationId: orgId,
        entityType: "CONTACT",
        key: "custom_field",
        label: "Custom Field",
        type: "TEXT",
        required: false,
        order: 0,
      });

      expect(fieldDef._id).toBeInstanceOf(Types.ObjectId);
      expect(fieldDef.organizationId).toEqual(orgId);
      expect(fieldDef.entityType).toBe("CONTACT");
      expect(fieldDef.key).toBe("custom_field");
      expect(fieldDef.label).toBe("Custom Field");
      expect(fieldDef.type).toBe("TEXT");
      expect(fieldDef.options).toEqual([]);
      expect(fieldDef.required).toBe(false);
      expect(fieldDef.order).toBe(0);
    });

    it("enforces unique key per organization and entity type", async () => {
      await FieldDefinitionModel.create({
        organizationId: orgId,
        entityType: "CONTACT",
        key: "duplicate",
        label: "First",
        type: "TEXT",
      });

      await expect(
        FieldDefinitionModel.create({
          organizationId: orgId,
          entityType: "CONTACT",
          key: "duplicate",
          label: "Second",
          type: "TEXT",
        }),
      ).rejects.toThrow();
    });

    it("allows same key for different entity types", async () => {
      await FieldDefinitionModel.create({
        organizationId: orgId,
        entityType: "CONTACT",
        key: "shared",
        label: "Contact Field",
        type: "TEXT",
      });
      await FieldDefinitionModel.create({
        organizationId: orgId,
        entityType: "COMPANY",
        key: "shared",
        label: "Company Field",
        type: "TEXT",
      });

      const fields = await FieldDefinitionModel.find({ key: "shared" });
      expect(fields).toHaveLength(2);
    });

    it("validates key format (snake_case)", async () => {
      await expect(
        FieldDefinitionModel.create({
          organizationId: orgId,
          entityType: "CONTACT",
          key: "InvalidKey",
          label: "Invalid",
          type: "TEXT",
        }),
      ).rejects.toThrow();

      await expect(
        FieldDefinitionModel.create({
          organizationId: orgId,
          entityType: "CONTACT",
          key: "123invalid",
          label: "Invalid",
          type: "TEXT",
        }),
      ).rejects.toThrow();
    });

    it("validates entity type enum", async () => {
      await expect(
        FieldDefinitionModel.create({
          organizationId: orgId,
          entityType: "INVALID",
          key: "test",
          label: "Test",
          type: "TEXT",
        }),
      ).rejects.toThrow();
    });

    it("validates field type enum", async () => {
      await expect(
        FieldDefinitionModel.create({
          organizationId: orgId,
          entityType: "CONTACT",
          key: "test",
          label: "Test",
          type: "INVALID",
        }),
      ).rejects.toThrow();
    });

    it("requires options for SELECT and MULTI_SELECT", async () => {
      await expect(
        FieldDefinitionModel.create({
          organizationId: orgId,
          entityType: "CONTACT",
          key: "select_field",
          label: "Select",
          type: "SELECT",
          options: [],
        }),
      ).rejects.toThrow();
    });

    it("validates FIELD_ENTITY_TYPES constant", () => {
      expect(FIELD_ENTITY_TYPES).toContain("CONTACT");
      expect(FIELD_ENTITY_TYPES).toContain("COMPANY");
      expect(FIELD_ENTITY_TYPES).toContain("LEAD");
      expect(FIELD_ENTITY_TYPES).toContain("DEAL");
      expect(FIELD_ENTITY_TYPES).toContain("TASK");
    });

    it("validates FIELD_TYPES constant", () => {
      expect(FIELD_TYPES).toContain("TEXT");
      expect(FIELD_TYPES).toContain("NUMBER");
      expect(FIELD_TYPES).toContain("DATE");
      expect(FIELD_TYPES).toContain("BOOLEAN");
      expect(FIELD_TYPES).toContain("SELECT");
      expect(FIELD_TYPES).toContain("MULTI_SELECT");
    });

    it("has correct indexes defined", () => {
      const indexes = fieldDefinitionSchemaDefinition.indexes();
      const uniqueIndex = indexes.find((idx) => idx[1].unique);
      expect(uniqueIndex).toBeDefined();
      expect(uniqueIndex![0]).toEqual({
        organizationId: 1,
        entityType: 1,
        key: 1,
      });
    });
  });

  describe("SavedView Model", () => {
    it("creates a saved view with valid data", async () => {
      const view = await SavedViewModel.create({
        organizationId: orgId,
        userId,
        entityType: "CONTACT",
        name: "My View",
        filters: { status: "CUSTOMER" },
        sort: "-createdAt",
        columns: [{ key: "name", width: 200 }],
        isShared: false,
      });

      expect(view._id).toBeInstanceOf(Types.ObjectId);
      expect(view.organizationId).toEqual(orgId);
      expect(view.userId).toEqual(userId);
      expect(view.entityType).toBe("CONTACT");
      expect(view.name).toBe("My View");
      expect(view.filters).toEqual({ status: "CUSTOMER" });
      expect(view.sort).toBe("-createdAt");
      expect(view.columns).toEqual([{ key: "name", width: 200 }]);
      expect(view.isShared).toBe(false);
    });

    it("defaults isShared to false", async () => {
      const view = await SavedViewModel.create({
        organizationId: orgId,
        userId,
        entityType: "CONTACT",
        name: "Default Shared",
      });

      expect(view.isShared).toBe(false);
    });

    it("enforces unique name per user per entity type per organization", async () => {
      await SavedViewModel.create({
        organizationId: orgId,
        userId,
        entityType: "CONTACT",
        name: "Duplicate",
      });

      await expect(
        SavedViewModel.create({
          organizationId: orgId,
          userId,
          entityType: "CONTACT",
          name: "Duplicate",
        }),
      ).rejects.toThrow();
    });

    it("allows same name for different users", async () => {
      const user2 = new Types.ObjectId();
      await SavedViewModel.create({
        organizationId: orgId,
        userId,
        entityType: "CONTACT",
        name: "Shared Name",
      });
      await SavedViewModel.create({
        organizationId: orgId,
        userId: user2,
        entityType: "CONTACT",
        name: "Shared Name",
      });

      const views = await SavedViewModel.find({ name: "Shared Name" });
      expect(views).toHaveLength(2);
    });

    it("validates entity type enum", async () => {
      await expect(
        SavedViewModel.create({
          organizationId: orgId,
          userId,
          entityType: "INVALID",
          name: "Test",
        }),
      ).rejects.toThrow();
    });

    it("validates SAVED_VIEW_ENTITY_TYPES constant", () => {
      expect(SAVED_VIEW_ENTITY_TYPES).toContain("CONTACT");
      expect(SAVED_VIEW_ENTITY_TYPES).toContain("COMPANY");
      expect(SAVED_VIEW_ENTITY_TYPES).toContain("LEAD");
      expect(SAVED_VIEW_ENTITY_TYPES).toContain("DEAL");
      expect(SAVED_VIEW_ENTITY_TYPES).toContain("TASK");
    });

    it("has correct indexes defined", () => {
      const indexes = savedViewSchemaDefinition.indexes();
      const uniqueIndex = indexes.find((idx) => idx[1].unique);
      expect(uniqueIndex).toBeDefined();
      expect(uniqueIndex![0]).toEqual({
        organizationId: 1,
        userId: 1,
        entityType: 1,
        name: 1,
      });
    });
  });

  describe("Company Model", () => {
    it("creates a company with valid data", async () => {
      const company = await CompanyModel.create({
        organizationId: orgId,
        name: "Acme Corp",
        ownerId: userId,
      });

      expect(company._id).toBeInstanceOf(Types.ObjectId);
      expect(company.organizationId).toEqual(orgId);
      expect(company.name).toBe("Acme Corp");
      expect(company.ownerId).toEqual(userId);
      expect(company.status).toBe("PROSPECT");
      expect(company.tags).toEqual([]);
      expect(company.customFields).toEqual({});
    });

    it("defaults status to PROSPECT", async () => {
      const company = await CompanyModel.create({
        organizationId: orgId,
        name: "Default Status",
        ownerId: userId,
      });

      expect(company.status).toBe("PROSPECT");
    });

    it("validates status enum", async () => {
      await expect(
        CompanyModel.create({
          organizationId: orgId,
          name: "Bad Status",
          ownerId: userId,
          status: "INVALID",
        }),
      ).rejects.toThrow();
    });

    it("validates website URL format", async () => {
      await expect(
        CompanyModel.create({
          organizationId: orgId,
          name: "Bad URL",
          ownerId: userId,
          website: "not-a-url",
        }),
      ).rejects.toThrow();
    });

    it("accepts valid website URLs", async () => {
      const company = await CompanyModel.create({
        organizationId: orgId,
        name: "Good URL",
        ownerId: userId,
        website: "https://example.com",
      });
      expect(company.website).toBe("https://example.com");
    });

    it("validates COMPANY_STATUSES constant", () => {
      expect(COMPANY_STATUSES).toContain("PROSPECT");
      expect(COMPANY_STATUSES).toContain("CUSTOMER");
      expect(COMPANY_STATUSES).toContain("PARTNER");
      expect(COMPANY_STATUSES).toContain("SUPPLIER");
      expect(COMPANY_STATUSES).toContain("INACTIVE");
    });

    it("has correct indexes defined", () => {
      const indexes = companySchemaDefinition.indexes();
      const indexNames = indexes.map((idx) => JSON.stringify(idx[0]));
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, name: 1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, status: 1, createdAt: -1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, ownerId: 1, updatedAt: -1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, domain: 1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({
          organizationId: 1,
          name: "text",
          industry: "text",
          notes: "text",
        }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, tags: 1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, parentId: 1 }),
      );
    });
  });

  describe("Contact Model", () => {
    it("creates a contact with valid data", async () => {
      const contact = await ContactModel.create({
        organizationId: orgId,
        firstName: "John",
        lastName: "Doe",
        ownerId: userId,
      });

      expect(contact._id).toBeInstanceOf(Types.ObjectId);
      expect(contact.organizationId).toEqual(orgId);
      expect(contact.firstName).toBe("John");
      expect(contact.lastName).toBe("Doe");
      expect(contact.ownerId).toEqual(userId);
      expect(contact.status).toBe("LEAD");
      expect(contact.emails).toEqual([]);
      expect(contact.phones).toEqual([]);
      expect(contact.tags).toEqual([]);
      expect(contact.customFields).toEqual({});
    });

    it("defaults status to LEAD", async () => {
      const contact = await ContactModel.create({
        organizationId: orgId,
        firstName: "Jane",
        lastName: "Smith",
        ownerId: userId,
      });

      expect(contact.status).toBe("LEAD");
    });

    it("validates status enum", async () => {
      await expect(
        ContactModel.create({
          organizationId: orgId,
          firstName: "Bad",
          lastName: "Status",
          ownerId: userId,
          status: "INVALID",
        }),
      ).rejects.toThrow();
    });

    it("handles multiple emails with primary flag", async () => {
      const contact = await ContactModel.create({
        organizationId: orgId,
        firstName: "Multi",
        lastName: "Email",
        ownerId: userId,
        emails: [
          { label: "Work", value: "work@example.com", isPrimary: true },
          {
            label: "Personal",
            value: "personal@example.com",
            isPrimary: false,
          },
        ],
        primaryEmail: "work@example.com",
      });

      expect(contact.emails).toHaveLength(2);
      expect(contact.primaryEmail).toBe("work@example.com");
    });

    it("validates CONTACT_STATUSES constant", () => {
      expect(CONTACT_STATUSES).toContain("LEAD");
      expect(CONTACT_STATUSES).toContain("PROSPECT");
      expect(CONTACT_STATUSES).toContain("CUSTOMER");
      expect(CONTACT_STATUSES).toContain("INACTIVE");
    });

    it("has correct indexes defined", () => {
      const indexes = contactSchemaDefinition.indexes();
      const indexNames = indexes.map((idx) => JSON.stringify(idx[0]));
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, lastName: 1, firstName: 1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, companyId: 1, lastName: 1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, ownerId: 1, updatedAt: -1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, status: 1, createdAt: -1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, primaryEmail: 1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, tags: 1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({
          organizationId: 1,
          firstName: "text",
          lastName: "text",
          primaryEmail: "text",
          notes: "text",
        }),
      );
    });
  });

  describe("Lead Model", () => {
    it("creates a lead with valid data", async () => {
      const lead = await LeadModel.create({
        organizationId: orgId,
        title: "Website Inquiry",
        contactSnapshot: {
          firstName: "Jane",
          lastName: "Doe",
          email: "jane@example.com",
        },
        source: "Website",
        ownerId: userId,
      });

      expect(lead._id).toBeInstanceOf(Types.ObjectId);
      expect(lead.organizationId).toEqual(orgId);
      expect(lead.title).toBe("Website Inquiry");
      expect(lead.contactSnapshot.firstName).toBe("Jane");
      expect(lead.contactSnapshot.email).toBe("jane@example.com");
      expect(lead.source).toBe("Website");
      expect(lead.ownerId).toEqual(userId);
      expect(lead.status).toBe("NEW");
      expect(lead.score).toBe(0);
      expect(lead.tags).toEqual([]);
      expect(lead.customFields).toEqual({});
    });

    it("defaults status to NEW", async () => {
      const lead = await LeadModel.create({
        organizationId: orgId,
        title: "Default Status",
        contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
        source: "Test",
        ownerId: userId,
      });

      expect(lead.status).toBe("NEW");
    });

    it("validates status enum", async () => {
      await expect(
        LeadModel.create({
          organizationId: orgId,
          title: "Bad Status",
          contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
          source: "Test",
          ownerId: userId,
          status: "INVALID",
        }),
      ).rejects.toThrow();
    });

    it("validates score range", async () => {
      await expect(
        LeadModel.create({
          organizationId: orgId,
          title: "Bad Score",
          contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
          source: "Test",
          ownerId: userId,
          score: 101,
        }),
      ).rejects.toThrow();

      await expect(
        LeadModel.create({
          organizationId: orgId,
          title: "Bad Score",
          contactSnapshot: { firstName: "A", lastName: "B", email: "a@b.com" },
          source: "Test",
          ownerId: userId,
          score: -1,
        }),
      ).rejects.toThrow();
    });

    it("validates LEAD_STATUSES constant", () => {
      expect(LEAD_STATUSES).toContain("NEW");
      expect(LEAD_STATUSES).toContain("CONTACTED");
      expect(LEAD_STATUSES).toContain("QUALIFIED");
      expect(LEAD_STATUSES).toContain("UNQUALIFIED");
      expect(LEAD_STATUSES).toContain("CONVERTED");
    });

    it("validates LEAD_STATUS_TRANSITIONS", () => {
      expect(LEAD_STATUS_TRANSITIONS.NEW).toContain("CONTACTED");
      expect(LEAD_STATUS_TRANSITIONS.NEW).toContain("UNQUALIFIED");
      expect(LEAD_STATUS_TRANSITIONS.CONTACTED).toContain("QUALIFIED");
      expect(LEAD_STATUS_TRANSITIONS.CONTACTED).toContain("UNQUALIFIED");
      expect(LEAD_STATUS_TRANSITIONS.QUALIFIED).toContain("CONVERTED");
      expect(LEAD_STATUS_TRANSITIONS.QUALIFIED).toContain("UNQUALIFIED");
      expect(LEAD_STATUS_TRANSITIONS.CONVERTED).toEqual([]);
    });

    it("has correct indexes defined", () => {
      const indexes = leadSchemaDefinition.indexes();
      const indexNames = indexes.map((idx) => JSON.stringify(idx[0]));
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, status: 1, createdAt: -1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, ownerId: 1, createdAt: -1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, source: 1, status: 1 }),
      );
      expect(indexNames).toContain(
        JSON.stringify({ organizationId: 1, convertedAt: 1 }),
      );
    });
  });
});
