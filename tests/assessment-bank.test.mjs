import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessmentProblems as assessments } from "../dist/assessment-bank.js";
import { units, problems } from "../dist/curriculum.js";
import { parse, coord, winner, winningMoves, proveVCF } from "../dist/game.js";
import {
  createAttempt,
  playLearningMove,
  answerLearningChoice,
  getLearningView,
  restoreLearningAttempt,
} from "../dist/learning.js";
import {
  createPathProgress,
  recordAttemptEvidence,
  unitStatus,
} from "../dist/learning-path.js";
import {
  empty,
  won,
  wins,
  fours,
  forks,
  vcf,
  allReplies,
  afterFirst,
  openThrees,
  fingerprint,
  exerciseCandidates,
  firstMoveCertificates,
} from "../scripts/generate-assessments.mjs";

const byId = new Map(assessments.map((p) => [p.id, p]));
function assertFrame(f, label) {
  assert.equal(f.board.length, 225, label);
  assert(f.text.trim(), `${label}: causal explanation missing`);
  if (f.last !== null) assert(f.board[f.last], `${label}: empty last point`);
  for (const h of f.highlights) {
    for (const i of h.cells)
      assert(f.board[i], `${label}: empty highlighted stone`);
    for (const i of h.points)
      assert.equal(f.board[i], 0, `${label}: occupied target`);
  }
}
function finish(p, first = p.guide[0], variant = 0, choice = null) {
  let s = createAttempt(p.id, {
    replyVariant: variant,
    attemptId: `assessment-test:${p.id}:${variant}:${first}:${choice}`,
  });
  if (p.kind !== "play")
    s = answerLearningChoice(
      s,
      choice || p.nodes[0].choices.find((c) => c.correct).id,
    );
  else s = playLearningMove(s, first);
  for (let n = 0; s.status === "choose" && n < 12; n++) {
    assert(s.guide.length, `${p.id}: continuation has no solution`);
    s = playLearningMove(s, s.guide[0]);
  }
  assert.equal(
    s.status,
    "solved",
    `${p.id}/${coord(first ?? 0)}/${variant}: ${JSON.stringify(s.feedback)}`,
  );
  if (p.completion === "five") assert.equal(winner(s.board), 1, p.id);
  if (p.requiresBranch)
    assert(
      s.history.some((m, i) => m.side === 2 && s.history[i + 1]?.side === 1),
      `${p.id}: no response after opponent`,
    );
  assert.equal(s.metrics.verifiedMistakes, 0, p.id);
  assert.equal(s.metrics.unknownSelections, 0, p.id);
  assert.equal(s.hints.uses, 0, p.id);
  return s;
}

test("36 assessments are isolated from lessons, with four genuine positions and at least two condition families per unit", () => {
  assert.equal(assessments.length, 36);
  assert.equal(new Set(assessments.map((p) => p.id)).size, 36);
  const seen = new Set(
    problems
      .filter((p) => p.role !== "assessment")
      .map((p) => fingerprint(p.board)),
  );
  for (const unit of units) {
    const ps = assessments.filter((p) => p.unitId === unit.id);
    assert.equal(ps.length, 4, unit.id);
    assert(new Set(ps.map((p) => p.family)).size >= 2, unit.id);
    assert(
      ps.every((p) => !unit.problemIds.includes(p.id)),
      `${unit.id}: answers leaked into lesson list`,
    );
  }
  for (const p of assessments) {
    assert.equal(p.role, "assessment");
    assert.equal(p.skillId, p.unitId);
    assert.equal(typeof p.requiresBranch, "boolean");
    assert(p.branchId);
    assert.equal(p.board.length, 225);
    assert.equal(p.sideToMove, 1);
    assert(p.board.every((c) => [0, 1, 2].includes(c)));
    assert.equal(
      p.board.filter((c) => c === 1).length,
      p.board.filter((c) => c === 2).length,
      p.id,
    );
    assert.equal(winner(p.board), 0, p.id);
    assert.equal(
      wins(p.board, 1).length > 0,
      !!p.intentionalImmediate?.black,
      p.id,
    );
    assert.equal(
      wins(p.board, 2).length > 0,
      !!p.intentionalImmediate?.white,
      p.id,
    );
    const key = fingerprint(p.board);
    assert(!seen.has(key), `${p.id}: D4/translation duplicate`);
    seen.add(key);
    assert(["original", "record"].includes(p.evidence.source));
    assert(p.evidence.scope && p.evidence.verification);
    assert.deepEqual(
      problems.find((v) => v.id === p.id),
      p,
      "versioned curriculum imports must expose the same verified problem data",
    );
    const s = createAttempt(p.id);
    assert.deepEqual(getLearningView(s).highlights, []);
    assert.deepEqual(s.history, []);
    assert.equal(getLearningView(s).hintText, "");
  }
});

test("all legal first moves agree with independent finite objectives and proven loss is accompanied by a legal terminal counterexample", () => {
  let decisions = 0,
    unknown = 0,
    refuted = 0;
  for (const p of assessments.filter((p) => p.kind === "play")) {
    const initial = createAttempt(p.id),
      snapshot = JSON.stringify(initial);
    for (const i of empty(p.board)) {
      const b = [...p.board];
      b[i] = 1;
      const s = playLearningMove(initial, i);
      decisions++;
      assert.equal(JSON.stringify(initial), snapshot, p.id);
      let expected;
      if (won(b, 1)) expected = true;
      else if (p.judge.firstObjective === "forcing-four" && !wins(b, 1).length)
        expected = false;
      else if (p.judge.kind === "prevent-fork")
        expected = !wins(b, 2).length && !forks(b, 2).length;
      else if (
        p.judge.kind === "open-four-first" &&
        (wins(b, 1).length < 2 || wins(b, 2).length)
      )
        expected = false;
      else if (p.judge.setups?.some((v) => v.move === i)) expected = true;
      else {
        const proof = afterFirst(p.board, i);
        expected =
          proof.status === "win"
            ? true
            : proof.status === "loss"
              ? false
              : null;
      }
      assert.equal(s.feedback.correct, expected, `${p.id}/${coord(i)}`);
      if (expected === true)
        assert(p.guide.includes(i), `${p.id}/${coord(i)}: omitted alternative`);
      else assert(!p.guide.includes(i), `${p.id}/${coord(i)}: incorrect guide`);
      for (const f of [...s.transitionFrames, ...s.refutationFrames])
        assertFrame(f, `${p.id}/${coord(i)}`);
      if (s.feedback.kind === "proven-loss") {
        refuted++;
        let previous = b;
        for (const f of s.refutationFrames) {
          const changes = f.board.flatMap((v, j) =>
            v !== previous[j] ? [j] : [],
          );
          assert(changes.length <= 1, `${p.id}: skipped refutation move`);
          if (changes.length) {
            assert.equal(previous[changes[0]], 0);
            assert.equal(winner(previous), 0);
          }
          previous = f.board;
        }
        assert.equal(winner(previous), 2, `${p.id}: unproved loss`);
      }
      if (expected === null) {
        unknown++;
        assert.equal(s.metrics.verifiedMistakes, 0);
        assert.equal(s.metrics.unknownSelections, 1);
        assert.equal(s.feedback.claim, "none");
      }
    }
  }
  assert(decisions > 6500);
  assert(unknown > 0);
  assert(refuted > 0);
});

test("every nonforcing accepted setup wins against every legal white reply, independently of authored replay choices", () => {
  let replies = 0;
  for (const p of assessments)
    for (const setup of p.judge.setups || []) {
      const result = allReplies(p.board, setup.move);
      assert.equal(result.length, setup.proof.replyCount, p.id);
      for (const r of result) {
        replies++;
        assert(r.proven, `${p.id}/${coord(setup.move)}/${coord(r.reply)}`);
        const b = [...p.board];
        b[setup.move] = 1;
        b[r.reply] = 2;
        assert.equal(winner(b), 0, p.id);
        assert.equal(
          proveVCF(b, 1, { maxPly: 9, maxNodes: 1600 }).proven,
          true,
          `${p.id}: independent solver disagreement`,
        );
        assert.deepEqual(winningMoves(b, 1), wins(b, 1));
      }
      assert(setup.replies.length >= 2, p.id);
      assert(
        setup.replies.every((i) => result.some((r) => r.reply === i)),
        p.id,
      );
    }
  assert.equal(
    replies,
    assessments
      .flatMap((p) => p.judge.setups || [])
      .reduce((sum, s) => sum + s.proof.replyCount, 0),
  );
});

test("all legal initial candidates are searched for forcing and all-reply setup certificates; no certified alternative is omitted", () => {
  for (const p of assessments.filter((p) => p.kind === "play")) {
    const result = firstMoveCertificates(p);
    const accepted = result
      .filter((r) => ["win", "setup", "local-goal"].includes(r.outcome))
      .map((r) => r.move)
      .sort((a, b) => a - b);
    assert.deepEqual(
      accepted,
      [...p.guide].sort((a, b) => a - b),
      p.id,
    );
  }
});

test("all authored alternatives and all displayed reply branches continue to five or the stated finite local goal", () => {
  for (const p of assessments) {
    if (p.kind === "play")
      for (const first of p.guide) {
        const replies =
          p.judge.setups?.find((s) => s.move === first)?.replies.length || 2;
        for (let v = 0; v < replies; v++) {
          const s = finish(p, first, v);
          if (p.unitId === "order") {
            let fourDecisions = 0;
            const b = [...p.board];
            for (const m of s.history) {
              b[m.i] = m.side;
              if (m.side === 1 && !won(b, 1) && wins(b, 1).length)
                fourDecisions++;
            }
            assert(
              fourDecisions >= 2,
              `${p.id}: order assessment did not require repeated fours`,
            );
          }
          assert(
            restoreLearningAttempt(JSON.parse(JSON.stringify(s))),
            `${p.id}: completed state failed restore`,
          );
          for (const f of s.transitionFrames) assertFrame(f, p.id);
        }
      }
    else
      for (const c of p.nodes[0].choices)
        for (let v = 0; v < (c.continuations?.length || 1); v++) {
          for (const f of c.frames) assertFrame(f, p.id);
          let s = answerLearningChoice(
            createAttempt(p.id, { replyVariant: v }),
            c.id,
          );
          if (!c.correct) {
            assert.equal(s.feedback.kind, "goal-miss");
            assert.equal(s.feedback.claim, "none");
            continue;
          }
          assert.equal(s.status, "choose");
          assert.equal(s.history.length, 2);
          assert(s.exercise);
          const candidates = exerciseCandidates([...s.board], s.exercise);
          assert(candidates.length);
          for (const i of empty(s.board)) {
            const next = playLearningMove(s, i);
            assert.equal(
              next.feedback.correct,
              candidates.includes(i),
              `${p.id}/${c.id}/${coord(i)}`,
            );
            assert.equal(
              next.feedback.kind,
              candidates.includes(i) ? "completed" : "goal-miss",
            );
          }
          finish(p, null, v, c.id);
        }
  }
});

test("four preparation positions have no initial four-making move and their stated quiet moves create neither a four nor an open three", () => {
  for (const p of assessments.filter((p) => p.unitId === "prepare")) {
    assert.equal(p.initialFourCount, 0);
    assert.deepEqual(fours(p.board, 1), [], p.id);
    for (const i of empty(p.board)) {
      const b = [...p.board];
      b[i] = 1;
      assert.deepEqual(wins(b, 1), [], `${p.id}/${coord(i)}`);
    }
    assert(p.quietSetupMoves.length);
    for (const first of p.quietSetupMoves) {
      const b = [...p.board];
      b[first] = 1;
      assert.deepEqual(wins(b, 1), []);
      assert.deepEqual(openThrees(b, 1, first), []);
      assert(
        p.judge.setups.some((s) => s.move === first),
        p.id,
      );
      const state = finish(p, first, 1);
      assert.equal(winner(state.board), 1);
    }
    assert.equal(
      p.guide[0],
      p.quietSetupMoves[0],
      "first hint preserves the intended quiet route",
    );
  }
});

test("practical positions come from four new complete legal self-play records and are not vacuously won by any first move", () => {
  const ps = assessments.filter((p) => p.unitId === "practice");
  assert.equal(new Set(ps.map((p) => p.evidence.sourceId)).size, 4);
  for (const p of ps) {
    assert.equal(p.evidence.source, "record");
    assert.equal(p.evidence.engine.searchMs, 150);
    assert(p.guide.length < empty(p.board).length / 2, p.id);
    let b = Array(225).fill(0);
    for (let k = 0; k < p.sourceRecord.length; k++) {
      const m = p.sourceRecord[k];
      assert.equal(m.side, (k % 2) + 1);
      assert.equal(b[m.i], 0);
      assert.equal(winner(b), 0);
      b[m.i] = m.side;
      if (k + 1 === p.sourceMoves.length) assert.deepEqual(b, p.board, p.id);
    }
    assert.equal(winner(b), 1, p.id);
    assert.deepEqual(
      p.sourceRecord.slice(0, p.sourceMoves.length),
      p.sourceMoves,
    );
  }
});

test("two unseen families with their actual response histories can supply initial evidence for every unit", () => {
  for (const unit of units) {
    const ps = assessments.filter((p) => p.unitId === unit.id),
      selected = [];
    for (const p of ps)
      if (!selected.some((q) => q.family === p.family)) selected.push(p);
    let progress = createPathProgress();
    for (const p of selected.slice(0, 2)) {
      const s = finish(p);
      progress = recordAttemptEvidence(progress, s, {
        ...p,
        at: "2026-11-11T10:00:00+09:00",
      });
    }
    assert.equal(unitStatus(progress, unit.id).initialConfirmed, true, unit.id);
    assert.equal(unitStatus(progress, unit.id).retained, false, unit.id);
  }
});

test("both defense families require preventing a real threat rather than substituting an immediate win", () => {
  const ps = assessments.filter((p) => p.unitId === "defense");
  assert.equal(ps.length, 4);
  assert.equal(byId.has("check-defense-race"), false);
  for (const p of ps) {
    assert.deepEqual(
      wins(p.board, 1),
      [],
      `${p.id}: an immediate win bypasses defense`,
    );
    assert.deepEqual(wins(p.board, 2), [], p.id);
    assert(forks([...p.board], 2).length, `${p.id}: no threat to prevent`);
    assert.equal(p.judge.kind, "prevent-fork");
    const completed = finish(p);
    assert.equal(
      winner(completed.board),
      0,
      `${p.id}: local prevention is not a win`,
    );
    assert.deepEqual(wins(completed.board, 2), [], p.id);
    assert.deepEqual(forks([...completed.board], 2), [], p.id);
  }
  const p = byId.get("check-defense-cross-straight");
  assert.deepEqual(forks([...p.board], 2).map(coord), ["I7"]);
  const expected = ["I8", "I7", "J7"].map(parse).sort((a, b) => a - b);
  assert.deepEqual(
    [...p.guide].sort((a, b) => a - b),
    expected,
  );
  for (const i of empty(p.board)) {
    const s = playLearningMove(createAttempt(p.id), i);
    assert.equal(s.status === "solved", expected.includes(i), coord(i));
    if (expected.includes(i)) assert.equal(s.feedback.claim, "local-goal");
    else {
      assert.equal(s.feedback.kind, "proven-loss", coord(i));
      assert.equal(winner(s.refutationFrames.at(-1).board), 2, coord(i));
    }
  }
});

test("priority separates winning now from stopping the only immediate loss, and both conditions are required for confirmation", () => {
  const ps = assessments.filter((p) => p.unitId === "priority");
  const own = ps.filter((p) => p.family === "priority/own-win-first");
  const defend = ps.filter(
    (p) => p.family === "priority/prevent-immediate-loss",
  );
  assert.equal(own.length, 2);
  assert.deepEqual(
    [...new Set(ps.map((p) => p.goal))],
    ["黒の一手を選ぶ"],
    "the prompt must not reveal which side of the priority decision applies",
  );
  assert.equal(defend.length, 2);
  assert.deepEqual(
    defend.map((p) => p.id),
    ["check-priority-defend-a", "check-priority-defend-b"],
  );
  assert(!byId.has("check-priority-options-a"));
  assert(!byId.has("check-priority-options-b"));
  for (const p of own) assert(wins(p.board, 1).length);
  for (const p of defend) {
    assert.deepEqual(wins(p.board, 1), []);
    const threat = wins(p.board, 2);
    assert.equal(threat.length, 1);
    assert.deepEqual(p.guide, threat);
    assert.equal(p.completion, "local-goal");
    assert.equal(p.requiresBranch, false);
    for (const i of empty(p.board)) {
      const s = playLearningMove(createAttempt(p.id), i);
      if (i === threat[0]) {
        assert.equal(s.status, "solved");
        assert.equal(s.feedback.claim, "local-goal");
        assert.equal(s.feedback.title, "白の五連を止めた");
        assert.match(s.feedback.text, /勝負は続く/);
        assert.equal(winner(s.board), 0);
        assert.deepEqual(wins(s.board, 2), []);
        assert.deepEqual(s.history, [{ i, side: 1 }]);
      } else {
        assert.equal(s.feedback.kind, "proven-loss");
        assert.equal(s.feedback.claim, "loss");
        const final = s.refutationFrames.at(-1);
        assert.equal(final.last, threat[0]);
        assert.equal(winner(final.board), 2);
      }
    }
  }
  for (const [sameCondition, otherCondition] of [
    [own, defend],
    [defend, own],
  ]) {
    let progress = createPathProgress();
    for (const p of sameCondition)
      progress = recordAttemptEvidence(progress, finish(p), {
        ...p,
        at: "2026-11-12T10:00:00+09:00",
      });
    assert.equal(
      unitStatus(progress, "priority").initialConfirmed,
      false,
      "two boards with the same priority decision are insufficient",
    );
    const p = otherCondition[0];
    progress = recordAttemptEvidence(progress, finish(p), {
      ...p,
      at: "2026-11-12T10:00:00+09:00",
    });
    assert.equal(unitStatus(progress, "priority").initialConfirmed, true);
  }
});

test("the separate basic lesson teaches and verifies the missing defensive priority without exposing an assessment board", () => {
  const lesson = JSON.parse(
    readFileSync(
      new URL("../docs/rebuild/PRIORITY-DEFENSE-LESSON.json", import.meta.url),
      "utf8",
    ),
  );
  const p = lesson.problem,
    threat = wins(p.board, 2);
  assert.equal(p.role, "lesson");
  assert.equal(p.family, "priority/prevent-immediate-loss");
  assert.equal(winner(p.board), 0);
  assert.deepEqual(wins(p.board, 1), []);
  assert.equal(threat.length, 1);
  assert.equal(
    p.board.filter((s) => s === 1).length,
    p.board.filter((s) => s === 2).length,
  );
  assert(
    !assessments.some((a) => fingerprint(a.board) === fingerprint(p.board)),
  );
  const checks = firstMoveCertificates(p);
  assert.deepEqual(
    checks.filter((c) => c.outcome === "local-goal").map((c) => c.move),
    threat,
  );
  for (const i of empty(p.board))
    if (i !== threat[0]) {
      const b = [...p.board];
      b[i] = 1;
      assert(!won(b, 1));
      b[threat[0]] = 2;
      assert(won(b, 2));
    }
  for (const f of [...lesson.lessonFrames, ...lesson.refutationExample.frames])
    assertFrame(f, p.id);
  assert.equal(winner(lesson.lessonFrames.at(-1).board), 0);
  assert.equal(winner(lesson.refutationExample.frames.at(-1).board), 2);
});
