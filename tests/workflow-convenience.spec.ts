import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { explanationRows } from "../lib/docx";
import { validateProject } from "../lib/process";
import type { Project } from "../lib/types";

const PREFIX = "visioflow:v1:";

function orderedProject(): Project {
  return {
    version: 1, id: "convenience-process", name: "Sənədin yoxlanması",
    pools: [{ id: "organization", name: "Təşkilat", lanes: [{ id: "operator", name: "Operator" }] }],
    steps: [
      { id: "start", laneId: "operator", type: "start", title: "Başla", description: "Proses başlayır.", routes: [{ targetId: "first", label: "" }] },
      { id: "first", laneId: "operator", type: "task", title: "Məlumatları yoxla", description: "Məlumatlar yoxlanılır.", routes: [{ targetId: "second", label: "Yoxlandı", description: "Yoxlama tamamlandıqdan sonra davam et." }] },
      { id: "second", laneId: "operator", type: "task", title: "Cavabı hazırla", description: "Cavab hazırlanır.", routes: [{ targetId: "end", label: "" }] },
      { id: "end", laneId: "operator", type: "end", title: "Tamamlandı", description: "İş tamamlandı.", routes: [] },
    ],
  };
}

async function seedProject(page: Page, project = orderedProject()) {
  await page.addInitScript(({ saved, prefix }) => {
    const key = prefix + saved.id;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
  }, { saved: project, prefix: PREFIX });
  await page.goto(`/#${project.id}`);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(project.steps.length);
  return project;
}

async function openSteps(page: Page) {
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /Addımlar/ }).click();
}

async function savedProject(page: Page): Promise<Project> {
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + window.location.hash.slice(1))!), PREFIX);
}

async function downloadBytes(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

function xmlText(markup: string): string {
  const parsed = new XMLParser({ ignoreAttributes: true, parseTagValue: false }).parse(`<value>${markup}</value>`).value;
  if (typeof parsed === "string") return parsed;
  return parsed?.["#text"] ?? "";
}

async function expectExportsFollowStepOrder(page: Page, project: Project) {
  const wordPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Word izahını yüklə", exact: true }).click();
  const word = await wordPromise;
  expect(word.suggestedFilename()).toMatch(/\.docx$/);
  const wordZip = await JSZip.loadAsync(await downloadBytes(word), { checkCRC32: true });
  const documentXml = await wordZip.file("word/document.xml")!.async("string");
  expect(XMLValidator.validate(documentXml)).toBe(true);
  const rows = [...documentXml.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].slice(1);
  const expected = explanationRows(project);
  expect(rows).toHaveLength(expected.length);
  for (const [index, row] of rows.entries()) {
    const cells = [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)];
    const numberText = cells[0][0].match(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/)![1];
    expect(xmlText(numberText)).toBe(expected[index].number);
    expect(cells[2][0]).toContain(expected[index].title);
  }
  const visioPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Visio üçün yüklə", exact: true }).click();
  const visio = await visioPromise;
  const visioZip = await JSZip.loadAsync(await downloadBytes(visio), { checkCRC32: true });
  const pageXml = await visioZip.file("visio/pages/page1.xml")!.async("string");
  expect(XMLValidator.validate(pageXml)).toBe(true);
  const shapes = [...pageXml.matchAll(/<Shape\b[^>]*>[\s\S]*?<\/Shape>/g)].map(match => match[0]);
  for (const [index, step] of project.steps.entries()) {
    const shape = shapes.find(candidate => candidate.includes(`<Cell N="Value" V="${step.id}"/>`));
    expect(shape).toBeDefined();
    const text = shape!.match(/<Text[^>]*>([\s\S]*?)<\/Text>/)![1];
    expect(xmlText(text)).toBe(`${index + 1}. ${step.title}`);
  }
}

test("moving steps up and down updates form order, Word rows and native Visio numbering together", async ({ page }) => {
  const before = await seedProject(page);
  await openSteps(page);
  await expect(page.getByRole("button", { name: "1-ci addımı yuxarı keçir", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "4-ci addımı aşağı keçir", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "3-ci addımı yuxarı keçir", exact: true }).click();
  await expect(page.locator(".step-summary-text strong")).toHaveText(["Başla", "Cavabı hazırla", "Məlumatları yoxla", "Tamamlandı"]);
  await page.getByRole("button", { name: "2-ci addımı aşağı keçir", exact: true }).click();
  await expect(page.locator(".step-summary-text strong")).toHaveText(before.steps.map(step => step.title));
  await page.getByRole("button", { name: "2-ci addımı aşağı keçir", exact: true }).click();
  const after = await savedProject(page);
  expect(after.steps.map(step => step.id)).toEqual(["start", "second", "first", "end"]);
  expect(after.steps.find(step => step.id === "first")!.routes).toEqual(before.steps[1].routes);
  await expectExportsFollowStepOrder(page, after);
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /İzah/ }).click();
  await expect(page.locator(".explanation-text tbody tr td:first-child")).toHaveText(["1", "2", "3", "4"]);
  await page.reload();
  expect((await savedProject(page)).steps.map(step => step.id)).toEqual(after.steps.map(step => step.id));
});

test("inserting after a single-path step keeps its existing route label and description", async ({ page }) => {
  const before = await seedProject(page);
  await openSteps(page);
  await page.getByRole("button", { name: "2-ci addımı aç", exact: true }).click();
  await page.getByRole("button", { name: "Bu addımdan sonra əlavə et", exact: true }).click();
  await expect(page.locator(".step-card")).toHaveCount(5);
  const after = await savedProject(page);
  const inserted = after.steps[2];
  expect(after.steps.map(step => step.id)).toEqual(["start", "first", inserted.id, "second", "end"]);
  expect(inserted.id).not.toBe(before.steps[2].id);
  expect(inserted.laneId).toBe(before.steps[1].laneId);
  expect(after.steps[1].routes).toEqual([{ ...before.steps[1].routes[0], targetId: inserted.id }]);
  expect(inserted.routes).toEqual([{ targetId: "second", label: "" }]);
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /İzah/ }).click();
  await expect(page.locator(".explanation-text")).toContainText("Yoxlandı");
  await expect(page.locator(".explanation-text")).toContainText(before.steps[1].routes[0].description!);
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  expect(await savedProject(page)).toEqual(before);
});

test("mobile insertion keeps the new form in view without opening the diagram inspector", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedProject(page);
  await openSteps(page);
  await page.getByRole("button", { name: "2-ci addımı aç", exact: true }).click();
  await page.getByRole("button", { name: "Bu addımdan sonra əlavə et", exact: true }).click();
  await expect(page.getByRole("button", { name: "3-ci addımı aç", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(page.locator(".canvas-inspector")).toHaveCount(0);
  const title = page.getByLabel("3-ci addımın adı", { exact: true });
  await expect(title).toBeVisible();
  await expect(title).toBeInViewport({ ratio: 1 });
  await title.fill("Yoxlamadan sonrakı addım");
  expect((await savedProject(page)).steps[2].title).toBe("Yoxlamadan sonrakı addım");
});

test("BFS renumbering handles a cycle and keeps disconnected tasks in their existing relative order", async ({ page }) => {
  const project = orderedProject();
  project.steps[1].routes = [{ targetId: "second", label: "Davam et" }, { targetId: "end", label: "Bitir" }];
  project.steps[2].routes = [{ targetId: "first", label: "Yenidən yoxla" }];
  const disconnected = [
    { id: "detached-a", laneId: "operator", type: "task" as const, title: "Ayrı iş A", description: "", routes: [] },
    { id: "detached-b", laneId: "operator", type: "task" as const, title: "Ayrı iş B", description: "", routes: [] },
  ];
  project.steps = [disconnected[0], project.steps[3], project.steps[2], project.steps[0], disconnected[1], project.steps[1]];
  await seedProject(page, project);
  await openSteps(page);
  await page.getByRole("button", { name: "Axın ardıcıllığı üzrə nömrələ", exact: true }).click();
  const after = await savedProject(page);
  expect(after.steps.map(step => step.id)).toEqual(["start", "first", "second", "end", "detached-a", "detached-b"]);
  expect(after.steps).toHaveLength(project.steps.length);
  for (const step of project.steps) expect(after.steps.find(item => item.id === step.id)!.routes).toEqual(step.routes);
  await expectExportsFollowStepOrder(page, after);
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  expect((await savedProject(page)).steps.map(step => step.id)).toEqual(project.steps.map(step => step.id));
});

async function openTemplatePicker(page: Page) {
  await page.getByRole("button", { name: "Layihə menyusu", exact: true }).click();
  await page.getByRole("button", { name: "Nümunə proses", exact: true }).click();
  const picker = page.getByRole("dialog");
  await expect(picker.getByRole("button", { name: "Nümunəni aç", exact: true })).toBeVisible();
  return picker;
}

for (const name of ["Təsdiq prosesi", "Sorğu-cavab", "İşə qəbul"]) {
  test(`${name} template creates a valid fresh draft and preserves the previous project at its hash`, async ({ page }) => {
    const previous = await seedProject(page);
    const previousHash = new URL(page.url()).hash;
    const picker = await openTemplatePicker(page);
    await picker.getByRole("radio", { name, exact: true }).check();
    await picker.getByRole("button", { name: "Nümunəni aç", exact: true }).click();
    await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
    const first = await savedProject(page);
    expect(first.name).toBe(name);
    expect(first.id).not.toBe(previous.id);
    expect(validateProject(first).filter(issue => issue.level === "error")).toEqual([]);
    const firstIds = new Set([first.id, ...first.pools.flatMap(pool => [pool.id, ...pool.lanes.map(lane => lane.id)]), ...first.steps.map(step => step.id)]);
    const repeatedPicker = await openTemplatePicker(page);
    await repeatedPicker.getByRole("radio", { name, exact: true }).check();
    await repeatedPicker.getByRole("button", { name: "Nümunəni aç", exact: true }).click();
    const second = await savedProject(page);
    for (const id of [second.id, ...second.pools.flatMap(pool => [pool.id, ...pool.lanes.map(lane => lane.id)]), ...second.steps.map(step => step.id)]) {
      expect(firstIds.has(id)).toBe(false);
    }
    await page.evaluate(hash => { window.location.hash = hash; }, previousHash);
    await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(previous.steps.length);
    expect(await savedProject(page)).toEqual(previous);
  });
}

test("opening a template asks before discarding a draft that browser storage cannot save", async ({ page }) => {
  await seedProject(page);
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /İştirakçılar/ }).click();
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); }; });
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Saxlanılmayan yeni iş");
  const originalHash = new URL(page.url()).hash;
  const picker = await openTemplatePicker(page);
  await picker.getByRole("radio", { name: "Təsdiq prosesi", exact: true }).check();
  await picker.getByRole("button", { name: "Nümunəni aç", exact: true }).click();
  const confirmation = page.getByRole("dialog", { name: "Dəyişikliklər saxlanılmayıb", exact: true });
  await expect(confirmation).toBeVisible();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Saxlanılmayan yeni iş");
  expect(new URL(page.url()).hash).toBe(originalHash);
  await confirmation.getByRole("button", { name: "Ləğv et", exact: true }).click();
  await expect(confirmation).not.toBeVisible();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Saxlanılmayan yeni iş");
});
