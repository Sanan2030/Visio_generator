import type { Project } from "./types";
import { isProject } from "./process";

export const STORAGE_PREFIX = "visioflow:v1:";
export const DIAGRAM_CLIPBOARD_KEY = "visioflow:diagram-clipboard:v1";
export const MAX_FILE_SIZE = 100_000_000;
// A 2 MB UTF-8 draft needs at most about 4 MB of UTF-16 storage, leaving
// room for its key inside the usual 5 MiB localStorage quota. The origin's
// remaining capacity still varies, so every write must catch quota failures.
export const MAX_STORED_SIZE = 2_000_000;
export const FILE_SIZE_LABEL = formatFileSize(MAX_FILE_SIZE);

export function hasProjectContent(project: Project): boolean {
  return project.size !== undefined || project.pools.some(pool => pool.size !== undefined || pool.position !== undefined || pool.lanes.some(lane => lane.height !== undefined))
    || project.steps.length > 0 || project.name !== "Yeni iş axını"
    || project.pools.length !== 1 || project.pools[0].name !== "Təşkilat"
    || project.pools[0].lanes.length !== 1 || project.pools[0].lanes[0].name !== "İştirakçı 1";
}

export function cleanupEmptyProjects(storage: Pick<Storage, "length" | "key" | "getItem" | "removeItem">): number {
  let removed = 0;
  try {
    const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
    for (const key of keys) {
      if (!key?.startsWith(STORAGE_PREFIX)) continue;
      try {
        const serialized = storage.getItem(key);
        if (!serialized) continue;
        const project = parseProject(serialized, MAX_STORED_SIZE);
        if (key === STORAGE_PREFIX + project.id && !hasProjectContent(project)) {
          storage.removeItem(key);
          removed++;
        }
      } catch { /* Malformed records and blocked storage stay untouched. */ }
    }
  } catch { /* Cleanup is optional and must not interrupt opening the editor. */ }
  return removed;
}

export function persistProject(storage: Pick<Storage, "setItem" | "removeItem">, project: Project): string {
  const serialized = JSON.stringify(project);
  try {
    if (!hasProjectContent(project)) { storage.removeItem(STORAGE_PREFIX + project.id); return serialized; }
    if (new TextEncoder().encode(serialized).byteLength > MAX_STORED_SIZE) {
      throw new Error(`Layihə brauzerdə saxlamaq üçün çox böyükdür (maksimum ${formatFileSize(MAX_STORED_SIZE)}). İşi Word və ya Visio faylı kimi yüklə.`);
    }
    storage.setItem(STORAGE_PREFIX + project.id, serialized);
    return serialized;
  } catch (error) {
    const name = error && typeof error === "object" && "name" in error ? error.name : "";
    if (name === "QuotaExceededError" || name === "NS_ERROR_DOM_QUOTA_REACHED") {
      throw new Error("Brauzer yaddaşı dolub. Son dəyişikliklər yalnız açıq səhifədədir. İşi Word və ya Visio faylı kimi yüklə, yaxud sayt üçün yaddaşda yer aç.");
    }
    if (error instanceof Error && error.message.startsWith("Layihə brauzerdə")) throw error;
    throw new Error("Brauzer yaddaşına yazmaq mümkün olmadı. Son dəyişikliklər yalnız açıq səhifədədir. İşi Word və ya Visio faylı kimi yüklə.");
  }
}

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
