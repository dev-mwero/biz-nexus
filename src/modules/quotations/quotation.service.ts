import { type ClientSession, Types } from "mongoose";
import { withTransaction } from "@/db/transaction";
import { recordAction } from "@/modules/audit/audit.service";
import type { Address } from "@/modules/crm/company.model";
import { CompanyRepository } from "@/modules/crm/company.repository";
import { ContactRepository } from "@/modules/crm/contact.repository";
import { DealRepository } from "@/modules/deals/deal.repository";
import {
  allocateDocumentNumber,
  DOCUMENT_TYPES,
} from "@/modules/document-numbers";
import { UserModel } from "@/modules/identity";
import {
  type Membership,
  MembershipModel,
  OrganizationModel,
} from "@/modules/organizations";
import { ProductRepository } from "@/modules/products/product.repository";
import type {
  CustomerSnapshot,
  Quotation,
  QuotationLine,
  QuotationRepository,
  QuotationRevision,
  QuotationRevisionRepository,
} from "@/modules/quotations";
import { AppError, type ErrorCode } from "@/shared/errors/app-error";
import { events } from "@/shared/events/bus";
import {
  compareCalendarDates,
  isValidCalendarDate,
  todayInTimeZone,
} from "@/shared/lib/calendar";
import {
  calculateDocument,
  calculateLine,
  MAX_LINE_ITEMS,
  MoneyError,
} from "@/shared/lib/money";

/**
 * A quotation operation that could not be carried out.
 *
 * Per-site codes, for the same reason `DealError` names them: a quotation that
 * is not there is a 404 and must stay one, a quotation that is already sent is
 * a 409, and a company or product that is not usable here is a 422 the caller
 * can fix. A single catch-all code would flatten those into one
 * indistinguishable status and leave the route handlers string-matching on
 * messages to tell them apart.
 */
export class QuotationError extends AppError {
  constructor(code: ErrorCode, message: string) {
    super(code, { message });
    this.name = "QuotationError";
  }
}

export interface QuotationDraftLineInput {
  productId: Types.ObjectId | string;
  quantityMilli: number;
  taxRateBps: number;
  unitPriceMinor?: number;
}

export interface CreateQuotationDraftInput {
  companyId: Types.ObjectId | string;
  contactId?: Types.ObjectId | string | null;
  dealId?: Types.ObjectId | string | null;
  ownerId?: Types.ObjectId | string | null;
  validUntil: string;
  terms?: string | null;
  notes?: string | null;
  lineItems: QuotationDraftLineInput[];
}

export interface UpdateQuotationDraftInput {
  contactId?: Types.ObjectId | string | null;
  dealId?: Types.ObjectId | string | null;
  ownerId?: Types.ObjectId | string | null;
  validUntil?: string;
  terms?: string | null;
  notes?: string | null;
  lineItems?: QuotationDraftLineInput[];
}

/**
 * The keys `updateDraft` will accept off the wire, checked by name at runtime.
 *
 * The zod schema and the TypeScript type are both erased by the time this
 * service runs, and an in-process caller is not obliged to have been to the
 * route at all. Every key the client may send is named here; anything else -
 * `companyId`, `number`, `status`, `currency`, the totals - is refused by name
 * rather than silently ignored.
 */
const EDITABLE_FIELD_SET: ReadonlySet<string> = new Set<string>([
  "contactId",
  "dealId",
  "ownerId",
  "validUntil",
  "terms",
  "notes",
  "lineItems",
]);

/**
 * The fields the parent quotation may be updated with.
 */
interface QuotationParentUpdate {
  contactId?: Types.ObjectId | null;
  contactName?: string | null;
  companyName?: string;
  dealId?: Types.ObjectId | null;
  ownerId?: Types.ObjectId;
  validUntil?: string;
  subtotalMinor?: number;
  taxMinor?: number;
  totalMinor?: number;
}

/**
 * Copy one editable field across, if it was supplied.
 *
 * Generic in the key rather than writing `payload[key] = input[key]` inside a
 * loop over the tuple. With a union of keys on the left-hand side TypeScript
 * demands the value satisfy the *intersection* of every payload field type, and
 * a caller reaching for a suppression to get past that is exactly the mistake
 * worth making impossible. Generic, the key is one key, the value's type is the
 * one that belongs to it.
 */
function copyEditableField<
  P extends object,
  S extends object,
  K extends keyof S & keyof P,
>(payload: P, source: S, key: K): void {
  if (key in source) {
    (payload as Record<string, unknown>)[key as string] = source[key];
  }
}

/**
 * Whether two owner references name the same user.
 *
 * An incoming owner is a string from the wire and a stored one is an ObjectId,
 * so `===` would report every same-owner edit as a change and ring the bell for
 * an edit that changed nothing. Comparing the string forms is what makes the
 * comparison mean what it says.
 */
function sameObjectId(
  a: Types.ObjectId | string,
  b: Types.ObjectId | string,
): boolean {
  return String(a) === String(b);
}

function toObjectId(value: Types.ObjectId | string): Types.ObjectId {
  return value instanceof Types.ObjectId ? value : new Types.ObjectId(value);
}

function formatBillingAddress(
  address: Address | null | undefined,
): string | null {
  if (!address) return null;
  const parts = [
    address.line1,
    address.line2,
    address.city,
    address.state,
    address.postalCode,
    address.country,
  ].filter((value): value is string => Boolean(value));
  return parts.length ? parts.join(", ") : null;
}

function buildCustomerSnapshot(
  companyName: string,
  contactName: string | null,
  contactEmail: string | null,
  billingAddress: string | null,
): CustomerSnapshot {
  return {
    companyName,
    contactName,
    contactEmail,
    billingAddress,
  };
}

/**
 * Service for quotation draft operations.
 *
 * Every repository is constructed with the organisation captured from the
 * session (via the quotation repository the caller passes in), never from a
 * request. Multi-document writes run in a single transaction; audit rows join
 * that transaction and events are emitted only after it commits.
 */
export class QuotationService {
  private readonly companyRepo: CompanyRepository;
  private readonly contactRepo: ContactRepository;
  private readonly dealRepo: DealRepository;
  private readonly productRepo: ProductRepository;

  constructor(
    private readonly quotationRepo: QuotationRepository,
    private readonly revisionRepo: QuotationRevisionRepository,
    private readonly actorId: Types.ObjectId,
  ) {
    const organizationId = quotationRepo.organizationId;
    this.companyRepo = new CompanyRepository(organizationId, actorId);
    this.contactRepo = new ContactRepository(organizationId, actorId);
    this.dealRepo = new DealRepository(organizationId, actorId);
    this.productRepo = new ProductRepository(organizationId, actorId);
  }

  /**
   * The audit actor for a write inside a transaction.
   *
   * `RecordActionInput.actor` is `{ id, name }`, not a bare id, and the name is
   * denormalised onto the audit row precisely so the log still reads after the
   * user is deleted. This service is constructed with an id alone, so the name
   * has to be read.
   *
   * Read inside the caller's session rather than separately, so the audit row
   * cannot name an actor that the transaction has not committed. A user who has
   * genuinely been deleted yields "System": that is `recordAction`'s own
   * documented fallback, and it is the honest reading of an actor we can no
   * longer name.
   */
  private async auditActor(session: ClientSession) {
    const actor = await UserModel.findOne({ _id: this.actorId }, undefined, {
      session,
    })
      .select("name")
      .lean<{ name?: string } | null>()
      .exec();

    return { id: this.actorId, name: actor?.name ?? "System" };
  }

  /**
   * Read the organisation the session is acting in, scoped to the transaction.
   *
   * The organisation is global but the session's active organisation is the
   * trust boundary: its timezone and currency come from the database, never
   * from the request.
   */
  private async loadOrganization(
    session: ClientSession,
  ): Promise<{ timezone: string; currency: string }> {
    const organization = await OrganizationModel.findOne(
      { _id: this.quotationRepo.organizationId, deletedAt: null },
      { timezone: 1, currency: 1 },
      { session },
    )
      .lean<{ timezone: string; currency: string } | null>()
      .exec();

    if (!organization) {
      throw new QuotationError(
        "VALIDATION_FAILED",
        "The organisation for this quotation could not be read.",
      );
    }

    return organization;
  }

  /**
   * Confirm a reference exists in this organisation, refusing foreign and absent
   * ids identically with `422 VALIDATION_FAILED`.
   */
  private assertInOrganization<T extends { _id: Types.ObjectId }>(
    record: T | null,
    what: string,
  ): asserts record is T {
    if (!record) {
      throw new QuotationError(
        "VALIDATION_FAILED",
        `That ${what} is not available for this organization.`,
      );
    }
  }

  /**
   * Confirm a membership is active in this organisation.
   */
  private async requireActiveMember(
    userId: Types.ObjectId | string,
    session: ClientSession,
  ): Promise<Types.ObjectId> {
    const membership = await MembershipModel.findOne(
      {
        organizationId: this.quotationRepo.organizationId,
        userId: toObjectId(userId),
        status: "ACTIVE",
        deletedAt: null,
      },
      undefined,
      { session },
    )
      .lean<Membership | null>()
      .exec();

    if (!membership) {
      throw new QuotationError(
        "VALIDATION_FAILED",
        "The owner must be an active member of this organization.",
      );
    }

    return toObjectId(userId);
  }

  /**
   * Validate one quotation line against the catalogue and compute its money.
   *
   * The product must exist in the organisation, be active, and be priced in the
   * organisation's currency. An archived or deleted product cannot be added to
   * a line.
   */
  private async validateLine(
    raw: QuotationDraftLineInput,
    position: number,
    currency: string,
    session: ClientSession,
  ): Promise<{
    line: QuotationLine;
    money: ReturnType<typeof calculateLine>;
  }> {
    const product = await this.productRepo.findOne(
      { _id: raw.productId },
      undefined,
      { session },
    );
    this.assertInOrganization(product, "product");

    if (product.status !== "ACTIVE") {
      throw new QuotationError(
        "VALIDATION_FAILED",
        `The product "${product.name}" is not active.`,
      );
    }

    if (product.currency !== currency) {
      throw new QuotationError(
        "VALIDATION_FAILED",
        `The product "${product.name}" is not priced in the organisation's currency.`,
      );
    }

    const listPriceMinor = product.unitPriceMinor;
    const unitPriceMinor = raw.unitPriceMinor ?? listPriceMinor;

    let money: ReturnType<typeof calculateLine>;
    try {
      money = calculateLine({
        unitPriceMinor,
        quantityMilli: raw.quantityMilli,
        taxRateBps: raw.taxRateBps,
      });
    } catch (error) {
      if (error instanceof MoneyError) {
        throw new QuotationError("VALIDATION_FAILED", error.message);
      }
      throw error;
    }

    const line: QuotationLine = {
      _id: new Types.ObjectId(),
      position,
      productId: toObjectId(raw.productId),
      productName: product.name,
      sku: product.sku ?? null,
      unitLabel: product.unitLabel ?? null,
      listPriceMinor,
      unitPriceMinor,
      quantityMilli: raw.quantityMilli,
      taxRateBps: raw.taxRateBps,
      lineSubtotalMinor: money.subtotalMinor,
      lineTaxMinor: money.taxMinor,
      lineTotalMinor: money.totalMinor,
    };

    return { line, money };
  }

  /**
   * Create a quotation draft: parent, first revision, and number, in one
   * transaction.
   */
  async createDraft(input: CreateQuotationDraftInput): Promise<{
    quotation: Quotation;
    revision: QuotationRevision;
    number: string;
  }> {
    return withTransaction(async (session) => {
      const organizationId = this.quotationRepo.organizationId;
      const actor = await this.auditActor(session);
      const { timezone, currency } = await this.loadOrganization(session);

      // Reject server-owned fields by name. The route schema already lists them
      // as optional so `strictObject` does not treat them as unknown; the
      // service is the second line of defence and refuses them outright.
      for (const key of Object.keys(input)) {
        const allowed = [
          "companyId",
          "contactId",
          "dealId",
          "ownerId",
          "validUntil",
          "terms",
          "notes",
          "lineItems",
        ];
        if (!allowed.includes(key)) {
          throw new QuotationError(
            "VALIDATION_FAILED",
            `The field "${key}" cannot be supplied when creating a quotation.`,
          );
        }
      }

      // --- Company (required) -------------------------------------------
      const company = await this.companyRepo.findOne(
        { _id: input.companyId },
        undefined,
        { session },
      );
      this.assertInOrganization(company, "company");

      // --- Contact (optional) -------------------------------------------
      let contactName: string | null = null;
      let contactEmail: string | null = null;
      let contactId: Types.ObjectId | null = null;
      if (input.contactId != null) {
        const contact = await this.contactRepo.findOne(
          { _id: input.contactId },
          undefined,
          { session },
        );
        this.assertInOrganization(contact, "contact");
        if (
          contact.companyId &&
          !sameObjectId(contact.companyId, input.companyId)
        ) {
          throw new QuotationError(
            "VALIDATION_FAILED",
            "That contact does not belong to the quotation's company.",
          );
        }
        contactId = toObjectId(input.contactId);
        contactName = `${contact.firstName} ${contact.lastName}`.trim();
        contactEmail = contact.primaryEmail ?? null;
      }

      // --- Deal (optional) ----------------------------------------------
      if (input.dealId != null) {
        const deal = await this.dealRepo.findOne(
          { _id: input.dealId },
          undefined,
          { session },
        );
        this.assertInOrganization(deal, "deal");
        if (deal.companyId && !sameObjectId(deal.companyId, input.companyId)) {
          throw new QuotationError(
            "VALIDATION_FAILED",
            "That deal does not belong to the quotation's company.",
          );
        }
      }

      // --- Owner --------------------------------------------------------
      const ownerId = await this.requireActiveMember(
        input.ownerId ?? this.actorId,
        session,
      );

      // --- Validity date ------------------------------------------------
      if (!isValidCalendarDate(input.validUntil)) {
        throw new QuotationError(
          "VALIDATION_FAILED",
          "validUntil must be a real calendar date in YYYY-MM-DD format.",
        );
      }
      const today = todayInTimeZone(timezone);
      if (compareCalendarDates(input.validUntil, today) < 0) {
        throw new QuotationError(
          "VALIDATION_FAILED",
          "validUntil must be on or after today in the organisation's timezone.",
        );
      }

      // --- Lines --------------------------------------------------------
      const lineItems = input.lineItems;
      if (lineItems.length < 1 || lineItems.length > MAX_LINE_ITEMS) {
        throw new QuotationError(
          "VALIDATION_FAILED",
          `A quotation must have between 1 and ${MAX_LINE_ITEMS} lines.`,
        );
      }

      const lines: QuotationLine[] = [];
      const lineMoney: ReturnType<typeof calculateLine>[] = [];
      for (let index = 0; index < lineItems.length; index++) {
        const { line, money } = await this.validateLine(
          lineItems[index],
          index,
          currency,
          session,
        );
        lines.push(line);
        lineMoney.push(money);
      }

      const document = calculateDocument(lineMoney);
      const { subtotalMinor, taxMinor, totalMinor } = document;

      // --- Customer snapshot (refreshed while draft) --------------------
      const customerSnapshot = buildCustomerSnapshot(
        company.name,
        contactName,
        contactEmail,
        formatBillingAddress(company.billingAddress),
      );

      // --- Numbering ----------------------------------------------------
      const allocated = await allocateDocumentNumber({
        organizationId,
        documentType: DOCUMENT_TYPES.QUOTATION,
        timeZone: timezone,
        session,
      });
      const number = allocated.number;

      // --- Parent first (its id names the revision) ---------------------
      const quotation = await this.quotationRepo.create(
        {
          number,
          status: "DRAFT",
          currentRevisionId: new Types.ObjectId(), // corrected below
          currentRevisionNumber: 1,
          companyId: toObjectId(input.companyId),
          companyName: company.name,
          contactId: contactId ?? null,
          contactName,
          dealId: input.dealId ? toObjectId(input.dealId) : null,
          ownerId,
          currency,
          validUntil: input.validUntil,
          subtotalMinor,
          taxMinor,
          totalMinor,
        },
        { session },
      );

      // --- Revision #1 --------------------------------------------------
      const revision = await this.revisionRepo.create(
        {
          quotationId: quotation._id,
          revision: 1,
          status: "DRAFT",
          lineItems: lines,
          subtotalMinor,
          taxMinor,
          totalMinor,
          validUntil: input.validUntil,
          terms: input.terms ?? null,
          notes: input.notes ?? null,
          customerSnapshot,
        },
        { session },
      );

      // Correct the pointer so the parent names the revision that was just
      // written, all inside the same transaction.
      const updatedParent = await this.quotationRepo
        .findOneAndUpdate(
          { _id: quotation._id, status: "DRAFT" },
          { $set: { currentRevisionId: revision._id } },
          { session, returnDocument: "after" },
        )
        .lean<Quotation>()
        .exec();
      if (!updatedParent) {
        throw new QuotationError(
          "INVALID_STATE",
          "The quotation could not be linked to its revision.",
        );
      }

      // --- Audit (inside the transaction) -------------------------------
      await recordAction({
        organizationId,
        actor,
        action: "quotation.create",
        entityType: "quotation",
        entityId: updatedParent._id,
        entityLabel: number,
        after: {
          number: updatedParent.number,
          status: updatedParent.status,
          companyId: updatedParent.companyId,
          ownerId: updatedParent.ownerId,
          currency: updatedParent.currency,
          validUntil: updatedParent.validUntil,
          subtotalMinor: updatedParent.subtotalMinor,
          taxMinor: updatedParent.taxMinor,
          totalMinor: updatedParent.totalMinor,
          currentRevisionId: updatedParent.currentRevisionId,
          currentRevisionNumber: updatedParent.currentRevisionNumber,
        },
        session,
      });

      return {
        quotation: updatedParent as Quotation,
        revision: revision as QuotationRevision,
        number,
      };
    }).then(async (result) => {
      // Events are emitted after the transaction commits, never inside it.
      await events.emit("quotation.created", {
        organizationId: result.quotation.organizationId,
        actorId: this.actorId,
        quotationId: result.quotation._id,
        number: result.number,
        companyId: result.quotation.companyId,
        contactId: result.quotation.contactId,
        dealId: result.quotation.dealId,
        currency: result.quotation.currency,
        totalMinor: result.quotation.totalMinor,
        occurredAt: new Date(),
      });
      return result;
    });
  }

  /**
   * Update a quotation draft. Draft-only: `SENT`, `ACCEPTED`, `REJECTED` and
   * `VOID` quotations refuse edits with `409 INVALID_STATE`.
   */
  async updateDraft(
    quotationId: Types.ObjectId | string,
    input: UpdateQuotationDraftInput,
  ): Promise<Quotation | null> {
    return withTransaction(async (session) => {
      const organizationId = this.quotationRepo.organizationId;
      const actor = await this.auditActor(session);
      const { timezone, currency } = await this.loadOrganization(session);

      const existing = await this.quotationRepo
        .findOne({ _id: quotationId }, undefined, { session })
        .lean<Quotation | null>()
        .exec();
      if (!existing) {
        throw new QuotationError("RECORD_NOT_FOUND", "Quotation not found.");
      }
      if (existing.status !== "DRAFT") {
        throw new QuotationError(
          "INVALID_STATE",
          "Only a draft quotation can be updated.",
        );
      }

      // Runtime editable-field allowlist, checked by name.
      for (const key of Object.keys(input)) {
        if (!EDITABLE_FIELD_SET.has(key)) {
          throw new QuotationError(
            "VALIDATION_FAILED",
            `The field "${key}" cannot be updated via this endpoint.`,
          );
        }
      }

      const company = await this.companyRepo.findOne(
        { _id: existing.companyId },
        undefined,
        { session },
      );
      this.assertInOrganization(company, "company");

      const currentRevision = await this.revisionRepo
        .findOne({ _id: existing.currentRevisionId }, undefined, { session })
        .lean<QuotationRevision | null>()
        .exec();
      if (!currentRevision) {
        throw new QuotationError(
          "RECORD_NOT_FOUND",
          "Current revision not found.",
        );
      }

      const parentPayload: QuotationParentUpdate = {};
      let contactId: Types.ObjectId | null = existing.contactId;
      let contactName: string | null = existing.contactName;
      let contactEmail: string | null =
        currentRevision.customerSnapshot.contactEmail ?? null;

      if ("contactId" in input) {
        if (input.contactId == null) {
          contactId = null;
          contactName = null;
          contactEmail = null;
        } else {
          const contact = await this.contactRepo.findOne(
            { _id: input.contactId },
            undefined,
            { session },
          );
          this.assertInOrganization(contact, "contact");
          if (
            contact.companyId &&
            !sameObjectId(contact.companyId, existing.companyId)
          ) {
            throw new QuotationError(
              "VALIDATION_FAILED",
              "That contact does not belong to the quotation's company.",
            );
          }
          contactId = toObjectId(input.contactId);
          contactName = `${contact.firstName} ${contact.lastName}`.trim();
          contactEmail = contact.primaryEmail ?? null;
        }
        copyEditableField(parentPayload, input, "contactId");
        parentPayload.contactId = contactId;
        parentPayload.contactName = contactName;
      }

      let dealId: Types.ObjectId | null = existing.dealId;
      if ("dealId" in input) {
        if (input.dealId == null) {
          dealId = null;
        } else {
          const deal = await this.dealRepo.findOne(
            { _id: input.dealId },
            undefined,
            { session },
          );
          this.assertInOrganization(deal, "deal");
          if (
            deal.companyId &&
            !sameObjectId(deal.companyId, existing.companyId)
          ) {
            throw new QuotationError(
              "VALIDATION_FAILED",
              "That deal does not belong to the quotation's company.",
            );
          }
          dealId = toObjectId(input.dealId);
        }
        copyEditableField(parentPayload, input, "dealId");
        parentPayload.dealId = dealId;
      }

      let ownerId: Types.ObjectId = existing.ownerId;
      if ("ownerId" in input && input.ownerId != null) {
        ownerId = await this.requireActiveMember(input.ownerId, session);
        copyEditableField(parentPayload, input, "ownerId");
        parentPayload.ownerId = ownerId;
      }

      if ("validUntil" in input && input.validUntil !== undefined) {
        if (!isValidCalendarDate(input.validUntil)) {
          throw new QuotationError(
            "VALIDATION_FAILED",
            "validUntil must be a real calendar date in YYYY-MM-DD format.",
          );
        }
        const today = todayInTimeZone(timezone);
        if (compareCalendarDates(input.validUntil, today) < 0) {
          throw new QuotationError(
            "VALIDATION_FAILED",
            "validUntil must be on or after today in the organisation's timezone.",
          );
        }
        copyEditableField(parentPayload, input, "validUntil");
        parentPayload.validUntil = input.validUntil;
      }

      // The company name snapshot is refreshed while a draft is open.
      parentPayload.companyName = company.name;

      // --- Revision payload ---------------------------------------------
      const revisionPayload: Partial<{
        lineItems: QuotationLine[];
        subtotalMinor: number;
        taxMinor: number;
        totalMinor: number;
        validUntil: string;
        terms: string | null;
        notes: string | null;
        customerSnapshot: CustomerSnapshot;
      }> = {};

      copyEditableField(revisionPayload, input, "terms");
      copyEditableField(revisionPayload, input, "notes");

      if ("lineItems" in input && input.lineItems) {
        const lineItems = input.lineItems;
        if (lineItems.length < 1 || lineItems.length > MAX_LINE_ITEMS) {
          throw new QuotationError(
            "VALIDATION_FAILED",
            `A quotation must have between 1 and ${MAX_LINE_ITEMS} lines.`,
          );
        }

        const lines: QuotationLine[] = [];
        const lineMoney: ReturnType<typeof calculateLine>[] = [];
        for (let index = 0; index < lineItems.length; index++) {
          const { line, money } = await this.validateLine(
            lineItems[index],
            index,
            currency,
            session,
          );
          lines.push(line);
          lineMoney.push(money);
        }

        const document = calculateDocument(lineMoney);
        revisionPayload.lineItems = lines;
        revisionPayload.subtotalMinor = document.subtotalMinor;
        revisionPayload.taxMinor = document.taxMinor;
        revisionPayload.totalMinor = document.totalMinor;

        parentPayload.subtotalMinor = document.subtotalMinor;
        parentPayload.taxMinor = document.taxMinor;
        parentPayload.totalMinor = document.totalMinor;
      }

      if (
        "validUntil" in input &&
        input.validUntil !== undefined &&
        input.validUntil !== currentRevision.validUntil
      ) {
        revisionPayload.validUntil = input.validUntil;
        parentPayload.validUntil = input.validUntil;
      }

      // The customer snapshot is refreshed on every draft write and frozen at
      // send.
      revisionPayload.customerSnapshot = buildCustomerSnapshot(
        company.name,
        contactName,
        contactEmail,
        formatBillingAddress(company.billingAddress),
      );

      // --- Writes -------------------------------------------------------
      let updatedParent: Quotation | null = null;
      if (Object.keys(parentPayload).length > 0) {
        updatedParent = (await this.quotationRepo
          .findOneAndUpdate(
            { _id: quotationId, status: "DRAFT" },
            { $set: parentPayload },
            { session, returnDocument: "after" },
          )
          .lean<Quotation>()
          .exec()) as Quotation | null;
        if (!updatedParent) {
          throw new QuotationError(
            "INVALID_STATE",
            "The quotation is no longer a draft.",
          );
        }
      }

      if (Object.keys(revisionPayload).length > 0) {
        await this.revisionRepo.findOneAndUpdate(
          { _id: existing.currentRevisionId, status: "DRAFT" },
          { $set: revisionPayload },
          { session, returnDocument: "after" },
        );
      }

      if (!updatedParent) {
        updatedParent = existing;
      }

      // --- Audit (inside the transaction) -------------------------------
      await recordAction({
        organizationId,
        actor,
        action: "quotation.update",
        entityType: "quotation",
        entityId: updatedParent._id,
        entityLabel: updatedParent.number,
        before: existing as unknown as Record<string, unknown>,
        after: updatedParent as unknown as Record<string, unknown>,
        session,
      });

      return updatedParent;
    });
  }

  /**
   * Create a new revision from a `SENT` or `REJECTED` quotation. The old
   * revision becomes `SUPERSEDED`, the parent returns to `DRAFT`, and the new
   * revision is `DRAFT` with an incremented number.
   */
  async createRevision(quotationId: Types.ObjectId | string): Promise<{
    quotation: Quotation;
    revision: QuotationRevision;
    number: string;
  }> {
    return withTransaction(async (session) => {
      const organizationId = this.quotationRepo.organizationId;
      const actor = await this.auditActor(session);

      const existing = await this.quotationRepo
        .findOne({ _id: quotationId }, undefined, { session })
        .lean<Quotation | null>()
        .exec();
      if (!existing) {
        throw new QuotationError("RECORD_NOT_FOUND", "Quotation not found.");
      }
      if (existing.status !== "SENT" && existing.status !== "REJECTED") {
        throw new QuotationError(
          "INVALID_STATE",
          "A new revision can only be created from a sent or rejected quotation.",
        );
      }

      const currentRevision = await this.revisionRepo
        .findOne({ _id: existing.currentRevisionId }, undefined, { session })
        .lean<QuotationRevision | null>()
        .exec();
      if (!currentRevision) {
        throw new QuotationError(
          "RECORD_NOT_FOUND",
          "Current revision not found.",
        );
      }

      const newRevisionNumber = (existing.currentRevisionNumber ?? 0) + 1;

      const newRevision = await this.revisionRepo.create(
        {
          quotationId: existing._id,
          revision: newRevisionNumber,
          status: "DRAFT",
          lineItems: currentRevision.lineItems,
          subtotalMinor: currentRevision.subtotalMinor,
          taxMinor: currentRevision.taxMinor,
          totalMinor: currentRevision.totalMinor,
          validUntil: currentRevision.validUntil,
          terms: currentRevision.terms,
          notes: currentRevision.notes,
          customerSnapshot: currentRevision.customerSnapshot,
        },
        { session },
      );

      // Mark the old revision superseded.
      await this.revisionRepo.findOneAndUpdate(
        { _id: existing.currentRevisionId },
        { $set: { status: "SUPERSEDED", supersededAt: new Date() } },
        { session, returnDocument: "after" },
      );

      // Return the parent to draft, point it at the new revision, and clear an
      // accepted revision id that pointed at the superseded revision.
      const parentUpdate: Record<string, unknown> = {
        status: "DRAFT",
        currentRevisionId: newRevision._id,
        currentRevisionNumber: newRevisionNumber,
      };
      if (
        existing.acceptedRevisionId &&
        sameObjectId(existing.acceptedRevisionId, existing.currentRevisionId)
      ) {
        parentUpdate.acceptedRevisionId = null;
        parentUpdate.acceptedAt = null;
      }

      const updatedParent = (await this.quotationRepo
        .findOneAndUpdate(
          { _id: quotationId, status: { $in: ["SENT", "REJECTED"] } },
          { $set: parentUpdate },
          { session, returnDocument: "after" },
        )
        .lean<Quotation>()
        .exec()) as Quotation | null;
      if (!updatedParent) {
        throw new QuotationError(
          "INVALID_STATE",
          "The quotation is no longer in a revisable state.",
        );
      }

      // --- Audit (inside the transaction) -------------------------------
      await recordAction({
        organizationId,
        actor,
        action: "quotation.revise",
        entityType: "quotation",
        entityId: updatedParent._id,
        entityLabel: updatedParent.number,
        before: existing as unknown as Record<string, unknown>,
        after: updatedParent as unknown as Record<string, unknown>,
        session,
      });

      return {
        quotation: updatedParent,
        revision: newRevision as QuotationRevision,
        number: updatedParent.number,
      };
    }).then(async (result) => {
      // Events are emitted after the transaction commits, never inside it.
      await events.emit("quotation.revised", {
        organizationId: result.quotation.organizationId,
        actorId: this.actorId,
        quotationId: result.quotation._id,
        number: result.number,
        companyId: result.quotation.companyId,
        contactId: result.quotation.contactId,
        dealId: result.quotation.dealId,
        currency: result.quotation.currency,
        totalMinor: result.quotation.totalMinor,
        revisionId: result.revision._id,
        revisionNumber: result.revision.revision,
        occurredAt: new Date(),
      });
      return result;
    });
  }

  /**
   * Delete a quotation draft. Only `DRAFT` may be deleted: the parent is
   * soft-deleted and the current revision is marked `VOID` in the same
   * transaction. The allocated number is not reused.
   */
  async deleteDraft(quotationId: Types.ObjectId | string): Promise<void> {
    return withTransaction(async (session) => {
      const organizationId = this.quotationRepo.organizationId;
      const actor = await this.auditActor(session);

      const existing = await this.quotationRepo
        .findOne({ _id: quotationId }, undefined, { session })
        .lean<Quotation | null>()
        .exec();
      if (!existing) {
        throw new QuotationError("RECORD_NOT_FOUND", "Quotation not found.");
      }
      if (existing.status !== "DRAFT") {
        throw new QuotationError(
          "INVALID_STATE",
          "Only a draft quotation can be deleted.",
        );
      }

      // Soft-delete the parent.
      await this.quotationRepo.softDeleteById(existing._id, { session });

      // Mark the current revision void so the history has no dangling draft.
      await this.revisionRepo.findOneAndUpdate(
        { _id: existing.currentRevisionId },
        { $set: { status: "VOID", voidedAt: new Date() } },
        { session, returnDocument: "after" },
      );

      // --- Audit (inside the transaction) -------------------------------
      await recordAction({
        organizationId,
        actor,
        action: "quotation.delete",
        entityType: "quotation",
        entityId: existing._id,
        entityLabel: existing.number,
        before: existing as unknown as Record<string, unknown>,
        session,
      });
    });
  }

  /**
   * Derived expiry: whether the quotation's validUntil is strictly before
   * today in the organisation's timezone. An expired quotation may still be
   * revised, but it cannot be sent or accepted.
   */
  async isExpired(quotation: Quotation): Promise<boolean> {
    const organization = await OrganizationModel.findOne(
      { _id: this.quotationRepo.organizationId, deletedAt: null },
      { timezone: 1 },
    )
      .lean<{ timezone: string } | null>()
      .exec();
    if (!organization) {
      throw new QuotationError(
        "VALIDATION_FAILED",
        "The organisation for this quotation could not be read.",
      );
    }
    return this.quoteIsExpired(quotation, organization.timezone);
  }

  /**
   * Pure expiry comparison for a quotation in a given timezone. Used by the
   * send/accept guards (which already loaded the organisation) and by
   * isExpired, so the derived comparison lives in one place.
   */
  private quoteIsExpired(quotation: Quotation, timezone: string): boolean {
    return (
      compareCalendarDates(quotation.validUntil, todayInTimeZone(timezone)) < 0
    );
  }

  /**
   * Send a quotation: parent and current revision both move to SENT, and
   * sentAt is stamped on the revision. Only a draft whose validUntil has not
   * passed may be sent.
   */
  async send(quotationId: Types.ObjectId | string): Promise<{
    quotation: Quotation;
    revision: QuotationRevision;
  }> {
    return withTransaction(async (session) => {
      const organizationId = this.quotationRepo.organizationId;
      const actor = await this.auditActor(session);
      const { timezone } = await this.loadOrganization(session);

      const existing = await this.quotationRepo.findQuotationById(quotationId);
      if (!existing) {
        throw new QuotationError("RECORD_NOT_FOUND", "Quotation not found.");
      }
      if (existing.status !== "DRAFT") {
        throw new QuotationError(
          "INVALID_STATE",
          "Only a draft quotation can be sent.",
        );
      }

      const currentRevision = await this.revisionRepo.findRevisionById(
        existing.currentRevisionId,
      );
      if (!currentRevision) {
        throw new QuotationError(
          "RECORD_NOT_FOUND",
          "Current revision not found.",
        );
      }
      if (currentRevision.status !== "DRAFT") {
        throw new QuotationError(
          "INVALID_STATE",
          "Only a draft revision can be sent.",
        );
      }

      if (this.quoteIsExpired(existing, timezone)) {
        throw new QuotationError(
          "VALIDATION_FAILED",
          "This quotation has expired and cannot be sent.",
        );
      }

      const now = new Date();

      const updatedParent = (await this.quotationRepo
        .findOneAndUpdate(
          { _id: quotationId, status: "DRAFT" },
          { $set: { status: "SENT" } },
          { session, returnDocument: "after" },
        )
        .lean<Quotation>()
        .exec()) as Quotation | null;
      if (!updatedParent) {
        throw new QuotationError(
          "INVALID_STATE",
          "The quotation is no longer a draft.",
        );
      }

      const updatedRevision = (await this.revisionRepo
        .findOneAndUpdate(
          { _id: existing.currentRevisionId, status: "DRAFT" },
          { $set: { status: "SENT", sentAt: now } },
          { session, returnDocument: "after" },
        )
        .lean<QuotationRevision>()
        .exec()) as QuotationRevision | null;
      if (!updatedRevision) {
        throw new QuotationError(
          "INVALID_STATE",
          "The revision is no longer a draft.",
        );
      }

      await recordAction({
        organizationId,
        actor,
        action: "quotation.send",
        entityType: "quotation",
        entityId: updatedParent._id,
        entityLabel: updatedParent.number,
        before: existing as unknown as Record<string, unknown>,
        after: updatedParent as unknown as Record<string, unknown>,
        session,
      });

      return { quotation: updatedParent, revision: updatedRevision };
    }).then(async (result) => {
      await events.emit("quotation.sent", {
        organizationId: result.quotation.organizationId,
        actorId: this.actorId,
        quotationId: result.quotation._id,
        number: result.quotation.number,
        revisionId: result.revision._id,
        revisionNumber: result.revision.revision,
        companyId: result.quotation.companyId,
        contactId: result.quotation.contactId,
        dealId: result.quotation.dealId,
        currency: result.quotation.currency,
        totalMinor: result.quotation.totalMinor,
        occurredAt: new Date(),
      });
      return result;
    });
  }

  /**
   * Accept a sent quotation: parent moves to ACCEPTED, acceptedAt and
   * acceptedRevisionId are stamped, and the current revision moves to ACCEPTED.
   * An expired quotation cannot be accepted, and an already-accepted quotation
   * cannot be accepted again.
   */
  async accept(quotationId: Types.ObjectId | string): Promise<{
    quotation: Quotation;
    revision: QuotationRevision;
  }> {
    return withTransaction(async (session) => {
      const organizationId = this.quotationRepo.organizationId;
      const actor = await this.auditActor(session);
      const { timezone } = await this.loadOrganization(session);

      const existing = await this.quotationRepo.findQuotationById(quotationId);
      if (!existing) {
        throw new QuotationError("RECORD_NOT_FOUND", "Quotation not found.");
      }
      if (existing.status !== "SENT") {
        throw new QuotationError(
          "INVALID_STATE",
          "Only a sent quotation can be accepted.",
        );
      }

      const currentRevision = await this.revisionRepo.findRevisionById(
        existing.currentRevisionId,
      );
      if (!currentRevision) {
        throw new QuotationError(
          "RECORD_NOT_FOUND",
          "Current revision not found.",
        );
      }
      if (currentRevision.status !== "SENT") {
        throw new QuotationError(
          "INVALID_STATE",
          "Only a sent revision can be accepted.",
        );
      }

      // Only one revision may be accepted on a quotation.
      if (
        existing.acceptedRevisionId != null &&
        !sameObjectId(existing.acceptedRevisionId, existing.currentRevisionId)
      ) {
        throw new QuotationError(
          "INVALID_STATE",
          "This quotation has already been accepted.",
        );
      }

      if (this.quoteIsExpired(existing, timezone)) {
        throw new QuotationError(
          "VALIDATION_FAILED",
          "This quotation has expired and cannot be accepted.",
        );
      }

      const now = new Date();

      const updatedParent = (await this.quotationRepo
        .findOneAndUpdate(
          { _id: quotationId, status: "SENT" },
          {
            $set: {
              status: "ACCEPTED",
              acceptedAt: now,
              acceptedRevisionId: existing.currentRevisionId,
            },
          },
          { session, returnDocument: "after" },
        )
        .lean<Quotation>()
        .exec()) as Quotation | null;
      if (!updatedParent) {
        throw new QuotationError(
          "INVALID_STATE",
          "The quotation is no longer sent.",
        );
      }

      const updatedRevision = (await this.revisionRepo
        .findOneAndUpdate(
          { _id: existing.currentRevisionId, status: "SENT" },
          { $set: { status: "ACCEPTED", acceptedAt: now } },
          { session, returnDocument: "after" },
        )
        .lean<QuotationRevision>()
        .exec()) as QuotationRevision | null;
      if (!updatedRevision) {
        throw new QuotationError(
          "INVALID_STATE",
          "The revision is no longer sent.",
        );
      }

      await recordAction({
        organizationId,
        actor,
        action: "quotation.accept",
        entityType: "quotation",
        entityId: updatedParent._id,
        entityLabel: updatedParent.number,
        before: existing as unknown as Record<string, unknown>,
        after: updatedParent as unknown as Record<string, unknown>,
        session,
      });

      return { quotation: updatedParent, revision: updatedRevision };
    }).then(async (result) => {
      await events.emit("quotation.accepted", {
        organizationId: result.quotation.organizationId,
        actorId: this.actorId,
        quotationId: result.quotation._id,
        number: result.quotation.number,
        revisionId: result.revision._id,
        revisionNumber: result.revision.revision,
        companyId: result.quotation.companyId,
        contactId: result.quotation.contactId,
        dealId: result.quotation.dealId,
        currency: result.quotation.currency,
        totalMinor: result.quotation.totalMinor,
        occurredAt: new Date(),
      });
      return result;
    });
  }

  /**
   * Reject a sent quotation: parent and current revision both move to REJECTED
   * with rejectedAt stamped. An optional reason is recorded in the audit
   * metadata. A rejected quotation can be revised to return the parent to DRAFT.
   */
  async reject(
    quotationId: Types.ObjectId | string,
    reason?: string | null,
  ): Promise<{
    quotation: Quotation;
    revision: QuotationRevision;
  }> {
    return withTransaction(async (session) => {
      const organizationId = this.quotationRepo.organizationId;
      const actor = await this.auditActor(session);

      const existing = await this.quotationRepo.findQuotationById(quotationId);
      if (!existing) {
        throw new QuotationError("RECORD_NOT_FOUND", "Quotation not found.");
      }
      if (existing.status !== "SENT") {
        throw new QuotationError(
          "INVALID_STATE",
          "Only a sent quotation can be rejected.",
        );
      }

      const currentRevision = await this.revisionRepo.findRevisionById(
        existing.currentRevisionId,
      );
      if (!currentRevision) {
        throw new QuotationError(
          "RECORD_NOT_FOUND",
          "Current revision not found.",
        );
      }
      if (currentRevision.status !== "SENT") {
        throw new QuotationError(
          "INVALID_STATE",
          "Only a sent revision can be rejected.",
        );
      }

      if (
        reason != null &&
        (typeof reason !== "string" || reason.length < 1 || reason.length > 500)
      ) {
        throw new QuotationError(
          "VALIDATION_FAILED",
          "The reason must be between 1 and 500 characters.",
        );
      }

      const now = new Date();

      const updatedParent = (await this.quotationRepo
        .findOneAndUpdate(
          { _id: quotationId, status: "SENT" },
          { $set: { status: "REJECTED", rejectedAt: now } },
          { session, returnDocument: "after" },
        )
        .lean<Quotation>()
        .exec()) as Quotation | null;
      if (!updatedParent) {
        throw new QuotationError(
          "INVALID_STATE",
          "The quotation is no longer sent.",
        );
      }

      const updatedRevision = (await this.revisionRepo
        .findOneAndUpdate(
          { _id: existing.currentRevisionId, status: "SENT" },
          { $set: { status: "REJECTED", rejectedAt: now } },
          { session, returnDocument: "after" },
        )
        .lean<QuotationRevision>()
        .exec()) as QuotationRevision | null;
      if (!updatedRevision) {
        throw new QuotationError(
          "INVALID_STATE",
          "The revision is no longer sent.",
        );
      }

      const metadata: Record<string, unknown> = {};
      if (reason != null) metadata.reason = reason;

      await recordAction({
        organizationId,
        actor,
        action: "quotation.reject",
        entityType: "quotation",
        entityId: updatedParent._id,
        entityLabel: updatedParent.number,
        before: existing as unknown as Record<string, unknown>,
        after: updatedParent as unknown as Record<string, unknown>,
        metadata,
        session,
      });

      return { quotation: updatedParent, revision: updatedRevision };
    }).then(async (result) => {
      await events.emit("quotation.rejected", {
        organizationId: result.quotation.organizationId,
        actorId: this.actorId,
        quotationId: result.quotation._id,
        number: result.quotation.number,
        revisionId: result.revision._id,
        revisionNumber: result.revision.revision,
        companyId: result.quotation.companyId,
        contactId: result.quotation.contactId,
        dealId: result.quotation.dealId,
        currency: result.quotation.currency,
        totalMinor: result.quotation.totalMinor,
        occurredAt: new Date(),
      });
      return result;
    });
  }

  /**
   * Void a draft or sent quotation: parent and current revision both move to
   * VOID with voidedAt stamped. VOID is terminal: no conversion, no revision,
   * no delete.
   */
  async void(
    quotationId: Types.ObjectId | string,
    reason?: string | null,
  ): Promise<{
    quotation: Quotation;
    revision: QuotationRevision;
  }> {
    return withTransaction(async (session) => {
      const organizationId = this.quotationRepo.organizationId;
      const actor = await this.auditActor(session);

      const existing = await this.quotationRepo.findQuotationById(quotationId);
      if (!existing) {
        throw new QuotationError("RECORD_NOT_FOUND", "Quotation not found.");
      }
      if (existing.status !== "DRAFT" && existing.status !== "SENT") {
        throw new QuotationError(
          "INVALID_STATE",
          "Only a draft or sent quotation can be voided.",
        );
      }

      const currentRevision = await this.revisionRepo.findRevisionById(
        existing.currentRevisionId,
      );
      if (!currentRevision) {
        throw new QuotationError(
          "RECORD_NOT_FOUND",
          "Current revision not found.",
        );
      }
      if (
        currentRevision.status !== "DRAFT" &&
        currentRevision.status !== "SENT"
      ) {
        throw new QuotationError(
          "INVALID_STATE",
          "Only a draft or sent revision can be voided.",
        );
      }

      if (
        reason != null &&
        (typeof reason !== "string" || reason.length < 1 || reason.length > 500)
      ) {
        throw new QuotationError(
          "VALIDATION_FAILED",
          "The reason must be between 1 and 500 characters.",
        );
      }

      const now = new Date();

      const updatedParent = (await this.quotationRepo
        .findOneAndUpdate(
          { _id: quotationId, status: { $in: ["DRAFT", "SENT"] } },
          { $set: { status: "VOID", voidedAt: now } },
          { session, returnDocument: "after" },
        )
        .lean<Quotation>()
        .exec()) as Quotation | null;
      if (!updatedParent) {
        throw new QuotationError(
          "INVALID_STATE",
          "The quotation cannot be voided.",
        );
      }

      const updatedRevision = (await this.revisionRepo
        .findOneAndUpdate(
          {
            _id: existing.currentRevisionId,
            status: { $in: ["DRAFT", "SENT"] },
          },
          { $set: { status: "VOID", voidedAt: now } },
          { session, returnDocument: "after" },
        )
        .lean<QuotationRevision>()
        .exec()) as QuotationRevision | null;
      if (!updatedRevision) {
        throw new QuotationError(
          "INVALID_STATE",
          "The revision cannot be voided.",
        );
      }

      const metadata: Record<string, unknown> = {};
      if (reason != null) metadata.reason = reason;

      await recordAction({
        organizationId,
        actor,
        action: "quotation.void",
        entityType: "quotation",
        entityId: updatedParent._id,
        entityLabel: updatedParent.number,
        before: existing as unknown as Record<string, unknown>,
        after: updatedParent as unknown as Record<string, unknown>,
        metadata,
        session,
      });

      return { quotation: updatedParent, revision: updatedRevision };
    }).then(async (result) => {
      await events.emit("quotation.voided", {
        organizationId: result.quotation.organizationId,
        actorId: this.actorId,
        quotationId: result.quotation._id,
        number: result.quotation.number,
        revisionId: result.revision._id,
        revisionNumber: result.revision.revision,
        companyId: result.quotation.companyId,
        contactId: result.quotation.contactId,
        dealId: result.quotation.dealId,
        currency: result.quotation.currency,
        totalMinor: result.quotation.totalMinor,
        occurredAt: new Date(),
      });
      return result;
    });
  }
}
