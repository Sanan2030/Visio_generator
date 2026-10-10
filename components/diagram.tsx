"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react";
import { Maximize2, Minus, Plus, MousePointer2 } from "lucide-react";
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

const buttonStyle: CSSProperties = {
  width: 32, height: 32, display: "inline-flex", alignItems: "center", justifyContent: "center",
  border: "1px solid #e3e9ee", borderRadius: 7, background: "#fff", color: "#647180", cursor: "pointer",
};

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

function TextLines({ text, x, y, width = 140, maxLines = 4, size = 12, color = "#344654" }: {
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
  const viewport = useRef<HTMLDivElement>(null);
  const pan = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [zoom, setZoom] = useState(0.8);
  const [panning, setPanning] = useState(false);
  const markerPrefix = useId().replace(/:/g, "");
  const diagramWidth = Math.max(560, layout.width);
  const diagramHeight = Math.max(360, layout.height);

  useEffect(() => {
    if (!selectedId || !viewport.current) return;
    const node = layout.nodes.find((item) => item.id === selectedId);
    if (!node) return;
    const view = viewport.current;
    const left = (node.x + node.width / 2) * zoom + 24;
    const top = (node.y + node.height / 2) * zoom + 24;
    if (left < view.scrollLeft + 50 || left > view.scrollLeft + view.clientWidth - 50 || top < view.scrollTop + 40 || top > view.scrollTop + view.clientHeight - 40) {
      view.scrollTo({ left: Math.max(0, left - view.clientWidth / 2), top: Math.max(0, top - view.clientHeight / 2), behavior: "smooth" });
    }
  }, [selectedId, layout.nodes, zoom]);

  function changeZoom(next: number) { setZoom(Math.max(0.15, Math.min(1.8, Math.round(next * 100) / 100))); }
  function fit() {
    const view = viewport.current;
    if (!view) return;
    changeZoom(Math.min((view.clientWidth - 48) / diagramWidth, (view.clientHeight - 48) / diagramHeight, 1));
    view.scrollTo({ left: 0, top: 0, behavior: "smooth" });
  }

  return <div className="diagram-panel" style={{ display: "flex", flexDirection: "column", height: 510, minHeight: 440 }}>
    <div className="diagram-toolbar" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "14px 20px", borderBottom: "1px solid #e9eef2", background: "#fff" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#88929d" }}>
        <span style={{ width: 6, height: 6, background: "#1aae97", borderRadius: "50%" }} />
        <span>Canlı görünüş</span>
        <span style={{ color: "#d2d9df" }}>•</span>
        <span>{project.steps.length} addım</span>
      </div>
      <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
        <button type="button" className="diagram-control" style={buttonStyle} aria-label="Diaqramı kiçilt" title="Kiçilt" onClick={() => changeZoom(zoom - 0.1)} disabled={zoom <= 0.15}><Minus size={15} /></button>
        <span aria-live="polite" style={{ minWidth: 43, textAlign: "center", fontSize: 11, fontWeight: 600, color: "#697887" }}>{Math.round(zoom * 100)}%</span>
        <button type="button" className="diagram-control" style={buttonStyle} aria-label="Diaqramı böyüt" title="Böyüt" onClick={() => changeZoom(zoom + 0.1)} disabled={zoom >= 1.8}><Plus size={15} /></button>
        <div style={{ width: 1, height: 20, background: "#e9eef2", margin: "0 5px" }} />
        <button type="button" className="diagram-control" style={buttonStyle} aria-label="Bütün diaqramı ekrana sığdır" title="Ekrana sığdır" onClick={fit}><Maximize2 size={14} /></button>
      </div>
    </div>
    <div ref={viewport} className="diagram-viewport" aria-label="Diaqram sahəsi. Sürüşdürərək digər addımlara baxın." style={{ position: "relative", flex: 1, minHeight: 0, overflow: "auto", backgroundColor: "#f9fbfc", backgroundImage: "radial-gradient(#dce5ea 0.8px, transparent 0.8px)", backgroundSize: "18px 18px", cursor: panning ? "grabbing" : "grab", touchAction: "pan-x pan-y" }}
      onPointerDown={(event) => {
        if (event.button !== 0 || (event.target as Element).closest("[data-step-id]")) return;
        const view = viewport.current;
        if (!view) return;
        pan.current = { x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop };
        setPanning(true); view.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (!pan.current || !viewport.current) return;
        viewport.current.scrollLeft = pan.current.left + pan.current.x - event.clientX;
        viewport.current.scrollTop = pan.current.top + pan.current.y - event.clientY;
      }}
      onPointerUp={(event) => { pan.current = null; setPanning(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
      onPointerCancel={() => { pan.current = null; setPanning(false); }}>
      <div style={{ width: diagramWidth * zoom + 48, minWidth: "100%", height: diagramHeight * zoom + 48, minHeight: "100%", padding: 24, boxSizing: "border-box" }}>
        <svg id="process-diagram" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${diagramWidth} ${diagramHeight}`} width={diagramWidth * zoom} height={diagramHeight * zoom} role="group" aria-label="İş axınının BPMN diaqramı" style={{ display: "block", fontFamily: "Arial, sans-serif", overflow: "visible" }}>
          <title>İş axınının BPMN diaqramı</title>
          <defs>
            <marker id={`${markerPrefix}-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8 z" fill="#81939d" /></marker>
            <marker id={`${markerPrefix}-message`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M 1 1 L 8 4.5 L 1 8" fill="none" stroke="#9a87bf" strokeWidth="1.2" /></marker>
          </defs>
          {layout.pools.map((pool, index) => <g key={pool.id}>
            <rect x={pool.x} y={pool.y} width={pool.width} height={pool.height} rx="8" fill={index % 2 ? "#fffdfb" : "#ffffff"} stroke="#dbe4e9" strokeWidth="1.3" />
            <path d={`M ${pool.x + 8} ${pool.y} H ${pool.x + pool.width - 8} Q ${pool.x + pool.width} ${pool.y} ${pool.x + pool.width} ${pool.y + 8} V ${pool.y + 36} H ${pool.x} V ${pool.y + 8} Q ${pool.x} ${pool.y} ${pool.x + 8} ${pool.y} Z`} fill="#f0f3fa" />
            <text x={pool.x + 16} y={pool.y + 23} fill="#586178" fontSize="12" fontWeight="600">{pool.name || "Adsız pool"}</text>
            <text x={pool.x + pool.width - 16} y={pool.y + 23} textAnchor="end" fill="#929aac" fontSize="10">POOL {index + 1}</text>
          </g>)}
          {layout.lanes.map((lane, index) => <g key={lane.id}>
            <rect x={lane.x} y={lane.y} width={lane.width} height={lane.height} fill={index % 2 ? "#fcfdfe" : "#ffffff"} stroke="#e3e9ed" strokeWidth="1" />
            <rect x={lane.x} y={lane.y} width={136} height={lane.height} fill={index % 2 ? "#f5f8fa" : "#f8fafb"} />
            <line x1={lane.x + 136} y1={lane.y} x2={lane.x + 136} y2={lane.y + lane.height} stroke="#e3e9ed" />
            <TextLines text={lane.name || "Adsız iştirakçı"} x={lane.x + 68} y={lane.y + lane.height / 2 + 4} width={113} maxLines={5} size={12} color="#667480" />
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
              <path d={path} fill="none" stroke={edge.message && !association ? "#9a87bf" : "#81939d"} strokeWidth="1.65" strokeDasharray={association ? "2 4" : edge.message ? "6 5" : undefined} strokeLinejoin="round" strokeLinecap="round" markerEnd={association ? undefined : `url(#${markerPrefix}-${edge.message ? "message" : "arrow"})`} />
              {edge.message && !association && <circle cx={edge.points[0].x} cy={edge.points[0].y} r="3" fill="white" stroke="#9a87bf" strokeWidth="1.3" />}
              {edge.label && <g>
                <rect x={label.x - labelWidth / 2} y={label.y - 10 - (labelLines.length > 1 ? 6 : 0)} width={labelWidth} height={labelLines.length > 1 ? 29 : 19} rx="4" fill="#ffffff" fillOpacity="0.97" />
                <TextLines text={edge.label} x={label.x} y={label.y + 3} width={labelWidth - 10} maxLines={2} size={10} color="#778690" />
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
            const stroke = selected ? "#159c88" : gateway ? "#c0a45f" : event ? step.type === "start" ? "#42ae95" : step.type === "end" ? "#d88781" : "#8c9ac0" : "#99b9c5";
            const fill = gateway ? "#fffaf0" : step.type === "start" ? "#eaf8f2" : step.type === "end" ? "#fff0ec" : event ? "#f1f2fc" : step.type === "annotation" ? "#faf8ff" : "#f3fafb";
            return <g key={node.id} data-step-id={node.id} role="button" tabIndex={0} aria-label={`${typeLabels[step.type]}: ${step.title || "Adsız addım"}`} aria-pressed={selected} onClick={() => onSelect(node.id)} onKeyDown={(key) => { if (key.key === "Enter" || key.key === " ") { key.preventDefault(); onSelect(node.id); } }} style={{ cursor: "pointer", outlineOffset: 4 }}>
              <title>{`${typeLabels[step.type]}: ${step.title || "Adsız addım"}`}</title>
              {selected && <rect x={x - 6} y={y - 6} width={width + 12} height={height + 12} rx={event ? r + 6 : 12} fill="none" stroke="#1aad96" strokeOpacity="0.3" strokeWidth="3" />}
              {gateway ? <>
                <path d={`M ${cx} ${y} L ${x + width} ${cy} L ${cx} ${y + height} L ${x} ${cy} Z`} fill={fill} stroke={stroke} strokeWidth={selected ? 2.5 : 1.8} />
                {step.type === "or" ? <circle cx={cx} cy={cy} r="11" fill="none" stroke="#ae934e" strokeWidth="2.2" /> : <text x={cx} y={cy + 7} textAnchor="middle" fill="#ae934e" fontSize={step.type === "and" ? 29 : 24} fontWeight="500">{step.type === "and" ? "+" : "×"}</text>}
                <TextLines text={step.title} x={cx} y={y + height + 23} width={130} maxLines={2} size={11} />
              </> : event ? <>
                <circle cx={cx} cy={cy} r={r - 1} fill={fill} stroke={stroke} strokeWidth={step.type === "end" ? 3 : selected ? 2.5 : 1.8} />
                {["end", "intermediate", "message", "timer"].includes(step.type) && <circle cx={cx} cy={cy} r={r - 6} fill="none" stroke={stroke} strokeWidth="1" />}
                {step.type === "message" && <g stroke="#8491b5" strokeWidth="1.4" fill="none"><rect x={cx - 11} y={cy - 7} width="22" height="14" rx="1" /><path d={`M ${cx - 11} ${cy - 7} L ${cx} ${cy + 1} L ${cx + 11} ${cy - 7}`} /></g>}
                {step.type === "timer" && <g stroke="#8491b5" strokeWidth="1.4" fill="none"><circle cx={cx} cy={cy} r="12" /><path d={`M ${cx} ${cy - 8} V ${cy} L ${cx + 6} ${cy + 4}`} />{[0, 1, 2, 3].map((tick) => <line key={tick} x1={cx} y1={cy - 12} x2={cx} y2={cy - 9} transform={`rotate(${tick * 90} ${cx} ${cy})`} />)}</g>}
                {step.type === "start" && <circle cx={cx} cy={cy} r="4" fill="#42ae95" />}
                {step.type === "end" && <rect x={cx - 4} y={cy - 4} width="8" height="8" rx="1" fill="#d88781" />}
                <TextLines text={step.title} x={cx} y={y + height + 22} width={120} maxLines={2} size={11} />
              </> : step.type === "data" ? <>
                <path d={`M ${x} ${y} H ${x + width - 17} L ${x + width} ${y + 17} V ${y + height} H ${x} Z M ${x + width - 17} ${y} V ${y + 17} H ${x + width}`} fill="#f4f3fd" stroke={selected ? "#159c88" : "#a9a1c8"} strokeWidth="1.7" />
                <TextLines text={step.title} x={cx} y={cy + 4} width={width - 24} maxLines={4} />
              </> : step.type === "annotation" ? <>
                <rect x={x} y={y} width={width} height={height} fill={fill} />
                <path d={`M ${x + 12} ${y} H ${x} V ${y + height} H ${x + 12}`} stroke={selected ? "#159c88" : "#aea4c6"} strokeWidth="2" fill="none" />
                <TextLines text={step.title} x={cx + 3} y={cy + 4} width={width - 24} maxLines={4} size={11} color="#82758f" />
              </> : <>
                <rect x={x} y={y} width={width} height={height} rx="9" fill={fill} stroke={stroke} strokeWidth={selected ? 2.5 : 1.6} />
                {step.type === "userTask" && <g transform={`translate(${x + 13} ${y + 11})`} stroke="#7d9eaa" strokeWidth="1.4" fill="none"><circle cx="4" cy="3" r="2.5" /><path d="M 0 11 V 9 Q 0 6 4 6 Q 8 6 8 9 V 11" /></g>}
                {step.type === "serviceTask" && <g transform={`translate(${x + 17} ${y + 16})`} stroke="#7d9eaa" strokeWidth="1.4" fill="none"><circle r="5" /><circle r="1.8" />{[0, 1, 2, 3].map((tick) => <line key={tick} x1="0" y1="-8" x2="0" y2="-5" transform={`rotate(${tick * 90})`} />)}</g>}
                <TextLines text={step.title} x={cx} y={cy + (step.type === "subprocess" ? -1 : 4)} width={width - 26} maxLines={step.type === "subprocess" ? 3 : 4} />
                {step.type === "subprocess" && <g><rect x={cx - 6} y={y + height - 17} width="12" height="12" rx="1" fill="#fff" stroke="#80a4b2" /><path d={`M ${cx - 3} ${y + height - 11} H ${cx + 3} M ${cx} ${y + height - 14} V ${y + height - 8}`} fill="none" stroke="#80a4b2" strokeWidth="1.2" /></g>}
              </>}
            </g>;
          })}
          {!layout.nodes.length && <g>
            <text x={diagramWidth / 2} y={diagramHeight / 2 - 8} textAnchor="middle" fill="#73818d" fontSize="16" fontWeight="500">İlk addımınızı əlavə edin</text>
            <text x={diagramWidth / 2} y={diagramHeight / 2 + 20} textAnchor="middle" fill="#a0aab3" fontSize="12">Cədvəli doldurduqca diaqram burada yaranacaq.</text>
          </g>}
        </svg>
      </div>
    </div>
    <div className="diagram-legend" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 10, padding: "12px 20px", background: "#fff", borderTop: "1px solid #e9eef2", fontSize: 10, color: "#8a96a1" }}>
      <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 14 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 8, height: 8, border: "1.5px solid #42ae95", background: "#eaf8f2", borderRadius: "50%" }} />Başlanğıc</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 11, height: 8, border: "1px solid #99b9c5", background: "#f3fafb", borderRadius: 2 }} />Tapşırıq</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 7, height: 7, border: "1px solid #c0a45f", background: "#fffaf0", transform: "rotate(45deg)" }} />Keçid</span>
        <span style={{ display: "flex", alignItems: "center", gap: 5 }}><span style={{ width: 16, borderTop: "1px dashed #9a87bf" }} />Pool-lararası mesaj</span>
      </div>
      <span style={{ display: "flex", alignItems: "center", gap: 4 }}><MousePointer2 size={10} />Addımı seçmək üçün üzərinə klikləyin</span>
    </div>
  </div>;
}
