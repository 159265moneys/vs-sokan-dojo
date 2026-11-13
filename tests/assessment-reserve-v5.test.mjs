import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  reserveAssessments,
  resolveReserveProblem,
  reserveCoverage,
} from "../dist/assessment-reserve-v5.js";
import { problems, units } from "../dist/curriculum.js";
import { data as diagrams } from "../dist/strategy-diagrams.js";
import { trainingLessons, lessonBoard } from "../dist/lessons.js";
import {
  createAttempt,
  answerLearningChoice,
  playLearningMove,
  restoreLearningAttempt,
  retryLearning,
  getLearningView,
  hintLearning,
} from "../dist/learning.js";
import {
  createPathProgress,
  recordAttemptEvidence,
  unitStatus,
  nextLearningStep,
} from "../dist/learning-path.js";
import {
  exerciseSatisfied,
  exerciseFacts,
} from "../dist/learning-objectives.js";
import {
  buildReserveAssessments,
  loadReserveSources,
  reconstructReserveRecipe,
  serializeReserveCatalog,
} from "../scripts/build-assessment-reserve-v5.mjs";
import {
  compileProblem,
  evaluateProblem,
  empty,
  fingerprint,
  wins,
  coord,
  five,
} from "../scripts/reserve-oracle-v5.mjs";
import { reserveDiagnostic } from "../scripts/reserve-novelty-v5.mjs";

const clone = (value) => JSON.parse(JSON.stringify(value));
const correct = (problem) =>
  problem.nodes[0].choices.find((choice) => choice.correct);
const continuation = (problem) => correct(problem).continuations?.[0];
const facts = new Map(
  reserveAssessments.map((problem) => [
    problem.id,
    evaluateProblem(compileProblem(problem), [...problem.board]),
  ]),
);
const expectedCoverage = {
  "conditions-positive": 8,
  "conditions-negative": 7,
  "counter-threat": 25,
  "counter-clear": 8,
  "branch-ready": 8,
  "branch-rebuild": 8,
  "prepare-two": 8,
  "prepare-one": 8,
  "opening-near-ready": 8,
  "opening-near-blocked": 8,
  "opening-far-ready": 8,
  "opening-far-blocked": 7,
  "practical-win": 8,
  "practical-defense": 7,
  "practical-build": 8,
};
function projected(problem) {
  const board = [...problem.board];
  for (const move of continuation(problem)?.moves || []) {
    assert.equal(board[move.i], 0, problem.id);
    board[move.i] = move.side;
  }
  return board;
}

// A second completion enumerator follows rays from every empty cell. It shares
// neither production predicates nor the build oracle's five-window algorithm.
const directions = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
const inside = (x, y) => x >= 0 && x < 15 && y >= 0 && y < 15;
function rayWin(board, i, side) {
  const x = i % 15,
    y = Math.floor(i / 15);
  return directions.some(([dx, dy]) => {
    let count = 1;
    for (const sign of [-1, 1])
      for (
        let k = 1;
        inside(x + k * sign * dx, y + k * sign * dy) &&
        board[(y + k * sign * dy) * 15 + x + k * sign * dx] === side;
        k++
      )
        count++;
    return count >= 5;
  });
}
const rayWins = (board, side) =>
  empty(board).filter((i) => rayWin(board, i, side));

test("134 immutable reserve assessments have exact coverage and trusted IDs", () => {
  assert.equal(reserveAssessments.length, 134);
  assert.deepEqual(reserveCoverage, expectedCoverage);
  assert.equal(new Set(reserveAssessments.map((p) => p.id)).size, 134);
  for (const p of reserveAssessments) {
    assert.equal(p.role, "assessment");
    assert.equal(p.supply, "reserve");
    assert.equal(p.kind, "compare");
    assert.equal(p.requiresBranch, false);
    assert(
      Object.isFrozen(p) &&
        Object.isFrozen(p.board) &&
        Object.isFrozen(p.prediction.reason),
    );
    assert.strictEqual(resolveReserveProblem(p.id), p);
    assert.equal(resolveReserveProblem(`${p.id}-unregistered`), null);
    assert.equal(p.nodes[0].choices.filter((c) => c.correct).length, 1);
    assert.equal(facts.get(p.id).domain, p.assessmentDomain);
    assert.deepEqual(facts.get(p.id).accepted, p.guide);
    if (p.unitId === "prepare")
      assert(p.goal.includes(`黒${coord(p.prediction.candidate)}を使う活三`));
    if (p.unitId === "practice")
      assert.equal(
        p.nodes[0].choices.find((c) => c.id === "win").title,
        "今すぐ五連",
      );
    if (p.unitId === "conditions" && p.prediction.completionPoints.length > 2) {
      assert.equal(p.prediction.kind, "completion-count");
      assert.equal(correct(p).title, "2か所以上");
      assert(
        correct(p).text.includes(`${p.prediction.completionPoints.length}か所`),
      );
      assert(!correct(p).resultTitle.includes("両端四"));
    }
  }
  assert.equal(resolveReserveProblem(null), null);
  const runtime = readFileSync(
    new URL("../dist/assessment-reserve-v5.js", import.meta.url),
    "utf8",
  );
  assert(!runtime.includes("node:fs") && !runtime.includes("/tmp/"));
});

test("fixed recipes reproduce the shipped catalog byte for byte and reject changed parameters", () => {
  const input = loadReserveSources();
  const first = buildReserveAssessments(input);
  const second = buildReserveAssessments(clone(input));
  assert.deepEqual(first, reserveAssessments);
  assert.equal(serializeReserveCatalog(first), serializeReserveCatalog(second));
  assert.equal(
    serializeReserveCatalog(first),
    readFileSync(
      new URL("../dist/assessment-reserve-v5.js", import.meta.url),
      "utf8",
    ),
  );
  const original = input.recipes[0];
  for (const altered of [
    { ...clone(original), id: original.id + "-x" },
    { ...clone(original), edit: { ...original.edit, to: 225 } },
    { ...clone(original), domain: "counter-threat" },
    { ...clone(original), semanticFingerprint: "forged" },
  ])
    assert.equal(reconstructReserveRecipe(altered, input.templates), null);
  const ray = input.recipes.find((entry) => entry.recipe === "counter-ray1");
  for (const edit of [
    { direction: 4 },
    { mask: 256 },
    { mask: 1 },
    { seed: 1 },
  ])
    assert.equal(
      reconstructReserveRecipe(
        { ...clone(ray), edit: { ...ray.edit, ...edit } },
        input.templates,
      ),
      null,
    );
  const stale = clone(input.templates);
  stale[original.source].prediction.reason = { kind: "stale-author-reason" };
  assert.equal(reconstructReserveRecipe(original, stale), null);
});

test("initial positions and relevant local structures are unseen across all authored teaching content", () => {
  const known = new Map();
  function visit(value, source) {
    if (!value || typeof value !== "object" || value.supply === "reserve")
      return;
    if (
      (Array.isArray(value) || ArrayBuffer.isView(value)) &&
      value.length === 225 &&
      [...value].every((s) => s === 0 || s === 1 || s === 2)
    ) {
      known.set(fingerprint(value), source);
      return;
    }
    for (const [key, item] of Object.entries(value))
      visit(item, `${source}/${key}`);
  }
  visit(problems, "curriculum");
  visit(units, "units");
  visit(diagrams, "diagrams");
  for (const lesson of trainingLessons)
    for (let step = 0; step <= lesson.steps.length; step++)
      visit(lessonBoard(lesson, step), `lesson/${lesson.id}/${step}`);
  for (const course of JSON.parse(
    readFileSync(
      new URL("../dist/expert-courses.json", import.meta.url),
      "utf8",
    ),
  ).courses) {
    const board = Array(225).fill(0);
    visit(board, course.id);
    for (const [index, move] of course.moves.entries()) {
      board[typeof move === "number" ? move : move.i] = (index % 2) + 1;
      visit(board, course.id);
    }
  }
  const semantic = new Map();
  for (const p of problems.filter(
    (p) =>
      p.supply !== "reserve" &&
      p.kind === "compare" &&
      p.prediction &&
      (p.assessmentDomain || p.teachesAssessmentDomain),
  )) {
    const fact = evaluateProblem(compileProblem(p), [...p.board]);
    assert(fact, p.id);
    semantic.set(reserveDiagnostic(p, fact).signature, p.id);
  }
  const sources = new Map(
    loadReserveSources().recipes.map((entry) => [entry.id, entry]),
  );
  const generated = new Map();
  for (const p of reserveAssessments) {
    const position = fingerprint(p.board),
      diagnosis = reserveDiagnostic(p, facts.get(p.id));
    assert(!known.has(position), `${p.id}: known ${known.get(position)}`);
    assert(
      !generated.has(position),
      `${p.id}: repeated ${generated.get(position)}`,
    );
    assert(
      !semantic.has(diagnosis.signature),
      `${p.id}: local duplicate ${semantic.get(diagnosis.signature)}`,
    );
    assert.equal(diagnosis.signature, sources.get(p.id).semanticFingerprint);
    semantic.set(diagnosis.signature, p.id);
    generated.set(position, p.id);
  }
  for (const p of reserveAssessments)
    for (const frame of correct(p).frames) {
      const other = generated.get(fingerprint(frame.board));
      assert(!other || other === p.id, `${p.id}: frame reveals ${other}`);
    }
});

test("every prediction has the claimed finite facts, including all white replies", () => {
  let counterReplies = 0,
    priorityReplies = 0,
    futureBlackInputs = 0;
  for (const p of reserveAssessments) {
    const fact = facts.get(p.id),
      pr = p.prediction,
      c = pr.candidate ?? pr.move,
      r = pr.reply,
      board = projected(p);
    assert.equal(
      p.board.filter((s) => s === 1).length,
      p.board.filter((s) => s === 2).length,
    );
    assert(!p.board.some((s, i) => s && rayWin(p.board, i, s)), p.id);
    if (p.unitId === "conditions") {
      board[c] = 1;
      assert.deepEqual(rayWins(board, 1), fact.finishes);
      continue;
    }
    if (p.unitId === "counter") {
      board[c] = 1;
      assert.deepEqual(rayWins(board, 1), [r]);
      const blocks = [];
      for (const reply of empty(board)) {
        counterReplies++;
        board[reply] = 2;
        assert(!rayWin(board, reply, 2));
        if (!rayWins(board, 1).length) blocks.push(reply);
        if (reply === r) assert.deepEqual(rayWins(board, 2), fact.finishes);
        board[reply] = 0;
      }
      assert.deepEqual(blocks, [r]);
      continue;
    }
    if (p.unitId === "branch") {
      const accepted = [];
      for (const i of empty(board)) {
        futureBlackInputs++;
        board[i] = 1;
        if (
          exerciseSatisfied(
            board,
            { objective: "open-four", cells: pr.support },
            i,
          )
        )
          accepted.push(i);
        board[i] = 0;
      }
      assert.deepEqual(accepted, fact.predictionMoves);
      continue;
    }
    if (p.unitId === "prepare") {
      const active = new Set();
      for (const i of empty(board)) {
        futureBlackInputs++;
        board[i] = 1;
        for (const axis of exerciseFacts(
          board,
          { objective: "open-three", cells: [c] },
          i,
        )?.axes || [])
          active.add(axis);
        board[i] = 0;
      }
      assert.deepEqual([...active].sort(), fact.directions);
      continue;
    }
    if (p.unitId === "opening") {
      assert.equal(
        exerciseSatisfied(
          board,
          { objective: "two-directions", cells: pr.support },
          c,
        ),
        fact.outcome === "yes",
      );
      const nearest = Math.min(
        ...p.board.flatMap((s, i) =>
          s === 2
            ? [
                Math.max(
                  Math.abs((i % 15) - (c % 15)),
                  Math.abs(Math.floor(i / 15) - Math.floor(c / 15)),
                ),
              ]
            : [],
        ),
      );
      assert.equal(nearest === 1, p.assessmentDomain.includes("-near-"));
      continue;
    }
    const black = rayWins(board, 1),
      white = rayWins(board, 2),
      forks = [];
    if (!white.length)
      for (const i of empty(board)) {
        priorityReplies++;
        board[i] = 2;
        if (
          !rayWin(board, i, 2) &&
          rayWins(board, 2).length >= 2 &&
          !rayWins(board, 1).length
        )
          forks.push(i);
        board[i] = 0;
      }
    assert.deepEqual(black, fact.blackWins);
    assert.deepEqual(white, fact.whiteWins);
    assert.deepEqual(forks, fact.whiteForks);
    assert.equal(
      black.length ? "win" : white.length || forks.length ? "defense" : "build",
      fact.outcome,
    );
  }
  assert.equal(counterReplies, 7194);
  assert.equal(priorityReplies, 3273);
  assert.equal(futureBlackInputs, 6944);
});

test("concrete reasons, hint marks and frames match the regenerated boards", () => {
  let frames = 0;
  for (const p of reserveAssessments) {
    const pr = p.prediction,
      reason = pr.reason,
      ex = continuation(p),
      board = projected(p);
    assert(reason && pr.comparisonGroup.startsWith("generated/"));
    if (p.unitId === "branch") {
      assert.deepEqual(reason.supports, pr.support);
      for (const followup of reason.followups) {
        assert.equal(board[followup.move], 0);
        const after = [...board];
        after[followup.move] = 1;
        const required = [...pr.support, followup.move];
        const points = [
          ...new Set(
            five
              .filter(
                ({ cells }) =>
                  required.every((i) => cells.includes(i)) &&
                  cells.filter((i) => after[i] === 1).length === 4 &&
                  cells.every((i) => after[i] !== 2),
              )
              .flatMap(({ cells }) => cells.filter((i) => !after[i])),
          ),
        ].sort((a, b) => a - b);
        assert.deepEqual(followup.completions, points);
      }
    }
    if (p.unitId === "prepare") {
      for (const f of reason.followups) {
        assert.equal(board[f.move], 0);
        const after = [...board];
        after[f.move] = 1;
        assert(exerciseSatisfied(after, ex, f.move));
        for (const window of f.windows) {
          assert.equal(after[window[0]], 0);
          assert.equal(after[window[5]], 0);
          assert.equal(
            window.slice(1, 5).filter((i) => after[i] === 1).length,
            3,
          );
        }
      }
    }
    if (p.unitId === "opening") {
      assert.deepEqual(
        reason.arms.map((arm) => arm.support),
        pr.support,
      );
      for (const arm of reason.arms) {
        assert(arm.axis >= 0 && arm.axis < 4);
        for (const window of arm.windows)
          assert(
            window.length === 5 &&
              window.includes(pr.candidate) &&
              window.includes(arm.support) &&
              window.every((i) => board[i] !== 2),
          );
        assert(arm.between.every((i) => board[i] === 2));
      }
    }
    for (const window of reason.blockedWindows || [])
      assert(window.blockers.every((i) => board[i] === 2));
    for (const marks of [p.questionHighlights, ...p.hintStages])
      for (const mark of marks) {
        assert(mark.cells.every((i) => p.board[i]));
        assert(mark.points.every((i) => !p.board[i]));
      }
    for (const choice of p.nodes[0].choices)
      for (const frame of choice.frames) {
        frames++;
        assert.equal(frame.board.length, 225);
        if (frame.last !== null) assert(frame.board[frame.last]);
        for (const mark of frame.highlights) {
          assert(mark.cells.every((i) => frame.board[i]));
          assert(mark.points.every((i) => !frame.board[i]));
          if (mark.tone === "danger")
            assert(mark.cells.every((i) => frame.board[i] === 2));
        }
        assert(!/undefined|NaN|原盤|recipe|保存方式/.test(frame.text));
      }
    const result = correct(p).frames.at(-1);
    assert(result.highlights.length, p.id);
    if (p.unitId === "counter") {
      const marks = result.highlights;
      assert(marks.flatMap((h) => h.cells).includes(pr.reply));
      assert(marks.flatMap((h) => h.cells).every((i) => result.board[i] === 2));
      if (p.assessmentDomain === "counter-threat")
        assert.equal(new Set(marks.flatMap((h) => h.cells)).size, 4);
      else {
        assert(marks.every((h) => h.points.length === 0));
        assert(
          reason.supportProfiles.every(
            (profile) => profile.maximumSupport <= 2,
          ),
        );
        assert(correct(p).text.includes("最大"));
      }
    }
  }
  assert.equal(frames, 735);
});

test("branch explanations prefer a continuous four and show its actual outer blocker", () => {
  for (const p of reserveAssessments.filter((p) => p.unitId === "branch")) {
    const reason = p.prediction.reason,
      example = reason.example;
    assert(!correct(p).text.includes("指定した支持石"));
    if (!example) continue;
    const pool = reason.followups.some((item) => item.completions.length >= 2)
      ? reason.followups.filter((item) => item.completions.length >= 2)
      : reason.followups;
    const hasContinuous = pool.some((item) =>
      item.windows.some((window) => {
        const positions = [...p.prediction.support, item.move].map((i) =>
          window.indexOf(i),
        );
        return (
          positions.every((i) => i >= 0) &&
          Math.max(...positions) - Math.min(...positions) === 3
        );
      }),
    );
    if (hasContinuous) assert.equal(example.four.length, 4, p.id);
    const after = projected(p);
    after[example.move] = 1;
    assert(example.four.every((i) => after[i] === 1));
    assert.deepEqual(
      example.blockers,
      example.outer.filter((i) => after[i] === 2),
    );
    const marks = correct(p).frames.at(-1).highlights;
    assert(
      marks.some(
        (mark) => mark.tone === "focus" && mark.points.includes(example.move),
      ),
    );
  }
  const p = resolveReserveProblem(
    "gen-v5-relocate1:check-branch-v5-double-interior-gap-rebuild:w31-52",
  );
  const example = p.prediction.reason.example;
  assert.equal(coord(example.move), "H7");
  assert.deepEqual(example.four.map(coord).sort(), ["H6", "H7", "H8", "H9"]);
  assert.deepEqual(example.completions.map(coord), ["H10"]);
  assert.deepEqual(example.blockers.map(coord), ["H5"]);
  const after = projected(p);
  after[example.move] = 1;
  assert.deepEqual(rayWins(after, 1).map(coord), ["H10"]);
  after[example.blockers[0]] = 0;
  assert.deepEqual(rayWins(after, 1).map(coord), ["H10", "H5"]);
  assert(correct(p).text.includes("指定の黒石"));
  for (const clear of reserveAssessments.filter(
    (item) => item.assessmentDomain === "counter-clear",
  )) {
    const reason = clear.prediction.reason,
      sample = reason.supportExample;
    const board = [...clear.board];
    board[reason.candidate] = 1;
    board[reason.reply] = 2;
    assert.equal(
      sample.cells.length,
      1 +
        Math.max(
          ...reason.supportProfiles.map((profile) => profile.maximumSupport),
        ),
    );
    assert(sample.cells.every((i) => board[i] === 2));
    assert(
      five.some(
        (window) =>
          window.axis === sample.axis &&
          sample.cells.every((i) => window.cells.includes(i)) &&
          window.cells.every((i) => board[i] !== 1),
      ),
    );
    assert(sample.cells.every((i) => correct(clear).text.includes(coord(i))));
  }
});

test("trusted curriculum and the actual learning API agree on all 25969 legal inputs and restoration", () => {
  let inputs = 0;
  for (const p of reserveAssessments) {
    assert(
      problems.some((q) => q.id === p.id),
      `${p.id}: trusted curriculum registration missing`,
    );
    const initial = createAttempt(p.id, { attemptId: `reserve/${p.id}` });
    assert.deepEqual(restoreLearningAttempt(clone(initial)), initial);
    assert.deepEqual(
      getLearningView(initial).choices,
      p.nodes[0].choices.map(({ id, title }) => ({ id, title })),
    );
    assert.deepEqual(getLearningView(initial).highlights, p.questionHighlights);
    assert.deepEqual(getLearningView(initial).transitionFrames, []);
    assert.deepEqual(getLearningView(initial).refutationFrames, []);
    const predicted = answerLearningChoice(initial, correct(p).id),
      ex = continuation(p);
    assert(restoreLearningAttempt(clone(predicted)), p.id);
    if (!ex) {
      assert.equal(predicted.status, "solved");
      assert.equal(predicted.metrics.acceptedDecisions, 1);
      continue;
    }
    const board = projected(p),
      accepted = facts.get(p.id).accepted;
    assert.deepEqual(predicted.board, board);
    assert.deepEqual(predicted.history, ex.moves);
    assert.equal(predicted.metrics.acceptedDecisions, 1);
    assert(
      getLearningView(predicted).highlights.every(
        (mark) =>
          mark.points.length === 0 &&
          mark.cells.every(
            (i) => ex.cells.includes(i) && predicted.board[i] === 1,
          ),
      ),
    );
    const before = JSON.stringify(predicted);
    for (const i of empty(board)) {
      inputs++;
      const result = playLearningMove(predicted, i),
        good = accepted.includes(i);
      assert.equal(result.feedback.correct, good, `${p.id}/${i}`);
      assert.deepEqual(result.history, [...ex.moves, { i, side: 1 }]);
      assert.equal(result.metrics.unknownSelections, 0);
      assert.equal(result.status, good ? "solved" : "feedback");
      assert.equal(result.metrics.acceptedDecisions, good ? 2 : 1);
    }
    assert.equal(JSON.stringify(predicted), before);
    const solved = playLearningMove(predicted, accepted[0]);
    assert.deepEqual(restoreLearningAttempt(clone(solved)), solved);
    const tampered = clone(predicted);
    tampered.board[empty(tampered.board)[0]] = 1;
    assert.equal(restoreLearningAttempt(tampered), null);
  }
  assert.equal(inputs, 25969);
});

test("a wrong reserve prediction remains a failed, known attempt after retry and reload", () => {
  for (const p of reserveAssessments) {
    const initial = createAttempt(p.id, { attemptId: `wrong/${p.id}` });
    const wrong = answerLearningChoice(
      initial,
      p.nodes[0].choices.find((c) => !c.correct).id,
    );
    assert.equal(wrong.metrics.verifiedMistakes, 1);
    assert.deepEqual(wrong.history, []);
    assert.deepEqual(wrong.board, p.board);
    assert.deepEqual(
      getLearningView(wrong).board,
      correct(p).frames.at(-1).board,
    );
    const retry = retryLearning(wrong);
    assert.equal(retry.metrics.verifiedMistakes, 1);
    assert.equal(retry.metrics.retries, 1);
    assert.deepEqual(restoreLearningAttempt(clone(retry)), retry);
    const invalid = clone(initial);
    invalid.problemId += "-unregistered";
    assert.equal(restoreLearningAttempt(invalid), null);
  }
});

test("initial, retried and restored reserve views expose only givens until an explicit action", () => {
  const assertQuestionOnly = (state, problem) => {
    const view = getLearningView(state);
    assert.equal(view.hintLevel, 0);
    assert.equal(view.hintText, "");
    assert.equal(view.feedback.text, "");
    assert.deepEqual(view.transitionFrames, []);
    assert.deepEqual(view.refutationFrames, []);
    assert.deepEqual(view.highlights, problem.questionHighlights);
    for (const key of [
      "prediction",
      "guide",
      "hintStages",
      "hintTexts",
      "assessmentDomain",
    ])
      assert.equal(
        Object.hasOwn(view, key),
        false,
        `${problem.id}: private data in public view`,
      );
    for (const choice of view.choices)
      assert.deepEqual(Object.keys(choice).sort(), ["id", "title"]);
    for (const mark of view.highlights) {
      assert.equal(mark.tone, "focus");
      assert(mark.cells.every((i) => problem.board[i] === 1));
      assert(
        mark.points.every(
          (i) =>
            i === (problem.prediction.candidate ?? problem.prediction.move),
        ),
      );
    }
  };
  for (const p of reserveAssessments) {
    const initial = createAttempt(p.id, { attemptId: `explicit-help/${p.id}` });
    assertQuestionOnly(initial, p);
    assertQuestionOnly(restoreLearningAttempt(clone(initial)), p);
    const hinted = hintLearning(initial);
    assert(getLearningView(hinted).hintText);
    const restored = restoreLearningAttempt(clone(hinted));
    assertQuestionOnly(restored, p);
    assert.equal(restored.hints.uses, hinted.hints.uses);
    assert.equal(restored.hints.maxLevel, hinted.hints.maxLevel);
    const wrong = answerLearningChoice(
      hinted,
      p.nodes[0].choices.find((c) => !c.correct).id,
    );
    const retry = retryLearning(wrong);
    assertQuestionOnly(retry, p);
    assert.equal(retry.hints.uses, hinted.hints.uses);
    assert.equal(retry.metrics.verifiedMistakes, 1);
    const continued = answerLearningChoice(initial, correct(p).id);
    if (continued.status === "choose") {
      const view = getLearningView(continued);
      assert.equal(view.hintText, "");
      assert.equal(view.feedback.text, "");
      assert.deepEqual(view.refutationFrames, []);
      assert(view.highlights.every((mark) => mark.points.length === 0));
      assert(
        view.transitionFrames.every(
          (frame) =>
            frame.text === "" &&
            frame.highlights.every((mark) => mark.points.length === 0),
        ),
      );
    }
  }
});

test("the original six counter-threat failures and matching remediations lead to a fresh trusted reserve", () => {
  const at = "2026-11-12T10:00:00+09:00",
    unitId = "counter";
  function solve(p, attemptId) {
    let a = createAttempt(p.id, { attemptId });
    if (p.kind === "compare") a = answerLearningChoice(a, correct(p).id);
    for (let i = 0; a.status === "choose" && i < 25; i++)
      a = playLearningMove(a, a.guide[0]);
    assert.equal(a.status, "solved", p.id);
    assert.equal(a.metrics.verifiedMistakes, 0);
    return a;
  }
  let progress = createPathProgress();
  for (const p of problems.filter(
    (p) =>
      p.role === "assessment" && p.unitId === unitId && !p.assessmentDomain,
  )) {
    progress = recordAttemptEvidence(progress, solve(p, `base/${p.id}`), {
      ...p,
      at,
    });
    if (unitStatus(progress, unitId).baselineConfirmed) break;
  }
  assert(unitStatus(progress, unitId).baselineConfirmed);
  const authored = problems.filter(
    (p) =>
      p.role === "assessment" &&
      p.assessmentDomain === "counter-threat" &&
      p.supply !== "reserve",
  );
  assert.equal(authored.length, 6);
  const lesson = problems.find(
    (p) =>
      p.role === "lesson" && p.teachesAssessmentDomain === "counter-threat",
  );
  for (const [index, p] of authored.entries()) {
    const started = createAttempt(p.id, { attemptId: `failed/${index}` });
    progress = recordAttemptEvidence(progress, started, { ...p, at });
    const failed = answerLearningChoice(
      started,
      p.nodes[0].choices.find((c) => !c.correct).id,
    );
    progress = recordAttemptEvidence(progress, failed, { ...p, at });
    progress = recordAttemptEvidence(
      progress,
      solve(lesson, `remedy/${index}`),
      { ...lesson, at },
    );
    progress = createPathProgress(clone(progress));
  }
  const bank = problems.filter(
    (p) => p.role === "assessment" && p.assessmentDomain === "counter-threat",
  );
  const next = nextLearningStep(progress, {
    units: units.filter((u) => u.id === unitId),
    assessmentProblems: bank,
    at,
  });
  assert.equal(next.kind, "assessment");
  const reserve = resolveReserveProblem(next.problemId);
  assert(reserve && reserve.assessmentDomain === "counter-threat");
  progress = recordAttemptEvidence(
    progress,
    solve(reserve, "new-counter-proof"),
    { ...reserve, at },
  );
  progress = createPathProgress(clone(progress));
  assert(
    !unitStatus(progress, unitId).pendingAssessmentDomains.includes(
      "counter-threat",
    ),
  );
  assert(unitStatus(progress, unitId).baselineConfirmed);
});
