import type { Project } from "./types";
import { isProject } from "./process";

export const STORAGE_PREFIX = "visioflow:v1:";
export const MAX_FILE_SIZE = 100_000_000;
export const MAX_STORED_SIZE = MAX_FILE_SIZE;
export const FILE_SIZE_LABEL = formatFileSize(MAX_FILE_SIZE);

export function formatFileSize(bytes: number): string {
  if (bytes >= 1_000_000) return `${Number((bytes / 1_000_000).toFixed(2))} MB`;
  if (bytes >= 1_000) return `${Number((bytes / 1_000).toFixed(2))} KB`;
  return `${bytes} bayt`;
}

export function parseProject(text: string, maxSize = MAX_FILE_SIZE): Project {
  // File.size measures UTF-8 bytes. The same bound must apply to restoration
  // and direct parsing, including Azerbaijani text with multibyte characters.
  // Most drafts fit the inexpensive upper bound without an extra allocation.
  if (text.length > maxSize || (text.length * 3 > maxSize && new TextEncoder().encode(text).byteLength > maxSize)) {
    throw new Error(`Fayl həddən artıq böyükdür (maksimum ${formatFileSize(maxSize)}).`);
  }
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
