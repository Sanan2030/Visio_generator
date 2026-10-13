import assert from "node:assert/strict";
import test from "node:test";
import { isProject, SAMPLE_PROJECT, validateProject } from "../lib/process";
import { createProcessTemplate, PROCESS_TEMPLATES } from "../lib/templates";
import type { Project } from "../lib/types";

function identities(project: Project): string[] {
  return [project.id, ...project.pools.flatMap((pool) => [pool.id, ...pool.lanes.map((lane) => lane.id)]), ...project.steps.map((step) => step.id)];
}

function facts(project: Project) {
  const byId = new Map(project.steps.map((step) => [step.id, step.title]));
  const lanes = new Map(project.pools.flatMap((pool) => pool.lanes.map((lane) => [lane.id, lane.name])));
  return {
    name: project.name,
    pools: project.pools.map((pool) => ({ name: pool.name, lanes: pool.lanes.map((lane) => lane.name) })),
    steps: project.steps.map((step) => ({ type: step.type, title: step.title, description: step.description,
      actor: lanes.get(step.laneId), routes: step.routes.map((route) => ({ destination: byId.get(route.targetId), label: route.label })) })),
  };
}

test("the three Azerbaijani presets create valid complete flows with all route targets and actors remapped", () => {
  assert.deepEqual(PROCESS_TEMPLATES.map((template) => template.name), ["Təsdiq prosesi", "Sorğu-cavab", "İşə qəbul"]);
  for (const metadata of PROCESS_TEMPLATES) {
    const project = createProcessTemplate(metadata.id);
    assert.equal(project.name, metadata.name);
    assert.equal(isProject(project), true);
    assert.deepEqual(validateProject(project), []);
    const allIds = identities(project);
    assert.equal(new Set(allIds).size, allIds.length);
    const lanes = new Set(project.pools.flatMap((pool) => pool.lanes.map((lane) => lane.id)));
    const steps = new Set(project.steps.map((step) => step.id));
    for (const step of project.steps) {
      assert.ok(lanes.has(step.laneId));
      for (const route of step.routes) assert.ok(steps.has(route.targetId));
    }
  }
});

test("each opening is an independent project with fresh identities and unchanged template facts", () => {
  for (const metadata of PROCESS_TEMPLATES) {
    const first = createProcessTemplate(metadata.id);
    const second = createProcessTemplate(metadata.id);
    const firstIds = new Set(identities(first));
    assert.ok(identities(second).every((id) => !firstIds.has(id)));
    assert.deepEqual(facts(first), facts(second));
    first.pools[0].lanes[0].name = "Dəyişdirilmiş icraçı";
    first.steps[0].title = "Dəyişdirilmiş başlanğıc";
    first.steps[0].routes[0].label = "Dəyişdirilmiş keçid";
    assert.deepEqual(facts(createProcessTemplate(metadata.id)), facts(second));
  }
});

test("presets retain useful correction loops, cross-pool exchanges and matching parallel split/join gateways", () => {
  const approval = createProcessTemplate("approval");
  const review = approval.steps.find((step) => step.title === "Müraciəti yoxla")!;
  const correction = approval.steps.find((step) => step.title === "Müraciəti düzəlt")!;
  assert.equal(correction.routes[0].targetId, review.id);
  assert.deepEqual(approval.steps.find((step) => step.type === "xor")!.routes.map((route) => route.label), ["Təsdiq", "İmtina"]);
  const questions = createProcessTemplate("question-answer");
  assert.equal(questions.pools.length, 2);
  const requesterLane = questions.pools[0].lanes[0].id;
  const respondentLane = questions.pools[1].lanes[0].id;
  const ask = questions.steps.find((step) => step.title === "Sorğunu göndər")!;
  const answer = questions.steps.find((step) => step.title === "Cavabı hazırla")!;
  assert.equal(ask.laneId, requesterLane);
  assert.equal(answer.laneId, respondentLane);
  assert.equal(ask.routes[0].targetId, answer.id);
  const recruitment = createProcessTemplate("recruitment");
  const gateways = recruitment.steps.filter((step) => step.type === "and");
  assert.equal(gateways.length, 2);
  assert.equal(gateways[0].routes.length, 2);
  assert.equal(recruitment.steps.filter((step) => step.routes.some((route) => route.targetId === gateways[1].id)).length, 2);
  assert.equal(SAMPLE_PROJECT.name, "Müştəri müraciətləri");
  assert.equal(SAMPLE_PROJECT.steps.length, 20);
  assert.deepEqual(validateProject(SAMPLE_PROJECT), []);
});
