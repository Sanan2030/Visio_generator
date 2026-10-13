import assert from "node:assert/strict";
import test from "node:test";
import { HISTORY_LIMIT, HISTORY_MERGE_WINDOW, recordHistory, type HistoryGroup } from "../lib/project-history";

test("consecutive typing in one field keeps the snapshot before typing began", () => {
  let history = recordHistory<string>([], "Əvvəlki ad", null, "project:name", 1000);
  history = recordHistory(history.snapshots, "Y", history.group, "project:name", 1300);
  history = recordHistory(history.snapshots, "Ye", history.group, "project:name", 1750);
  assert.deepEqual(history.snapshots, ["Əvvəlki ad"]);
  assert.deepEqual(history.group, { key: "project:name", changedAt: 1750 });
});

test("a pause, another field, and structural edits each start a new undo entry", () => {
  const first = recordHistory([], "A", null, "step:a:title", 0);
  const afterPause = recordHistory(first.snapshots, "B", first.group, "step:a:title", HISTORY_MERGE_WINDOW);
  assert.deepEqual(afterPause.snapshots, ["A", "B"]);
  const anotherField = recordHistory(afterPause.snapshots, "C", afterPause.group, "step:a:description", 601);
  assert.deepEqual(anotherField.snapshots, ["A", "B", "C"]);
  const structural = recordHistory(anotherField.snapshots, "D", anotherField.group, undefined, 602);
  assert.equal(structural.group, null);
  const sameFieldAgain = recordHistory(structural.snapshots, "E", structural.group, "step:a:description", 603);
  assert.deepEqual(sameFieldAgain.snapshots, ["A", "B", "C", "D", "E"]);
});

test("undo and redo break typing groups without consuming their snapshots", () => {
  const beforeUndo = recordHistory([], "A", null, "project:name", 1000);
  const afterUndo = recordHistory([], "A", null, "project:name", 1100);
  assert.deepEqual(afterUndo.snapshots, beforeUndo.snapshots);
  const afterRedo = recordHistory(afterUndo.snapshots, "B", null, "project:name", 1200);
  assert.deepEqual(afterRedo.snapshots, ["A", "B"]);
});

test("history retains thirty complete groups while continuous typing uses one slot", () => {
  let snapshots: number[] = [];
  let group: HistoryGroup | null = null;
  for (let index = 0; index < 35; index++) {
    ({ snapshots, group } = recordHistory(snapshots, index, group, undefined, index));
  }
  assert.equal(snapshots.length, HISTORY_LIMIT);
  assert.deepEqual(snapshots, Array.from({ length: 30 }, (_, index) => index + 5));
  ({ snapshots, group } = recordHistory(snapshots, 35, group, "project:name", 40));
  ({ snapshots, group } = recordHistory(snapshots, 36, group, "project:name", 41));
  assert.equal(snapshots.length, HISTORY_LIMIT);
  assert.equal(snapshots[0], 6);
  assert.equal(snapshots.at(-1), 35);
});

test("a clock moving backwards cannot merge an unrelated editing period", () => {
  const first = recordHistory([], "A", null, "project:name", 1000);
  const later = recordHistory(first.snapshots, "B", first.group, "project:name", 500);
  assert.deepEqual(later.snapshots, ["A", "B"]);
});
