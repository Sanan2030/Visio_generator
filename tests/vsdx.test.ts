import assert from "node:assert/strict";
import { posix } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { layoutProject } from "../lib/layout";
import { SAMPLE_PROJECT } from "../lib/process";
import { generateVsdx } from "../lib/vsdx";
import type { Project, StepType } from "../lib/types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseAttributeValue: false, parseTagValue: false });
const STEP_TYPES: StepType[] = ["start", "task", "userTask", "serviceTask", "subprocess", "xor", "or", "and", "intermediate", "message", "timer", "data", "annotation", "end"];

function fixture(): Project {
  return {
    version: 1,
    id: "project-unicode",
    name: 'Müştəri müraciətləri & "QNV" <sınaq>',
    pools: [
      { id: "pool-a", name: "Daxili proses", lanes: [{ id: "lane-a", name: "Operator" }, { id: "lane-b", name: "Vizaçı" }] },
      { id: "pool-b", name: "Xarici tərəf", lanes: [{ id: "lane-c", name: "İcraçı" }] },
    ],
    steps: STEP_TYPES.map((type, index) => ({
      id: `step-${index}`,
      laneId: index === 9 ? "lane-c" : index % 2 ? "lane-b" : "lane-a",
      type,
      title: index === 0 ? 'Başlanğıc & "Müştəri" <müraciət> 😀' : `${type} addımı`,
      description: `İcraçının təsviri & <qeyd> "${index}"`,
      routes: index < STEP_TYPES.length - 1 ? [{ targetId: `step-${index + 1}`, label: index === 5 ? "Təsdiq & davam" : "" }] : [],
    })),
  };
}

function array<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

interface XmlCell {
  "@N": string;
  "@V": string;
  "@F"?: string;
}
interface XmlRow {
  "@N"?: string;
  "@T"?: string;
  "@IX"?: string;
  Cell?: XmlCell | XmlCell[];
}
interface XmlSection {
  "@N": string;
  "@IX"?: string;
  Row?: XmlRow | XmlRow[];
  Cell?: XmlCell | XmlCell[];
}
interface XmlShape {
  "@ID": string;
  "@Name": string;
  "@NameU": string;
  "@Type": string;
  Cell: XmlCell | XmlCell[];
  Section?: XmlSection | XmlSection[];
  Text?: { "#text"?: string } | string;
}
interface XmlConnect {
  "@FromSheet": string;
  "@FromCell": string;
  "@FromPart": string;
  "@ToSheet": string;
  "@ToCell": string;
  "@ToPart": string;
}
interface XmlRelationship {
  "@Id": string;
  "@Type": string;
  "@Target": string;
}
interface XmlOverride {
  "@PartName": string;
  "@ContentType": string;
}

async function getPage(zip: JSZip): Promise<{ xml: string; shapes: XmlShape[]; connects: XmlConnect[] }> {
  const xml = await zip.file("visio/pages/page1.xml")!.async("string");
  const page = parser.parse(xml).PageContents;
  return { xml, shapes: array(page.Shapes.Shape), connects: array(page.Connects.Connect) };
}

test("VSDX is a valid XML/ZIP OPC package and every internal relationship resolves", async () => {
  const bytes = await generateVsdx(fixture());
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [0x50, 0x4b]);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  const expected = ["[Content_Types].xml", "_rels/.rels", "visio/document.xml", "visio/_rels/document.xml.rels", "visio/pages/pages.xml", "visio/pages/_rels/pages.xml.rels", "visio/pages/page1.xml", "docProps/core.xml", "docProps/app.xml"];
  for (const filename of expected) assert.ok(zip.file(filename), `${filename} exists`);
  for (const part of Object.values(zip.files).filter((file) => !file.dir)) {
    const xml = await part.async("string");
    assert.equal(XMLValidator.validate(xml), true, `${part.name} is well formed XML`);
    if (!part.name.endsWith(".rels")) continue;
    const relationships = array<XmlRelationship>(parser.parse(xml).Relationships.Relationship);
    assert.equal(new Set(relationships.map((relationship) => relationship["@Id"])).size, relationships.length);
    const base = part.name.replace(/_rels\/[^/]*\.rels$/, "");
    for (const relationship of relationships) {
      const target = posix.normalize(`${base}${relationship["@Target"]}`);
      assert.ok(zip.file(target), `${part.name}: ${target} exists`);
    }
  }
  const contentTypes = parser.parse(await zip.file("[Content_Types].xml")!.async("string")).Types;
  const overrides = array<XmlOverride>(contentTypes.Override);
  assert.equal(overrides.find((part) => part["@PartName"] === "/visio/document.xml")?.["@ContentType"], "application/vnd.ms-visio.drawing.main+xml");
  for (const override of overrides) assert.ok(zip.file(override["@PartName"].slice(1)));
  const pages = parser.parse(await zip.file("visio/pages/pages.xml")!.async("string")).Pages;
  assert.equal(pages.Page.Rel["@r:id"], "rId1");
  assert.equal(pages.Page["@Name"], fixture().name);
  assert.ok(Number(array<XmlCell>(pages.Page.PageSheet.Cell).find((value) => value["@N"] === "PageWidth")?.["@V"]) > 0);
});

test("VSDX exports all supported symbols as editable shapes and preserves Unicode text", async () => {
  const project = fixture();
  const layout = layoutProject(project);
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const { xml, shapes } = await getPage(zip);
  assert.equal(shapes.length, layout.pools.length + layout.lanes.length + layout.nodes.length + layout.edges.length);
  assert.equal(new Set(shapes.map((shape) => shape["@ID"])).size, shapes.length);
  assert.equal(shapes.filter((shape) => shape["@Type"] !== "Shape").length, 0);
  assert.equal(Object.keys(zip.files).some((name) => /\.(?:png|svg|jpe?g)$/i.test(name)), false);
  assert.doesNotMatch(xml, /<ForeignData/);
  assert.match(xml, /Başlanğıc &amp; &quot;Müştəri&quot; &lt;müraciət&gt; 😀/);
  assert.match(xml, /İcraçının təsviri &amp; &lt;qeyd&gt;/);
  for (const type of STEP_TYPES) {
    const shape = shapes.find((candidate) => array(candidate.Section).some((section) =>
      section["@N"] === "Property" && array(section.Row).some((row) =>
        row["@N"] === "StepType" && array(row.Cell).some((value) => value["@N"] === "Value" && value["@V"] === type))));
    assert.ok(shape, `${type} has a native shape with editable type metadata`);
    const geometry = array(shape.Section).filter((section) => section["@N"] === "Geometry");
    assert.ok(geometry.length > 0);
    if (["start", "end", "intermediate", "message", "timer"].includes(type)) {
      assert.equal(array(geometry[0].Row)[0]["@T"], "Ellipse");
    }
    if (["xor", "or", "and"].includes(type)) assert.ok(geometry.length >= 2, `${type} has its gateway marker`);
    const cellNames = array(shape.Cell).map((value) => value["@N"]);
    assert.equal(new Set(cellNames).size, cellNames.length, "ShapeSheet cell names are unique");
  }
});

test("every graph edge has the correct connector type glued to its source and target shapes", async () => {
  const project = fixture();
  const layout = layoutProject(project);
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const { shapes, connects } = await getPage(zip);
  const byId = new Map(shapes.map((shape) => [shape["@ID"], shape]));
  const nativeIdByStep = new Map<string, string>();
  for (const shape of shapes) {
    const properties = array(shape.Section).find((section) => section["@N"] === "Property");
    const stepId = array(properties?.Row).find((row) => row["@N"] === "ProjectStepId");
    const value = array(stepId?.Cell).find((value) => value["@N"] === "Value")?.["@V"];
    if (value) nativeIdByStep.set(value, shape["@ID"]);
  }
  const connectors = shapes.filter((shape) => shape["@NameU"].startsWith("Connector."));
  assert.equal(connectors.length, layout.edges.length);
  assert.equal(connects.length, layout.edges.length * 2);
  for (const [index, edge] of layout.edges.entries()) {
    const connector = connectors[index];
    const connectorCells = array(connector.Cell);
    const association = [project.steps.find((step) => step.id === edge.sourceId)?.type, project.steps.find((step) => step.id === edge.targetId)?.type]
      .some((type) => type === "data" || type === "annotation");
    const endArrow = Number(connectorCells.find((value) => value["@N"] === "EndArrow")?.["@V"]);
    if (association) assert.equal(endArrow, 0);
    else assert.ok(endArrow > 0);
    assert.equal(connectorCells.find((value) => value["@N"] === "LinePattern")?.["@V"], association ? "3" : edge.message ? "2" : "1");
    const ends = connects.filter((connection) => connection["@FromSheet"] === connector["@ID"]);
    assert.equal(ends.length, 2);
    assert.equal(ends.find((connection) => connection["@FromCell"] === "BeginX")?.["@ToSheet"], nativeIdByStep.get(edge.sourceId));
    assert.equal(ends.find((connection) => connection["@FromCell"] === "EndX")?.["@ToSheet"], nativeIdByStep.get(edge.targetId));
    for (const end of ends) {
      const node = byId.get(end["@ToSheet"]);
      assert.ok(node);
      const anchors = array(node.Section).find((section) => section["@N"] === "Connection");
      assert.ok(array(anchors?.Row).some((row) => Number(row["@IX"]) + 100 === Number(end["@ToPart"])));
      const endpoint = connectorCells.find((value) => value["@N"] === end["@FromCell"]);
      assert.ok(endpoint?.["@F"]?.includes(`Sheet.${node["@ID"]}!Connections.`));
    }
  }
});

test("XML-invalid control characters are removed without creating injected shapes", async () => {
  const project = fixture();
  project.steps[0].title = 'İcra\u0000\u0001 <Shape ID="999"/> & davam';
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const { xml, shapes } = await getPage(zip);
  assert.equal(XMLValidator.validate(xml), true);
  assert.doesNotMatch(xml, /[\u0000\u0001]/);
  assert.equal(shapes.some((shape) => shape["@ID"] === "999"), false);
  assert.ok(shapes.some((shape) => shape["@Name"] === 'İcra <Shape ID="999"/> & davam'));
});

test("short gateway branch labels use separate target segments and stay above routes in page coordinates", async () => {
  const project: Project = {
    version: 1,
    id: "branches",
    name: "Qərar qolları",
    pools: [{ id: "p", name: "Proses", lanes: [
      { id: "first", name: "Birinci" },
      { id: "second", name: "İkinci" },
      { id: "third", name: "Üçüncü" },
    ] }],
    steps: [{
      id: "choice", laneId: "first", type: "xor", title: "Əməliyyatı seç", description: "",
      routes: ["first", "second", "third"].map((lane, index) => ({ targetId: `task-${lane}`, label: `${index + 1}-ci əməliyyatın şərti` })),
    }, ...["first", "second", "third"].map((lane): Project["steps"][number] => ({
      id: `task-${lane}`, laneId: lane, type: "task", title: "Əməliyyat", description: "", routes: [],
    }))],
  };
  const layout = layoutProject(project);
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const { shapes } = await getPage(zip);
  const connectors = shapes.filter((shape) => shape["@NameU"].startsWith("Connector."));
  const labelPositions: number[] = [];
  for (const [index, connector] of connectors.entries()) {
    const edge = layout.edges[index];
    assert.ok(edge.points.length <= 4);
    const values = new Map(array(connector.Cell).map((value) => [value["@N"], Number(value["@V"])]));
    const angle = values.get("Angle")!;
    const textX = values.get("TxtPinX")! - values.get("LocPinX")!;
    const textY = values.get("TxtPinY")! - values.get("LocPinY")!;
    const pageY = values.get("PinY")! + textX * Math.sin(angle) + textY * Math.cos(angle);
    const target = layout.nodes.find((node) => node.id === edge.targetId)!;
    const expectedY = (layout.height - target.y - target.height / 2 + 20) / 96;
    assert.ok(Math.abs(pageY - expectedY) < 0.00001, "each label is 20px above its own target route");
    assert.ok(values.get("TxtWidth")! <= 144 / 96);
    assert.ok(values.get("TxtWidth")! >= 40 / 96 - 0.000001);
    labelPositions.push(Math.round(pageY * 96));
  }
  assert.equal(new Set(labelPositions).size, 3, "branch labels do not share the source segment");
});

test("sample connections preserve staggered border ports instead of snapping them to shape centers", async () => {
  const layout = layoutProject(SAMPLE_PROJECT);
  const zip = await JSZip.loadAsync(await generateVsdx(SAMPLE_PROJECT));
  const { shapes } = await getPage(zip);
  const connectors = shapes.filter((shape) => shape["@NameU"].startsWith("Connector."));
  for (const [index, connector] of connectors.entries()) {
    const edge = layout.edges[index];
    const values = new Map(array(connector.Cell).map((value) => [value["@N"], Number(value["@V"])]));
    const first = edge.points[0];
    const last = edge.points.at(-1)!;
    assert.ok(Math.abs(values.get("BeginX")! * 96 - first.x) < 0.0001);
    assert.ok(Math.abs(layout.height - values.get("BeginY")! * 96 - first.y) < 0.0001);
    assert.ok(Math.abs(values.get("EndX")! * 96 - last.x) < 0.0001);
    assert.ok(Math.abs(layout.height - values.get("EndY")! * 96 - last.y) < 0.0001);
  }
});
