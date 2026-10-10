"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Expand, Minus, Plus, Scan, Shrink } from "lucide-react";
import { layoutProject } from "@/lib/layout";
import type { Project, StepType } from "@/lib/types";

type DiagramProps = {
  project: Project;
  selectedId?: string | null;
  onSelect: (id: string) => void;
};

const typeLabels: Record<StepType, string> = {
  start: "Başlanğıc", end: "Son", task: "Tapşırıq", userTask: "İstifadəçi tapşırığı",
  serviceTask: "Sistem tapşırığı", subprocess: "Alt proses", xor: "XOR keçidi", or: "OR keçidi",
  and: "AND keçidi", intermediate: "Aralıq hadisə", message: "Mesaj hadisəsi",
  timer: "Vaxt hadisəsi", data: "Məlumat", annotation: "Qeyd",
};

const MIN_MANUAL_ZOOM = 0.1;
const MAX_ZOOM = 1.8;

function wrapText(value: string, length: number, maxLines = 4) {
  const words = value.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    if (word.length > length) {
      if (line) { lines.push(line); line = ""; }
      for (let i = 0; i < word.length; i += length) lines.push(word.slice(i, i + length));
    } else if (line && `${line} ${word}`.length > length) {
      lines.push(line); line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) return [...lines.slice(0, maxLines - 1), `${lines[maxLines - 1].slice(0, Math.max(1, length - 1))}…`];
  return lines.length ? lines : ["Adsız addım"];
}

function TextLines({ text, x, y, width = 140, maxLines = 4, size = 12, color = "#e9ecef" }: {
  text: string; x: number; y: number; width?: number; maxLines?: number; size?: number; color?: string;
}) {
  const lines = wrapText(text, Math.max(6, Math.floor(width / (size * 0.54))), maxLines);
  const lineHeight = size * 1.4;
  return <text x={x} y={y - ((lines.length - 1) * lineHeight) / 2} textAnchor="middle" fill={color} fontSize={size} fontWeight="500">
    {lines.map((line, index) => <tspan x={x} dy={index ? lineHeight : 0} key={index}>{line}</tspan>)}
  </text>;
}

function routeLabelPosition(points: { x: number; y: number }[], branch = false) {
  if (branch && points.length <= 4) {
    const a = points[points.length - 2], b = points[points.length - 1];
    if (a && b && Math.abs(a.y - b.y) < 1) return {x: (a.x + b.x) / 2, y: a.y - 12, length: Math.abs(a.x - b.x)};
  }
  let result = { x: 0, y: 0, length: -1 };
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1], b = points[index];
    const horizontal = Math.abs(a.y - b.y) < 1;
    const length = Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
    const score = horizontal ? length : length * 0.4;
    if (score > result.length) result = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - (horizontal ? 12 : 0), length: score };
  }
  return result;
}

export default function Diagram({ project, selectedId, onSelect }: DiagramProps) {
  const layout = useMemo(() => layoutProject(project), [project]);
  const stepById = useMemo(() => new Map(project.steps.map((step) => [step.id, step])), [project.steps]);
  const panel = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);
  const previousProject = useRef(project.id);
  const fittedProject = useRef<string | null>(project.id);
  const previousSelection = useRef("");
  const pendingScroll = useRef<{ left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const [fitted, setFitted] = useState(true);
  const [panning, setPanning] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [fullscreenNotice, setFullscreenNotice] = useState("");
  const markerPrefix = useId().replace(/:/g, "");
  const diagramWidth = Math.max(560, layout.width);
  const diagramHeight = Math.max(360, layout.height);

  useEffect(() => {
    if (previousProject.current === project.id) return;
    previousProject.current = project.id;
    previousSelection.current = "";
    pendingScroll.current = null;
    pan.current = null;
    fittedProject.current = project.id;
    setPanning(false);
    setFitted(true);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  }, [project.id]);

  useEffect(() => {
    const handleFullscreen = () => setFullscreen(document.fullscreenElement === panel.current);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setExpanded(false); setFullscreenNotice(""); }
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreen);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  useEffect(() => {
    if (!expanded || !panel.current) return;
    const element = panel.current;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = Array.from(element.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]'));
      const first = items[0], last = items[items.length - 1];
      if (!element.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", handleTab);
    return () => { document.body.style.overflow = originalOverflow; document.removeEventListener("keydown", handleTab); };
  }, [expanded]);

  useEffect(() => {
    if (!selectedId || !viewport.current) { previousSelection.current = ""; return; }
    const node = layout.nodes.find((item) => item.id === selectedId);
    if (!node) return;
    const selection = `${project.id}:${node.id}:${node.x}:${node.y}:${node.width}:${node.height}`;
    // Deliberate panning and zooming should not jump back to an unchanged selection.
    if (previousSelection.current === selection) return;
    previousSelection.current = selection;
    const view = viewport.current;
    const left = (node.x + node.width / 2) * zoom + 24;
    const top = (node.y + node.height / 2) * zoom + 24;
    if (left < view.scrollLeft + 50 || left > view.scrollLeft + view.clientWidth - 50 || top < view.scrollTop + 40 || top > view.scrollTop + view.clientHeight - 40) {
      view.scrollTo({ left: Math.max(0, left - view.clientWidth / 2), top: Math.max(0, top - view.clientHeight / 2), behavior: "smooth" });
    }
  }, [project.id, selectedId, layout.nodes, zoom]);

  useEffect(() => {
    if (pendingScroll.current && viewport.current) viewport.current.scrollTo(pendingScroll.current);
    pendingScroll.current = null;
  }, [zoom]);

  useEffect(() => {
    const view = viewport.current;
    if (!fitted || !view || fittedProject.current !== project.id) return;
    const updateFit = () => {
      // Fit uses the exact ratio: rounding or a manual zoom floor clips large flows.
      const availableWidth = Math.max(1, view.clientWidth - 48);
      const availableHeight = Math.max(1, view.clientHeight - 48);
      setZoom(Math.min(availableWidth / diagramWidth, availableHeight / diagramHeight, 1));
      view.scrollTo({ left: 0, top: 0 });
    };
    updateFit();
    const observer = new ResizeObserver(updateFit);
    observer.observe(view);
    return () => observer.disconnect();
  }, [project.id, fitted, diagramWidth, diagramHeight]);

  function changeZoom(next: number) {
    const nextZoom = Math.max(MIN_MANUAL_ZOOM, Math.min(MAX_ZOOM, Math.round(next * 100) / 100));
    const view = viewport.current;
    if (view) {
      const scale = nextZoom / zoom;
      pendingScroll.current = {
        left: Math.max(0, (view.scrollLeft + view.clientWidth / 2 - 24) * scale + 24 - view.clientWidth / 2),
        top: Math.max(0, (view.scrollTop + view.clientHeight / 2 - 24) * scale + 24 - view.clientHeight / 2),
      };
    }
    fittedProject.current = null;
    setFitted(false);
    setZoom(nextZoom);
  }

  function stopAutomaticFit() {
    fittedProject.current = null;
    setFitted(false);
  }

  async function toggleFullscreen() {
    const element = panel.current;
    if (!element) return;
    setFullscreenNotice("");
    if (expanded) { setExpanded(false); return; }
    if (document.fullscreenElement === element) {
      try { await document.exitFullscreen(); }
      catch { setFullscreenNotice("Tam ekrandan çıxmaq üçün Esc düyməsini bas."); }
      return;
    }
    if (element.requestFullscreen && document.fullscreenEnabled) {
      try { await element.requestFullscreen(); return; }
      catch { /* Embedded browsers can deny fullscreen; the expanded view remains available. */ }
    }
    setExpanded(true);
  }

  function fit() {
    const view = viewport.current;
    if (!view) return;
    pendingScroll.current = null;
    fittedProject.current = project.id;
    setFitted(true);
    setZoom(Math.min(Math.max(1, view.clientWidth - 48) / diagramWidth, Math.max(1, view.clientHeight - 48) / diagramHeight, 1));
    view.scrollTo({ left: 0, top: 0 });
  }

  return <div ref={panel} className={`diagram-panel${expanded ? " diagram-fullscreen" : ""}`}>
    <div className="diagram-toolbar">
      <span className="diagram-title">Bütün axın</span>
      <div className="diagram-controls">
        <button type="button" className="diagram-control" aria-label="Diaqramı kiçilt" title="Kiçilt" onClick={() => changeZoom(zoom - 0.1)} disabled={zoom <= MIN_MANUAL_ZOOM}><Minus size={15} /></button>
        <span className="diagram-zoom" aria-live="polite">{zoom < 0.1 ? Math.round(zoom * 1000) / 10 : Math.round(zoom * 100)}%</span>
        <button type="button" className="diagram-control" aria-label="Diaqramı böyüt" title="Böyüt" onClick={() => changeZoom(zoom + 0.1)} disabled={zoom >= MAX_ZOOM}><Plus size={15} /></button>
        <span className="diagram-controls-divider" />
        <button type="button" className="diagram-control" aria-label="Bütün diaqramı ekrana sığdır" title="Ekrana sığdır" onClick={fit}><Scan size={15} /></button>
        <button type="button" className="diagram-control" aria-label={fullscreen || expanded ? "Tam ekrandan çıx" : "Diaqramı tam ekranda aç"} aria-pressed={fullscreen || expanded} title={fullscreen || expanded ? "Tam ekrandan çıx" : "Tam ekran"} onClick={() => void toggleFullscreen()}>{fullscreen || expanded ? <Shrink size={15} /> : <Expand size={15} />}</button>
      </div>
    </div>
    {fullscreenNotice && <div className="diagram-notice" role="status">{fullscreenNotice}</div>}
    <div ref={viewport} className={`diagram-viewport${panning ? " is-panning" : ""}`} tabIndex={0} role="region" aria-label="Diaqram sahəsi. Sürüşdürün və ya ox düymələri ilə digər addımlara baxın."
      onWheel={() => {
        const view = viewport.current;
        if (view && (view.scrollWidth > view.clientWidth + 1 || view.scrollHeight > view.clientHeight + 1)) stopAutomaticFit();
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) return;
        const view = event.currentTarget;
        if (view.scrollWidth > view.clientWidth + 1 || view.scrollHeight > view.clientHeight + 1) stopAutomaticFit();
      }}
      onPointerDown={(event) => {
        if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest("[data-step-id]")) return;
        const view = viewport.current;
        if (!view) return;
        pan.current = { x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop, moved: false };
        setPanning(true); view.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!pan.current || !viewport.current) return;
        const view = viewport.current;
        if (!pan.current.moved && (Math.abs(pan.current.x - event.clientX) > 2 || Math.abs(pan.current.y - event.clientY) > 2) && (view.scrollWidth > view.clientWidth + 1 || view.scrollHeight > view.clientHeight + 1)) {
          pan.current.moved = true;
          stopAutomaticFit();
        }
        viewport.current.scrollLeft = pan.current.left + pan.current.x - event.clientX;
        viewport.current.scrollTop = pan.current.top + pan.current.y - event.clientY;
      }}
      onPointerUp={(event) => { pan.current = null; setPanning(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onLostPointerCapture={() => { pan.current = null; setPanning(false); }}
      onPointerCancel={() => { pan.current = null; setPanning(false); }}>
      <div className="diagram-surface" style={{ width: diagramWidth * zoom + 48, height: diagramHeight * zoom + 48 }}>
        <svg className="diagram-svg" id="process-diagram" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${diagramWidth} ${diagramHeight}`} width={diagramWidth * zoom} height={diagramHeight * zoom} role="group" aria-label="İş axınının BPMN diaqramı" style={{ fontFamily: "Arial, sans-serif" }}>
          <title>İş axınının BPMN diaqramı</title>
          <rect x="0" y="0" width={diagramWidth} height={diagramHeight} fill="#111315" />
          <defs>
            <marker id={`${markerPrefix}-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8 z" fill="#a1ada6" /></marker>
            <marker id={`${markerPrefix}-message`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M 1 1 L 8 4.5 L 1 8" fill="none" stroke="#b8a8d8" strokeWidth="1.2" /></marker>
          </defs>
          {layout.pools.map((pool, index) => <g key={pool.id}>
            <rect x={pool.x} y={pool.y} width={pool.width} height={pool.height} rx="8" fill={index % 2 ? "#14181b" : "#131619"} stroke="#34383b" strokeWidth="1.3" />
            <path d={`M ${pool.x + 8} ${pool.y} H ${pool.x + pool.width - 8} Q ${pool.x + pool.width} ${pool.y} ${pool.x + pool.width} ${pool.y + 8} V ${pool.y + 36} H ${pool.x} V ${pool.y + 8} Q ${pool.x} ${pool.y} ${pool.x + 8} ${pool.y} Z`} fill="#1d2421" />
            <text x={pool.x + 16} y={pool.y + 23} fill="#d0d5d0" fontSize="12" fontWeight="600"><title>{pool.name || "Adsız pool"}</title>{wrapText(pool.name || "Adsız pool", Math.max(8, Math.floor((pool.width - 124) / 6.5)), 1)[0]}</text>
            <text x={pool.x + pool.width - 16} y={pool.y + 23} textAnchor="end" fill="#8c968f" fontSize="10">POOL {index + 1}</text>
          </g>)}
          {layout.lanes.map((lane, index) => <g key={lane.id}>
            <title>{lane.name || "Adsız iştirakçı"}</title>
            <rect x={lane.x} y={lane.y} width={lane.width} height={lane.height} fill={index % 2 ? "#161b1e" : "#14181b"} stroke="#343d38" strokeWidth="1" />
            <rect x={lane.x} y={lane.y} width={136} height={lane.height} fill={index % 2 ? "#1c2323" : "#1b2122"} />
            <line x1={lane.x + 136} y1={lane.y} x2={lane.x + 136} y2={lane.y + lane.height} stroke="#343d38" />
            <TextLines text={lane.name || "Adsız iştirakçı"} x={lane.x + 68} y={lane.y + lane.height / 2 + 4} width={113} maxLines={5} size={12} color="#c5cec6" />
          </g>)}
          {layout.edges.map((edge, index) => {
            if (edge.points.length < 2) return null;
            const association = [stepById.get(edge.sourceId)?.type, stepById.get(edge.targetId)?.type].some(type => type === "data" || type === "annotation");
            const path = edge.points.map((point, pointIndex) => `${pointIndex ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
            const branch = (stepById.get(edge.sourceId)?.routes.length ?? 0) > 1;
            const label = routeLabelPosition(edge.points, branch);
            const maxLabelWidth = branch && edge.points.length <= 4 ? Math.max(40, Math.min(144, label.length - 8)) : 144;
            const labelLines = edge.label ? wrapText(edge.label, Math.max(5, Math.floor((maxLabelWidth - 14) / 5.6)), 2) : [];
            const labelWidth = Math.min(maxLabelWidth, Math.max(36, ...labelLines.map((line) => line.length * 5.6 + 14)));
            return <g key={`${edge.sourceId}-${edge.targetId}-${index}`}>
              <title>{edge.label || "Keçid"}</title>
              <path d={path} fill="none" stroke={edge.message && !association ? "#b8a8d8" : "#a1ada6"} strokeWidth="1.65" strokeDasharray={association ? "2 4" : edge.message ? "6 5" : undefined} strokeLinejoin="round" strokeLinecap="round" markerEnd={association ? undefined : `url(#${markerPrefix}-${edge.message ? "message" : "arrow"})`} />
              {edge.message && !association && <circle cx={edge.points[0].x} cy={edge.points[0].y} r="3" fill="#14181b" stroke="#b8a8d8" strokeWidth="1.3" />}
              {edge.label && <g>
                <rect x={label.x - labelWidth / 2} y={label.y - 10 - (labelLines.length > 1 ? 6 : 0)} width={labelWidth} height={labelLines.length > 1 ? 29 : 19} rx="4" fill="#1b2022" fillOpacity="0.97" />
                <TextLines text={edge.label} x={label.x} y={label.y + 3} width={labelWidth - 10} maxLines={2} size={10} color="#c3cbc5" />
              </g>}
            </g>;
          })}
          {layout.nodes.map((node) => {
            const step = stepById.get(node.id);
            if (!step) return null;
            const { x, y, width, height } = node;
            const cx = x + width / 2, cy = y + height / 2;
            const selected = selectedId === node.id;
            const gateway = ["xor", "or", "and"].includes(step.type);
            const event = ["start", "end", "intermediate", "message", "timer"].includes(step.type);
            const r = Math.min(width, height) / 2;
            const stroke = gateway ? "#d1d69c" : event ? step.type === "start" ? "#d8f78c" : step.type === "end" ? "#e1a6a0" : "#b9c2d2" : "#7d978d";
            const fill = gateway ? "#2b3020" : step.type === "start" ? "#24351d" : step.type === "end" ? "#352222" : event ? "#232a35" : step.type === "annotation" ? "#212225" : "#202b27";
            return <g key={node.id} className="diagram-node" data-step-id={node.id} role="button" tabIndex={0} aria-label={`${typeLabels[step.type]}: ${step.title || "Adsız addım"}`} aria-pressed={selected} onClick={() => onSelect(node.id)} onKeyDown={(key) => { if (key.key === "Enter" || key.key === " ") { key.preventDefault(); onSelect(node.id); } }}>
              <title>{`${typeLabels[step.type]}: ${step.title || "Adsız addım"}`}</title>
              {selected && <rect data-editor-only="selection" x={x - 6} y={y - 6} width={width + 12} height={height + 12} rx={event ? r + 6 : 12} fill="none" stroke="#d8f78c" strokeOpacity="0.9" strokeWidth="2.5" />}
              {gateway ? <>
                <path d={`M ${cx} ${y} L ${x + width} ${cy} L ${cx} ${y + height} L ${x} ${cy} Z`} fill={fill} stroke={stroke} strokeWidth="1.8" />
                {step.type === "or" ? <circle cx={cx} cy={cy} r="11" fill="none" stroke="#d8f78c" strokeWidth="2.2" /> : <text x={cx} y={cy + 7} textAnchor="middle" fill="#d8f78c" fontSize={step.type === "and" ? 29 : 24} fontWeight="500">{step.type === "and" ? "+" : "×"}</text>}
                <TextLines text={step.title} x={cx} y={y + height + 23} width={130} maxLines={2} size={11} />
              </> : event ? <>
                <circle cx={cx} cy={cy} r={r - 1} fill={fill} stroke={stroke} strokeWidth={step.type === "end" ? 3 : 1.8} />
                {["end", "intermediate", "message", "timer"].includes(step.type) && <circle cx={cx} cy={cy} r={r - 6} fill="none" stroke={stroke} strokeWidth="1" />}
                {step.type === "message" && <g stroke="#b9c2d2" strokeWidth="1.4" fill="none"><rect x={cx - 11} y={cy - 7} width="22" height="14" rx="1" /><path d={`M ${cx - 11} ${cy - 7} L ${cx} ${cy + 1} L ${cx + 11} ${cy - 7}`} /></g>}
                {step.type === "timer" && <g stroke="#b9c2d2" strokeWidth="1.4" fill="none"><circle cx={cx} cy={cy} r="12" /><path d={`M ${cx} ${cy - 8} V ${cy} L ${cx + 6} ${cy + 4}`} />{[0, 1, 2, 3].map((tick) => <line key={tick} x1={cx} y1={cy - 12} x2={cx} y2={cy - 9} transform={`rotate(${tick * 90} ${cx} ${cy})`} />)}</g>}
                {step.type === "start" && <circle cx={cx} cy={cy} r="4" fill="#d8f78c" />}
                {step.type === "end" && <rect x={cx - 4} y={cy - 4} width="8" height="8" rx="1" fill="#e1a6a0" />}
                <TextLines text={step.title} x={cx} y={y + height + 22} width={120} maxLines={2} size={11} />
              </> : step.type === "data" ? <>
                <path d={`M ${x} ${y} H ${x + width - 17} L ${x + width} ${y + 17} V ${y + height} H ${x} Z M ${x + width - 17} ${y} V ${y + 17} H ${x + width}`} fill="#282532" stroke="#b5a6c8" strokeWidth="1.7" />
                <TextLines text={step.title} x={cx} y={cy + 4} width={width - 24} maxLines={4} />
              </> : step.type === "annotation" ? <>
                <rect x={x} y={y} width={width} height={height} fill={fill} />
                <path d={`M ${x + 12} ${y} H ${x} V ${y + height} H ${x + 12}`} stroke="#9fa0a5" strokeWidth="2" fill="none" />
                <TextLines text={step.title} x={cx + 3} y={cy + 4} width={width - 24} maxLines={4} size={11} color="#b8b8bb" />
              </> : <>
                <rect x={x} y={y} width={width} height={height} rx="9" fill={fill} stroke={stroke} strokeWidth="1.6" />
                {step.type === "userTask" && <g transform={`translate(${x + 13} ${y + 11})`} stroke="#b2c5ba" strokeWidth="1.4" fill="none"><circle cx="4" cy="3" r="2.5" /><path d="M 0 11 V 9 Q 0 6 4 6 Q 8 6 8 9 V 11" /></g>}
                {step.type === "serviceTask" && <g transform={`translate(${x + 17} ${y + 16})`} stroke="#b2c5ba" strokeWidth="1.4" fill="none"><circle r="5" /><circle r="1.8" />{[0, 1, 2, 3].map((tick) => <line key={tick} x1="0" y1="-8" x2="0" y2="-5" transform={`rotate(${tick * 90})`} />)}</g>}
                <TextLines text={step.title} x={cx} y={cy + (step.type === "subprocess" ? -1 : 4)} width={width - 26} maxLines={step.type === "subprocess" ? 3 : 4} />
                {step.type === "subprocess" && <g><rect x={cx - 6} y={y + height - 17} width="12" height="12" rx="1" fill="#202b27" stroke="#b2c5ba" /><path d={`M ${cx - 3} ${y + height - 11} H ${cx + 3} M ${cx} ${y + height - 14} V ${y + height - 8}`} fill="none" stroke="#b2c5ba" strokeWidth="1.2" /></g>}
              </>}
            </g>;
          })}
          {!layout.nodes.length && <g>
            <text x={diagramWidth / 2} y={diagramHeight / 2 - 8} textAnchor="middle" fill="#d7dfd8" fontSize="16" fontWeight="500">İlk addımını əlavə et</text>
            <text x={diagramWidth / 2} y={diagramHeight / 2 + 20} textAnchor="middle" fill="#929c95" fontSize="12">Formanı doldurduqca diaqram burada yaranacaq.</text>
          </g>}
        </svg>
      </div>
    </div>
    <div className="diagram-legend" aria-label="Diaqram işarələri">
      <span className="diagram-key event"><i />Başlanğıc</span>
      <span className="diagram-key task"><i />Tapşırıq</span>
      <span className="diagram-key gateway"><i />Keçid</span>
      <span className="diagram-key message"><i />Mesaj</span>
      {(fullscreen || expanded) && <span className="diagram-fullscreen-hint">Esc ilə çıx</span>}
    </div>
  </div>;
}
