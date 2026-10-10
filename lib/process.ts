import type { Project, Step, StepType, ValidationIssue } from "./types";

export const STEP_TYPES: { value: StepType; label: string }[] = [
  { value: "start", label: "Başlanğıc" },
  { value: "end", label: "Son" },
  { value: "task", label: "Tapşırıq" },
  { value: "userTask", label: "İstifadəçi tapşırığı" },
  { value: "serviceTask", label: "Sistem tapşırığı" },
  { value: "subprocess", label: "Alt proses" },
  { value: "xor", label: "XOR · bir seçim" },
  { value: "or", label: "OR · bir və ya bir neçə seçim" },
  { value: "and", label: "AND · paralel axın" },
  { value: "intermediate", label: "Aralıq hadisə" },
  { value: "message", label: "Mesaj hadisəsi" },
  { value: "timer", label: "Vaxt hadisəsi" },
  { value: "data", label: "Məlumat / sənəd" },
  { value: "annotation", label: "Qeyd" },
];

const TYPES = new Set<string>(STEP_TYPES.map((type) => type.value));
const ARTIFACT_TYPES = new Set<StepType>(["data", "annotation"]);
const GATEWAY_TYPES = new Set<StepType>(["xor", "or", "and"]);

export function createId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function createProject(): Project {
  const poolId = createId();
  const laneId = createId();
  return {
    version: 1,
    id: createId(),
    name: "Yeni iş axını",
    pools: [{ id: poolId, name: "Təşkilat", lanes: [{ id: laneId, name: "İştirakçı 1" }] }],
    steps: [],
  };
}

function sampleStep(id: string, laneId: string, type: StepType, title: string, description: string, routes: [string, string][] = []): Step {
  return { id, laneId, type, title, description, routes: routes.map(([targetId, label]) => ({ targetId, label })) };
}

export const SAMPLE_PROJECT: Project = {
  version: 1,
  id: "customer-requests",
  name: "Müştəri müraciətləri",
  pools: [{
    id: "customer-pool",
    name: "Müştəri müraciətləri",
    lanes: [
      { id: "operator", name: "Operator" },
      { id: "approver", name: "Vizaçı" },
      { id: "recipients", name: "Aidiyyəti üzrə ünvanlanan şəxslər" },
      { id: "executors", name: "İcraçılar" },
    ],
  }],
  steps: [
    sampleStep("start", "operator", "start", "Yeni sənəd", "Operator “Müştəri müraciətləri” modulunda “Yeni sənəd” düyməsini sıxır.", [["register", ""]]),
    sampleStep("register", "operator", "userTask", "Əsas məlumatları doldur", "Operator sənədin əsas məlumatlarını daxil edir, əlavə vizaçı və “Baxılma üçün” / “İcra üçün” icraçıları seçir.", [["first-visa", ""]]),
    sampleStep("first-visa", "approver", "userTask", "İlk vizaçının qərarı", "Avtomatik vizaçı və ya viza səlahiyyətli istifadəçi sənədi yoxlayır. Vizaçılar sıra nömrəsinə uyğun işləyirlər.", [["visa-decision", ""]]),
    sampleStep("visa-decision", "approver", "xor", "Viza təsdiqlənib?", "Hər viza üçün təsdiq və ya imtina qərarı verilir.", [["first-approved", "Təsdiq"], ["correct", "İmtina"]]),
    sampleStep("correct", "operator", "userTask", "Sənədi düzəlt", "İmtina, geri qaytarılma və ya icraçının dəyişdirilməsi zamanı sənəd redaktə üçün operatora qaytarılır. Düzəlişdən sonra viza mərhələsi yenidən başlayır.", [["first-visa", "Yenidən göndər"]]),
    sampleStep("first-approved", "approver", "and", "İlk viza təsdiqləndi", "İlk təsdiqdən sonra digər vizaların toplanması və aidiyyəti üzrə ünvanlanma paralel davam edir.", [["remaining-visas", "Qalan vizalar"], ["notify", "Aidiyyəti üzrə ünvanla"]]),
    sampleStep("remaining-visas", "approver", "subprocess", "Qalan vizaları topla", "Qalan vizaçılar ardıcıllıqla qərar verirlər. Əlavə vizaçı yoxdursa bu mərhələ tamamlanır.", [["remaining-decision", ""]]),
    sampleStep("remaining-decision", "approver", "xor", "Bütün vizalar toplandı?", "Bütün vizalar təsdiqlənməlidir. İmtina olduqda sənəd operatora geri qayıdır.", [["before-sign", "Hamısı təsdiq"], ["correct", "İmtina"]]),
    sampleStep("notify", "recipients", "serviceTask", "Sənədi ünvanla", "Sistem sənədi əvvəlcədən təyin edilmiş şəxslərin “Oxunmamışlar” qutusuna göndərir. Əməliyyatlar imzadan sonra açılır.", [["before-sign", "Ünvanlandı"]]),
    sampleStep("before-sign", "approver", "and", "İmzaya hazırdır", "Vizaların toplanması və ünvanlanma tamamlanır.", [["sign", ""]]),
    sampleStep("sign", "approver", "userTask", "Sənədi imzala", "Bütün vizalar toplandıqdan sonra sənəd imzalayan şəxsin “Oxunmamışlar” qutusunda görünür. Bu nümunədə imzalayan şəxsin işi Vizaçı zolağında göstərilib; ayrıca zolağa keçirə bilərsiniz.", [["signed", "İmzalandı"]]),
    sampleStep("signed", "approver", "and", "İmza tamamlandı", "Aidiyyəti üzrə ünvanlanan şəxslər və icraçılar öz əməliyyatlarını yerinə yetirə bilərlər.", [["recipient-choice", "Tanışlıq"], ["executor-choice", "İcra / baxılma"]]),
    sampleStep("recipient-choice", "recipients", "xor", "Əməliyyatı seç", "İstifadəçi sənədlə tanış olur və ya əsas icraçı təyin etmədən yeni dərkənar yaradır.", [["acknowledged", "Tanış oldum"], ["recipient-note", "Yeni dərkənar"]]),
    sampleStep("recipient-note", "recipients", "subprocess", "Yeni dərkənar yarat", "“Dərkənar göndərmək” pəncərəsində yeni dərkənar hazırlanır. Əsas icraçı seçmək olmaz.", [["acknowledged", "Tamamlandı"]]),
    sampleStep("acknowledged", "recipients", "end", "Tanışlıq tamamlandı", "“Tanış oldum” seçildikdə sənəd həmin istifadəçinin “Oxunmamışlar” qutusundan çıxarılır."),
    sampleStep("executor-choice", "executors", "xor", "İcraçının əməliyyatı", "“İcra üçün” seçilən şəxs bütün göstərilən əməliyyatlardan istifadə edə bilər. “Baxılma üçün” seçilən şəxs yalnız yeni dərkənar, cavab sənədi və əlaqəli cavab sənədi yarada bilər.", [["executor-note", "Yeni dərkənar"], ["response", "Cavab sənədi"], ["related-response", "Əlaqəli cavab sənədi"], ["correct", "İcraçını dəyiş / geri qaytar · İcra üçün"], ["completed", "İcra statusunu daxil et · İcra üçün"]]),
    sampleStep("executor-note", "executors", "subprocess", "Dərkənar layihəsi yarat", "Səlahiyyətli icraçı “Dərkənar göndərmək” pəncərəsi vasitəsilə dərkənar layihəsi yaradır.", [["executor-choice", "İcra davam edir"]]),
    sampleStep("response", "executors", "userTask", "Cavab sənədi hazırla", "Başqa növ sənəd əsasında cavab sənədi hazırlanır. Əsas QNV-nin statusu “İcra olunub” olur; cavab sənədi üçün yeni QNV yaradılır.", [["completed", ""]]),
    sampleStep("related-response", "executors", "userTask", "Əlaqəli cavab sənədi", "Yeni əlaqəli cavab sənədi və ona aid QNV yaradılır. Əsas QNV “İcraatdadır” statusunda qalır.", [["executor-choice", "İcraatdadır"]]),
    sampleStep("completed", "executors", "end", "İcra olunub", "İcra statusu daxil edildikdə və ya yekun cavab sənədi hazırlananda sənəd tamamlanmış hesab olunur."),
  ],
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textValue(value: unknown, max: number, nonempty = false): value is string {
  return typeof value === "string" && value.length <= max && (!nonempty || value.length > 0);
}

function idValue(value: unknown): value is string {
  return typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value);
}

/** Shape validation permits unfinished drafts, while bounding imported data. */
export function isProject(input: unknown): input is Project {
  if (!record(input) || input.version !== 1 || !idValue(input.id) || !textValue(input.name, 300)
    || !Array.isArray(input.pools) || input.pools.length > 8
    || !Array.isArray(input.steps) || input.steps.length > 200) return false;
  const ids = new Set<string>();
  let laneCount = 0;
  const addId = (id: unknown) => {
    if (!idValue(id) || ids.has(id)) return false;
    ids.add(id);
    return true;
  };
  for (const pool of input.pools) {
    if (!record(pool) || !addId(pool.id) || !textValue(pool.name, 300)
      || !Array.isArray(pool.lanes) || pool.lanes.length > 20) return false;
    laneCount += pool.lanes.length;
    if (laneCount > 160) return false;
    for (const lane of pool.lanes) {
      if (!record(lane) || !addId(lane.id) || !textValue(lane.name, 300)) return false;
    }
  }
  for (const step of input.steps) {
    if (!record(step) || !addId(step.id) || !idValue(step.laneId) || typeof step.type !== "string" || !TYPES.has(step.type)
      || !textValue(step.title, 500) || !textValue(step.description, 20000)
      || !Array.isArray(step.routes) || step.routes.length > 200) return false;
    for (const route of step.routes) {
      // A cleared destination is an unfinished draft, not a corrupt project.
      if (!record(route) || (route.targetId !== "" && !idValue(route.targetId)) || !textValue(route.label, 500)) return false;
    }
  }
  return true;
}

export function validateProject(project: Project): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (level: ValidationIssue["level"], message: string, stepId?: string) => issues.push({ level, message, ...(stepId ? { stepId } : {}) });
  const laneIds = new Set(project.pools.flatMap((pool) => pool.lanes.map((lane) => lane.id)));
  const byId = new Map(project.steps.map((step) => [step.id, step]));
  const incoming = new Map<string, string[]>();
  const ids = new Set<string>();
  const checkId = (id: string) => {
    if (ids.has(id)) add("error", `Təkrarlanan identifikator: ${id}.`);
    ids.add(id);
  };
  if (!project.name.trim()) add("warning", "İş axınına ad verin.");
  if (!project.pools.length) add("error", "Ən azı bir pool (iştirakçı təşkilat) yaradın.");
  for (const pool of project.pools) {
    checkId(pool.id);
    if (!pool.name.trim()) add("warning", "Pool adını daxil edin.");
    if (!pool.lanes.length) add("error", `“${pool.name || "Adsız pool"}” üçün ən azı bir zolaq yaradın.`);
    for (const lane of pool.lanes) {
      checkId(lane.id);
      if (!lane.name.trim()) add("warning", "İcraçı zolağının adını daxil edin.");
    }
  }
  for (const step of project.steps) {
    checkId(step.id);
    if (!laneIds.has(step.laneId)) add("error", `“${step.title || "Adsız addım"}” üçün mövcud icraçı zolağı seçin.`, step.id);
    if (!step.title.trim()) add("warning", "Addımın adını daxil edin.", step.id);
    const seenRoutes = new Set<string>();
    for (const route of step.routes) {
      if (!byId.has(route.targetId)) {
        add("error", `“${step.title}” addımındakı keçidin hədəfi mövcud deyil.`, step.id);
        continue;
      }
      const key = `${route.targetId}\u0000${route.label}`;
      if (seenRoutes.has(key)) add("warning", `“${step.title}” addımında eyni keçid təkrarlanır.`, step.id);
      seenRoutes.add(key);
      if (!ARTIFACT_TYPES.has(step.type) && !ARTIFACT_TYPES.has(byId.get(route.targetId)!.type)) {
        const sources = incoming.get(route.targetId);
        if (sources) sources.push(step.id);
        else incoming.set(route.targetId, [step.id]);
      }
      if (route.targetId === step.id) add("warning", `“${step.title}” özünə qayıdır; dövrün çıxış şərtini yoxlayın.`, step.id);
    }
  }
  const flowSteps = project.steps.filter((step) => !ARTIFACT_TYPES.has(step.type));
  const starts = flowSteps.filter((step) => step.type === "start");
  const ends = flowSteps.filter((step) => step.type === "end");
  if (!flowSteps.length) add("warning", "İş axınının addımlarını əlavə edin.");
  else {
    if (!starts.length) add("error", "İş axını üçün başlanğıc hadisəsi əlavə edin.");
    if (!ends.length) add("error", "İş axını üçün son hadisəsi əlavə edin.");
  }
  for (const step of flowSteps) {
    const outputs = step.routes.filter((route) => byId.has(route.targetId) && !ARTIFACT_TYPES.has(byId.get(route.targetId)!.type));
    const inputCount = incoming.get(step.id)?.length || 0;
    if (step.type === "end" && outputs.length) add("error", "Son hadisəsinin davam edən keçidi olmamalıdır.", step.id);
    if (step.type === "start" && inputCount) add("warning", "Başlanğıc hadisəsinə daxil olan keçidi yoxlayın.", step.id);
    if (step.type !== "end" && !outputs.length) add("warning", `“${step.title}” üçün növbəti addımı seçin.`, step.id);
    if (step.type !== "start" && !inputCount) add("warning", `“${step.title}” addımına daxil olan keçid yoxdur.`, step.id);
    if (GATEWAY_TYPES.has(step.type)) {
      if (outputs.length < 2 && inputCount < 2) add("warning", `“${step.title}” keçidində ən azı iki giriş və ya çıxış gözlənilir.`, step.id);
      if ((step.type === "xor" || step.type === "or") && outputs.length > 1) {
        if (outputs.some((route) => !route.label.trim())) add("warning", `“${step.title}” qərarının bütün çıxışlarına şərt yazın.`, step.id);
        const labels = outputs.map((route) => route.label.trim().toLocaleLowerCase("az"));
        if (new Set(labels).size !== labels.length) add("warning", `“${step.title}” qərarında fərqli çıxış şərtləri yazın.`, step.id);
      }
    } else if (outputs.length > 1) {
      add("warning", `“${step.title}” bir neçə qola ayrılır. XOR, OR və ya AND keçidi əlavə edin.`, step.id);
    }
  }
  const visit = (initial: string[], neighbors: (id: string) => string[]) => {
    const reached = new Set<string>();
    const queue = [...initial];
    for (let i = 0; i < queue.length; i++) {
      const id = queue[i];
      if (reached.has(id)) continue;
      reached.add(id);
      queue.push(...neighbors(id).filter((next) => !reached.has(next)));
    }
    return reached;
  };
  if (starts.length) {
    const reached = visit(starts.map((step) => step.id), (id) => (byId.get(id)?.routes || []).map((route) => route.targetId).filter((targetId) => byId.has(targetId) && !ARTIFACT_TYPES.has(byId.get(targetId)!.type)));
    for (const step of flowSteps) if (!reached.has(step.id)) add("warning", `“${step.title}” başlanğıcdan əlçatan deyil.`, step.id);
  }
  if (ends.length) {
    const canFinish = visit(ends.map((step) => step.id), (id) => incoming.get(id) || []);
    for (const step of flowSteps) if (!canFinish.has(step.id)) add("warning", `“${step.title}” addımından son hadisəsinə yol yoxdur.`, step.id);
  }
  return issues;
}

export function explainProject(project: Project): string {
  const byId = new Map(project.steps.map((step) => [step.id, step]));
  const laneNames = new Map(project.pools.flatMap((pool) => pool.lanes.map((lane) => [lane.id, lane.name] as const)));
  const incomingCounts = new Map<string, number>();
  for (const step of project.steps) for (const route of step.routes) {
    if (!ARTIFACT_TYPES.has(step.type) && byId.has(route.targetId) && !ARTIFACT_TYPES.has(byId.get(route.targetId)!.type)) incomingCounts.set(route.targetId, (incomingCounts.get(route.targetId) || 0) + 1);
  }
  const lines = [project.name || "İş axını", "", "İştirakçılar"];
  for (const pool of project.pools) lines.push(`${pool.name || "Adsız pool"}: ${pool.lanes.map((lane) => lane.name || "Adsız icraçı").join(", ") || "İcraçı əlavə edilməyib"}.`);
  lines.push("", "Addımlar");
  project.steps.forEach((step, index) => {
    const kind = STEP_TYPES.find((type) => type.value === step.type)?.label || step.type;
    lines.push("", `${index + 1}. ${step.title || "Adsız addım"} — ${laneNames.get(step.laneId) || "İcraçı seçilməyib"} (${kind})`);
    if (step.description.trim()) lines.push(step.description.trim());
    const outputs = step.routes.filter((route) => byId.has(route.targetId) && !ARTIFACT_TYPES.has(byId.get(route.targetId)!.type));
    if (step.type === "xor" && outputs.length > 1) lines.push("XOR: şərtə görə yalnız bir çıxış seçilir.");
    if (step.type === "or" && outputs.length > 1) lines.push("OR: şərtlərə uyğun bir və ya bir neçə çıxış seçilir.");
    if (step.type === "and" && outputs.length > 1) lines.push("AND: bütün çıxış qolları paralel başlayır.");
    if ((incomingCounts.get(step.id) || 0) > 1) {
      if (step.type === "and") lines.push("AND birləşməsi: bütün daxil olan qollar tamamlandıqdan sonra davam edir.");
      else if (step.type === "or") lines.push("OR birləşməsi: aktivləşmiş qollar tamamlandıqdan sonra davam edir.");
      else if (step.type === "xor") lines.push("XOR birləşməsi: alternativ qollardan biri gələndə davam edir.");
    }
    if (step.type === "end") lines.push("Bu qol burada tamamlanır.");
    else if (!step.routes.length && !ARTIFACT_TYPES.has(step.type)) lines.push("Növbəti addım hələ seçilməyib.");
    for (const route of step.routes) {
      const target = byId.get(route.targetId);
      const targetName = target?.title || (target ? "Adsız addım" : "Mövcud olmayan addım");
      const attachment = ARTIFACT_TYPES.has(step.type) || (target && ARTIFACT_TYPES.has(target.type));
      lines.push(`${attachment ? "Əlaqə" : "Keçid"}: ${route.label.trim() ? `${route.label.trim()} → ` : ""}${targetName}.`);
    }
  });
  const issues = validateProject(project);
  if (issues.length) {
    lines.push("", "Yoxlama qeydləri");
    for (const issue of issues) lines.push(`${issue.level === "error" ? "Xəta" : "Diqqət"}: ${issue.message}`);
  }
  return lines.join("\n");
}
