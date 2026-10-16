import type { DiagramRouteSelection } from "./diagram-edit";
import { clampNodePosition, layoutProject, MAX_NODE_POSITION, MIN_NODE_Y } from "./layout";
import { isProject } from "./process";
import type { LayoutPoint, Project, ProjectLayout, Route, Step, StepPosition, StepType } from "./types";

export interface DiagramInsertionPlacement {
  laneId: string;
  position: StepPosition;
}

export interface DiagramInsertionResult {
  project: Project;
  stepId?: string;
  error?: string;
}

interface InsertionPlan {
  source: Step;
  target: Step;
  route: Route;
  inserted: Step;
  previous?: { source: Step; routeIndex: number; bridge: Route };
}

const ARTIFACT_TYPES = new Set<StepType>(["data", "annotation"]);
const INSERTABLE_TYPES = new Set<StepType>([
  "task", "userTask", "serviceTask", "subprocess", "xor", "or", "and", "intermediate", "message", "timer",
]);

function laneExists(project: Project, laneId: string): boolean {
  return laneId === "" || project.pools.some(pool => pool.lanes.some(lane => lane.id === laneId));
}

/** A bridge can keep both facts when their fields do not disagree. */
function bridgeRoute(incoming: Route, outgoing: Route): Route | null {
  const populated = (value: string | undefined) => Boolean(value?.trim());
  if (populated(incoming.label) && populated(outgoing.label) && incoming.label !== outgoing.label) return null;
  if (populated(incoming.description) && populated(outgoing.description) && incoming.description !== outgoing.description) return null;
  const description = populated(incoming.description) ? incoming.description : populated(outgoing.description)
    ? outgoing.description : incoming.description ?? outgoing.description;
  return {
    targetId: outgoing.targetId,
    label: populated(incoming.label) ? incoming.label : populated(outgoing.label) ? outgoing.label : incoming.label,
    ...(description !== undefined ? { description } : {}),
  };
}

function insertionPlan(project: Project, selection: DiagramRouteSelection, candidate: Step | string): InsertionPlan | string {
  const source = project.steps.find(step => step.id === selection.sourceId);
  if (!source || !Number.isInteger(selection.routeIndex) || selection.routeIndex < 0 || selection.routeIndex >= source.routes.length) {
    return "Arasına addım əlavə ediləcək keçid artıq mövcud deyil.";
  }
  const route = source.routes[selection.routeIndex];
  const target = project.steps.find(step => step.id === route.targetId);
  if (!target || source.id === target.id || source.type === "end"
    || ARTIFACT_TYPES.has(source.type) || ARTIFACT_TYPES.has(target.type)
    || !laneExists(project, source.laneId) || !laneExists(project, target.laneId)) {
    return "Addımı iki mövcud iş addımı arasındakı oxa əlavə edin.";
  }

  const moving = typeof candidate === "string";
  const inserted = moving ? project.steps.find(step => step.id === candidate) : candidate;
  if (!inserted) return "Yerini dəyişəcəyiniz addım artıq mövcud deyil.";
  if (!INSERTABLE_TYPES.has(inserted.type)) return "Başlanğıc, son, sənəd və qeydi oxun arasına əlavə etmək olmaz.";
  if (!laneExists(project, inserted.laneId)) return "Yeni addım üçün mövcud iştirakçı seçin.";
  if (source.id === inserted.id || target.id === inserted.id) return "Addımı öz oxunun arasına keçirmək olmaz.";

  if (!moving) {
    if (project.steps.length >= 200) return "Bir diaqramda maksimum 200 addım ola bilər.";
    if (inserted.id === project.id || project.steps.some(step => step.id === inserted.id)
      || project.pools.some(pool => pool.id === inserted.id || pool.lanes.some(lane => lane.id === inserted.id))) {
      return "Yeni addımın identifikatoru unikal və düzgün olmalıdır.";
    }
    if (inserted.routes.length) return "Yeni addımın əvvəlcədən çəkilmiş çıxış keçidləri olmamalıdır.";
    if (!isProject({ ...project, steps: [inserted] })) return "Yeni addımın məlumatları düzgün deyil.";
    return { source, target, route, inserted };
  }

  const incoming = project.steps.flatMap(step => step.routes.flatMap((item, routeIndex) => item.targetId === inserted.id
    ? [{ source: step, routeIndex, route: item }] : []));
  if (!incoming.length && !inserted.routes.length) return { source, target, route, inserted };
  if (incoming.length !== 1 || inserted.routes.length !== 1) {
    return "Bu addımın bir neçə əlaqəsi var. Qolları qorumaq üçün əlaqələri əvvəlcə ayrıca redaktə edin.";
  }
  const previous = incoming[0];
  const next = project.steps.find(step => step.id === inserted.routes[0].targetId);
  if (!next || previous.source.id === inserted.id || next.id === inserted.id
    || previous.source.id === next.id || previous.source.type === "end"
    || ARTIFACT_TYPES.has(previous.source.type) || ARTIFACT_TYPES.has(next.type)) {
    return "Addımın əvvəlki əlaqələrini təhlükəsiz birləşdirmək mümkün deyil.";
  }
  if (previous.source.routes.some((item, index) => index !== previous.routeIndex && item.targetId === next.id)) {
    return "Əvvəlki iki addım artıq bağlıdır. Əlavə ox yaratmadan əlaqələri ayrıca redaktə edin.";
  }
  const bridge = bridgeRoute(previous.route, inserted.routes[0]);
  if (!bridge) return "Əvvəlki iki oxun etiketləri və ya izahları fərqlidir. Məlumatları qorumaq üçün oxları əvvəlcə ayrıca redaktə edin.";
  return { source, target, route, inserted, previous: { source: previous.source, routeIndex: previous.routeIndex, bridge } };
}

/** Shared eligibility for the drag preview and the atomic graph operation. */
export function canInsertDiagramStepOnRoute(project: Project, selection: DiagramRouteSelection, step: Step | string): boolean {
  return typeof insertionPlan(project, selection, step) !== "string";
}

export function canInsertStepTypeOnRoute(project: Project, selection: DiagramRouteSelection, type: StepType): boolean {
  const source = project.steps.find(step => step.id === selection.sourceId);
  if (!source || !INSERTABLE_TYPES.has(type)) return false;
  const ids = new Set([project.id, ...project.steps.map(step => step.id), ...project.pools.flatMap(pool => [pool.id, ...pool.lanes.map(lane => lane.id)])]);
  let counter = 0;
  let id = "insertion-preview";
  while (ids.has(id)) id = `insertion-preview-${++counter}`;
  return canInsertDiagramStepOnRoute(project, selection, {
    id, laneId: source.laneId, type, title: "Yeni addım", description: "", routes: [],
  });
}

function applyInsertion(
  project: Project, selection: DiagramRouteSelection, candidate: Step | string, placement?: DiagramInsertionPlacement,
): DiagramInsertionResult {
  if (placement && !laneExists(project, placement.laneId)) return { project, error: "Addım üçün mövcud iştirakçı seçin." };
  const prepared = typeof candidate !== "string" && placement
    ? { ...candidate, laneId: placement.laneId, position: clampNodePosition(placement.position, placement.laneId === "") } : candidate;
  const plan = insertionPlan(project, selection, prepared);
  if (typeof plan === "string") return { project, error: plan };
  const moved: Step = {
    ...plan.inserted,
    ...(placement ? { laneId: placement.laneId, position: clampNodePosition(placement.position, placement.laneId === "") } : {}),
    routes: [{ targetId: plan.target.id, label: "" }],
  };
  const steps = project.steps.filter(step => step.id !== moved.id).map(step => {
    if (step.id !== plan.source.id && step.id !== plan.previous?.source.id) return step;
    return { ...step, routes: step.routes.map((route, index) => {
      if (step.id === plan.source.id && index === selection.routeIndex) return { ...plan.route, targetId: moved.id };
      if (step.id === plan.previous?.source.id && index === plan.previous.routeIndex) return plan.previous.bridge;
      return route;
    }) };
  });
  const index = steps.findIndex(step => step.id === plan.source.id);
  steps.splice(index + 1, 0, moved);
  const result = avoidInsertionOverlap({ ...project, steps }, moved.id);
  return result ? { project: result, stepId: moved.id }
    : { project, error: "Bu yerdə addım üçün boş sahə yoxdur. Fiqurların ölçüsünü azaldın və ya addımı başqa yerə əlavə edin." };
}

/** Keep the requested x, expanding the lane downwards instead of covering a task. */
function avoidInsertionOverlap(project: Project, stepId: string): Project | null {
  const step = project.steps.find(candidate => candidate.id === stepId)!;
  const layout = layoutProject(project);
  const node = layout.nodes.find(candidate => candidate.id === stepId);
  const lane = layout.lanes.find(candidate => candidate.id === step.laneId);
  if (!node) return null;
  const laneY = lane?.y ?? 0;
  const ids = new Set(project.steps.filter(candidate => candidate.id !== stepId && candidate.laneId === step.laneId).map(candidate => candidate.id));
  const others = layout.nodes.filter(candidate => ids.has(candidate.id)
    && node.x < candidate.x + candidate.width + 12 && node.x + node.width + 12 > candidate.x);
  const startingY = node.y - laneY;
  const freeY = (start: number): number | null => {
    let y = start;
    for (let attempt = 0; attempt <= others.length && y <= MAX_NODE_POSITION; attempt++) {
      const collisions = others.filter(candidate => y < candidate.y - laneY + candidate.height + 12
        && y + node.height + 12 > candidate.y - laneY);
      if (!collisions.length) return y;
      const bottom = Math.max(...collisions.map(candidate => candidate.y - laneY + candidate.height + 12));
      // Resized shapes may cover several rows, so skip those rows in one jump.
      y += Math.max(1, Math.ceil((bottom - y) / 118)) * 118;
    }
    return null;
  };
  const y = freeY(startingY) ?? freeY(MIN_NODE_Y);
  if (y === null) return null;
  if (y === startingY) return project;
  return { ...project, steps: project.steps.map(candidate => candidate.id === stepId
    ? { ...candidate, position: clampNodePosition({ x: node.x - (lane?.x ?? 16) + 16, y }, step.laneId === "") } : candidate) };
}

/** A → B becomes A → N → B; the original condition belongs to A → N. */
export function insertDiagramStepOnRoute(
  project: Project, selection: DiagramRouteSelection, newStep: Step, placement?: DiagramInsertionPlacement,
): DiagramInsertionResult {
  return applyInsertion(project, selection, newStep, placement);
}

/** Disconnect a safe linear task and insert it elsewhere in one undo entry. */
export function moveDiagramStepOnRoute(
  project: Project, stepId: string, selection: DiagramRouteSelection, placement?: DiagramInsertionPlacement,
): DiagramInsertionResult {
  return applyInsertion(project, selection, stepId, placement);
}

function segmentDistance(point: LayoutPoint, start: LayoutPoint, end: LayoutPoint): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = dx * dx + dy * dy;
  const fraction = length ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / length)) : 0;
  return Math.hypot(point.x - start.x - fraction * dx, point.y - start.y - fraction * dy);
}

/** Diagram-coordinate hit test; the caller converts the screen tolerance by zoom. */
export function findInsertionRoute(
  project: Project, layout: ProjectLayout, point: LayoutPoint, draggedStepId?: string, tolerance = 24,
): DiagramRouteSelection | null {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(tolerance) || tolerance < 0) return null;
  if (layout.nodes.some(node => node.id !== draggedStepId && point.x >= node.x && point.x <= node.x + node.width
    && point.y >= node.y && point.y <= node.y + node.height)) return null;
  let found: DiagramRouteSelection | null = null;
  let closest = tolerance;
  for (const edge of layout.edges) {
    const selection = { sourceId: edge.sourceId, routeIndex: edge.routeIndex };
    const route = project.steps.find(step => step.id === edge.sourceId)?.routes[edge.routeIndex];
    if (route?.targetId !== edge.targetId || !(draggedStepId
      ? canInsertDiagramStepOnRoute(project, selection, draggedStepId)
      : canInsertStepTypeOnRoute(project, selection, "task"))) continue;
    for (let index = 1; index < edge.points.length; index++) {
      const distance = segmentDistance(point, edge.points[index - 1], edge.points[index]);
      if (distance <= tolerance && (!found || distance < closest)) { found = selection; closest = distance; }
    }
  }
  return found;
}
