import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { duplicateDiagramStep, moveDiagramStep, reconnectDiagramRoute } from "../lib/diagram-edit";
import { explanationRows, generateDocx } from "../lib/docx";
import { layoutProject, MAX_NODE_POSITION, MIN_NODE_X, MIN_NODE_Y } from "../lib/layout";
import { isProject } from "../lib/process";
import { displayRouteLabel, getRouteNumber } from "../lib/step-numbering";
import type { Project } from "../lib/types";
import { generateVsdx } from "../lib/vsdx";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseAttributeValue: false, parseTagValue: false });

function fixture(): Project {
  return {
    version: 1, id: "editing-project", name: "Sənədin yoxlanması",
    pools: [
      { id: "organisation", name: "Təşkilat", lanes: [{ id: "operator", name: "Operator" }, { id: "approver", name: "Vizaçı" }] },
      { id: "customer", name: "Müştəri", lanes: [{ id: "recipient", name: "Müştəri nümayəndəsi" }] },
    ],
    steps: [
      { id: "start", type: "start", laneId: "operator", title: "Başla", description: "", routes: [{ targetId: "decision", label: "" }] },
      { id: "decision", type: "xor", laneId: "operator", title: "Sənəd düzgündür?", description: "Əsas məlumatları yoxla.", routes: [
        { targetId: "finish", label: "Təsdiq", description: "Bütün məlumatlar uyğundur.\nSənəd tamamlanır." },
        { targetId: "work", label: "İmtina", description: "Məlumatlar düzəliş üçün geri qaytarılır." },
      ] },
      { id: "work", type: "userTask", laneId: "operator", title: "Sənədi düzəlt", description: "Çatışmayan məlumatları daxil et.", routes: [{ targetId: "finish", label: "Düzəldildi" }] },
      { id: "review", type: "userTask", laneId: "approver", title: "Əlavə yoxla", description: "Məlumatları vizaçı yoxlayır.", routes: [{ targetId: "work", label: "Düzəliş", description: "Əlavə yoxlamanın qeydi." }] },
      { id: "external", type: "userTask", laneId: "recipient", title: "Müştərini məlumatlandır", description: "Müştəriyə nəticə göndərilir.", routes: [{ targetId: "finish", label: "Ünvanlandı" }] },
      { id: "finish", type: "end", laneId: "approver", title: "Tamamlandı", description: "QNV bağlanır.", routes: [] },
    ],
  };
}

function array<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function texts(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([name, value]) => name === "w:t"
    ? array(value).map((text) => typeof text === "string" ? text :
      typeof text === "object" && text !== null && "#text" in text ? String(text["#text"]) : "")
    : texts(value));
}

async function wordRows(project: Project): Promise<string[][]> {
  const zip = await JSZip.loadAsync(await generateDocx(project));
  const xml = await zip.file("word/document.xml")!.async("string");
  return array<{ "w:tc": unknown[] }>(parser.parse(xml)["w:document"]["w:body"]["w:tbl"]["w:tr"])
    .slice(1).map((row) => array(row["w:tc"]).map((cell) => texts(cell).join("\n")));
}

interface XmlCell { "@N": string; "@V": string }
interface XmlRow { "@N"?: string; Cell?: XmlCell | XmlCell[] }
interface XmlSection { "@N": string; Row?: XmlRow | XmlRow[] }
interface XmlShape { "@ID": string; "@NameU": string; Cell?: XmlCell | XmlCell[]; Section?: XmlSection | XmlSection[] }
interface XmlConnect { "@FromSheet": string; "@FromCell": string; "@ToSheet": string }

async function assertNativeConnectors(project: Project) {
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const xml = await zip.file("visio/pages/page1.xml")!.async("string");
  const page = parser.parse(xml).PageContents;
  const shapes = array<XmlShape>(page.Shapes.Shape);
  const connects = array<XmlConnect>(page.Connects.Connect);
  const ids = new Map(shapes.flatMap((shape) => {
    const property = array(shape.Section).find((section) => section["@N"] === "Property");
    const row = array(property?.Row).find((candidate) => candidate["@N"] === "ProjectStepId");
    const value = array(row?.Cell).find((candidate) => candidate["@N"] === "Value")?.["@V"];
    return value ? [[value, shape["@ID"]] as const] : [];
  }));
  const edges = layoutProject(project).edges;
  const connectors = shapes.filter((shape) => shape["@NameU"].startsWith("Connector."));
  assert.equal(connectors.length, edges.length);
  assert.equal(connects.length, edges.length * 2);
  edges.forEach((edge, index) => {
    const connector = connectors[index];
    const ends = connects.filter((connection) => connection["@FromSheet"] === connector["@ID"]);
    assert.equal(ends.find((connection) => connection["@FromCell"] === "BeginX")?.["@ToSheet"], ids.get(edge.sourceId));
    assert.equal(ends.find((connection) => connection["@FromCell"] === "EndX")?.["@ToSheet"], ids.get(edge.targetId));
    assert.equal(array(connector.Cell).find((cell) => cell["@N"] === "LinePattern")?.["@V"], edge.message ? "2" : "1");
  });
  return xml;
}

test("moving a task to another participant changes the actor in the explanation and native Word table", async () => {
  const original = fixture();
  const snapshot = structuredClone(original);
  const project = moveDiagramStep(original, "work", { x: 480.04, y: 72.08 }, "approver");
  assert.equal(isProject(project), true);
  assert.deepEqual(original, snapshot);
  assert.equal(project.pools, original.pools);
  assert.equal(project.steps[1], original.steps[1]);
  assert.deepEqual(project.steps[2], { ...original.steps[2], laneId: "approver", position: { x: 480, y: 72.1 } });
  const row = explanationRows(project).find((candidate) => candidate.stepId === "work")!;
  assert.equal(row.actor, "Vizaçı");
  assert.equal(row.description, original.steps[2].description);
  const word = (await wordRows(project)).find((candidate) => candidate[0] === "3")!;
  assert.equal(word[1], "Vizaçı");
  assert.ok(word[2].includes(original.steps[2].description));
  const layout = layoutProject(project);
  const lane = layout.lanes.find((candidate) => candidate.id === "approver")!;
  const node = layout.nodes.find((candidate) => candidate.id === "work")!;
  assert.equal(node.y, lane.y + 72.1);
});

test("cross-pool movement updates message-flow semantics without changing route facts or native connector gluing", async () => {
  const original = fixture();
  const project = moveDiagramStep(original, "work", { x: 610, y: 30 }, "recipient");
  assert.equal(project.steps[2].routes, original.steps[2].routes);
  assert.equal(explanationRows(project).find((row) => row.stepId === "work")!.actor, "Müştəri nümayəndəsi");
  const edge = layoutProject(project).edges.find((candidate) => candidate.sourceId === "work")!;
  assert.equal(edge.message, true);
  await assertNativeConnectors(project);
});

test("movement clamps coordinates and ignores missing nodes, invalid lanes and unchanged positions", () => {
  const original = fixture();
  assert.equal(moveDiagramStep(original, "deleted", { x: 300, y: 20 }, "approver"), original);
  assert.equal(moveDiagramStep(original, "work", { x: 300, y: 20 }, "deleted"), original);
  const project = moveDiagramStep(original, "work", { x: -30, y: Number.NaN });
  assert.deepEqual(project.steps[2].position, { x: MIN_NODE_X, y: MIN_NODE_Y });
  assert.equal(moveDiagramStep(project, "work", { x: MIN_NODE_X, y: MIN_NODE_Y }), project);
  const bounded = moveDiagramStep(project, "work", { x: 1e8, y: 1e8 });
  assert.deepEqual(bounded.steps[2].position, { x: MAX_NODE_POSITION, y: MAX_NODE_POSITION });
});

test("reconnecting an arrow target keeps its compact label and full numbered explanation", async () => {
  const original = fixture();
  const result = reconnectDiagramRoute(original, { sourceId: "decision", routeIndex: 0 }, "target", "external");
  assert.equal(result.error, undefined);
  assert.deepEqual(result.selection, { sourceId: "decision", routeIndex: 0 });
  assert.equal(original.steps[1].routes[0].targetId, "finish");
  assert.deepEqual(result.project.steps[1].routes[0], { ...original.steps[1].routes[0], targetId: "external" });
  assert.equal(result.project.steps[1].routes[1], original.steps[1].routes[1]);
  assert.equal(displayRouteLabel(result.project, "decision", 0), "2.1 · Təsdiq");
  const row = explanationRows(result.project).find((candidate) => candidate.number === "2.1")!;
  assert.equal(row.description, original.steps[1].routes[0].description);
  assert.deepEqual(row.notes, ["Keçid: Təsdiq → Müştərini məlumatlandır (addım 5)."]);
  const word = (await wordRows(result.project)).find((candidate) => candidate[0] === "2.1")!;
  assert.ok(word[2].includes(row.description));
  assert.ok(word[2].includes(row.notes[0]));
  const xml = await assertNativeConnectors(result.project);
  assert.ok(xml.includes("2.1 · Təsdiq"));
});

test("reconnecting an arrow source renumbers both sources and moves branch facts to the new actor in Word and Visio", async () => {
  const original = fixture();
  const targeted = reconnectDiagramRoute(original, { sourceId: "decision", routeIndex: 0 }, "target", "external").project;
  const result = reconnectDiagramRoute(targeted, { sourceId: "decision", routeIndex: 0 }, "source", "review");
  assert.equal(result.error, undefined);
  assert.deepEqual(result.selection, { sourceId: "review", routeIndex: 1 });
  assert.equal(result.project.steps[1].routes.length, 1);
  assert.equal(result.project.steps[3].routes[1], targeted.steps[1].routes[0]);
  assert.equal(displayRouteLabel(result.project, "decision", 0), "İmtina");
  assert.equal(getRouteNumber(result.project, "review", 1), "4.2");
  assert.equal(displayRouteLabel(result.project, "review", 1), "4.2 · Təsdiq");
  const rows = explanationRows(result.project);
  assert.equal(rows.some((row) => row.number === "2.1" || row.number === "2.2"), false);
  const declined = rows.find((row) => row.number === "2")!;
  assert.ok(declined.notes.includes(original.steps[1].routes[1].description!));
  const approved = rows.find((row) => row.number === "4.2")!;
  assert.equal(approved.actor, "Vizaçı");
  assert.equal(approved.description, original.steps[1].routes[0].description);
  assert.deepEqual(approved.notes, ["Keçid: Təsdiq → Müştərini məlumatlandır (addım 5)."]);
  const word = (await wordRows(result.project)).find((candidate) => candidate[0] === "4.2")!;
  assert.equal(word[1], approved.actor);
  assert.ok(word[2].includes(approved.description));
  assert.ok(word[2].includes(approved.notes[0]));
  const xml = await assertNativeConnectors(result.project);
  assert.ok(xml.includes("4.2 · Təsdiq"));
  assert.equal(xml.includes("2.1 · Təsdiq"), false);
});

test("invalid endpoint drops keep the original arrow and its explanation intact", () => {
  const original = fixture();
  const cases: [{ sourceId: string; routeIndex: number }, "source" | "target", string][] = [
    [{ sourceId: "missing", routeIndex: 0 }, "target", "work"],
    [{ sourceId: "decision", routeIndex: -1 }, "target", "work"],
    [{ sourceId: "decision", routeIndex: 0.5 }, "target", "work"],
    [{ sourceId: "decision", routeIndex: 4 }, "target", "work"],
    [{ sourceId: "decision", routeIndex: 0 }, "target", "missing"],
    [{ sourceId: "decision", routeIndex: 0 }, "target", "decision"],
    [{ sourceId: "decision", routeIndex: 0 }, "target", "work"],
    [{ sourceId: "decision", routeIndex: 0 }, "source", "missing"],
    [{ sourceId: "decision", routeIndex: 0 }, "source", "finish"],
    [{ sourceId: "decision", routeIndex: 0 }, "source", "work"],
    [{ sourceId: "decision", routeIndex: 1 }, "source", "work"],
  ];
  for (const [selection, endpoint, nodeId] of cases) {
    const result = reconnectDiagramRoute(original, selection, endpoint, nodeId);
    assert.equal(result.project, original);
    assert.equal(result.selection, selection);
    assert.ok(result.error);
  }
  for (const [endpoint, nodeId] of [["source", "decision"], ["target", "finish"]] as const) {
    const result = reconnectDiagramRoute(original, { sourceId: "decision", routeIndex: 0 }, endpoint, nodeId);
    assert.equal(result.project, original);
    assert.equal(result.error, undefined);
  }
});

test("a deliberately cleared route destination remains an editable draft with its full explanation", async () => {
  const original = fixture();
  const selection = { sourceId: "decision", routeIndex: 0 };
  const cleared = reconnectDiagramRoute(original, selection, "target", "");
  assert.equal(cleared.error, undefined);
  assert.deepEqual(cleared.project.steps[1].routes[0], { ...original.steps[1].routes[0], targetId: "" });
  assert.equal(isProject(JSON.parse(JSON.stringify(cleared.project))), true);
  assert.equal(layoutProject(cleared.project).edges.length, layoutProject(original).edges.length - 1);
  const row = explanationRows(cleared.project).find((candidate) => candidate.number === "2.1")!;
  assert.equal(row.description, original.steps[1].routes[0].description);
  assert.deepEqual(row.notes, ["Keçid: Təsdiq → Hədəf seçilməyib."]);
  const word = (await wordRows(cleared.project)).find((candidate) => candidate[0] === "2.1")!;
  assert.ok(word[2].includes(row.description));
  assert.ok(word[2].includes(row.notes[0]));
  assert.equal(reconnectDiagramRoute(cleared.project, selection, "target", "").project, cleared.project);
  const reassigned = reconnectDiagramRoute(cleared.project, selection, "source", "review");
  assert.equal(reassigned.error, undefined);
  assert.deepEqual(reassigned.selection, { sourceId: "review", routeIndex: 1 });
  assert.equal(reassigned.project.steps[3].routes[1], cleared.project.steps[1].routes[0]);
  await assert.rejects(generateVsdx(reassigned.project), /hədəfi mövcud deyil/);
  const restored = reconnectDiagramRoute(reassigned.project, reassigned.selection, "target", "external");
  assert.equal(restored.error, undefined);
  assert.equal(restored.project.steps[3].routes[1].description, original.steps[1].routes[0].description);
  await assertNativeConnectors(restored.project);
});

test("source reconnection rejects a full destination without losing the selected arrow", () => {
  const project = fixture();
  project.steps[3].routes = Array.from({ length: 200 }, (_, index) => ({ targetId: "work", label: `Keçid ${index}` }));
  const result = reconnectDiagramRoute(project, { sourceId: "decision", routeIndex: 0 }, "source", "review");
  assert.equal(result.project, project);
  assert.match(result.error!, /200/);
  assert.equal(project.steps[1].routes[0].description, fixture().steps[1].routes[0].description);
});

test("duplication copies task facts and actor without copying execution routes, then updates shared step numbering", async () => {
  const original = fixture();
  const snapshot = structuredClone(original);
  const node = layoutProject(original).nodes.find((candidate) => candidate.id === "work")!;
  const lane = layoutProject(original).lanes.find((candidate) => candidate.id === "operator")!;
  const result = duplicateDiagramStep(original, "work", "work-copy");
  assert.equal(result.error, undefined);
  assert.equal(result.stepId, "work-copy");
  assert.equal(isProject(result.project), true);
  assert.deepEqual(original, snapshot);
  const copy = result.project.steps[3];
  assert.deepEqual(copy, { ...original.steps[2], id: "work-copy", routes: [], position: { x: node.x + 24, y: node.y - lane.y + 24 } });
  assert.equal(result.project.steps[2], original.steps[2]);
  assert.equal(result.project.steps[0].routes[0].targetId, "decision");
  const row = explanationRows(result.project).find((candidate) => candidate.stepId === "work-copy")!;
  assert.equal(row.number, "4");
  assert.equal(row.actor, "Operator");
  assert.equal(row.description, original.steps[2].description);
  assert.ok(row.notes.includes("Növbəti addım hələ seçilməyib."));
  assert.equal(getRouteNumber(result.project, "review", 0), "5");
  const word = (await wordRows(result.project)).find((candidate) => candidate[0] === "4")!;
  assert.equal(word[1], row.actor);
  assert.ok(word[2].includes(row.description));
  await assertNativeConnectors(result.project);
});

test("duplication offsets explicit placement and rejects unsafe identities, missing actors and the shape limit", () => {
  const project = fixture();
  project.steps[2].position = { x: MAX_NODE_POSITION, y: 45 };
  assert.deepEqual(duplicateDiagramStep(project, "work", "copy").project.steps[3].position, { x: MAX_NODE_POSITION, y: 69 });
  for (const newId of ["", "bad id", "work", "operator", "organisation", "x".repeat(129)]) {
    const result = duplicateDiagramStep(project, "work", newId);
    assert.equal(result.project, project);
    assert.equal(result.stepId, undefined);
    assert.ok(result.error);
  }
  assert.equal(duplicateDiagramStep(project, "deleted", "copy").project, project);
  project.steps[2].laneId = "deleted";
  assert.match(duplicateDiagramStep(project, "work", "copy").error!, /iştirakçısını/);
  project.steps = Array.from({ length: 200 }, (_, index) => ({ ...fixture().steps[2], id: `step-${index}` }));
  const full = duplicateDiagramStep(project, "step-0", "copy");
  assert.equal(full.project, project);
  assert.match(full.error!, /200/);
});
