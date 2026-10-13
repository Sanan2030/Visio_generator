import { expect, test, type Page } from "@playwright/test";
import { createProject, SAMPLE_PROJECT } from "../lib/process";

const PREFIX = "visioflow:v1:";
const CLOCK_START = new Date("2026-10-13T12:00:00Z");
const CLOCK_PAUSE = new Date("2026-10-13T12:01:00Z");

async function openWorkspace(page: Page, path = "/") {
  await page.goto(path);
  await expect(page.getByRole("button", { name: "Visio üçün yüklə", exact: true })).toBeEnabled();
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  await page.locator(".form-tabs").getByRole("button", { name: /İştirakçılar/ }).click();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toBeVisible();
}

async function freezeWorkspaceClock(page: Page, path = "/") {
  await page.clock.install({ time: CLOCK_START });
  await openWorkspace(page, path);
  await page.clock.pauseAt(CLOCK_PAUSE);
}

async function appKeys(page: Page) {
  return page.evaluate(prefix => Object.keys(localStorage).filter(key => key.startsWith(prefix)).sort(), PREFIX);
}

test("an untouched workspace never occupies browser storage, including reload at its blank hash", async ({ page }) => {
  await freezeWorkspaceClock(page);
  const blankHash = new URL(page.url()).hash;
  await page.clock.runFor(1000);
  expect(await appKeys(page)).toEqual([]);
  expect(await page.evaluate(() => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);
  await page.reload();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Yeni iş axını");
  expect(new URL(page.url()).hash).toBe(blankHash);
  expect(await appKeys(page)).toEqual([]);
});

test("startup cleans only valid default empty drafts and preserves content, malformed keys and other apps", async ({ page }) => {
  const empty = { ...createProject(), id: "old-empty" };
  const named = { ...createProject(), id: "named-draft", name: "Adlandırılmış layihə" };
  const participant = { ...createProject(), id: "participant-draft" };
  participant.pools[0].lanes[0].name = "Operator";
  const populated = { ...SAMPLE_PROJECT, id: "populated-draft" };
  const mismatch = { ...empty, id: "different-id" };
  const expected = {
    [PREFIX + named.id]: JSON.stringify(named),
    [PREFIX + participant.id]: JSON.stringify(participant),
    [PREFIX + populated.id]: JSON.stringify(populated),
    [PREFIX + "invalid-json"]: "{unfinished",
    [PREFIX + "invalid-shape"]: JSON.stringify({ version: 1, id: "invalid-shape", steps: [] }),
    [PREFIX + "mismatched-id"]: JSON.stringify(mismatch),
    "another-app:empty": JSON.stringify(empty),
  };
  await page.addInitScript(({ draft, retained, prefix }) => {
    localStorage.setItem(prefix + draft.id, JSON.stringify(draft));
    for (const [key, value] of Object.entries(retained)) localStorage.setItem(key, value);
  }, { draft: empty, retained: expected, prefix: PREFIX });
  await openWorkspace(page);
  const actual = await page.evaluate(() => Object.fromEntries(Object.keys(localStorage).map(key => [key, localStorage.getItem(key)])));
  expect(actual).toEqual(expected);
});

test("rapid typing writes once after the debounce and saving status stays pending until that write", async ({ page }) => {
  await page.addInitScript(prefix => {
    const original = Storage.prototype.setItem;
    const writes: string[] = [];
    (window as unknown as { draftWrites: string[] }).draftWrites = writes;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith(prefix)) writes.push(value);
      return original.call(this, key, value);
    };
  }, PREFIX);
  await freezeWorkspaceClock(page);
  const name = page.getByLabel("Prosesin adı", { exact: true });
  await name.fill("Sənəd");
  await name.fill("Sənəd təsdiqi");
  await name.fill("Sənəd təsdiqi prosesi");
  await expect(page.locator(".save-status")).toHaveText("Saxlanılır…");
  expect(await appKeys(page)).toEqual([]);
  await page.clock.runFor(299);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılır…");
  expect(await page.evaluate(() => (window as unknown as { draftWrites: string[] }).draftWrites)).toHaveLength(0);
  await page.clock.runFor(1);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  const writes = await page.evaluate(() => (window as unknown as { draftWrites: string[] }).draftWrites);
  expect(writes).toHaveLength(1);
  expect(JSON.parse(writes[0]).name).toBe("Sənəd təsdiqi prosesi");
});

test("beforeunload synchronously flushes pending text without blocking a successful save", async ({ page }) => {
  await freezeWorkspaceClock(page);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Bağlanmadan əvvəlki mətn");
  await expect(page.locator(".save-status")).toHaveText("Saxlanılır…");
  const result = await page.evaluate(prefix => {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return {
      blocked: event.defaultPrevented,
      stored: JSON.parse(localStorage.getItem(prefix + window.location.hash.slice(1))!),
    };
  }, PREFIX);
  expect(result.blocked).toBe(false);
  expect(result.stored.name).toBe("Bağlanmadan əvvəlki mətn");
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
});

test("a pending edit is flushed before hash navigation restores a different saved project", async ({ page }) => {
  const first = { ...createProject(), id: "first-flush", name: "Birinci layihə" };
  const second = { ...createProject(), id: "second-flush", name: "İkinci layihə" };
  await page.addInitScript(({ drafts, prefix }) => {
    for (const draft of drafts) localStorage.setItem(prefix + draft.id, JSON.stringify(draft));
  }, { drafts: [first, second], prefix: PREFIX });
  await freezeWorkspaceClock(page, "/#first-flush");
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Birinci layihənin son mətni");
  await expect(page.locator(".save-status")).toHaveText("Saxlanılır…");
  await page.evaluate(() => { window.location.hash = "second-flush"; });
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue(second.name);
  const stored = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PREFIX + first.id);
  expect(stored.name).toBe("Birinci layihənin son mətni");
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
});

test("a project menu replacement flushes the previous draft and leaves the new empty draft unpersisted", async ({ page }) => {
  await freezeWorkspaceClock(page);
  const originalHash = new URL(page.url()).hash;
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Dəyişmədən əvvəlki layihə");
  await expect(page.locator(".save-status")).toHaveText("Saxlanılır…");
  await page.getByRole("button", { name: "Layihə menyusu", exact: true }).click();
  await page.getByRole("button", { name: "Yeni diaqram", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Yeni iş axını");
  const newHash = new URL(page.url()).hash;
  expect(newHash).not.toBe(originalHash);
  const stored = await page.evaluate(({ prefix, oldHash, emptyHash }) => ({
    previous: JSON.parse(localStorage.getItem(prefix + oldHash.slice(1))!),
    empty: localStorage.getItem(prefix + emptyHash.slice(1)),
  }), { prefix: PREFIX, oldHash: originalHash, emptyHash: newHash });
  expect(stored.previous.name).toBe("Dəyişmədən əvvəlki layihə");
  expect(stored.empty).toBeNull();
});

test("a failed hash-switch save preserves unsaved text until the user confirms discarding it", async ({ page }) => {
  const first = { ...createProject(), id: "blocked-first", name: "Əvvəlki layihə" };
  const second = { ...createProject(), id: "blocked-second", name: "Digər layihə" };
  await page.addInitScript(({ drafts, prefix }) => {
    for (const draft of drafts) localStorage.setItem(prefix + draft.id, JSON.stringify(draft));
    Storage.prototype.setItem = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); };
  }, { drafts: [first, second], prefix: PREFIX });
  await openWorkspace(page, "/#blocked-first");
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Saxlanılmayan son mətn");
  await page.evaluate(() => { window.location.hash = "blocked-second"; });
  const dialog = page.getByRole("dialog", { name: "Dəyişikliklər saxlanılmayıb", exact: true });
  await expect(dialog).toBeVisible();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Saxlanılmayan son mətn");
  expect(new URL(page.url()).hash).toBe("#blocked-first");
  await dialog.getByRole("button", { name: "Ləğv et", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Saxlanılmayan son mətn");
  await page.evaluate(() => { window.location.hash = "blocked-second"; });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Saxlamadan davam et", exact: true }).click();
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue(second.name);
  expect(new URL(page.url()).hash).toBe("#blocked-second");
  const oldDraft = await page.evaluate(key => JSON.parse(localStorage.getItem(key)!), PREFIX + first.id);
  expect(oldDraft.name).toBe(first.name);
});

test("one text session becomes one Undo entry and Redo restores its complete final value", async ({ page }) => {
  await freezeWorkspaceClock(page);
  const name = page.getByLabel("Prosesin adı", { exact: true });
  await name.fill("Təs");
  await name.fill("Təsdiq");
  await name.fill("Təsdiq prosesi");
  const undo = page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true });
  const redo = page.getByRole("button", { name: "Geri alınmış dəyişikliyi yenidən tətbiq et", exact: true });
  await undo.click();
  await expect(name).toHaveValue("Yeni iş axını");
  await expect(undo).toBeDisabled();
  await expect(redo).toBeEnabled();
  expect(await appKeys(page)).toEqual([]);
  await redo.click();
  await expect(name).toHaveValue("Təsdiq prosesi");
  await expect(redo).toBeDisabled();
  await page.clock.runFor(300);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
});

test("changing the edited field separates text history even inside the coalescing interval", async ({ page }) => {
  await freezeWorkspaceClock(page);
  const name = page.getByLabel("Prosesin adı", { exact: true });
  const participant = page.getByLabel("Pool 1 icraçı 1", { exact: true });
  const undo = page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true });
  await name.fill("İlk ad");
  await participant.fill("Operator");
  await name.fill("Son ad");
  await undo.click();
  await expect(name).toHaveValue("İlk ad");
  await expect(participant).toHaveValue("Operator");
  await undo.click();
  await expect(participant).toHaveValue("İştirakçı 1");
  await expect(name).toHaveValue("İlk ad");
  await undo.click();
  await expect(name).toHaveValue("Yeni iş axını");
  await expect(undo).toBeDisabled();
});

test("typing after the 600 ms grouping window creates a separate Undo entry", async ({ page }) => {
  await freezeWorkspaceClock(page);
  const name = page.getByLabel("Prosesin adı", { exact: true });
  await name.fill("Birinci yazı");
  await page.clock.runFor(650);
  await name.fill("İkinci yazı");
  const undo = page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true });
  await undo.click();
  await expect(name).toHaveValue("Birinci yazı");
  await expect(undo).toBeEnabled();
  await undo.click();
  await expect(name).toHaveValue("Yeni iş axını");
  await expect(undo).toBeDisabled();
});

test("a full browser storage reports a clear Azerbaijani failure and keeps the draft in memory", async ({ page }) => {
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => { throw new DOMException("Quota exceeded", "QuotaExceededError"); };
  });
  await openWorkspace(page);
  await page.getByLabel("Prosesin adı", { exact: true }).fill("Yaddaş dolsa da qorunan iş");
  await expect(page.locator(".save-status")).toHaveText("Yaddaş əlçatan deyil");
  await expect(page.locator(".toast")).toContainText(/yaddaş.*dol/i);
  await expect(page.getByLabel("Prosesin adı", { exact: true })).toHaveValue("Yaddaş dolsa da qorunan iş");
});
