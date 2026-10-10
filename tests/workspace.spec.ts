import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { EXPLANATION_HEADERS, explanationRows } from "../lib/docx";
import type { Project } from "../lib/types";

const STORAGE_PREFIX = "visioflow:v1:";

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Visio üçün yüklə", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/#[a-zA-Z0-9_-]+$/);
}

async function savedProject(page: Page): Promise<Project> {
  await expect(page.locator(".save-status")).toHaveText("Saxlanıldı");
  return page.evaluate((prefix) => JSON.parse(localStorage.getItem(prefix + window.location.hash.slice(1))!), STORAGE_PREFIX);
}

async function openSection(page: Page, name: "İştirakçılar" | "Addımlar" | "İzah") {
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: new RegExp(name) }).click();
}

async function openStep(page: Page, index: number) {
  await openSection(page, "Addımlar");
  const summary = page.getByRole("button", { name: `${index}-ci addımı aç`, exact: true });
  if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
  await expect(page.getByLabel(`${index}-ci addımın adı`, { exact: true })).toBeVisible();
}

async function openSample(page: Page) {
  await page.getByRole("button", { name: "Nümunə proses", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  if (await confirmation.isVisible()) await confirmation.getByRole("button", { name: "Nümunəni aç", exact: true }).click();
  await openSection(page, "İştirakçılar");
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Müştəri müraciətləri");
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(20);
}

async function resetDialog(page: Page) {
  await page.getByRole("button", { name: "Layihə menyusu", exact: true }).click();
  await page.getByRole("button", { name: "Hər şeyi sil", exact: true }).click();
}

async function downloadBytes(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await download.failure()).toBeNull();
  return readFile(path!);
}

async function seedProject(page: Page, project: Project) {
  await page.addInitScript(({ prefix, saved }) => {
    localStorage.setItem(prefix + saved.id, JSON.stringify(saved));
  }, { prefix: STORAGE_PREFIX, saved: project });
  await page.goto(`/#${project.id}`);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(project.steps.length);
  expect((await savedProject(page)).name).toBe(project.name);
}

function longProject(count = 200): Project {
  return {
    version: 1, id: "large-project", name: "Uzun iş axını",
    pools: [{ id: "large-pool", name: "Təşkilat", lanes: [{ id: "large-lane", name: "Operator" }] }],
    steps: Array.from({ length: count }, (_, index) => ({
      id: `large-step-${index}`, laneId: "large-lane", type: index === 0 ? "start" : index === count - 1 ? "end" : "task",
      title: `Addım ${index + 1}`, description: "", routes: index === count - 1 ? [] : [{ targetId: `large-step-${index + 1}`, label: "" }],
    })),
  };
}

test("the dark workspace presents a form beside a large canvas without JSON controls", async ({ page }, testInfo) => {
  await openWorkspace(page);
  await expect(page.getByRole("navigation", { name: "Proses forması" }).getByRole("button")).toHaveCount(3);
  await expect(page.locator("input[type='file']")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /JSON/i })).toHaveCount(0);
  await expect(page.locator(".form-panel table")).toHaveCount(0);
  const form = await page.getByRole("navigation", { name: "Proses forması" }).boundingBox();
  const canvas = await page.locator(".diagram-viewport").boundingBox();
  expect(canvas!.x).toBeGreaterThan(form!.x + form!.width - 1);
  expect(canvas!.width).toBeGreaterThan(form!.width);
  expect(canvas!.height).toBeGreaterThan(650);
  expect(await page.evaluate(() => {
    const colors = getComputedStyle(document.body).backgroundColor.match(/\d+/g)!.slice(0, 3).map(Number);
    return colors.every((value) => value < 60);
  })).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("dark-form-workspace.png"), fullPage: true });
});

test("form editing builds a connected live flow and restores every field after reload", async ({ page }) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await openWorkspace(page);
  await expect(page.getByLabel("Pool sayı", { exact: true })).toHaveValue("1");
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(0);
  await page.getByLabel("Prosesin adı").fill("Sənəd təsdiqi");
  await page.getByLabel("Pool 1 icraçı 1", { exact: true }).fill("Operator");
  await page.getByRole("button", { name: "İcraçı əlavə et", exact: true }).click();
  await page.getByLabel("Pool 1 icraçı 2", { exact: true }).fill("Vizaçı");
  await page.getByRole("button", { name: "Pool sayını artır", exact: true }).click();
  await page.getByLabel("Pool 2 adı", { exact: true }).fill("Tərəfdaş");
  await page.getByLabel("Pool 2 icraçı 1", { exact: true }).fill("Bank");
  await expect(page.getByLabel("Pool sayı", { exact: true })).toHaveValue("2");
  await expect(page.locator("#process-diagram")).toContainText("Vizaçı");
  await openSection(page, "Addımlar");
  await page.getByRole("button", { name: "Başlanğıc əlavə et", exact: true }).click();
  await page.getByRole("button", { name: "Addım əlavə et", exact: true }).click();
  await page.getByLabel("2-ci addımın adı", { exact: true }).fill("Sənədi təsdiqlə");
  await page.getByLabel("2-ci addımın növü", { exact: true }).selectOption("userTask");
  await page.getByLabel("2-ci addımın icraçısı", { exact: true }).selectOption({ label: "Təşkilat / Vizaçı" });
  await page.getByLabel("Addımın təsviri", { exact: true }).fill("Vizaçı sənədin məlumatlarını yoxlayıb təsdiqləyir.");
  await page.getByRole("button", { name: "Addım əlavə et", exact: true }).click();
  await page.getByLabel("3-ci addımın adı", { exact: true }).fill("Cavabı göndər");
  await page.getByLabel("3-ci addımın növü", { exact: true }).selectOption("serviceTask");
  await page.getByLabel("3-ci addımın icraçısı", { exact: true }).selectOption({ label: "Tərəfdaş / Bank" });
  await page.getByRole("button", { name: "Son hadisəsi", exact: true }).click();
  await expect(page.locator(".step-card")).toHaveCount(4);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(4);
  await expect(page.getByLabel("4-ci addımın icraçısı", { exact: true }).locator("option:checked")).toHaveText("Tərəfdaş / Bank");
  await expect(page.locator("#process-diagram path[stroke-dasharray='6 5']")).toHaveCount(1);
  const taskNode = page.locator("#process-diagram").getByRole("button", { name: "İstifadəçi tapşırığı: Sənədi təsdiqlə", exact: true });
  await taskNode.focus();
  await taskNode.press("Enter");
  await expect(page.getByLabel("2-ci addımın adı", { exact: true })).toHaveValue("Sənədi təsdiqlə");
  await expect(page.getByLabel("Keçid 1 hədəfi", { exact: true }).locator("option:checked")).toHaveText("3. Cavabı göndər");
  await page.getByLabel("2-ci addımın adı", { exact: true }).fill("Sənədi yoxla");
  await expect(page.locator("#process-diagram").getByRole("button", { name: "İstifadəçi tapşırığı: Sənədi yoxla", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Keçid 1 şərti", { exact: true }).fill("Təsdiq");
  await expect(page.locator("#process-diagram")).toContainText("Təsdiq");
  const before = await savedProject(page);
  expect(before.steps[0].routes[0].targetId).toBe(before.steps[1].id);
  expect(before.steps[1].routes[0]).toEqual({ targetId: before.steps[2].id, label: "Təsdiq" });
  const url = page.url();
  await page.reload();
  await openSection(page, "İştirakçılar");
  await expect(page.getByLabel("Prosesin adı")).toHaveValue(before.name);
  await openStep(page, 2);
  await expect(page.getByLabel("2-ci addımın adı", { exact: true })).toHaveValue("Sənədi yoxla");
  await expect(page.getByLabel("Addımın təsviri", { exact: true })).toHaveValue(before.steps[1].description);
  expect(page.url()).toBe(url);
  expect(await savedProject(page)).toEqual(before);
  await openSection(page, "İzah");
  await expect(page.getByText("Struktur yoxlaması tamamlandı", { exact: true })).toBeVisible();
  await expect(page.locator(".explanation-text")).toContainText(before.steps[1].description);
  expect(pageErrors).toEqual([]);
});

test("clearing the hash starts a blank project and reset requires confirmation", async ({ page }) => {
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı").fill("Saxlanmış layihə");
  const original = await savedProject(page);
  await page.evaluate(() => { localStorage.setItem("unrelated-app-data", "preserve-me"); window.location.hash = ""; });
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Yeni iş axını");
  const blank = await savedProject(page);
  expect(blank.id).not.toBe(original.id);
  expect(blank.steps).toHaveLength(0);
  await page.evaluate((id) => { window.location.hash = id; }, original.id);
  await expect(page.getByLabel("Prosesin adı")).toHaveValue(original.name);
  await resetDialog(page);
  await expect(page.getByRole("dialog", { name: "Hər şeyi silmək istəyirsən?" })).toBeVisible();
  await page.getByRole("button", { name: "Ləğv et", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await savedProject(page)).id).toBe(original.id);
  await resetDialog(page);
  await page.getByRole("button", { name: "Bəli, hər şeyi sil", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Yeni iş axını");
  const after = await savedProject(page);
  const storage = await page.evaluate((prefix) => ({
    keys: Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
    unrelated: localStorage.getItem("unrelated-app-data"),
  }), STORAGE_PREFIX);
  expect(storage.keys).toEqual([STORAGE_PREFIX + after.id]);
  expect(storage.unrelated).toBe("preserve-me");
  expect(after.steps).toHaveLength(0);
});

test("the example downloads editable native Visio shapes and the process explanation", async ({ page }) => {
  await openWorkspace(page);
  await openSample(page);
  await openSection(page, "İzah");
  await expect(page.getByText("Struktur yoxlaması tamamlandı", { exact: true })).toBeVisible();
  await expect(page.locator(".issue-list .error")).toHaveCount(0);
  await expect(page.locator(".explanation-text")).toContainText("İmtina");
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Visio üçün yüklə", exact: true }).click();
  const vsdxDownload = await download;
  expect(vsdxDownload.suggestedFilename()).toMatch(/\.vsdx$/);
  const vsdx = await downloadBytes(vsdxDownload);
  expect(vsdx.subarray(0, 2).toString()).toBe("PK");
  const zip = await JSZip.loadAsync(vsdx, { checkCRC32: true });
  expect(zip.file("[Content_Types].xml")).not.toBeNull();
  expect(zip.file("visio/document.xml")).not.toBeNull();
  const pageXml = await zip.file("visio/pages/page1.xml")!.async("string");
  expect(XMLValidator.validate(pageXml)).toBe(true);
  expect(pageXml).toContain("Əsas məlumatları doldur");
  expect(pageXml).toContain("<Connects>");
  expect(pageXml.match(/<Row N="ProjectStepId">/g)).toHaveLength(20);
  const wordDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: "Word cədvəli yüklə", exact: true }).click();
  const word = await wordDownload;
  expect(word.suggestedFilename()).toMatch(/\.docx$/);
  const docx = await JSZip.loadAsync(await downloadBytes(word), { checkCRC32: true });
  const documentXml = await docx.file("word/document.xml")!.async("string");
  expect(XMLValidator.validate(documentXml)).toBe(true);
  const document = new XMLParser({ ignoreAttributes: false, isArray: (name) => ["w:tr", "w:tc"].includes(name) }).parse(documentXml);
  const rows = document["w:document"]["w:body"]["w:tbl"]["w:tr"];
  const expectedRows = explanationRows(await savedProject(page));
  expect(rows).toHaveLength(expectedRows.length + 1);
  expect(rows.every((row: Record<string, unknown[]>) => row["w:tc"].length === 3)).toBe(true);
  for (const heading of EXPLANATION_HEADERS) expect(documentXml).toContain(heading);
  for (const row of expectedRows) expect(documentXml).toContain(row.number);
  expect(documentXml).toContain("İmtina");
  expect(documentXml).toContain("Operator");
  await expect(page.locator(".explanation-text tbody tr")).toHaveCount(expectedRows.length);
});

test("invalid flows open the review section and block Visio export", async ({ page }) => {
  await openWorkspace(page);
  await openSection(page, "Addımlar");
  await page.getByRole("button", { name: "Başlanğıc əlavə et", exact: true }).click();
  const downloads: Download[] = [];
  page.on("download", (file) => downloads.push(file));
  await page.getByRole("button", { name: "Visio üçün yüklə", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Visio faylını yükləmək üçün göstərilən xətaları düzəlt.");
  await expect(page.locator(".validation-card.has-errors")).toBeVisible();
  expect(downloads).toHaveLength(0);
  expect((await savedProject(page)).steps).toHaveLength(1);
});

test("unfinished routes survive autosave and become valid after choosing their target", async ({ page }) => {
  await openWorkspace(page);
  await openSample(page);
  await openStep(page, 1);
  await page.getByLabel("Keçid 1 hədəfi", { exact: true }).selectOption("");
  const draft = await savedProject(page);
  expect(draft.steps[0].routes[0].targetId).toBe("");
  const draftUrl = page.url();
  await page.reload();
  await openSection(page, "İştirakçılar");
  await expect(page.getByLabel("Prosesin adı")).toHaveValue(draft.name);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(20);
  expect(page.url()).toBe(draftUrl);
  expect(await savedProject(page)).toEqual(draft);
  await openStep(page, 1);
  await expect(page.getByLabel("Keçid 1 hədəfi", { exact: true })).toHaveValue("");
  await openSection(page, "İzah");
  await expect(page.locator(".validation-card.has-errors")).toBeVisible();
  await expect(page.locator(".issue-list .error")).toContainText("keçidin hədəfi mövcud deyil.");
  await openStep(page, 1);
  await page.getByLabel("Keçid 1 hədəfi", { exact: true }).selectOption({ label: "2. Əsas məlumatları doldur" });
  await openSection(page, "İzah");
  await expect(page.getByText("Struktur yoxlaması tamamlandı", { exact: true })).toBeVisible();
});

test("lanes and pools containing steps are protected until the steps move", async ({ page }) => {
  await openWorkspace(page);
  await page.getByLabel("Pool 1 icraçı 1", { exact: true }).fill("Operator");
  await page.getByRole("button", { name: "İcraçı əlavə et", exact: true }).click();
  await page.getByLabel("Pool 1 icraçı 2", { exact: true }).fill("Vizaçı");
  await page.getByRole("button", { name: "Pool sayını artır", exact: true }).click();
  await page.getByLabel("Pool 2 adı", { exact: true }).fill("Bank");
  await openSection(page, "Addımlar");
  await page.getByRole("button", { name: "Başlanğıc əlavə et", exact: true }).click();
  await openSection(page, "İştirakçılar");
  await page.getByRole("button", { name: "Operator icraçısını sil", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Əvvəl bu icraçının addımlarını başqa icraçıya keçir.");
  await expect(page.getByLabel("Pool 1 icraçı 1", { exact: true })).toHaveValue("Operator");
  await openStep(page, 1);
  await page.getByLabel("1-ci addımın icraçısı", { exact: true }).selectOption({ label: "Bank / İcraçı" });
  await openSection(page, "İştirakçılar");
  await page.getByRole("button", { name: "Pool sayını azalt", exact: true }).click();
  await expect(page.getByLabel("Pool sayı", { exact: true })).toHaveValue("2");
  await expect(page.locator(".toast")).toContainText("pool-dakı addımların icraçısını dəyiş");
  await openStep(page, 1);
  await page.getByLabel("1-ci addımın icraçısı", { exact: true }).selectOption({ label: "Təşkilat / Vizaçı" });
  await openSection(page, "İştirakçılar");
  await page.getByRole("button", { name: "Operator icraçısını sil", exact: true }).click();
  await expect(page.getByLabel("Pool 1 icraçı 1", { exact: true })).toHaveValue("Vizaçı");
  await page.getByRole("button", { name: "Pool sayını azalt", exact: true }).click();
  await expect(page.getByLabel("Pool sayı", { exact: true })).toHaveValue("1");
  expect((await savedProject(page)).steps).toHaveLength(1);
});

test("undo restores deleted steps and their incoming connections", async ({ page }) => {
  await openWorkspace(page);
  await openSection(page, "Addımlar");
  await page.getByRole("button", { name: "Başlanğıc əlavə et", exact: true }).click();
  await page.getByRole("button", { name: "Addım əlavə et", exact: true }).click();
  await page.getByRole("button", { name: "Son hadisəsi", exact: true }).click();
  const before = await savedProject(page);
  await openStep(page, 2);
  await page.getByRole("button", { name: "2-ci addımı sil", exact: true }).click();
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(2);
  expect((await savedProject(page)).steps[0].routes).toHaveLength(0);
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(3);
  expect(await savedProject(page)).toEqual(before);
});

test("selecting a diagram element opens its form and deliberate zooming preserves the pan position", async ({ page }) => {
  await openWorkspace(page);
  await openSample(page);
  const node = page.locator("#process-diagram").getByRole("button", { name: "Son: İcra olunub", exact: true });
  await node.focus();
  await node.press("Space");
  await expect(node).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByLabel("20-ci addımın adı", { exact: true })).toHaveValue("İcra olunub");
  await expect(node).toBeInViewport({ ratio: 1 });
  const viewport = page.locator(".diagram-viewport");
  await viewport.evaluate((element) => { element.scrollLeft = 0; element.scrollTop = 0; });
  await page.getByRole("button", { name: "Diaqramı böyüt", exact: true }).click();
  await expect.poll(() => viewport.evaluate((element) => element.scrollLeft < element.scrollWidth / 2 && element.scrollTop < element.scrollHeight / 2)).toBe(true);
  await expect(node).toHaveAttribute("aria-pressed", "true");
});

test("full-screen mode expands the diagram and exits without changing the saved process", async ({ page }) => {
  await openWorkspace(page);
  await openSample(page);
  const before = await savedProject(page);
  const initialHeight = (await page.locator(".diagram-viewport").boundingBox())!.height;
  await page.getByRole("button", { name: "Diaqramı tam ekranda aç", exact: true }).click();
  await expect(page.getByRole("button", { name: "Tam ekrandan çıx", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("diagram-panel") || !!document.querySelector(".diagram-fullscreen"))).toBe(true);
  expect((await page.locator(".diagram-viewport").boundingBox())!.height).toBeGreaterThan(initialHeight);
  await page.getByRole("button", { name: "Tam ekrandan çıx", exact: true }).click();
  await expect(page.getByRole("button", { name: "Diaqramı tam ekranda aç", exact: true })).toBeVisible();
  expect(await savedProject(page)).toEqual(before);
});

test.describe("mobile form and canvas", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the sample fits by default and the page never scrolls horizontally", async ({ page }, testInfo) => {
    await openWorkspace(page);
    await openSample(page);
    const viewport = page.locator(".diagram-viewport");
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect.poll(() => viewport.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await openStep(page, 2);
    await page.getByLabel("2-ci addımın adı", { exact: true }).fill("Mobil formda dəyişiklik");
    const saved = await savedProject(page);
    await page.reload();
    await openSection(page, "İştirakçılar");
    await expect(page.getByLabel("Prosesin adı")).toHaveValue(saved.name);
    expect(await savedProject(page)).toEqual(saved);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("mobile-form-workspace.png"), fullPage: true });
  });

  test("the maximum-size saved flow fits and supports keyboard and pointer panning", async ({ page }) => {
    await seedProject(page, longProject());
    const viewport = page.locator(".diagram-viewport");
    await expect.poll(() => viewport.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await page.setViewportSize({ width: 360, height: 740 });
    await expect.poll(() => viewport.evaluate((element) => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    await page.getByRole("button", { name: "Diaqramı böyüt", exact: true }).click();
    await viewport.scrollIntoViewIfNeeded();
    await viewport.focus();
    await expect(viewport).toBeFocused();
    const beforeKeyboard = await viewport.evaluate((element) => element.scrollLeft);
    await viewport.press("ArrowRight");
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(beforeKeyboard);
    const area = await viewport.boundingBox();
    const beforeDrag = await viewport.evaluate((element) => element.scrollLeft);
    await page.mouse.move(area!.x + 140, area!.y + 10);
    await page.mouse.down();
    await page.mouse.move(area!.x + 40, area!.y + 10, { steps: 5 });
    await page.mouse.up();
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft)).toBeGreaterThan(beforeDrag + 50);
    await expect(viewport).toHaveCSS("cursor", "grab");
    await page.getByRole("button", { name: "Bütün diaqramı ekrana sığdır", exact: true }).click();
    await expect.poll(() => viewport.evaluate((element) => element.scrollLeft === 0 && element.scrollTop === 0 && element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });
});
