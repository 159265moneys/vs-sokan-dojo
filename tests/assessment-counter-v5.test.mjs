import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  counterAssessmentProblems,
  counterPracticeProblems,
  counterProblemsV5,
} from "../dist/assessment-counter-v5.js";
import { problems } from "../dist/curriculum.js";
import { assessmentProblems } from "../dist/assessment-bank.js";
import { data as strategyDiagrams } from "../dist/strategy-diagrams.js";
import { trainingLessons, lessonBoard } from "../dist/lessons.js";
import {
  createAttempt,
  answerLearningChoice,
  playLearningMove,
  retryLearning,
  restoreLearningAttempt,
  getLearningView,
} from "../dist/learning.js";

// Independent from game.js and learning.js: enumerate every five-cell window,
// then test the exact finite objective, including every legal white reply.
const windows = [];
for (let row = 0; row < 15; row++)
  for (let col = 0; col < 15; col++)
    for (const [dx, dy] of [
      [1, 0],
      [0, 1],
      [1, 1],
      [1, -1],
    ]) {
      const endX = col + dx * 4,
        endY = row + dy * 4;
      if (endX < 0 || endX >= 15 || endY < 0 || endY >= 15) continue;
      windows.push(
        Array.from({ length: 5 }, (_, k) => (row + dy * k) * 15 + col + dx * k),
      );
    }
const empty = (board) => board.flatMap((stone, i) => (stone ? [] : [i]));
const won = (board, side) =>
  windows.some((line) => line.every((i) => board[i] === side));
const wins = (board, side) =>
  [
    ...new Set(
      windows.flatMap((line) =>
        line.every((i) => board[i] === 0 || board[i] === side) &&
        line.filter((i) => board[i] === side).length === 4
          ? line.filter((i) => !board[i])
          : [],
      ),
    ),
  ].sort((a, b) => a - b);
const placed = (board, i, side) => {
  assert.equal(board[i], 0, `occupied point ${i}`);
  const after = [...board];
  after[i] = side;
  return after;
};
function safeFour(board, i) {
  const after = placed(board, i, 1);
  if (won(after, 1)) return true;
  if (!wins(after, 1).length || wins(after, 2).length) return false;
  for (const reply of empty(after)) {
    const defended = placed(after, reply, 2);
    if (
      !wins(defended, 1).length &&
      (won(defended, 2) || wins(defended, 2).length)
    )
      return false;
  }
  return true;
}
const sorted = (values) => [...values].sort((a, b) => a - b);
function fingerprint(board) {
  const stones = board.flatMap((side, i) =>
    side ? [[i % 15, Math.floor(i / 15), side]] : [],
  );
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

test("12 counter assessments and two lesson boards have balanced contrast domains without prompt leakage", () => {
  assert.equal(counterAssessmentProblems.length, 12);
  assert.equal(counterPracticeProblems.length, 2);
  assert.equal(new Set(counterProblemsV5.map((p) => p.id)).size, 14);
  const first = counterProblemsV5[0],
    labels = first.nodes[0].choices.map(({ id, title }) => ({ id, title }));
  for (const domain of ["counter-threat", "counter-clear"]) {
    const group = counterAssessmentProblems.filter(
      (p) => p.assessmentDomain === domain,
    );
    assert.equal(group.length, 6);
    assert.equal(new Set(group.map((p) => p.family)).size, 6);
  }
  for (const p of counterProblemsV5) {
    assert.equal(
      p.role,
      counterAssessmentProblems.includes(p) ? "assessment" : "lesson",
    );
    assert.equal(p.unitId, "counter");
    assert.equal(p.skillId, "counter");
    assert.equal(p.requiresBranch, false);
    assert.equal(p.kind, "compare");
    assert.equal(p.board.length, 225);
    assert.equal(p.sideToMove, 1);
    assert(p.board.every((v) => v === 0 || v === 1 || v === 2));
    assert.equal(
      p.board.filter((v) => v === 1).length,
      p.board.filter((v) => v === 2).length,
    );
    assert.equal(won(p.board, 1) || won(p.board, 2), false, p.id);
    assert.deepEqual(wins(p.board, 1), [], p.id);
    assert.deepEqual(wins(p.board, 2), [], p.id);
    assert.equal(p.title, first.title);
    assert.equal(p.goal, first.goal);
    assert.deepEqual(
      p.nodes[0].choices.map(({ id, title }) => ({ id, title })),
      labels,
    );
    assert.deepEqual(p.questionHighlights, [
      { cells: [], points: [p.prediction.candidate], tone: "focus" },
    ]);
    const correct = p.nodes[0].choices.filter((choice) => choice.correct);
    assert.equal(correct.length, 1);
    assert.equal(correct[0].id, p.prediction.outcome);
    assert.deepEqual(correct[0].continuations, [
      {
        moves: [],
        cells: [],
        objective: "safe-four",
        title: "元の盤で、白に受け四を与えない四を作る",
      },
    ]);
    assert(
      p.nodes[0].choices
        .filter((choice) => !choice.correct)
        .every((choice) => !choice.continuations),
    );
  }
  for (const p of counterProblemsV5.filter(
    (p) => p.assessmentDomain === "counter-threat",
  )) {
    const other = counterProblemsV5.find(
      (q) => q.family === p.family && q.assessmentDomain === "counter-clear",
    );
    assert.deepEqual(
      p.board.flatMap((v, i) => (v === 1 ? [i] : [])),
      other.board.flatMap((v, i) => (v === 1 ? [i] : [])),
    );
    const changed = p.board.flatMap((v, i) =>
      v !== other.board[i] ? [i] : [],
    );
    assert.equal(
      changed.length,
      2,
      `${p.id}: contrast must relocate exactly one white stone`,
    );
    assert(changed.every((i) => p.board[i] !== 1 && other.board[i] !== 1));
    assert.equal(p.prediction.candidate, other.prediction.candidate);
    assert.equal(p.prediction.reply, other.prediction.reply);
  }
});

test("new initial positions are D4/translation distinct from each other and all static teaching positions", () => {
  const known = new Map(),
    newIds = new Set(counterProblemsV5.map((p) => p.id));
  function addTree(value, source) {
    if (!value || typeof value !== "object") return;
    if (value.id && newIds.has(value.id)) return;
    if (
      (Array.isArray(value) || ArrayBuffer.isView(value)) &&
      value.length === 225 &&
      [...value].every((v) => v === 0 || v === 1 || v === 2)
    ) {
      known.set(fingerprint([...value]), source);
      return;
    }
    for (const [key, child] of Object.entries(value))
      addTree(child, `${source}/${key}`);
  }
  addTree(problems, "curriculum");
  addTree(assessmentProblems, "legacy-assessment-bank");
  addTree(strategyDiagrams, "strategy-diagrams");
  for (const lesson of trainingLessons)
    for (let step = 0; step <= lesson.steps.length; step++)
      addTree(lessonBoard(lesson, step), `legacy-lesson/${lesson.id}/${step}`);
  const courses = JSON.parse(
    readFileSync(
      new URL("../dist/expert-courses.json", import.meta.url),
      "utf8",
    ),
  ).courses;
  for (const course of courses) {
    const board = Array(225).fill(0);
    addTree(board, `course/${course.id}/0`);
    for (const [index, move] of course.moves.entries()) {
      const i = typeof move === "number" ? move : move.i;
      assert(Number.isInteger(i), `${course.id}: unsupported course move`);
      board[i] = (index % 2) + 1;
      addTree(board, `course/${course.id}/${index + 1}`);
    }
  }
  for (const p of counterProblemsV5) {
    const key = fingerprint(p.board);
    assert(!known.has(key), `${p.id}: duplicated ${known.get(key)}`);
    known.set(key, p.id);
  }
});

test("all legal white responses verify the prediction, including the unique reply that blocks the candidate", () => {
  let replies = 0;
  for (const p of counterProblemsV5) {
    const { candidate, reply, whiteFinishes, outcome } = p.prediction,
      afterCandidate = placed(p.board, candidate, 1);
    assert.equal(won(afterCandidate, 1), false, p.id);
    assert.deepEqual(wins(afterCandidate, 1), [reply], p.id);
    const actualBlocks = [];
    for (const i of empty(afterCandidate)) {
      replies++;
      const afterReply = placed(afterCandidate, i, 2);
      assert.equal(
        won(afterReply, 2),
        false,
        `${p.id}/${i}: white already wins`,
      );
      if (!wins(afterReply, 1).length) actualBlocks.push(i);
      if (i === reply) {
        assert.deepEqual(wins(afterReply, 2), sorted(whiteFinishes), p.id);
        assert.equal(
          outcome,
          whiteFinishes.length > 1
            ? "open-four"
            : whiteFinishes.length
              ? "four"
              : "clear",
        );
        assert.equal(
          p.assessmentDomain === "counter-threat",
          whiteFinishes.length > 0,
        );
      } else
        assert(
          wins(afterReply, 1).includes(reply),
          `${p.id}/${i}: a different blocking reply was missed`,
        );
    }
    assert.deepEqual(actualBlocks, [reply], p.id);
    for (const choice of p.nodes[0].choices) {
      assert.equal(choice.frames.length, 2);
      assert.deepEqual(choice.frames[0].board, afterCandidate);
      assert.deepEqual(
        choice.frames[1].board,
        placed(afterCandidate, reply, 2),
      );
      for (const frame of choice.frames) {
        assert.match(frame.title, /^仮想手順：/);
        assert(frame.board[frame.last]);
        assert(frame.text.trim());
        for (const mark of frame.highlights) {
          assert(mark.cells.every((i) => frame.board[i]));
          assert(mark.points.every((i) => !frame.board[i]));
        }
      }
    }
  }
  assert(replies > 3000);
});

test("all legal black continuation moves meet exactly the finite safe-four objective", () => {
  let decisions = 0;
  for (const p of counterProblemsV5) {
    const accepted = [];
    for (const i of empty(p.board)) {
      decisions++;
      if (safeFour(p.board, i)) accepted.push(i);
    }
    assert.deepEqual(accepted, sorted(p.guide), p.id);
    assert(accepted.length > 0, p.id);
    if (p.assessmentDomain === "counter-threat") {
      assert(
        !accepted.includes(p.prediction.candidate),
        `${p.id}: dangerous candidate accepted`,
      );
      assert(accepted.every((i) => i !== p.prediction.candidate));
    } else
      assert(
        accepted.includes(p.prediction.candidate),
        `${p.id}: the harmless candidate must remain valid`,
      );
  }
  assert(decisions > 3000);
});

test("prediction leaves the real board untouched; every legal board input agrees with the independent objective", () => {
  let decisions = 0;
  for (const p of counterProblemsV5) {
    assert(
      problems.some((q) => q.id === p.id),
      `${p.id}: missing curriculum integration`,
    );
    const initial = createAttempt(p.id),
      predicted = answerLearningChoice(initial, p.prediction.outcome);
    assert.deepEqual(initial.board, p.board);
    assert.deepEqual(initial.history, []);
    assert.deepEqual(getLearningView(initial).highlights, p.questionHighlights);
    assert.deepEqual(
      predicted.board,
      p.board,
      `${p.id}: imaginary candidate changed the real board`,
    );
    assert.deepEqual(
      predicted.history,
      [],
      `${p.id}: imaginary moves leaked into history`,
    );
    assert.equal(predicted.status, "choose");
    assert.equal(predicted.exercise.objective, "safe-four");
    assert.equal(predicted.metrics.acceptedDecisions, 1);
    assert.equal(getLearningView(predicted).input, "board");
    assert.equal(
      getLearningView(predicted).goal,
      "元の盤で、白に受け四を与えない四を作る",
    );
    assert.deepEqual(getLearningView(predicted).highlights, []);
    assert.equal(
      predicted.transitionFrames.length,
      p.role === "assessment" ? 0 : 2,
      `${p.id}: assessment explanation must wait until the learner actually plays`,
    );
    assert.deepEqual(sorted(predicted.guide), sorted(p.guide), p.id);
    const restored = restoreLearningAttempt(
      JSON.parse(JSON.stringify(predicted)),
    );
    assert(restored, p.id);
    assert.deepEqual(restored.board, p.board);
    assert.deepEqual(restored.history, []);
    assert.deepEqual(sorted(restored.guide), sorted(p.guide));
    const snapshot = JSON.stringify(predicted);
    for (const i of empty(p.board)) {
      decisions++;
      const expected = safeFour(p.board, i),
        result = playLearningMove(predicted, i);
      assert.equal(result.feedback.correct, expected, `${p.id}/${i}`);
      assert.deepEqual(
        result.history,
        [{ i, side: 1 }],
        `${p.id}/${i}: only the learner's move belongs in history`,
      );
      assert.equal(result.metrics.unknownSelections, 0, `${p.id}/${i}`);
      if (expected) {
        assert.equal(result.status, "solved");
        assert.equal(result.metrics.acceptedDecisions, 2);
        assert.equal(result.metrics.verifiedMistakes, 0);
        assert.deepEqual(
          result.transitionFrames.slice(0, 2),
          p.nodes[0].choices.find((c) => c.correct).frames,
        );
        assert.deepEqual(
          result.transitionFrames.at(-1).board,
          placed(p.board, i, 1),
        );
        assert.equal(result.transitionFrames.at(-1).last, i);
        assert.deepEqual(
          getLearningView(result).board,
          placed(p.board, i, 1),
          `${p.id}/${i}: final board must show the actual decision`,
        );
      } else {
        assert.equal(result.status, "feedback");
        assert.equal(result.metrics.verifiedMistakes, 1);
      }
    }
    assert.equal(
      JSON.stringify(predicted),
      snapshot,
      `${p.id}: input state was mutated`,
    );
  }
  assert(decisions > 3000);
});

test("wrong prediction and unsafe actual attack retry without inserting hypothetical play into the checkpoint", () => {
  for (const p of counterProblemsV5) {
    for (const choice of p.nodes[0].choices.filter(
      (choice) => !choice.correct,
    )) {
      const wrong = answerLearningChoice(createAttempt(p.id), choice.id);
      assert.equal(wrong.status, "feedback");
      assert.equal(wrong.metrics.verifiedMistakes, 1);
      assert.deepEqual(wrong.history, []);
      assert.deepEqual(wrong.board, p.board);
      const retry = retryLearning(wrong);
      assert.equal(retry.status, "choose");
      assert.deepEqual(retry.history, []);
      assert.deepEqual(retry.board, p.board);
      assert.equal(retry.exercise, null);
    }
    if (p.assessmentDomain === "counter-threat") {
      const predicted = answerLearningChoice(
          createAttempt(p.id),
          p.prediction.outcome,
        ),
        wrong = playLearningMove(predicted, p.prediction.candidate),
        retry = retryLearning(wrong),
        success = playLearningMove(retry, p.guide[0]);
      assert.deepEqual(retry.board, p.board);
      assert.deepEqual(retry.history, []);
      assert.equal(retry.exercise.objective, "safe-four");
      assert.equal(success.status, "solved");
      assert.deepEqual(success.history, [{ i: p.guide[0], side: 1 }]);
    }
  }
});
