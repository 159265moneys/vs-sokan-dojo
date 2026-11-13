import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { problems, units } from "../dist/curriculum.js";
import {
  createAttempt,
  hintLearning,
  playLearningMove,
  retryLearning,
  restoreLearningAttempt,
  getLearningView,
  hideLearningHints,
  answerLearningChoice,
  markLearningGuidance,
} from "../dist/learning.js";
import {
  createJourney,
  playJourneyMove,
  applyJourneyReply,
  getJourneyView,
  getJourneyResult,
  previewJourneyMove,
} from "../dist/journey.js";
import { parse } from "../dist/game.js";
const copy = (x) => JSON.parse(JSON.stringify(x));
const app = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
const source = (from, to) =>
  app.slice(
    app.indexOf("function " + from + "("),
    app.indexOf("function " + to + "("),
  );

test("all problems begin with only their stated givens, not answer or hint data", () => {
  for (const p of problems) {
    const state = createAttempt(p.id, { attemptId: p.id }),
      v = getLearningView(state);
    assert.equal(v.hintLevel, 0, p.id);
    assert.equal(v.hintText, "", p.id);
    assert.deepEqual(v.highlights, p.questionHighlights || [], p.id);
    assert.deepEqual(v.transitionFrames, [], p.id);
    assert.deepEqual(v.refutationFrames, [], p.id);
    assert.equal(v.feedback.text, "", p.id);
    for (const c of v.choices)
      assert.deepEqual(Object.keys(c).sort(), ["id", "title"]);
  }
});
test("retry, reload and view closing hide hints while preserving every exposure counter", () => {
  let state = createAttempt("shared-point-order", { attemptId: "hidden-hint" });
  state = hintLearning(hintLearning(hintLearning(state)));
  assert.equal(getLearningView(state).hintLevel, 3);
  const usage = copy(state.hints);
  for (const hidden of [
    hideLearningHints(state),
    restoreLearningAttempt(copy(state)),
    retryLearning(playLearningMove(state, parse("J8"))),
  ]) {
    assert(hidden);
    assert.equal(getLearningView(hidden).hintLevel, 0);
    assert.equal(getLearningView(hidden).hintText, "");
    assert.deepEqual(getLearningView(hidden).highlights, []);
    assert.equal(hidden.hints.uses, usage.uses);
    assert.equal(hidden.hints.maxLevel, usage.maxLevel);
    assert.deepEqual(hidden.hints.byDecision, usage.byDecision);
    const asked = hintLearning(hidden);
    assert.equal(asked.hints.level, 1);
    assert.equal(Math.max(...Object.values(asked.hints.byDecision)), 3);
  }
});
test("a unit tile opens a question without showing or recording its answer demonstration", () => {
  let selected = null;
  const context = vm.createContext({
    units,
    unitId: null,
    lessonTarget: null,
    startProblem: (id, options) => {
      selected = { id, options };
    },
    recordLessonView: () => {
      throw Error("unsolicited demonstration");
    },
    exposeLesson: () => {
      throw Error("unsolicited answer exposure");
    },
  });
  vm.runInContext(
    source("openUnit", "startProblem") + "\nopenUnit('counter');",
    context,
  );
  assert.equal(
    selected.id,
    units.find((u) => u.id === "counter").problemIds[0],
  );
  assert.equal(selected.options.role, "lesson");
});
test("opening comparison states its criterion without supplying the continuation direction", () => {
  const initial = createAttempt("opening-two-plans");
  assert.match(getLearningView(initial).goal, /今の黒石につながる候補/);
  for (const replyVariant of [0, 1]) {
    const state = answerLearningChoice(
      createAttempt("opening-two-plans", { replyVariant }),
      "connect",
    );
    for (const question of [state, restoreLearningAttempt(copy(state))]) {
      assert(question);
      const view = getLearningView(question);
      assert.equal(view.status, "choose");
      assert.match(view.goal, /残る方向に活三/);
      assert.doesNotMatch(view.goal, /斜め|縦|G10|I7/);
      assert.equal(view.feedback.title, view.goal);
      assert.equal(view.feedback.text, "");
      assert.deepEqual(view.highlights, []);
      assert.equal(view.hintText, "");
    }
  }
});
test("a correct prediction leaves the next input unanswered until explanation is explicitly requested", () => {
  const p = problems.find(
    (p) => p.role === "lesson" && p.assessmentDomain === "counter-threat",
  );
  const ctx = vm.createContext({
    learning: createAttempt(p.id, { attemptId: "no-auto-answer" }),
    lessonReplay: null,
    pending: { learn: null },
    learningRole: "lesson",
    learnSection: "lessons",
    currentProblem: () => p,
    answerLearningChoice,
    playLearningMove,
    getLearningView,
    markLearningGuidance,
    saveLearning: () => {},
    render: () => {},
    markLiveHelp: () => {},
    exposeCurrent: () => {},
    se: { play: () => {} },
  });
  vm.runInContext(
    source("submitLearning", "nextLearning") +
      source("replayLearning", "archiveFailure"),
    ctx,
  );
  vm.runInContext(
    "submitLearning(null,'" +
      p.nodes[0].choices.find((c) => c.correct).id +
      "');",
    ctx,
  );
  assert.equal(ctx.learning.status, "choose");
  assert.equal(ctx.lessonReplay, null);
  assert.equal(ctx.learning.guidanceSeen, false);
  assert.deepEqual(getLearningView(ctx.learning).highlights, []);
  assert.equal(getLearningView(ctx.learning).feedback.text, "");
  vm.runInContext("replayLearning('transition');", ctx);
  assert(ctx.lessonReplay.frames.length);
  assert.equal(ctx.learning.guidanceSeen, true);
});
test("guided games hide the derived next move and speculative preview until the hint button is used", () => {
  let journey = createJourney("branch", {
    attemptId: "no-auto-coach",
    replyVariant: "E8",
  });
  journey = playJourneyMove(journey, parse("H8"));
  journey = applyJourneyReply(journey, parse("E8"));
  const view = getJourneyView(journey);
  assert(view.highlights.length);
  for (const show of [false, true]) {
    let previewCalls = 0;
    const panel = { innerHTML: "" },
      scroll = { scrollTop: 0 };
    const context = vm.createContext({
      mode: "learn",
      learnScreen: "journey",
      journey,
      pending: { learn: show ? null : parse("H9") },
      getJourneyView,
      getJourneyResult,
      previewJourneyMove: (...args) => {
        previewCalls++;
        return previewJourneyMove(...args);
      },
      journeyHelpShown: () => show,
      getFrame: () => ({}),
      journeyError: null,
      engineState: "ready",
      learning: null,
      lessonReplay: null,
      review: null,
      reviewScreen: "library",
      momentIndex: 0,
      reviewPhase: "advice",
      reviewFrame: 0,
      reviewStep: 0,
      reviewRetry: null,
      lastPanelKey: "",
      esc: (s) => String(s ?? ""),
      button: (action, label) => "<button>" + label + "</button>",
      statusText: () => "result",
      $: (selector) => (selector === "#panel" ? panel : scroll),
    });
    const frame = vm.runInContext(
      source("rawFrame", "getFrame") + "\nrawFrame();",
      context,
    );
    vm.runInContext(
      source("renderPanel", "hasLearningBranch") + "\nrenderPanel();",
      context,
    );
    if (!show) {
      assert.deepEqual(copy(frame.highlights), []);
      assert.equal(previewCalls, 0);
      assert(!panel.innerHTML.includes(view.instruction.text));
      assert(!panel.innerHTML.includes("H9"));
    } else {
      assert(frame.highlights.length);
      assert(panel.innerHTML.includes(view.instruction.text));
    }
  }
});
