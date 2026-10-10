import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_PROJECT } from "../lib/process";

async function openWorkspace(page: Page) {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Yüklə", exact: true })).toBeEnabled();
}

test("unsaved work survives project switches when browser storage is full", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı").fill("Saxlanılmayan iş");
  await expect(page.locator(".save-status")).toHaveText("Yaddaş əlçatan deyil");
  const originalUrl = page.url();
  await page.getByRole("button", { name: "Yeni diaqram", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Dəyişikliklər saxlanılmayıb", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Saxlanılmayan iş");
  expect(page.url()).toBe(originalUrl);
  const downloadPromise = page.waitForEvent("download");
  await dialog.getByRole("button", { name: "JSON ehtiyat nüsxəsi", exact: true }).click();
  const download = await downloadPromise;
  expect(JSON.parse(await readFile((await download.path())!, "utf8")).name).toBe("Saxlanılmayan iş");
  await dialog.getByRole("button", { name: "Ləğv et", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Saxlanılmayan iş");
  await page.getByRole("button", { name: "Yeni diaqram", exact: true }).click();
  await dialog.getByRole("button", { name: "Saxlamadan davam et", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Yeni iş axını");
  expect(page.url()).not.toBe(originalUrl);
});

test("failed local deletion preserves the current project", async ({ page }) => {
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı").fill("Silinməyən layihə");
  await expect(page.locator(".save-status")).toHaveText("Brauzerdə saxlanıldı");
  const originalUrl = page.url();
  await page.evaluate(() => { Storage.prototype.removeItem = () => { throw new DOMException("Blocked", "SecurityError"); }; });
  await page.getByRole("button", { name: "Hər şeyi sil", exact: true }).click();
  await page.getByRole("button", { name: "Bəli, hər şeyi sil", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Brauzer yerli yaddaşın silinməsinə icazə vermədi.");
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Silinməyən layihə");
  expect(page.url()).toBe(originalUrl);
  await page.reload();
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Silinməyən layihə");
});

test("a delayed import cannot overwrite edits made while the file is reading", async ({ page }) => {
  await openWorkspace(page);
  await page.evaluate(() => {
    const read = File.prototype.text;
    (window as unknown as { finishImport: () => void }).finishImport = () => {};
    File.prototype.text = async function () {
      await new Promise<void>((resolve) => { (window as unknown as { finishImport: () => void }).finishImport = resolve; });
      return read.call(this);
    };
  });
  await page.getByLabel("JSON layihə faylı", { exact: true }).setInputFiles({
    name: "delayed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(SAMPLE_PROJECT)),
  });
  await page.getByLabel("Prosesin adı").fill("Son dəyişiklik");
  const editedUrl = page.url();
  await page.evaluate(() => { (window as unknown as { finishImport: () => void }).finishImport(); });
  await expect(page.getByRole("status")).toContainText("Fayl oxunarkən layihə dəyişdi.");
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Son dəyişiklik");
  expect(page.url()).toBe(editedUrl);
});

test("the most recently selected file wins when imports finish out of order", async ({ page }) => {
  await openWorkspace(page);
  await page.evaluate(() => {
    const read = File.prototype.text;
    File.prototype.text = async function () {
      if (this.name === "first.json") await new Promise<void>((resolve) => {
        (window as unknown as { finishFirstImport: () => void }).finishFirstImport = resolve;
      });
      return read.call(this);
    };
  });
  const input = page.getByLabel("JSON layihə faylı", { exact: true });
  await input.setInputFiles({ name: "first.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...SAMPLE_PROJECT, name: "Birinci fayl" })) });
  await input.setInputFiles({ name: "second.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({ ...SAMPLE_PROJECT, name: "İkinci fayl" })) });
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("İkinci fayl");
  const importedUrl = page.url();
  await page.evaluate(async () => {
    (window as unknown as { finishFirstImport: () => void }).finishFirstImport();
    await new Promise((resolve) => setTimeout(resolve, 100));
  });
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("İkinci fayl");
  expect(page.url()).toBe(importedUrl);
});

test("imported participants are protected when their first autosave fails", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await openWorkspace(page);
  const draft = { ...SAMPLE_PROJECT, name: "Yeni iş axını", steps: [], pools: [{ id: "bank", name: "Bank", lanes: [{ id: "operator", name: "Operator" }] }] };
  await page.getByLabel("JSON layihə faylı", { exact: true }).setInputFiles({
    name: "participants.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(draft)),
  });
  await expect(page.getByLabel("Pool 1 adı", { exact: true })).toHaveValue("Bank");
  await page.getByRole("button", { name: "Yeni diaqram", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Dəyişikliklər saxlanılmayıb", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Ləğv et", exact: true }).click();
  await expect(page.getByLabel("Pool 1 icraçı 1", { exact: true })).toHaveValue("Operator");
});

test("a pending import cannot change the target of an unsaved-work confirmation", async ({ page }) => {
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı").fill("Hazırkı iş");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
    const read = File.prototype.text;
    File.prototype.text = async function () {
      await new Promise<void>((resolve) => { (window as unknown as { finishImport: () => void }).finishImport = resolve; });
      return read.call(this);
    };
  });
  await page.getByLabel("Prosesin adı").fill("Saxlanılmamış iş");
  await page.getByLabel("JSON layihə faylı", { exact: true }).setInputFiles({
    name: "delayed.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(SAMPLE_PROJECT)),
  });
  await page.getByRole("button", { name: "Yeni diaqram", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Dəyişikliklər saxlanılmayıb", exact: true });
  await expect(dialog).toBeVisible();
  await page.evaluate(() => { (window as unknown as { finishImport: () => void }).finishImport(); });
  await expect(page.getByRole("status")).toContainText("Fayl oxunarkən layihə dəyişdi.");
  await dialog.getByRole("button", { name: "Saxlamadan davam et", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı")).toHaveValue("Yeni iş axını");
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(0);
});

test("editing an imported step cannot exceed the restorable route limit", async ({ page }) => {
  await openWorkspace(page);
  const draft = structuredClone(SAMPLE_PROJECT);
  draft.steps[0].routes = Array.from({ length: 200 }, () => ({ targetId: draft.steps[1].id, label: "" }));
  await page.getByLabel("JSON layihə faylı", { exact: true }).setInputFiles({
    name: "many-routes.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(draft)),
  });
  await expect(page.getByLabel("Prosesin adı")).toHaveValue(draft.name);
  await page.getByRole("button", { name: "1-ci addımın keçidləri", exact: true }).click();
  await expect(page.getByRole("button", { name: "Keçid əlavə et", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Keçid 200 sil", exact: true }).click();
  await page.getByRole("button", { name: "Keçid əlavə et", exact: true }).click();
  await expect(page.getByRole("button", { name: "Keçid əlavə et", exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel("Prosesin adı")).toHaveValue(draft.name);
  const routes = await page.evaluate(() => JSON.parse(localStorage.getItem("visioflow:v1:" + location.hash.slice(1))!).steps[0].routes);
  expect(routes).toHaveLength(200);
  expect(routes[199].targetId).not.toBe(draft.steps[1].id);
});
