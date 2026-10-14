import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { explanationRows } from "../lib/docx";
import { layoutProject } from "../lib/layout";
import type { LayoutPoint, Project } from "../lib/types";

const PREFIX = "visioflow:v1:";
const UNDO = "Son dəyişikliyi geri al";

function editorProject(): Project {
  return {
    version: 1, id: "flexible-editor-process", name: "Sənədin emalı",
    pools: [{ id: "office", name: "Təşkilat", lanes: [
      { id: "operator", name: "Operator" }, { id: "reviewer", name: "Vizaçı" },
    ] }],
    steps: [
      { id: "start", laneId: "operator", type: "start", title: "Başla", description: "", position: { x: 210, y: 56 }, routes: [{ targetId: "source", label: "" }] },
      { id: "source", laneId: "operator", type: "task", title: "Məlumatları yoxla", description: "Operator məlumatları yoxlayır.", position: { x: 330, y: 42 }, routes: [
        { targetId: "target", label: "Yoxlandı", description: "Məlumatlar düzgündürsə, cavab hazırlansın." },
      ] },
      { id: "target", laneId: "operator", type: "task", title: "Cavabı hazırla", description: "Cavab sənədi hazırlanır.", position: { x: 850, y: 42 }, routes: [{ targetId: "end", label: "" }] },
      { id: "end", laneId: "operator", type: "end", title: "Tamamlandı", description: "", position: { x: 1090, y: 56 }, routes: [] },
      { id: "detached", laneId: "reviewer", type: "userTask", title: "Əlavə yoxlama", description: "Sənədin rekvizitlərini yoxla.", position: { x: 620, y: 42 }, duration: "1 iş günü", system: "Sənəd sistemi", document: "Müraciət", routes: [] },
    ],
  };
}

async function seed(page: Page, project = editorProject()) {
  await page.addInitScript(({ saved, prefix }) => {
    const key = prefix + saved.id;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
  }, { saved: project, prefix: PREFIX });
  await page.goto(`/#${project.id}`);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(project.steps.length);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return project;
}

async function saved(page: Page): Promise<Project> {
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + location.hash.slice(1))!), PREFIX);
}

function node(page: Page, id: string) {
  return page.locator(`#process-diagram [data-step-id="${id}"]`);
}

async function screenPoint(page: Page, point: LayoutPoint) {
  return page.locator("#process-diagram").evaluate((svg, point) => {
    const matrix = (svg as SVGSVGElement).getScreenCTM()!;
    const transformed = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: transformed.x, y: transformed.y, scale: matrix.a };
  }, point);
}

async function nodeCenter(page: Page, id: string) {
  const geometry = layoutProject(await saved(page)).nodes.find(item => item.id === id)!;
  return screenPoint(page, { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 });
}

async function edgeDropPoint(page: Page) {
  const edge = layoutProject(await saved(page)).edges.find(item => item.sourceId === "source" && item.routeIndex === 0)!;
  const segments = edge.points.slice(1).map((point, index) => {
    const previous = edge.points[index];
    return { x: (point.x + previous.x) / 2, y: (point.y + previous.y) / 2, length: Math.hypot(point.x - previous.x, point.y - previous.y) };
  }).sort((a, b) => b.length - a.length);
  return screenPoint(page, segments[0]);
}

async function dragFromTo(page: Page, start: LayoutPoint, target: LayoutPoint) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
}

async function downloadZip(page: Page, name: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  return JSZip.loadAsync(await readFile((await download.path())!), { checkCRC32: true });
}

type XmlShape = { "@_ID": string; "@_Name": string; Cell: { "@_N": string; "@_V": string }[]; Section?: { "@_N": string; Row?: { "@_N": string; Cell: { "@_N": string; "@_V": string }[] }[] }[]; Text?: unknown };
type XmlConnect = { "@_FromSheet": string; "@_FromCell": string; "@_ToSheet": string };

async function nativeDrawing(page: Page) {
  const zip = await downloadZip(page, "Visio üçün yüklə");
  const xml = await zip.file("visio/pages/page1.xml")!.async("string");
  expect(XMLValidator.validate(xml)).toBe(true);
  const parser = new XMLParser({ ignoreAttributes: false, parseTagValue: false, isArray: name => ["Shape", "Cell", "Section", "Row", "Connect"].includes(name) });
  const document = parser.parse(xml).PageContents;
  const shapes = document.Shapes.Shape as XmlShape[];
  const shapeForStep = (id: string) => shapes.find(shape => shape.Section?.some(section => section["@_N"] === "Property" && section.Row?.some(row => row["@_N"] === "ProjectStepId" && row.Cell.some(cell => cell["@_N"] === "Value" && cell["@_V"] === id))))!;
  const cellValue = (shape: XmlShape, name: string) => Number(shape.Cell.find(cell => cell["@_N"] === name)!["@_V"]);
  const pages = parser.parse(await zip.file("visio/pages/pages.xml")!.async("string"));
  return { xml, shapes, shapeForStep, cellValue, connects: document.Connects.Connect as XmlConnect[], pages };
}

function xmlText(markup: string): string {
  const value = new XMLParser({ ignoreAttributes: true, parseTagValue: false }).parse(`<value>${markup}</value>`).value;
  return typeof value === "string" ? value : value?.["#text"] ?? "";
}

async function expectExports(page: Page, project: Project) {
  const zip = await downloadZip(page, "Word izahını yüklə");
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(XMLValidator.validate(xml)).toBe(true);
  const rows = [...xml.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].slice(1);
  const expected = explanationRows(project);
  expect(rows).toHaveLength(expected.length);
  for (const [index, row] of rows.entries()) {
    const number = row[0].match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/)![1];
    expect(xmlText(number)).toBe(expected[index].number);
  }
  expect(xml).toContain("Məlumatlar düzgündürsə, cavab hazırlansın.");
  const drawing = await nativeDrawing(page);
  for (const [index, step] of project.steps.entries()) {
    expect(drawing.xml).toContain(`${index + 1}. ${step.title}`);
    const sourceId = drawing.shapeForStep(step.id)["@_ID"];
    for (const route of step.routes) {
      const targetId = drawing.shapeForStep(route.targetId)["@_ID"];
      const matching = drawing.connects.filter(connect => connect["@_FromCell"] === "BeginX" && connect["@_ToSheet"] === sourceId);
      expect(matching.some(begin => drawing.connects.some(end => end["@_FromSheet"] === begin["@_FromSheet"] && end["@_FromCell"] === "EndX" && end["@_ToSheet"] === targetId))).toBe(true);
    }
  }
}

test("dropping an existing task on a route splices it in, preserves facts and keeps exported explanations in sync", async ({ page }) => {
  const before = await seed(page);
  const center = await nodeCenter(page, "detached");
  const destination = await edgeDropPoint(page);
  await dragFromTo(page, center, destination);
  await expect(page.locator('[data-editor-only="insertion-target"][data-insertion-source="source"][data-insertion-route-index="0"]')).toBeAttached();
  await page.mouse.up();
  const after = await saved(page);
  expect(after.steps.map(step => step.id)).toEqual(["start", "source", "detached", "target", "end"]);
  expect(after.steps.find(step => step.id === "source")!.routes).toEqual([{ ...before.steps[1].routes[0], targetId: "detached" }]);
  expect(after.steps.find(step => step.id === "detached")).toMatchObject({ laneId: "operator", title: "Əlavə yoxlama", description: before.steps[4].description, duration: "1 iş günü", system: "Sənəd sistemi", document: "Müraciət", routes: [{ targetId: "target", label: "" }] });
  expect(after.steps.find(step => step.id === "target")!.routes).toEqual(before.steps[2].routes);
  await expectExports(page, after);
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /İzah/ }).click();
  const insertedRow = page.locator(".explanation-text tbody tr").filter({ has: page.locator("td:first-child", { hasText: /^3$/ }) });
  await expect(insertedRow).toContainText("Əlavə yoxlama");
  await expect(insertedRow.locator("td").nth(1)).toHaveText("Operator");
  await expect(page.locator(".explanation-text")).toContainText(before.steps[1].routes[0].description!);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await page.getByRole("button", { name: "Geri alınmış dəyişikliyi yenidən tətbiq et", exact: true }).click();
  expect(await saved(page)).toEqual(after);
  await page.reload();
  expect(await saved(page)).toEqual(after);
});

test("a palette task can be dragged directly onto a route and the whole insertion is one undo action", async ({ page }) => {
  const before = await seed(page);
  const button = page.getByRole("button", { name: "Diaqramda tapşırıq əlavə et", exact: true });
  const rectangle = (await button.boundingBox())!;
  const destination = await edgeDropPoint(page);
  await dragFromTo(page, { x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 }, destination);
  await expect(page.locator('[data-editor-only="insertion-target"][data-insertion-source="source"]')).toBeAttached();
  await page.mouse.up();
  const after = await saved(page);
  const inserted = after.steps.find(step => !before.steps.some(old => old.id === step.id))!;
  expect(after.steps).toHaveLength(before.steps.length + 1);
  expect(after.steps.map(step => step.id)).toEqual(["start", "source", inserted.id, "target", "end", "detached"]);
  expect(inserted).toMatchObject({ type: "task", laneId: "operator", routes: [{ targetId: "target", label: "" }] });
  expect(after.steps.find(step => step.id === "source")!.routes).toEqual([{ ...before.steps[1].routes[0], targetId: inserted.id }]);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await saved(page)).toEqual(before);
});

test("the selected route offers an explicit insert button without requiring a drag", async ({ page }) => {
  const before = await seed(page);
  const chip = page.locator('#process-diagram .diagram-edge[data-route-source="source"][data-route-index="0"] .diagram-route-chip');
  await chip.click();
  const insert = page.getByRole("button", { name: "Keçidin arasına tapşırıq əlavə et", exact: true });
  await expect(insert).toBeVisible();
  await chip.click();
  expect(await saved(page)).toEqual(before);
  await expect(insert).toBeVisible();
  await insert.click();
  const after = await saved(page);
  const inserted = after.steps.find(step => !before.steps.some(old => old.id === step.id))!;
  expect(inserted.routes).toEqual([{ targetId: "target", label: "" }]);
  expect(after.steps.find(step => step.id === "source")!.routes[0]).toEqual({ ...before.steps[1].routes[0], targetId: inserted.id });
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await saved(page)).toEqual(before);
});

test("Escape cancels a palette drag even when the pointer is released on its original button", async ({ page }) => {
  const before = await seed(page);
  const button = page.getByRole("button", { name: "Diaqramda tapşırıq əlavə et", exact: true });
  const rectangle = (await button.boundingBox())!;
  const center = { x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 };
  await dragFromTo(page, center, await edgeDropPoint(page));
  await expect(page.locator('[data-editor-only="insertion-target"]')).toBeAttached();
  await page.keyboard.press("Escape");
  await page.mouse.move(center.x, center.y);
  await page.mouse.up();
  await expect(page.locator('[data-editor-only="insertion-target"]')).toHaveCount(0);
  expect(await saved(page)).toEqual(before);
  await expect(page.getByRole("button", { name: UNDO, exact: true })).toBeDisabled();
  await button.click();
  expect((await saved(page)).steps).toHaveLength(before.steps.length + 1);
});

async function resizeHandle(page: Page, handle: Locator, dx: number, dy: number, cancel = false) {
  await handle.scrollIntoViewIfNeeded();
  const rectangle = (await handle.boundingBox())!;
  const point = { x: rectangle.x + rectangle.width / 2, y: rectangle.y + rectangle.height / 2 };
  const scale = await page.locator("#process-diagram").evaluate(svg => (svg as SVGSVGElement).getScreenCTM()!.a);
  await dragFromTo(page, point, { x: point.x + dx, y: point.y + dy });
  if (cancel) await page.keyboard.press("Escape");
  await page.mouse.up();
  return scale;
}

test("resizing a selected task changes native geometry, survives reload and can be undone", async ({ page }) => {
  const before = await seed(page);
  await node(page, "source").click();
  const handle = page.locator('[data-resize-handle="step"][data-resize-id="source"]');
  await expect(handle).toBeVisible();
  const previousNode = layoutProject(before).nodes.find(item => item.id === "source")!;
  const scale = await resizeHandle(page, handle, 35, 20);
  const after = await saved(page);
  const resized = after.steps.find(step => step.id === "source")!;
  expect(resized.size!.width).toBeCloseTo(previousNode.width + 35 / scale, 0);
  expect(resized.size!.height).toBeCloseTo(previousNode.height + 20 / scale, 0);
  expect(resized.routes).toEqual(before.steps[1].routes);
  const drawing = await nativeDrawing(page);
  expect(drawing.cellValue(drawing.shapeForStep("source"), "Width")).toBeCloseTo(resized.size!.width / 96, 5);
  expect(drawing.cellValue(drawing.shapeForStep("source"), "Height")).toBeCloseTo(resized.size!.height / 96, 5);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await node(page, "source").click();
  await resizeHandle(page, handle, 35, 20);
  const persisted = await saved(page);
  await page.reload();
  expect(await saved(page)).toEqual(persisted);
});

test("resizing a pool preserves its tasks and connections and exports its actual dimensions", async ({ page }) => {
  const before = await seed(page);
  const previous = layoutProject(before).pools[0];
  const handle = page.locator('[data-resize-handle="pool"][data-resize-id="office"]');
  const scale = await resizeHandle(page, handle, 55, 30);
  const after = await saved(page);
  expect(after.pools[0].size!.width).toBeCloseTo(previous.width + 55 / scale, 0);
  expect(after.pools[0].size!.height).toBeCloseTo(previous.height + 30 / scale, 0);
  expect(after.steps).toEqual(before.steps);
  const expected = layoutProject(after).pools[0];
  const drawing = await nativeDrawing(page);
  const poolShape = drawing.shapes.find(shape => shape["@_Name"] === "Təşkilat")!;
  expect(drawing.cellValue(poolShape, "Width")).toBeCloseTo(expected.width / 96, 5);
  expect(drawing.cellValue(poolShape, "Height")).toBeCloseTo(expected.height / 96, 5);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await resizeHandle(page, handle, 55, 30);
  const persisted = await saved(page);
  await page.reload();
  expect(await saved(page)).toEqual(persisted);
});

test("resizing the overall diagram saves a real page size and never changes flow data", async ({ page }) => {
  const before = await seed(page);
  const previous = layoutProject(before);
  const handle = page.locator('[data-resize-handle="canvas"]');
  const scale = await resizeHandle(page, handle, 60, 35);
  const after = await saved(page);
  expect(after.size!.width).toBeCloseTo(previous.width + 60 / scale, 0);
  expect(after.size!.height).toBeCloseTo(previous.height + 35 / scale, 0);
  expect(after.steps).toEqual(before.steps);
  expect(after.pools).toEqual(before.pools);
  const expected = layoutProject(after);
  const drawing = await nativeDrawing(page);
  const pageSheet = drawing.pages.Pages.Page.PageSheet;
  expect(Number(pageSheet.Cell.find((cell: { "@_N": string }) => cell["@_N"] === "PageWidth")["@_V"])).toBeCloseTo(expected.width / 96, 5);
  expect(Number(pageSheet.Cell.find((cell: { "@_N": string }) => cell["@_N"] === "PageHeight")["@_V"])).toBeCloseTo(expected.height / 96, 5);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await resizeHandle(page, handle, 60, 35);
  const persisted = await saved(page);
  await page.reload();
  expect(await saved(page)).toEqual(persisted);
});

test("Escape cancels an unfinished size change without creating an undo entry", async ({ page }) => {
  const before = await seed(page);
  await node(page, "source").click();
  await resizeHandle(page, page.locator('[data-resize-handle="step"][data-resize-id="source"]'), 50, 35, true);
  expect(await saved(page)).toEqual(before);
  await expect(page.getByRole("button", { name: UNDO, exact: true })).toBeDisabled();
});

test("keyboard resizing uses diagram units and leaves the selected task's position and routes untouched", async ({ page }) => {
  const before = await seed(page);
  const previous = layoutProject(before).nodes.find(item => item.id === "source")!;
  await node(page, "source").click();
  const handle = page.locator('[data-resize-handle="step"][data-resize-id="source"]');
  await handle.focus();
  await handle.press("ArrowRight");
  await handle.press("ArrowDown");
  await handle.press("Shift+ArrowRight");
  const after = await saved(page);
  expect(after.steps.find(step => step.id === "source")).toMatchObject({
    position: before.steps[1].position,
    routes: before.steps[1].routes,
    size: { width: previous.width + 60, height: previous.height + 10 },
  });
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect((await saved(page)).steps.find(step => step.id === "source")!.size).toEqual({ width: previous.width + 10, height: previous.height + 10 });
});

test("numeric dimensions commit on Enter or blur, ignore invalid drafts and can reset to automatic sizing", async ({ page }) => {
  const before = await seed(page);
  const initial = layoutProject(before);
  await node(page, "source").click();
  await page.getByRole("button", { name: "Diaqram ölçüləri", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Diaqram ölçüləri", exact: true });
  const pageWidth = dialog.getByLabel("Diaqram eni", { exact: true });
  await pageWidth.focus();
  await pageWidth.press("Tab");
  expect(await saved(page)).toEqual(before);
  await pageWidth.fill("");
  await pageWidth.press("Tab");
  expect(await saved(page)).toEqual(before);
  await pageWidth.fill("1e309");
  await pageWidth.press("Enter");
  expect(await saved(page)).toEqual(before);
  await pageWidth.fill(String(initial.width + 120));
  await pageWidth.press("Enter");
  expect((await saved(page)).size).toEqual({ width: initial.width + 120, height: initial.height });
  await dialog.getByRole("button", { name: "Bağla", exact: true }).click();
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await saved(page)).toEqual(before);
  await node(page, "source").click();
  await page.getByRole("button", { name: "Diaqram ölçüləri", exact: true }).click();
  await dialog.getByLabel("Pool 1 eni", { exact: true }).fill(String(initial.pools[0].width + 180));
  await dialog.getByLabel("Pool 1 eni", { exact: true }).press("Tab");
  await dialog.getByLabel("Pool 1 hündürlüyü", { exact: true }).fill(String(initial.pools[0].height + 120));
  await dialog.getByLabel("Pool 1 hündürlüyü", { exact: true }).press("Enter");
  await dialog.getByLabel("Fiqur eni", { exact: true }).fill("240");
  await dialog.getByLabel("Fiqur eni", { exact: true }).press("Enter");
  await dialog.getByLabel("Fiqur hündürlüyü", { exact: true }).fill("105");
  await dialog.getByLabel("Fiqur hündürlüyü", { exact: true }).press("Enter");
  await dialog.getByLabel("Diaqram hündürlüyü", { exact: true }).fill(String(initial.height + 240));
  await dialog.getByLabel("Diaqram hündürlüyü", { exact: true }).press("Enter");
  const resized = await saved(page);
  expect(resized.pools[0].size).toEqual({ width: initial.pools[0].width + 180, height: initial.pools[0].height + 120 });
  expect(resized.steps.find(step => step.id === "source")).toMatchObject({ position: before.steps[1].position, routes: before.steps[1].routes, size: { width: 240, height: 105 } });
  expect(resized.size!.height).toBe(initial.height + 240);
  await dialog.getByRole("button", { name: "Bağla", exact: true }).click();
  await page.reload();
  expect(await saved(page)).toEqual(resized);
  await node(page, "source").click();
  await page.getByRole("button", { name: "Diaqram ölçüləri", exact: true }).click();
  await dialog.getByRole("group", { name: "Seçilmiş fiqur — Məlumatları yoxla", exact: true }).getByRole("button", { name: "Avtomatik ölçü", exact: true }).click();
  await dialog.getByRole("group", { name: "Pool 1 — Təşkilat", exact: true }).getByRole("button", { name: "Avtomatik ölçü", exact: true }).click();
  await dialog.getByRole("group", { name: "Ümumi diaqram", exact: true }).getByRole("button", { name: "Avtomatik ölçü", exact: true }).click();
  expect(await saved(page)).toEqual(before);
});

test("the form divider supports dragging, keyboard adjustment and reset while staying hidden on mobile", async ({ page }) => {
  const before = await seed(page);
  const panel = page.locator(".form-panel");
  const divider = page.getByRole("separator", { name: "Forma panelinin enini dəyiş", exact: true });
  await expect(divider).toBeVisible();
  expect((await panel.boundingBox())!.width).toBeCloseTo(400, 0);
  const rectangle = (await divider.boundingBox())!;
  await dragFromTo(page, { x: rectangle.x + rectangle.width / 2, y: rectangle.y + 60 }, { x: rectangle.x + rectangle.width / 2 + 100, y: rectangle.y + 60 });
  await page.mouse.up();
  expect((await panel.boundingBox())!.width).toBeCloseTo(500, 0);
  await divider.focus();
  await divider.press("ArrowLeft");
  expect((await panel.boundingBox())!.width).toBeCloseTo(480, 0);
  await divider.press("Shift+ArrowRight");
  expect((await panel.boundingBox())!.width).toBeCloseTo(520, 0);
  for (let count = 0; count < 8; count++) await divider.press("Shift+ArrowRight");
  expect((await panel.boundingBox())!.width).toBeCloseTo(640, 0);
  for (let count = 0; count < 12; count++) await divider.press("Shift+ArrowLeft");
  expect((await panel.boundingBox())!.width).toBeCloseTo(280, 0);
  await divider.dblclick();
  expect((await panel.boundingBox())!.width).toBeCloseTo(400, 0);
  expect(await saved(page)).toEqual(before);
  await divider.press("ArrowRight");
  await expect(divider).toHaveAttribute("aria-valuenow", "420");
  await page.reload();
  expect((await panel.boundingBox())!.width).toBeCloseTo(420, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(divider).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});

test("participant and step composers use explicit names, types and actors without peripheral hint text", async ({ page }) => {
  await seed(page);
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /İştirakçılar/ }).click();
  await page.getByLabel("Pool 1 yeni iştirakçı", { exact: true }).fill("Arxivçi");
  await page.getByLabel("Pool 1 yeni iştirakçı", { exact: true }).press("Enter");
  const withActor = await saved(page);
  const actor = withActor.pools[0].lanes.at(-1)!;
  expect(actor.name).toBe("Arxivçi");
  await expect(page.getByLabel("Pool 1 yeni iştirakçı", { exact: true })).toHaveValue("");
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /Addımlar/ }).click();
  await page.getByLabel("Yeni addımın adı", { exact: true }).fill("Sənədi arxivlə");
  await page.getByLabel("Yeni addımın növü", { exact: true }).selectOption("serviceTask");
  await page.getByLabel("Yeni addımın icraçısı", { exact: true }).selectOption(actor.id);
  await page.getByRole("button", { name: "Addım əlavə et", exact: true }).click();
  const after = await saved(page);
  expect(after.steps.at(-1)).toMatchObject({ title: "Sənədi arxivlə", type: "serviceTask", laneId: actor.id });
  await expect(page.getByLabel("Yeni addımın adı", { exact: true })).toHaveValue("");
  await expect(page.locator(".preview-heading, .canvas-stats, .diagram-editor-hint")).toHaveCount(0);
  await expect(page.getByText("Prosesi adlandır, iştirakçıları əlavə et. Axının sağda yaransın.", { exact: true })).toHaveCount(0);
  await expect(page.locator("input[type=file]")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /JSON|Paylaş|Layihələrim/i })).toHaveCount(0);
});
