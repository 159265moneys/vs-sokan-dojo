import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  positionAssessments,
  positionPracticeLessons,
  positionProblemsV5,
} from "../dist/assessment-positions-v5.js";
import { problems, units } from "../dist/curriculum.js";
import { assessmentProblems } from "../dist/assessment-bank.js";
import { data as strategyDiagrams } from "../dist/strategy-diagrams.js";
import { trainingLessons, lessonBoard } from "../dist/lessons.js";
import {
  createAttempt,
  answerLearningChoice,
  playLearningMove,
  getLearningView,
  retryLearning,
  restoreLearningAttempt,
} from "../dist/learning.js";

// Independent finite oracle. No game/learning/shared-exercise predicate and no
// authored guide participates in the geometric classification below.
const five = [],
  six = [];
const directions = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
for (let y = 0; y < 15; y++)
  for (let x = 0; x < 15; x++)
    for (const [axis, [dx, dy]] of directions.entries())
      for (const length of [5, 6]) {
        const ex = x + (length - 1) * dx,
          ey = y + (length - 1) * dy;
        if (ex < 0 || ex >= 15 || ey < 0 || ey >= 15) continue;
        (length === 5 ? five : six).push({
          axis,
          cells: Array.from(
            { length },
            (_, k) => (y + k * dy) * 15 + x + k * dx,
          ),
        });
      }
const at = (name) =>
  (15 - Number(name.slice(1))) * 15 + name.charCodeAt(0) - 65;
const nameOf = (i) =>
  `${String.fromCharCode(65 + (i % 15))}${15 - Math.floor(i / 15)}`;
const sorted = (values) => [...values].sort((a, b) => a - b);
const empty = (board) => board.flatMap((stone, i) => (stone ? [] : [i]));
const occupied = (board, side) =>
  board.flatMap((stone, i) => (stone === side ? [i] : []));
const won = (board, side) =>
  five.some(({ cells }) => cells.every((i) => board[i] === side));
const wins = (board, side) =>
  sorted(
    new Set(
      five
        .filter(
          ({ cells }) =>
            cells.filter((i) => board[i] === side).length === 4 &&
            cells.every((i) => board[i] !== 3 - side),
        )
        .flatMap(({ cells }) => cells.filter((i) => board[i] === 0)),
    ),
  );
function placed(board, i, side) {
  assert(Number.isInteger(i) && i >= 0 && i < 225);
  assert.equal(board[i], 0, `occupied point ${i}`);
  assert(!won(board, 1) && !won(board, 2), "move after terminal position");
  const after = [...board];
  after[i] = side;
  return after;
}
const threeWindows = (board, required) =>
  six.filter(
    ({ cells }) =>
      !board[cells[0]] &&
      !board[cells[5]] &&
      required.every((i) => cells.slice(1, 5).includes(i)) &&
      cells.slice(1, 5).every((i) => board[i] !== 2) &&
      cells.slice(1, 5).filter((i) => board[i] === 1).length === 3,
  );
function connected(board, placed, supports) {
  const windows = five.filter(
    ({ cells }) =>
      cells.includes(placed) &&
      cells.every((i) => board[i] !== 2) &&
      supports.some((i) => i !== placed && cells.includes(i)),
  );
  return windows.some((a) =>
    windows.some(
      (b) =>
        a.axis !== b.axis &&
        supports.every((i) => a.cells.includes(i) || b.cells.includes(i)),
    ),
  );
}
function forks(board, side) {
  return empty(board).filter((i) => {
    const after = placed(board, i, side);
    return (
      !won(after, side) &&
      wins(after, side).length >= 2 &&
      !wins(after, 3 - side).length
    );
  });
}
function objectiveSatisfied(board, i, exercise) {
  const after = placed(board, i, 1),
    required = [...exercise.cells, i];
  if (exercise.objective === "five") return won(after, 1);
  if (won(after, 1)) return true;
  if (wins(after, 2).length) return false;
  if (exercise.objective === "open-four")
    return (
      new Set(
        five
          .filter(
            ({ cells }) =>
              required.every((i) => cells.includes(i)) &&
              cells.every((i) => after[i] !== 2) &&
              cells.filter((i) => after[i] === 1).length === 4,
          )
          .flatMap(({ cells }) => cells.filter((i) => after[i] === 0)),
      ).size >= 2
    );
  if (exercise.objective === "two-directions")
    return connected(after, i, exercise.cells);
  if (exercise.objective === "open-three")
    return threeWindows(after, required).length > 0;
  if (exercise.objective === "prevent-fork") return !forks(after, 2).length;
  assert.fail(`unsupported objective ${exercise.objective}`);
}
const correct = (p) => p.nodes[0].choices.find((choice) => choice.correct);
const continuation = (p) => correct(p).continuations[0];
function projected(p) {
  return continuation(p).moves.reduce(
    (board, move) => placed(board, move.i, move.side),
    [...p.board],
  );
}
function predictionOutcome(p) {
  const board = projected(p),
    prediction = p.prediction;
  if (p.unitId === "branch")
    return empty(board).some((i) =>
      objectiveSatisfied(board, i, {
        objective: "open-four",
        cells: prediction.support,
      }),
    )
      ? "yes"
      : "no";
  if (p.unitId === "prepare") {
    const axes = new Set(
      empty(board).flatMap((i) =>
        threeWindows(placed(board, i, 1), [prediction.candidate]).map(
          ({ axis }) => axis,
        ),
      ),
    );
    return ["none", "one", "two"][axes.size];
  }
  if (p.unitId === "opening")
    return connected(board, prediction.candidate, prediction.support)
      ? "yes"
      : "no";
  if (wins(board, 1).length) return "win";
  if (wins(board, 2).length || forks(board, 2).length) return "defense";
  return "build";
}
const oracle = new Map(
  positionProblemsV5.map((p) => {
    const board = projected(p),
      exercise = continuation(p);
    return [
      p.id,
      {
        board,
        legal: empty(board),
        accepted: empty(board).filter((i) =>
          objectiveSatisfied(board, i, exercise),
        ),
        outcome: predictionOutcome(p),
      },
    ];
  }),
);

test("authored positions provide 26 assessments and twelve distinct remedial lessons", () => {
  assert.equal(positionAssessments.length, 26);
  assert.equal(positionPracticeLessons.length, 12);
  assert.equal(new Set(positionProblemsV5.map((p) => p.id)).size, 38);
  const counts = {
    "branch-ready": 3,
    "branch-rebuild": 3,
    "prepare-two": 3,
    "prepare-one": 3,
    "opening-near-ready": 2,
    "opening-near-blocked": 2,
    "opening-far-ready": 2,
    "opening-far-blocked": 2,
    "practical-win": 2,
    "practical-defense": 2,
    "practical-build": 2,
  };
  for (const [domain, count] of Object.entries(counts)) {
    assert.equal(
      positionAssessments.filter((p) => p.assessmentDomain === domain).length,
      count,
      domain,
    );
    assert(
      positionPracticeLessons.some((p) => p.teachesAssessmentDomain === domain),
      domain,
    );
  }
  for (const p of positionProblemsV5) {
    assert.equal(p.kind, "compare");
    assert.equal(p.judge.kind, "compare");
    assert.equal(p.completion, "local-goal");
    assert.equal(p.requiresBranch, false);
    assert.equal(p.unitId, p.skillId);
    assert.notEqual(p.unitId, "practical");
    assert.equal(p.sideToMove, 1);
    assert(
      p.family && p.branchId && p.evidence.scope && p.evidence.verification,
    );
    assert.equal(p.evidence.source, "original");
    assert(
      Object.isFrozen(p) &&
        Object.isFrozen(p.board) &&
        Object.isFrozen(p.nodes),
    );
    assert.equal(p.nodes[0].choices.filter((c) => c.correct).length, 1);
    assert(
      p.nodes[0].choices
        .filter((c) => !c.correct)
        .every((c) => !c.continuations),
    );
    assert.equal(correct(p).continuations.length, 1);
    const exercise = continuation(p);
    for (const field of ["moves", "cells", "objective", "title"])
      assert(Object.hasOwn(exercise, field), `${p.id}/${field}`);
    if (p.role === "lesson") {
      assert(p.teachesAssessmentDomain);
      assert.equal(p.assessmentDomain, undefined);
    } else {
      assert.equal(p.role, "assessment");
      assert(p.assessmentDomain);
      assert.equal(p.teachesAssessmentDomain, undefined);
    }
  }
});

test("authored starts, prefixes, prediction outcomes and all 8280 finite continuations match the independent oracle", () => {
  let decisions = 0;
  for (const p of positionProblemsV5) {
    const black = occupied(p.board, 1),
      white = occupied(p.board, 2),
      checked = oracle.get(p.id);
    assert.equal(p.board.length, 225);
    assert(p.board.every((side) => [0, 1, 2].includes(side)));
    assert.equal(black.length, white.length, p.id);
    assert(!won(p.board, 1) && !won(p.board, 2), p.id);
    let replay = Array(225).fill(0);
    for (let k = 0; k < black.length; k++) {
      replay = placed(replay, black[k], 1);
      replay = placed(replay, white[k], 2);
    }
    assert.deepEqual(replay, p.board);
    assert.equal(p.prediction.outcome, checked.outcome, p.id);
    for (const choice of p.nodes[0].choices)
      assert.equal(
        choice.correct,
        choice.id === checked.outcome,
        `${p.id}/${choice.id}`,
      );
    assert.deepEqual(sorted(p.guide), sorted(checked.accepted), p.id);
    assert(checked.accepted.length, p.id);
    decisions += checked.legal.length;
    if (p.unitId !== "practice") {
      assert.deepEqual(continuation(p).moves, [
        { i: p.prediction.candidate, side: 1 },
        { i: p.prediction.reply, side: 2 },
      ]);
      for (const board of [p.board, checked.board]) {
        assert.deepEqual(wins(board, 1), [], p.id);
        assert.deepEqual(wins(board, 2), [], p.id);
      }
    } else assert.deepEqual(continuation(p).moves, []);
    if (p.unitId === "prepare") {
      const afterCandidate = placed(p.board, p.prediction.candidate, 1);
      assert.equal(
        threeWindows(afterCandidate, [p.prediction.candidate]).length,
        0,
        `${p.id}: preparation already makes three`,
      );
      assert.deepEqual(wins(afterCandidate, 1), [], p.id);
    }
    if (p.unitId === "practice" && checked.outcome === "build") {
      for (const side of [1, 2]) {
        assert.deepEqual(wins(p.board, side), [], p.id);
        assert.deepEqual(forks(p.board, side), [], p.id);
      }
    }
  }
  assert.equal(decisions, 8280);
});

test("contrast pairs have identical prompts and givens; both white-distance groups contain positive and negative cases", () => {
  const groups = Map.groupBy(
    positionProblemsV5.filter((p) => p.unitId !== "practice"),
    (p) => p.prediction.comparisonGroup,
  );
  for (const group of groups.values()) {
    if (group.length === 1) continue;
    assert.equal(group.length, 2);
    const [a, b] = group;
    assert.equal(a.family, b.family);
    assert.equal(a.title, b.title);
    assert.equal(a.goal, b.goal);
    assert.deepEqual(a.questionHighlights, b.questionHighlights);
    assert.deepEqual(
      a.nodes[0].choices.map(({ id, title }) => ({ id, title })),
      b.nodes[0].choices.map(({ id, title }) => ({ id, title })),
    );
    assert.deepEqual(occupied(a.board, 1), occupied(b.board, 1));
    const changes = a.board.flatMap((side, i) =>
      side !== b.board[i] ? [i] : [],
    );
    assert.equal(changes.length, 2, a.id);
    assert(changes.every((i) => a.board[i] !== 1 && b.board[i] !== 1));
    assert.notEqual(a.prediction.outcome, b.prediction.outcome);
  }
  for (const distance of ["near", "far"]) {
    const group = positionAssessments.filter((p) =>
      p.assessmentDomain.startsWith(`opening-${distance}-`),
    );
    assert.deepEqual(
      new Set(group.map((p) => p.prediction.outcome)),
      new Set(["yes", "no"]),
    );
  }
  for (const p of positionProblemsV5) {
    const given = p.questionHighlights;
    if (p.unitId === "practice") assert.deepEqual(given, []);
    else {
      assert.equal(given.length, 1);
      assert.deepEqual(given[0].points, [p.prediction.candidate]);
      assert(
        given[0].cells.every(
          (i) => p.board[i] === 1 && p.prediction.support.includes(i),
        ),
      );
      assert.equal(p.board[p.prediction.candidate], 0);
    }
    if (p.unitId === "opening") {
      const c = p.prediction.candidate;
      const distance = Math.min(
        ...occupied(p.board, 2).map((i) =>
          Math.max(
            Math.abs((i % 15) - (c % 15)),
            Math.abs(Math.floor(i / 15) - Math.floor(c / 15)),
          ),
        ),
      );
      assert.equal(p.prediction.whiteDistance, distance === 1 ? "near" : "far");
    }
    let board = [...p.board];
    for (const [index, move] of continuation(p).moves.entries()) {
      board = placed(board, move.i, move.side);
      const frame = correct(p).frames[index];
      assert.deepEqual(frame.board, board);
      assert.equal(frame.last, move.i);
      assert.equal(frame.text, "");
      assert.deepEqual(frame.highlights, [
        { cells: [move.i], points: [], tone: "focus" },
      ]);
    }
    assert.equal(correct(p).frames.at(-1).last, null);
    assert.deepEqual(correct(p).frames.at(-1).board, oracle.get(p.id).board);
  }
  const mixed = positionProblemsV5.filter((p) => p.unitId === "practice");
  assert.equal(new Set(mixed.map((p) => p.title)).size, 1);
  assert.equal(new Set(mixed.map((p) => p.goal)).size, 1);
  for (const p of mixed)
    assert.deepEqual(
      p.nodes[0].choices.map(({ id, title }) => ({ id, title })),
      mixed[0].nodes[0].choices.map(({ id, title }) => ({ id, title })),
    );
});

function fingerprint(board) {
  const stones = board.flatMap((side, i) =>
    side ? [[i % 15, Math.floor(i / 15), side]] : [],
  );
  if (!stones.length) return "empty";
  return Array.from({ length: 8 }, (_, transform) => {
    const transformed = stones.map(([x, y, side]) => {
      if (transform & 4) [x, y] = [y, x];
      return [transform & 1 ? -x : x, transform & 2 ? -y : y, side];
    });
    const minX = Math.min(...transformed.map(([x]) => x)),
      minY = Math.min(...transformed.map(([, y]) => y));
    return transformed
      .map(([x, y, side]) => `${x - minX},${y - minY},${side}`)
      .sort()
      .join(";");
  }).sort()[0];
}
test("new starts and lesson continuations do not reuse existing static boards under D4 and translation", () => {
  const known = new Map(),
    ids = new Set(positionProblemsV5.map((p) => p.id));
  function addTree(value, source) {
    if (!value || typeof value !== "object" || ids.has(value.id)) return;
    if (
      (Array.isArray(value) || ArrayBuffer.isView(value)) &&
      value.length === 225 &&
      [...value].every((v) => [0, 1, 2].includes(v))
    ) {
      known.set(fingerprint([...value]), source);
      return;
    }
    for (const [key, child] of Object.entries(value))
      addTree(child, `${source}/${key}`);
  }
  addTree(problems, "curriculum");
  addTree(units, "units");
  addTree(assessmentProblems, "assessment-bank");
  addTree(strategyDiagrams, "strategy-diagrams");
  for (const lesson of trainingLessons)
    for (let step = 0; step <= lesson.steps.length; step++)
      addTree(lessonBoard(lesson, step), `lesson/${lesson.id}/${step}`);
  for (const course of JSON.parse(
    readFileSync(
      new URL("../dist/expert-courses.json", import.meta.url),
      "utf8",
    ),
  ).courses) {
    const board = Array(225).fill(0);
    addTree(board, `course/${course.id}/0`);
    for (const [k, move] of course.moves.entries()) {
      board[typeof move === "number" ? move : move.i] = (k % 2) + 1;
      addTree(board, `course/${course.id}/${k + 1}`);
    }
  }
  const authored = new Map();
  for (const p of positionProblemsV5) {
    const key = fingerprint(p.board);
    assert(!known.has(key), `${p.id}: reused ${known.get(key)}`);
    assert(!authored.has(key), `${p.id}: reused ${authored.get(key)}`);
    authored.set(key, p.id);
  }
  for (const p of positionProblemsV5) {
    const checked = oracle.get(p.id);
    const frames = [
      checked.board,
      ...checked.accepted.map((i) => placed(checked.board, i, 1)),
    ];
    for (const board of frames) {
      const other = authored.get(fingerprint(board));
      assert(
        !other || other === p.id,
        `${p.id}: exposes another new start ${other}`,
      );
    }
  }
});

test("actual API agrees with every one of the 8280 legal continuations and counts only the learner's last black move", () => {
  let decisions = 0;
  for (const p of positionProblemsV5) {
    assert(
      problems.some((q) => q.id === p.id),
      `${p.id}: curriculum registration missing`,
    );
    const initial = createAttempt(p.id),
      checked = oracle.get(p.id),
      prefix = continuation(p).moves;
    assert.deepEqual(initial.history, []);
    assert.deepEqual(getLearningView(initial).highlights, p.questionHighlights);
    assert.deepEqual(
      getLearningView(initial).choices,
      p.nodes[0].choices.map(({ id, title }) => ({ id, title })),
    );
    assert.deepEqual(getLearningView(initial).transitionFrames, []);
    assert.deepEqual(getLearningView(initial).refutationFrames, []);
    assert.strictEqual(
      playLearningMove(initial, checked.legal[0]),
      initial,
      p.id,
    );
    const predicted = answerLearningChoice(initial, checked.outcome);
    assert.equal(predicted.status, "choose");
    assert.equal(predicted.metrics.acceptedDecisions, 1);
    assert.deepEqual(predicted.board, checked.board);
    assert.deepEqual(predicted.history, prefix);
    assert.deepEqual(predicted.exercise, continuation(p));
    assert.deepEqual(sorted(predicted.guide), sorted(checked.accepted));
    assert.equal(getLearningView(predicted).input, "board");
    assert(
      getLearningView(predicted).highlights.every(
        (mark) =>
          mark.points.length === 0 &&
          mark.cells.every(
            (i) =>
              predicted.exercise.cells.includes(i) && predicted.board[i] === 1,
          ),
      ),
      `${p.id}: continuation may show its given support stones, never future empty points`,
    );
    if (prefix.length)
      assert.deepEqual(
        predicted.transitionFrames,
        correct(p).frames.slice(0, prefix.length),
      );
    else if (p.role === "assessment")
      assert.deepEqual(predicted.transitionFrames, []);
    const restored = restoreLearningAttempt(
      JSON.parse(JSON.stringify(predicted)),
    );
    assert(restored, p.id);
    assert.deepEqual(restored.board, checked.board);
    assert.deepEqual(restored.history, prefix);
    assert.deepEqual(sorted(restored.guide), sorted(checked.accepted));
    const snapshot = JSON.stringify(predicted);
    for (const i of checked.legal) {
      decisions++;
      const expected = checked.accepted.includes(i),
        result = playLearningMove(predicted, i);
      assert.equal(result.feedback.correct, expected, `${p.id}/${i}`);
      assert.deepEqual(result.history, [...prefix, { i, side: 1 }]);
      assert.equal(result.metrics.unknownSelections, 0, `${p.id}/${i}`);
      if (expected) {
        assert.equal(result.status, "solved");
        assert.equal(result.metrics.acceptedDecisions, 2);
        assert.equal(result.metrics.verifiedMistakes, 0);
        assert.deepEqual(
          result.transitionFrames.at(-1).board,
          placed(checked.board, i, 1),
        );
        assert.equal(result.transitionFrames.at(-1).last, i);
        assert.deepEqual(
          getLearningView(result).board,
          placed(checked.board, i, 1),
        );
      } else {
        assert.equal(result.status, "feedback");
        assert.equal(result.metrics.verifiedMistakes, 1);
      }
    }
    assert.equal(JSON.stringify(predicted), snapshot, p.id);
  }
  assert.equal(decisions, 8280);
});

test("wrong predictions and wrong continuations retry from their own checkpoints without erasing failure", () => {
  for (const p of positionProblemsV5) {
    const checked = oracle.get(p.id);
    for (const choice of p.nodes[0].choices.filter((c) => !c.correct)) {
      const wrong = answerLearningChoice(createAttempt(p.id), choice.id),
        retry = retryLearning(wrong);
      assert.equal(wrong.status, "feedback");
      assert.equal(wrong.metrics.verifiedMistakes, 1);
      assert.deepEqual(wrong.history, []);
      assert.deepEqual(wrong.board, p.board);
      assert.equal(retry.status, "choose");
      assert.equal(retry.exercise, null);
      assert.equal(retry.metrics.verifiedMistakes, 1);
      assert.equal(retry.metrics.retries, 1);
      assert.deepEqual(retry.history, []);
    }
    const predicted = answerLearningChoice(
        createAttempt(p.id),
        checked.outcome,
      ),
      wrongPoint = checked.legal.find((i) => !checked.accepted.includes(i)),
      wrong = playLearningMove(predicted, wrongPoint),
      retry = retryLearning(wrong),
      success = playLearningMove(retry, checked.accepted[0]);
    assert.deepEqual(retry.board, checked.board);
    assert.deepEqual(retry.history, continuation(p).moves);
    assert.deepEqual(retry.exercise, continuation(p));
    assert.equal(success.status, "solved");
    assert.equal(success.metrics.verifiedMistakes, 1);
    assert.equal(success.metrics.retries, 1);
    assert.deepEqual(success.history, [
      ...continuation(p).moves,
      { i: checked.accepted[0], side: 1 },
    ]);
    const restored = restoreLearningAttempt(
      JSON.parse(JSON.stringify(success)),
    );
    assert(restored, p.id);
    assert.equal(restored.metrics.verifiedMistakes, 1);
    assert.equal(restored.metrics.retries, 1);
  }
});

test("mixed defense includes a real pre-fork and accepts both outside blocks", () => {
  const p = positionAssessments.find(
    (p) => p.family === "practice/pre-fork-defense",
  );
  assert(p);
  assert.deepEqual(wins(p.board, 1), []);
  assert.deepEqual(wins(p.board, 2), []);
  assert.deepEqual(forks(p.board, 2), [at("G11")]);
  assert.deepEqual(
    wins(placed(p.board, at("G11"), 2), 2),
    sorted([at("D11"), at("I11")]),
  );
  assert.deepEqual(
    sorted(oracle.get(p.id).accepted),
    sorted([at("D11"), at("G11"), at("I11")]),
  );
});

test("restoration rejects a legal replacement of the authored white prefix move", () => {
  for (const p of positionProblemsV5.filter(
    (p) => continuation(p).moves.length,
  )) {
    const raw = JSON.parse(
      JSON.stringify(
        answerLearningChoice(createAttempt(p.id), p.prediction.outcome),
      ),
    );
    const originalWhite = raw.history[1].i;
    const replacement = empty(raw.board).find((i) => i !== originalWhite);
    raw.history[1].i = replacement;
    raw.board[originalWhite] = 0;
    raw.board[replacement] = 2;
    raw.checkpoint.board = [...raw.board];
    raw.checkpoint.history = JSON.parse(JSON.stringify(raw.history));
    // The alternate history is a legal board and checkpoint, but it is not the
    // move that was specified in the question or in the approved continuation.
    assert.equal(restoreLearningAttempt(raw) === null, true, p.id);
  }
});

test("causal result frames name real moves, completion points and blocking whites without inventing a winning shape", () => {
  const mentions = (text, i) =>
    assert(
      new RegExp(`(?:^|[^A-O0-9])${nameOf(i)}(?![0-9])`).test(text),
      `missing ${nameOf(i)} in ${text}`,
    );
  const winningStones = (board, side, completions) =>
    sorted(
      new Set(
        five
          .filter(
            ({ cells }) =>
              cells.some((i) => completions.includes(i)) &&
              cells.filter((i) => board[i] === side).length === 4 &&
              cells.every((i) => board[i] !== 3 - side),
          )
          .flatMap(({ cells }) => cells.filter((i) => board[i] === side)),
      ),
    );
  const axisOf = (a, b) =>
    directions.findIndex(
      ([dx, dy]) =>
        ((b % 15) - (a % 15)) * dy ===
        (Math.floor(b / 15) - Math.floor(a / 15)) * dx,
    );
  function inspectArms(board, origin, arms, text, includeAll) {
    for (const arm of arms) {
      assert.equal(arm.axis, axisOf(origin, arm.support));
      const distance = Math.max(
          Math.abs((origin % 15) - (arm.support % 15)),
          Math.abs(Math.floor(origin / 15) - Math.floor(arm.support / 15)),
        ),
        dx = Math.sign((arm.support % 15) - (origin % 15)),
        dy = Math.sign(Math.floor(arm.support / 15) - Math.floor(origin / 15)),
        between = Array.from(
          { length: distance - 1 },
          (_, k) => origin + (k + 1) * (15 * dy + dx),
        ).filter((i) => board[i] === 2),
        possible = five.filter(
          (w) =>
            w.axis === arm.axis &&
            w.cells.includes(origin) &&
            w.cells.includes(arm.support) &&
            w.cells.every((i) => board[i] !== 2),
        );
      assert.deepEqual(sorted(arm.between), sorted(between));
      assert.equal(arm.window.length > 0, possible.length > 0);
      assert(arm.segment.includes(origin));
      assert(arm.segment.every((i) => board[i] !== 2));
      assert(arm.blockers.every((i) => board[i] === 2));
      if (arm.window.length) {
        assert(
          possible.some(
            (w) => JSON.stringify(w.cells) === JSON.stringify(arm.window),
          ),
        );
        assert.deepEqual(arm.blockers, []);
        if (includeAll) {
          mentions(text, arm.support);
          mentions(text, arm.window[0]);
          mentions(text, arm.window.at(-1));
        }
      } else {
        mentions(text, arm.support);
        for (const i of arm.blockers) mentions(text, i);
        if (between.length)
          assert.deepEqual(sorted(arm.blockers), sorted(between));
        else {
          assert(arm.segment.includes(arm.support));
          assert(arm.segment.length < 5);
          mentions(text, arm.segment[0]);
          mentions(text, arm.segment.at(-1));
          assert(text.includes(`${arm.segment.length}点`));
        }
      }
    }
  }
  for (const p of positionProblemsV5) {
    const board = oracle.get(p.id).board,
      reason = p.prediction.reason,
      frame = correct(p).frames.at(-1),
      text = frame.text;
    assert(reason && text.length > 10, p.id);
    assert.deepEqual(frame.board, board);
    assert.equal(frame.last, null);
    assert(!/必勝|唯一|最善|勝ち筋(?:は|が)?ない/.test(text), p.id);
    assert(p.nodes[0].choices.every((choice) => choice.text === text));
    for (const choice of p.nodes[0].choices.filter(
      (choice) => !choice.correct,
    )) {
      const wrong = answerLearningChoice(createAttempt(p.id), choice.id);
      assert.equal(wrong.metrics.verifiedMistakes, 1);
      assert.deepEqual(
        wrong.refutationFrames.at(-1),
        frame,
        `${p.id}: an incorrect prediction must explain the concrete cause`,
      );
    }
    assert(frame.highlights.length, p.id);
    for (const h of frame.highlights) {
      assert(
        h.cells.every((i) => board[i] !== 0),
        `${p.id}: a hypothetical stone is highlighted as real`,
      );
      assert(
        h.points.every((i) => board[i] === 0),
        `${p.id}: a blocked point is marked empty`,
      );
      if (h.tone === "danger")
        assert(
          h.cells.every((i) => board[i] === 2),
          p.id,
        );
      if (h.tone === "good")
        assert(
          h.cells.every((i) => board[i] === 1),
          p.id,
        );
    }
    if (reason.kind === "four-after-followup") {
      const after = placed(board, reason.move, 1),
        [dx, dy] = directions[reason.axis];
      assert.equal(reason.four.length, 4);
      assert(reason.four.includes(reason.move));
      assert(p.prediction.support.every((i) => reason.four.includes(i)));
      assert(
        reason.four.every(
          (i, k) => after[i] === 1 && i === reason.four[0] + k * (15 * dy + dx),
        ),
      );
      assert.deepEqual(reason.completions, wins(after, 1));
      const ends = [
        [(reason.four[0] % 15) - dx, Math.floor(reason.four[0] / 15) - dy],
        [
          (reason.four.at(-1) % 15) + dx,
          Math.floor(reason.four.at(-1) / 15) + dy,
        ],
      ];
      const blockers = ends
        .filter(([x, y]) => x >= 0 && x < 15 && y >= 0 && y < 15)
        .map(([x, y]) => y * 15 + x)
        .filter((i) => board[i] === 2);
      assert.deepEqual(sorted(reason.blockers), sorted(blockers));
      assert.equal(
        reason.completions.length >= 2,
        p.prediction.outcome === "yes",
      );
      for (const i of [reason.move, ...reason.completions, ...reason.blockers])
        mentions(text, i);
      assert.deepEqual(
        sorted(
          frame.highlights
            .filter((h) => h.tone === "good")
            .flatMap((h) => h.points),
        ),
        sorted(reason.completions),
      );
    } else if (reason.kind === "followup-arms") {
      assert.equal(reason.arms.length, 2);
      for (const arm of reason.arms) {
        const moves = empty(board).filter(
          (i) => threeWindows(placed(board, i, 1), arm.cells).length,
        );
        assert.deepEqual(sorted(arm.moves), sorted(moves));
        assert.equal(arm.axis, axisOf(...arm.cells));
        const blockers = moves.length
          ? []
          : sorted(
              new Set(
                six
                  .filter(({ cells }) =>
                    arm.cells.every((i) => cells.slice(1, 5).includes(i)),
                  )
                  .flatMap(({ cells }) => cells.filter((i) => board[i] === 2)),
              ),
            );
        assert.deepEqual(sorted(arm.blockers), blockers);
        for (const i of [...arm.cells, ...arm.moves, ...arm.blockers])
          mentions(text, i);
        if (!moves.length) {
          assert(blockers.length, `${p.id}: missing concrete blocker`);
          const cleared = [...board];
          for (const i of blockers) cleared[i] = 0;
          assert(
            empty(cleared).some(
              (i) => threeWindows(placed(cleared, i, 1), arm.cells).length,
            ),
            `${p.id}: removing the claimed blockers does not restore the arm`,
          );
        }
      }
    } else if (reason.kind === "connection") {
      assert.equal(reason.origin, p.prediction.candidate);
      inspectArms(
        board,
        reason.origin,
        reason.arms,
        text,
        p.prediction.outcome === "yes",
      );
      assert(
        frame.highlights.every(
          (h) => h.tone !== "good" && h.points.length === 0,
        ),
        `${p.id}: geometry must not glow as a completed winning shape`,
      );
      assert.deepEqual(
        sorted(
          frame.highlights
            .filter((h) => h.tone === "focus")
            .flatMap((h) => h.cells),
        ),
        sorted([...p.prediction.support, reason.origin]),
      );
    } else if (reason.kind === "immediate-win") {
      assert.deepEqual(reason.points, wins(board, 1));
      assert.deepEqual(reason.stones, winningStones(board, 1, reason.points));
      assert.deepEqual(reason.whitePoints, wins(board, 2));
      assert.deepEqual(
        reason.whiteStones,
        winningStones(board, 2, reason.whitePoints),
      );
      for (const i of [...reason.points, ...reason.whitePoints])
        mentions(text, i);
    } else if (reason.kind === "immediate-defense") {
      assert.deepEqual(wins(board, 1), []);
      assert.deepEqual(reason.points, wins(board, 2));
      assert.deepEqual(reason.stones, winningStones(board, 2, reason.points));
      assert.deepEqual(
        sorted(reason.defenses),
        sorted(oracle.get(p.id).accepted),
      );
      for (const i of [...reason.points, ...reason.defenses]) mentions(text, i);
    } else if (reason.kind === "pre-fork-defense") {
      assert.deepEqual(
        sorted(reason.threats.map((threat) => threat.move)),
        sorted(forks(board, 2)),
      );
      assert.deepEqual(
        sorted(reason.defenses),
        sorted(oracle.get(p.id).accepted),
      );
      for (const threat of reason.threats) {
        const after = placed(board, threat.move, 2);
        assert.deepEqual(threat.completions, wins(after, 2));
        assert.deepEqual(
          threat.stones,
          winningStones(after, 2, threat.completions),
        );
        for (const i of [threat.move, ...threat.completions]) mentions(text, i);
      }
      for (const i of reason.defenses) mentions(text, i);
    } else if (reason.kind === "quiet-connection") {
      assert(oracle.get(p.id).accepted.includes(reason.move));
      inspectArms(
        placed(board, reason.move, 1),
        reason.move,
        reason.arms,
        text,
        true,
      );
      assert(frame.highlights.every((h) => h.tone === "focus"));
      assert.deepEqual(
        frame.highlights.flatMap((h) => h.points),
        [reason.move],
      );
      assert.deepEqual(
        sorted(frame.highlights.flatMap((h) => h.cells)),
        sorted(continuation(p).cells),
      );
      mentions(text, reason.move);
    } else assert.fail(`unknown causal reason ${reason.kind}`);
  }
});
