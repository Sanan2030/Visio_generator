import assert from "node:assert/strict";
import test from "node:test";
import { createProject, explainProject, isProject, SAMPLE_PROJECT, validateProject } from "../lib/process";
import { STEP_METADATA_FIELDS, type Project, type Step, type StepType } from "../lib/types";

function flow(splitType: StepType = "and", joinType: StepType = "xor"): Project {
  const project = createProject();
  const laneId = project.pools[0].lanes[0].id;
  const step = (id: string, type: StepType, targets: string[] = []): Step => ({ id, laneId, type, title: id, description: "", routes: targets.map(targetId => ({ targetId, label: targetId })) });
  project.steps = [step("start", "start", ["split"]), step("split", splitType, ["a", "b"]), step("a", "task", ["join"]), step("b", "task", ["join"]), step("join", joinType, ["end"]), step("end", "end")];
  return project;
}

function mismatches(project: Project) {
  return validateProject(project).filter(issue => issue.level === "error" && /ilə ayrılır.*ilə birləşir/u.test(issue.message));
}

test("optional SLA, system and document strings survive version-1 drafts without requiring migration", () => {
  const project = flow();
  assert.equal(isProject(project), true);
  assert.equal(isProject(SAMPLE_PROJECT), true);
  Object.assign(project.steps[2], { duration: "2 iş günü", system: "Sənəd dövriyyəsi", document: "Müraciət forması" });
  const restored: unknown = JSON.parse(JSON.stringify(project));
  assert.equal(isProject(restored), true);
  if (!isProject(restored)) throw new Error("Draft is invalid");
  assert.equal(restored.version, 1);
  assert.equal(restored.steps[2].duration, "2 iş günü");
  assert.equal(restored.steps[2].system, "Sənəd dövriyyəsi");
  assert.equal(restored.steps[2].document, "Müraciət forması");
  for (const field of STEP_METADATA_FIELDS) {
    project.steps[2][field.key] = "";
    assert.equal(isProject(project), true, "cleared optional metadata remains a valid draft");
    delete project.steps[2][field.key];
    assert.equal(isProject(project), true, "omitted metadata remains compatible");
  }
});

test("optional metadata rejects wrong types and oversized values with shared form bounds", () => {
  for (const field of STEP_METADATA_FIELDS) {
    const project = flow();
    project.steps[2][field.key] = "x".repeat(field.maxLength);
    assert.equal(isProject(project), true);
    project.steps[2][field.key] = "x".repeat(field.maxLength + 1);
    assert.equal(isProject(project), false);
    for (const value of [null, false, 10, {}, []]) {
      const malformed = { ...project, steps: [{ ...project.steps[2], [field.key]: value }] };
      assert.equal(isProject(malformed), false, `${field.key}: ${JSON.stringify(value)}`);
    }
  }
});

test("AND splits paired with XOR joins and XOR splits paired with AND joins are errors on the rejoin", () => {
  for (const [splitType, joinType] of [["and", "xor"], ["xor", "and"]] as const) {
    const errors = mismatches(flow(splitType, joinType));
    assert.equal(errors.length, 1);
    assert.equal(errors[0].stepId, "join");
    assert.match(errors[0].message, new RegExp(`${splitType.toUpperCase()}.*${joinType.toUpperCase()}`));
  }
  for (const type of ["and", "xor", "or"] as const) assert.deepEqual(mismatches(flow(type, type)), []);
});

test("nested balanced gateways match their own branches rather than another level's join", () => {
  const project = flow("and", "and");
  const laneId = project.steps[0].laneId;
  project.steps[2] = { ...project.steps[2], type: "xor", routes: [{ targetId: "left", label: "Birinci" }, { targetId: "right", label: "İkinci" }] };
  project.steps.splice(3, 0, ...["left", "right"].map(id => ({ id, laneId, type: "task" as const, title: id, description: "", routes: [{ targetId: "inner-join", label: "" }] })), { id: "inner-join", laneId, type: "xor", title: "Daxili birləşmə", description: "", routes: [{ targetId: "join", label: "" }] });
  assert.deepEqual(mismatches(project), []);
  project.steps.find(step => step.id === "inner-join")!.type = "and";
  assert.deepEqual(mismatches(project).map(issue => issue.stepId), ["inner-join"]);
});

test("a plain-task first rejoin prevents mismatching an unrelated later gateway", () => {
  const project = flow("and", "task");
  project.steps[4].routes[0].targetId = "later";
  project.steps.splice(5, 0, { ...project.steps[4], id: "later", title: "Sonrakı XOR", type: "xor", routes: [{ targetId: "end", label: "" }] });
  project.steps.push({ ...project.steps[2], id: "unrelated", title: "Əlaqəsiz qol", routes: [{ targetId: "later", label: "" }] });
  assert.deepEqual(mismatches(project), []);
});

test("loops stay finite and do not turn retry paths, diverging ends or dead ends into paired joins", () => {
  const selfLoop = flow();
  selfLoop.steps[2].routes.push({ targetId: "a", label: "Təkrar" });
  assert.equal(mismatches(selfLoop).length, 1, "a local retry still reaches the same mismatched rejoin");
  const retry = flow();
  retry.steps[2].routes.push({ targetId: "split", label: "Yenidən başla" });
  assert.deepEqual(mismatches(retry), []);
  const diverging = flow();
  diverging.steps[2].routes.push({ targetId: "end", label: "Qolu bitir" });
  assert.deepEqual(mismatches(diverging), []);
  const deadEnd = flow();
  deadEnd.steps[2].routes.push({ targetId: "stuck", label: "Dayan" });
  deadEnd.steps.push({ ...deadEnd.steps[2], id: "stuck", title: "Davamı yoxdur", routes: [] });
  assert.deepEqual(mismatches(deadEnd), []);
  const closedCycle = flow();
  closedCycle.steps[2].routes.push({ targetId: "stuck", label: "Dövrə gir" });
  closedCycle.steps.push({ ...closedCycle.steps[2], id: "stuck", title: "Qapalı dövr", routes: [{ targetId: "stuck", label: "Təkrar" }] });
  assert.deepEqual(mismatches(closedCycle), [], "a closed component is not evidence of a shared rejoin");
});

test("disconnected branch destinations, duplicate routes and artifacts do not invent split/join pairs", () => {
  const disconnected = flow();
  disconnected.steps[3].routes = [{ targetId: "end", label: "" }];
  assert.deepEqual(mismatches(disconnected), []);
  const duplicated = flow();
  duplicated.steps[1].routes = [{ targetId: "a", label: "Birinci" }, { targetId: "a", label: "İkinci" }];
  assert.deepEqual(mismatches(duplicated), []);
  const artifacts = flow();
  artifacts.steps[3].type = "annotation";
  artifacts.steps[1].routes.push({ targetId: "missing", label: "Qaralama" });
  assert.deepEqual(mismatches(artifacts), []);
  assert.deepEqual(validateProject(SAMPLE_PROJECT).filter(issue => issue.level === "error"), []);
});

test("cross-pool message flows are not sequence branches for gateway pair matching", () => {
  const project = flow();
  project.pools.push({ id: "external-pool", name: "Xarici təşkilat", lanes: [{ id: "external-lane", name: "Xarici iştirakçı" }] });
  project.steps[3].laneId = "external-lane";
  assert.deepEqual(mismatches(project), []);
  project.steps[3].laneId = project.steps[2].laneId;
  assert.equal(mismatches(project).length, 1, "putting both branches in the pool restores the actual mismatch");
});


test("text explanations include populated metadata and preserve legacy output for absent or blank fields", () => {
  const project = flow("and", "and");
  const legacy = explainProject(project);
  Object.assign(project.steps[2], { duration: " 2 iş günü ", system: " Sənəd dövriyyəsi ", document: " Müraciət forması " });
  const explanation = explainProject(project);
  assert.match(explanation, /Müddət \(SLA\): 2 iş günü\nSistem: Sənəd dövriyyəsi\nSənəd: Müraciət forması/u);
  for (const field of STEP_METADATA_FIELDS) project.steps[2][field.key] = "   ";
  assert.equal(explainProject(project), legacy);
  for (const field of STEP_METADATA_FIELDS) delete project.steps[2][field.key];
  assert.equal(explainProject(project), legacy);
});
