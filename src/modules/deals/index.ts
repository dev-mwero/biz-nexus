export type { DealStageRef } from "./deal.events";
export {
  DEAL_STATUSES,
  type Deal,
  DealModel,
  type DealStatus,
  dealSchemaDefinition,
} from "./deal.model";

export {
  DEAL_EDITABLE_FIELDS,
  type DealEditableField,
  DealRepository,
  type DealUpdatePayload,
} from "./deal.repository";

export {
  type CreateDealInput,
  DealError,
  DealService,
  type MoveDealInput,
  type MoveDealResult,
  type UpdateDealInput,
} from "./deal.service";
