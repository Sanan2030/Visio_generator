import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { assignDiagramStep, duplicateDiagramStep, moveDiagramPool, moveDiagramStep } from "../lib/diagram-edit";
import { getPoolMinimumSize, resizeDiagramPool, resizeDiagramStep } from "../lib/diagram-size";
import { insertDiagramStepOnRoute } from "../lib/diagram-splice";
import { explanationRows } from "../lib/docx";
import { layoutProject } from "../lib/layout";
import { createProject, explainProject, isProject, MAX_STEP_POSITION, validateProject } from "../lib/process";
import { insertStepAfter } from "../lib/step-order";
import { cleanupEmptyProjects, hasProjectContent, parseProject, persistProject, STORAGE_PREFIX } from "../lib/storage";
import type { Project } from "../lib/types";
import { generateVsdx } from "../lib/vsdx";

function fixture(): Project {
  return {
    version: 1, id: "free-layout", name: "Sərbəst iş axını",
    pools: [
      { id: "inside", name: "Daxili", lanes: [{ id: "operator", name: "Operator" }] },
      { id: "outside", name: "Xarici", lanes: [{ id: "client", name: "Müştəri" }] },
    ],
    steps: [
      { id: "start", laneId: "operator", type: "start", title: "Başla", description: "", routes: [{ targetId: "work", label: "" }] },
      { id: "work", laneId: "operator", type: "task", title: "Yoxla", description: "Yoxlamanın izahı", routes: [{ targetId: "end", label: "Təsdiq", description: "Nəticə göndərilir" }], position: { x: 420, y: 48 } },
      { id: "end", laneId: "client", type: "end", title: "Bitir", description: "", routes: [] },
      { id: "note", laneId: "", type: "annotation", title: "Temp_raport_no\nStatus (Rejected)\nİmtina qeydi", description: "Sərbəst qeyd", routes: [{ targetId: "work", label: "" }], position: { x: 70, y: 900 } },
    ],
  };
}

function node(project: Project, id: string) {
  return layoutProject(project).nodes.find(item => item.id === id)!;
}

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

test("moving a pool carries automatic and manual children while other pools and free notes stay fixed", () => {
  const original = fixture();
  const before = layoutProject(original);
  const moved = moveDiagramPool(original, "inside", { x: 256, y: 156 });
  const after = layoutProject(moved);
  assert.equal(moved.steps, original.steps);
  assert.equal(original.pools[0].position, undefined);
  for (const id of ["start", "work"]) {
    const first = before.nodes.find(item => item.id === id)!;
    const last = after.nodes.find(item => item.id === id)!;
    assert.deepEqual({ x: last.x - first.x, y: last.y - first.y }, { x: 240, y: 140 });
  }
  for (const id of ["end", "note"]) assert.deepEqual(node(moved, id), node(original, id));
  assert.deepEqual(after.pools[1], before.pools[1]);
  assert.deepEqual(moveDiagramPool(moved, "inside", { x: 256, y: 156 }), moved);
  assert.equal(moveDiagramPool(moved, "deleted", { x: 400, y: 400 }), moved);
  for (const edge of after.edges) {
    const source = after.nodes.find(item => item.id === edge.sourceId)!;
    const target = after.nodes.find(item => item.id === edge.targetId)!;
    assert.equal(edge.points[0].x, source.x + source.width);
    assert.equal(edge.points.at(-1)!.x, target.x);
    for (const point of edge.points) {
      assert.ok(point.x >= 0 && point.x <= after.width);
      assert.ok(point.y >= 0 && point.y <= after.height);
    }
  }
});

test("pool placement and intentionally unassigned shapes round-trip while malformed coordinates are rejected", () => {
  const project = moveDiagramPool(fixture(), "inside", { x: 144.8, y: 610.3 });
  assert.equal(isProject(project), true);
  assert.deepEqual(parseProject(JSON.stringify(project)), project);
  for (const position of [null, [], {}, { x: 20 }, { x: "20", y: 30 }, { x: -1, y: 20 },
    { x: Infinity, y: 20 }, { x: 20, y: NaN }, { x: MAX_STEP_POSITION + 1, y: 20 }]) {
    assert.equal(isProject({ ...project, pools: [{ ...project.pools[0], position }] }), false);
  }
  assert.equal(validateProject(project).some(issue => issue.level === "error" && issue.stepId === "note"), false);
  const missing = { ...project, steps: [{ ...project.steps[3], laneId: "deleted" }] };
  assert.ok(validateProject(missing).some(issue => issue.level === "error" && issue.stepId === "note"));
});

test("moving an otherwise empty pool is saved and survives startup cleanup", () => {
  const storage = new MemoryStorage();
  const original = createProject();
  const moved = moveDiagramPool(original, original.pools[0].id, { x: 210, y: 350 });
  assert.equal(hasProjectContent(moved), true);
  persistProject(storage, moved);
  assert.equal(cleanupEmptyProjects(storage), 0);
  assert.deepEqual(parseProject(storage.getItem(STORAGE_PREFIX + original.id)!), moved);
  persistProject(storage, original);
  assert.equal(storage.length, 0);
});

test("a distant free shape grows the canvas without stretching assigned pools", () => {
  const original = fixture();
  const before = layoutProject(original);
  const distant = moveDiagramStep(original, "note", { x: 4000, y: 1400 }, "");
  const after = layoutProject(distant);
  assert.deepEqual(after.pools, before.pools);
  for (const id of ["start", "work", "end"]) assert.deepEqual(node(distant, id), node(original, id));
  assert.ok(after.width >= 4000 + node(distant, "note").width);
  assert.ok(after.height >= 1400 + node(distant, "note").height);
});

test("resizing a free note does not move automatic assigned columns or resize pools", () => {
  const original = fixture();
  original.steps[3].routes = [];
  const before = layoutProject(original);
  const resized = resizeDiagramStep(original, "note", { width: 1800, height: 240 });
  const after = layoutProject(resized);
  assert.deepEqual(after.pools, before.pools);
  for (const id of ["start", "work", "end"]) assert.deepEqual(node(resized, id), node(original, id));
  assert.equal(node(resized, "note").width, 1800);
  assert.ok(after.width >= node(resized, "note").x + 1800);
});

test("large automatic free shapes stay inside the canvas when imported or reset", () => {
  const project = fixture();
  project.steps[3] = { ...project.steps[3], position: undefined, size: { width: 1800, height: 240 }, routes: [] };
  const layout = layoutProject(project);
  const note = node(project, "note");
  assert.ok(note.x >= 16 && note.y >= 16);
  assert.ok(note.x + note.width <= layout.width);
  assert.ok(note.y + note.height <= layout.height);
  assert.equal(isProject(project), true);
});

test("tasks can move between assigned and free canvas positions without losing route facts", () => {
  const project = fixture();
  const free = moveDiagramStep(project, "work", { x: 80, y: 750 }, "");
  assert.equal(free.steps[1].laneId, "");
  assert.equal(free.steps[1].routes, project.steps[1].routes);
  assert.deepEqual({ x: node(free, "work").x, y: node(free, "work").y }, { x: 80, y: 750 });
  assert.equal(explanationRows(free).find(row => row.stepId === "work")!.actor, "Pool-dan kənar");
  assert.match(explainProject(free), /Yoxla — Pool-dan kənar/);
  assert.equal(layoutProject(free).edges.length, 3);
  const assigned = moveDiagramStep(free, "work", { x: 500, y: 24 }, "client");
  const lane = layoutProject(assigned).lanes.find(item => item.id === "client")!;
  assert.equal(node(assigned, "work").y, lane.y + 24);
  assert.equal(assigned.steps[1].description, project.steps[1].description);
});

test("changing assignment preserves visible coordinates when the destination contains the shape", () => {
  const movedPool = moveDiagramPool(fixture(), "inside", { x: 220, y: 410 });
  const originalNode = node(movedPool, "work");
  const detached = assignDiagramStep(movedPool, "work", "");
  assert.deepEqual(node(detached, "work"), originalNode);
  const restored = assignDiagramStep(detached, "work", "operator");
  assert.deepEqual(node(restored, "work"), originalNode);
  assert.equal(assignDiagramStep(restored, "work", "deleted"), restored);
});

test("duplicate and bottom-right resize preserve free coordinates and moved-pool offsets", () => {
  const project = moveDiagramPool(fixture(), "inside", { x: 316, y: 216 });
  for (const id of ["start", "work", "note"]) {
    const original = node(project, id);
    const resized = resizeDiagramStep(project, id, { width: 260, height: 140 });
    assert.deepEqual({ x: node(resized, id).x, y: node(resized, id).y }, { x: original.x, y: original.y });
    const result = duplicateDiagramStep(project, id, `${id}-copy`);
    assert.equal(result.error, undefined);
    const copy = node(result.project, `${id}-copy`);
    assert.deepEqual({ x: copy.x, y: copy.y }, { x: original.x + 24, y: original.y + 24 });
    assert.deepEqual(result.project.steps.find(item => item.id === `${id}-copy`)!.routes, []);
  }
  const minimum = getPoolMinimumSize(project, "inside");
  const resizedPool = resizeDiagramPool(project, "inside", { width: 1, height: 1 });
  assert.deepEqual(resizedPool.pools[0].size, minimum);
  assert.deepEqual(node(resizedPool, "work"), node(project, "work"));
});

test("a task can be inserted between two pools without an actor and retain the original transition explanation", () => {
  const original = fixture();
  const inserted = { id: "between", laneId: "", type: "timer" as const, title: "Cavabı gözlə", description: "", routes: [] };
  const result = insertDiagramStepOnRoute(original, { sourceId: "work", routeIndex: 0 }, inserted,
    { laneId: "", position: { x: 700, y: 700 } });
  assert.equal(result.error, undefined);
  assert.equal(isProject(result.project), true);
  assert.deepEqual(result.project.steps.find(item => item.id === "work")!.routes,
    [{ ...original.steps[1].routes[0], targetId: "between" }]);
  assert.deepEqual(result.project.steps.find(item => item.id === "between")!.routes, [{ targetId: "end", label: "" }]);
  assert.deepEqual({ x: node(result.project, "between").x, y: node(result.project, "between").y }, { x: 700, y: 700 });
  assert.equal(layoutProject(result.project).edges.length, 4);
});

test("manual editor insertion after a free task splices its outgoing route", () => {
  const original = moveDiagramStep(fixture(), "work", { x: 400, y: 700 }, "");
  const next = insertStepAfter(original, "work", {
    id: "after-free", laneId: "", type: "task", title: "Nəticəni saxla", description: "", routes: [],
  });
  assert.equal(next.steps.length, original.steps.length + 1);
  assert.equal(next.steps.find(item => item.id === "work")!.routes[0].targetId, "after-free");
  assert.equal(next.steps.find(item => item.id === "after-free")!.routes[0].targetId, "end");
  assert.ok(layoutProject(next).nodes.some(item => item.id === "after-free"));
});

test("free gateway branches retain incompatible split and join validation", () => {
  const project = fixture();
  project.steps = [
    { id: "start", laneId: "", type: "start", title: "Başla", description: "", routes: [{ targetId: "split", label: "" }] },
    { id: "split", laneId: "", type: "and", title: "Paralel", description: "", routes: [{ targetId: "left", label: "" }, { targetId: "right", label: "" }] },
    { id: "left", laneId: "", type: "task", title: "Birinci", description: "", routes: [{ targetId: "join", label: "" }] },
    { id: "right", laneId: "", type: "task", title: "İkinci", description: "", routes: [{ targetId: "join", label: "" }] },
    { id: "join", laneId: "", type: "xor", title: "Birləşmə", description: "", routes: [{ targetId: "end", label: "" }] },
    { id: "end", laneId: "", type: "end", title: "Bitir", description: "", routes: [] },
  ];
  assert.ok(validateProject(project).some(issue => issue.level === "error" && issue.stepId === "join" && /AND.*XOR/.test(issue.message)));
});

test("native Visio export includes free shapes and glues every route across moved pools", async () => {
  const project = moveDiagramPool(fixture(), "inside", { x: 430, y: 180 });
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const xml = await zip.file("visio/pages/page1.xml")!.async("string");
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
  const page = parser.parse(xml).PageContents;
  const shapes = page.Shapes.Shape as { "@ID": string; "@NameU": string; "@Name": string }[];
  const note = shapes.find(shape => shape["@Name"]?.startsWith("Temp_raport_no"));
  assert.ok(note);
  const edges = layoutProject(project).edges;
  assert.equal(shapes.filter(shape => shape["@NameU"].startsWith("Connector.")).length, edges.length);
  assert.equal(page.Connects.Connect.length, edges.length * 2);
  assert.ok(page.Connects.Connect.some((connection: { "@ToSheet": string }) => connection["@ToSheet"] === note["@ID"]));
  assert.match(xml, /Temp_raport_no/);
});


test("automatic wide free notes route from their visible border after pool movement", () => {
  const project = fixture();
  project.steps[3] = { ...project.steps[3], position: undefined, size: { width: 2000, height: 140 } };
  const moved = moveDiagramPool(project, "inside", { x: 1300, y: 16 });
  const layout = layoutProject(moved);
  const note = layout.nodes.find(item => item.id === "note")!;
  const edge = layout.edges.find(item => item.sourceId === "note")!;
  assert.equal(edge.points[0].x, note.x + note.width);
  assert.ok(edge.points[1].x > edge.points[0].x);
  assert.ok(layout.edges.every(item => item.points.every(point => Number.isFinite(point.x) && Number.isFinite(point.y))));
});
