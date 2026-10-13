"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Circle, Copy, Diamond, Expand, Minus, MousePointer2, Move, Pencil, Plus, Redo2, RotateCcw, Scan, Shrink, Square, StickyNote, Trash2, Undo2, Waypoints } from "lucide-react";
import { clampNodePosition, layoutProject } from "@/lib/layout";
import { displayRouteLabel, getStepNumber } from "@/lib/step-numbering";
import type { LayoutLane, LayoutPoint, Project, StepType } from "@/lib/types";

export type DiagramRouteSelection = { sourceId: string; routeIndex: number };

type DiagramProps = {
  project: Project;
  selectedId?: string | null;
  onSelect: (id: string) => void;
  selectedRoute?: DiagramRouteSelection | null;
  onMoveStep?: (id: string, position: LayoutPoint, laneId?: string) => void;
  onEditStep?: (id: string) => void;
  onSelectRoute?: (sourceId: string, routeIndex: number) => void;
  onEditRoute?: (sourceId: string, routeIndex: number) => void;
  onConnect?: (sourceId: string, targetId: string) => void;
  onResetLayout?: () => void;
  onDeleteStep?: (id: string) => void;
  onReconnectRoute?: (selection: DiagramRouteSelection, endpoint: "source" | "target", nodeId: string) => boolean;
  onDuplicateStep?: (id: string) => void;
  onDeleteRoute?: (selection: DiagramRouteSelection) => void;
  onAddShape?: (type: StepType) => void;
  controlsDisabled?: boolean;
  onUndo?: () => void;
  canUndo?: boolean;
  onRedo?: () => void;
  canRedo?: boolean;
  children?: ReactNode;
};

type DragGesture = {
  kind: "node"; id: string; pointerId: number; start: LayoutPoint; origin: LayoutPoint;
  clientX: number; clientY: number; position: LayoutPoint; moved: boolean;
  originalLaneId: string; laneId: string | null; lanes: LayoutLane[]; width: number; height: number;
  originalY: number;
};
type ReconnectChoice = { selection: DiagramRouteSelection; endpoint: "source" | "target" };
type ReconnectGesture = ReconnectChoice & {
  kind: "reconnect"; pointerId: number; clientX: number; clientY: number;
  point: LayoutPoint; targetId: string | null; moved: boolean;
};
type ConnectGesture = {
  kind: "connect"; id: string; pointerId: number; clientX: number; clientY: number;
  point: LayoutPoint; targetId: string | null; moved: boolean;
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

function TextLines({ text, x, y, width = 140, maxLines = 4, size = 12, color = "#14181D" }: {
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

export default function Diagram({ project, selectedId, selectedRoute, onSelect, onMoveStep, onEditStep, onSelectRoute, onEditRoute, onConnect, onResetLayout, onDeleteStep, onReconnectRoute, onDuplicateStep, onDeleteRoute, onAddShape, controlsDisabled = false, onUndo, canUndo = false, onRedo, canRedo = false, children }: DiagramProps) {
  const [draftPosition, setDraftPosition] = useState<{ id: string; point: LayoutPoint; laneId: string | null } | null>(null);
  const baseLayout = useMemo(() => layoutProject(project), [project]);
  const layout = useMemo(() => {
    if (!draftPosition) return baseLayout;
    // Keep lane hit regions fixed while dragging. Re-running automatic layout at
    // every pointer move can grow the original lane and prevent crossing it.
    const original = baseLayout.nodes.find((node) => node.id === draftPosition.id);
    if (!original) return baseLayout;
    const moved = { ...original, ...draftPosition.point };
    const dx = moved.x - original.x, dy = moved.y - original.y;
    return {
      ...baseLayout,
      nodes: baseLayout.nodes.map((node) => node.id === moved.id ? moved : node),
      edges: baseLayout.edges.map((edge) => {
        if (edge.sourceId !== moved.id && edge.targetId !== moved.id) return edge;
        const first = edge.points[0], last = edge.points[edge.points.length - 1];
        const start = edge.sourceId === moved.id ? { x: first.x + dx, y: first.y + dy } : first;
        const end = edge.targetId === moved.id ? { x: last.x + dx, y: last.y + dy } : last;
        const channelX = start.x + 28;
        return { ...edge, points: [start, { x: channelX, y: start.y }, { x: channelX, y: end.y }, end] };
      }),
    };
  }, [baseLayout, draftPosition]);
  const stepById = useMemo(() => new Map(project.steps.map((step) => [step.id, step])), [project.steps]);
  const panel = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const captureElement = useRef<SVGElement | HTMLDivElement | null>(null);
  const gesture = useRef<DragGesture | ConnectGesture | ReconnectGesture | null>(null);
  const suppressClick = useRef(false);
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
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [connection, setConnection] = useState<{ sourceId: string; point: LayoutPoint; targetId: string | null } | null>(null);
  const [connectionSource, setConnectionSource] = useState<string | null>(null);
  const [reconnectChoice, setReconnectChoice] = useState<ReconnectChoice | null>(null);
  const [reconnectPreview, setReconnectPreview] = useState<(ReconnectChoice & { point: LayoutPoint; targetId: string | null }) | null>(null);
  const [activeTool, setActiveTool] = useState<"select" | "pan" | "connect">("select");
  const [editNotice, setEditNotice] = useState("");
  const markerPrefix = useId().replace(/:/g, "");
  const diagramWidth = Math.max(560, layout.width);
  const diagramHeight = Math.max(360, layout.height);

  const releasePointer = useCallback((pointerId: number) => {
    const element = captureElement.current;
    captureElement.current = null;
    if (element?.hasPointerCapture(pointerId)) element.releasePointerCapture(pointerId);
    const view = viewport.current;
    if (view?.hasPointerCapture(pointerId)) view.releasePointerCapture(pointerId);
  }, []);

  const cancelGesture = useCallback(() => {
    const current = gesture.current;
    gesture.current = null;
    setDraftPosition(null);
    setDraggingId(null);
    setConnection(null);
    setReconnectPreview(null);
    if (current) releasePointer(current.pointerId);
  }, [releasePointer]);

  useEffect(() => {
    if (previousProject.current === project.id) return;
    previousProject.current = project.id;
    previousSelection.current = "";
    pendingScroll.current = null;
    pan.current = null;
    gesture.current = null;
    setDraftPosition(null);
    setDraggingId(null);
    setConnection(null);
    setConnectionSource(null);
    setReconnectChoice(null);
    setReconnectPreview(null);
    setActiveTool("select");
    fittedProject.current = project.id;
    setPanning(false);
    setFitted(true);
    viewport.current?.scrollTo({ left: 0, top: 0 });
  }, [project.id]);

  useEffect(() => {
    const handleFullscreen = () => setFullscreen(document.fullscreenElement === panel.current);
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { cancelGesture(); setConnectionSource(null); setReconnectChoice(null); setActiveTool("select"); setExpanded(false); setFullscreenNotice(""); }
    };
    document.addEventListener("fullscreenchange", handleFullscreen);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreen);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [cancelGesture]);

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
    if (gesture.current?.kind === "node") return;
    const selection = `${project.id}:${node.id}:${Boolean(children)}`;
    // Deliberate panning and zooming should not jump back to an unchanged selection.
    if (previousSelection.current === selection) return;
    previousSelection.current = selection;
    const view = viewport.current;
    const matrix = svg.current?.getScreenCTM();
    const rectangle = view.getBoundingClientRect();
    const center = matrix ? new DOMPoint(node.x + node.width / 2, node.y + node.height / 2).matrixTransform(matrix) : null;
    const left = center ? center.x - rectangle.left + view.scrollLeft : (node.x + node.width / 2) * zoom + 24;
    const top = center ? center.y - rectangle.top + view.scrollTop : (node.y + node.height / 2) * zoom + 24;
    if (left < view.scrollLeft + 50 || left > view.scrollLeft + view.clientWidth - 50 || top < view.scrollTop + 40 || top > view.scrollTop + view.clientHeight - 40) {
      view.scrollTo({ left: Math.max(0, left - view.clientWidth / 2), top: Math.max(0, top - view.clientHeight / 2), behavior: "smooth" });
    }
  }, [project.id, selectedId, layout.nodes, zoom, children]);

  useEffect(() => {
    if (pendingScroll.current && viewport.current) viewport.current.scrollTo(pendingScroll.current);
    pendingScroll.current = null;
  }, [zoom]);

  useEffect(() => {
    if (!editNotice) return;
    const timeout = window.setTimeout(() => setEditNotice(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [editNotice]);

  useEffect(() => {
    // A pending endpoint belongs to one exact route in one model snapshot.
    // Selection changes, deletion and history must never retarget a stale route.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Release DOM pointer capture and clear its preview when the model snapshot invalidates it.
    cancelGesture();
    setReconnectChoice(null);
    setConnectionSource(null);
  }, [project.steps, selectedRoute?.sourceId, selectedRoute?.routeIndex, cancelGesture]);

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

  function diagramPoint(clientX: number, clientY: number): LayoutPoint | null {
    const matrix = svg.current?.getScreenCTM();
    if (!matrix) return null;
    try {
      const point = new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse());
      return { x: point.x, y: point.y };
    } catch { return null; }
  }

  function capturePointer(pointerId: number, element: SVGElement | HTMLDivElement | null = viewport.current) {
    captureElement.current = element;
    try { element?.setPointerCapture(pointerId); } catch { /* The pointer may have ended before capture. */ }
  }

  function beginNodeDrag(event: ReactPointerEvent<SVGGElement>, id: string) {
    if (!event.isPrimary || event.button !== 0 || !onMoveStep || connectionSource || reconnectChoice || activeTool !== "select") return;
    const step = stepById.get(id);
    const node = layout.nodes.find((item) => item.id === id);
    const lane = layout.lanes.find((item) => item.id === step?.laneId);
    const point = diagramPoint(event.clientX, event.clientY);
    if (!node || !lane || !point) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.focus({ preventScroll: true });
    const origin = { x: node.x, y: node.y - lane.y };
    gesture.current = {
      kind: "node", id, pointerId: event.pointerId, start: point, origin,
      clientX: event.clientX, clientY: event.clientY, position: origin, moved: false,
      originalLaneId: lane.id, laneId: lane.id, lanes: baseLayout.lanes,
      width: node.width, height: node.height, originalY: node.y,
    };
    capturePointer(event.pointerId, event.currentTarget);
  }

  function beginConnection(event: ReactPointerEvent<SVGGElement>, id: string) {
    if (!event.isPrimary || event.button !== 0 || !onConnect) return;
    const point = diagramPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    setConnectionSource(null);
    setReconnectChoice(null);
    gesture.current = { kind: "connect", id, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, point, targetId: null, moved: false };
    setConnection({ sourceId: id, point, targetId: null });
    capturePointer(event.pointerId, event.currentTarget);
  }

  function beginReconnect(event: ReactPointerEvent<SVGGElement>, selection: DiagramRouteSelection, endpoint: "source" | "target") {
    if (!event.isPrimary || event.button !== 0 || !onReconnectRoute || activeTool === "pan") return;
    const point = diagramPoint(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    cancelGesture();
    setConnectionSource(null);
    setActiveTool("select");
    setReconnectChoice(null);
    gesture.current = { kind: "reconnect", selection, endpoint, pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY, point, targetId: null, moved: false };
    setReconnectPreview({ selection, endpoint, point, targetId: null });
    capturePointer(event.pointerId, event.currentTarget);
  }

  function reconnectToNode(choice: ReconnectChoice, id: string) {
    const accepted = onReconnectRoute?.(choice.selection, choice.endpoint, id) ?? false;
    setEditNotice(accepted ? "Keçidin ucu dəyişdirildi. Etiket və izah saxlanıldı." : "Bu fiqura birləşdirmək mümkün deyil. Keçid dəyişdirilmədi.");
    setReconnectChoice(null);
    setReconnectPreview(null);
    setActiveTool("select");
  }

  function moveGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return false;
    const point = diagramPoint(event.clientX, event.clientY);
    if (!point) return true;
    if (!current.moved && Math.hypot(event.clientX - current.clientX, event.clientY - current.clientY) >= 4) {
      current.moved = true;
      stopAutomaticFit();
    }
    if (current.kind === "node") {
      if (!current.moved) return true;
      const absolute = { x: current.origin.x + point.x - current.start.x, y: current.originalY + point.y - current.start.y };
      const center = { x: absolute.x + current.width / 2, y: absolute.y + current.height / 2 };
      const lane = current.lanes.find((item) => center.x >= item.x + 136 && center.x <= item.x + item.width && center.y >= item.y && center.y <= item.y + item.height);
      current.laneId = lane?.id ?? null;
      current.position = clampNodePosition({ x: absolute.x, y: lane ? Math.min(lane.height - current.height - 16, absolute.y - lane.y) : current.origin.y });
      setDraggingId(current.id);
      setDraftPosition({ id: current.id, point: { x: current.position.x, y: lane ? lane.y + current.position.y : absolute.y }, laneId: current.laneId });
    } else if (current.kind === "connect") {
      current.point = point;
      current.targetId = layout.nodes.find((node) => node.id !== current.id && point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height)?.id ?? null;
      setConnection({ sourceId: current.id, point, targetId: current.targetId });
    } else {
      current.point = point;
      current.targetId = layout.nodes.find((node) => point.x >= node.x && point.x <= node.x + node.width && point.y >= node.y && point.y <= node.y + node.height)?.id ?? null;
      setReconnectPreview({ selection: current.selection, endpoint: current.endpoint, point, targetId: current.targetId });
    }
    return true;
  }

  function finishGesture(event: ReactPointerEvent<HTMLDivElement>) {
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return false;
    gesture.current = null;
    suppressClick.current = true;
    // A pointer release also dispatches click; consume it without hiding the next deliberate click.
    window.setTimeout(() => { suppressClick.current = false; }, 0);
    if (current.kind === "node") {
      if (current.moved && current.laneId && (current.laneId !== current.originalLaneId || current.position.x !== current.origin.x || current.position.y !== current.origin.y)) {
        onMoveStep?.(current.id, current.position, current.laneId);
        setEditNotice(current.laneId !== current.originalLaneId ? "Addım digər iştirakçıya keçirildi. İzahda icraçı yeniləndi." : "Addımın yeri saxlanıldı.");
      } else if (current.moved && !current.laneId) {
        setEditNotice("Addımı iştirakçı sahəsinə burax. Dəyişiklik ləğv edildi.");
      }
      onSelect(current.id);
    } else if (current.kind === "reconnect") {
      if (current.moved && current.targetId) reconnectToNode(current, current.targetId);
      else if (!current.moved) setReconnectChoice({ selection: current.selection, endpoint: current.endpoint });
      else setEditNotice("Keçidin ucunu fiqura burax. Keçid dəyişdirilmədi.");
    } else if (current.targetId) {
      onConnect?.(current.id, current.targetId);
      setConnectionSource(null);
      setActiveTool("select");
    } else if (!current.moved) {
      setConnectionSource(current.id);
    }
    setDraftPosition(null);
    setDraggingId(null);
    setConnection(null);
    setReconnectPreview(null);
    releasePointer(event.pointerId);
    return true;
  }

  function selectNode(id: string) {
    if (activeTool === "pan") return;
    if (suppressClick.current) { suppressClick.current = false; return; }
    if (reconnectChoice) { reconnectToNode(reconnectChoice, id); return; }
    if (connectionSource && connectionSource !== id) {
      onConnect?.(connectionSource, id);
      setConnectionSource(null);
      setActiveTool("select");
      return;
    }
    if (activeTool === "connect") {
      if (stepById.get(id)?.type === "end") { setEditNotice("Son hadisəsindən yeni keçid yaradıla bilməz."); return; }
      setConnectionSource(id);
    }
    onSelect(id);
  }

  function selectTool(tool: "select" | "pan" | "connect") {
    cancelGesture();
    setActiveTool(tool);
    setReconnectChoice(null);
    setConnectionSource(tool === "connect" && selectedId && stepById.get(selectedId)?.type !== "end" ? selectedId : null);
  }

  function addShape(type: StepType) {
    selectTool("select");
    onAddShape?.(type);
  }

  function nudgeNode(id: string, event: ReactKeyboardEvent) {
    if (!onMoveStep || !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key) || event.altKey || event.ctrlKey || event.metaKey) return false;
    const step = stepById.get(id);
    const node = layout.nodes.find((item) => item.id === id);
    const lane = layout.lanes.find((item) => item.id === step?.laneId);
    if (!node || !lane) return false;
    event.preventDefault();
    event.stopPropagation();
    stopAutomaticFit();
    const distance = event.shiftKey ? 10 : 1;
    const position = clampNodePosition({
      x: node.x + (event.key === "ArrowLeft" ? -distance : event.key === "ArrowRight" ? distance : 0),
      y: Math.min(lane.height - node.height - 16, node.y - lane.y + (event.key === "ArrowUp" ? -distance : event.key === "ArrowDown" ? distance : 0)),
    });
    onMoveStep(id, position);
    return true;
  }

  function handleEditorShortcut(event: ReactKeyboardEvent<HTMLDivElement>) {
    const target = event.target as Element;
    if (target.closest("input, textarea, select, [contenteditable='true']")) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "z") {
      if (event.shiftKey ? onRedo && canRedo : onUndo && canUndo) {
        event.preventDefault();
        cancelGesture();
        setReconnectChoice(null);
        if (event.shiftKey) onRedo?.(); else onUndo?.();
      }
    } else if (modifier && event.key.toLowerCase() === "y" && onRedo && canRedo) {
      event.preventDefault(); cancelGesture(); setReconnectChoice(null); onRedo();
    } else if (modifier && event.key.toLowerCase() === "d" && onDuplicateStep && (selectedId || selectedRoute)) {
      event.preventDefault();
      if (selectedId && !selectedRoute && !controlsDisabled) onDuplicateStep(selectedId);
      else if (selectedRoute) setEditNotice("Surətini yaratmaq üçün keçid deyil, fiqur seç.");
    } else if (!modifier && (event.key === "Delete" || event.key === "Backspace") && event.target === viewport.current) {
      if (selectedRoute && onDeleteRoute) { event.preventDefault(); onDeleteRoute(selectedRoute); }
      else if (selectedId && onDeleteStep) { event.preventDefault(); onDeleteStep(selectedId); }
    }
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

  const selectedStep = selectedId ? stepById.get(selectedId) : undefined;
  const selectedEdge = selectedRoute ? layout.edges.find((edge) => edge.sourceId === selectedRoute.sourceId && edge.routeIndex === selectedRoute.routeIndex) : undefined;
  const dropLaneName = draftPosition?.laneId ? baseLayout.lanes.find((lane) => lane.id === draftPosition.laneId)?.name : null;
  const canEditSelection = selectedRoute ? Boolean(onEditRoute) : Boolean(selectedStep && onEditStep);
  function editSelection() {
    cancelGesture();
    setReconnectChoice(null);
    if (selectedRoute) onEditRoute?.(selectedRoute.sourceId, selectedRoute.routeIndex);
    else if (selectedId) onEditStep?.(selectedId);
  }

  return <div ref={panel} className={`diagram-panel${expanded ? " diagram-fullscreen" : ""}${children ? " has-inspector" : ""}`} onKeyDown={handleEditorShortcut}>
    <div className="diagram-toolbar">
      <div className="diagram-controls">
        {onUndo && <button type="button" className="diagram-control" aria-label="Son dəyişikliyi geri al" title="Geri al" onClick={onUndo} disabled={!canUndo}><Undo2 size={17} /></button>}
        {onRedo && <button type="button" className="diagram-control" aria-label="Geri alınmış dəyişikliyi yenidən tətbiq et" title="Yenidən tətbiq et" onClick={onRedo} disabled={!canRedo}><Redo2 size={17} /></button>}
        {onResetLayout && <button type="button" className="diagram-control" aria-label="Diaqramı avtomatik düz" title="Avtomatik düz" onClick={onResetLayout} disabled={!project.steps.some((step) => step.position)}><RotateCcw size={15} /></button>}
        <button type="button" className="diagram-control" aria-label="Diaqramı kiçilt" title="Kiçilt" onClick={() => changeZoom(zoom - 0.1)} disabled={zoom <= MIN_MANUAL_ZOOM}><Minus size={15} /></button>
        <span className="diagram-zoom" aria-live="polite">{zoom < 0.1 ? Math.round(zoom * 1000) / 10 : Math.round(zoom * 100)}%</span>
        <button type="button" className="diagram-control" aria-label="Diaqramı böyüt" title="Böyüt" onClick={() => changeZoom(zoom + 0.1)} disabled={zoom >= MAX_ZOOM}><Plus size={15} /></button>
        <span className="diagram-controls-divider" />
        <button type="button" className="diagram-control" aria-label="Bütün diaqramı ekrana sığdır" title="Ekrana sığdır" onClick={fit}><Scan size={15} /></button>
        <button type="button" className="diagram-control" aria-label={fullscreen || expanded ? "Tam ekrandan çıx" : "Diaqramı tam ekranda aç"} aria-pressed={fullscreen || expanded} title={fullscreen || expanded ? "Tam ekrandan çıx" : "Tam ekran"} onClick={() => void toggleFullscreen()}>{fullscreen || expanded ? <Shrink size={15} /> : <Expand size={15} />}</button>
      </div>
    </div>
    {(selectedStep || selectedEdge) && <div className="diagram-selection-actions" role="toolbar" aria-label="Seçilmiş elementin əməliyyatları">
      {canEditSelection && <button type="button" className="diagram-selection-action has-label" aria-label={selectedRoute ? "Seçilmiş keçidi redaktə et" : "Seçilmiş fiquru redaktə et"} title={selectedRoute ? "Keçidin etiketi, izahı və uclarını redaktə et" : "Addımın adı, icraçısı, növü və izahını redaktə et"} onClick={editSelection}><Pencil size={16} /><span>Redaktə et</span></button>}
      {selectedStep && !selectedRoute && onDuplicateStep && <button type="button" className="diagram-selection-action" aria-label="Seçilmiş fiqurun surətini yarat" title="Surətini yarat · Ctrl+D" disabled={controlsDisabled} onClick={() => onDuplicateStep(selectedStep.id)}><Copy size={16} /><span>Surətini yarat</span></button>}
      {(selectedRoute ? onDeleteRoute : selectedStep && onDeleteStep) && <button type="button" className="diagram-selection-action danger-icon" aria-label={selectedRoute ? "Diaqramda seçilmiş keçidi sil" : "Diaqramda seçilmiş fiquru sil"} title="Sil · Delete" onClick={() => { if (selectedRoute) onDeleteRoute?.(selectedRoute); else if (selectedStep) onDeleteStep?.(selectedStep.id); }}><Trash2 size={16} /><span>Sil</span></button>}
    </div>}
    {fullscreenNotice && <div className="diagram-notice" role="status">{fullscreenNotice}</div>}
    {(onMoveStep || onEditStep) && <div className="diagram-editor-hint" aria-live="polite">{reconnectChoice || reconnectPreview ? `Keçidin ${reconnectChoice?.endpoint === "source" || reconnectPreview?.endpoint === "source" ? "başlanğıcı" : "hədəfi"} üçün fiqur seç və ya ucunu fiqura sürüşdür. Esc ilə ləğv et.` : draggingId ? dropLaneName ? `İcraçı: ${dropLaneName} · Buraxdıqda izah yenilənir` : "Addımı iştirakçı sahəsinə burax · Esc ilə ləğv et" : connectionSource ? "Keçidi yaratmaq üçün digər addımı seç. Esc ilə ləğv et." : activeTool === "connect" ? "Keçidin başladığı fiquru seç." : activeTool === "pan" ? "Sahəni tut və sürüşdür · Esc ilə seçimə qayıt" : selectedRoute ? "Keçidin ucundakı dairəni sürüşdür · Etiketə basıb izahı redaktə et" : "Elementi seç · Başqa iştirakçıya sürüşdür · İki kliklə redaktə et"}</div>}
    <span className="sr-only" role="status">{editNotice}</span>
    <div ref={viewport} className={`diagram-viewport${panning ? " is-panning" : ""}${activeTool === "pan" ? " is-pan-tool" : ""}${draggingId ? " is-dragging-node" : ""}${connection || connectionSource || reconnectChoice || reconnectPreview ? " is-connecting" : ""}`} tabIndex={0} role="region" aria-label="Diaqram sahəsi. Fiqurları iştirakçılar arasında sürüşdürün. Keçidin ucunu başqa fiqura birləşdirin. Seçilmiş fiquru ox düymələri ilə hərəkət etdirin."
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
        if (!event.isPrimary || event.button !== 0 || (activeTool !== "pan" && (event.target as Element).closest("[data-step-id], [data-route-index], [data-connection-handle], [data-route-handle]"))) return;
        if (reconnectChoice) { setReconnectChoice(null); setEditNotice("Keçidin dəyişdirilməsi ləğv edildi."); return; }
        if (connectionSource) { setConnectionSource(null); return; }
        const view = viewport.current;
        if (!view) return;
        pan.current = { x: event.clientX, y: event.clientY, left: view.scrollLeft, top: view.scrollTop, moved: false };
        setPanning(true); view.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (moveGesture(event)) return;
        if (!pan.current || !viewport.current) return;
        const view = viewport.current;
        if (!pan.current.moved && (Math.abs(pan.current.x - event.clientX) > 2 || Math.abs(pan.current.y - event.clientY) > 2) && (view.scrollWidth > view.clientWidth + 1 || view.scrollHeight > view.clientHeight + 1)) {
          pan.current.moved = true;
          stopAutomaticFit();
        }
        viewport.current.scrollLeft = pan.current.left + pan.current.x - event.clientX;
        viewport.current.scrollTop = pan.current.top + pan.current.y - event.clientY;
      }}
      onPointerUp={(event) => { if (finishGesture(event)) return; pan.current = null; setPanning(false); releasePointer(event.pointerId); }}
      onLostPointerCapture={() => { cancelGesture(); pan.current = null; setPanning(false); }}
      onPointerCancel={() => { cancelGesture(); pan.current = null; setPanning(false); }}>
      <div className="diagram-surface" style={{ width: diagramWidth * zoom + 48, height: diagramHeight * zoom + 48 }}>
        <svg ref={svg} className="diagram-svg" id="process-diagram" xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${diagramWidth} ${diagramHeight}`} width={diagramWidth * zoom} height={diagramHeight * zoom} role="group" aria-label="İş axınının BPMN diaqramı" style={{ fontFamily: "'DM Sans', sans-serif" }}>
          <title>İş axınının BPMN diaqramı</title>
          <rect x="0" y="0" width={diagramWidth} height={diagramHeight} fill="transparent" />
          <defs>
            <marker id={`${markerPrefix}-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth"><path d="M 0 0 L 8 4 L 0 8 z" fill="context-stroke" /></marker>
            <marker id={`${markerPrefix}-message`} markerWidth="9" markerHeight="9" refX="8" refY="4.5" orient="auto" markerUnits="strokeWidth"><path d="M 1 1 L 8 4.5 L 1 8" fill="none" stroke="context-stroke" strokeWidth="1.2" /></marker>
          </defs>
          <text className="diagram-project-title" x={16} y={7} fill="#14181D" fontSize={14 / zoom} fontWeight="600" letterSpacing={-0.2 / zoom}>
            <title>{project.name || "Yeni iş axını"}</title>
            {wrapText(project.name || "Yeni iş axını", Math.max(8, Math.floor((diagramWidth - 32) * zoom / 7.6)), 1)[0]}
          </text>
          {layout.pools.map((pool, index) => <g key={pool.id}>
            <rect x={pool.x} y={pool.y} width={pool.width} height={pool.height} rx="8" fill="#FFFFFF" stroke="#D5DBE2" strokeWidth="1.3" />
            <path d={`M ${pool.x + 8} ${pool.y} H ${pool.x + pool.width - 8} Q ${pool.x + pool.width} ${pool.y} ${pool.x + pool.width} ${pool.y + 8} V ${pool.y + 36} H ${pool.x} V ${pool.y + 8} Q ${pool.x} ${pool.y} ${pool.x + 8} ${pool.y} Z`} fill="#F8FAFB" />
            <text x={pool.x + 16} y={pool.y + 23} fill="#14181D" fontSize="12" fontWeight="600"><title>{pool.name || "Adsız pool"}</title>{wrapText(pool.name || "Adsız pool", Math.max(8, Math.floor((pool.width - 124) / 6.5)), 1)[0]}</text>
            <text x={pool.x + pool.width - 16} y={pool.y + 23} textAnchor="end" fill="#566270" fontSize="10">POOL {index + 1}</text>
          </g>)}
          {layout.lanes.map((lane) => <g key={lane.id}>
            <title>{lane.name || "Adsız iştirakçı"}</title>
            <rect x={lane.x} y={lane.y} width={lane.width} height={lane.height} fill="#FFFFFF" stroke="#D5DBE2" strokeWidth="1" />
            <rect x={lane.x} y={lane.y} width={136} height={lane.height} fill="#F8FAFB" />
            <line x1={lane.x + 136} y1={lane.y} x2={lane.x + 136} y2={lane.y + lane.height} stroke="#D5DBE2" />
            <TextLines text={lane.name || "Adsız iştirakçı"} x={lane.x + 68} y={lane.y + lane.height / 2 + 4} width={113} maxLines={5} size={12} color="#566270" />
            {draftPosition?.laneId === lane.id && <rect className="diagram-lane-drop-target" data-editor-only="lane-drop-target" data-drop-lane-id={lane.id} x={lane.x + 2} y={lane.y + 2} width={lane.width - 4} height={lane.height - 4} fill="#2548E8" fillOpacity="0.06" stroke="#2548E8" strokeWidth="2" strokeDasharray="6 4" pointerEvents="none" />}
          </g>)}
          {layout.edges.map((edge, index) => {
            if (edge.points.length < 2) return null;
            const association = [stepById.get(edge.sourceId)?.type, stepById.get(edge.targetId)?.type].some(type => type === "data" || type === "annotation");
            const path = edge.points.map((point, pointIndex) => `${pointIndex ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
            const branch = (stepById.get(edge.sourceId)?.routes.length ?? 0) > 1;
            const label = routeLabelPosition(edge.points, branch);
            const number = edge.branchNumber || "";
            const chipText = displayRouteLabel(project, edge.sourceId, edge.routeIndex);
            const maxLabelWidth = branch && edge.points.length <= 4 ? Math.max(62, Math.min(126, label.length - 8)) : 126;
            const labelLines = wrapText(chipText, Math.max(7, Math.floor((maxLabelWidth - 16) / 5.6)), 1);
            const labelWidth = Math.min(maxLabelWidth, Math.max(52, labelLines[0].length * 5.6 + 16));
            const selected = selectedRoute?.sourceId === edge.sourceId && selectedRoute.routeIndex === edge.routeIndex;
            const routeCaption = edge.label.toLocaleLowerCase("az");
            const feedback = /imtina|rədd|geri|qaytar|reject|decline|return/.test(routeCaption);
            const approval = !feedback && /təsdiq|bəli|yes|approve|confirm/.test(routeCaption);
            const edgeColor = selected ? "#2548E8" : feedback ? "#B8470F" : "#6F7B88";
            const chipFill = selected ? "#E8ECFD" : feedback ? "#FCEBDD" : approval ? "#DDF2E6" : "#F8FAFB";
            const chipStroke = selected ? "#2548E8" : feedback ? "#EBB794" : approval ? "#9FD3B6" : "#D5DBE2";
            const chipInk = selected ? "#2548E8" : feedback ? "#A63F0B" : approval ? "#1B7048" : "#566270";
            return <g key={`${edge.sourceId}-${edge.routeIndex}-${index}`} className={`diagram-edge${selected ? " is-selected" : ""}`} data-route-source={edge.sourceId} data-route-index={edge.routeIndex} role={onSelectRoute ? "button" : undefined} tabIndex={onSelectRoute ? 0 : undefined} aria-label={`Keçid${number ? ` ${number}` : ""}: ${edge.label.trim() || "Şərtsiz"}`} aria-pressed={onSelectRoute ? selected : undefined}
              onClick={(event) => {
                event.stopPropagation();
                if (activeTool === "pan") return;
                cancelGesture();
                setReconnectChoice(null);
                setConnectionSource(null);
                if ((event.target as Element).closest(".diagram-route-chip")) onEditRoute?.(edge.sourceId, edge.routeIndex);
                else onSelectRoute?.(edge.sourceId, edge.routeIndex);
              }}
              onDoubleClick={(event) => { event.stopPropagation(); if (activeTool !== "pan") { cancelGesture(); setReconnectChoice(null); onEditRoute?.(edge.sourceId, edge.routeIndex); } }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); cancelGesture(); setReconnectChoice(null); setConnectionSource(null); onSelectRoute?.(edge.sourceId, edge.routeIndex); }
                else if (event.key === "F2") { event.preventDefault(); event.stopPropagation(); cancelGesture(); setReconnectChoice(null); onEditRoute?.(edge.sourceId, edge.routeIndex); }
                else if ((event.key === "Delete" || event.key === "Backspace") && onDeleteRoute) { event.preventDefault(); event.stopPropagation(); onDeleteRoute({ sourceId: edge.sourceId, routeIndex: edge.routeIndex }); }
              }}>
              <title>{`${number ? `${number}: ` : ""}${edge.label || "Şərtsiz keçid"}\nKliklə keçidi redaktə et.`}</title>
              <path d={path} fill="none" stroke="transparent" strokeWidth="14" className="diagram-edge-hit" />
              <path d={path} fill="none" stroke={edgeColor} strokeWidth={selected ? "2.6" : "1.65"} strokeDasharray={association ? "2 4" : edge.message ? "6 5" : undefined} strokeLinejoin="round" strokeLinecap="round" pointerEvents="none" markerEnd={association ? undefined : `url(#${markerPrefix}-${edge.message ? "message" : "arrow"})`} />
              {edge.message && !association && <circle cx={edge.points[0].x} cy={edge.points[0].y} r="3" fill="#FFFFFF" stroke={edgeColor} strokeWidth="1.3" />}
              {chipText && <g className="diagram-route-chip">
                <rect x={label.x - labelWidth / 2} y={label.y - 10} width={labelWidth} height={21} rx="10.5" fill={chipFill} stroke={chipStroke} strokeWidth="0.8" />
                <text x={label.x} y={label.y + 4} textAnchor="middle" fill={chipInk} fontFamily="'DM Mono', monospace" fontSize="10" fontWeight="500" pointerEvents="none">{labelLines[0]}</text>
              </g>}
            </g>;
          })}
          {connection && (() => {
            const source = layout.nodes.find((node) => node.id === connection.sourceId);
            if (!source) return null;
            const start = { x: source.x + source.width + 14, y: source.y + source.height / 2 };
            const middleX = (start.x + connection.point.x) / 2;
            return <path className="diagram-connection-preview" data-editor-only="connection" d={`M ${start.x} ${start.y} H ${middleX} V ${connection.point.y} H ${connection.point.x}`} fill="none" stroke="#2548E8" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none" />;
          })()}
          {layout.nodes.map((node) => {
            const step = stepById.get(node.id);
            if (!step) return null;
            const { x, y, width, height } = node;
            const cx = x + width / 2, cy = y + height / 2;
            const selected = selectedId === node.id || draggingId === node.id;
            const gateway = ["xor", "or", "and"].includes(step.type);
            const event = ["start", "end", "intermediate", "message", "timer"].includes(step.type);
            const r = Math.min(width, height) / 2;
            const stroke = selected ? "#2548E8" : gateway ? "#1F2630" : event ? step.type === "start" ? "#1B7048" : step.type === "end" ? "#8A2D2D" : "#566270" : "#BAC4CF";
            const fill = gateway ? "#1F2630" : "#FFFFFF";
            const stepNumber = getStepNumber(project, node.id);
            const isTarget = connection?.targetId === node.id || reconnectPreview?.targetId === node.id;
            return <g key={node.id}><g className={`diagram-node${onMoveStep ? " is-draggable" : ""}${draggingId === node.id ? " is-dragging" : ""}${isTarget ? " is-connect-target" : ""}`} data-step-id={node.id} role="button" tabIndex={0} aria-label={`${typeLabels[step.type]}: ${step.title || "Adsız addım"}`} aria-pressed={selected} style={{ touchAction: onMoveStep ? "none" : undefined }}
              onPointerDown={(event) => beginNodeDrag(event, node.id)}
              onClick={() => selectNode(node.id)}
              onDoubleClick={(event) => { event.stopPropagation(); if (activeTool !== "pan") onEditStep?.(node.id); }}
              onKeyDown={(event) => {
                if (event.target !== event.currentTarget) return;
                if (nudgeNode(node.id, event)) return;
                if (event.key === "Enter" || event.key === " ") { event.preventDefault(); event.stopPropagation(); selectNode(node.id); }
                else if (event.key === "F2") { event.preventDefault(); event.stopPropagation(); onEditStep?.(node.id); }
                else if (event.key === "Delete" || event.key === "Backspace") { if (onDeleteStep) { event.preventDefault(); event.stopPropagation(); onDeleteStep(node.id); } }
              }}>
              <title>{`${stepNumber}. ${typeLabels[step.type]}: ${step.title || "Adsız addım"}${step.description ? `\n${step.description}` : ""}\nSürüşdür və ya iki dəfə kliklə redaktə et.`}</title>
              {selected && <rect data-editor-only="selection" x={x - 4} y={y - 4} width={width + 8} height={height + 8} rx={event ? r + 4 : 12} fill="none" stroke="#2548E8" strokeOpacity="0.14" strokeWidth="6" />}
              {isTarget && <rect data-editor-only="connection-target" x={x - 9} y={y - 9} width={width + 18} height={height + 18} rx="13" fill="none" stroke="#2548E8" strokeWidth="2.5" strokeDasharray="4 3" />}
              {gateway ? <>
                <path d={`M ${cx} ${y} L ${x + width} ${cy} L ${cx} ${y + height} L ${x} ${cy} Z`} fill={fill} stroke={stroke} strokeWidth="1.8" />
                {step.type === "or" ? <circle cx={cx} cy={cy} r="11" fill="none" stroke="#FFFFFF" strokeWidth="2.2" /> : <text x={cx} y={cy + 7} textAnchor="middle" fill="#FFFFFF" fontSize={step.type === "and" ? 29 : 24} fontWeight="500">{step.type === "and" ? "+" : "×"}</text>}
                <TextLines text={step.title} x={cx} y={y + height + 23} width={130} maxLines={2} size={11} />
              </> : event ? <>
                <circle cx={cx} cy={cy} r={r - 1} fill={fill} stroke={stroke} strokeWidth={step.type === "end" ? 4 : 1.8} />
                {["intermediate", "message", "timer"].includes(step.type) && <circle cx={cx} cy={cy} r={r - 6} fill="none" stroke={stroke} strokeWidth="1" />}
                {step.type === "message" && <g stroke="#566270" strokeWidth="1.4" fill="none"><rect x={cx - 11} y={cy - 7} width="22" height="14" rx="1" /><path d={`M ${cx - 11} ${cy - 7} L ${cx} ${cy + 1} L ${cx + 11} ${cy - 7}`} /></g>}
                {step.type === "timer" && <g stroke="#566270" strokeWidth="1.4" fill="none"><circle cx={cx} cy={cy} r="12" /><path d={`M ${cx} ${cy - 8} V ${cy} L ${cx + 6} ${cy + 4}`} />{[0, 1, 2, 3].map((tick) => <line key={tick} x1={cx} y1={cy - 12} x2={cx} y2={cy - 9} transform={`rotate(${tick * 90} ${cx} ${cy})`} />)}</g>}
                <TextLines text={step.title} x={cx} y={y + height + 22} width={120} maxLines={2} size={11} />
              </> : step.type === "data" ? <>
                <path d={`M ${x} ${y} H ${x + width - 17} L ${x + width} ${y + 17} V ${y + height} H ${x} Z M ${x + width - 17} ${y} V ${y + 17} H ${x + width}`} fill="#FFFFFF" stroke="#BAC4CF" strokeWidth="1.7" />
                <TextLines text={step.title} x={cx} y={cy + 4} width={width - 24} maxLines={4} />
              </> : step.type === "annotation" ? <>
                <rect x={x} y={y} width={width} height={height} fill={fill} />
                <path d={`M ${x + 12} ${y} H ${x} V ${y + height} H ${x + 12}`} stroke="#8A96A3" strokeWidth="2" fill="none" />
                <TextLines text={step.title} x={cx + 3} y={cy + 4} width={width - 24} maxLines={4} size={11} color="#566270" />
              </> : <>
                <rect x={x} y={y} width={width} height={height} rx="9" fill={fill} stroke={stroke} strokeWidth="1.6" />
                {step.type === "userTask" && <g transform={`translate(${x + 13} ${y + 11})`} stroke="#566270" strokeWidth="1.4" fill="none"><circle cx="4" cy="3" r="2.5" /><path d="M 0 11 V 9 Q 0 6 4 6 Q 8 6 8 9 V 11" /></g>}
                {step.type === "serviceTask" && <g transform={`translate(${x + 17} ${y + 16})`} stroke="#566270" strokeWidth="1.4" fill="none"><circle r="5" /><circle r="1.8" />{[0, 1, 2, 3].map((tick) => <line key={tick} x1="0" y1="-8" x2="0" y2="-5" transform={`rotate(${tick * 90})`} />)}</g>}
                <TextLines text={step.title} x={cx} y={cy + (step.type === "subprocess" ? -1 : 4)} width={width - 26} maxLines={step.type === "subprocess" ? 3 : 4} />
                {step.type === "subprocess" && <g><rect x={cx - 6} y={y + height - 17} width="12" height="12" rx="1" fill="#FFFFFF" stroke="#566270" /><path d={`M ${cx - 3} ${y + height - 11} H ${cx + 3} M ${cx} ${y + height - 14} V ${y + height - 8}`} fill="none" stroke="#566270" strokeWidth="1.2" /></g>}
              </>}
              <g className="diagram-step-number" pointerEvents="none">
                <rect x={x - 5} y={y - 15} width={stepNumber.length > 2 ? 27 : 22} height="17" rx="5" fill={selected ? "#2548E8" : "#EEF1F4"} stroke={selected ? "#2548E8" : "#D5DBE2"} strokeWidth="0.8" />
                <text x={x + (stepNumber.length > 2 ? 8.5 : 6)} y={y - 3} textAnchor="middle" fill={selected ? "#FFFFFF" : "#566270"} fontFamily="'DM Mono', monospace" fontSize="10" fontWeight="500">{stepNumber}</text>
              </g>
              </g>
              {selected && !selectedRoute && onConnect && step.type !== "end" && activeTool !== "pan" && <g className="diagram-connection-handle" data-editor-only="connection-handle" data-connection-handle={node.id} role="button" tabIndex={0} aria-label={`Keçid çək: ${step.title || "Adsız addım"}`} aria-pressed={connectionSource === node.id} style={{ touchAction: "none" }}
                onPointerDown={(event) => beginConnection(event, node.id)}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault(); event.stopPropagation();
                    setConnectionSource((source) => source === node.id ? null : node.id);
                  }
                }}>
                <title>Digər fiqura sürüşdür və ya kliklə hədəfi seç.</title>
                <circle cx={x + width + 14} cy={cy} r="11" fill="#2548E8" stroke="#FFFFFF" strokeWidth="2" />
                <path d={`M ${x + width + 10} ${cy} H ${x + width + 18} M ${x + width + 14} ${cy - 4} V ${cy + 4}`} fill="none" stroke="#FFFFFF" strokeWidth="1.7" pointerEvents="none" />
              </g>}
            </g>;
          })}
          {reconnectPreview && (() => {
            const edge = layout.edges.find((item) => item.sourceId === reconnectPreview.selection.sourceId && item.routeIndex === reconnectPreview.selection.routeIndex);
            if (!edge) return null;
            const start = reconnectPreview.endpoint === "source" ? reconnectPreview.point : edge.points[0];
            const end = reconnectPreview.endpoint === "target" ? reconnectPreview.point : edge.points[edge.points.length - 1];
            const middleX = (start.x + end.x) / 2;
            return <path className="diagram-reconnect-preview" data-editor-only="reconnect-preview" d={`M ${start.x} ${start.y} H ${middleX} V ${end.y} H ${end.x}`} fill="none" stroke="#2548E8" strokeWidth="2" strokeDasharray="5 4" pointerEvents="none" />;
          })()}
          {selectedEdge && selectedRoute && onReconnectRoute && activeTool !== "pan" && (["source", "target"] as const).map((endpoint) => {
            const point = endpoint === "source" ? selectedEdge.points[0] : selectedEdge.points[selectedEdge.points.length - 1];
            const active = (reconnectChoice?.selection.sourceId === selectedRoute.sourceId && reconnectChoice.selection.routeIndex === selectedRoute.routeIndex && reconnectChoice.endpoint === endpoint)
              || (reconnectPreview?.selection.sourceId === selectedRoute.sourceId && reconnectPreview.selection.routeIndex === selectedRoute.routeIndex && reconnectPreview.endpoint === endpoint);
            return <g key={endpoint} className={`diagram-route-handle${active ? " is-active" : ""}`} data-editor-only="route-handle" data-route-handle={endpoint} data-route-source={selectedRoute.sourceId} data-route-index={selectedRoute.routeIndex} role="button" tabIndex={0} aria-label={endpoint === "source" ? "Keçidin başlanğıcını dəyiş" : "Keçidin hədəfini dəyiş"} aria-pressed={active} style={{ touchAction: "none", pointerEvents: reconnectChoice ? "none" : undefined }}
              onPointerDown={(event) => {
                // eslint-disable-next-line react-hooks/refs -- This pointer-event callback reads DOM capture refs after render, never while rendering the handle.
                beginReconnect(event, selectedRoute, endpoint);
              }}
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault(); event.stopPropagation();
                  // eslint-disable-next-line react-hooks/refs -- This keyboard-event callback releases DOM pointer capture after render.
                  cancelGesture();
                  setConnectionSource(null); setActiveTool("select");
                  setReconnectChoice({ selection: selectedRoute, endpoint });
                }
              }}>
              <title>{endpoint === "source" ? "Keçidin başlanğıcını" : "Keçidin hədəfini"} başqa fiqura sürüşdür və ya klikləyib fiqur seç. Etiket və izah saxlanılır.</title>
              <circle cx={point.x} cy={point.y} r={14 / zoom} fill="transparent" />
              <circle cx={point.x} cy={point.y} r={7 / zoom} fill={active ? "#2548E8" : "#FFFFFF"} stroke="#2548E8" strokeWidth={2 / zoom} />
            </g>;
          })}
          {!layout.nodes.length && <g>
            <text x={diagramWidth / 2} y={diagramHeight / 2 - 8} textAnchor="middle" fill="#14181D" fontSize="16" fontWeight="600">İlk addımını əlavə et</text>
            <text x={diagramWidth / 2} y={diagramHeight / 2 + 20} textAnchor="middle" fill="#566270" fontSize="12">Formanı doldurduqca diaqram burada yaranacaq.</text>
          </g>}
        </svg>
      </div>
    </div>
    {children}
    {(onMoveStep || onAddShape || onConnect) && <div className="diagram-palette" role="toolbar" aria-label="Fiqur alətləri">
      <button type="button" className={`diagram-tool${activeTool === "select" ? " is-active" : ""}`} aria-label="Seç" aria-pressed={activeTool === "select"} title="Seç və sürüşdür" onClick={() => selectTool("select")}><MousePointer2 size={20} /></button>
      <button type="button" className={`diagram-tool${activeTool === "pan" ? " is-active" : ""}`} aria-label="Sahəni sürüşdür" aria-pressed={activeTool === "pan"} title="Sahəni sürüşdür" onClick={() => selectTool("pan")}><Move size={20} /></button>
      {onAddShape && <>
        <span className="diagram-palette-divider" aria-hidden="true" />
        <button type="button" className="diagram-tool" aria-label="Diaqramda başlanğıc əlavə et" title="Başlanğıc əlavə et" disabled={controlsDisabled} onClick={() => addShape("start")}><Circle size={20} /></button>
        <button type="button" className="diagram-tool" aria-label="Diaqramda tapşırıq əlavə et" title="Tapşırıq əlavə et" disabled={controlsDisabled} onClick={() => addShape("task")}><Square size={20} /></button>
        <button type="button" className="diagram-tool" aria-label="Diaqramda qərar əlavə et" title="Qərar əlavə et" disabled={controlsDisabled} onClick={() => addShape("xor")}><Diamond size={20} /></button>
      </>}
      {onConnect && <button type="button" className={`diagram-tool${activeTool === "connect" ? " is-active" : ""}`} aria-label="Keçid çək" aria-pressed={activeTool === "connect"} title="Fiqurları bağla" disabled={!project.steps.length} onClick={() => selectTool(activeTool === "connect" ? "select" : "connect")}><Waypoints size={20} /></button>}
      {onAddShape && <button type="button" className="diagram-tool" aria-label="Diaqramda qeyd əlavə et" title="Qeyd əlavə et" disabled={controlsDisabled} onClick={() => addShape("annotation")}><StickyNote size={20} /></button>}
    </div>}
    <div className="diagram-legend" aria-label="Diaqram işarələri">
      <span className="diagram-key event"><i />Başlanğıc</span>
      <span className="diagram-key task"><i />Tapşırıq</span>
      <span className="diagram-key gateway"><i />Keçid</span>
      <span className="diagram-key message"><i />Mesaj</span>
      {(fullscreen || expanded) && <span className="diagram-fullscreen-hint">Esc ilə çıx</span>}
    </div>
  </div>;
}
