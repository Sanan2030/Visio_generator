import assert from "node:assert/strict";
import test from "node:test";
import { diagramColor, DIAGRAM_LIGHT_COLORS, resolveDiagramColor, type DiagramColor } from "../lib/diagram-palette";

test("every editor palette token resolves to a concrete light color for standalone downloads", () => {
  for (const color of Object.keys(DIAGRAM_LIGHT_COLORS) as DiagramColor[]) {
    const live = diagramColor(color);
    assert.match(live, /^var\(--diagram-[a-z-]+, #[A-F\d]{6}\)$/);
    assert.equal(resolveDiagramColor(live), DIAGRAM_LIGHT_COLORS[color]);
    assert.doesNotMatch(resolveDiagramColor(live), /var\(/);
  }
});

test("export palette does not change transparent paint, marker inheritance, literal colors or unrelated variables", () => {
  for (const value of ["none", "transparent", "context-stroke", "#123ABC", "var(--other-color, #ABCDEF)", "var(--diagram-unknown, #123456)"]) {
    assert.equal(resolveDiagramColor(value), value);
  }
});

test("export colors use the canonical print palette even when a theme supplies a different fallback", () => {
  assert.equal(resolveDiagramColor("var(--diagram-surface, #101418)"), "#FFFFFF");
  assert.equal(resolveDiagramColor("var( --diagram-ink , #FFFFFF )"), "#14181D");
});
