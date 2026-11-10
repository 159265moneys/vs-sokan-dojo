import test from "node:test";
import assert from "node:assert/strict";
import { trainingLessons, lessonBoard } from "../dist/lessons.js";
import {
  coord,
  parse,
  winner,
  winningLine,
  winningMoves,
} from "../dist/game.js";
import {
  makeTrainingPosition,
  createTrainingState,
  judgeTrainingMove,
  trainingAnswers,
  openFourMoves,
  createTacticalPosition,
} from "../dist/training-positions.js";

const lesson = (id) => trainingLessons.find((l) => l.id === id);
const count = (b, c) => Array.from(b).filter((x) => x === c).length;
function exhaustiveForkMoves(input, color) {
  const b = input.slice(),
    result = [];
  for (let i = 0; i < 225; i++)
    if (!b[i]) {
      b[i] = color;
      if (!winningLine(b, i).length && winningMoves(b, color).length >= 2)
        result.push(i);
      b[i] = 0;
    }
  return result;
}

test("translated training positions preserve legal counts, authored moves and scoped answers", () => {
  const diversity = new Map(trainingLessons.map((l) => [l.id, new Set()]));
  for (const l of trainingLessons)
    for (let seed = 0; seed < 32; seed++) {
      const p = makeTrainingPosition(l, {
        seed: `placement-${seed}`,
        transform: seed % 8,
      });
      assert.equal(count(p.board, 1), l.black.length, l.id);
      assert.equal(count(p.board, 1), count(p.board, 2), l.id);
      assert.equal(winner(p.board), 0, l.id);
      assert.equal(p.metadata.completeStrategy, false);
      assert(p.answers.length > 0, l.id);
      assert(p.answers.every((i) => !p.board[i]));
      p.answers.forEach((i) => diversity.get(l.id).add(i));
      const b = p.board.slice();
      for (let j = 0; j < p.steps.length; j++) {
        assert.equal(b[p.steps[j].i], 0, l.id);
        assert.equal(winner(b), 0, l.id);
        b[p.steps[j].i] = (j % 2) + 1;
      }
      if (p.metadata.goalType === "force-win") assert.equal(winner(b), 1, l.id);
      else if (p.metadata.goalType === "stop-five") {
        for (const i of p.answers) {
          const defended = p.board.slice();
          defended[i] = 1;
          assert.equal(winningMoves(defended, 2).length, 0);
        }
      }
    }
  for (const id of ["doublefour", "chain", "overline"]) {
    assert(
      diversity.get(id).size >= 16,
      `${id}: no fixed-center answer shortcut`,
    );
  }
});

test("seeded variant is reproducible, including relocated filler and translated text", () => {
  const a = makeTrainingPosition(lesson("chain"), {
    seed: "same",
    transform: 2,
  });
  const b = makeTrainingPosition(lesson("chain"), {
    seed: "same",
    transform: 2,
  });
  assert.deepEqual(a, b);
  assert.equal(a.steps[0].text.includes(coord(a.steps[1].i)), true);
  assert.equal(a.metadata.transform, 2);
});

test("mastery variant identity ignores filler and duplicate symmetries, but tracks tactical relocation", () => {
  const a = makeTrainingPosition(lesson("chain"), {
    seed: "same-core-9",
    transform: 0,
  });
  const b = makeTrainingPosition(lesson("chain"), {
    seed: "same-core-16",
    transform: 0,
  });
  assert.equal(a.metadata.dx, b.metadata.dx);
  assert.equal(a.metadata.dy, b.metadata.dy);
  assert.notDeepEqual(a.board, b.board, "the harmless filler actually differs");
  assert.equal(
    a.variantId,
    b.variantId,
    "same tactical recall must count only once",
  );
  const shifted = makeTrainingPosition(lesson("chain"), {
    seed: "different-core",
    transform: 0,
  });
  assert.notDeepEqual(a.answers, shifted.answers);
  assert.notEqual(a.variantId, shifted.variantId);

  const symmetric = makeTrainingPosition(lesson("openfour"), {
    seed: "symmetric",
    transform: 0,
  });
  let reflection;
  for (let seed = 0; seed < 500; seed++) {
    const p = makeTrainingPosition(lesson("openfour"), { seed, transform: 4 });
    if (
      p.metadata.dx === symmetric.metadata.dx &&
      p.metadata.dy === symmetric.metadata.dy
    ) {
      reflection = p;
      break;
    }
  }
  assert(reflection, "fixture must include the identical reflected core");
  assert.deepEqual(
    [...symmetric.answers].sort((a, b) => a - b),
    [...reflection.answers].sort((a, b) => a - b),
  );
  assert.equal(
    symmetric.variantId,
    reflection.variantId,
    "a symmetric reorientation is not a new tactical layout",
  );
});

test("attack training requires every black move, handles both endpoints and accepts equivalent finishes", () => {
  for (const id of ["five", "openfour", "doublefour", "chain", "overline"]) {
    const p = makeTrainingPosition(lesson(id), { seed: `branches-${id}` });
    const whiteEndpoints = new Set();
    for (let defenseChoice = 0; defenseChoice < 4; defenseChoice++) {
      let s = createTrainingState(p, { defenseChoice });
      let blackMoves = 0;
      while (!s.done) {
        assert(blackMoves < 6, id);
        const before = s.board.slice(),
          actual = s.answers.at(-1);
        const r = judgeTrainingMove(s, actual);
        assert(r.correct);
        assert.deepEqual(s.board, before, "transition must not mutate input");
        const afterBlack = before.slice();
        afterBlack[actual] = 1;
        if (r.whiteMove !== null) {
          whiteEndpoints.add(r.whiteMove);
          // Exhaust every legal white response, not just the generated line.
          for (let d = 0; d < 225; d++)
            if (!afterBlack[d]) {
              afterBlack[d] = 2;
              assert.equal(
                winningLine(afterBlack, d).length,
                0,
                "white cannot win first",
              );
              if (d !== r.whiteMove && !winningMoves(afterBlack, 1).length) {
                assert(
                  trainingAnswers(afterBlack, "force-win").length > 0,
                  "a non-immediate branch must still be provably winnable",
                );
              }
              afterBlack[d] = 0;
            }
        }
        s = r.state;
        blackMoves++;
        if (!s.done)
          assert(s.answers.length > 0, "continuation cannot strand player");
      }
      assert.equal(winner(s.board), 1, id);
      if (id === "chain")
        assert.equal(blackMoves, 3, "first move alone is not a solved chain");
      if (id === "openfour" || id === "doublefour") assert.equal(blackMoves, 2);
    }
    if (["openfour", "doublefour", "chain"].includes(id))
      assert(whiteEndpoints.size >= 2, "vary endpoint defenses");
  }
});

test("live and broken three defense answers are exhaustive for preventing next open four", () => {
  for (const [id, expected] of [
    ["live-three", ["F8", "J8"]],
    ["broken-three", ["F8", "H8", "K8"]],
  ]) {
    const b = lessonBoard(lesson(id));
    assert.deepEqual(
      trainingAnswers(b, "prevent-open-four").sort((a, b) => a - b),
      expected.map(parse).sort((a, b) => a - b),
    );
    const initialForks = exhaustiveForkMoves(b, 2);
    assert(initialForks.length);
    assert.deepEqual(openFourMoves(b, 2), initialForks);
    // Independently test all 225 candidate black moves using the direct win checker.
    const valid = [];
    for (let i = 0; i < 225; i++)
      if (!b[i]) {
        b[i] = 1;
        if (!winningMoves(b, 2).length && !exhaustiveForkMoves(b, 2).length)
          valid.push(i);
        b[i] = 0;
      }
    assert.deepEqual(
      valid,
      expected.map(parse).sort((a, b) => a - b),
    );
    for (let seed = 0; seed < 8; seed++) {
      const p = makeTrainingPosition(lesson(id), { seed, transform: seed });
      for (const i of p.answers) {
        const r = judgeTrainingMove(createTrainingState(p), i);
        assert.equal(r.done, true);
        assert.equal(winningMoves(r.state.board, 2).length, 0);
        assert.equal(exhaustiveForkMoves(r.state.board, 2).length, 0);
      }
    }
  }
});

test("wrong answers give verifiable immediate refutations without changing the drill", () => {
  for (const id of ["block", "outside", "live-three", "broken-three"]) {
    const p = makeTrainingPosition(lesson(id), { seed: "refutation" });
    const s = createTrainingState(p),
      wrong = Array.from({ length: 225 }, (_, i) => i).find(
        (i) => !s.board[i] && !s.answers.includes(i),
      );
    const before = s.board.slice(),
      r = judgeTrainingMove(s, wrong);
    assert.equal(r.correct, false);
    assert.equal(r.done, false);
    assert.deepEqual(s.board, before);
    assert.equal(r.refutationColor, 2);
    assert.equal(before[r.refutation], 0);
    before[wrong] = 1;
    before[r.refutation] = 2;
    if (p.metadata.goalType === "stop-five")
      assert(winningLine(before, r.refutation).length);
    else assert(winningMoves(before, 2).length >= 2);
  }
});

test("record repair accepts every immediate win, unique defense, and rejects invalid or unavoidable losses", () => {
  const win = lessonBoard(lesson("openfour"), 1);
  // Position after black creates an open four has one extra black: add harmless white.
  win[parse("A3")] = 2;
  const p = createTacticalPosition({
    board: win,
    kind: "miss-win",
    id: "test",
  });
  assert.equal(p.answers.length, 2);
  for (const i of p.answers)
    assert.equal(judgeTrainingMove(createTrainingState(p), i).done, true);
  const defense = createTacticalPosition({
    board: lessonBoard(lesson("block")),
    kind: "miss-block",
  });
  assert.deepEqual(defense.answers, [parse("K8")]);
  assert.equal(
    judgeTrainingMove(createTrainingState(defense), parse("K8")).done,
    true,
  );
  assert.throws(() =>
    createTacticalPosition({ board: new Uint8Array(225), kind: "miss-win" }),
  );
  assert.throws(() =>
    createTacticalPosition({ board: win, kind: "miss-block" }),
  );
  assert.throws(() =>
    createTacticalPosition({ board: Uint8Array.of(1, 2), kind: "miss-win" }),
  );
  const terminal = win.slice();
  terminal[parse("K8")] = 1;
  assert.throws(() =>
    createTacticalPosition({ board: terminal, kind: "miss-win" }),
  );
});

test("identical recorded boards in different games count as one retrieval variant", () => {
  const board = lessonBoard(lesson("five"));
  const a = createTacticalPosition({
    board,
    kind: "miss-win",
    id: "game-one:8",
  });
  const b = createTacticalPosition({
    board,
    kind: "miss-win",
    id: "game-two:8",
  });
  assert.equal(a.variantId, b.variantId);
  assert.notEqual(
    a.metadata.sourceId,
    b.metadata.sourceId,
    "review provenance stays separate from mastery identity",
  );
  const changed = board.slice();
  changed[parse("A1")] = 0;
  changed[parse("A2")] = 2;
  const c = createTacticalPosition({
    board: changed,
    kind: "miss-win",
    id: "game-one:8",
  });
  assert.notEqual(a.variantId, c.variantId);
});
