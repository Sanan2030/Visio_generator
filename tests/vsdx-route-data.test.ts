import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { reconnectDiagramRoute } from "../lib/diagram-edit";
import { insertDiagramStepOnRoute } from "../lib/diagram-splice";
import type { Project } from "../lib/types";
import { generateVsdx } from "../lib/vsdx";

interface Cell { "@N": string; "@V": string; "@F"?: string }
interface Row { "@N": string; Cell: Cell[] }
interface Section { "@N": string; Row?: Row | Row[] }
interface Shape { "@ID": string; "@NameU": string; Section: Section[]; Cell: Cell[] }
interface Connect { "@FromSheet": string; "@FromCell": string; "@ToSheet": string }

function array<T>(value: T | T[] | undefined): T[] { return value === undefined ? [] : Array.isArray(value) ? value : [value]; }

function fixture(): Project {
  return {
    version: 1, id: "route-data-project", name: "Keçid məlumatları",
    pools: [{ id: "pool", name: "Təşkilat", lanes: [{ id: "lane", name: "Operator" }] }],
    steps: [
      { id: "start", laneId: "lane", type: "start", title: "Başla", description: "", routes: [{ targetId: "task", label: "" }] },
      { id: "task", laneId: "lane", type: "task", title: "Yoxla", description: "Sənədi yoxla", routes: [
        { targetId: "approved", label: 'Təsdiq & "qəbul" <sınaq> 😀', description: 'Birinci sətir\nİkinci\tqeyd & <Shape ID="999999"/>\u0001' },
        { targetId: "rejected", label: "İmtina" },
      ] },
      { id: "approved", laneId: "lane", type: "end", title: "Təsdiqləndi", description: "", routes: [] },
      { id: "rejected", laneId: "lane", type: "end", title: "İmtina edildi", description: "", routes: [] },
      { id: "other", laneId: "lane", type: "task", title: "Əlavə baxış", description: "", routes: [] },
    ],
  };
}

function shapeData(shape: Shape): Map<string, { label: string; value: string }> {
  const rows = array(shape.Section.find(section => section["@N"] === "Property")?.Row);
  return new Map(rows.map(row => {
    const values = new Map(row.Cell.map(cell => [cell["@N"], cell["@V"]]));
    return [row["@N"], { label: values.get("Label")!, value: values.get("Value")! }];
  }));
}

async function drawing(project: Project) {
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const xml = await zip.file("visio/pages/page1.xml")!.async("string");
  assert.equal(XMLValidator.validate(xml), true);
  const parsed = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseAttributeValue: false,
    trimValues: false, htmlEntities: true }).parse(xml);
  const shapes = parsed.PageContents.Shapes.Shape as Shape[];
  return { xml, shapes, connectors: shapes.filter(shape => shape["@NameU"].startsWith("Connector.")),
    connects: array(parsed.PageContents.Connects.Connect as Connect | Connect[]) };
}

test("native connectors preserve full Unicode route labels, explanations and graph IDs with Azerbaijani ShapeData labels", async () => {
  const project = fixture();
  const { xml, shapes, connectors, connects } = await drawing(project);
  assert.equal(connectors.length, 3);
  const connector = connectors.find(shape => shapeData(shape).get("SourceStepId")?.value === "task"
    && shapeData(shape).get("TargetStepId")?.value === "approved")!;
  const data = shapeData(connector);
  assert.deepEqual(data.get("SourceStepId"), { label: "Mənbə addımın identifikatoru", value: "task" });
  assert.deepEqual(data.get("TargetStepId"), { label: "Hədəf addımın identifikatoru", value: "approved" });
  assert.deepEqual(data.get("RouteLabel"), { label: "Keçidin etiketi", value: project.steps[1].routes[0].label });
  assert.deepEqual(data.get("RouteDescription"), { label: "Keçidin izahı", value: project.steps[1].routes[0].description!.replace("\u0001", "") });
  assert.deepEqual(data.get("BranchNumber"), { label: "Qolun nömrəsi", value: "2.1" });
  assert.ok(xml.includes("&#xA;") && xml.includes("&#x9;"));
  assert.ok(!xml.includes('<Shape ID="999999"'));
  const byStep = new Map(shapes.filter(shape => !shape["@NameU"].startsWith("Connector."))
    .map(shape => [shapeData(shape).get("ProjectStepId")?.value, shape["@ID"]]));
  const glue = connects.filter(item => item["@FromSheet"] === connector["@ID"]);
  assert.equal(glue.find(item => item["@FromCell"] === "BeginX")!["@ToSheet"], byStep.get("task"));
  assert.equal(glue.find(item => item["@FromCell"] === "EndX")!["@ToSheet"], byStep.get("approved"));
  const oldRoute = connectors.find(shape => shapeData(shape).get("TargetStepId")?.value === "rejected")!;
  assert.equal(shapeData(oldRoute).get("RouteDescription")!.value, "");
});

test("moving a connector endpoint updates exported graph IDs and keeps its original full condition and explanation", async () => {
  const project = fixture();
  const changedSource = reconnectDiagramRoute(project, { sourceId: "task", routeIndex: 0 }, "source", "other");
  assert.equal(changedSource.error, undefined);
  const changedTarget = reconnectDiagramRoute(changedSource.project, changedSource.selection, "target", "rejected");
  assert.equal(changedTarget.error, undefined);
  const { connectors } = await drawing(changedTarget.project);
  const connector = connectors.find(shape => shapeData(shape).get("SourceStepId")?.value === "other")!;
  const data = shapeData(connector);
  assert.equal(data.get("TargetStepId")!.value, "rejected");
  assert.equal(data.get("RouteLabel")!.value, project.steps[1].routes[0].label);
  assert.equal(data.get("RouteDescription")!.value, project.steps[1].routes[0].description!.replace("\u0001", ""));
  assert.equal(data.has("BranchNumber"), false);
});

test("inserting a task between connected shapes preserves the source condition in Visio and records the new two-part connection", async () => {
  const project = fixture();
  const inserted = insertDiagramStepOnRoute(project, { sourceId: "task", routeIndex: 0 },
    { id: "inserted", laneId: "lane", type: "task", title: "Əlavə yoxlama", description: "Yeni əməliyyat", routes: [] });
  assert.equal(inserted.error, undefined);
  const { connectors } = await drawing(inserted.project);
  const first = connectors.find(shape => shapeData(shape).get("SourceStepId")?.value === "task"
    && shapeData(shape).get("TargetStepId")?.value === "inserted")!;
  assert.equal(shapeData(first).get("RouteLabel")!.value, project.steps[1].routes[0].label);
  assert.equal(shapeData(first).get("RouteDescription")!.value, project.steps[1].routes[0].description!.replace("\u0001", ""));
  assert.equal(shapeData(first).get("BranchNumber")!.value, "2.1");
  const second = connectors.find(shape => shapeData(shape).get("SourceStepId")?.value === "inserted")!;
  assert.equal(shapeData(second).get("TargetStepId")!.value, "approved");
  assert.equal(shapeData(second).get("RouteLabel")!.value, "");
  assert.equal(shapeData(second).get("RouteDescription")!.value, "");
  assert.equal(connectors.length, 4);
});
