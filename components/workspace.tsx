"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownToLine, ArrowLeft, ArrowRight, Check, CheckCircle2, ChevronDown, CircleHelp, GitBranch, Layers3, LoaderCircle, MoreHorizontal, Plus, RotateCcw, ShieldCheck, Trash2, X } from "lucide-react";
import type { Step, StepType } from "@/lib/types";
import { createId, createProject, explainProject, SAMPLE_PROJECT, STEP_TYPES, validateProject } from "@/lib/process";
import { download, filename } from "@/lib/storage";
import { useProject } from "@/lib/use-project";
import Diagram from "./diagram";

type Tab = "people" | "steps" | "explanation";
type Modal = "reset" | "sample" | "help" | null;

const tabs: { value: Tab; label: string }[] = [
  { value: "people", label: "İştirakçılar" },
  { value: "steps", label: "Addımlar" },
  { value: "explanation", label: "İzah" },
];

export default function Workspace() {
  const { project, ready, saveState, undoCount, update, undo, replace, reset, unsavedReplacement, confirmReplacement, cancelReplacement, notice, setNotice } = useProject();
  const [tab, setTab] = useState<Tab>("people");
  const [selected, setSelected] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const formScroll = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const previousProject = useRef("");
  const issues = useMemo(() => validateProject(project), [project]);
  const errors = issues.filter(issue => issue.level === "error");
  const lanes = project.pools.flatMap(pool => pool.lanes.map(lane => ({ ...lane, poolName: pool.name })));
  const explanation = useMemo(() => explainProject(project), [project]);
  const activeModal = unsavedReplacement ? "unsaved" : modal;

  useEffect(() => {
    if (!ready || previousProject.current === project.id) return;
    previousProject.current = project.id;
    setTab(project.steps.length ? "steps" : "people");
    setSelected(project.steps[0]?.id ?? null);
    setMenuOpen(false);
    formScroll.current?.scrollTo({ top: 0 });
  }, [ready, project.id, project.steps]);

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
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") setMenuOpen(false); };
    document.addEventListener("keydown", close);
    return () => document.removeEventListener("keydown", close);
  }, [menuOpen]);

  function updateStep(id: string, patch: Partial<Step>) {
    update(current => ({ ...current, steps: current.steps.map(step => step.id === id ? { ...step, ...patch } : step) }));
  }

  function openSample() {
    if (project.steps.length) setModal("sample");
    else sample();
  }

  function sample() {
    if (!replace({ ...structuredClone(SAMPLE_PROJECT), id: createId() })) return;
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

  function addStep(type: StepType = "task") {
    if (!lanes.length) { setNotice("Əvvəl ən azı bir icraçı əlavə et."); setTab("people"); return; }
    if (project.steps.length >= 200) { setNotice("Bir layihədə maksimum 200 addım ola bilər."); return; }
    const step: Step = {
      id: createId(), laneId: lanes[0].id, type,
      title: type === "start" ? "Başlanğıc" : type === "end" ? "Son" : "Yeni addım",
      description: "", routes: [],
    };
    update(current => ({ ...current, steps: [
      ...current.steps.map((item, index) => index === current.steps.length - 1 && item.type !== "end" && !item.routes.length && !["data", "annotation"].includes(item.type)
        ? { ...item, routes: [{ targetId: step.id, label: "" }] } : item),
      step,
    ] }));
    setSelected(step.id);
    setTab("steps");
  }

  function deleteStep(id: string) {
    const index = project.steps.findIndex(step => step.id === id);
    update(current => ({ ...current, steps: current.steps.filter(step => step.id !== id).map(step => ({ ...step, routes: step.routes.filter(route => route.targetId !== id) })) }));
    if (selected === id) setSelected(project.steps[index + 1]?.id ?? project.steps[index - 1]?.id ?? null);
  }

  function addRoute(step: Step) {
    if (step.routes.length >= 200) return;
    const target = project.steps.find(item => item.id !== step.id && !step.routes.some(route => route.targetId === item.id));
    if (!target) { setNotice("Yeni keçid üçün əvvəl başqa addım əlavə et."); return; }
    updateStep(step.id, { routes: [...step.routes, { targetId: target.id, label: "" }] });
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

  function exportText() {
    download(explanation, `${filename(project.name)}-izah.txt`, "text/plain;charset=utf-8");
  }

  return <div className="studio-shell">
    <header className="studio-header">
      <a className="brand" href="#" onClick={event => event.preventDefault()} aria-label="VisioFlow ana səhifə">
        <span className="brand-icon"><GitBranch size={21}/></span><span>visio<span className="brand-light">flow</span></span>
      </a>
      <div className={`save-status ${saveState}`} aria-live="polite">
        {saveState === "saved" ? <CheckCircle2 size={14}/> : saveState === "saving" ? <LoaderCircle size={14} className="spin"/> : <CircleHelp size={14}/>}
        <span>{saveState === "saved" ? "Saxlanıldı" : saveState === "saving" ? "Saxlanılır…" : "Yaddaş əlçatan deyil"}</span>
      </div>
      <div className="header-actions">
        <button type="button" className="secondary-button sample-button" aria-label="Nümunə proses" onClick={openSample} disabled={!ready}><Layers3 size={15}/><span className="button-label">Nümunə</span></button>
        <button type="button" className="icon-button" aria-label="Yeni diaqram" title="Yeni diaqram" disabled={!ready} onClick={()=>replace(createProject())}><Plus size={18}/></button>
        <button type="button" className="icon-button" aria-label="Son dəyişikliyi geri al" title="Geri al" disabled={!undoCount} onClick={undo}><RotateCcw size={16}/></button>
        <div className="header-menu">
          <button type="button" className="icon-button" aria-label="Layihə menyusu" aria-expanded={menuOpen} title="Digər əməliyyatlar" onClick={()=>setMenuOpen(!menuOpen)}><MoreHorizontal size={19}/></button>
          {menuOpen && <>
            <button type="button" className="menu-backdrop" aria-label="Menyunu bağla" onClick={()=>setMenuOpen(false)}/>
            <div className="project-menu">
              <button type="button" onClick={()=>{setMenuOpen(false);setModal("help");}}><CircleHelp size={16}/> Necə işləyir?</button>
              <button type="button" className="danger-menu-item" onClick={()=>{setMenuOpen(false);setModal("reset");}}><Trash2 size={16}/> Hər şeyi sil</button>
            </div>
          </>}
        </div>
        <button type="button" className="primary-button export-button" aria-label="Visio üçün yüklə" disabled={exporting || !ready} onClick={()=>void exportVisio()}>
          {exporting ? <LoaderCircle size={16} className="spin"/> : <ArrowDownToLine size={16}/>}
          <span className="export-label">{exporting ? "Hazırlanır…" : "Visio üçün yüklə"}</span><span className="mobile-export-label">Visio</span>
        </button>
      </div>
    </header>

    <main className="studio-main">
      <section className="form-panel" aria-label="İş axını forması">
        <nav className="form-tabs" aria-label="Proses forması">
          {tabs.map((item, index) => <button type="button" key={item.value} className={tab === item.value ? "active" : ""} aria-current={tab === item.value ? "step" : undefined} onClick={()=>setTab(item.value)}><span>{index+1}</span>{item.label}</button>)}
        </nav>
        <div className="form-scroll" ref={formScroll}>
          {tab === "people" && <div className="people-form">
            <div className="form-intro"><span className="section-label">01 — İŞTİRAKÇILAR</span><h1>Prosesini qur.</h1><p>Prosesi adlandır, iştirakçıları əlavə et. Axının sağda yaransın.</p></div>
            <label className="field-label">Prosesin adı<input aria-label="Prosesin adı" placeholder="Məsələn, Sənədin təsdiqi" maxLength={160} value={project.name} onChange={event=>update(current=>({...current,name:event.target.value}))}/></label>
            <div className="pool-count"><div><strong>Neçə pool olacaq?</strong><p>Hər pool bir təşkilat və ya tərəfdir.</p></div><div className="number-control"><button type="button" aria-label="Pool sayını azalt" disabled={project.pools.length<=1} onClick={()=>setPoolCount(project.pools.length-1)}>−</button><input aria-label="Pool sayı" type="number" min={1} max={8} value={project.pools.length} onChange={event=>setPoolCount(Number(event.target.value))}/><button type="button" aria-label="Pool sayını artır" disabled={project.pools.length>=8} onClick={()=>setPoolCount(project.pools.length+1)}>+</button></div></div>
            {project.pools.map((pool,index) => <fieldset className="pool-card" key={pool.id}>
              <legend className="pool-heading"><Layers3 size={14}/> Pool {index+1}</legend>
              <label className="field-label">Təşkilatın adı<input aria-label={`Pool ${index+1} adı`} placeholder="Təşkilat və ya tərəfin adı" maxLength={160} value={pool.name} onChange={event=>update(current=>({...current,pools:current.pools.map(item=>item.id===pool.id?{...item,name:event.target.value}:item)}))}/></label>
              <div className="field-caption">İcraçılar <span>Lane-lər</span></div>
              {pool.lanes.map((lane,laneIndex) => <div className="lane-input-row" key={lane.id}><span className="lane-dot"/><input aria-label={`Pool ${index+1} icraçı ${laneIndex+1}`} placeholder="Məsələn, Operator" maxLength={160} value={lane.name} onChange={event=>update(current=>({...current,pools:current.pools.map(item=>item.id===pool.id?{...item,lanes:item.lanes.map(role=>role.id===lane.id?{...role,name:event.target.value}:role)}:item)}))}/><button type="button" className="icon-button small-icon" aria-label={`${lane.name} icraçısını sil`} disabled={pool.lanes.length<=1} onClick={()=>deleteLane(pool.id,lane.id)}><X size={15}/></button></div>)}
              <button type="button" className="text-button" disabled={pool.lanes.length>=20} onClick={()=>update(current=>({...current,pools:current.pools.map(item=>item.id===pool.id?{...item,lanes:[...item.lanes,{id:createId(),name:"Yeni icraçı"}]}:item)}))}><Plus size={14}/> İcraçı əlavə et</button>
            </fieldset>)}
            <p className="form-note">Eyni təşkilatın rollarını bir pool daxilində saxla.</p>
          </div>}

          {tab === "steps" && <div className="steps-form">
            <div className="form-intro"><span className="section-label">02 — ADDIMLAR</span><h1>İş necə davam edir?</h1><p>Hər addımı bir forma kimi doldur. Sonra onu növbəti addıma bağla.</p></div>
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
                    <button type="button" className="step-summary" aria-label={`${index+1}-ci addımı aç`} aria-expanded={open} aria-controls={`step-fields-${step.id}`} onClick={()=>setSelected(open?null:step.id)}>
                      <span className="step-number">{String(index+1).padStart(2,"0")}</span><span className="step-summary-text"><strong>{step.title||"Adsız addım"}</strong><small>{lane?.name||"İcraçı seçilməyib"} <span>·</span> {kind}</small></span><ChevronDown size={15} className="step-summary-chevron"/>
                    </button>
                    <button type="button" className="icon-button small-icon danger-icon" aria-label={`${index+1}-ci addımı sil`} onClick={()=>deleteStep(step.id)}><Trash2 size={14}/></button>
                  </div>
                  {open && <div className="step-form" id={`step-fields-${step.id}`}>
                    <label className="field-label">Addımın adı<input aria-label={`${index+1}-ci addımın adı`} placeholder="Bu addımda nə baş verir?" maxLength={240} value={step.title} onChange={event=>updateStep(step.id,{title:event.target.value})}/></label>
                    <div className="field-row">
                      <label className="field-label">Element növü<select aria-label={`${index+1}-ci addımın növü`} value={step.type} onChange={event=>updateStep(step.id,{type:event.target.value as StepType,routes:event.target.value==="end"?[]:step.routes})}>{STEP_TYPES.map(item=><option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
                      <label className="field-label">İcraçı<select aria-label={`${index+1}-ci addımın icraçısı`} value={step.laneId} onChange={event=>updateStep(step.id,{laneId:event.target.value})}>{lanes.map(item=><option key={item.id} value={item.id}>{project.pools.length>1?`${item.poolName} / `:""}{item.name}</option>)}</select></label>
                    </div>
                    <label className="field-label">İşin təsviri <span className="field-hint">İstəyə bağlı</span><textarea aria-label="Addımın təsviri" rows={3} placeholder="İcraçı nə edir? Hansı qaydalar var?" maxLength={10000} value={step.description} onChange={event=>updateStep(step.id,{description:event.target.value})}/></label>
                    {gateway && <p className="gateway-tip">{step.type==="xor"?"XOR — şərtə uyğun yalnız bir yol seçilir.":step.type==="or"?"OR — bir və ya bir neçə uyğun yol seçilir.":"AND — bütün qollar paralel davam edir. Birləşmədə bütün girişlər gözlənilir."}</p>}
                    <div className="route-heading"><strong>{artifact?"Bağlı elementlər":gateway?"Çıxış qolları":"Növbəti addım"}</strong>{step.type!=="end"&&<button type="button" className="text-button" disabled={step.routes.length>=200} onClick={()=>addRoute(step)} aria-label="Keçid əlavə et"><Plus size={13}/> Keçid</button>}</div>
                    {step.type==="end"?<p className="field-help">Bu qol burada tamamlanır.</p>:<>
                      {!step.routes.length && <p className="field-help">Keçid əlavə edərək axını davam etdir.</p>}
                      {step.routes.map((route,routeIndex)=><div className="route-card" key={routeIndex}>
                        <div className="route-row"><label className="field-label">{gateway?`Qol ${routeIndex+1}`:"Hədəf addım"}<select aria-label={`Keçid ${routeIndex+1} hədəfi`} value={route.targetId} onChange={event=>updateStep(step.id,{routes:step.routes.map((item,i)=>i===routeIndex?{...item,targetId:event.target.value}:item)})}><option value="">Addımı seç</option>{project.steps.filter(item=>item.id!==step.id).map(item=><option key={item.id} value={item.id}>{project.steps.indexOf(item)+1}. {item.title||"Adsız addım"}</option>)}</select></label><button type="button" className="icon-button small-icon" aria-label={`Keçid ${routeIndex+1} sil`} onClick={()=>updateStep(step.id,{routes:step.routes.filter((_,i)=>i!==routeIndex)})}><X size={14}/></button></div>
                        <label className="field-label">{gateway?"Şərt / əməliyyat":"Keçidin adı"}<input aria-label={`Keçid ${routeIndex+1} şərti`} placeholder={gateway?"Məsələn, Təsdiq / İmtina":"İstəyə bağlı"} maxLength={500} value={route.label} onChange={event=>updateStep(step.id,{routes:step.routes.map((item,i)=>i===routeIndex?{...item,label:event.target.value}:item)})}/></label>
                      </div>)}
                    </>}
                  </div>}
                </article>;
              })}
            </div>
            {!!project.steps.length && <div className="add-step-bar"><button type="button" className="secondary-button" disabled={project.steps.length>=200} onClick={()=>addStep()}><Plus size={15}/> Addım əlavə et</button><button type="button" className="text-button" disabled={project.steps.length>=200} onClick={()=>addStep("end")}>Son hadisəsi <Plus size={13}/></button></div>}
          </div>}

          {tab === "explanation" && <div className="explanation-form">
            <div className="form-intro"><span className="section-label">03 — İZAH</span><h1>Axını nəzərdən keçir.</h1><p>İzahı oxu, əlaqələri yoxla və Visio faylını yüklə.</p></div>
            <div className={`validation-card ${errors.length?"has-errors":""}`}><ShieldCheck size={20}/><div><strong>{errors.length?`${errors.length} düzəliş tələb olunur`:"Struktur yoxlaması tamamlandı"}</strong><p>{errors.length?"Aşağıdakı xətaları düzəlt.":"Biznes qaydalarını da nəzərdən keçir."}</p></div></div>
            {!!issues.length && <details className="validation-details" open={errors.length>0}><summary>Yoxlama qeydləri <span>{issues.length}</span></summary><ul className="issue-list">{issues.map((issue,index)=><li key={index} className={issue.level}><span>{issue.level==="error"?"Xəta":"Qeyd"}</span><button type="button" onClick={()=>{if(issue.stepId){setSelected(issue.stepId);setTab("steps");}else setTab("people");}}>{issue.message}</button></li>)}</ul></details>}
            <div className="explanation-toolbar"><span>PROSESİN İZAHI</span><button type="button" className="text-button" onClick={exportText}><ArrowDownToLine size={13}/> Mətn yüklə</button></div>
            <pre className="explanation-text">{explanation}</pre>
          </div>}
        </div>
        <footer className="form-footer">
          <div className="form-status-line"><ShieldCheck size={13}/><span>{saveState==="unavailable"?"Brauzer yaddaşına giriş yoxdur.":"Səhifə yenilənsə də işin burada qalır."}</span></div>
          {tab==="people"?<button type="button" className="primary-button continue-button" onClick={()=>setTab("steps")}>Addımlara keç <ArrowRight size={15}/></button>:tab==="steps"?<div className="footer-navigation"><button type="button" className="text-button" onClick={()=>setTab("people")}><ArrowLeft size={14}/> İştirakçılar</button><button type="button" className="secondary-button" onClick={()=>setTab("explanation")}>İzahı yoxla <ArrowRight size={14}/></button></div>:<div className="footer-navigation"><button type="button" className="text-button" onClick={()=>setTab("steps")}><ArrowLeft size={14}/> Addımlar</button><span className="form-save-caption">.vsdx ilə Visio-da davam et</span></div>}
        </footer>
      </section>

      <section className="preview-panel" aria-label="Canlı iş axını">
        <div className="preview-heading"><div className="canvas-title"><span className="live-dot"/><h2 title={project.name||"Yeni iş axını"}>{project.name||"Yeni iş axını"}</h2><span className="live-pill">CANLI</span></div><div className="canvas-stats">{project.pools.length} pool <span>·</span> {lanes.length} lane <span>·</span> {project.steps.length} addım</div></div>
        <Diagram project={project} selectedId={selected} onSelect={id=>{setSelected(id);setTab("steps");}}/>
      </section>
    </main>

    {notice && <div className="toast" role="status"><CircleHelp size={18}/><span>{notice}</span><button type="button" aria-label="Bildirişi bağla" onClick={()=>setNotice("")}><X size={16}/></button></div>}
    {activeModal && <div className="modal-overlay" onClick={closeModal}><section className="modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="modal-title" onClick={event=>event.stopPropagation()}>
      <button type="button" className="modal-close icon-button" aria-label="Pəncərəni bağla" onClick={closeModal}><X size={18}/></button>
      <span className={`modal-icon ${activeModal==="reset"||activeModal==="unsaved"?"red":""}`}>{activeModal==="reset"?<Trash2 size={24}/>:activeModal==="sample"?<Layers3 size={24}/>:<CircleHelp size={24}/>}</span>
      <h2 id="modal-title">{activeModal==="reset"?"Hər şeyi silmək istəyirsən?":activeModal==="sample"?"Nümunə prosesi açaq?":activeModal==="unsaved"?"Dəyişikliklər saxlanılmayıb":"Formadan Visio diaqramına"}</h2>
      {activeModal==="help"?<div className="help-content"><p><strong>1. İştirakçıları əlavə et.</strong> Prosesin adını, pool-ları və onların daxilindəki rolları yaz.</p><p><strong>2. Addımları doldur.</strong> Hər addım üçün ad, növ, icraçı və növbəti keçidi seç.</p><p><strong>3. Visio üçün yüklə.</strong> Sağdakı diaqramı izlə, izahı yoxla və .vsdx faylını yüklə.</p><p>Dəyişikliklər bu brauzerdə avtomatik saxlanılır. Eyni ünvanı açanda və ya səhifəni yeniləyəndə işinə davam edirsən. Ünvanın hash hissəsini silsən, yeni boş layihə başlayır.</p><button type="button" className="primary-button" onClick={closeModal}>Aydındır <Check size={15}/></button></div>:<>
        <p>{activeModal==="reset"?"Bu brauzerdəki bütün VisioFlow layihələri silinəcək. Bu əməliyyat geri qaytarılmır.":activeModal==="sample"?"Müştəri müraciətləri nümunəsi açılacaq. Saxlanmış layihən öz əvvəlki ünvanında qalacaq.":"Brauzer son dəyişiklikləri saxlaya bilmədi. Hazırkı işi açıq saxlaya və ya dəyişiklikləri itirməyi qəbul edib davam edə bilərsən."}</p>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={closeModal}>Ləğv et</button><button type="button" className={activeModal==="sample"?"primary-button":"danger-button"} onClick={activeModal==="reset"?clearProjects:activeModal==="sample"?sample:()=>{confirmReplacement();setModal(null);}}>{activeModal==="reset"?"Bəli, hər şeyi sil":activeModal==="sample"?"Nümunəni aç":"Saxlamadan davam et"}</button></div>
      </>}
    </section></div>}
  </div>;
}
