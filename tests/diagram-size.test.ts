import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import JSZip from "jszip";
import { XMLParser } from "fast-xml-parser";
import { getPoolMinimumSize, getProjectMinimumSize, getStepMinimumSize, MAX_DIAGRAM_SIZE,
  resizeDiagramPool, resizeDiagramStep, resizeProjectCanvas } from "../lib/diagram-size";
import { layoutProject } from "../lib/layout";
import { createProject, isProject, SAMPLE_PROJECT } from "../lib/process";
import type { Project, StepType } from "../lib/types";
import { generateVsdx } from "../lib/vsdx";

function fixture(): Project {
  return {
    version: 1, id: "resize-project", name: "Ölçü sınağı",
    pools: [
      { id: "pool-a", name: "Daxili", lanes: [{ id: "lane-a", name: "Operator" }, { id: "lane-b", name: "Vizaçı" }] },
      { id: "pool-b", name: "Xarici", lanes: [{ id: "lane-c", name: "İcraçı" }] },
    ],
    steps: [
      { id: "start", laneId: "lane-a", type: "start", title: "Başla", description: "", routes: [{ targetId: "task", label: "" }] },
      { id: "task", laneId: "lane-a", type: "task", title: "Yoxla", description: "Məlumatları yoxla", duration: "2 gün", routes: [{ targetId: "end", label: "Təsdiq", description: "Sənəd təsdiqlənir" }] },
      { id: "end", laneId: "lane-b", type: "end", title: "Bitir", description: "", routes: [] },
    ],
  };
}

test("unsized version 1 drafts retain the entire legacy layout, including customer-flow corridors", () => {
  // Recorded before resizing support; this catches accidental movement of saved diagrams.
  assert.equal(createHash("sha256").update(JSON.stringify(layoutProject(SAMPLE_PROJECT))).digest("hex"),
    "87b63e028cc577badfec4e844c608e60740227e0b2525422af628867b373ce70");
  const empty = layoutProject(createProject());
  assert.deepEqual({ width: empty.width, height: empty.height, pool: empty.pools.map(({ width, height }) => ({ width, height })) },
    { width: 960, height: 302, pool: [{ width: 928, height: 262 }] });
});

test("optional page, pool and step sizes restore in version 1 while malformed or oversized dimensions are rejected", () => {
  const project = fixture();
  project.size = { width: 1700, height: 1100 };
  project.pools[0].size = { width: 1500, height: 600 };
  project.steps[1].size = { width: 220.5, height: 95.2 };
  assert.equal(isProject(project), true);
  assert.deepEqual(JSON.parse(JSON.stringify(project)), project);
  assert.equal(isProject(fixture()), true);
  for (const size of [null, [], {}, { width: 100 }, { width: "100", height: 100 }, { width: 0, height: 100 },
    { width: -1, height: 100 }, { width: 100, height: -1 }, { width: Infinity, height: 100 },
    { width: 100, height: NaN }, { width: MAX_DIAGRAM_SIZE + 1, height: 100 }, { width: 100, height: MAX_DIAGRAM_SIZE + 1 }]) {
    assert.equal(isProject({ ...fixture(), size }), false);
    const pool = fixture();
    assert.equal(isProject({ ...pool, pools: [{ ...pool.pools[0], size }] }), false);
    const step = fixture();
    assert.equal(isProject({ ...step, steps: [{ ...step.steps[1], size }] }), false);
  }
});

test("empty pages can shrink below the legacy presentation width and then expand without rewriting content", () => {
  const original = createProject();
  const snapshot = structuredClone(original);
  assert.deepEqual(getProjectMinimumSize(original), { width: 352, height: 240 });
  const small = resizeProjectCanvas(original, { width: 1, height: 1 });
  assert.deepEqual(small.size, { width: 352, height: 240 });
  assert.deepEqual(layoutProject(small).pools.map(({ width, height }) => ({ width, height })), [{ width: 320, height: 132 }]);
  const expanded = resizeProjectCanvas(small, { width: 1400, height: 900 });
  assert.deepEqual({ width: layoutProject(expanded).width, height: layoutProject(expanded).height }, { width: 1400, height: 900 });
  assert.equal(expanded.pools, original.pools);
  assert.equal(expanded.steps, original.steps);
  assert.deepEqual(original, snapshot);
  assert.equal(resizeProjectCanvas(expanded, expanded.size!), expanded);
});

test("growing one pool preserves other pool widths and enlarges the page only as needed", () => {
  const original = fixture();
  const before = layoutProject(original);
  const larger = resizeDiagramPool(original, "pool-a", { width: 1700, height: 850 });
  const after = layoutProject(larger);
  assert.equal(after.pools[0].width, 1700);
  assert.equal(after.pools[0].height, 850);
  assert.equal(after.pools[1].width, before.pools[1].width);
  assert.equal(after.pools[1].height, before.pools[1].height);
  assert.ok(after.width >= 1732);
  assert.equal(larger.pools[1], original.pools[1]);
  assert.equal(larger.steps, original.steps);
  assert.equal(resizeDiagramPool(larger, "pool-a", larger.pools[0].size!), larger);
});

test("shrinking containers respects actual content, lane corridors and stored manual positions", () => {
  const original = fixture();
  original.steps[1].position = { x: 1810, y: 350 };
  original.steps[2].position = { x: 880, y: 190 };
  const minimum = getPoolMinimumSize(original, "pool-a");
  assert.ok(minimum.width >= 1810 + 164 + 24);
  const resized = resizeDiagramPool(original, "pool-a", { width: 1, height: 1 });
  assert.deepEqual(resized.pools[0].size, minimum);
  const layout = layoutProject(resized);
  const lanes = new Map(layout.lanes.map(lane => [lane.id, lane]));
  for (const step of resized.steps) {
    const node = layout.nodes.find(item => item.id === step.id)!;
    const lane = lanes.get(step.laneId)!;
    assert.ok(node.x >= lane.x && node.x + node.width <= lane.x + lane.width);
    assert.ok(node.y >= lane.y && node.y + node.height <= lane.y + lane.height);
    if (step.position) {
      assert.equal(node.x, step.position.x);
      assert.equal(node.y - lane.y, step.position.y);
    }
  }
  for (const edge of layout.edges) for (const point of edge.points) {
    assert.ok(point.x >= 0 && point.x <= layout.width);
    assert.ok(point.y >= 0 && point.y <= layout.height);
  }
  assert.deepEqual(resized.steps, original.steps);
});

test("extra pool height is shared evenly between lanes without changing lane-relative node placement", () => {
  const project = fixture();
  project.steps[2].position = { x: 850, y: 65 };
  const minimum = getPoolMinimumSize(project, "pool-a");
  const compact = resizeDiagramPool(project, "pool-a", minimum);
  const expanded = resizeDiagramPool(compact, "pool-a", { width: minimum.width, height: minimum.height + 400 });
  const before = layoutProject(compact);
  const after = layoutProject(expanded);
  for (const lane of before.lanes.filter(lane => lane.poolId === "pool-a")) {
    assert.equal(after.lanes.find(item => item.id === lane.id)!.height - lane.height, 200);
  }
  const node = after.nodes.find(item => item.id === "end")!;
  const lane = after.lanes.find(item => item.id === "lane-b")!;
  assert.equal(node.y - lane.y, 65);
  assert.deepEqual(expanded.steps[2].position, project.steps[2].position);
});

test("all event and gateway types resize as squares while task and data shapes have usable independent minima", () => {
  for (const type of ["start", "end", "intermediate", "message", "timer", "xor", "or", "and"] as StepType[]) {
    const project = fixture();
    project.steps[1].type = type;
    const larger = resizeDiagramStep(project, "task", { width: 150, height: 90 });
    assert.deepEqual(larger.steps[1].size, { width: 150, height: 150 });
    const smaller = resizeDiagramStep(project, "task", { width: -1, height: 2 });
    assert.deepEqual(smaller.steps[1].size, { width: 40, height: 40 });
  }
  assert.deepEqual(getStepMinimumSize("task"), { width: 100, height: 50 });
  assert.deepEqual(getStepMinimumSize("data"), { width: 80, height: 50 });
  const small = resizeDiagramStep(fixture(), "task", { width: 1, height: 1 });
  assert.deepEqual(small.steps[1].size, { width: 100, height: 50 });
});

test("large task sizes expand automatic columns and lanes and keep connectors on their resized borders", () => {
  const project = fixture();
  const resized = resizeDiagramStep(project, "task", { width: 430, height: 220 });
  const layout = layoutProject(resized);
  const nodes = new Map(layout.nodes.map(node => [node.id, node]));
  const task = nodes.get("task")!;
  const end = nodes.get("end")!;
  assert.deepEqual({ width: task.width, height: task.height }, { width: 430, height: 220 });
  assert.ok(end.x > task.x + task.width);
  for (const edge of layout.edges) {
    const source = nodes.get(edge.sourceId)!;
    const target = nodes.get(edge.targetId)!;
    assert.equal(edge.points[0].x, source.x + source.width);
    assert.equal(edge.points.at(-1)!.x, target.x);
    assert.equal(edge.points[0].y, source.y + source.height / 2);
    assert.equal(edge.points.at(-1)!.y, target.y + target.height / 2);
  }
  assert.equal(resized.steps[1].routes, project.steps[1].routes);
  assert.equal(resized.steps[1].description, project.steps[1].description);
  assert.equal(resized.steps[1].duration, project.steps[1].duration);
  assert.equal(project.steps[1].size, undefined);
});

test("bottom-right shape resizing preserves the opposite corner in one immutable update for automatic and manual placement", () => {
  for (const manual of [false, true]) {
    const project = fixture();
    if (manual) project.steps[1].position = { x: 750, y: 170 };
    const before = layoutProject(project);
    const first = before.nodes.find(item => item.id === "task")!;
    const oldLane = before.lanes.find(item => item.id === "lane-a")!;
    const resized = resizeDiagramStep(project, "task", { width: 330, height: 180 });
    const after = layoutProject(resized);
    const node = after.nodes.find(item => item.id === "task")!;
    const lane = after.lanes.find(item => item.id === "lane-a")!;
    assert.equal(node.x, first.x);
    assert.equal(node.y - lane.y, first.y - oldLane.y);
    assert.deepEqual(resized.steps[1].position, { x: first.x, y: first.y - oldLane.y });
    assert.deepEqual(project.steps[1].position, manual ? { x: 750, y: 170 } : undefined);
  }
});

test("enlarged events and gateways keep branching connectors on center-side borders in layout and native Visio", async () => {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
  for (const type of ["start", "intermediate", "message", "timer", "xor", "or", "and"] as StepType[]) {
    const project = fixture();
    project.steps[1].type = type;
    project.steps[1].size = { width: 180, height: 180 };
    project.steps[1].routes.push({ targetId: "another-end", label: "Digər qol" });
    project.steps[2].size = { width: 150, height: 150 };
    project.steps[0].routes.push({ targetId: "end", label: "Birbaşa" });
    project.steps.push({ id: "another-end", laneId: "lane-b", type: "end", title: "Digər son", description: "", routes: [] });
    const layout = layoutProject(project);
    const nodes = new Map(layout.nodes.map(node => [node.id, node]));
    for (const edge of layout.edges) {
      const source = nodes.get(edge.sourceId)!;
      const target = nodes.get(edge.targetId)!;
      assert.equal(edge.points[0].x, source.x + source.width);
      assert.equal(edge.points[0].y, source.y + source.height / 2);
      assert.equal(edge.points.at(-1)!.x, target.x);
      assert.equal(edge.points.at(-1)!.y, target.y + target.height / 2);
    }
    const zip = await JSZip.loadAsync(await generateVsdx(project));
    const parsed = parser.parse(await zip.file("visio/pages/page1.xml")!.async("string"));
    const connectors = (parsed.PageContents.Shapes.Shape as { "@NameU": string; Cell: { "@N": string; "@V": string }[] }[])
      .filter(shape => shape["@NameU"].startsWith("Connector."));
    for (const [index, shape] of connectors.entries()) {
      const cells = new Map(shape.Cell.map(cell => [cell["@N"], Number(cell["@V"])]));
      const edge = layout.edges[index];
      assert.ok(Math.abs(cells.get("BeginX")! * 96 - edge.points[0].x) < 0.0001);
      assert.ok(Math.abs(layout.height - cells.get("BeginY")! * 96 - edge.points[0].y) < 0.0001);
      assert.ok(Math.abs(cells.get("EndX")! * 96 - edge.points.at(-1)!.x) < 0.0001);
      assert.ok(Math.abs(layout.height - cells.get("EndY")! * 96 - edge.points.at(-1)!.y) < 0.0001);
    }
    assert.equal(parsed.PageContents.Connects.Connect.length, layout.edges.length * 2);
  }
});

test("resize helpers are bounded, immutable and safely ignore missing identities", () => {
  const project = fixture();
  assert.equal(resizeDiagramPool(project, "missing", { width: 800, height: 800 }), project);
  assert.equal(resizeDiagramStep(project, "missing", { width: 800, height: 800 }), project);
  const page = resizeProjectCanvas(project, { width: MAX_DIAGRAM_SIZE + 10, height: MAX_DIAGRAM_SIZE + 10 });
  assert.deepEqual(page.size, { width: MAX_DIAGRAM_SIZE, height: MAX_DIAGRAM_SIZE });
  const pool = resizeDiagramPool(project, "pool-a", { width: MAX_DIAGRAM_SIZE + 10, height: MAX_DIAGRAM_SIZE + 10 });
  assert.deepEqual(pool.pools[0].size, { width: MAX_DIAGRAM_SIZE, height: MAX_DIAGRAM_SIZE });
  const step = resizeDiagramStep(project, "task", { width: 221.234, height: 91.256 });
  assert.deepEqual(step.steps[1].size, { width: 221.2, height: 91.3 });
  assert.equal(step.steps[0], project.steps[0]);
  assert.equal(step.pools, project.pools);
  assert.equal(isProject(page), true);
  assert.equal(isProject(pool), true);
  assert.equal(isProject(step), true);
});

test("resized page, pools and nodes export as native Visio dimensions with unchanged shape data and connectors", async () => {
  let project = resizeDiagramPool(fixture(), "pool-a", { width: 1600, height: 750 });
  project = resizeDiagramPool(project, "pool-b", { width: 500, height: 300 });
  project = resizeDiagramStep(project, "task", { width: 260, height: 140 });
  project = resizeProjectCanvas(project, { width: 1900, height: 1300 });
  const layout = layoutProject(project);
  const zip = await JSZip.loadAsync(await generateVsdx(project));
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: "@" });
  const pages = parser.parse(await zip.file("visio/pages/pages.xml")!.async("string"));
  const cells = (input: { "@N": string; "@V": string }[]) => new Map(input.map(cell => [cell["@N"], Number(cell["@V"])]));
  const pageCells = cells(pages.Pages.Page.PageSheet.Cell);
  assert.ok(Math.abs(pageCells.get("PageWidth")! * 96 - layout.width) < 0.0001);
  assert.ok(Math.abs(pageCells.get("PageHeight")! * 96 - layout.height) < 0.0001);
  const contents = parser.parse(await zip.file("visio/pages/page1.xml")!.async("string"));
  const shapes = contents.PageContents.Shapes.Shape as { "@Name": string; Cell: { "@N": string; "@V": string }[] }[];
  for (const item of [...layout.pools, ...layout.nodes.map(node => ({ ...node, name: project.steps.find(step => step.id === node.id)!.title }))]) {
    const shape = shapes.find(shape => shape["@Name"] === item.name)!;
    const values = cells(shape.Cell);
    assert.ok(Math.abs(values.get("Width")! * 96 - item.width) < 0.0001);
    assert.ok(Math.abs(values.get("Height")! * 96 - item.height) < 0.0001);
  }
  assert.equal(contents.PageContents.Connects.Connect.length, project.steps.reduce((sum, step) => sum + step.routes.length * 2, 0));
  assert.match(await zip.file("visio/pages/page1.xml")!.async("string"), /Label[^>]*V="Müddət \(SLA\)"/);
});
