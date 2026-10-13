import assert from "node:assert/strict";
import test from "node:test";
import { diagramRasterSize } from "../lib/diagram-image";

test("PNG output doubles ordinary diagrams and bounds long or large processes without changing their proportions", () => {
  assert.deepEqual(diagramRasterSize(960, 360), { width: 1920, height: 720 });
  for (const [width, height] of [[60_000, 800], [10_000, 10_000], [500, 80_000]]) {
    const result = diagramRasterSize(width, height);
    assert.ok(result.width <= 8192 && result.height <= 8192);
    assert.ok(result.width * result.height <= 16_000_000);
    // Rounding one pixel on a short edge can move a long edge by several
    // equivalent pixels; compare the relative aspect ratio error instead.
    const ratio = width / height;
    assert.ok(Math.abs(result.width / result.height - ratio) / ratio <= 1 / result.width + 1 / result.height);
  }
});

test("PNG refuses invalid canvas dimensions before allocating memory", () => {
  for (const [width, height] of [[0, 360], [-1, 360], [960, 0], [Infinity, 360], [960, NaN]]) {
    assert.throws(() => diagramRasterSize(width, height), /ölçüləri düzgün deyil/);
  }
});
