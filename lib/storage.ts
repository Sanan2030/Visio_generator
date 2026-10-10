import type { Project } from "./types";
import { isProject } from "./process";

export const STORAGE_PREFIX = "visioflow:v1:";
export const MAX_FILE_SIZE = 2_000_000;
export const MAX_STORED_SIZE = 30_000_000;

export function parseProject(text: string, maxSize = MAX_FILE_SIZE): Project {
  if (text.length > maxSize) throw new Error("Fayl həddən artıq böyükdür (maksimum 2 MB).");
  let data: unknown;
  try { data = JSON.parse(text); }
  catch { throw new Error("JSON faylı oxunmadı. Faylın düzgün JSON formatında olduğunu yoxla."); }
  if (!isProject(data)) throw new Error("Bu fayl etibarlı VisioFlow layihəsi deyil.");
  return data;
}

export function filename(name: string): string {
  return name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").slice(0, 100) || "is-axini";
}

export function download(data: BlobPart, name: string, mime: string) {
  const url = URL.createObjectURL(new Blob([data], { type: mime }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
