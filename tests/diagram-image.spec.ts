import { readFile } from "node:fs/promises";
import { expect, test, type Page } from "@playwright/test";
import { XMLValidator } from "fast-xml-parser";
import type { Project } from "../lib/types";

const STORAGE_PREFIX = "visioflow:v1:";

function imageProject(): Project {
  return {
    version: 1, id: "standalone-diagram-export", name: "Ərizənin yoxlanması və şöbəyə ötürülməsi",
    pools: [{ id: "office", name: "Təşkilat", lanes: [
      { id: "operator", name: "Operator" }, { id: "reviewer", name: "İkinci iştirakçı" },
    ] }],
    steps: [
      { id: "start", laneId: "operator", type: "start", title: "Başla", description: "Ərizə daxil olur.", routes: [{ targetId: "check", label: "" }] },
      { id: "check", laneId: "operator", type: "userTask", title: "Ərizəni yoxla", description: "Məlumatları yoxla.", routes: [
        { targetId: "approve", label: "Təsdiq", description: "Ərizə digər iştirakçıya ötürülür." },
        { targetId: "reject", label: "İmtina", description: "Müraciətə baxılmır." },
      ] },
      { id: "approve", laneId: "reviewer", type: "end", title: "Təsdiqləndi", description: "", routes: [] },
      { id: "reject", laneId: "operator", type: "end", title: "İmtina edildi", description: "", routes: [] },
    ],
  };
}

async function seed(page: Page, project = imageProject()) {
  await page.addInitScript(({ prefix, saved }) => {
    localStorage.setItem(prefix + saved.id, JSON.stringify(saved));
  }, { prefix: STORAGE_PREFIX, saved: project });
  await page.goto(`/#${project.id}`);
  await expect(page.locator("#process-diagram [data-step-id]")).toHaveCount(4);
  await expect(page.locator(".save-status")).toHaveText("Saxlanılıb");
  return project;
}

async function exportImage(page: Page, type: "SVG" | "PNG") {
  const action = page.getByRole("button", { name: `${type} kimi yüklə`, exact: true });
  if (!await action.isVisible()) await page.getByRole("button", { name: "Layihə menyusu", exact: true }).click();
  const waiting = page.waitForEvent("download");
  await action.click();
  const result = await waiting;
  expect(await result.failure()).toBeNull();
  expect(result.suggestedFilename()).toMatch(new RegExp(`\\.${type.toLowerCase()}$`));
  return readFile((await result.path())!);
}

async function editorSnapshot(page: Page) {
  return page.evaluate(prefix => {
    const svg = document.getElementById("process-diagram") as unknown as SVGSVGElement;
    return { html: svg.outerHTML, saved: localStorage.getItem(prefix + location.hash.slice(1)), width: svg.viewBox.baseVal.width, height: svg.viewBox.baseVal.height };
  }, STORAGE_PREFIX);
}

test("SVG download preserves complete vector geometry and Azerbaijani fonts without editor handles or live-editor changes", async ({ page }) => {
  await seed(page);
  await page.getByRole("button", { name: "Diaqramı böyüt", exact: true }).click();
  const task = page.locator('#process-diagram [data-step-id="check"]');
  await task.click();
  await expect(task).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#process-diagram [data-editor-only]")).not.toHaveCount(0);
  const before = await editorSnapshot(page);
  const text = (await exportImage(page, "SVG")).toString("utf8");
  expect(XMLValidator.validate(text)).toBe(true);
  const exported = await page.evaluate(source => {
    const document = new DOMParser().parseFromString(source, "image/svg+xml");
    const svg = document.documentElement;
    const node = svg.querySelector('[data-step-id="check"]');
    return {
      width: Number(svg.getAttribute("width")), height: Number(svg.getAttribute("height")),
      viewBox: svg.getAttribute("viewBox"), nodes: svg.querySelectorAll("[data-step-id]").length,
      editorOnly: svg.querySelectorAll("[data-editor-only], .diagram-edge-hit, [aria-pressed]").length,
      shapeStroke: node?.querySelector(":scope > rect")?.getAttribute("stroke"),
      numberFill: node?.querySelector(".diagram-step-number rect")?.getAttribute("fill"),
      fonts: svg.querySelector("defs style")?.textContent ?? "",
      text: svg.textContent,
      background: svg.querySelector(":scope > rect")?.getAttribute("fill"),
    };
  }, text);
  expect(exported.width).toBe(before.width);
  expect(exported.height).toBe(before.height);
  expect(exported.viewBox).toBe(`0 0 ${before.width} ${before.height}`);
  expect(exported.nodes).toBe(4);
  expect(exported.editorOnly).toBe(0);
  expect(exported.shapeStroke).toBe("#BAC4CF");
  expect(exported.numberFill).toBe("#EEF1F4");
  expect(exported.background).toBe("#FFFFFF");
  expect(exported.fonts).toContain("DM Sans");
  expect(exported.fonts).toContain("DM Mono");
  expect(/unicode-range:U\+0?100/i.test(exported.fonts)).toBe(true);
  expect(exported.fonts).toContain("data:font/woff2;base64,");
  expect(exported.fonts).not.toMatch(/url\(['"]?(?:https?:|\/|\.\/)/i);
  expect(exported.text).toContain("Ərizəni yoxla");
  expect(exported.text).toContain("2.1");
  expect(exported.text).toContain("2.2");
  expect(await editorSnapshot(page)).toEqual(before);
});

test("SVG download removes selected-edge colors while preserving approval and rejection chips and attached connectors", async ({ page }) => {
  await seed(page);
  const edge = page.locator('#process-diagram .diagram-edge[data-route-source="check"][data-route-index="1"]');
  await edge.focus();
  await edge.press("Enter");
  await expect(edge).toHaveAttribute("aria-pressed", "true");
  const before = await editorSnapshot(page);
  const text = (await exportImage(page, "SVG")).toString("utf8");
  const output = await page.evaluate(source => {
    const svg = new DOMParser().parseFromString(source, "image/svg+xml").documentElement;
    const edge = svg.querySelector('.diagram-edge[data-route-source="check"][data-route-index="1"]')!;
    return {
      stroke: edge.querySelector(":scope > path")?.getAttribute("stroke"),
      width: edge.querySelector(":scope > path")?.getAttribute("stroke-width"),
      marker: edge.querySelector(":scope > path")?.getAttribute("marker-end"),
      chip: edge.querySelector(".diagram-route-chip rect")?.getAttribute("fill"),
      label: edge.querySelector(".diagram-route-chip text")?.textContent,
      handles: svg.querySelectorAll("[data-editor-only]").length,
    };
  }, text);
  expect(output.stroke).toBe("#B8470F");
  expect(output.width).toBe("1.65");
  expect(output.marker).toMatch(/^url\(#.+-arrow\)$/);
  expect(output.chip).toBe("#FCEBDD");
  expect(output.label).toContain("2.2");
  expect(output.handles).toBe(0);
  expect(await editorSnapshot(page)).toEqual(before);
});

test("PNG download has a valid proportional bitmap, opaque white background and diagram content without changing the draft", async ({ page }) => {
  await seed(page);
  const before = await editorSnapshot(page);
  const data = await exportImage(page, "PNG");
  expect([...data.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  expect(width).toBe(before.width * 2);
  expect(height).toBe(before.height * 2);
  const pixels = await page.evaluate(async source => {
    const image = new Image();
    image.src = `data:image/png;base64,${source}`;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = Math.round(400 * image.height / image.width);
    const context = canvas.getContext("2d")!;
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const background = [...context.getImageData(0, 0, 1, 1).data];
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let visible = 0;
    for (let offset = 0; offset < data.length; offset += 4) if (data[offset] < 220 && data[offset + 1] < 220 && data[offset + 2] < 220) visible++;
    return { background, visible };
  }, data.toString("base64"));
  expect(pixels.background).toEqual([255, 255, 255, 255]);
  expect(pixels.visible).toBeGreaterThan(100);
  expect(await editorSnapshot(page)).toEqual(before);
});

test("PNG keeps extremely distant manual positions within decoder and canvas limits while exporting the full viewBox", async ({ page }) => {
  const project = imageProject();
  project.steps[1].position = { x: 100_000, y: 100_000 };
  await seed(page, project);
  const before = await editorSnapshot(page);
  expect(before.width).toBeGreaterThan(100_000);
  expect(before.height).toBeGreaterThan(100_000);
  const data = await exportImage(page, "PNG");
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  expect(width).toBeLessThanOrEqual(8192);
  expect(height).toBeLessThanOrEqual(8192);
  expect(width * height).toBeLessThanOrEqual(16_000_000);
  const ratio = before.width / before.height;
  expect(Math.abs(width / height - ratio) / ratio).toBeLessThanOrEqual(1 / width + 1 / height);
  expect(await editorSnapshot(page)).toEqual(before);
});
