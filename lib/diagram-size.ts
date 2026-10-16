import { getStepDimensions, getStepMinimumSize, layoutProject } from "./layout";
import { MAX_STEP_POSITION } from "./process";
import type { DiagramSize, Project } from "./types";

export { getStepMinimumSize };
export const MAX_DIAGRAM_SIZE = MAX_STEP_POSITION;
export const MIN_CANVAS_SIZE: DiagramSize = { width: 352, height: 240 };
export const MIN_POOL_SIZE: DiagramSize = { width: 320, height: 132 };

function sameSize(first: DiagramSize | undefined, second: DiagramSize): boolean {
  return first?.width === second.width && first.height === second.height;
}

function clampSize(size: DiagramSize, minimum: DiagramSize, fallback: DiagramSize): DiagramSize {
  const clamp = (value: number, min: number, previous: number) => Math.round(Math.min(MAX_DIAGRAM_SIZE,
    Math.max(min, Number.isFinite(value) ? value : previous)) * 10) / 10;
  return { width: clamp(size.width, minimum.width, fallback.width), height: clamp(size.height, minimum.height, fallback.height) };
}

/** Measure content with the page's presentation minimum removed; explicit pool sizes remain respected. */
export function getProjectMinimumSize(project: Project): DiagramSize {
  const layout = layoutProject({ ...project, size: { width: 1, height: 1 } });
  return { width: layout.width, height: layout.height };
}

/** A pool can shrink to its own content, independently of wider pools or the page. */
export function getPoolMinimumSize(project: Project, poolId: string): DiagramSize {
  const pool = layoutProject({ ...project, pools: project.pools.map(item => item.id === poolId
    ? { ...item, size: { width: 1, height: 1 } } : item) }).pools.find(item => item.id === poolId);
  return pool ? { width: pool.width, height: pool.height } : { ...MIN_POOL_SIZE };
}

/** Configured page extents are bounded; layout still grows if legacy content exceeds them. */
export function resizeProjectCanvas(project: Project, size: DiagramSize): Project {
  const current = layoutProject(project);
  const nextSize = clampSize(size, getProjectMinimumSize(project), current);
  if (sameSize(project.size, nextSize)) return project;
  return { ...project, size: nextSize };
}

export function resizeDiagramPool(project: Project, poolId: string, size: DiagramSize): Project {
  const pool = project.pools.find(item => item.id === poolId);
  if (!pool) return project;
  const current = layoutProject(project).pools.find(item => item.id === poolId)!;
  const nextSize = clampSize(size, getPoolMinimumSize(project, poolId), current);
  if (sameSize(pool.size, nextSize)) return project;
  return { ...project, pools: project.pools.map(item => item.id === poolId ? { ...item, size: nextSize } : item) };
}

export function resizeDiagramStep(project: Project, stepId: string, size: DiagramSize): Project {
  const step = project.steps.find(item => item.id === stepId);
  if (!step) return project;
  const nextSize = getStepDimensions({ type: step.type, size: clampSize(size, getStepMinimumSize(step.type), getStepDimensions(step)) });
  if (sameSize(step.size, nextSize)) return project;
  const layout = step.position ? undefined : layoutProject(project);
  const node = layout?.nodes.find(item => item.id === stepId);
  const lane = layout?.lanes.find(item => item.id === step.laneId);
  // Bottom-right resizing keeps the opposite corner fixed, including shapes
  // that previously used automatic placement; this is one undoable mutation.
  const position = step.position ?? (node ? { x: node.x - (lane?.x ?? 16) + 16, y: node.y - (lane?.y ?? 0) } : undefined);
  return { ...project, steps: project.steps.map(item => item.id === stepId ? { ...item, size: nextSize,
    ...(position ? { position } : {}) } : item) };
}

/** Release both explicit pool dimensions and lane boundaries pinned by a pasted diagram. */
export function resetDiagramPoolSize(project: Project, poolId: string): Project {
  const pool = project.pools.find(item => item.id === poolId);
  if (!pool || (!pool.size && !pool.lanes.some(lane => lane.height !== undefined))) return project;
  return { ...project, pools: project.pools.map(item => {
    if (item.id !== poolId) return item;
    const { size, ...next } = item;
    void size;
    return { ...next, lanes: next.lanes.map(({ height, ...lane }) => { void height; return lane; }) };
  }) };
}
