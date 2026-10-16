export type StepType =
  | "start"
  | "end"
  | "task"
  | "userTask"
  | "serviceTask"
  | "subprocess"
  | "xor"
  | "or"
  | "and"
  | "intermediate"
  | "message"
  | "timer"
  | "data"
  | "annotation";

export interface Route {
  targetId: string;
  label: string;
  description?: string;
}

export interface StepPosition {
  /** Assigned: x relative to the default pool origin (16), y relative to the lane. Free: absolute canvas coordinates. */
  x: number;
  y: number;
}

/** Physical diagram pixels; optional in version 1 drafts created before resizing. */
export interface DiagramSize {
  width: number;
  height: number;
}

export type StepMetadataKey = "duration" | "system" | "document";

/** Shared form, validation and export definitions; existing drafts omit these fields. */
export const STEP_METADATA_FIELDS = [
  { key: "duration", label: "Müddət (SLA)", maxLength: 300, placeholder: "Məsələn, 2 iş günü" },
  { key: "system", label: "Sistem", maxLength: 500, placeholder: "Məsələn, sənəd dövriyyəsi sistemi" },
  { key: "document", label: "Sənəd", maxLength: 500, placeholder: "Məsələn, müraciət forması" },
] as const satisfies readonly { key: StepMetadataKey; label: string; maxLength: number; placeholder: string }[];

export interface Step {
  id: string;
  /** Empty means intentionally outside every pool. */
  laneId: string;
  type: StepType;
  title: string;
  description: string;
  routes: Route[];
  position?: StepPosition;
  size?: DiagramSize;
  duration?: string;
  system?: string;
  document?: string;
}

export interface Lane {
  id: string;
  name: string;
}

export interface Pool {
  id: string;
  name: string;
  lanes: Lane[];
  position?: StepPosition;
  size?: DiagramSize;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  pools: Pool[];
  steps: Step[];
  size?: DiagramSize;
}

export interface ValidationIssue {
  level: "error" | "warning";
  message: string;
  stepId?: string;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutEdge {
  sourceId: string;
  targetId: string;
  routeIndex: number;
  branchNumber?: string;
  label: string;
  points: LayoutPoint[];
  message: boolean;
}

export interface LayoutPool {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface LayoutLane extends LayoutPool {
  poolId: string;
}

export interface ProjectLayout {
  width: number;
  height: number;
  pools: LayoutPool[];
  lanes: LayoutLane[];
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}
