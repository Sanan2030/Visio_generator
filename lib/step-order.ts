import type { Project, Step, StepType } from "./types";
import { layoutProject } from "./layout";

const ARTIFACT_TYPES = new Set<StepType>(["data", "annotation"]);

/** Form ordering also defines the diagram, Word and Visio step numbers. */
export function moveStepInOrder(project: Project, stepId: string, direction: "up" | "down"): Project {
  const index = project.steps.findIndex((step) => step.id === stepId);
  const destination = index + (direction === "up" ? -1 : 1);
  if (index < 0 || destination < 0 || destination >= project.steps.length) return project;
  const steps = [...project.steps];
  [steps[index], steps[destination]] = [steps[destination], steps[index]];
  return { ...project, steps };
}

/** Insert between a single execution route; ambiguous branches stay untouched. */
export function insertStepAfter(project: Project, afterId: string, newStep: Step): Project {
  const index = project.steps.findIndex((step) => step.id === afterId);
  if (index < 0 || project.steps.length >= 200
    || !/^[a-zA-Z0-9_-]{1,128}$/.test(newStep.id)
    || project.steps.some((step) => step.id === newStep.id)
    || project.pools.some((pool) => pool.id === newStep.id || pool.lanes.some((lane) => lane.id === newStep.id))
    || !project.pools.some((pool) => pool.lanes.some((lane) => lane.id === newStep.laneId))) return project;
  const original = project.steps[index];
  const byId = new Map(project.steps.map((step) => [step.id, step]));
  const flowRouteIndices = original.routes.flatMap((route, routeIndex) => {
    const target = byId.get(route.targetId);
    return target && !ARTIFACT_TYPES.has(target.type) ? [routeIndex] : [];
  });
  let source = original;
  let inserted = newStep;
  const canConnect = original.type !== "end" && !ARTIFACT_TYPES.has(original.type)
    && newStep.type !== "start" && !ARTIFACT_TYPES.has(newStep.type) && !newStep.routes.length;
  if (canConnect && flowRouteIndices.length === 1 && newStep.type !== "end") {
    const routeIndex = flowRouteIndices[0];
    const destination = original.routes[routeIndex].targetId;
    source = { ...original, routes: original.routes.map((route, currentIndex) => currentIndex === routeIndex
      ? { ...route, targetId: newStep.id } : route) };
    inserted = { ...newStep, routes: [{ targetId: destination, label: "" }] };
  } else if (canConnect && !flowRouteIndices.length && original.routes.length < 200
    && original.routes.every((route) => {
      const target = byId.get(route.targetId);
      return target && ARTIFACT_TYPES.has(target.type);
    })) {
    source = { ...original, routes: [...original.routes, { targetId: newStep.id, label: "" }] };
  }
  const next = { ...project, steps: [...project.steps.slice(0, index), source, inserted, ...project.steps.slice(index + 1)] };
  if (inserted.position) return next;
  const layout = layoutProject(next);
  const node = layout.nodes.find(item => item.id === inserted.id);
  const lane = layout.lanes.find(item => item.id === inserted.laneId);
  if (!node || !lane) return next;
  const sameLaneIds = new Set(next.steps.filter(item => item.laneId === inserted.laneId && item.id !== inserted.id).map(item => item.id));
  const others = layout.nodes.filter(item => sameLaneIds.has(item.id));
  let y = node.y;
  for (let attempt = 0; attempt <= others.length; attempt++) {
    if (!others.some(item => node.x < item.x + item.width + 12 && node.x + node.width + 12 > item.x && y < item.y + item.height + 12 && y + node.height + 12 > item.y)) break;
    y += 118;
  }
  return y === node.y ? next : { ...next, steps: next.steps.map(item => item.id === inserted.id
    ? { ...item, position: { x: node.x, y: y - lane.y } } : item) };
}

/** Breadth-first flow order; drafts, notes and disconnected steps are retained. */
export function reorderStepsByFlow(project: Project): Project {
  const starts = project.steps.filter((step) => step.type === "start");
  if (!starts.length) return project;
  const byId = new Map(project.steps.map((step) => [step.id, step]));
  const ordered = [...starts];
  const visited = new Set(starts.map((step) => step.id));
  for (let cursor = 0; cursor < ordered.length; cursor++) {
    for (const route of ordered[cursor].routes) {
      const target = byId.get(route.targetId);
      if (!target || ARTIFACT_TYPES.has(target.type) || visited.has(target.id)) continue;
      visited.add(target.id);
      ordered.push(target);
    }
  }
  ordered.push(...project.steps.filter((step) => !visited.has(step.id)));
  return ordered.every((step, index) => step === project.steps[index]) ? project : { ...project, steps: ordered };
}
