import test from "node:test";
import assert from "node:assert/strict";
import { problems, units } from "../dist/curriculum.js";
import {
  createAttempt,
  answerLearningChoice,
  playLearningMove,
} from "../dist/learning.js";
import {
  createPathProgress,
  recordAttemptEvidence,
  noteExposure,
  unitStatus,
  selectAssessment,
  assessmentAvailability,
  nextLearningStep,
  requiredAssessmentDomains,
  positionFingerprint,
} from "../dist/learning-path.js";

const day = "2026-11-13T09:00:00+09:00";
const later = "2026-11-15T09:00:00+09:00";
const copy = (value) => JSON.parse(JSON.stringify(value));
const bank = problems.filter((problem) => problem.role === "assessment");
const domainPairs = Object.entries(requiredAssessmentDomains).flatMap(
  ([unitId, domains]) => domains.map((domain) => [unitId, domain]),
);
const original = bank.filter(
  (problem) => problem.assessmentDomain && problem.supply !== "reserve",
);
const reserves = bank.filter((problem) => problem.supply === "reserve");
const domainBank = (unitId, domain) =>
  bank.filter(
    (problem) =>
      problem.unitId === unitId && problem.assessmentDomain === domain,
  );
const originalDomain = (unitId, domain) =>
  domainBank(unitId, domain).filter((problem) => problem.supply !== "reserve");
const reserveDomain = (unitId, domain) =>
  domainBank(unitId, domain).filter((problem) => problem.supply === "reserve");
const baseline = (unitId) =>
  bank.filter(
    (problem) => problem.unitId === unitId && !problem.assessmentDomain,
  );
const lessonFor = (unitId, domain) =>
  problems.find(
    (problem) =>
      problem.role === "lesson" &&
      problem.unitId === unitId &&
      problem.teachesAssessmentDomain === domain,
  );
const settings = (unitId, assessmentProblems = bank) => ({
  units: units.filter((unit) => unit.id === unitId),
  assessmentProblems,
});
const solvedCache = new Map();
function solved(problem, attemptId = problem.id) {
  if (!solvedCache.has(problem.id)) {
    let attempt = createAttempt(problem.id, { attemptId: problem.id });
    if (problem.kind === "compare")
      attempt = answerLearningChoice(
        attempt,
        problem.nodes[0].choices.find((choice) => choice.correct).id,
      );
    for (let count = 0; attempt.status === "choose" && count < 20; count++)
      attempt = playLearningMove(attempt, attempt.guide[0]);
    assert.equal(attempt.status, "solved", problem.id);
    assert.equal(attempt.metrics.verifiedMistakes, 0, problem.id);
    assert.equal(attempt.metrics.unknownSelections, 0, problem.id);
    solvedCache.set(problem.id, attempt);
  }
  return { ...copy(solvedCache.get(problem.id)), attemptId };
}
function record(progress, problem, { at = day, attemptId } = {}) {
  return recordAttemptEvidence(progress, solved(problem, attemptId), {
    ...problem,
    at,
  });
}
function fail(progress, problem, at = day) {
  let attempt = createAttempt(problem.id, { attemptId: problem.id });
  attempt = answerLearningChoice(
    attempt,
    problem.nodes[0].choices.find((choice) => !choice.correct).id,
  );
  assert.equal(attempt.status, "feedback", problem.id);
  assert.equal(attempt.metrics.verifiedMistakes, 1, problem.id);
  return recordAttemptEvidence(progress, attempt, { ...problem, at });
}
function withBaseline(unitId) {
  let progress = createPathProgress();
  const firstFamilies = baseline(unitId).filter(
    (problem, index, candidates) =>
      candidates.findIndex((other) => other.family === problem.family) ===
      index,
  );
  for (const problem of firstFamilies) {
    progress = record(progress, problem);
    if (unitStatus(progress, unitId).baselineConfirmed) return progress;
  }
  assert.fail(`${unitId}: original baseline remains reachable`);
}
function missingOnly(unitId, missingDomain) {
  let progress = withBaseline(unitId);
  for (const domain of requiredAssessmentDomains[unitId])
    if (domain !== missingDomain)
      progress = record(progress, originalDomain(unitId, domain)[0]);
  return progress;
}
function covered(unitId) {
  let progress = withBaseline(unitId);
  for (const domain of requiredAssessmentDomains[unitId])
    progress = record(progress, originalDomain(unitId, domain)[0]);
  return progress;
}
function expose(progress, candidates, at = day) {
  for (const problem of candidates)
    progress = noteExposure(progress, { ...problem, kind: "answer", at });
  return progress;
}

test("stage-three supply is a registered static catalog for all fifteen required domains", () => {
  assert.equal(domainPairs.length, 15);
  assert.equal(original.length, 50);
  assert.equal(reserves.length, 134);
  const originalPositions = new Set(
    problems
      .filter((problem) => problem.supply !== "reserve")
      .map((problem) => positionFingerprint(problem.board)),
  );
  const reservePositions = new Set();
  for (const problem of reserves) {
    assert(
      requiredAssessmentDomains[problem.unitId].includes(
        problem.assessmentDomain,
      ),
    );
    assert.equal(problem.kind, "compare");
    const fingerprint = positionFingerprint(problem.board);
    assert(!originalPositions.has(fingerprint), problem.id);
    assert(!reservePositions.has(fingerprint), problem.id);
    reservePositions.add(fingerprint);
  }
  for (const [unitId, domain] of domainPairs)
    assert(reserveDomain(unitId, domain).length, domain);
});

for (const [unitId, domain] of domainPairs) {
  test(`${domain}: original questions precede reserve regardless of bank order or supplied supply labels`, () => {
    const progress = missingOnly(unitId, domain);
    const authored = originalDomain(unitId, domain)[0];
    const reserve = reserveDomain(unitId, domain)[0];
    const reversed = [
      { ...reserve, supply: "authored" },
      { ...authored, supply: "reserve" },
    ];
    assert.equal(selectAssessment(progress, unitId, reversed).id, authored.id);
    const availability = assessmentAvailability(progress, unitId, reversed);
    assert.equal(availability.state, "ready");
    assert.equal(availability.assessmentDomain, domain);
    assert.deepEqual(availability.remaining, {
      authored: 1,
      reserve: 1,
      total: 2,
    });
    assert.equal(
      selectAssessment(expose(progress, [authored]), unitId, reversed).id,
      reserve.id,
    );
    assert.deepEqual(
      assessmentAvailability(progress, unitId, [reserve, reserve]).remaining,
      { authored: 0, reserve: 1, total: 1 },
    );
  });

  test(`${domain}: all original questions can fail, then matching remediation and a reserve question clear only this deficit`, () => {
    let progress = missingOnly(unitId, domain);
    const initialEvidence = unitStatus(progress, unitId).initialEvidence;
    for (const problem of originalDomain(unitId, domain))
      progress = fail(progress, problem);
    assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
    const lessonStep = nextLearningStep(progress, settings(unitId));
    assert.equal(lessonStep.kind, "lesson");
    assert.equal(
      problems.find((problem) => problem.id === lessonStep.problemId)
        .teachesAssessmentDomain,
      domain,
    );
    progress = record(progress, lessonFor(unitId, domain));
    const before = JSON.stringify(progress);
    const availability = assessmentAvailability(progress, unitId, bank);
    assert.equal(availability.state, "ready");
    assert.equal(availability.phase, "reconfirmation");
    assert.equal(availability.assessmentDomain, domain);
    assert.deepEqual(availability.pendingDomains, [domain]);
    assert.equal(availability.remaining.authored, 0);
    assert.equal(
      availability.remaining.reserve,
      reserveDomain(unitId, domain).length,
    );
    const next = selectAssessment(progress, unitId, bank);
    assert.equal(next.supply, "reserve");
    assert.equal(next.assessmentDomain, domain);
    assert.equal(
      nextLearningStep(progress, settings(unitId)).problemId,
      next.id,
    );
    assert.equal(
      JSON.stringify(progress),
      before,
      "supply inspection cannot alter evidence",
    );
    progress = createPathProgress(copy(progress));
    assert.equal(selectAssessment(progress, unitId, bank).id, next.id);
    progress = record(progress, next);
    const status = unitStatus(createPathProgress(copy(progress)), unitId);
    assert.equal(status.currentConfirmed, true);
    assert.deepEqual(status.pendingAssessmentDomains, []);
    assert.deepEqual(status.initialEvidence, initialEvidence);
    assert.equal(
      assessmentAvailability(progress, unitId, bank).state,
      "complete",
    );
  });

  test(`${domain}: complete exposure returns structured unavailability and survives restore and renamed/reflected aliases`, () => {
    let progress = expose(
      missingOnly(unitId, domain),
      domainBank(unitId, domain),
    );
    progress = createPathProgress(copy(progress));
    const availability = assessmentAvailability(progress, unitId, bank);
    assert.equal(availability.state, "exhausted");
    assert.equal(availability.reason, "domain-exhausted");
    assert.deepEqual(availability.exhaustedDomains, [domain]);
    assert.deepEqual(availability.remaining, {
      authored: 0,
      reserve: 0,
      total: 0,
    });
    assert.equal(selectAssessment(progress, unitId, bank), null);
    const step = nextLearningStep(progress, settings(unitId));
    assert.equal(step.kind, "assessment-unavailable");
    assert.equal(step.reason, "domain-exhausted");
    assert.equal(step.assessmentDomain, domain);
    assert.equal(step.phase, "initial");
    assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
    const source = reserveDomain(unitId, domain)[0];
    const reflected = Array(225).fill(0);
    source.board.forEach((side, index) => {
      reflected[Math.floor(index / 15) * 15 + 14 - (index % 15)] = side;
    });
    const alias = {
      ...source,
      id: `${source.id}-unregistered`,
      board: reflected,
    };
    assert.equal(
      selectAssessment(progress, unitId, [
        { ...source, board: reflected },
        alias,
      ]),
      null,
    );
    const forged = solved(source, `renamed-${source.id}`);
    forged.problemId = alias.id;
    progress = recordAttemptEvidence(progress, forged, { ...alias, at: later });
    assert.equal(
      unitStatus(createPathProgress(copy(progress)), unitId).currentConfirmed,
      false,
    );
    assert.equal(selectAssessment(progress, unitId, bank), null);
    progress = fail(progress, source, later);
    progress = record(progress, lessonFor(unitId, domain), {
      at: later,
      attemptId: `exhausted-remediation-${domain}`,
    });
    const stillUnavailable = nextLearningStep(progress, settings(unitId));
    assert.equal(stillUnavailable.kind, "assessment-unavailable");
    assert.equal(stillUnavailable.reason, "domain-exhausted");
    assert.equal(stillUnavailable.assessmentDomain, domain);
    assert.equal(stillUnavailable.phase, "reconfirmation");
    assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
  });

  test(`${domain}: later-day retention uses fresh reserve supply after original supply is known`, () => {
    let progress = covered(unitId);
    const waiting = assessmentAvailability(progress, unitId, bank, {
      phase: "retention",
      at: day,
    });
    assert.equal(waiting.state, "waiting");
    assert.equal(waiting.reason, "retention-not-due");
    assert.equal(
      selectAssessment(progress, unitId, bank, { phase: "retention", at: day }),
      null,
    );
    progress = record(
      progress,
      selectAssessment(progress, unitId, bank, {
        phase: "retention",
        at: later,
      }),
      { at: later },
    );
    for (const sibling of requiredAssessmentDomains[unitId])
      if (sibling !== domain)
        progress = record(
          progress,
          selectAssessment(progress, unitId, domainBank(unitId, sibling), {
            phase: "retention",
            at: later,
          }),
          { at: later },
        );
    progress = expose(progress, originalDomain(unitId, domain), later);
    const availability = assessmentAvailability(progress, unitId, bank, {
      phase: "retention",
      at: later,
    });
    assert.equal(availability.state, "ready");
    assert.equal(availability.phase, "retention");
    assert.deepEqual(availability.pendingDomains, [domain]);
    assert.equal(availability.remaining.authored, 0);
    const reserve = selectAssessment(progress, unitId, bank, {
      phase: "retention",
      at: later,
    });
    assert.equal(reserve.supply, "reserve");
    assert.equal(reserve.assessmentDomain, domain);
    progress = record(progress, reserve, { at: later });
    assert.equal(unitStatus(progress, unitId).retained, true);
    assert.equal(
      assessmentAvailability(progress, unitId, bank, {
        phase: "retention",
        at: later,
      }).state,
      "complete",
    );
  });
}

test("every reserve domain still requires the original baseline route", () => {
  let progress = createPathProgress();
  for (const [unitId, domain] of domainPairs)
    progress = record(progress, reserveDomain(unitId, domain)[0]);
  for (const unitId of Object.keys(requiredAssessmentDomains)) {
    const status = unitStatus(progress, unitId);
    assert.equal(status.initialAssessmentCount, 0);
    assert.equal(status.initialConfirmed, false);
    assert.equal(status.currentConfirmed, false);
  }
});

test("baseline-only exhaustion keeps its practical alternative while total domain exhaustion is explicit", () => {
  const unitId = "conditions";
  let progress = expose(createPathProgress(), baseline(unitId));
  const baselineAvailability = assessmentAvailability(progress, unitId, bank);
  assert.equal(baselineAvailability.reason, "baseline-exhausted");
  assert.equal(baselineAvailability.needsBaseline, true);
  assert.deepEqual(baselineAvailability.exhaustedDomains, []);
  assert.equal(nextLearningStep(progress, settings(unitId)).kind, "journey");
  progress = expose(
    progress,
    bank.filter((problem) => problem.unitId === unitId),
  );
  const unavailable = nextLearningStep(
    createPathProgress(copy(progress)),
    settings(unitId),
  );
  assert.equal(unavailable.kind, "assessment-unavailable");
  assert.equal(unavailable.reason, "domain-exhausted");
  assert.equal(unavailable.needsBaseline, true);
  assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
  const prematureRetention = assessmentAvailability(progress, unitId, bank, {
    phase: "retention",
    at: later,
  });
  assert.equal(prematureRetention.state, "waiting");
  assert.equal(prematureRetention.reason, "initial-incomplete");
});

test("authored-only exhaustion becomes available with reserves without changing the stored ledger", () => {
  for (const unitId of ["opening", "practice"]) {
    const domain = requiredAssessmentDomains[unitId].at(-1);
    const progress = expose(
      missingOnly(unitId, domain),
      originalDomain(unitId, domain),
    );
    const authoredOnly = bank.filter((problem) => problem.supply !== "reserve");
    assert.equal(
      nextLearningStep(progress, settings(unitId, authoredOnly)).kind,
      "assessment-unavailable",
    );
    const next = nextLearningStep(progress, settings(unitId));
    assert.equal(next.kind, "assessment");
    assert.equal(
      problems.find((problem) => problem.id === next.problemId).supply,
      "reserve",
    );
    assert.equal(next.assessmentDomain, domain);
  }
});
