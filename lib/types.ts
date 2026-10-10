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
  /** Absolute diagram x; y is the top offset within the assigned lane. */
  x: number;
  y: number;
}

export interface Step {
  id: string;
  laneId: string;
  type: StepType;
  title: string;
  description: string;
  routes: Route[];
  position?: StepPosition;
}

export interface Lane {
  id: string;
  name: string;
}

export interface Pool {
  id: string;
  name: string;
  lanes: Lane[];
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  pools: Pool[];
  steps: Step[];
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
