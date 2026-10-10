import assert from "node:assert/strict";
import test from "node:test";
import { createProject, explainProject, isProject, SAMPLE_PROJECT, validateProject } from "../lib/process";
import { layoutProject } from "../lib/layout";
import type { Project } from "../lib/types";

function simpleProject(): Project {
  return {
    version: 1,
    id: "test-project",
    name: "Sadə proses",
    pools: [{ id: "pool", name: "Təşkilat", lanes: [{ id: "lane", name: "Operator" }] }],
    steps: [
      { id: "start", laneId: "lane", type: "start", title: "Başla", description: "", routes: [{ targetId: "work", label: "" }] },
      { id: "work", laneId: "lane", type: "userTask", title: "Yoxla", description: "Sənədin məlumatlarını yoxla.", routes: [{ targetId: "end", label: "" }] },
      { id: "end", laneId: "lane", type: "end", title: "Bitir", description: "", routes: [] },
    ],
  };
}

test("a new project is an importable empty draft with distinct identities", () => {
  const first = createProject();
  const second = createProject();
  assert.equal(isProject(first), true);
  assert.equal(first.steps.length, 0);
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.pools[0].lanes[0].id, second.pools[0].lanes[0].id);
});

test("runtime import validation rejects bad versions, shapes, duplicates and oversized input", () => {
  assert.equal(isProject(simpleProject()), true);
  assert.equal(isProject({ ...simpleProject(), version: 2 }), false);
  assert.equal(isProject({ ...simpleProject(), pools: null }), false);
  assert.equal(isProject({ ...simpleProject(), steps: [{ ...simpleProject().steps[0], type: "execute-code" }] }), false);
  assert.equal(isProject({ ...simpleProject(), steps: [{ ...simpleProject().steps[0], routes: [{ targetId: "end", label: 4 }] }] }), false);
  assert.equal(isProject({ ...simpleProject(), steps: [simpleProject().steps[0], simpleProject().steps[0]] }), false);
  assert.equal(isProject({ ...simpleProject(), name: "x".repeat(301) }), false);
  assert.equal(isProject({ ...simpleProject(), steps: Array.from({ length: 201 }, (_, i) => ({ ...simpleProject().steps[0], id: `step-${i}` })) }), false);
});

test("prototype-like IDs are normal graph identities and unknown inherited names remain missing", () => {
  const project = simpleProject();
  project.steps[1].id = "constructor";
  project.steps[0].routes[0].targetId = "constructor";
  project.steps[2].id = "__proto__";
  project.steps[1].routes[0].targetId = "__proto__";
  assert.equal(isProject(project), true);
  assert.deepEqual(validateProject(project), []);
  const layout = layoutProject(project);
  assert.equal(layout.nodes.length, 3);
  assert.equal(layout.edges.length, 2);
  assert.match(explainProject(project), /Keçid: Bitir/);
  project.steps[1].routes[0].targetId = "toString";
  assert.ok(validateProject(project).some((issue) => issue.level === "error" && issue.stepId === "constructor"));
  assert.equal(layoutProject(project).edges.length, 1);
});

test("incomplete route destinations survive storage round trips and remain validation errors", () => {
  const project = simpleProject();
  project.steps[1].routes = [{ targetId: "", label: "Qərar hələ verilməyib" }];
  const restored: unknown = JSON.parse(JSON.stringify(project));
  assert.equal(isProject(restored), true);
  if (!isProject(restored)) throw new Error("Draft should be restorable");
  assert.ok(validateProject(restored).some((issue) => issue.level === "error" && issue.stepId === "work"));
  assert.doesNotThrow(() => layoutProject(restored));
});

test("all UI-supported route counts can be restored but oversized routes are rejected", () => {
  const project = simpleProject();
  project.steps[1].routes = Array.from({ length: 200 }, (_, index) => ({ targetId: "end", label: String(index) }));
  assert.equal(isProject(project), true);
  project.steps[1].routes.push({ targetId: "end", label: "Too many" });
  assert.equal(isProject(project), false);
});

test("the documented customer workflow is structurally valid and all branches can finish", () => {
  assert.equal(isProject(SAMPLE_PROJECT), true);
  assert.deepEqual(validateProject(SAMPLE_PROJECT), []);
  assert.deepEqual(validateProject(simpleProject()), []);
});

test("validation identifies broken targets, disconnected branches and closed loops", () => {
  const project = simpleProject();
  project.steps[1].routes = [{ targetId: "missing", label: "" }];
  project.steps.push({ id: "isolated", laneId: "lane", type: "task", title: "Ayrı addım", description: "", routes: [{ targetId: "isolated", label: "Təkrar" }] });
  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.level === "error" && issue.stepId === "work"));
  assert.ok(issues.some((issue) => issue.stepId === "isolated" && issue.message.includes("əlçatan deyil")));
  assert.ok(issues.some((issue) => issue.stepId === "isolated" && issue.message.includes("son hadisəsinə yol yoxdur")));
  assert.ok(issues.some((issue) => issue.stepId === "end" && issue.message.includes("əlçatan deyil")));
});

test("decision branches require descriptive conditions, end nodes cannot continue", () => {
  const project = simpleProject();
  project.steps[1].type = "xor";
  project.steps[1].routes = [{ targetId: "end", label: "" }, { targetId: "start", label: "" }];
  project.steps[2].routes = [{ targetId: "start", label: "" }];
  const issues = validateProject(project);
  assert.ok(issues.some((issue) => issue.stepId === "work" && issue.message.includes("şərt yazın")));
  assert.ok(issues.some((issue) => issue.stepId === "end" && issue.level === "error"));
});

test("document artifacts are attachments and do not need a start-to-end execution path", () => {
  const project = simpleProject();
  project.steps.push({ id: "document", laneId: "lane", type: "data", title: "QNV", description: "Qeydiyyat nəzarət vərəqəsi.", routes: [] });
  project.steps[1].routes.push({ targetId: "document", label: "Yaradır" });
  assert.deepEqual(validateProject(project), []);
  assert.match(explainProject(project), /Əlaqə: Yaradır → QNV/);
});

test("explanation is deterministic, preserves supplied facts and distinguishes gateway behavior", () => {
  const explanation = explainProject(SAMPLE_PROJECT);
  assert.equal(explanation, explainProject(structuredClone(SAMPLE_PROJECT)));
  assert.match(explanation, /XOR: şərtə görə yalnız bir çıxış seçilir/);
  assert.match(explanation, /AND: bütün çıxış qolları paralel başlayır/);
  assert.match(explanation, /AND birləşməsi: bütün daxil olan qollar/);
  assert.match(explanation, /Əsas QNV “İcraatdadır” statusunda qalır/);
  const project = simpleProject();
  project.steps[1].type = "or";
  project.steps[1].routes.push({ targetId: "start", label: "Təkrar" });
  assert.match(explainProject(project), /OR: şərtlərə uyğun bir və ya bir neçə çıxış seçilir/);
});

test("layout handles rejection loops, is finite and keeps every node within its lane", () => {
  const layout = layoutProject(SAMPLE_PROJECT);
  assert.equal(layout.nodes.length, SAMPLE_PROJECT.steps.length);
  assert.equal(layout.edges.length, SAMPLE_PROJECT.steps.reduce((sum, step) => sum + step.routes.length, 0));
  const lanes = new Map(layout.lanes.map((lane) => [lane.id, lane]));
  for (const step of SAMPLE_PROJECT.steps) {
    const node = layout.nodes.find((candidate) => candidate.id === step.id)!;
    const lane = lanes.get(step.laneId)!;
    assert.ok(node.x >= lane.x + 136);
    assert.ok(node.x + node.width <= lane.x + lane.width);
    assert.ok(node.y >= lane.y);
    assert.ok(node.y + node.height + 30 < lane.y + lane.height);
  }
  for (const edge of layout.edges) {
    assert.ok(edge.points.length >= 2);
    for (const point of edge.points) {
      assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y));
      assert.ok(point.x >= 0 && point.x <= layout.width);
      assert.ok(point.y >= 0 && point.y <= layout.height);
    }
    edge.points.slice(1).forEach((point, i) => assert.ok(point.x === edge.points[i].x || point.y === edge.points[i].y));
  }
  const loop = layout.edges.find((edge) => edge.sourceId === "correct" && edge.targetId === "first-visa")!;
  assert.ok(loop.points.length > 4);
});

test("parallel nodes in the same lane and layer never overlap", () => {
  const project = simpleProject();
  project.steps[0].type = "and";
  project.steps[0].routes.push({ targetId: "parallel", label: "" });
  project.steps.push({ ...project.steps[1], id: "parallel" });
  const layout = layoutProject(project);
  const first = layout.nodes.find((node) => node.id === "work")!;
  const second = layout.nodes.find((node) => node.id === "parallel")!;
  assert.equal(first.x, second.x);
  assert.ok(first.y + first.height < second.y || second.y + second.height < first.y);
});

test("backward route corridors leave space for separate two-line condition labels", () => {
  const project = structuredClone(SAMPLE_PROJECT);
  for (const id of ["executor-note", "related-response"]) {
    project.steps.find((step) => step.id === id)!.routes[0].label = "İcra prosesi yenidən davam etdirilir";
  }
  const layout = layoutProject(project);
  const first = layout.edges.find((edge) => edge.sourceId === "executor-note")!;
  const second = layout.edges.find((edge) => edge.sourceId === "related-response")!;
  assert.equal(first.points.length, 6);
  assert.equal(second.points.length, 6);
  assert.ok(Math.abs(first.points[2].y - second.points[2].y) >= 29);
});

test("self-loop endpoints connect to the same node rather than leaving detached arrows", () => {
  const project = simpleProject();
  project.steps[1].routes.push({ targetId: "work", label: "Təkrar yoxla" });
  const layout = layoutProject(project);
  const node = layout.nodes.find((node) => node.id === "work")!;
  const edge = layout.edges.find((edge) => edge.sourceId === "work" && edge.targetId === "work")!;
  assert.equal(edge.points[0].x, node.x + node.width);
  assert.equal(edge.points.at(-1)!.x, node.x);
  assert.ok(edge.points[0].y > node.y && edge.points[0].y < node.y + node.height);
  assert.ok(edge.points.at(-1)!.y > node.y && edge.points.at(-1)!.y < node.y + node.height);
  assert.ok(edge.points.some((point) => point.y > node.y + node.height + 30));
});

test("cross-pool edges are message flows, empty projects and dangling links are safe to lay out", () => {
  const project = simpleProject();
  project.pools.push({ id: "external-pool", name: "Xarici tərəf", lanes: [{ id: "external-lane", name: "Müştəri" }] });
  project.steps[2].laneId = "external-lane";
  const layout = layoutProject(project);
  assert.equal(layout.edges.find((edge) => edge.sourceId === "work")!.message, true);
  assert.equal(layout.edges.find((edge) => edge.sourceId === "start")!.message, false);
  assert.equal(layoutProject(createProject()).nodes.length, 0);
  project.steps[0].routes.push({ targetId: "missing", label: "" });
  assert.doesNotThrow(() => layoutProject(project));
});
