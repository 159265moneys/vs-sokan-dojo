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
  nextLearningStep,
  requiredAssessmentDomains,
} from "../dist/learning-path.js";

const day = "2026-11-12T09:00:00+09:00";
const later = "2026-11-14T09:00:00+09:00";
const copy = (value) => JSON.parse(JSON.stringify(value));
const assessmentBank = problems.filter(
  (problem) => problem.role === "assessment",
);
const baseline = (unitId) =>
  assessmentBank.filter(
    (problem) => problem.unitId === unitId && !problem.assessmentDomain,
  );
const domainBank = (unitId, domain) =>
  assessmentBank.filter(
    (problem) =>
      problem.unitId === unitId && problem.assessmentDomain === domain,
  );
const nextDomain = (progress, unitId, domain) =>
  domainBank(unitId, domain).find(
    (problem) =>
      selectAssessment(progress, unitId, [problem])?.id === problem.id,
  );
function solved(problem, id = problem.id) {
  if (problem.assessmentDomain || problem.teachesAssessmentDomain) {
    let attempt = createAttempt(problem.id, { attemptId: id });
    attempt = answerLearningChoice(
      attempt,
      problem.nodes[0].choices.find((choice) => choice.correct).id,
    );
    if (attempt.status === "choose")
      attempt = playLearningMove(attempt, problem.guide[0]);
    assert.equal(attempt.status, "solved", problem.id);
    return attempt;
  }
  return {
    attemptId: id,
    problemId: problem.id,
    status: "solved",
    history: [
      { i: 0, side: 1 },
      { i: 1, side: 2 },
      { i: 2, side: 1 },
    ],
    hints: { uses: 0 },
    guidanceSeen: false,
    metrics: {
      acceptedDecisions: 2,
      verifiedMistakes: 0,
      unknownSelections: 0,
      retries: 0,
    },
  };
}
function record(progress, problem, { at = day, mutate = () => {}, id } = {}) {
  const attempt = solved(problem, id);
  mutate(attempt);
  return recordAttemptEvidence(progress, attempt, { ...problem, at });
}
function baselineProgress(unitId) {
  const [first, second] = baseline(unitId).filter(
    (problem, index, bank) =>
      bank.findIndex((other) => other.family === problem.family) === index,
  );
  assert(first && second, unitId);
  return record(record(createPathProgress(), first), second);
}
function covered(unitId) {
  let progress = baselineProgress(unitId);
  for (const domain of requiredAssessmentDomains[unitId])
    progress = record(progress, nextDomain(progress, unitId, domain));
  return progress;
}

test("v5 retains the stage-one requirements while adding explicit position capabilities", () => {
  assert.deepEqual(Object.keys(requiredAssessmentDomains).sort(), [
    "branch",
    "conditions",
    "counter",
    "opening",
    "practice",
    "prepare",
  ]);
  for (const unit of units.filter(
    (unit) => !requiredAssessmentDomains[unit.id],
  ))
    assert.deepEqual(
      unitStatus(createPathProgress(), unit.id).requiredAssessmentDomains,
      [],
    );
  for (const unitId of ["conditions", "counter"])
    for (const domain of requiredAssessmentDomains[unitId])
      assert(
        domainBank(unitId, domain).length >= 3,
        `${domain}: initial, retention and reconfirmation`,
      );
});

for (const unitId of ["conditions", "counter"]) {
  test(`${unitId}: existing confirmation remains historical while the standard path requests only missing domains`, () => {
    const progress = baselineProgress(unitId);
    const old = copy(progress);
    for (const attempt of Object.values(old.attempts)) {
      delete attempt.assessmentDomain;
      delete attempt.acceptedDecisions;
      delete attempt.history;
    }
    const restored = createPathProgress(old);
    const status = unitStatus(restored, unitId);
    assert.equal(status.initialConfirmed, true);
    assert.equal(status.currentConfirmed, false);
    assert.equal(status.initialAssessmentCount, 2);
    assert.deepEqual(
      status.pendingAssessmentDomains,
      requiredAssessmentDomains[unitId],
    );
    assert.deepEqual(
      status.initialEvidence,
      unitStatus(progress, unitId).initialEvidence,
    );
    assert.equal(Object.keys(restored.attempts).length, 2);
    const step = nextLearningStep(restored, {
      units: units.filter((unit) => unit.id === unitId),
      assessmentProblems: assessmentBank,
    });
    assert.equal(step.kind, "assessment");
    assert(
      requiredAssessmentDomains[unitId].includes(
        problems.find((problem) => problem.id === step.problemId)
          .assessmentDomain,
      ),
    );
    assert.equal(selectAssessment(restored, unitId, baseline(unitId)), null);
  });

  test(`${unitId}: domain prediction never replaces either baseline family`, () => {
    let progress = createPathProgress();
    for (const domain of requiredAssessmentDomains[unitId])
      progress = record(progress, domainBank(unitId, domain)[0]);
    const status = unitStatus(progress, unitId);
    assert.equal(status.initialCount, 0);
    assert.equal(status.initialConfirmed, false);
    assert.equal(status.currentConfirmed, false);
    assert.equal(
      selectAssessment(progress, unitId, assessmentBank).assessmentDomain,
      undefined,
    );
  });

  test(`${unitId}: each distinct domain is required, and stored evidence survives reload`, () => {
    let progress = baselineProgress(unitId);
    const [first, second] = requiredAssessmentDomains[unitId];
    progress = record(progress, nextDomain(progress, unitId, first));
    assert.deepEqual(unitStatus(progress, unitId).pendingAssessmentDomains, [
      second,
    ]);
    assert.equal(
      selectAssessment(progress, unitId, assessmentBank).assessmentDomain,
      second,
    );
    progress = record(progress, nextDomain(progress, unitId, second));
    const status = unitStatus(createPathProgress(copy(progress)), unitId);
    assert.equal(status.currentConfirmed, true);
    assert.equal(status.retained, false);
    assert.deepEqual(status.pendingAssessmentDomains, []);
    assert.equal(status.initialCount, 2);
  });

  test(`${unitId}: hints, unknown, mistakes, retry and known/demo boards give no domain credit`, () => {
    const [domain] = requiredAssessmentDomains[unitId];
    const problem = domainBank(unitId, domain)[0];
    for (const mutate of [
      (attempt) => {
        attempt.hints.uses = 1;
      },
      (attempt) => {
        attempt.metrics.unknownSelections = 1;
      },
      (attempt) => {
        attempt.metrics.verifiedMistakes = 1;
      },
      (attempt) => {
        attempt.metrics.retries = 1;
      },
      (attempt) => {
        attempt.guidanceSeen = true;
      },
      (attempt) => {
        attempt.metrics.acceptedDecisions = 0;
      },
    ]) {
      const progress = record(baselineProgress(unitId), problem, { mutate });
      assert(
        unitStatus(progress, unitId).pendingAssessmentDomains.includes(domain),
      );
    }
    let progress = noteExposure(baselineProgress(unitId), problem, {
      kind: "demo",
      at: day,
    });
    progress = record(progress, problem);
    assert(
      unitStatus(progress, unitId).pendingAssessmentDomains.includes(domain),
    );
    assert.equal(selectAssessment(progress, unitId, [problem]), null);
  });

  test(`${unitId}: retention needs a fresh later-day prediction in every domain`, () => {
    let progress = covered(unitId);
    const original = unitStatus(progress, unitId);
    assert.equal(
      selectAssessment(progress, unitId, assessmentBank, {
        phase: "retention",
        at: day,
      }),
      null,
    );
    const base = baseline(unitId).find(
      (problem) => !original.initialEvidence.includes(problem.id),
    );
    progress = record(progress, base, { at: later });
    assert.equal(unitStatus(progress, unitId).historicalRetained, true);
    assert.equal(unitStatus(progress, unitId).retained, false);
    for (const domain of requiredAssessmentDomains[unitId]) {
      const problem = selectAssessment(
        progress,
        unitId,
        domainBank(unitId, domain),
        { phase: "retention", at: later },
      );
      assert(problem, domain);
      progress = record(progress, problem, { at: later });
    }
    assert.equal(unitStatus(progress, unitId).retained, true);
    assert.deepEqual(unitStatus(progress, unitId).pendingRetentionDomains, []);
    assert.deepEqual(
      unitStatus(progress, unitId).initialEvidence,
      original.initialEvidence,
    );
  });

  test(`${unitId}: a failed domain cannot be reconfirmed by its sibling or a known-board retry`, () => {
    let progress = covered(unitId);
    const [failedDomain, sibling] = requiredAssessmentDomains[unitId];
    const failure = domainBank(unitId, failedDomain).find(
      (problem) =>
        !Object.values(progress.attempts).some(
          (attempt) => attempt.problemId === problem.id,
        ),
    );
    progress = record(progress, failure, {
      mutate: (attempt) => {
        attempt.metrics.unknownSelections = 1;
      },
    });
    assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
    const lesson = problems.find(
      (problem) =>
        problem.unitId === unitId &&
        problem.role === "lesson" &&
        problem.teachesAssessmentDomain === failedDomain,
    );
    progress = record(progress, lesson, { id: `remedial-${unitId}` });
    assert.equal(
      unitStatus(progress, unitId).assessmentReview.stage,
      "assessment",
    );
    assert.equal(
      selectAssessment(progress, unitId, domainBank(unitId, sibling)),
      null,
    );
    const retried = record(progress, failure, { id: `retry-${unitId}` });
    assert.equal(unitStatus(retried, unitId).currentConfirmed, false);
    const fresh = selectAssessment(progress, unitId, assessmentBank);
    assert.equal(fresh.assessmentDomain, failedDomain);
    progress = record(progress, fresh);
    assert.equal(unitStatus(progress, unitId).currentConfirmed, true);
  });

  test(`${unitId}: baseline reconfirmation must cover every domain after remediation`, () => {
    let progress = covered(unitId);
    const failure = baseline(unitId).find(
      (problem) =>
        !Object.values(progress.attempts).some(
          (attempt) => attempt.problemId === problem.id,
        ),
    );
    progress = record(progress, failure, {
      mutate: (attempt) => {
        attempt.metrics.verifiedMistakes = 1;
      },
    });
    const lesson = problems.find(
      (problem) => problem.unitId === unitId && problem.role === "lesson",
    );
    progress = record(progress, lesson, { id: `baseline-remedial-${unitId}` });
    const baselineCheck = selectAssessment(progress, unitId, assessmentBank);
    assert.equal(baselineCheck.assessmentDomain, undefined);
    progress = record(progress, baselineCheck);
    assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
    assert.deepEqual(
      unitStatus(progress, unitId).assessmentReview.pendingDomains,
      requiredAssessmentDomains[unitId],
    );
    for (const domain of requiredAssessmentDomains[unitId]) {
      const fresh = selectAssessment(
        progress,
        unitId,
        domainBank(unitId, domain),
      );
      assert.equal(fresh.assessmentDomain, domain);
      progress = record(progress, fresh);
    }
    assert.equal(unitStatus(progress, unitId).currentConfirmed, true);
    assert.equal(
      unitStatus(progress, unitId).assessmentReview.domainResolutionEvidence
        .length,
      2,
    );
  });

  test(`${unitId}: independent failures in both domains must each be reconfirmed`, () => {
    let progress = covered(unitId);
    for (const domain of requiredAssessmentDomains[unitId]) {
      const failure = domainBank(unitId, domain).find(
        (problem) =>
          !Object.values(progress.attempts).some(
            (attempt) => attempt.problemId === problem.id,
          ),
      );
      progress = record(progress, failure, {
        mutate: (attempt) => {
          attempt.metrics.verifiedMistakes = 1;
        },
      });
    }
    assert.equal(unitStatus(progress, unitId).assessmentReviews.length, 2);
    for (const domain of requiredAssessmentDomains[unitId]) {
      const lesson = problems.find(
        (problem) =>
          problem.unitId === unitId &&
          problem.role === "lesson" &&
          problem.teachesAssessmentDomain === domain,
      );
      progress = record(progress, lesson, { id: `both-remedial-${domain}` });
    }
    progress = record(
      progress,
      selectAssessment(progress, unitId, assessmentBank),
    );
    assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
    assert.equal(
      unitStatus(progress, unitId).pendingAssessmentDomains.length,
      1,
    );
    progress = record(
      progress,
      selectAssessment(progress, unitId, assessmentBank),
    );
    assert.equal(unitStatus(progress, unitId).currentConfirmed, true);
  });

  test(`${unitId}: exhausting new prediction boards cannot promote the historical baseline to current`, () => {
    let progress = baselineProgress(unitId);
    for (const domain of requiredAssessmentDomains[unitId])
      for (const problem of domainBank(unitId, domain))
        progress = noteExposure(progress, problem, { kind: "demo", at: day });
    assert.equal(selectAssessment(progress, unitId, assessmentBank), null);
    assert.equal(unitStatus(progress, unitId).initialConfirmed, true);
    assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
    assert.equal(
      nextLearningStep(progress, {
        units: units.filter((unit) => unit.id === unitId),
        assessmentProblems: assessmentBank,
      }).reason,
      "assessment-exhausted",
    );
  });
}

test("counter domain credit requires the prediction and the user's actual board input", () => {
  const problem = domainBank("counter", "counter-threat")[0];
  for (const mutate of [
    (attempt) => {
      attempt.metrics.acceptedDecisions = 1;
    },
    (attempt) => {
      attempt.history = [];
    },
    (attempt) => {
      attempt.history = [{ i: problem.guide[0], side: 2 }];
    },
  ]) {
    const progress = record(baselineProgress("counter"), problem, { mutate });
    assert.equal(
      unitStatus(progress, "counter").confirmedAssessmentDomains.length,
      0,
    );
  }
});

for (const [unitId, failedDomain, otherDomain] of [
  ["conditions", "conditions-negative", "conditions-positive"],
  ["counter", "counter-threat", "counter-clear"],
]) {
  test(`${failedDomain}: remediation requires its authored teaching lesson, not its sibling`, () => {
    let progress = covered(unitId);
    const failure = domainBank(unitId, failedDomain).find(
      (problem) =>
        !Object.values(progress.attempts).some(
          (attempt) => attempt.problemId === problem.id,
        ),
    );
    progress = record(progress, failure, {
      mutate: (attempt) => {
        attempt.metrics.verifiedMistakes = 1;
      },
    });
    const settings = {
      units: units.filter((unit) => unit.id === unitId),
      assessmentProblems: assessmentBank,
    };
    const first = nextLearningStep(progress, settings);
    assert.equal(first.kind, "lesson");
    assert.equal(
      problems.find((problem) => problem.id === first.problemId)
        .teachesAssessmentDomain,
      failedDomain,
    );
    const siblingLesson = problems.find(
      (problem) =>
        problem.unitId === unitId &&
        problem.role === "lesson" &&
        problem.teachesAssessmentDomain === otherDomain,
    );
    progress = record(progress, siblingLesson);
    assert.equal(
      unitStatus(progress, unitId).assessmentReview.stage,
      "remediation",
    );
    assert.equal(
      nextLearningStep(progress, settings).problemId,
      first.problemId,
    );
    const genericLesson = problems.find(
      (problem) =>
        problem.unitId === unitId &&
        problem.role !== "assessment" &&
        !problem.teachesAssessmentDomain,
    );
    progress = recordAttemptEvidence(progress, solved(genericLesson), {
      ...genericLesson,
      teachesAssessmentDomain: failedDomain,
      at: day,
    });
    assert.equal(
      unitStatus(progress, unitId).assessmentReview.stage,
      "remediation",
    );
    const correctLesson = problems.find(
      (problem) => problem.id === first.problemId,
    );
    progress = record(progress, correctLesson);
    assert.equal(
      unitStatus(progress, unitId).assessmentReview.stage,
      "assessment",
    );
    const confirmation = nextLearningStep(progress, settings);
    assert.equal(confirmation.kind, "assessment");
    assert.equal(
      problems.find((problem) => problem.id === confirmation.problemId)
        .assessmentDomain,
      failedDomain,
    );
  });
}

test("caller-supplied tags, renamed IDs and mismatched source identity cannot create capability evidence", () => {
  const source = domainBank("conditions", "conditions-negative")[0];
  for (const fake of [
    { ...source, id: "invented-domain-problem" },
    { ...source, family: "conditions/invented" },
    { ...source, board: baseline("conditions")[0].board },
  ]) {
    const attempt = solved(source);
    attempt.problemId = fake.id;
    const progress = recordAttemptEvidence(
      baselineProgress("conditions"),
      attempt,
      { ...fake, at: day },
    );
    assert.equal(
      unitStatus(progress, "conditions").confirmedAssessmentDomains.length,
      0,
    );
  }
});
