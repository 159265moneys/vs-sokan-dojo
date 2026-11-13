import test from "node:test";
import assert from "node:assert/strict";
import {
  createPathProgress,
  noteExposure,
  recordAttemptEvidence,
  positionFingerprint,
  unitStatus,
  selectAssessment,
  nextLearningStep,
  recordPracticalResult,
  getExamStatus,
  recordReviewFindings,
} from "../dist/learning-path.js";
import {
  createLearningProgress,
  recordLessonView,
  createAttempt,
  recordLearningAttempt,
  playLearningMove,
  answerLearningChoice,
  hintLearning,
  getDemoFrames,
  getLearningStats,
} from "../dist/learning.js";
import { problems as authoredProblems } from "../dist/curriculum.js";
import { parse, winner } from "../dist/game.js";
import {
  createJourney,
  playJourneyMove,
  applyJourneyReply,
  getJourneyResult,
} from "../dist/journey.js";

const copy = (value) => JSON.parse(JSON.stringify(value));
const time = "2026-11-11T12:00:00+09:00";
function board(...stones) {
  const result = Array(225).fill(0);
  for (const [x, y, side] of stones) result[y * 15 + x] = side;
  return result;
}
const base = board([2, 3, 1], [3, 3, 1], [7, 6, 2]);
const different = board([2, 3, 1], [4, 4, 1], [7, 6, 2]);
const third = board([2, 3, 1], [5, 3, 1], [7, 7, 2]);
const fourth = board([2, 3, 1], [6, 4, 1], [7, 8, 2]);
const problem = (id, family, position = base, unitId = "priority") => ({
  id,
  unitId,
  skillId: unitId,
  role: "assessment",
  family,
  board: position,
  branchId: `${family}/condition`,
  requiresBranch: true,
});
const bank = [
  problem("a", "priority/own-win-first"),
  problem("b", "priority/prevent-immediate-loss", different),
  problem("c", "priority/own-win-first", third),
  problem("d", "priority/prevent-immediate-loss", fourth),
];
function attempt(id, options = {}) {
  return {
    attemptId: `attempt-${id}`,
    problemId: id,
    status: "solved",
    history: [
      { i: 0, side: 1 },
      { i: 1, side: 2 },
      { i: 2, side: 1 },
    ],
    hints: { uses: 0 },
    guidanceSeen: false,
    metrics: { verifiedMistakes: 0, unknownSelections: 0, retries: 0 },
    ...options,
  };
}
function record(progress, item, options = {}, at = time) {
  return recordAttemptEvidence(progress, attempt(item.id, options), {
    ...item,
    at,
  });
}
function initial() {
  return record(record(createPathProgress(), bank[0]), bank[1]);
}

test("audit F3: a demo answer is never a first independent encounter", () => {
  let progress = recordLessonView(createLearningProgress(), "priority");
  let state = createAttempt("win-before-block", { attemptId: "demo-audit" });
  progress = recordLearningAttempt(progress, state);
  const authored = authoredProblems.find((p) => p.id === state.problemId);
  const demonstratedAnswer = getDemoFrames("priority").find((frame) =>
    authored.guide.includes(frame.last),
  );
  state = playLearningMove(state, demonstratedAnswer.last);
  progress = recordLearningAttempt(progress, state);
  const stats = getLearningStats(progress, { problemId: state.problemId });
  assert.equal(stats.completed, 1);
  assert.equal(stats.firstTryUnaided, 0);
  assert.equal(stats.familyFirstTryUnaided, 0);
  assert.equal(stats.independentCompleted, 0);
  assert.equal(stats.knownCompleted, 1);
  assert.equal(stats.needsReview, true);
});

test("audit F4: a hint followed by immediate clean replay cannot end review", () => {
  let progress = createLearningProgress();
  for (const assisted of [true, false]) {
    let state = createAttempt("quiet-two-plans", {
      attemptId: assisted ? "hint" : "replay",
    });
    progress = recordLearningAttempt(progress, state);
    if (assisted) state = hintLearning(state);
    while (state.status === "choose")
      state = playLearningMove(state, state.guide[0]);
    progress = recordLearningAttempt(progress, state);
  }
  const stats = getLearningStats(progress, { problemId: "quiet-two-plans" });
  assert.equal(stats.completed, 2);
  assert.equal(stats.assistedCompleted, 1);
  assert.equal(stats.independentCompleted, 0);
  assert.equal(stats.needsReview, true);
});

test("D4, reflection and translation cannot create fresh assessment credit under new IDs", () => {
  const rotated = board([11, 2, 1], [11, 3, 1], [8, 7, 2]);
  const translated = board([3, 4, 1], [4, 4, 1], [8, 7, 2]);
  assert.equal(positionFingerprint(base), positionFingerprint(rotated));
  assert.equal(positionFingerprint(base), positionFingerprint(translated));
  let progress = record(createPathProgress(), bank[0]);
  const alias = problem("renamed", "invented-family", rotated);
  progress = record(progress, alias);
  assert.equal(unitStatus(progress, "priority").initialCount, 1);
  assert.equal(selectAssessment(progress, "priority", [alias]), null);
  assert.equal(progress.attempts["attempt-renamed"].exposureSeen, true);
});

test("independent structural families and actual opponent continuation advance the standard path", () => {
  const units = [
    { id: "priority", problemIds: [] },
    { id: "conditions", problemIds: ["condition-lesson"] },
  ];
  const nextUnitProblem = problem(
    "condition-check",
    "conditions/alpha",
    fourth,
    "conditions",
  );
  const progress = initial();
  assert.equal(unitStatus(progress, "priority").initialConfirmed, true);
  assert.equal(unitStatus(progress, "priority").retained, false);
  assert.equal(unitStatus(progress, "priority").label, "保持待ち");
  assert.deepEqual(
    nextLearningStep(progress, {
      units,
      assessmentProblems: [...bank, nextUnitProblem],
    }),
    {
      kind: "assessment",
      unitId: "conditions",
      problemId: "condition-check",
      reason: "diagnostic",
      label: "初回確認",
    },
  );
  const onlyFirstMove = record(record(createPathProgress(), bank[0]), bank[1], {
    history: [{ i: 0, side: 1 }],
  });
  assert.equal(unitStatus(onlyFirstMove, "priority").initialConfirmed, false);
  const sameFamily = record(record(createPathProgress(), bank[0]), bank[2]);
  assert.equal(unitStatus(sameFamily, "priority").initialCount, 1);
});

test("the standard path diagnoses first, then checks another family without requiring prior lessons", () => {
  const units = [{ id: "priority", problemIds: ["priority-lesson"] }];
  let progress = createPathProgress();
  assert.deepEqual(
    nextLearningStep(progress, { units, assessmentProblems: bank }),
    {
      kind: "assessment",
      unitId: "priority",
      problemId: "a",
      reason: "diagnostic",
      label: "初回確認",
    },
  );
  progress = record(progress, bank[0]);
  assert.equal(
    nextLearningStep(progress, { units, assessmentProblems: bank }).problemId,
    "b",
  );
  progress = record(progress, bank[1]);
  assert.equal(
    nextLearningStep(progress, { units, assessmentProblems: bank }).reason,
    "initial-complete",
  );
  assert.equal(
    Object.values(progress.attempts).some((a) => a.role === "lesson"),
    false,
  );
});

test("failure, hints and unknown selections each cause only the target unit's remediation", () => {
  const units = [
    { id: "priority", problemIds: ["priority-lesson"] },
    { id: "conditions", problemIds: ["condition-lesson"] },
  ];
  const question = problem(
    "conditions-check",
    "conditions/alpha",
    third,
    "conditions",
  );
  const options = [
    {
      status: "feedback",
      metrics: { verifiedMistakes: 1, unknownSelections: 0, retries: 0 },
    },
    { hints: { uses: 1 } },
    {
      status: "feedback",
      metrics: { verifiedMistakes: 0, unknownSelections: 1, retries: 0 },
    },
  ];
  for (const failure of options) {
    const progress = record(initial(), question, failure);
    assert.deepEqual(
      nextLearningStep(progress, {
        units,
        assessmentProblems: [...bank, question],
      }),
      {
        kind: "lesson",
        unitId: "conditions",
        problemId: "condition-lesson",
        reason: "remediation",
        label: "練習する",
      },
    );
  }
});

test("a new diagnostic failure requires later remediation even when every lesson was already completed", () => {
  const units = [{ id: "priority", problemIds: ["priority-lesson"] }];
  const lesson = {
    ...problem("priority-lesson", "lesson", fourth),
    role: "lesson",
  };
  let progress = record(createPathProgress(), lesson);
  progress = record(progress, bank[0], { status: "feedback" });
  assert.equal(
    nextLearningStep(progress, { units, assessmentProblems: bank }).reason,
    "remediation",
  );
  progress = record(progress, lesson, {
    attemptId: "later-remediation",
    hints: { uses: 1 },
  });
  let next = nextLearningStep(progress, { units, assessmentProblems: bank });
  assert.equal(next.kind, "assessment");
  assert.equal(next.problemId, "b");
  assert.equal(unitStatus(progress, "priority").initialConfirmed, false);
  progress = record(progress, bank[1], { status: "choose" });
  progress = record(progress, bank[1], { status: "feedback" });
  next = nextLearningStep(progress, { units, assessmentProblems: bank });
  assert.equal(next.reason, "remediation");
  assert.equal(next.problemId, "priority-lesson");
  const restored = createPathProgress(copy(progress));
  assert.deepEqual(
    nextLearningStep(restored, { units, assessmentProblems: bank }),
    next,
  );
});

test("only a later completed task game with a relevant observed skill releases remediation", () => {
  const units = [{ id: "priority", problemIds: ["priority-lesson"] }];
  let progress = recordPracticalResult(createPathProgress(), {
    id: "ongoing-journey",
    role: "journey",
    completed: false,
    result: "unfinished",
    opportunities: [],
  });
  progress = record(progress, bank[0], { status: "feedback" });
  progress = recordPracticalResult(progress, {
    id: "unrelated",
    role: "journey",
    completed: true,
    result: "win",
    opportunities: [{ unitId: "opening", success: true }],
  });
  assert.equal(
    nextLearningStep(progress, { units, assessmentProblems: bank }).reason,
    "remediation",
  );
  progress = recordPracticalResult(progress, {
    id: "ongoing-journey",
    role: "journey",
    completed: false,
    result: "unfinished",
    opportunities: [{ unitId: "priority", success: true }],
  });
  assert.equal(
    nextLearningStep(progress, { units, assessmentProblems: bank }).reason,
    "remediation",
  );
  progress = recordPracticalResult(progress, {
    id: "ongoing-journey",
    role: "journey",
    completed: true,
    result: "loss",
    opportunities: [{ unitId: "priority", success: false }],
  });
  const next = nextLearningStep(progress, { units, assessmentProblems: bank });
  assert.equal(next.kind, "assessment");
  assert.equal(next.problemId, "b");
  assert.equal(unitStatus(progress, "priority").initialConfirmed, false);
  assert.equal(unitStatus(progress, "priority").practicalObserved, false);
  const priorGame = {
    id: "older-journey",
    role: "journey",
    completed: true,
    result: "win",
    opportunities: [{ unitId: "priority", success: true }],
  };
  let older = recordPracticalResult(createPathProgress(), priorGame);
  delete older.practicalResults[priorGame.id].completedOrdinal;
  older = record(older, bank[0], { status: "feedback" });
  older = recordPracticalResult(older, priorGame);
  assert.equal(
    nextLearningStep(older, { units, assessmentProblems: bank }).reason,
    "remediation",
    "re-saving an older task game does not invent later remediation",
  );
});

test("lesson completion, repeated trials and one condition do not confer independent confirmation", () => {
  let progress = recordAttemptEvidence(createPathProgress(), attempt("a"), {
    ...bank[0],
    role: "lesson",
    at: time,
  });
  progress = recordAttemptEvidence(
    progress,
    attempt("a", { attemptId: "repeat" }),
    { ...bank[0], at: time },
  );
  assert.equal(unitStatus(progress, "priority").practiced, true);
  assert.equal(unitStatus(progress, "priority").initialCount, 0);
  let oneBranch = record(createPathProgress(), bank[0]);
  oneBranch = record(oneBranch, { ...bank[1], branchId: bank[0].branchId });
  assert.equal(unitStatus(oneBranch, "priority").initialConfirmed, false);
});

test("answer exposure before or during assessment contaminates that attempt and stale updates cannot erase it", () => {
  let progress = recordAttemptEvidence(
    createPathProgress(),
    attempt("a", { status: "choose" }),
    { ...bank[0], at: time },
  );
  progress = noteExposure(progress, { ...bank[0], kind: "answer", at: time });
  progress = record(progress, bank[0]);
  assert.equal(unitStatus(progress, "priority").initialCount, 0);
  const frozen = copy(progress);
  progress = recordAttemptEvidence(
    progress,
    attempt("a", { status: "choose" }),
    { ...bank[0], at: time },
  );
  assert.deepEqual(progress, frozen);
  let historical = record(createPathProgress(), bank[0]);
  historical = noteExposure(historical, {
    ...bank[0],
    kind: "answer",
    at: time,
  });
  historical = record(historical, bank[0]);
  assert.equal(unitStatus(historical, "priority").initialCount, 1);
});

test("a hint or judged error cannot be erased by a clean solved snapshot or reload", () => {
  let progress = record(createPathProgress(), bank[0], {
    status: "choose",
    hints: { uses: 1 },
  });
  progress = record(progress, bank[0]);
  progress = record(progress, bank[1], {
    status: "feedback",
    metrics: { verifiedMistakes: 1, retries: 0, unknownSelections: 0 },
  });
  progress = record(progress, bank[1]);
  progress = createPathProgress(copy(progress));
  assert.equal(unitStatus(progress, "priority").initialCount, 0);
  assert.equal(unitStatus(progress, "priority").needsReview, true);
  assert.equal(selectAssessment(progress, "priority", bank).id, "c");
});

test("retention requires another calendar day, 24 hours, a new structure and manual selection", () => {
  const progress = initial();
  assert.equal(
    selectAssessment(progress, "priority", bank, {
      phase: "retention",
      at: "2026-11-12T00:01:00+09:00",
    }),
    null,
  );
  assert.equal(
    selectAssessment(progress, "priority", bank, {
      phase: "retention",
      at: "2026-11-12T12:00:00+09:00",
    }).id,
    "c",
  );
  const tooSoon = record(progress, bank[2], {}, "2026-11-12T00:01:00+09:00");
  assert.equal(unitStatus(tooSoon, "priority").retained, false);
  const retained = record(progress, bank[2], {}, "2026-11-12T12:00:00+09:00");
  assert.equal(unitStatus(retained, "priority").retained, true);
  assert.equal(unitStatus(retained, "priority").practicalObserved, false);
  const repeated = recordAttemptEvidence(
    progress,
    attempt("a", { attemptId: "later-known" }),
    { ...bank[0], at: "2026-11-13T12:00:00+09:00" },
  );
  assert.equal(unitStatus(repeated, "priority").retained, false);
  assert.deepEqual(
    progress,
    initial(),
    "time checks never mutate or start work",
  );
});

test("only missing prerequisites get remediation, and an exhausted bank stays exhausted", () => {
  const units = [
    { id: "priority", problemIds: [] },
    { id: "conditions", problemIds: ["basics"], prerequisites: ["priority"] },
    {
      id: "order",
      problemIds: ["order-lesson"],
      prerequisites: ["conditions"],
    },
  ];
  assert.equal(
    nextLearningStep(initial(), {
      units,
      unitId: "order",
      assessmentProblems: bank,
    }).unitId,
    "conditions",
  );
  let exhausted = createPathProgress();
  for (const item of bank)
    exhausted = noteExposure(exhausted, { ...item, kind: "answer", at: time });
  assert.equal(selectAssessment(exhausted, "priority", bank), null);
  assert.equal(
    nextLearningStep(exhausted, { units, assessmentProblems: bank }).reason,
    "assessment-exhausted",
  );
  assert.equal(unitStatus(exhausted, "priority").initialConfirmed, false);
});

test("legacy practice and games are preserved without promotion; old demo boards remain known", () => {
  let old = recordLessonView(createLearningProgress(), "priority");
  const original = copy(old);
  delete old.evidenceVersion;
  delete old.exposures;
  const normalized = createLearningProgress(old);
  const game = { id: "old-game", moves: [0, 1], result: "unfinished" };
  const progress = createPathProgress(
    { schemaVersion: 1, records: [game] },
    normalized,
  );
  assert.deepEqual(progress.legacy.progress.records, [game]);
  assert.equal(unitStatus(progress, "priority").initialConfirmed, false);
  assert.equal(unitStatus(progress, "priority").viewed, true);
  const demoProblem = problem(
    "fresh-id",
    "fresh-family",
    getDemoFrames("priority")[0].board,
  );
  assert.equal(selectAssessment(progress, "priority", [demoProblem]), null);
  assert.deepEqual(original.viewedUnits, normalized.viewedUnits);
  assert.deepEqual(createPathProgress(copy(progress)), progress);
});

test("changing ledger versions keeps encountered boards known and never imports confirmation", () => {
  const previous = initial();
  const migrated = createPathProgress(previous, null, {
    curriculumVersion: "next-bank",
  });
  assert.equal(unitStatus(migrated, "priority").initialConfirmed, false);
  assert.equal(selectAssessment(migrated, "priority", bank).id, "c");
  assert.equal(migrated.legacy.progress.attempts["attempt-a"].status, "solved");
});

const settings = {
  rule: "freestyle15",
  level: "max",
  strength: 100,
  timeMs: 8000,
};
function game(id, extra = {}) {
  return {
    id,
    role: "exam",
    seriesId: "series-a",
    at: time,
    rule: "freestyle15",
    level: "max",
    assisted: false,
    startBoard: Array(225).fill(0),
    settings: { ...settings },
    startSettings: { ...settings },
    moves: [0, 30, 1, 31, 2, 32, 3, 33, 4],
    result: "win",
    ...extra,
  };
}

function priorityGame(id, variant = 0, extra = {}) {
  const white = [
    30 + variant,
    60 + 2 * variant,
    95 + variant,
    150 + 3 * variant,
  ];
  return game(id, {
    role: "practice",
    moves: [0, white[0], 1, white[1], 2, white[2], 3, white[3], 4],
    opportunities: [
      {
        unitId: "priority",
        objectiveId: "take-win",
        kind: "take-win",
        ply: 9,
        success: true,
        outcome: "achieved",
        evidence: { played: 4, points: [4] },
      },
    ],
    ...extra,
  });
}

function priorityBlockGame(id, variant = 0, extra = {}) {
  const row = (variant + 2) * 15,
    block = row + 4;
  return game(id, {
    role: "practice",
    moves: [
      0,
      row,
      2,
      row + 1,
      4,
      row + 2,
      6,
      row + 3,
      block,
      220 - variant,
      1,
      218 - variant,
      3,
    ],
    opportunities: [
      {
        unitId: "priority",
        objectiveId: "stop-five",
        kind: "stop-five",
        ply: 9,
        success: true,
        outcome: "achieved",
        evidence: { played: block, points: [block], remaining: [] },
      },
    ],
    ...extra,
  });
}

function tracedGame(id, moves, extra = {}) {
  let journey = createJourney("practice", {
    attemptId: id,
    replyVariant: "natural",
    white: { ms: 8000, strength: 100 },
  });
  moves.forEach(
    (point, i) =>
      (journey =
        i % 2
          ? applyJourneyReply(journey, point)
          : playJourneyMove(journey, point)),
  );
  return game(id, { ...getJourneyResult(journey), role: "practice", ...extra });
}

function authoredContinuation(
  id,
  problemId,
  {
    verified = false,
    extraBlack = [],
    extraWhite = [],
    omitDefaultPair = false,
  } = {},
) {
  const authored = authoredProblems.find((item) => item.id === problemId);
  assert(authored, problemId);
  let attempt = createAttempt(problemId, { attemptId: `source-${id}` });
  if (authored.nodes[0]?.input === "choice")
    attempt = answerLearningChoice(
      attempt,
      authored.nodes[0].choices.find((choice) => choice.correct).id,
    );
  while (attempt.status === "choose")
    attempt = playLearningMove(attempt, attempt.guide[0]);
  assert.equal(attempt.status, "solved", problemId);
  const black = authored.board.flatMap((side, i) => (side === 1 ? [i] : []));
  const white = authored.board.flatMap((side, i) => (side === 2 ? [i] : []));
  const extras = [210, 224, 195, 209, 0, 14, 15, 29].filter(
    (point) => !authored.board[point],
  );
  if (authored.unitId === "opening" && authored.judge.kind === "prevent-fork")
    black[black.length - 1] = extras[0];
  else if (!omitDefaultPair) {
    black.push(extras[0]);
    white.push(extras[1]);
  }
  black.push(...extraBlack);
  white.push(...extraWhite);
  const prefix = black.flatMap((point, i) => [point, white[i]]);
  const moves = [...prefix, ...attempt.history.map((move) => move.i)],
    position = Array(225).fill(0);
  moves.forEach((point, i) => (position[point] = (i % 2) + 1));
  if (!winner(position)) {
    let target;
    for (let row = 13; row >= 0 && !target; row--) {
      const points = Array.from({ length: 5 }, (_, x) => row * 15 + x);
      if (points.every((point) => !position[point])) target = points;
    }
    for (const point of target) {
      const reply = position.findIndex((side, index) => {
        if (side || target.includes(index)) return false;
        const after = [...position];
        after[index] = 2;
        return !winner(after);
      });
      assert(reply >= 0);
      moves.push(reply, point);
      position[reply] = 2;
      position[point] = 1;
      if (winner(position)) break;
    }
  }
  const record = tracedGame(id, moves);
  if (verified)
    record.opportunities.push({
      source: "verified-pattern",
      unitId: authored.unitId,
      ply: prefix.length + 1,
      success: true,
      outcome: "achieved",
    });
  return record;
}

function beforeEvent(record, ply = 9) {
  const before = Array(225).fill(0);
  record.moves
    .slice(0, ply - 1)
    .forEach((i, n) => (before[typeof i === "number" ? i : i.i] = (n % 2) + 1));
  return before;
}

test("only replayable unaided empty-board terminal games with matching settings count", () => {
  let progress = recordPracticalResult(createPathProgress(), game("valid"));
  const excluded = [
    game("assisted", { assisted: true }),
    game("unfinished", { moves: [0, 30], result: "unfinished" }),
    game("resigned", { moves: [0, 30], result: "resign" }),
    game("partial", { startBoard: base }),
    game("mismatch", { settings: { ...settings, timeMs: 1000 } }),
    game("invalid", { moves: [0, 0] }),
    game("pretend-win", { moves: [0, 30], result: "win" }),
    game("recovery", { role: "recovery" }),
    game("journey", { role: "journey" }),
  ];
  for (const item of excluded) progress = recordPracticalResult(progress, item);
  const stats = getExamStatus(progress);
  assert.equal(stats.games, 1);
  assert.equal(stats.wins, 1);
  assert.equal(stats.excludedGames, 7);
  assert.equal(stats.assisted, 1);
  assert.equal(stats.unfinished, 1);
  assert.equal(stats.resigned, 1);
  assert.equal(stats.attempts, 8);
  assert.equal(Object.keys(progress.practicalResults).length, 10);
  assert.equal(stats.challengeCompleted, false);
});

test("exam series do not inherit old results and cannot replace an abandoned attempt with an extra win", () => {
  let progress = createPathProgress();
  for (let n = 0; n < 10; n++)
    progress = recordPracticalResult(progress, game(`win-${n}`));
  assert.equal(getExamStatus(progress).challengeCompleted, true);
  progress = recordPracticalResult(
    progress,
    game("new-series", {
      seriesId: "series-b",
      moves: [0],
      result: "unfinished",
    }),
  );
  assert.equal(getExamStatus(progress).seriesId, "series-b");
  assert.equal(getExamStatus(progress).wins, 0);
  assert.equal(getExamStatus(progress, { seriesId: "series-a" }).wins, 10);
  for (let n = 0; n < 10; n++)
    progress = recordPracticalResult(
      progress,
      game(`replacement-${n}`, { seriesId: "series-b" }),
    );
  assert.equal(getExamStatus(progress).challengeCompleted, false);
});

test("a normal recorded loss counts, and an existing ordinary game cannot be relabeled into an exam", () => {
  let progress = recordPracticalResult(
    createPathProgress(),
    game("loss", {
      moves: [0, 30, 1, 31, 2, 32, 20, 33, 21, 34],
      result: "loss",
    }),
  );
  assert.equal(getExamStatus(progress).games, 1);
  assert.equal(getExamStatus(progress).losses, 1);
  progress = recordPracticalResult(
    progress,
    game("ordinary", { role: "practice", seriesId: null }),
  );
  progress = recordPracticalResult(progress, game("ordinary"));
  assert.equal(getExamStatus(progress).wins, 0);
  assert.equal(progress.practicalResults.ordinary.source.role, "practice");
});

test("restoration replays source game evidence instead of trusting saved eligible flags", () => {
  const progress = recordPracticalResult(
    createPathProgress(),
    game("incomplete", { moves: [0], result: "unfinished" }),
  );
  progress.practicalResults.incomplete.eligibleFullGame = true;
  progress.practicalResults.incomplete.eligibleExam = true;
  progress.practicalResults.incomplete.actualResult = "win";
  assert.equal(getExamStatus(progress).wins, 0);
  assert.equal(getExamStatus(progress).unfinished, 1);
});

test("ordinary game opportunities are separate from journey objectives and assistance cannot disappear", () => {
  let progress = recordPracticalResult(
    initial(),
    priorityGame("journey-goal", 0, { role: "journey" }),
  );
  assert.equal(unitStatus(progress, "priority").practicalObserved, false);
  progress = recordPracticalResult(progress, priorityGame("ordinary", 1));
  assert.equal(unitStatus(progress, "priority").practicalObserved, true);
  assert.equal(unitStatus(progress, "priority").retained, false);
  progress = recordPracticalResult(
    progress,
    game("hinted", { assisted: true, moves: [0], result: "unfinished" }),
  );
  progress = recordPracticalResult(progress, game("hinted"));
  assert.equal(progress.practicalResults.hinted.eligibleExam, false);
  assert.equal(getExamStatus(progress).wins, 0);
});

function reviewFixture() {
  const prefix = [0, 30, 1, 31, 2, 32, 3, 33],
    before = Array(225).fill(0);
  prefix.forEach((i, ply) => (before[i] = (ply % 2) + 1));
  return {
    record: {
      id: "review-source",
      rule: "freestyle15",
      moves: [...prefix, 60, 34],
      result: "loss",
    },
    moment: {
      ply: 9,
      kind: "miss-win",
      skillId: "priority",
      before,
      actual: 60,
      alternatives: [4],
      evidence: { status: "proven", winningPoints: [4] },
    },
    recovery: {
      id: "recovery",
      role: "recovery",
      completed: true,
      startPly: 8,
      startBoard: before,
      sourceReview: { recordId: "review-source", ply: 9, before },
      moves: [...prefix, 4],
      result: "win",
      assisted: true,
    },
  };
}

test("only proven failures tied to the actual record prefix create deduplicated review findings", () => {
  const { record: source, moment } = reviewFixture();
  let progress = recordReviewFindings(
    initial(),
    source,
    [
      { ...moment, kind: "winning-chance" },
      { ...moment, kind: "pattern-play" },
      { ...moment, evidence: { status: "unknown" } },
      { ...moment, actual: 61 },
      { ...moment, ply: 7 },
      { ...moment, before: Array(225).fill(0) },
    ],
    { at: time },
  );
  assert.equal(Object.keys(progress.reviewFindings).length, 0);
  progress = recordReviewFindings(progress, source, [moment], { at: time });
  const first = copy(progress);
  progress = recordReviewFindings(
    progress,
    source,
    [moment, { ...moment, kind: "allowed-fork" }],
    { at: "2026-11-12T12:00:00+09:00" },
  );
  assert.deepEqual(progress, first);
  assert.equal(unitStatus(progress, "priority").initialConfirmed, true);
  assert.equal(unitStatus(progress, "priority").needsReview, true);
  assert.equal(unitStatus(progress, "priority").label, "実戦の復習");
  assert.deepEqual(
    nextLearningStep(progress, {
      units: [{ id: "priority", problemIds: [] }],
      assessmentProblems: bank,
    }),
    {
      kind: "review",
      unitId: "priority",
      recordId: source.id,
      ply: 9,
      reason: "review-recovery",
      label: "実戦の復習",
    },
  );
  assert.deepEqual(createPathProgress(copy(progress)), progress);
  const brokenSource = { ...source, moves: [...source.moves, 70] };
  assert.equal(
    Object.keys(
      recordReviewFindings(createPathProgress(), brokenSource, [moment])
        .reviewFindings,
    ).length,
    0,
  );
});

test("a proven allowed counterplay requires a real terminal line, while unknown evidence is not failure", () => {
  const before = Array(225).fill(0),
    prefix = [0, 30, 2, 31, 4, 32, 6, 33];
  prefix.forEach((i, ply) => (before[i] = (ply % 2) + 1));
  const source = { id: "defense-source", moves: [...prefix, 60, 34] };
  const moment = {
    ply: 9,
    kind: "miss-block",
    skillId: "priority",
    before,
    actual: 60,
    alternatives: [34],
    evidence: { status: "proven", attacker: 2, line: [34] },
  };
  let progress = recordReviewFindings(createPathProgress(), source, [
    { ...moment, evidence: { ...moment.evidence, line: [35] } },
  ]);
  assert.equal(Object.keys(progress.reviewFindings).length, 0);
  progress = recordReviewFindings(progress, source, [moment]);
  assert.equal(Object.keys(progress.reviewFindings).length, 1);
});

test("recovery requires matching original prefix, start board and actual terminal play; a legal loss still completes the continuation", () => {
  const { record: source, moment, recovery } = reviewFixture();
  const start = recordReviewFindings(initial(), source, [moment], { at: time });
  const invalid = [
    {
      ...recovery,
      id: "partial",
      moves: recovery.moves.slice(0, 8),
      result: "unfinished",
    },
    { ...recovery, id: "wrong-result", result: "loss" },
    { ...recovery, id: "wrong-ply", startPly: 6 },
    {
      ...recovery,
      id: "wrong-before",
      sourceReview: { ...recovery.sourceReview, before: Array(225).fill(0) },
    },
    { ...recovery, id: "wrong-board", startBoard: Array(225).fill(0) },
    {
      ...recovery,
      id: "wrong-prefix",
      moves: [10, ...recovery.moves.slice(1)],
    },
  ];
  for (const value of invalid) {
    const p = recordPracticalResult(start, value);
    assert.equal(
      unitStatus(p, "priority").reviewFindings[0].stage,
      "recovery",
      value.id,
    );
  }
  const continued = recordPracticalResult(start, {
    ...recovery,
    moves: source.moves,
    result: "loss",
  });
  assert.equal(
    unitStatus(continued, "priority").reviewFindings[0].stage,
    "assessment",
  );
  assert.equal(unitStatus(continued, "priority").needsReview, true);
  assert.equal(continued.practicalResults.recovery.eligibleFullGame, false);
  const next = nextLearningStep(continued, {
    units: [{ id: "priority", problemIds: [] }],
    assessmentProblems: bank,
  });
  assert.equal(next.kind, "assessment");
  assert.equal(next.reason, "review-transfer");
  assert.equal(next.problemId, "c");
});

test("recovery and a known-board retry do not finish review; fresh independent transfer leaves practical evidence pending", () => {
  const { record: source, moment, recovery } = reviewFixture();
  let progress = recordPracticalResult(
    initial(),
    priorityGame("old-success", 0),
  );
  assert.equal(unitStatus(progress, "priority").practicalObserved, true);
  progress = recordReviewFindings(progress, source, [moment], { at: time });
  assert.equal(unitStatus(progress, "priority").practicalObserved, false);
  assert.equal(unitStatus(progress, "priority").practicalSuccesses, 0);
  progress = recordPracticalResult(progress, recovery);
  progress = record(progress, bank[0], { attemptId: "known-retry" });
  assert.equal(unitStatus(progress, "priority").needsReview, true);
  assert.equal(
    unitStatus(progress, "priority").reviewFindings[0].stage,
    "assessment",
  );
  progress = record(progress, {
    ...bank[0],
    id: "retry-remedial",
    role: "lesson",
  });
  progress = record(progress, bank[2]);
  let status = unitStatus(progress, "priority");
  assert.equal(status.needsReview, false);
  assert.equal(status.practicalPending, 1);
  assert.equal(status.practicalObserved, false);
  assert.equal(status.label, "実戦待ち");
  const otherQuestion = problem(
    "conditions-new",
    "conditions/alpha",
    fourth,
    "conditions",
  );
  const next = nextLearningStep(progress, {
    units: [
      { id: "priority", problemIds: [] },
      { id: "conditions", problemIds: [] },
    ],
    assessmentProblems: [...bank, otherQuestion],
  });
  assert.equal(
    next.unitId,
    "conditions",
    "waiting for a practical opportunity does not block the remaining curriculum",
  );
  progress = recordPracticalResult(
    progress,
    priorityGame("no-opportunity", 1, { opportunities: [] }),
  );
  progress = recordPracticalResult(
    progress,
    priorityGame("assisted-opportunity", 2, { assisted: true }),
  );
  const missed = priorityGame("missed-opportunity", 3);
  missed.opportunities[0].success = false;
  missed.opportunities[0].outcome = "missed";
  progress = recordPracticalResult(progress, missed);
  assert.equal(unitStatus(progress, "priority").practicalPending, 1);
  progress = recordPracticalResult(progress, priorityGame("later-success", 4));
  status = unitStatus(progress, "priority");
  assert.equal(status.practicalPending, 0);
  assert.equal(status.practicalObserved, true);
  assert.equal(status.reviewFindings[0].stage, "resolved");
  assert.equal(status.reviewFindings[0].practicalRecordId, "later-success");
});

test("a full game that began before independent transfer cannot supply the later practical observation", () => {
  const { record: source, moment, recovery } = reviewFixture();
  let progress = recordPracticalResult(
    recordReviewFindings(initial(), source, [moment]),
    recovery,
  );
  progress = recordPracticalResult(
    progress,
    priorityGame("started-earlier", 0, {
      moves: [0],
      result: "unfinished",
      opportunities: [],
    }),
  );
  progress = record(progress, bank[2]);
  progress = recordPracticalResult(
    progress,
    priorityGame("started-earlier", 0),
  );
  assert.equal(unitStatus(progress, "priority").practicalPending, 1);
  assert.equal(unitStatus(progress, "priority").practicalObserved, false);
});

test("two new completed games with verified skill opportunities provide a distinct practical confirmation route", () => {
  let progress = createPathProgress();
  for (const item of bank)
    progress = noteExposure(progress, { ...item, kind: "answer", at: time });
  const first = priorityGame("practical-one", 0);
  first.opportunities.push(copy(first.opportunities[0]));
  progress = recordPracticalResult(progress, first);
  let status = unitStatus(progress, "priority");
  assert.equal(status.initialConfirmed, false);
  assert.equal(
    status.initialPracticalCount,
    1,
    "multiple events in one game supply only one observation",
  );
  progress = recordPracticalResult(
    progress,
    priorityBlockGame("practical-two", 1),
  );
  status = unitStatus(progress, "priority");
  assert.equal(status.initialConfirmed, true);
  assert.equal(status.initialMethod, "practical");
  assert.equal(status.initialAssessmentCount, 0);
  assert.deepEqual(status.initialPracticalEvidence, [
    { recordId: "practical-one", ply: 9, conditionId: "own-win-first" },
    {
      recordId: "practical-two",
      ply: 9,
      conditionId: "prevent-immediate-loss",
    },
  ]);
  assert.equal(
    unitStatus(progress, "defense").initialConfirmed,
    false,
    "wins do not confer every skill",
  );
  const units = [
    { id: "priority", problemIds: [] },
    { id: "conditions", problemIds: [] },
  ];
  const other = problem("another-unit", "conditions/one", fourth, "conditions");
  assert.equal(
    nextLearningStep(progress, { units, assessmentProblems: [...bank, other] })
      .unitId,
    "conditions",
  );
});

test("coordinate transforms, previous game boards, exposures and attempted boards never become new practical evidence", () => {
  const first = priorityGame("first", 0);
  let progress = recordPracticalResult(createPathProgress(), first);
  const rotate = (i) => (i % 15) * 15 + 14 - Math.floor(i / 15);
  const rotated = {
    ...priorityGame("rotated", 0),
    moves: first.moves.map(rotate),
  };
  rotated.opportunities[0].evidence = {
    played: rotate(4),
    points: [rotate(4)],
  };
  progress = recordPracticalResult(progress, rotated);
  assert.equal(unitStatus(progress, "priority").initialPracticalCount, 1);
  const exposed = priorityGame("exposed", 2);
  progress = noteExposure(progress, {
    unitId: "priority",
    board: beforeEvent(exposed),
    kind: "answer",
    at: time,
  });
  progress = recordPracticalResult(progress, exposed);
  assert.equal(unitStatus(progress, "priority").initialPracticalCount, 1);
  const attempted = priorityGame("attempted", 3);
  progress = record(
    progress,
    problem("known-practice", "known", beforeEvent(attempted)),
    { status: "feedback" },
  );
  progress = recordPracticalResult(progress, attempted);
  assert.equal(unitStatus(progress, "priority").initialPracticalCount, 1);
  const unscored = priorityGame("earlier-without-event", 4, {
    opportunities: [],
  });
  progress = recordPracticalResult(progress, unscored);
  progress = recordPracticalResult(
    progress,
    priorityGame("replayed-earlier-game", 4),
  );
  assert.equal(unitStatus(progress, "priority").initialPracticalCount, 1);
  const previouslyPlayedAssessment = problem(
    "previously-played",
    "new-name",
    beforeEvent(unscored),
  );
  assert.equal(
    selectAssessment(progress, "priority", [previouslyPlayedAssessment]),
    null,
    "a played game position is not an unseen assessment either",
  );
});

test("authored lesson and assessment positions are excluded even without a recorded view", () => {
  const authored = authoredProblems.find((p) => p.id === "win-before-block");
  const black = authored.board.flatMap((side, i) => (side === 1 ? [i] : []));
  const white = authored.board.flatMap((side, i) => (side === 2 ? [i] : []));
  const move = authored.guide[0],
    moves = black.flatMap((point, i) => [point, white[i]]).concat(move);
  const exact = priorityGame("authored-game", 0, {
    moves,
    opportunities: [
      {
        unitId: "priority",
        objectiveId: "take-win",
        kind: "take-win",
        ply: moves.length,
        success: true,
        outcome: "achieved",
        evidence: { played: move, points: [move] },
      },
    ],
  });
  const progress = recordPracticalResult(createPathProgress(), exact);
  assert.equal(progress.practicalResults[exact.id].eligibleFullGame, true);
  assert.equal(unitStatus(progress, "priority").initialPracticalCount, 0);
});

test("practical credit requires a real Black decision, consistent success evidence and terminal unassisted games", () => {
  const baseEvent = priorityGame("fixture").opportunities[0];
  const invalid = [
    { unitId: "priority", success: true },
    { ...baseEvent, ply: 8 },
    { ...baseEvent, ply: 11 },
    { ...baseEvent, success: false },
    { ...baseEvent, outcome: "unknown" },
    { ...baseEvent, evidence: { ...baseEvent.evidence, played: 3 } },
    { ...baseEvent, unitId: "defense" },
    {
      ...baseEvent,
      objectiveId: "finish-game",
      kind: "finish-game",
      unitId: "practice",
    },
  ];
  for (let i = 0; i < invalid.length; i++) {
    const progress = recordPracticalResult(
      createPathProgress(),
      priorityGame(`invalid-${i}`, 0, { opportunities: [invalid[i]] }),
    );
    assert.equal(
      unitStatus(progress, invalid[i].unitId).initialPracticalCount,
      0,
    );
  }
  for (const extra of [
    { assisted: true },
    { moves: [0], result: "unfinished" },
    { result: "resign" },
  ]) {
    const progress = recordPracticalResult(
      createPathProgress(),
      priorityGame("not-eligible", 0, extra),
    );
    assert.equal(unitStatus(progress, "priority").initialPracticalCount, 0);
  }
  const verified = priorityGame("verified", 0, {
    opportunities: [
      {
        source: "verified-pattern",
        unitId: "priority",
        ply: 9,
        success: true,
        outcome: "achieved",
      },
    ],
  });
  assert.equal(
    unitStatus(
      recordPracticalResult(createPathProgress(), verified),
      "priority",
    ).initialPracticalCount,
    1,
  );
  const mixed = recordPracticalResult(
    record(createPathProgress(), bank[0]),
    priorityGame("one-game", 1),
  );
  assert.equal(
    unitStatus(mixed, "priority").initialConfirmed,
    false,
    "one family and one game do not combine into either two-observation route",
  );
});

test("practical retention requires a later new game and immutable completion time, not a later resave", () => {
  let progress = recordPracticalResult(
    recordPracticalResult(createPathProgress(), priorityGame("one", 0)),
    priorityBlockGame("two", 1),
  );
  const tooSoon = priorityGame("too-soon", 2, {
    at: "2026-11-12T11:59:00+09:00",
  });
  progress = recordPracticalResult(progress, tooSoon);
  assert.equal(unitStatus(progress, "priority").retained, false);
  progress = recordPracticalResult(progress, {
    ...tooSoon,
    at: "2026-11-14T12:00:00+09:00",
  });
  assert.equal(progress.practicalResults[tooSoon.id].completedAt, tooSoon.at);
  assert.equal(unitStatus(progress, "priority").retained, false);
  progress = recordPracticalResult(
    progress,
    priorityGame("retained", 3, { at: "2026-11-12T12:00:00+09:00" }),
  );
  const status = unitStatus(progress, "priority");
  assert.equal(status.retained, true);
  assert.equal(status.initialMethod, "practical");
  assert.equal(status.retentionMethod, "practical");
  assert.deepEqual(status.retentionPracticalEvidence, {
    recordId: "retained",
    ply: 9,
    conditionId: "own-win-first",
  });
  let assessed = initial();
  assessed = recordPracticalResult(
    assessed,
    priorityGame("retained-after-assessment", 4, {
      at: "2026-11-12T12:00:00+09:00",
    }),
  );
  assert.equal(unitStatus(assessed, "priority").initialMethod, "assessment");
  assert.equal(unitStatus(assessed, "priority").retentionMethod, "practical");
  let undated = recordPracticalResult(
    createPathProgress(),
    priorityGame("undated", 5, { at: "" }),
  );
  undated = recordPracticalResult(
    undated,
    priorityGame("undated", 5, { at: "2026-11-15T12:00:00+09:00" }),
  );
  assert.equal(undated.practicalResults.undated.completedAt, "");
  assert.equal(
    unitStatus(undated, "priority").initialPracticalCount,
    0,
    "re-saving an undated terminal game does not invent its completion date",
  );
});

test("after recovery two fresh games can supply transfer, and another fresh game is needed to resolve the review", () => {
  const { record: source, moment, recovery } = reviewFixture();
  let progress = recordPracticalResult(
    recordReviewFindings(initial(), source, [moment], { at: time }),
    recovery,
  );
  progress = recordPracticalResult(progress, priorityGame("transfer-one", 6));
  assert.equal(
    unitStatus(progress, "priority").reviewFindings[0].stage,
    "assessment",
  );
  progress = recordPracticalResult(progress, priorityGame("transfer-two", 7));
  let finding = unitStatus(progress, "priority").reviewFindings[0];
  assert.equal(finding.stage, "practical");
  assert.equal(finding.transferMethod, "practical");
  assert.equal(finding.transferEvidence.length, 2);
  assert.equal(unitStatus(progress, "priority").needsReview, false);
  progress = recordPracticalResult(
    progress,
    priorityGame("transfer-repeat", 7),
  );
  assert.equal(
    unitStatus(progress, "priority").reviewFindings[0].stage,
    "practical",
  );
  progress = recordPracticalResult(
    progress,
    priorityGame("transfer-observed", 8),
  );
  finding = unitStatus(progress, "priority").reviewFindings[0];
  assert.equal(finding.stage, "resolved");
  assert.equal(finding.practicalRecordId, "transfer-observed");
});

test("audit: one simple three or one forcing four per game never certifies conditions or order, through either event source", () => {
  let progress = createPathProgress();
  const lines = [
    "A1 A15 B1 C15 C1 E15 D1 G15 E1",
    "A1 B14 B1 D13 C1 F12 D1 H11 E1",
  ];
  for (let i = 0; i < lines.length; i++) {
    const record = tracedGame(
      `audit-short-${i}`,
      lines[i].split(" ").map(parse),
    );
    assert(
      record.opportunities.some(
        (event) => event.objectiveId === "force-four" && event.success,
      ),
    );
    assert(
      record.opportunities.some(
        (event) => event.objectiveId === "build-threat" && event.success,
      ),
    );
    record.opportunities.push(
      {
        source: "verified-pattern",
        unitId: "order",
        ply: 7,
        success: true,
        outcome: "achieved",
      },
      {
        source: "verified-pattern",
        unitId: "conditions",
        ply: 5,
        success: true,
        outcome: "achieved",
      },
    );
    progress = recordPracticalResult(progress, record);
  }
  assert.equal(unitStatus(progress, "order").initialConfirmed, false);
  assert.equal(unitStatus(progress, "conditions").initialConfirmed, false);
  assert.equal(unitStatus(progress, "order").initialPracticalCount, 0);
  assert(
    Object.values(progress.practicalResults).every((record) =>
      record.source.opportunities.some(
        (event) => event.objectiveId === "force-four" && event.success,
      ),
    ),
    "local achievements remain stored",
  );
  assert.equal(
    unitStatus(progress, "priority").initialConfirmed,
    false,
    "two own wins have not demonstrated the blocking priority condition",
  );
});

test("actual authored-strength order, conditions, branch and quiet preparation sequences qualify when the full-game structure is novel", () => {
  const cases = [
    ["order", "check-order-gap-a", "check-order-chain-a"],
    ["conditions", "check-conditions-gap-a", "check-conditions-cross-a"],
    ["branch", "check-switch-cross-a", "check-switch-gap-a"],
    ["prepare", "check-prepare-1", "check-prepare-3"],
    ["counter", "check-counter-finish-a", "check-counter-chain-a"],
    ["defense", "check-defense-gap-a", "check-defense-cross"],
    ["opening", "check-opening-space-a", "check-opening-reply-a"],
  ];
  for (const [unitId, first, second] of cases) {
    let progress = recordPracticalResult(
      createPathProgress(),
      authoredContinuation(`${unitId}-one`, first),
    );
    assert.equal(unitStatus(progress, unitId).initialPracticalCount, 1, first);
    progress = recordPracticalResult(
      progress,
      authoredContinuation(`${unitId}-two`, second),
    );
    const status = unitStatus(progress, unitId);
    assert.equal(
      status.initialConfirmed,
      true,
      `${unitId}: ${status.practicalConditionsObserved.join(",")}`,
    );
    assert.equal(status.initialMethod, "practical");
    assert.equal(
      status.currentConfirmed,
      ![
        "conditions",
        "counter",
        "branch",
        "prepare",
        "opening",
        "practice",
      ].includes(unitId),
      `${unitId}: two actual games preserve baseline history but cannot certify explicit prediction`,
    );
  }
});

test("v5: two goal-matched games after remediation still need every explicit prediction domain", () => {
  for (const [unitId, firstGame, secondGame] of [
    ["conditions", "check-conditions-gap-a", "check-conditions-cross-a"],
    ["counter", "check-counter-finish-a", "check-counter-chain-a"],
  ]) {
    const authoredBank = authoredProblems.filter(
      (item) => item.unitId === unitId && item.role === "assessment",
    );
    const baseBank = authoredBank.filter((item) => !item.assessmentDomain);
    const first = baseBank[0];
    const second = baseBank.find((item) => item.family !== first.family);
    let progress = record(record(createPathProgress(), first), second);
    function predict(item) {
      let state = createAttempt(item.id, { attemptId: `domain-${item.id}` });
      state = answerLearningChoice(
        state,
        item.nodes[0].choices.find((choice) => choice.correct).id,
      );
      if (state.status === "choose")
        state = playLearningMove(state, item.guide[0]);
      assert.equal(state.status, "solved");
      progress = recordAttemptEvidence(progress, state, { ...item, at: time });
    }
    for (const domain of unitStatus(progress, unitId).requiredAssessmentDomains)
      predict(
        selectAssessment(
          progress,
          unitId,
          authoredBank.filter((item) => item.assessmentDomain === domain),
        ),
      );
    const failed = baseBank.find(
      (item) => ![first.id, second.id].includes(item.id),
    );
    progress = record(progress, failed, { hints: { uses: 1 } });
    const lesson = authoredProblems.find(
      (item) => item.unitId === unitId && item.role === "lesson",
    );
    progress = record(progress, lesson, { attemptId: `remedial-${unitId}` });
    progress = recordPracticalResult(
      progress,
      authoredContinuation(`transfer-${unitId}-1`, firstGame),
    );
    progress = recordPracticalResult(
      progress,
      authoredContinuation(`transfer-${unitId}-2`, secondGame),
    );
    let status = unitStatus(progress, unitId);
    assert.equal(status.assessmentReview.baselinePending, false);
    assert.equal(status.assessmentReview.stage, "assessment");
    assert.equal(status.currentConfirmed, false);
    for (const domain of status.requiredAssessmentDomains)
      predict(
        selectAssessment(
          progress,
          unitId,
          authoredBank.filter((item) => item.assessmentDomain === domain),
        ),
      );
    status = unitStatus(progress, unitId);
    assert.equal(status.currentConfirmed, true);
    assert.equal(status.assessmentReview.resolutionMethod, "practical");
    assert.equal(status.assessmentReview.domainResolutionEvidence.length, 2);
  }
});

test("quiet preparation cannot be credited when the original position already has a move creating four", () => {
  const record = authoredContinuation("not-quiet-before", "check-prepare-1", {
    verified: true,
    omitDefaultPair: true,
    extraBlack: "A3 B3 C3".split(" ").map(parse),
    extraWhite: "M2 A13 O7".split(" ").map(parse),
  });
  const progress = recordPracticalResult(createPathProgress(), record);
  assert.equal(progress.practicalResults[record.id].eligibleFullGame, true);
  assert(record.opportunities.some((event) => event.unitId === "prepare"));
  assert.equal(unitStatus(progress, "prepare").initialPracticalCount, 0);
});

test("priority requires winning and blocking decisions across separate games, rather than either easy condition twice", () => {
  let wins = recordPracticalResult(
    recordPracticalResult(createPathProgress(), priorityGame("win-one", 1)),
    priorityGame("win-two", 2),
  );
  assert.equal(unitStatus(wins, "priority").initialConfirmed, false);
  wins = recordPracticalResult(wins, priorityBlockGame("block", 3));
  assert.equal(unitStatus(wins, "priority").initialConfirmed, true);
  let blocks = recordPracticalResult(
    recordPracticalResult(
      createPathProgress(),
      priorityBlockGame("block-one", 1),
    ),
    priorityBlockGame("block-two", 2),
  );
  assert.equal(unitStatus(blocks, "priority").initialConfirmed, false);
  const both = priorityBlockGame("both-in-one", 4);
  both.opportunities.push({
    unitId: "priority",
    objectiveId: "take-win",
    kind: "take-win",
    ply: 13,
    success: true,
    outcome: "achieved",
    evidence: { played: 3, points: [3] },
  });
  assert.equal(
    unitStatus(recordPracticalResult(createPathProgress(), both), "priority")
      .initialConfirmed,
    false,
    "one game cannot supply both required game observations",
  );
});

test("a failed later confirmation preserves initial history but suspends current confirmation and the standard path", () => {
  const units = [
    { id: "priority", problemIds: ["remedial"] },
    { id: "conditions", problemIds: [] },
  ];
  const failedAt = "2026-11-13T12:00:00+09:00";
  let progress = record(
    initial(),
    bank[2],
    {
      status: "feedback",
      metrics: { verifiedMistakes: 1, unknownSelections: 0, retries: 0 },
    },
    failedAt,
  );
  let status = unitStatus(progress, "priority");
  assert.equal(status.initialConfirmed, true);
  assert.equal(status.currentConfirmed, false);
  assert.equal(status.retained, false);
  assert.equal(status.needsReview, true);
  assert.equal(status.label, "保持の復習");
  for (const unitId of [null, "priority"]) {
    const next = nextLearningStep(progress, {
      units,
      assessmentProblems: bank,
      unitId,
    });
    assert.equal(next.unitId, "priority");
    assert.equal(next.kind, "lesson");
    assert.equal(next.reason, "confirmation-remediation");
  }
  progress = record(progress, bank[2], {}, failedAt);
  assert.equal(
    unitStatus(progress, "priority").currentConfirmed,
    false,
    "a corrected same attempt does not remove the error",
  );
  const lesson = { ...bank[0], id: "remedial", role: "lesson" };
  progress = record(progress, lesson, {}, failedAt);
  assert.equal(
    nextLearningStep(progress, { units, assessmentProblems: bank }).reason,
    "assessment-exhausted",
    "an unused defense question cannot replace the failed winning decision",
  );
  const freshOwn = problem(
    "fresh-own",
    "priority/own-win-first",
    board([1, 2, 1], [6, 5, 1], [8, 10, 2]),
  );
  assert.equal(
    nextLearningStep(progress, {
      units,
      assessmentProblems: [...bank, freshOwn],
    }).reason,
    "reconfirmation",
  );
  assert.equal(
    nextLearningStep(progress, {
      units,
      assessmentProblems: [...bank, freshOwn],
    }).problemId,
    "fresh-own",
  );
  progress = record(progress, bank[0], {}, "2026-11-14T12:00:00+09:00");
  assert.equal(
    unitStatus(progress, "priority").currentConfirmed,
    false,
    "an old solved snapshot cannot become a new confirmation",
  );
  progress = record(progress, bank[3], {}, failedAt);
  assert.equal(
    unitStatus(progress, "priority").currentConfirmed,
    false,
    "the opposite priority condition cannot repair this failure",
  );
  progress = record(progress, freshOwn, {}, failedAt);
  status = unitStatus(progress, "priority");
  assert.equal(status.currentConfirmed, true);
  assert.equal(status.assessmentReview.stage, "resolved");
  assert.equal(status.initialAt, time);
  assert.equal(status.retained, true);
});

test("a later failure suspends an older retention result, and a new goal-matched practical pair can reconfirm after remediation", () => {
  let progress = record(initial(), bank[2], {}, "2026-11-12T12:00:00+09:00");
  assert.equal(unitStatus(progress, "priority").retained, true);
  const at = "2026-11-14T12:00:00+09:00";
  progress = record(progress, bank[3], { status: "feedback" }, at);
  let status = unitStatus(progress, "priority");
  assert.equal(status.historicalRetained, true);
  assert.equal(status.retained, false);
  assert.equal(status.currentConfirmed, false);
  progress = record(
    progress,
    { ...bank[0], id: "later-lesson", role: "lesson" },
    {},
    at,
  );
  progress = recordPracticalResult(
    progress,
    priorityGame("later-win", 6, { at }),
  );
  assert.equal(unitStatus(progress, "priority").currentConfirmed, false);
  progress = recordPracticalResult(
    progress,
    priorityBlockGame("later-block", 6, { at }),
  );
  assert.equal(
    unitStatus(progress, "priority").currentConfirmed,
    false,
    "a single matching game is insufficient for practical reconfirmation",
  );
  progress = recordPracticalResult(
    progress,
    priorityBlockGame("later-block-two", 7, { at }),
  );
  status = unitStatus(progress, "priority");
  assert.equal(status.currentConfirmed, true);
  assert.equal(status.assessmentReview.resolutionMethod, "practical");
  assert.equal(status.retained, true);
});

test("undated failures persist and neither undated completion nor later resaving can clear confirmation review", () => {
  let progress = record(initial(), bank[2], { status: "feedback" }, "");
  assert.equal(unitStatus(progress, "priority").needsReview, true);
  const lesson = { ...bank[0], id: "undated-remedial", role: "lesson" };
  progress = record(progress, lesson, {}, "");
  progress = record(progress, lesson, {}, "2026-11-14T12:00:00+09:00");
  assert.equal(
    unitStatus(progress, "priority").assessmentReview.stage,
    "remediation",
  );
  progress = record(
    progress,
    { ...lesson, id: "dated-remedial" },
    {},
    "2026-11-14T12:00:00+09:00",
  );
  progress = record(progress, bank[3], {}, "");
  progress = record(progress, bank[3], {}, "2026-11-15T12:00:00+09:00");
  const restored = createPathProgress(copy(progress));
  assert.equal(restored.attempts["attempt-d"].completedAt, "");
  assert.equal(unitStatus(restored, "priority").currentConfirmed, false);
  assert.equal(
    unitStatus(restored, "priority").assessmentReview.stage,
    "assessment",
  );
});

test("the two legacy winning families migrate into one priority condition without promoting unseen defense", () => {
  const old = copy(initial());
  old.attempts["attempt-a"].family = "priority/gapped-race";
  old.attempts["attempt-b"].family = "priority/multiple-finishes";
  const progress = createPathProgress(old);
  assert.equal(progress.attempts["attempt-a"].family, "priority/own-win-first");
  assert.equal(progress.attempts["attempt-b"].family, "priority/own-win-first");
  assert.equal(
    progress.attempts["attempt-a"].originalFamily,
    "priority/gapped-race",
  );
  assert.equal(unitStatus(progress, "priority").initialConfirmed, false);
  assert.equal(unitStatus(progress, "priority").initialAssessmentCount, 1);
  assert.equal(Object.keys(progress.attempts).length, 2);
  assert.deepEqual(createPathProgress(copy(progress)), progress);
  const defended = record(progress, bank[3]);
  assert.equal(unitStatus(defended, "priority").initialConfirmed, true);
});

test("retiring the defense race preserves its history and exposure without certifying defense or promoting priority", () => {
  const raceBoard = Array(225).fill(0);
  for (const [stones, side] of [
    ["C9 D9 E9 F9 H3 J5", 1],
    ["C4 D4 E4 F4 J10 J12", 2],
  ])
    for (const point of stones.split(" ")) raceBoard[parse(point)] = side;
  const race = {
    ...problem(
      "check-defense-race",
      "defense/two-axis-threat",
      raceBoard,
      "defense",
    ),
    branchId: "own-five-before-opponent-four",
    requiresBranch: false,
  };
  const authored = (id) => authoredProblems.find((p) => p.id === id);
  const solve = (id) => {
    let state = createAttempt(id, { attemptId: `migration-${id}` });
    for (let n = 0; state.status === "choose" && n < 12; n++)
      state = playLearningMove(state, state.guide[0]);
    assert.equal(state.status, "solved", id);
    return state;
  };
  let raw = recordAttemptEvidence(
    createPathProgress(),
    solve("check-defense-gap-a"),
    {
      ...authored("check-defense-gap-a"),
      at: time,
    },
  );
  raw = record(raw, race, { history: [{ i: parse("B9"), side: 1 }] });
  const raceId = `attempt-${race.id}`;
  delete raw.attempts[raceId].assessmentExclusion;
  const untouched = copy(raw);
  const restored = createPathProgress(raw);
  assert.deepEqual(
    raw,
    untouched,
    "migration must not mutate the supplied save",
  );
  assert.deepEqual(restored.attempts[raceId], {
    ...untouched.attempts[raceId],
    assessmentExclusion: "retired-defense-race",
  });
  assert.deepEqual(restored.exposures, untouched.exposures);
  assert.equal(unitStatus(restored, "defense").initialConfirmed, false);
  assert.equal(unitStatus(restored, "defense").initialAssessmentCount, 1);
  assert.equal(unitStatus(restored, "priority").initialAssessmentCount, 0);
  assert.deepEqual(createPathProgress(copy(restored)), restored);
  assert.equal(selectAssessment(restored, "defense", [race]), null);

  // A different ID still cannot turn the old, encountered board into unseen evidence.
  const alias = { ...race, id: "old-race-renamed" };
  const known = record(restored, alias, {
    history: [{ i: parse("B9"), side: 1 }],
  });
  assert.equal(known.attempts["attempt-old-race-renamed"].exposureSeen, true);
  assert.equal(unitStatus(known, "defense").initialConfirmed, false);

  // An actual two-axis defense restores the pair; unrelated legitimate evidence survives.
  const withCross = recordAttemptEvidence(
    restored,
    solve("check-defense-cross"),
    {
      ...authored("check-defense-cross"),
      at: time,
    },
  );
  const confirmed = unitStatus(withCross, "defense");
  assert.equal(confirmed.initialConfirmed, true);
  assert.deepEqual(confirmed.initialEvidence, [
    "check-defense-gap-a",
    "check-defense-cross",
  ]);
  let validPair = recordAttemptEvidence(
    createPathProgress(),
    solve("check-defense-gap-a"),
    {
      ...authored("check-defense-gap-a"),
      at: time,
    },
  );
  validPair = recordAttemptEvidence(validPair, solve("check-defense-cross"), {
    ...authored("check-defense-cross"),
    at: time,
  });
  const retainedRaw = record(
    validPair,
    race,
    {
      attemptId: "old-race-later",
      history: [{ i: parse("B9"), side: 1 }],
    },
    "2026-11-13T12:00:00+09:00",
  );
  delete retainedRaw.attempts["old-race-later"].assessmentExclusion;
  assert.equal(retainedRaw.attempts["old-race-later"].exposureSeen, false);
  const retained = unitStatus(createPathProgress(retainedRaw), "defense");
  assert.equal(retained.initialConfirmed, true);
  assert.equal(
    retained.retained,
    false,
    "retired race cannot supply later retention",
  );
  assert.deepEqual(retained.initialEvidence, confirmed.initialEvidence);

  // New callers and older candidate lists cannot revive the retired assessment.
  const incoming = record(restored, race, {
    attemptId: "old-race-replayed",
    history: [{ i: parse("G9"), side: 1 }],
  });
  assert.equal(
    incoming.attempts["old-race-replayed"].assessmentExclusion,
    "retired-defense-race",
  );
  assert.equal(unitStatus(incoming, "defense").initialConfirmed, false);
  assert.equal(selectAssessment(createPathProgress(), "defense", [race]), null);
  assert.equal(
    selectAssessment(restored, "defense", [
      authored("check-defense-cross-straight"),
    ]).id,
    "check-defense-cross-straight",
  );
});

test("a retired defense-race failure does not demand irrelevant defense remediation", () => {
  const retired = {
    ...problem(
      "check-defense-race",
      "defense/two-axis-threat",
      base,
      "defense",
    ),
    requiresBranch: false,
  };
  const progress = record(createPathProgress(), retired, {
    status: "feedback",
  });
  const next = problem(
    "fresh-defense",
    "defense/distant-broken-threat",
    different,
    "defense",
  );
  const step = nextLearningStep(progress, {
    units: [{ id: "defense", problemIds: ["defense-lesson"] }],
    assessmentProblems: [retired, next],
    at: time,
  });
  assert.equal(step.kind, "assessment");
  assert.equal(step.problemId, "fresh-defense");
  assert.equal(
    progress.attempts["attempt-check-defense-race"].status,
    "feedback",
  );
});

test("failures on both priority decisions remain separate until each condition is freshly reconfirmed", () => {
  const at = "2026-11-13T12:00:00+09:00";
  let progress = record(
    record(initial(), bank[2], { status: "feedback" }, at),
    bank[3],
    { status: "feedback" },
    at,
  );
  progress = record(
    progress,
    { ...bank[0], id: "both-remedial", role: "lesson" },
    {},
    at,
  );
  assert.equal(unitStatus(progress, "priority").assessmentReviews.length, 2);
  const own = problem(
    "own-again",
    "priority/own-win-first",
    board([1, 2, 1], [6, 5, 1], [8, 10, 2]),
  );
  const defense = problem(
    "defend-again",
    "priority/prevent-immediate-loss",
    board([1, 2, 1], [6, 7, 1], [8, 11, 2]),
  );
  progress = record(progress, own, {}, at);
  let status = unitStatus(progress, "priority");
  assert.equal(status.currentConfirmed, false);
  assert.equal(
    status.assessmentReview.requiredCondition,
    "prevent-immediate-loss",
  );
  assert.equal(
    selectAssessment(progress, "priority", [own, defense]).id,
    defense.id,
  );
  progress = record(progress, defense, {}, at);
  status = unitStatus(progress, "priority");
  assert.equal(status.currentConfirmed, true);
  assert(
    status.assessmentReviews.every((review) => review.stage === "resolved"),
  );
});

test("miss-block review cannot be closed by winning-only transfer or by a later winning-only opportunity", () => {
  const prefix = [0, 30, 2, 31, 4, 32, 6, 33],
    before = Array(225).fill(0);
  prefix.forEach((point, i) => (before[point] = (i % 2) + 1));
  const source = {
    id: "block-review",
    moves: [...prefix, 60, 34],
    rule: "freestyle15",
  };
  const moment = {
    ply: 9,
    actual: 60,
    before,
    kind: "miss-block",
    skillId: "priority",
    alternatives: [34],
    evidence: { status: "proven", attacker: 2, line: [34] },
  };
  let progress = recordReviewFindings(initial(), source, [moment], {
    at: time,
  });
  const recovery = {
    ...priorityBlockGame("block-recovery", 0),
    role: "recovery",
    completed: true,
    startPly: 8,
    startBoard: before,
    sourceReview: { recordId: source.id, ply: 9, before },
  };
  progress = recordPracticalResult(progress, recovery);
  progress = record(progress, bank[2]);
  assert.equal(
    unitStatus(progress, "priority").reviewFindings[0].stage,
    "assessment",
  );
  assert.equal(selectAssessment(progress, "priority", bank).id, "d");
  progress = record(progress, bank[3]);
  assert.equal(
    unitStatus(progress, "priority").reviewFindings[0].stage,
    "practical",
  );
  progress = recordPracticalResult(
    progress,
    priorityGame("wrong-practical-side", 8),
  );
  assert.equal(
    unitStatus(progress, "priority").reviewFindings[0].stage,
    "practical",
  );
  progress = recordPracticalResult(
    progress,
    priorityBlockGame("matching-practical-side", 2),
  );
  assert.equal(
    unitStatus(progress, "priority").reviewFindings[0].stage,
    "resolved",
  );
});
