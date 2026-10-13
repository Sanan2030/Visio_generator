import { createId } from "./process";
import type { Project, Step, StepType } from "./types";

export type ProcessTemplateId = "approval" | "question-answer" | "recruitment";

export const PROCESS_TEMPLATES: { id: ProcessTemplateId; name: string; description: string }[] = [
  { id: "approval", name: "Təsdiq prosesi", description: "Müraciətin yoxlanılması, təsdiqi və düzəliş üçün geri qaytarılması." },
  { id: "question-answer", name: "Sorğu-cavab", description: "İki tərəf arasında sorğu, cavab və əlavə məlumat mübadiləsi." },
  { id: "recruitment", name: "İşə qəbul", description: "Namizədin qiymətləndirilməsi, paralel yoxlama və yekun qərar." },
];

function step(id: string, laneId: string, type: StepType, title: string, description: string, routes: [string, string][] = []): Step {
  return { id, laneId, type, title, description, routes: routes.map(([targetId, label]) => ({ targetId, label })) };
}

const definitions: Record<ProcessTemplateId, Project> = {
  approval: {
    version: 1, id: "approval-template", name: "Təsdiq prosesi",
    pools: [{ id: "organization", name: "Təşkilat", lanes: [
      { id: "requester", name: "Müraciət edən" }, { id: "approver", name: "Təsdiqləyən" }, { id: "system", name: "Sistem" },
    ] }],
    steps: [
      step("start", "requester", "start", "Müraciət daxil oldu", "Müraciət edən yeni müraciət yaradır.", [["prepare", ""]]),
      step("prepare", "requester", "userTask", "Müraciəti hazırla", "Tələb olunan məlumatları və sənədləri daxil et.", [["review", ""]]),
      step("review", "approver", "userTask", "Müraciəti yoxla", "Təsdiqləyən müraciətin düzgünlüyünü və tamlığını yoxlayır.", [["decision", ""]]),
      step("decision", "approver", "xor", "Müraciət təsdiqlənir?", "Təsdiq verilirsə qeydiyyat aparılır; imtina zamanı müraciət düzəlişə qaytarılır.", [["register", "Təsdiq"], ["correct", "İmtina"]]),
      step("register", "system", "serviceTask", "Təsdiqi qeydiyyata al", "Sistem təsdiq nəticəsini qeyd edir və müraciət edənə bildirir.", [["finish", ""]]),
      step("correct", "requester", "userTask", "Müraciəti düzəlt", "İmtina səbəbinə uyğun məlumatları düzəlt və təkrar yoxlamaya göndər.", [["review", "Yenidən göndər"]]),
      step("finish", "system", "end", "Təsdiq tamamlandı", "Müraciətin təsdiq prosesi tamamlanır."),
    ],
  },
  "question-answer": {
    version: 1, id: "question-answer-template", name: "Sorğu-cavab",
    pools: [
      { id: "requesting-party", name: "Sorğu göndərən tərəf", lanes: [{ id: "requester", name: "Sorğu göndərən" }] },
      { id: "responding-party", name: "Cavab verən tərəf", lanes: [{ id: "respondent", name: "Cavab verən" }] },
    ],
    steps: [
      step("start", "requester", "start", "Sorğuya ehtiyac yarandı", "Məlumat və ya sənəd almaq üçün sorğu prosesi başladılır.", [["ask", ""]]),
      step("ask", "requester", "userTask", "Sorğunu göndər", "Sorğunun mövzusunu və tələb olunan məlumatları yazaraq qarşı tərəfə göndər.", [["answer", "Sorğu"]]),
      step("answer", "respondent", "userTask", "Cavabı hazırla", "Cavab verən sorğunu araşdırır və tələb olunan məlumatları təqdim edir.", [["decision", "Cavab"]]),
      step("decision", "requester", "xor", "Cavab kifayətdirmi?", "Sorğu göndərən cavabın tamlığını yoxlayır.", [["finish", "Bəli"], ["clarify", "Əlavə məlumat lazımdır"]]),
      step("clarify", "requester", "userTask", "Sorğunu dəqiqləşdir", "Çatışmayan məlumatları qeyd et və dəqiqləşdirilmiş sorğunu yenidən göndər.", [["ask", "Yenidən soruş"]]),
      step("finish", "requester", "end", "Sorğu cavablandırıldı", "Alınan cavab sorğunu təmin edir və proses tamamlanır."),
    ],
  },
  recruitment: {
    version: 1, id: "recruitment-template", name: "İşə qəbul",
    pools: [{ id: "employer", name: "İşəgötürən", lanes: [
      { id: "hr", name: "İnsan resursları" }, { id: "manager", name: "Şöbə rəhbəri" },
    ] }],
    steps: [
      step("start", "hr", "start", "Namizəd müraciət etdi", "Vakansiyaya namizədin müraciəti daxil olur.", [["register", ""]]),
      step("register", "hr", "userTask", "Namizədi qeydiyyata al", "Namizədin əlaqə məlumatlarını və təcrübəsini qeyd et.", [["parallel", ""]]),
      step("parallel", "hr", "and", "Qiymətləndirməni başlat", "Sənədlərin yoxlanılması və müsahibə paralel aparılır.", [["screen", "Sənəd yoxlaması"], ["interview", "Müsahibə"]]),
      step("screen", "hr", "userTask", "Sənədləri yoxla", "Namizədin təcrübəsini, təqdim etdiyi sənədləri və tələblərə uyğunluğunu yoxla.", [["join", ""]]),
      step("interview", "manager", "userTask", "Müsahibə keçir", "Şöbə rəhbəri namizədin peşə bacarıqlarını qiymətləndirir.", [["join", ""]]),
      step("join", "hr", "and", "Nəticələri birləşdir", "Sənəd yoxlaması və müsahibə tamamlandıqdan sonra yekun qərara keç.", [["decision", ""]]),
      step("decision", "manager", "xor", "Namizəd uyğundurmu?", "Toplanmış nəticələrə əsasən işə qəbul və ya imtina qərarı verilir.", [["offer", "Bəli"], ["decline", "İmtina"]]),
      step("offer", "hr", "userTask", "İş təklifini göndər", "Uyğun namizədə vəzifə, əməkhaqqı və işə başlama tarixini bildir.", [["finish", ""]]),
      step("decline", "hr", "userTask", "İmtina barədə bildir", "Namizədə qərarı və uyğun olduqda imtina səbəbini bildir.", [["finish", ""]]),
      step("finish", "hr", "end", "Seçim tamamlandı", "Namizədin seçim prosesi tamamlanır."),
    ],
  },
};

/** Every opening creates independent editable identities, with remapped routes. */
export function createProcessTemplate(templateId: ProcessTemplateId): Project {
  const definition = definitions[templateId];
  if (!definition) throw new Error("Seçilmiş şablon mövcud deyil.");
  const ids = new Map<string, string>();
  for (const pool of definition.pools) {
    ids.set(pool.id, createId());
    for (const lane of pool.lanes) ids.set(lane.id, createId());
  }
  for (const item of definition.steps) ids.set(item.id, createId());
  return {
    version: 1, id: createId(), name: definition.name,
    pools: definition.pools.map((pool) => ({
      ...pool, id: ids.get(pool.id)!, lanes: pool.lanes.map((lane) => ({ ...lane, id: ids.get(lane.id)! })),
    })),
    steps: definition.steps.map((item) => ({
      ...item, id: ids.get(item.id)!, laneId: ids.get(item.laneId)!,
      routes: item.routes.map((route) => ({ ...route, targetId: ids.get(route.targetId)! })),
    })),
  };
}
