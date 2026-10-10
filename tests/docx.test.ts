import assert from "node:assert/strict";
import { posix } from "node:path";
import test from "node:test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { EXPLANATION_HEADERS, explanationRows, generateDocx } from "../lib/docx";
import { createProject, SAMPLE_PROJECT } from "../lib/process";
import { displayRouteLabel, getRouteNumber, getStepNumber } from "../lib/step-numbering";
import type { Project, StepType } from "../lib/types";

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@", parseAttributeValue: false, parseTagValue: false });

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

async function document(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml")!.async("string");
  return { zip, xml, body: parser.parse(xml)["w:document"]["w:body"] };
}

function branchedProject(): Project {
  return {
    version: 1, id: "word-project", name: 'Müştəri müraciətləri & "QNV" <izah> 😀',
    pools: [{ id: "pool", name: "Təşkilat", lanes: [{ id: "operator", name: "Operator" }, { id: "approver", name: "Vizaçı" }] }],
    steps: [
      { id: "start", type: "start", laneId: "operator", title: "Yeni sənəd", description: "Birinci sətir\nİkinci sətir\təlavə", routes: [{ targetId: "decision", label: "", description: "Sənəd yoxlama üçün təqdim olunur." }] },
      { id: "decision", type: "xor", laneId: "approver", title: "Viza təsdiqlənib?", description: "Sənədi yoxla.", routes: [
        { targetId: "end", label: "Təsdiq", description: "Bütün vizalar toplandıqdan sonra\nsənəd imzaya təqdim olunur." },
        { targetId: "start", label: "İmtina", description: "Sənəd operatora redaktə üçün qaytarılır." },
        { targetId: "", label: "Dəqiqləşdirmə", description: "Hədəf sonra seçiləcək." },
        { targetId: "deleted", label: "Köhnə keçid", description: "Mövcud olmayan addımla bağlı qeyd." },
      ] },
      { id: "end", type: "end", laneId: "operator", title: "Tamamlandı", description: "QNV “İcra olunub” statusu alır.", routes: [] },
    ],
  };
}

test("DOCX is an OOXML package with valid parts, content types and resolving relationships", async () => {
  const bytes = await generateDocx(branchedProject());
  assert.ok(bytes instanceof Uint8Array);
  assert.deepEqual(Array.from(bytes.slice(0, 2)), [0x50, 0x4b]);
  const zip = await JSZip.loadAsync(bytes, { checkCRC32: true });
  for (const path of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels", "docProps/core.xml", "docProps/app.xml"]) assert.ok(zip.file(path), path);
  for (const part of Object.values(zip.files).filter((file) => !file.dir)) {
    const xml = await part.async("string");
    assert.equal(XMLValidator.validate(xml), true, `${part.name} is well formed XML`);
    if (!part.name.endsWith(".rels")) continue;
    const relationships = array<{ "@Id": string; "@Target": string }>(parser.parse(xml).Relationships.Relationship);
    assert.equal(new Set(relationships.map((relationship) => relationship["@Id"])).size, relationships.length);
    const base = part.name.replace(/_rels\/[^/]*\.rels$/, "");
    for (const relationship of relationships) assert.ok(zip.file(posix.normalize(`${base}${relationship["@Target"]}`)));
  }
  const overrides = array<{ "@PartName": string; "@ContentType": string }>(parser.parse(await zip.file("[Content_Types].xml")!.async("string")).Types.Override);
  assert.equal(overrides.find((part) => part["@PartName"] === "/word/document.xml")?.["@ContentType"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml");
  for (const override of overrides) assert.ok(zip.file(override["@PartName"].slice(1)));
});

test("Word exports a native editable three-column table with repeating header and matching branch numbers", async () => {
  const project = branchedProject();
  const { zip, body, xml } = await document(await generateDocx(project));
  const table = body["w:tbl"];
  const rows = array<Record<string, unknown>>(table["w:tr"]);
  assert.equal(rows.length, 1 + project.steps.length + 4);
  assert.deepEqual(texts(rows[0]), [...EXPLANATION_HEADERS]);
  assert.ok(Object.hasOwn(rows[0]["w:trPr"] as object, "w:tblHeader"));
  const numbers = rows.slice(1).map((row) => texts(array(row["w:tc"])[0]).join(""));
  assert.deepEqual(numbers, ["1", "2", "2.1", "2.2", "2.3", "2.4", "3"]);
  for (const row of rows) assert.equal(array(row["w:tc"]).length, 3);
  const widths = array<{ "@w:w": string }>(table["w:tblGrid"]["w:gridCol"]).map((column) => Number(column["@w:w"]));
  assert.equal(widths.reduce((sum, width) => sum + width, 0), 15398);
  assert.equal(body["w:sectPr"]["w:pgSz"]["@w:orient"], "landscape");
  assert.equal(Number(body["w:sectPr"]["w:pgSz"]["@w:w"]) - 2 * Number(body["w:sectPr"]["w:pgMar"]["@w:left"]), 15398);
  assert.doesNotMatch(xml, /altChunk|<w:drawing|<w:pict/);
  assert.equal(Object.keys(zip.files).some((path) => /\.(?:html?|png|jpe?g|svg)$/i.test(path)), false);
});

test("table preview and Word preserve multiline descriptions, full branch explanations and actual actors", async () => {
  const project = branchedProject();
  const rows = explanationRows(project);
  assert.equal(rows[0].actor, "Operator");
  assert.equal(rows[0].description, project.steps[0].description);
  assert.ok(rows[0].notes.includes("Sənəd yoxlama üçün təqdim olunur."));
  const decision = rows.find((row) => row.number === "2")!;
  assert.equal(decision.actor, "Vizaçı");
  assert.equal(decision.notes.length, 1, "branch facts live in their numbered rows rather than duplicated in the main row");
  assert.equal(decision.notes[0], "XOR: şərtə görə yalnız bir çıxış seçilir.");
  const approved = rows.find((row) => row.number === "2.1")!;
  assert.equal(approved.actor, "Vizaçı");
  assert.equal(approved.stepId, "decision");
  assert.equal(approved.routeIndex, 0);
  assert.equal(approved.description, project.steps[1].routes[0].description);
  assert.deepEqual(approved.notes, ["Keçid: Təsdiq → Tamamlandı (addım 3)."]);
  assert.match(rows.find((row) => row.number === "2.3")!.notes[0], /Hədəf seçilməyib/);
  assert.match(rows.find((row) => row.number === "2.4")!.notes[0], /Mövcud olmayan addım/);
  const { xml, body } = await document(await generateDocx(project));
  assert.ok(texts(body).includes(project.name));
  assert.match(xml, /Birinci sətir<\/w:t><w:br\/><w:t xml:space="preserve">İkinci sətir/);
  assert.match(xml, /<w:tab\/>/);
  assert.match(xml, /Bütün vizalar toplandıqdan sonra<\/w:t><w:br\/>/);
  assert.equal(texts(body).filter((text) => text === "Sənəd operatora redaktə üçün qaytarılır.").length, 1);
});

test("gateway notes distinguish choices and synchronisation without treating artifact links as flow", () => {
  for (const type of ["xor", "or", "and"] as StepType[]) {
    const project: Project = {
      ...createProject(), steps: [
        { id: "a", laneId: "missing", type: "task", title: "A", description: "", routes: [{ targetId: "g", label: "" }] },
        { id: "b", laneId: "missing", type: "task", title: "B", description: "", routes: [{ targetId: "g", label: "" }] },
        { id: "g", laneId: "missing", type, title: "Qərar", description: "", routes: [{ targetId: "a", label: "Birinci" }, { targetId: "b", label: "İkinci" }] },
        { id: "note", laneId: "missing", type: "annotation", title: "Qeyd", description: "İzah", routes: [{ targetId: "g", label: "" }] },
      ],
    };
    const rows = explanationRows(project);
    const gateway = rows.find((row) => row.stepId === "g" && row.routeIndex === undefined)!;
    assert.equal(gateway.notes.length, 2);
    assert.match(gateway.notes[0], new RegExp(`^${type.toUpperCase()}:`));
    assert.match(gateway.notes[1], new RegExp(`^${type.toUpperCase()} birləşməsi:`));
    assert.equal(gateway.actor, "İcraçı seçilməyib");
    assert.match(rows.find((row) => row.stepId === "note")!.notes[0], /^Əlaqə:/);
  }
  const rows = explanationRows(SAMPLE_PROJECT);
  assert.ok(rows.length > SAMPLE_PROJECT.steps.length);
  assert.equal(rows.find((row) => row.stepId === "completed")!.notes[0], "Bu qol burada tamamlanır.");
});

test("XML-invalid controls and injected markup cannot alter the Word table structure", async () => {
  const project = branchedProject();
  project.name += '\u0000\ud800</w:body><w:p>Injected';
  project.steps[0].title = 'İcra\u0000\u0001\uffff <w:tr> & "davam"';
  project.steps[1].routes[0].description += '\u000b </w:tc><w:tc>Saxta';
  const { body, xml } = await document(await generateDocx(project));
  assert.equal(XMLValidator.validate(xml), true);
  assert.doesNotMatch(xml, /[\u0000\u0001\u000b\uffff]/);
  assert.match(xml, /&lt;w:tr&gt; &amp; &quot;davam&quot;/);
  assert.equal(array(body["w:tbl"]["w:tr"]).length, 8);
  assert.ok(texts(body).some((text) => text.includes("</w:tc><w:tc>Saxta")));
});

test("unfinished and empty drafts export safely and malformed data is rejected", async () => {
  const project = createProject();
  assert.deepEqual(explanationRows(project), []);
  const { xml, body } = await document(await generateDocx(project));
  assert.equal(XMLValidator.validate(xml), true);
  assert.equal(array(body["w:tbl"]["w:tr"]).length, 1);
  assert.ok(texts(body).includes("Hələ addım əlavə edilməyib."));
  const invalid = { ...project, steps: [{ id: "bad", routes: "not an array" }] };
  await assert.rejects(generateDocx(invalid as unknown as Project), /məlumatları düzgün deyil/);
});

test("shared branch numbers and line captions follow step order and handle unlabelled routes", () => {
  const project = branchedProject();
  assert.equal(getStepNumber(project, "decision"), "2");
  assert.equal(getRouteNumber(project, "decision", 0), "2.1");
  assert.equal(getRouteNumber(project, "start", 0), "1");
  assert.equal(displayRouteLabel(project, "decision", 0), "2.1 · Təsdiq");
  assert.equal(displayRouteLabel(project, "start", 0), "");
  project.steps[1].routes[1].label = "   ";
  assert.equal(displayRouteLabel(project, "decision", 1), "2.2");
  project.steps.reverse();
  assert.equal(getStepNumber(project, "start"), "3");
  assert.equal(getRouteNumber(project, "start", 0), "3");
  for (const invalidIndex of [-1, 4, 0.5]) assert.equal(getRouteNumber(project, "decision", invalidIndex), "");
  assert.equal(getStepNumber(project, "missing"), "");
  assert.equal(displayRouteLabel(project, "missing", 0), "");
});
