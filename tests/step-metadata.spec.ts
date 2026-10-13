import { readFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import JSZip from "jszip";
import { XMLParser, XMLValidator } from "fast-xml-parser";
import { EXPLANATION_HEADERS } from "../lib/docx";
import type { Project } from "../lib/types";

const PREFIX = "visioflow:v1:";
const TASK_ID = "review-metadata";
const FIELDS = ["Müddət (SLA)", "Sistem", "Sənəd"] as const;
const VALUES = ["2 iş günü", "Qeydiyyat sistemi", "Müraciət forması"] as const;

function legacyProject(): Project {
  return {
    version: 1, id: "metadata-project", name: "Müraciətin yoxlanılması",
    pools: [{ id: "organization", name: "Təşkilat", lanes: [{ id: "operator", name: "Operator" }] }],
    steps: [
      { id: "start", laneId: "operator", type: "start", title: "Başla", description: "Müraciət daxil olur.", routes: [{ targetId: TASK_ID, label: "" }] },
      { id: TASK_ID, laneId: "operator", type: "userTask", title: "Müraciəti yoxla", description: "Məlumatları yoxlayaraq nəticəni seç.", routes: [
        { targetId: "approved", label: "Təsdiq", description: "Məlumatlar düzgündür." },
        { targetId: "declined", label: "İmtina", description: "Məlumatlar uyğun deyil." },
      ] },
      { id: "approved", laneId: "operator", type: "end", title: "Təsdiqləndi", description: "Müraciət təsdiqlənir.", routes: [] },
      { id: "declined", laneId: "operator", type: "end", title: "İmtina edildi", description: "Müraciət bağlanır.", routes: [] },
    ],
  };
}

function populatedProject(): Project {
  const project = legacyProject();
  project.steps[1] = { ...project.steps[1], duration: VALUES[0], system: VALUES[1], document: VALUES[2] };
  return project;
}

async function seedProject(page: Page, project = legacyProject()) {
  await page.addInitScript(({ saved, prefix }) => {
    const key = prefix + saved.id;
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify(saved));
  }, { saved: project, prefix: PREFIX });
  await page.goto(`/#${project.id}`);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(project.steps.length);
  return project;
}

async function openTaskForm(page: Page) {
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /Addımlar/ }).click();
  const summary = page.getByRole("button", { name: "2-ci addımı aç", exact: true });
  if (await summary.getAttribute("aria-expanded") !== "true") await summary.click();
  await expect(page.getByLabel("2-ci addımın adı", { exact: true })).toBeVisible();
}

async function savedProject(page: Page): Promise<Project> {
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return page.evaluate(prefix => JSON.parse(localStorage.getItem(prefix + location.hash.slice(1))!), PREFIX);
}

async function downloadBytes(download: Download) {
  expect(await download.failure()).toBeNull();
  const path = await download.path();
  expect(path).not.toBeNull();
  return readFile(path!);
}

async function downloadXml(page: Page, kind: "word" | "visio", fromModal = false) {
  const promise = page.waitForEvent("download");
  const buttonName = kind === "visio" ? "Visio üçün yüklə" : fromModal ? "Word faylını yüklə" : "Word izahını yüklə";
  await page.getByRole("button", { name: buttonName, exact: true }).click();
  const download = await promise;
  expect(download.suggestedFilename()).toMatch(kind === "word" ? /\.docx$/ : /\.vsdx$/);
  const zip = await JSZip.loadAsync(await downloadBytes(download), { checkCRC32: true });
  const xml = await zip.file(kind === "word" ? "word/document.xml" : "visio/pages/page1.xml")!.async("string");
  expect(XMLValidator.validate(xml)).toBe(true);
  return xml;
}

function wordCells(xml: string): string[][] {
  const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
  return [...xml.matchAll(/<w:tr>[\s\S]*?<\/w:tr>/g)].map(row =>
    [...row[0].matchAll(/<w:tc>[\s\S]*?<\/w:tc>/g)].map(cell =>
      [...cell[0].matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/g)].map(text => parser.parse(`<value>${text[1]}</value>`).value).join("\n")));
}

test("legacy drafts retain optional empty fields and one SLA typing session supports Undo, Redo and reload", async ({ page }) => {
  await page.clock.install({ time: new Date("2026-10-13T12:00:00Z") });
  const original = await seedProject(page);
  await page.clock.pauseAt(new Date("2026-10-13T12:01:00Z"));
  await openTaskForm(page);
  const details = page.locator(".form-panel details").filter({ has: page.locator("summary", { hasText: "Əlavə məlumatlar" }) });
  await expect(details).not.toHaveAttribute("open", "");
  await details.locator("summary").click();
  for (const field of FIELDS) await expect(page.getByLabel(`2-ci addım — ${field}`, { exact: true })).toHaveValue("");
  const duration = page.getByLabel("2-ci addım — Müddət (SLA)", { exact: true });
  await duration.fill("2");
  await duration.fill("2 iş");
  await duration.fill(VALUES[0]);
  await page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true }).click();
  await openTaskForm(page);
  await details.locator("summary").click();
  await expect(duration).toHaveValue("");
  await expect(page.getByRole("button", { name: "Son dəyişikliyi geri al", exact: true })).toBeDisabled();
  expect(await savedProject(page)).toEqual(original);
  await page.getByRole("button", { name: "Geri alınmış dəyişikliyi yenidən tətbiq et", exact: true }).click();
  await page.clock.runFor(300);
  expect((await savedProject(page)).steps[1].duration).toBe(VALUES[0]);
  await page.reload();
  await openTaskForm(page);
  await expect(page.getByLabel("2-ci addım — Müddət (SLA)", { exact: true })).toBeVisible();
  await expect(page.getByLabel("2-ci addım — Müddət (SLA)", { exact: true })).toHaveValue(VALUES[0]);
  await page.getByLabel("2-ci addım — Müddət (SLA)", { exact: true }).fill("");
  await page.clock.runFor(300);
  const cleared = await savedProject(page);
  expect(cleared.version).toBe(1);
  expect(cleared.steps[1]).not.toHaveProperty("duration");
  expect(cleared.steps[1]).not.toHaveProperty("system");
  expect(cleared.steps[1]).not.toHaveProperty("document");
});

test("diagram metadata editing updates the form, Word notes and native Visio shape data", async ({ page }) => {
  await seedProject(page, populatedProject());
  await page.locator(`#process-diagram [data-step-id="${TASK_ID}"]`).dblclick();
  const inspector = page.getByRole("complementary", { name: "Addım redaktəsi", exact: true });
  await expect(inspector).toBeVisible();
  for (const [index, field] of FIELDS.entries()) await expect(inspector.getByLabel(`Diaqram addımı — ${field}`, { exact: true })).toHaveValue(VALUES[index]);
  const changed = ["4 saat", "Sənəd dövriyyəsi", "Ərizə"];
  for (const [index, field] of FIELDS.entries()) await inspector.getByLabel(`Diaqram addımı — ${field}`, { exact: true }).fill(changed[index]);
  await openTaskForm(page);
  for (const [index, field] of FIELDS.entries()) await expect(page.getByLabel(`2-ci addım — ${field}`, { exact: true })).toHaveValue(changed[index]);
  const restored = await savedProject(page);
  expect(restored.steps[1]).toMatchObject({ duration: changed[0], system: changed[1], document: changed[2] });
  const word = wordCells(await downloadXml(page, "word"));
  const taskRow = word.find(row => row[0] === "2")!;
  for (const [index, field] of FIELDS.entries()) expect(taskRow[2]).toContain(`${field}: ${changed[index]}`);
  const visioXml = await downloadXml(page, "visio");
  const shape = [...visioXml.matchAll(/<Shape\b[^>]*>[\s\S]*?<\/Shape>/g)].map(match => match[0]).find(candidate => candidate.includes(`<Cell N="Value" V="${TASK_ID}"/>`))!;
  for (const [index, key] of ["Duration", "System", "Document"].entries()) {
    const property = shape.match(new RegExp(`<Row N="${key}">[\\s\\S]*?<\\/Row>`))![0];
    expect(property).toContain(`<Cell N="Value" V="${changed[index]}"/>`);
    expect(property).toContain(`<Cell N="Label" V="${FIELDS[index]}"/>`);
  }
});

test("default Word columns keep optional metadata as labelled notes rather than losing it", async ({ page }) => {
  await seedProject(page, populatedProject());
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /İzah/ }).click();
  for (const field of FIELDS) await expect(page.getByLabel(`${field} sütunu`, { exact: true })).not.toBeChecked();
  await expect(page.locator(".form-panel .explanation-text thead th")).toHaveText([...EXPLANATION_HEADERS]);
  const rows = wordCells(await downloadXml(page, "word"));
  expect(rows[0]).toEqual([...EXPLANATION_HEADERS]);
  expect(rows.every(row => row.length === 3)).toBe(true);
  const taskRow = rows.find(row => row[0] === "2")!;
  for (const [index, field] of FIELDS.entries()) expect(taskRow[2]).toContain(`${field}: ${VALUES[index]}`);
  expect(rows.filter(row => row[0] === "2.1" || row[0] === "2.2")).toHaveLength(2);
});

test("chosen Word metadata columns are shared by preview, expanded table and downloaded file with empty branch cells", async ({ page }) => {
  await seedProject(page, populatedProject());
  await page.getByRole("navigation", { name: "Proses forması" }).getByRole("button", { name: /İzah/ }).click();
  await page.getByLabel("Müddət (SLA) sütunu", { exact: true }).check();
  const subset = wordCells(await downloadXml(page, "word"));
  expect(subset[0]).toEqual([...EXPLANATION_HEADERS, FIELDS[0]]);
  const subsetTask = subset.find(row => row[0] === "2")!;
  expect(subsetTask[3]).toBe(VALUES[0]);
  expect(subsetTask[2]).not.toContain(`${FIELDS[0]}: ${VALUES[0]}`);
  expect(subsetTask[2]).toContain(`${FIELDS[1]}: ${VALUES[1]}`);
  expect(subsetTask[2]).toContain(`${FIELDS[2]}: ${VALUES[2]}`);
  for (const field of FIELDS.slice(1)) await page.getByLabel(`${field} sütunu`, { exact: true }).check();
  const headers = [...EXPLANATION_HEADERS, ...FIELDS];
  await expect(page.locator(".form-panel .explanation-text thead th")).toHaveText(headers);
  const previewTask = page.locator(".form-panel .explanation-text tbody tr").filter({ has: page.locator("td:first-child", { hasText: /^2$/ }) });
  await expect(previewTask.locator("td").nth(3)).toHaveText(VALUES[0]);
  await expect(previewTask.locator("td").nth(4)).toHaveText(VALUES[1]);
  await expect(previewTask.locator("td").nth(5)).toHaveText(VALUES[2]);
  await page.getByRole("button", { name: "İzah cədvəlinə geniş bax", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "İş axınının izah cədvəli", exact: true });
  await expect(modal.locator(".explanation-text thead th")).toHaveText(headers);
  const rows = wordCells(await downloadXml(page, "word", true));
  expect(rows[0]).toEqual(headers);
  expect(rows.every(row => row.length === 6)).toBe(true);
  expect(rows.find(row => row[0] === "2")!.slice(3)).toEqual([...VALUES]);
  for (const row of rows.filter(row => row[0] === "2.1" || row[0] === "2.2")) expect(row.slice(3)).toEqual(["", "", ""]);
});

test("metadata edits and exports remain local without sending project payloads or mutation requests", async ({ page }) => {
  const mutations: string[] = [];
  const payloads: string[] = [];
  const marker = "Yalnız yerli məlumat 947";
  page.on("request", request => {
    if (!["GET", "HEAD"].includes(request.method())) mutations.push(`${request.method()} ${request.url()}`);
    const data = `${request.url()} ${request.postData() || ""}`;
    if (data.includes(marker) || data.includes(encodeURIComponent(marker))) payloads.push(data);
  });
  await seedProject(page);
  await openTaskForm(page);
  await page.locator(".form-panel details").filter({ has: page.locator("summary", { hasText: "Əlavə məlumatlar" }) }).locator("summary").click();
  for (const field of FIELDS) await page.getByLabel(`2-ci addım — ${field}`, { exact: true }).fill(marker);
  expect((await savedProject(page)).steps[1]).toMatchObject({ duration: marker, system: marker, document: marker });
  await downloadXml(page, "word");
  await downloadXml(page, "visio");
  expect(mutations).toEqual([]);
  expect(payloads).toEqual([]);
});
