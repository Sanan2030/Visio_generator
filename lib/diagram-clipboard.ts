import { layoutProject } from "./layout";
import { createId, isProject, MAX_STEP_POSITION } from "./process";
import { hasProjectContent, MAX_STORED_SIZE, parseProject } from "./storage";
import type { Project, ProjectLayout } from "./types";

const PASTE_GAP = 48;

function assertDiagram(project: unknown): asserts project is Project {
  if (!isProject(project)) throw new Error("Kopyalanmış məlumat etibarlı VisioFlow diaqramı deyil.");
  const laneIds = new Set(project.pools.flatMap(pool => pool.lanes.map(lane => lane.id)));
  const stepIds = new Set(project.steps.map(step => step.id));
  for (const step of project.steps) {
    if (step.laneId !== "" && !laneIds.has(step.laneId)) {
      throw new Error("Kopyalanmış diaqramda mövcud olmayan iştirakçıya aid addım var.");
    }
    if (step.routes.some(route => route.targetId !== "" && !stepIds.has(route.targetId))) {
      throw new Error("Kopyalanmış diaqramda mövcud olmayan addıma keçid var.");
    }
  }
}

/** Plain project JSON is portable between the saved clipboard and JSON backups. */
export function serializeDiagram(project: Project): string {
  assertDiagram(project);
  let text: string;
  try { text = JSON.stringify(project); }
  catch { throw new Error("Diaqramı kopyalamaq mümkün olmadı."); }
  if (new TextEncoder().encode(text).byteLength > MAX_STORED_SIZE) {
    throw new Error("Kopyalanacaq diaqram çox böyükdür (maksimum 2 MB).");
  }
  return text;
}

/** Accept unfinished routes, but never carry references outside the copied group. */
export function parseDiagram(text: string): Project {
  const project = parseProject(text, MAX_STORED_SIZE);
  assertDiagram(project);
  return project;
}

function allIds(project: Project): string[] {
  return [project.id, ...project.pools.flatMap(pool => [pool.id, ...pool.lanes.map(lane => lane.id)]),
    ...project.steps.map(step => step.id)];
}

/** Freeze automatic geometry before combining independently laid out diagrams. */
function materialize(project: Project, layout: ProjectLayout, offsetY = 0): Project {
  const pools = new Map(layout.pools.map(pool => [pool.id, pool]));
  const lanes = new Map(layout.lanes.map(lane => [lane.id, lane]));
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  return {
    ...project,
    pools: project.pools.map(pool => {
      const geometry = pools.get(pool.id)!;
      return {
        ...pool,
        position: { x: geometry.x, y: geometry.y + offsetY },
        size: { width: geometry.width, height: geometry.height },
        lanes: pool.lanes.map(lane => ({ ...lane, height: lanes.get(lane.id)!.height })),
      };
    }),
    steps: project.steps.map(step => {
      const node = nodes.get(step.id)!;
      const lane = lanes.get(step.laneId);
      return {
        ...step,
        position: {
          x: node.x - (lane?.x ?? 16) + 16,
          y: node.y - (lane?.y ?? 0) + (lane ? 0 : offsetY),
        },
        ...(step.size ? { size: { ...step.size } } : {}),
        routes: step.routes.map(route => ({ ...route })),
      };
    }),
    ...(project.size ? { size: { ...project.size } } : {}),
  };
}

/** Append one complete diagram atomically, keeping its actors and internal links. */
export function pasteDiagram(
  target: Project,
  source: Project,
  idFactory: () => string = createId,
): { project: Project; stepIds: string[] } {
  assertDiagram(target);
  assertDiagram(source);
  const pristine = !hasProjectContent(target);
  const basePools = pristine ? [] : target.pools;
  if (basePools.length + source.pools.length > 8) throw new Error("Bir diaqramda maksimum 8 pool ola bilər. Yapışdırmaq üçün pool sayını azaldın.");
  if (target.steps.length + source.steps.length > 200) throw new Error("Bir diaqramda maksimum 200 addım ola bilər. Yapışdırmaq üçün addım sayını azaldın.");
  const laneCount = [...basePools, ...source.pools].reduce((sum, pool) => sum + pool.lanes.length, 0);
  if (laneCount > 160) throw new Error("Bir diaqramda maksimum 160 iştirakçı ola bilər.");

  const targetLayout = layoutProject(target);
  const sourceLayout = layoutProject(source);
  const sourceYs = [...sourceLayout.pools.map(pool => pool.y), ...sourceLayout.nodes.map(node => node.y)];
  const sourceTop = sourceYs.length ? Math.min(...sourceYs) : 16;
  const offsetY = pristine ? 0 : targetLayout.height + PASTE_GAP - sourceTop;
  const frozenSource = materialize(source, sourceLayout, offsetY);
  const frozenTarget = pristine ? target : materialize(target, targetLayout);
  const occupied = new Set([...allIds(target), ...allIds(source)]);
  const ids = new Map<string, string>();
  const nextId = () => {
    for (let attempt = 0; attempt < 100; attempt++) {
      let id: string;
      try { id = idFactory(); }
      catch { throw new Error("Yeni diaqram identifikatoru yaratmaq mümkün olmadı."); }
      if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id) || occupied.has(id)) continue;
      occupied.add(id);
      return id;
    }
    throw new Error("Diaqram üçün unikal identifikator yaratmaq mümkün olmadı. Yenidən cəhd edin.");
  };
  for (const pool of source.pools) {
    ids.set(pool.id, nextId());
    for (const lane of pool.lanes) ids.set(lane.id, nextId());
  }
  for (const step of source.steps) ids.set(step.id, nextId());
  const copiedPools = frozenSource.pools.map(pool => ({
    ...pool,
    id: ids.get(pool.id)!,
    lanes: pool.lanes.map(lane => ({ ...lane, id: ids.get(lane.id)! })),
  }));
  const copiedSteps = frozenSource.steps.map(step => ({
    ...step,
    id: ids.get(step.id)!,
    laneId: step.laneId === "" ? "" : ids.get(step.laneId)!,
    routes: step.routes.map(route => ({ ...route, targetId: route.targetId === "" ? "" : ids.get(route.targetId)! })),
  }));
  const project: Project = {
    ...(pristine ? frozenSource : frozenTarget),
    id: target.id,
    name: pristine ? source.name : target.name,
    pools: [...(pristine ? [] : frozenTarget.pools), ...copiedPools],
    steps: [...frozenTarget.steps, ...copiedSteps],
    ...(!pristine ? { size: {
      width: Math.max(targetLayout.width, sourceLayout.width),
      height: Math.max(targetLayout.height, sourceLayout.height + offsetY),
    } } : {}),
  };
  if ((project.size && (project.size.width > MAX_STEP_POSITION || project.size.height > MAX_STEP_POSITION))
    || !isProject(project)) {
    throw new Error("Yapışdırılan diaqramın ölçüləri icazə verilən həddi aşır. Diaqramı yığcamlaşdırın və yenidən cəhd edin.");
  }
  // Check the combined draft, rather than discovering a quota-sized result after editing.
  serializeDiagram(project);
  return { project, stepIds: copiedSteps.map(step => step.id) };
}
