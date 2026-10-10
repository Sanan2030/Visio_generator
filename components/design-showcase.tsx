"use client";

import { useState } from "react";
import Link from "next/link";
import {
  ArrowDown, ArrowLeft, ArrowRight, Check, ChevronDown, ChevronRight,
  Circle, Diamond, FileText, Grip, Layers3, LayoutGrid, Maximize2,
  MousePointer2, Move, Plus, Redo2, Search, Settings2, Square,
  Undo2, Users, Workflow, X, ZoomIn, ZoomOut,
} from "lucide-react";
import styles from "./design-showcase.module.css";

type Variant = "guided" | "canvas" | "table";

const steps = [
  { title: "Sənəd yarat", actor: "Operator", type: "Tapşırıq", description: "Operator yeni sənəd yaradır, əsas məlumatları doldurur və vizaçıları seçir.", next: "Viza prosesi" },
  { title: "Viza prosesi", actor: "Vizaçı", type: "Tapşırıq", description: "Vizaçı sənədi yoxlayır. Təsdiqdən sonra sənəd icraya keçir, imtina zamanı operatora qaytarılır.", next: "Təsdiq / İmtina" },
  { title: "Sənədi icra et", actor: "İcraçı", type: "Tapşırıq", description: "İcraçı sənədə cavab hazırlayır və icra statusunu tamamlayır.", next: "Prosesin sonu" },
];

const variants: { id: Variant; letter: string; title: string; detail: string }[] = [
  { id: "guided", letter: "A", title: "Addım-addım forma", detail: "Sadə suallar, bir addım, yanında canlı nəticə." },
  { id: "canvas", letter: "B", title: "Diaqram mərkəzdə", detail: "Geniş iş sahəsi, alətlər aşağıda, seçilən element sağda." },
  { id: "table", letter: "C", title: "Cədvəldən diaqrama", detail: "Word cədvəlinə bənzər izah və diaqram eyni ekranda." },
];

function Brand() {
  return <span className={styles.brand}><span className={styles.brandMark}><Workflow size={20} /></span>VisioFlow</span>;
}

function PreviewHeader({ compact = false }: { compact?: boolean }) {
  return <div className={styles.previewHeader}>
    <Brand />
    <span className={styles.headerDivider} />
    <span className={styles.projectName}>Müştəri müraciətləri <ChevronDown size={14} /></span>
    <span className={styles.saved}><Check size={14} /> Saxlanılıb</span>
    <div className={styles.previewHeaderActions}>
      {!compact && <span className={styles.headerAction}><FileText size={16} /> Word izahı</span>}
      <span className={styles.exportButton}>Visio üçün yüklə <ArrowDown size={15} /></span>
    </div>
  </div>;
}

function FlowCanvas({ selected, onSelect, tall = false, compact = false }: { selected: number; onSelect: (index: number) => void; tall?: boolean; compact?: boolean }) {
  const [branch, setBranch] = useState<"1.1" | "1.2" | null>(null);
  return <div className={`${styles.canvas} ${tall ? styles.tallCanvas : ""}`}>
    <div className={styles.canvasTopline}><span><span className={styles.liveDot} /> Canlı diaqram</span><span>3 icraçı · 3 addım</span></div>
    <svg className={styles.flowSvg} viewBox="0 0 830 530" role="img" aria-label="Operator, vizaçı və icraçı arasında nümunə iş axını">
      <defs><marker id="showcase-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#8391a6" /></marker></defs>
      <rect x="24" y="50" width="782" height="435" rx="10" className={styles.poolOuter} />
      <path d="M24 195H806M24 340H806M68 50V485" className={styles.laneDivider} />
      <text x="40" y="125" className={styles.laneName} transform="rotate(-90 40 125)">Operator</text>
      <text x="40" y="280" className={styles.laneName} transform="rotate(-90 40 280)">Vizaçı</text>
      <text x="40" y="420" className={styles.laneName} transform="rotate(-90 40 420)">İcraçı</text>
      <text x="88" y="33" className={styles.poolTitle}>Müştəri müraciətləri</text>
      <g className={styles.flowLinks} markerEnd="url(#showcase-arrow)">
        <path d="M142 123H187" />
        <path d="M347 123H409V266H438" />
        <path d="M598 266H650" />
        <path d="M689 304V412H531" />
        <path d="M728 266H770V86H267V102" className={styles.returnLink} />
        <path d="M371 412H248" />
      </g>
      <circle cx="121" cy="123" r="21" className={styles.startNode} />
      <text x="121" y="166" textAnchor="middle" className={styles.nodeCaption}>Başlanğıc</text>
      <g role="button" tabIndex={0} aria-label="Nümunə: Sənəd yarat" onClick={() => onSelect(0)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(0); } }} className={styles.clickableNode}>
        <rect x="187" y="102" width="160" height="62" rx="9" className={selected === 0 ? styles.nodeSelected : styles.taskNode} />
        <text x="267" y="130" textAnchor="middle" className={styles.nodeText}>Sənəd yarat</text><text x="267" y="148" textAnchor="middle" className={styles.nodeSmall}>Əsas məlumatları doldur</text>
      </g>
      <g role="button" tabIndex={0} aria-label="Nümunə: Viza prosesi" onClick={() => onSelect(1)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(1); } }} className={styles.clickableNode}>
        <rect x="438" y="235" width="160" height="62" rx="9" className={selected === 1 ? styles.nodeSelected : styles.taskNode} />
        <text x="518" y="263" textAnchor="middle" className={styles.nodeText}>Viza prosesi</text><text x="518" y="281" textAnchor="middle" className={styles.nodeSmall}>Sənədi yoxla</text>
        {selected === 1 && <><rect x="434" y="231" width="7" height="7" rx="1" className={styles.nodeHandle} /><rect x="595" y="294" width="7" height="7" rx="1" className={styles.nodeHandle} /></>}
      </g>
      <path d="M689 228L728 266L689 304L650 266Z" className={styles.gatewayNode} />
      <path d="M682 259L696 273M696 259L682 273" className={styles.gatewayMark} />
      <g role="button" tabIndex={0} aria-label="Şaxə 1.1 izahını aç" className={styles.branchChip} onClick={() => setBranch("1.1")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setBranch("1.1"); } }}><title>1.1 · Təsdiq — izahı aç</title><rect x="652" y="351" width="47" height="24" rx="12" className={styles.conditionPill} /><text x="670" y="367" textAnchor="middle" className={styles.conditionText}>1.1</text><circle cx="688" cy="363" r="5" className={styles.chipInfo} /><text x="688" y="366" textAnchor="middle" className={styles.chipInfoLetter}>i</text></g>
      <g role="button" tabIndex={0} aria-label="Şaxə 1.2 izahını aç" className={styles.branchChip} onClick={() => setBranch("1.2")} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setBranch("1.2"); } }}><title>1.2 · İmtina — izahı aç</title><rect x="741" y="155" width="47" height="24" rx="12" className={styles.returnPill} /><text x="759" y="171" textAnchor="middle" className={styles.conditionText}>1.2</text><circle cx="777" cy="167" r="5" className={styles.chipInfo} /><text x="777" y="170" textAnchor="middle" className={styles.chipInfoLetter}>i</text></g>
      <g role="button" tabIndex={0} aria-label="Nümunə: Sənədi icra et" onClick={() => onSelect(2)} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onSelect(2); } }} className={styles.clickableNode}>
        <rect x="371" y="381" width="160" height="62" rx="9" className={selected === 2 ? styles.nodeSelected : styles.taskNode} />
        <text x="451" y="409" textAnchor="middle" className={styles.nodeText}>Sənədi icra et</text><text x="451" y="427" textAnchor="middle" className={styles.nodeSmall}>Cavabı hazırla</text>
      </g>
      <circle cx="226" cy="412" r="20" className={styles.endNode} /><circle cx="226" cy="412" r="14" className={styles.endInner} /><text x="226" y="457" textAnchor="middle" className={styles.nodeCaption}>Tamamlandı</text>
    </svg>
    {branch && <div className={styles.branchPopover} role="status"><div><span>{branch} · {branch === "1.1" ? "Təsdiq" : "İmtina"}</span><button aria-label="Şaxə izahını bağla" onClick={() => setBranch(null)}><X size={14} /></button></div><p>{branch === "1.1" ? "Viza təsdiqləndikdən sonra sənəd icraçıya göndərilir." : "Vizadan imtina edildikdə sənəd düzəliş üçün operatora qaytarılır."}</p><span><ArrowRight size={12} /> {branch === "1.1" ? "Sənədi icra et" : "Sənəd yarat"}</span></div>}
    <div className={styles.canvasBottom}><span><MousePointer2 size={14} /> {compact ? "Elementi seç" : "Elementi seç · Tut və sürüşdür"}</span><div className={styles.zoomControls}><ZoomOut size={16} /><span>100%</span><ZoomIn size={16} /><span className={styles.zoomDivider} /><Maximize2 size={15} /></div></div>
  </div>;
}

function ReadField({ label, value, multiline = false }: { label: string; value: string; multiline?: boolean }) {
  return <label className={styles.field}><span>{label}</span>{multiline ? <textarea value={value} readOnly rows={4} /> : <input value={value} readOnly />}</label>;
}

function Guided({ selected, onSelect }: { selected: number; onSelect: (index: number) => void }) {
  const step = steps[selected];
  return <div className={`${styles.mockup} ${styles.guided}`}><PreviewHeader /><div className={styles.guidedBody}>
    <aside className={styles.guidedForm}>
      <div className={styles.sectionEyebrow}>PROSESİNİ QUR</div><h2>Bir addım, bir fikir.</h2><p className={styles.formIntro}>Məlumatları doldur. Diaqram yanında yaranır.</p>
      <div className={styles.progressSteps}><span><Check size={13} /> İştirakçılar</span><span className={styles.currentProgress}>2 Addımlar</span><span>3 İzah</span></div>
      <div className={styles.guidedFields}><div className={styles.stepPicker}>{steps.map((item, index) => <button key={item.title} onClick={() => onSelect(index)} aria-pressed={selected === index} className={selected === index ? styles.pickerSelected : ""}><span>{index + 1}</span>{item.title}<ChevronRight size={14} /></button>)}</div>
      <div className={styles.fieldHeading}><span>Addım {selected + 1} / 3</span><span className={styles.formTag}>Tapşırıq</span></div>
      <ReadField label="Bu addımda nə edilir?" value={step.title} />
      <ReadField label="Kim icra edir?" value={step.actor} />
      <ReadField label="Ətraflı izah" value={step.description} multiline />
      </div><div className={styles.guidedFooter}><div className={styles.nextStep}><ArrowRight size={16} /><div><span>Sonra nə olur?</span><strong>{selected === 1 ? "1.1 Təsdiq · 1.2 İmtina" : step.next}</strong></div><ChevronDown size={15} /></div>
      <div className={styles.formFootnote}><Check size={14} /> Dəyişikliklər avtomatik saxlanılır</div>
      <button className={styles.continueButton} onClick={() => onSelect((selected + 1) % steps.length)}>Növbəti addım <ArrowRight size={17} /></button></div>
    </aside>
    <div className={styles.guidedCanvas}><FlowCanvas selected={selected} onSelect={onSelect} tall /><div className={styles.canvasHint}><span className={styles.hintIcon}><Move size={18} /></span><div><strong>İstədiyin kimi yerləşdir</strong><p>Formada yaz, diaqramda seç və sürüşdür.</p></div></div></div>
  </div></div>;
}

function CanvasFirst({ selected, onSelect }: { selected: number; onSelect: (index: number) => void }) {
  const step = steps[selected];
  return <div className={`${styles.mockup} ${styles.canvasFirst}`}><PreviewHeader compact /><div className={styles.canvasFirstBody}>
    <aside className={styles.navigator}>
      <div className={styles.navigatorTitle}>Proses <span>3</span></div><div className={styles.navSearch}><Search size={15} /> Addım axtar</div>
      <div className={styles.navigatorLabel}><Layers3 size={15} /> Müştəri müraciətləri</div>
      {steps.map((item, index) => <button key={item.title} className={`${styles.navStep} ${selected === index ? styles.navStepActive : ""}`} onClick={() => onSelect(index)}><span className={styles.navStepIcon}><Square size={13} /></span><span><strong>{item.title}</strong><small>{item.actor}</small></span></button>)}
      <div className={styles.addItem}><Plus size={16} /> Addım əlavə et</div>
      <div className={styles.navigatorBottom}><Users size={16} /><span>İştirakçılar</span><span className={styles.countBadge}>3</span></div>
    </aside>
    <div className={styles.centerCanvas}>
      <div className={styles.editorBar}><span><MousePointer2 size={15} /> Seç və sürüşdür</span><div><Undo2 size={16} /><Redo2 size={16} /></div></div>
      <FlowCanvas selected={selected} onSelect={onSelect} tall />
      <div className={styles.floatingTools}><span className={styles.activeTool}><MousePointer2 size={19} /></span><Move size={19} /><span className={styles.toolDivider} /><Circle size={19} /><Square size={19} /><Diamond size={19} /><ArrowRight size={19} /><span className={styles.toolDivider} /><FileText size={19} /></div>
    </div>
    <aside className={styles.inspector}>
      <div className={styles.inspectorTop}><Settings2 size={17} /><h2>Seçilmiş element</h2><span className={styles.countBadge}>1</span></div>
      <div className={styles.selectionTitle}><span className={styles.selectionIcon}><Square size={22} /></span><div><span>ADDIM {selected + 1}</span><h3>{step.title}</h3></div></div>
      <div className={styles.inspectorTabs}><span className={styles.inspectorTabActive}>Məlumatlar</span><span>Görünüş</span></div>
      <ReadField label="Addımın adı" value={step.title} /><ReadField label="İcraçı" value={step.actor} />
      <ReadField label="İşin izahı" value={step.description} multiline />
      <div className={styles.inspectorSection}><h3>Keçidlər</h3><span className={styles.countBadge}>{selected === 1 ? "2" : "1"}</span></div>
      <div className={styles.transitionItem}><span className={styles.transitionDot} /><div><strong>{selected === 1 ? "1.1 · Təsdiq" : "Davam et"}</strong><span>{selected === 0 ? "Viza prosesi" : selected === 1 ? "Sənədi icra et" : "Tamamlandı"}</span></div><ChevronRight size={14} /></div>
      {selected === 1 && <div className={styles.transitionItem}><span className={`${styles.transitionDot} ${styles.returnDot}`} /><div><strong>1.2 · İmtina</strong><span>Sənəd yarat</span></div><ChevronRight size={14} /></div>}
      <div className={styles.inspectorNote}><MousePointer2 size={15} /> Diaqramdakı addımı seçdikdə məlumatları burada görünür.</div>
    </aside>
  </div></div>;
}

function TableFirst({ selected, onSelect }: { selected: number; onSelect: (index: number) => void }) {
  return <div className={`${styles.mockup} ${styles.tableFirst}`}><PreviewHeader /><div className={styles.tableFirstBody}>
    <section className={styles.documentPanel}>
      <div className={styles.documentHeading}><div><span className={styles.sectionEyebrow}>İŞ AXINININ İZAHI</span><h2>Müştəri müraciətləri</h2><p>Məlumatlarını cədvələ yaz, diaqramı yanında gör.</p></div><span className={styles.documentIcon}><FileText size={22} /></span></div>
      <div className={styles.documentToolbar}><span className={styles.documentToolActive}><LayoutGrid size={15} /> Cədvəl</span><span><Users size={15} /> İştirakçılar</span><span className={styles.documentToolbarEnd}>3 addım</span></div>
      <div className={styles.workflowTable}><div className={styles.tableHeader}><span>№</span><span>İcraçı</span><span>Addımın təsviri</span></div>{steps.map((step, index) => <button key={step.title} onClick={() => onSelect(index)} className={`${styles.tableRow} ${selected === index ? styles.tableRowSelected : ""}`} aria-pressed={selected === index}><span className={styles.rowNumber}>{index + 1}<Grip size={13} /></span><span className={styles.rowActor}><span className={styles.actorAvatar}>{step.actor.charAt(0)}</span>{step.actor}</span><span className={styles.rowContent}><strong>{step.title}</strong><span>{step.description}</span><span className={styles.rowNext}><ArrowRight size={12} /> {index === 1 ? "1.1 Təsdiq · 1.2 İmtina" : step.next}</span></span></button>)}</div>
      <div className={styles.addTableRow}><Plus size={16} /> Yeni sətir əlavə et</div>
      <div className={styles.documentNote}><FileText size={17} /><div><strong>İzahın paylaşmağa hazırdır</strong><p>Word sənədində də bu cədvəl quruluşu saxlanılır.</p></div><Check size={16} /></div>
    </section>
    <div className={styles.tableCanvas}><FlowCanvas selected={selected} onSelect={onSelect} tall compact /><div className={styles.selectionStrip}><span className={styles.selectionStripIcon}><Square size={16} /></span><div><span>SEÇİLMİŞ ADDIM</span><strong>{steps[selected].title}</strong></div><span className={styles.selectionActor}>{steps[selected].actor}</span><span className={styles.selectionDivider} /><Move size={16} /><span>Yerini dəyiş</span></div></div>
  </div></div>;
}

export function DesignShowcase() {
  const [variant, setVariant] = useState<Variant>("guided");
  const [selected, setSelected] = useState(1);
  const current = variants.find((item) => item.id === variant)!;
  return <main className={`${styles.gallery} ${variant === "canvas" ? styles.canvasVariant : variant === "table" ? styles.tableVariant : ""}`}>
    <header className={styles.galleryHeader}><div><Link className={styles.backLink} href="/"><ArrowLeft size={15} /> Tətbiqə qayıt</Link><h1>İnterfeys nümunələri <span>3 görünüş</span></h1></div><div className={styles.galleryHeaderActions}><span className={styles.previewBadge}>Yalnız görünüş nümunəsi</span><a className={styles.previewImageLink} href={`/design-previews/design-${current.letter.toLowerCase()}.png`} target="_blank" rel="noreferrer">{current.letter} variantını şəkil kimi aç <ArrowRight size={12} /></a></div></header>
    <nav className={styles.variantNav} aria-label="İnterfeys variantları">{variants.map((item) => <button key={item.id} onClick={() => setVariant(item.id)} aria-pressed={variant === item.id} className={`${styles.variantButton} ${variant === item.id ? styles.variantSelected : ""}`}><span className={styles.variantLetter}>{item.letter}</span><span><strong>{item.title}</strong><small>{item.detail}</small></span>{variant === item.id && <Check size={17} />}</button>)}</nav>
    <section aria-label={current.title} className={styles.previewStage}>{variant === "guided" ? <Guided selected={selected} onSelect={setSelected} /> : variant === "canvas" ? <CanvasFirst selected={selected} onSelect={setSelected} /> : <TableFirst selected={selected} onSelect={setSelected} />}</section>
    <p className={styles.galleryCaption}>Görünüşləri dəyiş və addımları seçərək müqayisə et. Buradakı nümunələr layihəndəki məlumatları dəyişmir.</p>
  </main>;
}
