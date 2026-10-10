import type { Project } from "./types";

/** Numbers follow the explicit step order used by the form and Word table. */
export function getStepNumber(project: Project, stepId: string): string {
  const index = project.steps.findIndex((step) => step.id === stepId);
  return index < 0 ? "" : String(index + 1);
}

export function getRouteNumber(project: Project, stepId: string, routeIndex: number): string {
  const step = project.steps.find((candidate) => candidate.id === stepId);
  if (!step || !Number.isInteger(routeIndex) || routeIndex < 0 || routeIndex >= step.routes.length) return "";
  const number = getStepNumber(project, stepId);
  return step.routes.length > 1 ? `${number}.${routeIndex + 1}` : number;
}

/** Full explanations stay in the inspector; only a compact caption is on the line. */
export function displayRouteLabel(project: Project, stepId: string, routeIndex: number): string {
  const step = project.steps.find((candidate) => candidate.id === stepId);
  const route = step?.routes[routeIndex];
  if (!step || !route) return "";
  const label = route.label.trim();
  if (step.routes.length < 2) return label;
  const number = getRouteNumber(project, stepId, routeIndex);
  return label ? `${number} · ${label}` : number;
}
