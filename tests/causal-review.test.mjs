import test from "node:test";
import assert from "node:assert/strict";
import {
  parse,
  coord,
  winningLine,
  winningMoves,
  winner,
} from "../dist/game.js";
import {
  scanRecord,
  describePosition,
  describeMove,
  judgeReviewMove,
} from "../dist/causal-review.js";
import { handleReviewMessage } from "../dist/review-worker.js";

const points = (s) => (s ? s.split(" ").map(parse) : []);
function board(black, white) {
  const b = new Uint8Array(225);
  for (const i of points(black)) b[i] = 1;
  for (const i of points(white)) {
    assert.equal(b[i], 0);
    b[i] = 2;
  }
  return b;
}
function record(black, white, actual) {
  const bs = points(black),
    ws = points(white);
  assert.equal(bs.length, ws.length);
  const moves = bs.flatMap((i, k) => [i, ws[k]]);
  if (actual) moves.push(parse(actual));
  return {
    rule: "freestyle15",
    level: "strong",
    moves: moves.map((i) => ({ i })),
  };
}
function validateFrames(frames) {
  for (let index = 0; index < frames.length; index++) {
    const f = frames[index];
    assert.equal(f.board.length, 225);
    assert(f.board.every((v) => [0, 1, 2].includes(v)));
    if (f.last !== null) assert(f.board[f.last]);
    for (const h of f.highlights) {
      assert(["good", "danger", "focus"].includes(h.tone));
      for (const i of h.cells)
        assert(i >= 0 && i < 225 && f.board[i], `invalid support ${i}`);
      for (const i of h.points)
        assert(i >= 0 && i < 225 && f.board[i] === 0, `invalid point ${i}`);
    }
    for (const claim of f.claims || []) {
      const wins = winningMoves(Uint8Array.from(f.board), claim.color);
      if (claim.type === "completed-five")
        assert(winningLine(f.board, claim.point).length >= 5);
      if (claim.type === "two-completions") {
        assert(new Set(claim.points).size >= 2);
        assert(claim.points.every((i) => wins.includes(i)));
        assert(
          f.text.includes(coord(claim.points[0])) &&
            f.text.includes(coord(claim.points[1])),
        );
      }
      if (claim.type === "must-block") {
        assert(
          claim.points.length && claim.points.every((i) => wins.includes(i)),
        );
        assert.equal(
          winningMoves(Uint8Array.from(f.board), 3 - claim.color).length,
          0,
        );
        assert(f.text.includes(coord(claim.points[0])));
      }
      if (
        claim.type === "blocked-but-remains" ||
        claim.type === "completion-removed"
      ) {
        assert.equal(f.board[claim.blocked], 3 - claim.color);
        assert(claim.previousPoints.includes(claim.blocked));
        assert(f.text.includes(coord(claim.blocked)));
        if (frames[index - 1])
          assert(
            winningMoves(
              Uint8Array.from(frames[index - 1].board),
              claim.color,
            ).includes(claim.blocked),
          );
      }
      if (claim.type === "blocked-but-remains")
        assert(
          claim.points.length && claim.points.every((i) => wins.includes(i)),
        );
      if (claim.type === "completion-removed" || claim.type === "no-completion")
        assert.equal(wins.length, 0);
      if (claim.type === "occupied-plan-point") {
        assert.equal(f.board[claim.point], claim.color);
        assert(f.text.includes(coord(claim.point)));
      }
    }
  }
}
function verifyVCF(input, evidence) {
  const b = Uint8Array.from(input),
    a = evidence.attacker;
  for (let k = 0; k < evidence.line.length; k += 2) {
    const m = evidence.line[k];
    assert.equal(b[m], 0);
    b[m] = a;
    if (winningLine(b, m).length) return;
    for (let d = 0; d < 225; d++)
      if (!b[d]) {
        b[d] = 3 - a;
        assert.equal(winningLine(b, d).length, 0, "defender cannot win first");
        if (d !== evidence.line[k + 1])
          assert(winningMoves(b, a).length, "off-line defense permits five");
        b[d] = 0;
      }
    assert.equal(b[evidence.line[k + 1]], 0);
    b[evidence.line[k + 1]] = 3 - a;
  }
  assert.fail("certificate has no terminal win");
}

test("position and move frames expose actual shape stones and empty completion points without mutation", () => {
  const b = board("F8 G8 H8", "A1");
  const original = b.slice();
  const frames = describeMove(b, parse("I8"), 1);
  assert.deepEqual(b, original);
  assert.deepEqual(frames[1].facts.immediateWins.black, points("E8 J8"));
  assert(
    frames[1].highlights.some(
      (h) => h.cells.includes(parse("F8")) && h.points.includes(parse("J8")),
    ),
  );
  validateFrames(frames);
  const overline = board("E8 F8 G8 H8 I8 J8", "A1");
  assert.equal(describePosition(overline).facts.terminal, 1);
  assert.equal(describePosition(b, 1, { last: 225 }).last, null);
});

test("a blocked three-shaped row is not mislabeled an extendable three", () => {
  const dead = describePosition(board("F8 G8 H8", "D8 J8"));
  assert.equal(
    dead.facts.patterns.filter((p) => p.color === 1 && p.kind === "three")
      .length,
    0,
  );
  const alive = describePosition(board("F8 G8 H8", "D8"));
  assert(
    alive.facts.patterns.some(
      (p) => p.kind === "three" && p.points.includes(parse("I8")),
    ),
  );
});

test("immediate wins accept both endpoints and never claim another move loses the game", async () => {
  const r = record("F8 G8 H8 I8", "A1 C1 E1 G1", "A3");
  const copy = structuredClone(r),
    progress = [];
  const moments = await scanRecord(r, { onProgress: (p) => progress.push(p) });
  assert.deepEqual(r, copy);
  const m = moments.find((m) => m.ply === 9);
  assert.equal(m.kind, "miss-win");
  assert.deepEqual(m.alternatives, points("E8 J8"));
  assert.equal(judgeReviewMove(m, parse("E8")).status, "correct");
  assert.equal(judgeReviewMove(m, parse("J8")).status, "alternative");
  const bad = judgeReviewMove(m, parse("A3"));
  assert.equal(bad.scope, "immediate-win");
  assert.equal(bad.text, "この手では五にならない");
  assert.equal(progress.at(-1).done, 9);
  validateFrames([...m.frames, ...m.improvementFrames]);
});

test("a missed single completion point carries a concrete White win and an improvement", async () => {
  const ms = await scanRecord(record("E8 A1 C1 E1", "F8 G8 H8 I8", "A3"));
  const m = ms.find((m) => m.ply === 9);
  assert.equal(m.kind, "miss-block");
  assert.equal(m.evidence.line[0], parse("J8"));
  assert(m.alternatives.includes(parse("J8")));
  const next = Uint8Array.from(m.before);
  next[m.actual] = 1;
  verifyVCF(next, m.evidence);
});

test("review identifies allowing an open four before the two-point loss exists", async () => {
  const ms = await scanRecord(record("A1 C1 E1", "F8 G8 H8", "A3"));
  const m = ms.find((m) => m.ply === 7);
  assert.equal(m.kind, "allowed-fork");
  assert.equal(m.title, "達四を許した");
  assert.equal(m.evidence.plies, 3);
  assert.match(m.text, /片方|止めても/);
  assert.match(m.text, /五が完成/);
  assert(m.frames[0].text.length > 0);
  const next = Uint8Array.from(m.before);
  next[m.actual] = 1;
  verifyVCF(next, m.evidence);
  const good = judgeReviewMove(m, parse("I8"));
  assert.equal(good.accepted, true);
  assert.equal(good.scope, "line-prevented");
  const bad = judgeReviewMove(m, parse("A3"));
  assert.equal(bad.accepted, false);
  assert.equal(bad.status, "refuted");
  validateFrames([
    ...m.frames,
    ...m.improvementFrames,
    ...good.frames,
    ...bad.frames,
  ]);
});

test("a later double four is recognized without blaming an already forced loss", async () => {
  const r = record("D8 H4 A1 C3 E1 N3", "E8 F8 G8 H5 H6 H7", "A3");
  const ms = await scanRecord(r);
  assert(
    ms.some((m) => m.ply === 11),
    "the earlier avoidable setup is identified",
  );
  assert.equal(
    ms.some((m) => m.ply === 13),
    false,
  );
  assert(ms.coverage.unavoidablePlies.includes(13));
  const b = board("D8 H4 A1 C3 E1 N3 A3", "E8 F8 G8 H5 H6 H7");
  const f = describeMove(b, parse("H8"), 2).at(-1);
  const pattern = f.motifs.find(
    (m) => m.type === "double-four" && m.color === 2,
  );
  assert(pattern);
  assert(
    pattern.points.includes(parse("H9")) &&
      pattern.points.includes(parse("I8")),
  );
  assert.equal(pattern.groups.length, 2);
  validateFrames([f]);
});

test("an already existing double completion is not blamed on the last unavoidable move", async () => {
  const ms = await scanRecord(record("A1 C1 E1 G2", "F8 G8 H8 I8", "A3"));
  assert.equal(
    ms.some((m) => m.ply === 9),
    false,
  );
  assert(ms.coverage.unavoidablePlies.includes(9));
  assert(ms.some((m) => m.ply === 7 && m.kind === "allowed-fork"));
});

test("counter-four is reported only with a complete winning continuation", async () => {
  const r = record("B8 F4 I8 J10 H10 L12 K13", "C8 D8 E8 F5 F6 G7 H7", "G10");
  const ms = await scanRecord(r);
  const m = ms.find((m) => m.ply === 15);
  assert(m, "review moment exists");
  assert.equal(m.kind, "allowed-counter");
  assert.equal(m.skillId, "counter");
  assert.equal(m.evidence.line[0], parse("F8"));
  assert.match(m.text, /黒はG8を守る必要/);
  const next = Uint8Array.from(m.before);
  next[m.actual] = 1;
  verifyVCF(next, m.evidence);
  validateFrames([...m.frames, ...m.improvementFrames]);
});

test("lost four-chase order requires both a prior Black win and a proven White reply", async () => {
  const r = record(
    "C8 D8 E8 F5 F6 G7 H7 A1 O1 G13 K9",
    "H13 I13 J13 K10 K11 L12 M12 B8 F4 D15 F15",
    "E7",
  );
  const ms = await scanRecord(r);
  const m = ms.find((m) => m.ply === 23);
  assert(m, "review moment exists");
  assert.equal(m.kind, "lost-order");
  assert.equal(m.skillId, "order");
  verifyVCF(m.before, m.priorWinningProof);
  const next = Uint8Array.from(m.before);
  next[m.actual] = 1;
  verifyVCF(next, m.evidence);
  assert(m.alternatives.includes(m.priorWinningProof.line[0]));
  const good = judgeReviewMove(m, m.priorWinningProof.line[0]);
  assert.equal(good.accepted, true);
  assert.equal(good.scope, "forced-win");
  validateFrames([...m.frames, ...m.improvementFrames, ...good.frames]);
});

test("bounded failure is unknown, not an absence-of-mistakes verdict", async () => {
  const ms = await scanRecord(record("A1 C1 E1", "F8 G8 H8", "A3"), {
    proofLimits: { maxPly: 7, maxNodes: 0 },
  });
  assert.equal(ms.length, 0);
  assert(ms.coverage.unknownPlies.includes(7));
  assert.equal(ms.coverage.complete, true);
  assert.match(ms.coverage.scope, /bounded/);
});

test("record validation rejects post-terminal games and occupied retry moves", async () => {
  const moves = points("H8 A1 I8 C1 J8 E1 K8 G1 L8 A3");
  await assert.rejects(scanRecord({ rule: "freestyle15", moves }));
  const ms = await scanRecord(record("A1 C1 E1", "F8 G8 H8", "A3"));
  assert.equal(
    judgeReviewMove(
      ms.find((m) => m.ply === 7),
      parse("F8"),
    ).status,
    "illegal",
  );
});

test("worker protocol delivers IDs, coverage, progress, and errors", async () => {
  const events = [];
  await handleReviewMessage(
    {
      type: "scan",
      id: "review-7",
      record: record("A1 C1 E1", "F8 G8 H8", "A3"),
    },
    (e) => events.push(structuredClone(e)),
  );
  assert(
    events
      .filter((e) => e.type === "progress")
      .every((e) => e.id === "review-7"),
  );
  const result = events.at(-1);
  assert.equal(result.type, "result");
  assert.equal(result.coverage.complete, true);
  assert(result.moments.some((m) => m.kind === "allowed-fork"));
  const errors = [];
  await handleReviewMessage(
    { type: "scan", id: "bad", record: { rule: "wrong", moves: [] } },
    (e) => errors.push(e),
  );
  assert.equal(errors.at(-1).type, "error");
  assert.equal(errors.at(-1).id, "bad");
});
