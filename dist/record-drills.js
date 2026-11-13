import { boardFrom, coord, validateRecord, winner, winningLine, winningMoves } from "./game.js";
import { scanRecord, judgeReviewMove } from "./causal-review.js?v=learning-v3-20261111";
import { provePatternMove, recognizePatterns } from "./review-patterns.js?v=patterns-20261111-v2";
import { tacticalHintStages } from "./learning-hints.js";

export const RECORD_DRILL_VERSION = 7;
export const RECORD_DRILL_WORKER_VERSION = "record-drills-v7";
const LIMITS = { maxPly: 9, maxNodes: 450, quietDepth: 2 };
const LABELS = { own: "自分の実戦", library: "収録棋譜", import: "取込棋譜" };
const MAX_EVENTS = 256;
const clone = (value) => JSON.parse(JSON.stringify(value));
const legal = (b, i) => Number.isInteger(i) && i >= 0 && i < 225 && b[i] === 0;
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const bounded = (value, fallback, min, max) => Number.isInteger(value) ? Math.max(min, Math.min(max, value)) : fallback;
const canonical = (value) => Array.isArray(value) ? value.map(canonical) : value && typeof value === "object"
  ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
// Stable content checksum, not a signature or an authority for imported questions.
function hash(value) {
  const s = JSON.stringify(canonical(value));
  let a = 0x811c9dc5, b = 0x9e3779b9;
  for (let i = 0; i < s.length; i++) {
    a = Math.imul(a ^ s.charCodeAt(i), 0x01000193);
    b = Math.imul(b ^ s.charCodeAt(i), 0x85ebca6b);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/** Identity only: displayed boards are never transformed, translated, or padded. */
export function recordDrillFingerprint(board) {
  if (!Array.isArray(board) || board.length !== 225 || board.some((v) => ![0, 1, 2].includes(v))) return "";
  const stones = board.flatMap((side, i) => side ? [[i % 15, Math.floor(i / 15), side]] : []);
  if (!stones.length) return "board:empty";
  const forms = [];
  for (let mirror = 0; mirror < 2; mirror++) for (let turn = 0; turn < 4; turn++) {
    const points = stones.map(([px, py, side]) => {
      let x = mirror ? -px : px, y = py;
      for (let t = 0; t < turn; t++) [x, y] = [-y, x];
      return [x, y, side];
    });
    const minX = Math.min(...points.map((p) => p[0])), minY = Math.min(...points.map((p) => p[1]));
    forms.push(points.map(([x, y, side]) => `${x - minX},${y - minY},${side}`).sort().join(";"));
  }
  return `board:${forms.sort()[0]}`;
}

function originalRecord(record) {
  if (!record || (record.startPly !== undefined && record.startPly !== 0) || record.sourceLessonId ||
      ["lesson", "snapshot", "authored-snapshot", "problem"].includes(record.origin)) {
    throw Error("実戦の初手から続く棋譜が必要です");
  }
  if (record.moves?.some((m, j) => typeof m === "object" &&
      ((m.side !== undefined && m.side !== j % 2 + 1) || (m.color !== undefined && m.color !== j % 2 + 1)))) {
    throw Error("棋譜の手番が不正です");
  }
  return validateRecord({ ...record, moves: record.moves?.map((m) => typeof m === "number" ? m : { ...m }) });
}
export function recordSourceHash(record) {
  const valid = originalRecord(record);
  return hash({ rule: "freestyle15", moves: valid.moves.map((m) => m.i) });
}
function compactProof(p) {
  if (!p) return null;
  const out = {};
  for (const key of ["status", "attacker", "line", "plies", "scope", "branches", "preferred", "pattern", "winningPoints", "kind"])
    if (p[key] !== undefined) out[key] = clone(p[key]);
  return out;
}
function compactMoment(m) {
  return {
    kind: m.kind, actual: m.actual, alternatives: [...m.alternatives], scope: m.scope,
    evidence: compactProof(m.evidence), priorWinningProof: compactProof(m.priorWinningProof),
    alternativeDetails: (m.alternativeDetails || []).map((d) => ({
      move: d.move, scope: d.scope, proof: compactProof(d.proof),
    })),
    patternType: m.patternType || null, skillId: m.skillId || null,
    explanation: m.coach?.text || m.text || "",
  };
}
const materialHash = (q) => hash(Object.fromEntries(Object.entries(q).filter(([key]) => key !== "integrity")));
function momentFor(q, board = q.before) { return { ...q.moment, before: board }; }
function qError() { throw Error("実戦問題の出典または局面が一致しません"); }
function assertQuestion(q, record) {
  if (!q || q.version !== RECORD_DRILL_VERSION || q.integrity !== materialHash(q) || q.color !== 1 ||
      !Number.isInteger(q.ply) || q.ply % 2 !== 1 || q.ply < 1 || !LABELS[q.source?.kind] ||
      !Array.isArray(q.source.moves) || q.source.moves.length > 225 ||
      !Array.isArray(q.prefix) || !Array.isArray(q.before) || q.before.length !== 225 ||
      !q.moment?.alternatives?.length) qError();
  const valid = originalRecord({ rule: "freestyle15", moves: q.source.moves });
  if (q.ply > valid.moves.length || q.source.recordHash !== recordSourceHash(valid) ||
      !equal(q.prefix, q.source.moves.slice(0, q.ply - 1)) ||
      !equal(q.before, Array.from(boardFrom(q.prefix))) || winner(q.before) ||
      q.moment.actual !== q.source.moves[q.ply - 1] || q.fingerprint !== recordDrillFingerprint(q.before) ||
      q.id !== `record-v7-${q.source.recordHash}-${q.ply}-${hash(q.before)}` ||
      q.moment.alternatives.some((p) => !legal(q.before, p))) qError();
  if (record && (recordSourceHash(record) !== q.source.recordHash ||
      !equal(originalRecord(record).moves.map((m) => m.i), q.source.moves))) qError();
  return q;
}
/** A checksum checks accidental corruption. Trust requires the original record or re-extraction. */
export function verifyRecordDrill(q, record) {
  try { assertQuestion(q, record); return true; } catch { return false; }
}

export async function extractRecordDrills(record, options = {}) {
  const valid = originalRecord(record);
  const kind = Object.hasOwn(LABELS, options.sourceKind) ? options.sourceKind : "own";
  const limits = {
    maxPly: bounded(options.proofLimits?.maxPly, 9, 1, 9),
    maxNodes: bounded(options.proofLimits?.maxNodes, 450, 0, 450),
    quietDepth: bounded(options.proofLimits?.quietDepth, 2, 0, 2),
  };
  const moments = await scanRecord(valid, { proofLimits: limits, onProgress: options.onProgress });
  const minStones = bounded(options.minStones, 14, 0, 224);
  const minProofPlies = bounded(options.minProofPlies, 3, 1, 9);
  const maxQuestions = bounded(options.maxQuestions, 4, 0, 12);
  const minPlyGap = bounded(options.minPlyGap, 6, 2, 225);
  const source = {
    kind, label: String(options.sourceLabel || LABELS[kind]).slice(0, 80),
    recordId: String(options.sourceId || valid.id || recordSourceHash(valid)).slice(0, 160),
    recordHash: recordSourceHash(valid), moves: valid.moves.map((m) => m.i),
    result: valid.result, level: valid.level,
  };
  const questions = [], seen = new Set(options.seenFingerprints || []);
  const exclusions = { density: 0, immediate: 0, shallow: 0, adjacent: 0, duplicate: 0, unverified: 0 };
  const candidates = [];
  for (const m of moments) {
    if (m.ply - 1 < minStones) { exclusions.density++; continue; }
    if (!options.includeImmediate && (winningMoves(Uint8Array.from(m.before), 1).length ||
        winningMoves(Uint8Array.from(m.before), 2).length || m.kind === "miss-win" || m.kind === "miss-block")) {
      exclusions.immediate++; continue;
    }
    const depth = Math.max(m.evidence?.plies || 0, m.priorWinningProof?.plies || 0,
      ...(m.alternativeDetails || []).map((d) => d.proof?.plies || 0));
    if (depth < minProofPlies && !(options.includeImmediate && ["miss-win", "miss-block"].includes(m.kind))) {
      exclusions.shallow++; continue;
    }
    const accepted = m.alternatives.filter((point) => judgeReviewMove(m, point).accepted);
    if (!accepted.length) { exclusions.unverified++; continue; }
    candidates.push({ m: { ...m, alternatives: accepted }, depth });
  }
  // Start of a decision sequence, not the final easy forced move. Mistakes first.
  const priority = (m) => m.kind === "pattern-play" ? 2 : m.kind === "winning-chance" ? 1 : 0;
  candidates.sort((a, b) => priority(a.m) - priority(b.m) || b.depth - a.depth || a.m.ply - b.m.ply);
  for (const { m, depth } of candidates) {
    if (questions.length >= maxQuestions) break;
    if (questions.some((q) => Math.abs(q.ply - m.ply) < minPlyGap ||
        (q.ply < m.ply && q.ply + q.proofPlies > m.ply) ||
        (m.ply < q.ply && m.ply + depth > q.ply))) { exclusions.adjacent++; continue; }
    const fingerprint = recordDrillFingerprint(m.before);
    if (seen.has(fingerprint)) { exclusions.duplicate++; continue; }
    seen.add(fingerprint);
    const q = {
      version: RECORD_DRILL_VERSION, id: `record-v7-${source.recordHash}-${m.ply}-${hash(m.before)}`,
      color: 1, source: clone(source), ply: m.ply, prefix: source.moves.slice(0, m.ply - 1),
      before: [...m.before], fingerprint, proofPlies: depth, proofLimits: limits,
      maxContinuationPlies: 9, moment: compactMoment(m),
    };
    q.integrity = materialHash(q);
    assertQuestion(q);
    questions.push(q);
  }
  questions.coverage = { ...moments.coverage, exclusions, extracted: questions.length, eligible: candidates.length };
  return questions;
}

function fresh(q, attemptId) {
  return {
    version: RECORD_DRILL_VERSION, questionId: q.id, sourceHash: q.source.recordHash,
    attemptId: String(attemptId || `${q.id}:attempt`).slice(0, 160),
    board: [...q.before], moves: [...q.prefix], prefixLength: q.prefix.length,
    status: "ready", scope: "unknown", result: null, last: q.prefix.at(-1) ?? null,
    hintStage: 0, answerShown: false, feedback: null, plan: null,
    feedbackFrames: [], explanationFrames: [],
    metrics: { assisted: false, hints: 0, answers: 0, errors: 0, retries: 0, exposures: 0, unknown: 0 },
    events: [], qualification: { fullGame: false, independentCurriculum: false },
  };
}
export function startRecordDrill(q, { attemptId } = {}) { assertQuestion(q); return fresh(q, attemptId); }
function checked(q, state) {
  assertQuestion(q);
  if (!state || state.version !== RECORD_DRILL_VERSION || state.questionId !== q.id ||
      state.sourceHash !== q.source.recordHash || !Array.isArray(state.events) || state.events.length >= MAX_EVENTS ||
      !equal(state.moves?.slice(0, q.prefix.length), q.prefix) ||
      !equal(state.board, Array.from(boardFrom(state.moves)))) throw Error("実戦問題の試行が不正です");
  return clone(state);
}
const actionable = (s) => s.status === "ready" || s.status === "continuing";
function finish(s, scope) {
  s.status = "completed"; s.scope = scope;
  s.result = scope === "line-prevented" ? "line-prevented" : "black-win";
  s.plan = null;
}
function currentGuide(q, s) { return s.moves.length === q.prefix.length ? q.moment.alternatives : [s.plan?.line?.[0]].filter(Number.isInteger); }
function proofFor(q, s, point) {
  const remaining = q.maxContinuationPlies - (s.moves.length - q.prefix.length);
  return provePatternMove(s.board, 1, point, { ...LIMITS, maxPly: Math.min(9, remaining), allowQuiet: true });
}
function feedbackFor(q, s, judged, point, proof) {
  const after = [...s.board]; after[point] = 1;
  const pattern = recognizePatterns(after, { last: point, before: s.board, sideToMove: 2 })
    .find((p) => p.color === 1 && p.cells.includes(point));
  if (judged.accepted && judged.scope === "line-prevented") {
    const reply = q.moment.evidence?.line?.[0];
    return { status: judged.status, accepted: true, scope: "line-prevented", title: "この勝ち筋を止めた",
      text: `${Number.isInteger(reply) ? `白${coord(reply)}からの攻め` : "白の攻め"}を続けさせない一手。勝敗はまだ決まっていない。`,
      explanation: judged.frames?.find((f) => f.text)?.text || q.moment.explanation };
  }
  if (judged.accepted) return {
    status: judged.status, accepted: true, scope: "forced-win", title: winningLine(after, point).length ? "五が完成" : "続けて打とう",
    text: winningLine(after, point).length ? "黒の五がつながった。" :
      `${pattern?.name ? `${pattern.name}を作った。` : "勝ちにつながる手。"}${Number.isInteger(proof?.line?.[1]) ? `白${coord(proof.line[1])}の応手から続けよう。` : ""}`,
  };
  const counterFrame = judged.frames?.find((f) => f.last !== null && f.board?.[f.last] === 2);
  return { status: judged.status, accepted: false, scope: judged.scope, title: judged.title,
    text: judged.status === "unknown" ? "この手の成否は未確認。誤答には数えない。" :
      (counterFrame ? `白${coord(counterFrame.last)}から反撃が続く。` : judged.text || "相手の勝ち筋が残る。"),
    explanation: judged.status === "refuted" ? (counterFrame?.text || judged.text || "") : "" };
}
export function playRecordDrill(q, state, point) {
  const s = checked(q, state);
  if (!actionable(s) || !legal(s.board, point)) return s;
  const initial = s.moves.length === q.prefix.length;
  let judged = judgeReviewMove(initial ? momentFor(q) : {
    before: s.board, kind: "pattern-play", alternatives: currentGuide(q, s),
  }, point);
  let proof = null;
  if (judged.accepted && judged.scope !== "line-prevented") {
    proof = proofFor(q, s, point);
    // Never turn a claimed win into an unconstrained ordinary CPU game.
    if (!proof) judged = { status: "unknown", accepted: false, scope: "unknown", title: "この先は未確認" };
  }
  s.events.push({ type: "play", point });
  s.metrics.exposures++;
  s.feedback = feedbackFor(q, s, judged, point, proof);
  s.feedbackFrames = [];
  s.explanationFrames = [];
  s.board[point] = 1; s.moves.push(point); s.last = point;
  s.hintStage = 0; s.answerShown = false;
  if (!judged.accepted) {
    s.status = judged.status === "refuted" ? "refuted" : "unknown";
    if (s.status === "refuted") s.metrics.errors++; else s.metrics.unknown++;
    s.scope = judged.scope;
    s.feedbackFrames = clone(judged.frames || []);
    return s;
  }
  if (winningLine(s.board, point).length) {
    s.feedbackFrames = clone(judged.frames || []);
    s.explanationFrames = clone(judged.frames || []);
    finish(s, "forced-win"); return s;
  }
  if (judged.scope === "line-prevented") {
    s.feedbackFrames = clone(judged.frames || []);
    s.explanationFrames = clone(judged.frames || []);
    finish(s, "line-prevented"); return s;
  }
  const reply = proof.line[1];
  if (!legal(s.board, reply)) throw Error("検証手順の応手が不正です");
  s.board[reply] = 2; s.moves.push(reply); s.last = reply;
  if (winner(s.board)) throw Error("検証手順に矛盾があります");
  s.plan = { line: proof.line.slice(2), scope: proof.scope };
  s.status = "continuing"; s.scope = "forced-win";
  return s;
}
export function hintRecordDrill(q, state) {
  const s = checked(q, state);
  if (!actionable(s) || s.hintStage >= 3) return s;
  s.events.push({ type: "hint" }); s.hintStage++;
  s.metrics.assisted = true; s.metrics.hints++; s.metrics.exposures++;
  return s;
}
export function answerRecordDrill(q, state) {
  const s = checked(q, state);
  if (s.answerShown) return s;
  let board = s.board, guide = currentGuide(q, s);
  if (["refuted", "unknown"].includes(s.status)) {
    board = Array.from(boardFrom(s.moves.slice(0, -1)));
    guide = s.moves.length - 1 === q.prefix.length ? q.moment.alternatives : [s.plan?.line?.[0]].filter(Number.isInteger);
  } else if (s.status === "completed") {
    board = q.before;
    guide = [s.moves[q.prefix.length]];
  }
  const initial = equal(board, q.before);
  const judged = judgeReviewMove(initial ? momentFor(q) : {
    before: board, kind: "pattern-play", alternatives: guide,
  }, guide[0]);
  if (!judged.accepted) throw Error("解説の手順を確認できません");
  s.events.push({ type: "answer" }); s.answerShown = true; s.hintStage = 3;
  s.metrics.assisted = true; s.metrics.answers++; s.metrics.exposures++;
  s.explanationFrames = clone(judged.frames || []);
  return s;
}
/** Closing/re-entering a screen hides clues without erasing lifetime assistance. */
export function hideRecordDrillHints(q, state) {
  const s = checked(q, state);
  if (!s.hintStage && !s.answerShown) return s;
  s.events.push({ type: "hide-hints" });
  s.hintStage = 0; s.answerShown = false;
  return s;
}
export function retryRecordDrill(q, state) {
  const s = checked(q, state), next = fresh(q, s.attemptId);
  next.events = [...s.events, { type: "retry" }];
  next.metrics = { ...s.metrics, retries: s.metrics.retries + 1 };
  return next;
}

/** Sole presentation boundary: do not bind raw questions, plans, or source outcomes to blind UI. */
export function getRecordDrillView(q, state) {
  assertQuestion(q);
  const s = state || startRecordDrill(q);
  if (s.questionId !== q.id || s.sourceHash !== q.source.recordHash) throw Error("問題が一致しません");
  const hints = actionable(s) && s.hintStage ? tacticalHintStages(s.board, currentGuide(q, s), 1)[s.hintStage - 1] : [];
  return {
    id: q.id, prompt: "次の一手を選ぶ", color: 1, board: [...s.board], last: s.last,
    source: { kind: q.source.kind, label: q.source.label, recordId: q.source.recordId, ply: q.ply },
    status: s.status, canPlay: actionable(s), canHint: actionable(s) && s.hintStage < 3,
    canAnswer: !s.answerShown, canRetry: true,
    hintStage: s.hintStage, highlights: clone(hints), givens: [],
    feedback: s.feedback ? clone(s.feedback) : null,
    refutationFrames: s.status === "refuted" ? clone(s.feedbackFrames || []) : [],
    explanationFrames: s.answerShown || s.status === "completed" ? clone(s.explanationFrames || []) : [],
    completion: s.status === "completed" ? {
      result: s.result, scope: s.scope, title: s.result === "black-win" ? "五が完成" : "この勝ち筋を止めた",
    } : null,
    metrics: { ...s.metrics }, qualification: { ...s.qualification },
  };
}

/** Replays only allowlisted user events against a separate trusted question. No saved board is trusted. */
export function restoreRecordDrill(q, raw) {
  try {
    assertQuestion(q);
    if (!raw || raw.questionId !== q.id || raw.sourceHash !== q.source.recordHash ||
        !Array.isArray(raw.events) || raw.events.length > MAX_EVENTS) return null;
    let s = startRecordDrill(q, { attemptId: raw.attemptId });
    for (const event of raw.events) {
      if (!event || !["play", "hint", "answer", "retry", "hide-hints"].includes(event.type) ||
          !equal(Object.keys(event).sort(), event.type === "play" ? ["point", "type"] : ["type"])) return null;
      const count = s.events.length;
      if (event.type === "play") s = playRecordDrill(q, s, event.point);
      else if (event.type === "hint") s = hintRecordDrill(q, s);
      else if (event.type === "answer") s = answerRecordDrill(q, s);
      else if (event.type === "hide-hints") s = hideRecordDrillHints(q, s);
      else s = retryRecordDrill(q, s);
      if (s.events.length !== count + 1) return null;
    }
    return equal(canonical(s), canonical(raw)) ? s : null;
  } catch { return null; }
}
