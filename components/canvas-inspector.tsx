"use client";

import { useEffect, useRef } from "react";
import { ArrowRight, Copy, Info, RotateCcw, Trash2, X } from "lucide-react";
import { STEP_TYPES } from "@/lib/process";
import { getRouteNumber, getStepNumber } from "@/lib/step-numbering";
import type { Project, Step, StepType } from "@/lib/types";
import type { DiagramRouteSelection } from "./diagram";
import StepMetadataFields from "./step-metadata-fields";

interface InspectorProps {
  project: Project;
  stepId: string | null;
  routeSelection: DiagramRouteSelection | null;
  onUpdate: (id: string, patch: Partial<Step>, historyKey?: string) => void;
  onDeleteStep: (id: string) => void;
  onDeleteRoute: (sourceId: string, routeIndex: number) => void;
  onReconnectRoute?: (selection: DiagramRouteSelection, endpoint: "source" | "target", nodeId: string) => boolean;
  onDuplicateStep?: (id: string) => void;
  onClose: () => void;
}

export default function CanvasInspector({ project, stepId, routeSelection, onUpdate, onDeleteStep, onDeleteRoute, onReconnectRoute, onDuplicateStep, onClose }: InspectorProps) {
  const panelRef = useRef<HTMLElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    opener.current = document.activeElement as HTMLElement | null;
    return () => {
      if (opener.current?.isConnected) opener.current.focus({ preventScroll: !window.matchMedia("(max-width: 800px)").matches });
    };
  }, []);
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>("input, textarea, select")?.focus({ preventScroll: true });
    if (window.matchMedia("(max-width: 800px)").matches) panelRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [stepId, routeSelection?.sourceId, routeSelection?.routeIndex]);
  const step = project.steps.find(item => item.id === (routeSelection?.sourceId ?? stepId));
  if (!step) return null;
  const route = routeSelection ? step.routes[routeSelection.routeIndex] : null;
  if (routeSelection && !route) return null;
  const target = route && project.steps.find(item => item.id === route.targetId);
  const lanes = project.pools.flatMap(pool => pool.lanes.map(lane => ({ ...lane, poolName: pool.name })));

  function updateRoute(patch: Partial<Step["routes"][number]>) {
    if (!routeSelection || !step) return;
    const field = Object.keys(patch)[0];
    onUpdate(step.id, { routes: step.routes.map((item, index) => index === routeSelection.routeIndex ? { ...item, ...patch } : item) },
      ["label", "description"].includes(field) ? `route:${step.id}:${routeSelection.routeIndex}:${field}` : undefined);
  }

  return <aside className="canvas-inspector" ref={panelRef} aria-label={routeSelection ? "Keçid redaktəsi" : "Addım redaktəsi"} onPointerDown={event => event.stopPropagation()} onKeyDown={event => {
    event.stopPropagation();
    if (event.key === "Escape") onClose();
  }}>
    <header className="inspector-heading">
      <div><span>{routeSelection ? "KEÇİD" : "ADDIM"}</span><h3>{routeSelection ? `Keçid ${getRouteNumber(project, step.id, routeSelection.routeIndex)}` : `${getStepNumber(project, step.id)}. ${step.title || "Adsız addım"}`}</h3></div>
      <button type="button" className="icon-button" aria-label="Redaktə panelini bağla" onClick={onClose}><X size={17}/></button>
    </header>
    <div className="inspector-fields">
      {routeSelection && route ? <>
        <div className="connection-context"><span>{getStepNumber(project, step.id)}. {step.title}</span><ArrowRight size={14}/><span>{target ? `${getStepNumber(project, target.id)}. ${target.title}` : "Hədəf seçilməyib"}</span></div>
        <label className="field-label">Etiketin mətni<input aria-label="Etiketin mətni" value={route.label} maxLength={80} placeholder="Məsələn, Təsdiq" onChange={event => updateRoute({ label: event.target.value })}/></label>
        <p className="field-help">Xəttdə yalnız kiçik etiket görünür. Ətraflı mətni aşağıda yaz.</p>
        <label className="field-label">Başlanğıc addım<select aria-label="Keçidin başlanğıcı" aria-describedby="inspector-route-edit-hint" value={step.id} disabled={!onReconnectRoute} onChange={event => onReconnectRoute?.(routeSelection, "source", event.target.value)}>{project.steps.filter(item => item.type !== "end" && (item.id !== route.targetId || item.id === step.id)).map(item => <option key={item.id} value={item.id}>{getStepNumber(project, item.id)}. {item.title || "Adsız addım"}</option>)}</select></label>
        <label className="field-label">Hədəf addım<select aria-label="Keçidin hədəfi" aria-describedby="inspector-route-edit-hint" value={route.targetId} onChange={event => onReconnectRoute ? onReconnectRoute(routeSelection, "target", event.target.value) : updateRoute({ targetId: event.target.value })}><option value="">Addımı seç</option>{project.steps.filter(item => item.id !== step.id || item.id === route.targetId).map(item => <option key={item.id} value={item.id}>{getStepNumber(project, item.id)}. {item.title || "Adsız addım"}</option>)}</select></label>
        <label className="field-label">Keçidin izahı<textarea aria-label="Keçidin izahı" rows={5} value={route.description ?? ""} maxLength={10000} placeholder="Bu yol nə zaman seçilir və sonra nə baş verir?" onChange={event => updateRoute({ description: event.target.value })}/></label>
        <p className="inspector-edit-hint" id="inspector-route-edit-hint"><Info size={15}/><span>Oxun uclarını sürüşdürərək başqa addıma birləşdir və ya yuxarıdakı addımları seç. Etiket və izah saxlanılır; dəyişiklik iş axınının izahında da görünür.</span></p>
      </> : <>
        <label className="field-label">Addımın adı<input aria-label="Diaqram addımının adı" value={step.title} maxLength={240} onChange={event => onUpdate(step.id, { title: event.target.value })}/></label>
        <label className="field-label">Element növü<select aria-label="Diaqram addımının növü" value={step.type} onChange={event => onUpdate(step.id, { type: event.target.value as StepType, routes: event.target.value === "end" ? [] : step.routes })}>{STEP_TYPES.map(item => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
        <label className="field-label">İcraçı<select aria-label="Diaqram addımının icraçısı" aria-describedby="inspector-lane-edit-hint" value={step.laneId} onChange={event => onUpdate(step.id, { laneId: event.target.value })}>{lanes.map(item => <option key={item.id} value={item.id}>{project.pools.length > 1 ? `${item.poolName} / ` : ""}{item.name}</option>)}</select></label>
        <p className="field-help inspector-lane-hint" id="inspector-lane-edit-hint">Fiquru başqa iştirakçının zolağına sürüşdürə və ya burada icraçını dəyişə bilərsən. İzah cədvəlində icraçı da yenilənir.</p>
        <label className="field-label">İşin təsviri<textarea aria-label="Diaqram addımının təsviri" rows={5} value={step.description} maxLength={10000} placeholder="İcraçının gördüyü işi izah et." onChange={event => onUpdate(step.id, { description: event.target.value })}/></label>
        <StepMetadataFields key={step.id} step={step} labelPrefix="Diaqram addımı" onChange={patch => onUpdate(step.id, patch)}/>
        <div className="inspector-step-actions">
          {onDuplicateStep && <button type="button" className="secondary-button" aria-label="Seçilmiş addımın surətini yarat" disabled={project.steps.length >= 200} onClick={() => onDuplicateStep(step.id)}><Copy size={15}/> Surətini yarat</button>}
          {step.position && <button type="button" className="text-button" onClick={() => onUpdate(step.id, { position: undefined })}><RotateCcw size={14}/> Bu fiquru avtomatik yerləşdir</button>}
        </div>
      </>}
    </div>
    <footer className="inspector-footer"><span>Avtomatik saxlanılır</span><button type="button" className="text-button danger-icon" aria-label={routeSelection ? "Seçilmiş keçidi sil" : "Seçilmiş addımı sil"} onClick={() => routeSelection ? onDeleteRoute(step.id, routeSelection.routeIndex) : onDeleteStep(step.id)}><Trash2 size={14}/> Sil</button></footer>
  </aside>;
}
