import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  units,
  baseLessonProblems as allProblems,
  curriculumVersion,
} from "../dist/curriculum.js";
import {
  parse,
  coord,
  winner,
  winningLine,
  winningMoves,
  proveVCF,
  boardFrom,
} from "../dist/game.js";
import {
  createAttempt,
  playLearningMove,
  answerLearningChoice,
  getLearningView,
  getDemoFrames,
  hintLearning,
  retryLearning,
  restoreLearningAttempt,
  markLearningGuidance,
  createLearningProgress,
  recordLearningAttempt,
  recordLessonView,
  getLearningStats,
} from "../dist/learning.js";

const problems = allProblems.filter((p) => p.role !== "assessment");
const copy = (x) => JSON.parse(JSON.stringify(x));
const problem = (id) => problems.find((p) => p.id === id);
function solve(id, variant = 0, first = null, choiceId = null) {
  const p = problem(id);
  let s = createAttempt(id, {
    replyVariant: variant,
    attemptId: `${id}:${variant}:${first}:${choiceId}`,
  });
  if (getLearningView(s).input === "choice")
    s = answerLearningChoice(
      s,
      choiceId || p.nodes[0].choices.find((c) => c.correct).id,
    );
  if (first !== null) s = playLearningMove(s, first);
  for (let n = 0; s.status === "choose" && n < 20; n++) {
    assert.equal(getLearningView(s).input, "board", id);
    assert(s.guide.length, `${id}: missing continuation`);
    s = playLearningMove(s, s.guide[0]);
  }
  assert.equal(
    s.status,
    "solved",
    `${id}/${variant}/${first}: ${JSON.stringify(s.feedback)}`,
  );
  return s;
}
function assertFrame(frame, context) {
  assert.equal(frame.board.length, 225, context);
  assert(
    frame.board.every((c) => [0, 1, 2].includes(c)),
    context,
  );
  assert.equal(typeof frame.title, "string");
  assert(frame.text.trim().length > 0, `${context}: empty causal caption`);
  if (frame.last !== null)
    assert(frame.board[frame.last], `${context}: last is empty`);
  for (const h of frame.highlights) {
    assert(["focus", "danger", "good"].includes(h.tone));
    for (const i of h.cells)
      assert(frame.board[i], `${context}: highlighted stone ${i} is empty`);
    for (const i of h.points)
      assert.equal(frame.board[i], 0, `${context}: point ${i} is occupied`);
  }
}
function assertRefutation(start, frames) {
  let previous = start;
  for (const f of frames) {
    assertFrame(f, "refutation");
    const changed = f.board.flatMap((c, i) => (c !== previous[i] ? [i] : []));
    assert(changed.length <= 1, "dynamic proof must show every move");
    if (changed.length) {
      assert.equal(previous[changed[0]], 0);
      assert.equal(winner(previous), 0);
    }
    previous = f.board;
  }
  assert.equal(winner(previous), 2);
}

test("curriculum has nine stages, sparse basics, legal original positions and explanatory demonstrations", () => {
  assert.equal(units.length, 9);
  assert.equal(problems.length, 22);
  assert.equal(new Set(problems.map((p) => p.family)).size, 20);
  assert.equal(problems.filter((p) => p.unitId === "priority").length, 3);
  assert.equal(new Set(problems.map((p) => p.id)).size, problems.length);
  for (const p of problems) {
    assert.equal(p.board.length, 225, p.id);
    assert.equal(
      p.board.filter((c) => c === 1).length,
      p.board.filter((c) => c === 2).length,
      p.id,
    );
    assert.equal(winner(p.board), 0, p.id);
    if (p.unitId !== "priority")
      assert.equal(winningMoves([...p.board], 1).length, 0, p.id);
    if (!["priority"].includes(p.unitId) && p.id !== "defend-and-attack")
      assert.equal(winningMoves([...p.board], 2).length, 0, p.id);
    for (const n of p.nodes)
      for (const c of n.choices)
        c.frames.forEach((f) => assertFrame(f, `${p.id}/${c.id}`));
  }
  for (const unit of units) {
    assert(unit.problemIds.length > 0);
    assert(unit.lessonFrames.length >= 3 || unit.id === "priority");
    unit.lessonFrames.forEach((f) => assertFrame(f, `${unit.id} demo`));
    const isolated = getDemoFrames(unit.id);
    isolated[0].board.fill(2);
    assert.notDeepEqual(isolated[0].board, unit.lessonFrames[0].board);
  }
});

test("initial exercise has a populated board but no answer overlay; demos do not leak into attempt", () => {
  for (const p of problems) {
    const state = createAttempt(p.id),
      view = getLearningView(state);
    assert(view.board.some(Boolean));
    assert.deepEqual(view.highlights, []);
    assert.equal(view.hintText, "");
    assert.deepEqual(state.history, []);
    assert(view.choices.every((c) => !("correct" in c)));
    assert(!view.choices.some((c) => /二方向を残す|離れて置く/.test(c.title)));
    view.board.fill(2);
    assert.deepEqual(state.board, p.board);
  }
});

test("every authored answer and selected opponent variant continues to a valid completion", () => {
  for (const p of problems)
    for (let v = 0; v < 5; v++) {
      if (p.kind === "play")
        for (const first of p.guide) {
          const state = solve(p.id, v, first);
          if (p.completion === "five") {
            assert.equal(winner(state.board), 1, p.id);
            assert.equal(state.feedback.claim, "win");
            if (p.unitId !== "priority")
              assert(
                state.history.filter((m) => m.side === 1).length >= 2,
                p.id,
              );
          } else assert.equal(state.feedback.claim, "local-goal");
          const frozen = copy(state);
          assert.equal(playLearningMove(state, 0), state);
          assert.equal(hintLearning(state), state);
          assert.deepEqual(state, frozen);
        }
      else
        for (const choice of p.nodes[0].choices.filter((c) => c.correct))
          solve(p.id, v, null, choice.id);
    }
});

test("accepted first move is not completion; endpoint replies and alternate winning points both work", () => {
  let s = createAttempt("shared-point-order");
  s = playLearningMove(s, parse("H8"));
  assert.equal(s.status, "choose");
  assert.deepEqual(s.history, [
    { i: parse("H8"), side: 1 },
    { i: parse("J8"), side: 2 },
  ]);
  assert.equal(s.feedback.correct, true);
  assert.match(
    s.transitionFrames.at(-1).text,
    /白はJ8を塞ぎ、黒の五連を防いだ/,
  );
  assert.match(s.transitionFrames.at(-1).text, /縦の黒石/);
  assert(
    s.transitionFrames
      .at(-1)
      .highlights.some((h) =>
        ["H7", "H8", "H9"].every((label) => h.cells.includes(parse(label))),
      ),
  );
  for (const second of ["H6", "H10"]) {
    const next = playLearningMove(s, parse(second));
    assert.equal(next.status, "choose");
    assert.equal(next.history.length, 4);
    const wins = winningMoves([...next.board], 1);
    assert(wins.length);
    assert.match(next.transitionFrames.at(-1).text, /黒には.*勝ち口が残る/);
    assert.doesNotMatch(next.transitionFrames.at(-1).text, /危険/);
    for (const i of wins)
      assert.equal(playLearningMove(next, i).status, "solved");
  }
  const zero = playLearningMove(
    createAttempt("two-direction-fork", { replyVariant: 0 }),
    parse("H8"),
  );
  const one = playLearningMove(
    createAttempt("two-direction-fork", { replyVariant: 1 }),
    parse("H8"),
  );
  assert.equal(zero.history.at(-1).i, parse("E8"));
  assert.equal(one.history.at(-1).i, parse("H9"));
  assert.notDeepEqual(zero.guide, one.guide);
});

test("quiet preparation accepts both H8 and F8 and every white response has an independent continuation", () => {
  const p = problem("quiet-two-plans");
  assert.equal(
    proveVCF(p.board, 1, { maxPly: 7, maxNodes: 4000 }).proven,
    false,
  );
  for (const first of ["H8", "F8"]) {
    const b = [...p.board];
    b[parse(first)] = 1;
    let checked = 0;
    for (let i = 0; i < 225; i++)
      if (!b[i]) {
        const after = [...b];
        after[i] = 2;
        assert.equal(winner(after), 0);
        const proof = proveVCF(after, 1, { maxPly: 5, maxNodes: 4000 });
        assert.equal(proof.proven, true, `${first} / ${i}`);
        checked++;
      }
    assert.equal(checked, 208);
    assert.equal(
      playLearningMove(createAttempt(p.id), parse(first)).status,
      "choose",
    );
  }
});

test("two-direction setup covers all opponent moves, not only the displayed branch", () => {
  const p = problem("two-direction-fork"),
    b = [...p.board];
  b[parse("H8")] = 1;
  let checked = 0;
  for (let i = 0; i < 225; i++)
    if (!b[i]) {
      const after = [...b];
      after[i] = 2;
      const proof = proveVCF(after, 1, { maxPly: 3, maxNodes: 1000 });
      assert.equal(proof.proven, true, String(i));
      checked++;
    }
  assert.equal(checked, 216);
});

test("all first moves of early defense are scoped and verified, including changed-board alternatives", () => {
  for (const id of ["prevent-junction", "prevent-changed-arm"]) {
    const p = problem(id),
      accepted = [];
    for (let i = 0; i < 225; i++)
      if (!p.board[i]) {
        const state = playLearningMove(createAttempt(id), i);
        if (state.status === "solved") accepted.push(i);
        else {
          assert.equal(state.feedback.kind, "proven-loss", `${id}/${i}`);
          assertRefutation(state.board, state.refutationFrames);
        }
      }
    if (id === "prevent-junction") assert.deepEqual(accepted, [parse("H8")]);
    else
      for (const i of ["E8", "H8", "J8"].map(parse))
        assert(accepted.includes(i));
  }
});

test("unknown is not a loss, known counterplay is a real five, and local failure is separate", () => {
  const unknown = playLearningMove(
    createAttempt("shared-point-order"),
    parse("J8"),
  );
  assert.equal(unknown.status, "feedback");
  assert.equal(unknown.feedback.kind, "observation");
  assert.equal(unknown.feedback.title, "つなぎ目を取られる");
  assert.equal(unknown.feedback.correct, null);
  assert.equal(unknown.feedback.claim, "none");
  assert.equal(unknown.metrics.verifiedMistakes, 0);
  assert.equal(unknown.metrics.unknownSelections, 1);
  const loss = playLearningMove(
    createAttempt("defend-and-attack"),
    parse("G8"),
  );
  assert.equal(loss.feedback.kind, "proven-loss");
  assertRefutation(loss.board, loss.refutationFrames);
  const local = playLearningMove(createAttempt("three-room"), parse("F8"));
  assert.equal(local.feedback.kind, "goal-miss");
  assert.equal(local.feedback.claim, "none");
  const wrongClaim = answerLearningChoice(
    createAttempt("counter-four-claim"),
    "win",
  );
  assert.equal(wrongClaim.feedback.kind, "goal-miss");
  assert.equal(winner(wrongClaim.refutationFrames.at(-1).board), 2);
  assert.deepEqual(wrongClaim.history, []);
});

test("the four-three counterexample really forces black to lose after H8", () => {
  const b = [...problem("counter-four-claim").board];
  b[parse("H8")] = 1;
  b[parse("J8")] = 2;
  assert.deepEqual(winningMoves(b, 1), []);
  assert.deepEqual(winningMoves(b, 2), [parse("J9")]);
  for (let i = 0; i < 225; i++)
    if (!b[i]) {
      const after = [...b];
      after[i] = 1;
      assert.equal(winner(after), 0);
      if (i !== parse("J9")) {
        after[parse("J9")] = 2;
        assert.equal(winner(after), 2);
      } else {
        after[parse("H6")] = 2;
        for (let j = 0; j < 225; j++)
          if (!after[j]) {
            const defended = [...after];
            defended[j] = 1;
            assert.equal(winner(defended), 0);
            assert(winningMoves(defended, 2).length > 0);
          }
      }
    }
});

test("all public transitions preserve arguments, invalid operations are no-ops, and hints survive retry", () => {
  let s = createAttempt("shared-point-order", { attemptId: "immutable" });
  const original = copy(s),
    originalProblem = copy(problem(s.problemId));
  for (const i of [-1, 225, 1.5, NaN, "H8", parse("F8")])
    assert.equal(playLearningMove(s, i), s);
  assert.equal(answerLearningChoice(s, "win"), s);
  s = hintLearning(s);
  s = hintLearning(s);
  s = hintLearning(s);
  assert.equal(hintLearning(s), s);
  assert(getLearningView(s).hintText.length > 0);
  const hinted = copy(s),
    failed = playLearningMove(s, parse("J8"));
  assert.deepEqual(s, hinted);
  const retried = retryLearning(failed);
  assert.equal(retried.hints.level, 0);
  assert.equal(retried.hints.maxLevel, 3);
  assert.equal(retried.hints.uses, 3);
  assert.equal(retried.metrics.unknownSelections, 1);
  assert.equal(retried.metrics.retries, 1);
  assert.deepEqual(retried.board, original.board);
  assert.deepEqual(originalProblem, problem(s.problemId));
  assert.deepEqual(
    original,
    createAttempt("shared-point-order", { attemptId: "immutable" }),
  );
});

test("choice comparisons use separate input and result view matches its visible highlights", () => {
  let s = createAttempt("opening-two-plans");
  assert.equal(getLearningView(s).input, "choice");
  assert.equal(playLearningMove(s, parse("G9")), s);
  s = answerLearningChoice(s, "connect");
  assert.equal(s.status, "choose");
  assert.equal(getLearningView(s).input, "board");
  assert.equal(s.history.length, 2);
  s = playLearningMove(s, parse("I7"));
  assert.equal(s.status, "solved");
  assert.equal(s.feedback.claim, "comparison");
  for (const p of problems.filter((p) => p.kind !== "play")) {
    const result = solve(p.id),
      view = getLearningView(result);
    for (const h of view.highlights) {
      h.cells.forEach((i) => assert(view.board[i], p.id));
      h.points.forEach((i) => assert.equal(view.board[i], 0, p.id));
    }
    assert.deepEqual(view.board, result.transitionFrames.at(-1).board);
  }
});

test("opening continuation is judged by its shape, accepting every straight and broken alternative", () => {
  const cases = [
    ["connect", 0, ["E11", "F10", "I7", "J6"]],
    ["connect", 1, ["G6", "G7", "G10", "G11"]],
    ["three", 0, ["D8", "E8"]],
    ["three", 1, ["I8", "J8"]],
  ];
  for (const [choiceId, replyVariant, expected] of cases) {
    const state = answerLearningChoice(
      createAttempt("opening-two-plans", { replyVariant }),
      choiceId,
    );
    const snapshot = copy(state),
      accepted = [];
    const authored = problem("opening-two-plans").nodes[0].choices.find(
      (c) => c.id === choiceId,
    ).frames[0];
    assert.deepEqual(state.transitionFrames[0], authored);
    assert.match(
      state.transitionFrames[1].text,
      new RegExp(`白${coord(state.history.at(-1).i)}`),
    );
    state.transitionFrames.forEach((f) => {
      assertFrame(f, `${choiceId}/${replyVariant} comparison caption`);
      assert.doesNotMatch(f.text, /今すぐ五連になる点はない/);
    });
    assert(
      !("answers" in state.exercise),
      "goal must not depend on a fixed list",
    );
    for (let i = 0; i < 225; i++)
      if (!state.board[i]) {
        const result = playLearningMove(state, i);
        if (result.status === "solved") {
          accepted.push(i);
          assert.equal(result.feedback.claim, "comparison");
          assert.match(
            result.transitionFrames.at(-1).text,
            /を使い、.*[三四]を作った/,
          );
          assert.doesNotMatch(
            result.transitionFrames.at(-1).text,
            /今すぐ五連になる点はない/,
          );
          assertFrame(
            result.transitionFrames.at(-1),
            `${choiceId}/${replyVariant}/${i} outcome`,
          );
          assert(
            restoreLearningAttempt(copy(result)),
            `${choiceId}/${replyVariant}/${i}`,
          );
        } else {
          assert.equal(result.feedback.kind, "goal-miss");
          assert.equal(result.feedback.claim, "none");
        }
      }
    assert.deepEqual(
      accepted,
      expected.map(parse).sort((a, b) => a - b),
    );
    assert.deepEqual(state.guide, accepted);
    assert.deepEqual(state, snapshot);
  }
});

test("automatic continuation guidance is assistance without using a hint and survives save/retry", () => {
  let state = createAttempt("shared-point-order", { attemptId: "guided" });
  let progress = recordLearningAttempt(createLearningProgress(), state);
  state = playLearningMove(state, parse("H8"));
  const before = copy(state);
  const guided = markLearningGuidance(state);
  assert.deepEqual(state, before);
  assert.equal(guided.guidanceSeen, true);
  assert.equal(guided.hints.level, 0);
  assert.equal(guided.hints.uses, 0);
  assert.equal(markLearningGuidance(guided), guided);
  assert.equal(getLearningView(guided).guidanceSeen, true);
  progress = recordLearningAttempt(progress, guided);
  progress = recordLearningAttempt(progress, state); // a stale snapshot cannot erase assistance
  state = restoreLearningAttempt(copy(guided));
  assert(state.guidanceSeen);
  while (state.status === "choose")
    state = playLearningMove(state, state.guide[0]);
  assert.equal(
    markLearningGuidance(state),
    state,
    "post-completion explanation is not assistance",
  );
  progress = recordLearningAttempt(progress, state);
  const stats = getLearningStats(progress, { problemId: state.problemId });
  assert.equal(stats.completed, 1);
  assert.equal(stats.assistedCompleted, 1);
  assert.equal(stats.guidedCompleted, 1);
  assert.equal(stats.hintUses, 0);
  assert.equal(stats.firstTryUnaided, 0);
  assert.equal(stats.independentCompleted, 0);
  assert.equal(stats.familyFirstTryUnaided, 0);
  assert.equal(stats.lastOutcome, "assisted");
  assert.equal(stats.needsReview, true);
  assert.deepEqual(createLearningProgress(copy(progress)), progress);
  let failed = markLearningGuidance(createAttempt("shared-point-order"));
  failed = playLearningMove(failed, parse("J8"));
  assert(retryLearning(restoreLearningAttempt(copy(failed))).guidanceSeen);
});

test("saved state roundtrips and corrupted or incompatible states cannot grant a win", () => {
  for (const p of problems) {
    const start = createAttempt(p.id),
      solved = solve(p.id);
    assert(restoreLearningAttempt(copy(start)), p.id);
    assert(restoreLearningAttempt(copy(solved)), p.id);
    const mismatched = copy(solved);
    mismatched.board[0] = 99;
    assert.equal(restoreLearningAttempt(mismatched), null);
  }
  const forged = createAttempt("quiet-two-plans");
  forged.status = "solved";
  forged.feedback = {
    ...forged.feedback,
    kind: "completed",
    correct: true,
    claim: "win",
  };
  assert.equal(restoreLearningAttempt(forged), null);
  const old = createAttempt("quiet-two-plans");
  old.curriculumVersion = "legacy";
  assert.equal(restoreLearningAttempt(old), null);
  let pending = createAttempt("shared-point-order");
  pending = hintLearning(hintLearning(pending));
  pending = playLearningMove(pending, parse("J8"));
  const restoredFeedback = restoreLearningAttempt(copy(pending));
  assert(restoredFeedback);
  assert.equal(restoredFeedback.hints.level, 0);
  assert.equal(restoredFeedback.hints.maxLevel, 2);
  const retried = retryLearning(restoredFeedback);
  assert.equal(retried.hints.level, 0);
  assert.equal(retried.hints.uses, 2);
  assert.deepEqual(retried.board, problem("shared-point-order").board);
  assert.equal(retried.metrics.unknownSelections, 1);
});

test("progress records starts, is idempotent, and separates first exposure, hints, retry and unknown", () => {
  let progress = createLearningProgress();
  progress = recordLessonView(progress, "order");
  assert.equal(
    getLearningStats(progress, { unitId: "order" }).completedProblems,
    0,
  );
  let first = createAttempt("shared-point-order", { attemptId: "first" });
  progress = recordLearningAttempt(progress, first);
  first = hintLearning(first);
  progress = recordLearningAttempt(progress, first);
  while (first.status === "choose")
    first = playLearningMove(first, first.guide[0]);
  progress = recordLearningAttempt(progress, first);
  const duplicate = recordLearningAttempt(progress, first);
  assert.deepEqual(duplicate, progress);
  assert.deepEqual(
    recordLearningAttempt(
      progress,
      createAttempt("shared-point-order", { attemptId: "first" }),
    ),
    progress,
  );
  let stats = getLearningStats(progress, { problemId: "shared-point-order" });
  assert.equal(stats.started, 1);
  assert.equal(stats.completed, 1);
  assert.equal(stats.assistedCompleted, 1);
  assert.equal(stats.firstTryUnaided, 0);
  assert.equal(stats.needsReview, true);
  const second = solve("shared-point-order");
  second.attemptId = "second";
  progress = recordLearningAttempt(progress, second);
  stats = getLearningStats(progress, { problemId: "shared-point-order" });
  assert.equal(stats.firstTryUnaided, 0);
  assert.equal(stats.retryCompleted, 1);
  assert.equal(stats.completedProblems, 1);
  assert.equal(stats.needsReview, true);
  assert.equal(stats.lastOutcome, "unaided");
  let third = createAttempt("quiet-two-plans", { attemptId: "unknown" });
  progress = recordLearningAttempt(progress, third);
  third = playLearningMove(third, parse("H10"));
  assert.equal(third.feedback.kind, "unknown");
  progress = recordLearningAttempt(progress, third);
  assert.equal(
    getLearningStats(progress, { problemId: "quiet-two-plans" })
      .verifiedMistakes,
    0,
  );
  assert.equal(
    getLearningStats(progress, { problemId: "quiet-two-plans" })
      .unknownEncountered,
    1,
  );
  assert.deepEqual(createLearningProgress(copy(progress)), progress);
  assert.equal(
    createLearningProgress({ schemaVersion: 0, attempts: { old: {} } })
      .nextOrdinal,
    1,
  );
});

test("the three practical boards reproduce their original full histories", () => {
  const { courses } = JSON.parse(
    readFileSync(new URL("../dist/expert-courses.json", import.meta.url)),
  );
  for (const p of problems.filter((p) => p.evidence.source === "record")) {
    const record = courses.find((course) => course.id === p.evidence.sourceId);
    assert(record, `published source record exists: ${p.evidence.sourceId}`);
    const source = record.moves.slice(0, p.sourceMoves.length);
    assert.deepEqual(
      p.sourceMoves,
      source.map((m) => ({ i: m.i, side: m.side })),
    );
    assert.deepEqual(p.board, Array.from(boardFrom(source)));
    assert.equal(winner(p.board), 0);
    assert.equal(winningMoves([...p.board], 1).length, 0);
    assert.equal(winningMoves([...p.board], 2).length, 0);
  }
});
