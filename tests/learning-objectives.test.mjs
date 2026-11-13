import test from "node:test";
import assert from "node:assert/strict";
import { parse } from "../dist/game.js";
import {
  exerciseSatisfied,
  exerciseMoves,
} from "../dist/learning-objectives.js";
const board = (black, white = "") => {
  const b = Array(225).fill(0);
  for (const [s, c] of [
    [black, 1],
    [white, 2],
  ])
    for (const p of s.split(/\s+/).filter(Boolean)) b[parse(p)] = c;
  return b;
};
const goal = (objective, cells) => ({
  objective,
  cells: cells.split(/\s+/).filter(Boolean).map(parse),
});
test("two-directions needs different axes using the specified stones, not an unrelated extra connection", () => {
  const e = goal("two-directions", "F8 G8");
  assert.equal(exerciseSatisfied(board("F8 G8 H8 I9"), e, parse("H8")), false);
  assert.equal(
    exerciseSatisfied(
      board("F8 H6 H8"),
      goal("two-directions", "F8 H6"),
      parse("H8"),
    ),
    true,
  );
});
test("connection space cannot jump a white stone or count outside the board", () => {
  const e = goal("two-directions", "F8 H6");
  assert.equal(
    exerciseSatisfied(board("F8 H6 H8", "G8"), e, parse("H8")),
    false,
  );
  assert.equal(
    exerciseSatisfied(board("F8 H6 H8", "E8 J8"), e, parse("H8")),
    false,
  );
  assert.equal(
    exerciseSatisfied(board("F8 H6 H8", "G7 J8"), e, parse("H8")),
    true,
  );
  const edge = goal("two-directions", "A1 C3");
  assert.equal(exerciseSatisfied(board("A1 C3 A3"), edge, parse("A3")), true);
  assert.equal(
    exerciseSatisfied(board("A1 C3 A3", "A4"), edge, parse("A3")),
    false,
  );
});
test("two finishes must use the requested support, not a separate preexisting four", () => {
  const e = goal("open-four", "F8 G8 H8");
  assert.equal(exerciseSatisfied(board("F8 G8 H8 I8"), e, parse("I8")), true);
  assert.equal(
    exerciseSatisfied(board("F8 G8 H8 I8", "E8"), e, parse("I8")),
    false,
  );
  assert.equal(
    exerciseSatisfied(board("F8 G8 H8 I8 A1 A2 A3 A4", "E8"), e, parse("I8")),
    false,
  );
});
test("the black five ends the game before an existing white winning point", () => {
  const b = board("F8 G8 H8 I8 J8", "A1 A2 A3 A4");
  for (const objective of ["five", "safe-four", "prevent-fork"])
    assert.equal(exerciseSatisfied(b, goal(objective, ""), parse("J8")), true);
});
test("enumeration is immutable and returns legal empty points only", () => {
  const before = Object.freeze(board("F8 H6")),
    copy = [...before],
    e = goal("two-directions", "F8 H6");
  const moves = exerciseMoves(before, e);
  assert(moves.includes(parse("H8")));
  assert(!moves.includes(parse("F8")));
  assert.deepEqual([...before], copy);
  assert.equal(exerciseSatisfied(before, e, -1), false);
  assert.equal(exerciseSatisfied(before, e, parse("H8")), false);
});
