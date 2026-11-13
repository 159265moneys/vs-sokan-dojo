import test from "node:test";
import assert from "node:assert/strict";
import { tacticalHintStages } from "../dist/learning-hints.js";
import { parse } from "../dist/game.js";
import { problems } from "../dist/curriculum.js";

const points = (text) => text.split(/\s+/).filter(Boolean).map(parse);
function board(black, white = "") {
  const result = Array(225).fill(0);
  for (const i of points(black)) result[i] = 1;
  for (const i of points(white)) result[i] = 2;
  return result;
}
const cells = (stage) => [...new Set(stage.flatMap((m) => m.cells))].sort((a, b) => a - b);
const sorted = (text) => points(text).sort((a, b) => a - b);

test("crowded order confirmations focus on one black forcing line, not nearby stones", () => {
  for (const id of ["check-order-chain-a", "check-order-chain-b"]) {
    const p = problems.find((p) => p.id === id);
    assert(p);
    assert.equal(p.board.filter(Boolean).length, 16);
    const stages = tacticalHintStages(p.board, p.guide);
    assert.equal(cells(stages[0]).length, 3, id);
    assert(cells(stages[0]).every((i) => p.board[i] === 1), id);
    assert.equal(stages[0].flatMap((m) => m.points).length, 0, id);
    assert.equal(stages[1].flatMap((m) => m.points).length, 0, id);
  }
});

test("dense off-line stones do not alter the first forcing-line hint", () => {
  const b = board("F8 G8 I8 E7 F6 G5 I7 J6 K4", "E8 E9 G9 I9 K9 F10 J10");
  const before = [...b];
  const guide = points("H8");
  const stages = tacticalHintStages(b, guide);
  assert.deepEqual(cells(stages[0]), sorted("F8 G8 I8"));
  assert.deepEqual(stages[1].filter((m) => m.tone === "danger").flatMap((m) => m.cells), sorted("E8"));
  assert.deepEqual(b, before);
  assert.deepEqual(guide, points("H8"));
  stages[2][0].cells.push(0);
  assert(!stages[1][0].cells.includes(0), "stages do not share mutable cell arrays");
});

test("an immediate win highlights its four supporting stones before a rival threat", () => {
  const b = board("C8 D8 F8 G8", "J4 K4 L4 M4");
  const stages = tacticalHintStages(b, points("E8"));
  assert.deepEqual(cells(stages[0]), sorted("C8 D8 F8 G8"));
  assert(stages[0].every((m) => m.tone === "focus"));
});

test("a required block points to the rival four, including an internal gap", () => {
  const b = board("B2 D3 H4 L6", "D10 E10 G10 H10");
  const stages = tacticalHintStages(b, points("F10"));
  assert.deepEqual(cells(stages[0]), sorted("D10 E10 G10 H10"));
  assert(stages[0].every((m) => m.tone === "danger"));
});

test("preventing a two-direction fork shows only the threat's actual supporting stones", () => {
  const b = board("A1 C1 E1 G1", "F8 G8 I8 H6 H7 H9");
  const stages = tacticalHintStages(b, points("H8"));
  assert.equal(cells(stages[0]).length, 3);
  assert.deepEqual(cells(stages[1]), sorted("F8 G8 I8 H6 H7 H9"));
  assert(stages[1].every((m) => m.tone === "danger"));
});

test("an actual open three is supported, but a blocked potential line is not called one", () => {
  const open = board("G8 I8", "C3");
  assert.deepEqual(cells(tacticalHintStages(open, points("H8"))[0]), sorted("G8 I8"));
  const closed = board("G8 I8", "E8 K8 C3");
  const stages = tacticalHintStages(closed, points("H8"));
  assert.deepEqual(stages.slice(0, 2), [[], []]);
  assert.deepEqual(stages[2].flatMap((m) => m.points), points("H8"));
});

test("missing, occupied, invalid or unsupported candidates never produce whole-board glow", () => {
  const b = board("F8 G8", "F7 G7");
  assert.deepEqual(tacticalHintStages(b, []), [[], [], []]);
  assert.deepEqual(tacticalHintStages(b, [parse("F8"), -1, 225, NaN]), [[], [], []]);
  assert.deepEqual(tacticalHintStages(b, points("O15")).slice(0, 2), [[], []]);
  assert.deepEqual(tacticalHintStages([], points("H8")), [[], [], []]);
  assert.deepEqual(tacticalHintStages(b, points("H8"), 0), [[], [], []]);
});

test("the same tactical geometry works for the other side and typed boards", () => {
  const b = Uint8Array.from(board("A1 C1 E1", "G8 H8 I8"));
  const stages = tacticalHintStages(b, points("J8"), 2);
  assert.deepEqual(cells(stages[0]), sorted("G8 H8 I8"));
  assert(stages[0].every((m) => m.tone === "focus"));
  assert.equal(b[parse("J8")], 0);
});
