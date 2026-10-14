"use client";

import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { getPoolMinimumSize, getProjectMinimumSize, getStepMinimumSize, MAX_DIAGRAM_SIZE } from "@/lib/diagram-size";
import { getStepDimensions, layoutProject } from "@/lib/layout";
import type { DiagramSize, Project } from "@/lib/types";
import styles from "./diagram-dimensions.module.css";

export interface DiagramDimensionsProps {
  project: Project;
  selectedStepId: string | null;
  onResizeCanvas: (size: DiagramSize) => void;
  onResizePool: (id: string, size: DiagramSize) => void;
  onResizeStep: (id: string, size: DiagramSize) => void;
  onResetCanvas: () => void;
  onResetPool: (id: string) => void;
  onResetStep: (id: string) => void;
}

function DimensionInput({ label, name, value, minimum, onCommit }: {
  label: string;
  name: string;
  value: number;
  minimum: number;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));
  const [editing, setEditing] = useState(false);

  function commit() {
    const candidate = Number(draft);
    if (editing && draft.trim() !== "" && Number.isFinite(candidate) && candidate > 0 && candidate <= MAX_DIAGRAM_SIZE && candidate !== value) {
      onCommit(candidate);
    }
    setEditing(false);
  }

  return <label className="field-label">
    {label}
    <span className={styles.inputWrap}>
      <input aria-label={name} type="number" inputMode="decimal" min={minimum} max={MAX_DIAGRAM_SIZE} step="0.1"
        value={editing ? draft : value}
        onFocus={() => { setDraft(String(value)); setEditing(true); }}
        onChange={event => { setDraft(event.target.value); setEditing(true); }}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); commit(); }
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setDraft(String(value)); setEditing(false); }
        }}/>
      <span className={styles.unit} aria-hidden="true">px</span>
    </span>
  </label>;
}

function SizeGroup({ title, prefix, size, minimum, onResize, onReset }: {
  title: string;
  prefix: string;
  size: DiagramSize;
  minimum: DiagramSize;
  onResize: (size: DiagramSize) => void;
  onReset: () => void;
}) {
  return <fieldset className={styles.group}>
    <legend>{title}</legend>
    <div className={styles.fields}>
      <DimensionInput label="En" name={`${prefix} eni`} value={size.width} minimum={minimum.width}
        onCommit={width => onResize({ width, height: size.height })}/>
      <DimensionInput label="Hündürlük" name={`${prefix} hündürlüyü`} value={size.height} minimum={minimum.height}
        onCommit={height => onResize({ width: size.width, height })}/>
    </div>
    <button type="button" className="text-button" onClick={onReset}><RotateCcw size={14}/> Avtomatik ölçü</button>
  </fieldset>;
}

export function DiagramDimensions({ project, selectedStepId, onResizeCanvas, onResizePool, onResizeStep,
  onResetCanvas, onResetPool, onResetStep }: DiagramDimensionsProps) {
  const geometry = layoutProject(project);
  const canvasSize = project.size ? geometry : { width: Math.max(560, geometry.width), height: Math.max(360, geometry.height) };
  const step = project.steps.find(item => item.id === selectedStepId);
  return <div className={styles.dimensions} key={project.id}>
    <SizeGroup title="Ümumi diaqram" prefix="Diaqram" size={canvasSize} minimum={getProjectMinimumSize(project)}
      onResize={onResizeCanvas} onReset={onResetCanvas}/>
    {project.pools.map((pool, index) => {
      const poolGeometry = geometry.pools.find(item => item.id === pool.id);
      if (!poolGeometry) return null;
      return <SizeGroup key={pool.id} title={`Pool ${index + 1} — ${pool.name || "Adsız pool"}`} prefix={`Pool ${index + 1}`}
        size={poolGeometry} minimum={getPoolMinimumSize(project, pool.id)}
        onResize={size => onResizePool(pool.id, size)} onReset={() => onResetPool(pool.id)}/>;
    })}
    {step && <SizeGroup key={step.id} title={`Seçilmiş fiqur — ${step.title || "Adsız addım"}`} prefix="Fiqur"
      size={getStepDimensions(step)} minimum={getStepMinimumSize(step.type)}
      onResize={size => onResizeStep(step.id, size)} onReset={() => onResetStep(step.id)}/>}
    <p className={styles.minimumNote}>Ölçülər içəridəki fiqurlardan kiçik ola bilməz.</p>
  </div>;
}

export default DiagramDimensions;
