import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import {
  canInsertDiagramStepOnRoute, canInsertStepTypeOnRoute, findInsertionRoute,
  insertDiagramStepOnRoute, moveDiagramStepOnRoute,
} from "../lib/diagram-splice";
import { explanationRows, generateDocx } from "../lib/docx";
import { layoutProject, MAX_NODE_POSITION, MIN_NODE_X, MIN_NODE_Y } from "../lib/layout";
import { explainProject, isProject } from "../lib/process";
import { displayRouteLabel, getStepNumber } from "../lib/step-numbering";
import { parseProject, persistProject, STORAGE_PREFIX } from "../lib/storage";
import type { Project, ProjectLayout, Route, Step, StepType } from "../lib/types";
import { generateVsdx } from "../lib/vsdx";

const selection = { sourceId: "source", routeIndex: 0 };
const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseAttributeValue: false, parseTagValue: false });

function fixture(): Project {
  return {
    version: 1, id: "splice-project", name: "Əlavə yoxlama",
    pools: [
      { id: "organisation", name: "Təşkilat", lanes: [{ id: "operator", name: "Operator" }, { id: "reviewer", name: "Vizaçı" }] },
      { id: "customer", name: "Müştəri", lanes: [{ id: "recipient", name: "Müştəri nümayəndəsi" }] },
    ],
    steps: [
      { id: "start", laneId: "operator", type: "start", title: "Başla", description: "", routes: [{ targetId: "source", label: "" }] },
      { id: "source", laneId: "operator", type: "xor", title: "Sənəd düzgündür?", description: "Sənədi yoxla.", routes: [
        { targetId: "target", label: "Təsdiq", description: "Təsdiqdən sonra əlavə yoxlama aparılır.\nBütün qeydlər saxlanır." },
        { targetId: "other", label: "İmtina", description: "Sənəd geri qaytarılır." },
      ] },
      { id: "target", laneId: "operator", type: "task", title: "Sənədi imzala", description: "İmzanı tamamla.", routes: [{ targetId: "finish", label: "" }] },
      { id: "other", laneId: "operator", type: "task", title: "Düzəliş et", description: "Məlumatları düzəlt.", routes: [{ targetId: "source", label: "Yenidən yoxla" }] },
      { id: "detached", laneId: "reviewer", type: "userTask", title: "Əlavə yoxla", description: "Əlavə yoxlamanın izahı.", duration: "2 gün", system: "QNV", document: "Ərizə", routes: [] },
      { id: "finish", laneId: "operator", type: "end", title: "Tamamlandı", description: "İş bağlanır.", routes: [] },
    ],
  };
}

function newStep(patch: Partial<Step> = {}): Step {
  return { id: "inserted", laneId: "operator", type: "task", title: "Aralıq yoxlama", description: "Yeni işi yerinə yetir.", routes: [], ...patch };
}

function byId(project: Project, id: string): Step {
  return project.steps.find(step => step.id === id)!;
}

function linearFixture(incoming: Route = { targetId: "detached", label: "", description: "Əvvəlki keçidin izahı." },
  outgoing: Route = { targetId: "target", label: "" }): Project {
  const project = fixture();
  byId(project, "other").routes = [incoming];
  byId(project, "detached").routes = [outgoing];
  return project;
}

test("inserting on one chosen branch keeps all facts and other branches immutable, with shared numbering", () => {
  const original = fixture();
  const snapshot = structuredClone(original);
  const result = insertDiagramStepOnRoute(original, selection, newStep(), { laneId: "reviewer", position: { x: 710.05, y: 28.04 } });
  assert.equal(result.error, undefined);
  assert.equal(result.stepId, "inserted");
  assert.equal(isProject(result.project), true);
  assert.deepEqual(original, snapshot);
  assert.equal(result.project.pools, original.pools);
  assert.deepEqual(result.project.steps.map(step => step.id), ["start", "source", "inserted", "target", "other", "detached", "finish"]);
  assert.deepEqual(byId(result.project, "source").routes[0], { ...byId(original, "source").routes[0], targetId: "inserted" });
  assert.equal(byId(result.project, "source").routes[1], byId(original, "source").routes[1]);
  assert.equal(byId(result.project, "target"), byId(original, "target"));
  assert.deepEqual(byId(result.project, "inserted").routes, [{ targetId: "target", label: "" }]);
  assert.deepEqual(byId(result.project, "inserted").position, { x: 710.1, y: 28 });
  assert.equal(displayRouteLabel(result.project, "source", 0), "2.1 · Təsdiq");
  assert.equal(getStepNumber(result.project, "inserted"), "3");
  assert.equal(explanationRows(result.project).find(row => row.number === "2.1")!.description, byId(original, "source").routes[0].description);
  assert.deepEqual(explanationRows(result.project).find(row => row.number === "2.1")!.notes, ["Keçid: Təsdiq → Aralıq yoxlama (addım 3)."]);
});

test("insertion preserves a backward correction loop instead of dropping its route or facts", () => {
  const original = fixture();
  const result = insertDiagramStepOnRoute(original, { sourceId: "other", routeIndex: 0 }, newStep({ type: "timer" }));
  assert.equal(result.error, undefined);
  assert.deepEqual(byId(result.project, "other").routes, [{ targetId: "inserted", label: "Yenidən yoxla" }]);
  assert.deepEqual(byId(result.project, "inserted").routes, [{ targetId: "source", label: "" }]);
  assert.deepEqual(byId(result.project, "source").routes, byId(original, "source").routes);
});

test("an isolated existing task is spliced and moved to the chosen actor in one immutable change", () => {
  const original = fixture();
  const snapshot = structuredClone(original);
  assert.equal(canInsertDiagramStepOnRoute(original, selection, "detached"), true);
  const result = moveDiagramStepOnRoute(original, "detached", selection, { laneId: "recipient", position: { x: 750, y: 35 } });
  assert.equal(result.error, undefined);
  assert.equal(result.project.steps.length, original.steps.length);
  assert.deepEqual(result.project.steps.map(step => step.id), ["start", "source", "detached", "target", "other", "finish"]);
  assert.deepEqual(byId(result.project, "detached"), { ...byId(original, "detached"), laneId: "recipient", position: { x: 750, y: 35 }, routes: [{ targetId: "target", label: "" }] });
  assert.equal(explanationRows(result.project).find(row => row.stepId === "detached")!.actor, "Müştəri nümayəndəsi");
  assert.equal(layoutProject(result.project).edges.find(edge => edge.sourceId === "source" && edge.targetId === "detached")!.message, true);
  assert.deepEqual(original, snapshot);
});

test("moving a linear task bridges its old neighbours, keeps incoming facts and does not alter either branch index", () => {
  const original = linearFixture({ targetId: "detached", label: "Təkrar", description: "Əvvəlki keçidin tam izahı." });
  const result = moveDiagramStepOnRoute(original, "detached", selection);
  assert.equal(result.error, undefined);
  assert.deepEqual(byId(result.project, "other").routes, [{ targetId: "target", label: "Təkrar", description: "Əvvəlki keçidin tam izahı." }]);
  assert.deepEqual(byId(result.project, "source").routes, [{ ...byId(original, "source").routes[0], targetId: "detached" }, byId(original, "source").routes[1]]);
  assert.deepEqual(byId(result.project, "detached").routes, [{ targetId: "target", label: "" }]);
  assert.equal(byId(result.project, "detached").description, byId(original, "detached").description);
});

test("safe bridge merging retains facts from either old arrow, while conflicting facts reject the complete operation", () => {
  const original = linearFixture({ targetId: "detached", label: "Təkrar" }, { targetId: "target", label: "", description: "Sonrakı keçidin izahı." });
  const result = moveDiagramStepOnRoute(original, "detached", selection);
  assert.deepEqual(byId(result.project, "other").routes, [{ targetId: "target", label: "Təkrar", description: "Sonrakı keçidin izahı." }]);
  for (const [incoming, outgoing] of [
    [{ targetId: "detached", label: "A" }, { targetId: "target", label: "B" }],
    [{ targetId: "detached", label: "", description: "Birinci izah" }, { targetId: "target", label: "", description: "İkinci izah" }],
  ] satisfies [Route, Route][]) {
    const project = linearFixture(incoming, outgoing);
    const snapshot = structuredClone(project);
    assert.equal(canInsertDiagramStepOnRoute(project, selection, "detached"), false);
    const rejected = moveDiagramStepOnRoute(project, "detached", selection);
    assert.equal(rejected.project, project);
    assert.match(rejected.error!, /etiketləri və ya izahları fərqlidir/);
    assert.deepEqual(project, snapshot);
  }
  const sameFacts = linearFixture({ targetId: "detached", label: "Təkrar", description: "Eyni izah" }, { targetId: "target", label: "Təkrar", description: "Eyni izah" });
  assert.equal(moveDiagramStepOnRoute(sameFacts, "detached", selection).error, undefined);
});

test("a predecessor that is also the destination source can have both routes changed without replacing a branch", () => {
  const original = fixture();
  byId(original, "source").routes.push({ targetId: "detached", label: "Əlavə", description: "Əvvəlki əlavə yoxlama." });
  byId(original, "detached").routes = [{ targetId: "finish", label: "" }];
  const result = moveDiagramStepOnRoute(original, "detached", selection);
  assert.equal(result.error, undefined);
  assert.deepEqual(byId(result.project, "source").routes, [
    { ...byId(original, "source").routes[0], targetId: "detached" },
    byId(original, "source").routes[1],
    { targetId: "finish", label: "Əlavə", description: "Əvvəlki əlavə yoxlama." },
  ]);
});

test("branch, merge, half-connected, attached-artifact and self-incident movements never silently rewire", () => {
  const cases: Project[] = [];
  const branching = linearFixture(); byId(branching, "detached").routes.push({ targetId: "finish", label: "Əlavə" }); cases.push(branching);
  const merging = linearFixture(); byId(merging, "target").routes.push({ targetId: "detached", label: "Əlavə" }); cases.push(merging);
  const incomingOnly = linearFixture(); byId(incomingOnly, "detached").routes = []; cases.push(incomingOnly);
  const outgoingOnly = fixture(); byId(outgoingOnly, "detached").routes = [{ targetId: "finish", label: "" }]; cases.push(outgoingOnly);
  const artifact = linearFixture(); byId(artifact, "other").type = "data"; cases.push(artifact);
  const dangling = linearFixture(); byId(dangling, "detached").routes[0].targetId = ""; cases.push(dangling);
  const loop = linearFixture(); byId(loop, "detached").routes[0].targetId = "other"; cases.push(loop);
  const duplicate = linearFixture(); byId(duplicate, "other").routes.push({ targetId: "target", label: "Başqa keçid" }); cases.push(duplicate);
  for (const project of cases) {
    const snapshot = structuredClone(project);
    const result = moveDiagramStepOnRoute(project, "detached", selection);
    assert.equal(result.project, project);
    assert.ok(result.error);
    assert.equal(canInsertDiagramStepOnRoute(project, selection, "detached"), false);
    assert.deepEqual(project, snapshot);
  }
  const project = fixture();
  for (const id of ["source", "target", "start", "finish", "missing"]) {
    assert.equal(moveDiagramStepOnRoute(project, id, selection).project, project);
    assert.equal(canInsertDiagramStepOnRoute(project, selection, id), false);
  }
});

test("new insertion rejects stale arrows, invalid IDs, forbidden shapes, occupied IDs, pre-linked steps and invalid actors", () => {
  const project = fixture();
  for (const picked of [{ sourceId: "missing", routeIndex: 0 }, { sourceId: "source", routeIndex: -1 },
    { sourceId: "source", routeIndex: 0.5 }, { sourceId: "source", routeIndex: 200 }]) {
    assert.equal(insertDiagramStepOnRoute(project, picked, newStep()).project, project);
  }
  for (const step of [newStep({ id: "source" }), newStep({ id: "organisation" }), newStep({ id: "operator" }),
    newStep({ id: project.id }), newStep({ id: "bad id" }), newStep({ laneId: "missing" }),
    newStep({ routes: [{ targetId: "target", label: "" }] }), newStep({ title: "x".repeat(501) }),
    ...(["start", "end", "data", "annotation"] satisfies StepType[]).map(type => newStep({ type }))]) {
    const result = insertDiagramStepOnRoute(project, selection, step);
    assert.equal(result.project, project);
    assert.ok(result.error);
    assert.equal(canInsertDiagramStepOnRoute(project, selection, step), false);
  }
  assert.equal(insertDiagramStepOnRoute(project, selection, newStep(), { laneId: "missing", position: { x: 500, y: 30 } }).project, project);
  assert.equal(moveDiagramStepOnRoute(project, "detached", selection, { laneId: "missing", position: { x: 500, y: 30 } }).project, project);
  for (const type of ["task", "userTask", "serviceTask", "subprocess", "xor", "or", "and", "intermediate", "message", "timer"] satisfies StepType[]) {
    assert.equal(canInsertStepTypeOnRoute(project, selection, type), true);
  }
  for (const type of ["start", "end", "data", "annotation"] satisfies StepType[]) assert.equal(canInsertStepTypeOnRoute(project, selection, type), false);
});

test("dangling, artifact and malformed self-loop arrows cannot become execution insertions", () => {
  for (const patch of [(project: Project) => { byId(project, "source").routes[0].targetId = ""; },
    (project: Project) => { byId(project, "target").type = "data"; },
    (project: Project) => { byId(project, "source").type = "annotation"; },
    (project: Project) => { byId(project, "source").type = "end"; },
    (project: Project) => { byId(project, "source").routes[0].targetId = "source"; },
    (project: Project) => { byId(project, "target").laneId = "missing"; }]) {
    const project = fixture(); patch(project);
    assert.equal(insertDiagramStepOnRoute(project, selection, newStep()).project, project);
    assert.equal(canInsertStepTypeOnRoute(project, selection, "task"), false);
  }
});

test("the 200-step limit blocks a new shape but permits an existing task to be spliced", () => {
  const project = fixture();
  for (let index = project.steps.length; index < 200; index++) project.steps.push(newStep({ id: `filler-${index}` }));
  assert.match(insertDiagramStepOnRoute(project, selection, newStep()).error!, /200/);
  assert.equal(canInsertStepTypeOnRoute(project, selection, "task"), false);
  const moved = moveDiagramStepOnRoute(project, "detached", selection);
  assert.equal(moved.error, undefined);
  assert.equal(moved.project.steps.length, 200);
});

test("replacing one arrow in a source with 200 routes does not consume an extra route or reorder its facts", () => {
  const project = fixture();
  const source = byId(project, "source");
  source.routes = Array.from({ length: 200 }, (_, index) => ({ targetId: index % 2 ? "other" : "target", label: `Qol ${index + 1}`, description: `İzah ${index + 1}` }));
  const result = insertDiagramStepOnRoute(project, { sourceId: "source", routeIndex: 199 }, newStep());
  assert.equal(result.error, undefined);
  const routes = byId(result.project, "source").routes;
  assert.equal(routes.length, 200);
  assert.deepEqual(routes.slice(0, 199), source.routes.slice(0, 199));
  assert.deepEqual(routes[199], { targetId: "inserted", label: "Qol 200", description: "İzah 200" });
  assert.deepEqual(byId(result.project, "inserted").routes, [{ targetId: "other", label: "" }]);
  assert.equal(displayRouteLabel(result.project, "source", 199), "2.200 · Qol 200");
});

test("inserted positions use the same bounded diagram coordinates as ordinary dragging", () => {
  const project = fixture();
  const minimum = insertDiagramStepOnRoute(project, selection, newStep(), { laneId: "operator", position: { x: -5, y: Number.NaN } });
  assert.equal(byId(minimum.project, "inserted").position!.x, MIN_NODE_X);
  assert.ok(byId(minimum.project, "inserted").position!.y >= MIN_NODE_Y);
  const maximum = moveDiagramStepOnRoute(project, "detached", selection, { laneId: "operator", position: { x: 1e8, y: 1e8 } });
  assert.deepEqual(byId(maximum.project, "detached").position, { x: MAX_NODE_POSITION, y: MAX_NODE_POSITION });
});

function assertClearOfOtherNodes(project: Project, stepId: string): void {
  const layout = layoutProject(project);
  const step = byId(project, stepId);
  const node = layout.nodes.find(candidate => candidate.id === stepId)!;
  const ids = new Set(project.steps.filter(candidate => candidate.id !== stepId && candidate.laneId === step.laneId).map(candidate => candidate.id));
  for (const other of layout.nodes.filter(candidate => ids.has(candidate.id))) {
    assert.equal(node.x < other.x + other.width + 12 && node.x + node.width + 12 > other.x
      && node.y < other.y + other.height + 12 && node.y + node.height + 12 > other.y, false, `${stepId} must leave a 12px gap around ${other.id}`);
  }
}

test("a task dropped into the default forward gap shifts down instead of covering its source", () => {
  const project = fixture();
  byId(project, "source").type = "task";
  const layout = layoutProject(project);
  const source = layout.nodes.find(node => node.id === "source")!;
  const target = layout.nodes.find(node => node.id === "target")!;
  const lane = layout.lanes.find(candidate => candidate.id === "operator")!;
  const requested = { x: (source.x + source.width + target.x) / 2 - 82, y: source.y - lane.y };
  const result = insertDiagramStepOnRoute(project, selection, newStep(), { laneId: "operator", position: requested });
  assert.equal(result.error, undefined);
  assert.equal(byId(result.project, "inserted").position!.x, clampX(requested.x));
  assert.ok(byId(result.project, "inserted").position!.y > requested.y);
  assertClearOfOtherNodes(result.project, "inserted");
  assert.deepEqual(byId(result.project, "source").routes[0], { ...byId(project, "source").routes[0], targetId: "inserted" });
  assert.deepEqual(byId(result.project, "inserted").routes, [{ targetId: "target", label: "" }]);
});

function clampX(value: number): number { return Math.round(Math.max(MIN_NODE_X, Math.min(MAX_NODE_POSITION, value)) * 10) / 10; }

test("inserting between manually positioned endpoints moves only the new task down and expands its lane", () => {
  const project = fixture();
  byId(project, "source").type = "task";
  byId(project, "source").position = { x: 300, y: 40 };
  byId(project, "target").position = { x: 600, y: 40 };
  const original = structuredClone(project);
  const oldLayout = layoutProject(project);
  const result = insertDiagramStepOnRoute(project, selection, newStep(), { laneId: "operator", position: { x: 450, y: 40 } });
  assert.equal(result.error, undefined);
  assert.deepEqual(byId(result.project, "inserted").position, { x: 450, y: 158 });
  assert.deepEqual(byId(result.project, "source").position, byId(project, "source").position);
  assert.deepEqual(byId(result.project, "target").position, byId(project, "target").position);
  assertClearOfOtherNodes(result.project, "inserted");
  const layout = layoutProject(result.project);
  assert.ok(layout.lanes.find(lane => lane.id === "operator")!.height >= oldLayout.lanes.find(lane => lane.id === "operator")!.height);
  assert.deepEqual(project, original);
});

test("moving onto an arrow clears resized blockers without changing their positions or sizes", () => {
  const project = fixture();
  byId(project, "source").position = { x: 300, y: 30 };
  byId(project, "source").size = { width: 180, height: 440 };
  byId(project, "target").position = { x: 620, y: 30 };
  byId(project, "target").size = { width: 200, height: 300 };
  byId(project, "detached").size = { width: 200, height: 110 };
  const result = moveDiagramStepOnRoute(project, "detached", selection, { laneId: "operator", position: { x: 460, y: 30 } });
  assert.equal(result.error, undefined);
  assert.equal(byId(result.project, "detached").position!.x, 460);
  assert.ok(byId(result.project, "detached").position!.y >= 482);
  assertClearOfOtherNodes(result.project, "detached");
  assert.deepEqual(byId(result.project, "source").position, byId(project, "source").position);
  assert.deepEqual(byId(result.project, "source").size, byId(project, "source").size);
  assert.deepEqual(byId(result.project, "target").position, byId(project, "target").position);
  assert.deepEqual(byId(result.project, "target").size, byId(project, "target").size);
});

test("collision recovery keeps position bounds and rejects an impossibly tall occupied strip atomically", () => {
  const project = fixture();
  byId(project, "source").position = { x: 300, y: MAX_NODE_POSITION };
  const result = insertDiagramStepOnRoute(project, selection, newStep(), { laneId: "operator", position: { x: 310, y: MAX_NODE_POSITION } });
  assert.equal(result.error, undefined);
  assert.ok(byId(result.project, "inserted").position!.y < MAX_NODE_POSITION);
  assert.equal(isProject(result.project), true);
  assertClearOfOtherNodes(result.project, "inserted");
  const occupied = fixture();
  byId(occupied, "source").position = { x: 300, y: 16 };
  byId(occupied, "source").type = "task";
  byId(occupied, "source").size = { width: 200, height: MAX_NODE_POSITION };
  const snapshot = structuredClone(occupied);
  const rejected = insertDiagramStepOnRoute(occupied, selection, newStep(), { laneId: "operator", position: { x: 310, y: 16 } });
  assert.equal(rejected.project, occupied);
  assert.match(rejected.error!, /boş sahə yoxdur/);
  assert.deepEqual(occupied, snapshot);
});

function hitLayout(): ProjectLayout {
  return {
    width: 1000, height: 400, lanes: [], pools: [],
    nodes: [{ id: "source", x: 50, y: 30, width: 50, height: 40 }, { id: "target", x: 700, y: 200, width: 100, height: 40 }],
    edges: [
      { sourceId: "source", targetId: "target", routeIndex: 0, label: "Təsdiq", message: false,
        points: [{ x: 100, y: 50 }, { x: 400, y: 50 }, { x: 400, y: 220 }, { x: 700, y: 220 }] },
      { sourceId: "source", targetId: "other", routeIndex: 1, label: "İmtina", message: false,
        points: [{ x: 100, y: 65 }, { x: 500, y: 65 }, { x: 500, y: 300 }] },
    ],
  };
}

test("edge insertion hit-testing measures all polyline segments, chooses the nearest and keeps ties stable", () => {
  const project = fixture(); const layout = hitLayout();
  assert.deepEqual(findInsertionRoute(project, layout, { x: 250, y: 52 }), selection);
  assert.deepEqual(findInsertionRoute(project, layout, { x: 406, y: 150 }), selection);
  assert.deepEqual(findInsertionRoute(project, layout, { x: 600, y: 222 }), selection);
  assert.deepEqual(findInsertionRoute(project, layout, { x: 250, y: 63 }), { sourceId: "source", routeIndex: 1 });
  assert.deepEqual(findInsertionRoute(project, layout, { x: 250, y: 57.5 }), selection);
  assert.deepEqual(findInsertionRoute(project, layout, { x: 250, y: 50 }, undefined, 0), selection);
  assert.equal(findInsertionRoute(project, layout, { x: 250, y: 100 }, undefined, 24), null);
  assert.equal(findInsertionRoute(project, layout, { x: 250, y: 74 }, undefined, 7), null);
});

test("edge previews skip node interiors, stale edges, unsafe tasks and non-finite coordinates", () => {
  const project = fixture(); const layout = hitLayout();
  assert.equal(findInsertionRoute(project, layout, { x: 75, y: 50 }), null);
  assert.equal(findInsertionRoute(project, layout, { x: 720, y: 220 }), null);
  assert.deepEqual(findInsertionRoute(project, layout, { x: 250, y: 50 }, "detached"), selection);
  assert.equal(findInsertionRoute(project, layout, { x: 250, y: 50 }, "source"), null);
  assert.equal(findInsertionRoute(project, { ...layout, edges: [layout.edges[0]] }, { x: 250, y: 50 }, "target"), null);
  assert.equal(findInsertionRoute(project, layout, { x: Number.NaN, y: 50 }), null);
  assert.equal(findInsertionRoute(project, layout, { x: 250, y: 50 }, undefined, -1), null);
  assert.equal(findInsertionRoute(project, layout, { x: 250, y: 50 }, undefined, Number.POSITIVE_INFINITY), null);
  const stale = { ...layout, edges: [{ ...layout.edges[0], targetId: "other" }] };
  assert.equal(findInsertionRoute(project, stale, { x: 250, y: 50 }), null);
  const onlyData = fixture(); byId(onlyData, "target").type = "data";
  assert.equal(findInsertionRoute(onlyData, { ...layout, edges: [layout.edges[0]] }, { x: 250, y: 50 }), null);
});

test("splicing keeps native Word numbering, Visio connector gluing, explanation facts and restored draft identical", async () => {
  const original = fixture();
  const result = moveDiagramStepOnRoute(original, "detached", selection, { laneId: "recipient", position: { x: 750, y: 35 } });
  const project = result.project;
  let saved = "";
  persistProject({ setItem: (key, value) => { assert.equal(key, STORAGE_PREFIX + project.id); saved = value; }, removeItem: () => {} }, project);
  assert.deepEqual(parseProject(saved), project);
  const rows = explanationRows(project);
  assert.equal(rows.find(row => row.stepId === "detached")!.number, "3");
  assert.equal(rows.find(row => row.stepId === "detached")!.actor, "Müştəri nümayəndəsi");
  assert.equal(rows.find(row => row.number === "2.1")!.description, byId(original, "source").routes[0].description);
  assert.ok(explainProject(project).includes("3. Əlavə yoxla — Müştəri nümayəndəsi"));
  const word = await JSZip.loadAsync(await generateDocx(project));
  const wordXml = await word.file("word/document.xml")!.async("string");
  assert.ok(wordXml.includes("Təsdiqdən sonra əlavə yoxlama aparılır."));
  assert.ok(wordXml.includes("Müştəri nümayəndəsi"));
  const wordRows = array<Record<string, unknown>>(parser.parse(wordXml)["w:document"]["w:body"]["w:tbl"]["w:tr"]).slice(1);
  assert.deepEqual(wordRows.map(row => texts(array(row["w:tc"])[0]).join("")), rows.map(row => row.number));

  const visio = await JSZip.loadAsync(await generateVsdx(project));
  const xml = await visio.file("visio/pages/page1.xml")!.async("string");
  const page = parser.parse(xml).PageContents;
  const shapes = array<XmlShape>(page.Shapes.Shape);
  const connects = array<{ "@FromSheet": string; "@FromCell": string; "@ToSheet": string }>(page.Connects.Connect);
  const ids = new Map(shapes.flatMap(shape => {
    const property = array(shape.Section).find(section => section["@N"] === "Property");
    const value = array(array(property?.Row).find(row => row["@N"] === "ProjectStepId")?.Cell).find(cell => cell["@N"] === "Value")?.["@V"];
    return value ? [[value, shape["@ID"]] as const] : [];
  }));
  const connectors = shapes.filter(shape => shape["@NameU"].startsWith("Connector."));
  const edges = layoutProject(project).edges;
  assert.equal(connectors.length, edges.length);
  assert.equal(connects.length, edges.length * 2);
  edges.forEach((edge, index) => {
    const ends = connects.filter(connection => connection["@FromSheet"] === connectors[index]["@ID"]);
    assert.equal(ends.find(connection => connection["@FromCell"] === "BeginX")?.["@ToSheet"], ids.get(edge.sourceId));
    assert.equal(ends.find(connection => connection["@FromCell"] === "EndX")?.["@ToSheet"], ids.get(edge.targetId));
  });
  assert.ok(xml.includes("3. Əlavə yoxla"));
  assert.ok(xml.includes("2.1 · Təsdiq"));
  assert.ok(xml.includes("Əlavə yoxlamanın izahı."));
});

interface XmlShape {
  "@ID": string;
  "@NameU": string;
  Section?: { "@N": string; Row?: { "@N": string; Cell?: { "@N": string; "@V": string } | { "@N": string; "@V": string }[] }[] }[];
}

function array<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }
function texts(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => key === "w:t" ? array(value).map(text => typeof text === "string" ? text : String(text["#text"] ?? "")) : texts(value));
}
