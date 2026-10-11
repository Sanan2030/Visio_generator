import { expect, test, type Page } from "@playwright/test";
import { SAMPLE_PROJECT } from "../lib/process";

async function projectAction(page: Page, name: "Yeni diaqram" | "Nümunə proses") {
  const action = page.getByRole("button", { name, exact: true });
  if (!await action.isVisible()) await page.getByRole("button", { name: "Layihə menyusu", exact: true }).click();
  await action.click();
}

async function openWorkspace(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.locator(".save-status")).toHaveText(/^(Saxlanılıb|Yaddaş əlçatan deyil)$/);
  await page.locator(".form-tabs").getByRole("button", { name: /İştirakçılar/ }).click();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toBeVisible();
}

async function openReset(page: Page) {
  await page.getByRole("button", { name: "Layihə menyusu", exact: true }).click();
  await page.getByRole("button", { name: "Hər şeyi sil", exact: true }).click();
}

async function unloadIsBlocked(page: Page) {
  return page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
}

test("the workspace has no JSON upload, download or recovery controls", async ({ page }) => {
  await openWorkspace(page);
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(/JSON/i);
  await page.getByRole("button", { name: "Layihə menyusu", exact: true }).click();
  await expect(page.locator("body")).not.toContainText(/JSON/i);
  await expect(page.getByRole("button", { name: "Visio üçün yüklə", exact: true })).toBeVisible();
});

test("an edit persists before an immediate same-event reload", async ({ page }) => {
  await openWorkspace(page);
  const originalHash = new URL(page.url()).hash;
  await Promise.all([
    page.waitForEvent("framenavigated", { predicate: frame => frame === page.mainFrame() }),
    page.evaluate(() => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="Prosesin adı"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Son anda yazılmış iş");
      input.dispatchEvent(new Event("input", { bubbles: true }));
      window.location.reload();
    }),
  ]);
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Son anda yazılmış iş");
  expect(new URL(page.url()).hash).toBe(originalHash);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
});

test("old version-one drafts restore at their existing hash without an import flow", async ({ page }) => {
  const draft = { ...SAMPLE_PROJECT, id: "existing-draft", name: "Əvvəlki layihəm" };
  await page.addInitScript(project => {
    localStorage.setItem("visioflow:v1:" + project.id, JSON.stringify(project));
  }, draft);
  await openWorkspace(page, "/#existing-draft");
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue(draft.name);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(draft.steps.length);
  expect(new URL(page.url()).hash).toBe("#existing-draft");
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
});

test("hash navigation restores earlier drafts and clearing it creates a separate blank draft", async ({ page }) => {
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Birinci layihə");
  const firstHash = new URL(page.url()).hash;
  await projectAction(page, "Yeni diaqram");
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Yeni iş axını");
  const secondHash = new URL(page.url()).hash;
  expect(secondHash).not.toBe(firstHash);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("İkinci layihə");
  await page.evaluate(hash => { window.location.hash = hash; }, firstHash);
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Birinci layihə");
  await page.evaluate(() => { window.location.hash = ""; });
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Yeni iş axını");
  const thirdHash = new URL(page.url()).hash;
  expect(thirdHash).not.toBe(firstHash);
  expect(thirdHash).not.toBe(secondHash);
  const drafts = await page.evaluate(hashes => hashes.map(hash => JSON.parse(localStorage.getItem("visioflow:v1:" + hash.slice(1))!).name), [firstHash, secondHash]);
  expect(drafts).toEqual(["Birinci layihə", "İkinci layihə"]);
  await page.reload();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Yeni iş axını");
  expect(new URL(page.url()).hash).toBe(thirdHash);
});

test("reset removes only app drafts and preserves unrelated browser storage", async ({ page }) => {
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Silinəcək layihə");
  const previousHash = new URL(page.url()).hash;
  await page.evaluate(() => { localStorage.setItem("other-app:preference", "keep"); });
  await openReset(page);
  await page.getByRole("button", { name: "Ləğv et", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Silinəcək layihə");
  await openReset(page);
  await page.getByRole("button", { name: "Bəli, hər şeyi sil", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Yeni iş axını");
  expect(new URL(page.url()).hash).not.toBe(previousHash);
  const storage = await page.evaluate(() => ({
    other: localStorage.getItem("other-app:preference"),
    drafts: Object.keys(localStorage).filter(key => key.startsWith("visioflow:v1:")),
  }));
  expect(storage.other).toBe("keep");
  expect(storage.drafts).toHaveLength(1);
  await page.reload();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Yeni iş axını");
});

test("failed reset preserves the current draft, hash and saved content", async ({ page }) => {
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Silinməyən layihə");
  const originalUrl = page.url();
  await page.evaluate(() => { Storage.prototype.removeItem = () => { throw new DOMException("Blocked", "SecurityError"); }; });
  await openReset(page);
  await page.getByRole("button", { name: "Bəli, hər şeyi sil", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Hazırkı layihə açıq saxlanıldı.");
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Silinməyən layihə");
  expect(page.url()).toBe(originalUrl);
  await page.reload();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Silinməyən layihə");
});

test("failed reset and writes do not warn on unload when the saved snapshot still exists", async ({ page }) => {
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Yaddaşda qalan layihə");
  await page.evaluate(() => {
    Storage.prototype.removeItem = () => { throw new DOMException("Blocked", "SecurityError"); };
    Storage.prototype.setItem = () => { throw new DOMException("Blocked", "SecurityError"); };
  });
  await openReset(page);
  await page.getByRole("button", { name: "Bəli, hər şeyi sil", exact: true }).click();
  await expect(page.locator(".toast")).toContainText("Hazırkı layihə açıq saxlanıldı.");
  expect(await unloadIsBlocked(page)).toBe(false);
  const name = await page.evaluate(() => JSON.parse(localStorage.getItem("visioflow:v1:" + location.hash.slice(1))!).name);
  expect(name).toBe("Yaddaşda qalan layihə");
});

test("unsaved work survives blocked-storage project switches until explicit discard", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await openWorkspace(page);
  expect(await unloadIsBlocked(page)).toBe(false);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Saxlanılmayan iş");
  await expect(page.locator(".save-status")).toHaveText("Yaddaş əlçatan deyil");
  expect(await unloadIsBlocked(page)).toBe(true);
  const originalUrl = page.url();
  await projectAction(page, "Yeni diaqram");
  const dialog = page.getByRole("dialog", { name: "Dəyişikliklər saxlanılmayıb", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText(/JSON/i);
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Saxlanılmayan iş");
  expect(page.url()).toBe(originalUrl);
  await dialog.getByRole("button", { name: "Ləğv et", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Saxlanılmayan iş");
  await projectAction(page, "Yeni diaqram");
  await dialog.getByRole("button", { name: "Saxlamadan davam et", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Yeni iş axını");
  expect(page.url()).not.toBe(originalUrl);
  expect(await unloadIsBlocked(page)).toBe(false);
});

test("a storage retry saves the current draft before switching once storage becomes available", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    (window as unknown as { enableStorage: () => void }).enableStorage = () => { Storage.prototype.setItem = original; };
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Sonradan saxlanılan iş");
  const originalHash = new URL(page.url()).hash;
  await page.evaluate(() => { (window as unknown as { enableStorage: () => void }).enableStorage(); });
  await projectAction(page, "Yeni diaqram");
  await expect(page.getByRole("dialog", { name: "Dəyişikliklər saxlanılmayıb", exact: true })).toHaveCount(0);
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Yeni iş axını");
  await page.evaluate(hash => { window.location.hash = hash; }, originalHash);
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Sonradan saxlanılan iş");
  expect(await unloadIsBlocked(page)).toBe(false);
});

test("undoing a failed save back to the stored snapshot clears the unload warning", async ({ page }) => {
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Əvvəl saxlanılmış iş");
  await page.evaluate(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Yaddaşda olmayan dəyişiklik");
  expect(await unloadIsBlocked(page)).toBe(true);
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Əvvəl saxlanılmış iş");
  await expect(page.locator(".save-status")).toHaveText("Yaddaş əlçatan deyil");
  expect(await unloadIsBlocked(page)).toBe(false);
});

test("a real unload warning can cancel refresh when edits could not be saved", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Storage full", "QuotaExceededError"); };
  });
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Bağlanmadan qorunan iş");
  const dialogPromise = page.waitForEvent("dialog");
  // page.reload waits for a navigation that dismissal intentionally cancels.
  // Trigger the real browser refresh without waiting for a new document.
  const reloadPromise = page.evaluate(() => window.location.reload());
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
  await reloadPromise;
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Bağlanmadan qorunan iş");
});

test("undo is limited to thirty snapshots and the undo result survives reload", async ({ page }) => {
  await openWorkspace(page);
  const name = page.getByLabel("Prosesin adı", { exact: true });
  for (let index = 1; index <= 35; index++) await name.fill(`Dəyişiklik ${index}`);
  const undo = page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true });
  for (let index = 0; index < 30; index++) await undo.click();
  await expect(name).toHaveValue("Dəyişiklik 5");
  await expect(undo).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Dəyişiklik 5");
  await expect(undo).toBeDisabled();
  expect(await unloadIsBlocked(page)).toBe(false);
});
