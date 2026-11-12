import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { strategyChapters, strategySources } from "../dist/strategy-article.js";
import {
  strategyMarkup,
  strategyFigures,
  strategyExposure,
  strategyRecordExposures,
} from "../dist/strategy-guide.js";
import { data } from "../dist/strategy-diagrams.js";
import { problems } from "../dist/curriculum.js";
import {
  createLearningProgress,
  recordBoardExposure,
  createAttempt,
  playLearningMove,
  recordLearningAttempt,
  getLearningStats,
} from "../dist/learning.js";
import { assessmentProblems } from "../dist/assessment-bank.js";
import { positionFingerprint } from "../dist/learning-path.js";

test("every chapter, citation and illustrated step resolves in the standalone article", () => {
  const html = strategyMarkup();
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(
    new Set(ids).size,
    ids.length,
    "SVG titles and chapter anchors stay unique",
  );
  for (const [, target] of html.matchAll(/href="#([^"]+)"/g))
    assert(ids.includes(target), target);
  assert(!html.includes("[[diagram:"));
  assert(!html.includes("[[record:"));
  assert.equal(
    (html.match(/class="guide-chapter"/g) || []).length,
    strategyChapters.length,
  );
  assert.equal(
    (html.match(/class="guide-figure"/g) || []).length,
    strategyFigures.length,
  );
  assert(strategyFigures.every((f) => data[f.id]?.frames[f.step]));
  assert(strategySources.every((s) => s.url.startsWith("https://")));
  assert(
    !/data-(?:problem|unit|record|action)=/.test(html),
    "the article does not mix in exercises or match controls",
  );
});

test("reading exposes actual pictured boards without leaking any independent assessment position", () => {
  const assessmentBoards = new Set(
    assessmentProblems.map((p) => positionFingerprint(p.board)),
  );
  for (const f of strategyFigures) {
    const exposure = strategyExposure(f.id, f.step);
    assert(exposure);
    assert(!assessmentBoards.has(positionFingerprint(exposure.board)), f.id);
    assert.deepEqual(exposure.board, data[f.id].frames[f.step].board);
    exposure.board[0] = 99;
    assert.notEqual(data[f.id].frames[f.step].board[0], 99);
  }
  const quiet = strategyExposure("quiet-preparation", 0);
  assert.equal(
    quiet.problemId,
    "quiet-shape",
    "known lesson exposure retains its identity",
  );
  assert.equal(strategyExposure("missing", 0), null);
  assert.equal(strategyExposure("open-four", 99), null);
});

test("moving into the book marks assistance while leaving preserves the reading position and other session state", () => {
  const app = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
  const fn = app.slice(
    app.indexOf("function switchMode("),
    app.indexOf("function statusText("),
  );
  const events = [];
  const context = vm.createContext({
    mode: "play",
    learnScreen: "practice",
    reviewScan: { state: "idle" },
    reviewAutoOpen: false,
    saveStrategyScroll: () => events.push("scroll"),
    markLiveHelp: (k) => events.push(k),
    closeModal: () => {},
    save: () => {},
    render: () => {},
    cpuTurn: () => events.push("cpu"),
    journeyReply: () => {},
  });
  vm.runInContext(fn + "\nswitchMode('guide');", context);
  assert.equal(context.mode, "guide");
  assert.deepEqual(events, ["strategy-guide"]);
  vm.runInContext("switchMode('guide'); switchMode('learn');", context);
  assert.deepEqual(events, ["strategy-guide", "scroll"]);
  assert.equal(context.mode, "learn");
  assert.equal(context.learnScreen, "practice");
});

test("the reading tab never accepts a board move from a suspended review retry", () => {
  const app = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
  const fn = app.slice(
    app.indexOf("function canPlace()"),
    app.indexOf("function switchMode("),
  );
  const context = vm.createContext({
    mode: "guide",
    reviewRetry: { status: "choose" },
  });
  assert.equal(vm.runInContext(fn + "\ncanPlace();", context), false);
});

test("an expanded complete record exposes the intermediate lesson position, not just the printed snapshots", () => {
  const exposures = strategyRecordExposures("whole-game");
  const lesson = problems.find((p) => p.id === "practical-contact");
  assert.equal(exposures.length, 36);
  assert(
    exposures.some(
      (e) => positionFingerprint(e.board) === positionFingerprint(lesson.board),
    ),
  );
  const independent = new Set(
    assessmentProblems.map((p) => positionFingerprint(p.board)),
  );
  for (const e of exposures)
    assert(!independent.has(positionFingerprint(e.board)));
  assert.deepEqual(strategyRecordExposures("missing"), []);
});

test("article board exposure cannot become a first independent foundation answer, and never erases an earlier success", () => {
  const problem = problems.find((p) => p.id === "win-before-block");
  let attempt = createAttempt(problem.id, { attemptId: "book-seen" });
  let progress = recordBoardExposure(createLearningProgress(), problem.board);
  progress = recordLearningAttempt(progress, attempt);
  attempt = playLearningMove(attempt, problem.guide[0]);
  progress = recordLearningAttempt(progress, attempt);
  assert.equal(
    getLearningStats(progress, { problemId: problem.id }).firstTryUnaided,
    0,
  );
  assert.equal(
    getLearningStats(progress, { problemId: problem.id }).knownCompleted,
    1,
  );
  let earlier = createAttempt(problem.id, { attemptId: "before-reading" });
  let history = recordLearningAttempt(createLearningProgress(), earlier);
  earlier = playLearningMove(earlier, problem.guide[0]);
  history = recordLearningAttempt(history, earlier);
  history = recordBoardExposure(history, problem.board);
  assert.equal(
    getLearningStats(history, { problemId: problem.id }).firstTryUnaided,
    1,
  );
});
