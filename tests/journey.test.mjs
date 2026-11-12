import test from "node:test";
import assert from "node:assert/strict";
import { boardFrom, parse, winningLine } from "../dist/game.js";
import {
  journeyTracks,
  createJourney,
  playJourneyMove,
  applyJourneyReply,
  getJourneyResult,
  getJourneyView,
  restoreJourney,
  retryJourney,
  markJourneyAssistance,
  previewJourneyMove,
} from "../dist/journey.js";

const points = (s) => s.split(/\s+/).filter(Boolean).map(parse);
function history(black, white) {
  const b = points(black),
    w = points(white);
  assert.equal(b.length, w.length);
  return b.flatMap((i, n) => [i, w[n]]);
}
function fromPosition(black, white, track = "defend") {
  return createJourney(track, {
    attemptId: "position",
    initialMoves: history(black, white),
  });
}
function pairs(state, moves) {
  for (const [black, white] of moves) {
    state = playJourneyMove(state, parse(black));
    if (white) state = applyJourneyReply(state, parse(white));
  }
  return state;
}
const result = getJourneyResult;
const objective = (s, id) => result(s).objectives.find((o) => o.id === id);
const observations = (s, id) =>
  result(s).opportunities.filter((o) => o.objectiveId === id && !o.retracted);

test("the three opening tracks accept different legal human moves and actual CPU replies", () => {
  assert.deepEqual(
    journeyTracks.map((t) => t.id),
    ["build", "defend", "practice", "branch"],
  );
  for (const first of ["H8", "G7", "A1"]) {
    const empty = createJourney("build", { attemptId: first });
    assert.equal(empty.board.filter(Boolean).length, 0);
    const black = playJourneyMove(empty, parse(first));
    assert.equal(getJourneyView(black).needsReply, true);
    const white = applyJourneyReply(black, parse("O15"));
    assert.equal(getJourneyView(white).turn, 1);
    const next = playJourneyMove(white, parse("F7"));
    assert.equal(next.moves.length, 3);
    assert.equal(result(next).fromOpening, true);
    assert.equal(result(next).result, "unfinished");
    assert.equal(empty.moves.length, 0);
    assert.throws(() => black.moves.push(3));
  }
});

test("a self-built connection, a real obstruction and a remaining direction are separate events", () => {
  let s = pairs(createJourney("build"), [
    ["J8", "A1"],
    ["H10", "C1"],
    ["H8", "I8"],
  ]);
  assert.equal(objective(s, "two-directions").status, "achieved");
  assert.equal(objective(s, "switch-direction").status, "not-observed");
  assert.equal(getJourneyView(s).feedback.kind, "direction-blocked");
  s = playJourneyMove(s, parse("H9"));
  assert.equal(objective(s, "switch-direction").status, "achieved");
  assert.equal(objective(s, "build-threat").status, "achieved");
  assert.equal(objective(s, "force-four").status, "not-observed");
  assert.equal(s.completed, false);
  assert.equal(result(s).goalMet, false);
  assert.equal(result(s).proofScope, "local-board-facts");
  assert.equal(
    observations(s, "two-directions")[0].evidence.scope,
    "connection-geometry-only",
  );

  let alternate = pairs(createJourney("build"), [
    ["J8", "A1"],
    ["H10", "C1"],
    ["H8", "H9"],
  ]);
  alternate = playJourneyMove(alternate, parse("I8"));
  assert.equal(objective(alternate, "switch-direction").status, "achieved");
  assert.notDeepEqual(
    observations(s, "switch-direction")[0].evidence.blockedAxes,
    observations(alternate, "switch-direction")[0].evidence.blockedAxes,
  );
});

test("choosing another quiet plan is unknown, not an incorrect coordinate", () => {
  let s = pairs(createJourney("build"), [
    ["J8", "A1"],
    ["H10", "C1"],
    ["H8", "I8"],
  ]);
  s = playJourneyMove(s, parse("B12"));
  assert.equal(observations(s, "switch-direction")[0].outcome, "unknown");
  assert.deepEqual(s.mistakes, []);
  assert.equal(result(s).result, "unfinished");
  assert.equal(objective(s, "prevent-fork").status, "not-observed");
});

test("human continues beyond construction, forces a reply and completes their own five", () => {
  let s = pairs(createJourney("build"), [
    ["J8", "A1"],
    ["H10", "C1"],
    ["H8", "I8"],
    ["H9", "E1"],
    ["H11", "H7"],
  ]);
  assert.equal(objective(s, "force-four").status, "achieved");
  assert.equal(s.completed, false);
  s = playJourneyMove(s, parse("H12"));
  assert.equal(s.winner, 1);
  assert.equal(s.completed, true);
  assert.equal(result(s).goalMet, true);
  assert.equal(result(s).result, "win");
  assert.equal(result(s).moves.length, 11);
  assert.equal(objective(s, "finish-game").status, "achieved");
  assert.throws(() => applyJourneyReply(s, parse("G1")));
});

test("own immediate win has priority over the opponent's immediate threat", () => {
  const s = fromPosition("F8 G8 H8 I8", "F6 G6 H6 I6");
  const won = playJourneyMove(s, parse("J8"));
  assert.equal(won.winner, 1);
  assert.equal(observations(won, "take-win")[0].success, true);
  assert.equal(observations(won, "stop-five").length, 0);
  assert.equal(won.mistakes.length, 0);
  const missed = playJourneyMove(s, parse("J6"));
  assert.equal(missed.mistakes[0].kind, "miss-win");
  assert.equal(missed.completed, false);
});

test("a block is a decision point, not the end; the defended stone can support the next attack", () => {
  let s = fromPosition("D8 I6 I7 A1", "E8 F8 G8 H8");
  s = playJourneyMove(s, parse("I8"));
  assert.equal(observations(s, "stop-five")[0].success, true);
  assert.equal(objective(s, "recover-after-defense").status, "not-observed");
  assert.equal(s.status, "reply");
  s = applyJourneyReply(s, parse("K10"));
  s = playJourneyMove(s, parse("I9"));
  assert.equal(objective(s, "recover-after-defense").status, "achieved");
  assert.equal(objective(s, "force-four").status, "achieved");
  assert.equal(s.completed, false);
});

test("an actual white counter is shown, with a verified fork witness and no automatic black answers", () => {
  let s = fromPosition("A1 C1 E1", "F8 G8 H8");
  s = playJourneyMove(s, parse("A3"));
  assert.equal(s.mistakes[0].kind, "allow-fork");
  const witness = s.mistakes[0].evidence.line;
  const board = [...s.board];
  witness.forEach((i, n) => {
    assert.equal(board[i], 0);
    board[i] = n % 2 ? 1 : 2;
  });
  assert.ok(winningLine(board, witness.at(-1)).length >= 5);
  s = applyJourneyReply(s, witness[0]);
  assert.equal(getJourneyView(s).feedback.kind, "actual-counter");
  assert.equal(getJourneyView(s).feedback.facts.actualReply, witness[0]);
  assert.equal(s.turn, 1);
  s = playJourneyMove(s, witness[1]);
  assert.equal(observations(s, "stop-five").at(-1).outcome, "unknown");
  assert.equal(
    s.mistakes.length,
    1,
    "already unavoidable position does not add another blame event",
  );
  s = applyJourneyReply(s, witness[2]);
  assert.equal(result(s).result, "loss");
  assert.equal(getJourneyView(s).retryPly, 6);
  s = retryJourney(s);
  assert.equal(s.moves.length, 6);
  assert.equal(s.completed, false);
  assert.equal(s.retries, 1);
  assert.equal(s.mistakes.length, 1);
  assert.equal(s.mistakes[0].retracted, true);
  s = playJourneyMove(s, parse("E8"));
  assert.equal(observations(s, "prevent-fork").at(-1).success, true);
  assert.equal(result(s).assisted, true);
});

test("an immediate white win is recorded only after the real reply", () => {
  let s = fromPosition("D8 A1 C1 E1", "E8 F8 G8 H8");
  s = playJourneyMove(s, parse("A3"));
  assert.equal(s.mistakes[0].kind, "miss-block");
  assert.equal(s.completed, false);
  s = applyJourneyReply(s, parse("I8"));
  assert.equal(s.winner, 2);
  assert.equal(s.completed, true);
});

test("review recovery requires its legal source history and preserves the source record", () => {
  const initialMoves = history("D8 I6 I7 A1", "E8 F8 G8 H8");
  const record = {
    rule: "freestyle15",
    moves: [...initialMoves, parse("A3"), parse("I8")],
  };
  const review = {
    id: "9:miss-block",
    recordId: "source-1",
    ply: 9,
    before: Array.from(boardFrom(initialMoves)),
    actual: parse("A3"),
    alternatives: [parse("I8")],
  };
  const untouched = JSON.stringify({ record, review });
  let s = createJourney("defend", {
    initialMoves: record.moves.slice(0, review.ply - 1),
    sourceReview: review,
  });
  assert.equal(result(s).origin, "review");
  assert.equal(result(s).startPly, 8);
  assert.equal(result(s).fromOpening, false);
  assert.equal(result(s).assisted, true);
  s = pairs(s, [
    ["I8", "K10"],
    ["I9", "I10"],
  ]);
  assert.equal(s.moves.length, 12);
  assert.equal(s.completed, false);
  assert.equal(JSON.stringify({ record, review }), untouched);
  assert.throws(() =>
    createJourney("defend", {
      initialMoves: initialMoves.slice(0, -2),
      sourceReview: review,
    }),
  );
  assert.throws(() =>
    createJourney("defend", { initialMoves: initialMoves.slice(0, -1) }),
  );
});

test("saved journal restores evidence and retries, rejecting board, history and evidence corruption", () => {
  let s = pairs(createJourney("practice", { attemptId: "durable" }), [
    ["H8", "G7"],
    ["I8", "H7"],
  ]);
  s = markJourneyAssistance(s, "model-reference");
  s = retryJourney(s);
  s = pairs(s, [["H9", "G8"]]);
  const saved = JSON.parse(JSON.stringify(s));
  assert.deepEqual(restoreJourney(saved), s);
  assert.deepEqual(result(restoreJourney(saved)), result(s));
  const reordered = Object.fromEntries(Object.entries(saved).reverse());
  assert.deepEqual(restoreJourney(reordered), s);
  for (const corrupt of [
    (x) => {
      x.board[0] = 2;
    },
    (x) => {
      x.moves[0] = parse("A1");
    },
    (x) => {
      x.assisted = false;
    },
    (x) => {
      x.retries = 0;
    },
    (x) => {
      x.opportunities.push({ objectiveId: "finish-five" });
    },
    (x) => {
      x.journal[1].i = x.journal[0].i;
    },
    (x) => {
      x.config.initialMoves = [1, 1];
    },
  ]) {
    const bad = JSON.parse(JSON.stringify(saved));
    corrupt(bad);
    assert.throws(() => restoreJourney(bad));
  }
});

test("retry keeps the decision context while retracting goals from the abandoned branch", () => {
  let s = pairs(createJourney("build"), [
    ["J8", "A1"],
    ["H10", "C1"],
    ["H8", "I8"],
  ]);
  s = playJourneyMove(s, parse("H9"));
  s = retryJourney(s, 6);
  assert.equal(objective(s, "switch-direction").status, "not-observed");
  s = playJourneyMove(s, parse("H9"));
  assert.equal(objective(s, "switch-direction").status, "achieved");
  assert.equal(
    result(s).opportunities.filter((o) => o.objectiveId === "switch-direction")
      .length,
    2,
  );
  assert.equal(s.retries, 1);
});

test("practice conceals ongoing coach facts and keeps assistance and configured opening variants distinct", () => {
  const plain = createJourney("practice");
  assert.equal(result(plain).assisted, false);
  assert.equal(result(createJourney("build")).assisted, true);
  let s = pairs(plain, [
    ["J8", "A1"],
    ["H10", "C1"],
    ["H8", "I8"],
  ]);
  assert.ok(s.feedback.highlights.length);
  assert.deepEqual(getJourneyView(s).highlights, []);
  assert.equal(getJourneyView(s).feedback.kind, "play");
  s = retryJourney(s);
  assert.equal(result(s).assisted, true);
  assert.equal(
    result(restoreJourney(JSON.parse(JSON.stringify(s)))).assisted,
    true,
  );
  for (const replyVariant of ["H7", "G7", "H6"]) {
    let seeded = createJourney("practice", { replyVariant });
    seeded = playJourneyMove(seeded, parse("H8"));
    assert.equal(
      getJourneyView(seeded).replyConfig.openingMove,
      parse(replyVariant),
    );
    seeded = applyJourneyReply(seeded, parse(replyVariant));
    assert.equal(result(seeded).white.kind, "seeded-opening");
    assert.equal(result(seeded).openingOverride.variant, replyVariant);
  }
  const occupied = playJourneyMove(
    createJourney("practice", { replyVariant: "G7" }),
    parse("G7"),
  );
  assert.equal(getJourneyView(occupied).replyConfig.openingMove, null);
  assert.equal(
    result(applyJourneyReply(occupied, parse("H8"))).white.kind,
    "natural",
  );
});

test("illegal turns, repeated moves and play after terminal positions are rejected", () => {
  const empty = createJourney("build");
  assert.throws(() => applyJourneyReply(empty, parse("H8")));
  const black = playJourneyMove(empty, parse("H8"));
  assert.throws(() => playJourneyMove(black, parse("G8")));
  assert.throws(() => applyJourneyReply(black, parse("H8")));
  assert.throws(() => playJourneyMove(empty, -1));
  assert.throws(() =>
    createJourney("build", { initialMoves: points("H8 H7 H8 G7") }),
  );
  assert.throws(() =>
    createJourney("build", {
      initialMoves: points("F8 A1 G8 C1 H8 E1 I8 G1 J8 H1"),
    }),
  );
});

test("guided instructions progress from one stone to an actionable two-direction comparison", () => {
  let s = createJourney("build");
  assert.match(getJourneyView(s).instruction.title, /最初/);
  s = pairs(s, [["H8", "A1"]]);
  const one = getJourneyView(s).instruction;
  assert.match(one.title, /一つつな/);
  assert.match(one.text, /H8/);
  assert.doesNotMatch(one.title, /二方向/);
  s = pairs(s, [["G8", "C1"]]);
  const two = getJourneyView(s).instruction;
  assert.match(two.title, /二方向/);
  assert.match(two.text, /異なる方向/);
  assert.match(two.text, /[A-O][0-9]+/);
  const before = JSON.stringify(s);
  const connecting = previewJourneyMove(s, parse("H9"));
  assert.equal(connecting.title, "二方向につながる");
  assert.match(connecting.text, /G8.*H8|H8.*G8/);
  assert.match(connecting.text, /縦/);
  assert.equal(connecting.board[parse("H9")], 1);
  assert.equal(connecting.hypothetical, true);
  const distant = previewJourneyMove(s, parse("O15"));
  assert.notEqual(distant.title, connecting.title);
  assert.equal(distant.facts.assessment, "unknown");
  assert.equal(JSON.stringify(s), before);
  assert.equal(objective(s, "two-directions").status, "not-observed");
});

test("guided instruction names the blocked and remaining directions and then the defended stone", () => {
  let s = pairs(createJourney("build"), [
    ["J8", "A1"],
    ["H10", "C1"],
    ["H8", "I8"],
  ]);
  assert.match(getJourneyView(s).instruction.text, /I8.*横.*縦/);
  assert.match(getJourneyView(s).instruction.title, /縦/);
  assert.match(getJourneyView(s).feedback.text, /I8.*横.*縦/);
  const preview = previewJourneyMove(s, parse("H9"));
  assert.equal(preview.kind, "switch-direction");
  assert.match(preview.text, /H8.*縦/);
  s = fromPosition("D8 I6 I7 A1", "E8 F8 G8 H8");
  s = pairs(s, [["I8", "K10"]]);
  assert.equal(getJourneyView(s).instruction.title, "受けた石を使う");
  assert.match(getJourneyView(s).instruction.text, /I8.*I[67]/);
});

test("preview identifies concrete opponent threats without recording a mistake or presenting a winning guarantee", () => {
  const s = fromPosition("A1 C1 E1", "F8 G8 H8");
  const before = JSON.stringify(s);
  const exposed = previewJourneyMove(s, parse("A3"));
  assert.equal(exposed.kind, "allow-fork");
  assert.match(exposed.text, /白E8.*D8.*I8/);
  const prevented = previewJourneyMove(s, parse("E8"));
  assert.equal(prevented.kind, "prevent-fork");
  assert.match(prevented.text, /黒E8/);
  assert.equal(JSON.stringify(s), before);
  assert.equal(s.mistakes.length, 0);
  assert.equal(s.opportunities.length, 0);
  assert.equal(previewJourneyMove(s, parse("F8")), null);
});

test("practice provides neither instructions nor previews and keeps its unaided result", () => {
  const s = pairs(createJourney("practice"), [["H8", "G7"]]);
  const before = JSON.stringify(s);
  assert.equal(getJourneyView(s).instruction, null);
  assert.equal(previewJourneyMove(s, parse("I8")), null);
  assert.equal(JSON.stringify(s), before);
  assert.equal(result(s).assisted, false);
});

test("branch practice starts with the known legal setup and requires the player to switch, force and finish", () => {
  for (const [variant, continuation, whiteBlock, finish, blockedAxis] of [
    ["E8", "H5", "H9", "H4", 0],
    ["I8", "H9", "H5", "H10", 0],
    ["H5", "E8", "I8", "D8", 1],
    ["H9", "I8", "E8", "J8", 1],
  ]) {
    let s = createJourney("branch", {
      attemptId: `branch:${variant}`,
      replyVariant: variant,
    });
    const initial = result(s);
    assert.equal(initial.startPly, 8);
    assert.equal(initial.fromOpening, false);
    assert.equal(initial.origin, "position");
    assert.equal(initial.sourceProblemId, "two-direction-fork");
    assert.equal(initial.assisted, true);
    assert.deepEqual(initial.achievedObjectives, []);
    assert.equal(initial.goalMet, false);
    s = playJourneyMove(s, parse("H8"));
    assert.equal(getJourneyView(s).replyConfig.teachingMove, parse(variant));
    assert.equal(getJourneyView(s).replyConfig.openingMove, null);
    s = applyJourneyReply(s, parse(variant));
    assert.equal(s.pendingSwitch.scope, "blocked-open-three-then-other-four");
    assert.deepEqual(result(s).branchOverride.blockedAxes, [blockedAxis]);
    assert.equal(result(s).white.kind, "teaching-branch");
    assert.equal(objective(s, "switch-direction").status, "not-observed");
    assert.match(
      getJourneyView(s).instruction.text,
      /両端四への伸びが止まった/,
    );
    const compared = previewJourneyMove(s, parse(continuation));
    assert.equal(compared.kind, "switch-direction");
    assert.match(compared.text, /残った.*三を四/);
    s = playJourneyMove(s, parse(continuation));
    assert.equal(objective(s, "switch-direction").status, "achieved");
    assert.equal(objective(s, "force-four").status, "achieved");
    assert.equal(
      observations(s, "switch-direction")[0].evidence.scope,
      "blocked-open-three-then-other-four",
    );
    assert.equal(result(s).goalMet, false);
    assert.equal(getJourneyView(s).replyConfig.teachingMove, null);
    s = applyJourneyReply(s, parse(whiteBlock));
    s = playJourneyMove(s, parse(finish));
    assert.equal(result(s).winner, 1);
    assert.equal(result(s).goalMet, true);
    assert.equal(result(s).fromOpening, false);
    assert.deepEqual(restoreJourney(JSON.parse(JSON.stringify(s))), s);
  }
});

test("teaching reply is withheld if the human did not create the actual two-direction threes", () => {
  for (const move of ["A1", "E8", "H9", "I8"]) {
    let s = createJourney("branch", { replyVariant: "E8" });
    s = playJourneyMove(s, parse(move));
    assert.equal(getJourneyView(s).replyConfig.teachingMove, null);
    assert.equal(getJourneyView(s).replyConfig.kind, "natural");
    if (move !== "E8") {
      s = applyJourneyReply(s, parse("E8"));
      assert.equal(result(s).branchOverride, null);
      assert.equal(result(s).white.kind, "natural");
      assert.equal(objective(s, "switch-direction").status, "not-observed");
    }
  }
});

test("a white move near a three, or a partial loss of only one extension, does not invent a direction switch", () => {
  for (const reply of ["A3", "D8"]) {
    let s = createJourney("branch");
    s = pairs(s, [["H8", reply]]);
    assert.equal(s.pendingSwitch, null);
    s = playJourneyMove(s, parse("H5"));
    assert.equal(objective(s, "switch-direction").status, "not-observed");
    assert.equal(result(s).branchOverride, null);
  }
});

test("a blocked open three can switch to an existing closed three's real four without claiming an open-four win", () => {
  let s = fromPosition("F8 G8 H6 H7", "B3 D4 K12 H9", "build");
  s = pairs(s, [["H8", "E8"]]);
  assert.equal(s.pendingSwitch.kind, "threat-continuation");
  assert.deepEqual(s.pendingSwitch.blockedAxes, [0]);
  s = playJourneyMove(s, parse("H5"));
  assert.equal(objective(s, "switch-direction").status, "achieved");
  assert.equal(objective(s, "force-four").status, "achieved");
  const four = observations(s, "force-four").at(-1);
  assert.deepEqual(four.evidence.points, [parse("H4")]);
  assert.equal(s.completed, false);
});

test("blocking the outside of a broken three also requires a real other-direction four", () => {
  let s = fromPosition("F8 H8 H6 H7", "B3 D4 K12 M13", "build");
  s = pairs(s, [["I8", "E8"]]);
  assert.equal(s.pendingSwitch.kind, "threat-continuation");
  assert.deepEqual(s.pendingSwitch.blockedAxes, [0]);
  assert.ok(
    s.pendingSwitch.blockedShapes.some(
      (g) =>
        g.cells.includes(parse("F8")) &&
        g.cells.includes(parse("H8")) &&
        g.cells.includes(parse("I8")),
    ),
  );
  s = playJourneyMove(s, parse("H9"));
  assert.equal(objective(s, "switch-direction").status, "achieved");
  assert.equal(objective(s, "force-four").status, "achieved");
  assert.equal(result(s).goalMet, false);
});

test("retry reopens the real branch decision and keeps the prescribed-response evidence only on the retained line", () => {
  let s = pairs(createJourney("branch", { replyVariant: "E8" }), [
    ["H8", "E8"],
    ["H5", "H9"],
  ]);
  s = retryJourney(s, 10);
  assert.equal(s.pendingSwitch.scope, "blocked-open-three-then-other-four");
  assert.equal(objective(s, "switch-direction").status, "not-observed");
  assert.equal(result(s).branchOverride.variant, "E8");
  s = playJourneyMove(s, parse("H9"));
  assert.equal(objective(s, "switch-direction").status, "achieved");
  s = retryJourney(s, 8);
  assert.equal(result(s).branchOverride, null);
  assert.equal(result(s).assisted, true);
});

test("ordinary three/four construction belongs to conditions, never quiet preparation proof", () => {
  let s = pairs(createJourney("build"), [
    ["J8", "A1"],
    ["H10", "C1"],
    ["H8", "I8"],
    ["H9", "E1"],
  ]);
  assert.equal(observations(s, "build-threat").at(-1).unitId, "conditions");
  assert.equal(
    s.opportunities.some((o) => o.unitId === "prepare"),
    false,
  );
  assert.equal(
    journeyTracks.find((t) => t.id === "build").unitIds.includes("prepare"),
    false,
  );
});

test("branch instruction lights the real surviving three and its extensions instead of only the last white stone", () => {
  const s = pairs(createJourney("branch"), [["H8", "E8"]]);
  const v = getJourneyView(s);
  assert.match(v.instruction.title, /縦.*四/);
  assert.deepEqual(v.highlights, v.instruction.highlights);
  const cells = [...new Set(v.highlights.flatMap((h) => h.cells))].sort(
    (a, b) => a - b,
  );
  assert.deepEqual(
    cells,
    points("H6 H7 H8").sort((a, b) => a - b),
  );
  assert.ok(
    v.highlights.every(
      (h) => h.motif && h.scope === "verified-four-continuation",
    ),
  );
  assert.ok(
    v.highlights.some(
      (h) => h.points.includes(parse("H5")) && h.points.includes(parse("H9")),
    ),
  );
  assert.ok(!cells.includes(parse("E8")));
  assert.ok(
    v.highlights.every((h) => h.lines.every((line) => line.length === 3)),
  );
});

test("priority guidance lights the actual four belonging to the side that must be considered first", () => {
  const win = getJourneyView(fromPosition("F8 G8 H8 I8", "F6 G6 H6 I6"));
  assert.equal(win.instruction.title, "自分の五を先に");
  assert.ok(
    win.highlights.every(
      (h) =>
        h.motif &&
        h.tone === "good" &&
        h.cells.every((i) => win.board[i] === 1),
    ),
  );
  assert.ok(win.highlights.some((h) => h.points.includes(parse("J8"))));
  const defense = getJourneyView(fromPosition("D8 A1 C1 E1", "E8 F8 G8 H8"));
  assert.equal(defense.instruction.title, "白の五を先に受ける");
  assert.ok(
    defense.highlights.every(
      (h) =>
        h.motif &&
        h.tone === "danger" &&
        h.cells.every((i) => defense.board[i] === 2),
    ),
  );
  assert.ok(defense.highlights.some((h) => h.points.includes(parse("I8"))));
});

test("a verified upcoming double attack lights existing white lines and the critical empty junction", () => {
  const s = fromPosition("E5 G7 D11 K12 B3 L6", "H5 H6 H7 F8 G8 I8");
  const v = getJourneyView(s);
  assert.equal(v.instruction.title, "白の次の四を読む");
  const junction = v.highlights.find((h) => h.critical === parse("H8"));
  assert.ok(junction);
  assert.equal(junction.scope, "verified-next-white-fork");
  assert.ok(junction.lines.length >= 2);
  assert.ok(
    junction.lines.every(
      (line) => line.length >= 3 && line.every((i) => v.board[i] === 2),
    ),
  );
  assert.ok(junction.points.every((i) => !v.board[i]));
  assert.equal(
    junction.cells.includes(parse("H8")),
    false,
    "the future white stone is not fabricated as an existing stone",
  );
});

test("geometric guidance has focus markers only, while a real three using the defended stone has motif glow", () => {
  const geometric = getJourneyView(
    pairs(createJourney("build"), [
      ["H8", "A1"],
      ["G8", "C1"],
    ]),
  );
  assert.ok(geometric.highlights.length);
  assert.ok(
    geometric.highlights.every(
      (h) => h.motif === false && h.tone === "focus" && !h.lines,
    ),
  );
  assert.ok(
    geometric.highlights.every(
      (h) =>
        h.cells.every((i) => geometric.board[i] === 1) &&
        h.points.every((i) => !geometric.board[i]),
    ),
  );
  const recovered = getJourneyView(
    pairs(fromPosition("D8 I6 I7 A1", "E8 F8 G8 H8"), [["I8", "K10"]]),
  );
  assert.equal(recovered.instruction.title, "受けた石を使う");
  assert.ok(
    recovered.highlights.some(
      (h) => h.motif && points("I6 I7 I8").every((i) => h.cells.includes(i)),
    ),
  );
  const unaided = getJourneyView(
    pairs(createJourney("practice"), [
      ["J8", "A1"],
      ["H10", "C1"],
      ["H8", "I8"],
    ]),
  );
  assert.equal(unaided.instruction, null);
  assert.deepEqual(unaided.highlights, []);
});
