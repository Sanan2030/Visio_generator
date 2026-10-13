import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { explanationRows, generateDocx } from "../lib/docx";
import { createProject, isProject } from "../lib/process";
import { layoutProject } from "../lib/layout";
import { displayRouteLabel, getRouteNumber, getStepNumber } from "../lib/step-numbering";
import { insertStepAfter, moveStepInOrder, reorderStepsByFlow } from "../lib/step-order";
import type { Project, Step } from "../lib/types";
import { generateVsdx } from "../lib/vsdx";

function fixture(): Project {
  return {
    version: 1, id: "ordering-project", name: "Addımların sırası",
    pools: [{ id: "pool", name: "Təşkilat", lanes: [{ id: "lane", name: "Operator" }] }],
    steps: [
      { id: "start", laneId: "lane", type: "start", title: "Başlanğıc", description: "Başla.", routes: [{ targetId: "decision", label: "" }] },
      { id: "decision", laneId: "lane", type: "xor", title: "Qərar", description: "Qərarı ver.", routes: [
        { targetId: "second", label: "Təsdiq", description: "Təsdiqdən sonra ikinci qol başlayır." },
        { targetId: "first", label: "İmtina", description: "İmtina zamanı birinci qol başlayır." },
      ] },
      { id: "first", laneId: "lane", type: "userTask", title: "Birinci qol", description: "Birinci işi gör.", routes: [{ targetId: "finish", label: "", description: "Yekunlaşdır." }], position: { x: 580, y: 120 } },
      { id: "second", laneId: "lane", type: "userTask", title: "İkinci qol", description: "İkinci işi gör.", routes: [{ targetId: "finish", label: "" }] },
      { id: "finish", laneId: "lane", type: "end", title: "Tamamlandı", description: "Bitir.", routes: [] },
    ],
  };
}

function newStep(patch: Partial<Step> = {}): Step {
  return { id: "new-task", laneId: "lane", type: "task", title: "Yeni tapşırıq", description: "Əlavə işi gör.", routes: [], ...patch };
}

test("moving a form step changes only its explicit order and preserves route facts and manual placement", () => {
  const original = fixture();
  const snapshot = structuredClone(original);
  const up = moveStepInOrder(original, "second", "up");
  assert.deepEqual(up.steps.map((step) => step.id), ["start", "decision", "second", "first", "finish"]);
  assert.equal(up.pools, original.pools);
  assert.equal(up.steps[2], original.steps[3]);
  assert.equal(up.steps[3], original.steps[2]);
  assert.equal(getStepNumber(up, "first"), "4");
  const down = moveStepInOrder(up, "second", "down");
  assert.deepEqual(down.steps, original.steps);
  assert.deepEqual(original, snapshot);
});

test("ordering boundary moves and unknown IDs are no-ops rather than undo entries", () => {
  const project = fixture();
  assert.equal(moveStepInOrder(project, "start", "up"), project);
  assert.equal(moveStepInOrder(project, "finish", "down"), project);
  assert.equal(moveStepInOrder(project, "missing", "up"), project);
  assert.equal(moveStepInOrder({ ...project, steps: [] }, "start", "down").steps.length, 0);
});

test("inserting after a single route splices the flow while preserving its condition and explanation", () => {
  const original = fixture();
  const snapshot = structuredClone(original);
  const inserted = insertStepAfter(original, "first", newStep());
  assert.deepEqual(inserted.steps.map((step) => step.id), ["start", "decision", "first", "new-task", "second", "finish"]);
  assert.deepEqual(inserted.steps[2].routes, [{ targetId: "new-task", label: "", description: "Yekunlaşdır." }]);
  assert.deepEqual(inserted.steps[3].routes, [{ targetId: "finish", label: "" }]);
  assert.equal(inserted.steps[2].position, original.steps[2].position);
  assert.deepEqual(original, snapshot);
  assert.equal(isProject(inserted), true);
});

test("inserting into a correction loop keeps the loop and route facts intact", () => {
  const original = fixture();
  original.steps[2].routes = [{ targetId: "decision", label: "Yenidən yoxla", description: "Düzəlişdən sonra təkrar yoxlanır." }];
  const project = insertStepAfter(original, "first", newStep());
  assert.deepEqual(project.steps[2].routes, [{ targetId: "new-task", label: "Yenidən yoxla", description: "Düzəlişdən sonra təkrar yoxlanır." }]);
  assert.deepEqual(project.steps[3].routes, [{ targetId: "decision", label: "" }]);
  assert.equal(project.steps[1], original.steps[1]);
});

test("a source without outgoing flow connects an inserted task, and an end can close that flow", () => {
  const original = fixture();
  original.steps[2].routes = [];
  for (const insertedType of ["task", "end"] as const) {
    const project = insertStepAfter(original, "first", newStep({ type: insertedType }));
    assert.deepEqual(project.steps[2].routes, [{ targetId: "new-task", label: "" }]);
    assert.deepEqual(project.steps[3].routes, []);
  }
});

test("branching, end events, artifacts and unfinished destinations are inserted in order without guessing links", () => {
  for (const sourceId of ["decision", "finish"]) {
    const original = fixture();
    const source = original.steps.find((step) => step.id === sourceId)!;
    const project = insertStepAfter(original, sourceId, newStep());
    assert.equal(project.steps.find((step) => step.id === sourceId), source);
    assert.deepEqual(project.steps.find((step) => step.id === "new-task")!.routes, []);
  }
  for (const sourceType of ["data", "annotation"] as const) {
    const original = fixture();
    original.steps[2].type = sourceType;
    const project = insertStepAfter(original, "first", newStep());
    assert.equal(project.steps[2], original.steps[2]);
    assert.deepEqual(project.steps[3].routes, []);
  }
  const draft = fixture();
  draft.steps[2].routes = [{ targetId: "", label: "Hədəf sonra seçiləcək" }];
  const inserted = insertStepAfter(draft, "first", newStep());
  assert.equal(inserted.steps[2], draft.steps[2]);
  assert.deepEqual(inserted.steps[3].routes, []);
});

test("one execution route can be spliced without modifying an associated note", () => {
  const original = fixture();
  original.steps.push(newStep({ id: "note", type: "annotation", title: "Qeyd" }));
  original.steps[2].routes.push({ targetId: "note", label: "Əlaqəli qeyd", description: "Qeyd izahı." });
  const project = insertStepAfter(original, "first", newStep());
  assert.deepEqual(project.steps[2].routes[0], { targetId: "new-task", label: "", description: "Yekunlaşdır." });
  assert.equal(project.steps[2].routes[1], original.steps[2].routes[1]);
  assert.deepEqual(project.steps[3].routes, [{ targetId: "finish", label: "" }]);
});

test("inserting a start, note, routed task or end before an existing destination preserves the original flow", () => {
  for (const step of [newStep({ type: "start" }), newStep({ type: "annotation" }), newStep({ type: "end" }), newStep({ routes: [{ targetId: "finish", label: "Artıq seçilib" }] })]) {
    const original = fixture();
    const project = insertStepAfter(original, "first", step);
    assert.equal(project.steps[2], original.steps[2]);
    assert.equal(project.steps[3], step);
  }
});

test("invalid insertion targets, duplicate identities, missing actors and capacity limits leave the draft unchanged", () => {
  const original = fixture();
  assert.equal(insertStepAfter(original, "missing", newStep()), original);
  for (const patch of [{ id: "decision" }, { id: "pool" }, { id: "lane" }, { id: "invalid id" }, { laneId: "missing" }]) {
    assert.equal(insertStepAfter(original, "first", newStep(patch)), original);
  }
  const full = { ...original, steps: Array.from({ length: 200 }, (_, index) => newStep({ id: `step-${index}` })) };
  assert.equal(insertStepAfter(full, "step-0", newStep()), full);
});

test("flow renumbering uses breadth-first route order and keeps disconnected steps, annotations and data", () => {
  const original = fixture();
  const note = newStep({ id: "note", type: "annotation", routes: [{ targetId: "unconnected", label: "" }] });
  const document = newStep({ id: "document", type: "data" });
  const disconnected = newStep({ id: "unconnected" });
  original.steps = [document, original.steps[4], original.steps[2], note, original.steps[3], original.steps[1], disconnected, original.steps[0]];
  original.steps.find((step) => step.id === "start")!.routes.push({ targetId: "note", label: "Qeyd" }, { targetId: "missing", label: "Sonra" });
  const snapshot = structuredClone(original);
  const project = reorderStepsByFlow(original);
  assert.deepEqual(project.steps.map((step) => step.id), ["start", "decision", "second", "first", "finish", "document", "note", "unconnected"]);
  assert.equal(project.steps.length, original.steps.length);
  assert.equal(new Set(project.steps.map((step) => step.id)).size, original.steps.length);
  assert.deepEqual(original, snapshot);
  assert.equal(project.steps[0], original.steps[7]);
  assert.equal(reorderStepsByFlow(project), project);
});

test("breadth-first numbering terminates cycles, deduplicates shared joins and seeds multiple starts in existing order", () => {
  const original = fixture();
  const extraStart = newStep({ id: "second-start", type: "start", routes: [{ targetId: "first", label: "" }] });
  original.steps = [original.steps[4], original.steps[3], extraStart, original.steps[2], original.steps[1], original.steps[0]];
  original.steps.find((step) => step.id === "first")!.routes.push({ targetId: "decision", label: "Təkrar" });
  const project = reorderStepsByFlow(original);
  assert.deepEqual(project.steps.map((step) => step.id), ["second-start", "start", "first", "decision", "finish", "second"]);
  assert.equal(project.steps.filter((step) => step.id === "finish").length, 1);
  const noStart = { ...original, steps: original.steps.filter((step) => step.type !== "start") };
  assert.equal(reorderStepsByFlow(noStart), noStart);
});

test("manual and BFS ordering produce the same step and branch numbers in the preview, Word table and native Visio shapes", async () => {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseTagValue: false });
  const array = <T>(value: T | T[]): T[] => Array.isArray(value) ? value : [value];
  for (const project of [moveStepInOrder(fixture(), "decision", "down"), reorderStepsByFlow(fixture())]) {
    const expected = explanationRows(project);
    const wordZip = await JSZip.loadAsync(await generateDocx(project));
    const word = parser.parse(await wordZip.file("word/document.xml")!.async("string"));
    const wordRows = array<Record<string, unknown>>(word["w:document"]["w:body"]["w:tbl"]["w:tr"]).slice(1);
    const numbers = wordRows.map((row) => {
      const cell = array<Record<string, unknown>>(row["w:tc"] as Record<string, unknown> | Record<string, unknown>[])[0];
      const text = (cell["w:p"] as { "w:r": { "w:t": string | { "#text": string } } })["w:r"]["w:t"];
      return typeof text === "string" ? text : text["#text"];
    });
    assert.deepEqual(numbers, expected.map((row) => row.number));
    const visioZip = await JSZip.loadAsync(await generateVsdx(project));
    const visio = parser.parse(await visioZip.file("visio/pages/page1.xml")!.async("string"));
    const shapes = array<{ "@Name": string; "@NameU": string; Text?: string | { "#text": string } }>(visio.PageContents.Shapes.Shape);
    for (const [index, step] of project.steps.entries()) {
      const shape = shapes.find((candidate) => candidate["@Name"] === step.title)!;
      const text = typeof shape.Text === "string" ? shape.Text : shape.Text?.["#text"];
      assert.equal(text, `${index + 1}. ${step.title}`);
      assert.equal(getStepNumber(project, step.id), String(index + 1));
    }
    const decision = project.steps.find((step) => step.id === "decision")!;
    assert.equal(getRouteNumber(project, decision.id, 0), `${getStepNumber(project, decision.id)}.1`);
    const connectors = shapes.filter((shape) => shape["@NameU"].startsWith("Connector."));
    assert.ok(connectors.some((shape) => shape["@Name"] === displayRouteLabel(project, decision.id, 0)));
    assert.ok(expected.find((row) => row.stepId === "decision" && row.routeIndex === 0)!.notes[0].includes(`addım ${getStepNumber(project, "second")}`));
  }
});


test("insertion avoids manually positioned shapes without moving the user's existing placement", () => {
  const project = createProject();
  const laneId = project.pools[0].lanes[0].id;
  project.steps = [
    {id:"start",laneId,type:"start",title:"Başla",description:"",routes:[{targetId:"task",label:""}],position:{x:240,y:55}},
    {id:"task",laneId,type:"task",title:"Yoxla",description:"",routes:[{targetId:"end",label:""}],position:{x:340,y:55}},
    {id:"end",laneId,type:"end",title:"Son",description:"",routes:[],position:{x:850,y:55}},
  ];
  const next = insertStepAfter(project, "task", {id:"inserted",laneId,type:"task",title:"Yeni addım",description:"",routes:[]});
  const layout = layoutProject(next);
  const inserted = layout.nodes.find(node => node.id === "inserted")!;
  for (const node of layout.nodes.filter(node => node.id !== "inserted")) {
    assert.equal(inserted.x < node.x + node.width && inserted.x + inserted.width > node.x && inserted.y < node.y + node.height && inserted.y + inserted.height > node.y, false);
  }
  for (const old of project.steps) assert.deepEqual(next.steps.find(step => step.id === old.id)!.position, old.position);
});
