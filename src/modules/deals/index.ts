export type { DealStageRef } from "./deal.events";
export {
  DEAL_STATUSES,
  type Deal,
  DealModel,
  type DealStatus,
  dealSchemaDefinition,
} from "./deal.model";

export { DealRepository } from "./deal.repository";

export {
  type CreateDealInput,
  DealError,
  DealService,
  type MoveDealInput,
  type MoveDealResult,
} from "./deal.service";
