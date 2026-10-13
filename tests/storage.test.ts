import assert from "node:assert/strict";
import test from "node:test";
import { createProject, SAMPLE_PROJECT } from "../lib/process";
import { FILE_SIZE_LABEL, filename, formatFileSize, MAX_FILE_SIZE, MAX_STORED_SIZE, parseProject, cleanupEmptyProjects, hasProjectContent, persistProject, STORAGE_PREFIX } from "../lib/storage";

test("JSON backups and unfinished drafts round-trip through the same parser as browser restore", () => {
  assert.deepEqual(parseProject(JSON.stringify(SAMPLE_PROJECT)), SAMPLE_PROJECT);
  const draft = createProject();
  draft.steps.push({ id: "draft-step", laneId: draft.pools[0].lanes[0].id, type: "xor", title: "Qərar", description: "", routes: [{ targetId: "", label: "" }] });
  assert.deepEqual(parseProject(JSON.stringify(draft)), draft);
});

test("import rejects invalid JSON, incompatible project versions, malformed shapes and excessive sizes", () => {
  assert.throws(() => parseProject("not json"));
  assert.throws(() => parseProject(JSON.stringify({ ...SAMPLE_PROJECT, version: 2 })), /etibarlı VisioFlow/);
  assert.throws(() => parseProject(JSON.stringify({ ...SAMPLE_PROJECT, steps: [{ id: "a", routes: [] }] })), /etibarlı VisioFlow/);
  assert.throws(() => parseProject(" ".repeat(1001), 1000), /1 KB/);
});

test("large legacy drafts remain parseable but exceed the conservative browser write limit", () => {
  const draft = createProject();
  draft.steps = Array.from({ length: 200 }, (_, index) => ({
    id: `step-${index}`,
    laneId: draft.pools[0].lanes[0].id,
    type: "userTask" as const,
    title: `Addım ${index + 1}`,
    description: "Ə".repeat(10000),
    routes: [],
  }));
  const serialized = JSON.stringify(draft, null, 2);
  const fileBytes = new TextEncoder().encode(serialized).byteLength;
  assert.ok(fileBytes > 2_000_000 && fileBytes < MAX_FILE_SIZE);
  assert.equal(MAX_STORED_SIZE, 2_000_000);
  assert.deepEqual(parseProject(serialized), draft);
  assert.throws(() => parseProject(serialized, MAX_STORED_SIZE), /maksimum 2 MB/);
  const oversizedShape = { ...draft, steps: [...draft.steps, { ...draft.steps[0], id: "extra-step" }] };
  assert.throws(() => parseProject(JSON.stringify(oversizedShape), MAX_FILE_SIZE), /etibarlı VisioFlow/);
});

test("parser size boundaries count UTF-8 bytes, with consistent human-readable limits", () => {
  const draft = createProject();
  draft.name = "Müştəri müraciətləri 🦥";
  const serialized = JSON.stringify(draft);
  const bytes = new TextEncoder().encode(serialized).byteLength;
  assert.ok(bytes > serialized.length);
  assert.deepEqual(parseProject(serialized, bytes), draft);
  assert.throws(() => parseProject(serialized, bytes - 1), /Fayl həddən artıq böyükdür/);
  assert.equal(FILE_SIZE_LABEL, "100 MB");
  assert.equal(formatFileSize(1_500_000), "1.5 MB");
  assert.equal(formatFileSize(500), "500 bayt");
});

test("download filenames keep Azerbaijani text and remove path separators and control characters", () => {
  assert.equal(filename("  Müştəri müraciətləri  "), "Müştəri müraciətləri");
  assert.equal(filename('QNV/\u0000:"\\test?*<>|'), "QNV-----test-----");
  assert.equal(filename("   "), "is-axini");
  assert.equal(filename("x".repeat(120)).length, 100);
});

class MemoryStorage implements Storage {
  private data = new Map<string, string>();
  get length() { return this.data.size; }
  key(index: number) { return [...this.data.keys()][index] ?? null; }
  getItem(key: string) { return this.data.get(key) ?? null; }
  setItem(key: string, value: string) { this.data.set(key, value); }
  removeItem(key: string) { this.data.delete(key); }
  clear() { this.data.clear(); }
}

test("startup removes only valid default empty projects and preserves authored, unrelated and malformed records", () => {
  const storage = new MemoryStorage();
  const blank = createProject();
  const authored = { ...createProject(), name: "Müştəri müraciətləri" };
  storage.setItem(STORAGE_PREFIX + blank.id, JSON.stringify(blank));
  storage.setItem(STORAGE_PREFIX + authored.id, JSON.stringify(authored));
  storage.setItem(STORAGE_PREFIX + "broken", "broken data");
  storage.setItem("another-app", JSON.stringify(blank));
  storage.setItem(STORAGE_PREFIX + "wrong-id", JSON.stringify(blank));
  assert.equal(cleanupEmptyProjects(storage), 1);
  assert.equal(storage.getItem(STORAGE_PREFIX + blank.id), null);
  assert.equal(storage.getItem(STORAGE_PREFIX + authored.id), JSON.stringify(authored));
  assert.equal(storage.length, 4);
  assert.equal(cleanupEmptyProjects(storage), 0);
});

test("empty drafts never occupy storage and undoing to empty removes the previous content snapshot", () => {
  const storage = new MemoryStorage();
  const blank = createProject();
  assert.equal(hasProjectContent(blank), false);
  persistProject(storage, blank);
  assert.equal(storage.length, 0);
  const named = { ...blank, name: "Sənəd axını" };
  assert.equal(hasProjectContent(named), true);
  assert.equal(persistProject(storage, named), JSON.stringify(named));
  assert.equal(storage.length, 1);
  persistProject(storage, blank);
  assert.equal(storage.length, 0);
});

test("quota and access failures have actionable Azerbaijani messages", () => {
  const project = { ...createProject(), name: "İş axını" };
  assert.throws(() => persistProject({ removeItem() {}, setItem() { throw new DOMException("quota", "QuotaExceededError"); } }, project), /yaddaşı dolub.*Word və ya Visio/s);
  assert.throws(() => persistProject({ removeItem() {}, setItem() { throw new DOMException("blocked", "SecurityError"); } }, project), /yaddaşına yazmaq mümkün olmadı/);
  assert.equal(cleanupEmptyProjects({ get length(): number { throw new Error("blocked"); }, key() { return null; }, getItem() { return null; }, removeItem() {} }), 0);
});

test("an oversized write preserves the previous stored project instead of silently discarding it", () => {
  const storage = new MemoryStorage();
  const previous = { ...createProject(), name: "Saxlanmış axın" };
  persistProject(storage, previous);
  const oversized = { ...previous, steps: Array.from({ length: 200 }, (_, index) => ({ id: `large-${index}`, laneId: previous.pools[0].lanes[0].id, type: "task" as const, title: "Yoxla", description: "ə".repeat(10000), routes: [] })) };
  assert.throws(() => persistProject(storage, oversized), /maksimum 2 MB/);
  assert.equal(storage.getItem(STORAGE_PREFIX + previous.id), JSON.stringify(previous));
});
