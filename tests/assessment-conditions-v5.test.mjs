import test from "node:test";
import assert from "node:assert/strict";
import {
  conditionsAssessments,
  conditionsPracticeLessons,
} from "../dist/assessment-conditions-v5.js";
import { problems, units } from "../dist/curriculum.js";
import { data as articleDiagrams } from "../dist/strategy-diagrams.js";

const all = [...conditionsAssessments, ...conditionsPracticeLessons];
const ownIds = new Set(all.map((p) => p.id));
const at = (label) => {
  const [, column, row] = /^([A-O])(\d+)$/.exec(label);
  return (15 - Number(row)) * 15 + column.charCodeAt(0) - 65;
};
const name = (i) => `${String.fromCharCode(65 + i % 15)}${15 - Math.floor(i / 15)}`;
const sorted = (a) => [...a].sort((a, b) => a - b);

// Independent finite geometry: no game.js winningMoves/classifier, authored
// answer metadata, or assessment-generator predicate participates in the oracle.
const lines = [];
for (let y = 0; y < 15; y++)
  for (let x = 0; x < 15; x++)
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]])
      for (const length of [5, 6]) {
        const endX = x + dx * (length - 1), endY = y + dy * (length - 1);
        if (endX < 0 || endX >= 15 || endY < 0 || endY >= 15) continue;
        lines.push(Array.from({ length }, (_, k) => (y + dy * k) * 15 + x + dx * k));
      }
const five = lines.filter((line) => line.length === 5);
const six = lines.filter((line) => line.length === 6);
const won = (board, side) => five.some((line) => line.every((i) => board[i] === side));
const winningWindows = (board, side) => five.filter((line) =>
  line.filter((i) => board[i] === side).length === 4 && line.every((i) => board[i] !== 3 - side));
const completions = (board, side) => sorted(new Set(winningWindows(board, side).flatMap((line) => line.filter((i) => board[i] === 0))));
const openFours = (board, move) => six.filter((line) =>
  !board[line[0]] && !board[line[5]] && line.slice(1, 5).every((i) => board[i] === 1) && line.slice(1, 5).includes(move));
function after(p) {
  const board = [...p.board];
  board[p.prediction.move] = 1;
  return board;
}
function fingerprint(board) {
  const stones = board.flatMap((value, i) => value ? [[i % 15, Math.floor(i / 15), value]] : []);
  if (!stones.length) return "empty";
  const forms = [];
  for (const swap of [false, true]) for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
    const transformed = stones.map(([x, y, color]) => [sx * (swap ? y : x), sy * (swap ? x : y), color]);
    const minX = Math.min(...transformed.map((p) => p[0]));
    const minY = Math.min(...transformed.map((p) => p[1]));
    forms.push(transformed.map(([x, y, c]) => `${x - minX},${y - minY},${c}`).sort().join(";"));
  }
  return forms.sort()[0];
}
function boardsIn(value, result = []) {
  if (Array.isArray(value) && value.length === 225 && value.every((v) => [0, 1, 2].includes(v))) result.push(value);
  else if (value && typeof value === "object") for (const child of Object.values(value)) boardsIn(child, result);
  return result;
}
function assertFrame(frame, p) {
  assert.deepEqual(frame.board, after(p), p.id);
  assert.equal(frame.last, p.prediction.move, p.id);
  assert(frame.text.trim() && frame.title.trim(), p.id);
  for (const mark of frame.highlights) {
    for (const i of mark.cells) assert(frame.board[i], `${p.id}: highlighted stone ${name(i)} is empty`);
    for (const i of mark.points) assert.equal(frame.board[i], 0, `${p.id}: highlighted point ${name(i)} is occupied`);
  }
  const indicated = frame.highlights.filter((h) => h.tone === "good").flatMap((h) => h.points);
  assert.deepEqual(sorted(indicated), completions(frame.board, 1), `${p.id}: diagram completion points`);
  const blockers = frame.highlights.filter((h) => h.tone === "danger").flatMap((h) => h.cells);
  assert(blockers.every((i) => frame.board[i] === 2), `${p.id}: false white blocker`);
}

test("conditions has six independent positive/negative pairs and four separate lessons", () => {
  assert.equal(conditionsAssessments.length, 12);
  assert.equal(conditionsPracticeLessons.length, 4);
  assert.equal(ownIds.size, 16);
  const expectedCounts = new Map([["outer-space", 4], ["board-edge", 4], ["gapped-three", 2], ["shared-completion", 2]]);
  for (const [family, count] of expectedCounts) {
    const ps = conditionsAssessments.filter((p) => p.family === `conditions/${family}`);
    assert.equal(ps.length, count, family);
    for (const domain of ["conditions-positive", "conditions-negative"])
      assert.equal(ps.filter((p) => p.assessmentDomain === domain).length, count / 2, `${family}/${domain}`);
  }
  for (const p of all) {
    assert.equal(p.board.length, 225);
    assert(p.board.every((v) => [0, 1, 2].includes(v)));
    assert.equal(p.board.filter((v) => v === 1).length, p.board.filter((v) => v === 2).length, p.id);
    assert.equal(p.sideToMove, 1);
    assert.equal(p.board[p.prediction.move], 0, p.id);
    for (const side of [1, 2]) {
      assert.equal(won(p.board, side), false, p.id);
      assert.deepEqual(completions(p.board, side), [], `${p.id}: starts with an immediate win`);
      assert.equal(won(after(p), side), false, `${p.id}: prediction is already terminal`);
    }
    assert.deepEqual(completions(after(p), 2), [], `${p.id}: white counter-win obscures the local prediction`);
    assert.equal(p.kind, "compare");
    assert.equal(p.completion, "comparison");
    assert.equal(p.unitId, "conditions");
    assert.equal(p.skillId, "conditions");
    assert.equal(p.requiresBranch, false);
    assert(p.branchId);
    assert.deepEqual(p.guide, []);
    assert.equal(p.nodes[0].choices.filter((c) => c.correct).length, 1, p.id);
    assert.equal(p.evidence.source, "original");
    assert(p.evidence.scope && p.evidence.verification);
    assert(Object.isFrozen(p) && Object.isFrozen(p.board) && Object.isFrozen(p.nodes[0].choices));
  }
  assert(conditionsAssessments.every((p) => p.role === "assessment"));
  assert(conditionsPracticeLessons.every((p) => p.role === "lesson" && !p.assessmentDomain));
});

test("all answers and every choice explanation agree with independently enumerated windows", () => {
  for (const p of all) {
    const board = after(p), actual = completions(board, 1);
    assert.deepEqual(sorted(p.prediction.completionPoints), actual, p.id);
    assert(p.prediction.focusCells.every((i) => board[i] === 1), p.id);
    assert(p.prediction.blockers.every((i) => board[i] === 2), p.id);
    const positive = p.prediction.kind === "open-four" ? openFours(board, p.prediction.move).length > 0 : actual.length >= 2;
    if (p.role === "assessment") assert.equal(p.assessmentDomain, `conditions-${positive ? "positive" : "negative"}`, p.id);
    for (const choice of p.nodes[0].choices) {
      const correct = p.prediction.kind === "open-four"
        ? (choice.id === "yes") === (openFours(board, p.prediction.move).length > 0)
        : ({ zero: 0, one: 1, two: 2 }[choice.id] === actual.length);
      assert.equal(choice.correct, correct, `${p.id}/${choice.id}`);
      assert(choice.text.trim(), `${p.id}/${choice.id}: missing causal feedback`);
      assert.equal(choice.frames.length, 1);
      assert.equal(choice.frames[0].text, choice.text);
      assertFrame(choice.frames[0], p);
      for (const i of actual) assert(choice.text.includes(name(i)), `${p.id}/${choice.id}: missing completion ${name(i)}`);
      for (const i of p.prediction.blockers) assert(choice.text.includes(name(i)), `${p.id}/${choice.id}: missing blocker ${name(i)}`);
    }
  }
});

test("matched positive and negative questions do not reveal the answer in initial labels or marks", () => {
  const groups = Map.groupBy(conditionsAssessments, (p) => p.prediction.comparisonGroup);
  assert.equal(groups.size, 6);
  for (const [group, pair] of groups) {
    assert.equal(pair.length, 2, group);
    assert.equal(new Set(pair.map((p) => p.assessmentDomain)).size, 2, group);
    assert.equal(pair[0].title, pair[1].title, group);
    assert.equal(pair[0].goal, pair[1].goal, group);
    assert.deepEqual(pair[0].nodes[0].choices.map(({ id, title }) => ({ id, title })), pair[1].nodes[0].choices.map(({ id, title }) => ({ id, title })), group);
    assert.equal(pair[0].prediction.move, pair[1].prediction.move, group);
    for (const p of pair) {
      assert.deepEqual(p.questionHighlights, [{ cells: [], points: [p.prediction.move], tone: "focus" }], p.id);
      assert(!/偽|正解|不成立|成立する|外側|端では|止まる/.test(p.title), p.id);
      assert(!p.nodes[0].choices.some((c) => c.continuations), p.id);
    }
  }
});

test("outer whites, actual boundaries, a gapped three and shared completion points have concrete witnesses", () => {
  for (const id of ["check-conditions-01", "check-conditions-04"]) {
    const p = all.find((p) => p.id === id);
    const trio = p.prediction.focusCells.filter((i) => i !== p.prediction.move);
    assert.equal(trio.length, 3);
    const extensions = [];
    for (let i = 0; i < 225; i++) if (!p.board[i]) {
      const b = [...p.board]; b[i] = 1;
      if (six.some((line) => !b[line[0]] && !b[line[5]] && trio.every((j) => line.slice(1, 5).includes(j)) && line.slice(1, 5).every((j) => b[j] === 1))) extensions.push(i);
    }
    assert.deepEqual(extensions, [], `${id}: either side must fail to make an open four`);
    assert.equal(p.prediction.blockers.length, 2, id);
  }
  for (const p of all.filter((p) => p.prediction.boundary)) {
    const { anchor, outward: [dx, dy] } = p.prediction.boundary;
    const i = at(anchor), x = i % 15 + dx, y = Math.floor(i / 15) + dy;
    assert(x < 0 || x >= 15 || y < 0 || y >= 15, `${p.id}: invented board edge`);
    assert.equal(after(p)[i], 1);
    assert(p.nodes[0].choices.every((c) => c.text.includes(anchor) && c.text.includes("盤外")), p.id);
  }
  const edgePositive = all.find((p) => p.id === "check-conditions-08");
  assert(completions(after(edgePositive), 1).includes(at("A15")), "a real corner intersection counts as one point");
  for (const p of conditionsAssessments.filter((p) => p.family === "conditions/gapped-three")) {
    const occupied = p.prediction.focusCells.filter((i) => p.board[i] === 1);
    assert.equal(occupied.length, 3);
    const ordered = sorted(p.prediction.focusCells);
    assert(ordered[1] === p.prediction.move || ordered[2] === p.prediction.move, p.id);
    assert.equal(winningWindows(after(p), 1).length, p.assessmentDomain === "conditions-positive" ? 2 : 1, p.id);
  }
  for (const p of conditionsAssessments.filter((p) => p.family === "conditions/shared-completion")) {
    const windows = winningWindows(after(p), 1);
    assert.equal(windows.length, 2, p.id);
    assert.equal(completions(after(p), 1).length, p.assessmentDomain === "conditions-positive" ? 2 : 1, p.id);
    assert.equal(openFours(after(p), p.prediction.move).length, 0, `${p.id}: distinguish two completion points from a contiguous open four`);
  }
});

test("all new original boards are separate from legacy lessons, assessments and article diagrams under D4 and translation", () => {
  const priorBoards = boardsIn(problems.filter((p) => !ownIds.has(p.id)));
  priorBoards.push(...boardsIn(units.map((u) => u.lessonFrames)), ...boardsIn(articleDiagrams));
  for (const diagram of Object.values(articleDiagrams)) if (diagram.recordMoves) {
    const board = Array(225).fill(0);
    for (const move of diagram.recordMoves) {
      board[move.i] = move.color;
      priorBoards.push([...board]);
    }
  }
  const prior = new Set(priorBoards.map(fingerprint));
  const seen = new Set();
  for (const p of all) {
    const key = fingerprint(p.board);
    assert(!prior.has(key), `${p.id}: repeated a lesson, assessment, or article position`);
    assert(!seen.has(key), `${p.id}: repeated another conditions position`);
    seen.add(key);
  }
  for (const p of conditionsAssessments)
    for (const lesson of conditionsPracticeLessons)
      assert(!boardsIn(lesson).some((b) => fingerprint(b) === fingerprint(p.board)), `${p.id}: exposed by ${lesson.id}`);
});
