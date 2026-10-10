import { readFile } from "node:fs/promises";
import { expect, test, type Page, type Download } from "@playwright/test";
import JSZip from "jszip";
import { XMLValidator } from "fast-xml-parser";
import type { Project } from "../lib/types";

const STORAGE_PREFIX = "visioflow:v1:";

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Yüklə", exact: true })).toBeEnabled();
  await expect(page).toHaveURL(/#[a-zA-Z0-9_-]+$/);
}

async function savedProject(page: Page): Promise<Project> {
  await expect.poll(() => page.evaluate((prefix) => {
    const text = localStorage.getItem(prefix + window.location.hash.slice(1));
    return text ? JSON.parse(text) : null;
  }, STORAGE_PREFIX)).not.toBeNull();
  await expect(page.locator(".save-status")).toHaveText("Brauzerdə saxlanıldı");
  return page.evaluate((prefix) => JSON.parse(localStorage.getItem(prefix + window.location.hash.slice(1))!), STORAGE_PREFIX);
}

async function openSteps(page: Page) {
  await page.getByRole("navigation", { name: "Layihə bölmələri" }).getByRole("button", { name: /Proses addımları/ }).click();
}

async function openSample(page: Page) {
  await page.getByRole("button", { name: "Nümunə proses", exact: true }).click();
  const confirmation = page.getByRole("dialog");
  if (await confirmation.isVisible()) await confirmation.getByRole("button", { name: "Nümunəni aç", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Müştəri müraciətləri");
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(20);
}

async function exportDownload(page: Page, name: RegExp): Promise<Download> {
  await page.getByRole("button", { name: "Yüklə", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name }).click();
  return download;
}

async function downloadBytes(download: Download) {
  const path = await download.path();
  expect(path).not.toBeNull();
  expect(await download.failure()).toBeNull();
  return readFile(path!);
}

test("table editing builds a connected live flow and restores it after reload", async ({ page }) => {
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

  await openSteps(page);
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
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(4);
  await expect(page.locator(".editor-footer")).toContainText("4 element · 3 keçid");
  await expect(page.locator("#process-diagram path[stroke-dasharray='6 5']")).toHaveCount(2);

  const taskNode = page.locator("#process-diagram").getByRole("button", { name: "İstifadəçi tapşırığı: Sənədi təsdiqlə", exact: true });
  await taskNode.focus();
  await taskNode.press("Enter");
  await expect(page.locator(".selected-row input")).toHaveValue("Sənədi təsdiqlə");
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
  await expect(page.getByLabel("2-ci addımın adı", { exact: true })).toHaveValue("Sənədi yoxla");
  expect(page.url()).toBe(url);
  expect(await savedProject(page)).toEqual(before);
  await page.getByRole("button", { name: /İzah və yoxlama/ }).click();
  await expect(page.getByText("Struktur yoxlaması tamamlandı", { exact: true })).toBeVisible();
  await expect(page.locator(".explanation-text")).toContainText("Vizaçı sənədin məlumatlarını yoxlayıb təsdiqləyir.");
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
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Saxlanmış layihə");
  await savedProject(page);

  await page.getByRole("button", { name: "Hər şeyi sil", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Hər şeyi silmək istəyirsən?" })).toBeVisible();
  await page.getByRole("button", { name: "Ləğv et", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect((await savedProject(page)).id).toBe(original.id);
  await page.getByRole("button", { name: "Hər şeyi sil", exact: true }).click();
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

test("the example passes validation and downloads real VSDX, JSON and SVG files", async ({ page }) => {
  await openWorkspace(page);
  await openSample(page);
  const project = await savedProject(page);
  await page.getByRole("button", { name: /İzah və yoxlama/ }).click();
  await expect(page.getByText("Struktur yoxlaması tamamlandı", { exact: true })).toBeVisible();
  await expect(page.locator(".issue-list .error")).toHaveCount(0);
  await expect(page.locator(".explanation-text")).toContainText("İmtina");

  const vsdxDownload = await exportDownload(page, /Microsoft Visio/);
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

  const jsonDownload = await exportDownload(page, /Layihənin ehtiyat nüsxəsi/);
  expect(jsonDownload.suggestedFilename()).toMatch(/\.json$/);
  expect(JSON.parse((await downloadBytes(jsonDownload)).toString("utf8"))).toEqual(project);

  const svgDownload = await exportDownload(page, /Vektor diaqramı/);
  expect(svgDownload.suggestedFilename()).toMatch(/\.svg$/);
  const svg = (await downloadBytes(svgDownload)).toString("utf8");
  expect(XMLValidator.validate(svg)).toBe(true);
  expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
  expect(svg.match(/data-step-id=/g)).toHaveLength(20);
  expect(svg).toContain("Operator");
  expect(svg).not.toContain("<script");
});

test("invalid flows block diagram export while JSON backups remain available", async ({ page }) => {
  await openWorkspace(page);
  await openSteps(page);
  await page.getByRole("button", { name: "Başlanğıc əlavə et", exact: true }).click();
  const downloads: Download[] = [];
  page.on("download", (file) => downloads.push(file));
  await page.getByRole("button", { name: "Yüklə", exact: true }).click();
  await page.getByRole("button", { name: /Microsoft Visio/ }).click();
  await expect(page.getByRole("status")).toContainText("İxracdan əvvəl yoxlamadakı xətaları düzəlt.");
  await expect(page.locator(".validation-card.has-errors")).toBeVisible();
  expect(downloads).toHaveLength(0);
  const backup = await exportDownload(page, /Layihənin ehtiyat nüsxəsi/);
  expect(JSON.parse((await downloadBytes(backup)).toString("utf8")).steps).toHaveLength(1);
});

test("JSON imports create an independent draft and reject invalid files", async ({ page }) => {
  await openWorkspace(page);
  await openSample(page);
  const original = await savedProject(page);
  const imported: Project = { ...original, name: "İdxal edilmiş proses", steps: original.steps.map((step) => ({ ...step })) };
  const fileInput = page.getByLabel("JSON layihə faylı", { exact: true });
  await fileInput.setInputFiles({ name: "proses.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(imported)) });
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("İdxal edilmiş proses");
  const restored = await savedProject(page);
  expect(restored.id).not.toBe(original.id);
  expect(restored.steps).toEqual(imported.steps);
  expect(await page.evaluate((key) => localStorage.getItem(key), STORAGE_PREFIX + original.id)).not.toBeNull();

  await fileInput.setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from('{"version":99,"name":"invalid"}') });
  await expect(page.getByRole("status")).toContainText("Bu fayl etibarlı VisioFlow layihəsi deyil.");
  expect(await savedProject(page)).toEqual(restored);
  await fileInput.setInputFiles({ name: "too-large.json", mimeType: "application/json", buffer: Buffer.alloc(2_000_001, 32) });
  await expect(page.getByRole("status")).toContainText("Fayl maksimum 2 MB ola bilər.");
  expect(await savedProject(page)).toEqual(restored);
});

test("an unfinished route remains editable after autosave and reload", async ({ page }) => {
  await openWorkspace(page);
  await openSample(page);
  await page.getByRole("button", { name: "1-ci addımın keçidləri", exact: true }).click();
  await page.getByLabel("Keçid 1 hədəfi", { exact: true }).selectOption("");
  const draft = await savedProject(page);
  expect(draft.steps[0].routes[0].targetId).toBe("");
  const draftUrl = page.url();
  await page.reload();
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Müştəri müraciətləri");
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(20);
  expect(page.url()).toBe(draftUrl);
  expect(await savedProject(page)).toEqual(draft);
  await page.getByRole("button", { name: "1-ci addımın keçidləri", exact: true }).click();
  await expect(page.getByLabel("Keçid 1 hədəfi", { exact: true })).toHaveValue("");
  await page.getByRole("button", { name: /İzah və yoxlama/ }).click();
  await expect(page.locator(".validation-card.has-errors")).toBeVisible();
  await expect(page.locator(".issue-list .error")).toContainText("keçidin hədəfi mövcud deyil.");
  await openSteps(page);
  await page.getByRole("button", { name: "1-ci addımın keçidləri", exact: true }).click();
  await page.getByLabel("Keçid 1 hədəfi", { exact: true }).selectOption({ label: "2. Əsas məlumatları doldur" });
  await page.getByRole("button", { name: /İzah və yoxlama/ }).click();
  await expect(page.getByText("Struktur yoxlaması tamamlandı", { exact: true })).toBeVisible();
});

test.describe("mobile layout", () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test("the page stays within its viewport while the diagram scrolls independently", async ({ page }, testInfo) => {
    await openWorkspace(page);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.getByRole("button", { name: "Kömək", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Cədvəldən Visio diaqramına", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Aydındır", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.getByRole("button", { name: "Nümunə aç", exact: true }).click();
    await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(20);
    const sample = await savedProject(page);
    const fileChooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "JSON layihəsini aç", exact: true }).click();
    await (await fileChooser).setFiles({ name: "mobile.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...sample, name: "Mobil layihə" })) });
    await expect(page.getByLabel("Prosesin adı")).toHaveValue("Mobil layihə");
    expect((await savedProject(page)).id).not.toBe(sample.id);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const viewport = page.locator(".diagram-viewport");
    expect(await viewport.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
    await page.getByRole("button", { name: "Bütün diaqramı ekrana sığdır", exact: true }).click();
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath("mobile-workspace.png"), fullPage: true });
  });
});
