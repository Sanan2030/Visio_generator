import { expect, test, type Page } from "@playwright/test";
import { layoutProject } from "../lib/layout";
import type { LayoutPoint, Project } from "../lib/types";

const STORAGE_PREFIX = "visioflow:v1:";
const UNDO = "Son dəyişikliyi geri al";
const REDO = "Geri alınmış dəyişikliyi yenidən tətbiq et";

function projectFixture(): Project {
  return {
    version: 1, id: "free-canvas-project", name: "Sərbəst iş axını", size: { width: 1000, height: 720 },
    pools: [
      { id: "first-pool", name: "Birinci pool", position: { x: 16, y: 16 }, size: { width: 480, height: 160 }, lanes: [{ id: "first-lane", name: "Operator" }] },
      { id: "second-pool", name: "İkinci pool", position: { x: 16, y: 400 }, size: { width: 480, height: 160 }, lanes: [{ id: "second-lane", name: "Vizaçı" }] },
    ],
    steps: [
      { id: "first-task", laneId: "first-lane", type: "task", title: "Müraciəti yoxla", description: "İlkin yoxlama.", position: { x: 260, y: 24 }, size: { width: 120, height: 60 }, routes: [{ targetId: "second-task", label: "Davam et" }] },
      { id: "second-task", laneId: "second-lane", type: "task", title: "Qərar ver", description: "İkinci yoxlama.", position: { x: 260, y: 24 }, size: { width: 120, height: 60 }, routes: [] },
      { id: "free-note", laneId: "", type: "annotation", title: "• Temp_raport_no (Raportun müvəqqəti nömrəsi),", description: "• Status (Rejected),\n• İcraçının ad, soyad, ata adı\n• İmtina qeydi", position: { x: 520, y: 240 }, size: { width: 430, height: 120 }, routes: [] },
    ],
  };
}

async function seed(page: Page) {
  const project = projectFixture();
  await page.addInitScript(({ prefix, saved }) => {
    const key = prefix + saved.id;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
  }, { prefix: STORAGE_PREFIX, saved: project });
  await page.goto(`/#${project.id}`);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(project.steps.length);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return project;
}

async function saved(page: Page): Promise<Project> {
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + location.hash.slice(1))!), STORAGE_PREFIX);
}

function node(page: Page, id: string) {
  return page.locator(`#process-diagram [data-step-id="${id}"]`);
}

async function screenPoint(page: Page, point: LayoutPoint) {
  return page.locator("#process-diagram").evaluate((element, point) => {
    const matrix = (element as SVGSVGElement).getScreenCTM()!;
    const position = new DOMPoint(point.x, point.y).matrixTransform(matrix);
    return { x: position.x, y: position.y, scale: matrix.a };
  }, point);
}

async function drag(page: Page, start: LayoutPoint, target: LayoutPoint, release = true) {
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 12 });
  if (release) await page.mouse.up();
}

async function nodeCenter(page: Page, id: string) {
  const geometry = layoutProject(await saved(page)).nodes.find(item => item.id === id)!;
  return screenPoint(page, { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 });
}

test("pool dragging carries its children and connector, persists, supports undo/redo and cancels with Escape", async ({ page }) => {
  const original = await seed(page);
  const before = layoutProject(original);
  const pool = before.pools.find(item => item.id === "first-pool")!;
  const start = await screenPoint(page, { x: pool.x + 90, y: pool.y + 18 });
  await drag(page, start, { x: start.x + 60 * start.scale, y: start.y + 40 * start.scale });
  await expect.poll(async () => (await saved(page)).pools[0].position).toEqual({ x: pool.x + 60, y: pool.y + 40 });
  const moved = await saved(page);
  expect(moved.steps).toEqual(original.steps);
  expect(moved.pools[1]).toEqual(original.pools[1]);
  const after = layoutProject(moved);
  for (const id of ["first-task", "second-task", "free-note"]) {
    const first = before.nodes.find(item => item.id === id)!;
    const next = after.nodes.find(item => item.id === id)!;
    expect(next.x - first.x).toBe(id === "first-task" ? 60 : 0);
    expect(next.y - first.y).toBe(id === "first-task" ? 40 : 0);
  }
  expect(after.edges[0].points[0].x - before.edges[0].points[0].x).toBe(60);
  expect(after.edges[0].points[0].y - before.edges[0].points[0].y).toBe(40);
  expect(after.edges[0].points.at(-1)).toEqual(before.edges[0].points.at(-1));
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await saved(page)).toEqual(original);
  await page.getByRole("button", { name: REDO, exact: true }).click();
  expect(await saved(page)).toEqual(moved);
  await page.reload();
  await expect(page.locator('[data-pool-handle="first-pool"]')).toBeVisible();
  expect(await saved(page)).toEqual(moved);
  const nextPool = after.pools.find(item => item.id === "first-pool")!;
  const nextStart = await screenPoint(page, { x: nextPool.x + 90, y: nextPool.y + 18 });
  await drag(page, nextStart, { x: nextStart.x + 40, y: nextStart.y + 25 }, false);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await saved(page)).toEqual(moved);
  await expect(page.getByRole("button", { name: UNDO, exact: true })).toBeDisabled();
});

test("a palette task can be placed between pools, assigned to a lane and positioned precisely outside pools", async ({ page }) => {
  const original = await seed(page);
  const target = await screenPoint(page, { x: 280, y: 280 });
  const palette = page.getByRole("button", { name: "Diaqramda tapşırıq əlavə et", exact: true });
  const bounds = (await palette.boundingBox())!;
  await drag(page, { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }, target);
  await expect.poll(async () => (await saved(page)).steps.length).toBe(original.steps.length + 1);
  const placed = await saved(page);
  const task = placed.steps.at(-1)!;
  expect(task.laneId).toBe("");
  expect(task.routes).toEqual([]);
  const geometry = layoutProject(placed).nodes.find(item => item.id === task.id)!;
  expect(geometry.x + geometry.width / 2).toBeCloseTo(280, 0);
  expect(geometry.y + geometry.height / 2).toBeCloseTo(280, 0);
  await expect(node(page, task.id)).toHaveAttribute("aria-pressed", "true");
  await node(page, task.id).dblclick();
  await page.getByLabel("Diaqram addımının icraçısı", { exact: true }).selectOption("second-lane");
  await expect.poll(async () => (await saved(page)).steps.at(-1)!.laneId).toBe("second-lane");
  const assigned = await saved(page);
  const lane = layoutProject(assigned).lanes.find(item => item.id === "second-lane")!;
  const assignedNode = layoutProject(assigned).nodes.find(item => item.id === task.id)!;
  expect(assignedNode.y).toBeGreaterThanOrEqual(lane.y);
  expect(assignedNode.y + assignedNode.height).toBeLessThanOrEqual(lane.y + lane.height);
  expect(assigned.steps.at(-1)!.title).toBe(task.title);
  await page.getByLabel("Diaqram addımının icraçısı", { exact: true }).selectOption("");
  await page.getByLabel("Fiqurun X mövqeyi", { exact: true }).fill("48");
  await page.getByLabel("Fiqurun X mövqeyi", { exact: true }).press("Enter");
  await page.getByLabel("Fiqurun Y mövqeyi", { exact: true }).fill("290");
  await page.getByLabel("Fiqurun Y mövqeyi", { exact: true }).press("Tab");
  await expect.poll(async () => (await saved(page)).steps.at(-1)!.position).toEqual({ x: 48, y: 290 });
  const precise = await saved(page);
  expect(precise.steps.at(-1)!.laneId).toBe("");
  await page.reload();
  await expect(node(page, task.id)).toBeVisible();
  expect(await saved(page)).toEqual(precise);
});

test("an assigned task can be dragged into the gap and then into another pool without losing its routes", async ({ page }) => {
  const original = await seed(page);
  const start = await nodeCenter(page, "first-task");
  const free = await screenPoint(page, { x: 280, y: 280 });
  await drag(page, start, free);
  await expect.poll(async () => (await saved(page)).steps[0].laneId).toBe("");
  const detached = await saved(page);
  expect(detached.steps[0].routes).toEqual(original.steps[0].routes);
  const layout = layoutProject(detached);
  const lane = layout.lanes.find(item => item.id === "second-lane")!;
  const center = await nodeCenter(page, "first-task");
  const target = await screenPoint(page, { x: lane.x + 190, y: lane.y + 50 });
  await drag(page, center, target);
  await expect.poll(async () => (await saved(page)).steps[0].laneId).toBe("second-lane");
  expect((await saved(page)).steps[0].routes).toEqual(original.steps[0].routes);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await saved(page)).toEqual(detached);
});

test("screenshot-style notes show separate blue bullet lines with a thin bracket and no task card or number", async ({ page }) => {
  await seed(page);
  const note = node(page, "free-note");
  await expect(note.locator(".diagram-annotation-hit-area")).toHaveAttribute("fill", "transparent");
  await expect(note.locator(".diagram-annotation-text")).toHaveAttribute("text-anchor", "start");
  await expect(note.locator(".diagram-annotation-text")).toHaveAttribute("fill", /--diagram-annotation-ink/);
  await expect(note.locator("path")).toHaveAttribute("stroke-width", "1.2");
  await expect(note.locator(".diagram-step-number")).toHaveCount(0);
  await expect(note.locator(".diagram-annotation-text tspan")).toHaveText([
    "• Temp_raport_no (Raportun müvəqqəti nömrəsi),", "• Status (Rejected),", "• İcraçının ad, soyad, ata adı", "• İmtina qeydi",
  ]);
  await note.dblclick();
  await page.getByLabel("Diaqram addımının təsviri", { exact: true }).fill("- Status (Approved)\n• Yeni qeyd");
  await expect(note.locator(".diagram-annotation-text tspan")).toHaveText([
    "• Temp_raport_no (Raportun müvəqqəti nömrəsi),", "• Status (Approved)", "• Yeni qeyd",
  ]);
  const edited = await saved(page);
  await page.reload();
  await expect(node(page, "free-note").locator(".diagram-annotation-text tspan")).toHaveCount(3);
  expect(await saved(page)).toEqual(edited);
});
