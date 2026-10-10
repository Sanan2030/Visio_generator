import assert from "node:assert/strict";
import test from "node:test";
import { createProject, SAMPLE_PROJECT } from "../lib/process";
import { FILE_SIZE_LABEL, filename, formatFileSize, MAX_FILE_SIZE, MAX_STORED_SIZE, parseProject } from "../lib/storage";

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

test("exported backups above the old 2MB limit round-trip through import and local restore", () => {
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
  assert.equal(MAX_FILE_SIZE, MAX_STORED_SIZE);
  assert.deepEqual(parseProject(serialized), draft);
  assert.deepEqual(parseProject(serialized, MAX_STORED_SIZE), draft);
  const oversizedShape = { ...draft, steps: [...draft.steps, { ...draft.steps[0], id: "extra-step" }] };
  assert.throws(() => parseProject(JSON.stringify(oversizedShape), MAX_STORED_SIZE), /etibarlı VisioFlow/);
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
