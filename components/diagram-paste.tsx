"use client";

import { useMemo, useRef, useState } from "react";
import { ClipboardPaste, Upload } from "lucide-react";
import { parseDiagram } from "@/lib/diagram-clipboard";
import { MAX_STORED_SIZE } from "@/lib/storage";
import type { Project } from "@/lib/types";

interface DiagramPasteProps {
  initialText: string;
  onPaste: (source: Project) => void;
  onClose: () => void;
}

export function DiagramPaste({ initialText, onPaste, onClose }: DiagramPasteProps) {
  const [text, setText] = useState(initialText);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const revision = useRef(0);
  const parsed = useMemo(() => {
    if (!text.trim()) return null;
    try { return { project: parseDiagram(text), error: "" }; }
    catch (error) { return { project: null, error: error instanceof Error ? error.message : "Diaqram oxunmadı." }; }
  }, [text]);

  function changeText(value: string) {
    revision.current++;
    setText(value);
    setError("");
    setLoading(false);
  }

  async function readClipboard() {
    const current = ++revision.current;
    setLoading(true); setError("");
    try {
      const value = await navigator.clipboard.readText();
      if (value.length > MAX_STORED_SIZE) throw new Error("Diaqram 2 MB-dan böyükdür.");
      if (revision.current === current) setText(value);
    } catch {
      if (revision.current === current) setError("Bufer oxunmadı. Mətni aşağıdakı sahəyə yapışdır və ya saxladığın diaqram faylını seç.");
    } finally { if (revision.current === current) setLoading(false); }
  }

  async function readFile(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file) return;
    const current = ++revision.current;
    setLoading(true); setError("");
    try {
      if (file.size > MAX_STORED_SIZE) throw new Error("Diaqram faylı 2 MB-dan böyükdür.");
      const value = await file.text();
      if (revision.current === current) setText(value);
    } catch (error) {
      if (revision.current === current) setError(error instanceof Error ? error.message : "Diaqram faylı oxunmadı.");
    } finally {
      input.value = "";
      if (revision.current === current) setLoading(false);
    }
  }

  return <form onSubmit={event => {
    event.preventDefault();
    if (!parsed?.project) { setError(parsed?.error || "Əvvəl kopyalanmış diaqramı daxil et."); return; }
    try { onPaste(parsed.project); }
    catch (error) { setError(error instanceof Error ? error.message : "Diaqram əlavə edilmədi."); }
  }}>
    <p>Bu brauzerdə son kopyaladığın diaqram aşağıdadır. Onu cari axına əlavə et, başqa nüsxənin mətnini yapışdır və ya saxladığın faylı seç.</p>
    <div className="diagram-transfer-actions">
      <button type="button" className="secondary-button" disabled={loading} onClick={() => void readClipboard()}><ClipboardPaste size={15}/> Buferdən yapışdır</button>
      <label className="field-label diagram-file-input"><span><Upload size={15}/> Saxlanmış nüsxəni aç</span><input type="file" aria-label="Diaqram faylını seç" accept=".json,application/json" disabled={loading} onChange={event => void readFile(event.currentTarget)}/></label>
    </div>
    <label className="field-label">Kopyalanmış diaqram<textarea aria-label="Kopyalanmış diaqram" className="diagram-copy-text" rows={6} maxLength={MAX_STORED_SIZE} placeholder="Kopyaladığın diaqramı buraya yapışdır." value={text} onChange={event => changeText(event.target.value)}/></label>
    {parsed?.project && <p className="diagram-paste-summary">{parsed.project.name || "Adsız diaqram"} · {parsed.project.pools.length} pool · {parsed.project.steps.length} element</p>}
    <p className="field-help">Mövcud axın saxlanılır, yeni diaqram onun altına əlavə olunur. Səhv yapışdırmanı “Geri al” ilə ləğv edə bilərsən.</p>
    {(error || parsed?.error) && <p className="diagram-transfer-error" role="alert">{error || parsed?.error}</p>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Ləğv et</button><button type="submit" className="primary-button" disabled={loading || !text.trim()}>Diaqramı əlavə et</button></div>
  </form>;
}
