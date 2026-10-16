/** Live colors inherit the editor theme; standalone exports use these light colors. */
export const DIAGRAM_LIGHT_COLORS = {
  surface: "#FFFFFF",
  node: "#FFFFFF",
  header: "#F8FAFB",
  ink: "#14181D",
  muted: "#566270",
  border: "#D5DBE2",
  "shape-border": "#BAC4CF",
  gateway: "#1F2630",
  "gateway-border": "#1F2630",
  "on-gateway": "#FFFFFF",
  start: "#1B7048",
  end: "#8A2D2D",
  annotation: "#BFC3C7",
  "annotation-ink": "#4472C4",
  accent: "#2548E8",
  "accent-soft": "#E8ECFD",
  "on-accent": "#FFFFFF",
  edge: "#6F7B88",
  "feedback-edge": "#B8470F",
  "feedback-fill": "#FCEBDD",
  "feedback-border": "#EBB794",
  "feedback-ink": "#A63F0B",
  "approval-fill": "#DDF2E6",
  "approval-border": "#9FD3B6",
  "approval-ink": "#1B7048",
  chip: "#F8FAFB",
  badge: "#EEF1F4",
} as const;

export type DiagramColor = keyof typeof DIAGRAM_LIGHT_COLORS;

export function diagramColor(color: DiagramColor) {
  return `var(--diagram-${color}, ${DIAGRAM_LIGHT_COLORS[color]})`;
}

/** Resolves only our palette tokens, without asking a detached SVG for computed styles. */
export function resolveDiagramColor(value: string) {
  const match = /^var\(\s*--diagram-([a-z-]+)\s*,\s*#[a-fA-F\d]{6}\s*\)$/.exec(value);
  if (!match || !Object.hasOwn(DIAGRAM_LIGHT_COLORS, match[1])) return value;
  return DIAGRAM_LIGHT_COLORS[match[1] as DiagramColor];
}
