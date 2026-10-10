import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { layoutProject } from "../lib/layout";
import type { Project } from "../lib/types";

const STORAGE_PREFIX = "visioflow:v1:";
const SOURCE_ID = "check-request";

function branchingProject(): Project {
  return {
    version: 1, id: "editable-branching-project", name: "Müraciətin yoxlanması",
    pools: [{ id: "office", name: "Təşkilat", lanes: [
      { id: "operator", name: "Operator" }, { id: "reviewer", name: "Vizaçı" },
    ] }],
    steps: [
      { id: "start-request", laneId: "operator", type: "start", title: "Başla", description: "Müraciət daxil olur.", routes: [{ targetId: SOURCE_ID, label: "" }] },
      { id: SOURCE_ID, laneId: "operator", type: "userTask", title: "Müraciəti yoxla", description: "Operator müraciəti yoxlayıb uyğun əməliyyatı seçir.", routes: [
        { targetId: "approve-request", label: "Təsdiq", description: "Məlumatlar düzgündür və müraciət təsdiqlənir." },
        { targetId: "reject-request", label: "İmtina", description: "Səbəb göstərilərək müraciətdən imtina edilir." },
        { targetId: "return-request", label: "Geri qaytar", description: "Məlumatları dəqiqləşdirmək üçün geri qaytarılır." },
        { targetId: "close-request", label: "Bağla", description: "Əlavə əməliyyat tələb olunmadıqda müraciət bağlanır." },
      ] },
      { id: "approve-request", laneId: "operator", type: "end", title: "Təsdiqləndi", description: "", routes: [] },
      { id: "reject-request", laneId: "operator", type: "end", title: "İmtina edildi", description: "", routes: [] },
      { id: "return-request", laneId: "operator", type: "end", title: "Geri qaytarıldı", description: "", routes: [] },
      { id: "close-request", laneId: "operator", type: "end", title: "Bağlandı", description: "", routes: [] },
    ],
  };
}

async function seedProject(page: Page, project = branchingProject()) {
  await page.addInitScript(({ prefix, saved }) => {
    const key = prefix + saved.id;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
  }, { prefix: STORAGE_PREFIX, saved: project });
  await page.goto(`/#${project.id}`);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(project.steps.length);
  await expect(page.locator(".save-status")).toHaveText("Saxlanıldı");
  return project;
}

async function savedProject(page: Page): Promise<Project> {
  await expect(page.locator(".save-status")).toHaveText("Saxlanıldı");
  return page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + location.hash.slice(1))!), STORAGE_PREFIX);
}

function node(page: Page, id = SOURCE_ID): Locator {
  return page.locator(`#process-diagram [data-step-id="${id}"]`);
}

async function nodeCenter(page: Page, id = SOURCE_ID) {
  const project = await savedProject(page);
  const geometry = layoutProject(project).nodes.find(item => item.id === id)!;
  return page.locator("#process-diagram").evaluate((element, point) => {
    const matrix = (element as SVGSVGElement).getScreenCTM()!;
    const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: screen.x, y: screen.y, scale: matrix.a };
  }, { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 });
}

async function dragNode(page: Page, id: string, dx: number, dy: number) {
  const center = await nodeCenter(page, id);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + dx, center.y + dy, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await savedProject(page)).steps.find(step => step.id === id)!.position).toBeTruthy();
  return center.scale;
}

async function downloadBytes(download: Download) {
  expect(await download.failure()).toBeNull();
  return readFile((await download.path())!);
}

test("dragging at a changed zoom saves diagram coordinates, supports undo and survives reload and Visio export", async ({ page }) => {
  const original = await seedProject(page);
  await page.getByRole("button", { name: "Diaqramı böyüt", exact: true }).click();
  const initialLayout = layoutProject(original);
  const initialNode = initialLayout.nodes.find(item => item.id === SOURCE_ID)!;
  const initialLane = initialLayout.lanes.find(item => item.id === "operator")!;
  const scale = await dragNode(page, SOURCE_ID, 48, 18);
  const moved = await savedProject(page);
  const position = moved.steps.find(step => step.id === SOURCE_ID)!.position!;
  expect(position.x).toBeCloseTo(initialNode.x + 48 / scale, 0);
  expect(position.y).toBeCloseTo(initialNode.y - initialLane.y + 18 / scale, 0);
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  expect(await savedProject(page)).toEqual(original);
  await dragNode(page, SOURCE_ID, 52, 12);
  const persisted = await savedProject(page);
  const url = page.url();
  await page.reload();
  await expect(node(page)).toBeVisible();
  expect(page.url()).toBe(url);
  expect(await savedProject(page)).toEqual(persisted);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Visio üçün yüklə", exact: true }).click();
  const vsdx = await JSZip.loadAsync(await downloadBytes(await downloadPromise), { checkCRC32: true });
  const pageXml = await vsdx.file("visio/pages/page1.xml")!.async("string");
  expect(XMLValidator.validate(pageXml)).toBe(true);
  const parsed = new XMLParser({ ignoreAttributes: false, isArray: name => ["Shape", "Cell"].includes(name) }).parse(pageXml);
  const shape = parsed.PageContents.Shapes.Shape.find((item: Record<string, string>) => item["@_Name"] === "Müraciəti yoxla");
  const exportedLayout = layoutProject(persisted);
  const exportedNode = exportedLayout.nodes.find(item => item.id === SOURCE_ID)!;
  const cellValue = (name: string) => Number(shape.Cell.find((item: Record<string, string>) => item["@_N"] === name)["@_V"]);
  expect(cellValue("PinX")).toBeCloseTo((exportedNode.x + exportedNode.width / 2) / 96, 5);
  expect(cellValue("PinY")).toBeCloseTo((exportedLayout.height - exportedNode.y - exportedNode.height / 2) / 96, 5);
});

test("keyboard nudges use diagram units and Escape cancels an unfinished drag", async ({ page }) => {
  const original = await seedProject(page);
  const layout = layoutProject(original);
  const geometry = layout.nodes.find(item => item.id === SOURCE_ID)!;
  const lane = layout.lanes.find(item => item.id === "operator")!;
  await node(page).focus();
  await node(page).press("ArrowRight");
  await node(page).press("Shift+ArrowDown");
  const nudged = await savedProject(page);
  expect(nudged.steps.find(step => step.id === SOURCE_ID)!.position).toEqual({ x: geometry.x + 1, y: geometry.y - lane.y + 10 });
  const center = await nodeCenter(page);
  await page.mouse.move(center.x, center.y);
  await page.mouse.down();
  await page.mouse.move(center.x + 40, center.y + 20, { steps: 5 });
  await expect(node(page)).toHaveClass(/is-dragging/);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(node(page)).not.toHaveClass(/is-dragging/);
  expect(await savedProject(page)).toEqual(nudged);
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  expect((await savedProject(page)).steps.find(step => step.id === SOURCE_ID)!.position).toEqual({ x: geometry.x + 1, y: geometry.y - lane.y });
});

test("double-clicking a figure opens the compact editor and persists name, explanation, type and actor", async ({ page }) => {
  await seedProject(page);
  await node(page).dblclick();
  await expect(page.getByLabel("Diaqram addımının adı", { exact: true })).toBeVisible();
  await page.getByLabel("Diaqram addımının adı", { exact: true }).fill("Sənədi vizaçı yoxlayır");
  await page.getByLabel("Diaqram addımının təsviri", { exact: true }).fill("Vizaçı sənədi yoxlayır və dörd əməliyyatdan birini seçir.");
  await page.getByLabel("Diaqram addımının növü", { exact: true }).selectOption("xor");
  await page.getByLabel("Diaqram addımının icraçısı", { exact: true }).selectOption("reviewer");
  const saved = await savedProject(page);
  expect(saved.steps.find(step => step.id === SOURCE_ID)).toMatchObject({
    title: "Sənədi vizaçı yoxlayır", type: "xor", laneId: "reviewer",
    description: "Vizaçı sənədi yoxlayır və dörd əməliyyatdan birini seçir.",
  });
  await expect(node(page)).toHaveAttribute("aria-label", "XOR keçidi: Sənədi vizaçı yoxlayır");
  await page.reload();
  expect(await savedProject(page)).toEqual(saved);
  await node(page).dblclick();
  await expect(page.getByLabel("Diaqram addımının təsviri", { exact: true })).toHaveValue(saved.steps[1].description);
});

test("compact branch chips open their full explanation and keep numbering identical in the diagram and Word table", async ({ page }) => {
  const original = await seedProject(page);
  for (let index = 0; index < 4; index++) {
    await expect(page.locator(`#process-diagram .diagram-edge[data-route-source="${SOURCE_ID}"][data-route-index="${index}"] .diagram-route-chip`)).toContainText(`2.${index + 1}`);
  }
  const chip = page.locator(`#process-diagram .diagram-edge[data-route-source="${SOURCE_ID}"][data-route-index="1"] .diagram-route-chip`);
  await chip.click();
  await expect(page.getByLabel("Etiketin mətni", { exact: true })).toHaveValue("İmtina");
  await expect(page.getByLabel("Keçidin izahı", { exact: true })).toHaveValue(original.steps[1].routes[1].description!);
  await expect(page.getByLabel("Keçidin hədəfi", { exact: true })).toHaveValue("reject-request");
  const longExplanation = "İmtina səbəbi qeyd olunur, operatora bildiriş göndərilir və müraciətin viza prosesi tamamlanır.";
  await page.getByLabel("Etiketin mətni", { exact: true }).fill("Rədd et");
  await page.getByLabel("Keçidin izahı", { exact: true }).fill(longExplanation);
  await expect(chip).toContainText("2.2");
  await expect(chip).toContainText("Rədd et");
  await expect(page.locator("#process-diagram")).not.toContainText(longExplanation);
  const saved = await savedProject(page);
  expect(saved.steps[1].routes[1]).toEqual({ targetId: "reject-request", label: "Rədd et", description: longExplanation });
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /İzah/ }).click();
  for (const number of ["2.1", "2.2", "2.3", "2.4"]) await expect(page.locator(".explanation-text tbody tr").filter({ has: page.locator("td", { hasText: new RegExp(`^${number.replace(".", "\\.")}$`) }) })).toHaveCount(1);
  await expect(page.locator(".explanation-text")).toContainText(longExplanation);
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Word cədvəli yüklə", exact: true }).click();
  const docx = await JSZip.loadAsync(await downloadBytes(await downloadPromise), { checkCRC32: true });
  const xml = await docx.file("word/document.xml")!.async("string");
  for (const number of ["2.1", "2.2", "2.3", "2.4"]) expect(xml).toContain(`>${number}</w:t>`);
  expect(xml).toContain(longExplanation);
  await page.reload();
  expect(await savedProject(page)).toEqual(saved);
});

test("the connection handle creates a targeted route and the route editor can delete and undo it", async ({ page }) => {
  const original = await seedProject(page);
  await node(page, "start-request").click();
  const handle = page.locator('#process-diagram [data-connection-handle="start-request"]');
  await expect(handle).toBeVisible();
  await handle.click();
  await expect(page.locator(".diagram-editor-hint")).toContainText("digər addımı seç");
  await node(page, "approve-request").click();
  const connected = await savedProject(page);
  expect(connected.steps[0].routes).toEqual([...original.steps[0].routes, { targetId: "approve-request", label: "", description: "" }]);
  await expect(page.getByLabel("Keçidin hədəfi", { exact: true })).toHaveValue("approve-request");
  await page.getByRole("button", { name: "Seçilmiş keçidi sil", exact: true }).click();
  expect(await savedProject(page)).toEqual(original);
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  expect(await savedProject(page)).toEqual(connected);
});

test("dragging a connection handle links figures while Escape cancels a pending connection", async ({ page }) => {
  const original = await seedProject(page);
  await node(page, "start-request").click();
  const handle = page.locator('#process-diagram [data-connection-handle="start-request"]');
  const initialHandle = (await handle.boundingBox())!;
  const target = await nodeCenter(page, "approve-request");
  await page.mouse.move(initialHandle.x + initialHandle.width / 2, initialHandle.y + initialHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 10 });
  await expect(page.locator(".diagram-connection-preview")).toBeVisible();
  await page.mouse.up();
  expect((await savedProject(page)).steps[0].routes).toEqual([...original.steps[0].routes, { targetId: "approve-request", label: "", description: "" }]);
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  expect(await savedProject(page)).toEqual(original);
  await node(page, "start-request").click();
  const cancelHandle = (await handle.boundingBox())!;
  const cancelTarget = await nodeCenter(page, "reject-request");
  await page.mouse.move(cancelHandle.x + cancelHandle.width / 2, cancelHandle.y + cancelHandle.height / 2);
  await page.mouse.down();
  await page.mouse.move(cancelTarget.x, cancelTarget.y, { steps: 10 });
  await expect(page.locator(".diagram-connection-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".diagram-connection-preview")).toHaveCount(0);
  expect(await savedProject(page)).toEqual(original);
});

test("deleting a focused diagram figure removes its incoming connection and undo restores both", async ({ page }) => {
  const original = await seedProject(page);
  await node(page, "approve-request").focus();
  await node(page, "approve-request").press("Delete");
  await expect(node(page, "approve-request")).toHaveCount(0);
  const saved = await savedProject(page);
  expect(saved.steps).toHaveLength(5);
  expect(saved.steps[1].routes).toHaveLength(3);
  expect(saved.steps[1].routes.some(route => route.targetId === "approve-request")).toBe(false);
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  expect(await savedProject(page)).toEqual(original);
  await expect(node(page, "approve-request")).toHaveCount(1);
});

test("automatic layout removes manual positions and undo restores them", async ({ page }) => {
  const original = branchingProject();
  original.steps[1].position = { x: 610, y: 60 };
  original.steps[2].position = { x: 1040, y: 130 };
  await seedProject(page, original);
  await page.getByRole("button", { name: "Diaqramı avtomatik düz", exact: true }).click();
  const automatic = await savedProject(page);
  expect(automatic.steps.every(step => !step.position)).toBe(true);
  expect(automatic.steps.map(({ position: _position, ...step }) => step)).toEqual(original.steps.map(({ position: _position, ...step }) => step));
  await expect(page.getByRole("button", { name: "Diaqramı avtomatik düz", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  expect(await savedProject(page)).toEqual(original);
});
