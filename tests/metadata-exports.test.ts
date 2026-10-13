import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { EXPLANATION_HEADERS, explanationColumns, explanationRows, generateDocx } from "../lib/docx";
import { createProject } from "../lib/process";
import { STEP_METADATA_FIELDS, type Project, type StepMetadataKey } from "../lib/types";
import { generateVsdx } from "../lib/vsdx";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseAttributeValue: false, parseTagValue: false, trimValues: false, htmlEntities: true });

function array<T>(value: T | T[] | undefined): T[] {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function texts(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(texts);
  if (typeof node !== "object" || node === null) return [];
  return Object.entries(node).flatMap(([name, value]) => {
    if (name !== "w:t") return texts(value);
    return array(value).map((text) => typeof text === "string" ? text :
      typeof text === "object" && text !== null && "#text" in text ? String(text["#text"]) : "");
  });
}

function fixture(): Project {
  return {
    version: 1, id: "metadata-export", name: "Sənədin təsdiqi",
    pools: [{ id: "pool", name: "Təşkilat", lanes: [{ id: "lane", name: "Vizaçı" }] }],
    steps: [
      { id: "start", laneId: "lane", type: "start", title: "Başla", description: "", routes: [{ targetId: "decision", label: "" }] },
      { id: "decision", laneId: "lane", type: "xor", title: "Təsdiqlə", description: "Məlumatı yoxla.", duration: " 2 iş günü ", system: " Sənəd dövriyyəsi ", document: " Müraciət forması ", routes: [
        { targetId: "end", label: "Təsdiq", description: "Sənəd tamamlanır." },
        { targetId: "start", label: "İmtina", description: "Düzəliş üçün qaytarılır." },
      ] },
      { id: "end", laneId: "lane", type: "end", title: "Bitir", description: "", routes: [] },
    ],
  };
}

async function word(project: Project, columns: readonly StepMetadataKey[] = []) {
  const zip = await JSZip.loadAsync(await generateDocx(project, { columns }));
  const xml = await zip.file("word/document.xml")!.async("string");
  assert.equal(XMLValidator.validate(xml), true);
  const body = parser.parse(xml)["w:document"]["w:body"];
  return { xml, table: body["w:tbl"] };
}

test("metadata stays in the default three-column explanation without repeating branch facts", async () => {
  const project = fixture();
  const rows = explanationRows(project);
  const main = rows.find((row) => row.number === "2")!;
  assert.deepEqual(main.metadata, { duration: "2 iş günü", system: "Sənəd dövriyyəsi", document: "Müraciət forması" });
  for (const field of STEP_METADATA_FIELDS) assert.ok(main.notes.includes(`${field.label}: ${main.metadata[field.key]}`));
  for (const row of rows.filter((row) => row.routeIndex !== undefined)) {
    assert.deepEqual(row.metadata, { duration: "", system: "", document: "" });
    assert.equal(row.notes.some((note) => STEP_METADATA_FIELDS.some((field) => note.startsWith(`${field.label}:`))), false);
  }
  const { table } = await word(project);
  assert.deepEqual(texts(array(table["w:tr"])[0]), [...EXPLANATION_HEADERS]);
  assert.ok(texts(table).includes("Müddət (SLA): 2 iş günü"));
  assert.equal(array(table["w:tblGrid"]["w:gridCol"]).length, 3);
});

test("metadata column choices are canonical and selected fields do not duplicate description notes", () => {
  const options = { columns: ["document", "duration", "document"] as StepMetadataKey[] };
  assert.deepEqual(explanationColumns(options).map((field) => field.key), ["duration", "document"]);
  assert.deepEqual(explanationColumns(), []);
  const main = explanationRows(fixture(), options).find((row) => row.number === "2")!;
  assert.equal(main.notes.some((note) => note.startsWith("Müddət (SLA):") || note.startsWith("Sənəd:")), false);
  assert.ok(main.notes.includes("Sistem: Sənəd dövriyyəsi"));
  assert.ok(main.notes.includes("XOR: şərtə görə yalnız bir çıxış seçilir."));
});

test("all metadata column combinations produce matching Word cells, blank branch cells and page widths", async () => {
  const project = fixture();
  for (let mask = 0; mask < 8; mask++) {
    const selected = STEP_METADATA_FIELDS.filter((_, index) => mask & (1 << index));
    const columns = selected.map((field) => field.key);
    const { table } = await word(project, columns);
    const rows = array<Record<string, unknown>>(table["w:tr"]);
    assert.deepEqual(texts(rows[0]), [...EXPLANATION_HEADERS, ...selected.map((field) => field.label)]);
    const preview = explanationRows(project, { columns });
    assert.equal(rows.length, preview.length + 1);
    for (let index = 0; index < preview.length; index++) {
      const cells = array(rows[index + 1]["w:tc"]);
      assert.equal(cells.length, 3 + columns.length);
      assert.equal(texts(cells[0]).join(""), preview[index].number);
      selected.forEach((field, column) => assert.equal(texts(cells[column + 3]).join(""), preview[index].metadata[field.key]));
    }
    const widths = array<{ "@w:w": string }>(table["w:tblGrid"]["w:gridCol"]).map((column) => Number(column["@w:w"]));
    assert.equal(widths.length, 3 + columns.length);
    assert.equal(widths.reduce((sum, width) => sum + width, 0), 15398);
    assert.ok(widths.every((width) => width > 0));
    if (mask === 0) assert.deepEqual(widths, [1400, 2800, 11198]);
  }
});

test("metadata XML escaping preserves Unicode and line breaks without adding Word table cells", async () => {
  const project = fixture();
  project.steps[1].system = 'Birinci\nİkinci\tsətir <w:tc> & "sistem" 😀\u0000\ud800';
  const { xml, table } = await word(project, ["system"]);
  assert.match(xml, /İkinci<\/w:t><w:tab\/><w:t xml:space="preserve">sətir &lt;w:tc&gt; &amp; &quot;sistem&quot; 😀/);
  assert.equal(xml.includes("\u0000"), false);
  assert.equal(xml.includes("\ud800"), false);
  for (const row of array<Record<string, unknown>>(table["w:tr"])) assert.equal(array(row["w:tc"]).length, 4);
});

interface ShapeCell { "@N": string; "@V": string; }
interface ShapeRow { "@N": string; Cell: ShapeCell | ShapeCell[]; }
interface ShapeSection { "@N": string; Row?: ShapeRow | ShapeRow[]; }
interface Shape { "@Name": string; Section?: ShapeSection | ShapeSection[]; }

async function shapeProperties(project: Project) {
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const xml = await zip.file("visio/pages/page1.xml")!.async("string");
  assert.equal(XMLValidator.validate(xml), true);
  const shapes = array<Shape>(parser.parse(xml).PageContents.Shapes.Shape);
  return { xml, byTitle: new Map(shapes.map((shape) => [shape["@Name"], array(array(shape.Section).find((section) => section["@N"] === "Property")?.Row)])) };
}

function propertyValue(row: ShapeRow, name: string): string | undefined {
  return array(row.Cell).find((cell) => cell["@N"] === name)?.["@V"];
}

test("VSDX shape data preserves populated metadata with Azerbaijani labels and omits blank values", async () => {
  const project = fixture();
  project.steps[1].system = 'Birinci\r\nİkinci\tsətir & "sistem" <qeyd> 😀';
  project.steps[0].duration = "  ";
  const { xml, byTitle } = await shapeProperties(project);
  const properties = byTitle.get("Təsdiqlə")!;
  const expected = { duration: "Duration", system: "System", document: "Document" };
  for (const field of STEP_METADATA_FIELDS) {
    const row = properties.find((property) => property["@N"] === expected[field.key])!;
    assert.ok(row);
    assert.equal(propertyValue(row, "Label"), field.label);
    assert.equal(propertyValue(row, "Value"), project.steps[1][field.key]);
  }
  assert.equal(propertyValue(properties.find((row) => row["@N"] === "Description")!, "Value"), project.steps[1].description);
  assert.equal(propertyValue(properties.find((row) => row["@N"] === "ProjectStepId")!, "Value"), "decision");
  assert.equal(byTitle.get("Başla")!.some((row) => Object.values(expected).includes(row["@N"])), false);
  assert.equal(byTitle.get("Bitir")!.some((row) => Object.values(expected).includes(row["@N"])), false);
  assert.match(xml, /Birinci&#xD;&#xA;İkinci&#x9;sətir &amp; &quot;sistem&quot; &lt;qeyd&gt; 😀/);
});

test("legacy projects retain three Word columns and unchanged Visio shape data", async () => {
  const project = fixture();
  for (const step of project.steps) {
    delete step.duration;
    delete step.system;
    delete step.document;
  }
  const { table } = await word(project);
  for (const row of array<Record<string, unknown>>(table["w:tr"])) assert.equal(array(row["w:tc"]).length, 3);
  const { byTitle } = await shapeProperties(project);
  for (const step of project.steps) assert.deepEqual(byTitle.get(step.title)!.map((row) => row["@N"]), ["ProjectStepId", "StepType", "Description"]);
  const empty = await word(createProject(), ["duration", "system", "document"]);
  assert.equal(array(empty.table["w:tr"]).length, 1);
  assert.equal(array(array<Record<string, unknown>>(empty.table["w:tr"])[0]["w:tc"]).length, 6);
});

test("malformed metadata is rejected before building Word and Visio packages", async () => {
  const project = fixture();
  const invalid = { ...project, steps: project.steps.map((step, index) => index === 1 ? { ...step, duration: 42 } : step) } as unknown as Project;
  await assert.rejects(generateDocx(invalid), /məlumatları düzgün deyil/);
  await assert.rejects(generateVsdx(invalid), /strukturu düzgün deyil/);
});
