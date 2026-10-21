import type { Types } from "mongoose";

/**
 * Events the quotations module emits.
 *
 * A declaration only: the emitting service is elsewhere, and it compiles
 * against this contract rather than defining it. Events are declared by the
 * module that emits them so subscribers - the activity timeline, and later any
 * notification producer - are written against a shape only this module owns.
 *
 * `quotation.created` is the one event without a revision, because it is
 * emitted for the parent after the first revision has been written and does not
 * describe a transition of it. Every later event names the revision that moved,
 * so a subscriber never has to look up "which one was current at the time".
 */
export interface QuotationEventBase {
  organizationId: Types.ObjectId;
  actorId: Types.ObjectId;
  quotationId: Types.ObjectId;
  number: string;
  companyId: Types.ObjectId;
  contactId: Types.ObjectId | null;
  dealId: Types.ObjectId | null;
  currency: string;
  totalMinor: number;
  occurredAt: Date;
}

export interface QuotationLifecycleEvent extends QuotationEventBase {
  revisionId: Types.ObjectId;
  revisionNumber: number;
}

declare module "@/shared/events/registry" {
  interface DomainEventMap {
    "quotation.created": QuotationEventBase;
    "quotation.sent": QuotationLifecycleEvent;
    "quotation.accepted": QuotationLifecycleEvent;
    "quotation.rejected": QuotationLifecycleEvent;
    "quotation.revised": QuotationLifecycleEvent;
    "quotation.voided": QuotationLifecycleEvent;
    "quotation.converted": QuotationLifecycleEvent & {
      /** The order created by the conversion, for a subscriber that links them. */
      orderId: Types.ObjectId;
    };
  }
}
