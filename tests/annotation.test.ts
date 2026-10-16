import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import Diagram from "../components/diagram";
import { annotationText, wrapAnnotationText } from "../lib/annotation-text";
import type { Project } from "../lib/types";

test("annotation text keeps separate paragraphs and normalizes editable list markers", () => {
  assert.equal(annotationText({ title: " Hesabat ", description: "- Status (Rejected)\n* İcraçının ad, soyad, ata adı\n\nİmtina qeydi" }),
    "Hesabat\n• Status (Rejected)\n• İcraçının ad, soyad, ata adı\n\nİmtina qeydi");
  assert.equal(annotationText({ title: "", description: " " }), "Adsız qeyd");
});

test("annotation wrapping preserves bullets, blank lines and hanging continuation lines", () => {
  assert.deepEqual(wrapAnnotationText("• Status (Rejected)\n\nİmtina qeydi", 15, 8), [
    { text: "• Status", continuation: false },
    { text: "(Rejected)", continuation: true },
    { text: "", continuation: false },
    { text: "İmtina qeydi", continuation: false },
  ]);
  assert.deepEqual(wrapAnnotationText("• Birinci çox uzun mətn\n• İkinci bənd", 15, 1), [
    { text: "• Birinci çox…", continuation: false },
  ]);
});

test("annotation renderer draws a transparent blue text bracket without task numbering", () => {
  const project: Project = {
    version: 1, id: "annotations", name: "Qeydlər",
    pools: [{ id: "pool", name: "Proses", lanes: [{ id: "lane", name: "İcraçı" }] }],
    steps: [
      { id: "note", laneId: "lane", type: "annotation", title: "• Status (Rejected)", description: "• İmtina qeydi", routes: [], size: { width: 320, height: 100 } },
      { id: "task", laneId: "lane", type: "task", title: "Yoxla", description: "", routes: [] },
    ],
  };
  const markup = renderToStaticMarkup(createElement(Diagram, { project, onSelect: () => {} }));
  const annotation = markup.slice(markup.indexOf('data-step-id="note"'), markup.indexOf('data-step-id="task"'));
  assert.match(annotation, /class="diagram-annotation-hit-area"[^>]+fill="transparent"/);
  assert.match(annotation, /stroke-width="1.2" fill="none"/);
  assert.match(annotation, /class="diagram-annotation-text"[^>]+text-anchor="start"[^>]+#4472C4/);
  assert.match(annotation, /<tspan[^>]*>• Status \(Rejected\)<\/tspan>/);
  assert.match(annotation, /<tspan[^>]*>• İmtina qeydi<\/tspan>/);
  assert.doesNotMatch(annotation, /diagram-step-number/);
  assert.match(markup.slice(markup.indexOf('data-step-id="task"')), /diagram-step-number/);
});
