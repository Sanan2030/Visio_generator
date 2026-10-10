import assert from "node:assert/strict";
import test from "node:test";
import { createProject, SAMPLE_PROJECT } from "../lib/process";
import { filename, MAX_FILE_SIZE, MAX_STORED_SIZE, parseProject } from "../lib/storage";

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
  assert.throws(() => parseProject(" ".repeat(MAX_FILE_SIZE + 1)), /2 MB/);
});

test("large valid local drafts restore while the upload parser keeps its smaller size limit", () => {
  const draft = createProject();
  draft.steps = Array.from({ length: 200 }, (_, index) => ({
    id: `step-${index}`,
    laneId: draft.pools[0].lanes[0].id,
    type: "userTask" as const,
    title: `Addım ${index + 1}`,
    description: "A".repeat(10000),
    routes: [],
  }));
  const serialized = JSON.stringify(draft);
  assert.ok(serialized.length > MAX_FILE_SIZE);
  assert.throws(() => parseProject(serialized), /2 MB/);
  assert.deepEqual(parseProject(serialized, MAX_STORED_SIZE), draft);
  const oversizedShape = { ...draft, steps: [...draft.steps, { ...draft.steps[0], id: "extra-step" }] };
  assert.throws(() => parseProject(JSON.stringify(oversizedShape), MAX_STORED_SIZE), /etibarlı VisioFlow/);
});

test("download filenames keep Azerbaijani text and remove path separators and control characters", () => {
  assert.equal(filename("  Müştəri müraciətləri  "), "Müştəri müraciətləri");
  assert.equal(filename('QNV/\u0000:"\\test?*<>|'), "QNV-----test-----");
  assert.equal(filename("   "), "is-axini");
  assert.equal(filename("x".repeat(120)).length, 100);
});
