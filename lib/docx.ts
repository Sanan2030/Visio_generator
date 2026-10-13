import { isProject } from "./process";
import { getRouteNumber, getStepNumber } from "./step-numbering";
import { STEP_METADATA_FIELDS, type Project, type StepMetadataKey, type StepType } from "./types";

export interface ExplanationOptions {
  columns?: readonly StepMetadataKey[];
}

export interface ExplanationRow {
  number: string;
  stepId: string;
  routeIndex?: number;
  actor: string;
  title: string;
  description: string;
  notes: string[];
  metadata: Record<StepMetadataKey, string>;
}

export const EXPLANATION_HEADERS = ["Addımın sıra N-si", "İcraçı", "Addımların təsviri"] as const;

const ARTIFACT_TYPES = new Set<StepType>(["data", "annotation"]);
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const COLUMN_WIDTHS = [1400, 2800, 11198];

/** Choices keep the same order in the preview and downloaded Word table. */
export function explanationColumns(options: ExplanationOptions = {}) {
  return STEP_METADATA_FIELDS.filter((field) => options.columns?.includes(field.key));
}

/** The preview and Word download use the same facts, in the user's step order. */
export function explanationRows(project: Project, options: ExplanationOptions = {}): ExplanationRow[] {
  const separateColumns = new Set(explanationColumns(options).map((field) => field.key));
  const byId = new Map(project.steps.map((step, index) => [step.id, { step, number: index + 1 }]));
  const lanes = new Map(project.pools.flatMap((pool) => pool.lanes.map((lane) => [lane.id, lane.name] as const)));
  const incoming = new Map<string, number>();
  for (const step of project.steps) {
    if (ARTIFACT_TYPES.has(step.type)) continue;
    for (const route of step.routes) {
      const target = byId.get(route.targetId)?.step;
      if (target && !ARTIFACT_TYPES.has(target.type)) incoming.set(target.id, (incoming.get(target.id) || 0) + 1);
    }
  }

  return project.steps.flatMap((step) => {
    const metadata = Object.fromEntries(STEP_METADATA_FIELDS.map((field) => [field.key, step[field.key]?.trim() || ""])) as Record<StepMetadataKey, string>;
    const notes: string[] = STEP_METADATA_FIELDS.flatMap((field) => metadata[field.key] && !separateColumns.has(field.key)
      ? [`${field.label}: ${metadata[field.key]}`] : []);
    const outputs = step.routes.filter((route) => {
      const target = byId.get(route.targetId)?.step;
      return target && !ARTIFACT_TYPES.has(target.type);
    });
    if (outputs.length > 1) {
      if (step.type === "xor") notes.push("XOR: şərtə görə yalnız bir çıxış seçilir.");
      if (step.type === "or") notes.push("OR: şərtlərə uyğun bir və ya bir neçə çıxış seçilir.");
      if (step.type === "and") notes.push("AND: bütün çıxış qolları paralel başlayır.");
    }
    if ((incoming.get(step.id) || 0) > 1) {
      if (step.type === "and") notes.push("AND birləşməsi: bütün daxil olan qollar tamamlandıqdan sonra davam edir.");
      if (step.type === "or") notes.push("OR birləşməsi: aktivləşmiş qollar tamamlandıqdan sonra davam edir.");
      if (step.type === "xor") notes.push("XOR birləşməsi: alternativ qollardan biri gələndə davam edir.");
    }
    if (step.type === "end") notes.push("Bu qol burada tamamlanır.");
    else if (!step.routes.length && !ARTIFACT_TYPES.has(step.type)) notes.push("Növbəti addım hələ seçilməyib.");
    const routeNote = (routeIndex: number): string => {
      const route = step.routes[routeIndex];
      const target = byId.get(route.targetId);
      const attached = ARTIFACT_TYPES.has(step.type) || (target && ARTIFACT_TYPES.has(target.step.type));
      const destination = target
        ? `${target.step.title.trim() || "Adsız addım"} (addım ${target.number})`
        : route.targetId ? "Mövcud olmayan addım" : "Hədəf seçilməyib";
      return `${attached ? "Əlaqə" : "Keçid"}: ${route.label.trim() ? `${route.label.trim()} → ` : ""}${destination}.`;
    };
    if (step.routes.length === 1) {
      notes.push(routeNote(0));
      if (step.routes[0].description?.trim()) notes.push(step.routes[0].description.trim());
    }
    const actor = lanes.get(step.laneId)?.trim() || "İcraçı seçilməyib";
    const mainRow: ExplanationRow = {
      number: getStepNumber(project, step.id),
      stepId: step.id,
      actor,
      title: step.title.trim() || "Adsız addım",
      description: step.description.trim(),
      notes,
      metadata,
    };
    if (step.routes.length < 2) return [mainRow];
    return [mainRow, ...step.routes.map((route, routeIndex): ExplanationRow => ({
      number: getRouteNumber(project, step.id, routeIndex),
      stepId: step.id,
      routeIndex,
      actor,
      title: route.label.trim() || "Şərt göstərilməyib",
      description: route.description?.trim() || "",
      notes: [routeNote(routeIndex)],
      metadata: { duration: "", system: "", document: "" },
    }))];
  });
}

/** XML 1.0 permits these code points; lone surrogates and control bytes are omitted. */
function escapeXml(value: string): string {
  return Array.from(value).filter((character) => {
    const code = character.codePointAt(0)!;
    return code === 9 || code === 10 || code === 13 || (code >= 0x20 && code <= 0xd7ff)
      || (code >= 0xe000 && code <= 0xfffd) || (code >= 0x10000 && code <= 0x10ffff);
  }).join("").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function textRuns(value: string): string {
  return value.split(/(\r\n|\r|\n|\t)/).map((part) => {
    if (/^(?:\r\n|\r|\n)$/.test(part)) return "<w:br/>";
    if (part === "\t") return "<w:tab/>";
    return `<w:t xml:space="preserve">${escapeXml(part)}</w:t>`;
  }).join("");
}

function paragraph(value: string, options: { bold?: boolean; style?: string; centered?: boolean; after?: number } = {}): string {
  const properties = `${options.style ? `<w:pStyle w:val="${options.style}"/>` : ""}<w:spacing w:after="${options.after ?? 100}" w:line="264" w:lineRule="auto"/>${options.centered ? '<w:jc w:val="center"/>' : ""}`;
  return `<w:p><w:pPr>${properties}</w:pPr><w:r>${options.bold ? "<w:rPr><w:b/></w:rPr>" : ""}${textRuns(value)}</w:r></w:p>`;
}

function tableCell(content: string, width: number, header = false): string {
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${header ? '<w:shd w:val="clear" w:color="auto" w:fill="E8EDF2"/>' : ""}<w:vAlign w:val="top"/></w:tcPr>${content}</w:tc>`;
}

function documentXml(project: Project, options: ExplanationOptions): string {
  const columns = explanationColumns(options);
  const metadataWidth = 2100;
  const widths = [COLUMN_WIDTHS[0], COLUMN_WIDTHS[1], COLUMN_WIDTHS[2] - metadataWidth * columns.length, ...columns.map(() => metadataWidth)];
  const headers = [...EXPLANATION_HEADERS, ...columns.map((field) => field.label)];
  const header = `<w:tr><w:trPr><w:tblHeader/></w:trPr>${headers.map((label, index) => tableCell(paragraph(label, { bold: true, centered: index === 0, after: 0 }), widths[index], true)).join("")}</w:tr>`;
  const rows = explanationRows(project, options).map((row) => {
    const contents = [
      paragraph(row.number, { centered: true }),
      paragraph(row.actor),
      [paragraph(row.title, { bold: true }), ...(row.description ? [paragraph(row.description)] : []), ...row.notes.map((note) => paragraph(note))].join(""),
      ...columns.map((field) => paragraph(row.metadata[field.key])),
    ];
    return `<w:tr>${contents.map((content, index) => tableCell(content, widths[index])).join("")}</w:tr>`;
  }).join("");
  const borders = ["top", "left", "bottom", "right", "insideH", "insideV"].map((side) => `<w:${side} w:val="single" w:sz="4" w:space="0" w:color="B5BEC8"/>`).join("");
  const table = `<w:tbl><w:tblPr><w:tblW w:w="15398" w:type="dxa"/><w:tblBorders>${borders}</w:tblBorders><w:tblLayout w:type="fixed"/><w:tblCellMar><w:top w:w="120" w:type="dxa"/><w:left w:w="140" w:type="dxa"/><w:bottom w:w="120" w:type="dxa"/><w:right w:w="140" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${widths.map((width) => `<w:gridCol w:w="${width}"/>`).join("")}</w:tblGrid>${header}${rows}</w:tbl>`;
  return `${XML_HEADER}<w:document xmlns:w="${WORD_NS}" xmlns:r="${OFFICE_REL_NS}"><w:body>${paragraph(project.name.trim() || "İş axını", { style: "Title", after: 160 })}${paragraph("İş axınının izahı", { style: "Subtitle", after: 240 })}${table}${!project.steps.length ? paragraph("Hələ addım əlavə edilməyib.", { after: 160 }) : ""}<w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720" w:header="360" w:footer="360" w:gutter="0"/></w:sectPr></w:body></w:document>`;
}

/** An editable native Word table, packaged as Office Open XML rather than HTML. */
export async function generateDocx(project: Project, options: ExplanationOptions = {}): Promise<Uint8Array> {
  if (!isProject(project)) throw new Error("İş axınının məlumatları düzgün deyil.");
  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  zip.file("_rels/.rels", `${XML_HEADER}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="${OFFICE_REL_NS}/extended-properties" Target="docProps/app.xml"/></Relationships>`);
  zip.file("word/document.xml", documentXml(project, options));
  zip.file("word/_rels/document.xml.rels", `${XML_HEADER}<Relationships xmlns="${REL_NS}"><Relationship Id="rId1" Type="${OFFICE_REL_NS}/styles" Target="styles.xml"/></Relationships>`);
  zip.file("word/styles.xml", `${XML_HEADER}<w:styles xmlns:w="${WORD_NS}"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="az-Latn-AZ"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="100"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Subtitle"><w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/></w:pPr><w:rPr><w:color w:val="596776"/><w:sz w:val="22"/></w:rPr></w:style></w:styles>`);
  zip.file("docProps/core.xml", `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${escapeXml(project.name.trim() || "İş axını")}</dc:title><dc:subject>İş axınının izahı</dc:subject><dc:creator>VisioFlow</dc:creator></cp:coreProperties>`);
  zip.file("docProps/app.xml", `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>VisioFlow</Application></Properties>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
}
