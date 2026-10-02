// Models

export type { DealStageRef } from "../deals/deal.events";
// Deals
export {
  DEAL_STATUSES,
  type Deal,
  DealModel,
  type DealStatus,
  dealSchemaDefinition,
} from "../deals/deal.model";
export { DealRepository } from "../deals/deal.repository";
export {
  type CreateDealInput,
  DealError,
  DealService,
  type MoveDealInput,
  type MoveDealResult,
} from "../deals/deal.service";
// Pipelines
export {
  type Pipeline,
  PipelineModel,
  type PipelineStage,
  pipelineSchemaDefinition,
} from "../pipelines/pipeline.model";
export { PipelineRepository } from "../pipelines/pipeline.repository";
export {
  DEFAULT_PIPELINE_STAGES,
  PipelineError,
  PipelineService,
} from "../pipelines/pipeline.service";
export {
  type Address,
  COMPANY_STATUSES,
  type Company,
  CompanyModel,
  type CompanyStatus,
  companySchemaDefinition,
} from "./company.model";
export { CompanyRepository } from "./company.repository";
export {
  CompanyError,
  CompanyService,
  type CreateCompanyInput,
  type UpdateCompanyInput,
} from "./company.service";
export {
  CONTACT_STATUSES,
  type Contact,
  ContactModel,
  type ContactStatus,
  contactSchemaDefinition,
} from "./contact.model";
export { ContactRepository } from "./contact.repository";
export {
  ContactError,
  ContactService,
  type CreateContactInput,
  type UpdateContactInput,
} from "./contact.service";
export {
  FIELD_ENTITY_TYPES,
  FIELD_TYPES,
  type FieldDefinition,
  FieldDefinitionModel,
  type FieldEntityType,
  type FieldType,
  fieldDefinitionSchemaDefinition,
} from "./field-definition.model";
export { FieldDefinitionRepository } from "./field-definition.repository";
export {
  type CreateFieldDefinitionInput,
  FieldDefinitionError,
  FieldDefinitionService,
  type UpdateFieldDefinitionInput,
} from "./field-definition.service";
// Events
export type {
  LeadConvertedPayload,
  LeadCreatedPayload,
  LeadDeletedPayload,
  LeadUpdatedPayload,
} from "./lead.events";
export {
  LEAD_STATUS_TRANSITIONS,
  LEAD_STATUSES,
  type Lead,
  type LeadContactSnapshot,
  LeadModel,
  type LeadStatus,
  leadSchemaDefinition,
} from "./lead.model";
export { LeadRepository } from "./lead.repository";
export {
  type CreateLeadInput,
  type LeadConversionInput,
  LeadError,
  LeadService,
  type UpdateLeadInput,
} from "./lead.service";
export {
  SAVED_VIEW_ENTITY_TYPES,
  type SavedView,
  type SavedViewEntityType,
  SavedViewModel,
  savedViewSchemaDefinition,
} from "./saved-view.model";
export { SavedViewRepository } from "./saved-view.repository";
export {
  type CreateSavedViewInput,
  SavedViewError,
  SavedViewService,
  type UpdateSavedViewInput,
} from "./saved-view.service";
export {
  TAG_COLORS,
  type Tag,
  type TagColor,
  TagModel,
  tagSchemaDefinition,
} from "./tag.model";
// Repositories
export { TagRepository } from "./tag.repository";
// Services
export {
  type CreateTagInput,
  type MergeTagsInput,
  TagError,
  TagService,
  type UpdateTagInput,
} from "./tag.service";
export {
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Task,
  TaskModel,
  type TaskStatus,
  taskSchemaDefinition,
} from "./task.model";
