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

const day = "2026-11-12T10:00:00+09:00";
const later = "2026-11-14T10:00:00+09:00";
const targets = {
  branch: ["branch-ready", "branch-rebuild"],
  prepare: ["prepare-two", "prepare-one"],
  opening: [
    "opening-near-ready",
    "opening-near-blocked",
    "opening-far-ready",
    "opening-far-blocked",
  ],
  practice: ["practical-win", "practical-defense", "practical-build"],
};
const clone = (value) => JSON.parse(JSON.stringify(value));
// These cases audit the original finite bank independently of reserve supply.
const bank = problems.filter(
  (problem) => problem.role === "assessment" && problem.supply !== "reserve",
);
const baseline = (unitId) =>
  bank.filter(
    (problem) => problem.unitId === unitId && !problem.assessmentDomain,
  );
const domainBank = (unitId, domain) =>
  bank.filter(
    (problem) =>
      problem.unitId === unitId && problem.assessmentDomain === domain,
  );
const lessonFor = (unitId, domain) =>
  problems.find(
    (problem) =>
      problem.unitId === unitId &&
      problem.role === "lesson" &&
      problem.teachesAssessmentDomain === domain,
  );
const settings = (unitId) => ({
  units: units.filter((unit) => unit.id === unitId),
  assessmentProblems: bank,
});
const solvedCache = new Map();
function solve(problem, attemptId = problem.id) {
  assert(problem, "authored problem exists");
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
  return { ...clone(solvedCache.get(problem.id)), attemptId };
}
function record(
  progress,
  problem,
  { at = day, attemptId, mutate = () => {} } = {},
) {
  const attempt = solve(problem, attemptId);
  mutate(attempt);
  return recordAttemptEvidence(progress, attempt, { ...problem, at });
}
function withBaseline(unitId) {
  let progress = createPathProgress();
  for (const problem of baseline(unitId).filter(
    (item, index, items) =>
      items.findIndex((other) => other.family === item.family) === index,
  )) {
    progress = record(progress, problem);
    if (unitStatus(progress, unitId).baselineConfirmed) return progress;
  }
  assert.fail(`${unitId}: authored baseline can still be confirmed`);
}
function covered(unitId) {
  let progress = withBaseline(unitId);
  for (const domain of targets[unitId]) {
    const next = selectAssessment(progress, unitId, domainBank(unitId, domain));
    assert(next, domain);
    progress = record(progress, next);
  }
  return progress;
}

test("stage two has exact required domains and separate domain teaching lessons", () => {
  for (const [unitId, domains] of Object.entries(targets)) {
    assert.deepEqual(requiredAssessmentDomains[unitId], domains);
    for (const domain of domains) {
      assert.equal(
        domainBank(unitId, domain).length,
        ["opening", "practice"].includes(unitId) ? 2 : 3,
      );
      assert(lessonFor(unitId, domain), domain);
    }
  }
  for (const unitId of ["priority", "defense", "order"])
    assert.deepEqual(
      unitStatus(createPathProgress(), unitId).requiredAssessmentDomains,
      [],
    );
});

for (const [unitId, domains] of Object.entries(targets)) {
  test(`${unitId}: prior baseline history survives and only missing position domains are recommended`, () => {
    const original = withBaseline(unitId);
    const old = clone(original);
    for (const attempt of Object.values(old.attempts)) {
      delete attempt.assessmentDomain;
      delete attempt.acceptedDecisions;
      delete attempt.history;
    }
    const progress = createPathProgress(old);
    const status = unitStatus(progress, unitId);
    assert.equal(status.initialConfirmed, true);
    assert.equal(status.currentConfirmed, false);
    assert.deepEqual(status.pendingAssessmentDomains, domains);
    assert.deepEqual(
      status.initialEvidence,
      unitStatus(original, unitId).initialEvidence,
    );
    assert.equal(
      Object.keys(progress.attempts).length,
      Object.keys(old.attempts).length,
    );
    assert.equal(selectAssessment(progress, unitId, baseline(unitId)), null);
    const step = nextLearningStep(progress, settings(unitId));
    assert.equal(step.reason, "coverage");
    assert(domains.includes(step.assessmentDomain));
  });

  test(`${unitId}: new prediction and input evidence cannot substitute for either baseline family`, () => {
    let progress = createPathProgress();
    for (const domain of domains)
      progress = record(progress, domainBank(unitId, domain)[0]);
    const status = unitStatus(progress, unitId);
    assert.equal(status.initialAssessmentCount, 0);
    assert.equal(status.initialConfirmed, false);
    assert.equal(status.currentConfirmed, false);
    assert.equal(
      selectAssessment(progress, unitId, bank).assessmentDomain,
      undefined,
    );
  });

  test(`${unitId}: every required domain needs both the real prediction and the learner's move`, () => {
    let progress = withBaseline(unitId);
    for (const [index, domain] of domains.entries()) {
      const problem = selectAssessment(
        progress,
        unitId,
        domainBank(unitId, domain),
      );
      let predicted = createAttempt(problem.id, { attemptId: problem.id });
      predicted = answerLearningChoice(
        predicted,
        problem.nodes[0].choices.find((choice) => choice.correct).id,
      );
      assert.equal(predicted.status, "choose");
      assert.equal(predicted.metrics.acceptedDecisions, 1);
      assert.equal(predicted.history.length, unitId === "practice" ? 0 : 2);
      progress = recordAttemptEvidence(progress, predicted, {
        ...problem,
        at: day,
      });
      assert(
        unitStatus(progress, unitId).pendingAssessmentDomains.includes(domain),
      );
      const completed = playLearningMove(predicted, problem.guide[0]);
      assert.equal(completed.status, "solved");
      assert.equal(completed.metrics.acceptedDecisions, 2);
      assert.equal(completed.history.length, unitId === "practice" ? 1 : 3);
      progress = recordAttemptEvidence(progress, completed, {
        ...problem,
        at: day,
      });
      const status = unitStatus(createPathProgress(clone(progress)), unitId);
      assert.deepEqual(
        status.pendingAssessmentDomains,
        domains.slice(index + 1),
      );
      assert.equal(status.currentConfirmed, index === domains.length - 1);
    }
  });

  test(`${unitId}: forged completion must reproduce the signed prefix and satisfy the actual local goal`, () => {
    for (const domain of domains) {
      const problem = domainBank(unitId, domain)[0];
      const real = solve(problem);
      const exercise = problem.nodes[0].choices.find((choice) => choice.correct)
        .continuations[0];
      const before = [...problem.board];
      for (const move of exercise.moves) before[move.i] = move.side;
      const wrongPoint = before.findIndex(
        (side, index) => !side && !problem.guide.includes(index),
      );
      assert(wrongPoint >= 0);
      const mutations = [
        (attempt) => {
          attempt.metrics.acceptedDecisions = 1;
        },
        (attempt) => {
          attempt.history.pop();
        },
        (attempt) => {
          attempt.history.at(-1).side = 2;
        },
        (attempt) => {
          attempt.history.at(-1).i = wrongPoint;
        },
        (attempt) => {
          attempt.history.at(-1).i = problem.board.findIndex(Boolean);
        },
      ];
      if (exercise.moves.length)
        mutations.push(
          (attempt) => {
            attempt.history.shift();
          },
          (attempt) => {
            attempt.history[1].side = 1;
          },
          (attempt) => {
            attempt.history[0].i = wrongPoint;
          },
        );
      for (const mutate of mutations) {
        const forged = clone(real);
        mutate(forged);
        const progress = recordAttemptEvidence(withBaseline(unitId), forged, {
          ...problem,
          at: day,
        });
        assert.equal(
          unitStatus(progress, unitId).confirmedAssessmentDomains.length,
          0,
          domain,
        );
      }
      const restored = createPathProgress(
        record(withBaseline(unitId), problem),
      );
      assert.deepEqual(
        unitStatus(restored, unitId).confirmedAssessmentDomains,
        [domain],
      );
    }
  });

  test(`${unitId}: unknown, hints, guidance, errors, retries and transformed known positions remain ineligible`, () => {
    const problem = domainBank(unitId, domains[0])[0];
    for (const mutate of [
      (attempt) => {
        attempt.metrics.unknownSelections = 1;
      },
      (attempt) => {
        attempt.hints.uses = 1;
      },
      (attempt) => {
        attempt.guidanceSeen = true;
      },
      (attempt) => {
        attempt.metrics.verifiedMistakes = 1;
      },
      (attempt) => {
        attempt.metrics.retries = 1;
      },
    ]) {
      const progress = record(withBaseline(unitId), problem, { mutate });
      assert.equal(
        unitStatus(progress, unitId).confirmedAssessmentDomains.length,
        0,
      );
    }
    const reflected = Array(225).fill(0);
    problem.board.forEach((side, index) => {
      reflected[Math.floor(index / 15) * 15 + 14 - (index % 15)] = side;
    });
    let progress = noteExposure(
      withBaseline(unitId),
      { ...problem, id: "prior-demo", board: reflected },
      { kind: "demo", at: day },
    );
    progress = record(progress, problem);
    assert.equal(
      unitStatus(progress, unitId).confirmedAssessmentDomains.length,
      0,
    );
    assert.equal(selectAssessment(progress, unitId, [problem]), null);
  });

  test(`${unitId}: later-day retention must freshly cover every position domain`, () => {
    let progress = covered(unitId);
    const original = unitStatus(progress, unitId);
    assert.equal(
      selectAssessment(progress, unitId, bank, { phase: "retention", at: day }),
      null,
    );
    let next = selectAssessment(progress, unitId, bank, {
      phase: "retention",
      at: later,
    });
    assert.equal(next.assessmentDomain, undefined);
    progress = record(progress, next, { at: later });
    assert.equal(unitStatus(progress, unitId).historicalRetained, true);
    assert.equal(unitStatus(progress, unitId).retained, false);
    for (const [index, domain] of domains.entries()) {
      next = selectAssessment(progress, unitId, domainBank(unitId, domain), {
        phase: "retention",
        at: later,
      });
      assert(next, domain);
      progress = record(progress, next, { at: later });
      assert.equal(
        unitStatus(progress, unitId).retained,
        index === domains.length - 1,
      );
    }
    const restored = unitStatus(createPathProgress(clone(progress)), unitId);
    assert.deepEqual(restored.pendingRetentionDomains, []);
    assert.deepEqual(restored.initialEvidence, original.initialEvidence);
  });

  test(`${unitId}: a baseline failure needs all position domains again after remediation`, () => {
    let progress = covered(unitId);
    const used = new Set(
      Object.values(progress.attempts).map((attempt) => attempt.problemId),
    );
    const failure = baseline(unitId).find((problem) => !used.has(problem.id));
    progress = record(progress, failure, {
      mutate: (attempt) => {
        attempt.metrics.verifiedMistakes = 1;
      },
    });
    const lesson = problems.find(
      (problem) =>
        problem.unitId === unitId &&
        problem.role !== "assessment" &&
        !problem.teachesAssessmentDomain,
    );
    progress = record(progress, lesson);
    const base = selectAssessment(progress, unitId, bank);
    assert.equal(base.assessmentDomain, undefined);
    progress = record(progress, base);
    assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
    for (const domain of domains) {
      const next = selectAssessment(
        progress,
        unitId,
        domainBank(unitId, domain),
      );
      assert(next, domain);
      progress = record(progress, next);
    }
    assert.equal(unitStatus(progress, unitId).currentConfirmed, true);
  });

  test(`${unitId}: a failed retention domain preserves initial history and cannot be replaced by another domain`, () => {
    let progress = covered(unitId);
    const original = unitStatus(progress, unitId);
    const baselineRetention = selectAssessment(progress, unitId, bank, {
      phase: "retention",
      at: later,
    });
    progress = record(progress, baselineRetention, { at: later });
    const domain = domains.at(-1);
    const failure = selectAssessment(
      progress,
      unitId,
      domainBank(unitId, domain),
      { phase: "retention", at: later },
    );
    progress = record(progress, failure, {
      at: later,
      mutate: (attempt) => {
        attempt.metrics.unknownSelections = 1;
      },
    });
    let status = unitStatus(progress, unitId);
    assert.equal(status.assessmentReview.kind, "retention");
    assert.equal(status.currentConfirmed, false);
    assert.equal(status.retained, false);
    assert.equal(status.historicalRetained, true);
    assert.deepEqual(
      status.domainInitialEvidence,
      original.domainInitialEvidence,
    );
    progress = record(progress, lessonFor(unitId, domain), { at: later });
    assert.equal(
      selectAssessment(progress, unitId, domainBank(unitId, domains[0])),
      null,
    );
    const fresh = selectAssessment(progress, unitId, bank);
    if (domainBank(unitId, domain).length === 2) {
      assert.equal(fresh, null);
      assert.equal(unitStatus(progress, unitId).currentConfirmed, false);
      assert.equal(
        nextLearningStep(progress, settings(unitId)).reason,
        "domain-exhausted",
      );
      return;
    }
    assert.equal(fresh.assessmentDomain, domain);
    progress = record(progress, fresh, { at: later });
    assert.equal(unitStatus(progress, unitId).currentConfirmed, true);
    for (const missing of unitStatus(progress, unitId).pendingRetentionDomains)
      progress = record(
        progress,
        selectAssessment(progress, unitId, domainBank(unitId, missing), {
          phase: "retention",
          at: later,
        }),
        { at: later },
      );
    status = unitStatus(progress, unitId);
    assert.equal(status.retained, true);
    assert.deepEqual(status.initialEvidence, original.initialEvidence);
  });

  for (const domain of domains) {
    test(`${domain}: failure requires its own teaching lesson and a fresh matching confirmation`, () => {
      let progress = withBaseline(unitId);
      const failure = domainBank(unitId, domain)[0];
      let failed = createAttempt(failure.id, { attemptId: failure.id });
      failed = answerLearningChoice(
        failed,
        failure.nodes[0].choices.find((choice) => !choice.correct).id,
      );
      assert.equal(failed.status, "feedback");
      progress = recordAttemptEvidence(progress, failed, {
        ...failure,
        at: day,
      });
      const first = nextLearningStep(progress, settings(unitId));
      assert.equal(first.kind, "lesson");
      assert.equal(
        problems.find((problem) => problem.id === first.problemId)
          .teachesAssessmentDomain,
        domain,
      );
      const otherDomains = domains.filter((candidate) => candidate !== domain);
      for (const otherDomain of otherDomains) {
        progress = record(progress, lessonFor(unitId, otherDomain));
        assert.equal(
          unitStatus(progress, unitId).assessmentReview.stage,
          "remediation",
          `${otherDomain} cannot remediate ${domain}`,
        );
      }
      const teacher = lessonFor(unitId, domain);
      const missingInput = solve(teacher);
      missingInput.history.pop();
      const forgedLesson = recordAttemptEvidence(progress, missingInput, {
        ...teacher,
        at: day,
      });
      assert.equal(
        unitStatus(forgedLesson, unitId).assessmentReview.stage,
        "remediation",
      );
      progress = record(progress, lessonFor(unitId, domain));
      assert.equal(
        unitStatus(progress, unitId).assessmentReview.stage,
        "assessment",
      );
      for (const otherDomain of otherDomains)
        assert.equal(
          selectAssessment(progress, unitId, domainBank(unitId, otherDomain)),
          null,
          `${otherDomain} cannot reconfirm ${domain}`,
        );
      const fresh = selectAssessment(progress, unitId, bank);
      assert.equal(fresh.assessmentDomain, domain);
      assert.notEqual(fresh.id, failure.id);
      progress = record(progress, fresh);
      assert.equal(
        unitStatus(progress, unitId).assessmentReview.stage,
        "resolved",
      );
      for (const missing of unitStatus(progress, unitId)
        .pendingAssessmentDomains)
        progress = record(
          progress,
          selectAssessment(progress, unitId, domainBank(unitId, missing)),
        );
      assert.equal(unitStatus(progress, unitId).currentConfirmed, true);
    });
  }
}

test("near-blocked plus far-ready does not skip either opening counterexample", () => {
  let progress = withBaseline("opening");
  for (const domain of ["opening-near-blocked", "opening-far-ready"])
    progress = record(progress, domainBank("opening", domain)[0]);
  const status = unitStatus(progress, "opening");
  assert.equal(status.initialConfirmed, true);
  assert.equal(status.currentConfirmed, false);
  assert.deepEqual(status.pendingAssessmentDomains, [
    "opening-near-ready",
    "opening-far-blocked",
  ]);
  assert.equal(
    selectAssessment(
      progress,
      "opening",
      domainBank("opening", "opening-near-blocked"),
    ),
    null,
  );
  const step = nextLearningStep(progress, settings("opening"));
  assert(status.pendingAssessmentDomains.includes(step.assessmentDomain));
});

test("practical supply exhaustion never restores current confirmation or recycles a known board", () => {
  let progress = covered("practice");
  const domain = "practical-build";
  const failure = domainBank("practice", domain)[1];
  progress = record(progress, failure, {
    mutate: (attempt) => {
      attempt.metrics.unknownSelections = 1;
    },
  });
  progress = record(progress, lessonFor("practice", domain));
  assert.equal(
    unitStatus(progress, "practice").assessmentReview.stage,
    "assessment",
  );
  assert.equal(selectAssessment(progress, "practice", bank), null);
  assert.equal(
    nextLearningStep(progress, settings("practice")).reason,
    "domain-exhausted",
  );
  assert.equal(unitStatus(progress, "practice").initialConfirmed, true);
  assert.equal(unitStatus(progress, "practice").currentConfirmed, false);
});

test("position capability metadata is signed by the shipped curriculum, not by caller tags", () => {
  const source = domainBank("branch", "branch-ready")[0];
  for (const fake of [
    { ...source, id: "custom-position-tag" },
    { ...source, family: "branch/custom-tag" },
    { ...source, board: baseline("branch")[0].board },
  ]) {
    const attempt = solve(source);
    attempt.problemId = fake.id;
    const progress = recordAttemptEvidence(withBaseline("branch"), attempt, {
      ...fake,
      at: day,
    });
    assert.equal(
      unitStatus(progress, "branch").confirmedAssessmentDomains.length,
      0,
    );
  }
  let relabeled = createPathProgress();
  for (const domain of targets.branch) {
    const lesson = lessonFor("branch", domain);
    relabeled = recordAttemptEvidence(relabeled, solve(lesson), {
      ...lesson,
      role: "assessment",
      assessmentDomain: domain,
      at: day,
    });
  }
  assert.equal(unitStatus(relabeled, "branch").initialAssessmentCount, 0);
  assert.deepEqual(
    unitStatus(relabeled, "branch").confirmedAssessmentDomains,
    [],
  );
});
