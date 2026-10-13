"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUp, Check, ChevronDown, CircleHelp, FileText, GitBranch, Layers3, LoaderCircle, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import type { Step, StepType } from "@/lib/types";
import { createId, createProject, SAMPLE_PROJECT, STEP_TYPES, validateProject } from "@/lib/process";
import { clampNodePosition } from "@/lib/layout";
import { duplicateDiagramStep, moveDiagramStep, reconnectDiagramRoute } from "@/lib/diagram-edit";
import { getRouteNumber } from "@/lib/step-numbering";
import { insertStepAfter, moveStepInOrder, reorderStepsByFlow } from "@/lib/step-order";
import { createProcessTemplate, PROCESS_TEMPLATES, type ProcessTemplateId } from "@/lib/templates";
import { download, filename } from "@/lib/storage";
import { useProject } from "@/lib/use-project";
import Diagram, { type DiagramRouteSelection } from "./diagram";
import CanvasInspector from "./canvas-inspector";
import ExplanationTable from "./explanation-table";

type Tab = "people" | "steps" | "explanation";
type Modal = "reset" | "sample" | "help" | "table" | null;

const tabs: { value: Tab; label: string }[] = [
  { value: "people", label: "İştirakçılar" },
  { value: "steps", label: "Addımlar" },
  { value: "explanation", label: "İzah" },
];

export default function Workspace() {
  const { project, ready, saveState, undoCount, redoCount, update, undo, redo, replace, reset, unsavedReplacement, confirmReplacement, cancelReplacement, notice, setNotice } = useProject();
  const [tab, setTab] = useState<Tab>("people");
  const [selected, setSelected] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<DiagramRouteSelection | null>(null);
  const [routeEditorOpen, setRouteEditorOpen] = useState(false);
  const [inspectorStep, setInspectorStep] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportingWord, setExportingWord] = useState(false);
  const [exportingImage, setExportingImage] = useState<"svg" | "png" | null>(null);
  const [templateId, setTemplateId] = useState<ProcessTemplateId | "customer">("customer");
  const formScroll = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const previousProject = useRef("");
  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter(issue => issue.level === "error");
  const lanes = project.pools.flatMap(pool => pool.lanes.map(lane => ({ ...lane, poolName: pool.name })));
  const activeModal = unsavedReplacement ? "unsaved" : modal;

  useEffect(() => {
    if (!ready || previousProject.current === project.id) return;
    previousProject.current = project.id;
    setTab(project.steps.length ? "steps" : "people");
    setSelected(project.steps[0]?.id ?? null);
    setSelectedRoute(null);
    setRouteEditorOpen(false);
    setInspectorStep(null);
    setMenuOpen(false);
    formScroll.current?.scrollTo({ top: 0 });
  }, [ready, project.id, project.steps]);

  useEffect(() => {
    if (inspectorStep && !project.steps.some(step => step.id === inspectorStep)) setInspectorStep(null);
    if (selectedRoute && !project.steps.find(step => step.id === selectedRoute.sourceId)?.routes[selectedRoute.routeIndex]) { setSelectedRoute(null); setRouteEditorOpen(false); }
  }, [project.steps, inspectorStep, selectedRoute]);

  useEffect(() => {
    if (tab !== "steps" || !selected) return;
    const element = document.getElementById(`step-form-${selected}`);
    element?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [selected, tab]);

  useEffect(() => {
    if (!activeModal) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(dialogRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, a[href], [tabindex="0"]') ?? []);
    focusable()[0]?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") { cancelReplacement(); setModal(null); }
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previousFocus?.focus(); };
  }, [activeModal, cancelReplacement]);

  useEffect(() => {
    if (!menuOpen) return;
    projectMenuRef.current?.querySelector<HTMLButtonElement>("button:not([disabled])")?.focus();
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMenuOpen(false); menuButtonRef.current?.focus(); }
    };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);

  function updateStep(id: string, patch: Partial<Step>, historyKey?: string) {
    const fields = Object.keys(patch);
    const textField = fields.length === 1 && ["title", "description", "duration", "system", "document"].includes(fields[0]);
    update(current => {
      const existing = current.steps.find(step => step.id === id);
      if (!existing || fields.every(field => Object.is(existing[field as keyof Step], patch[field as keyof Step]))) return current;
      return { ...current, steps: current.steps.map(step => step.id === id ? { ...step, ...patch } : step) };
    }, historyKey ?? (textField ? `step:${id}:${fields[0]}` : undefined));
  }

  function selectStep(id: string) {
    setSelected(id);
    setSelectedRoute(null);
    setRouteEditorOpen(false);
    if (inspectorStep && inspectorStep !== id) setInspectorStep(null);
    setTab("steps");
  }

  function editStep(id: string) {
    selectStep(id);
    setInspectorStep(id);
  }

  function selectRoute(sourceId: string, routeIndex: number, openEditor = true) {
    setSelected(sourceId);
    setSelectedRoute({ sourceId, routeIndex });
    setRouteEditorOpen(openEditor);
    setInspectorStep(null);
    setTab("steps");
  }

  function removeRoute(sourceId: string, routeIndex: number) {
    update(current => ({ ...current, steps: current.steps.map(step => step.id === sourceId ? { ...step, routes: step.routes.filter((_, index) => index !== routeIndex) } : step) }));
    if (selectedRoute?.sourceId === sourceId) {
      if (selectedRoute.routeIndex === routeIndex) { setSelectedRoute(null); setRouteEditorOpen(false); }
      else if (selectedRoute.routeIndex > routeIndex) setSelectedRoute({ sourceId, routeIndex: selectedRoute.routeIndex - 1 });
    }
  }

  function moveStep(id: string, position: { x: number; y: number }, laneId?: string) {
    const bounded = clampNodePosition(position);
    update(current => moveDiagramStep(current, id, bounded, laneId));
  }

  function reconnectRoute(selection: DiagramRouteSelection, endpoint: "source" | "target", nodeId: string): boolean {
    let result: ReturnType<typeof reconnectDiagramRoute> | undefined;
    update(current => {
      result = reconnectDiagramRoute(current, selection, endpoint, nodeId);
      return result.project;
    });
    if (!result) return false;
    if (result.error) { setNotice(result.error); return false; }
    setSelected(result.selection.sourceId);
    setSelectedRoute(result.selection);
    setInspectorStep(null);
    setTab("steps");
    return true;
  }

  function duplicateStep(id: string) {
    const newId = createId();
    let result: ReturnType<typeof duplicateDiagramStep> | undefined;
    update(current => {
      result = duplicateDiagramStep(current, id, newId);
      return result.project;
    });
    if (result?.error) { setNotice(result.error); return; }
    if (result?.stepId) {
      editStep(result.stepId);
      setNotice("Addımın surəti yaradıldı. Keçidlərini özün seçərək axına əlavə et.");
    }
  }

  function clearEditorSelection() {
    setSelected(null);
    setSelectedRoute(null);
    setRouteEditorOpen(false);
    setInspectorStep(null);
  }

  function undoEdit() {
    clearEditorSelection();
    undo();
  }

  function redoEdit() {
    clearEditorSelection();
    redo();
  }

  function resetLayout() {
    update(current => current.steps.some(step => step.position) ? { ...current, steps: current.steps.map(({ position, ...step }) => { void position; return step; }) } : current);
  }

  function connectSteps(sourceId: string, targetId: string) {
    const source = project.steps.find(step => step.id === sourceId);
    if (!source || source.type === "end" || sourceId === targetId || !project.steps.some(step => step.id === targetId)) return;
    if (source.routes.some(route => route.targetId === targetId)) { setNotice("Bu iki addım artıq bağlıdır."); return; }
    if (source.routes.length >= 200) { setNotice("Bir addımda maksimum 200 keçid ola bilər."); return; }
    updateStep(source.id, { routes: [...source.routes, { targetId, label: "", description: "" }] });
    selectRoute(source.id, source.routes.length);
  }

  function openSample() {
    setTemplateId("customer");
    setModal("sample");
  }

  function sample() {
    const next = templateId === "customer" ? { ...structuredClone(SAMPLE_PROJECT), id: createId() } : createProcessTemplate(templateId);
    if (!replace(next)) return;
    setModal(null);
    setNotice("Nümunə açıldı. Məlumatları dəyişərək öz axınını qur.");
  }

  function closeModal() {
    cancelReplacement();
    setModal(null);
  }

  function clearProjects() {
    reset();
    setModal(null);
  }

  function setPoolCount(count: number) {
    if (!Number.isFinite(count)) return;
    count = Math.max(1, Math.min(8, Math.floor(count)));
    const removed = project.pools.slice(count).flatMap(pool => pool.lanes.map(lane => lane.id));
    if (project.steps.some(step => removed.includes(step.laneId))) {
      setNotice("Əvvəl bu pool-dakı addımların icraçısını dəyiş.");
      return;
    }
    update(current => ({
      ...current,
      pools: count < current.pools.length ? current.pools.slice(0, count) : [
        ...current.pools,
        ...Array.from({ length: count - current.pools.length }, (_, index) => ({
          id: createId(), name: `Pool ${current.pools.length + index + 1}`,
          lanes: [{ id: createId(), name: "İcraçı" }],
        })),
      ],
    }));
  }

  function deleteLane(poolId: string, laneId: string) {
    if (project.steps.some(step => step.laneId === laneId)) {
      setNotice("Əvvəl bu icraçının addımlarını başqa icraçıya keçir.");
      return;
    }
    update(current => ({ ...current, pools: current.pools.map(pool => pool.id === poolId ? { ...pool, lanes: pool.lanes.filter(lane => lane.id !== laneId) } : pool) }));
  }

  function addStep(type: StepType = "task", openInspector = false) {
    if (!lanes.length) { setNotice("Əvvəl ən azı bir icraçı əlavə et."); setTab("people"); return; }
    if (project.steps.length >= 200) { setNotice("Bir layihədə maksimum 200 addım ola bilər."); return; }
    const step: Step = {
      id: createId(), laneId: project.steps.find(item => item.id === selected)?.laneId ?? lanes[0].id, type,
      title: type === "start" ? "Başlanğıc" : type === "end" ? "Son" : "Yeni addım",
      description: "", routes: [],
    };
    update(current => ({ ...current, steps: [
      ...current.steps.map((item, index) => index === current.steps.length - 1 && item.type !== "end" && !item.routes.length && !["data", "annotation"].includes(item.type)
        ? { ...item, routes: [{ targetId: step.id, label: "" }] } : item),
      step,
    ] }));
    setSelected(step.id);
    setSelectedRoute(null);
    setInspectorStep(openInspector ? step.id : null);
    setTab("steps");
  }

  function addAfter(id: string) {
    const source = project.steps.find(step => step.id === id);
    if (!source || project.steps.length >= 200) return;
    const next: Step = { id: createId(), laneId: source.laneId, type: "task", title: "Yeni addım", description: "", routes: [] };
    update(current => insertStepAfter(current, id, next));
    selectStep(next.id);
    setInspectorStep(null);
    if (source.routes.length > 1) setNotice("Addım əlavə olundu. Hansı qola bağlanacağını keçidlərdə seç.");
  }

  function changeStepOrder(id: string, direction: "up" | "down") {
    update(current => moveStepInOrder(current, id, direction));
    selectStep(id);
  }

  function numberByFlow() {
    clearEditorSelection();
    update(reorderStepsByFlow);
    setNotice("Addımlar başlanğıcdan axın ardıcıllığı üzrə nömrələndi. İzah və ixrac da bu sıranı izləyir.");
  }

  function deleteStep(id: string) {
    const index = project.steps.findIndex(step => step.id === id);
    update(current => ({ ...current, steps: current.steps.filter(step => step.id !== id).map(step => ({ ...step, routes: step.routes.filter(route => route.targetId !== id) })) }));
    if (selected === id) setSelected(project.steps[index + 1]?.id ?? project.steps[index - 1]?.id ?? null);
    if (inspectorStep === id) setInspectorStep(null);
    setSelectedRoute(null);
  }

  function addRoute(step: Step) {
    if (step.routes.length >= 200) return;
    const target = project.steps.find(item => item.id !== step.id && !step.routes.some(route => route.targetId === item.id));
    if (!target) { setNotice("Yeni keçid üçün əvvəl başqa addım əlavə et."); return; }
    updateStep(step.id, { routes: [...step.routes, { targetId: target.id, label: "" }] });
    selectRoute(step.id, step.routes.length);
  }

  async function exportVisio() {
    setMenuOpen(false);
    if (!project.steps.length) { setNotice("Əvvəl prosesin ilk addımını əlavə et."); setTab("steps"); return; }
    if (errors.length) { setNotice("Visio faylını yükləmək üçün göstərilən xətaları düzəlt."); setTab("explanation"); return; }
    setExporting(true);
    try {
      const { generateVsdx } = await import("@/lib/vsdx");
      const data = await generateVsdx(project);
      download(new Uint8Array(data).buffer, `${filename(project.name)}.vsdx`, "application/vnd.ms-visio.drawing");
      setNotice("Visio faylı hazırdır. Yükləmə başladıldı.");
    } catch { setNotice("Visio faylı hazırlana bilmədi. Yenidən yoxla."); }
    finally { setExporting(false); }
  }

  async function exportWord() {
    setExportingWord(true);
    try {
      const { generateDocx } = await import("@/lib/docx");
      const data = await generateDocx(project);
      download(new Uint8Array(data).buffer, `${filename(project.name)}-izah.docx`, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
      setNotice("Word cədvəli hazırdır. Yükləmə başladıldı.");
    } catch { setNotice("Word faylı hazırlana bilmədi. Yenidən yoxla."); }
    finally { setExportingWord(false); }
  }

  async function exportImage(format: "svg" | "png") {
    setMenuOpen(false);
    const svg = document.getElementById("process-diagram") as SVGSVGElement | null;
    if (!svg) { setNotice("Diaqram hələ hazır deyil."); return; }
    const snapshot = svg.cloneNode(true) as SVGSVGElement;
    setExportingImage(format);
    try {
      const { serializeDiagram, generateDiagramPng } = await import("@/lib/diagram-image");
      const data = format === "svg" ? await serializeDiagram(snapshot, project) : await generateDiagramPng(snapshot, project);
      download(data, `${filename(project.name)}.${format}`, format === "svg" ? "image/svg+xml" : "image/png");
      setNotice(`${format.toUpperCase()} faylı hazırdır. Yükləmə başladıldı.`);
    } catch (error) { setNotice(error instanceof Error ? error.message : "Diaqram şəklini hazırlamaq mümkün olmadı."); }
    finally { setExportingImage(null); }
  }

  return <div className="studio-shell">
    <header className="studio-header">
      <a className="brand" href="#" onClick={event => event.preventDefault()} aria-label="VisioFlow ana səhifə">
        <span className="brand-icon"><GitBranch size={21}/></span><span>Visio<span className="brand-light">Flow</span></span>
      </a>
      <span className="header-divider" aria-hidden="true"/>
      <div className="header-project">
        <div className="header-menu">
          <button type="button" className="project-title-button" ref={menuButtonRef} aria-label="Layihə menyusu" aria-expanded={menuOpen} title={project.name||"Yeni iş axını"} onClick={()=>setMenuOpen(!menuOpen)}><span>{project.name||"Yeni iş axını"}</span><ChevronDown size={15}/></button>
          {menuOpen && <>
            <button type="button" className="menu-backdrop" tabIndex={-1} aria-label="Menyunu bağla" onClick={()=>{setMenuOpen(false);menuButtonRef.current?.focus();}}/>
            <div className="project-menu" ref={projectMenuRef}>
              <button type="button" aria-label="Yeni diaqram" disabled={!ready} onClick={()=>{setMenuOpen(false);replace(createProject());}}><Plus size={16}/> Yeni diaqram</button>
              <button type="button" aria-label="Nümunə proses" disabled={!ready} onClick={()=>{setMenuOpen(false);openSample();}}><Layers3 size={16}/> Nümunə proses</button>
              <button type="button" aria-label="SVG kimi yüklə" disabled={!ready || exportingImage!==null} onClick={()=>void exportImage("svg")}><ArrowDownToLine size={16}/> SVG kimi yüklə</button>
              <button type="button" aria-label="PNG kimi yüklə" disabled={!ready || exportingImage!==null} onClick={()=>void exportImage("png")}><ArrowDownToLine size={16}/> PNG kimi yüklə</button>
              <button type="button" onClick={()=>{setMenuOpen(false);setModal("help");}}><CircleHelp size={16}/> Necə işləyir?</button>
              <a href="/designs"><Layers3 size={16}/> İnterfeys nümunələri</a>
              <button type="button" className="danger-menu-item" onClick={()=>{setMenuOpen(false);setModal("reset");}}><Trash2 size={16}/> Hər şeyi sil</button>
            </div>
          </>}
        </div>
        <div className={`save-status ${saveState}`} aria-live="polite">
          {saveState === "saved" ? <Check size={14}/> : saveState === "saving" ? <LoaderCircle size={14} className="spin"/> : <CircleHelp size={14}/>}
          <span>{saveState === "saved" ? "Saxlanılıb" : saveState === "saving" ? "Saxlanılır…" : "Yaddaş əlçatan deyil"}</span>
        </div>
      </div>
      <div className="header-actions">
        <button type="button" className="secondary-button word-export-button" aria-label="Word izahını yüklə" disabled={exportingWord || !ready} onClick={()=>void exportWord()}>
          {exportingWord ? <LoaderCircle size={16} className="spin"/> : <FileText size={16}/>}
          <span className="button-label">{exportingWord ? "Hazırlanır…" : "Word izahı"}</span>
        </button>
        <button type="button" className="primary-button export-button" aria-label="Visio üçün yüklə" disabled={exporting || !ready} onClick={()=>void exportVisio()}>
          {exporting ? <LoaderCircle size={16} className="spin"/> : <ArrowDownToLine size={16}/>}
          <span className="export-label">{exporting ? "Hazırlanır…" : "Visio üçün yüklə"}</span><span className="mobile-export-label">Visio</span>
        </button>
      </div>
    </header>

    <main className="studio-main">
      <section className="form-panel" aria-label="İş axını forması">
        <nav className="form-tabs" aria-label="Proses forması">
          {tabs.map(item => <button type="button" key={item.value} className={tab === item.value ? "active" : ""} aria-current={tab === item.value ? "step" : undefined} onClick={()=>setTab(item.value)}>{item.label}{item.value === "steps" && project.steps.length > 0 && <span className="tab-count">{project.steps.length}</span>}</button>)}
        </nav>
        {tab === "steps" && !!project.steps.length && <div className="form-step-toolbar"><button type="button" className="text-button flow-numbering-button" aria-label="Axın ardıcıllığı üzrə nömrələ" disabled={!project.steps.some(step=>step.type==="start")} onClick={numberByFlow}><GitBranch size={14}/> Axın ardıcıllığı üzrə nömrələ</button></div>}
        <div className="form-scroll" ref={formScroll}>
          {tab === "people" && <div className="people-form">
            <div className="form-intro"><span className="section-label">01 — İŞTİRAKÇILAR</span><h1>Prosesini qur.</h1><p>Prosesi adlandır, iştirakçıları əlavə et. Axının sağda yaransın.</p></div>
            <label className="field-label">Prosesin adı<input aria-label="Prosesin adı" placeholder="Məsələn, Sənədin təsdiqi" maxLength={160} value={project.name} onChange={event=>update(current=>({...current,name:event.target.value}), `project:${project.id}:name`)}/></label>
            <div className="pool-count"><div><strong>Neçə pool olacaq?</strong><p>Hər pool bir təşkilat və ya tərəfdir.</p></div><div className="number-control"><button type="button" aria-label="Pool sayını azalt" disabled={project.pools.length<=1} onClick={()=>setPoolCount(project.pools.length-1)}>−</button><input aria-label="Pool sayı" type="number" min={1} max={8} value={project.pools.length} onChange={event=>setPoolCount(Number(event.target.value))}/><button type="button" aria-label="Pool sayını artır" disabled={project.pools.length>=8} onClick={()=>setPoolCount(project.pools.length+1)}>+</button></div></div>
            {project.pools.map((pool,index) => <fieldset className="pool-card" key={pool.id}>
              <legend className="pool-heading"><Layers3 size={14}/> Pool {index+1}</legend>
              <label className="field-label">Təşkilatın adı<input aria-label={`Pool ${index+1} adı`} placeholder="Təşkilat və ya tərəfin adı" maxLength={160} value={pool.name} onChange={event=>update(current=>({...current,pools:current.pools.map(item=>item.id===pool.id?{...item,name:event.target.value}:item)}), `pool:${pool.id}:name`)}/></label>
              <div className="field-caption">İcraçılar <span>Lane-lər</span></div>
              {pool.lanes.map((lane,laneIndex) => <div className="lane-input-row" key={lane.id}><span className="lane-dot"/><input aria-label={`Pool ${index+1} icraçı ${laneIndex+1}`} placeholder="Məsələn, Operator" maxLength={160} value={lane.name} onChange={event=>update(current=>({...current,pools:current.pools.map(item=>item.id===pool.id?{...item,lanes:item.lanes.map(role=>role.id===lane.id?{...role,name:event.target.value}:role)}:item)}), `lane:${lane.id}:name`)}/><button type="button" className="icon-button small-icon" aria-label={`${lane.name} icraçısını sil`} disabled={pool.lanes.length<=1} onClick={()=>deleteLane(pool.id,lane.id)}><X size={15}/></button></div>)}
              <button type="button" className="text-button" disabled={pool.lanes.length>=20} onClick={()=>update(current=>({...current,pools:current.pools.map(item=>item.id===pool.id?{...item,lanes:[...item.lanes,{id:createId(),name:"Yeni icraçı"}]}:item)}))}><Plus size={14}/> İcraçı əlavə et</button>
            </fieldset>)}
            <p className="form-note">Eyni təşkilatın rollarını bir pool daxilində saxla.</p>
          </div>}

          {tab === "steps" && <div className="steps-form">
            {!project.steps.length && <div className="form-intro"><h1>İş necə davam edir?</h1><p>Hər addımı bir forma kimi doldur. Sonra onu növbəti addıma bağla.</p></div>}
            {!project.steps.length && <div className="empty-steps"><span className="empty-step-icon"><GitBranch size={24}/></span><h2>Bir başlanğıc kifayətdir.</h2><p>İlk hadisəni əlavə et, sonra axını addım-addım qur.</p><button type="button" className="primary-button" onClick={()=>addStep("start")}><Plus size={15}/> Başlanğıc əlavə et</button></div>}
            <div className="step-list">
              {project.steps.map((step,index) => {
                const open = selected === step.id;
                const gateway = ["xor","or","and"].includes(step.type);
                const artifact = ["data","annotation"].includes(step.type);
                const kind = STEP_TYPES.find(item=>item.value===step.type)?.label;
                const lane = lanes.find(item=>item.id===step.laneId);
                return <article className={`step-card ${open ? "is-open" : ""}`} key={step.id} id={`step-form-${step.id}`}>
                  <div className="step-summary-row">
                    <button type="button" className="step-summary" aria-label={`${index+1}-ci addımı aç`} aria-expanded={open} aria-controls={`step-fields-${step.id}`} onClick={()=>{
                      if (open) { setSelected(null); setSelectedRoute(null); setRouteEditorOpen(false); setInspectorStep(null); }
                      else selectStep(step.id);
                    }}>
                      <span className="step-number">{index+1}</span><span className="step-summary-text"><strong>{step.title||"Adsız addım"}</strong><small>{lane?.name||"İcraçı seçilməyib"} <span>·</span> {kind}</small></span><ChevronDown size={15} className="step-summary-chevron"/>
                    </button>
                    <button type="button" className="icon-button small-icon" aria-label={`${index+1}-ci addımı yuxarı keçir`} title="Yuxarı keçir" disabled={index===0} onClick={()=>changeStepOrder(step.id,"up")}><ArrowUp size={14}/></button>
                    <button type="button" className="icon-button small-icon" aria-label={`${index+1}-ci addımı aşağı keçir`} title="Aşağı keçir" disabled={index===project.steps.length-1} onClick={()=>changeStepOrder(step.id,"down")}><ArrowDown size={14}/></button>
                    <button type="button" className="icon-button small-icon danger-icon" aria-label={`${index+1}-ci addımı sil`} onClick={()=>deleteStep(step.id)}><Trash2 size={14}/></button>
                  </div>
                  {open && <div className="step-form" id={`step-fields-${step.id}`}>
                    <button type="button" className="text-button insert-after-button" aria-label="Bu addımdan sonra əlavə et" disabled={project.steps.length>=200 || step.type==="end"} onClick={()=>addAfter(step.id)}><Plus size={14}/> Bu addımdan sonra əlavə et</button>
                    <label className="field-label">Addımın adı<input aria-label={`${index+1}-ci addımın adı`} placeholder="Bu addımda nə baş verir?" maxLength={240} value={step.title} onChange={event=>updateStep(step.id,{title:event.target.value})}/></label>
                    <div className="field-row">
                      <label className="field-label">Element növü<select aria-label={`${index+1}-ci addımın növü`} value={step.type} onChange={event=>updateStep(step.id,{type:event.target.value as StepType,routes:event.target.value==="end"?[]:step.routes})}>{STEP_TYPES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                      <label className="field-label">İcraçı<select aria-label={`${index+1}-ci addımın icraçısı`} value={step.laneId} onChange={event=>updateStep(step.id,{laneId:event.target.value})}>{lanes.map(item=><option key={item.id} value={item.id}>{project.pools.length>1?`${item.poolName} / `:""}{item.name}</option>)}</select></label>
                    </div>
                    <label className="field-label">İşin təsviri <span className="field-hint">İstəyə bağlı</span><textarea aria-label="Addımın təsviri" rows={3} placeholder="İcraçı nə edir? Hansı qaydalar var?" maxLength={10000} value={step.description} onChange={event=>updateStep(step.id,{description:event.target.value})}/></label>
                    {gateway && <>
                      <div className="gateway-selector" role="group" aria-label="Keçid şərtinin növü">{(["xor", "or", "and"] as const).map(type=><button type="button" key={type} aria-pressed={step.type===type} onClick={()=>updateStep(step.id,{type})}>{type.toUpperCase()}</button>)}</div>
                      <p className="field-help">{step.type==="xor"?"XOR — şərtə uyğun yalnız bir yol seçilir.":step.type==="or"?"OR — bir və ya bir neçə uyğun yol seçilir.":"AND — bütün qollar paralel davam edir. Birləşmədə bütün girişlər gözlənilir."}</p>
                    </>}
                    <div className="route-heading"><strong>{artifact?"Bağlı elementlər":gateway?"Çıxış qolları":"Növbəti addım"}</strong>{step.type!=="end"&&<button type="button" className="text-button" disabled={step.routes.length>=200} onClick={()=>addRoute(step)} aria-label="Keçid əlavə et"><Plus size={13}/> Keçid</button>}</div>
                    {step.type==="end"?<p className="field-help">Bu qol burada tamamlanır.</p>:<>
                      {!step.routes.length && <p className="field-help">Keçid əlavə edərək axını davam etdir.</p>}
                      {step.routes.map((route,routeIndex)=>{
                        const label = route.label.toLocaleLowerCase("az");
                        const tone = /imtina|rədd|geri/.test(label) ? "route-tone-negative" : /təsdiq|qəbul/.test(label) ? "route-tone-positive" : "";
                        const target = project.steps.find(item=>item.id===route.targetId);
                        return <div className={`route-card ${tone}`} key={routeIndex}>
                          <button type="button" className="route-summary" aria-label={`Keçid ${routeIndex+1} izahını aç`} title="Keçidin etiketini, hədəfini və izahını redaktə et" onClick={()=>selectRoute(step.id,routeIndex)}>
                            {step.routes.length>1 && <span className="branch-number">{getRouteNumber(project,step.id,routeIndex)}</span>}
                            <span className="route-label">{route.label || "Keçid"}</span><ArrowRight size={13}/><span className="route-target">{target?.title || "Hədəf seçilməyib"}</span>
                          </button>
                          <button type="button" className="icon-button small-icon route-summary-delete" aria-label={`Keçid ${routeIndex+1} sil`} onClick={()=>removeRoute(step.id,routeIndex)}><X size={14}/></button>
                        </div>;
                      })}
                    </>}
                  </div>}
                </article>;
              })}
            </div>
          </div>}

          {tab === "explanation" && <div className="explanation-form">
            <div className="form-intro"><span className="section-label">03 — İZAH</span><h1>Axını nəzərdən keçir.</h1><p>İzahı oxu, əlaqələri yoxla və Visio faylını yüklə.</p></div>
            <div className={`validation-card ${errors.length?"has-errors":""}`}><ShieldCheck size={20}/><div><strong>{errors.length?`${errors.length} düzəliş tələb olunur`:"Struktur yoxlaması tamamlandı"}</strong><p>{errors.length?"Aşağıdakı xətaları düzəlt.":"Biznes qaydalarını da nəzərdən keçir."}</p></div></div>
            {!!issues.length && <details className="validation-details" open={errors.length>0}><summary>Yoxlama qeydləri <span>{issues.length}</span></summary><ul className="issue-list">{issues.map((issue,index)=><li key={index} className={issue.level}><span>{issue.level==="error"?"Xəta":"Qeyd"}</span><button type="button" onClick={()=>{if(issue.stepId){setSelected(issue.stepId);setTab("steps");}else setTab("people");}}>{issue.message}</button></li>)}</ul></details>}
            <div className="explanation-toolbar"><span>WORD CƏDVƏLİ</span><button type="button" className="text-button" disabled={exportingWord} onClick={()=>void exportWord()}><ArrowDownToLine size={13}/> Word cədvəli yüklə</button></div>
            <button type="button" className="secondary-button word-expand-button" onClick={()=>setModal("table")}><FileText size={14}/> İzah cədvəlinə geniş bax</button>
            <ExplanationTable project={project} onSelect={(id,index)=>index===undefined?editStep(id):selectRoute(id,index)}/>
          </div>}
        </div>
        <footer className="form-footer">
          {tab==="people"?<button type="button" className="primary-button continue-button" onClick={()=>setTab("steps")}>Addımlara keç <ArrowRight size={15}/></button>:tab==="steps"?<>
            {!!project.steps.length && <button type="button" className="secondary-button add-step-button" disabled={!ready || project.steps.length>=200} onClick={()=>addStep()}><Plus size={15}/> Addım əlavə et</button>}
            <div className="footer-navigation"><button type="button" className="text-button" disabled={!ready || project.steps.length>=200} onClick={()=>addStep("end")}>Son hadisəsi <Plus size={13}/></button><button type="button" className="text-button" onClick={()=>setTab("explanation")}>İzahı yoxla <ArrowRight size={14}/></button></div>
          </>:<div className="footer-navigation"><button type="button" className="text-button" onClick={()=>setTab("steps")}><ArrowLeft size={14}/> Addımlar</button><span className="form-save-caption">.vsdx ilə Visio-da davam et</span></div>}
          <div className="form-status-line"><Check size={13}/><span>{saveState==="unavailable"?"Brauzer yaddaşına giriş yoxdur.":"Dəyişikliklər avtomatik saxlanılır"}</span></div>
        </footer>
      </section>

      <section className="preview-panel" aria-label="Canlı iş axını">
        <div className="preview-heading"><div className="canvas-title"><span className="live-dot"/><h2>Canlı diaqram</h2></div><div className="canvas-stats">{project.pools.length} pool <span>·</span> {lanes.length} icraçı <span>·</span> {project.steps.length} addım</div></div>
        <Diagram project={project} selectedId={selected} selectedRoute={selectedRoute} onSelect={selectStep} onEditStep={editStep} onSelectRoute={(sourceId,index)=>selectRoute(sourceId,index,false)} onEditRoute={selectRoute} onMoveStep={moveStep} onReconnectRoute={reconnectRoute} onDuplicateStep={duplicateStep} onDeleteRoute={selection=>removeRoute(selection.sourceId,selection.routeIndex)} onResetLayout={resetLayout} onConnect={connectSteps} onDeleteStep={deleteStep} onAddShape={type=>addStep(type,true)} controlsDisabled={!ready || project.steps.length>=200} onUndo={undoEdit} canUndo={undoCount>0} onRedo={redoEdit} canRedo={redoCount>0}>
          {(inspectorStep || (selectedRoute && routeEditorOpen)) && <CanvasInspector project={project} stepId={inspectorStep} routeSelection={routeEditorOpen ? selectedRoute : null} onUpdate={updateStep} onReconnectRoute={reconnectRoute} onDuplicateStep={duplicateStep} onDeleteStep={deleteStep} onDeleteRoute={removeRoute} onClose={()=>{setInspectorStep(null);setRouteEditorOpen(false);}}/>}
        </Diagram>
      </section>
    </main>

    {notice && <div className="toast" role="status"><CircleHelp size={18}/><span>{notice}</span><button type="button" aria-label="Bildirişi bağla" onClick={()=>setNotice("")}><X size={16}/></button></div>}
    {activeModal && <div className="modal-overlay" onClick={closeModal}><section className={`modal ${activeModal==="table"?"word-table-modal":""}`} ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={event=>event.stopPropagation()}>
      <button type="button" className="modal-close icon-button" aria-label="Pəncərəni bağla" onClick={closeModal}><X size={18}/></button>
      <span className={`modal-icon ${activeModal==="reset"||activeModal==="unsaved"?"red":""}`}>{activeModal==="reset"?<Trash2 size={24}/>:activeModal==="sample"?<Layers3 size={24}/>:<CircleHelp size={24}/>}</span>
      <h2 id="modal-title">{activeModal==="reset"?"Hər şeyi silmək istəyirsən?":activeModal==="sample"?"Nümunə prosesi açaq?":activeModal==="unsaved"?"Dəyişikliklər saxlanılmayıb":activeModal==="table"?"İş axınının izah cədvəli":"Formadan Visio diaqramına"}</h2>
      {activeModal==="table"?<><p>{project.name}</p><ExplanationTable project={project}/><div className="modal-actions"><button type="button" className="secondary-button" onClick={closeModal}>Bağla</button><button type="button" className="primary-button" disabled={exportingWord} onClick={()=>void exportWord()}><ArrowDownToLine size={14}/> Word faylını yüklə</button></div></>:activeModal==="help"?<div className="help-content"><p><strong>1. İştirakçıları əlavə et.</strong> Prosesin adını, pool-ları və onların daxilindəki rolları yaz.</p><p><strong>2. Addımları doldur.</strong> Fiquru başqa iştirakçının sahəsinə sürüşdür: izahda icraçı da dəyişir. İki kliklə və ya Redaktə et düyməsi ilə paneli aç. Seçilmiş fiqurun + tutacağını digər fiqura apararaq yeni keçid yarat.</p><p><strong>3. Keçidə izah yaz.</strong> Xətti seçib ucundakı dairəni başqa fiqura sürüşdürərək oxun başlanğıcını və ya hədəfini dəyiş. Etiketə basıb qısa mətni və ətraflı izahı doldur. İcraçı, hədəf və qol nömrələri Word cədvəlində də yenilənir.</p><p><strong>4. Faylları yüklə.</strong> Diaqram .vsdx, izah isə redaktə olunan .docx cədvəli kimi yüklənir.</p><p>Dəyişikliklər bu brauzerdə avtomatik saxlanılır. Eyni ünvanı açanda və ya səhifəni yeniləyəndə işinə davam edirsən. Ünvanın hash hissəsini silsən, yeni boş layihə başlayır.</p><button type="button" className="primary-button" onClick={closeModal}>Aydındır <Check size={15}/></button></div>:<>
        {activeModal==="sample" && <fieldset className="template-options"><legend>Hazır proses seç</legend>
          {[{id:"customer", name:"Müştəri müraciətləri", description:"Əvvəlki operator, vizaçı və icraçı nümunəsi."}, ...PROCESS_TEMPLATES].map(item=><label key={item.id} className={`template-option ${templateId===item.id ? "is-selected" : ""}`}>
            <input type="radio" name="process-template" aria-label={item.name} checked={templateId===item.id} onChange={()=>setTemplateId(item.id as ProcessTemplateId|"customer")}/><span><strong>{item.name}</strong><small>{item.description}</small></span>
          </label>)}
        </fieldset>}
        <p>{activeModal==="reset"?"Bu brauzerdəki bütün VisioFlow layihələri silinəcək. Bu əməliyyat geri qaytarılmır.":activeModal==="sample"?"Seçdiyin nümunə açılacaq. Saxlanmış layihən öz əvvəlki ünvanında qalacaq.":"Brauzer son dəyişiklikləri saxlaya bilmədi. Hazırkı işi açıq saxlaya və ya dəyişiklikləri itirməyi qəbul edib davam edə bilərsən."}</p>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={closeModal}>Ləğv et</button><button type="button" className={activeModal==="sample"?"primary-button":"danger-button"} onClick={activeModal==="reset"?clearProjects:activeModal==="sample"?sample:()=>{confirmReplacement();setModal(null);}}>{activeModal==="reset"?"Bəli, hər şeyi sil":activeModal==="sample"?"Nümunəni aç":"Saxlamadan davam et"}</button></div>
      </>}
    </section></div>}
  </div>;
}
