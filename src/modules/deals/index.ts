/**
 * The deals module, which does not exist yet.
 *
 * See `deal.events.ts`. This barrel exists so the event declaration is a real
 * import rather than a file nothing references, and it will be replaced by the
 * module's real barrel when there is one.
 */
export type { DealStageRef } from "./deal.events";
