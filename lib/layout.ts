import type { LayoutEdge, LayoutLane, LayoutNode, Project, ProjectLayout, StepType } from "./types";

const COLUMN_PITCH = 300;
const CONTENT_X = 184;
const TASK_WIDTH = 164;
const ROW_PITCH = 118;
const POOL_HEADER = 36;
// The SVG renderer uses a 29px box for two-line route labels.
const CORRIDOR_PITCH = 36;

function dimensions(type: StepType): { width: number; height: number } {
  if (type === "start" || type === "end" || type === "intermediate" || type === "message" || type === "timer") return { width: 48, height: 48 };
  if (type === "xor" || type === "or" || type === "and") return { width: 58, height: 58 };
  if (type === "data") return { width: 126, height: 76 };
  if (type === "annotation") return { width: 164, height: 66 };
  return { width: TASK_WIDTH, height: 76 };
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
  const width = Math.max(960, CONTENT_X + (columnCount - 1) * COLUMN_PITCH + TASK_WIDTH + 56);
  const laneOrder = new Map(project.pools.flatMap(pool => pool.lanes).map((lane, index) => [lane.id, index]));
  const stepIndex = new Map(project.steps.map(step => [step.id, step]));
  const corridorCounts = new Map<string, number>();
  for (const step of project.steps) for (const route of step.routes) {
    const target = stepIndex.get(route.targetId);
    if (!target || columns.get(target.id) === (columns.get(step.id) ?? 0) + 1) continue;
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
    let laneY = poolY + POOL_HEADER;
    for (const lane of pool.lanes) {
      const buckets = new Map<number, typeof project.steps>();
      for (const step of stepsByLane.get(lane.id) || []) {
        const column = columns.get(step.id) || 0;
        buckets.set(column, [...(buckets.get(column) || []), step]);
      }
      const stackCount = Math.max(1, ...[...buckets.values()].map((bucket) => bucket.length));
      const laneHeight = Math.max(208, stackCount * ROW_PITCH + 108 + Math.max(0, (corridorCounts.get(lane.id) ?? 0) - 1) * CORRIDOR_PITCH);
      lanes.push({ id: lane.id, name: lane.name, poolId: pool.id, x: 16, y: laneY, width: width - 32, height: laneHeight });
      for (const [column, bucket] of buckets) {
        bucket.forEach((step, index) => {
          const size = dimensions(step.type);
          nodes.push({
            id: step.id,
            x: CONTENT_X + column * COLUMN_PITCH + (TASK_WIDTH - size.width) / 2,
            y: laneY + 34 + (stackCount - bucket.length) * ROW_PITCH / 2 + index * ROW_PITCH + (ROW_PITCH - size.height) / 2,
            ...size,
          });
        });
      }
      laneY += laneHeight;
    }
    const height = Math.max(POOL_HEADER + 96, laneY - poolY);
    pools.push({ id: pool.id, name: pool.name, x: 16, y: poolY, width: width - 32, height });
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
      const isSourceBox = source.width > 100;
      const isTargetBox = target.width > 100;
      const sourceY = source.y + source.height / 2 + (isSourceBox ? (routeIndex - (sourceCount - 1) / 2) * Math.min(10, 48 / Math.max(1, sourceCount)) : 0);
      const targetY = target.y + target.height / 2 + (isTargetBox ? (targetIndex - (targetRoutes.length - 1) / 2) * Math.min(10, 48 / Math.max(1, targetRoutes.length)) : 0);
      const sourceX = source.x + source.width;
      const targetX = target.x;
      const sourceColumn = columns.get(step.id) || 0;
      const targetColumn = columns.get(route.targetId) || 0;
      let points: LayoutEdge["points"];
      if (targetColumn === sourceColumn + 1) {
        // The column gap provides a clear vertical channel between lane rows.
        const channelX = CONTENT_X + sourceColumn * COLUMN_PITCH + TASK_WIDTH + 28 + Math.min(routeIndex, 4) * 5;
        points = [{ x: sourceX, y: sourceY }, { x: channelX, y: sourceY }, { x: channelX, y: targetY }, { x: targetX, y: targetY }];
      } else {
        // Long and backward routes use the clear strip below the lane's nodes.
        const corridorLane = sourceLane.y >= targetLane.y ? sourceLane : targetLane;
        const useCount = corridorUsage.get(corridorLane.id) || 0;
        corridorUsage.set(corridorLane.id, useCount + 1);
        const corridorY = corridorLane.y + corridorLane.height - 16 - useCount * CORRIDOR_PITCH;
        const exitX = CONTENT_X + sourceColumn * COLUMN_PITCH + TASK_WIDTH + 28 + (routeIndex % 4) * 4;
        const entryX = CONTENT_X + targetColumn * COLUMN_PITCH - 18 - (targetIndex % 4) * 4;
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
      edges.push({ sourceId: step.id, targetId: route.targetId, label: route.label, points, message: sourceLane.poolId !== targetLane.poolId });
    });
  }
  return { width, height: Math.max(240, poolY), pools, lanes, nodes, edges };
}
