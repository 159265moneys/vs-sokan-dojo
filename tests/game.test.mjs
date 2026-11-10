import test from "node:test";
import assert from "node:assert/strict";
import {
  boardFrom,
  winningLine,
  winningMoves,
  winner,
  parse,
  coord,
  proveVCF,
  classify,
  validateRecord,
} from "../dist/game.js";
import {
  lessons,
  lessonBoard,
  makePuzzle,
  transformPoint,
} from "../dist/lessons.js";
test("freestyle: all directions, overlines, edges, gaps and opponents", () => {
  for (const moves of [
    "A1 B1 C1 D1 E1",
    "A15 A14 A13 A12 A11",
    "A1 B2 C3 D4 E5",
    "A15 B14 C13 D12 E11",
    "E8 F8 G8 H8 I8 J8",
  ]) {
    const b = new Uint8Array(225);
    moves.split(" ").forEach((s) => (b[parse(s)] = 1));
    assert.equal(winner(b), 1);
  }
  for (const moves of ["A1 B1 C1 D1 F1", "N15 O15 A14 B14 C14"]) {
    const b = new Uint8Array(225);
    moves.split(" ").forEach((s) => (b[parse(s)] = 1));
    assert.equal(winner(b), 0);
  }
});
test("coordinate convention is bijective", () => {
  for (let i = 0; i < 225; i++) assert.equal(parse(coord(i)), i);
  assert.throws(() => parse("A0"));
});
test("lessons contain legal alternating, non-terminal starting positions", () => {
  for (const l of lessons) {
    const b = lessonBoard(l);
    assert.equal(winner(b), 0, l.id);
    assert.equal(l.black.length, l.white.length, l.id);
    for (let j = 0; j < l.steps.length; j++) {
      const { i } = l.steps[j];
      assert.equal(b[i], 0, l.id);
      assert.equal(winner(b), 0, l.id);
      b[i] = (j % 2) + 1;
    }
    if (["finish", "fork", "chain"].includes(l.theme))
      assert.equal(winner(b), 1, l.id);
  }
});
test("all 56 symmetry puzzles preserve win and defensive obligations", () => {
  for (const l of lessons)
    for (let t = 0; t < 8; t++) {
      const p = makePuzzle(l, t);
      assert.equal(
        new Set(Array.from({ length: 225 }, (_, i) => transformPoint(i, t)))
          .size,
        225,
      );
      assert.equal(winner(p.board), 0);
      for (const i of p.answers) {
        const before = p.board.slice();
        const c = classify(p.board, i, 1);
        assert.equal(c.severity, 0, l.id);
        assert.deepEqual(p.board, before);
        if (l.theme === "defense") {
          assert(winningMoves(p.board, 2).includes(i));
          p.board[i] = 1;
          assert.equal(winningMoves(p.board, 2).length, 0);
          p.board[i] = 0;
        } else {
          p.board[i] = 1;
          const wins = winningMoves(p.board, 1);
          assert(winningLine(p.board, i).length || wins.length > 0, l.id);
          p.board[i] = 0;
        }
      }
    }
});
test("distant four invalidates the otherwise winning local fork", () => {
  const l = lessons.find((x) => x.id === "outside");
  const b = lessonBoard(l);
  assert.equal(classify(b, parse("H8"), 1).type, "miss-block");
  b[parse("H8")] = 1;
  assert(winningMoves(b, 2).includes(parse("F2")));
});
test("a pre-existing open four is not blamed on the next unavoidable move", () => {
  const b = new Uint8Array(225);
  for (const s of "F8 G8 H8 I8".split(" ")) b[parse(s)] = 2;
  assert.equal(classify(b, parse("A1"), 1).type, "forced-loss");
  assert.equal(classify(b, parse("E8"), 1).severity, 0);
});
// Check every possible defender reply at each node in returned certificates.
function verifyCertificate(input, line) {
  const b = input.slice();
  for (let j = 0; j < line.length; j += 2) {
    const m = line[j];
    assert.equal(b[m], 0);
    b[m] = 1;
    if (winningLine(b, m).length) {
      assert.equal(j, line.length - 1);
      return;
    }
    for (let d = 0; d < 225; d++)
      if (!b[d]) {
        b[d] = 2;
        assert.equal(winningLine(b, d).length, 0, "defender cannot win");
        if (d !== line[j + 1])
          assert(
            winningMoves(b, 1).length > 0,
            "off-line defense loses immediately",
          );
        b[d] = 0;
      }
    assert.equal(b[line[j + 1]], 0);
    b[line[j + 1]] = 2;
  }
  assert.fail("certificate must end in a win");
}
test("bounded solver returns sound continuous-four certificates against every defense", () => {
  for (const id of ["five", "openfour", "doublefour", "chain", "overline"]) {
    const b = lessonBoard(lessons.find((l) => l.id === id));
    const result = proveVCF(b, 1, { maxPly: 7, maxNodes: 1000 });
    assert.equal(result.proven, true, id);
    verifyCertificate(b, result.line);
    assert.deepEqual(b, lessonBoard(lessons.find((l) => l.id === id)));
  }
});
test("no proof is not mislabeled as a loss; current terminal games are rejected", () => {
  assert.equal(proveVCF(new Uint8Array(225), 1).proven, false);
  const b = lessonBoard(lessons[0], 1);
  assert.equal(proveVCF(b, 2).terminal, true);
});
test("record import rejects duplicates, out-of-bounds and moves after game over", () => {
  const r = (moves) => ({ rule: "freestyle15", moves, level: "max" });
  assert.throws(() => validateRecord(r([112, 112])));
  assert.throws(() => validateRecord(r([225])));
  assert.throws(() => validateRecord(r([-1])));
  const m = ["H8", "A1", "I8", "C1", "J8", "E1", "K8", "G1", "L8"].map(parse);
  assert.equal(validateRecord(r(m)).result, "win");
  assert.throws(() => validateRecord(r([...m, 0])));
  assert.equal(boardFrom(m)[parse("L8")], 1);
});
