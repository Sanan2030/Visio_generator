"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowRight, Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, FileJson, FileText, GitBranch, Layers3, LayoutGrid, LoaderCircle, Plus, RotateCcw, Settings2, ShieldCheck, Trash2, Upload, Users, X } from "lucide-react";
import type { Project, Step, StepType } from "@/lib/types";
import { createId, createProject, explainProject, SAMPLE_PROJECT, STEP_TYPES, validateProject } from "@/lib/process";
import { download, filename, MAX_FILE_SIZE, MAX_STORED_SIZE, parseProject, STORAGE_PREFIX } from "@/lib/storage";
import Diagram from "./diagram";

type Tab = "people" | "steps" | "explanation";
type SaveState = "saving" | "saved" | "unavailable";
type Modal = "reset" | "sample" | "help" | null;

export default function Workspace() {
  const [project, setProject] = useState<Project>(() => createProject());
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("people");
  const [selected, setSelected] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saving");
  const [modal, setModal] = useState<Modal>(null);
  const [notice, setNotice] = useState("");
  const [exportOpen, setExportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const history = useRef<Project[]>([]);
  const [undoCount, setUndoCount] = useState(0);
  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter(issue => issue.level === "error");
  const lanes = project.pools.flatMap(pool => pool.lanes.map(lane => ({ ...lane, poolName: pool.name })));
  const activeStep = project.steps.find(step => step.id === selected);
  const explanation = useMemo(() => explainProject(project), [project]);

  useEffect(() => {
    function restore() {
      let restored: Project | null = null;
      const id = window.location.hash.slice(1);
      if (/^[a-zA-Z0-9_-]{1,100}$/.test(id)) {
        try {
          const stored = localStorage.getItem(STORAGE_PREFIX + id);
          if (stored) {
            restored = parseProject(stored, MAX_STORED_SIZE);
            if (restored.id !== id) restored = null;
          }
        } catch {
          setNotice("Yerli yaddaş oxunmadı. JSON ehtiyat nüsxəsini yükləyərək işini qoru.");
        }
      }
      const next = restored ?? createProject();
      setProject(next);
      setTab(next.steps.length ? "steps" : "people");
      setSelected(null);
      history.current = [];
      setUndoCount(0);
      window.history.replaceState(null, "", `#${next.id}`);
      setReady(true);
    }
    restore();
    window.addEventListener("hashchange", restore);
    return () => window.removeEventListener("hashchange", restore);
  }, []);

  useEffect(() => {
    if (!ready) return;
    setSaveState("saving");
    try {
      localStorage.setItem(STORAGE_PREFIX + project.id, JSON.stringify(project));
      window.history.replaceState(null, "", `#${project.id}`);
      setSaveState("saved");
    } catch { setSaveState("unavailable"); }
  }, [project, ready]);

  useEffect(() => {
    if (!modal) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusable = () => Array.from(dialog?.querySelectorAll<HTMLElement>('button:not([disabled]), input, select, textarea, a[href], [tabindex="0"]') ?? []);
    focusable()[0]?.focus();
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") setModal(null);
      if (event.key !== "Tab") return;
      const items = focusable();
      const first = items[0], last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
    document.addEventListener("keydown", handleKey);
    return () => { document.removeEventListener("keydown", handleKey); previousFocus?.focus(); };
  }, [modal]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(""), 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  function update(change: (current: Project) => Project) {
    history.current = [...history.current.slice(-29), project];
    setUndoCount(history.current.length);
    setProject(change(project));
  }

  function updateStep(id: string, patch: Partial<Step>) {
    update(current => ({ ...current, steps: current.steps.map(step => step.id === id ? { ...step, ...patch } : step) }));
  }

  function undo() {
    const previous = history.current.pop();
    if (previous) { setProject(previous); setUndoCount(history.current.length); }
  }

  function replace(next: Project) {
    setProject(next);
    setSelected(null);
    history.current = [];
    setUndoCount(0);
    window.history.replaceState(null, "", `#${next.id}`);
    setTab(next.steps.length ? "steps" : "people");
  }

  function sample() {
    replace({ ...structuredClone(SAMPLE_PROJECT), id: createId() });
    setModal(null);
    setNotice("Nümunə açıldı. İstənilən xananı dəyişərək öz prosesini qur.");
  }

  function reset() {
    try {
      Object.keys(localStorage).filter(key => key.startsWith(STORAGE_PREFIX)).forEach(key => localStorage.removeItem(key));
    } catch { setNotice("Brauzer yerli yaddaşın silinməsinə icazə vermədi."); }
    replace(createProject());
    setModal(null);
  }

  function setPoolCount(count: number) {
    if (!Number.isFinite(count)) return;
    count = Math.max(1, Math.min(8, Math.floor(count)));
    const removed = project.pools.slice(count).flatMap(pool => pool.lanes.map(lane => lane.id));
    if (project.steps.some(step => removed.includes(step.laneId))) {
      setNotice("Pool-u silmək üçün əvvəl onun addımlarını başqa icraçıya keçir."); return;
    }
    update(current => ({ ...current, pools: count < current.pools.length ? current.pools.slice(0, count) : [...current.pools, ...Array.from({ length: count - current.pools.length }, (_, index) => ({ id: createId(), name: `Pool ${current.pools.length + index + 1}`, lanes: [{ id: createId(), name: "İcraçı" }] }))] }));
  }

  function addStep(type: StepType = "task") {
    if (!lanes.length) { setNotice("Əvvəl ən azı bir icraçı əlavə et."); setTab("people"); return; }
    if (project.steps.length >= 200) { setNotice("Bir layihədə maksimum 200 addım ola bilər."); return; }
    const step: Step = { id: createId(), laneId: lanes[0].id, type, title: type === "start" ? "Başlanğıc" : type === "end" ? "Son" : "Yeni addım", description: "", routes: [] };
    update(current => ({ ...current, steps: [...current.steps.map((item, i) => i === current.steps.length - 1 && item.type !== "end" && item.routes.length === 0 && !["data", "annotation"].includes(item.type) ? { ...item, routes: [{ targetId: step.id, label: "" }] } : item), step] }));
    setSelected(step.id);
    setTab("steps");
  }

  function deleteStep(id: string) {
    update(current => ({ ...current, steps: current.steps.filter(step => step.id !== id).map(step => ({ ...step, routes: step.routes.filter(route => route.targetId !== id) })) }));
    if (selected === id) setSelected(null);
  }

  async function exportFile(format: "vsdx" | "json" | "svg" | "text") {
    setExportOpen(false);
    const name = filename(project.name);
    if (format === "json") { download(JSON.stringify(project, null, 2), `${name}.json`, "application/json"); return; }
    if (format === "text") { download(explanation, `${name}-izah.txt`, "text/plain;charset=utf-8"); return; }
    if (!project.steps.length) { setNotice("Diaqram yükləmək üçün əvvəl addım əlavə et."); return; }
    if (errors.length) { setNotice("İxracdan əvvəl yoxlamadakı xətaları düzəlt."); setTab("explanation"); return; }
    try {
      setExporting(true);
      if (format === "vsdx") {
        const { generateVsdx } = await import("@/lib/vsdx");
        const data = await generateVsdx(project);
        download(new Uint8Array(data).buffer, `${name}.vsdx`, "application/vnd.ms-visio.drawing");
      } else {
        const svg = document.getElementById("process-diagram")?.cloneNode(true) as SVGSVGElement | undefined;
        if (!svg) throw new Error("Diaqram tapılmadı.");
        svg.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        download(new XMLSerializer().serializeToString(svg), `${name}.svg`, "image/svg+xml;charset=utf-8");
      }
      setNotice("Fayl hazırdır. Yükləmə başladıldı.");
    } catch { setNotice("Fayl hazırlana bilmədi. JSON ehtiyat nüsxəsini yüklə və yenidən yoxla."); }
    finally { setExporting(false); }
  }

  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_FILE_SIZE) throw new Error("Fayl maksimum 2 MB ola bilər.");
      const next = parseProject(await file.text());
      replace({ ...next, id: createId() });
      setNotice("Layihə açıldı. Əvvəlki layihə öz ünvanında saxlanılıb.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Fayl oxunmadı."); }
    if (fileInput.current) fileInput.current.value = "";
  }

  const stepsComplete = project.steps.length > 0 && errors.length === 0;
  return <div className="app-shell">
    <aside className="sidebar">
      <a className="brand" href="#" onClick={event => event.preventDefault()} aria-label="VisioFlow ana səhifə"><span className="brand-icon"><GitBranch size={23} /></span><span>visio<span className="brand-light">flow</span><small>İŞ AXINI STUDİYASI</small></span></a>
      <button className="new-project" onClick={() => replace(createProject())}><Plus size={17} /> Yeni diaqram</button>
      <div className="nav-caption">İŞ MƏKANI</div>
      <nav className="main-nav" aria-label="Layihə bölmələri">
        <button className={tab === "people" ? "nav-item active" : "nav-item"} onClick={() => setTab("people")}><Users size={19} /><span>İştirakçılar</span><span className="nav-number">01</span></button>
        <button className={tab === "steps" ? "nav-item active" : "nav-item"} onClick={() => setTab("steps")}><LayoutGrid size={19} /><span>Proses addımları</span><span className="nav-number">02</span></button>
        <button className={tab === "explanation" ? "nav-item active" : "nav-item"} onClick={() => setTab("explanation")}><FileText size={19} /><span>İzah və yoxlama</span><span className="nav-number">03</span></button>
      </nav>
      <div className="nav-caption second">ALƏTLƏR</div>
      <button className="nav-item" onClick={() => project.steps.length ? setModal("sample") : sample()}><Layers3 size={19} /><span>Nümunə proses</span></button>
      <button className="nav-item" onClick={() => fileInput.current?.click()}><Upload size={19} /><span>JSON layihə aç</span></button>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => void importFile(event.target.files?.[0])} aria-label="JSON layihə faylı" />
      <div className="sidebar-bottom"><div className="local-card"><span className="local-icon"><ShieldCheck size={19} /></span><strong>İşin sənin brauzerindədir</strong><p>Hesab tələb olunmur. Dəyişikliklər avtomatik saxlanılır.</p><span className="local-label"><span /> Yalnız bu cihazda</span></div><button className="nav-item help-link" onClick={() => setModal("help")}><CircleHelp size={18} /><span>Necə işləyir?</span><ArrowRight size={15}/></button></div>
    </aside>

    <main className="main-content">
      <header className="topbar"><div className="breadcrumb"><span>İş məkanı</span><ChevronRight size={14}/><strong>Diaqram redaktoru</strong></div><span className="version-pill">BETA <span>0.1</span></span><div className="topbar-actions"><div className="mobile-tools"><button className="icon-button" aria-label="Nümunə aç" onClick={() => project.steps.length ? setModal("sample") : sample()}><Layers3 size={15}/></button><button className="icon-button" aria-label="JSON layihəsini aç" onClick={() => fileInput.current?.click()}><Upload size={15}/></button><button className="icon-button" aria-label="Kömək" onClick={() => setModal("help")}><CircleHelp size={15}/></button></div><button className="icon-button" aria-label="Son dəyişikliyi geri al" disabled={!undoCount} onClick={undo}><RotateCcw size={17}/></button><button className="danger-icon icon-button" aria-label="Hər şeyi sil" onClick={() => setModal("reset")}><Trash2 size={17}/></button></div></header>
      <section className="project-header"><div><div className="eyebrow"><span/> SADƏDƏN VİZUALA</div><input className="project-title" aria-label="Prosesin adı" maxLength={160} value={project.name} onChange={event => update(current => ({...current, name:event.target.value}))}/><p>Prosesi cədvəldə qur. Axının necə yarandığını canlı izlə.</p></div><div className="header-right"><span className={`save-status ${saveState}`}>{saveState === "saved" ? <CheckCircle2 size={15}/> : saveState === "saving" ? <LoaderCircle size={15} className="spin"/> : <CircleHelp size={15}/>} {saveState === "saved" ? "Brauzerdə saxlanıldı" : saveState === "saving" ? "Saxlanılır…" : "Yaddaş əlçatan deyil"}</span><div className="export-wrap"><button className="primary-button export-button" disabled={exporting || !ready} onClick={() => setExportOpen(!exportOpen)}>{exporting ? <LoaderCircle size={17} className="spin"/> : <ArrowDownToLine size={17}/>} {exporting ? "Hazırlanır…" : "Yüklə"}<ChevronDown size={15}/></button>{exportOpen && <><button aria-label="Yükləmə menyusunu bağla" className="menu-backdrop" onClick={() => setExportOpen(false)}/><div className="export-menu"><button onClick={() => void exportFile("vsdx")}><GitBranch size={17}/><span>Microsoft Visio<small>Redaktə olunan .vsdx</small></span><span className="format-tag">VSDX</span></button><button onClick={() => void exportFile("svg")}><Layers3 size={17}/><span>Vektor diaqramı<small>Keyfiyyətli görüntü</small></span><span className="format-tag">SVG</span></button><button onClick={() => void exportFile("json")}><FileJson size={17}/><span>Layihənin ehtiyat nüsxəsi<small>Sonra yenidən açmaq üçün</small></span><span className="format-tag">JSON</span></button><button onClick={() => void exportFile("text")}><FileText size={17}/><span>İş axınının izahı</span><span className="format-tag">TXT</span></button></div></>}</div></div></section>

      <div className="workflow-strip"><button onClick={() => setTab("people")} className={tab === "people" ? "workflow-step current" : "workflow-step"}><span className="step-bubble">{lanes.length && tab !== "people" ? <Check size={13}/> : "1"}</span><span>Pool və icraçılar</span></button><div className="step-line"/><button onClick={() => setTab("steps")} className={tab === "steps" ? "workflow-step current" : "workflow-step"}><span className="step-bubble">2</span><span>Addımlar və keçidlər</span></button><div className="step-line"/><button onClick={() => setTab("explanation")} className={tab === "explanation" ? "workflow-step current" : "workflow-step"}><span className="step-bubble">{stepsComplete && tab !== "explanation" ? <Check size={13}/> : "3"}</span><span>Yoxla və yüklə</span></button><span className="live-label"><span/> Canlı generasiya</span></div>

      <div className="editor-grid">
        <section className="editor-panel">
          <div className="panel-heading"><div className="panel-title"><span className="panel-icon">{tab === "people" ? <Users size={18}/> : tab === "steps" ? <LayoutGrid size={18}/> : <FileText size={18}/>}</span><div><h2>{tab === "people" ? "İştirakçıları müəyyən et" : tab === "steps" ? "Proses addımları" : "İş axınının izahı"}</h2><p>{tab === "people" ? "Hər pool bir iştirakçı təşkilatı, hər lane isə bir roldur." : tab === "steps" ? "Hər sətir diaqramdakı bir elementdir." : "Daxil etdiyin məlumatlar əsasında avtomatik izah."}</p></div></div>{tab === "steps" && <span className="count-pill">{project.steps.length} addım</span>}</div>

          {tab === "people" && <div className="people-editor"><div className="setup-intro"><div><strong>Neçə pool olacaq?</strong><p>Eyni təşkilatın rollarını bir pool daxilində saxla.</p></div><div className="number-control"><button aria-label="Pool sayını azalt" disabled={project.pools.length <= 1} onClick={() => setPoolCount(project.pools.length - 1)}>−</button><input aria-label="Pool sayı" type="number" min={1} max={8} value={project.pools.length} onChange={event => setPoolCount(Number(event.target.value))}/><button aria-label="Pool sayını artır" disabled={project.pools.length >= 8} onClick={() => setPoolCount(project.pools.length + 1)}>+</button></div></div>
            {project.pools.map((pool,index) => <div className="pool-card" key={pool.id}><div className="pool-heading"><span className="pool-index">{String(index + 1).padStart(2,"0")}</span><label>Pool-un adı<input aria-label={`Pool ${index + 1} adı`} value={pool.name} maxLength={160} onChange={event => update(current => ({...current,pools:current.pools.map(item=>item.id===pool.id?{...item,name:event.target.value}:item)}))}/></label><Layers3 size={18}/></div><div className="lane-editor"><div className="field-caption">İCRAÇILAR / LANE-LƏR</div>{pool.lanes.map((lane,laneIndex) => <div className="lane-input-row" key={lane.id}><span className="lane-dot"/><input aria-label={`Pool ${index+1} icraçı ${laneIndex+1}`} placeholder="Məsələn, Operator" maxLength={160} value={lane.name} onChange={event=>update(current=>({...current,pools:current.pools.map(item=>item.id===pool.id?{...item,lanes:item.lanes.map(role=>role.id===lane.id?{...role,name:event.target.value}:role)}:item)}))}/><button className="small-icon" aria-label={`${lane.name} icraçısını sil`} disabled={pool.lanes.length <= 1} onClick={()=>{if(project.steps.some(step=>step.laneId===lane.id)){setNotice("Bu icraçının addımlarını əvvəl başqa icraçıya keçir.");return;}update(current=>({...current,pools:current.pools.map(item=>item.id===pool.id?{...item,lanes:item.lanes.filter(role=>role.id!==lane.id)}:item)}));}}><X size={15}/></button></div>)}<button className="text-button" disabled={pool.lanes.length>=20} onClick={()=>update(current=>({...current,pools:current.pools.map(item=>item.id===pool.id?{...item,lanes:[...item.lanes,{id:createId(),name:"Yeni icraçı"}]}:item)}))}><Plus size={15}/> İcraçı əlavə et</button></div></div>)}
            <div className="info-note"><GitBranch size={17}/><p>Pool-lar arasındakı keçidlər <strong>mesaj axını</strong>, eyni pool daxilindəki keçidlər isə <strong>ardıcıl axın</strong> kimi göstərilir.</p></div><button className="primary-button continue-button" onClick={()=>setTab("steps")}>Addımları qurmağa başla <ArrowRight size={16}/></button>
          </div>}

          {tab === "steps" && <div className="steps-editor"><div className="table-scroll"><table className="steps-table"><thead><tr><th>№</th><th>ADDIMIN ADI</th><th>NÖV</th><th>İCRAÇI</th><th/></tr></thead><tbody>{project.steps.map((step,index)=><tr key={step.id} className={selected===step.id?"selected-row":""}><td><button className="row-number" aria-label={`${index+1}-ci addımın keçidləri`} onClick={()=>setSelected(step.id)}>{String(index+1).padStart(2,"0")}</button></td><td><input aria-label={`${index+1}-ci addımın adı`} value={step.title} maxLength={240} onFocus={()=>setSelected(step.id)} onChange={event=>updateStep(step.id,{title:event.target.value})}/><button className="row-details" onClick={()=>setSelected(selected===step.id?null:step.id)}>Təsvir və keçidlər <ChevronRight size={11}/></button></td><td><select aria-label={`${index+1}-ci addımın növü`} value={step.type} onFocus={()=>setSelected(step.id)} onChange={event=>updateStep(step.id,{type:event.target.value as StepType,routes:event.target.value==="end"?[]:step.routes})}>{STEP_TYPES.map(type=><option key={type.value} value={type.value}>{type.label}</option>)}</select></td><td><select aria-label={`${index+1}-ci addımın icraçısı`} value={step.laneId} onFocus={()=>setSelected(step.id)} onChange={event=>updateStep(step.id,{laneId:event.target.value})}>{lanes.map(lane=><option key={lane.id} value={lane.id}>{project.pools.length>1?`${lane.poolName} / `:""}{lane.name}</option>)}</select></td><td><button className="small-icon" aria-label={`${index+1}-ci addımı sil`} onClick={()=>deleteStep(step.id)}><Trash2 size={14}/></button></td></tr>)}</tbody></table></div>
            {project.steps.length===0 && <div className="empty-steps"><span><GitBranch size={29}/></span><h3>Hər proses bir addımla başlayır</h3><p>Başlanğıc hadisəsi əlavə et, sonra tapşırıqları və qərarları cədvəldə ardıcıl qur.</p><button className="primary-button" onClick={()=>addStep("start")}><Plus size={16}/> Başlanğıc əlavə et</button><button className="text-button" onClick={sample}>Nümunə ilə tanış ol <ArrowRight size={14}/></button></div>}
            {project.steps.length>0 && <div className="add-step-bar"><button className="text-button" onClick={()=>addStep()}><Plus size={16}/> Addım əlavə et</button><button className="text-button muted" onClick={()=>addStep("end")}>Son hadisəsi <Plus size={14}/></button></div>}
            {activeStep && <div className="step-detail"><div className="detail-heading"><span><Settings2 size={16}/> Addım {project.steps.findIndex(step=>step.id===activeStep.id)+1}</span><button className="small-icon" aria-label="Addım detallarını bağla" onClick={()=>setSelected(null)}><X size={16}/></button></div><label className="field-label">Addımın təsviri<textarea value={activeStep.description} maxLength={10000} rows={3} placeholder="İcraçı nə edir? Hansı qaydalar və nəticələr var?" onChange={event=>updateStep(activeStep.id,{description:event.target.value})}/></label><div className="route-heading"><strong>Növbəti keçidlər</strong><span>{["xor","or","and"].includes(activeStep.type)?activeStep.type.toUpperCase()+" keçidi":"Axının davamı"}</span></div>{activeStep.type==="end"?<p className="muted-text">Son hadisəsindən çıxış keçidi yoxdur.</p>:<>{activeStep.routes.map((route,index)=><div className="route-row" key={index}><ArrowRight size={15}/><select aria-label={`Keçid ${index+1} hədəfi`} value={route.targetId} onChange={event=>updateStep(activeStep.id,{routes:activeStep.routes.map((item,i)=>i===index?{...item,targetId:event.target.value}:item)})}><option value="">Növbəti addımı seç</option>{project.steps.filter(step=>step.id!==activeStep.id).map((step,i)=><option key={step.id} value={step.id}>{project.steps.indexOf(step)+1}. {step.title||`Addım ${i+1}`}</option>)}</select><input aria-label={`Keçid ${index+1} şərti`} placeholder="Şərt / əməliyyat" maxLength={500} value={route.label} onChange={event=>updateStep(activeStep.id,{routes:activeStep.routes.map((item,i)=>i===index?{...item,label:event.target.value}:item)})}/><button className="small-icon" aria-label={`Keçid ${index+1} sil`} onClick={()=>updateStep(activeStep.id,{routes:activeStep.routes.filter((_,i)=>i!==index)})}><X size={14}/></button></div>)}<button className="text-button" onClick={()=>{const target=project.steps.find(step=>step.id!==activeStep.id&&!activeStep.routes.some(route=>route.targetId===step.id));if(!target){setNotice("Keçid üçün əvvəl başqa addım əlavə et.");return;}updateStep(activeStep.id,{routes:[...activeStep.routes,{targetId:target.id,label:""}]});}}><Plus size={14}/> Keçid əlavə et</button></>}{["xor","or","and"].includes(activeStep.type)&&<div className="gateway-tip">{activeStep.type==="xor"?"XOR: şərtə uyğun yalnız bir yol seçilir.":activeStep.type==="or"?"OR: şərtlərə uyğun bir və ya bir neçə yol seçilir.":"AND: bütün çıxış yolları paralel davam edir. Birləşmə bütün girişləri gözləyir."}</div>}</div>}
            <div className="editor-footer"><span><span className="status-dot"/>{project.steps.length} element · {project.steps.reduce((total,step)=>total+step.routes.length,0)} keçid</span><button className="text-button" onClick={()=>setTab("explanation")}>Yoxla və davam et <ArrowRight size={14}/></button></div>
          </div>}

          {tab === "explanation" && <div className="explanation-editor"><div className={errors.length?"validation-card has-errors":"validation-card"}><ShieldCheck size={24}/><div><strong>{errors.length?`${errors.length} düzəliş tələb olunur`:"Struktur yoxlaması tamamlandı"}</strong><p>{errors.length?"İxracdan əvvəl aşağıdakı xətaları düzəlt.":"Axının qaydalarını nəzərdən keçir, sonra diaqramı yüklə."}</p></div></div>{issues.length>0&&<ul className="issue-list">{issues.map((issue,index)=><li key={index} className={issue.level}><span>{issue.level==="error"?"Xəta":"Qeyd"}</span><button onClick={()=>{if(issue.stepId){setSelected(issue.stepId);setTab("steps");}else setTab("people");}}>{issue.message}</button></li>)}</ul>}<div className="explanation-toolbar"><span><FileText size={15}/> PROSESİN İZAHI</span><button className="text-button" onClick={()=>void exportFile("text")}><ArrowDownToLine size={14}/> Mətn yüklə</button></div><pre className="explanation-text">{explanation}</pre><div className="info-note"><ShieldCheck size={17}/><p>İzah daxil etdiyin addımlardan və keçidlərdən hazırlanır. Biznes qaydalarını özün yoxla; süni intellekt istifadə olunmur.</p></div></div>}
        </section>

        <section className="preview-panel"><div className="panel-heading"><div className="panel-title"><span className="panel-icon teal"><GitBranch size={18}/></span><div><h2>Canlı diaqram</h2><p>Xanaları doldurduqca axın burada yaranır.</p></div></div><span className="live-pill"><span/> CANLI</span></div><Diagram project={project} selectedId={selected} onSelect={id=>{setSelected(id);setTab("steps");}}/><div className="preview-footer"><span><Layers3 size={14}/>{project.pools.length} pool <span>·</span> {lanes.length} lane</span><span>Microsoft Visio üçün .vsdx</span></div></section>
      </div>
      <footer className="page-footer"><span>Fikrindən axına — bir xana ilə.</span><span>VisioFlow <span>·</span> Azərbaycan dilində hazırlanıb</span></footer>
    </main>

    {notice&&<div className="toast" role="status"><CheckCircle2 size={19}/><span>{notice}</span><button aria-label="Bildirişi bağla" onClick={()=>setNotice("")}><X size={16}/></button></div>}
    {modal&&<div className="modal-overlay" onClick={()=>setModal(null)}><section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={event=>event.stopPropagation()}><button className="modal-close small-icon" aria-label="Pəncərəni bağla" onClick={()=>setModal(null)}><X size={19}/></button><span className={`modal-icon ${modal==="reset"?"red":""}`}>{modal==="reset"?<Trash2 size={25}/>:modal==="help"?<CircleHelp size={25}/>:<Layers3 size={25}/>}</span><h2 id="modal-title">{modal==="reset"?"Hər şeyi silmək istəyirsən?":modal==="sample"?"Nümunə prosesi açaq?":"Cədvəldən Visio diaqramına"}</h2>{modal==="help"?<div className="help-content"><p><strong>1. İştirakçıları qur.</strong> Pool-un adını və içindəki rolları (lane-ləri) daxil et.</p><p><strong>2. Addımları yaz.</strong> İcraçını, element növünü və keçidləri seç. XOR bir yolu, OR bir və ya bir neçə yolu, AND bütün yolları işə salır.</p><p><strong>3. Yoxla və yüklə.</strong> Diaqramı .vsdx, layihəni isə JSON kimi yüklə.</p><p>İşin bu brauzerdə URL-dəki hash ilə bağlı saxlanılır. Hash-i silsən yeni layihə başlayır. Link başqa cihazda məlumatı açmır. JSON ehtiyat nüsxəsi cihazlar arasında köçürmək üçündür.</p><p>Sloth AI inteqrasiyası hələ aktiv deyil. İzah hazırda qaydalar əsasında yaranır.</p><button className="primary-button" onClick={()=>setModal(null)}>Aydındır <Check size={16}/></button></div>:<><p>{modal==="reset"?"Bu brauzerdəki bütün VisioFlow layihələri silinəcək. Əvvəl JSON ehtiyat nüsxəsi yükləyə bilərsən. Bu əməliyyat geri qaytarılmır.":"Müştəri müraciətləri nümunəsi açılacaq. Hazırkı layihə əvvəlki hash ünvanında saxlanılacaq."}</p><div className="modal-actions"><button className="secondary-button" onClick={()=>setModal(null)}>Ləğv et</button><button className={modal==="reset"?"danger-button":"primary-button"} onClick={modal==="reset"?reset:sample}>{modal==="reset"?"Bəli, hər şeyi sil":"Nümunəni aç"}</button></div></>}</section></div>}
  </div>;
}
