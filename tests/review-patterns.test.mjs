import test from "node:test";
import assert from "node:assert/strict";
import { parse, boardFrom, winningMoves } from "../dist/game.js";
import {
  recognizePatterns,
  patternHighlights,
  provePatternMove,
  patternOpportunities,
} from "../dist/review-patterns.js";
import {
  describePosition,
  describeMove,
  scanRecord,
} from "../dist/causal-review.js";
import { problems } from "../dist/curriculum.js";
const ps = (s) => s.split(" ").map(parse);
function board(black, white = "") {
  const b = Array(225).fill(0);
  ps(black).forEach((i) => (b[i] = 1));
  if (white) ps(white).forEach((i) => (b[i] = 2));
  return b;
}
function record(black, white, actual) {
  const b = ps(black),
    w = ps(white);
  assert.equal(b.length, w.length);
  return {
    rule: "freestyle15",
    level: "strong",
    moves: b.flatMap((i, k) => [i, w[k]]).concat(parse(actual)),
  };
}
const A = problems.find((p) => p.id === "shared-point-order").board;
const B = problems.find((p) => p.id === "counter-four-claim").board;
function framesValid(frames) {
  for (const f of frames) {
    for (const h of f.highlights) {
      assert(h.cells.every((i) => f.board[i]));
      assert(h.points.every((i) => !f.board[i]));
      if (h.motif) {
        assert(f.motifs.some((m) => m.id === h.patternId));
        assert(!f.motifs.some((m) => m.type === "connection"));
      }
    }
  }
}

test("two loosely connected stones never get a pattern glow or a fabricated tactical explanation", () => {
  const b = board("F8 G8", "A1 C1");
  assert.deepEqual(recognizePatterns(b), []);
  const f = describePosition(b, 1, { last: parse("G8") });
  assert.deepEqual(f.highlights, []);
  const before = board("F8", "A1");
  const move = describeMove(before, parse("G8"), 1).at(-1);
  assert.equal(move.text, "");
  assert.deepEqual(move.highlights, []);
});
test("open and broken threes require the real outside space; closed threes are not lit", () => {
  assert.equal(recognizePatterns(board("F8 G8 H8", "D8 J8")).length, 0);
  const open = recognizePatterns(board("F8 G8 H8", "D8")).find(
    (m) => m.type === "open-three",
  );
  assert(open);
  assert.deepEqual(open.points, [parse("I8")]);
  const broken = recognizePatterns(board("F8 G8 I8")).find(
    (m) => m.type === "broken-three",
  );
  assert(broken);
  assert.deepEqual(broken.points, [parse("H8")]);
  assert.equal(
    recognizePatterns(board("A8 B8 D8")).some((m) => m.type.includes("three")),
    false,
  );
});
test("four-three groups its two actual axes and its distinct continuation points", () => {
  const b = A.slice();
  b[parse("H8")] = 1;
  const m = recognizePatterns(b).find(
    (m) => m.type === "four-three" && m.color === 1,
  );
  assert(m);
  assert.equal(m.groups.length, 2);
  assert.equal(new Set(m.groups.map((g) => g.axis)).size, 2);
  assert(m.points.includes(parse("J8")));
  assert(m.cells.includes(parse("H9")));
  const h = patternHighlights(m, b)[0];
  assert.equal(h.motif, true);
  assert.equal(h.lines.length, 2);
});
test("the same four-three can fail to a counter-four; recognizing a shape is not proving a win", () => {
  const after = B.slice();
  after[parse("H8")] = 1;
  assert(recognizePatterns(after).some((m) => m.type === "four-three"));
  assert.match(
    recognizePatterns(after).find((m) => m.type === "four-three").caution,
    /J8.*J9/,
  );
  assert.equal(provePatternMove(B, 1, parse("H8")), null);
  const reply = after.slice();
  reply[parse("J8")] = 2;
  const m = recognizePatterns(reply, {
    last: parse("J8"),
    before: after,
    sideToMove: 1,
  })[0];
  assert.equal(m.type, "counter-four");
  assert.equal(m.color, 2);
  assert(m.cells.includes(parse("J5")));
  assert.deepEqual(m.points, [parse("J9")]);
  assert.equal(
    recognizePatterns(after).find((m) => m.type === "four-three").confirmedWin,
    false,
  );
  const remaining = recognizePatterns(reply).find((m) => m.color === 1);
  assert.equal(remaining.confirmedWin, false);
  assert.match(remaining.caution, /J9/);
});
test("a double-three win checks every defense including remote counterattacks", () => {
  const b = problems.find((p) => p.id === "two-direction-fork").board;
  const proof = provePatternMove(b, 1, parse("H8"), { allowQuiet: true });
  assert(proof);
  assert.equal(proof.branches, 216);
  assert.equal(proof.scope, "all-replies-then-vcf");
  const counter = b.slice();
  for (const i of ps("K2 K3 K4 K5")) counter[i] = 2;
  assert.equal(
    provePatternMove(counter, 1, parse("H8"), { allowQuiet: true }),
    null,
  );
});
test("a missed winning combination is reviewed even when the played move does not immediately lose", async () => {
  const r = record("F8 G8 I8 H7 H9 J4", "E8 J5 J6 K2 A1 C1", "J8");
  const ms = await scanRecord(r),
    m = ms.find((m) => m.ply === 13);
  assert.equal(m.kind, "winning-chance");
  assert.match(m.coach.title, /H8.*四三.*勝/);
  assert.match(m.coach.text, /横の四と縦の三/);
  assert.match(m.coach.text, /白をJ8/);
  assert.equal(m.coach.motifs[0].type, "four-three");
  assert.deepEqual(m.coach.board, Array.from(boardFrom(r.moves.slice(0, -1))));
  framesValid([m.coach, ...m.frames, ...m.improvementFrames]);
});
test("defensive review starts with the move that would prevent the named fork", async () => {
  const r = record("E5 G7 D11 K12 B3 L6", "H5 H6 H7 F8 G8 I8", "F6");
  const m = (await scanRecord(r)).find((m) => m.ply === 13);
  assert.equal(m.coach.selectedMove, parse("H8"));
  assert.match(m.coach.title, /H8.*防げた/);
  assert.equal(m.coach.motifs[0].type, "double-four");
  assert.equal(m.coach.motifs[0].purpose, "prevent");
  assert.equal(m.coach.board[parse("H8")], 0);
  framesValid([m.coach, ...m.frames, ...m.improvementFrames]);
});
test("quiet double plans are labeled only after universal-response verification, not as loose connections", () => {
  const b = problems.find((p) => p.id === "quiet-two-plans").board;
  const found = patternOpportunities(b, 1, { maxQuietChecks: 2 });
  const h8 = found.find((p) => p.move === parse("H8"));
  assert(h8);
  assert.equal(h8.pattern.type, "double-plan");
  assert.equal(h8.proof.branches, 208);
  assert(h8.proof.plans.length >= 2);
  const after = b.slice();
  after[parse("H8")] = 1;
  assert.equal(winningMoves(after, 1).length, 0);
  assert.equal(recognizePatterns(after).filter((m) => m.color === 1).length, 0);
  assert.equal(
    patternOpportunities(b, 1, { maxQuietChecks: 0 }).some(
      (p) => p.pattern.type === "double-plan",
    ),
    false,
  );
});
test("a successful pattern is picked up in a winning game rather than returning an empty mistakes report", async () => {
  const r = record("F8 G8 I8 H7 H9 J4", "E8 J5 J6 K2 A1 C1", "H8");
  const m = (await scanRecord(r)).find((m) => m.ply === 13);
  assert.equal(m.kind, "pattern-play");
  assert.match(m.coach.title, /四三を作れた/);
  assert.equal(m.coach.motifs[0].purpose, "aim");
  framesValid([m.coach, ...m.frames, ...m.improvementFrames]);
});
