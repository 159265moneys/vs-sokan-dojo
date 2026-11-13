import test, { before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { boardFrom, winner, winningMoves } from "../dist/game.js";
import { judgeReviewMove } from "../dist/causal-review.js";
import { provePatternMove } from "../dist/review-patterns.js";
import {
  extractRecordDrills, recordSourceHash, recordDrillFingerprint, verifyRecordDrill,
  startRecordDrill, playRecordDrill, hintRecordDrill, answerRecordDrill,
  retryRecordDrill, hideRecordDrillHints, getRecordDrillView, restoreRecordDrill, RECORD_DRILL_WORKER_VERSION,
} from "../dist/record-drills.js";
import { handleRecordDrillMessage } from "../dist/record-drill-worker.js";

const loss = JSON.parse(fs.readFileSync(new URL("./fixtures/record-drill-qa-loss-v7.json", import.meta.url)));
const courses = JSON.parse(fs.readFileSync(new URL("../dist/expert-courses.json", import.meta.url))).courses;
let lossQuestions, expertQuestions;
before(async () => {
  lossQuestions = await extractRecordDrills(loss);
  expertQuestions = [];
  for (const record of courses) {
    expertQuestions.push(...await extractRecordDrills({ ...record, rule: "freestyle15", level: "max" }, {
      sourceKind: "library", sourceId: record.id,
    }));
  }
});

function blind(q, s) {
  const view = getRecordDrillView(q, s);
  assert.equal(view.prompt, "次の一手を選ぶ");
  assert.deepEqual(view.highlights, []);
  assert.deepEqual(view.givens, []);
  assert.equal(view.feedback, null);
  assert.equal(view.completion, null);
  assert.deepEqual(view.explanationFrames, []);
  assert.deepEqual(view.refutationFrames, []);
  for (const key of ["patternType", "skillId", "kind", "goal", "alternatives", "evidence", "scope", "plan", "result"])
    assert.equal(Object.hasOwn(view, key), false, key);
  assert.equal(Object.hasOwn(view.source, "result"), false);
  assert.equal(Object.hasOwn(view.source, "moves"), false);
  assert.equal(Object.hasOwn(view.source, "recordHash"), false);
  return view;
}

test("real 22-ply loss yields the full original 14-stone decision before the forced chain", () => {
  assert.equal(loss.moves.length, 22);
  assert.equal(lossQuestions.length, 1);
  const q = lossQuestions[0];
  assert.equal(q.ply, 15);
  assert.equal(q.before.filter(Boolean).length, 14);
  assert.equal(q.proofPlies, 7);
  assert.equal(q.source.kind, "own");
  assert.equal(q.source.result, "loss");
  assert.deepEqual(q.prefix, loss.moves.slice(0, 14).map((m) => typeof m === "number" ? m : m.i));
  assert.deepEqual(q.before, Array.from(boardFrom(q.prefix)));
  assert.deepEqual(q.source.moves, loss.moves.map((m) => typeof m === "number" ? m : m.i));
  assert(verifyRecordDrill(q, loss));
  assert.equal(q.source.recordHash, recordSourceHash(loss));
  assert.equal(winner(q.before), 0);
  assert.deepEqual(winningMoves(Uint8Array.from(q.before), 1), []);
  assert.deepEqual(winningMoves(Uint8Array.from(q.before), 2), []);
  assert(!JSON.stringify(q).includes('"frames"'));
  assert(JSON.stringify(q).length < 5000);
});

test("expert complete games keep their clutter, dedupe forced-chain suffixes, and retain source identity", () => {
  assert.equal(expertQuestions.length, 3);
  assert.deepEqual(expertQuestions.map((q) => q.ply), [37, 29, 19]);
  for (const q of expertQuestions) {
    const original = courses.find((r) => r.id === q.source.recordId);
    assert(verifyRecordDrill(q, { ...original, rule: "freestyle15" }));
    assert(q.before.filter(Boolean).length >= 14);
    assert(q.proofPlies >= 3);
    assert.equal(q.source.kind, "library");
    assert.equal(q.source.label, "収録棋譜");
    assert.deepEqual(q.before, Array.from(boardFrom(original.moves.slice(0, q.ply - 1))));
  }
});

test("blind views hide tactical type, outcome, coordinates, evidence, and authored givens", () => {
  for (const q of [...lossQuestions, ...expertQuestions]) {
    const view = blind(q, startRecordDrill(q));
    assert.deepEqual(view.board, q.before);
    assert.equal(view.color, 1);
    assert.equal(view.canPlay, true);
    assert.deepEqual(view.qualification, { fullGame: false, independentCurriculum: false });
  }
});

test("every legal first response in the real-loss fixture is judged dynamically; all verified alternatives count", () => {
  const q = lossQuestions[0], original = structuredClone(q);
  let accepted = 0, refuted = 0;
  for (let point = 0; point < 225; point++) {
    if (q.before[point]) continue;
    const verdict = judgeReviewMove({ ...q.moment, before: q.before }, point);
    const initial = startRecordDrill(q), snapshot = structuredClone(initial);
    const s = playRecordDrill(q, initial, point);
    assert.deepEqual(initial, snapshot);
    assert.equal(s.feedback.accepted, verdict.accepted, `point ${point}`);
    assert.equal(s.metrics.errors, verdict.status === "refuted" ? 1 : 0);
    assert.deepEqual(s.moves.slice(0, q.prefix.length), q.prefix);
    if (verdict.accepted) {
      accepted++;
      assert.equal(s.status, "completed");
      assert.equal(s.result, "line-prevented");
      assert.equal(s.scope, "line-prevented");
      assert.equal(winner(s.board), 0);
      assert(s.feedback.explanation.includes(String.fromCharCode(65 + point % 15) + (15 - Math.floor(point / 15))));
    } else if (verdict.status === "refuted") refuted++;
  }
  assert(accepted >= 3);
  assert(refuted > 0);
  assert.deepEqual(q, original);
});

test("own winning sequences require each Black move and finish only with an actual five", () => {
  for (const q of expertQuestions) for (const first of q.moment.alternatives) {
    let s = startRecordDrill(q, { attemptId: `test-${q.id}-${first}` });
    s = playRecordDrill(q, s, first);
    assert.equal(s.status, "continuing");
    assert.equal(s.result, null);
    assert.equal(s.moves.length, q.prefix.length + 2);
    assert.equal(winner(s.board), 0);
    let steps = 1;
    while (s.status === "continuing") {
      const view = getRecordDrillView(q, s);
      assert(!Object.hasOwn(view, "plan"));
      assert.deepEqual(view.highlights, []);
      assert.deepEqual(view.explanationFrames, []);
      assert.deepEqual(view.refutationFrames, []);
      const point = s.plan.line[0];
      assert(provePatternMove(s.board, 1, point, { maxPly: 9, maxNodes: 450, quietDepth: 2, allowQuiet: true }));
      s = playRecordDrill(q, s, point);
      assert(++steps <= 5);
    }
    assert.equal(s.status, "completed");
    assert.equal(s.result, "black-win");
    assert.equal(winner(s.board), 1);
    assert(s.moves.length - q.prefix.length <= q.maxContinuationPlies);
    assert.equal(s.metrics.errors, 0);
    assert.equal(s.metrics.assisted, false);
    assert.deepEqual(restoreRecordDrill(q, JSON.parse(JSON.stringify(s))), s);
    const explained = answerRecordDrill(q, s);
    const frames = getRecordDrillView(q, explained).explanationFrames;
    const firstAnswerBoard = [...q.before]; firstAnswerBoard[first] = 1;
    assert.deepEqual(frames[0].board, firstAnswerBoard);
    assert(frames.some((f) => f.last === first && f.board[first] === 1));
    assert.deepEqual(restoreRecordDrill(q, explained), explained);
  }
});

test("unknown is not an error or completion and cannot grant a win", () => {
  let fixture;
  for (const q of expertQuestions) {
    for (let point = 0; point < 225; point++) {
      if (q.before[point]) continue;
      const s = playRecordDrill(q, startRecordDrill(q), point);
      if (s.status === "unknown") { fixture = { q, s }; break; }
    }
    if (fixture) break;
  }
  assert(fixture, "a bounded unproven alternative must remain unknown");
  const { q, s } = fixture;
  assert.equal(s.metrics.errors, 0);
  assert.equal(s.metrics.unknown, 1);
  assert.equal(s.result, null);
  assert.equal(getRecordDrillView(q, s).completion, null);
  assert.deepEqual(restoreRecordDrill(q, s), s);
});

test("hints are explicit and narrow; answer/retry cannot clear lifetime assistance, errors or exposure", () => {
  const q = lossQuestions[0];
  let s = startRecordDrill(q, { attemptId: "cumulative" });
  s = hintRecordDrill(q, s);
  const hints = getRecordDrillView(q, s).highlights;
  assert(hints.length);
  assert(hints.flatMap((h) => h.cells).length < q.before.filter(Boolean).length);
  assert(hints.every((h) => h.points.length === 0));
  s = answerRecordDrill(q, s);
  assert.equal(s.metrics.assisted, true);
  assert.equal(s.metrics.answers, 1);
  assert(getRecordDrillView(q, s).highlights.some((h) => h.points.length));
  const wrong = q.moment.actual;
  s = playRecordDrill(q, s, wrong);
  assert.equal(s.metrics.errors, 1);
  const metrics = { ...s.metrics };
  s = retryRecordDrill(q, s);
  assert.equal(s.attemptId, "cumulative");
  assert.equal(s.metrics.retries, 1);
  for (const key of ["assisted", "hints", "answers", "errors", "exposures", "unknown"]) assert.equal(s.metrics[key], metrics[key]);
  blind(q, s);
  assert.deepEqual(restoreRecordDrill(q, s), s);
});

test("restore replays trusted source plus events and rejects fabricated metrics, boards, moves, or source", () => {
  const q = lossQuestions[0];
  let s = hintRecordDrill(q, startRecordDrill(q, { attemptId: "integrity" }));
  s = playRecordDrill(q, s, q.moment.actual);
  s = retryRecordDrill(q, s);
  s = playRecordDrill(q, s, q.moment.alternatives[1]);
  assert.deepEqual(restoreRecordDrill(q, s), s);
  for (const mutate of [
    (x) => x.metrics.errors = 0,
    (x) => x.metrics.assisted = false,
    (x) => x.metrics.retries = 0,
    (x) => x.board[0] = 2,
    (x) => x.moves[0] = 0,
    (x) => x.sourceHash = "invented",
    (x) => x.questionId += "new",
    (x) => x.events[0].type = "retry",
    (x) => x.events[0].extra = true,
    (x) => x.qualification.fullGame = true,
    (x) => x.feedbackFrames.push({ board: Array(225).fill(0) }),
  ]) {
    const corrupt = structuredClone(s); mutate(corrupt);
    assert.equal(restoreRecordDrill(q, corrupt), null);
  }
  for (const mutate of [
    (x) => x.prefix[0] = 0,
    (x) => x.source.moves[0] = 0,
    (x) => x.before[0] = 1,
    (x) => x.moment.alternatives = [0],
    (x) => x.color = 2,
    (x) => x.version = 6,
  ]) {
    const corrupt = structuredClone(q); mutate(corrupt);
    assert.equal(verifyRecordDrill(corrupt), false);
    assert.throws(() => startRecordDrill(corrupt));
    assert.equal(restoreRecordDrill(corrupt, s), null);
  }
  assert.equal(verifyRecordDrill(q, { ...loss, moves: loss.moves.slice(0, -1) }), false);
});

test("re-entry closes requested hints without erasing their replayable exposure history", () => {
  const q = expertQuestions[0];
  let s = answerRecordDrill(q, startRecordDrill(q));
  assert(getRecordDrillView(q, s).explanationFrames.length >= 3);
  const metrics = structuredClone(s.metrics);
  s = hideRecordDrillHints(q, s);
  blind(q, s);
  assert.deepEqual(s.metrics, metrics);
  assert.deepEqual(restoreRecordDrill(q, s), s);
  s = playRecordDrill(q, s, q.moment.alternatives[0]);
  assert.equal(s.status, "continuing");
  assert.deepEqual(getRecordDrillView(q, s).explanationFrames, []);
  assert.deepEqual(getRecordDrillView(q, s).highlights, []);
  assert(s.metrics.assisted);
});

test("explicit explanation after a failed answer reconstructs the verified correction, including continuation checkpoints", () => {
  const q = lossQuestions[0];
  let s = playRecordDrill(q, startRecordDrill(q), q.moment.actual);
  assert.equal(s.status, "refuted");
  assert(getRecordDrillView(q, s).canAnswer);
  assert(getRecordDrillView(q, s).refutationFrames.some((f) => f.last !== null && f.board[f.last] === 2));
  assert.deepEqual(getRecordDrillView(q, s).explanationFrames, []);
  s = answerRecordDrill(q, s);
  assert(s.answerShown);
  assert(getRecordDrillView(q, s).explanationFrames.some((f) => f.board[q.moment.alternatives[0]] === 1));
  assert.deepEqual(restoreRecordDrill(q, s), s);
  const winQ = expertQuestions[0];
  let continuation = playRecordDrill(winQ, startRecordDrill(winQ), winQ.moment.alternatives[0]);
  let failed;
  for (let point = 0; point < 225; point++) {
    if (continuation.board[point]) continue;
    const candidate = playRecordDrill(winQ, continuation, point);
    if (["refuted", "unknown"].includes(candidate.status)) { failed = candidate; break; }
  }
  assert(failed);
  const explained = answerRecordDrill(winQ, failed);
  assert(explained.explanationFrames.length);
  assert.deepEqual(restoreRecordDrill(winQ, explained), explained);
});

test("wrong-answer refutation survives correction, hint closing and restore as a separate frame sequence", () => {
  const q = lossQuestions[0];
  let s = playRecordDrill(q, startRecordDrill(q), q.moment.actual);
  const refutation = getRecordDrillView(q, s).refutationFrames;
  assert(refutation.length);
  assert.deepEqual(getRecordDrillView(q, s).explanationFrames, []);
  s = answerRecordDrill(q, s);
  const correction = getRecordDrillView(q, s).explanationFrames;
  assert(correction.length);
  assert.notDeepEqual(correction, refutation);
  assert.deepEqual(getRecordDrillView(q, s).refutationFrames, refutation);
  s = hideRecordDrillHints(q, s);
  assert.deepEqual(getRecordDrillView(q, s).explanationFrames, []);
  s = restoreRecordDrill(q, JSON.parse(JSON.stringify(s)));
  assert(s);
  assert.deepEqual(getRecordDrillView(q, s).refutationFrames, refutation);
  assert.deepEqual(getRecordDrillView(q, s).explanationFrames, []);
  s = answerRecordDrill(q, s);
  assert.deepEqual(getRecordDrillView(q, s).explanationFrames, correction);
  assert.deepEqual(getRecordDrillView(q, s).refutationFrames, refutation);
  s = retryRecordDrill(q, s);
  assert.deepEqual(s.feedbackFrames, []);
  blind(q, s);
});

test("reject authored snapshots, invalid/terminal-before histories and mismatched colors; unknown-only/density cases are empty", async () => {
  for (const record of [
    { ...loss, startPly: 2 }, { ...loss, startPly: -1 }, { ...loss, sourceLessonId: "lesson" },
    { ...loss, moves: [...loss.moves, loss.moves[0]] },
    { ...loss, moves: [...loss.moves, 0] },
    { ...loss, moves: loss.moves.map((m, i) => ({ i: typeof m === "number" ? m : m.i, side: i === 0 ? 2 : i % 2 + 1 })) },
    { ...loss, rule: "renju" },
  ]) await assert.rejects(extractRecordDrills(record));
  assert.equal((await extractRecordDrills({ ...loss, moves: loss.moves.slice(0, 8) })).length, 0);
  assert.equal((await extractRecordDrills(loss, { minStones: 30 })).length, 0);
  assert.equal((await extractRecordDrills(loss, { proofLimits: { maxNodes: 0 } })).length, 0);
  const again = await extractRecordDrills(loss, { sourceKind: "import", sourceId: "renamed" });
  assert.equal(again[0].id, lossQuestions[0].id);
  assert.equal(again[0].source.kind, "import");
  assert.equal((await extractRecordDrills(loss, { seenFingerprints: [again[0].fingerprint] })).length, 0);
  assert.equal(recordDrillFingerprint(again[0].before), again[0].fingerprint);
});

test("worker isolates extraction/grading and serializes progress, version and errors", async () => {
  const messages = [];
  await handleRecordDrillMessage({ type: "extract", id: "extract", version: RECORD_DRILL_WORKER_VERSION, record: loss }, (m) => messages.push(m));
  assert(messages.some((m) => m.type === "progress" && m.done === loss.moves.length));
  const result = messages.at(-1);
  assert.equal(result.type, "result");
  assert.equal(result.coverage.extracted, 1);
  assert.deepEqual(result.questions, [...lossQuestions]);
  const q = result.questions[0];
  await handleRecordDrillMessage({ type: "grade", id: "grade", question: q, state: startRecordDrill(q), point: q.moment.alternatives[0] }, (m) => messages.push(m));
  assert.equal(messages.at(-1).state.status, "completed");
  assert.equal(messages.at(-1).view.completion.scope, "line-prevented");
  await handleRecordDrillMessage({ type: "extract", id: "bad", version: "wrong", record: loss }, (m) => messages.push(m));
  assert.equal(messages.at(-1).type, "error");
  assert.equal(typeof messages.at(-1).error, "string");
  assert(messages.every((m) => m.version === RECORD_DRILL_WORKER_VERSION));
  assert.doesNotThrow(() => JSON.stringify(messages));
});
