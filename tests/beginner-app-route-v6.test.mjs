import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { nextCourseStep } from "../dist/course-route.js";
import { createPathProgress } from "../dist/learning-path.js";
import { units } from "../dist/curriculum.js";
import { assessmentProblems } from "../dist/assessment-bank.js";
const app = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
const source = (from, to) => app.slice(
  app.indexOf("function " + from + "("),
  app.indexOf("function " + to + "("),
);

test("the app's fresh recommendation opens the first lesson instead of spending an unseen assessment", () => {
  const ctx = vm.createContext({
    pathProgress: createPathProgress(), units, assessmentProblems, nextCourseStep,
    nowISO: () => "2026-11-13T12:00:00+09:00",
  });
  vm.runInContext(source("recommendedStep", "goRecommended") + "\nresult = recommendedStep();", ctx);
  assert.equal(ctx.result.kind, "lesson");
  assert.equal(ctx.result.problemId, units[0].problemIds[0]);
});

test("manual baseline exhaustion offers learning instead of an unaided full game", () => {
  let shown = null;
  const ctx = vm.createContext({
    learningRole: "lesson", learning: null, pathProgress: {}, assessmentProblems: [],
    selectAssessment: () => null,
    assessmentAvailability: () => ({ state: "exhausted", reason: "baseline-exhausted", unitId: "priority" }),
    nowISO: () => "2026-11-13T12:00:00+09:00",
    showAssessmentUnavailable: (step) => { shown = step; },
    startJourney: () => { throw Error("novice sent into an unaided game"); },
  });
  vm.runInContext(source("startAssessment", "pathCard") + "\nstartAssessment('priority');", ctx);
  assert.equal(shown.reason, "baseline-exhausted");
});

test("finishing practice with pending confirmation enters the gradual guided sequence", () => {
  const events = [];
  const ctx = vm.createContext({
    recommendedStep: () => ({ kind: "journey", reason: "course-practiced", guided: true }),
    learningRole: "lesson", learning: null, mode: "learn", learnScreen: "practice", learnSection: "lessons",
    save: () => {}, examState: () => ({ challengeCompleted: false }),
    startGuidedNext: () => events.push("guided"),
    startJourney: () => { throw Error("direct jump to full game"); },
  });
  vm.runInContext(source("goRecommended", "startGuidedNext") + "\ngoRecommended();", ctx);
  assert.deepEqual(events, ["guided"]);
});

for (const role of ["lesson", "assessment"])
  test(`the unfinished ${role} is resumed without replacing its attempt`, () => {
    const active = { status: "choose", problemId: "active", hints: { uses: 2 } };
    const ctx = vm.createContext({
      recommendedStep: () => role === "lesson"
        ? { kind: "lesson", reason: "course-lesson", unitId: "priority", problemId: "active" }
        : { kind: "lesson", reason: "course-lesson", unitId: "conditions", problemId: "later" },
      learningRole: role, learning: active,
      currentProblem: () => ({ unitId: "priority" }),
      mode: "learn", learnScreen: "library", lessonReplay: {},
      render: () => {},
      startProblem: () => { throw Error("active question restarted"); },
    });
    vm.runInContext(source("goRecommended", "startGuidedNext") + "\ngoRecommended();", ctx);
    assert.equal(ctx.learning, active);
    assert.equal(ctx.learnScreen, "practice");
    assert.equal(ctx.lessonReplay, null);
    assert.equal(active.hints.uses, 2);
  });

test("a saved unfinished lesson remains resumable after the unit's lesson order changes", () => {
  const active = { status: "choose", problemId: "quiet-two-plans", history: [1, 2], hints: { uses: 1 } };
  const ctx = vm.createContext({
    recommendedStep: () => ({ kind: "lesson", reason: "course-lesson", unitId: "prepare", problemId: "quiet-shape" }),
    learningRole: "lesson", learning: active,
    currentProblem: () => ({ unitId: "prepare" }),
    mode: "learn", learnScreen: "library", lessonReplay: {},
    render: () => {},
    startProblem: () => { throw Error("reordered unit replaced the saved question"); },
  });
  vm.runInContext(source("goRecommended", "startGuidedNext") + "\ngoRecommended();", ctx);
  assert.equal(ctx.learning, active);
  assert.equal(ctx.learnScreen, "practice");
  assert.deepEqual(active.history, [1, 2]);
});

for (const role of ["lesson", "assessment"])
  test(`requesting help does not replace an unfinished ${role} with its remediation attempt`, () => {
    const active = { status: "choose", problemId: "active", history: [1, 2], hints: { uses: 2 } };
    const ctx = vm.createContext({
      recommendedStep: () => ({
        kind: "lesson", reason: "confirmation-remediation", unitId: "priority",
        problemId: role === "lesson" ? "active" : "remedial",
      }),
      learningRole: role, learning: active,
      currentProblem: () => ({ unitId: "priority" }),
      mode: "learn", learnScreen: "library", lessonReplay: {},
      render: () => {},
      openUnit: () => { throw Error("unfinished attempt replaced by remediation"); },
      startProblem: () => { throw Error("unfinished attempt restarted"); },
    });
    vm.runInContext(source("goRecommended", "startGuidedNext") + "\ngoRecommended();", ctx);
    assert.equal(ctx.learning, active);
    assert.equal(ctx.learnScreen, "practice");
    assert.equal(active.hints.uses, 2);
    assert.deepEqual(active.history, [1, 2]);
  });
