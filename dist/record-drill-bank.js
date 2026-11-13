import { verifyRecordDrill, recordDrillFingerprint } from "./record-drills.js";

export const RECORD_DRILL_BANK_VERSION = 7;
export const RECORD_DRILL_BANK_MAX_QUESTIONS = 60;
export const RECORD_DRILL_BANK_MAX_BYTES = 1_500_000;
const MAX_STATS = 240, MAX_RECEIPTS = 240, MAX_EVENTS = 512, MAX_RECENT = 12;
const sourceRank = { own: 0, import: 1, library: 2 };
const clone = (value) => JSON.parse(JSON.stringify(value));
const count = (value) => Number.isSafeInteger(value) && value >= 0 ? value : 0;
const text = (value, max = 160) => typeof value === "string" ? value.slice(0, max) : "";
const timestamp = (value) => Number.isFinite(value) && value >= 0 ? value : 0;
const limits = (options = {}) => ({
  maxQuestions: Math.min(RECORD_DRILL_BANK_MAX_QUESTIONS, Math.max(1, count(options.maxQuestions) || RECORD_DRILL_BANK_MAX_QUESTIONS)),
  maxBytes: Math.min(RECORD_DRILL_BANK_MAX_BYTES, Math.max(1024, count(options.maxBytes) || RECORD_DRILL_BANK_MAX_BYTES)),
});
export function recordDrillBankBytes(bank) {
  return new TextEncoder().encode(JSON.stringify(bank)).byteLength;
}

const skillAliases = {
  "open-three": "conditions", "broken-three": "conditions", "open-four": "conditions",
  four: "priority", "broken-four": "priority", "miss-win": "priority", "miss-block": "priority",
  "double-three": "branch", "four-three": "order", "double-four": "order", "four-chase": "order",
  vcf: "order", "lost-order": "order", "winning-chance": "order", "pattern-play": "order",
  "counter-four": "counter", "reverse-four": "counter", "allowed-counter": "counter",
  "double-plan": "prepare", "allowed-pattern": "defense", "allowed-fork": "defense", "allowed-vcf": "defense",
};
/** Maps review pattern identifiers to the existing curriculum skill vocabulary. */
export function normalizeRecordDrillSkill(value) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return skillAliases[id] || id;
}
function skill(q) {
  return normalizeRecordDrillSkill(q.moment.skillId || q.moment.patternType || q.moment.kind);
}
function emptyStat(q) {
  return { fingerprint: q.fingerprint, seen: 0, completed: 0, hints: 0, mistakes: 0, retries: 0,
    attempts: 0, unknown: 0, lastSeenAt: 0, lastAttemptAt: 0, updated: 0 };
}
function cleanStat(raw, q = null) {
  if (!raw || typeof raw !== "object") return q ? emptyStat(q) : null;
  const fingerprint = q?.fingerprint || text(raw.fingerprint, 4096);
  if (!fingerprint.startsWith("board:")) return null;
  const out = { fingerprint };
  for (const key of ["seen", "completed", "hints", "mistakes", "retries", "attempts", "unknown", "updated"])
    out[key] = count(raw[key]);
  out.lastSeenAt = timestamp(raw.lastSeenAt);
  out.lastAttemptAt = timestamp(raw.lastAttemptAt);
  return out;
}
function combinedStat(stats, q) {
  const out = emptyStat(q);
  for (const [id, raw] of Object.entries(stats)) {
    if (id !== q.id && raw.fingerprint !== q.fingerprint) continue;
    // Duplicates describe the same position; moving provenance must not reset history.
    for (const key of Object.keys(out)) if (key !== "fingerprint") out[key] = Math.max(out[key], raw[key] || 0);
  }
  return out;
}
function retention(a, b, bank) {
  if ((a.id === bank.activeId) !== (b.id === bank.activeId)) return a.id === bank.activeId ? -1 : 1;
  const aa = bank.stats[a.id] || {}, bb = bank.stats[b.id] || {};
  return sourceRank[a.source.kind] - sourceRank[b.source.kind] ||
    Number(!!aa.completed) - Number(!!bb.completed) ||
    (bb.updated || 0) - (aa.updated || 0);
}
function deduplicate(questions, bank) {
  const active = bank.questions.find((q) => q.id === bank.activeId);
  const ordered = questions.map((q, order) => ({ q, order }))
    .sort((a, b) => Number(b.q === active) - Number(a.q === active) || retention(a.q, b.q, bank) || b.order - a.order);
  const fingerprints = new Set(), positions = new Set(), ids = new Set(), kept = [];
  for (const { q } of ordered) {
    const position = `${q.source.recordHash}:${q.ply}`;
    if (ids.has(q.id) || fingerprints.has(q.fingerprint) || positions.has(position)) continue;
    ids.add(q.id); fingerprints.add(q.fingerprint); positions.add(position); kept.push(q);
  }
  // Stable question ordering makes a persist/restore cycle byte-for-byte idempotent.
  return kept.sort((a, b) => a.id.localeCompare(b.id));
}
function trimMap(map, maximum, keep = new Set()) {
  const entries = Object.entries(map).sort((a, b) => Number(keep.has(b[0])) - Number(keep.has(a[0])) ||
    (b[1].updated || 0) - (a[1].updated || 0) || a[0].localeCompare(b[0]));
  return Object.fromEntries(entries.slice(0, maximum));
}
function bound(bank, options) {
  const { maxQuestions, maxBytes } = limits(options);
  const ranked = [...bank.questions].sort((a, b) => retention(a, b, bank) || a.id.localeCompare(b.id));
  bank.questions = ranked.slice(0, maxQuestions).sort((a, b) => a.id.localeCompare(b.id));
  const kept = new Set(bank.questions.map((q) => q.id));
  bank.activeId = kept.has(bank.activeId) ? bank.activeId : null;
  bank.stats = trimMap(bank.stats, MAX_STATS, kept);
  bank.analysisReceipts = trimMap(bank.analysisReceipts, MAX_RECEIPTS);
  bank.eventIds = bank.eventIds.slice(-MAX_EVENTS);
  bank.recentIds = bank.recentIds.filter((id) => kept.has(id)).slice(-MAX_RECENT);
  const withinBudget = () => recordDrillBankBytes(bank) <= maxBytes;
  // Derived receipts and evicted-position history yield before useful boards.
  for (const map of [bank.analysisReceipts, bank.stats]) {
    const removable = Object.keys(map).filter((id) => map !== bank.stats || !kept.has(id))
      .sort((a, b) => map[a].updated - map[b].updated);
    for (const id of removable) { if (withinBudget()) break; delete map[id]; }
  }
  while (!withinBudget() && bank.eventIds.length) bank.eventIds.shift();
  while (!withinBudget() && bank.questions.length) {
    const removable = [...bank.questions].sort((a, b) => retention(b, a, bank) || b.id.localeCompare(a.id));
    const q = removable[0];
    bank.questions = bank.questions.filter((item) => item.id !== q.id);
    delete bank.stats[q.id];
    bank.recentIds = bank.recentIds.filter((id) => id !== q.id);
    if (bank.activeId === q.id) bank.activeId = null;
  }
  return bank;
}

/** Only derived questions and their independent practice history are stored here. */
export function createRecordDrillBank(raw = null, options = {}) {
  if (typeof raw === "string") { try { raw = JSON.parse(raw); } catch { raw = null; } }
  if (raw?.version !== RECORD_DRILL_BANK_VERSION) raw = null;
  const bank = { version: RECORD_DRILL_BANK_VERSION, questions: [], stats: {}, analysisReceipts: {},
    activeId: text(options.activeId === undefined ? raw?.activeId : options.activeId) || null,
    recentIds: [], eventIds: [], sequence: count(raw?.sequence) };
  if (raw && typeof raw === "object") {
    for (const [id, value] of Object.entries(raw.stats || {})) {
      const clean = cleanStat(value);
      if (clean && id && id.length <= 160) Object.defineProperty(bank.stats, id, { value: clean, enumerable: true, writable: true, configurable: true });
    }
    bank.questions = (Array.isArray(raw.questions) ? raw.questions : []).filter((q) => verifyRecordDrill(q)).map(clone);
    for (const [key, receipt] of Object.entries(raw.analysisReceipts || {})) {
      const clean = cleanReceipt(receipt);
      if (clean && receiptKey(clean) === key) bank.analysisReceipts[key] = clean;
    }
    bank.eventIds = Array.isArray(raw.eventIds) ? [...new Set(raw.eventIds.filter((id) => typeof id === "string" && id.length <= 320))] : [];
    bank.recentIds = Array.isArray(raw.recentIds) ? raw.recentIds.filter((id) => typeof id === "string") : [];
  }
  bank.questions = deduplicate(bank.questions, bank);
  for (const q of bank.questions) bank.stats[q.id] = combinedStat(bank.stats, q);
  return bound(bank, options);
}

export function mergeRecordDrills(raw, questions, options = {}) {
  const bank = createRecordDrillBank(raw, options);
  const incoming = (Array.isArray(questions) ? questions : []).filter((q) => verifyRecordDrill(q)).map(clone);
  bank.questions = deduplicate([...bank.questions, ...incoming], bank);
  for (const q of bank.questions) bank.stats[q.id] = combinedStat(bank.stats, q);
  return bound(bank, options);
}

export function pinRecordDrill(bank, questionId = null, options = {}) {
  return createRecordDrillBank(bank, { ...options, activeId: questionId });
}

/** No fallback crosses a requested skill, pattern, source, or exclusion boundary. */
export function selectRecordDrill(raw, options = {}) {
  const bank = createRecordDrillBank(raw);
  const excludedIds = new Set(options.excludeIds || []);
  const excludedFingerprints = new Set(options.excludeFingerprints || []);
  for (const board of options.excludeBoards || []) {
    const fingerprint = recordDrillFingerprint(Array.from(board || []));
    if (fingerprint) excludedFingerprints.add(fingerprint);
  }
  const requestedSkill = normalizeRecordDrillSkill(options.skillId);
  const requestedPattern = options.patternId === "vcf" ? "four-chase" : options.patternId;
  const recent = new Set(bank.recentIds);
  const last = bank.questions.find((q) => q.id === bank.recentIds.at(-1));
  const candidates = bank.questions.filter((q) => !excludedIds.has(q.id) && !excludedFingerprints.has(q.fingerprint) &&
    (!requestedSkill || skill(q) === requestedSkill) &&
    (!requestedPattern || q.moment.patternType === requestedPattern) &&
    (!options.sourceKind || q.source.kind === options.sourceKind));
  const score = (q) => {
    const stat = bank.stats[q.id];
    return [options.preferUnseen === false ? 0 : Number(stat.seen > 0), Number(recent.has(q.id)),
      Number(!!last && q.source.recordHash === last.source.recordHash),
      sourceRank[q.source.kind], stat.seen, stat.completed, stat.lastSeenAt];
  };
  candidates.sort((a, b) => {
    const aa = score(a), bb = score(b);
    for (let i = 0; i < aa.length; i++) if (aa[i] !== bb[i]) return aa[i] - bb[i];
    return a.id.localeCompare(b.id);
  });
  return candidates.length ? clone(candidates[0]) : null;
}

export function getRecordDrillStats(raw, questionId) {
  const bank = createRecordDrillBank(raw);
  return bank.stats[questionId] ? clone(bank.stats[questionId]) : null;
}
function recordEvent(raw, questionId, event, apply) {
  const bank = createRecordDrillBank(raw);
  const q = bank.questions.find((item) => item.id === questionId);
  if (!q) return bank;
  const key = event.eventId ? `${questionId}:${text(String(event.eventId), 160)}` : null;
  if (key && bank.eventIds.includes(key)) return bank;
  const stat = bank.stats[q.id];
  bank.sequence++;
  stat.updated = bank.sequence;
  const at = timestamp(event.at ?? Date.now());
  apply(stat, bank, at);
  if (key) bank.eventIds.push(key);
  return bound(bank);
}
export function noteDrillExposure(bank, questionId, event = {}) {
  return recordEvent(bank, questionId, event, (stat, next, at) => {
    stat.seen++; stat.lastSeenAt = at;
    next.recentIds = [...next.recentIds.filter((id) => id !== questionId), questionId];
  });
}
/** Unknown is a separate observation, never a failed or completed attempt. */
export function recordRecordDrillAttempt(bank, event = {}) {
  if (!["success", "mistake", "unknown", "hint", "retry"].includes(event.outcome)) return createRecordDrillBank(bank);
  return recordEvent(bank, event.questionId, event, (stat, next, at) => {
    stat.lastAttemptAt = at;
    if (event.outcome === "success") { stat.completed++; stat.attempts++; }
    else if (event.outcome === "mistake") { stat.mistakes++; stat.attempts++; }
    else if (event.outcome === "unknown") stat.unknown++;
    else if (event.outcome === "hint") stat.hints++;
    else if (event.outcome === "retry") stat.retries++;
    if (event.hinted === true && event.outcome !== "hint") stat.hints++;
  });
}

function cleanReceipt(raw) {
  if (!raw || raw.complete !== true || !/^[a-f0-9]{16}$/.test(raw.recordHash || "") ||
      !Number.isSafeInteger(raw.questionCount) || raw.questionCount < 0 || raw.questionCount > 225) return null;
  return { recordHash: raw.recordHash, analysisKey: text(raw.analysisKey || "default", 320), complete: true,
    questionCount: raw.questionCount, at: timestamp(raw.at), updated: count(raw.updated),
    sourceKind: Object.hasOwn(sourceRank, raw.sourceKind) ? raw.sourceKind : null,
    sourceId: text(raw.sourceId) || null };
}
const receiptKey = (receipt) => JSON.stringify([receipt.recordHash, receipt.analysisKey]);
/** Call only after successful extraction, including a successful empty result. */
export function noteRecordDrillAnalysis(raw, receipt) {
  const bank = createRecordDrillBank(raw), clean = cleanReceipt(receipt);
  if (!clean) return bank;
  const key = receiptKey(clean);
  if (bank.analysisReceipts[key]) return bank;
  bank.sequence++;
  bank.analysisReceipts[key] = { ...clean, at: timestamp(receipt.at ?? Date.now()), updated: bank.sequence };
  return bound(bank);
}
export function hasRecordDrillAnalysis(raw, { recordHash, analysisKey = "default" } = {}) {
  const bank = createRecordDrillBank(raw);
  return Object.hasOwn(bank.analysisReceipts, receiptKey({ recordHash, analysisKey }));
}
