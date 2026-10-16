import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { layoutProject } from "../lib/layout";
import type { Project } from "../lib/types";

const PROJECT_PREFIX = "visioflow:v1:";
const CLIPBOARD_KEY = "visioflow:diagram-clipboard:v1";
const UNDO = "Son dəyişikliyi geri al";
const REDO = "Geri alınmış dəyişikliyi yenidən tətbiq et";

function sourceProject(): Project {
  return {
    version: 1, id: "clipboard-source", name: "Kopyalanacaq iş axını", size: { width: 1200, height: 850 },
    pools: [
      { id: "source-pool-a", name: "Qəbul şöbəsi", position: { x: 16, y: 16 }, size: { width: 540, height: 190 }, lanes: [{ id: "source-lane-a", name: "Operator" }] },
      { id: "source-pool-b", name: "Təsdiq şöbəsi", position: { x: 90, y: 420 }, size: { width: 600, height: 210 }, lanes: [{ id: "source-lane-b", name: "Təsdiqləyən" }] },
    ],
    steps: [
      {
        id: "source-task-a", laneId: "source-lane-a", type: "userTask", title: "Müraciəti yoxla", description: "Ərizənin məlumatlarını yoxla.",
        duration: "2 iş günü", system: "Sənəd dövriyyəsi", document: "Ərizə forması", position: { x: 260, y: 30 }, size: { width: 180, height: 80 },
        routes: [{ targetId: "source-task-b", label: "Təsdiqə göndər", description: "Məlumatlar tam olduqda göndərilir." }],
      },
      {
        id: "source-task-b", laneId: "source-lane-b", type: "task", title: "Müraciəti təsdiqlə", description: "Yekun qərarı ver.",
        duration: "1 saat", system: "Təsdiq sistemi", document: "Qərar", position: { x: 340, y: 40 }, size: { width: 160, height: 70 },
        routes: [{ targetId: "source-task-a", label: "Düzəliş", description: "Çatışmazlıq olduqda operatora qaytar." }],
      },
      {
        id: "source-note", laneId: "", type: "annotation", title: "• Temp_raport_no", description: "• Status (Rejected)\n• İmtina qeydi",
        position: { x: 680, y: 260 }, size: { width: 370, height: 120 }, routes: [],
      },
    ],
  };
}

function targetProject(): Project {
  return {
    version: 1, id: "clipboard-target", name: "Mövcud digər iş axını", size: { width: 900, height: 500 },
    pools: [{ id: "source-pool-a", name: "Mövcud şöbə", position: { x: 70, y: 50 }, size: { width: 650, height: 190 }, lanes: [{ id: "source-lane-a", name: "Mövcud icraçı" }] }],
    steps: [{ id: "source-task-a", laneId: "source-lane-a", type: "task", title: "Əvvəlki işi saxla", description: "Bu addım dəyişməməlidir.", position: { x: 260, y: 40 }, size: { width: 160, height: 70 }, routes: [] }],
  };
}

async function seed(page: Page, clipboard: "working" | "denied" = "working") {
  const source = sourceProject();
  const target = targetProject();
  await page.addInitScript(({ projects, prefix, clipboardMode }) => {
    for (const project of projects) {
      const key = prefix + project.id;
      if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(project));
    }
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        writeText: async (text: string) => {
          if (clipboardMode === "denied") throw new DOMException("Clipboard is unavailable", "NotAllowedError");
          (window as unknown as { copiedDiagram: string }).copiedDiagram = text;
        },
      },
    });
  }, { projects: [source, target], prefix: PROJECT_PREFIX, clipboardMode: clipboard });
  await page.goto(`/#${source.id}`);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(source.steps.length);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return { source, target };
}

async function projectMenuAction(page: Page, name: string) {
  await page.getByRole("button", { name: "Layihə menyusu", exact: true }).click();
  await page.getByRole("button", { name, exact: true }).click();
}

async function saved(page: Page): Promise<Project> {
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + location.hash.slice(1))!), PROJECT_PREFIX);
}

async function openTarget(page: Page, target: Project) {
  await page.evaluate(id => { location.hash = id; }, target.id);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(target.steps.length);
  expect(await saved(page)).toEqual(target);
}

async function openPasteDialog(page: Page) {
  await projectMenuAction(page, "Diaqram yapışdır");
  const dialog = page.getByRole("dialog", { name: "Diaqram yapışdır", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

function ids(project: Project) {
  return [project.id, ...project.pools.flatMap(pool => [pool.id, ...pool.lanes.map(lane => lane.id)]), ...project.steps.map(step => step.id)];
}

function expectCompleteCopy(source: Project, target: Project, pasted: Project) {
  expect(pasted.id).toBe(target.id);
  expect(pasted.name).toBe(target.name);
  const poolContent = (project: Project) => project.pools.map(({ position: _position, size: _size, lanes, ...pool }) => ({
    ...pool, lanes: lanes.map(({ height: _height, ...lane }) => lane),
  }));
  const stepContent = (project: Project) => project.steps.map(({ position: _position, size: _size, ...step }) => step);
  expect(poolContent(pasted).slice(0, target.pools.length)).toEqual(poolContent(target));
  expect(stepContent(pasted).slice(0, target.steps.length)).toEqual(stepContent(target));
  const previousLayout = layoutProject(target);
  const nextLayout = layoutProject(pasted);
  for (const pool of previousLayout.pools) expect(nextLayout.pools.find(item => item.id === pool.id)).toEqual(pool);
  for (const lane of previousLayout.lanes) expect(nextLayout.lanes.find(item => item.id === lane.id)).toEqual(lane);
  for (const node of previousLayout.nodes) expect(nextLayout.nodes.find(item => item.id === node.id)).toEqual(node);
  for (const edge of previousLayout.edges) expect(nextLayout.edges.find(item => item.sourceId === edge.sourceId && item.routeIndex === edge.routeIndex)).toEqual(edge);
  const pools = pasted.pools.slice(target.pools.length);
  const steps = pasted.steps.slice(target.steps.length);
  expect(pools).toHaveLength(source.pools.length);
  expect(steps).toHaveLength(source.steps.length);
  const previousIds = new Set([...ids(source), ...ids(target)]);
  const newIds = [...pools.flatMap(pool => [pool.id, ...pool.lanes.map(lane => lane.id)]), ...steps.map(step => step.id)];
  expect(new Set(newIds).size).toBe(newIds.length);
  for (const id of newIds) expect(previousIds.has(id)).toBe(false);

  const laneMap = new Map(source.pools.flatMap((pool, index) => pool.lanes.map((lane, laneIndex) => [lane.id, pools[index].lanes[laneIndex].id])));
  const stepMap = new Map(source.steps.map((step, index) => [step.id, steps[index].id]));
  for (const [index, pool] of source.pools.entries()) {
    expect(pools[index].name).toBe(pool.name);
    expect(pools[index].lanes.map(lane => lane.name)).toEqual(pool.lanes.map(lane => lane.name));
  }
  for (const [index, step] of source.steps.entries()) {
    const { id: _sourceId, laneId, routes, position: _position, ...content } = step;
    const { id: _copyId, laneId: pastedLane, routes: pastedRoutes, position: _copyPosition, ...pastedContent } = steps[index];
    expect(pastedContent).toEqual(content);
    expect(pastedLane).toBe(laneId === "" ? "" : laneMap.get(laneId));
    expect(pastedRoutes).toEqual(routes.map(route => ({ ...route, targetId: stepMap.get(route.targetId) })));
  }

  const originalLayout = layoutProject(source);
  const firstPool = nextLayout.pools.find(pool => pool.id === pools[0].id)!;
  const dx = firstPool.x - originalLayout.pools[0].x;
  const dy = firstPool.y - originalLayout.pools[0].y;
  for (const [index, pool] of originalLayout.pools.entries()) {
    const copy = nextLayout.pools.find(item => item.id === pools[index].id)!;
    expect({ x: copy.x - dx, y: copy.y - dy, width: copy.width, height: copy.height }).toEqual({ x: pool.x, y: pool.y, width: pool.width, height: pool.height });
  }
  for (const node of originalLayout.nodes) {
    const copy = nextLayout.nodes.find(item => item.id === stepMap.get(node.id))!;
    expect({ x: copy.x - dx, y: copy.y - dy, width: copy.width, height: copy.height }).toEqual({ x: node.x, y: node.y, width: node.width, height: node.height });
  }
}

test("a full diagram copy survives reload and pastes all geometry, free notes, metadata and remapped routes into another flow in one undo", async ({ page }) => {
  const { source, target } = await seed(page);
  await projectMenuAction(page, "Bütün diaqramı kopyala");
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CLIPBOARD_KEY)).toContain(source.steps[0].title);
  const copy = await page.evaluate(key => localStorage.getItem(key)!, CLIPBOARD_KEY);
  await expect.poll(() => page.evaluate(() => (window as unknown as { copiedDiagram: string }).copiedDiagram)).toBe(copy);
  await openTarget(page, target);
  await page.reload();
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(target.steps.length);
  const dialog = await openPasteDialog(page);
  await expect(dialog.getByLabel("Kopyalanmış diaqram", { exact: true })).toHaveValue(copy);
  await dialog.getByRole("button", { name: "Diaqramı əlavə et", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(target.steps.length + source.steps.length);
  const pasted = await saved(page);
  expectCompleteCopy(source, target, pasted);
  expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PROJECT_PREFIX + source.id)).toEqual(source);
  await page.getByRole("button", { name: UNDO, exact: true }).click();
  expect(await saved(page)).toEqual(target);
  await expect(page.getByRole("button", { name: UNDO, exact: true })).toBeDisabled();
  await page.getByRole("button", { name: REDO, exact: true }).click();
  expect(await saved(page)).toEqual(pasted);
  await page.reload();
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(pasted.steps.length);
  expect(await saved(page)).toEqual(pasted);
});

test("unavailable system clipboard still retains a reusable browser copy", async ({ page }) => {
  const { source, target } = await seed(page, "denied");
  await projectMenuAction(page, "Bütün diaqramı kopyala");
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CLIPBOARD_KEY)).toContain(source.steps[0].title);
  await openTarget(page, target);
  const dialog = await openPasteDialog(page);
  await expect(dialog.getByLabel("Kopyalanmış diaqram", { exact: true })).toHaveValue(/Müraciəti yoxla/);
  await dialog.getByRole("button", { name: "Diaqramı əlavə et", exact: true }).click();
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(target.steps.length + source.steps.length);
  expectCompleteCopy(source, target, await saved(page));
});

test("a new session copy takes precedence over an older saved copy when clipboard storage is full", async ({ page }) => {
  const { source, target } = await seed(page, "denied");
  await openTarget(page, target);
  await projectMenuAction(page, "Bütün diaqramı kopyala");
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CLIPBOARD_KEY)).toContain(target.steps[0].title);
  const oldCopy = await page.evaluate(key => localStorage.getItem(key), CLIPBOARD_KEY);
  await page.evaluate(id => { location.hash = id; }, source.id);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(source.steps.length);
  await page.evaluate(key => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException("Clipboard storage is full", "QuotaExceededError");
      return original.call(this, name, value);
    };
  }, CLIPBOARD_KEY);
  await projectMenuAction(page, "Bütün diaqramı kopyala");
  expect(await page.evaluate(key => localStorage.getItem(key), CLIPBOARD_KEY)).toBe(oldCopy);
  await openTarget(page, target);
  const dialog = await openPasteDialog(page);
  await expect(dialog.getByLabel("Kopyalanmış diaqram", { exact: true })).toHaveValue(/Müraciəti yoxla/);
  await expect(dialog.getByLabel("Kopyalanmış diaqram", { exact: true })).not.toHaveValue(/Əvvəlki işi saxla/);
  await dialog.getByRole("button", { name: "Diaqramı əlavə et", exact: true }).click();
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(target.steps.length + source.steps.length);
  expectCompleteCopy(source, target, await saved(page));
});

test("clearing all projects also removes the saved and session diagram copies", async ({ page }) => {
  const { source } = await seed(page);
  await projectMenuAction(page, "Bütün diaqramı kopyala");
  await expect.poll(() => page.evaluate(key => localStorage.getItem(key), CLIPBOARD_KEY)).toContain(source.steps[0].title);
  await projectMenuAction(page, "Hər şeyi sil");
  const confirmation = page.getByRole("dialog", { name: "Hər şeyi silmək istəyirsən?", exact: true });
  await confirmation.getByRole("button", { name: "Bəli, hər şeyi sil", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(0);
  expect(await page.evaluate(key => localStorage.getItem(key), CLIPBOARD_KEY)).toBeNull();
  const dialog = await openPasteDialog(page);
  await expect(dialog.getByLabel("Kopyalanmış diaqram", { exact: true })).toHaveValue("");
});

test("invalid external diagram text keeps the current flow and undo history unchanged", async ({ page }) => {
  const { target } = await seed(page);
  await openTarget(page, target);
  const dialog = await openPasteDialog(page);
  const input = dialog.getByLabel("Kopyalanmış diaqram", { exact: true });
  for (const invalid of ["{unfinished", JSON.stringify({ version: 1, pools: [], steps: [] }), JSON.stringify({ version: 1, id: "broken", name: "Broken", pools: "invalid", steps: [] })]) {
    await input.fill(invalid);
    await dialog.getByRole("button", { name: "Diaqramı əlavə et", exact: true }).click();
    await expect(dialog).toBeVisible();
    expect(await saved(page)).toEqual(target);
    await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(target.steps.length);
  }
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: UNDO, exact: true })).toBeDisabled();
});

test("a downloaded diagram file can later be imported into another flow without a browser clipboard", async ({ page }) => {
  const { source, target } = await seed(page);
  const downloadPromise = page.waitForEvent("download");
  await projectMenuAction(page, "Diaqram nüsxəsini yüklə");
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.visioflow\.json$/);
  expect(await download.failure()).toBeNull();
  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const bytes = await readFile(filePath!);
  expect(() => JSON.parse(bytes.toString("utf8"))).not.toThrow();
  expect(bytes.toString("utf8")).toContain(source.steps[0].title);
  await page.evaluate(key => localStorage.removeItem(key), CLIPBOARD_KEY);
  await openTarget(page, target);
  const dialog = await openPasteDialog(page);
  await expect(dialog.getByLabel("Kopyalanmış diaqram", { exact: true })).toHaveValue("");
  await dialog.getByLabel("Diaqram faylını seç", { exact: true }).setInputFiles({ name: download.suggestedFilename(), mimeType: "application/json", buffer: bytes });
  await expect(dialog.getByLabel("Kopyalanmış diaqram", { exact: true })).toHaveValue(/Müraciəti yoxla/);
  await dialog.getByRole("button", { name: "Diaqramı əlavə et", exact: true }).click();
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(target.steps.length + source.steps.length);
  expectCompleteCopy(source, target, await saved(page));
});
