import type { Step } from "./types";

/** Notes show their full editable text, independently of process step numbering. */
export function annotationText(step: Pick<Step, "title" | "description">): string {
  return [step.title.trim(), step.description.trim()].filter(Boolean).join("\n").replace(/^[ \t]*[•*-][ \t]+/gm, "• ") || "Adsız qeyd";
}

export type AnnotationLine = { text: string; continuation: boolean };

/** Keep paragraphs and list items distinct, with a hanging indent for wrapped bullets. */
export function wrapAnnotationText(text: string, columns: number, maxLines: number): AnnotationLine[] {
  const lines: AnnotationLine[] = [];
  const width = Math.max(6, Math.floor(columns));
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const bullet = /^\s*[•*-]\s+/.test(paragraph);
    const content = paragraph.replace(bullet ? /^\s*[•*-]\s+/ : /^\s+/, "").trimEnd();
    const words = content.split(/\s+/).filter(Boolean);
    const available = Math.max(4, width - (bullet ? 2 : 0));
    let line = "";
    let first = true;
    const append = () => {
      lines.push({ text: `${bullet && first ? "• " : ""}${line}`, continuation: bullet && !first });
      first = false;
      line = "";
    };
    for (const word of words) {
      if (line && line.length + word.length + 1 > available) append();
      let remaining = word;
      while (remaining.length > available) {
        line = remaining.slice(0, available);
        append();
        remaining = remaining.slice(available);
      }
      line = line ? `${line} ${remaining}` : remaining;
    }
    if (line || first) append();
  }
  const limit = Math.max(1, Math.floor(maxLines));
  if (lines.length <= limit) return lines;
  const visible = lines.slice(0, limit);
  visible[limit - 1] = { ...visible[limit - 1], text: `${visible[limit - 1].text.replace(/…$/, "").slice(0, width - 1)}…` };
  return visible;
}
