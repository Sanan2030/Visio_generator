"use client";

import { useRef, type KeyboardEvent, type PointerEvent } from "react";

export interface ResizableSidebarSeparatorProps {
  width: number;
  min: number;
  max: number;
  onChange: (width: number) => void;
  onCommit: (width: number) => void;
  onCancel?: (origin: number) => void;
}

interface SeparatorDrag {
  pointerId: number;
  startX: number;
  origin: number;
  width: number;
}

export function ResizableSidebarSeparator({ width, min, max, onChange, onCommit, onCancel }: ResizableSidebarSeparatorProps) {
  const drag = useRef<SeparatorDrag | null>(null);
  const clamp = (value: number) => Math.round(Math.max(min, Math.min(max, value)));

  function cancel(element: HTMLDivElement) {
    const previous = drag.current;
    if (!previous) return;
    drag.current = null;
    onChange(previous.origin);
    onCancel?.(previous.origin);
    if (element.hasPointerCapture(previous.pointerId)) element.releasePointerCapture(previous.pointerId);
  }

  function finish(event: PointerEvent<HTMLDivElement>) {
    const previous = drag.current;
    if (!previous || previous.pointerId !== event.pointerId) return;
    const next = clamp(previous.origin + event.clientX - previous.startX);
    drag.current = null;
    onChange(next);
    onCommit(next);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleKey(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape" && drag.current) {
      event.preventDefault();
      event.stopPropagation();
      cancel(event.currentTarget);
      return;
    }
    const increment = event.shiftKey ? 40 : 20;
    const next = event.key === "ArrowLeft" ? width - increment : event.key === "ArrowRight" ? width + increment
      : event.key === "Home" ? min : event.key === "End" ? max : null;
    if (next === null || drag.current) return;
    event.preventDefault();
    event.stopPropagation();
    const bounded = clamp(next);
    onChange(bounded);
    onCommit(bounded);
  }

  return <div className="workspace-separator" role="separator" tabIndex={0}
    aria-label="Forma panelinin enini dəyiş" aria-orientation="vertical"
    aria-valuemin={min} aria-valuemax={max} aria-valuenow={width} aria-valuetext={`${width} piksel`}
    onKeyDown={handleKey}
    onDoubleClick={() => {
      if (drag.current) return;
      const next = clamp(400);
      onChange(next);
      onCommit(next);
    }}
    onPointerDown={event => {
      if (event.button !== 0 || drag.current) return;
      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, startX: event.clientX, origin: width, width };
    }}
    onPointerMove={event => {
      const current = drag.current;
      if (!current || current.pointerId !== event.pointerId) return;
      const next = clamp(current.origin + event.clientX - current.startX);
      current.width = next;
      onChange(next);
    }}
    onPointerUp={finish}
    onPointerCancel={event => { if (drag.current?.pointerId === event.pointerId) cancel(event.currentTarget); }}
    onLostPointerCapture={event => { if (drag.current?.pointerId === event.pointerId) cancel(event.currentTarget); }}/>
}

export default ResizableSidebarSeparator;
