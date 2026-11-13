import {
  createPathProgress,
  nextLearningStep,
  unitStatus,
} from "./learning-path.js?v=curriculum-v5-stage3-20261113";
import { problems } from "./curriculum.js?v=curriculum-v5-stage3-20261113";

const authoredById = new Map(problems.map((problem) => [problem.id, problem]));

// Course navigation reads evidence; it never awards or rewrites evidence.
function courseState(progress, units) {
  const ledger = createPathProgress(progress);
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const solved = new Map(units.map((unit) => [unit.id, new Set()]));
  for (const attempt of Object.values(ledger.attempts))
    if (attempt.role === "lesson" && attempt.status === "solved")
      solved.get(attempt.unitId)?.add(attempt.problemId);
  const statuses = new Map();
  const status = (unit) => {
    if (!statuses.has(unit.id))
      statuses.set(unit.id, unitStatus(ledger, unit.id));
    return statuses.get(unit.id);
  };
  const remaining = (unit) =>
    (unit.problemIds || []).filter((id) => !solved.get(unit.id).has(id));
  const taught = (unit) =>
    !remaining(unit).length || status(unit).currentConfirmed;
  return { ledger, byId, solved, status, remaining, taught };
}

export function courseProgressSummary(progress, { units = [] } = {}) {
  const state = courseState(progress, units);
  const rows = units.map((unit) => {
    const remainingLessonIds = state.remaining(unit);
    const lessonCount = (unit.problemIds || []).length;
    return {
      unitId: unit.id,
      lessonCount,
      completedLessonCount: lessonCount - remainingLessonIds.length,
      remainingLessonIds,
      practiced: !remainingLessonIds.length,
      currentConfirmed: state.status(unit).currentConfirmed,
    };
  });
  return {
    units: rows,
    lessonCount: rows.reduce((sum, row) => sum + row.lessonCount, 0),
    completedLessonCount: rows.reduce(
      (sum, row) => sum + row.completedLessonCount,
      0,
    ),
    practicedUnitCount: rows.filter((row) => row.practiced).length,
    confirmedUnitCount: rows.filter((row) => row.currentConfirmed).length,
    pendingConfirmationUnitIds: rows
      .filter((row) => !row.currentConfirmed)
      .map((row) => row.unitId),
    coursePracticed:
      !!rows.length && rows.every((row) => row.practiced || row.currentConfirmed),
    allConfirmed: !!rows.length && rows.every((row) => row.currentConfirmed),
  };
}

const lessonStep = (unit, problemId, reason = "course-lesson") => ({
  kind: "lesson",
  unitId: unit.id,
  problemId,
  reason,
  label: "練習する",
});
const guided = (step) =>
  step.kind === "journey" ? { ...step, guided: true } : step;
const exhausted = (step) =>
  step.reason === "assessment-exhausted" || step.reason === "domain-exhausted";

export function nextCourseStep(
  progress,
  { units = [], assessmentProblems = [], unitId = null, at = null } = {},
) {
  const state = courseState(progress, units);
  const { ledger, byId, status, remaining, taught } = state;
  const steps = new Map();
  const confirmationStep = (unit) => {
    if (!steps.has(unit.id))
      steps.set(
        unit.id,
        nextLearningStep(ledger, {
          // Prerequisites are navigated below using taught lessons. The ledger
          // and the independent qualification rules are passed through intact.
          units: [{ ...unit, prerequisites: [] }],
          assessmentProblems,
          unitId: unit.id,
          at,
        }),
      );
    return steps.get(unit.id);
  };
  const reviewUnitIds = new Set(
    Object.values(ledger.reviewFindings).map((finding) => finding.unitId),
  );
  const reviews = units
    .filter((unit) => reviewUnitIds.has(unit.id))
    .flatMap((unit) => status(unit).reviewFindings)
    .filter((finding) => ["recovery", "assessment"].includes(finding.stage))
    .sort((a, b) => a.ordinal - b.ordinal);
  const recovery = reviews.find((finding) => finding.stage === "recovery");
  if (recovery)
    return {
      kind: "review",
      unitId: recovery.unitId,
      recordId: recovery.recordId,
      ply: recovery.ply,
      reason: "review-recovery",
      label: "実戦の復習",
    };

  const assessedIds = new Set(
    Object.values(ledger.attempts)
      .filter((attempt) => attempt.role === "assessment")
      .map((attempt) => attempt.unitId),
  );
  const assessedUnits = units.filter((unit) => assessedIds.has(unit.id));
  // A later failure can need its own remediation even while an earlier
  // reconfirmation is awaiting fresh supply. Do not hide it behind that wait.
  for (const unit of assessedUnits) {
    const remediation = status(unit).assessmentReviews.find(
      (review) => review.stage === "remediation",
    );
    if (!remediation) continue;
    const candidates = (unit.problemIds || []).filter(
      (id) =>
        !remediation.requiredDomain ||
        []
          .concat(authoredById.get(id)?.teachesAssessmentDomain || [])
          .includes(remediation.requiredDomain),
    );
    const problemId =
      candidates.find((id) => !state.solved.get(unit.id).has(id)) || candidates[0];
    return problemId
      ? lessonStep(unit, problemId, "confirmation-remediation")
      : {
          kind: "journey",
          unitId: unit.id,
          reason: "confirmation-remediation",
          label: "課題対局",
          guided: true,
        };
  }
  // Initial, assisted checks also need a later lesson before another check.
  for (const unit of assessedUnits) {
    if (status(unit).currentConfirmed) continue;
    const step = confirmationStep(unit);
    if (["remediation", "confirmation-remediation"].includes(step.reason))
      return guided(step);
  }

  const priorityUnits = [
    ...assessedUnits.filter((unit) => status(unit).assessmentReviewPending),
    ...reviews.map((review) => byId.get(review.unitId)),
  ];
  for (const unit of new Set(priorityUnits)) {
    const step = confirmationStep(unit);
    if (!exhausted(step)) return guided(step);
    const nextLesson = remaining(unit)[0];
    if (nextLesson) return lessonStep(unit, nextLesson);
  }

  function prerequisite(unit, visited = new Set()) {
    if (visited.has(unit.id)) return unit;
    visited.add(unit.id);
    const missing = (unit.prerequisites || [])
      .map((id) => byId.get(id))
      .find((candidate) => candidate && !taught(candidate));
    return missing ? prerequisite(missing, visited) : unit;
  }
  const requested = byId.get(unitId);
  const requestedIndex = units.indexOf(requested);
  const candidates = requested
    ? [...units.slice(requestedIndex), ...units.slice(0, requestedIndex)]
    : units;
  const visited = new Set();
  for (const candidate of candidates) {
    if (status(candidate).currentConfirmed) continue;
    const unit = prerequisite(candidate);
    if (visited.has(unit.id)) continue;
    visited.add(unit.id);
    const nextLesson = remaining(unit)[0];
    if (nextLesson) return lessonStep(unit, nextLesson);
    const step = confirmationStep(unit);
    if (!exhausted(step)) return guided(step);
    // Supply exhaustion does not confirm this unit or block taught successors.
  }

  const pending = units.filter((unit) => !status(unit).currentConfirmed);
  return {
    kind: "journey",
    unitId: priorityUnits[0]?.id || requested?.id || units.at(-1)?.id || null,
    reason: pending.length || !units.length ? "course-practiced" : "initial-complete",
    label: "課題対局",
    guided: true,
    pendingConfirmationUnitIds: pending.map((unit) => unit.id),
  };
}
