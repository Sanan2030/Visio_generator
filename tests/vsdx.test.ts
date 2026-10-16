import assert from "node:assert/strict";
import { posix } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { layoutProject } from "../lib/layout";
import { SAMPLE_PROJECT } from "../lib/process";
import { generateVsdx } from "../lib/vsdx";
import type { Project, StepType } from "../lib/types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseAttributeValue: false, parseTagValue: false, htmlEntities: true });
const STEP_TYPES: StepType[] = ["start", "task", "userTask", "serviceTask", "subprocess", "xor", "or", "and", "intermediate", "message", "timer", "data", "annotation", "end"];

test("native Visio branch captions retain shared numbers without changing shape identities", async () => {
  const project = fixture();
  project.steps[5].routes = [
    { targetId: project.steps[6].id, label: "Təsdiq" },
    { targetId: project.steps[7].id, label: "İmtina" },
    { targetId: project.steps[8].id, label: "Əlavə yoxlama" },
  ];
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const xml = await zip.file("visio/pages/page1.xml")!.async("string");
  assert.equal(XMLValidator.validate(xml), true);
  assert.ok(xml.includes('Name="xor addımı"'));
  assert.ok(xml.includes("6. xor addımı"));
  for (const caption of ["6.1 · Təsdiq", "6.2 · İmtina", "6.3 · Əlavə yoxlama"]) assert.ok(xml.includes(caption));
});

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

type NumericScope = Record<string, number>;

/** Evaluate only the arithmetic/functions emitted by our ShapeSheet generator. */
function evaluateFormula(formula: string, local: NumericScope, sheets = new Map<string, NumericScope>()): number {
  const functions = {
    GUARD: (value: number) => value,
    IF: (condition: number, yes: number, no: number) => condition ? yes : no,
    COS: Math.cos,
    SIN: Math.sin,
    MAX: Math.max,
    MIN: Math.min,
    SQRT: Math.sqrt,
    ATAN2: Math.atan2,
  };
  const expression = formula
    .replace(/Sheet\.(\d+)!([A-Za-z0-9_.]+)/g, (_, id: string, name: string) => {
      const value = sheets.get(id)?.[name];
      assert.ok(value !== undefined && Number.isFinite(value), `known numeric reference: Sheet.${id}!${name}`);
      return `(${value})`;
    })
    .replace(/\b[A-Za-z_][A-Za-z0-9_.]*/g, (name) => {
      if (Object.hasOwn(functions, name)) return name;
      assert.ok(Object.hasOwn(local, name), `known local reference: ${name}`);
      return `(${local[name]})`;
    });
  assert.match(expression, /^[0-9eE+\-*/^().,\sA-Z_]+$/);
  return Function(...Object.keys(functions), `"use strict";return (${expression.replaceAll("^", "**")});`)(...Object.values(functions));
}

function numericScope(shape: XmlShape): NumericScope {
  return Object.fromEntries(array(shape.Cell).filter((value) => Number.isFinite(Number(value["@V"])))
    .map((value) => [value["@N"], Number(value["@V"])]));
}

function cellValue(value: XmlCell, local: NumericScope, sheets?: Map<string, NumericScope>): number {
  return value["@F"] ? evaluateFormula(value["@F"], local, sheets) : Number(value["@V"]);
}

function shapeCell(shape: XmlShape, name: string): XmlCell {
  const value = array(shape.Cell).find((candidate) => candidate["@N"] === name);
  assert.ok(value, `${shape["@NameU"]}.${name} exists`);
  return value;
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

test("VSDX annotations preserve blue multiline text with a transparent bracket and no step number", async () => {
  const project = fixture();
  const note = project.steps.find((step) => step.type === "annotation")!;
  note.title = "• Temp_raport_no (Raportun müvəqqəti nömrəsi)";
  note.description = "- Status (Rejected)\n• İcraçının ad, soyad, ata adı\n• İmtina qeydi";
  const { shapes } = await getPage(await JSZip.loadAsync(await generateVsdx(project)));
  const shape = shapes.find((candidate) => candidate["@Name"] === note.title)!;
  assert.ok(shape);
  assert.equal(shapeCell(shape, "FillPattern")["@V"], "0");
  assert.equal(shapeCell(shape, "LineColor")["@V"], "#BFC3C7");
  assert.equal(shapeCell(shape, "VerticalAlign")["@V"], "0");
  const character = array(shape.Section).find((section) => section["@N"] === "Character")!;
  const paragraph = array(shape.Section).find((section) => section["@N"] === "Paragraph")!;
  assert.equal(array(array(character.Row)[0].Cell).find((value) => value["@N"] === "Color")?.["@V"], "#4472C4");
  assert.equal(array(array(paragraph.Row)[0].Cell).find((value) => value["@N"] === "HorzAlign")?.["@V"], "0");
  const text = typeof shape.Text === "string" ? shape.Text : shape.Text?.["#text"];
  assert.equal(text, `${note.title}\n• Status (Rejected)\n• İcraçının ad, soyad, ata adı\n• İmtina qeydi`);
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
    if (edge.message && !association) {
      assert.equal(connectorCells.find((value) => value["@N"] === "BeginArrow")?.["@V"], "20", "message source uses a native hollow-circle marker");
      assert.equal(connectorCells.find((value) => value["@N"] === "FillPattern")?.["@V"], "0");
    }
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

test("native endpoint and geometry formulas stay attached after move, resize, rotation and mirror", async () => {
  const zip = await JSZip.loadAsync(await generateVsdx(SAMPLE_PROJECT));
  const { shapes, connects } = await getPage(zip);
  const byId = new Map(shapes.map((shape) => [shape["@ID"], shape]));
  for (const [flipX, flipY] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
    const sheets = new Map<string, NumericScope>();
    for (const shape of shapes.filter((candidate) => !candidate["@NameU"].startsWith("Connector."))) {
      const original = numericScope(shape);
      const changed: NumericScope = { ...original, Width: original.Width * 1.4, Height: original.Height * 0.8,
        PinX: original.PinX + 3, PinY: original.PinY - 1, Angle: Math.PI / 3, FlipX: flipX, FlipY: flipY };
      changed.LocPinX = cellValue(shapeCell(shape, "LocPinX"), changed);
      changed.LocPinY = cellValue(shapeCell(shape, "LocPinY"), changed);
      const anchors = array(shape.Section).find((section) => section["@N"] === "Connection");
      for (const row of array(anchors?.Row)) {
        for (const value of array(row.Cell).filter((candidate) => candidate["@N"] === "X" || candidate["@N"] === "Y")) {
          changed[`Connections.${value["@N"]}${Number(row["@IX"]) + 1}`] = cellValue(value, changed);
        }
      }
      sheets.set(shape["@ID"], changed);
    }
    for (const connector of shapes.filter((shape) => shape["@NameU"].startsWith("Connector."))) {
      const updated = numericScope(connector);
      for (const connection of connects.filter((value) => value["@FromSheet"] === connector["@ID"])) {
        const node = byId.get(connection["@ToSheet"])!;
        const scope = sheets.get(node["@ID"])!;
        const index = Number(connection["@ToPart"]) - 100 + 1;
        const offsetX = (scope[`Connections.X${index}`] - scope.LocPinX) * (flipX ? -1 : 1);
        const offsetY = (scope[`Connections.Y${index}`] - scope.LocPinY) * (flipY ? -1 : 1);
        const expectedX = scope.PinX + offsetX * Math.cos(scope.Angle) - offsetY * Math.sin(scope.Angle);
        const expectedY = scope.PinY + offsetX * Math.sin(scope.Angle) + offsetY * Math.cos(scope.Angle);
        const prefix = connection["@FromCell"] === "BeginX" ? "Begin" : "End";
        updated[`${prefix}X`] = cellValue(shapeCell(connector, `${prefix}X`), updated, sheets);
        updated[`${prefix}Y`] = cellValue(shapeCell(connector, `${prefix}Y`), updated, sheets);
        assert.ok(Math.abs(updated[`${prefix}X`] - expectedX) < 0.000001);
        assert.ok(Math.abs(updated[`${prefix}Y`] - expectedY) < 0.000001);
      }
      for (const name of ["PinX", "PinY", "Width", "LocPinX", "Angle"]) updated[name] = cellValue(shapeCell(connector, name), updated);
      const geometry = array(connector.Section).find((section) => section["@N"] === "Geometry");
      const rows = array(geometry?.Row);
      for (const [row, prefix] of [[rows[0], "Begin"], [rows.at(-1)!, "End"]] as const) {
        const x = cellValue(array(row.Cell).find((value) => value["@N"] === "X")!, updated) - updated.LocPinX;
        const y = cellValue(array(row.Cell).find((value) => value["@N"] === "Y")!, updated) - updated.LocPinY;
        const pageX = updated.PinX + x * Math.cos(updated.Angle) - y * Math.sin(updated.Angle);
        const pageY = updated.PinY + x * Math.sin(updated.Angle) + y * Math.cos(updated.Angle);
        assert.ok(Math.abs(pageX - updated[`${prefix}X`]) < 0.000001, "geometry X meets the glued endpoint");
        assert.ok(Math.abs(pageY - updated[`${prefix}Y`]) < 0.000001, "geometry Y meets the glued endpoint");
      }
    }
  }
});

test("resizing native containers and event symbols recomputes text dimensions and lane label divider", async () => {
  const project = fixture();
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const { shapes } = await getPage(zip);
  const pool = shapes.find((shape) => shape["@Name"] === project.pools[0].name)!;
  const poolScope = { ...numericScope(pool), Width: 15 };
  assert.equal(cellValue(shapeCell(pool, "TxtWidth"), poolScope), 14.7);
  const lane = shapes.find((shape) => shape["@Name"] === project.pools[0].lanes[0].name)!;
  const laneScope = { ...numericScope(lane), Width: 0.7, Height: 3 };
  assert.equal(cellValue(shapeCell(lane, "TxtWidth"), laneScope), 0.7);
  assert.equal(cellValue(shapeCell(lane, "TxtHeight"), laneScope), 2.85);
  assert.equal(cellValue(shapeCell(lane, "TxtPinX"), laneScope), 0.35);
  const divider = array(lane.Section).find((section) => section["@N"] === "Geometry" && section["@IX"] === "1")!;
  const dividerX = array(array(divider.Row)[0].Cell).find((value) => value["@N"] === "X")!;
  assert.equal(cellValue(dividerX, laneScope), 0.7);
  assert.ok(Math.abs(cellValue(dividerX, { ...laneScope, Width: 20 }) - 136 / 96) < 0.000001);
  const start = shapes.find((shape) => shape["@Name"] === project.steps[0].title)!;
  assert.equal(cellValue(shapeCell(start, "TxtWidth"), { ...numericScope(start), Width: 4 }), 4);
});

test("ShapeData descriptions preserve line breaks and tabs through XML attributes", async () => {
  const project = fixture();
  const description = 'Birinci sətir\r\nİkinci\tsətir & "qeyd"\nÜçüncü sətir';
  project.steps[0].description = description;
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const { xml, shapes } = await getPage(zip);
  assert.match(xml, /&#xD;&#xA;İkinci&#x9;sətir/);
  const shape = shapes.find((candidate) => candidate["@Name"] === project.steps[0].title)!;
  const properties = array(shape.Section).find((section) => section["@N"] === "Property")!;
  const row = array(properties.Row).find((candidate) => candidate["@N"] === "Description")!;
  assert.equal(array(row.Cell).find((value) => value["@N"] === "Value")?.["@V"], description);
});

test("broken project references and duplicate identifiers reject export instead of dropping content", async () => {
  const missingLane = fixture();
  missingLane.steps[0].laneId = "not-found";
  await assert.rejects(generateVsdx(missingLane), /icraçı zolağı/);
  const missingTarget = fixture();
  missingTarget.steps[0].routes[0].targetId = "not-found";
  await assert.rejects(generateVsdx(missingTarget), /hədəfi mövcud deyil/);
  missingTarget.steps[0].routes[0].targetId = "";
  await assert.rejects(generateVsdx(missingTarget), /hədəfi mövcud deyil/);
  const duplicate = fixture();
  duplicate.steps[1].id = duplicate.steps[0].id;
  await assert.rejects(generateVsdx(duplicate), /strukturu düzgün deyil/);
  const unsupported = fixture();
  unsupported.steps[0].type = "unsupported" as StepType;
  await assert.rejects(generateVsdx(unsupported), /strukturu düzgün deyil/);
});

test("self-loop geometry keeps finite editable coordinates and both ends on the same native shape", async () => {
  const project: Project = {
    version: 1, id: "self-loop", name: "Təkrar əməliyyat",
    pools: [{ id: "pool", name: "Proses", lanes: [{ id: "lane", name: "İcraçı" }] }],
    steps: [
      { id: "start", laneId: "lane", type: "start", title: "Başla", description: "", routes: [{ targetId: "task", label: "" }] },
      { id: "task", laneId: "lane", type: "task", title: "Yoxla", description: "", routes: [{ targetId: "task", label: "Yenidən yoxla" }, { targetId: "end", label: "Tamamlandı" }] },
      { id: "end", laneId: "lane", type: "end", title: "Bitir", description: "", routes: [] },
    ],
  };
  const layout = layoutProject(project);
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const { shapes, connects } = await getPage(zip);
  const index = layout.edges.findIndex((edge) => edge.sourceId === "task" && edge.targetId === "task");
  const connector = shapes.filter((shape) => shape["@NameU"].startsWith("Connector."))[index];
  const endpoints = connects.filter((connection) => connection["@FromSheet"] === connector["@ID"]);
  assert.equal(endpoints.length, 2);
  assert.equal(endpoints[0]["@ToSheet"], endpoints[1]["@ToSheet"]);
  const scope = numericScope(connector);
  assert.ok(scope.Width > 0);
  const geometry = array(connector.Section).find((section) => section["@N"] === "Geometry")!;
  const rows = array(geometry.Row);
  assert.equal(rows.length, layout.edges[index].points.length);
  for (const [pointIndex, row] of rows.entries()) {
    const x = cellValue(array(row.Cell).find((value) => value["@N"] === "X")!, scope) - scope.LocPinX;
    const y = cellValue(array(row.Cell).find((value) => value["@N"] === "Y")!, scope) - scope.LocPinY;
    const pageX = scope.PinX + x * Math.cos(scope.Angle) - y * Math.sin(scope.Angle);
    const pageY = scope.PinY + x * Math.sin(scope.Angle) + y * Math.cos(scope.Angle);
    assert.ok(Number.isFinite(pageX) && Number.isFinite(pageY));
    assert.ok(Math.abs(pageX * 96 - layout.edges[index].points[pointIndex].x) < 0.002);
    assert.ok(Math.abs(layout.height - pageY * 96 - layout.edges[index].points[pointIndex].y) < 0.002);
  }
});

test("manual canvas positions are exported as editable Visio coordinates with attached rerouted connectors", async () => {
  const project = fixture();
  project.steps[0].position = { x: 1750, y: 38 };
  project.steps[1].position = { x: 750, y: 430 };
  project.steps[2].position = { x: 2950, y: 1500 };
  project.steps.at(-1)!.position = { x: 6400, y: 720 };
  const layout = layoutProject(project);
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const { shapes, connects } = await getPage(zip);
  for (const step of project.steps.filter(step => step.position)) {
    const node = layout.nodes.find(candidate => candidate.id === step.id)!;
    const shape = shapes.find(candidate => array(candidate.Section).some(section => section["@N"] === "Property"
      && array(section.Row).some(row => row["@N"] === "ProjectStepId"
        && array(row.Cell).some(value => value["@N"] === "Value" && value["@V"] === step.id))))!;
    assert.ok(shape, "manual node remains a native editable shape");
    const values = numericScope(shape);
    assert.ok(Math.abs(values.PinX * 96 - node.x - node.width / 2) < 0.0001);
    assert.ok(Math.abs(layout.height - values.PinY * 96 - node.y - node.height / 2) < 0.0001);
  }
  const connectors = shapes.filter(shape => shape["@NameU"].startsWith("Connector."));
  for (const [index, edge] of layout.edges.entries()) {
    const connector = connectors[index];
    const values = numericScope(connector);
    const first = edge.points[0];
    const last = edge.points.at(-1)!;
    assert.ok(Math.abs(values.BeginX * 96 - first.x) < 0.0001);
    assert.ok(Math.abs(layout.height - values.BeginY * 96 - first.y) < 0.0001);
    assert.ok(Math.abs(values.EndX * 96 - last.x) < 0.0001);
    assert.ok(Math.abs(layout.height - values.EndY * 96 - last.y) < 0.0001);
    assert.equal(connects.filter(connection => connection["@FromSheet"] === connector["@ID"]).length, 2);
  }
  const pages = parser.parse(await zip.file("visio/pages/pages.xml")!.async("string")).Pages;
  const dimensions = new Map(array<XmlCell>(pages.Page.PageSheet.Cell).map(value => [value["@N"], Number(value["@V"])]));
  assert.ok(Math.abs(dimensions.get("PageWidth")! * 96 - layout.width) < 0.0001);
  assert.ok(Math.abs(dimensions.get("PageHeight")! * 96 - layout.height) < 0.0001);
});
