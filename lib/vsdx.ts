import JSZip from "jszip";
import { layoutProject } from "./layout";
import { isProject } from "./process";
import { displayRouteLabel, getStepNumber } from "./step-numbering";
import { annotationText } from "./annotation-text";
import { STEP_METADATA_FIELDS, type LayoutEdge, type LayoutNode, type LayoutPoint, type Project, type Route, type Step, type StepMetadataKey } from "./types";

const VISIO_NS = "http://schemas.microsoft.com/office/visio/2012/main";
const REL_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const OFFICE_REL_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const VISIO_REL_NS = "http://schemas.microsoft.com/visio/2010/relationships";
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
const PIXELS_PER_INCH = 96;

/** Remove characters XML 1.0 cannot represent, while preserving Unicode text. */
function escapeXml(value: string): string {
  return Array.from(value)
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code === 9 || code === 10 || code === 13 ||
        (code >= 0x20 && code <= 0xd7ff) ||
        (code >= 0xe000 && code <= 0xfffd) ||
        (code >= 0x10000 && code <= 0x10ffff);
    })
    .join("")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Character references prevent XML attribute whitespace normalization. */
function escapeAttribute(value: string): string {
  return escapeXml(value).replace(/\t/g, "&#x9;").replace(/\n/g, "&#xA;").replace(/\r/g, "&#xD;");
}

function number(value: number): string {
  if (!Number.isFinite(value)) throw new Error("Diaqram koordinatı düzgün deyil.");
  return String(Math.round(value * 1_000_000) / 1_000_000);
}

function cell(name: string, value: number | string, formula?: string, unit?: string): string {
  return `<Cell N="${escapeAttribute(name)}" V="${escapeAttribute(typeof value === "number" ? number(value) : value)}"${unit ? ` U="${unit}"` : ""}${formula ? ` F="${escapeAttribute(formula)}"` : ""}/>`;
}

function characterSection(size = 10, color = "#24344B", bold = false, horizontalAlign = 1): string {
  return `<Section N="Character"><Row IX="0">${cell("Font", "Calibri")}${cell("Size", size / 72, undefined, "PT")}${cell("Color", color)}${cell("Style", bold ? 1 : 0)}${cell("LangID", "az-Latn-AZ")}</Row></Section><Section N="Paragraph"><Row IX="0">${cell("HorzAlign", horizontalAlign)}</Row></Section>`;
}

type RelativePoint = [number, number];

/** Native ShapeSheet geometry, with formulas so shapes can be resized in Visio. */
function polyline(index: number, points: RelativePoint[], width: number, height: number, fill = false): string {
  return `<Section N="Geometry" IX="${index}">${cell("NoFill", fill ? 0 : 1)}${cell("NoLine", 0)}${points.map(([x, y], row) => `<Row IX="${row + 1}" T="${row ? "LineTo" : "MoveTo"}">${cell("X", x * width, `Width*${number(x)}`)}${cell("Y", y * height, `Height*${number(y)}`)}</Row>`).join("")}</Section>`;
}

function rectangle(width: number, height: number): string {
  return polyline(0, [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]], width, height, true);
}

function ellipse(index: number, width: number, height: number, inset = 0, fill = true): string {
  return `<Section N="Geometry" IX="${index}">${cell("NoFill", fill ? 0 : 1)}<Row IX="1" T="Ellipse">${cell("X", width / 2, "Width*0.5")}${cell("Y", height / 2, "Height*0.5")}${cell("A", width * (1 - inset), `Width*${number(1 - inset)}`)}${cell("B", height / 2, "Height*0.5")}${cell("C", width / 2, "Width*0.5")}${cell("D", height * (1 - inset), `Height*${number(1 - inset)}`)}</Row></Section>`;
}

const ANCHORS: RelativePoint[] = [[1, 0.5], [0, 0.5], [0.5, 1], [0.5, 0]];

function connectionPoints(width: number, height: number, anchors: RelativePoint[]): string {
  return `<Section N="Connection">${anchors.map(([x, y], index) => `<Row IX="${index}" T="Connection">${cell("X", width * x, `Width*${number(x)}`)}${cell("Y", height * y, `Height*${number(y)}`)}${cell("DirX", x === 1 ? 1 : x === 0 ? -1 : 0)}${cell("DirY", y === 1 ? 1 : y === 0 ? -1 : 0)}${cell("Type", 0)}</Row>`).join("")}</Section>`;
}

interface NativeShapeOptions {
  id: number;
  name: string;
  rect: { x: number; y: number; width: number; height: number };
  pageHeight: number;
  geometry: string;
  text: string;
  cells?: string;
  sections?: string;
  fill?: string;
  fillPattern?: number;
  line?: string;
  fontSize?: number;
  bold?: boolean;
  lineWidth?: number;
  annotation?: boolean;
}

function nativeShape(options: NativeShapeOptions): string {
  const { id, name, rect, pageHeight, geometry, text } = options;
  const width = rect.width / PIXELS_PER_INCH;
  const height = rect.height / PIXELS_PER_INCH;
  return `<Shape ID="${id}" Name="${escapeAttribute(name)}" NameU="Shape.${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">${cell("PinX", (rect.x + rect.width / 2) / PIXELS_PER_INCH)}${cell("PinY", (pageHeight - rect.y - rect.height / 2) / PIXELS_PER_INCH)}${cell("Width", width)}${cell("Height", height)}${cell("LocPinX", width / 2, "Width*0.5")}${cell("LocPinY", height / 2, "Height*0.5")}${cell("Angle", 0)}${cell("FlipX", 0)}${cell("FlipY", 0)}${cell("LineColor", options.line ?? "#8795AD")}${cell("LineWeight", options.lineWidth ?? 0.013889)}${cell("LinePattern", 1)}${cell("FillForegnd", options.fill ?? "#FFFFFF")}${cell("FillPattern", options.fillPattern ?? 1)}${cell("VerticalAlign", options.annotation ? 0 : 1)}${cell("LeftMargin", options.annotation ? 14 / PIXELS_PER_INCH : 0.07)}${cell("RightMargin", options.annotation ? 14 / PIXELS_PER_INCH : 0.07)}${cell("TopMargin", options.annotation ? 6 / PIXELS_PER_INCH : 0.04)}${cell("BottomMargin", 0.04)}${options.cells ?? ""}${characterSection(options.fontSize, options.annotation ? "#4472C4" : "#24344B", options.bold, options.annotation ? 0 : 1)}${geometry}${options.sections ?? ""}<Text><cp IX="0"/><pp IX="0"/>${escapeXml(text)}</Text></Shape>`;
}

function properties(step: Step): string {
  const values: [string, string, string][] = [
    ["ProjectStepId", "ProjectStepId", step.id],
    ["StepType", "StepType", step.type],
    ["Description", "Description", step.description],
  ];
  const metadataKeys: Record<StepMetadataKey, string> = { duration: "Duration", system: "System", document: "Document" };
  for (const field of STEP_METADATA_FIELDS) {
    const value = step[field.key];
    if (value?.trim()) values.push([metadataKeys[field.key], field.label, value]);
  }
  return `<Section N="Property">${values.map(([key, label, value]) => `<Row N="${key}">${cell("Label", label)}${cell("Type", 0)}${cell("Value", value)}</Row>`).join("")}</Section>`;
}

/** Full editor explanations stay on the native connector even when its visible label is short. */
function routeProperties(edge: LayoutEdge, route: Route): string {
  const values: [string, string, string][] = [
    ["SourceStepId", "Mənbə addımın identifikatoru", edge.sourceId],
    ["TargetStepId", "Hədəf addımın identifikatoru", edge.targetId],
    ["RouteLabel", "Keçidin etiketi", route.label],
    ["RouteDescription", "Keçidin izahı", route.description || ""],
  ];
  if (edge.branchNumber) values.push(["BranchNumber", "Qolun nömrəsi", edge.branchNumber]);
  return `<Section N="Property">${values.map(([key, label, value]) => `<Row N="${key}">${cell("Label", label)}${cell("Type", 0)}${cell("Value", value)}</Row>`).join("")}</Section>`;
}

function nodeShape(step: Step, node: LayoutNode, id: number, pageHeight: number, anchors: RelativePoint[], displayText = step.title): string {
  const width = node.width / PIXELS_PER_INCH;
  const height = node.height / PIXELS_PER_INCH;
  let geometry = rectangle(width, height);
  let fill = "#FFFFFF";
  let line = "#5C7BB8";
  let cells = cell("Rounding", 0.065);
  let fontSize = 10;
  let lineWidth = 0.016667;
  const event = ["start", "end", "intermediate", "message", "timer"].includes(step.type);
  const gateway = ["xor", "or", "and"].includes(step.type);

  if (event || gateway) {
    // The label is outside the symbol; all label text stays editable on the same shape.
    cells = cell("TxtWidth", Math.max(width, 1.5), "MAX(Width,1.5)") + cell("TxtHeight", 0.5) +
      cell("TxtPinX", width / 2, "Width*0.5") + cell("TxtPinY", -0.28) +
      cell("TxtLocPinX", Math.max(width, 1.5) / 2, "TxtWidth*0.5") + cell("TxtLocPinY", 0.25, "TxtHeight*0.5");
    fontSize = 9;
  }
  if (event) {
    geometry = ellipse(0, width, height);
    if (step.type === "start") { fill = "#E5F5EE"; line = "#398A69"; }
    else if (step.type === "end") { fill = "#FCEBEF"; line = "#B94D64"; lineWidth = 0.041667; }
    else {
      fill = "#EDF2FF";
      geometry += ellipse(1, width, height, 0.08, false);
    }
    if (step.type === "message") {
      geometry += polyline(2, [[0.24, 0.32], [0.76, 0.32], [0.76, 0.68], [0.24, 0.68], [0.24, 0.32]], width, height);
      geometry += polyline(3, [[0.24, 0.68], [0.5, 0.48], [0.76, 0.68]], width, height);
    } else if (step.type === "timer") {
      geometry += ellipse(2, width, height, 0.22, false);
      geometry += polyline(3, [[0.5, 0.73], [0.5, 0.5], [0.68, 0.42]], width, height);
    }
  } else if (gateway) {
    fill = "#FFF7DB";
    line = "#B68A29";
    geometry = polyline(0, [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5], [0.5, 0]], width, height, true);
    if (step.type === "or") geometry += ellipse(1, width, height, 0.28, false);
    else if (step.type === "xor") {
      geometry += polyline(1, [[0.33, 0.33], [0.67, 0.67]], width, height);
      geometry += polyline(2, [[0.33, 0.67], [0.67, 0.33]], width, height);
    } else {
      geometry += polyline(1, [[0.5, 0.27], [0.5, 0.73]], width, height);
      geometry += polyline(2, [[0.27, 0.5], [0.73, 0.5]], width, height);
    }
  } else if (step.type === "data") {
    fill = "#F0F3FA";
    cells = cell("Rounding", 0);
    geometry = polyline(0, [[0, 0], [1, 0], [1, 0.76], [0.8, 1], [0, 1], [0, 0]], width, height, true);
    geometry += polyline(1, [[0.8, 1], [0.8, 0.76], [1, 0.76]], width, height);
  } else if (step.type === "annotation") {
    line = "#BFC3C7";
    lineWidth = 1.2 / PIXELS_PER_INCH;
    fontSize = 9.75;
    cells = cell("Rounding", 0);
    const bracket = 10 / node.width;
    geometry = polyline(0, [[bracket, 1], [0, 1], [0, 0], [bracket, 0]], width, height);
  } else if (step.type === "subprocess") {
    geometry += polyline(1, [[0.46, 0.08], [0.54, 0.08], [0.54, 0.23], [0.46, 0.23], [0.46, 0.08]], width, height);
    geometry += polyline(2, [[0.5, 0.105], [0.5, 0.205]], width, height);
    geometry += polyline(3, [[0.475, 0.155], [0.525, 0.155]], width, height);
  } else if (step.type === "serviceTask") {
    fill = "#EDF2FF";
  } else if (step.type === "userTask") {
    fill = "#F0FAF7";
  }
  return nativeShape({ id, name: step.title, rect: node, pageHeight, geometry, text: step.type === "annotation" ? annotationText(step) : displayText, fill, fillPattern: step.type === "annotation" ? 0 : 1, line, cells, fontSize, lineWidth, annotation: step.type === "annotation", sections: connectionPoints(width, height, anchors) + properties(step) });
}

function nearestAnchor(node: LayoutNode, point: LayoutPoint, anchors: RelativePoint[]): number {
  let nearest = 0;
  let shortest = Number.POSITIVE_INFINITY;
  anchors.forEach(([x, y], index) => {
    const distance = Math.hypot(node.x + x * node.width - point.x, node.y + (1 - y) * node.height - point.y);
    if (distance < shortest) { shortest = distance; nearest = index; }
  });
  return nearest;
}

function anchorPosition(node: LayoutNode, anchor: number, pageHeight: number, anchors: RelativePoint[]): LayoutPoint {
  const [x, y] = anchors[anchor];
  return { x: (node.x + x * node.width) / PIXELS_PER_INCH, y: (pageHeight - node.y - (1 - y) * node.height) / PIXELS_PER_INCH };
}

function connectorShape(edge: LayoutEdge, id: number, sourceId: number, targetId: number, source: LayoutNode, target: LayoutNode, pageHeight: number, association: boolean, branching: boolean, sourceAnchors: RelativePoint[], targetAnchors: RelativePoint[], route: Route): { shape: string; connects: string } {
  const sourceAnchor = nearestAnchor(source, edge.points[0], sourceAnchors);
  const targetAnchor = nearestAnchor(target, edge.points.at(-1)!, targetAnchors);
  const begin = anchorPosition(source, sourceAnchor, pageHeight, sourceAnchors);
  const end = anchorPosition(target, targetAnchor, pageHeight, targetAnchors);
  const dx = end.x - begin.x;
  const dy = end.y - begin.y;
  const length = Math.max(Math.hypot(dx, dy), 0.000001);
  const angle = Math.atan2(dy, dx);
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const points = edge.points.map((point) => ({ x: point.x / PIXELS_PER_INCH, y: (pageHeight - point.y) / PIXELS_PER_INCH }));
  points[0] = begin;
  points[points.length - 1] = end;
  const local = points.map((point) => ({ x: (point.x - begin.x) * cosine + (point.y - begin.y) * sine, y: -(point.x - begin.x) * sine + (point.y - begin.y) * cosine }));
  const endpoint = (sheet: number, anchor: number, axis: "X" | "Y") => {
    const ref = `Sheet.${sheet}!`;
    const offsetX = `((${ref}Connections.X${anchor + 1}-${ref}LocPinX)*IF(${ref}FlipX,-1,1))`;
    const offsetY = `((${ref}Connections.Y${anchor + 1}-${ref}LocPinY)*IF(${ref}FlipY,-1,1))`;
    return axis === "X"
      ? `GUARD(${ref}PinX+${offsetX}*COS(${ref}Angle)-${offsetY}*SIN(${ref}Angle))`
      : `GUARD(${ref}PinY+${offsetX}*SIN(${ref}Angle)+${offsetY}*COS(${ref}Angle))`;
  };
  const geometry = `<Section N="Geometry" IX="0">${cell("NoFill", 1)}${local.map((point, index) => `<Row IX="${index + 1}" T="${index === 0 ? "MoveTo" : "LineTo"}">${cell("X", point.x, `Width*${number(point.x / length)}`)}${cell("Y", point.y)}</Row>`).join("")}</Section>`;
  const message = edge.message && !association;
  // Visio arrow style 20 is the centered unfilled circle used by BPMN messages.
  // Short branch routes place labels near their distinct targets. Feedback routes
  // use their long corridor so a tiny final segment does not crowd a task label.
  const segments: { begin: LayoutPoint; end: LayoutPoint; length: number; horizontal: boolean }[] = [];
  for (let index = 1; index < points.length; index++) {
    const first = points[index - 1];
    const last = points[index];
    const segmentLength = Math.hypot(last.x - first.x, last.y - first.y);
    if (segmentLength < 0.000001) continue;
    const horizontal = Math.abs(last.y - first.y) < 0.000001;
    const previous = segments.at(-1);
    if (horizontal && previous?.horizontal && Math.abs(previous.end.y - first.y) < 0.000001 &&
      Math.sign(previous.end.x - previous.begin.x) === Math.sign(last.x - first.x)) {
      previous.end = last;
      previous.length += segmentLength;
    } else {
      segments.push({ begin: first, end: last, length: segmentLength, horizontal });
    }
  }
  const horizontalSegments = segments.filter((candidate) => candidate.horizontal);
  const segment = branching && edge.points.length <= 4
    ? horizontalSegments.at(-1) ?? segments.at(-1)!
    : horizontalSegments.sort((a, b) => b.length - a.length)[0] ?? segments.sort((a, b) => b.length - a.length)[0];
  const labelWidth = Math.min(144 / PIXELS_PER_INCH, Math.max(40 / PIXELS_PER_INCH, segment.length - 8 / PIXELS_PER_INCH));
  const pageLabel = { x: (segment.begin.x + segment.end.x) / 2, y: (segment.begin.y + segment.end.y) / 2 + 20 / PIXELS_PER_INCH };
  // Text is upright, and this position is expressed in the rotated 1-D shape's
  // local coordinates. A local Y offset alone would not mean "above" on the page.
  const labelPoint = { x: (pageLabel.x - begin.x) * cosine + (pageLabel.y - begin.y) * sine, y: -(pageLabel.x - begin.x) * sine + (pageLabel.y - begin.y) * cosine };
  const shape = `<Shape ID="${id}" Name="${escapeAttribute(edge.label || "Keçid")}" NameU="Connector.${id}" Type="Shape" LineStyle="0" FillStyle="0" TextStyle="0">${cell("BeginX", begin.x, endpoint(sourceId, sourceAnchor, "X"))}${cell("BeginY", begin.y, endpoint(sourceId, sourceAnchor, "Y"))}${cell("EndX", end.x, endpoint(targetId, targetAnchor, "X"))}${cell("EndY", end.y, endpoint(targetId, targetAnchor, "Y"))}${cell("PinX", (begin.x + end.x) / 2, "(BeginX+EndX)*0.5")}${cell("PinY", (begin.y + end.y) / 2, "(BeginY+EndY)*0.5")}${cell("Width", length, "SQRT((EndX-BeginX)^2+(EndY-BeginY)^2)")}${cell("Height", 0)}${cell("LocPinX", length / 2, "Width*0.5")}${cell("LocPinY", 0)}${cell("Angle", angle, "ATAN2(EndY-BeginY,EndX-BeginX)")}${cell("ObjType", 2)}${cell("GlueType", 4)}${cell("LineColor", edge.message ? "#8E70BB" : "#617898")}${cell("LineWeight", 0.013889)}${cell("LinePattern", association ? 3 : edge.message ? 2 : 1)}${cell("FillPattern", 0)}${cell("BeginArrow", message ? 20 : 0)}${cell("EndArrow", association ? 0 : edge.message ? 1 : 13)}${cell("EndArrowSize", 2)}${cell("BegTrigger", 0, `Sheet.${sourceId}!EventXFMod`)}${cell("EndTrigger", 0, `Sheet.${targetId}!EventXFMod`)}${cell("TxtPinX", labelPoint.x, `Width*${number(labelPoint.x / length)}`)}${cell("TxtPinY", labelPoint.y)}${cell("TxtWidth", labelWidth)}${cell("TxtHeight", 0.5)}${cell("TxtLocPinX", labelWidth / 2, "TxtWidth*0.5")}${cell("TxtLocPinY", 0.25, "TxtHeight*0.5")}${cell("TxtAngle", -angle, "-Angle")}${characterSection(8)}${routeProperties(edge, route)}${geometry}<Text><cp IX="0"/><pp IX="0"/>${escapeXml(edge.label)}</Text></Shape>`;
  const connects = `<Connect FromSheet="${id}" FromCell="BeginX" FromPart="9" ToSheet="${sourceId}" ToCell="Connections.X${sourceAnchor + 1}" ToPart="${100 + sourceAnchor}"/><Connect FromSheet="${id}" FromCell="EndX" FromPart="12" ToSheet="${targetId}" ToCell="Connections.X${targetAnchor + 1}" ToPart="${100 + targetAnchor}"/>`;
  return { shape, connects };
}

function relationships(entries: { id: string; type: string; target: string }[]): string {
  return `${XML_HEADER}<Relationships xmlns="${REL_NS}">${entries.map(({ id, type, target }) => `<Relationship Id="${id}" Type="${type}" Target="${escapeXml(target)}"/>`).join("")}</Relationships>`;
}

/**
 * Generate an OPC .vsdx drawing with native, editable shapes and glued connectors.
 * No raster snapshot is embedded. Desktop Visio interoperability must additionally
 * be checked in Visio; package/graph validation alone is not a desktop smoke test.
 */
export async function generateVsdx(project: Project): Promise<Uint8Array> {
  // Reject broken references before layout can silently omit their shapes/edges.
  // This permits drafts without start/end events; semantic checks belong to the editor.
  if (!isProject(project)) throw new Error("Layihənin strukturu düzgün deyil; Visio faylı yaradılmadı.");
  const laneIds = new Set(project.pools.flatMap((pool) => pool.lanes.map((lane) => lane.id)));
  const stepIds = new Set(project.steps.map((step) => step.id));
  for (const step of project.steps) {
    if (step.laneId !== "" && !laneIds.has(step.laneId)) throw new Error(`“${step.title || "Adsız addım"}” üçün mövcud icraçı zolağı seçin.`);
    if (step.routes.some((route) => !stepIds.has(route.targetId))) {
      throw new Error(`“${step.title || "Adsız addım"}” addımındakı keçidin hədəfi mövcud deyil.`);
    }
  }
  const layout = layoutProject(project);
  const zip = new JSZip();
  // OPC parts use path names, not standalone ZIP directory entries.
  const addPart = (path: string, text: string) => zip.file(path, text, { createFolders: false });
  let nextId = 1;
  const shapes: string[] = [];
  const connections: string[] = [];
  const nodes = new Map(layout.nodes.map((node) => [node.id, node]));
  const shapeIds = new Map<string, number>();
  const steps = new Map(project.steps.map((step) => [step.id, step]));
  // The layout can stagger ports along a shape border. Add native connection
  // points at those precise ports rather than snapping them to the four centers.
  const anchorsByNode = new Map(layout.nodes.map((node) => [node.id, ANCHORS.map(([x, y]): RelativePoint => [x, y])]));
  for (const edge of layout.edges) {
    for (const [nodeId, point] of [[edge.sourceId, edge.points[0]], [edge.targetId, edge.points.at(-1)]] as const) {
      const node = nodes.get(nodeId);
      const anchors = anchorsByNode.get(nodeId);
      if (!node || !anchors || !point) continue;
      const x = Math.max(0, Math.min(1, (point.x - node.x) / node.width));
      const y = Math.max(0, Math.min(1, 1 - (point.y - node.y) / node.height));
      if (!anchors.some(([existingX, existingY]) => Math.hypot(existingX - x, existingY - y) < 0.000001)) {
        anchors.push([x, y]);
      }
    }
  }

  for (const pool of layout.pools) {
    const width = pool.width / PIXELS_PER_INCH;
    const height = pool.height / PIXELS_PER_INCH;
    shapes.push(nativeShape({ id: nextId++, name: pool.name, rect: pool, pageHeight: layout.height, geometry: rectangle(width, height), text: pool.name, fill: "#EDF2FC", line: "#9EB0CD", bold: true, cells: cell("TxtWidth", Math.max(width - 0.3, 0.1), "MAX(Width-0.3,0.1)") + cell("TxtHeight", 0.3) + cell("TxtPinX", width / 2, "Width*0.5") + cell("TxtPinY", height - 0.1875, "Height-0.1875") + cell("TxtLocPinX", (width - 0.3) / 2, "TxtWidth*0.5") + cell("TxtLocPinY", 0.15) }));
  }
  for (const lane of layout.lanes) {
    const width = lane.width / PIXELS_PER_INCH;
    const height = lane.height / PIXELS_PER_INCH;
    const divider = Math.min(136 / PIXELS_PER_INCH, width);
    const dividerGeometry = `<Section N="Geometry" IX="1">${cell("NoFill", 1)}<Row IX="1" T="MoveTo">${cell("X", divider, `MIN(Width,${number(136 / PIXELS_PER_INCH)})`)}${cell("Y", 0)}</Row><Row IX="2" T="LineTo">${cell("X", divider, `MIN(Width,${number(136 / PIXELS_PER_INCH)})`)}${cell("Y", height, "Height")}</Row></Section>`;
    shapes.push(nativeShape({ id: nextId++, name: lane.name, rect: lane, pageHeight: layout.height, geometry: rectangle(width, height) + dividerGeometry, text: lane.name, fill: "#FBFCFE", line: "#CAD4E4", fontSize: 10, bold: true, cells: cell("TxtWidth", Math.min(1.25, width), "MIN(1.25,Width)") + cell("TxtHeight", Math.max(height - 0.15, 0.1), "MAX(Height-0.15,0.1)") + cell("TxtPinX", Math.min(68 / PIXELS_PER_INCH, width / 2), `MIN(${number(68 / PIXELS_PER_INCH)},Width*0.5)`) + cell("TxtPinY", height / 2, "Height*0.5") + cell("TxtLocPinX", Math.min(1.25, width) / 2, "TxtWidth*0.5") + cell("TxtLocPinY", (height - 0.15) / 2, "TxtHeight*0.5") }));
  }
  for (const node of layout.nodes) {
    const step = steps.get(node.id);
    if (!step) continue;
    const id = nextId++;
    shapeIds.set(step.id, id);
    shapes.push(nodeShape(step, node, id, layout.height, anchorsByNode.get(node.id)!, `${getStepNumber(project, step.id)}. ${step.title}`));
  }
  for (const edge of layout.edges) {
    const sourceId = shapeIds.get(edge.sourceId);
    const targetId = shapeIds.get(edge.targetId);
    const source = nodes.get(edge.sourceId);
    const target = nodes.get(edge.targetId);
    if (!sourceId || !targetId || !source || !target || edge.points.length < 2) continue;
    const association = [steps.get(edge.sourceId)?.type, steps.get(edge.targetId)?.type]
      .some((type) => type === "data" || type === "annotation");
    const connector = connectorShape({ ...edge, label: displayRouteLabel(project, edge.sourceId, edge.routeIndex) }, nextId++, sourceId, targetId, source, target, layout.height, association, (steps.get(edge.sourceId)?.routes.length ?? 0) > 1, anchorsByNode.get(edge.sourceId)!, anchorsByNode.get(edge.targetId)!, steps.get(edge.sourceId)!.routes[edge.routeIndex]);
    shapes.push(connector.shape);
    connections.push(connector.connects);
  }

  const pageWidth = Math.max(layout.width / PIXELS_PER_INCH, 1);
  const pageHeight = Math.max(layout.height / PIXELS_PER_INCH, 1);
  addPart("[Content_Types].xml", `${XML_HEADER}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/visio/document.xml" ContentType="application/vnd.ms-visio.drawing.main+xml"/><Override PartName="/visio/pages/pages.xml" ContentType="application/vnd.ms-visio.pages+xml"/><Override PartName="/visio/pages/page1.xml" ContentType="application/vnd.ms-visio.page+xml"/><Override PartName="/visio/windows.xml" ContentType="application/vnd.ms-visio.windows+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`);
  addPart("_rels/.rels", relationships([
    { id: "rId1", type: `${VISIO_REL_NS}/document`, target: "visio/document.xml" },
    { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
    { id: "rId3", type: `${OFFICE_REL_NS}/extended-properties`, target: "docProps/app.xml" },
  ]));
  addPart("visio/document.xml", `${XML_HEADER}<VisioDocument xmlns="${VISIO_NS}" xmlns:r="${OFFICE_REL_NS}" xml:space="preserve"><DocumentSettings TopPage="0" DefaultTextStyle="0" DefaultLineStyle="0" DefaultFillStyle="0" DefaultGuideStyle="0"><GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings></DocumentSettings><Colors><ColorEntry IX="0" RGB="#000000"/><ColorEntry IX="1" RGB="#FFFFFF"/></Colors><FaceNames><FaceName NameU="Calibri"/></FaceNames><StyleSheets><StyleSheet ID="0" NameU="No Style" Name="No Style">${cell("LinePattern", 1)}${cell("LineWeight", 0.013889)}${cell("LineColor", "#24344B")}${cell("FillForegnd", "#FFFFFF")}${cell("FillPattern", 1)}${cell("VerticalAlign", 1)}${characterSection()}</StyleSheet></StyleSheets><DocumentSheet NameU="TheDoc" Name="TheDoc" LineStyle="0" FillStyle="0" TextStyle="0"/></VisioDocument>`);
  addPart("visio/_rels/document.xml.rels", relationships([
    { id: "rId1", type: `${VISIO_REL_NS}/pages`, target: "pages/pages.xml" },
    { id: "rId2", type: `${VISIO_REL_NS}/windows`, target: "windows.xml" },
  ]));
  addPart("visio/pages/pages.xml", `${XML_HEADER}<Pages xmlns="${VISIO_NS}" xmlns:r="${OFFICE_REL_NS}"><Page ID="0" Name="${escapeAttribute(project.name || "İş axını")}" NameU="Page-1" IsCustomName="1" IsCustomNameU="0" ViewScale="0.75" ViewCenterX="${number(pageWidth / 2)}" ViewCenterY="${number(pageHeight / 2)}"><PageSheet LineStyle="0" FillStyle="0" TextStyle="0">${cell("PageWidth", pageWidth)}${cell("PageHeight", pageHeight)}${cell("PageScale", 1, undefined, "IN")}${cell("DrawingScale", 1, undefined, "IN")}${cell("DrawingSizeType", 0)}${cell("DrawingScaleType", 0)}${cell("InhibitSnap", 0)}</PageSheet><Rel r:id="rId1"/></Page></Pages>`);
  addPart("visio/pages/_rels/pages.xml.rels", relationships([{ id: "rId1", type: `${VISIO_REL_NS}/page`, target: "page1.xml" }]));
  addPart("visio/windows.xml", `${XML_HEADER}<Windows xmlns="${VISIO_NS}" xmlns:r="${OFFICE_REL_NS}" ClientWidth="1280" ClientHeight="800"><Window ID="0" WindowType="Drawing" WindowState="1073741824" WindowWidth="1280" WindowHeight="800" ContainerType="Page" Page="0" ViewScale="0.75" ViewCenterX="${number(pageWidth / 2)}" ViewCenterY="${number(pageHeight / 2)}"><ShowRulers>1</ShowRulers><ShowGrid>1</ShowGrid><ShowGuides>1</ShowGuides><ShowConnectionPoints>1</ShowConnectionPoints><GlueSettings>9</GlueSettings><SnapSettings>65847</SnapSettings></Window></Windows>`);
  addPart("visio/pages/page1.xml", `${XML_HEADER}<PageContents xmlns="${VISIO_NS}" xmlns:r="${OFFICE_REL_NS}" xml:space="preserve"><Shapes>${shapes.join("")}</Shapes><Connects>${connections.join("")}</Connects></PageContents>`);
  addPart("docProps/core.xml", `${XML_HEADER}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${escapeXml(project.name)}</dc:title><dc:creator>Visio Generator</dc:creator><dc:description>Redaktə olunan iş axını diaqramı</dc:description><cp:lastModifiedBy>Visio Generator</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created></cp:coreProperties>`);
  addPart("docProps/app.xml", `${XML_HEADER}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Visio Generator</Application><AppVersion>1.0</AppVersion><Pages>1</Pages></Properties>`);
  return zip.generateAsync({ type: "uint8array", compression: "DEFLATE", compressionOptions: { level: 6 }, mimeType: "application/vnd.ms-visio.drawing" });
}
