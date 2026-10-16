import { readFile } from "node:fs/promises";
import { expect, test, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { layoutProject } from "../lib/layout";
import type { LayoutPoint, Project } from "../lib/types";

const STORAGE_PREFIX = "visioflow:v1:";
const TASK_ID = "review-task";
const SECOND_TASK_ID = "second-task";
const UNDO = "Son dəyişikliyi geri al";
const REDO = "Geri alınmış dəyişikliyi yenidən tətbiq et";

function editorProject(): Project {
  return {
    version: 1, id: "canvas-operations-project", name: "Sənədin emalı",
    pools: [{ id: "office", name: "Təşkilat", lanes: [
      { id: "operator", name: "Operator" }, { id: "reviewer", name: "Vizaçı" },
    ] }],
    steps: [
      { id: "start", laneId: "operator", type: "start", title: "Başla", description: "Sənəd daxil olur.", position: { x: 210, y: 56 }, routes: [{ targetId: TASK_ID, label: "" }] },
      { id: TASK_ID, laneId: "operator", type: "userTask", title: "Müraciəti yoxla", description: "Sənədin məlumatlarını yoxla və uyğun yolu seç.", position: { x: 340, y: 42 }, routes: [
        { targetId: "approved", label: "Təsdiq", description: "Məlumatlar düzgündür və sənəd təsdiqlənir." },
        { targetId: SECOND_TASK_ID, label: "Yoxlamaya göndər", description: "Əlavə viza tələb olunduqda vizaçıya göndərilir." },
      ] },
      { id: SECOND_TASK_ID, laneId: "reviewer", type: "task", title: "Vizanı yoxla", description: "Vizaçı sənədi yoxlayır.", position: { x: 585, y: 42 }, routes: [
        { targetId: "completed", label: "Təsdiqlə", description: "Viza tamamlandıqda icra bağlanır." },
      ] },
      { id: "alternative-task", laneId: "reviewer", type: "task", title: "Əlavə sənədi yoxla", description: "Əlavə sənəd tələb edilir.", position: { x: 350, y: 150 }, routes: [] },
      { id: "approved", laneId: "operator", type: "end", title: "Təsdiqləndi", description: "Təsdiq qolu bitir.", position: { x: 850, y: 56 }, routes: [] },
      { id: "completed", laneId: "reviewer", type: "end", title: "İcra tamamlandı", description: "İcra qolu bitir.", position: { x: 850, y: 56 }, routes: [] },
    ],
  };
}

async function seedProject(page: Page) {
  const project = editorProject();
  await page.addInitScript(({ prefix, saved }) => {
    const key = prefix + saved.id;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
  }, { prefix: STORAGE_PREFIX, saved: project });
  await page.goto(`/#${project.id}`);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(project.steps.length);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return project;
}

async function savedProject(page: Page): Promise<Project> {
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + location.hash.slice(1))!), STORAGE_PREFIX);
}

function node(page: Page, id = TASK_ID): Locator {
  return page.locator(`#process-diagram [data-step-id="${id}"]`);
}

function edge(page: Page, sourceId = TASK_ID, routeIndex = 0) {
  return page.locator(`#process-diagram .diagram-edge[data-route-source="${sourceId}"][data-route-index="${routeIndex}"]`);
}

function routeHandle(page: Page, endpoint: "source" | "target", sourceId = TASK_ID, routeIndex = 0) {
  return page.locator(`#process-diagram [data-route-handle="${endpoint}"][data-route-source="${sourceId}"][data-route-index="${routeIndex}"]`);
}

async function screenPoint(page: Page, point: LayoutPoint) {
  return page.locator("#process-diagram").evaluate((element, position) => {
    const matrix = (element as SVGSVGElement).getScreenCTM()!;
    const screen = new DOMPoint(position.x, position.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y, scale: matrix.a };
  }, point);
}

async function nodeCenter(page: Page, id = TASK_ID) {
  const geometry = layoutProject(await savedProject(page)).nodes.find(item => item.id === id)!;
  return screenPoint(page, { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 });
}

async function startDrag(page: Page, id: string, target: LayoutPoint) {
  const center = await nodeCenter(page, id);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
}

async function endpointDrag(page: Page, endpoint: "source" | "target", targetId: string, sourceId = TASK_ID, routeIndex = 0) {
  await edge(page, sourceId, routeIndex).locator(".diagram-route-chip").click();
  const handle = routeHandle(page, endpoint, sourceId, routeIndex);
  await expect(handle).toBeVisible();
  const rectangle = (await handle.boundingBox())!;
  const target = await nodeCenter(page, targetId);
  await page.mouse.move(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  await page.mouse.up();
}

async function endpointClick(page: Page, endpoint: "source" | "target", targetId: string, sourceId = TASK_ID, routeIndex = 0) {
  await edge(page, sourceId, routeIndex).locator(".diagram-route-chip").click();
  await routeHandle(page, endpoint, sourceId, routeIndex).click();
  await node(page, targetId).click();
}

async function downloadZip(page: Page, name: string) {
  const pending = page.waitForEvent("download");
  await page.getByRole("button", { name, exact: true }).click();
  const download = await pending;
  expect(await download.failure()).toBeNull();
  return JSZip.loadAsync(await readFile((await download.path())!), { checkCRC32: true });
}

function xmlText(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(xmlText);
  if (!value || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, child]) => {
    if (key !== "w:t") return key.startsWith("@_") ? [] : xmlText(child);
    const values = Array.isArray(child) ? child : [child];
    return values.map(item => String(item && typeof item === "object" ? (item as Record<string, unknown>)["#text"] ?? "" : item));
  });
}

async function wordRows(page: Page) {
  const zip = await downloadZip(page, "Word izahını yüklə");
  const xml = await zip.file("word/document.xml")!.async("string");
  expect(XMLValidator.validate(xml)).toBe(true);
  const parsed = new XMLParser({ ignoreAttributes: false, parseTagValue: false, isArray: name => ["w:tr", "w:tc"].includes(name) }).parse(xml);
  return parsed["w:document"]["w:body"]["w:tbl"]["w:tr"].map((row: Record<string, unknown[]>) => row["w:tc"].map(cell => xmlText(cell).join(" "))) as string[][];
}

async function visioPage(page: Page) {
  const zip = await downloadZip(page, "Visio üçün yüklə");
  const xml = await zip.file("visio/pages/page1.xml")!.async("string");
  expect(XMLValidator.validate(xml)).toBe(true);
  return new XMLParser({ ignoreAttributes: false, parseAttributeValue: false, isArray: name => ["Shape", "Cell", "Connect"].includes(name) }).parse(xml).PageContents;
}

async function showExplanation(page: Page) {
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /İzah/ }).click();
}

function explanationRow(page: Page, number: string) {
  return page.locator(".explanation-text tbody tr").filter({ has: page.locator("td").first().filter({ hasText: new RegExp(`^${number.replace(".", "\\.")}$`) }) });
}

test("a task can move to another participant at changed zoom and actor changes reach the explanation, Word and Visio", async ({ page }) => {
  const original = await seedProject(page);
  await page.getByRole("button", { name: "Diaqramı böyüt", exact: true }).click();
  const initial = layoutProject(original);
  const sourceNode = initial.nodes.find(item => item.id === TASK_ID)!;
  const destinationLane = initial.lanes.find(item => item.id === "reviewer")!;
  const target = await screenPoint(page, { x: sourceNode.x + sourceNode.width / 2 + 24, y: destinationLane.y + 38 + sourceNode.height / 2 });
  await startDrag(page, TASK_ID, target);
  await expect(node(page)).toHaveClass(/is-dragging/);
  await page.mouse.up();
  await expect.poll(async () => (await savedProject(page)).steps[1].laneId).toBe("reviewer");
  const moved = await savedProject(page);
  expect(moved.steps[1]).toMatchObject({ laneId: "reviewer", position: { x: sourceNode.x + 24, y: 38 } });
  expect(moved.steps[1].routes).toEqual(original.steps[1].routes);
  expect(moved.steps[1].description).toBe(original.steps[1].description);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await savedProject(page)).toEqual(original);
  await page.getByRole("button", { name: REDO, exact: true }).click();
  expect(await savedProject(page)).toEqual(moved);
  await showExplanation(page);
  for (const number of ["2", "2.1", "2.2"]) await expect(explanationRow(page, number).locator("td").nth(1)).toHaveText("Vizaçı");
  const rows = await wordRows(page);
  for (const number of ["2", "2.1", "2.2"]) expect(rows.find(row => row[0] === number)![1]).toBe("Vizaçı");
  const exported = await visioPage(page);
  const shape = exported.Shapes.Shape.find((item: Record<string, unknown>) => item["@_Name"] === original.steps[1].title);
  const layout = layoutProject(moved);
  const geometry = layout.nodes.find(item => item.id === TASK_ID)!;
  const value = (name: string) => Number(shape.Cell.find((item: Record<string, string>) => item["@_N"] === name)["@_V"]);
  expect(value("PinX")).toBeCloseTo((geometry.x + geometry.width / 2) / 96, 5);
  expect(value("PinY")).toBeCloseTo((layout.height - geometry.y - geometry.height / 2) / 96, 5);
  expect(geometry.y).toBeGreaterThanOrEqual(layout.lanes.find(item => item.id === "reviewer")!.y);
  const url = page.url();
  await page.reload();
  await expect(node(page)).toBeVisible();
  expect(page.url()).toBe(url);
  expect(await savedProject(page)).toEqual(moved);
});

test("Escape and a drop outside the canvas cancel a cross-lane move without recording undo", async ({ page }) => {
  const original = await seedProject(page);
  const layout = layoutProject(original);
  const lane = layout.lanes.find(item => item.id === "reviewer")!;
  const target = await screenPoint(page, { x: 430, y: lane.y + 80 });
  await startDrag(page, TASK_ID, target);
  await expect(node(page)).toHaveClass(/is-dragging/);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await savedProject(page)).toEqual(original);
  const outside = await screenPoint(page, { x: 430, y: layout.pools[0].y - 8 });
  await startDrag(page, TASK_ID, outside);
  await page.mouse.up();
  expect(await savedProject(page)).toEqual(original);
  await expect(page.getByRole("button", { name: UNDO, exact: true })).toBeDisabled();
});

test("dragging an arrow target reconnects the same condition and synchronizes live explanation, Word and native glue", async ({ page }) => {
  const original = await seedProject(page);
  await endpointDrag(page, "target", "completed");
  const saved = await savedProject(page);
  expect(saved.steps[1].routes[0]).toEqual({ ...original.steps[1].routes[0], targetId: "completed" });
  await expect(page.getByLabel("Keçidin hədəfi", { exact: true })).toHaveValue("completed");
  await expect(page.getByLabel("Keçidin izahı", { exact: true })).toHaveValue(original.steps[1].routes[0].description!);
  await showExplanation(page);
  await expect(explanationRow(page, "2.1")).toContainText("İcra tamamlandı (addım 6)");
  await expect(explanationRow(page, "2.1")).not.toContainText("Təsdiqləndi (addım 5)");
  const rows = await wordRows(page);
  expect(rows.find(row => row[0] === "2.1")![2]).toContain("İcra tamamlandı (addım 6)");
  expect(rows.find(row => row[0] === "2.1")![2]).toContain(original.steps[1].routes[0].description!);
  const exported = await visioPage(page);
  const connector = exported.Shapes.Shape.find((shape: Record<string, string>) => shape["@_Name"] === "2.1 · Təsdiq");
  const target = exported.Shapes.Shape.find((shape: Record<string, string>) => shape["@_Name"] === "İcra tamamlandı");
  const source = exported.Shapes.Shape.find((shape: Record<string, string>) => shape["@_Name"] === "Müraciəti yoxla");
  expect(exported.Connects.Connect).toContainEqual(expect.objectContaining({ "@_FromSheet": connector["@_ID"], "@_FromCell": "EndX", "@_ToSheet": target["@_ID"] }));
  expect(exported.Connects.Connect).toContainEqual(expect.objectContaining({ "@_FromSheet": connector["@_ID"], "@_FromCell": "BeginX", "@_ToSheet": source["@_ID"] }));
  await page.reload();
  expect(await savedProject(page)).toEqual(saved);
});

test("an arrow source can move by its handle and source selector while branch numbers and actor update everywhere", async ({ page }) => {
  const original = await seedProject(page);
  await endpointClick(page, "source", SECOND_TASK_ID);
  const moved = await savedProject(page);
  expect(moved.steps[1].routes).toEqual([original.steps[1].routes[1]]);
  expect(moved.steps[2].routes).toEqual([...original.steps[2].routes, original.steps[1].routes[0]]);
  await expect(page.getByLabel("Keçidin başlanğıcı", { exact: true })).toHaveValue(SECOND_TASK_ID);
  await expect(page.getByLabel("Etiketin mətni", { exact: true })).toHaveValue("Təsdiq");
  await expect(edge(page, SECOND_TASK_ID, 1).locator(".diagram-route-chip")).toContainText("3.2");
  await expect(edge(page, TASK_ID, 0).locator(".diagram-route-chip")).not.toContainText("2.2");
  await showExplanation(page);
  await expect(explanationRow(page, "3.2").locator("td").nth(1)).toHaveText("Vizaçı");
  await expect(explanationRow(page, "3.2")).toContainText(original.steps[1].routes[0].description!);
  await expect(explanationRow(page, "2.1")).toHaveCount(0);
  const rows = await wordRows(page);
  expect(rows.find(row => row[0] === "3.2")![1]).toBe("Vizaçı");
  expect(rows.find(row => row[0] === "3.2")![2]).toContain("Təsdiqləndi (addım 5)");
  const exported = await visioPage(page);
  const connector = exported.Shapes.Shape.find((shape: Record<string, string>) => shape["@_Name"] === "3.2 · Təsdiq");
  const source = exported.Shapes.Shape.find((shape: Record<string, string>) => shape["@_Name"] === "Vizanı yoxla");
  expect(exported.Connects.Connect).toContainEqual(expect.objectContaining({ "@_FromSheet": connector["@_ID"], "@_FromCell": "BeginX", "@_ToSheet": source["@_ID"] }));
  await page.getByLabel("Keçidin başlanğıcı", { exact: true }).selectOption("alternative-task");
  const selected = await savedProject(page);
  expect(selected.steps[2].routes).toEqual(original.steps[2].routes);
  expect(selected.steps[3].routes).toEqual([original.steps[1].routes[0]]);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await savedProject(page)).toEqual(moved);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await savedProject(page)).toEqual(original);
  await page.getByRole("button", { name: REDO, exact: true }).click();
  expect(await savedProject(page)).toEqual(moved);
});

test("illegal reconnects, Escape and dropping in blank space retain the old arrow and do not create undo history", async ({ page }) => {
  const original = await seedProject(page);
  for (const [endpoint, target] of [
    ["target", SECOND_TASK_ID], ["target", TASK_ID], ["source", "completed"], ["source", "approved"],
  ] as const) {
    await endpointClick(page, endpoint, target);
    expect(await savedProject(page)).toEqual(original);
  }
  await edge(page).locator(".diagram-route-chip").click();
  const rectangle = (await routeHandle(page, "target").boundingBox())!;
  const blank = await screenPoint(page, { x: 760, y: 20 });
  await page.mouse.move(rectangle.x + rectangle.width / 2, rectangle.y + rectangle.height / 2);
  await page.mouse.down();
  await page.mouse.move(blank.x, blank.y, { steps: 10 });
  await page.mouse.up();
  expect(await savedProject(page)).toEqual(original);
  await edge(page).locator(".diagram-route-chip").click();
  await routeHandle(page, "target").click();
  await page.keyboard.press("Escape");
  await node(page, "completed").click();
  expect(await savedProject(page)).toEqual(original);
  await expect(page.getByRole("button", { name: UNDO, exact: true })).toBeDisabled();
});

test("copy creates an isolated editable shape and keyboard undo and redo preserve the original while ignoring form fields", async ({ page }) => {
  const original = await seedProject(page);
  await node(page).dblclick();
  await page.getByRole("button", { name: "Seçilmiş addımın surətini yarat", exact: true }).click();
  const copied = await savedProject(page);
  const copy = copied.steps.find(step => !original.steps.some(existing => existing.id === step.id))!;
  expect(copied.steps).toHaveLength(original.steps.length + 1);
  expect(copy).toMatchObject({ type: original.steps[1].type, laneId: original.steps[1].laneId, title: original.steps[1].title, description: original.steps[1].description, routes: [] });
  expect(copy.position).not.toEqual(original.steps[1].position);
  expect(copied.steps.find(step => step.id === TASK_ID)).toEqual(original.steps[1]);
  expect(copied.steps.flatMap(step => step.routes).some(route => route.targetId === copy.id)).toBe(false);
  await page.getByLabel("Diaqram addımının adı", { exact: true }).focus();
  await page.keyboard.press("Control+z");
  expect(await savedProject(page)).toEqual(copied);
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: "İştirakçılar", exact: true }).click();
  await page.getByLabel("Prosesin adı", { exact: true }).focus();
  await page.keyboard.press("Control+z");
  expect(await savedProject(page)).toEqual(copied);
  await node(page, copy.id).focus();
  await page.keyboard.press("Control+z");
  await expect.poll(async () => (await savedProject(page)).steps.length).toBe(original.steps.length);
  expect(await savedProject(page)).toEqual(original);
  await page.getByLabel("Prosesin adı", { exact: true }).focus();
  await page.keyboard.press("Control+Shift+z");
  expect(await savedProject(page)).toEqual(original);
  await node(page).focus();
  await page.keyboard.press("Control+Shift+z");
  expect(await savedProject(page)).toEqual(copied);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  await node(page).dblclick();
  await page.getByLabel("Diaqram addımının adı", { exact: true }).fill("Dəqiqləşdirilmiş müraciət");
  const edited = await savedProject(page);
  expect(edited.steps).toHaveLength(original.steps.length);
  expect(edited.steps[1].title).toBe("Dəqiqləşdirilmiş müraciət");
  await expect(page.getByRole("button", { name: REDO, exact: true })).toBeDisabled();
  await page.reload();
  expect(await savedProject(page)).toEqual(edited);
});

test("the pencil has a visible edit label and opens the selected shape or arrow inspector", async ({ page }) => {
  await seedProject(page);
  await node(page).click();
  const stepEdit = page.getByRole("button", { name: "Seçilmiş fiquru redaktə et", exact: true });
  await expect(stepEdit).toContainText("Redaktə et");
  await stepEdit.click();
  await expect(page.getByRole("complementary", { name: "Addım redaktəsi" })).toBeVisible();
  await expect(page.getByLabel("Diaqram addımının icraçısı", { exact: true })).toHaveValue("operator");
  await page.getByRole("button", { name: "Redaktə panelini bağla", exact: true }).click();
  await edge(page).locator(".diagram-route-chip").click();
  await page.getByRole("button", { name: "Redaktə panelini bağla", exact: true }).click();
  const routeEdit = page.getByRole("button", { name: "Seçilmiş keçidi redaktə et", exact: true });
  await expect(routeEdit).toContainText("Redaktə et");
  await routeEdit.click();
  await expect(page.getByRole("complementary", { name: "Keçid redaktəsi" })).toBeVisible();
  await expect(page.getByLabel("Keçidin başlanğıcı", { exact: true })).toHaveValue(TASK_ID);
  await expect(page.getByLabel("Keçidin hədəfi", { exact: true })).toHaveValue("approved");
});

test("undo and redo close the branch editor rather than silently selecting a different reindexed arrow", async ({ page }) => {
  const original = await seedProject(page);
  await edge(page, TASK_ID, 1).locator(".diagram-route-chip").click();
  await expect(page.getByLabel("Etiketin mətni", { exact: true })).toHaveValue(original.steps[1].routes[1].label);
  await page.locator(`#step-form-${TASK_ID}`).getByRole("button", { name: "Keçid 1 sil", exact: true }).click();
  const removed = await savedProject(page);
  expect(removed.steps[1].routes).toEqual([original.steps[1].routes[1]]);
  await expect(page.getByLabel("Etiketin mətni", { exact: true })).toHaveValue(original.steps[1].routes[1].label);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await savedProject(page)).toEqual(original);
  await expect(page.getByRole("complementary", { name: "Keçid redaktəsi" })).toHaveCount(0);
  await expect(page.locator('#process-diagram .diagram-edge[aria-pressed="true"]')).toHaveCount(0);
  await edge(page, TASK_ID, 1).locator(".diagram-route-chip").click();
  await expect(page.getByLabel("Etiketin mətni", { exact: true })).toHaveValue(original.steps[1].routes[1].label);
  await expect(page.getByLabel("Keçidin izahı", { exact: true })).toHaveValue(original.steps[1].routes[1].description!);
  await page.getByRole("button", { name: REDO, exact: true }).click();
  expect(await savedProject(page)).toEqual(removed);
  await expect(page.getByRole("complementary", { name: "Keçid redaktəsi" })).toHaveCount(0);
  await expect(page.locator('#process-diagram .diagram-edge[aria-pressed="true"]')).toHaveCount(0);
  await edge(page, TASK_ID, 0).locator(".diagram-route-chip").click();
  await expect(page.getByLabel("Etiketin mətni", { exact: true })).toHaveValue(original.steps[1].routes[1].label);
});

test("choosing a different arrow cancels an armed reconnect so the next shape click only changes selection", async ({ page }) => {
  const original = await seedProject(page);
  await edge(page, TASK_ID, 0).locator(".diagram-route-chip").click();
  await routeHandle(page, "target", TASK_ID, 0).click();
  await expect(routeHandle(page, "target", TASK_ID, 0)).toHaveAttribute("aria-pressed", "true");
  await edge(page, TASK_ID, 1).locator(".diagram-route-chip").click();
  await expect(page.getByLabel("Etiketin mətni", { exact: true })).toHaveValue(original.steps[1].routes[1].label);
  await expect(routeHandle(page, "target", TASK_ID, 1)).toHaveAttribute("aria-pressed", "false");
  await node(page, "alternative-task").click();
  expect(await savedProject(page)).toEqual(original);
  await expect(node(page, "alternative-task")).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('#process-diagram .diagram-edge[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Seçilmiş fiquru redaktə et", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: UNDO, exact: true })).toBeDisabled();
});
