import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
const source = (from, to) =>
  app.slice(
    app.indexOf("function " + from + "("),
    app.indexOf("function " + to + "("),
  );

test("an in-progress last unseen question remains resumable even when no further question can be issued", () => {
  const events = [];
  const ctx = vm.createContext({
    recommendedStep: () => ({
      kind: "assessment-unavailable",
      unitId: "counter",
      assessmentDomain: "counter-threat",
    }),
    learningRole: "assessment",
    learning: { status: "choose" },
    currentProblem: () => ({
      unitId: "counter",
      assessmentDomain: "counter-threat",
    }),
    mode: "learn",
    learnScreen: "library",
    lessonReplay: { kind: "transition" },
    render: () => events.push("resume"),
    showAssessmentUnavailable: () => {
      throw Error("the active attempt was stranded");
    },
  });
  vm.runInContext(
    source("goRecommended", "startGuidedNext") + "\ngoRecommended();",
    ctx,
  );
  assert.equal(ctx.learnScreen, "practice");
  assert.equal(ctx.lessonReplay, null);
  assert.deepEqual(events, ["resume"]);
});
test("manual confirmation buttons never send an exhausted prediction requirement into an unrelated game", () => {
  let shown = false,
    played = false;
  const ctx = vm.createContext({
    learningRole: "lesson",
    learning: null,
    selectAssessment: () => null,
    assessmentAvailability: () => ({
      state: "exhausted",
      reason: "domain-exhausted",
      unitId: "counter",
      assessmentDomain: "counter-threat",
    }),
    pathProgress: {},
    assessmentProblems: [],
    nowISO: () => "2026-11-13T12:00:00+09:00",
    showAssessmentUnavailable: () => {
      shown = true;
    },
    startJourney: () => {
      played = true;
    },
  });
  vm.runInContext(
    source("startAssessment", "pathCard") +
      "\nstartAssessment('counter','retention');",
    ctx,
  );
  assert(shown);
  assert.equal(played, false);
});
test("a completed final challenge leads to its result and does not automatically create another challenge", () => {
  let restarted = false,
    rendered = false;
  const ctx = vm.createContext({
    recommendedStep: () => ({ kind: "journey", reason: "initial-complete" }),
    learningRole: "lesson",
    learning: null,
    mode: "learn",
    learnScreen: "practice",
    learnSection: "lessons",
    save: () => {},
    examState: () => ({ challengeCompleted: true }),
    startGuidedNext: () => {
      restarted = true;
    },
    render: () => {
      rendered = true;
    },
  });
  vm.runInContext(
    source("goRecommended", "startGuidedNext") + "\ngoRecommended();",
    ctx,
  );
  assert.equal(restarted, false);
  assert(rendered);
  assert.equal(ctx.learnScreen, "library");
  assert.equal(ctx.learnSection, "games");
});

test("a last in-progress confirmation can also be resumed from its unit button", () => {
  let rendered = false;
  const ctx = vm.createContext({
    selectAssessment: () => null,
    pathProgress: {},
    assessmentProblems: [],
    nowISO: () => "2026-11-13T12:00:00+09:00",
    learningRole: "assessment",
    learning: { status: "choose" },
    currentProblem: () => ({ unitId: "counter" }),
    mode: "learn",
    learnScreen: "library",
    lessonReplay: { kind: "transition" },
    render: () => {
      rendered = true;
    },
    showAssessmentUnavailable: () => {
      throw Error("active attempt must remain resumable");
    },
  });
  vm.runInContext(
    source("startAssessment", "pathCard") +
      "\nstartAssessment('counter','retention');",
    ctx,
  );
  assert(rendered);
  assert.equal(ctx.learnScreen, "practice");
  assert.equal(ctx.lessonReplay, null);
});
