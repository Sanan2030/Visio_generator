import { MAX_STEP_POSITION } from "./process";
import { getRouteNumber } from "./step-numbering";
import type { DiagramSize, LayoutEdge, LayoutLane, LayoutNode, Project, ProjectLayout, Step, StepPosition, StepType } from "./types";

const COLUMN_PITCH = 300;
const CONTENT_X = 184;
const TASK_WIDTH = 164;
const ROW_PITCH = 118;
const POOL_HEADER = 36;
// The SVG renderer uses a 29px box for two-line route labels.
const CORRIDOR_PITCH = 36;

export const MIN_NODE_X = CONTENT_X;
export const MIN_NODE_Y = 16;
export const MAX_NODE_POSITION = MAX_STEP_POSITION;

/** Keep stored positions in the content area without rounding away pointer movement. */
export function clampNodePosition(position: StepPosition): StepPosition {
  const clamp = (value: number, minimum: number) => Math.round(Math.min(MAX_NODE_POSITION,
    Math.max(minimum, Number.isFinite(value) ? value : minimum)) * 10) / 10;
  return { x: clamp(position.x, MIN_NODE_X), y: clamp(position.y, MIN_NODE_Y) };
}

export function getStepMinimumSize(type: StepType): DiagramSize {
  if (["start", "end", "intermediate", "message", "timer", "xor", "or", "and"].includes(type)) return { width: 40, height: 40 };
  if (type === "data") return { width: 80, height: 50 };
  return { width: 100, height: 50 };
}

function dimensions(type: StepType): DiagramSize {
  if (type === "start" || type === "end" || type === "intermediate" || type === "message" || type === "timer") return { width: 48, height: 48 };
  if (type === "xor" || type === "or" || type === "and") return { width: 58, height: 58 };
  if (type === "data") return { width: 126, height: 76 };
  if (type === "annotation") return { width: 164, height: 66 };
  return { width: TASK_WIDTH, height: 76 };
}

/** Normalize circles and gateways to a square even if an older draft supplied unequal sides. */
export function getStepDimensions(step: Pick<Step, "type" | "size">): DiagramSize {
  if (!step.size) return dimensions(step.type);
  const minimum = getStepMinimumSize(step.type);
  const clamp = (value: number, min: number) => Math.round(Math.max(min,
    Math.min(MAX_NODE_POSITION, Number.isFinite(value) ? value : min)) * 10) / 10;
  const width = clamp(step.size.width, minimum.width);
  const height = clamp(step.size.height, minimum.height);
  if (minimum.width === 40) return { width: Math.max(width, height), height: Math.max(width, height) };
  return { width, height };
}

/** Longest-path columns after removing DFS feedback edges keep loops finite. */
function assignColumns(project: Project): Map<string, number> {
  const byId = new Map(project.steps.map((step) => [step.id, step]));
  const color = new Map<string, number>();
  const feedback = new Set<string>();
  const visit = (id: string) => {
    color.set(id, 1);
    const step = byId.get(id);
    step?.routes.forEach((route, index) => {
      if (!byId.has(route.targetId)) return;
      if (color.get(route.targetId) === 1) feedback.add(`${id}:${index}`);
      else if (!color.has(route.targetId)) visit(route.targetId);
    });
    color.set(id, 2);
  };
  // Stable table order is a tiebreaker; start events establish the main flow.
  for (const step of project.steps.filter((step) => step.type === "start")) if (!color.has(step.id)) visit(step.id);
  for (const step of project.steps) if (!color.has(step.id)) visit(step.id);
  const indegree = new Map(project.steps.map((step) => [step.id, 0]));
  const columns = new Map(project.steps.map((step) => [step.id, 0]));
  for (const step of project.steps) step.routes.forEach((route, index) => {
    if (byId.has(route.targetId) && !feedback.has(`${step.id}:${index}`)) indegree.set(route.targetId, (indegree.get(route.targetId) || 0) + 1);
  });
  const queue = project.steps.filter((step) => indegree.get(step.id) === 0).map((step) => step.id);
  for (let cursor = 0; cursor < queue.length; cursor++) {
    const id = queue[cursor];
    byId.get(id)?.routes.forEach((route, index) => {
      if (!byId.has(route.targetId) || feedback.has(`${id}:${index}`)) return;
      columns.set(route.targetId, Math.max(columns.get(route.targetId) || 0, (columns.get(id) || 0) + 1));
      const count = (indegree.get(route.targetId) || 0) - 1;
      indegree.set(route.targetId, count);
      if (count === 0) queue.push(route.targetId);
    });
  }
  return columns;
}

export function layoutProject(project: Project): ProjectLayout {
  const columns = assignColumns(project);
  const columnCount = Math.max(1, ...columns.values()) + (project.steps.length ? 1 : 0);
  const columnWidths = new Map<number, number>();
  for (const step of project.steps) {
    const column = columns.get(step.id) || 0;
    columnWidths.set(column, Math.max(TASK_WIDTH, columnWidths.get(column) || 0, getStepDimensions(step).width));
  }
  const columnStarts = [CONTENT_X];
  for (let column = 0; column < columnCount; column++) {
    columnStarts.push(columnStarts[column] + Math.max(COLUMN_PITCH, (columnWidths.get(column) || TASK_WIDTH) + 136));
  }
  const columnStart = (column: number) => columnStarts[column] ?? CONTENT_X;
  const columnRight = (column: number) => columnStart(column) + (columnWidths.get(column) || TASK_WIDTH);
  const nodeGeometry = new Map(project.steps.map(step => {
    const size = getStepDimensions(step);
    const position = step.position && clampNodePosition(step.position);
    const column = columns.get(step.id) || 0;
    const x = position?.x ?? columnStart(column) + ((columnWidths.get(column) || TASK_WIDTH) - size.width) / 2;
    return [step.id, { ...size, x, relativeY: position?.y }];
  }));
  const contentWidth = project.size
    ? Math.max(352, ...[...nodeGeometry.values()].map(node => node.x + node.width + 56))
    : Math.max(960, columnRight(columnCount - 1) + 56,
      ...[...nodeGeometry.values()].map(node => node.x + node.width + 56));
  const directRoute = (source: Step, target: Step) => {
    const sourceNode = nodeGeometry.get(source.id)!;
    const targetNode = nodeGeometry.get(target.id)!;
    // Manual movement can reverse an otherwise adjacent pair. Route based on
    // the new geometry instead of treating its old automatic column as truth.
    return targetNode.x - sourceNode.x - sourceNode.width >= 56
      && (source.position !== undefined || target.position !== undefined
        || columns.get(target.id) === (columns.get(source.id) ?? 0) + 1);
  };
  const laneOrder = new Map(project.pools.flatMap(pool => pool.lanes).map((lane, index) => [lane.id, index]));
  const stepIndex = new Map(project.steps.map(step => [step.id, step]));
  const corridorCounts = new Map<string, number>();
  for (const step of project.steps) for (const route of step.routes) {
    const target = stepIndex.get(route.targetId);
    if (!target || directRoute(step, target)) continue;
    const laneId = (laneOrder.get(step.laneId) ?? 0) >= (laneOrder.get(target.laneId) ?? 0) ? step.laneId : target.laneId;
    corridorCounts.set(laneId, (corridorCounts.get(laneId) ?? 0) + 1);
  }
  const pools: ProjectLayout["pools"] = [];
  const lanes: LayoutLane[] = [];
  const nodes: LayoutNode[] = [];
  const stepsByLane = new Map<string, typeof project.steps>();
  for (const step of project.steps) stepsByLane.set(step.laneId, [...(stepsByLane.get(step.laneId) || []), step]);
  let poolY = 16;
  for (const pool of project.pools) {
    const poolNodeGeometry = pool.lanes.flatMap(lane => (stepsByLane.get(lane.id) || []).map(step => nodeGeometry.get(step.id)!));
    const localContentWidth = Math.max(320, ...poolNodeGeometry.map(node => node.x + node.width + 24));
    const poolWidth = pool.size ? Math.max(pool.size.width, localContentWidth)
      : project.size ? Math.max(project.size.width - 32, localContentWidth) : contentWidth - 32;
    const laneContents = pool.lanes.map(lane => {
      const buckets = new Map<number, typeof project.steps>();
      for (const step of stepsByLane.get(lane.id) || []) {
        const column = columns.get(step.id) || 0;
        buckets.set(column, [...(buckets.get(column) || []), step]);
      }
      const stackCount = Math.max(1, ...[...buckets.values()].map((bucket) => bucket.length));
      const rowPitch = Math.max(ROW_PITCH, ...(stepsByLane.get(lane.id) || []).map(step => nodeGeometry.get(step.id)!.height + 42));
      const laneNodes: LayoutNode[] = [];
      for (const bucket of buckets.values()) {
        bucket.forEach((step, index) => {
          const geometry = nodeGeometry.get(step.id)!;
          laneNodes.push({
            id: step.id,
            x: geometry.x,
            y: geometry.relativeY ?? 34 + (stackCount - bucket.length) * rowPitch / 2 + index * rowPitch + (rowPitch - geometry.height) / 2,
            width: geometry.width,
            height: geometry.height,
          });
        });
      }
      const corridorCount = corridorCounts.get(lane.id) ?? 0;
      const nodeBottom = Math.max(0, ...laneNodes.map(node => node.y + node.height));
      const corridorSpace = corridorCount ? 56 + (corridorCount - 1) * CORRIDOR_PITCH : 32;
      const laneHeight = pool.size || project.size ? Math.max(96, nodeBottom + corridorSpace)
        : Math.max(208, stackCount * rowPitch + 108 + Math.max(0, corridorCount - 1) * CORRIDOR_PITCH,
          nodeBottom + corridorSpace);
      return { lane, nodes: laneNodes, height: laneHeight };
    });
    const naturalHeight = Math.max(POOL_HEADER + 96, POOL_HEADER + laneContents.reduce((sum, lane) => sum + lane.height, 0));
    const height = Math.max(naturalHeight, pool.size?.height || 0);
    const extraPerLane = laneContents.length ? (height - naturalHeight) / laneContents.length : 0;
    let laneY = poolY + POOL_HEADER;
    for (const content of laneContents) {
      const laneHeight = content.height + extraPerLane;
      lanes.push({ id: content.lane.id, name: content.lane.name, poolId: pool.id, x: 16, y: laneY, width: poolWidth, height: laneHeight });
      nodes.push(...content.nodes.map(node => ({ ...node, y: node.y + laneY })));
      laneY += laneHeight;
    }
    pools.push({ id: pool.id, name: pool.name, x: 16, y: poolY, width: poolWidth, height });
    poolY += height + 24;
  }
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const stepById = new Map(project.steps.map((step) => [step.id, step]));
  const laneById = new Map(lanes.map((lane) => [lane.id, lane]));
  const incoming: Record<string, string[]> = Object.create(null);
  for (const step of project.steps) step.routes.forEach((route, index) => {
    if (nodeById.has(route.targetId)) (incoming[route.targetId] ||= []).push(`${step.id}:${index}`);
  });
  const edges: LayoutEdge[] = [];
  const corridorUsage = new Map<string, number>();
  for (const step of project.steps) {
    const source = nodeById.get(step.id);
    const sourceLane = laneById.get(step.laneId);
    if (!source || !sourceLane) continue;
    step.routes.forEach((route, routeIndex) => {
      const target = nodeById.get(route.targetId);
      const targetStep = stepById.get(route.targetId);
      const targetLane = targetStep && laneById.get(targetStep.laneId);
      if (!target || !targetStep || !targetLane) return;
      const sourceCount = step.routes.length;
      const targetRoutes = incoming[route.targetId] || [];
      const targetIndex = targetRoutes.indexOf(`${step.id}:${routeIndex}`);
      // Symbol type determines the border: enlarged circles and gateways keep
      // their center-side ports instead of inheriting rectangular staggered ports.
      const isSourceBox = !["start", "end", "intermediate", "message", "timer", "xor", "or", "and"].includes(step.type);
      const isTargetBox = !["start", "end", "intermediate", "message", "timer", "xor", "or", "and"].includes(targetStep.type);
      const sourceY = source.y + source.height / 2 + (isSourceBox ? (routeIndex - (sourceCount - 1) / 2) * Math.min(10, 48 / Math.max(1, sourceCount)) : 0);
      const targetY = target.y + target.height / 2 + (isTargetBox ? (targetIndex - (targetRoutes.length - 1) / 2) * Math.min(10, 48 / Math.max(1, targetRoutes.length)) : 0);
      const sourceX = source.x + source.width;
      const targetX = target.x;
      const sourceColumn = columns.get(step.id) || 0;
      const targetColumn = columns.get(route.targetId) || 0;
      let points: LayoutEdge["points"];
      if (directRoute(step, targetStep)) {
        // The column gap provides a clear vertical channel between lane rows.
        const channelX = (step.position || targetStep.position ? sourceX : columnRight(sourceColumn))
          + 28 + Math.min(routeIndex, 4) * 5;
        points = [{ x: sourceX, y: sourceY }, { x: channelX, y: sourceY }, { x: channelX, y: targetY }, { x: targetX, y: targetY }];
      } else {
        // Long and backward routes use the clear strip below the lane's nodes.
        const corridorLane = sourceLane.y >= targetLane.y ? sourceLane : targetLane;
        const useCount = corridorUsage.get(corridorLane.id) || 0;
        corridorUsage.set(corridorLane.id, useCount + 1);
        const corridorY = corridorLane.y + corridorLane.height - 16 - useCount * CORRIDOR_PITCH;
        const manual = step.position !== undefined || targetStep.position !== undefined;
        const exitX = (manual ? sourceX : columnRight(sourceColumn)) + 28 + (routeIndex % 4) * 4;
        const entryX = (manual ? targetX : columnStart(targetColumn)) - 18 - (targetIndex % 4) * 4;
        points = [
          { x: sourceX, y: sourceY },
          { x: exitX, y: sourceY },
          { x: exitX, y: corridorY },
          { x: entryX, y: corridorY },
          { x: entryX, y: targetY },
          { x: targetX, y: targetY },
        ];
      }
      // Adjacent identical points needlessly complicate exported connectors.
      points = points.filter((point, index) => index === 0 || point.x !== points[index - 1].x || point.y !== points[index - 1].y);
      edges.push({ sourceId: step.id, targetId: route.targetId, routeIndex,
        ...(step.routes.length > 1 ? { branchNumber: getRouteNumber(project, step.id, routeIndex) } : {}),
        label: route.label, points, message: sourceLane.poolId !== targetLane.poolId });
    });
  }
  return { width: Math.max(contentWidth, project.size?.width || 0, ...pools.map(pool => pool.x + pool.width + 16)),
    height: Math.max(240, poolY, project.size?.height || 0), pools, lanes, nodes, edges };
}
