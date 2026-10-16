import assert from "node:assert/strict";
import test from "node:test";
import { parseDiagram, pasteDiagram, serializeDiagram } from "../lib/diagram-clipboard";
import { resetDiagramPoolSize } from "../lib/diagram-size";
import { layoutProject } from "../lib/layout";
import { createProject, isProject, MAX_STEP_POSITION } from "../lib/process";
import { MAX_STORED_SIZE } from "../lib/storage";
import type { Project } from "../lib/types";

function fixture(): Project {
  return {
    version: 1, id: "source", name: "Müştəri müraciətləri", size: { width: 1800, height: 1100 },
    pools: [
      { id: "internal", name: "Daxili", position: { x: 116, y: 80 }, size: { width: 1200, height: 650 },
        lanes: [{ id: "operator", name: "Operator" }, { id: "approver", name: "Vizaçı" }] },
      { id: "external", name: "Xarici", lanes: [{ id: "client", name: "Müştəri" }] },
    ],
    steps: [
      { id: "start", laneId: "operator", type: "start", title: "Başla", description: "", routes: [{ targetId: "work", label: "" }] },
      { id: "work", laneId: "approver", type: "userTask", title: "Yoxla", description: "Əsas məlumatları yoxla", position: { x: 520, y: 56 }, size: { width: 220, height: 100 },
        duration: "2 iş günü", system: "QNV", document: "Müraciət", routes: [
          { targetId: "end", label: "Təsdiq", description: "Nəticə müştəriyə göndərilir" },
          { targetId: "start", label: "İmtina", description: "Məlumatı düzəlt" },
          { targetId: "", label: "Sonra seçiləcək" },
        ] },
      { id: "end", laneId: "client", type: "end", title: "Bitir", description: "", routes: [] },
      { id: "note", laneId: "", type: "annotation", title: "Temp_raport_no\nStatus (Rejected)\nİmtina qeydi", description: "Sərbəst qeyd", position: { x: 60, y: 940 }, size: { width: 420, height: 150 }, routes: [{ targetId: "work", label: "", description: "İzah" }] },
    ],
  };
}

function sequence(prefix = "copied"): () => string {
  let index = 0;
  return () => `${prefix}-${++index}`;
}

test("a complete portable snapshot preserves routes, notes, metadata, sizes, and unfinished destinations", () => {
  const source = fixture();
  const before = JSON.stringify(source);
  const text = serializeDiagram(source);
  assert.deepEqual(JSON.parse(text), source);
  const restored = parseDiagram(text);
  assert.deepEqual(restored, source);
  restored.steps[1].routes[0].label = "Dəyişdi";
  assert.equal(JSON.stringify(source), before);
});

test("clipboard parsing rejects broken structure and unknown references without rejecting unfinished drafts", () => {
  const source = fixture();
  assert.doesNotThrow(() => parseDiagram(serializeDiagram(source)));
  assert.throws(() => parseDiagram("bad JSON"), /JSON/);
  assert.throws(() => parseDiagram(JSON.stringify({ ...source, version: 2 })), /etibarlı/);
  for (const sourceId of ["missing", "internal", "operator"]) {
    const dangling = structuredClone(source);
    dangling.steps[0].routes[0].targetId = sourceId;
    assert.throws(() => parseDiagram(JSON.stringify(dangling)), /mövcud olmayan addıma/);
    assert.throws(() => serializeDiagram(dangling), /mövcud olmayan addıma/);
  }
  const missingLane = structuredClone(source);
  missingLane.steps[0].laneId = "work";
  assert.throws(() => parseDiagram(JSON.stringify(missingLane)), /mövcud olmayan iştirakçıya/);
  const duplicateId = structuredClone(source);
  duplicateId.steps[0].id = "internal";
  assert.throws(() => parseDiagram(JSON.stringify(duplicateId)), /etibarlı/);
});

test("pinned lane heights survive snapshots and invalid heights are rejected", () => {
  const source = fixture();
  source.pools[0].lanes[0].height = 360.5;
  assert.equal(parseDiagram(serializeDiagram(source)).pools[0].lanes[0].height, 360.5);
  for (const height of [0, -1, Infinity, NaN, MAX_STEP_POSITION + 1, "300", null]) {
    const malformed = { ...source, pools: [{ ...source.pools[0], lanes: [{ ...source.pools[0].lanes[0], height }] }] };
    assert.equal(isProject(malformed), false);
    assert.throws(() => parseDiagram(JSON.stringify(malformed)), /etibarlı/);
  }
});

test("clipboard size checks use UTF-8 bytes and apply the browser draft limit", () => {
  const source = fixture();
  const text = serializeDiagram(source);
  const bytes = new TextEncoder().encode(text).byteLength;
  assert.ok(bytes > text.length);
  assert.deepEqual(parseDiagram(text + " ".repeat(MAX_STORED_SIZE - bytes)), source);
  assert.throws(() => parseDiagram(text + " ".repeat(MAX_STORED_SIZE - bytes + 1)), /maksimum 2 MB/);
  const large = largeProject("large", 120);
  assert.equal(isProject(large), true);
  assert.throws(() => serializeDiagram(large), /maksimum 2 MB/);
});

test("pasting into a pristine flow replaces its placeholder pool and keeps the entire source geometry", () => {
  const target = createProject();
  const source = fixture();
  const before = JSON.stringify([target, source]);
  const result = pasteDiagram(target, source, sequence());
  assert.equal(result.project.id, target.id);
  assert.equal(result.project.name, source.name);
  assert.deepEqual(result.project.size, source.size);
  assert.equal(result.project.pools.length, source.pools.length);
  assert.ok(!result.project.pools.some(pool => pool.id === target.pools[0].id));
  assert.equal(isProject(result.project), true);
  assert.equal(JSON.stringify([target, source]), before);
  const originalLayout = layoutProject(source);
  const pastedLayout = layoutProject(result.project);
  for (const [index, node] of originalLayout.nodes.entries()) {
    assert.deepEqual({ ...pastedLayout.nodes[index], id: node.id }, node);
  }
  for (const [index, pool] of originalLayout.pools.entries()) {
    assert.deepEqual({ ...pastedLayout.pools[index], id: pool.id }, pool);
  }
  for (const [index, lane] of originalLayout.lanes.entries()) {
    assert.deepEqual({ ...pastedLayout.lanes[index], id: lane.id, poolId: lane.poolId }, lane);
  }
});

test("pasting remaps every pool, actor, step and route even when copying a flow into itself", () => {
  const source = fixture();
  const result = pasteDiagram(source, source, sequence());
  assert.equal(result.project.id, source.id);
  assert.equal(result.project.name, source.name);
  assert.equal(result.project.steps.length, source.steps.length * 2);
  const copiedSteps = result.project.steps.slice(source.steps.length);
  assert.deepEqual(result.stepIds, copiedSteps.map(step => step.id));
  const oldIds = new Set([source.id, ...source.pools.flatMap(pool => [pool.id, ...pool.lanes.map(lane => lane.id)]), ...source.steps.map(step => step.id)]);
  const newPools = result.project.pools.slice(source.pools.length);
  const newLanes = newPools.flatMap(pool => pool.lanes);
  for (const id of [...newPools.map(pool => pool.id), ...newLanes.map(lane => lane.id), ...result.stepIds]) assert.ok(!oldIds.has(id));
  for (let index = 0; index < copiedSteps.length; index++) {
    const old = source.steps[index];
    const copied = copiedSteps[index];
    assert.equal(copied.title, old.title);
    assert.equal(copied.description, old.description);
    assert.deepEqual(copied.size, old.size);
    assert.equal(copied.duration, old.duration);
    assert.equal(copied.system, old.system);
    assert.equal(copied.document, old.document);
    assert.equal(copied.laneId === "", old.laneId === "");
    if (copied.laneId) assert.ok(newLanes.some(lane => lane.id === copied.laneId));
    assert.deepEqual(copied.routes, old.routes.map(route => ({ ...route, targetId: route.targetId === "" ? ""
      : copiedSteps[source.steps.findIndex(step => step.id === route.targetId)].id })));
  }
});

test("appending preserves existing automatic nodes, pools, lane boundaries and route data", () => {
  const target = fixture();
  delete target.size;
  for (const pool of target.pools) { delete pool.size; delete pool.position; }
  for (const step of target.steps) if (step.laneId !== "") delete step.position;
  target.steps.push({ id: "parallel", laneId: "operator", type: "task", title: "Paralel yoxla", description: "", routes: [] });
  const source = fixture();
  source.pools[0].size = { width: 3000, height: 760 };
  const before = JSON.stringify(target);
  const originalLayout = layoutProject(target);
  const result = pasteDiagram(target, source, sequence());
  const after = layoutProject(result.project);
  assert.equal(result.project.id, target.id);
  assert.equal(result.project.name, target.name);
  assert.deepEqual(after.pools.slice(0, target.pools.length), originalLayout.pools);
  assert.deepEqual(after.lanes.slice(0, originalLayout.lanes.length), originalLayout.lanes);
  for (const node of originalLayout.nodes) assert.deepEqual(after.nodes.find(candidate => candidate.id === node.id), node);
  assert.deepEqual(result.project.steps.slice(0, target.steps.length).map(step => step.routes), target.steps.map(step => step.routes));
  assert.equal(JSON.stringify(target), before);
  const pastedPool = after.pools[target.pools.length];
  const pastedNodes = after.nodes.filter(node => result.stepIds.includes(node.id));
  assert.ok(Math.min(pastedPool.y, ...pastedNodes.map(node => node.y)) >= originalLayout.height + 48);
  const originalSource = layoutProject(source);
  const shift = pastedPool.y - originalSource.pools[0].y;
  for (let index = 0; index < source.steps.length; index++) {
    const old = originalSource.nodes.find(node => node.id === source.steps[index].id)!;
    const pasted = after.nodes.find(node => node.id === result.stepIds[index])!;
    assert.deepEqual({ x: pasted.x, y: pasted.y - shift, width: pasted.width, height: pasted.height },
      { x: old.x, y: old.y, width: old.width, height: old.height });
  }
});

test("unequal automatic lane heights and existing placement remain stable through repeated pastes", () => {
  const target: Project = {
    version: 1, id: "unequal", name: "Avtomatik axın",
    pools: [{ id: "unequal-pool", name: "Təşkilat", lanes: [{ id: "one", name: "Bir" }, { id: "two", name: "İki" }, { id: "three", name: "Üç" }] }],
    steps: [
      { id: "a", laneId: "one", type: "task", title: "A", description: "", routes: [{ targetId: "large", label: "" }] },
      { id: "b", laneId: "one", type: "task", title: "B", description: "", routes: [] },
      { id: "c", laneId: "one", type: "task", title: "C", description: "", routes: [] },
      { id: "large", laneId: "one", type: "task", title: "Böyük", description: "", size: { width: 500, height: 900 }, routes: [] },
      { id: "d", laneId: "two", type: "task", title: "D", description: "", routes: [] },
      { id: "e", laneId: "three", type: "task", title: "E", description: "", routes: [] },
    ],
  };
  const original = layoutProject(target);
  assert.notEqual(original.lanes[0].height, original.lanes[1].height);
  const first = pasteDiagram(target, fixture(), sequence("first")).project;
  const firstLayout = layoutProject(first);
  const second = pasteDiagram(first, fixture(), sequence("second")).project;
  const secondLayout = layoutProject(second);
  assert.deepEqual(firstLayout.pools[0], original.pools[0]);
  assert.deepEqual(firstLayout.lanes.slice(0, 3), original.lanes);
  for (const node of original.nodes) assert.deepEqual(firstLayout.nodes.find(candidate => candidate.id === node.id), node);
  assert.deepEqual(secondLayout.pools.slice(0, first.pools.length), firstLayout.pools);
  assert.deepEqual(secondLayout.lanes.slice(0, firstLayout.lanes.length), firstLayout.lanes);
  for (const node of firstLayout.nodes) assert.deepEqual(secondLayout.nodes.find(candidate => candidate.id === node.id), node);
});

test("free-only diagrams can be pasted without inventing a pool or losing free-to-free links", () => {
  const source: Project = {
    version: 1, id: "free-only", name: "Sərbəst hissə", pools: [],
    steps: [
      { id: "free-work", laneId: "", type: "task", title: "İşlə", description: "", routes: [{ targetId: "free-note", label: "İzah" }], position: { x: 80, y: 340 } },
      { id: "free-note", laneId: "", type: "annotation", title: "Qeyd", description: "", routes: [], position: { x: 560, y: 420 } },
    ],
  };
  const pristine = pasteDiagram(createProject(), source, sequence("pristine"));
  assert.deepEqual(pristine.project.pools, []);
  assert.deepEqual(layoutProject(pristine.project).nodes.map(node => ({ ...node, id: "" })), layoutProject(source).nodes.map(node => ({ ...node, id: "" })));
  const target = fixture();
  const pasted = pasteDiagram(target, source, sequence("free"));
  const after = layoutProject(pasted.project);
  assert.equal(pasted.project.pools.length, target.pools.length);
  assert.ok(pasted.project.steps.slice(-2).every(step => step.laneId === ""));
  assert.equal(pasted.project.steps.at(-2)!.routes[0].targetId, pasted.stepIds[1]);
  assert.equal(after.nodes.find(node => node.id === pasted.stepIds[0])!.y, layoutProject(target).height + 48);
});

test("edited empty pools are retained, while a pristine placeholder does not consume the eight-pool limit", () => {
  const target = createProject();
  target.pools[0].position = { x: 200, y: 300 };
  const source = createProject();
  source.name = "Hazır hissə";
  const result = pasteDiagram(target, source, sequence());
  assert.equal(result.project.pools.length, 2);
  assert.equal(result.project.pools[0].id, target.pools[0].id);
  assert.deepEqual(result.project.pools[0].position, target.pools[0].position);
  const eightPools: Project = { ...source, pools: Array.from({ length: 8 }, (_, index) => ({ id: `pool-${index}`, name: `Pool ${index}`, lanes: [] })) };
  assert.equal(pasteDiagram(createProject(), eightPools, sequence()).project.pools.length, 8);
  assert.throws(() => pasteDiagram(target, eightPools), /maksimum 8 pool/);
});

test("paste rejects step limits, invalid references, and exhausted identifiers without changing either input", () => {
  const target = largeProject("target", 199, "");
  const source = fixture();
  const before = JSON.stringify([target, source]);
  assert.throws(() => pasteDiagram(target, source), /maksimum 200 addım/);
  assert.equal(JSON.stringify([target, source]), before);
  const broken = fixture();
  broken.steps[0].laneId = "missing";
  assert.throws(() => pasteDiagram(createProject(), broken), /mövcud olmayan iştirakçıya/);
  assert.throws(() => pasteDiagram(createProject(), source, () => "work"), /unikal identifikator/);
  assert.throws(() => pasteDiagram(createProject(), source, () => "bad id"), /unikal identifikator/);
  const collisions = ["source", "internal", "work", "copied-1", "copied-1"];
  let count = 0;
  const pasted = pasteDiagram(createProject(), source, () => collisions[count++] ?? `safe-${count}`);
  assert.equal(isProject(pasted.project), true);
});

test("the combined UTF-8 draft limit is checked before returning a pasted project", () => {
  const target = largeProject("target", 60);
  const source = largeProject("source", 60);
  assert.ok(new TextEncoder().encode(serializeDiagram(target)).byteLength < MAX_STORED_SIZE);
  assert.ok(new TextEncoder().encode(serializeDiagram(source)).byteLength < MAX_STORED_SIZE);
  const before = JSON.stringify([target, source]);
  assert.throws(() => pasteDiagram(target, source, sequence()), /maksimum 2 MB/);
  assert.equal(JSON.stringify([target, source]), before);
});

test("paste rejects a shift beyond the coordinate bounds instead of clamping or partially applying it", () => {
  const target = fixture();
  target.steps[3].position = { x: 60, y: MAX_STEP_POSITION - 60 };
  const source = fixture();
  const before = JSON.stringify([target, source]);
  assert.throws(() => pasteDiagram(target, source, sequence()), /ölçüləri icazə verilən həddi aşır/);
  assert.equal(JSON.stringify([target, source]), before);
});

function largeProject(id: string, count: number, description = "ə".repeat(9000)): Project {
  const project = createProject();
  project.id = id;
  project.name = "Böyük iş axını";
  project.steps = Array.from({ length: count }, (_, index) => ({
    id: `${id}-step-${index}`, laneId: project.pools[0].lanes[0].id, type: "task", title: `Addım ${index}`, description, routes: [],
  }));
  return project;
}


test("resetting copied pool dimensions releases pinned lane heights after its content is removed", () => {
  const pasted = pasteDiagram(createProject(), fixture(), sequence()).project;
  const empty = { ...pasted, steps: [] };
  const poolId = empty.pools[0].id;
  const before = layoutProject(empty).pools[0];
  const reset = resetDiagramPoolSize(empty, poolId);
  assert.ok(layoutProject(reset).pools[0].height < before.height);
  assert.deepEqual(reset.pools[0].position, empty.pools[0].position);
  assert.ok(empty.pools[0].lanes.every(lane => lane.height !== undefined));
  assert.ok(reset.pools[0].lanes.every(lane => lane.height === undefined));
  assert.equal(resetDiagramPoolSize(reset, poolId), reset);
});
