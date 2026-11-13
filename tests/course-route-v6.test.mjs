import test from "node:test";
import assert from "node:assert/strict";
import { problems, units } from "../dist/curriculum.js";
import {
  createAttempt,
  answerLearningChoice,
  playLearningMove,
  hintLearning,
} from "../dist/learning.js";
import {
  createPathProgress,
  recordAttemptEvidence,
  recordPracticalResult,
  recordReviewFindings,
  noteExposure,
  selectAssessment,
  assessmentAvailability,
  unitStatus,
  requiredAssessmentDomains,
} from "../dist/learning-path.js";
import {
  nextCourseStep,
  courseProgressSummary,
} from "../dist/course-route.js";

const at = "2026-11-13T09:00:00+09:00";
const copy = (value) => JSON.parse(JSON.stringify(value));
const byId = new Map(problems.map((problem) => [problem.id, problem]));
const bank = problems.filter((problem) => problem.role === "assessment");
const settings = { units, assessmentProblems: bank, at };
const baseline = (unitId) =>
  bank.filter((problem) => problem.unitId === unitId && !problem.assessmentDomain);
const domainBank = (unitId, domain) =>
  bank.filter(
    (problem) =>
      problem.unitId === unitId && problem.assessmentDomain === domain,
  );
const solvedCache = new Map();
let attemptNumber = 0;

// Exercise the same learning state transitions that the application records.
function solve(problem, hinted = false) {
  const cacheKey = `${problem.id}/${hinted}`;
  if (!solvedCache.has(cacheKey)) {
    let attempt = createAttempt(problem.id, { attemptId: cacheKey });
    if (hinted) attempt = hintLearning(attempt);
    for (let moves = 0; attempt.status === "choose" && moves < 30; moves++) {
      const node = problem.nodes.find((node) => node.id === attempt.nodeId);
      attempt = !attempt.exercise && node?.input === "choice"
        ? answerLearningChoice(
            attempt,
            node.choices.find((choice) => choice.correct).id,
          )
        : playLearningMove(attempt, attempt.guide[0]);
    }
    assert.equal(attempt.status, "solved", problem.id);
    assert.equal(attempt.metrics.verifiedMistakes, 0, problem.id);
    assert.equal(attempt.metrics.unknownSelections, 0, problem.id);
    solvedCache.set(cacheKey, attempt);
  }
  return {
    ...copy(solvedCache.get(cacheKey)),
    attemptId: `course-attempt-${++attemptNumber}`,
  };
}
function record(progress, problem, hinted = false) {
  return recordAttemptEvidence(progress, solve(problem, hinted), { ...problem, at });
}
function lessons(progress, unit, hinted = true) {
  for (const id of unit.problemIds) progress = record(progress, byId.get(id), hinted);
  return progress;
}
function expose(progress, candidates) {
  for (const problem of candidates)
    progress = noteExposure(progress, { ...problem, kind: "answer", at });
  return progress;
}
function withBaseline(progress, unitId) {
  for (let count = 0; count < baseline(unitId).length; count++) {
    if (unitStatus(progress, unitId).baselineConfirmed) return progress;
    const next = selectAssessment(progress, unitId, bank);
    assert(next, `${unitId}: independent baseline available`);
    progress = record(progress, next);
  }
  assert(unitStatus(progress, unitId).baselineConfirmed, unitId);
  return progress;
}
function reviewFixture() {
  const prefix = [0, 30, 1, 31, 2, 32, 3, 33];
  const before = Array(225).fill(0);
  prefix.forEach((i, ply) => (before[i] = (ply % 2) + 1));
  return {
    record: {
      id: "course-review",
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
      id: "course-recovery",
      role: "recovery",
      completed: true,
      startPly: 8,
      startBoard: before,
      sourceReview: { recordId: "course-review", ply: 9, before },
      moves: [...prefix, 4],
      result: "win",
      assisted: true,
      completedAt: at,
    },
  };
}

test("zero progress starts the authored lesson queue; hint completion never confirms", () => {
  let progress = createPathProgress();
  assert.deepEqual(nextCourseStep(progress, settings), {
    kind: "lesson",
    unitId: "priority",
    problemId: "win-before-block",
    reason: "course-lesson",
    label: "練習する",
  });
  assert.equal(courseProgressSummary(progress, { units }).completedLessonCount, 0);
  for (const id of units[0].problemIds) {
    const next = nextCourseStep(progress, settings);
    assert.equal(next.kind, "lesson");
    assert.equal(next.problemId, id);
    progress = record(progress, byId.get(id), true);
    assert.equal(unitStatus(progress, "priority").currentConfirmed, false);
  }
  assert.equal(nextCourseStep(progress, settings).kind, "assessment");
  const before = copy(progress);
  const restored = createPathProgress(copy(progress));
  assert.deepEqual(nextCourseStep(restored, settings), nextCourseStep(progress, settings));
  assert.deepEqual(progress, before, "navigation cannot mutate the ledger");
});

test("in-progress lessons, assessment aliases and another unit's attempts do not skip lessons", () => {
  const first = byId.get(units[0].problemIds[0]);
  let progress = recordAttemptEvidence(
    createPathProgress(),
    createAttempt(first.id, { attemptId: "unfinished" }),
    { ...first, at },
  );
  progress = recordAttemptEvidence(progress, solve(first), {
    ...first,
    unitId: "conditions",
    at,
  });
  progress = recordAttemptEvidence(progress, solve(first), {
    ...first,
    role: "assessment",
    at,
  });
  assert.equal(courseProgressSummary(progress, { units }).completedLessonCount, 0);
  // A mislabeled assessment can require remediation, but cannot advance the queue.
  assert.equal(nextCourseStep(progress, settings).problemId, first.id);
});

test("two hinted winning checks and two clean defensive checks exhaust all four baselines without a game cliff", () => {
  let progress = lessons(createPathProgress(), units[0]);
  const checks = [];
  let remediations = 0;
  for (let count = 0; count < 12; count++) {
    const next = nextCourseStep(progress, settings);
    if (next.unitId !== "priority") {
      assert.equal(next.kind, "lesson");
      assert.equal(next.unitId, "conditions");
      assert.equal(next.problemId, units[1].problemIds[0]);
      break;
    }
    if (next.kind === "lesson") {
      assert.equal(next.reason, "remediation");
      remediations++;
      progress = record(progress, byId.get(next.problemId), true);
    } else {
      assert.equal(next.kind, "assessment");
      const problem = byId.get(next.problemId);
      checks.push(problem);
      progress = record(
        progress,
        problem,
        problem.family === "priority/own-win-first",
      );
    }
  }
  assert.equal(checks.length, 4);
  assert.equal(remediations, 2);
  assert.equal(checks.filter((problem) => problem.family === "priority/own-win-first").length, 2);
  assert.equal(assessmentAvailability(progress, "priority", bank).state, "exhausted");
  assert.equal(unitStatus(progress, "priority").currentConfirmed, false);
  assert.equal(nextCourseStep(progress, { ...settings, unitId: "priority" }).unitId, "conditions");
  assert.equal(nextCourseStep(progress, { ...settings, unitId: "conditions" }).unitId, "conditions");
  assert.deepEqual(nextCourseStep(createPathProgress(copy(progress)), settings), nextCourseStep(progress, settings));
});

test("an unfinished prerequisite is taught before a selected later unit", () => {
  const next = nextCourseStep(createPathProgress(), { ...settings, unitId: "practice" });
  assert.equal(next.unitId, "priority");
  assert.equal(next.kind, "lesson");
});

test("all nine lesson queues remain finite after assessment exhaustion, without confirming a unit", () => {
  let progress = expose(createPathProgress(), bank);
  const expected = units.flatMap((unit) => unit.problemIds);
  const encountered = [];
  for (const id of expected) {
    const before = JSON.stringify(progress);
    const next = nextCourseStep(progress, settings);
    assert.equal(JSON.stringify(progress), before);
    assert.equal(next.kind, "lesson", id);
    assert.equal(next.problemId, id);
    encountered.push(next.unitId);
    progress = record(progress, byId.get(id), true);
  }
  assert.deepEqual([...new Set(encountered)], units.map((unit) => unit.id));
  const next = nextCourseStep(progress, settings);
  assert.equal(next.kind, "journey");
  assert.equal(next.reason, "course-practiced");
  assert.equal(next.guided, true);
  assert.deepEqual(next.pendingConfirmationUnitIds, units.map((unit) => unit.id));
  const summary = courseProgressSummary(progress, { units });
  assert.equal(summary.completedLessonCount, expected.length);
  assert.equal(summary.practicedUnitCount, 9);
  assert.equal(summary.confirmedUnitCount, 0);
  assert.equal(summary.coursePracticed, true);
  assert.equal(summary.allConfirmed, false);
  assert.deepEqual(nextCourseStep(createPathProgress(copy(progress)), settings), next);
});

test("a novice can complete the whole course using hints on every check, with all confirmations still pending", () => {
  let progress = createPathProgress();
  const taught = new Set();
  const checked = new Set();
  let next;
  for (let count = 0; count < 250; count++) {
    next = nextCourseStep(progress, settings);
    if (next.kind === "journey") break;
    assert(["lesson", "assessment"].includes(next.kind), next.reason);
    if (next.kind === "lesson") taught.add(next.problemId);
    else {
      assert(!checked.has(next.problemId), "seen checks never regain independent eligibility");
      checked.add(next.problemId);
    }
    progress = record(progress, byId.get(next.problemId), true);
  }
  assert.equal(next.kind, "journey", "the finite course must terminate without an exhaustion loop");
  assert.equal(next.reason, "course-practiced");
  assert.equal(next.guided, true);
  assert.deepEqual([...taught].sort(), units.flatMap((unit) => unit.problemIds).sort());
  assert.equal(new Set([...checked].map((id) => byId.get(id).unitId)).size, 9);
  const summary = courseProgressSummary(progress, { units });
  assert.equal(summary.practicedUnitCount, 9);
  assert.equal(summary.confirmedUnitCount, 0);
  assert.deepEqual(summary.pendingConfirmationUnitIds, units.map((unit) => unit.id));
  assert.deepEqual(nextCourseStep(createPathProgress(copy(progress)), settings), next);
});

for (const [unitId, domains] of Object.entries(requiredAssessmentDomains)) {
  for (const domain of domains) {
    test(`${domain}: finite domain exhaustion permits the next lesson while confirmation stays pending`, () => {
      const index = units.findIndex((unit) => unit.id === unitId);
      const unit = units[index];
      let progress = withBaseline(createPathProgress(), unitId);
      for (const other of domains)
        if (other !== domain) progress = record(progress, domainBank(unitId, other)[0]);
      progress = record(progress, domainBank(unitId, domain)[0], true);
      const remedial = nextCourseStep(progress, {
        ...settings,
        units: [unit],
      });
      assert.equal(remedial.reason, "confirmation-remediation");
      assert.equal(byId.get(remedial.problemId).teachesAssessmentDomain, domain);
      progress = expose(progress, domainBank(unitId, domain));
      progress = lessons(progress, unit);
      const suppliedUnits = units.slice(index, index + 2);
      const options = { ...settings, units: suppliedUnits, unitId };
      const status = unitStatus(progress, unitId);
      assert.equal(status.currentConfirmed, false);
      assert.equal(status.assessmentReview.stage, "assessment");
      assert.deepEqual(status.pendingAssessmentDomains, [domain]);
      const availability = assessmentAvailability(progress, unitId, bank);
      assert.equal(availability.state, "exhausted");
      assert.deepEqual(availability.exhaustedDomains, [domain]);
      const before = copy(progress);
      const next = nextCourseStep(progress, options);
      if (index < units.length - 1) {
        assert.equal(next.kind, "lesson");
        assert.equal(next.unitId, units[index + 1].id);
        assert.equal(next.problemId, units[index + 1].problemIds[0]);
      } else {
        assert.equal(next.kind, "journey");
        assert.equal(next.reason, "course-practiced");
        assert.equal(next.guided, true);
      }
      assert.deepEqual(progress, before);
      assert.deepEqual(nextCourseStep(createPathProgress(copy(progress)), options), next);
      assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
    });
  }
}

test("real review recovery and available transfer keep global priority over a selected lesson", () => {
  const fixture = reviewFixture();
  let progress = recordReviewFindings(createPathProgress(), fixture.record, [fixture.moment], { at });
  const options = { ...settings, unitId: "conditions" };
  const next = nextCourseStep(progress, options);
  assert.equal(next.kind, "review");
  assert.equal(next.unitId, "priority");
  assert.equal(next.recordId, fixture.record.id);
  assert.equal(next.reason, "review-recovery");
  progress = recordPracticalResult(progress, fixture.recovery);
  const transfer = nextCourseStep(progress, options);
  assert.equal(transfer.kind, "assessment");
  assert.equal(transfer.unitId, "priority");
  assert.equal(transfer.reason, "review-transfer");
  assert.equal(unitStatus(progress, "priority").currentConfirmed, false);
  progress = expose(progress, baseline("priority"));
  progress = lessons(progress, units[0]);
  const later = nextCourseStep(progress, options);
  assert.equal(later.kind, "lesson");
  assert.equal(later.unitId, "conditions");
  assert.equal(unitStatus(progress, "priority").reviewFindings[0].stage, "assessment");
  progress = expose(progress, bank);
  for (const unit of units.slice(1)) progress = lessons(progress, unit);
  const guided = nextCourseStep(progress, options);
  assert.equal(guided.kind, "journey");
  assert.equal(guided.unitId, "priority");
  assert.equal(guided.reason, "course-practiced");
  assert.equal(guided.guided, true);
  assert.equal(unitStatus(progress, "priority").reviewFindings[0].stage, "assessment");
});

test("a failed later confirmation requires global remediation before a selected later lesson", () => {
  let progress = withBaseline(createPathProgress(), "priority");
  const previousEvidence = unitStatus(progress, "priority").initialEvidence;
  const fresh = selectAssessment(progress, "priority", bank);
  assert(fresh);
  progress = record(progress, fresh, true);
  assert.equal(unitStatus(progress, "priority").assessmentReviewPending, true);
  const next = nextCourseStep(progress, { ...settings, unitId: "conditions" });
  assert.equal(next.kind, "lesson");
  assert.equal(next.unitId, "priority");
  assert.equal(next.reason, "confirmation-remediation");
  progress = record(progress, byId.get(next.problemId), true);
  progress = lessons(progress, units[0]);
  progress = expose(progress, baseline("priority"));
  const later = nextCourseStep(progress, { ...settings, unitId: "conditions" });
  assert.equal(later.kind, "lesson");
  assert.equal(later.unitId, "conditions");
  const status = unitStatus(progress, "priority");
  assert.equal(status.assessmentReviewPending, true);
  assert.equal(status.assessmentReview.stage, "assessment");
  assert.equal(status.currentConfirmed, false);
  assert.deepEqual(status.initialEvidence, previousEvidence);
});

test("a later domain remediation is not hidden behind an exhausted earlier reconfirmation", () => {
  const unit = units.find((unit) => unit.id === "conditions");
  let progress = withBaseline(createPathProgress(), unit.id);
  for (const domain of requiredAssessmentDomains[unit.id])
    progress = record(progress, domainBank(unit.id, domain)[0]);
  for (const domain of requiredAssessmentDomains[unit.id]) {
    progress = record(progress, domainBank(unit.id, domain)[1], true);
    if (domain === "conditions-positive") {
      const remedial = nextCourseStep(progress, settings);
      assert.equal(remedial.reason, "confirmation-remediation");
      progress = record(progress, byId.get(remedial.problemId), true);
      progress = expose(progress, domainBank(unit.id, domain));
    }
  }
  const next = nextCourseStep(progress, { ...settings, unitId: "opening" });
  assert.equal(next.reason, "confirmation-remediation");
  assert.equal(next.unitId, "conditions");
  assert.equal(byId.get(next.problemId).teachesAssessmentDomain, "conditions-negative");
});

test("existing independent confirmation skips prior lessons and all-confirmed retains its outcome", () => {
  let progress = withBaseline(createPathProgress(), "priority");
  assert.equal(nextCourseStep(progress, settings).unitId, "conditions");
  for (const unit of units) {
    progress = withBaseline(progress, unit.id);
    for (const domain of requiredAssessmentDomains[unit.id] || [])
      progress = record(progress, domainBank(unit.id, domain)[0]);
    assert.equal(unitStatus(progress, unit.id).currentConfirmed, true, unit.id);
  }
  const before = copy(progress);
  const next = nextCourseStep(progress, settings);
  assert.equal(next.kind, "journey");
  assert.equal(next.reason, "initial-complete");
  assert.equal(next.guided, true);
  assert.deepEqual(next.pendingConfirmationUnitIds, []);
  const summary = courseProgressSummary(progress, { units });
  assert.equal(summary.completedLessonCount, 0);
  assert.equal(summary.confirmedUnitCount, 9);
  assert.equal(summary.coursePracticed, true);
  assert.equal(summary.allConfirmed, true);
  assert.deepEqual(progress, before);
});
