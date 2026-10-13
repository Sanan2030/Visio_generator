import type { Project, StepType } from "./types";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
const FONT_FAMILIES = new Set(["DM Sans", "DM Mono"]);
const fontData = new Map<string, Promise<string>>();

/** Raster limits keep long processes from allocating an unbounded canvas. */
export function diagramRasterSize(width: number, height: number) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Diaqramın ölçüləri düzgün deyil.");
  }
  const scale = Math.min(2, 8192 / width, 8192 / height, Math.sqrt(16_000_000 / (width * height)));
  return { width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)) };
}

function viewBoxSize(svg: SVGSVGElement) {
  const { width, height } = svg.viewBox.baseVal;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error("Diaqramın ölçüləri düzgün deyil.");
  }
  return { width, height };
}

function readDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Diaqram şriftini oxumaq mümkün olmadı."));
    reader.readAsDataURL(blob);
  });
}

function fontAsDataUrl(url: string) {
  let pending = fontData.get(url);
  if (!pending) {
    // Only the app's own static font files are requested. No project data leaves the browser.
    pending = fetch(url, { credentials: "same-origin" }).then(async response => {
      if (!response.ok) throw new Error("Diaqram şriftini yükləmək mümkün olmadı. Yenidən cəhd et.");
      return readDataUrl(new Blob([await response.arrayBuffer()], { type: "font/woff2" }));
    }).catch(error => { fontData.delete(url); throw error; });
    fontData.set(url, pending);
  }
  return pending;
}

async function embeddedFonts(document: Document) {
  await document.fonts.ready;
  const faces: CSSFontFaceRule[] = [];
  function collect(rules: CSSRuleList) {
    for (const rule of rules) {
      if (rule.type === CSSRule.FONT_FACE_RULE) {
        const face = rule as CSSFontFaceRule;
        const family = face.style.getPropertyValue("font-family").trim().replace(/^['"]|['"]$/g, "");
        if (FONT_FAMILIES.has(family)) faces.push(face);
      } else if ("cssRules" in rule) {
        collect((rule as CSSGroupingRule).cssRules);
      }
    }
  }
  for (const sheet of document.styleSheets) {
    try { collect(sheet.cssRules); } catch { /* Cross-origin sheets never supply exported fonts. */ }
  }
  if (!faces.length) throw new Error("Diaqram şriftləri hazırlanmadı. Səhifəni yeniləyib yenidən cəhd et.");
  const rules = await Promise.all(faces.map(async face => {
    const source = /url\(\s*(['"]?)([^)'"\s]+)\1\s*\)/i.exec(face.style.getPropertyValue("src"));
    if (!source) throw new Error("Diaqram şriftinin ünvanı tapılmadı.");
    const url = new URL(source[2], face.parentStyleSheet?.href ?? document.location.href);
    if (url.origin !== document.location.origin || !/\.woff2(?:$|[?#])/i.test(url.href)) {
      throw new Error("Diaqram şrifti tətbiqin yerli faylı olmalıdır.");
    }
    const sourceData = await fontAsDataUrl(url.href);
    const properties = ["font-family", "font-style", "font-weight", "unicode-range"]
      .map(name => `${name}:${face.style.getPropertyValue(name)};`).join("");
    return `@font-face{${properties}src:url('${sourceData}') format('woff2');font-display:block;}`;
  }));
  return rules.join("\n");
}

function nodeStroke(type: StepType) {
  if (["xor", "or", "and"].includes(type)) return "#1F2630";
  if (type === "start") return "#1B7048";
  if (type === "end") return "#8A2D2D";
  if (["intermediate", "message", "timer"].includes(type)) return "#566270";
  return "#BAC4CF";
}

function removeEditorState(clone: SVGSVGElement, project: Project) {
  clone.querySelectorAll("[data-editor-only], .diagram-edge-hit").forEach(element => element.remove());
  const steps = new Map(project.steps.map(step => [step.id, step]));
  for (const group of clone.querySelectorAll<SVGGElement>(".diagram-node[data-step-id]")) {
    const step = steps.get(group.dataset.stepId!);
    if (!step) continue;
    if (["xor", "or", "and", "data"].includes(step.type)) {
      group.querySelector(":scope > path")?.setAttribute("stroke", nodeStroke(step.type));
    } else if (["start", "end", "intermediate", "message", "timer"].includes(step.type)) {
      group.querySelectorAll(":scope > circle").forEach(element => element.setAttribute("stroke", nodeStroke(step.type)));
    } else if (step.type !== "annotation") {
      group.querySelector(":scope > rect")?.setAttribute("stroke", nodeStroke(step.type));
    }
    const badge = group.querySelector(".diagram-step-number");
    badge?.querySelector("rect")?.setAttribute("fill", "#EEF1F4");
    badge?.querySelector("rect")?.setAttribute("stroke", "#D5DBE2");
    badge?.querySelector("text")?.setAttribute("fill", "#566270");
    const title = group.querySelector(":scope > title");
    if (title) title.textContent = title.textContent?.replace(/\nSürüşdür və ya iki dəfə kliklə redaktə et\.$/, "") ?? "";
  }
  for (const group of clone.querySelectorAll<SVGGElement>(".diagram-edge[data-route-source]")) {
    const route = steps.get(group.dataset.routeSource!)?.routes[Number(group.dataset.routeIndex)];
    const caption = route?.label.toLocaleLowerCase("az") ?? "";
    const feedback = /imtina|rədd|geri|qaytar|reject|decline|return/.test(caption);
    const approval = !feedback && /təsdiq|bəli|yes|approve|confirm/.test(caption);
    const stroke = feedback ? "#B8470F" : "#6F7B88";
    const path = group.querySelector(":scope > path");
    path?.setAttribute("stroke", stroke);
    path?.setAttribute("stroke-width", "1.65");
    group.querySelector(":scope > circle")?.setAttribute("stroke", stroke);
    const chip = group.querySelector(".diagram-route-chip");
    chip?.querySelector("rect")?.setAttribute("fill", feedback ? "#FCEBDD" : approval ? "#DDF2E6" : "#F8FAFB");
    chip?.querySelector("rect")?.setAttribute("stroke", feedback ? "#EBB794" : approval ? "#9FD3B6" : "#D5DBE2");
    chip?.querySelector("text")?.setAttribute("fill", feedback ? "#A63F0B" : approval ? "#1B7048" : "#566270");
    const title = group.querySelector(":scope > title");
    if (title) title.textContent = (title.textContent?.replace(/\nKliklə keçidi redaktə et\.$/, "") ?? "") + (route?.description ? `\n${route.description}` : "");
  }
  for (const element of [clone, ...clone.querySelectorAll("*")]) {
    element.removeAttribute("tabindex");
    element.removeAttribute("aria-pressed");
    element.classList.remove("is-selected", "is-dragging", "is-connect-target", "is-draggable");
    if (element !== clone) element.removeAttribute("role");
  }
}

async function diagramBlob(svg: SVGSVGElement, project: Project, rasterSize?: { width: number; height: number }): Promise<Blob> {
  const { width, height } = rasterSize ?? viewBoxSize(svg);
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", SVG_NAMESPACE);
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("role", "img");
  clone.style.removeProperty("width");
  clone.style.removeProperty("height");
  removeEditorState(clone, project);
  clone.querySelector(":scope > rect")?.setAttribute("fill", "#FFFFFF");
  const title = clone.querySelector(".diagram-project-title");
  title?.setAttribute("font-size", "14");
  title?.setAttribute("letter-spacing", "-0.2");
  title?.setAttribute("y", "12");
  const style = svg.ownerDocument.createElementNS(SVG_NAMESPACE, "style");
  style.textContent = await embeddedFonts(svg.ownerDocument);
  let definitions = clone.querySelector("defs");
  if (!definitions) {
    definitions = svg.ownerDocument.createElementNS(SVG_NAMESPACE, "defs");
    clone.prepend(definitions);
  }
  definitions.prepend(style);
  return new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml;charset=utf-8" });
}

/** Produces a self-contained vector file without changing the live editor. */
export async function serializeDiagram(svg: SVGSVGElement, project: Project): Promise<Blob> {
  return diagramBlob(svg, project);
}

/** PNG uses the same standalone vector, at twice the size within safe canvas bounds. */
export async function generateDiagramPng(svg: SVGSVGElement, project: Project): Promise<Blob> {
  const { width, height } = viewBoxSize(svg);
  const size = diagramRasterSize(width, height);
  // Bound the Image decoder as well as the destination canvas. The original
  // viewBox remains intact, so distant manually positioned nodes still fit.
  const source = await diagramBlob(svg, project, size);
  const url = URL.createObjectURL(source);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Diaqram şəklini yaratmaq mümkün olmadı. SVG kimi yükləyib yenidən cəhd et."));
      image.src = url;
    });
    const canvas = svg.ownerDocument.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Brauzer PNG şəklini hazırlaya bilmir. SVG kimi yüklə.");
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error("PNG şəklini hazırlamaq mümkün olmadı. SVG kimi yüklə.")), "image/png");
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
