import { winner, winningMoves } from "./game.js";
import { lineShapes } from "./review-patterns.js";
import { exerciseSatisfied } from "./learning-objectives.js";
import {
  problems as curriculumProblems,
  units as curriculumUnits,
} from "./curriculum.js?v=curriculum-v6-20261113";

// Evidence is supplied by the caller. This module reads no clock and schedules nothing.
export const pathSchemaVersion = 3;
export const initialFamilyTarget = 2;
export const examGameTarget = 10;
export const retentionMinimumMs = 24 * 60 * 60 * 1000;
export const requiredAssessmentDomains = Object.freeze({
  conditions: Object.freeze(["conditions-positive", "conditions-negative"]),
  counter: Object.freeze(["counter-threat", "counter-clear"]),
  branch: Object.freeze(["branch-ready", "branch-rebuild"]),
  prepare: Object.freeze(["prepare-two", "prepare-one"]),
  opening: Object.freeze([
    "opening-near-ready",
    "opening-near-blocked",
    "opening-far-ready",
    "opening-far-blocked",
  ]),
  practice: Object.freeze([
    "practical-win",
    "practical-defense",
    "practical-build",
  ]),
});
const clone = (value) => JSON.parse(JSON.stringify(value));
const roles = new Set([
  "lesson",
  "assessment",
  "journey",
  "recovery",
  "exam",
  "practice",
]);
const reviewUnits = {
  "miss-win": "priority",
  "miss-block": "priority",
  "allowed-pattern": "defense",
  "allowed-fork": "defense",
  "allowed-counter": "counter",
  "allowed-vcf": "defense",
  "lost-order": "order",
};
const unitIds = new Set([
  "priority",
  "conditions",
  "opening",
  "defense",
  "order",
  "counter",
  "branch",
  "prepare",
  "practice",
]);
const objectiveUnits = {
  "take-win": "priority",
  "stop-five": "priority",
  "two-directions": "opening",
  "switch-direction": "branch",
  "build-threat": "conditions",
  "force-four": "order",
  "prevent-fork": "defense",
  "recover-after-defense": "counter",
  "finish-five": "practice",
};
const derivedObjectives = {
  opening: ["prevent-fork"],
  counter: ["stop-five"],
  branch: ["two-directions"],
  prepare: ["two-directions"],
};
const practicalConditions = {
  priority: ["own-win-first", "prevent-immediate-loss"],
  conditions: ["open-four", "crossed-four"],
  opening: ["two-axis-response", "early-threat-defense"],
  defense: ["single-axis-threat", "crossed-threat"],
  counter: ["defend-two-finishes", "defend-forcing-chain"],
  branch: ["straight-three-response", "broken-three-response"],
  prepare: ["mixed-reserve-entries", "inside-gap-reserves"],
};
const normalizedFamily = (unitId, family) =>
  unitId === "priority" &&
  ["priority/gapped-race", "priority/multiple-finishes"].includes(family)
    ? "priority/own-win-first"
    : family;
// This retired board measured an immediate win, not two-axis prevention.
// Keep its history and exposure; never promote it into another unit.
const assessmentExclusion = (problemId) =>
  problemId === "check-defense-race" ? "retired-defense-race" : null;
const priorityCondition = (family) => {
  const normalized = normalizedFamily("priority", family);
  return ["priority/own-win-first", "priority/prevent-immediate-loss"].includes(
    normalized,
  )
    ? normalized.slice("priority/".length)
    : null;
};
const matchesCondition = (item, conditionId) =>
  !conditionId ||
  (item.unitId === "priority" &&
    priorityCondition(item.family) === conditionId);
const text = (value) => (typeof value === "string" ? value : "");
const integer = (value) => (Number.isInteger(value) && value >= 0 ? value : 0);
const boardValid = (board) =>
  Array.isArray(board) &&
  board.length === 225 &&
  board.every((c) => c === 0 || c === 1 || c === 2);
const date = (value) =>
  typeof value === "string" &&
  /^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value) &&
  Number.isFinite(Date.parse(value))
    ? value.slice(0, 10)
    : null;
const laterDay = (later, earlier) =>
  !!date(later) &&
  !!date(earlier) &&
  date(later) > date(earlier) &&
  Date.parse(later) - Date.parse(earlier) >= retentionMinimumMs;
const completionTimestamp = (source, allowObservedAt = false) =>
  date(source.finished)
    ? source.finished
    : typeof source.finished === "number" &&
        Number.isFinite(source.finished) &&
        Math.abs(source.finished) <= 8640000000000000
      ? new Date(source.finished).toISOString()
      : allowObservedAt && date(source.at)
        ? source.at
        : "";
const fingerprints = new Map();
const axes = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];
const fiveWindows = [];
for (let y = 0; y < 15; y++)
  for (let x = 0; x < 15; x++)
    axes.forEach(([dx, dy], axis) => {
      if (
        x + 4 * dx < 0 ||
        x + 4 * dx >= 15 ||
        y + 4 * dy < 0 ||
        y + 4 * dy >= 15
      )
        return;
      fiveWindows.push({
        axis,
        cells: Array.from(
          { length: 5 },
          (_, k) => (y + k * dy) * 15 + x + k * dx,
        ),
      });
    });

// D4 rotations/reflections and translations share an identity. Family names alone
// do not make two positions different. This deliberately treats edge translations
// conservatively; authors must supply genuinely different stone structures.
export function positionFingerprint(board) {
  if (!boardValid(board)) return "";
  const cacheKey = board.join("");
  if (fingerprints.has(cacheKey)) return fingerprints.get(cacheKey);
  const stones = board.flatMap((side, i) =>
    side ? [[i % 15, Math.floor(i / 15), side]] : [],
  );
  if (!stones.length) return "board:empty";
  const forms = [];
  for (let reflection = 0; reflection < 2; reflection++) {
    for (let rotation = 0; rotation < 4; rotation++) {
      const points = stones.map(([px, py, side]) => {
        let x = reflection ? -px : px,
          y = py;
        for (let n = 0; n < rotation; n++) [x, y] = [-y, x];
        return [x, y, side];
      });
      const minX = Math.min(...points.map(([x]) => x));
      const minY = Math.min(...points.map(([, y]) => y));
      forms.push(
        points
          .map(([x, y, side]) => `${x - minX},${y - minY},${side}`)
          .sort()
          .join(";"),
      );
    }
  }
  const fingerprint = `board:${forms.sort()[0]}`;
  if (fingerprints.size >= 2048)
    fingerprints.delete(fingerprints.keys().next().value);
  fingerprints.set(cacheKey, fingerprint);
  return fingerprint;
}

const curriculumFingerprints = new Set([
  ...curriculumProblems.map((problem) => positionFingerprint(problem.board)),
  ...curriculumUnits.flatMap((unit) =>
    unit.lessonFrames.map((frame) => positionFingerprint(frame.board)),
  ),
]);
const curriculumById = new Map(
  curriculumProblems.map((problem) => [problem.id, problem]),
);
// Domain claims come from the shipped curriculum, never from caller-supplied tags.
function domainProblem(value) {
  const authored = curriculumById.get(value.problemId || value.id);
  return authored?.role === "assessment" &&
    requiredAssessmentDomains[authored.unitId]?.includes(
      authored.assessmentDomain,
    )
    ? authored
    : null;
}
function trustedAssessmentDomain(value) {
  const authored = domainProblem(value);
  if (!authored) return null;
  const key = identity(value);
  return authored.kind === "compare" &&
    key.unitId === authored.unitId &&
    key.family === authored.family &&
    key.fingerprint === positionFingerprint(authored.board)
    ? authored.assessmentDomain
    : null;
}
function domainEvidenceValid(value) {
  return (
    !!trustedAssessmentDomain(value) &&
    comparisonEvidenceValid(value, domainProblem(value))
  );
}
function comparisonEvidenceValid(value, authored) {
  if (authored.kind !== "compare" || integer(value.acceptedDecisions) < 1)
    return false;
  if (authored.unitId === "conditions") return true;
  if (value.acceptedDecisions < 2 || !Array.isArray(value.history))
    return false;
  const continuations = (authored.nodes || []).flatMap((node) =>
    (node.choices || [])
      .filter((choice) => choice.correct)
      .flatMap((choice) => choice.continuations || []),
  );
  return continuations.some((exercise) => {
    const prefix = exercise.moves;
    if (
      !Array.isArray(prefix) ||
      value.history.length !== prefix.length + 1 ||
      !prefix.every(
        (move, index) =>
          move.i === value.history[index]?.i &&
          move.side === value.history[index]?.side,
      )
    )
      return false;
    const placed = value.history.at(-1);
    if (placed?.side !== 1) return false;
    const board = [...authored.board];
    for (const move of value.history) {
      if (
        !Number.isInteger(move?.i) ||
        move.i < 0 ||
        move.i >= 225 ||
        ![1, 2].includes(move.side) ||
        board[move.i] ||
        winner(board)
      )
        return false;
      board[move.i] = move.side;
    }
    return exerciseSatisfied(board, exercise, placed.i);
  });
}
const baselineIndependent = (value) =>
  independent(value) &&
  !domainProblem(value) &&
  !curriculumById.get(value.problemId || value.id)?.teachesAssessmentDomain;
const domainOf = (value) => trustedAssessmentDomain(value);
function teachesRequiredDomain(value, domain, completed = false) {
  if (!domain) return true;
  const authored = curriculumById.get(value.problemId || value.id);
  if (authored?.role !== "lesson") return false;
  const key = identity(value);
  return (
    [].concat(authored.teachesAssessmentDomain || []).includes(domain) &&
    key.unitId === authored.unitId &&
    key.family === authored.family &&
    key.fingerprint === positionFingerprint(authored.board) &&
    (!completed || comparisonEvidenceValid(value, authored))
  );
}
function remediationLesson(unit, completedIds, domain = null) {
  const candidates = (unit.problemIds || []).filter(
    (id) =>
      !domain || teachesRequiredDomain(curriculumById.get(id) || {}, domain),
  );
  return candidates.find((id) => !completedIds.has(id)) ||
    (!domain && candidates.includes(unit.remediationProblemId)
      ? unit.remediationProblemId : candidates[0]);
}
function assessmentBundle(rows, domains = [], baseline = true) {
  const selected = [];
  if (baseline) {
    const first = rows.find(([, attempt]) => baselineIndependent(attempt));
    if (!first) return [];
    selected.push(first);
  }
  for (const domain of domains) {
    const first = rows.find(([, attempt]) => domainOf(attempt) === domain);
    if (!first) return [];
    selected.push(first);
  }
  return selected.sort(
    ([, a], [, b]) => a.completedOrdinal - b.completedOrdinal,
  );
}

function identity(value) {
  if (!value || typeof value !== "object") value = {};
  return {
    unitId: text(value.unitId || value.skillId),
    problemId: text(value.problemId || value.id),
    family: normalizedFamily(
      text(value.unitId || value.skillId),
      text(value.family),
    ),
    fingerprint: positionFingerprint(value.board) || text(value.fingerprint),
  };
}

export function createPathProgress(
  raw = null,
  legacy = null,
  { curriculumVersion = raw?.curriculumVersion || "3" } = {},
) {
  const empty = {
    schemaVersion: pathSchemaVersion,
    curriculumVersion,
    nextOrdinal: 1,
    exposures: [],
    attempts: {},
    practicalResults: {},
    reviewFindings: {},
    legacy: null,
  };
  if (
    !raw ||
    raw.schemaVersion !== pathSchemaVersion ||
    raw.curriculumVersion !== curriculumVersion
  ) {
    if (raw || legacy)
      empty.legacy = clone({ progress: raw, learning: legacy });
    for (const previous of [raw, legacy].filter(Boolean)) {
      for (const exposure of Array.isArray(previous.exposures)
        ? previous.exposures
        : []) {
        const key =
          typeof exposure === "string"
            ? { unitId: "", problemId: "", family: "", fingerprint: exposure }
            : identity(exposure);
        if (key.fingerprint || key.family || key.problemId || key.unitId)
          empty.exposures.push({
            ...key,
            kind: "legacy",
            at: "",
            ordinal: empty.nextOrdinal++,
          });
      }
      for (const unitId of Array.isArray(previous.viewedUnits)
        ? previous.viewedUnits
        : []) {
        if (typeof unitId === "string")
          empty.exposures.push({
            unitId,
            problemId: "",
            family: "",
            fingerprint: "",
            kind: "legacy-view",
            at: "",
            ordinal: empty.nextOrdinal++,
          });
      }
      for (const attempt of Object.values(previous.attempts || {})) {
        const key = identity(attempt);
        if (key.fingerprint || key.family || key.problemId)
          empty.exposures.push({
            ...key,
            kind: "legacy",
            at: "",
            ordinal: empty.nextOrdinal++,
          });
      }
      for (const finding of Object.values(previous.reviewFindings || {})) {
        if (validFinding(finding))
          empty.reviewFindings[
            JSON.stringify([finding.recordId, finding.ply])
          ] = { ...clone(finding), ordinal: empty.nextOrdinal++ };
      }
    }
    return empty;
  }
  const result = { ...empty, legacy: raw.legacy ? clone(raw.legacy) : null };
  for (const exposure of Array.isArray(raw.exposures) ? raw.exposures : []) {
    if (
      !exposure ||
      !integer(exposure.ordinal) ||
      !(
        exposure.fingerprint ||
        exposure.family ||
        exposure.problemId ||
        exposure.unitId
      )
    )
      continue;
    result.exposures.push({
      ...clone(exposure),
      family: normalizedFamily(exposure.unitId, exposure.family),
    });
    result.nextOrdinal = Math.max(result.nextOrdinal, exposure.ordinal + 1);
  }
  for (const [id, attempt] of Object.entries(raw.attempts || {})) {
    if (
      !id ||
      !attempt ||
      !roles.has(attempt.role) ||
      !integer(attempt.ordinal) ||
      !attempt.unitId
    )
      continue;
    result.attempts[id] = clone(attempt);
    // Re-derive capability identity on restore without discarding historical rows.
    result.attempts[id].assessmentDomain = trustedAssessmentDomain(attempt);
    if (
      attempt.role === "assessment" &&
      (domainProblem(attempt) ||
        attempt.assessmentDomain ||
        attempt.supply === "reserve") &&
      !result.attempts[id].assessmentDomain
    )
      result.attempts[id].invalidAssessmentDomain = true;
    if (assessmentExclusion(attempt.problemId))
      result.attempts[id].assessmentExclusion = assessmentExclusion(
        attempt.problemId,
      );
    const family = normalizedFamily(attempt.unitId, attempt.family);
    if (family !== attempt.family)
      result.attempts[id] = {
        ...result.attempts[id],
        originalFamily: attempt.originalFamily || attempt.family,
        family,
      };
    result.nextOrdinal = Math.max(
      result.nextOrdinal,
      attempt.ordinal + 1,
      (attempt.completedOrdinal || 0) + 1,
      (attempt.lastFailureOrdinal || 0) + 1,
    );
  }
  for (const [id, record] of Object.entries(raw.practicalResults || {})) {
    if (!id || !record?.source || !integer(record.ordinal)) continue;
    const restored = clone(record),
      check = fullGameCheck(restored.source);
    restored.completedOrdinal =
      restored.completedOrdinal ||
      (restored.source.completed === true ||
      ["win", "loss", "draw", "resign"].includes(restored.source.result)
        ? restored.ordinal
        : null);
    restored.completedAt =
      text(restored.completedAt) || completionTimestamp(restored.source);
    restored.eligibleFullGame = !check.failures.length;
    restored.eligibleExam = examEligible(
      restored.source,
      restored.eligibleFullGame,
    );
    restored.exclusionReasons = check.failures;
    restored.actualResult = check.actual;
    result.practicalResults[id] = restored;
    result.nextOrdinal = Math.max(
      result.nextOrdinal,
      restored.ordinal + 1,
      (restored.completedOrdinal || 0) + 1,
    );
  }
  for (const finding of Object.values(raw.reviewFindings || {})) {
    if (!validFinding(finding) || !integer(finding.ordinal)) continue;
    result.reviewFindings[JSON.stringify([finding.recordId, finding.ply])] =
      clone(finding);
    result.nextOrdinal = Math.max(result.nextOrdinal, finding.ordinal + 1);
  }
  return result;
}

function replayMoves(moves) {
  if (!Array.isArray(moves) || moves.length > 225) return null;
  const board = Array(225).fill(0),
    points = [];
  for (let ply = 0; ply < moves.length; ply++) {
    const move = moves[ply],
      i = typeof move === "number" ? move : move?.i;
    if (
      !Number.isInteger(i) ||
      i < 0 ||
      i >= 225 ||
      board[i] ||
      winner(board) ||
      (typeof move === "object" &&
        move.side !== undefined &&
        move.side !== (ply % 2) + 1)
    )
      return null;
    board[i] = (ply % 2) + 1;
    points.push(i);
  }
  const won = winner(board);
  return {
    board,
    points,
    result:
      won === 1
        ? "win"
        : won === 2
          ? "loss"
          : points.length === 225
            ? "draw"
            : "unfinished",
  };
}

function equalBoard(a, b) {
  return boardValid(a) && boardValid(b) && a.every((cell, i) => cell === b[i]);
}

function validFinding(finding) {
  if (
    !finding ||
    !text(finding.recordId) ||
    !reviewUnits[finding.kind] ||
    !unitIds.has(finding.unitId) ||
    !Number.isInteger(finding.ply) ||
    finding.ply < 1 ||
    finding.ply % 2 !== 1
  )
    return false;
  const prefix = replayMoves(finding.prefix);
  return (
    !!prefix &&
    prefix.points.length === finding.ply - 1 &&
    equalBoard(prefix.board, finding.before) &&
    !!replayMoves([...prefix.points, finding.actual])
  );
}

function proofEndsInWin(board, proof, attacker) {
  if (
    proof?.status !== "proven" ||
    proof.attacker !== attacker ||
    !Array.isArray(proof.line) ||
    !proof.line.length
  )
    return false;
  const result = [...board];
  for (let n = 0; n < proof.line.length; n++) {
    const i = proof.line[n];
    if (
      !Number.isInteger(i) ||
      i < 0 ||
      i >= 225 ||
      result[i] ||
      winner(result)
    )
      return false;
    result[i] = n % 2 ? 3 - attacker : attacker;
  }
  return winner(result) === attacker;
}

export function recordReviewFindings(
  progress,
  record,
  moments,
  { at = "" } = {},
) {
  const next = createPathProgress(progress);
  if (!text(record?.id) || (record.rule && record.rule !== "freestyle15"))
    return next;
  const replay = replayMoves(record.moves);
  if (!replay) return next;
  for (const moment of Array.isArray(moments) ? moments : []) {
    if (
      !reviewUnits[moment?.kind] ||
      moment.evidence?.status !== "proven" ||
      !Number.isInteger(moment.ply) ||
      moment.ply < 1 ||
      moment.ply > replay.points.length ||
      moment.ply % 2 !== 1 ||
      replay.points[moment.ply - 1] !== moment.actual
    )
      continue;
    const prefix = replay.points.slice(0, moment.ply - 1),
      before = replayMoves(prefix).board;
    if (!equalBoard(before, moment.before)) continue;
    const alternatives = (
      Array.isArray(moment.alternatives) ? moment.alternatives : []
    ).filter(
      (i) =>
        Number.isInteger(i) &&
        i >= 0 &&
        i < 225 &&
        !before[i] &&
        i !== moment.actual,
    );
    if (!alternatives.length) continue;
    const after = [...before];
    after[moment.actual] = 1;
    if (winner(after)) continue;
    if (moment.kind === "miss-win") {
      if (
        !alternatives.some((i) => {
          const b = [...before];
          b[i] = 1;
          return winner(b) === 1;
        })
      )
        continue;
    } else if (
      !proofEndsInWin(after, moment.evidence, 2) ||
      (moment.kind === "lost-order" &&
        !proofEndsInWin(before, moment.priorWinningProof, 1))
    )
      continue;
    const unitId = moment.unitId || moment.skillId || reviewUnits[moment.kind];
    if (!unitIds.has(unitId)) continue;
    const id = JSON.stringify([record.id, moment.ply]);
    if (next.reviewFindings[id]) continue;
    next.reviewFindings[id] = {
      recordId: record.id,
      ply: moment.ply,
      unitId,
      kind: moment.kind,
      before,
      prefix,
      actual: moment.actual,
      at: text(at),
      ordinal: next.nextOrdinal++,
    };
    next.exposures.push({
      unitId,
      problemId: "",
      family: "",
      fingerprint: positionFingerprint(before),
      kind: "game-encounter",
      at: text(at),
      ordinal: next.nextOrdinal++,
    });
  }
  return next;
}

function matches(a, b) {
  if (a.fingerprint && b.fingerprint && a.fingerprint === b.fingerprint)
    return true;
  if (a.problemId && a.problemId === b.problemId) return true;
  // A family-only exposure has no position-level evidence, so stay conservative.
  return !a.fingerprint && a.family && a.family === b.family;
}

function wasSeen(progress, candidate, exceptAttemptId = null) {
  return (
    progress.exposures.some((e) => matches(e, candidate)) ||
    Object.entries(progress.attempts).some(
      ([id, a]) => id !== exceptAttemptId && matches(a, candidate),
    ) ||
    Object.values(progress.practicalResults).some((record) => {
      const fingerprint = candidate.fingerprint;
      const count =
        fingerprint === "board:empty"
          ? 0
          : /^board:\d+,\d+,[12](?:;\d+,\d+,[12])*$/.test(fingerprint)
            ? fingerprint.split(";").length
            : null;
      if (
        count === null ||
        !Array.isArray(record.source.moves) ||
        record.source.moves.length < count
      )
        return false;
      const prefix = replayMoves(record.source.moves.slice(0, count));
      return !!prefix && positionFingerprint(prefix.board) === fingerprint;
    })
  );
}

export function noteExposure(progress, exposure) {
  const next = createPathProgress(progress),
    key = identity(exposure);
  if (!(key.fingerprint || key.family || key.problemId || key.unitId))
    return next;
  const kind = text(exposure.kind) || "view";
  if (
    !next.exposures.some(
      (e) =>
        e.fingerprint === key.fingerprint &&
        e.problemId === key.problemId &&
        e.family === key.family &&
        e.kind === kind &&
        e.unitId === key.unitId,
    )
  ) {
    next.exposures.push({
      ...key,
      kind,
      at: text(exposure.at),
      ordinal: next.nextOrdinal++,
    });
  }
  for (const attempt of Object.values(next.attempts)) {
    if (
      !attempt.completedOrdinal &&
      matches(key, attempt) &&
      !attempt.exposureSeen
    ) {
      attempt.exposureSeen = true;
      attempt.lastFailureOrdinal = next.nextOrdinal++;
      attempt.lastFailureAt = text(exposure.at);
    }
  }
  return next;
}

function responded(history) {
  return (
    Array.isArray(history) &&
    history.some(
      (move, i) =>
        move?.side === 2 &&
        history.slice(i + 1).some((next) => next?.side === 1),
    )
  );
}

export function recordAttemptEvidence(progress, attempt, metadata = {}) {
  const next = createPathProgress(progress);
  if (!attempt || typeof attempt !== "object") return next;
  const id = text(attempt?.attemptId || metadata.attemptId);
  const key = identity({
    ...attempt,
    ...metadata,
    problemId: attempt?.problemId || metadata.problemId,
  });
  if (
    !id ||
    !key.unitId ||
    !roles.has(metadata.role || attempt.role || "lesson")
  )
    return next;
  const prior = next.attempts[id];
  if (
    prior &&
    (prior.problemId !== key.problemId || prior.unitId !== key.unitId)
  )
    return next;
  if (prior?.status === "solved" && attempt.status !== "solved") return next;
  const role = prior?.role || metadata.role || attempt.role || "lesson";
  const currentAt = text(metadata.at || attempt.at);
  const status = ["choose", "feedback", "solved"].includes(attempt.status)
    ? attempt.status
    : "choose";
  const completedOrdinal =
    prior?.completedOrdinal ||
    (status === "solved" ? next.nextOrdinal++ : null);
  const requiresBranch =
    prior?.requiresBranch ??
    domainProblem(key)?.requiresBranch ??
    metadata.requiresBranch !== false;
  const row = {
    ...key,
    ...(assessmentExclusion(key.problemId)
      ? { assessmentExclusion: assessmentExclusion(key.problemId) }
      : {}),
    role,
    ordinal: prior?.ordinal || next.nextOrdinal++,
    startedAt: prior ? prior.startedAt : currentAt,
    completedAt: prior?.completedOrdinal
      ? prior.completedAt
      : status === "solved"
        ? currentAt
        : "",
    completedOrdinal,
    status,
    family: prior?.family || key.family,
    fingerprint: prior?.fingerprint || key.fingerprint,
    acceptedDecisions: Math.max(
      integer(prior?.acceptedDecisions),
      integer(attempt.metrics?.acceptedDecisions ?? attempt.acceptedDecisions),
    ),
    history: Array.isArray(attempt.history)
      ? clone(attempt.history)
      : clone(prior?.history || []),
    branchId:
      prior?.branchId || text(metadata.branchId || metadata.requiredBranch),
    requiresBranch,
    branchHandled:
      prior?.branchHandled === true ||
      !requiresBranch ||
      responded(attempt.history),
    exposureSeen:
      prior?.exposureSeen === true ||
      (prior?.status !== "solved" && wasSeen(next, key, id)),
    hints: Math.max(
      prior?.hints || 0,
      integer(attempt.hints?.uses ?? attempt.hints),
    ),
    guidanceSeen:
      prior?.guidanceSeen === true ||
      attempt.guidanceSeen === true ||
      attempt.assisted === true,
    mistakes: Math.max(
      prior?.mistakes || 0,
      integer(attempt.metrics?.verifiedMistakes ?? attempt.verifiedMistakes),
    ),
    unknownSelections: Math.max(
      prior?.unknownSelections || 0,
      integer(attempt.metrics?.unknownSelections ?? attempt.unknownSelections),
    ),
    retries: Math.max(
      prior?.retries || 0,
      integer(attempt.metrics?.retries ?? attempt.retries),
    ),
  };
  row.assessmentDomain = trustedAssessmentDomain(row);
  if (
    prior?.invalidAssessmentDomain ||
    (role === "assessment" &&
      (domainProblem(row) ||
        metadata.assessmentDomain ||
        attempt.assessmentDomain ||
        metadata.supply === "reserve" ||
        attempt.supply === "reserve") &&
      !row.assessmentDomain)
  )
    row.invalidAssessmentDomain = true;
  const newFailure =
    (row.status === "feedback" && prior?.status !== "feedback") ||
    ["hints", "mistakes", "unknownSelections", "retries"].some(
      (key) => row[key] > (prior?.[key] || 0),
    ) ||
    ["guidanceSeen", "exposureSeen"].some((key) => row[key] && !prior?.[key]);
  row.lastFailureOrdinal = newFailure
    ? next.nextOrdinal++
    : prior?.lastFailureOrdinal || null;
  row.lastFailureAt = newFailure ? currentAt : text(prior?.lastFailureAt);
  next.attempts[id] = row;
  return next;
}

function independent(a) {
  return (
    a.role === "assessment" &&
    !a.invalidAssessmentDomain &&
    !assessmentExclusion(a.problemId) &&
    a.status === "solved" &&
    a.family &&
    a.fingerprint &&
    a.branchId &&
    a.branchHandled &&
    (!domainProblem(a) || domainEvidenceValid(a)) &&
    !a.exposureSeen &&
    !a.hints &&
    !a.guidanceSeen &&
    !a.mistakes &&
    !a.unknownSelections &&
    !a.retries
  );
}

function fourEntries(board, side) {
  const entries = new Set();
  for (const { cells } of fiveWindows) {
    if (
      cells.filter((i) => board[i] === side).length === 3 &&
      cells.every((i) => board[i] !== 3 - side)
    )
      cells.filter((i) => !board[i]).forEach((i) => entries.add(i));
  }
  return [...entries];
}

function forkThreatPoints(board, side) {
  return fourEntries(board, side).filter((point) => {
    const next = [...board];
    next[point] = side;
    return (
      !winner(next) &&
      winningMoves(next, side).length >= 2 &&
      !winningMoves(next, 3 - side).length
    );
  });
}

function connectionGroups(board, pivot, minimum) {
  const groups = new Map();
  for (const { axis, cells } of fiveWindows) {
    if (
      !cells.includes(pivot) ||
      cells.some((i) => board[i] === 2) ||
      cells.filter((i) => board[i] === 1).length < minimum ||
      cells.every((i) => board[i])
    )
      continue;
    if (!groups.has(axis)) groups.set(axis, new Set());
    cells.filter((i) => !board[i]).forEach((i) => groups.get(axis).add(i));
  }
  return groups;
}

function forcingFinish(replay, startPly, minimumFours) {
  if (
    replay.result !== "win" ||
    !Number.isInteger(startPly) ||
    startPly < 1 ||
    startPly % 2 !== 1 ||
    startPly >= replay.points.length
  )
    return false;
  const board = replayMoves(replay.points.slice(0, startPly - 1)).board;
  let fours = 0,
    threats = [];
  for (let ply = startPly; ply <= replay.points.length; ply++) {
    const point = replay.points[ply - 1],
      side = ply % 2 ? 1 : 2;
    if (side === 2 && !threats.includes(point)) return false;
    board[point] = side;
    if (winner(board))
      return (
        side === 1 && ply === replay.points.length && fours >= minimumFours
      );
    if (side === 1) {
      threats = winningMoves([...board], 1);
      if (
        !threats.length ||
        winningMoves([...board], 2).length ||
        !fourAxesAt(board, point, 1).size
      )
        return false;
      fours++;
    }
  }
  return false;
}

function fourAxesAt(board, point, side) {
  return new Set(
    fiveWindows
      .filter(
        ({ cells }) =>
          cells.includes(point) &&
          cells.filter((i) => board[i] === side).length === 4 &&
          cells.every((i) => board[i] !== 3 - side),
      )
      .map(({ axis }) => axis),
  );
}

function tacticalDirectionResponse(replay, pivot, replyPly, responsePly) {
  if (
    !Number.isInteger(replyPly) ||
    replyPly < 2 ||
    replyPly % 2 ||
    responsePly !== replyPly + 1 ||
    responsePly > replay.points.length
  )
    return null;
  const before = replayMoves(replay.points.slice(0, replyPly - 1)).board;
  if (before[pivot] !== 1 || winningMoves([...before], 1).length) return null;
  const threes = lineShapes(before, 1).filter(
    (shape) => shape.kind === "three" && shape.cells.includes(pivot),
  );
  const axesBefore = new Set(threes.map((shape) => shape.axis));
  const afterReply = [...before];
  afterReply[replay.points[replyPly - 1]] = 2;
  const remaining = lineShapes(afterReply, 1).filter(
    (shape) => shape.kind === "three" && shape.cells.includes(pivot),
  );
  const beforePoints = new Map(),
    afterPoints = new Map();
  for (const [shapes, target] of [
    [threes, beforePoints],
    [remaining, afterPoints],
  ])
    for (const shape of shapes) {
      if (!target.has(shape.axis)) target.set(shape.axis, new Set());
      shape.points.forEach((point) => target.get(shape.axis).add(point));
    }
  const restricted = new Set(
    [...beforePoints]
      .filter(([axis, points]) =>
        [...points].some((point) => !afterPoints.get(axis)?.has(point)),
      )
      .map(([axis]) => axis),
  );
  const actual = replay.points[responsePly - 1];
  if (
    axesBefore.size < 2 ||
    !restricted.size ||
    !remaining.some(
      (shape) => !restricted.has(shape.axis) && shape.points.includes(actual),
    )
  )
    return null;
  const straight = threes.filter((shape) => {
    const coordinates = shape.cells
      .map((i) => (axes[shape.axis][0] ? i % 15 : Math.floor(i / 15)))
      .sort((a, b) => a - b);
    return coordinates.at(-1) - coordinates[0] === 2;
  });
  return new Set(straight.map((shape) => shape.axis)).size === axesBefore.size
    ? "straight-three-response"
    : !straight.length
      ? "broken-three-response"
      : null;
}

function directionResponse(replay, pivot, replyPly, responsePly, minimum) {
  if (
    !Number.isInteger(replyPly) ||
    replyPly < 2 ||
    replyPly % 2 ||
    responsePly !== replyPly + 1 ||
    responsePly > replay.points.length
  )
    return false;
  const beforeReply = replayMoves(replay.points.slice(0, replyPly - 1)).board;
  if (beforeReply[pivot] !== 1) return false;
  const before = connectionGroups(beforeReply, pivot, minimum),
    afterReply = [...beforeReply];
  afterReply[replay.points[replyPly - 1]] = 2;
  const remaining = connectionGroups(afterReply, pivot, minimum);
  if (
    before.size < 2 ||
    ![...before.keys()].some((axis) => !remaining.has(axis)) ||
    !remaining.size
  )
    return false;
  const actual = replay.points[responsePly - 1],
    after = [...afterReply];
  after[actual] = 1;
  const extended = connectionGroups(after, pivot, minimum + 1);
  return [...remaining].some(
    ([axis, points]) => points.has(actual) && extended.has(axis),
  );
}

// Local successes are retained in opportunities. Unit credit additionally needs
// the actual sequence to meet that unit's authored objective, through every source.
function meetsPracticalUnitGoal(event, replay, before, after, actual) {
  const ownBefore = winningMoves([...before], 1),
    ownAfter = winningMoves([...after], 1);
  if (event.unitId === "priority") {
    if (winner(after) === 1) return "own-win-first";
    const enemy = winningMoves([...before], 2);
    return !ownBefore.length &&
      enemy.length === 1 &&
      actual === enemy[0] &&
      !winningMoves([...after], 2).length
      ? "prevent-immediate-loss"
      : null;
  }
  if (event.unitId === "conditions")
    return !ownBefore.length &&
      !winner(after) &&
      ownAfter.length >= 2 &&
      !winningMoves([...after], 2).length &&
      forcingFinish(replay, event.ply, 1)
      ? fourAxesAt(after, actual, 1).size >= 2
        ? "crossed-four"
        : "open-four"
      : null;
  if (event.unitId === "order")
    return !ownBefore.length &&
      !winner(after) &&
      forcingFinish(replay, event.ply, 2)
      ? "forcing-order"
      : null;
  if (event.unitId === "practice")
    return event.ply === replay.points.length && winner(after) === 1
      ? "terminal-win"
      : null;
  if (
    event.unitId === "defense" ||
    (event.unitId === "opening" && event.ply <= 7)
  ) {
    const threats = forkThreatPoints(before, 2);
    if (
      threats.length &&
      (winner(after) === 1 ||
        (!winningMoves([...after], 2).length &&
          !forkThreatPoints(after, 2).length))
    ) {
      if (event.unitId === "opening") return "early-threat-defense";
      return threats.some((point) => {
        const board = [...before];
        board[point] = 2;
        return fourAxesAt(board, point, 2).size >= 2;
      })
        ? "crossed-threat"
        : "single-axis-threat";
    }
    if (event.unitId === "defense") return null;
  }
  if (event.unitId === "opening")
    return directionResponse(replay, actual, event.ply + 1, event.ply + 2, 2)
      ? "two-axis-response"
      : null;
  if (event.unitId === "branch") {
    const switching = event.objectiveId === "switch-direction";
    const responsePly = switching ? event.ply : event.ply + 2;
    const pivot = switching ? event.evidence?.pivot : actual;
    return forcingFinish(replay, responsePly, 1)
      ? tacticalDirectionResponse(replay, pivot, responsePly - 1, responsePly)
      : null;
  }
  if (event.unitId === "counter") {
    const startPly =
      event.objectiveId === "recover-after-defense"
        ? event.evidence?.defense?.ply
        : event.ply;
    if (
      !Number.isInteger(startPly) ||
      startPly < 1 ||
      startPly % 2 !== 1 ||
      startPly > event.ply
    )
      return false;
    const defenseBefore = replayMoves(
      replay.points.slice(0, startPly - 1),
    ).board;
    const defenseAfter = [...defenseBefore];
    defenseAfter[replay.points[startPly - 1]] = 1;
    if (
      !winningMoves([...defenseBefore], 2).length ||
      winningMoves([...defenseAfter], 2).length
    )
      return null;
    return winningMoves([...defenseAfter], 1).length >= 2 &&
      forcingFinish(replay, startPly, 1)
      ? "defend-two-finishes"
      : forcingFinish(replay, startPly, 2)
        ? "defend-forcing-chain"
        : null;
  }
  if (event.unitId === "prepare") {
    if (
      ownBefore.length ||
      fourEntries(before, 1).length ||
      ownAfter.length ||
      lineShapes(after, 1).some((shape) => shape.kind === "three") ||
      winner(after) ||
      winningMoves([...after], 2).length ||
      !forcingFinish(replay, event.ply + 2, 1)
    )
      return false;
    const entryAxes = new Map();
    for (const entry of fourEntries(after, 1)) {
      const possible = [...after];
      possible[entry] = 1;
      if (
        !winningMoves([...possible], 1).length ||
        winningMoves([...possible], 2).length
      )
        continue;
      for (const { axis, cells } of fiveWindows)
        if (
          cells.includes(actual) &&
          cells.includes(entry) &&
          cells.filter((i) => possible[i] === 1).length === 4 &&
          cells.every((i) => possible[i] !== 2)
        ) {
          if (!entryAxes.has(axis)) entryAxes.set(axis, new Set());
          const coordinates = cells
            .filter((i) => after[i] === 1)
            .map((i) => (axes[axis][0] ? i % 15 : Math.floor(i / 15)));
          const at = axes[axis][0] ? entry % 15 : Math.floor(entry / 15);
          entryAxes
            .get(axis)
            .add(
              at > Math.min(...coordinates) && at < Math.max(...coordinates)
                ? "inside"
                : "outside",
            );
        }
    }
    if (entryAxes.size < 2) return null;
    const types = new Set(
      [...entryAxes.values()].flatMap((values) => [...values]),
    );
    return [...entryAxes.values()].filter((values) => values.has("inside"))
      .length >= 2
      ? "inside-gap-reserves"
      : types.has("inside") && types.has("outside")
        ? "mixed-reserve-entries"
        : null;
  }
  return false;
}

function validPracticalOpportunity(event, replay) {
  if (
    !event ||
    !unitIds.has(event.unitId) ||
    event.success !== true ||
    event.retracted ||
    ![undefined, "achieved"].includes(event.outcome) ||
    !Number.isInteger(event.ply) ||
    event.ply < 1 ||
    event.ply > replay.points.length ||
    event.ply % 2 !== 1
  )
    return null;
  const actual = replay.points[event.ply - 1],
    before = replayMoves(replay.points.slice(0, event.ply - 1)).board;
  if (event.actual !== undefined && event.actual !== actual) return null;
  const after = [...before];
  after[actual] = 1;
  const conditionId = meetsPracticalUnitGoal(
    event,
    replay,
    before,
    after,
    actual,
  );
  if (!conditionId) return null;
  if (event.source === "verified-pattern")
    return {
      ply: event.ply,
      unitId: event.unitId,
      conditionId,
      fingerprint: positionFingerprint(before),
    };
  const objective = event.objectiveId,
    evidence = event.evidence;
  const validUnit =
    objectiveUnits[objective] === event.unitId ||
    (event.sourceUnitId === objectiveUnits[objective] &&
      derivedObjectives[event.unitId]?.includes(objective));
  if (
    !validUnit ||
    !evidence ||
    typeof evidence !== "object" ||
    (event.kind !== undefined && event.kind !== objective)
  )
    return null;
  if (
    ["played", "move"].some(
      (key) => evidence[key] !== undefined && evidence[key] !== actual,
    )
  )
    return null;
  const shape = (item, point = actual) =>
    item &&
    ["three", "four"].includes(item.kind) &&
    Array.isArray(item.cells) &&
    item.cells.includes(actual) &&
    item.cells.includes(point) &&
    item.cells.every((i) => Number.isInteger(i) && after[i] === 1);
  let valid = false;
  if (objective === "take-win")
    valid =
      evidence.played === actual &&
      evidence.points?.includes(actual) &&
      winner(after) === 1;
  else if (objective === "stop-five")
    valid =
      evidence.played === actual &&
      winningMoves([...before], 2).length > 0 &&
      !winningMoves([...after], 2).length;
  else if (objective === "finish-five")
    valid =
      winner(after) === 1 &&
      Array.isArray(evidence.line) &&
      evidence.line.includes(actual) &&
      evidence.line.every((i) => after[i] === 1);
  else if (objective === "force-four")
    valid =
      evidence.move === actual &&
      !winner(after) &&
      !winningMoves([...before], 1).length &&
      winningMoves([...after], 1).length > 0 &&
      !winningMoves([...after], 2).length;
  else if (objective === "build-threat")
    valid =
      evidence.move === actual &&
      Array.isArray(evidence.shapes) &&
      evidence.shapes.some((item) => shape(item));
  else if (objective === "two-directions")
    valid =
      evidence.pivot === actual &&
      Array.isArray(evidence.groups) &&
      new Set(
        evidence.groups
          .filter(
            (group) =>
              Array.isArray(group.cells) &&
              group.cells.includes(actual) &&
              group.cells.every((i) => after[i] === 1),
          )
          .map((group) => group.axis),
      ).size >= 2;
  else if (objective === "switch-direction")
    valid =
      evidence.played === actual &&
      evidence.reply === replay.points[event.ply - 2] &&
      Number.isInteger(evidence.planPly) &&
      evidence.planPly > 0 &&
      evidence.planPly < event.ply - 1 &&
      replay.points[evidence.planPly - 1] === evidence.pivot &&
      Array.isArray(evidence.remaining) &&
      evidence.remaining.some((group) => group.points?.includes(actual));
  else if (objective === "recover-after-defense")
    valid =
      evidence.move === actual &&
      Number.isInteger(evidence.defense?.ply) &&
      evidence.defense.ply > 0 &&
      evidence.defense.ply < event.ply &&
      replay.points[evidence.defense.ply - 1] === evidence.defense.point &&
      Array.isArray(evidence.shapes) &&
      evidence.shapes.some((item) => shape(item, evidence.defense.point));
  else if (objective === "prevent-fork")
    valid =
      evidence.played === actual &&
      Array.isArray(evidence.before) &&
      evidence.before.length > 0 &&
      Array.isArray(evidence.remaining) &&
      !evidence.remaining.length &&
      !winningMoves([...after], 2).length &&
      evidence.before.some((threat) => {
        if (
          !Number.isInteger(threat.move) ||
          threat.move < 0 ||
          threat.move >= 225 ||
          before[threat.move]
        )
          return false;
        const possible = [...before];
        possible[threat.move] = 2;
        return winningMoves(possible, 2).length >= 2;
      });
  return valid
    ? {
        ply: event.ply,
        unitId: event.unitId,
        conditionId,
        fingerprint: positionFingerprint(before),
      }
    : null;
}

function practicalConfirmations(progress, unitId) {
  const records = Object.values(progress.practicalResults).sort(
    (a, b) => a.ordinal - b.ordinal,
  );
  const previous = [],
    confirmations = [];
  for (const record of records) {
    const replay = replayMoves(record.source.moves);
    if (replay && record.eligibleFullGame && date(record.completedAt)) {
      const events = (
        Array.isArray(record.source.opportunities)
          ? record.source.opportunities
          : []
      )
        .flatMap((event) => {
          if (event?.unitId === unitId) return [event];
          return event?.unitId === objectiveUnits[event?.objectiveId] &&
            derivedObjectives[unitId]?.includes(event.objectiveId)
            ? [{ ...event, sourceUnitId: event.unitId, unitId }]
            : [];
        })
        .map((event) => validPracticalOpportunity(event, replay))
        .filter(Boolean)
        .sort((a, b) => a.ply - b.ply);
      const fresh = events.filter(
        (event) =>
          !curriculumFingerprints.has(event.fingerprint) &&
          !progress.exposures.some(
            (exposure) =>
              exposure.ordinal < record.completedOrdinal &&
              exposure.fingerprint === event.fingerprint,
          ) &&
          !Object.values(progress.attempts).some(
            (attempt) =>
              attempt.ordinal < record.completedOrdinal &&
              attempt.fingerprint === event.fingerprint,
          ) &&
          !previous.some(
            (prior) =>
              prior.points.length >= event.ply - 1 &&
              positionFingerprint(
                replayMoves(prior.points.slice(0, event.ply - 1)).board,
              ) === event.fingerprint,
          ),
      );
      const conditions = new Set();
      for (const event of fresh)
        if (!conditions.has(event.conditionId)) {
          confirmations.push({
            ...event,
            recordId: record.source.id,
            ordinal: record.ordinal,
            completedOrdinal: record.completedOrdinal,
            completedAt: record.completedAt,
          });
          conditions.add(event.conditionId);
        }
    }
    if (replay) previous.push(replay);
  }
  return confirmations.sort((a, b) => a.completedOrdinal - b.completedOrdinal);
}

function practicalPair(evidence, unitId, conditionId = null) {
  if (conditionId)
    evidence = evidence.filter((item) => item.conditionId === conditionId);
  const required = conditionId ? [conditionId] : practicalConditions[unitId];
  for (let right = 1; right < evidence.length; right++)
    for (let left = 0; left < right; left++) {
      const pair = [evidence[left], evidence[right]];
      if (pair[0].recordId === pair[1].recordId) continue;
      if (
        !required ||
        required.every((condition) =>
          pair.some((item) => item.conditionId === condition),
        )
      )
        return pair;
    }
  return [];
}

function recoveryMatches(record, finding) {
  const source = record.source,
    reference = source.sourceReview;
  if (
    source.role !== "recovery" ||
    source.completed !== true ||
    !(record.completedOrdinal > finding.ordinal) ||
    reference?.recordId !== finding.recordId ||
    reference.ply !== finding.ply ||
    source.startPly !== finding.ply - 1 ||
    !equalBoard(reference.before, finding.before) ||
    !equalBoard(source.startBoard, finding.before)
  )
    return false;
  const replay = replayMoves(source.moves);
  return (
    !!replay &&
    replay.result !== "unfinished" &&
    replay.result === source.result &&
    finding.prefix.every((point, i) => replay.points[i] === point)
  );
}

function reviewStages(progress, unitId = null) {
  const records = Object.values(progress.practicalResults).sort(
    (a, b) => a.completedOrdinal - b.completedOrdinal,
  );
  const assessments = Object.entries(progress.attempts)
    .filter(([, a]) => independent(a))
    .sort(([, a], [, b]) => a.completedOrdinal - b.completedOrdinal);
  return Object.values(progress.reviewFindings)
    .filter((finding) => !unitId || finding.unitId === unitId)
    .sort((a, b) => a.ordinal - b.ordinal)
    .map((finding) => {
      const requiredCondition =
        finding.unitId === "priority"
          ? finding.kind === "miss-win"
            ? "own-win-first"
            : finding.kind === "miss-block"
              ? "prevent-immediate-loss"
              : null
          : null;
      const recovery = records.find((record) =>
        recoveryMatches(record, finding),
      );
      const requiredDomains = requiredAssessmentDomains[finding.unitId] || [];
      const candidates = recovery
        ? assessments.filter(
            ([, a]) =>
              a.unitId === finding.unitId &&
              matchesCondition(a, requiredCondition) &&
              date(a.startedAt) &&
              date(a.completedAt) &&
              a.ordinal > recovery.completedOrdinal &&
              a.completedOrdinal > recovery.completedOrdinal,
          )
        : [];
      const assessmentEvidence = assessmentBundle(candidates, requiredDomains);
      const assessment = assessmentEvidence.at(-1);
      const domainEvidence = assessmentBundle(
        candidates,
        requiredDomains,
        false,
      );
      const gameEvidence = practicalConfirmations(progress, finding.unitId);
      const transferGames = recovery
        ? practicalPair(
            gameEvidence.filter(
              (evidence) => evidence.ordinal > recovery.completedOrdinal,
            ),
            finding.unitId,
            requiredCondition,
          )
        : [];
      const gameTransfer =
        transferGames.length === 2 &&
        (!requiredDomains.length ||
          domainEvidence.length === requiredDomains.length)
          ? [transferGames[1], domainEvidence.at(-1)?.[1]]
              .filter(Boolean)
              .sort((a, b) => a.completedOrdinal - b.completedOrdinal)
              .at(-1)
          : null;
      const useGames =
        !!gameTransfer &&
        (!assessment ||
          gameTransfer.completedOrdinal < assessment[1].completedOrdinal);
      const transfer = useGames ? gameTransfer : assessment?.[1];
      const practical =
        transfer &&
        gameEvidence.find(
          (evidence) =>
            evidence.recordId !== finding.recordId &&
            (!requiredCondition ||
              evidence.conditionId === requiredCondition) &&
            evidence.ordinal > transfer.completedOrdinal,
        );
      return {
        recordId: finding.recordId,
        ply: finding.ply,
        unitId: finding.unitId,
        kind: finding.kind,
        ordinal: finding.ordinal,
        requiredCondition,
        requiredDomains,
        pendingDomains: requiredDomains.filter(
          (domain) =>
            !candidates.some(([, attempt]) => domainOf(attempt) === domain),
        ),
        baselinePending:
          !candidates.some(([, attempt]) => baselineIndependent(attempt)) &&
          transferGames.length !== 2,
        stage: !recovery
          ? "recovery"
          : !transfer
            ? "assessment"
            : !practical
              ? "practical"
              : "resolved",
        recoveryId: recovery?.source.id || null,
        assessmentId: (!useGames && assessment?.[0]) || null,
        assessmentEvidence: (useGames
          ? domainEvidence
          : assessmentEvidence
        ).map(([attemptId, attempt]) => ({
          attemptId,
          problemId: attempt.problemId,
          assessmentDomain: domainOf(attempt),
        })),
        practicalRecordId: practical?.recordId || null,
        transferMethod: transfer
          ? useGames
            ? "practical"
            : "assessment"
          : null,
        transferEvidence: useGames
          ? transferGames.map(({ recordId, ply, conditionId }) => ({
              recordId,
              ply,
              conditionId,
            }))
          : [],
        assessmentOrdinal: transfer?.completedOrdinal || null,
      };
    });
}

function failedAssessment(attempt) {
  return (
    attempt.role === "assessment" &&
    !attempt.invalidAssessmentDomain &&
    !assessmentExclusion(attempt.problemId) &&
    (attempt.status === "feedback" ||
      attempt.hints ||
      attempt.guidanceSeen ||
      attempt.mistakes ||
      attempt.unknownSelections ||
      attempt.retries ||
      attempt.exposureSeen)
  );
}

function datedAfter(value, minimum = "") {
  return (
    !!date(value) &&
    (!date(minimum) || Date.parse(value) >= Date.parse(minimum))
  );
}

function relevantTask(source, unitId) {
  return (
    source.unitId === unitId ||
    source.unitIds?.includes(unitId) ||
    (Array.isArray(source.opportunities) &&
      source.opportunities.some(
        (event) =>
          event?.unitId === unitId &&
          !event.retracted &&
          (typeof event.success === "boolean" ||
            ["achieved", "missed"].includes(event.outcome)),
      )) ||
    (Array.isArray(source.objectives) &&
      source.objectives.some(
        (objective) =>
          objective?.unitId === unitId &&
          ["achieved", "observed"].includes(objective.status),
      ))
  );
}

function assessmentReviewStates(progress, unitId, initial, practicalEvidence) {
  if (!initial) return [];
  const rows = Object.entries(progress.attempts).filter(
    ([, attempt]) => attempt.unitId === unitId,
  );
  const failures = rows
    .filter(([, attempt]) => failedAssessment(attempt))
    .map(([id, attempt]) => ({
      id,
      attempt,
      ordinal:
        attempt.lastFailureOrdinal ||
        attempt.completedOrdinal ||
        attempt.ordinal,
    }));
  const latest = new Map();
  for (const failure of failures
    .filter(
      (item) =>
        domainOf(item.attempt) || item.ordinal > initial.completedOrdinal,
    )
    .sort((a, b) => a.ordinal - b.ordinal))
    latest.set(
      domainOf(failure.attempt) ||
        (unitId === "priority"
          ? priorityCondition(failure.attempt.family)
          : null),
      failure,
    );
  return [...latest]
    .sort(([, a], [, b]) => a.ordinal - b.ordinal)
    .map(([requirement, failure]) => {
      const requiredDomain = requiredAssessmentDomains[unitId]?.includes(
        requirement,
      )
        ? requirement
        : null;
      const requiredCondition = requiredDomain ? null : requirement;
      const requiredDomains = requiredDomain
        ? [requiredDomain]
        : requiredAssessmentDomains[unitId] || [];
      const failureAt = text(failure.attempt.lastFailureAt);
      const remediation = rows
        .filter(
          ([, attempt]) =>
            attempt.role === "lesson" &&
            attempt.status === "solved" &&
            teachesRequiredDomain(attempt, requiredDomain, true) &&
            attempt.completedOrdinal > failure.ordinal &&
            date(attempt.startedAt) &&
            datedAfter(attempt.completedAt, failureAt),
        )
        .map(([id, attempt]) => ({
          id,
          ordinal: attempt.completedOrdinal,
          at: attempt.completedAt,
        }));
      for (const record of Object.values(progress.practicalResults)) {
        const source = record.source;
        if (
          requiredDomain ||
          !(record.completedOrdinal > failure.ordinal) ||
          source.completed !== true ||
          !datedAfter(record.completedAt, failureAt) ||
          !(
            source.role === "journey" ||
            source.role === "recovery" ||
            source.trackId
          ) ||
          !relevantTask(source, unitId)
        )
          continue;
        const replay = replayMoves(source.moves);
        if (
          replay &&
          replay.result !== "unfinished" &&
          replay.result === source.result
        )
          remediation.push({
            id: source.id,
            ordinal: record.completedOrdinal,
            at: record.completedAt,
          });
      }
      remediation.sort((a, b) => a.ordinal - b.ordinal);
      const remedial = remediation[0];
      const candidates = remedial
        ? rows
            .filter(
              ([, attempt]) =>
                independent(attempt) &&
                matchesCondition(attempt, requiredCondition) &&
                attempt.ordinal > remedial.ordinal &&
                datedAfter(attempt.startedAt, remedial.at) &&
                datedAfter(attempt.completedAt, attempt.startedAt) &&
                datedAfter(attempt.completedAt, failureAt),
            )
            .sort(([, a], [, b]) => a.completedOrdinal - b.completedOrdinal)
        : [];
      const assessments = assessmentBundle(
        candidates,
        requiredDomains,
        !requiredDomain,
      );
      const domainAssessments = assessmentBundle(
        candidates,
        requiredDomains,
        false,
      );
      const games = remedial
        ? practicalPair(
            practicalEvidence.filter(
              (event) =>
                event.ordinal > remedial.ordinal &&
                datedAfter(event.completedAt, remedial.at) &&
                datedAfter(event.completedAt, failureAt),
            ),
            unitId,
            requiredCondition,
          )
        : [];
      const gameResolution =
        !requiredDomain &&
        games.length === 2 &&
        (!requiredDomains.length ||
          domainAssessments.length === requiredDomains.length)
          ? [games[1], domainAssessments.at(-1)?.[1]]
              .filter(Boolean)
              .sort((a, b) => a.completedOrdinal - b.completedOrdinal)
              .at(-1)
          : null;
      const assessmentResolution = assessments.at(-1)?.[1];
      const useGames =
        !!gameResolution &&
        (!assessmentResolution ||
          gameResolution.completedOrdinal <
            assessmentResolution.completedOrdinal);
      const resolution = useGames ? gameResolution : assessmentResolution;
      const previousDomainEvidence = requiredDomain
        ? rows.find(
            ([, attempt]) =>
              independent(attempt) &&
              domainOf(attempt) === requiredDomain &&
              attempt.completedOrdinal < failure.ordinal,
          )?.[1]
        : initial;
      return {
        attemptId: failure.id,
        problemId: failure.attempt.problemId,
        failureOrdinal: failure.ordinal,
        failureAt,
        requiredCondition,
        requiredDomain,
        requiredDomains,
        baselinePending:
          !requiredDomain &&
          !candidates.some(([, attempt]) => baselineIndependent(attempt)) &&
          games.length !== 2,
        pendingDomains: requiredDomains.filter(
          (domain) =>
            !candidates.some(([, attempt]) => domainOf(attempt) === domain),
        ),
        kind:
          previousDomainEvidence &&
          laterDay(failureAt, previousDomainEvidence.completedAt)
            ? "retention"
            : "confirmation",
        stage: !remedial
          ? "remediation"
          : !resolution
            ? "assessment"
            : "resolved",
        remediationId: remedial?.id || null,
        remediationOrdinal: remedial?.ordinal || null,
        resolutionMethod: resolution
          ? useGames
            ? "practical"
            : "assessment"
          : null,
        resolutionOrdinal: resolution?.completedOrdinal || null,
        baselineResolutionOrdinal:
          resolution && !requiredDomain
            ? useGames
              ? games[1].completedOrdinal
              : assessments.find(([, attempt]) =>
                  baselineIndependent(attempt),
                )?.[1].completedOrdinal || null
            : null,
        resolvedAt: resolution?.completedAt || null,
        domainResolutionEvidence: (useGames ? domainAssessments : assessments)
          .filter(([, attempt]) => domainOf(attempt))
          .map(([attemptId, attempt]) => ({
            attemptId,
            problemId: attempt.problemId,
            assessmentDomain: domainOf(attempt),
            completedOrdinal: attempt.completedOrdinal,
            completedAt: attempt.completedAt,
          })),
        resolutionEvidence: useGames
          ? games.map(({ recordId, ply, conditionId }) => ({
              recordId,
              ply,
              conditionId,
            }))
          : assessments.length
            ? assessments.map(([attemptId, attempt]) => ({
                attemptId,
                problemId: attempt.problemId,
                assessmentDomain: domainOf(attempt),
              }))
            : [],
      };
    });
}

export function unitStatus(progress, unitId) {
  const p = createPathProgress(progress);
  const rows = Object.values(p.attempts)
    .filter((a) => a.unitId === unitId)
    .sort((a, b) => a.ordinal - b.ordinal);
  const qualifying = rows
    .filter(independent)
    .sort((a, b) => a.completedOrdinal - b.completedOrdinal);
  const baselineQualifying = qualifying.filter(baselineIndependent);
  const requiredDomains = requiredAssessmentDomains[unitId] || [];
  const domainInitialEvidence = requiredDomains
    .map((domain) => qualifying.find((attempt) => domainOf(attempt) === domain))
    .filter(Boolean);
  const families = new Set(),
    branches = new Set(),
    firstEvidence = [];
  let initial = null;
  for (const row of baselineQualifying) {
    families.add(row.family);
    branches.add(row.branchId);
    firstEvidence.push(row);
    if (
      families.size >= initialFamilyTarget &&
      branches.size >= initialFamilyTarget &&
      (unitId !== "priority" ||
        ["priority/own-win-first", "priority/prevent-immediate-loss"].every(
          (family) => families.has(family),
        ))
    ) {
      initial = row;
      break;
    }
  }
  const practicalEvidence = practicalConfirmations(p, unitId);
  const practicalInitialEvidence = practicalPair(practicalEvidence, unitId);
  const practicalInitial = practicalInitialEvidence.at(-1) || null;
  const initialMethod =
    practicalInitial &&
    (!initial || practicalInitial.completedOrdinal < initial.completedOrdinal)
      ? "practical"
      : initial
        ? "assessment"
        : null;
  if (initialMethod === "practical") initial = practicalInitial;
  const initialFingerprints =
    initialMethod === "practical"
      ? practicalInitialEvidence.map((e) => e.fingerprint)
      : firstEvidence.map((e) => e.fingerprint);
  const initialDay = date(initial?.completedAt);
  const assessmentRetention = initialDay
    ? baselineQualifying.find(
        (a) =>
          a.ordinal > initial.completedOrdinal &&
          a.completedOrdinal > initial.completedOrdinal &&
          laterDay(a.completedAt, initial.completedAt) &&
          !initialFingerprints.includes(a.fingerprint),
      )
    : null;
  const practicalRetention = initialDay
    ? practicalEvidence.find(
        (e) =>
          e.ordinal > initial.completedOrdinal &&
          laterDay(e.completedAt, initial.completedAt) &&
          !initialFingerprints.includes(e.fingerprint),
      )
    : null;
  const historicalRetentionMethod =
    practicalRetention &&
    (!assessmentRetention ||
      practicalRetention.completedOrdinal <
        assessmentRetention.completedOrdinal)
      ? "practical"
      : assessmentRetention
        ? "assessment"
        : null;
  const historicalRetention =
    historicalRetentionMethod === "practical"
      ? practicalRetention
      : assessmentRetention;
  const assessmentReviews = assessmentReviewStates(
    p,
    unitId,
    initial,
    practicalEvidence,
  );
  const assessmentReview =
    assessmentReviews.find((review) => review.stage !== "resolved") ||
    [...assessmentReviews]
      .sort((a, b) => a.resolutionOrdinal - b.resolutionOrdinal)
      .at(-1) ||
    null;
  const assessmentReviewPending = assessmentReviews.some(
    (review) => review.stage !== "resolved",
  );
  const baselineReviews = assessmentReviews.filter(
    (review) => !review.requiredDomain,
  );
  const baselineReview =
    baselineReviews.find((review) => review.stage !== "resolved") ||
    [...baselineReviews]
      .sort((a, b) => a.resolutionOrdinal - b.resolutionOrdinal)
      .at(-1);
  const retentionFloor =
    baselineReview?.baselineResolutionOrdinal ||
    baselineReview?.resolutionOrdinal ||
    initial?.completedOrdinal ||
    0;
  const currentAssessmentRetention =
    initialDay && !baselineReviews.some((review) => review.stage !== "resolved")
      ? baselineQualifying.find(
          (a) =>
            matchesCondition(a, baselineReview?.requiredCondition) &&
            a.completedOrdinal >= retentionFloor &&
            a.ordinal > initial.completedOrdinal &&
            laterDay(a.completedAt, initial.completedAt) &&
            !initialFingerprints.includes(a.fingerprint),
        )
      : null;
  const currentPracticalRetention =
    initialDay && !baselineReviews.some((review) => review.stage !== "resolved")
      ? practicalEvidence.find(
          (e) =>
            (!baselineReview?.requiredCondition ||
              e.conditionId === baselineReview.requiredCondition) &&
            e.completedOrdinal >= retentionFloor &&
            e.ordinal > initial.completedOrdinal &&
            laterDay(e.completedAt, initial.completedAt) &&
            !initialFingerprints.includes(e.fingerprint),
        )
      : null;
  const baselineRetentionMethod =
    currentPracticalRetention &&
    (!currentAssessmentRetention ||
      currentPracticalRetention.completedOrdinal <
        currentAssessmentRetention.completedOrdinal)
      ? "practical"
      : currentAssessmentRetention
        ? "assessment"
        : null;
  const baselineRetention =
    baselineRetentionMethod === "practical"
      ? currentPracticalRetention
      : currentAssessmentRetention;
  const reviewFindings = reviewStages(p, unitId);
  const reviewPending = reviewFindings.filter((finding) =>
    ["recovery", "assessment"].includes(finding.stage),
  ).length;
  const practicalPending = reviewFindings.filter(
    (finding) => finding.stage === "practical",
  ).length;
  const coverageInitial =
    initial && domainInitialEvidence.length === requiredDomains.length
      ? [initial, ...domainInitialEvidence]
          .sort((a, b) => a.completedOrdinal - b.completedOrdinal)
          .at(-1)
      : null;
  const confirmedDomains = domainInitialEvidence.map(domainOf);
  const pendingDomains = requiredDomains.filter(
    (domain) =>
      !confirmedDomains.includes(domain) ||
      assessmentReviews.some(
        (review) =>
          review.stage !== "resolved" && review.pendingDomains.includes(domain),
      ) ||
      reviewFindings.some(
        (finding) =>
          ["recovery", "assessment"].includes(finding.stage) &&
          finding.pendingDomains?.includes(domain),
      ),
  );
  const domainRetentionEvidence = coverageInitial
    ? requiredDomains
        .map((domain) => {
          const domainReviewFloor = Math.max(
            0,
            ...assessmentReviews
              .filter((review) => review.requiredDomains.includes(domain))
              .map(
                (review) =>
                  review.domainResolutionEvidence.find(
                    (evidence) => evidence.assessmentDomain === domain,
                  )?.completedOrdinal || review.failureOrdinal,
              ),
          );
          return qualifying.find(
            (attempt) =>
              domainOf(attempt) === domain &&
              attempt.ordinal > coverageInitial.completedOrdinal &&
              attempt.completedOrdinal >= domainReviewFloor &&
              laterDay(attempt.completedAt, coverageInitial.completedAt),
          );
        })
        .filter(Boolean)
    : [];
  const retainedDomains = domainRetentionEvidence.map(domainOf);
  const currentConfirmed =
    !!coverageInitial && !assessmentReviewPending && !reviewPending;
  const retention =
    (!requiredDomains.length || currentConfirmed) &&
    baselineRetention &&
    domainRetentionEvidence.length === requiredDomains.length
      ? [baselineRetention, ...domainRetentionEvidence]
          .sort((a, b) => a.completedOrdinal - b.completedOrdinal)
          .at(-1)
      : null;
  const retentionMethod = retention ? baselineRetentionMethod : null;
  const latestTransfer = Math.max(
    0,
    ...assessmentReviews.map(
      (review) => review.resolutionOrdinal || review.failureOrdinal,
    ),
    ...reviewFindings.map(
      (finding) => finding.assessmentOrdinal || finding.ordinal,
    ),
  );
  const practical = Object.values(p.practicalResults)
    .filter((r) => r.eligibleFullGame)
    .flatMap((r) =>
      (Array.isArray(r.source.opportunities) ? r.source.opportunities : [])
        .filter((o) => o?.unitId === unitId && !o.retracted)
        .map((o) => ({ ...o, recordId: r.source.id, ordinal: r.ordinal })),
    );
  const currentSuccesses = practicalEvidence.filter(
    (o) => o.ordinal > latestTransfer,
  );
  const practicalObserved =
    !assessmentReviewPending &&
    !reviewPending &&
    !practicalPending &&
    currentSuccesses.length > 0;
  const practiced = rows.some((a) => a.status === "solved");
  const viewed = p.exposures.some((e) => e.unitId === unitId);
  const countedFamilies = baselineQualifying
    .map((a) => a.family)
    .filter(
      (family) =>
        unitId !== "priority" ||
        ["priority/own-win-first", "priority/prevent-immediate-loss"].includes(
          family,
        ),
    );
  const assessmentCount = Math.min(
    initialFamilyTarget,
    new Set(countedFamilies).size,
  );
  const practicalCount =
    practicalInitialEvidence.length || (practicalEvidence.length ? 1 : 0);
  const count = Math.max(assessmentCount, practicalCount);
  return {
    unitId,
    viewed,
    practiced,
    initialConfirmed: !!initial,
    baselineConfirmed: !!initial,
    baselineRetained: !!baselineRetention,
    retained: !!retention,
    initialMethod,
    retentionMethod,
    currentConfirmed,
    coverageInitialAt: coverageInitial?.completedAt || null,
    requiredAssessmentDomains: [...requiredDomains],
    confirmedAssessmentDomains: confirmedDomains.filter(
      (domain) => !pendingDomains.includes(domain),
    ),
    pendingAssessmentDomains: pendingDomains,
    retainedAssessmentDomains: retainedDomains,
    pendingRetentionDomains: requiredDomains.filter(
      (domain) => !retainedDomains.includes(domain),
    ),
    domainInitialEvidence: domainInitialEvidence.map((attempt) => ({
      problemId: attempt.problemId,
      assessmentDomain: domainOf(attempt),
      completedAt: attempt.completedAt,
    })),
    domainRetentionEvidence: domainRetentionEvidence.map((attempt) => ({
      problemId: attempt.problemId,
      assessmentDomain: domainOf(attempt),
      completedAt: attempt.completedAt,
    })),
    historicalRetained: !!historicalRetention,
    historicalRetentionAt: historicalRetention?.completedAt || null,
    historicalRetentionMethod,
    assessmentReview,
    assessmentReviews,
    assessmentReviewPending,
    practicalObserved,
    initialCount: count,
    initialTarget: initialFamilyTarget,
    initialAssessmentCount: assessmentCount,
    initialPracticalCount: practicalCount,
    practicalConditionsRequired: practicalConditions[unitId] || [],
    practicalConditionsObserved: [
      ...new Set(practicalEvidence.map((event) => event.conditionId)),
    ],
    branchCount: new Set(baselineQualifying.map((a) => a.branchId)).size,
    initialAt: initial?.completedAt || null,
    retentionAt: retention?.completedAt || null,
    initialEvidence:
      initialMethod === "assessment"
        ? firstEvidence.map((a) => a.problemId)
        : [],
    initialPracticalEvidence:
      initialMethod === "practical"
        ? practicalInitialEvidence.map(({ recordId, ply, conditionId }) => ({
            recordId,
            ply,
            conditionId,
          }))
        : [],
    retentionEvidence:
      retentionMethod === "assessment" ? baselineRetention.problemId : null,
    retentionPracticalEvidence:
      retentionMethod === "practical"
        ? {
            recordId: baselineRetention.recordId,
            ply: baselineRetention.ply,
            conditionId: baselineRetention.conditionId,
          }
        : null,
    opportunities: practical.length,
    practicalSuccesses: practicalObserved
      ? new Set(currentSuccesses.map((event) => event.recordId)).size
      : 0,
    historicalPracticalSuccesses: new Set(
      practicalEvidence.map((event) => event.recordId),
    ).size,
    reviewFindings,
    reviewPending,
    practicalPending,
    needsReview:
      assessmentReviewPending ||
      !!reviewPending ||
      (rows.some(
        (a) =>
          a.status === "feedback" ||
          a.hints ||
          a.guidanceSeen ||
          a.mistakes ||
          a.unknownSelections ||
          a.retries ||
          a.exposureSeen,
      ) &&
        !initial),
    label: assessmentReviewPending
      ? assessmentReview.kind === "retention"
        ? "保持の復習"
        : "確認の復習"
      : reviewPending
        ? "実戦の復習"
        : practicalPending
          ? "実戦待ち"
          : initial && pendingDomains.length
            ? `追加確認 ${requiredDomains.length - pendingDomains.length}/${requiredDomains.length}`
            : retention
              ? practicalObserved
                ? "実戦遂行"
                : "実戦待ち"
              : initial
                ? "保持待ち"
                : count
                  ? `確認 ${count}/${initialFamilyTarget}`
                  : practiced
                    ? "練習済"
                    : viewed
                      ? "閲覧済"
                      : "未着手",
  };
}

const reserveProblem = (problem) =>
  !!trustedAssessmentDomain(problem) &&
  curriculumById.get(problem.problemId || problem.id)?.supply === "reserve";
const supplyCounts = (problems) => {
  const reserve = problems.filter(reserveProblem).length;
  return {
    authored: problems.length - reserve,
    reserve,
    total: problems.length,
  };
};

function assessmentSupply(
  progress,
  unitId,
  bank,
  { phase = "initial", at = null } = {},
) {
  const p = createPathProgress(progress),
    status = unitStatus(p, unitId);
  const initialReady = status.requiredAssessmentDomains.length
    ? status.currentConfirmed
    : status.initialConfirmed;
  const waitingReason =
    phase !== "retention"
      ? null
      : !initialReady
        ? "initial-incomplete"
        : !laterDay(at, status.coverageInitialAt || status.initialAt)
          ? "retention-not-due"
          : null;
  const successful = new Set(
    Object.values(p.attempts)
      .filter((a) => a.unitId === unitId && independent(a))
      .map((a) => a.family),
  );
  const review = status.assessmentReviewPending
    ? status.assessmentReview
    : status.reviewFindings.find((finding) => finding.stage === "assessment");
  const requiredCondition = review?.requiredCondition;
  const pendingDomains =
    review?.pendingDomains ||
    (phase === "retention"
      ? status.pendingRetentionDomains
      : status.pendingAssessmentDomains);
  const needsBaseline = review
    ? review.baselinePending
    : phase === "retention"
      ? !status.baselineRetained
      : !status.baselineConfirmed;
  const seenCandidates = new Set();
  const available = (Array.isArray(bank) ? bank : [])
    .filter(
      (problem) =>
        problem.role === "assessment" &&
        !assessmentExclusion(problem.problemId || problem.id) &&
        (problem.unitId || problem.skillId) === unitId &&
        matchesCondition(problem, requiredCondition) &&
        (!domainProblem(problem) || !!trustedAssessmentDomain(problem)) &&
        (!problem.assessmentDomain || !!trustedAssessmentDomain(problem)) &&
        (problem.supply !== "reserve" ||
          curriculumById.has(problem.problemId || problem.id)) &&
        !curriculumById.get(problem.problemId || problem.id)
          ?.teachesAssessmentDomain &&
        !wasSeen(p, identity(problem)),
    )
    .map((problem) =>
      trustedAssessmentDomain(problem)
        ? curriculumById.get(problem.problemId || problem.id)
        : problem,
    )
    .filter((problem) => {
      const key = identity(problem);
      const structure = key.fingerprint || key.problemId;
      if (seenCandidates.has(structure)) return false;
      seenCandidates.add(structure);
      return true;
    });
  const candidates = available.filter(
    (problem) =>
      !status.requiredAssessmentDomains.length ||
      (needsBaseline
        ? !domainProblem(problem)
        : pendingDomains.includes(trustedAssessmentDomain(problem))),
  );
  candidates.sort(
    (a, b) =>
      Number(reserveProblem(a)) - Number(reserveProblem(b)) ||
      Number(successful.has(a.family)) - Number(successful.has(b.family)),
  );
  const domains = status.requiredAssessmentDomains.map((assessmentDomain) => ({
    assessmentDomain,
    pending: pendingDomains.includes(assessmentDomain),
    remaining: supplyCounts(
      available.filter(
        (problem) => trustedAssessmentDomain(problem) === assessmentDomain,
      ),
    ),
  }));
  const exhaustedDomains = domains
    .filter((domain) => domain.pending && !domain.remaining.total)
    .map((domain) => domain.assessmentDomain);
  const complete =
    phase === "retention" ? status.retained : status.currentConfirmed;
  const state = complete
    ? "complete"
    : waitingReason
      ? "waiting"
      : candidates.length
        ? "ready"
        : "exhausted";
  const selected = waitingReason ? null : candidates[0] || null;
  return {
    selected,
    availability: {
      unitId,
      phase: phase === "retention" ? phase : review ? "reconfirmation" : phase,
      state,
      reason:
        state === "waiting"
          ? waitingReason
          : state === "exhausted"
            ? exhaustedDomains.length
              ? "domain-exhausted"
              : "baseline-exhausted"
            : null,
      problemId:
        state === "ready" ? selected?.id || selected?.problemId || null : null,
      assessmentDomain:
        state === "ready"
          ? trustedAssessmentDomain(selected)
          : exhaustedDomains[0] ||
            (!needsBaseline ? pendingDomains[0] : null) ||
            null,
      needsBaseline,
      pendingDomains: [...pendingDomains],
      exhaustedDomains,
      remaining: supplyCounts(candidates),
      domains,
    },
  };
}

export function assessmentAvailability(progress, unitId, bank, options = {}) {
  return assessmentSupply(progress, unitId, bank, options).availability;
}

export function selectAssessment(progress, unitId, bank, options = {}) {
  return assessmentSupply(progress, unitId, bank, options).selected;
}

function domainUnavailable(availability) {
  if (
    availability.state !== "exhausted" ||
    availability.reason !== "domain-exhausted"
  )
    return null;
  return {
    kind: "assessment-unavailable",
    unitId: availability.unitId,
    assessmentDomain: availability.assessmentDomain,
    pendingDomains: availability.pendingDomains,
    exhaustedDomains: availability.exhaustedDomains,
    needsBaseline: availability.needsBaseline,
    phase: availability.phase,
    reason: "domain-exhausted",
    label: "復習へ",
  };
}

export function nextLearningStep(
  progress,
  { units = [], assessmentProblems = [], unitId = null, at = null } = {},
) {
  const ledger = createPathProgress(progress);
  const byId = new Map(units.map((unit) => [unit.id, unit]));
  const requested = byId.get(unitId);
  const pendingAssessment = (requested ? [requested] : units)
    .map((unit) => unitStatus(ledger, unit.id))
    .find((status) => status.assessmentReviewPending);
  const pendingReview = reviewStages(ledger, requested?.id).find(
    (finding) =>
      byId.has(finding.unitId) &&
      ["recovery", "assessment"].includes(finding.stage),
  );
  if (pendingReview?.stage === "recovery")
    return {
      kind: "review",
      unitId: pendingReview.unitId,
      recordId: pendingReview.recordId,
      ply: pendingReview.ply,
      reason: "review-recovery",
      label: "実戦の復習",
    };
  const pending = units.filter(
    (unit) => !unitStatus(progress, unit.id).currentConfirmed,
  );
  if (!pending.length && !pendingReview && !pendingAssessment)
    return {
      kind: "journey",
      unitId: units.at(-1)?.id || null,
      reason: "initial-complete",
      label: "課題対局",
    };
  let target = pendingAssessment
    ? byId.get(pendingAssessment.unitId)
    : pendingReview
      ? byId.get(pendingReview.unitId)
      : requested || pending[0];
  const visited = new Set();
  function prerequisite(unit) {
    if (visited.has(unit.id)) return unit;
    visited.add(unit.id);
    const ids = unit.prerequisites || [];
    const missing = ids
      .map((id) => byId.get(id))
      .find((item) => item && !unitStatus(progress, item.id).currentConfirmed);
    return missing ? prerequisite(missing) : unit;
  }
  if (!pendingReview && !pendingAssessment) {
    target = prerequisite(target);
    if (unitStatus(progress, target.id).currentConfirmed)
      target = prerequisite(pending[0]);
  }
  const status = unitStatus(progress, target.id);
  const { selected: problem, availability } = assessmentSupply(
    progress,
    target.id,
    assessmentProblems,
    {
      at,
    },
  );
  const rows = Object.values(ledger.attempts).filter(
    (a) => a.unitId === target.id,
  );
  if (status.assessmentReviewPending) {
    if (status.assessmentReview.stage === "remediation") {
      const completedIds = new Set(
        rows
          .filter((a) => a.role === "lesson" && a.status === "solved")
          .map((a) => a.problemId),
      );
      const lesson = remediationLesson(
        target,
        completedIds,
        status.assessmentReview.requiredDomain,
      );
      return lesson
        ? {
            kind: "lesson",
            unitId: target.id,
            problemId: lesson,
            reason: "confirmation-remediation",
            label: "練習する",
          }
        : {
            kind: "journey",
            unitId: target.id,
            reason: "confirmation-remediation",
            label: "課題対局",
          };
    }
    return problem
      ? {
          kind: "assessment",
          unitId: target.id,
          problemId: problem.id,
          reason: "reconfirmation",
          label: "新しい局面で確認",
        }
      : domainUnavailable(availability) || {
          kind: "journey",
          unitId: target.id,
          reason: "assessment-exhausted",
          label: "課題対局",
        };
  }
  const failures = rows.filter(failedAssessment);
  const lastFailure = Math.max(
    0,
    ...failures.map(
      (a) => a.lastFailureOrdinal || a.completedOrdinal || a.ordinal,
    ),
  );
  const completedLessons = rows.filter(
    (a) => a.role === "lesson" && a.status === "solved",
  );
  const requiredRemediationDomain = domainOf(
    failures.find(
      (attempt) =>
        (attempt.lastFailureOrdinal ||
          attempt.completedOrdinal ||
          attempt.ordinal) === lastFailure,
    ) || {},
  );
  const lessonAfterFailure = completedLessons.some(
    (a) =>
      a.completedOrdinal > lastFailure &&
      teachesRequiredDomain(a, requiredRemediationDomain, true),
  );
  const journeyAfterFailure = Object.values(ledger.practicalResults).some(
    (record) => {
      const source = record.source;
      if (
        requiredRemediationDomain ||
        !(record.completedOrdinal > lastFailure) ||
        source.completed !== true ||
        !(
          source.role === "journey" ||
          source.role === "recovery" ||
          source.trackId
        )
      )
        return false;
      return (
        source.unitId === target.id ||
        source.unitIds?.includes(target.id) ||
        (Array.isArray(source.opportunities) &&
          source.opportunities.some(
            (opportunity) =>
              opportunity?.unitId === target.id &&
              !opportunity.retracted &&
              (typeof opportunity.success === "boolean" ||
                ["achieved", "missed"].includes(opportunity.outcome)),
          )) ||
        (Array.isArray(source.objectives) &&
          source.objectives.some(
            (objective) =>
              objective?.unitId === target.id &&
              ["achieved", "observed"].includes(objective.status),
          ))
      );
    },
  );
  if (lastFailure && !lessonAfterFailure && !journeyAfterFailure) {
    const completedIds = new Set(completedLessons.map((a) => a.problemId));
    const lesson = remediationLesson(
      target,
      completedIds,
      requiredRemediationDomain,
    );
    if (lesson)
      return {
        kind: "lesson",
        unitId: target.id,
        problemId: lesson,
        reason: "remediation",
        label: "練習する",
      };
    return {
      kind: "journey",
      unitId: target.id,
      reason: "remediation",
      label: "課題対局",
    };
  }
  if (problem)
    return {
      kind: "assessment",
      unitId: target.id,
      problemId: problem.id,
      reason: pendingReview
        ? "review-transfer"
        : status.baselineConfirmed && status.pendingAssessmentDomains.length
          ? "coverage"
          : status.initialCount || lastFailure
            ? "initial"
            : "diagnostic",
      label: pendingReview
        ? "別の局面で確認"
        : status.baselineConfirmed && status.pendingAssessmentDomains.length
          ? "追加確認"
          : "初回確認",
      ...(trustedAssessmentDomain(problem)
        ? { assessmentDomain: trustedAssessmentDomain(problem) }
        : {}),
    };
  return (
    domainUnavailable(availability) || {
      kind: "journey",
      unitId: target.id,
      reason: "assessment-exhausted",
      label: "課題対局",
    }
  );
}

function fullGameCheck(record) {
  const failures = [];
  if (!["practice", "exam"].includes(record.role)) failures.push("role");
  if (
    record.assisted !== false ||
    integer(record.retries) ||
    integer(record.hints) ||
    record.guidanceSeen ||
    record.assistance?.length
  )
    failures.push("assisted");
  if (
    !boardValid(record.startBoard) ||
    record.startBoard.some(Boolean) ||
    integer(record.startPly)
  )
    failures.push("start-position");
  const settings = record.settings,
    start = record.startSettings;
  const keys = ["rule", "level", "strength", "timeMs"];
  if (
    !settings ||
    !start ||
    !keys.every(
      (key) => settings[key] !== undefined && settings[key] === start[key],
    ) ||
    settings.rule !== "freestyle15" ||
    record.rule !== "freestyle15" ||
    settings.level !== record.level
  )
    failures.push("settings");
  if (
    !Array.isArray(record.moves) ||
    !record.moves.length ||
    record.moves.length > 225
  )
    failures.push("moves");
  const board = Array(225).fill(0);
  for (
    let ply = 0;
    ply < (Array.isArray(record.moves) ? record.moves.length : 0);
    ply++
  ) {
    const move = record.moves[ply],
      i = typeof move === "number" ? move : move?.i;
    if (
      !Number.isInteger(i) ||
      i < 0 ||
      i >= 225 ||
      board[i] ||
      winner(board) ||
      (typeof move === "object" &&
        move.side !== undefined &&
        move.side !== (ply % 2) + 1)
    ) {
      failures.push("invalid-replay");
      break;
    }
    board[i] = (ply % 2) + 1;
  }
  const win = winner(board),
    actual =
      win === 1
        ? "win"
        : win === 2
          ? "loss"
          : board.every(Boolean)
            ? "draw"
            : "unfinished";
  if (!["win", "loss", "draw"].includes(actual) || actual !== record.result)
    failures.push("unfinished-or-result");
  return { failures: [...new Set(failures)], actual };
}

export function recordPracticalResult(progress, record) {
  const next = createPathProgress(progress),
    id = text(record?.id || record?.attemptId);
  if (!id) return next;
  const source = clone({ ...record, id, role: record.role || "practice" });
  const prior = next.practicalResults[id];
  if (prior) {
    source.role = prior.source.role;
    source.seriesId = prior.source.seriesId || null;
    if (prior.completedOrdinal) {
      source.at = prior.source.at;
      if (prior.source.finished !== undefined)
        source.finished = prior.source.finished;
    }
  }
  // An assisted snapshot must never become an unassisted result later.
  if (
    prior &&
    (prior.source.assisted ||
      prior.source.guidanceSeen ||
      prior.source.hints ||
      prior.source.retries ||
      prior.source.assistance?.length)
  )
    source.assisted = true;
  if (prior?.source.startSettings)
    source.startSettings = clone(prior.source.startSettings);
  if (prior?.source.startBoard)
    source.startBoard = clone(prior.source.startBoard);
  if (prior?.source.sourceReview)
    source.sourceReview = clone(prior.source.sourceReview);
  if (Number.isInteger(prior?.source.startPly))
    source.startPly = prior.source.startPly;
  if (
    prior?.eligibleFullGame &&
    ["unfinished", null, undefined].includes(source.result)
  )
    return next;
  const check = fullGameCheck(source);
  const eligibleFullGame = !check.failures.length;
  const eligibleExam = examEligible(source, eligibleFullGame);
  const ordinal = prior?.ordinal || next.nextOrdinal++;
  const finished =
    source.completed === true ||
    ["win", "loss", "draw", "resign"].includes(source.result);
  const completedOrdinal =
    prior?.completedOrdinal || (finished ? next.nextOrdinal++ : null);
  const completedAt = prior?.completedOrdinal
    ? prior.completedAt
    : finished
      ? completionTimestamp(source, true)
      : "";
  next.practicalResults[id] = {
    ordinal,
    completedOrdinal,
    completedAt,
    source,
    eligibleFullGame,
    eligibleExam,
    exclusionReasons: check.failures,
    actualResult: check.actual,
  };
  return next;
}

function examEligible(source, eligibleFullGame) {
  return (
    eligibleFullGame &&
    source.role === "exam" &&
    !!text(source.seriesId) &&
    source.level === "max" &&
    source.settings.strength === 100 &&
    source.settings.timeMs === 8000
  );
}

export function getExamStatus(progress, { seriesId = null } = {}) {
  const records = Object.values(
    createPathProgress(progress).practicalResults,
  ).sort((a, b) => a.ordinal - b.ordinal);
  const selectedSeries =
    seriesId ||
    records.filter((r) => r.source.role === "exam" && r.source.seriesId).at(-1)
      ?.source.seriesId ||
    null;
  const scoped = records.filter(
    (r) => r.source.role === "exam" && r.source.seriesId === selectedSeries,
  );
  const games = scoped.filter((r) => r.eligibleExam),
    recent = games.slice(-examGameTarget);
  const wins = recent.filter((r) => r.actualResult === "win").length;
  return {
    seriesId: selectedSeries,
    kind: "observed-performance",
    label: "観測成績",
    target: examGameTarget,
    games: games.length,
    wins: games.filter((r) => r.actualResult === "win").length,
    losses: games.filter((r) => r.actualResult === "loss").length,
    draws: games.filter((r) => r.actualResult === "draw").length,
    recentGames: recent.length,
    recentWins: wins,
    attempts: scoped.length,
    assisted: scoped.filter((r) => r.exclusionReasons.includes("assisted"))
      .length,
    unfinished: scoped.filter(
      (r) => r.source.result === "unfinished" || !r.source.result,
    ).length,
    resigned: scoped.filter((r) => r.source.result === "resign").length,
    invalid: scoped.filter(
      (r) =>
        !r.eligibleExam &&
        !r.exclusionReasons.includes("assisted") &&
        !["resign", "unfinished", null, undefined].includes(r.source.result),
    ).length,
    challengeCompleted:
      scoped.length === examGameTarget &&
      games.length === examGameTarget &&
      wins === examGameTarget,
    excludedGames: scoped.filter((r) => !r.eligibleExam).length,
    recordIds: games.map((r) => r.source.id),
  };
}
