export {
  type Pipeline,
  PipelineModel,
  type PipelineStage,
  pipelineSchemaDefinition,
} from "./pipeline.model";

export { PipelineRepository } from "./pipeline.repository";

export {
  DEFAULT_PIPELINE_STAGES,
  PipelineError,
  PipelineService,
} from "./pipeline.service";

// Events (re-export for side effects - registers event types)
import "./pipeline.events";
