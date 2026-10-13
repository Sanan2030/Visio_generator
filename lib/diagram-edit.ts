import { clampNodePosition, layoutProject } from "./layout";
import type { Project, StepPosition } from "./types";

export interface DiagramRouteSelection {
  sourceId: string;
  routeIndex: number;
}

export interface ReconnectDiagramRouteResult {
  project: Project;
  selection: DiagramRouteSelection;
  error?: string;
}

/** Positions are relative to the destination participant's lane. */
export function moveDiagramStep(project: Project, id: string, position: StepPosition, laneId?: string): Project {
  const step = project.steps.find((candidate) => candidate.id === id);
  if (!step) return project;
  const destination = laneId ?? step.laneId;
  if (!project.pools.some((pool) => pool.lanes.some((lane) => lane.id === destination))) return project;
  const bounded = clampNodePosition(position);
  if (step.laneId === destination && step.position?.x === bounded.x && step.position?.y === bounded.y) return project;
  return { ...project, steps: project.steps.map((candidate) => candidate.id === id
    ? { ...candidate, laneId: destination, position: bounded } : candidate) };
}

/** Move an existing arrow end, preserving its label and full explanation. */
export function reconnectDiagramRoute(
  project: Project,
  selection: DiagramRouteSelection,
  endpoint: "source" | "target",
  nodeId: string,
): ReconnectDiagramRouteResult {
  const unchanged = (error?: string): ReconnectDiagramRouteResult => ({ project, selection, ...(error ? { error } : {}) });
  const source = project.steps.find((step) => step.id === selection.sourceId);
  if (!source || !Number.isInteger(selection.routeIndex) || selection.routeIndex < 0 || selection.routeIndex >= source.routes.length) {
    return unchanged("Redaktə edilən keçid artıq mövcud deyil.");
  }
  const route = source.routes[selection.routeIndex];
  const node = project.steps.find((step) => step.id === nodeId);
  const clearedTarget = endpoint === "target" && nodeId === "";
  if (!node && !clearedTarget) return unchanged("Keçidi mövcud addıma birləşdirin.");
  if (nodeId === (endpoint === "source" ? source.id : route.targetId)) return unchanged();
  const nextSource = endpoint === "source" ? node! : source;
  const nextTargetId = endpoint === "target" ? nodeId : route.targetId;
  // The form can deliberately clear a destination while the draft is unfinished.
  if (nextTargetId !== "" && !project.steps.some((step) => step.id === nextTargetId)) return unchanged("Keçidin hədəfi mövcud deyil.");
  if (nextSource.type === "end") return unchanged("Son hadisəsindən çıxış keçidi çəkmək olmaz.");
  if (nextSource.id === nextTargetId) return unchanged("Addımı özünə birləşdirmək olmaz.");
  if (nextTargetId !== "" && nextSource.routes.some((candidate, index) => candidate.targetId === nextTargetId
    && (nextSource.id !== source.id || index !== selection.routeIndex))) {
    return unchanged("Bu iki addım artıq bağlıdır.");
  }
  if (endpoint === "source" && nextSource.routes.length >= 200) return unchanged("Bir addımda maksimum 200 keçid ola bilər.");

  if (endpoint === "target") {
    return {
      project: { ...project, steps: project.steps.map((step) => step.id === source.id
        ? { ...step, routes: step.routes.map((candidate, index) => index === selection.routeIndex
          ? { ...candidate, targetId: nextTargetId } : candidate) } : step) },
      selection,
    };
  }
  return {
    project: { ...project, steps: project.steps.map((step) => step.id === source.id
      ? { ...step, routes: step.routes.filter((_, index) => index !== selection.routeIndex) }
      : step.id === nextSource.id ? { ...step, routes: [...step.routes, route] } : step) },
    selection: { sourceId: nextSource.id, routeIndex: nextSource.routes.length },
  };
}

/** Copy one shape without creating any unintended execution branches. */
export function duplicateDiagramStep(project: Project, id: string, newId: string): { project: Project; stepId?: string; error?: string } {
  const index = project.steps.findIndex((step) => step.id === id);
  if (index < 0) return { project, error: "Kopyalanacaq addım artıq mövcud deyil." };
  if (project.steps.length >= 200) return { project, error: "Bir diaqramda maksimum 200 addım ola bilər." };
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(newId) || project.steps.some((step) => step.id === newId)
    || project.pools.some((pool) => pool.id === newId || pool.lanes.some((lane) => lane.id === newId))) {
    return { project, error: "Yeni addımın identifikatoru unikal və düzgün olmalıdır." };
  }
  const original = project.steps[index];
  const layout = layoutProject(project);
  const node = layout.nodes.find((candidate) => candidate.id === id);
  const lane = layout.lanes.find((candidate) => candidate.id === original.laneId);
  if (!lane || !node) return { project, error: "Addımın iştirakçısını seçdikdən sonra kopyalayın." };
  const position = original.position ?? { x: node.x, y: node.y - lane.y };
  const copy = { ...original, id: newId, routes: [], position: clampNodePosition({ x: position.x + 24, y: position.y + 24 }) };
  return {
    project: { ...project, steps: [...project.steps.slice(0, index + 1), copy, ...project.steps.slice(index + 1)] },
    stepId: newId,
  };
}
