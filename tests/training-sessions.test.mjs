import test from "node:test";
import assert from "node:assert/strict";
import { positionMoves, reviewStartPly } from "../dist/training-sessions.js";
import { boardFrom, parse, validateRecord } from "../dist/game.js";
import { scanRecord } from "../dist/causal-review.js";
import { problems } from "../dist/curriculum.js";

test("authored snapshot protocol preserves every stone and cannot invent an empty-board game", () => {
  const p = problems.find((p) => p.id === "prevent-junction");
  const b = p.board.slice();
  const moves = positionMoves(b);
  assert.deepEqual(Array.from(boardFrom(moves)), b);
  assert.deepEqual(p.board, b);
  assert.equal(
    validateRecord({ rule: "freestyle15", moves }).result,
    "unfinished",
  );
  assert.equal(reviewStartPly({ startPly: moves.length, moves }), moves.length);
  const bad = b.slice();
  bad[parse("A15")] = 1;
  assert.throws(() => positionMoves(bad));
});
test("review never attributes setup placements in a position exercise to the learner", async () => {
  const moves = "F8 A1 G8 C1 H8 E1 I8 G1 A3 J8".split(" ").map(parse);
  const ms = await scanRecord({ rule: "freestyle15", moves, startPly: 8 });
  assert(ms.length);
  assert(ms.every((m) => m.ply > 8));
  assert.equal(ms.coverage.scannedBlackMoves, 1);
  assert.equal(ms[0].ply, 9);
  assert.equal(reviewStartPly({ startPly: 3, moves }), 0);
  assert.equal(reviewStartPly({ startPly: 999, moves }), 0);
});

test("review continuation carries the accepted human move while preserving the authentic source prefix", async () => {
  const { readFileSync } = await import("node:fs");
  const vm = await import("node:vm");
  const app = readFileSync(new URL("../dist/app.js", import.meta.url), "utf8");
  const controller = app.slice(
    app.indexOf("function startRecovery()"),
    app.indexOf("function putJourney("),
  );
  const moves = [112, 127, 113, 128];
  const before = Array.from(boardFrom(moves));
  let received;
  vm.runInNewContext(`${controller}\nstartRecovery();`, {
    moments: [{ before, ply: 5 }],
    momentIndex: 0,
    review: { id: "source", moves, level: "normal" },
    reviewRetry: { accepted: true, move: 114 },
    levels: { normal: { ms: 300, strength: 35 } },
    startJourney: (track, options) => {
      received = JSON.parse(JSON.stringify({ track, options }));
    },
  });
  assert.equal(received.track, "defend");
  assert.deepEqual(received.options.initialMoves, moves);
  assert.equal(received.options.initialBlackMove, 114);
  assert.deepEqual(received.options.sourceReview, {
    before,
    ply: 5,
    recordId: "source",
  });
});
